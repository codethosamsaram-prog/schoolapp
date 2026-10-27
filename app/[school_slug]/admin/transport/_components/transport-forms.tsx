'use client';

import * as React from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { ActionResult, BusStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { BUS_STATUS_META, monthLabel } from '@/lib/transport';
import { formatINR } from '@/lib/utils';
import {
  addStop,
  assignStudent,
  deleteStop,
  removeFromTransport,
  saveRoute,
  setRouteStatus,
} from '../actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Errors = Record<string, string[]>;

/** Runs a server action from a form, with field errors and a toast. */
function useFormAction<T>(
  action: (formData: FormData) => Promise<ActionResult<T>>,
  onSuccess: (data: T, form: HTMLFormElement) => void,
) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Errors>({});
  const { toast } = useToast();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Not saved', description: result.error });
        return;
      }
      onSuccess(result.data, form);
    });
  }

  const error = (field: string) =>
    errors[field]?.[0] ? <p className="text-xs text-destructive">{errors[field][0]}</p> : null;

  return { pending, onSubmit, error, toast };
}

/* ------------------------------------------------------------------ routes */

export interface RouteValues {
  id: string;
  name: string;
  vehicleRegistration: string;
  driverName: string;
  driverPhone: string;
}

export function RouteDialog({ schoolSlug, route }: { schoolSlug: string; route?: RouteValues }) {
  const [open, setOpen] = React.useState(false);
  const { pending, onSubmit, error, toast } = useFormAction(
    (formData) => {
      if (route) formData.set('routeId', route.id);
      return saveRoute(schoolSlug, formData);
    },
    (_data, form) => {
      toast({ variant: 'success', title: route ? 'Route saved' : 'Route added' });
      if (!route) form.reset();
      setOpen(false);
    },
  );
  const id = (field: string) => `${field}-${route?.id ?? 'new'}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {route ? (
          <Button variant="ghost" size="sm">
            Edit route
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            Add route
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{route ? `Edit ${route.name}` : 'Add a bus route'}</DialogTitle>
          <DialogDescription>Parents of riders see the driver&apos;s name and number on the portal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('name')}>Route name</Label>
              <Input id={id('name')} name="name" defaultValue={route?.name} placeholder="Route 3 · Rohini East" />
              {error('name')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('vehicleRegistration')}>Vehicle registration</Label>
              <Input
                id={id('vehicleRegistration')}
                name="vehicleRegistration"
                defaultValue={route?.vehicleRegistration}
                placeholder="DL 1P 1234"
                autoCapitalize="characters"
              />
              {error('vehicleRegistration')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('driverName')}>Driver</Label>
              <Input id={id('driverName')} name="driverName" defaultValue={route?.driverName} />
              {error('driverName')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('driverPhone')}>Driver mobile</Label>
              <Input
                id={id('driverPhone')}
                name="driverPhone"
                type="tel"
                inputMode="tel"
                defaultValue={route?.driverPhone}
              />
              {error('driverPhone')}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {route ? 'Save route' : 'Add route'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RouteStatusForm({
  schoolSlug,
  routeId,
  routeName,
  status,
  note,
}: {
  schoolSlug: string;
  routeId: string;
  routeName: string;
  status: BusStatus;
  note: string | null;
}) {
  const [value, setValue] = React.useState<BusStatus>(status);
  const { pending, onSubmit, toast } = useFormAction(
    (formData) => {
      formData.set('routeId', routeId);
      return setRouteStatus(schoolSlug, formData);
    },
    () => toast({ title: `${routeName}: ${BUS_STATUS_META[value].label.toLowerCase()}` }),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" aria-label={`Bus status for ${routeName}`}>
      <select
        name="status"
        aria-label="Bus status"
        className={selectClass.replace('w-full', 'w-44')}
        value={value}
        onChange={(event) => setValue(event.target.value as BusStatus)}
      >
        {Object.entries(BUS_STATUS_META).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.label}
          </option>
        ))}
      </select>
      {value !== 'ON_SCHEDULE' ? (
        <Input
          name="note"
          aria-label="Note for parents"
          defaultValue={note ?? ''}
          placeholder="About 20 minutes late"
          maxLength={140}
          className="w-56"
        />
      ) : null}
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Update status
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------- stops */

export function AddStopForm({ schoolSlug, routeId, routeName }: { schoolSlug: string; routeId: string; routeName: string }) {
  const { pending, onSubmit, error, toast } = useFormAction(
    (formData) => {
      formData.set('routeId', routeId);
      return addStop(schoolSlug, formData);
    },
    (_data, form) => {
      toast({ variant: 'success', title: `Stop added to ${routeName}` });
      form.reset();
    },
  );

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Add a stop to ${routeName}`}
      className="grid gap-2 border-t bg-muted/30 p-3 sm:grid-cols-[1fr_110px_110px_110px_auto] sm:items-start"
      noValidate
    >
      <div className="grid gap-1">
        <Input name="name" aria-label="Stop name" placeholder="New stop, e.g. Sector 9 Market" />
        {error('name')}
      </div>
      <div className="grid gap-1">
        <Input name="pickupTime" type="time" aria-label="Pick-up time" defaultValue="07:00" />
        {error('pickupTime')}
      </div>
      <div className="grid gap-1">
        <Input name="dropTime" type="time" aria-label="Drop time" defaultValue="14:30" />
        {error('dropTime')}
      </div>
      <div className="grid gap-1">
        <Input name="monthlyFee" type="number" min={0} step="1" aria-label="Monthly fee (₹)" placeholder="₹ / month" />
        {error('monthlyFee')}
      </div>
      <Button type="submit" size="sm" className="h-10" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        Add stop
      </Button>
    </form>
  );
}

