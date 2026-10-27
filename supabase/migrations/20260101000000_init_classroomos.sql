-- =============================================================================
-- ClassroomOS - Multi-tenant School & College Management ERP
-- Target: Supabase / PostgreSQL 15+
-- File:   supabase/schema.sql
--
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- Tenancy model
-- -------------
-- Every tenant-owned row carries school_id. Isolation is enforced in the
-- database (RLS), never in application code. The tenant of the calling user is
-- resolved by public.current_school_id(), which prefers the school_id claim
-- minted into the JWT by the custom access token hook and falls back to a
-- SECURITY DEFINER lookup against profiles, so a project without the hook
-- installed still behaves correctly.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum (
      'SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('PENDING', 'SUCCESS', 'FAILED');
  end if;

  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum ('PRESENT', 'ABSENT', 'LATE');
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum ('NEW', 'CONTACTED', 'ADMITTED', 'REJECTED');
  end if;
end
$$;
-- Indian academic year label, e.g. '2026-2027' for any date from 1 April.
create or replace function public.current_academic_year()
returns text
language sql
stable
as $$
  select case
    when extract(month from now()) >= 4
      then extract(year from now())::int::text || '-' || (extract(year from now())::int + 1)::text
    else (extract(year from now())::int - 1)::text || '-' || extract(year from now())::int::text
  end;
$$;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- 2.1 schools ----------------------------------------------------------------
create table if not exists public.schools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 160),
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 3 and 80),
  logo_url      text,
  custom_domain text unique,
  address       text,
  city          text,
  state         text,
  pincode       text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  contact_email text,
  contact_phone text,
  board         text,
  established_year int check (established_year is null or established_year between 1800 and 2100),
  tagline       text,
  hero_image_url text,
  primary_color text default '#1d4ed8',
  razorpay_key_id text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.schools is
  'Tenant root. One row per institution; slug drives the public portal URL.';

-- 2.2 profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  school_id  uuid references public.schools (id) on delete cascade,
  role       public.user_role not null default 'STUDENT',
  full_name  text not null default '',
  phone      text,
  email      text,
  avatar_url text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Every role except the platform operator must belong to exactly one tenant.
  constraint profiles_tenant_required
    check (role = 'SUPER_ADMIN' or school_id is not null)
);

comment on table public.profiles is
  'Application user record, 1:1 with auth.users, carrying tenant and role.';

-- 2.3 students ---------------------------------------------------------------
create table if not exists public.students (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  roll_number      text not null,
  admission_number text,
  full_name        text not null default '',
  class_grade      text not null,
  section          text not null default 'A',
  parent_name      text,
  parent_phone     text not null,
  parent_user_id   uuid references auth.users (id) on delete set null,
  date_of_birth    date,
  gender           text check (gender is null or gender in ('MALE', 'FEMALE', 'OTHER')),
  total_fee_due    numeric(12, 2) not null default 0 check (total_fee_due >= 0),
  current_balance  numeric(12, 2) not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Roll numbers repeat across schools and classes, never inside one class.
  constraint students_roll_unique unique (school_id, class_grade, section, roll_number)
);

comment on column public.students.current_balance is
  'total_fee_due minus SUCCESS payments. Maintained by trigger, never by the client.';

-- 2.4 fee_structures ---------------------------------------------------------
create table if not exists public.fee_structures (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  title         text not null,
  description   text,
  amount        numeric(12, 2) not null check (amount >= 0),
  due_date      date not null,
  class_grade   text not null,
  academic_year text not null default public.current_academic_year(),
  is_recurring  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fee_structures_unique unique (school_id, academic_year, class_grade, title)
);

-- 2.5 fee_payments -----------------------------------------------------------
create table if not exists public.fee_payments (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id) on delete cascade,
  student_id          uuid not null references public.students (id) on delete cascade,
  fee_structure_id    uuid references public.fee_structures (id) on delete set null,
  amount_paid         numeric(12, 2) not null check (amount_paid >= 0),
  payment_method      text not null default 'UPI',
  razorpay_order_id   text,
  razorpay_payment_id text,
  razorpay_signature  text,
  status              public.payment_status not null default 'PENDING',
  receipt_number      text,
  receipt_url         text,
  notes               text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Razorpay identifiers are globally unique. These constraints are what make
  -- the webhook handler idempotent under gateway retries.
  constraint fee_payments_order_unique unique (razorpay_order_id),
  constraint fee_payments_payment_unique unique (razorpay_payment_id),
  constraint fee_payments_receipt_unique unique (school_id, receipt_number)
);

