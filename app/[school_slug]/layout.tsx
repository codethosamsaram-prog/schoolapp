import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSchoolBySlug } from '@/lib/auth';
import { tenantThemeCss } from '@/lib/theme';

interface TenantLayoutProps {
  children: React.ReactNode;
  params: { school_slug: string };
}

export async function generateMetadata({ params }: TenantLayoutProps): Promise<Metadata> {
  const school = await getSchoolBySlug(params.school_slug);
  if (!school) return { title: 'School not found' };

  const description =
    school.tagline ??
    `Admissions, fees and academic information for ${school.name}${school.city ? `, ${school.city}` : ''}.`;

  return {
    title: { default: school.name, template: `%s | ${school.name}` },
    description,
    openGraph: {
      title: school.name,
      description,
      type: 'website',
      images: school.hero_image_url ? [{ url: school.hero_image_url }] : undefined,
    },
    icons: school.logo_url ? { icon: school.logo_url } : undefined,
  };
}

/**
 * Tenant shell. Resolving the school here means every nested route can assume
 * the slug is valid, and the brand colour is bound once for the whole subtree.
 */
export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const school = await getSchoolBySlug(params.school_slug);
  if (!school) notFound();

  const scopeClass = `tenant-${school.id.slice(0, 8)}`;

  return (
    <div className={scopeClass}>
      <style
        // Scoped to this tenant's subtree; values come from a validated hex column.
        dangerouslySetInnerHTML={{ __html: tenantThemeCss(school.primary_color, scopeClass) }}
      />
      {children}
    </div>
  );
}
