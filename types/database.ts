/**
 * Database types for ClassroomOS.
 *
 * Shaped like the Supabase CLI output, and regenerable with:
 *   supabase gen types typescript --project-id <ref> --schema public > types/database.ts
 *
 * Row/Insert shapes are declared as standalone interfaces rather than inline
 * inside `Database`: a self-referential `Update: Partial<Database[...]>` makes
 * the client's GenericSchema constraint circular, and every query silently
 * degrades to `never`.
 *
 * They are `type` aliases, never `interface`. Supabase constrains tables to
 * `Record<string, unknown>`, and only type aliases get an implicit index
 * signature; an interface here also collapses every query result to `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
export type PaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'VOIDED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';
export type RefundStatus = 'pending' | 'processed' | 'failed';
export type StaffRole = 'TEACHER' | 'ACCOUNTANT' | 'SUPERVISOR';
export type PayrollMethod = 'DIRECT_TRANSFER' | 'CHEQUE' | 'CASH';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
export type PayLine = { label: string; amount: number };
export type BusStatus = 'ON_SCHEDULE' | 'DELAYED' | 'NOT_RUNNING';
export type LeaveType = 'SICK' | 'CASUAL' | 'EMERGENCY';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveApplicant = 'STUDENT' | 'STAFF';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED_ABSENT';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'ADMITTED' | 'REJECTED';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

/* ---------------------------------------------------------------- schools */

