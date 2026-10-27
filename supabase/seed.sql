-- =============================================================================
-- ClassroomOS demo seed. Run after schema.sql:
--   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
-- Creates two tenants so cross-tenant isolation can be verified by hand.
-- =============================================================================

insert into public.schools (
  id, name, slug, logo_url, address, city, state, pincode,
  contact_email, contact_phone, board, established_year, tagline, primary_color
)
values
  ('11111111-1111-4111-8111-111111111111',
   'Delhi Public School, Rohini', 'demo-public-school',
   null, 'Sector 24, Rohini', 'New Delhi', 'Delhi', '110085',
   'office@dpsrohini.example', '+91 11 2755 1234', 'CBSE', 1994,
   'Nurturing curious minds since 1994', '#1d4ed8'),
  ('22222222-2222-4222-8222-222222222222',
   'Sri Chaitanya Junior College', 'sri-chaitanya-jc',
   null, 'Ameerpet Main Road', 'Hyderabad', 'Telangana', '500016',
   'info@scjc.example', '+91 40 2373 9900', 'State Board', 1986,
   'Where results speak', '#be123c')
on conflict (id) do nothing;

insert into public.fee_structures (school_id, title, amount, due_date, class_grade, academic_year)
values
  ('11111111-1111-4111-8111-111111111111', 'Tuition Fee - Term I',  42000, date '2026-06-15', 'IX',  '2026-2027'),
  ('11111111-1111-4111-8111-111111111111', 'Tuition Fee - Term II', 42000, date '2026-11-15', 'IX',  '2026-2027'),
  ('11111111-1111-4111-8111-111111111111', 'Transport Fee',         18000, date '2026-06-15', 'IX',  '2026-2027'),
  ('11111111-1111-4111-8111-111111111111', 'Tuition Fee - Term I',  46000, date '2026-06-15', 'X',   '2026-2027'),
  ('11111111-1111-4111-8111-111111111111', 'Laboratory Fee',         9000, date '2026-07-01', 'X',   '2026-2027'),
  ('22222222-2222-4222-8222-222222222222', 'Tuition Fee - Annual',  95000, date '2026-06-30', 'XI',  '2026-2027')
on conflict on constraint fee_structures_unique do nothing;

insert into public.students (
  school_id, roll_number, admission_number, full_name,
  class_grade, section, parent_name, parent_phone, total_fee_due
)
values
  ('11111111-1111-4111-8111-111111111111', '01', 'DPS/2020/0141', 'Aarav Sharma',   'IX', 'A', 'Rakesh Sharma',  '9810012345', 102000),
  ('11111111-1111-4111-8111-111111111111', '02', 'DPS/2020/0142', 'Diya Nair',      'IX', 'A', 'Suresh Nair',    '9810012346', 102000),
  ('11111111-1111-4111-8111-111111111111', '03', 'DPS/2020/0143', 'Kabir Malhotra', 'IX', 'A', 'Anita Malhotra', '9810012347', 102000),
  ('11111111-1111-4111-8111-111111111111', '04', 'DPS/2020/0144', 'Ishaan Verma',   'IX', 'A', 'Pooja Verma',    '9810012348', 102000),
  ('11111111-1111-4111-8111-111111111111', '05', 'DPS/2020/0145', 'Ananya Iyer',    'IX', 'A', 'Vikram Iyer',    '9810012349', 102000),
  ('11111111-1111-4111-8111-111111111111', '01', 'DPS/2019/0102', 'Rohan Gupta',    'X',  'B', 'Manish Gupta',   '9810012350',  55000),
  ('11111111-1111-4111-8111-111111111111', '02', 'DPS/2019/0103', 'Sara Khan',      'X',  'B', 'Imran Khan',     '9810012351',  55000),
  ('22222222-2222-4222-8222-222222222222', '01', 'SC/2026/7781',  'Lakshmi Reddy',  'XI', 'A', 'Srinivas Reddy', '9848012345',  95000)
on conflict on constraint students_roll_unique do nothing;

