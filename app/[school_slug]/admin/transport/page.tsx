import type { Metadata } from 'next';
import { Bus, Phone } from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { BUS_STATUS_META, clockTime, monthLabel, thisMonth } from '@/lib/transport';
import { cn, formatDateTime, formatINR } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AddStopForm,
  AssignStudentForm,
  DeleteStopButton,
  RiderActions,
  RouteDialog,
  RouteStatusForm,
  type StopOption,
} from './_components/transport-forms';

export const metadata: Metadata = { title: 'Transport' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

interface RiderRow {
  id: string;
  stop_id: string;
  monthly_fee: number;
  start_month: string;
  students: { id: string; full_name: string; class_grade: string; section: string; roll_number: string } | null;
}

export default async function TransportPage({ params }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const [routesResult, stopsResult, ridersResult, studentsResult] = await Promise.all([
    supabase.from('transport_routes').select('*').eq('school_id', school.id).order('name'),
    supabase
      .from('transport_stops')
      .select('*')
      .eq('school_id', school.id)
      .order('sequence')
      .order('pickup_time'),
    supabase
      .from('transport_allocations')
      .select('id, stop_id, monthly_fee, start_month, students(id, full_name, class_grade, section, roll_number)')
      .eq('school_id', school.id)
      .is('end_month', null),
    supabase
      .from('students')
      .select('id, full_name, class_grade, section, roll_number')
      .eq('school_id', school.id)
      .eq('is_active', true)
      .order('full_name')
      .limit(2000),
  ]);

  const routes = routesResult.data ?? [];
  const stops = stopsResult.data ?? [];
  const riders = ((ridersResult.data ?? []) as unknown as RiderRow[]).sort((a, b) =>
    (a.students?.full_name ?? '').localeCompare(b.students?.full_name ?? ''),
  );
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const ridersByStop = new Map<string, number>();
  for (const rider of riders) ridersByStop.set(rider.stop_id, (ridersByStop.get(rider.stop_id) ?? 0) + 1);

  const stopOptions: StopOption[] = stops
    .filter((stop) => routeById.get(stop.route_id)?.is_active)
    .map((stop) => ({
      id: stop.id,
      label: `${stop.name} (${clockTime(stop.pickup_time)})`,
      routeName: routeById.get(stop.route_id)?.name ?? 'Route',
      monthlyFee: Number(stop.monthly_fee),
    }));

  const monthlyTotal = riders.reduce((sum, rider) => sum + Number(rider.monthly_fee), 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Transport</h1>
          <p className="text-sm text-muted-foreground">
            {routes.length} route{routes.length === 1 ? '' : 's'} · {riders.length} rider
            {riders.length === 1 ? '' : 's'} · {formatINR(monthlyTotal)} a month in transport fees
          </p>
        </div>
        <RouteDialog schoolSlug={school.slug} />
      </header>

      <Card>
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Riders</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Assigning a stop adds its monthly fee to the student&apos;s fee schedule for each remaining month
            of the academic year, starting this month.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {stopOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a route and its stops before assigning students.</p>
          ) : (
            <AssignStudentForm
              schoolSlug={school.slug}
              stops={stopOptions}
              students={(studentsResult.data ?? []).map((student) => ({
                id: student.id,
                label: `${student.full_name} · ${student.class_grade}-${student.section} · Roll ${student.roll_number}`,
              }))}
            />
          )}

          {riders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Route and stop</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Fee / month</TableHead>
                  <TableHead className="w-40">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riders.map((rider) => {
                  const stop = stopById.get(rider.stop_id);
                  const route = stop ? routeById.get(stop.route_id) : undefined;
                  const student = rider.students;
                  if (!student) return null;
                  return (
                    <TableRow key={rider.id}>
                      <TableCell>
                        <div className="font-medium">{student.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          Class {student.class_grade}-{student.section} · Roll {student.roll_number}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {route?.name} · {stop?.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {stop ? `Pick-up ${clockTime(stop.pickup_time)}` : ''}
                          {rider.start_month > thisMonth() ? ` · from ${monthLabel(rider.start_month)}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right sm:table-cell">
                        {formatINR(rider.monthly_fee)}
                      </TableCell>
                      <TableCell>
                        <RiderActions
                          schoolSlug={school.slug}
                          studentId={student.id}
                          studentName={student.full_name}
                          stopId={rider.stop_id}
                          stops={stopOptions}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {routes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No bus routes yet. Add a route with its vehicle and driver, then its pick-up points.
          </CardContent>
        </Card>
      ) : (
        routes.map((route) => {
          const routeStops = stops.filter((stop) => stop.route_id === route.id);
          const status = BUS_STATUS_META[route.status];
          return (
            <Card key={route.id} className="overflow-hidden" aria-label={`Route ${route.name}`}>
              <CardHeader className="space-y-3 border-b py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Bus className="h-4 w-4 text-primary" aria-hidden />
                      {route.name}
                      <span className="rounded-md border px-1.5 py-0.5 font-mono text-xs font-normal">
                        {route.vehicle_registration}
                      </span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', status.tone)}>
                        {status.label}
                      </span>
                    </CardTitle>
                    <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      Driver {route.driver_name} ·
                      <a href={`tel:+91${route.driver_phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {route.driver_phone}
                      </a>
                      {route.status !== 'ON_SCHEDULE' ? (
                        <span>
                          {' '}
                          · {route.status_note ? `“${route.status_note}” · ` : ''}updated {formatDateTime(route.status_updated_at)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <RouteDialog
                    schoolSlug={school.slug}
                    route={{
                      id: route.id,
                      name: route.name,
                      vehicleRegistration: route.vehicle_registration,
                      driverName: route.driver_name,
                      driverPhone: route.driver_phone,
                    }}
                  />
                </div>
                <RouteStatusForm
                  schoolSlug={school.slug}
                  routeId={route.id}
                  routeName={route.name}
                  status={route.status}
                  note={route.status_note}
                />
              </CardHeader>
              <CardContent className="p-0">
                {routeStops.length === 0 ? (
                  <p className="px-6 py-6 text-sm text-muted-foreground">No stops yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stop</TableHead>
                        <TableHead>Pick-up</TableHead>
                        <TableHead>Drop</TableHead>
                        <TableHead className="text-right">Fee / month</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Riders</TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Remove</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {routeStops.map((stop) => (
                        <TableRow key={stop.id}>
                          <TableCell className="font-medium">{stop.name}</TableCell>
                          <TableCell className="whitespace-nowrap">{clockTime(stop.pickup_time)}</TableCell>
                          <TableCell className="whitespace-nowrap">{clockTime(stop.drop_time)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatINR(stop.monthly_fee)}</TableCell>
                          <TableCell className="hidden text-right sm:table-cell">{ridersByStop.get(stop.id) ?? 0}</TableCell>
                          <TableCell>
                            <DeleteStopButton schoolSlug={school.slug} stopId={stop.id} name={stop.name} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <AddStopForm schoolSlug={school.slug} routeId={route.id} routeName={route.name} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
