'use client';

import * as React from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { StudentAvatar } from '@/components/student-avatar';
import { uploadToBucket } from '@/lib/upload';
import { provisionStudentLogin, setStudentPhoto } from '../../actions';

interface IdentityPanelProps {
  schoolSlug: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  usn: string | null;
  hasStudentLogin: boolean;
  avatarSrc: string | null;
  onDone: () => void;
}

export function StudentLoginPanel({
  schoolSlug,
  studentId,
  studentName,
  usn,
  hasStudentLogin,
  onDone,
}: IdentityPanelProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ usn: string; password: string } | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('studentId', studentId);
    setError(null);

    startTransition(async () => {
      const result = await provisionStudentLogin(schoolSlug, formData);
      if (!result.ok) {
        setError(result.fieldErrors?.usn?.[0] ?? result.error);
        return;
      }
      setIssued({ usn: result.data.usn, password: result.data.temporaryPassword });
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{hasStudentLogin ? 'Reset student login' : 'Create student login'}</DialogTitle>
        <DialogDescription>
          {studentName} signs in at the school&apos;s login page with their USN and a one-time
          password, then must choose their own.
          {hasStudentLogin ? ' Resetting signs them out of the old password.' : ''}
        </DialogDescription>
      </DialogHeader>

      {issued ? (
        <div className="space-y-3 text-sm">
          <p>Share these details with the student. The password is shown only once.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
            <dt className="text-muted-foreground">USN</dt>
            <dd className="break-all">{issued.usn}</dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="select-all break-all" data-testid="temp-password">
              {issued.password}
            </dd>
          </dl>
          <DialogFooter>
            <Button onClick={onDone}>Done</Button>
          </DialogFooter>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor={`usn-${studentId}`}>USN (login ID)</Label>
            <Input
              id={`usn-${studentId}`}
              name="usn"
              defaultValue={usn ?? ''}
              placeholder="e.g. DPS20200141"
              autoCapitalize="characters"
              required
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {hasStudentLogin ? 'Reset password' : 'Create login'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function StudentPhotoPanel({
  schoolSlug,
  schoolId,
  studentId,
  studentName,
  avatarSrc,
  onDone,
}: IdentityPanelProps) {
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(avatarSrc);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  React.useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save() {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const path = await uploadToBucket('avatars', schoolId, studentId, file);
      const result = await setStudentPhoto(schoolSlug, studentId, path);
      if (!result.ok) throw new Error(result.error);
      toast({ variant: 'success', title: `Photo saved for ${studentName}` });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Student photo</DialogTitle>
        <DialogDescription>
          Shown to teachers during roll call and on the student&apos;s own portal. JPEG, PNG or
          WebP, up to 2 MB.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4">
        <StudentAvatar src={preview} name={studentName} className="h-28 w-28 text-2xl" />
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
          <Camera className="h-4 w-4" aria-hidden />
          Choose photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="sr-only"
            aria-label="Choose photo"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              if (chosen && chosen.size > MAX_PHOTO_BYTES) {
                setError('That photo is larger than 2 MB.');
                return;
              }
              setError(null);
              setFile(chosen);
            }}
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <DialogFooter>
        <Button onClick={save} disabled={!file || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save photo
        </Button>
      </DialogFooter>
    </>
  );
}
