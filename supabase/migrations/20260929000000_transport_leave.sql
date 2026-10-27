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
