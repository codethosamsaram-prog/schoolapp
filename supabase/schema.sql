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

-- =============================================================================
-- Fee concessions, and admission leads that become students.
-- =============================================================================

-- A standing reduction on one student's annual dues (scholarship, sibling or
-- staff-ward discount). total_fee_due = class fee heads - concession, floored
-- at zero, so re-syncing a class after a schedule change keeps it.
alter table public.students
  add column if not exists fee_concession numeric(12, 2) not null default 0
    check (fee_concession >= 0),
  add column if not exists fee_concession_note text;

-- The student an admitted enquiry was enrolled as. Set once, so a lead cannot
-- be enrolled twice.
alter table public.admission_leads
  add column if not exists student_id uuid references public.students (id) on delete set null;

create unique index if not exists admission_leads_student_unique
  on public.admission_leads (student_id)
  where student_id is not null;

-- Re-derives total_fee_due for every active student in one class from the
-- current academic year's fee heads. SECURITY INVOKER: it runs through the
-- caller's RLS, so only that tenant's admin can move anyone's dues.
-- trg_students_fee_change then recalculates each balance.
create or replace function public.sync_class_dues(target_school uuid, target_grade text)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with heads as (
    select coalesce(sum(f.amount), 0) as total
      from public.fee_structures f
     where f.school_id = target_school
       and f.class_grade = target_grade
       and f.academic_year = public.current_academic_year()
  ), updated as (
    update public.students s
       set total_fee_due = greatest((select total from heads) - s.fee_concession, 0)
     where s.school_id = target_school
       and s.class_grade = target_grade
       and s.is_active
    returning 1
  )
  select count(*)::integer from updated;
$$;

grant execute on function public.sync_class_dues(uuid, text) to authenticated;

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

-- =============================================================================
-- Voided office receipts and fee-due reminders.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Voids
--    A receipt issued at the office in error is voided, never deleted: the row
--    and its receipt number stay in the ledger, and the balance trigger stops
--    counting it because only SUCCESS rows count.
-- -----------------------------------------------------------------------------
alter type public.payment_status add value if not exists 'VOIDED';

alter table public.fee_payments
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users (id) on delete set null,
  add column if not exists void_reason text;

-- Compared as text: a new enum value cannot be referenced as a literal inside
-- the transaction that adds it.
create or replace function public.guard_payment_void()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status::text = 'VOIDED' then
    if new.status::text <> 'VOIDED'
       or new.amount_paid <> old.amount_paid
       or new.student_id <> old.student_id then
      raise exception 'a voided payment cannot be changed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status::text = 'VOIDED' then
    if old.status::text <> 'SUCCESS' then
      raise exception 'only a settled payment can be voided' using errcode = '22023';
    end if;
    if old.razorpay_payment_id is not null then
      raise exception 'online payments are refunded through the gateway, not voided'
        using errcode = '22023';
    end if;
    if new.void_reason is null or length(btrim(new.void_reason)) < 3 then
      raise exception 'a void needs a reason' using errcode = '22023';
    end if;
    if new.amount_paid <> old.amount_paid or new.student_id <> old.student_id then
      raise exception 'a void cannot change the amount or student' using errcode = '22023';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fee_payments_void on public.fee_payments;
create trigger trg_fee_payments_void
  before update on public.fee_payments
  for each row execute function public.guard_payment_void();

-- -----------------------------------------------------------------------------
-- 2. Fee-due reminders
--    Stamped after each delivered reminder so a second click the same week
--    does not message the family again.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists last_fee_reminder_at timestamptz;

-- =============================================================================
-- Online refunds through Razorpay.
--
-- One payment can be refunded in several parts, and each part has its own
-- Razorpay refund id, so refunds live in their own table. fee_payments keeps a
-- running amount_refunded, and its settled status (SUCCESS,
-- PARTIALLY_REFUNDED, REFUNDED) is derived from that amount by trigger rather
-- than written by the application.
-- =============================================================================

alter type public.payment_status add value if not exists 'PARTIALLY_REFUNDED';
alter type public.payment_status add value if not exists 'REFUNDED';

alter table public.fee_payments
  add column if not exists amount_refunded numeric(12, 2) not null default 0
    check (amount_refunded >= 0);

