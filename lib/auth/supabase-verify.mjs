// Verifies a Supabase Auth access token on the server. Uses only the public URL and
// anon key; the token itself is the credential. Never logs the token.
import { createClient } from '@supabase/supabase-js';

export async function verifySupabaseAccessToken(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { email: data.user.email ?? '' };
}
