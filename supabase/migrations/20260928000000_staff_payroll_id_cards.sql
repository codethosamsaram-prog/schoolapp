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
