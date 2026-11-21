import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const RECEIPTS_BUCKET = 'receipts';

/** El "ref" del proyecto (https://<ref>.supabase.co), para abrir su SQL Editor. */
export const supabaseProjectRef = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