alter table public.fee_payments drop constraint if exists fee_payments_refund_within_paid;
alter table public.fee_payments
  add constraint fee_payments_refund_within_paid check (amount_refunded <= amount_paid);

comment on column public.fee_payments.amount_refunded is
  'Sum of this payment''s refunds that have not failed. Maintained by trigger from fee_refunds.';

-- -----------------------------------------------------------------------------
-- 1. fee_refunds
-- -----------------------------------------------------------------------------
create table if not exists public.fee_refunds (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools (id) on delete cascade,
  payment_id         uuid not null references public.fee_payments (id) on delete cascade,
  razorpay_refund_id text not null,
  amount             numeric(12, 2) not null check (amount > 0),
  reason             text not null check (length(btrim(reason)) between 3 and 200),
  -- Razorpay's own refund states.
  status             text not null default 'pending'
                       check (status in ('pending', 'processed', 'failed')),
  initiated_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- The unique id is what makes the webhook's reconciliation idempotent.
  constraint fee_refunds_razorpay_unique unique (razorpay_refund_id)
);

create index if not exists fee_refunds_payment on public.fee_refunds (payment_id);

drop trigger if exists trg_fee_refunds_updated_at on public.fee_refunds;
create trigger trg_fee_refunds_updated_at
  before update on public.fee_refunds
  for each row execute function public.set_updated_at();

-- A refund belongs to the tenant of its payment, and only to an online one.
create or replace function public.assert_refund_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.fee_payments p
     where p.id = new.payment_id
       and p.school_id = new.school_id
       and p.razorpay_payment_id is not null
  ) then
    raise exception 'refund % does not match an online payment of this school', new.razorpay_refund_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fee_refunds_payment on public.fee_refunds;
create trigger trg_fee_refunds_payment
  before insert or update of payment_id, school_id on public.fee_refunds
  for each row execute function public.assert_refund_payment();

-- Keeps fee_payments.amount_refunded equal to the refunds that have not failed.
create or replace function public.sync_payment_refunds()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.payment_id, old.payment_id);
begin
  update public.fee_payments p
     set amount_refunded = coalesce((
           select sum(r.amount) from public.fee_refunds r
            where r.payment_id = target and r.status <> 'failed'
         ), 0)
   where p.id = target;
  return null;
end;
$$;

drop trigger if exists trg_fee_refunds_sync on public.fee_refunds;
create trigger trg_fee_refunds_sync
  after insert or delete or update of amount, status, payment_id on public.fee_refunds
  for each row execute function public.sync_payment_refunds();

