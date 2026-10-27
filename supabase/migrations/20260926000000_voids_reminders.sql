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
