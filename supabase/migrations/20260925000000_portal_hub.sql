-- =============================================================================
-- Portal hub: first-login credentials, student identity and photos, academic
-- content (announcements, homework, videos, syllabus, holidays), exams (hall
-- tickets, results), fee types and per-student fee heads, and two private
-- storage buckets.
--
-- "Class" throughout is the (class_grade, section) pair the rest of the schema
-- already uses; there is no separate classes table. A null section means every
-- section of that grade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. First-login password change
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Set when an admin issues a temporary password. Cleared only by the service role after the user sets their own.';

-- handle_new_user also carries the flag across from app_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  granted_role text := nullif(new.raw_app_meta_data ->> 'role', '');
begin
  if granted_role is null then
    return new;
  end if;

  insert into public.profiles (
    id, school_id, role, full_name, phone, email, must_change_password
  )
  values (
    new.id,
    public.safe_uuid(new.raw_app_meta_data ->> 'school_id'),
    granted_role::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', new.phone),
    new.email,
    coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- The guard now also protects must_change_password, so a user cannot skip the
-- first-login change by clearing their own flag through the API. Direct
-- database sessions (no JWT) and the service role are trusted.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is null or auth.role() = 'service_role' or public.is_super_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     and not public.is_school_admin(old.school_id) then
    raise exception 'role changes require a school administrator'
      using errcode = '42501';
  end if;

  if new.school_id is distinct from old.school_id then
    raise exception 'profiles cannot be moved between tenants'
      using errcode = '42501';
  end if;

  if new.role = 'SUPER_ADMIN' then
    raise exception 'SUPER_ADMIN may only be granted by the platform operator'
      using errcode = '42501';
  end if;

  if new.must_change_password is distinct from old.must_change_password
     and not public.is_school_admin(old.school_id) then
    raise exception 'must_change_password is managed by the school'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Student identity and photo
-- -----------------------------------------------------------------------------
-- roll_number already exists (per class and section). USN is the school-wide
-- student identifier, and the login ID for student accounts.
alter table public.students
  add column if not exists usn text
    check (usn is null or usn ~ '^[A-Za-z0-9-]{3,20}$'),
  add column if not exists avatar_url text;

comment on column public.students.avatar_url is
  'Object path inside the private avatars bucket, e.g. <school_id>/<student_id>-<n>.jpg.';

create unique index if not exists students_usn_unique
  on public.students (school_id, lower(usn))
  where usn is not null;

-- Can the caller see content addressed to this grade (and optionally
-- section)? Staff see everything in their tenant; a student or parent sees
-- content for any class one of their linked, active students is in.
create or replace function public.can_view_class(
  target_school uuid,
  target_grade text,
  target_section text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_school_staff(target_school)
      or exists (
        select 1
          from public.students s
         where s.school_id = target_school
           and s.is_active
           and (s.user_id = auth.uid() or s.parent_user_id = auth.uid())
           and (target_grade is null or s.class_grade = target_grade)
           and (target_section is null or s.section = target_section)
      );
$$;

grant execute on function public.can_view_class(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Announcements
-- -----------------------------------------------------------------------------
create table if not exists public.announcements (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  title          text not null check (length(btrim(title)) between 3 and 150),
  content        text not null check (length(btrim(content)) between 1 and 5000),
  target_type    text not null default 'ALL' check (target_type in ('ALL', 'CLASS', 'SECTION')),
  target_grade   text,
  target_section text,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint announcements_target_shape check (
    (target_type = 'ALL'     and target_grade is null     and target_section is null) or
    (target_type = 'CLASS'   and target_grade is not null and target_section is null) or
    (target_type = 'SECTION' and target_grade is not null and target_section is not null)
  )
);

create index if not exists announcements_school_created
  on public.announcements (school_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Homework and video references
-- -----------------------------------------------------------------------------
create table if not exists public.homework (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  class_grade text not null,
  section     text,
  subject     text not null check (length(btrim(subject)) between 2 and 60),
  title       text not null check (length(btrim(title)) between 3 and 150),
  description text,
  due_date    date not null,
  -- [{ "name": "worksheet.pdf", "path": "<school_id>/homework/..." }]
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists homework_school_class_due
  on public.homework (school_id, class_grade, due_date);

create table if not exists public.video_references (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  class_grade text not null,
  section     text,
  subject     text not null check (length(btrim(subject)) between 2 and 60),
  youtube_url text not null check (
    youtube_url ~ '^https://(www\.|m\.)?(youtube\.com/(watch\?v=|embed/|shorts/)|youtu\.be/)[A-Za-z0-9_-]{11}'
  ),
  title       text not null check (length(btrim(title)) between 3 and 150),
  description text,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists video_references_school_class
  on public.video_references (school_id, class_grade, created_at desc);

-- -----------------------------------------------------------------------------
-- 5. Fee types, and fee heads for individual students
-- -----------------------------------------------------------------------------
create table if not exists public.fee_types (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 2 and 40),
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fee_types_name_unique
  on public.fee_types (school_id, lower(name));

-- Every school starts with the three standard categories.
create or replace function public.seed_fee_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.fee_types (school_id, name, is_system)
  values (new.id, 'Tuition', true), (new.id, 'Exam', true), (new.id, 'Bus', true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_schools_seed_fee_types on public.schools;
create trigger trg_schools_seed_fee_types
  after insert on public.schools
  for each row execute function public.seed_fee_types();

insert into public.fee_types (school_id, name, is_system)
select s.id, t.name, true
  from public.schools s
 cross join (values ('Tuition'), ('Exam'), ('Bus')) as t (name)
on conflict do nothing;

alter table public.fee_structures
  add column if not exists fee_type_id uuid references public.fee_types (id) on delete set null,
  add column if not exists student_id uuid references public.students (id) on delete cascade;

comment on column public.fee_structures.student_id is
  'Null for a class-wide fee head; set for a charge on one student only.';

-- Existing heads get a category from their title.
update public.fee_structures f
   set fee_type_id = t.id
  from public.fee_types t
 where f.fee_type_id is null
   and t.school_id = f.school_id
   and t.name = case
         when f.title ilike '%tuition%' then 'Tuition'
         when f.title ilike '%exam%' then 'Exam'
         when f.title ilike '%bus%' or f.title ilike '%transport%' then 'Bus'
       end;

-- One head per title per class per year, or per student when student_id is set.
alter table public.fee_structures drop constraint if exists fee_structures_unique;
alter table public.fee_structures
  add constraint fee_structures_unique
  unique nulls not distinct (school_id, academic_year, class_grade, title, student_id);

drop trigger if exists trg_fee_structures_tenant on public.fee_structures;
create or replace function public.assert_optional_student_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.students s
     where s.id = new.student_id
       and s.school_id = new.school_id
       and s.class_grade = new.class_grade
  ) then
    raise exception 'student % is not in class % of this school', new.student_id, new.class_grade
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_fee_structures_tenant
  before insert or update of student_id, school_id, class_grade on public.fee_structures
  for each row execute function public.assert_optional_student_tenant();

-- A student-specific charge is not part of the public schedule, and is visible
-- only to staff and to that student's own family.
drop policy if exists fee_structures_select_public on public.fee_structures;
create policy fee_structures_select_public
  on public.fee_structures for select
  to anon
  using (
    student_id is null
    and exists (
      select 1 from public.schools s
       where s.id = fee_structures.school_id and s.is_active = true
    )
  );

drop policy if exists fee_structures_select_tenant on public.fee_structures;
create policy fee_structures_select_tenant
  on public.fee_structures for select
  to authenticated
  using (
    public.is_school_staff(school_id)
    or (student_id is null and public.is_member_of(school_id))
    or (student_id is not null and public.owns_student(student_id))
  );

-- Dues: class heads plus the student's own heads, less their concession.
create or replace function public.sync_class_dues(target_school uuid, target_grade text)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with updated as (
    update public.students s
       set total_fee_due = greatest(
             coalesce((
               select sum(f.amount)
                 from public.fee_structures f
                where f.school_id = target_school
                  and f.class_grade = target_grade
                  and f.academic_year = public.current_academic_year()
                  and (f.student_id is null or f.student_id = s.id)
             ), 0) - s.fee_concession,
             0)
     where s.school_id = target_school
       and s.class_grade = target_grade
       and s.is_active
    returning 1
  )
  select count(*)::integer from updated;
$$;

-- -----------------------------------------------------------------------------
-- 6. Exams: hall tickets and results
-- -----------------------------------------------------------------------------
create table if not exists public.hall_tickets (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  exam_name      text not null check (length(btrim(exam_name)) between 2 and 80),
  term           text not null check (length(btrim(term)) between 1 and 40),
  -- Optional uploaded PDF (academic-docs path). Null: the app renders one.
  ticket_pdf_url text,
  is_published   boolean not null default false,
  issued_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint hall_tickets_unique unique (student_id, exam_name, term)
);

create table if not exists public.exam_results (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  exam_name      text not null check (length(btrim(exam_name)) between 2 and 80),
  subject        text not null check (length(btrim(subject)) between 2 and 60),
  marks_obtained numeric(6, 2) not null check (marks_obtained >= 0),
  max_marks      numeric(6, 2) not null check (max_marks > 0),
  grade          text,
  remarks        text,
  entered_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint exam_results_marks_range check (marks_obtained <= max_marks),
  constraint exam_results_unique unique (student_id, exam_name, subject)
);

create index if not exists exam_results_school_exam
  on public.exam_results (school_id, exam_name);

drop trigger if exists trg_hall_tickets_tenant on public.hall_tickets;
create trigger trg_hall_tickets_tenant
  before insert or update of student_id, school_id on public.hall_tickets
  for each row execute function public.assert_student_tenant();

drop trigger if exists trg_exam_results_tenant on public.exam_results;
create trigger trg_exam_results_tenant
  before insert or update of student_id, school_id on public.exam_results
  for each row execute function public.assert_student_tenant();

-- -----------------------------------------------------------------------------
-- 7. Holidays and syllabus
-- -----------------------------------------------------------------------------
create table if not exists public.holiday_calendar (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id) on delete cascade,
  title               text not null check (length(btrim(title)) between 2 and 120),
  date                date not null,
  description         text,
  is_academic_holiday boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint holiday_calendar_unique unique (school_id, date, title)
);

create table if not exists public.syllabus_copies (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  class_grade   text not null,
  subject       text not null check (length(btrim(subject)) between 2 and 60),
  pdf_url       text not null,
  academic_year text not null default public.current_academic_year(),
  uploaded_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint syllabus_copies_unique unique (school_id, academic_year, class_grade, subject)
);

-- -----------------------------------------------------------------------------
-- 8. updated_at, RLS and grants for the new tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'announcements', 'homework', 'video_references', 'fee_types',
    'hall_tickets', 'exam_results', 'holiday_calendar', 'syllabus_copies'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- Announcements: whole-school posts go to every member; targeted ones to that
-- class's families. Staff publish; the author or an admin may edit or remove.
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (
    public.is_school_staff(school_id)
    or (target_type = 'ALL' and public.is_member_of(school_id))
    or (target_type <> 'ALL' and public.can_view_class(school_id, target_grade, target_section))
  );

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_school_staff(school_id) and created_by = auth.uid());

drop policy if exists announcements_modify on public.announcements;
create policy announcements_modify on public.announcements for update to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_staff(school_id) and created_by = auth.uid()))
  with check (public.is_school_staff(school_id));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_school_admin(school_id) or (public.is_school_staff(school_id) and created_by = auth.uid()));

-- Homework, videos and syllabus share one shape: class-scoped reads, staff
-- writes, and only the author or an admin may change or remove a row.
do $$
declare
  t text;
  author text;
begin
  foreach t in array array['homework', 'video_references', 'syllabus_copies']
  loop
    author := case when t = 'syllabus_copies' then 'uploaded_by' else 'created_by' end;

    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$
      create policy %1$s_select on public.%1$I for select to authenticated
        using (public.can_view_class(school_id, class_grade, %2$s))
    $p$, t, case when t = 'syllabus_copies' then 'null' else 'section' end);

    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (public.is_school_staff(school_id) and %2$I = auth.uid())
    $p$, t, author);

    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$
      create policy %1$s_update on public.%1$I for update to authenticated
        using (public.is_school_admin(school_id) or (public.is_school_staff(school_id) and %2$I = auth.uid()))
        with check (public.is_school_staff(school_id))
    $p$, t, author);

    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using (public.is_school_admin(school_id) or (public.is_school_staff(school_id) and %2$I = auth.uid()))
    $p$, t, author);
  end loop;