-- -----------------------------------------------------------------------------
-- 2. Settled status follows amount_refunded
--    Also protects refunds from a replayed payment.captured: the webhook may
--    write SUCCESS again, and this turns it back into what the refunds say.
-- -----------------------------------------------------------------------------
create or replace function public.derive_refund_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status::text in ('SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    new.status := case
      when new.amount_refunded = 0 then 'SUCCESS'
      when new.amount_refunded >= new.amount_paid then 'REFUNDED'
      else 'PARTIALLY_REFUNDED'
    end::public.payment_status;
  elsif old.amount_refunded > 0 then
    raise exception 'a refunded payment cannot move to %', new.status using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fee_payments_refund_status on public.fee_payments;
create trigger trg_fee_payments_refund_status
  before update on public.fee_payments
  for each row execute function public.derive_refund_status();

-- -----------------------------------------------------------------------------
-- 3. Balances and revenue count money kept, not money received
-- -----------------------------------------------------------------------------
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
  select coalesce(sum(amount_paid - amount_refunded), 0)
    into paid
    from public.fee_payments
   where student_id = target_student
     and status::text in ('SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED');

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

drop trigger if exists trg_fee_payments_balance on public.fee_payments;
create trigger trg_fee_payments_balance
  after insert or delete or update of amount_paid, amount_refunded, status, student_id
  on public.fee_payments
  for each row execute function public.sync_student_balance();

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
    coalesce((select sum(p.amount_paid - p.amount_refunded) from public.fee_payments p
               where p.school_id = target_school
                 and p.status::text in ('SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')), 0),
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

-- -----------------------------------------------------------------------------
-- 4. RLS
--    Admins issue refunds; a family can see the refunds on its own payments.
--    The webhook reconciles on the service role. Refund rows are never deleted.
-- -----------------------------------------------------------------------------
alter table public.fee_refunds enable row level security;

drop policy if exists fee_refunds_select on public.fee_refunds;
create policy fee_refunds_select
  on public.fee_refunds for select
  to authenticated
  using (
    public.is_school_admin(school_id)
    or exists (
      select 1 from public.fee_payments p
       where p.id = payment_id and public.owns_student(p.student_id)
    )
  );

drop policy if exists fee_refunds_insert_admin on public.fee_refunds;
create policy fee_refunds_insert_admin
  on public.fee_refunds for insert
  to authenticated
  with check (public.is_school_admin(school_id));

drop policy if exists fee_refunds_update_admin on public.fee_refunds;
create policy fee_refunds_update_admin
  on public.fee_refunds for update
  to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

grant select, insert, update on public.fee_refunds to authenticated;
grant all on public.fee_refunds to service_role;

-- =============================================================================
-- Staff directory, monthly payroll, and student ID cards.
--
-- Staff records are HR records, not logins: staff_role describes the job
-- (TEACHER, ACCOUNTANT, SUPERVISOR) and grants no access. Logins and their
-- permissions stay on profiles.role.
--
-- Salary data is visible to school admins only. Payslips are immutable once
-- issued, and their totals are computed here, never taken from the client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. staff
-- -----------------------------------------------------------------------------
create table if not exists public.staff (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  employee_code   text not null check (employee_code ~ '^[A-Za-z0-9-]{2,20}$'),
  full_name       text not null check (length(btrim(full_name)) between 2 and 120),
  staff_role      text not null check (staff_role in ('TEACHER', 'ACCOUNTANT', 'SUPERVISOR')),
  departments     text[] not null default '{}'
                    check (cardinality(departments) <= 8),
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text,
  date_of_joining date,
  base_salary     numeric(12, 2) not null check (base_salary >= 0),
  bank_name       text check (bank_name is null or length(bank_name) <= 80),
  -- Only the last four digits: enough to identify the account on a payslip.
  bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint staff_code_unique unique (school_id, employee_code)
);

create index if not exists staff_school_active on public.staff (school_id, is_active);

drop trigger if exists trg_staff_updated_at on public.staff;
create trigger trg_staff_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. payslips
-- -----------------------------------------------------------------------------
create table if not exists public.payslips (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools (id) on delete cascade,
  staff_id          uuid not null references public.staff (id) on delete restrict,
  -- First day of the month the salary is for.
  period            date not null check (extract(day from period) = 1),
  slip_number       text not null,
  base_pay          numeric(12, 2) not null check (base_pay >= 0),
  -- [{ "label": "Overtime", "amount": 1500 }, ...]
  additions         jsonb not null default '[]'::jsonb,
  deductions        jsonb not null default '[]'::jsonb,
  total_additions   numeric(12, 2) not null default 0,
  total_deductions  numeric(12, 2) not null default 0,
  gross_pay         numeric(12, 2) not null default 0,
  net_pay           numeric(12, 2) not null default 0,
  payment_method    text not null check (payment_method in ('DIRECT_TRANSFER', 'CHEQUE', 'CASH')),
  payment_reference text check (payment_reference is null or length(payment_reference) <= 60),
  paid_at           timestamptz not null default now(),
  processed_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  -- One salary per person per month; this is what makes re-processing safe.
  constraint payslips_one_per_month unique (staff_id, period),
  constraint payslips_number_unique unique (school_id, slip_number),
  constraint payslips_reference_required
    check (payment_method = 'CASH' or payment_reference is not null)
);

create index if not exists payslips_school_period on public.payslips (school_id, period);

-- Validates the line items and derives every total from them.
create or replace function public.compute_payslip_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(new.additions) <> 'array' or jsonb_typeof(new.deductions) <> 'array' then
    raise exception 'additions and deductions must be arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(new.additions) > 20 or jsonb_array_length(new.deductions) > 20 then
    raise exception 'at most 20 additions and 20 deductions' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(new.additions || new.deductions) loop
    if jsonb_typeof(item -> 'label') <> 'string'
       or length(btrim(item ->> 'label')) not between 1 and 60
       or jsonb_typeof(item -> 'amount') <> 'number'
       or (item ->> 'amount')::numeric <= 0 then
      raise exception 'each line needs a label and a positive amount' using errcode = '22023';
    end if;
  end loop;

  new.total_additions := coalesce(
    (select sum((value ->> 'amount')::numeric) from jsonb_array_elements(new.additions)), 0);
  new.total_deductions := coalesce(
    (select sum((value ->> 'amount')::numeric) from jsonb_array_elements(new.deductions)), 0);
  new.gross_pay := new.base_pay + new.total_additions;
  new.net_pay := new.gross_pay - new.total_deductions;

  if new.net_pay < 0 then
    raise exception 'deductions exceed gross pay' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payslips_totals on public.payslips;
create trigger trg_payslips_totals
  before insert on public.payslips
  for each row execute function public.compute_payslip_totals();

-- A payslip belongs to the tenant of its staff member.
create or replace function public.assert_staff_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.staff s where s.id = new.staff_id and s.school_id = new.school_id
  ) then
    raise exception 'staff % does not belong to this school', new.staff_id using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payslips_tenant on public.payslips;
