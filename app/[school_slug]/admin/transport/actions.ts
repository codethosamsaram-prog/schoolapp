'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { requireTenantSession } from '@/lib/auth';
import { nextMonth, thisMonth } from '@/lib/transport';
import { toLocalIndianNumber } from '@/lib/utils';

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const local = toLocalIndianNumber(value);
    if (!local) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return local;
  });

function fail(parsed: z.SafeParseError<unknown>): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  return {
    ok: false,
    error: parsed.error.issues[0]?.message ?? 'Please correct the highlighted fields.',
    fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
  };
}

function revalidateTransport(schoolSlug: string) {
  revalidatePath(`/${schoolSlug}/admin/transport`);
  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/admin/fees`);
  revalidatePath(`/${schoolSlug}/portal`, 'layout');
}

/* ------------------------------------------------------------------ routes */

const routeSchema = z.object({
  routeId: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Name the route').max(60),
  vehicleRegistration: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 -]{4,15}$/, 'Registration like DL 1P 1234'),
  driverName: z.string().trim().min(2, "Enter the driver's name").max(80),
  driverPhone: phone,
});

export async function saveRoute(schoolSlug: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = routeSchema.safeParse({
    name: formData.get('name'),
    vehicleRegistration: formData.get('vehicleRegistration'),
    driverName: formData.get('driverName'),
    driverPhone: formData.get('driverPhone'),
    routeId: formData.get('routeId') || undefined,
  });
  if (!parsed.success) return fail(parsed);

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const input = parsed.data;
  const values = {
    name: input.name,
    vehicle_registration: input.vehicleRegistration,
    driver_name: input.driverName,
    driver_phone: input.driverPhone,
  };

  const { data, error } = input.routeId
    ? await supabase
        .from('transport_routes')
        .update(values)
        .eq('id', input.routeId)
        .eq('school_id', school.id)
        .select('id')
        .maybeSingle()
    : await supabase
        .from('transport_routes')
        .insert({ ...values, school_id: school.id })
        .select('id')
        .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: 'A route with that name already exists.', fieldErrors: { name: ['Already exists'] } };
    }
    console.error('[transport] route save failed', { error: error?.message });
    return { ok: false, error: 'Could not save the route. Please try again.' };
  }

  revalidateTransport(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

const statusSchema = z.object({
  routeId: z.string().uuid(),
  status: z.enum(['ON_SCHEDULE', 'DELAYED', 'NOT_RUNNING']),
  note: z.string().trim().max(140).optional(),
});

/** What parents see on the portal today, e.g. "Delayed: about 20 minutes". */
export async function setRouteStatus(schoolSlug: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = statusSchema.safeParse({
    routeId: formData.get('routeId'),
    status: formData.get('status'),
    note: formData.get('note') || undefined,
  });
  if (!parsed.success) return fail(parsed);

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const { data, error } = await createClient()
    .from('transport_routes')
    .update({
      status: parsed.data.status,
      status_note: parsed.data.status === 'ON_SCHEDULE' ? null : parsed.data.note ?? null,
      status_updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.routeId)
    .eq('school_id', school.id)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not update the bus status.' };
  revalidateTransport(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

/* ------------------------------------------------------------------- stops */

const stopSchema = z.object({
  routeId: z.string().uuid(),
  name: z.string().trim().min(2, 'Name the stop').max(80),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a pick-up time'),
  dropTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a drop time'),
  monthlyFee: z.coerce.number({ invalid_type_error: 'Enter the monthly fee' }).nonnegative().max(1_00_000),
  sequence: z.coerce.number().int().min(0).max(999).default(0),
});

export async function addStop(schoolSlug: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = stopSchema.safeParse({
    routeId: formData.get('routeId'),
    name: formData.get('name'),
    pickupTime: formData.get('pickupTime'),
    dropTime: formData.get('dropTime'),
    monthlyFee: formData.get('monthlyFee'),
    sequence: formData.get('sequence') || 0,
  });
  if (!parsed.success) return fail(parsed);

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const input = parsed.data;
  const { data, error } = await createClient()
    .from('transport_stops')
    .insert({
      school_id: school.id,
      route_id: input.routeId,
      name: input.name,
      pickup_time: input.pickupTime,
      drop_time: input.dropTime,
      monthly_fee: input.monthlyFee,
      sequence: input.sequence,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return {
        ok: false,
        error: 'This route already has a stop with that name.',
        fieldErrors: { name: ['Already on this route'] },
      };
    }
    console.error('[transport] stop insert failed', { error: error?.message });
    return { ok: false, error: 'Could not add the stop. Please try again.' };
  }

  revalidateTransport(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

/** Only a stop nobody has ever been allocated to can be removed. */
export async function deleteStop(schoolSlug: string, stopId: string): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(stopId).success) return { ok: false, error: 'Unknown stop.' };
  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);

  const { data, error } = await createClient()
    .from('transport_stops')
    .delete()
    .eq('id', stopId)
    .eq('school_id', school.id)
    .select('id')
    .maybeSingle();

  if (error?.code === '23503') {
    return { ok: false, error: 'Students have used this stop, so it is kept for their fee history.' };
  }
  if (error || !data) return { ok: false, error: 'Could not remove the stop.' };
  revalidateTransport(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

/* ------------------------------------------------------------- allocations */

const assignSchema = z.object({
  studentId: z.string().uuid('Pick a student'),
  stopId: z.string().uuid('Pick a stop'),
});

/**
 * Puts a student on a stop. A first allocation is billed from this month.
 * Changing stop keeps this month on the old stop and bills the new one from
 * next month, so no month is charged twice. The monthly fee heads are rebuilt
 * by sync_transport_fees() whenever the allocation rows change.
 */
export async function assignStudent(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ billedFrom: string; changed: boolean }>> {
  const parsed = assignSchema.safeParse({
    studentId: formData.get('studentId'),
    stopId: formData.get('stopId'),
  });
  if (!parsed.success) return fail(parsed);

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const { studentId, stopId } = parsed.data;

  const [{ data: student }, { data: stop }, { data: current }] = await Promise.all([
    supabase.from('students').select('id, is_active').eq('id', studentId).eq('school_id', school.id).maybeSingle(),
    supabase
      .from('transport_stops')
      .select('id, monthly_fee')
      .eq('id', stopId)
      .eq('school_id', school.id)
      .maybeSingle(),
    supabase
      .from('transport_allocations')
      .select('id, stop_id, start_month')
      .eq('student_id', studentId)
      .is('end_month', null)
      .maybeSingle(),
  ]);

  if (!student?.is_active) return { ok: false, error: 'That student is not on your active roll.' };
  if (!stop) return { ok: false, error: 'That stop does not exist.' };
  if (current?.stop_id === stopId) return { ok: false, error: 'The student is already on this stop.' };

  let billedFrom = thisMonth();
  if (current) {
    // A change that has not started billing yet is simply replaced.
    billedFrom = current.start_month > thisMonth() ? current.start_month : nextMonth();
    const { error } = await supabase
      .from('transport_allocations')
      .update({ end_month: billedFrom })
      .eq('id', current.id);
    if (error) {
      console.error('[transport] could not close allocation', { error: error.message });
      return { ok: false, error: 'Could not change the stop. Please try again.' };
    }
  }

  const { error } = await supabase.from('transport_allocations').insert({
    school_id: school.id,
    student_id: studentId,
    stop_id: stopId,
    monthly_fee: Number(stop.monthly_fee),
    start_month: billedFrom,
  });
  if (error) {
    console.error('[transport] allocation failed', { error: error.message });
    return { ok: false, error: 'Could not assign the stop. Please try again.' };
  }

  revalidateTransport(schoolSlug);
  return { ok: true, data: { billedFrom, changed: Boolean(current) } };
}

/** Takes a student off transport; the current month is still billed. */
export async function removeFromTransport(
  schoolSlug: string,
  studentId: string,
): Promise<ActionResult<{ lastBilledMonth: string }>> {
  if (!z.string().uuid().safeParse(studentId).success) return { ok: false, error: 'Unknown student.' };
  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data: current } = await supabase
    .from('transport_allocations')
    .select('id, start_month')
    .eq('student_id', studentId)
    .eq('school_id', school.id)
    .is('end_month', null)
    .maybeSingle();
  if (!current) return { ok: false, error: 'That student is not on transport.' };

  const end = current.start_month > thisMonth() ? current.start_month : nextMonth();
  const { error } = await supabase.from('transport_allocations').update({ end_month: end }).eq('id', current.id);
  if (error) return { ok: false, error: 'Could not remove the student from transport.' };

  revalidateTransport(schoolSlug);
  return { ok: true, data: { lastBilledMonth: thisMonth() } };
}