insert into public.admission_leads (
  school_id, applicant_name, parent_name, phone, target_grade, status, message
)
values
  ('11111111-1111-4111-8111-111111111111', 'Vivaan Joshi',  'Neha Joshi',   '9899001122', 'VI',  'NEW',
   'Looking for a mid-session transfer from Gurgaon.'),
  ('11111111-1111-4111-8111-111111111111', 'Myra Bansal',   'Amit Bansal',  '9899001123', 'I',   'CONTACTED',
   'Requested a campus visit on a weekend.'),
  ('11111111-1111-4111-8111-111111111111', 'Arjun Pillai',  'Deepa Pillai', '9899001124', 'XI',  'ADMITTED',
   'Science stream, needs transport from Pitampura.'),
  ('22222222-2222-4222-8222-222222222222', 'Harini Rao',    'Suma Rao',     '9848099887', 'XI',  'NEW',
   'MPC stream enquiry.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Portal hub demo content (migration 20260925000000).
-- ---------------------------------------------------------------------------

-- USN is the student login ID. Derived from the admission number here.
update public.students
   set usn = upper(regexp_replace(admission_number, '[^A-Za-z0-9]', '', 'g'))
 where usn is null and admission_number is not null;

insert into public.announcements (school_id, title, content, target_type, target_grade, target_section, created_by)
select v.school_id::uuid, v.title, v.content, v.target_type, v.target_grade, null, null
  from (values
    ('11111111-1111-4111-8111-111111111111', 'Annual Sports Day on 14 November',
     'All students report by 7:30 am in house colours. Parents are welcome from 9 am on the main ground.',
     'ALL', null),
    ('11111111-1111-4111-8111-111111111111', 'Class IX: Science practical file due',
     'Submit your completed practical file to your science teacher by Friday. Late files lose marks.',
     'CLASS', 'IX'),
    ('22222222-2222-4222-8222-222222222222', 'Orientation for MPC batch',
     'Orientation for the new MPC batch is on Monday at 10 am in the auditorium.',
     'ALL', null)
  ) as v (school_id, title, content, target_type, target_grade)
 where not exists (select 1 from public.announcements a where a.title = v.title);

insert into public.holiday_calendar (school_id, title, date, description, is_academic_holiday)
values
  ('11111111-1111-4111-8111-111111111111', 'Gandhi Jayanti', date '2026-10-02', null, true),
  ('11111111-1111-4111-8111-111111111111', 'Dussehra', date '2026-10-20', null, true),
  ('11111111-1111-4111-8111-111111111111', 'Diwali break', date '2026-11-08', 'School reopens 12 November.', true),
  ('11111111-1111-4111-8111-111111111111', 'Parent-Teacher Meeting', date '2026-10-10', 'Half day for students.', false),
  ('22222222-2222-4222-8222-222222222222', 'Bathukamma', date '2026-10-12', null, true)
on conflict on constraint holiday_calendar_unique do nothing;

insert into public.homework (school_id, class_grade, section, subject, title, description, due_date, created_by)
select '11111111-1111-4111-8111-111111111111', 'IX', 'A', v.subject, v.title, v.description, v.due, null
  from (values
    ('Mathematics', 'Exercise 4.2: Linear equations', 'Questions 1 to 12. Show all working.', date '2026-09-28'),
    ('Science', 'Diagram of a plant cell', 'Draw and label on A4 sheet.', date '2026-09-30'),
    ('English', 'Essay: My favourite festival', '250 words.', date '2026-09-22')
  ) as v (subject, title, description, due)
 where not exists (select 1 from public.homework h where h.title = v.title);

insert into public.video_references (school_id, class_grade, section, subject, youtube_url, title, description, created_by)
select '11111111-1111-4111-8111-111111111111', 'IX', null, 'Mathematics',
       'https://www.youtube.com/watch?v=l3XzepN03KQ', 'Linear equations in two variables',
       'Watch before attempting Exercise 4.2.', null
 where not exists (select 1 from public.video_references where title = 'Linear equations in two variables');

insert into public.exam_results (school_id, student_id, exam_name, subject, marks_obtained, max_marks, grade, entered_by)
select s.school_id, s.id, 'Periodic Test 1', r.subject, r.marks, 80, null, null
  from public.students s
 cross join (values ('Mathematics', 68), ('Science', 72), ('English', 61), ('Social Science', 55), ('Hindi', 24))
       as r (subject, marks)
 where s.full_name = 'Aarav Sharma'
on conflict on constraint exam_results_unique do nothing;