create trigger trg_payslips_tenant
  before insert on public.payslips
  for each row execute function public.assert_staff_tenant();

-- -----------------------------------------------------------------------------
-- 3. RLS: salaries are for school admins only
-- -----------------------------------------------------------------------------
alter table public.staff enable row level security;
alter table public.payslips enable row level security;

drop policy if exists staff_select_admin on public.staff;
create policy staff_select_admin on public.staff for select to authenticated
  using (public.is_school_admin(school_id));

drop policy if exists staff_insert_admin on public.staff;
create policy staff_insert_admin on public.staff for insert to authenticated
  with check (public.is_school_admin(school_id));

drop policy if exists staff_update_admin on public.staff;
create policy staff_update_admin on public.staff for update to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists payslips_select_admin on public.payslips;
create policy payslips_select_admin on public.payslips for select to authenticated
  using (public.is_school_admin(school_id));

drop policy if exists payslips_insert_admin on public.payslips;
create policy payslips_insert_admin on public.payslips for insert to authenticated
  with check (public.is_school_admin(school_id));

-- No update or delete policy: an issued payslip is a financial record.
grant select, insert, update on public.staff to authenticated;
grant select, insert on public.payslips to authenticated;
grant all on public.staff, public.payslips to service_role;

-- -----------------------------------------------------------------------------
-- 4. Student ID cards need a blood group
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists blood_group text
    check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

-- =============================================================================
-- Transport (routes, stops, student allocations with monthly billing) and
-- leave applications (students and staff), with approved student leave
-- recorded in attendance as EXCUSED_ABSENT.
-- =============================================================================

alter type public.attendance_status add value if not exists 'EXCUSED_ABSENT';

-- -----------------------------------------------------------------------------
-- 1. Transport
-- -----------------------------------------------------------------------------
create table if not exists public.transport_routes (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 2 and 60),
  vehicle_registration text not null check (vehicle_registration ~ '^[A-Z0-9 -]{4,15}$'),
  driver_name          text not null check (length(btrim(driver_name)) between 2 and 80),
  driver_phone         text not null check (driver_phone ~ '^[6-9][0-9]{9}$'),
  -- What parents see today. Set by the transport desk; there is no GPS feed.
  status               text not null default 'ON_SCHEDULE'
                         check (status in ('ON_SCHEDULE', 'DELAYED', 'NOT_RUNNING')),
  status_note          text check (status_note is null or length(status_note) <= 140),
  status_updated_at    timestamptz not null default now(),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint transport_routes_name_unique unique (school_id, name)
);

create table if not exists public.transport_stops (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  route_id    uuid not null references public.transport_routes (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 80),
  pickup_time time not null,
  drop_time   time not null,
  monthly_fee numeric(10, 2) not null check (monthly_fee >= 0),
  sequence    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint transport_stops_name_unique unique (route_id, name)
);