-- 2.6 attendance -------------------------------------------------------------
create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  date       date not null default current_date,
  status     public.attendance_status not null,
  remarks    text,
  marked_by  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One record per student per day; bulk submission upserts on this key.
  constraint attendance_unique_per_day unique (student_id, date)
);

-- 2.7 admission_leads --------------------------------------------------------
create table if not exists public.admission_leads (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  applicant_name text not null check (length(btrim(applicant_name)) between 2 and 120),
  parent_name    text not null check (length(btrim(parent_name)) between 2 and 120),
  phone          text not null check (phone ~ '^[0-9]{10}$'),
  email          text,
  target_grade   text not null,
  message        text,
  source         text not null default 'PUBLIC_PORTAL',
  status         public.lead_status not null default 'NEW',
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.admission_leads is
  'Enquiries captured by the public portal. Anonymous INSERT is allowed, reads are staff only.';

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

create index if not exists idx_profiles_school        on public.profiles (school_id);
create index if not exists idx_profiles_role          on public.profiles (school_id, role);

create index if not exists idx_students_school        on public.students (school_id);
create index if not exists idx_students_class         on public.students (school_id, class_grade, section);
create index if not exists idx_students_user          on public.students (user_id);
create index if not exists idx_students_parent_user   on public.students (parent_user_id);
create index if not exists idx_students_name_trgm     on public.students
  using gin (full_name extensions.gin_trgm_ops);

create index if not exists idx_fee_structures_school  on public.fee_structures (school_id, class_grade);

create index if not exists idx_fee_payments_school    on public.fee_payments (school_id, created_at desc);
create index if not exists idx_fee_payments_student   on public.fee_payments (student_id, created_at desc);
create index if not exists idx_fee_payments_status    on public.fee_payments (school_id, status);

create index if not exists idx_attendance_school_date on public.attendance (school_id, date desc);
create index if not exists idx_attendance_student     on public.attendance (student_id, date desc);

create index if not exists idx_leads_school_created   on public.admission_leads (school_id, created_at desc);
create index if not exists idx_leads_status           on public.admission_leads (school_id, status);

-- =============================================================================
-- 4. TENANCY HELPER FUNCTIONS
--    SECURITY DEFINER so policies on profiles can call them without recursing
--    through profiles' own RLS.
-- =============================================================================

create or replace function public.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'school_id', '')::uuid,
    (select p.school_id from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'user_role', '')::public.user_role,
    (select p.role from public.profiles p where p.id = auth.uid()),
    'STUDENT'::public.user_role
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() = 'SUPER_ADMIN';
$$;