export type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  custom_domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  board: string | null;
  established_year: number | null;
  tagline: string | null;
  hero_image_url: string | null;
  primary_color: string | null;
  razorpay_key_id: string | null;
  upi_vpa: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type SchoolInsert = {
  id?: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  custom_domain?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  board?: string | null;
  established_year?: number | null;
  tagline?: string | null;
  hero_image_url?: string | null;
  primary_color?: string | null;
  razorpay_key_id?: string | null;
  upi_vpa?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/* --------------------------------------------------------------- profiles */

export type ProfileRow = {
  id: string;
  school_id: string | null;
  role: UserRole;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileInsert = {
  id: string;
  school_id?: string | null;
  role?: UserRole;
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_active?: boolean;
  must_change_password?: boolean;
  created_at?: string;
  updated_at?: string;
}

/* --------------------------------------------------------------- students */

export type StudentRow = {
  id: string;
  school_id: string;
  user_id: string | null;
  roll_number: string;
  admission_number: string | null;
  full_name: string;
  class_grade: string;
  section: string;
  parent_name: string | null;
  parent_phone: string;
  parent_user_id: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  total_fee_due: number;
  current_balance: number;
  fee_concession: number;
  fee_concession_note: string | null;
  usn: string | null;
  avatar_url: string | null;
  last_fee_reminder_at: string | null;
  blood_group: BloodGroup | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type StudentInsert = {
  id?: string;
  school_id: string;
  user_id?: string | null;
  roll_number: string;
  admission_number?: string | null;
  full_name?: string;
  class_grade: string;
  section?: string;
  parent_name?: string | null;
  parent_phone: string;
  parent_user_id?: string | null;
  date_of_birth?: string | null;
  gender?: Gender | null;
  total_fee_due?: number;
  current_balance?: number;
  fee_concession?: number;
  fee_concession_note?: string | null;
  usn?: string | null;
  avatar_url?: string | null;
  last_fee_reminder_at?: string | null;
  blood_group?: BloodGroup | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/* --------------------------------------------------------- fee_structures */

export type FeeStructureRow = {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  amount: number;
  due_date: string;
  class_grade: string;
  academic_year: string;
  is_recurring: boolean;
  fee_type_id: string | null;
  student_id: string | null;
  transport_month: string | null;
  created_at: string;
  updated_at: string;
}

export type FeeStructureInsert = {
  id?: string;
  school_id: string;
  title: string;
  description?: string | null;
  amount: number;
  due_date: string;
  class_grade: string;
  academic_year?: string;
  is_recurring?: boolean;
  fee_type_id?: string | null;
  student_id?: string | null;
  transport_month?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ----------------------------------------------------------- fee_payments */

export type FeePaymentRow = {
  id: string;
  school_id: string;
  student_id: string;
  fee_structure_id: string | null;
  amount_paid: number;
  payment_method: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  status: PaymentStatus;
  receipt_number: string | null;
  receipt_url: string | null;
  notes: string | null;
  paid_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  amount_refunded: number;
  created_at: string;
  updated_at: string;
}

export type FeePaymentInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  fee_structure_id?: string | null;
  amount_paid: number;
  payment_method?: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  razorpay_signature?: string | null;
  status?: PaymentStatus;
  receipt_number?: string | null;
  receipt_url?: string | null;
  notes?: string | null;
  paid_at?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  amount_refunded?: number;
  created_at?: string;
  updated_at?: string;
}

/* ------------------------------------------------------------------ staff */

export type StaffRow = {
  id: string;
  school_id: string;
  employee_code: string;
  full_name: string;
  staff_role: StaffRole;
  departments: string[];
  email: string | null;
  phone: string | null;
  date_of_joining: string | null;
  base_salary: number;
  bank_name: string | null;
  bank_account_last4: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type StaffInsert = {
  id?: string;
  school_id: string;
  employee_code: string;
  full_name: string;
  staff_role: StaffRole;
  departments?: string[];
  email?: string | null;
  phone?: string | null;
  date_of_joining?: string | null;
  base_salary: number;
  bank_name?: string | null;
  bank_account_last4?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/* --------------------------------------------------------------- payslips */

export type PayslipRow = {
  id: string;
  school_id: string;
  staff_id: string;
  period: string;
  slip_number: string;
  base_pay: number;
  additions: PayLine[];
  deductions: PayLine[];
  total_additions: number;
  total_deductions: number;
  gross_pay: number;
  net_pay: number;
  payment_method: PayrollMethod;
  payment_reference: string | null;
  paid_at: string;
  processed_by: string | null;
  created_at: string;
}

/** Totals are computed by compute_payslip_totals(), so they are not insertable. */
export type PayslipInsert = {
  id?: string;
  school_id: string;
  staff_id: string;
  period: string;
  slip_number: string;
  base_pay: number;
  additions?: PayLine[];
  deductions?: PayLine[];
  payment_method: PayrollMethod;
  payment_reference?: string | null;
  paid_at?: string;
  processed_by?: string | null;
  created_at?: string;
}

/* -------------------------------------------------------------- transport */

export type TransportRouteRow = {
  id: string;
  school_id: string;
  name: string;
  vehicle_registration: string;
  driver_name: string;
  driver_phone: string;
  status: BusStatus;
  status_note: string | null;
  status_updated_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TransportRouteInsert = {
  id?: string;
  school_id: string;
  name: string;
  vehicle_registration: string;
  driver_name: string;
  driver_phone: string;
  status?: BusStatus;
  status_note?: string | null;
  status_updated_at?: string;
  is_active?: boolean;
}

export type TransportStopRow = {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  pickup_time: string;
  drop_time: string;
  monthly_fee: number;
  sequence: number;
  created_at: string;
  updated_at: string;
}

export type TransportStopInsert = {
  id?: string;
  school_id: string;
  route_id: string;
  name: string;
  pickup_time: string;
  drop_time: string;
  monthly_fee: number;
  sequence?: number;
}

export type TransportAllocationRow = {
  id: string;
  school_id: string;
  student_id: string;
  stop_id: string;
  monthly_fee: number;
  start_month: string;
  end_month: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TransportAllocationInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  stop_id: string;
  monthly_fee: number;
  start_month: string;
  end_month?: string | null;
  created_by?: string | null;
}

/* ------------------------------------------------------------------ leave */

export type LeaveRequestRow = {
  id: string;
  school_id: string;
  applicant_kind: LeaveApplicant;
  student_id: string | null;
  staff_user_id: string | null;
  requested_by: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export type LeaveRequestInsert = {
  id?: string;
  school_id: string;
  applicant_kind: LeaveApplicant;
  student_id?: string | null;
  staff_user_id?: string | null;
  requested_by?: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status?: LeaveStatus;
  review_note?: string | null;
}

/* ------------------------------------------------------------ fee_refunds */

export type FeeRefundRow = {
  id: string;
  school_id: string;
  payment_id: string;
  razorpay_refund_id: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  initiated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FeeRefundInsert = {
  id?: string;
  school_id: string;
  payment_id: string;
  razorpay_refund_id: string;
  amount: number;
  reason: string;
  status?: RefundStatus;
  initiated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ------------------------------------------------------------- attendance */

export type AttendanceRow = {
  id: string;
  school_id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AttendanceInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  date?: string;
  status: AttendanceStatus;
  remarks?: string | null;
  marked_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* -------------------------------------------------------- admission_leads */

export type AdmissionLeadRow = {
  id: string;
  school_id: string;
  applicant_name: string;
  parent_name: string;
  phone: string;
  email: string | null;
  target_grade: string;
  message: string | null;
  source: string;
  status: LeadStatus;
  notified_at: string | null;
  student_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AdmissionLeadInsert = {
  id?: string;
  school_id: string;
  applicant_name: string;
  parent_name: string;
  phone: string;
  email?: string | null;
  target_grade: string;
  message?: string | null;
  source?: string;
  status?: LeadStatus;
  notified_at?: string | null;
  student_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ------------------------------------------------------------- portal hub */

export type AnnouncementTarget = 'ALL' | 'CLASS' | 'SECTION';

export type HomeworkAttachment = { name: string; path: string };

export type AnnouncementRow = {
  id: string;
  school_id: string;
  title: string;
  content: string;
  target_type: AnnouncementTarget;
  target_grade: string | null;
  target_section: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AnnouncementInsert = {
  id?: string;
  school_id: string;
  title: string;
  content: string;
  target_type?: AnnouncementTarget;
  target_grade?: string | null;
  target_section?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type HomeworkRow = {
  id: string;
  school_id: string;
  class_grade: string;
  section: string | null;
  subject: string;
  title: string;
  description: string | null;
  due_date: string;
  attachments: HomeworkAttachment[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type HomeworkInsert = {
  id?: string;
  school_id: string;
  class_grade: string;
  section?: string | null;
  subject: string;
  title: string;
  description?: string | null;
  due_date: string;
  attachments?: HomeworkAttachment[];
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type VideoReferenceRow = {
  id: string;
  school_id: string;
  class_grade: string;
  section: string | null;
  subject: string;
  youtube_url: string;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type VideoReferenceInsert = {
  id?: string;
  school_id: string;
  class_grade: string;
  section?: string | null;
  subject: string;
  youtube_url: string;
  title: string;
  description?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type FeeTypeRow = {
  id: string;
  school_id: string;
  name: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export type FeeTypeInsert = {
  id?: string;
  school_id: string;
  name: string;
  is_system?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type HallTicketRow = {
  id: string;
  school_id: string;
  student_id: string;
  exam_name: string;
  term: string;
  ticket_pdf_url: string | null;
  is_published: boolean;
  issued_by: string | null;
  created_at: string;
  updated_at: string;
}

export type HallTicketInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  exam_name: string;
  term: string;
  ticket_pdf_url?: string | null;
  is_published?: boolean;
  issued_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ExamResultRow = {
  id: string;
  school_id: string;
  student_id: string;
  exam_name: string;
  subject: string;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ExamResultInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  exam_name: string;
  subject: string;
  marks_obtained: number;
  max_marks: number;
  grade?: string | null;
  remarks?: string | null;
  entered_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type HolidayRow = {
  id: string;
  school_id: string;
  title: string;
  date: string;
  description: string | null;
  is_academic_holiday: boolean;
  created_at: string;
  updated_at: string;
}

export type HolidayInsert = {
  id?: string;
  school_id: string;
  title: string;
  date: string;
  description?: string | null;
  is_academic_holiday?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type SyllabusCopyRow = {
  id: string;
  school_id: string;
  class_grade: string;
  subject: string;
  pdf_url: string;
  academic_year: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SyllabusCopyInsert = {
  id?: string;
  school_id: string;
  class_grade: string;
  subject: string;
  pdf_url: string;
  academic_year?: string;
  uploaded_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ---------------------------------------------------------- notifications */

export type NotificationType = 'FEE' | 'LEAVE' | 'ATTENDANCE' | 'ANNOUNCEMENT';

export type NotificationRow = {
  id: string;
  school_id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export type NotificationInsert = {
  id?: string;
  school_id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  link?: string | null;
  is_read?: boolean;
  created_at?: string;
}

/* ------------------------------------------------------- UPI payment claims */

export type UpiClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type UpiPaymentClaimRow = {
  id: string;
  school_id: string;
  student_id: string;
  amount: number;
  utr: string;
  invoice_ref: string | null;
  status: UpiClaimStatus;
  submitted_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export type UpiPaymentClaimInsert = {
  id?: string;
  school_id: string;
  student_id: string;
  amount: number;
  utr: string;
  invoice_ref?: string | null;
  status?: UpiClaimStatus;
  submitted_by?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  payment_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ------------------------------------------------------- dashboard metrics */

export type DashboardMetrics = {
  revenue_collected: number;
  outstanding_balance: number;
  students_total: number;
  attendance_present: number;
  attendance_marked: number;
  attendance_percent: number;
  leads_new: number;
  leads_total: number;
}

export type Database = {
  public: {
    Tables: {
      schools: {
        Row: SchoolRow;
        Insert: SchoolInsert;
        Update: Partial<SchoolInsert>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: Partial<ProfileInsert>;
        Relationships: [];
      };
      students: {
        Row: StudentRow;
        Insert: StudentInsert;
        Update: Partial<StudentInsert>;
        Relationships: [];
      };
      fee_structures: {
        Row: FeeStructureRow;
        Insert: FeeStructureInsert;
        Update: Partial<FeeStructureInsert>;
        Relationships: [];
      };
      fee_payments: {
        Row: FeePaymentRow;
        Insert: FeePaymentInsert;
        Update: Partial<FeePaymentInsert>;
        Relationships: [];
      };
      staff: {
        Row: StaffRow;
        Insert: StaffInsert;
        Update: Partial<StaffInsert>;
        Relationships: [];
      };
      payslips: {
        Row: PayslipRow;
        Insert: PayslipInsert;
        Update: Partial<PayslipInsert>;
        Relationships: [];
      };
      transport_routes: {
        Row: TransportRouteRow;
        Insert: TransportRouteInsert;
        Update: Partial<TransportRouteInsert>;
        Relationships: [];
      };
      transport_stops: {
        Row: TransportStopRow;
        Insert: TransportStopInsert;
        Update: Partial<TransportStopInsert>;
        Relationships: [];
      };
      transport_allocations: {
        Row: TransportAllocationRow;
        Insert: TransportAllocationInsert;
        Update: Partial<TransportAllocationInsert>;
        Relationships: [];
      };
      leave_requests: {
        Row: LeaveRequestRow;
        Insert: LeaveRequestInsert;
        Update: Partial<LeaveRequestInsert>;
        Relationships: [];
      };
      fee_refunds: {
        Row: FeeRefundRow;
        Insert: FeeRefundInsert;
        Update: Partial<FeeRefundInsert>;
        Relationships: [];
      };
      attendance: {
        Row: AttendanceRow;
        Insert: AttendanceInsert;
        Update: Partial<AttendanceInsert>;
        Relationships: [];
      };
      admission_leads: {
        Row: AdmissionLeadRow;
        Insert: AdmissionLeadInsert;
        Update: Partial<AdmissionLeadInsert>;
        Relationships: [];
      };
      announcements: {
        Row: AnnouncementRow;
        Insert: AnnouncementInsert;
        Update: Partial<AnnouncementInsert>;
        Relationships: [];
      };
      homework: {
        Row: HomeworkRow;
        Insert: HomeworkInsert;
        Update: Partial<HomeworkInsert>;
        Relationships: [];
      };
      video_references: {
        Row: VideoReferenceRow;
        Insert: VideoReferenceInsert;
        Update: Partial<VideoReferenceInsert>;
        Relationships: [];
      };
      fee_types: {
        Row: FeeTypeRow;
        Insert: FeeTypeInsert;
        Update: Partial<FeeTypeInsert>;
        Relationships: [];
      };
      hall_tickets: {
        Row: HallTicketRow;
        Insert: HallTicketInsert;
        Update: Partial<HallTicketInsert>;
        Relationships: [];
      };
      exam_results: {
        Row: ExamResultRow;
        Insert: ExamResultInsert;
        Update: Partial<ExamResultInsert>;
        Relationships: [];
      };
      holiday_calendar: {
        Row: HolidayRow;
        Insert: HolidayInsert;
        Update: Partial<HolidayInsert>;
        Relationships: [];
      };
      syllabus_copies: {
        Row: SyllabusCopyRow;
        Insert: SyllabusCopyInsert;
        Update: Partial<SyllabusCopyInsert>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: NotificationInsert;
        Update: Partial<NotificationInsert>;
        Relationships: [];
      };
      upi_payment_claims: {
        Row: UpiPaymentClaimRow;
        Insert: UpiPaymentClaimInsert;
        Update: Partial<UpiPaymentClaimInsert>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      current_academic_year: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_school_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole;
      };
      next_receipt_number: {
        Args: { target_school: string };
        Returns: string;
      };
      recalculate_student_balance: {
        Args: { target_student: string };
        Returns: number;
      };
      can_view_class: {
        Args: { target_school: string; target_grade: string | null; target_section: string | null };
        Returns: boolean;
      };
      sync_class_dues: {
        Args: { target_school: string; target_grade: string };
        Returns: number;
      };
      sync_transport_fees: {
        Args: { target_student: string };
        Returns: number;
      };
      school_dashboard_metrics: {
        Args: { target_school: string; target_date?: string };
        Returns: DashboardMetrics[];
      };
      review_upi_claim: {
        Args: { target_claim: string; approve: boolean; note?: string | null };
        Returns: string | null;
      };
      is_member_of: {
        Args: { target_school: string };
        Returns: boolean;
      };
      is_school_staff: {
        Args: { target_school: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      payment_status: PaymentStatus;
      attendance_status: AttendanceStatus;
      lead_status: LeadStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

/* ---------------------------------------------------------------------------
 * Convenience aliases used across the app.
 * ------------------------------------------------------------------------- */

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type InsertDto<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type UpdateDto<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];

export type School = SchoolRow;
export type Profile = ProfileRow;
export type Student = StudentRow;
export type FeeStructure = FeeStructureRow;
export type FeePayment = FeePaymentRow;
export type FeeRefund = FeeRefundRow;
export type Staff = StaffRow;
export type Payslip = PayslipRow;
export type Attendance = AttendanceRow;
export type AdmissionLead = AdmissionLeadRow;
export type Announcement = AnnouncementRow;
export type Homework = HomeworkRow;
export type VideoReference = VideoReferenceRow;
export type FeeType = FeeTypeRow;
export type HallTicket = HallTicketRow;
export type ExamResult = ExamResultRow;
export type Holiday = HolidayRow;
export type SyllabusCopy = SyllabusCopyRow;
export type Notification = NotificationRow;
export type UpiPaymentClaim = UpiPaymentClaimRow;

/** A payment joined with the student it settles, as the receipt route reads it. */
export type FeePaymentWithStudent = FeePayment & {
  students: Pick<
    Student,
    | 'id'
    | 'full_name'
    | 'roll_number'
    | 'class_grade'
    | 'section'
    | 'parent_name'
    | 'parent_phone'
    | 'total_fee_due'
    | 'current_balance'
  > | null;
};

/** Discriminated result returned by every Server Action in this codebase. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
