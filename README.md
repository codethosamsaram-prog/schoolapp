# ClassroomOS

White-label, multi-tenant School & College Management ERP and public portal, built for
institutions in India. One deployment serves many schools: each gets its own branded portal at
`/<school_slug>`, its own admissions pipeline, fee collection over UPI, attendance, and parent
communication on WhatsApp.

Tenant isolation is enforced in PostgreSQL through Row Level Security, not in application code.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 14 App Router, Server Actions, strict TypeScript |
| UI | Tailwind CSS, Shadcn UI primitives, Lucide icons |
| Data & auth | Supabase (PostgreSQL, RLS, Auth, Storage) |
| Payments | Razorpay Node API (UPI, netbanking, cards), webhook reconciliation |
| Messaging | WhatsApp Business Cloud API, with an Interakt adapter |
| Documents | `@react-pdf/renderer` server-streamed receipts |

## Project layout

```
app/
  page.tsx                                   Platform marketing page
  login/                                     Sign-in, routes users by role
  [school_slug]/
    layout.tsx                               Tenant shell + per-school brand colour
    page.tsx                                 A. Public portal: hero, campus, fees, contact
    actions.ts                               Admission enquiry Server Action
    _components/admission-dialog.tsx         Admission modal
    admin/
      layout.tsx                             Admin shell (SCHOOL_ADMIN guard)
      actions.ts                             Leads, fee heads, students, parent logins
      dashboard/page.tsx                     B. KPI dashboard + recent leads/payments
      admissions/page.tsx                    Enquiry pipeline; enrol admitted leads as students
      students/page.tsx                      Roster, enrolment, editing details, concessions,
                                             office payments, parent/student logins, photos,
                                             withdrawal
      fees/page.tsx                          Fee schedule editor, payments ledger with voids,
                                             WhatsApp fee reminders
      students/id-cards/page.tsx             Bulk student ID cards: preview, pick, print
      staff/page.tsx                         Staff directory and monthly payroll
      transport/page.tsx                     Bus routes, stops, riders and bus status
      leave/page.tsx                         Leave approvals for students and staff
      calendar/page.tsx                      Holiday calendar
    teacher/
      layout.tsx                             Staff shell (TEACHER guard; admins may enter)
      actions.ts, content-actions.ts         Attendance, announcements, homework, exams
      attendance/page.tsx                    D. Mobile attendance portal
      announcements/, homework/, exams/      Notices, homework + videos, hall tickets,
                                             results and syllabus copies
    portal/
      layout.tsx                             Parent/student shell (PARENT, STUDENT guard)
      page.tsx                               Overview; siblings switch with the child switcher
      fees/, homework/, exams/, syllabus/,
      calendar/, profile/                    One page per portal section
      _components/pay-button.tsx             Razorpay Checkout for the outstanding balance
  auth/sign-out/route.ts                     POST-only sign out
  hall-tickets/[ticket_id]/route.tsx         Streams a hall ticket PDF
  report-cards/[student_id]/route.tsx        Streams a report card PDF for one exam
  api/payments/refund/route.ts               Refunds an online payment through Razorpay
  api/whatsapp/health/route.ts               WhatsApp credential and template diagnostics
  api/payroll/process/route.ts               Issues a month's payslips
  api/id-cards/route.tsx                     Streams a class section's ID cards as one PDF
  payslips/[payslip_id]/route.tsx            Streams a payslip PDF
e2e/                                         Playwright suite, fixtures and a stand-in gateway
  api/
    webhooks/razorpay/route.ts               C. Signature-verified webhook receiver
    payments/create-order/route.ts           Opens a Razorpay order + PENDING payment row
    payments/verify/route.ts                 Checks the Checkout signature (writes nothing)
  receipts/[payment_id]/route.tsx            Streams the receipt PDF (signed link or session)
components/
  pdf/FeeReceiptPDF.tsx                      E. Print-ready receipt document
  ui/                                        Shadcn primitives
lib/
  supabase/{server,client,admin}.ts          Session, browser, and service-role clients
  auth.ts, auth-routes.ts                    Tenant + role guards
  razorpay.ts, whatsapp.ts, tokens.ts        Integrations
supabase/
  schema.sql                                 Tables, triggers, RLS policies, storage, auth hook
  migrations/                                The same schema as ordered migrations
  seed.sql                                   Two demo tenants
scripts/
  create-user.mjs                            Provisions staff logins with the service role
```

