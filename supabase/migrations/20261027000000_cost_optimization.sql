
-- =============================================================================
-- Cost optimisation: in-app notifications instead of routine WhatsApp
-- messages, and direct UPI payments (zero MDR) reconciled by UTR.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notifications
--    One row per recipient login. The portal reads them through RLS and
--    receives new ones over Supabase Realtime (postgres_changes, which applies
--    the same select policy per subscriber). Rows are written by the server
--    (service role) and by the triggers below, never by the browser.
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 150),
  body       text not null check (length(body) <= 1000),
  type       text not null check (type in ('FEE', 'LEAVE', 'ATTENDANCE', 'ANNOUNCEMENT')),
  -- An in-app path to open, e.g. /<slug>/portal/fees.
  link       text check (link is null or (link like '/%' and length(link) <= 300)),
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread on public.notifications (user_id) where not is_read;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Recipients may only mark their own rows read: the column grant below limits
-- the update to is_read, and the policy to their own rows.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- Realtime delivery. Wrapped because the publication is absent on a plain
-- Postgres and the table may already be a member.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- The student's own login and their parent's, whichever exist.
create or replace function public.family_user_ids(target_student uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.u
    from public.students s
   cross join lateral unnest(array[s.user_id, s.parent_user_id]) as t(u)
   where s.id = target_student and s.is_active and t.u is not null;
$$;

revoke execute on function public.family_user_ids(uuid) from public, anon, authenticated;
grant execute on function public.family_user_ids(uuid) to service_role;

-- Leave decisions reach the applicant: the family for student leave, the
-- staff member for their own.
create or replace function public.notify_leave_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  school_slug text;
  verdict     text := lower(new.status);
  dates       text := case when new.start_date = new.end_date
                           then to_char(new.start_date, 'DD Mon YYYY')
                           else to_char(new.start_date, 'DD Mon') || ' to ' || to_char(new.end_date, 'DD Mon YYYY')
                      end;
begin
  if new.status = old.status or new.status not in ('APPROVED', 'REJECTED') then
    return null;
  end if;
  select slug into school_slug from public.schools where id = new.school_id;

  if new.applicant_kind = 'STUDENT' then
    insert into public.notifications (school_id, user_id, title, body, type, link)
    select new.school_id, u,
           'Leave ' || verdict,
           s.full_name || '''s ' || lower(new.leave_type) || ' leave for ' || dates || ' was ' || verdict
             || coalesce('. Note: ' || new.review_note, '') || '.',
           'LEAVE',
           '/' || school_slug || '/portal/leave'
      from public.students s, public.family_user_ids(s.id) u
     where s.id = new.student_id;
  else
    insert into public.notifications (school_id, user_id, title, body, type, link)
    values (new.school_id, new.staff_user_id,
            'Leave ' || verdict,
            'Your ' || lower(new.leave_type) || ' leave for ' || dates || ' was ' || verdict
              || coalesce('. Note: ' || new.review_note, '') || '.',
            'LEAVE',
            '/' || school_slug || '/teacher/leave');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_leave_requests_notify on public.leave_requests;
create trigger trg_leave_requests_notify
  after update of status on public.leave_requests
  for each row execute function public.notify_leave_decision();

-- Announcements reach every family the announcement targets.
create or replace function public.notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  school_slug text;
begin
  select slug into school_slug from public.schools where id = new.school_id;

  insert into public.notifications (school_id, user_id, title, body, type, link)
  select distinct on (u)
         new.school_id, u, new.title, left(new.content, 280), 'ANNOUNCEMENT', '/' || school_slug || '/portal'
    from public.students s
   cross join lateral unnest(array[s.user_id, s.parent_user_id]) as t(u)
   where s.school_id = new.school_id
     and s.is_active
     and u is not null
     and (new.target_grade is null or s.class_grade = new.target_grade)
     and (new.target_section is null or s.section = new.target_section);
  return null;
end;
$$;

drop trigger if exists trg_announcements_notify on public.announcements;
create trigger trg_announcements_notify
  after insert on public.announcements
  for each row execute function public.notify_announcement();

-- -----------------------------------------------------------------------------
-- 2. Direct UPI payments
--    Families pay the school's own UPI ID from any UPI app (no gateway, no
--    MDR), then report the 12-digit UTR. An admin checks it against the bank
--    statement and approves it, which issues the receipt.
-- -----------------------------------------------------------------------------
alter table public.schools
  add column if not exists upi_vpa text
    check (upi_vpa is null or upi_vpa ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$');

comment on column public.schools.upi_vpa is
  'The school''s UPI ID (VPA) for direct, zero-MDR fee payments. Printed on invoices and the portal.';

create table if not exists public.upi_payment_claims (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0 and amount <= 1000000),
  utr          text not null check (utr ~ '^[0-9]{12}$'),
  -- The invoice reference the QR carried in its transaction note.
  invoice_ref  text check (invoice_ref is null or length(invoice_ref) <= 40),
  status       text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  submitted_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text check (review_note is null or length(review_note) <= 300),
  payment_id   uuid references public.fee_payments (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A UTR identifies one bank transfer, so it can settle at most one claim. A
-- rejected claim frees its UTR, so a mistyped amount can be reported again.
create unique index if not exists upi_payment_claims_utr_unique
  on public.upi_payment_claims (school_id, utr) where status <> 'REJECTED';
create index if not exists upi_payment_claims_queue on public.upi_payment_claims (school_id, status, created_at);
create index if not exists upi_payment_claims_student on public.upi_payment_claims (student_id);

drop trigger if exists trg_upi_payment_claims_updated_at on public.upi_payment_claims;
create trigger trg_upi_payment_claims_updated_at
  before update on public.upi_payment_claims
  for each row execute function public.set_updated_at();

-- A new claim is PENDING, for a student of the same school, and unreviewed.
create or replace function public.guard_upi_claim_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'PENDING' or new.reviewed_by is not null or new.reviewed_at is not null
     or new.payment_id is not null then
    raise exception 'a UPI claim starts as pending' using errcode = '42501';
  end if;
  if not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
    raise exception 'student does not belong to this school' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_upi_payment_claims_insert on public.upi_payment_claims;
create trigger trg_upi_payment_claims_insert
  before insert on public.upi_payment_claims
  for each row execute function public.guard_upi_claim_insert();

alter table public.upi_payment_claims enable row level security;

drop policy if exists upi_payment_claims_select on public.upi_payment_claims;
create policy upi_payment_claims_select on public.upi_payment_claims for select to authenticated
  using (public.is_school_admin(school_id) or public.owns_student(student_id));

drop policy if exists upi_payment_claims_insert on public.upi_payment_claims;
create policy upi_payment_claims_insert on public.upi_payment_claims for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.owns_student(student_id)
    and public.is_member_of(school_id)
  );

-- Decisions go through review_upi_claim(); nobody updates rows directly.
revoke all on public.upi_payment_claims from anon, authenticated;
grant select, insert on public.upi_payment_claims to authenticated;
grant all on public.upi_payment_claims to service_role;

-- Approves or rejects a pending claim in one transaction. Approval records a
-- SUCCESS payment with the next receipt number (trg_fee_payments_balance then
-- moves the balance) and links it to the claim. Returns the payment id on
-- approval, null on rejection.
create or replace function public.review_upi_claim(target_claim uuid, approve boolean, note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim   public.upi_payment_claims%rowtype;
  balance numeric(12, 2);
  receipt text;
  payment uuid;
begin
  select * into claim from public.upi_payment_claims where id = target_claim for update;
  if not found or not public.is_school_admin(claim.school_id) then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if claim.status <> 'PENDING' then
    raise exception 'this claim has already been %', lower(claim.status) using errcode = '22023';
  end if;
  if note is not null and length(note) > 300 then
    raise exception 'the note is too long' using errcode = '22023';
  end if;

  if not approve then
    update public.upi_payment_claims
       set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(note), '')
     where id = claim.id;
    return null;
  end if;

  select current_balance into balance from public.students where id = claim.student_id for update;
  if claim.amount > balance then
    raise exception 'the claim is more than the % outstanding', balance using errcode = '22023';
  end if;

  receipt := public.next_receipt_number(claim.school_id);
  insert into public.fee_payments (
    school_id, student_id, amount_paid, payment_method, status, receipt_number, notes, paid_at
  ) values (
    claim.school_id, claim.student_id, claim.amount, 'UPI (UTR ' || claim.utr || ')', 'SUCCESS', receipt,
    coalesce('Fee payment · ' || claim.invoice_ref, 'Fee payment'), claim.created_at
  )
  returning id into payment;

  update public.upi_payment_claims
     set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(btrim(note), ''), payment_id = payment
   where id = claim.id;
  return payment;
end;
$$;

revoke execute on function public.review_upi_claim(uuid, boolean, text) from public, anon;
grant execute on function public.review_upi_claim(uuid, boolean, text) to authenticated, service_role;