-- Allocation history. The open row (end_month is null) is the student's
-- current stop. Months are first-of-month dates: a row covers start_month up
-- to, but not including, end_month.
create table if not exists public.transport_allocations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  stop_id     uuid not null references public.transport_stops (id) on delete restrict,
  -- The stop's fee when allocated; later fee changes do not rewrite it.
  monthly_fee numeric(10, 2) not null check (monthly_fee >= 0),
  start_month date not null check (extract(day from start_month) = 1),
  end_month   date check (end_month is null or extract(day from end_month) = 1),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint transport_allocations_range check (end_month is null or end_month >= start_month)
);

create unique index if not exists transport_allocations_one_open
  on public.transport_allocations (student_id) where end_month is null;
create index if not exists transport_allocations_stop on public.transport_allocations (stop_id);
create index if not exists transport_stops_route on public.transport_stops (route_id, sequence);

do $$
declare t text;
begin
  foreach t in array array['transport_routes', 'transport_stops', 'transport_allocations'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- Stops belong to their route's school; allocations to the student's and stop's.
create or replace function public.assert_transport_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'transport_stops' then
    if not exists (select 1 from public.transport_routes r where r.id = new.route_id and r.school_id = new.school_id) then
      raise exception 'route does not belong to this school' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.transport_stops s where s.id = new.stop_id and s.school_id = new.school_id)
       or not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
      raise exception 'stop or student does not belong to this school' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transport_stops_tenant on public.transport_stops;
create trigger trg_transport_stops_tenant
  before insert or update of route_id, school_id on public.transport_stops
  for each row execute function public.assert_transport_tenant();

drop trigger if exists trg_transport_allocations_tenant on public.transport_allocations;
create trigger trg_transport_allocations_tenant
  before insert or update of stop_id, student_id, school_id on public.transport_allocations
  for each row execute function public.assert_transport_tenant();

-- Transport fees are student-specific fee heads, one per billed month of the
-- current academic year (April to March), in the Bus category. They are
-- rebuilt from the allocation history on every change, so re-running is
-- harmless and a change of stop can never double-charge a month.
alter table public.fee_structures
  add column if not exists transport_month date;

comment on column public.fee_structures.transport_month is
  'Set on the monthly transport charges that sync_transport_fees() maintains; never edit these by hand.';