## Setup

```bash
npm install
cp .env.example .env.local        # fill in the values below
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # optional demo data
node --env-file=.env.local scripts/create-user.mjs   --email admin@example.com --password 'choose-a-password'   --role SCHOOL_ADMIN --school demo-public-school --name "Office Admin"
npm run dev
```

Then open `http://localhost:3000/demo-public-school`, and sign in at `/login` with the admin you
just created.

With the Supabase CLI, `supabase start` applies `supabase/migrations/` and `seed.sql` for you.
`schema.sql` is every migration concatenated, safe to re-run, for projects set up with `psql`.

### Logins

Public signups are off (`enable_signup = false` in `supabase/config.toml`; turn off **Allow new
users to sign up** in the dashboard for a hosted project). Every login is provisioned:

- **Staff** with `scripts/create-user.mjs`.
- **Parents** from **Admin → Students → Create parent login**. This creates the account with a
  one-time password shown to the admin, and links the child. Entering the same email for a
  sibling links the second child to the same login.

`handle_new_user()` reads the role and tenant from `app_metadata`, which only the service role can
write. It never reads them from `user_metadata`, which `signUp()` lets any caller set. An account
with no role in `app_metadata` gets no profile, and RLS treats it as nobody.

After running `schema.sql`, enable the access token hook in the Supabase dashboard under
**Authentication → Hooks → Customize Access Token**, pointing at
`public.custom_access_token_hook`. This mints `school_id` and `user_role` into every JWT so RLS
policies resolve the tenant without a per-row `profiles` lookup. The system still works without
it — `public.current_school_id()` falls back to a `SECURITY DEFINER` profile lookup — just with
more query overhead.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase project credentials |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook, receipt reads, and creating parent logins. Never import into a Client Component |
| `NEXT_PUBLIC_APP_URL` | Origin used to build receipt links sent over WhatsApp |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Order creation and checkout signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC key for `x-razorpay-signature` |
| `WHATSAPP_PROVIDER` | `meta` (default) or `interakt` |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API credentials |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Lets the health check read template approval status (not needed to send) |
| `INTERAKT_API_KEY` | Interakt credentials, when that provider is selected |
| `RECEIPT_TOKEN_SECRET` | HMAC key for signed receipt links (`openssl rand -hex 32`) |

## Deploying to Vercel and Supabase Cloud

1. **Database.** Create a Supabase project (Mumbai, `ap-south-1`, for Indian schools), then apply
   the migrations: `npx supabase link --project-ref <ref>` and `npx supabase db push`.
2. **Auth.** Turn off **Allow new users to sign up**. Enable the access token hook
   (`public.custom_access_token_hook`) under **Authentication → Hooks**.
3. **Environment.** Set the variables in `.env.example` on the Vercel project for Production.
   `NEXT_PUBLIC_APP_URL` is the school-facing https origin. Generate `RECEIPT_TOKEN_SECRET` with
   `openssl rand -hex 32`. Razorpay and WhatsApp are optional: without them, families pay by direct
   UPI and notifications stay in-app. Upstash is optional too, and is only called for payment and
   payroll routes.
   To use Cloudflare R2, set `STORAGE_PROVIDER=r2` and the `R2_*` variables, and allow `PUT` and
   `GET` with the `Content-Type` header from your origin in the bucket's CORS policy. Switching
   provider does not copy existing files.
