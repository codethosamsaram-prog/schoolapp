'use client';

import * as React from 'react';
import { Loader2, Paperclip, Plus, X, Youtube } from 'lucide-react';
import type { HomeworkAttachment } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { COMMON_SUBJECTS } from '@/lib/constants';
import { uploadToBucket } from '@/lib/upload';
import { todayInIST } from '@/lib/utils';
import { youtubeId } from '@/lib/youtube';
import { createHomework, createVideoReference } from '../../content-actions';
import { ClassFields } from '../../_components/class-fields';

interface FormProps {
  schoolSlug: string;
  schoolId: string;
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function SubjectField({ id, error }: { id: string; error?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Subject</Label>
      <Input id={id} name="subject" list={`${id}-options`} placeholder="Mathematics" required />
      <datalist id={`${id}-options`}>
        {COMMON_SUBJECTS.map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function HomeworkForm({ schoolSlug, schoolId, grades, sectionsByGrade }: FormProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setErrors({});
    setPending(true);

    try {
      const attachments: HomeworkAttachment[] = [];
      for (const file of files) {
        const path = await uploadToBucket('academic-docs', schoolId, 'homework', file);
        attachments.push({ name: file.name, path });
      }
      formData.set('attachments', JSON.stringify(attachments));

      const result = await createHomework(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Homework not posted', description: result.error });
        return;
      }
      toast({ variant: 'success', title: 'Homework posted' });
      form.reset();
      setFiles([]);
    } catch (cause) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: cause instanceof Error ? cause.message : 'Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <ClassFields idPrefix="hw" grades={grades} sectionsByGrade={sectionsByGrade} errors={errors} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SubjectField id="hw-subject" error={errors.subject?.[0]} />
        <div className="grid gap-2">
          <Label htmlFor="hw-due">Due date</Label>
          <Input id="hw-due" name="dueDate" type="date" min={todayInIST()} required />
          {errors.dueDate?.[0] ? <p className="text-xs text-destructive">{errors.dueDate[0]}</p> : null}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hw-title">Title</Label>
        <Input id="hw-title" name="title" maxLength={150} placeholder="Exercise 4.2, questions 1-12" required />
        {errors.title?.[0] ? <p className="text-xs text-destructive">{errors.title[0]}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hw-description">Instructions</Label>
        <Textarea id="hw-description" name="description" rows={3} maxLength={3000} />
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Attachments</span>
        {files.length > 0 ? (
          <ul className="space-y-1">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length < 5 ? (
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-4 w-4" aria-hidden />
            Add a file (PDF, image or Word, up to 10 MB)
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,image/*,.doc,.docx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > MAX_FILE_BYTES) {
                  toast({ variant: 'destructive', title: `${file.name} is larger than 10 MB` });
                  return;
                }
                setFiles((current) => [...current, file]);
              }}
            />
          </label>
        ) : null}
      </div>

      <Button type="submit" disabled={pending || grades.length === 0} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        Post homework
      </Button>
    </form>
  );
}

export function VideoForm({ schoolSlug, grades, sectionsByGrade }: FormProps) {
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [url, setUrl] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();
  const previewId = youtubeId(url);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setErrors({});

    startTransition(async () => {
      const result = await createVideoReference(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Video not added', description: result.error });
        return;
      }
      toast({ variant: 'success', title: 'Video added to the feed' });
      form.reset();
      setUrl('');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <ClassFields idPrefix="vid" grades={grades} sectionsByGrade={sectionsByGrade} errors={errors} />
      </div>
      <SubjectField id="vid-subject" error={errors.subject?.[0]} />
      <div className="grid gap-2">
        <Label htmlFor="vid-url">YouTube link</Label>
        <Input
          id="vid-url"
          name="youtubeUrl"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        {errors.youtubeUrl?.[0] ? <p className="text-xs text-destructive">{errors.youtubeUrl[0]}</p> : null}
      </div>
      {previewId ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail preview
        <img
          src={`https://i.ytimg.com/vi/${previewId}/mqdefault.jpg`}
          alt="Video thumbnail"
          className="aspect-video w-48 rounded-md border object-cover"
        />
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="vid-title">Title</Label>
        <Input id="vid-title" name="title" maxLength={150} required />
        {errors.title?.[0] ? <p className="text-xs text-destructive">{errors.title[0]}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="vid-description">Why watch it</Label>
        <Textarea id="vid-description" name="description" rows={2} maxLength={1000} />
      </div>
      <Button type="submit" disabled={pending || grades.length === 0} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Youtube className="h-4 w-4" aria-hidden />}
        Add video
      </Button>
    </form>
  );
}