create or replace function public.sync_transport_fees(target_student uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        record;
  ay       text := public.current_academic_year();
  ay_start date := make_date(split_part(public.current_academic_year(), '-', 1)::int, 4, 1);
  bus_type uuid;
  created  integer;
begin
  select id, school_id, class_grade into s from public.students where id = target_student;
  if not found then
    return 0;
  end if;

  select id into bus_type
    from public.fee_types
   where school_id = s.school_id and name = 'Bus' and is_system;

  delete from public.fee_structures
   where student_id = s.id and transport_month is not null and academic_year = ay;

  insert into public.fee_structures (
    school_id, title, description, amount, due_date, class_grade, academic_year,
    fee_type_id, student_id, transport_month
  )
  select s.school_id,
         'Transport · ' || to_char(m.month, 'Mon YYYY'),
         r.name || ', ' || st.name,
         a.monthly_fee,
         (m.month + 9)::date,
         s.class_grade,
         ay,
         bus_type,
         s.id,
         m.month
    from (select generate_series(ay_start, ay_start + interval '11 months', interval '1 month')::date as month) m
    join lateral (
      select * from public.transport_allocations a
       where a.student_id = s.id
         and a.start_month <= m.month
         and (a.end_month is null or a.end_month > m.month)
       order by a.start_month desc, a.created_at desc
       limit 1
    ) a on true
    join public.transport_stops st on st.id = a.stop_id
    join public.transport_routes r on r.id = st.route_id
   where a.monthly_fee > 0;

  get diagnostics created = row_count;
  perform public.sync_class_dues(s.school_id, s.class_grade);
  return created;
end;
$$;

grant execute on function public.sync_transport_fees(uuid) to authenticated, service_role;

create or replace function public.on_transport_allocation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_transport_fees(coalesce(new.student_id, old.student_id));
  return null;
end;
$$;

drop trigger if exists trg_transport_allocations_fees on public.transport_allocations;
create trigger trg_transport_allocations_fees
  after insert or update or delete on public.transport_allocations
  for each row execute function public.on_transport_allocation_change();

-- RLS. Staff see everything; a family sees only the route and stop its child
-- currently rides, which is where the driver's number comes from.
alter table public.transport_routes enable row level security;
alter table public.transport_stops enable row level security;
alter table public.transport_allocations enable row level security;

drop policy if exists transport_routes_select on public.transport_routes;
create policy transport_routes_select on public.transport_routes for select to authenticated
  using (
    public.is_school_staff(school_id)
    or exists (
      select 1
        from public.transport_stops st
        join public.transport_allocations a on a.stop_id = st.id and a.end_month is null
       where st.route_id = transport_routes.id and public.owns_student(a.student_id)
    )
  );

drop policy if exists transport_stops_select on public.transport_stops;
create policy transport_stops_select on public.transport_stops for select to authenticated
  using (
    public.is_school_staff(school_id)
    or exists (
      select 1 from public.transport_allocations a
       where a.stop_id = transport_stops.id and a.end_month is null and public.owns_student(a.student_id)
    )
  );

drop policy if exists transport_allocations_select on public.transport_allocations;
create policy transport_allocations_select on public.transport_allocations for select to authenticated
  using (public.is_school_staff(school_id) or public.owns_student(student_id));

do $$
declare t text;
begin
  foreach t in array array['transport_routes', 'transport_stops', 'transport_allocations'] loop
    execute format('drop policy if exists %1$s_insert_admin on public.%1$s', t);
    execute format(
      'create policy %1$s_insert_admin on public.%1$s for insert to authenticated
         with check (public.is_school_admin(school_id))', t);
    execute format('drop policy if exists %1$s_update_admin on public.%1$s', t);
    execute format(
      'create policy %1$s_update_admin on public.%1$s for update to authenticated
         using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id))', t);
  end loop;
end;
$$;

-- Stops without riders can be removed; allocations and routes are kept.
drop policy if exists transport_stops_delete_admin on public.transport_stops;
create policy transport_stops_delete_admin on public.transport_stops for delete to authenticated
  using (public.is_school_admin(school_id));

grant select, insert, update on public.transport_routes, public.transport_allocations to authenticated;
grant select, insert, update, delete on public.transport_stops to authenticated;
grant all on public.transport_routes, public.transport_stops, public.transport_allocations to service_role;

-- -----------------------------------------------------------------------------
-- 2. Leave applications
-- -----------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  applicant_kind text not null check (applicant_kind in ('STUDENT', 'STAFF')),
  student_id     uuid references public.students (id) on delete cascade,
  -- Staff apply for themselves with their own login.
  staff_user_id  uuid references auth.users (id) on delete cascade,
  requested_by   uuid not null references auth.users (id) on delete cascade default auth.uid(),
  leave_type     text not null check (leave_type in ('SICK', 'CASUAL', 'EMERGENCY')),
  start_date     date not null,
  end_date       date not null,
  reason         text not null check (length(btrim(reason)) between 3 and 500),
  status         text not null default 'PENDING'
                   check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text check (review_note is null or length(review_note) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leave_requests_dates check (end_date >= start_date and end_date - start_date <= 60),
  constraint leave_requests_applicant check (
    (applicant_kind = 'STUDENT' and student_id is not null and staff_user_id is null)
    or (applicant_kind = 'STAFF' and staff_user_id is not null and student_id is null)
  )
);

create index if not exists leave_requests_school_status on public.leave_requests (school_id, status, start_date);
create index if not exists leave_requests_student on public.leave_requests (student_id);

drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at
  before update on public.leave_requests
  for each row execute function public.set_updated_at();

-- New requests start PENDING, for a student of the same school.
create or replace function public.guard_leave_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'PENDING' or new.reviewed_by is not null or new.reviewed_at is not null then
    raise exception 'a leave request starts as pending' using errcode = '42501';
  end if;
  if new.student_id is not null
     and not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
    raise exception 'student does not belong to this school' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leave_requests_insert on public.leave_requests;
create trigger trg_leave_requests_insert
  before insert on public.leave_requests
  for each row execute function public.guard_leave_insert();

-- Who may move a request where:
--   PENDING -> APPROVED / REJECTED  staff for student leave, admins for staff
--                                   leave, and never the applicant themselves
--   PENDING -> CANCELLED            the person who applied
-- A decided request is final, and the application itself never changes.
create or replace function public.guard_leave_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if (new.school_id, new.applicant_kind, new.student_id, new.staff_user_id, new.requested_by,
      new.leave_type, new.start_date, new.end_date, new.reason)
     is distinct from
     (old.school_id, old.applicant_kind, old.student_id, old.staff_user_id, old.requested_by,
      old.leave_type, old.start_date, old.end_date, old.reason) then
    raise exception 'a leave application cannot be edited; cancel it and apply again' using errcode = '42501';
  end if;

  if new.status = old.status then
    return new;
  end if;
  if old.status <> 'PENDING' then
    raise exception 'this leave request has already been %', lower(old.status) using errcode = '22023';
  end if;

  if new.status = 'CANCELLED' then
    if actor is not null and actor <> old.requested_by then
      raise exception 'only the applicant can cancel a leave request' using errcode = '42501';
    end if;
  elsif new.status in ('APPROVED', 'REJECTED') then
    if actor is not null then
      if actor = old.requested_by or actor = old.staff_user_id then
        raise exception 'you cannot review your own leave request' using errcode = '42501';
      end if;
      if old.applicant_kind = 'STAFF' and not public.is_school_admin(old.school_id) then
        raise exception 'staff leave is reviewed by a school admin' using errcode = '42501';
      end if;
      if not public.is_school_staff(old.school_id) then
        raise exception 'only school staff can review leave' using errcode = '42501';
      end if;
    end if;
    new.reviewed_by := actor;
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leave_requests_transition on public.leave_requests;
create trigger trg_leave_requests_transition
  before update on public.leave_requests
  for each row execute function public.guard_leave_transition();

-- Approved student leave becomes attendance: EXCUSED_ABSENT for every school
-- day in the range (Sundays and academic holidays are skipped). It replaces an
-- ABSENT mark, but never a day the student was actually marked present or late.
create or replace function public.apply_leave_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'APPROVED' or old.status = 'APPROVED' or new.applicant_kind <> 'STUDENT' then
    return null;
  end if;

  insert into public.attendance (school_id, student_id, date, status, remarks, marked_by)
  select new.school_id,
         new.student_id,
         d::date,
         'EXCUSED_ABSENT'::public.attendance_status,
         'Approved ' || lower(new.leave_type) || ' leave',
         new.reviewed_by
    from generate_series(new.start_date, new.end_date, interval '1 day') d
   where extract(isodow from d) <> 7
     and not exists (
       select 1 from public.holiday_calendar h
        where h.school_id = new.school_id and h.date = d::date and h.is_academic_holiday
     )
  on conflict (student_id, date) do update
     set status = excluded.status,
         remarks = excluded.remarks,
         marked_by = excluded.marked_by,
         updated_at = now()
   where public.attendance.status::text = 'ABSENT';

  return null;
end;
$$;

drop trigger if exists trg_leave_requests_attendance on public.leave_requests;
create trigger trg_leave_requests_attendance
  after update of status on public.leave_requests
  for each row execute function public.apply_leave_to_attendance();

alter table public.leave_requests enable row level security;

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (
    public.is_school_staff(school_id)
    or requested_by = auth.uid()
    or staff_user_id = auth.uid()
    or (student_id is not null and public.owns_student(student_id))
  );

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.is_member_of(school_id)
    and (
      (applicant_kind = 'STUDENT' and public.owns_student(student_id))
      or (applicant_kind = 'STAFF' and staff_user_id = auth.uid() and public.is_school_staff(school_id))
    )
  );

-- The transition trigger decides what each of these callers may change.
drop policy if exists leave_requests_update on public.leave_requests;
create policy leave_requests_update on public.leave_requests for update to authenticated
  using (public.is_school_staff(school_id) or requested_by = auth.uid())
  with check (public.is_school_staff(school_id) or requested_by = auth.uid());

grant select, insert, update on public.leave_requests to authenticated;
grant all on public.leave_requests to service_role;