4. **Pre-flight.** `npm run build` runs `scripts/check-env.mjs` first. On a Vercel production
   build (`VERCEL_ENV=production`) it stops the deploy on anything unsafe:
   - missing keys, half-configured integrations, or placeholder and test values,
   - the local `supabase start` keys or JWT secret,
   - http or localhost URLs,
   - a secret behind a `NEXT_PUBLIC_` prefix, which would ship it to browsers,
   - a service key with the wrong role,
   - a short receipt secret,
   - the e2e-only overrides.

   Check a file by hand with `node scripts/check-env.mjs --production --file .env.production`.
   Locally and on preview builds it only reports.
5. **Integrations (if used).** Point the Razorpay webhook at `https://<domain>/api/webhooks/razorpay` (events
   under Payments). Get the WhatsApp templates approved and check **Admin → Fees** for the health
   banner.
6. **First login.** `node --env-file=.env.production scripts/create-user.mjs --role SCHOOL_ADMIN …`.

### Backups

```bash
SUPABASE_DB_URL=… scripts/backup-db.sh               # full backup
SUPABASE_DB_URL=… scripts/backup-db.sh --sanitize    # PII-free copy for staging
```

Each run writes `backups/classroomos_backup_YYYYMMDD_HHMMSS.sql.gz` (UTC time) and deletes archives
older than `BACKUP_RETENTION_DAYS` (30). All sections are read from one database snapshot, so a
backup taken while the school is working is still consistent.

**Contents.** The archive holds:
- the extensions the schema needs,
- logins,
- the public schema with its data, constraints, triggers and RLS policies,
- the `auth.users` trigger and the storage RLS policies,
- storage bucket and object metadata.

**Restoring.** Restore into a new, empty project with
`gunzip -c <file> | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1`. This was verified locally: row
counts, policies, triggers, functions and constraints all match the source.

**What is not included.** The uploaded files themselves live in Supabase Storage, so back them up
separately. Supabase's own daily backups (Pro plan) are a second line of defence, not a replacement.

**Sanitized copies.**
- Replaced with stable fakes: names, phone numbers, emails, dates of birth, photos, leave reasons,
  driver details and bank details.
- Removed: payslips, salaries and every password.
- Kept: amounts, attendance and results, so balances still add up.
- The source database is only read.

**Scheduling.** Use cron or a scheduled CI job, for example
`0 1 * * * cd /srv/classroomos && SUPABASE_DB_URL=… scripts/backup-db.sh >> backups/backup.log 2>&1`.
The archives contain personal data: they are written owner-only (`umask 077`), and should be stored
encrypted and off the machine.

### Edge security

