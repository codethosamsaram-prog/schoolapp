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
