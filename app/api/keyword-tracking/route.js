// E1: owner-only, server-side read of keyword_tracking. The browser no longer reads the
// table with the anon key. The service-role key lives only in server environment
// variables and is never sent to the client.
import { createClient } from '@supabase/supabase-js';
import { authorizeOwner } from '../../../lib/auth/owner.mjs';
import { verifySupabaseAccessToken } from '../../../lib/auth/supabase-verify.mjs';
import { parseRange } from '../../../lib/keywords/history-range.mjs';
import { HISTORY_ORDER } from '../../../lib/keywords/paginate.mjs';

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request) {
  const auth = await authorizeOwner({
    authorization: request.headers.get('authorization'),
    ownerEmail: process.env.DASHBOARD_OWNER_EMAIL,
    verifyAccessToken: verifySupabaseAccessToken,
  });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const range = parseRange(new URL(request.url).searchParams);
  if (!range.ok) return json({ error: range.error }, 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ error: 'read_not_configured' }, 503);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let query = supabase.from('keyword_tracking').select('*', { count: 'exact' });
  for (const column of HISTORY_ORDER) {
    query = query.order(column, { ascending: true });
  }
  const { data, error, count } = await query.range(range.from, range.to);
  if (error) return json({ error: 'read_failed' }, 500);

  return json({ data: data ?? [], count: Number.isInteger(count) ? count : null }, 200);
}
