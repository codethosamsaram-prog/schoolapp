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