end
$$;

-- Fee types: every member reads the categories, admins manage them, and the
-- three system categories cannot be deleted.
drop policy if exists fee_types_select on public.fee_types;
create policy fee_types_select on public.fee_types for select to authenticated
  using (public.is_member_of(school_id));

drop policy if exists fee_types_insert on public.fee_types;
create policy fee_types_insert on public.fee_types for insert to authenticated
  with check (public.is_school_admin(school_id) and not is_system);

drop policy if exists fee_types_update on public.fee_types;
create policy fee_types_update on public.fee_types for update to authenticated
  using (public.is_school_admin(school_id) and not is_system)
  with check (public.is_school_admin(school_id) and not is_system);

drop policy if exists fee_types_delete on public.fee_types;
create policy fee_types_delete on public.fee_types for delete to authenticated
  using (public.is_school_admin(school_id) and not is_system);

-- Hall tickets: staff issue them; a family sees one only once it is published.
drop policy if exists hall_tickets_select on public.hall_tickets;
create policy hall_tickets_select on public.hall_tickets for select to authenticated
  using (
    public.is_school_staff(school_id)
    or (is_published and public.owns_student(student_id))
  );

drop policy if exists hall_tickets_write on public.hall_tickets;
create policy hall_tickets_write on public.hall_tickets for insert to authenticated
  with check (public.is_school_staff(school_id));