`middleware.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera,
microphone, geolocation and USB (payment stays open to Razorpay's origins), and HSTS over HTTPS. It
sets them on every response it handles, redirects and 429s included. `X-Powered-By` is off.

`/api/payments/*` (20 a minute), `/api/payroll/*` (10) and `/api/whatsapp/*` (20) are rate limited.
Signed-in callers are counted per account, anonymous ones per client IP (`request.ip` on Vercel).
Over the limit, the answer is `429` with `Retry-After`. The Razorpay webhook is never limited,
because the gateway retries until it gets a 2xx.

There is no Content-Security-Policy yet. Razorpay Checkout, YouTube embeds and Supabase Storage all
need allowances, so add one with a report-only period first.

## Tenancy and RLS

Every tenant-owned table carries `school_id`, and each verb has its own policy. The rules are
expressed through four `SECURITY DEFINER` helpers so that policies on `profiles` do not recurse
through `profiles`:

| Helper | Answers |
| --- | --- |
| `current_school_id()` | Which tenant is the caller in? (JWT claim, else profile lookup) |
| `is_member_of(school)` | Does the caller belong to this tenant? |
| `is_school_staff(school)` | Teacher or admin of this tenant? |
| `is_school_admin(school)` | Admin of this tenant, or the platform operator? |
| `owns_student(student)` | Is the caller that student, or their linked parent? |

Read-access summary:

| Table | anon | STUDENT / PARENT | TEACHER | SCHOOL_ADMIN |
| --- | --- | --- | --- | --- |
| `schools` | active rows | own tenant | own tenant | own tenant (update) |
| `fee_structures` | published schedule | own tenant | own tenant | full |
| `students` | — | own record only | own tenant | full |
| `fee_payments` | — | own ledger | own tenant | full |
| `attendance` | — | own record | own tenant (write) | full |
| `admission_leads` | insert only | — | own tenant | full |

Three writes are deliberately not reachable from a session at all, and belong to the database or
the service role:

- `students.current_balance` is recalculated by trigger from `SUCCESS` payments. No client sets it.
- `fee_payments.status = 'SUCCESS'` is set only by the verified webhook, or by a school admin
  recording money collected at the office (see Payments).
- `profiles.role` and `profiles.school_id` are guarded by `guard_profile_privileges()`, so no user
  can escalate their own role or move themselves between tenants.

To verify isolation by hand, sign in as an admin of `demo-public-school` and query the other
seeded tenant:

```sql
-- Returns zero rows, regardless of what the client asks for.
select count(*) from students
where school_id = '22222222-2222-4222-8222-222222222222';
```

## Fees

A student's `total_fee_due` is the sum of their class's fee heads for the current academic year,
less their own `fee_concession`, floored at zero. `sync_class_dues()` re-applies it to every active
student in a class whenever a fee head is added, changed or removed on **Admin → Fees**, or a
concession is set from **Admin → Students**. Concessions are stored separately, so they survive
schedule changes. The balance triggers follow `total_fee_due`.

Moving a student to another class from **Admin → Students → Edit details** carries their own
fee heads for the year across and re-derives their dues from the new class's schedule. Payments
and the concession are kept.

## Payments

1. The parent (or an admin) calls `POST /api/payments/create-order`. The amount is read from the
   database, never from the request body, and a `PENDING` `fee_payments` row is written with the
   Razorpay order id.
2. Checkout completes in the browser.
3. Razorpay calls `POST /api/webhooks/razorpay`. The handler verifies the HMAC over the **raw**
   body, then settles the payment: allocates a receipt number, stores the receipt URL, lets the
   trigger recalculate the balance, and dispatches the WhatsApp confirmation.

**Office payments.** Cash, cheque, demand draft and bank transfer are recorded from **Admin →
Students → Record payment**. The action checks the amount against the outstanding balance, takes a
receipt number from the same `next_receipt_number()` sequence as online payments, and inserts a
`SUCCESS` row. The admin RLS policy allows this; a parent's insert can only ever be `PENDING`. The
parent gets the same WhatsApp confirmation with a signed receipt link.

**Voids.** An office receipt issued in error is voided from **Admin → Fees → Payments → Void**
with a reason. The row and its receipt number stay in the ledger as `VOIDED` and the receipt PDF is
watermarked; the balance trigger stops counting it. `guard_payment_void()` makes a void final and
refuses to void a gateway payment.

**Refunds.** Online payments are refunded from **Admin → Fees → Payments → ⋯ → Initiate
refund**, in full or in part, with a reason. `POST /api/payments/refund` (school admins only) calls
Razorpay first, then records the refund in `fee_refunds`. Triggers do the rest: `amount_refunded` on
the payment follows its refunds, the status becomes `PARTIALLY_REFUNDED` or `REFUNDED`, and the
refunded amount goes back on the student's balance. Revenue on the dashboard is net of refunds.

Each partial refund has its own Razorpay refund id, which is why refunds are rows of their own
rather than a column on the payment. The `refund.*` webhooks move a refund to `processed` or
`failed` (a failed refund counts as paid again), and record refunds issued from the Razorpay
dashboard, or ones whose ledger write failed after the gateway accepted them. A replayed
`payment.captured` cannot undo a refund: `derive_refund_status()` recomputes the status from the
refunded amount on every update.

The handler is idempotent. `razorpay_order_id` and `razorpay_payment_id` are unique, an already
settled payment short-circuits to `200`, and failures that a retry could fix return `503` while
permanent ones return `200` so the gateway stops resending.

Configure the webhook in the Razorpay dashboard for the `payment.captured`, `payment.failed`,
`refund.created`, `refund.processed` and `refund.failed` events, pointing at `https://<your-domain>/api/webhooks/razorpay`.

## Staff and payroll

**Admin → Staff & payroll** keeps the staff directory: employee code, role (`TEACHER`,
`ACCOUNTANT` or `SUPERVISOR`), department tags, base salary and the last four digits of the bank
account. The role describes the job. It grants no access; logins and permissions stay on
`profiles.role`. Staff are taken off the payroll, never deleted, because payslips refer to them.

Each month, pay a staff member from their row (base salary plus any additions and deductions,
with presets for 12% provident fund and professional tax) or pay everyone remaining at base salary
in one batch. Both call `POST /api/payroll/process`:

```json
{ "month": "2026-09",
  "entries": [{ "staff_id": "…", "additions": [{ "label": "Exam duty", "amount": 1500 }],
                "deductions": [{ "label": "Professional tax", "amount": 200 }],
                "payment_method": "DIRECT_TRANSFER", "payment_reference": "UTR…" }] }
```

Base pay is read from the staff record, never from the request. `compute_payslip_totals()` checks
every line and computes gross, deductions and net in the database. There is one payslip per person
per month (`PAY-YYYYMM-<code>`), so a repeated request skips that person instead of paying twice.
Transfers and cheques need a reference. Payslips have no update or delete policy: once issued they
are a financial record. Salaries are visible to school admins only.

## Transport

**Admin → Transport** holds bus routes (vehicle registration, driver and mobile), their stops
(pick-up and drop times, monthly fee) and the riders. Assigning a student to a stop bills the
stop's monthly fee for every remaining month of the academic year (April to March), starting this
month. Each month is a student-specific fee head in the Bus category, "Transport · Oct 2026", so it
shows on the parent's fee page and moves the balance like any other fee.

`sync_transport_fees()` rebuilds a student's transport heads from their allocation history whenever
it changes, so no month is ever billed twice:

- **Changing stop** keeps this month at the old stop and bills the new one from next month.
- **Removing a student** bills through the current month.
- A stop's fee is copied onto the allocation, so later fee changes don't rewrite existing bills.

Parents see the route, stop, pick-up and drop times, the driver's number and today's status (on
schedule, delayed with a note, or not running) on the portal home page. The status is set by the
office; there is no GPS feed. RLS lets a family read only the route and stop its child rides.

## Leave

Students and parents apply from **Portal → Leave**; staff apply for themselves from **Staff room →
Leave**. The kinds are sick, casual and emergency. One application covers up to 30 days, can be up
to 30 days after the fact, and cannot overlap another pending or approved one. The applicant can
withdraw it while it is pending.

Teachers review student leave from **Staff room → Leave**; admins review everything from **Admin →
Leave approvals**. `guard_leave_transition()` enforces the rules in the database:

- Staff leave is decided by an admin.
- Nobody reviews their own application.
- A decision is final.

Approving student leave records attendance as `EXCUSED_ABSENT` for each school day in the range,
skipping Sundays and academic holidays. An `ABSENT` mark is replaced; a day the student was
actually marked present or late is kept. The attendance register lists students on leave separately,
and saving a register never overwrites approved leave. The portal counts leave days apart from
absences.

## Student ID cards

**Admin → Students → ID cards** previews a class section's cards and prints the chosen ones as one
PDF from `GET /api/id-cards?grade=IX&section=A[&student=<id>…]`. Cards are CR80 size
(85.6 × 54 mm), front and back side by side, four students to an A4 page. The front has the
school's colour, the student's photo, class, roll number, USN and blood group. The back has the
parent's emergency number and the school's address. The QR code holds only the student's record
id. Blood group is set when enrolling or editing a student.

## WhatsApp templates

Create and get these approved on your WABA. Parameter order must match:

**`admission_enquiry_ack`**
> Hello {{1}}, we have received your admission enquiry for {{2}} (Grade {{3}}) at {{4}}. Our
> admissions team will call you on {{5}}.

**`fee_payment_confirmation`** — with a dynamic URL button
> Dear {{1}}, we have received {{2}} towards fees for {{3}} at {{4}}. Receipt no: {{5}}.
> Outstanding balance: {{6}}.

**`student_absence_alert`**
> Dear {{1}}, {{2}} was marked absent at {{3}} on {{4}}.

**`fee_due_reminder`**: with a dynamic URL button whose suffix is `<school_slug>/portal/fees`
> Dear {{1}}, {{2}} is outstanding towards fees for {{3}} at {{4}}. You can pay online from the
> parent portal.

Fee reminders are sent from **Admin → Fees → Send fee reminders**, to every active student with a
balance or to one class. A family is messaged at most once every three days
(`REMINDER_COOLDOWN_DAYS`), tracked in `students.last_fee_reminder_at`, so a repeated click sends
nothing new. The button is disabled when no WhatsApp provider is configured.

Notifications never fail a user request: every send resolves to a `WhatsAppResult` and is logged.
With no provider configured the calls are skipped, so local development works without credentials.

**Health check.** `GET /api/whatsapp/health` (school admins; `?fresh=1` skips the five-minute
cache) reports which variables are missing, whether Meta accepts the token and phone number id,
and each template's status in language `en`, the language the app sends in. Template status needs
`WHATSAPP_BUSINESS_ACCOUNT_ID`. Interakt offers no API for either check, so only the key's presence
is verified. When something is wrong, **Admin → Fees** shows a banner with the problems and setup
steps, and fee reminders stay disabled until `fee_due_reminder` is approved.

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm run build
```

All three pass on a clean checkout.

### End-to-end tests

```bash
npx supabase start                 # local stack, with migrations applied
npx playwright install chromium    # once
npm run test:e2e
```

The suite starts its own dev server on port 3100 (build output in `.next-e2e`, so a running
`npm run dev` is unaffected) and `e2e/mock-gateway.mjs` on port 3199, which stands in for Razorpay
and the Meta Graph API. No real money or messages move. `e2e/global-setup.ts` recreates the E2E
logins and the `E2E-` students before every run; seed data is not touched.

| Spec | Covers |
| --- | --- |
| `tenant-isolation` | RLS reads, writes, pages and documents across tenants, in both directions |
| `student-lifecycle` | Editing a student, moving class, dues recalculation, validation |
| `receipt-void` | Office payment, balance, void with reason, database guards |
| `refunds` | Partial and full refunds, API guards, gateway declines, refund webhooks |
| `student-portal` | Student login, syllabus download, report card download, fee balance |
| `whatsapp-health` | Template status, admin-only access, the Fees page banner |
| `payroll-processing` | Staff directory, payslip totals, PDF download, repeats, batch pay, access |
| `security-hardening` | Security headers, 401/403 on sensitive APIs, Storage closed to anon, rate limits |
| `id-card-generation` | Section preview, QR contents, selected-card PDFs and page count, access |
| `transport-allocation` | Routes and stops, monthly billing on assign/change/remove, parent view, RLS |
| `leave-workflow` | Apply, validate, approve into `EXCUSED_ABSENT`, reject, staff leave, withdraw |

`node scripts/auto-runner.mjs` runs the environment check, typecheck, lint and build in order and
stops at the first failure. Add `--e2e` to run this suite afterwards, or `--production` to make the
environment check strict.

`RAZORPAY_API_BASE_URL` points the Razorpay SDK at the stand-in. It is refused when
`NODE_ENV=production`.