export function DeleteStopButton({ schoolSlug, stopId, name }: { schoolSlug: string; stopId: string; name: string }) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      aria-label={`Remove stop ${name}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteStop(schoolSlug, stopId);
          toast(
            result.ok
              ? { title: `${name} removed` }
              : { variant: 'destructive', title: 'Stop kept', description: result.error },
          );
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />}
    </Button>
  );
}

/* ------------------------------------------------------------- allocations */

export interface StopOption {
  id: string;
  label: string;
  routeName: string;
  monthlyFee: number;
}

function StopSelect({ stops, defaultValue, id }: { stops: StopOption[]; defaultValue?: string; id: string }) {
  const routes = [...new Set(stops.map((stop) => stop.routeName))];
  return (
    <select id={id} name="stopId" className={selectClass} defaultValue={defaultValue ?? ''}>
      <option value="" disabled>
        Choose a stop
      </option>
      {routes.map((route) => (
        <optgroup key={route} label={route}>
          {stops
            .filter((stop) => stop.routeName === route)
            .map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.label} · {formatINR(stop.monthlyFee)}/month
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function AssignStudentForm({
  schoolSlug,
  students,
  stops,
}: {
  schoolSlug: string;
  students: { id: string; label: string }[];
  stops: StopOption[];
}) {
  const { pending, onSubmit, error, toast } = useFormAction(
    (formData) => assignStudent(schoolSlug, formData),
    (data, form) => {
      toast({
        variant: 'success',
        title: data.changed ? 'Stop changed' : 'Student added to transport',
        description: `Monthly transport fee billed from ${monthLabel(data.billedFrom)}.`,
      });
      form.reset();
    },
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="assign-student">Student</Label>
        <select id="assign-student" name="studentId" className={selectClass} defaultValue="">
          <option value="" disabled>
            Choose a student
          </option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.label}
            </option>
          ))}
        </select>
        {error('studentId')}
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="assign-stop">Pick-up point</Label>
        <StopSelect id="assign-stop" stops={stops} />
        {error('stopId')}
      </div>
      <Button type="submit" disabled={pending || stops.length === 0}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Assign
      </Button>
    </form>
  );
}

export function RiderActions({
  schoolSlug,
  studentId,
  studentName,
  stopId,
  stops,
}: {
  schoolSlug: string;
  studentId: string;
  studentName: string;
  stopId: string;
  stops: StopOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [removing, startRemove] = React.useTransition();
  const { pending, onSubmit, error, toast } = useFormAction(
    (formData) => {
      formData.set('studentId', studentId);
      return assignStudent(schoolSlug, formData);
    },
    (data) => {
      toast({
        variant: 'success',
        title: `${studentName}: stop changed`,
        description: `The new stop is billed from ${monthLabel(data.billedFrom)}.`,
      });
      setOpen(false);
    },
  );

  function remove() {
    startRemove(async () => {
      const result = await removeFromTransport(schoolSlug, studentId);
      toast(
        result.ok
          ? { title: `${studentName} taken off transport`, description: `Billed through ${monthLabel(result.data.lastBilledMonth)}.` }
          : { variant: 'destructive', title: 'Not changed', description: result.error },
      );
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Change stop for ${studentName}`}>
            Change
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Change stop for {studentName}</DialogTitle>
            <DialogDescription>
              This month stays billed at the current stop; the new stop is billed from next month.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor={`change-${studentId}`}>New pick-up point</Label>
              <StopSelect id={`change-${studentId}`} stops={stops.filter((stop) => stop.id !== stopId)} />
              {error('stopId')}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Change stop
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Button variant="ghost" size="sm" onClick={remove} disabled={removing} aria-label={`Remove ${studentName} from transport`}>
        {removing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Remove'}
      </Button>
    </div>
  );
}