drop policy if exists hall_tickets_update on public.hall_tickets;
create policy hall_tickets_update on public.hall_tickets for update to authenticated
  using (public.is_school_staff(school_id))
  with check (public.is_school_staff(school_id));

drop policy if exists hall_tickets_delete on public.hall_tickets;
create policy hall_tickets_delete on public.hall_tickets for delete to authenticated
  using (public.is_school_admin(school_id));

-- Results: staff enter marks; a family reads its own child's.
drop policy if exists exam_results_select on public.exam_results;
create policy exam_results_select on public.exam_results for select to authenticated
  using (public.is_school_staff(school_id) or public.owns_student(student_id));

drop policy if exists exam_results_insert on public.exam_results;
create policy exam_results_insert on public.exam_results for insert to authenticated
  with check (public.is_school_staff(school_id));

drop policy if exists exam_results_update on public.exam_results;
create policy exam_results_update on public.exam_results for update to authenticated
  using (public.is_school_staff(school_id))
  with check (public.is_school_staff(school_id));

drop policy if exists exam_results_delete on public.exam_results;
create policy exam_results_delete on public.exam_results for delete to authenticated
  using (public.is_school_admin(school_id));

-- Holidays: every member reads, admins manage.
drop policy if exists holiday_calendar_select on public.holiday_calendar;
create policy holiday_calendar_select on public.holiday_calendar for select to authenticated
  using (public.is_member_of(school_id));

