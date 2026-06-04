import { createClient } from '@supabase/supabase-js';

function isValidUrl(s: string | undefined): boolean {
  if (!s) return false;
  try { new URL(s); return true; } catch { return false; }
}

const supabaseUrl = isValidUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  ? process.env.NEXT_PUBLIC_SUPABASE_URL!
  : 'https://placeholder.supabase.co';

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const isConfigured = isValidUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
