import type { Metadata } from 'next';
import { Paperclip, PlayCircle } from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { audienceLabel, getSchoolClasses } from '@/lib/classes';
import { formatDate, todayInIST } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteItemButton } from '@/components/delete-item-button';
import { deleteHomework, deleteVideoReference } from '../content-actions';
import { HomeworkForm, VideoForm } from './_components/homework-forms';

export const metadata: Metadata = { title: 'Homework & videos' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

export default async function HomeworkCuratorPage({ params }: PageProps) {
  const { school, userId, profile } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  const supabase = createClient();
  const [classes, homeworkResult, videoResult] = await Promise.all([
    getSchoolClasses(supabase, school.id),
    supabase
      .from('homework')
      .select('*')
      .eq('school_id', school.id)
      .order('due_date', { ascending: false })
      .limit(40),
    supabase
      .from('video_references')
      .select('*')
      .eq('school_id', school.id)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const canDelete = (createdBy: string | null) => profile.role !== 'TEACHER' || createdBy === userId;
  const today = todayInIST();
  const formProps = {
    schoolSlug: school.slug,
    schoolId: school.id,
    grades: classes.grades,
    sectionsByGrade: classes.sectionsByGrade,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Set homework</CardTitle>
          </CardHeader>
          <CardContent>
            <HomeworkForm {...formProps} />
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Share a YouTube reference</CardTitle>
            <p className="text-sm text-muted-foreground">
              Appears in the video feed on the class&apos;s portal home.
            </p>
          </CardHeader>
          <CardContent>
            <VideoForm {...formProps} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="hw-list">
          <h2 id="hw-list" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent homework
          </h2>
          {(homeworkResult.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No homework set yet.</p>
          ) : (
            (homeworkResult.data ?? []).map((item) => (
              <Card key={item.id}>
                <CardContent className="flex gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.subject}</Badge>
                      <Badge variant="secondary">{audienceLabel(item.class_grade, item.section)}</Badge>
                      <span className={item.due_date < today ? 'text-xs text-muted-foreground' : 'text-xs font-medium'}>
                        Due {formatDate(item.due_date)}
                      </span>
                    </div>
                    <p className="font-medium">{item.title}</p>
                    {item.attachments.length > 0 ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" aria-hidden />
                        {item.attachments.map((file) => file.name).join(', ')}
                      </p>
                    ) : null}
                  </div>
                  {canDelete(item.created_by) ? (
                    <DeleteItemButton
                      action={deleteHomework.bind(null, school.slug, item.id)}
                      label={`Remove ${item.title}`}
                      confirmText="Remove this homework?"
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <section className="space-y-3" aria-labelledby="video-list">
          <h2 id="video-list" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Video references
          </h2>
          {(videoResult.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos shared yet.</p>
          ) : (
            (videoResult.data ?? []).map((item) => (
              <Card key={item.id}>
                <CardContent className="flex gap-3 p-4">
                  <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <a href={item.youtube_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {item.title}
                    </a>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.subject}</Badge>
                      <Badge variant="secondary">{audienceLabel(item.class_grade, item.section)}</Badge>
                    </div>
                  </div>
                  {canDelete(item.created_by) ? (
                    <DeleteItemButton
                      action={deleteVideoReference.bind(null, school.slug, item.id)}
                      label={`Remove ${item.title}`}
                      confirmText="Remove this video?"
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