drop policy if exists holiday_calendar_insert on public.holiday_calendar;
create policy holiday_calendar_insert on public.holiday_calendar for insert to authenticated
  with check (public.is_school_admin(school_id));

drop policy if exists holiday_calendar_update on public.holiday_calendar;
create policy holiday_calendar_update on public.holiday_calendar for update to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists holiday_calendar_delete on public.holiday_calendar;
create policy holiday_calendar_delete on public.holiday_calendar for delete to authenticated
  using (public.is_school_admin(school_id));

-- -----------------------------------------------------------------------------
-- 9. Storage: avatars and academic-docs
--     Both private, laid out as <school_id>/... like fee-receipts, and served
--     through short-lived signed URLs. Staff write; members of the tenant read.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 2097152,
    array['image/png', 'image/jpeg', 'image/webp']),
  ('academic-docs', 'academic-docs', false, 10485760,
    array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

drop policy if exists tenant_docs_read on storage.objects;
create policy tenant_docs_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('avatars', 'academic-docs')
    and public.is_member_of(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists tenant_docs_insert on storage.objects;
create policy tenant_docs_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('avatars', 'academic-docs')
    and public.is_school_staff(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists tenant_docs_update on storage.objects;
create policy tenant_docs_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('avatars', 'academic-docs')
    and public.is_school_staff(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists tenant_docs_delete on storage.objects;
create policy tenant_docs_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('avatars', 'academic-docs')
    and public.is_school_staff(public.safe_uuid((storage.foldername(name))[1]))
  );
