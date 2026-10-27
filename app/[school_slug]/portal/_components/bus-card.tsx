import { Bus, Clock, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { BUS_STATUS_META, clockTime, monthLabel, thisMonth } from '@/lib/transport';
import { cn, formatDateTime, formatINR } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AllocationRow {
  monthly_fee: number;
  start_month: string;
  transport_stops: {
    name: string;
    pickup_time: string;
    drop_time: string;
    transport_routes: {
      name: string;
      vehicle_registration: string;
      driver_name: string;
      driver_phone: string;
      status: keyof typeof BUS_STATUS_META;
      status_note: string | null;
      status_updated_at: string;
    } | null;
  } | null;
}

/**
 * The child's school bus: route, stop, times, driver and today's status.
 * RLS lets a family read only the route and stop its child currently rides.
 * Renders nothing for a student who is not on transport.
 */
export async function BusCard({ studentId }: { studentId: string }) {
  const { data } = await createClient()
    .from('transport_allocations')
    .select(
      'monthly_fee, start_month, transport_stops(name, pickup_time, drop_time, transport_routes(name, vehicle_registration, driver_name, driver_phone, status, status_note, status_updated_at))',
    )
    .eq('student_id', studentId)
    .is('end_month', null)
    .maybeSingle();

  const allocation = data as unknown as AllocationRow | null;
  const stop = allocation?.transport_stops;
  const route = stop?.transport_routes;
  if (!allocation || !stop || !route) return null;

  const status = BUS_STATUS_META[route.status];

  return (
    <Card aria-labelledby="bus-heading">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b py-4">
        <CardTitle id="bus-heading" className="flex items-center gap-2 text-base">
          <Bus className="h-4 w-4 text-primary" aria-hidden />
          School bus
        </CardTitle>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', status.tone)}>
          {status.label}
        </span>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Route</p>
          <p className="font-semibold">{route.name}</p>
          <p className="text-sm text-muted-foreground">
            {stop.name} · <span className="font-mono">{route.vehicle_registration}</span>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Timings</p>
          <p className="flex items-center gap-1.5 font-semibold">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Pick-up {clockTime(stop.pickup_time)}
          </p>
          <p className="text-sm text-muted-foreground">Drop {clockTime(stop.drop_time)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver</p>
          <p className="font-semibold">{route.driver_name}</p>
          <a
            href={`tel:+91${route.driver_phone}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden />
            +91 {route.driver_phone}
          </a>
        </div>
        {route.status !== 'ON_SCHEDULE' ? (
          <p className="rounded-md border bg-muted/40 p-2 text-sm sm:col-span-3">
            {route.status_note ?? status.label}
            <span className="text-muted-foreground"> · updated {formatDateTime(route.status_updated_at)}</span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground sm:col-span-3">
          {formatINR(allocation.monthly_fee)} a month, on your fee schedule
          {allocation.start_month > thisMonth() ? ` from ${monthLabel(allocation.start_month)}` : ''}.
        </p>
      </CardContent>
    </Card>
  );
}
