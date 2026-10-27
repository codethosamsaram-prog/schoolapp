import type { Metadata } from 'next';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { audienceLabel, getSchoolClasses } from '@/lib/classes';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteItemButton } from '@/components/delete-item-button';
import { deleteAnnouncement } from '../content-actions';
import { AnnouncementForm } from './_components/announcement-form';

export const metadata: Metadata = { title: 'Announcements' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

export default async function AnnouncementsPage({ params }: PageProps) {
  const { school, userId, profile } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  const supabase = createClient();
  const [classes, { data, error }] = await Promise.all([
    getSchoolClasses(supabase, school.id),
    supabase
      .from('announcements')
      .select('*')
      .eq('school_id', school.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (error) console.error('[announcements] list failed', { error: error.message });
  const isAdmin = profile.role !== 'TEACHER';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Broadcast an announcement</CardTitle>
          <p className="text-sm text-muted-foreground">
            It appears at the top of the portal for the students and parents you choose.
          </p>
        </CardHeader>
        <CardContent>
          <AnnouncementForm
            schoolSlug={school.slug}
            grades={classes.grades}
            sectionsByGrade={classes.sectionsByGrade}
          />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="posted-heading">
        <h2 id="posted-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Posted
        </h2>
        {(data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing posted yet.
            </CardContent>
          </Card>
        ) : (
          (data ?? []).map((item) => (
            <Card key={item.id}>
              <CardContent className="flex gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{item.title}</p>
                    <Badge variant="secondary">{audienceLabel(item.target_grade, item.target_section)}</Badge>
                  </div>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{item.content}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(item.created_at)}</p>
                </div>
                {isAdmin || item.created_by === userId ? (
                  <DeleteItemButton
                    action={deleteAnnouncement.bind(null, school.slug, item.id)}
                    label={`Remove ${item.title}`}
                    confirmText="Remove this announcement for everyone?"
                  />
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
