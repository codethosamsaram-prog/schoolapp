import 'server-only';

import { cache } from 'react';
import { createAnonClient } from '@/lib/supabase/server';
import type { SchoolOption } from '@/components/school-combobox';

/** Active schools for the public pickers, through the anon RLS view. */
export const listActiveSchools = cache(async (): Promise<SchoolOption[]> => {
  const { data, error } = await createAnonClient()
    .from('schools')
    .select('id, name, slug, city, board')
    .eq('is_active', true)
    .order('name')
    .limit(1000);

  if (error) {
    console.error('[schools] list failed', { error: error.message });
    return [];
  }
  return data ?? [];
});