-- Belongs to this tenant (or is the platform operator).
create or replace function public.is_member_of(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_school is not null
     and (public.is_super_admin() or target_school = public.current_school_id());
$$;

-- Can administer this tenant: its SCHOOL_ADMIN, or the platform operator.
create or replace function public.is_school_admin(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_super_admin()
     or (public.current_user_role() = 'SCHOOL_ADMIN'
         and target_school is not null
         and target_school = public.current_school_id());
$$;

-- Can act on academic records: teachers and admins of this tenant.
create or replace function public.is_school_staff(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_super_admin()
     or (public.current_user_role() in ('SCHOOL_ADMIN', 'TEACHER')
         and target_school is not null
         and target_school = public.current_school_id());
$$;

-- Is the caller the student themselves, or that student's linked parent?
create or replace function public.owns_student(target_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.students s
    where s.id = target_student
      and (s.user_id = auth.uid() or s.parent_user_id = auth.uid())
  );
$$;

-- Path segments in storage are arbitrary text; a bad key must read as "not
-- your tenant", not raise invalid_text_representation from inside a policy.
create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

grant execute on function public.safe_uuid(text) to authenticated, anon;

grant execute on function
  public.current_academic_year(),
  public.current_school_id(),
  public.current_user_role(),
  public.is_super_admin(),
  public.is_member_of(uuid),
  public.is_school_admin(uuid),
  public.is_school_staff(uuid),
  public.owns_student(uuid)
to authenticated, anon;

-- =============================================================================
-- 5. TRIGGERS: timestamps, tenant integrity, balances, receipts
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'schools', 'profiles', 'students', 'fee_structures',
    'fee_payments', 'attendance', 'admission_leads'
  ]
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- Defence in depth: a payment or attendance row may never point at a student
-- in another tenant, even when written by a privileged service-role caller.
create or replace function public.assert_student_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_school uuid;
begin
  select school_id into student_school from public.students where id = new.student_id;

  if student_school is null then
    raise exception 'student % does not exist', new.student_id using errcode = '23503';
  end if;

  if student_school <> new.school_id then
    raise exception 'tenant mismatch: student % belongs to school %, row declares %',
      new.student_id, student_school, new.school_id using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fee_payments_tenant on public.fee_payments;
create trigger trg_fee_payments_tenant
  before insert or update of student_id, school_id on public.fee_payments
  for each row execute function public.assert_student_tenant();

drop trigger if exists trg_attendance_tenant on public.attendance;
create trigger trg_attendance_tenant
  before insert or update of student_id, school_id on public.attendance
  for each row execute function public.assert_student_tenant();

-- Single source of truth for a student's outstanding balance.
create or replace function public.recalculate_student_balance(target_student uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid    numeric(12, 2);
  due     numeric(12, 2);
  balance numeric(12, 2);
begin
  select coalesce(sum(amount_paid), 0)
    into paid
    from public.fee_payments
   where student_id = target_student
     and status = 'SUCCESS';

  select coalesce(total_fee_due, 0) into due
    from public.students where id = target_student;

  balance := due - paid;

  update public.students
     set current_balance = balance,
         updated_at = now()
   where id = target_student;

  return balance;
end;
$$;

grant execute on function public.recalculate_student_balance(uuid)
  to authenticated, service_role;

create or replace function public.sync_student_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_student_balance(old.student_id);
    return old;
  end if;

  perform public.recalculate_student_balance(new.student_id);

  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    perform public.recalculate_student_balance(old.student_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fee_payments_balance on public.fee_payments;
create trigger trg_fee_payments_balance
  after insert or delete or update of amount_paid, status, student_id on public.fee_payments
  for each row execute function public.sync_student_balance();

-- Changing the assessed fee must move the balance with it.
create or replace function public.sync_balance_on_fee_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.total_fee_due is distinct from old.total_fee_due then
    perform public.recalculate_student_balance(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_students_fee_change on public.students;
create trigger trg_students_fee_change
  after update of total_fee_due on public.students
  for each row execute function public.sync_balance_on_fee_change();

-- A new student has no payments yet, so the balance starts at the full due.
-- Without this, rows inserted with a total_fee_due (the seed, bulk imports)
-- would show nothing outstanding until their fee next changed.
create or replace function public.init_student_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.current_balance := new.total_fee_due;
  return new;
end;
$$;

drop trigger if exists trg_students_init_balance on public.students;
create trigger trg_students_init_balance
  before insert on public.students
  for each row execute function public.init_student_balance();

-- Human-readable, per-tenant receipt numbers: DPSR/2026-27/000042
create sequence if not exists public.receipt_number_seq;

create or replace function public.next_receipt_number(target_school uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fy       text;
  seq      bigint;
  slug     text;
  prefix   text;
begin
  select s.slug into slug from public.schools s where s.id = target_school;

  fy := case when extract(month from now()) >= 4
          then to_char(now(), 'YYYY') || '-' || to_char(now() + interval '1 year', 'YY')
          else to_char(now() - interval '1 year', 'YYYY') || '-' || to_char(now(), 'YY')
        end;

  prefix := upper(coalesce(
    nullif(left(regexp_replace(coalesce(slug, ''), '[^a-zA-Z0-9]', '', 'g'), 4), ''),
    'SCHL'));

  seq := nextval('public.receipt_number_seq');

  return prefix || '/' || fy || '/' || lpad(seq::text, 6, '0');
end;
$$;

grant execute on function public.next_receipt_number(uuid) to authenticated, service_role;

-- An auth user gets a profile once the platform has assigned them a role.
--
-- Tenant and role come from raw_app_meta_data, which only the service role can
-- write. raw_user_meta_data is whatever the caller passed to signUp(), so
-- trusting it here would let anyone self-register as SCHOOL_ADMIN of any
-- tenant. GoTrue inserts the user first and writes app_metadata in a second
-- statement, so this runs on both; a user with no assigned role (a public
-- signup) gets no profile, and every RLS helper treats them as nobody.
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

  insert into public.profiles (id, school_id, role, full_name, phone, email)
  values (
    new.id,
    public.safe_uuid(new.raw_app_meta_data ->> 'school_id'),
    granted_role::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', new.phone),
    new.email
  )
  -- Later role or tenant changes go through profiles and its guard trigger.
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 6. ROW LEVEL SECURITY
--
-- Every table below denies by default; each verb is granted explicitly.
-- The shape of every tenant policy is the same: the row's school_id must equal
-- public.current_school_id(). SUPER_ADMIN (the platform operator) is the only
-- principal that crosses tenants, and it does so through the helper functions
-- rather than through a policy exception per table.
-- =============================================================================

alter table public.schools         enable row level security;
alter table public.profiles        enable row level security;
alter table public.students        enable row level security;
alter table public.fee_structures  enable row level security;
alter table public.fee_payments    enable row level security;
alter table public.attendance      enable row level security;
alter table public.admission_leads enable row level security;

-- Force RLS for table owners too, so a mis-scoped connection cannot bypass it.
alter table public.students        force row level security;
alter table public.fee_payments    force row level security;
alter table public.attendance      force row level security;
alter table public.admission_leads force row level security;

grant usage on schema public to anon, authenticated;
grant select on public.schools, public.fee_structures to anon;
grant insert on public.admission_leads to anon;
grant select, insert, update, delete on
  public.schools, public.profiles, public.students, public.fee_structures,
  public.fee_payments, public.attendance, public.admission_leads
to authenticated;

-- -----------------------------------------------------------------------------
-- 6.1 schools
-- -----------------------------------------------------------------------------
drop policy if exists schools_select_public on public.schools;
create policy schools_select_public
  on public.schools for select
  to anon
  using (is_active = true);

drop policy if exists schools_select_member on public.schools;
create policy schools_select_member
  on public.schools for select
  to authenticated
  using (public.is_super_admin() or id = public.current_school_id() or is_active = true);

drop policy if exists schools_insert_platform on public.schools;
create policy schools_insert_platform
  on public.schools for insert
  to authenticated
  with check (public.is_super_admin());

drop policy if exists schools_update_admin on public.schools;
create policy schools_update_admin
  on public.schools for update
  to authenticated
  using (public.is_school_admin(id))
  with check (public.is_school_admin(id));

drop policy if exists schools_delete_platform on public.schools;
create policy schools_delete_platform
  on public.schools for delete
  to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 6.2 profiles
--     A user always sees their own row. Staff see the roster of their own
--     school only. Role and tenant changes are additionally gated by trigger,
--     because WITH CHECK alone cannot compare OLD to NEW.
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_tenant on public.profiles;
create policy profiles_select_self_or_tenant
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.is_school_staff(school_id)
  );

drop policy if exists profiles_insert_self_or_admin on public.profiles;
create policy profiles_insert_self_or_admin
  on public.profiles for insert
  to authenticated
  with check (
    (id = auth.uid() and role <> 'SUPER_ADMIN')
    or public.is_school_admin(school_id)
  );

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_school_admin(school_id))
  with check (id = auth.uid() or public.is_school_admin(school_id));

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.is_school_admin(school_id));

-- Nobody edits their own role or moves themselves between tenants.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_super_admin() then
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

  -- A school admin may not mint another SUPER_ADMIN.
  if new.role = 'SUPER_ADMIN' then
    raise exception 'SUPER_ADMIN may only be granted by the platform operator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- 6.3 students
-- -----------------------------------------------------------------------------
drop policy if exists students_select_tenant on public.students;
create policy students_select_tenant
  on public.students for select
  to authenticated
  using (
    public.is_school_staff(school_id)
    or user_id = auth.uid()
    or parent_user_id = auth.uid()
  );

drop policy if exists students_insert_admin on public.students;
create policy students_insert_admin
  on public.students for insert
  to authenticated
  with check (public.is_school_admin(school_id));

drop policy if exists students_update_admin on public.students;
create policy students_update_admin
  on public.students for update
  to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists students_delete_admin on public.students;
create policy students_delete_admin
  on public.students for delete
  to authenticated
  using (public.is_school_admin(school_id));

-- -----------------------------------------------------------------------------
-- 6.4 fee_structures
--     The fee schedule is published on the public portal, so anon may read it.
-- -----------------------------------------------------------------------------
drop policy if exists fee_structures_select_public on public.fee_structures;
create policy fee_structures_select_public
  on public.fee_structures for select
  to anon
  using (
    exists (
      select 1 from public.schools s
      where s.id = fee_structures.school_id and s.is_active = true
    )
  );

drop policy if exists fee_structures_select_tenant on public.fee_structures;
create policy fee_structures_select_tenant
  on public.fee_structures for select
  to authenticated
  using (public.is_member_of(school_id));

drop policy if exists fee_structures_insert_admin on public.fee_structures;
create policy fee_structures_insert_admin
  on public.fee_structures for insert
  to authenticated
  with check (public.is_school_admin(school_id));

drop policy if exists fee_structures_update_admin on public.fee_structures;
create policy fee_structures_update_admin
  on public.fee_structures for update
  to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists fee_structures_delete_admin on public.fee_structures;
create policy fee_structures_delete_admin
  on public.fee_structures for delete
  to authenticated
  using (public.is_school_admin(school_id));

-- -----------------------------------------------------------------------------
-- 6.5 fee_payments
--     Parents and students read their own ledger. Gateway-driven writes arrive
--     through the webhook on the service role, which bypasses RLS by design.
-- -----------------------------------------------------------------------------
drop policy if exists fee_payments_select_tenant on public.fee_payments;
create policy fee_payments_select_tenant
  on public.fee_payments for select
  to authenticated
  using (
    public.is_school_staff(school_id)
    or public.owns_student(student_id)
  );

drop policy if exists fee_payments_insert_admin on public.fee_payments;
create policy fee_payments_insert_admin
  on public.fee_payments for insert
  to authenticated
  with check (
    public.is_school_admin(school_id)
    -- A parent may open their own PENDING payment before redirecting to the
    -- gateway; only the webhook can ever mark it SUCCESS.
    or (public.owns_student(student_id)
        and status = 'PENDING'
        and public.is_member_of(school_id))
  );

drop policy if exists fee_payments_update_admin on public.fee_payments;
create policy fee_payments_update_admin
  on public.fee_payments for update
  to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists fee_payments_delete_platform on public.fee_payments;
create policy fee_payments_delete_platform
  on public.fee_payments for delete
  to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 6.6 attendance
-- -----------------------------------------------------------------------------
drop policy if exists attendance_select_tenant on public.attendance;
create policy attendance_select_tenant
  on public.attendance for select
  to authenticated
  using (
    public.is_school_staff(school_id)
    or public.owns_student(student_id)
  );

drop policy if exists attendance_insert_staff on public.attendance;
create policy attendance_insert_staff
  on public.attendance for insert
  to authenticated
  with check (public.is_school_staff(school_id) and marked_by = auth.uid());

drop policy if exists attendance_update_staff on public.attendance;
create policy attendance_update_staff
  on public.attendance for update
  to authenticated
  using (public.is_school_staff(school_id))
  with check (public.is_school_staff(school_id) and marked_by = auth.uid());

drop policy if exists attendance_delete_admin on public.attendance;
create policy attendance_delete_admin
  on public.attendance for delete
  to authenticated
  using (public.is_school_admin(school_id));

-- -----------------------------------------------------------------------------
-- 6.7 admission_leads
--     The public portal posts here anonymously. The WITH CHECK pins the row to
--     a real, active tenant and to the portal source, so the open endpoint
--     cannot be used to forge internal lead sources or target a dead tenant.
--     Nothing anonymous may read back.
-- -----------------------------------------------------------------------------
drop policy if exists leads_insert_public on public.admission_leads;
create policy leads_insert_public
  on public.admission_leads for insert
  to anon
  with check (
    source = 'PUBLIC_PORTAL'
    and status = 'NEW'
    and exists (
      select 1 from public.schools s
      where s.id = admission_leads.school_id and s.is_active = true
    )
  );

drop policy if exists leads_insert_tenant on public.admission_leads;
create policy leads_insert_tenant
  on public.admission_leads for insert
  to authenticated
  with check (
    public.is_school_staff(school_id)
    or exists (
      select 1 from public.schools s
      where s.id = admission_leads.school_id and s.is_active = true
    )
  );

drop policy if exists leads_select_staff on public.admission_leads;
create policy leads_select_staff
  on public.admission_leads for select
  to authenticated
  using (public.is_school_staff(school_id));

drop policy if exists leads_update_staff on public.admission_leads;
create policy leads_update_staff
  on public.admission_leads for update
  to authenticated
  using (public.is_school_staff(school_id))
  with check (public.is_school_staff(school_id));

drop policy if exists leads_delete_admin on public.admission_leads;
create policy leads_delete_admin
  on public.admission_leads for delete
  to authenticated
  using (public.is_school_admin(school_id));

-- =============================================================================
-- 7. CUSTOM ACCESS TOKEN HOOK
--     Mints school_id and user_role into every issued JWT so that policies can
--     resolve the tenant without a profiles lookup on each row.
--     Enable in Dashboard > Authentication > Hooks > Customize Access Token.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims    jsonb;
  p_school  uuid;
  p_role    text;
begin
  select school_id, role::text into p_school, p_role
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if p_school is not null then
    claims := jsonb_set(claims, '{school_id}', to_jsonb(p_school::text));
  else
    claims := claims - 'school_id';
  end if;

  if p_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(p_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

drop policy if exists profiles_read_auth_admin on public.profiles;
create policy profiles_read_auth_admin
  on public.profiles for select
  to supabase_auth_admin
  using (true);

-- =============================================================================
-- 8. DASHBOARD REPORTING RPC
--     SECURITY INVOKER on purpose: the aggregates below are computed through
--     the caller's own RLS view of the data, so a school admin can only ever
--     aggregate their own tenant.
-- =============================================================================

create or replace function public.school_dashboard_metrics(
  target_school uuid,
  target_date   date default current_date
)
returns table (
  revenue_collected    numeric,
  outstanding_balance  numeric,
  students_total       bigint,
  attendance_present   bigint,
  attendance_marked    bigint,
  attendance_percent   numeric,
  leads_new            bigint,
  leads_total          bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce((select sum(p.amount_paid) from public.fee_payments p
               where p.school_id = target_school and p.status = 'SUCCESS'), 0),
    coalesce((select sum(greatest(s.current_balance, 0)) from public.students s
               where s.school_id = target_school and s.is_active), 0),
    (select count(*) from public.students s
      where s.school_id = target_school and s.is_active),
    (select count(*) from public.attendance a
      where a.school_id = target_school and a.date = target_date
        and a.status in ('PRESENT', 'LATE')),
    (select count(*) from public.attendance a
      where a.school_id = target_school and a.date = target_date),
    case
      when (select count(*) from public.attendance a
             where a.school_id = target_school and a.date = target_date) = 0 then 0
      else round(
        (select count(*) from public.attendance a
          where a.school_id = target_school and a.date = target_date
            and a.status in ('PRESENT', 'LATE'))::numeric
        * 100
        / (select count(*) from public.attendance a
            where a.school_id = target_school and a.date = target_date)::numeric, 1)
    end,
    (select count(*) from public.admission_leads l
      where l.school_id = target_school and l.status = 'NEW'),
    (select count(*) from public.admission_leads l
      where l.school_id = target_school);
$$;

grant execute on function public.school_dashboard_metrics(uuid, date) to authenticated;

-- =============================================================================
-- 9. STORAGE BUCKETS
--     school-assets : public (logos, hero imagery served on the portal)
--     fee-receipts  : private, laid out as <school_id>/<payment_id>.pdf so the
--                     first path segment is the tenant key every policy checks.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('school-assets', 'school-assets', true,  5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('fee-receipts',  'fee-receipts',  false, 5242880,
    array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists assets_read_public on storage.objects;
create policy assets_read_public
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'school-assets');

drop policy if exists assets_write_admin on storage.objects;
create policy assets_write_admin
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'school-assets'
    and public.is_school_admin(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists assets_update_admin on storage.objects;
create policy assets_update_admin
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'school-assets'
    and public.is_school_admin(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists assets_delete_admin on storage.objects;
create policy assets_delete_admin
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'school-assets'
    and public.is_school_admin(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists receipts_read_tenant on storage.objects;
create policy receipts_read_tenant
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fee-receipts'
    and public.is_member_of(public.safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists receipts_write_admin on storage.objects;
create policy receipts_write_admin
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fee-receipts'
    and public.is_school_admin(public.safe_uuid((storage.foldername(name))[1]))
  );
