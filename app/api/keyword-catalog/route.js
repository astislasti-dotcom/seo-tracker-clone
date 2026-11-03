// E1: the keyword catalog is no longer public. It is served only to the verified owner.
// The file lives in data/ (not public/), so Next.js never serves it as a static asset.
import catalog from '../../../data/keywords.json' with { type: 'json' };
import { authorizeOwner } from '../../../lib/auth/owner.mjs';
import { verifySupabaseAccessToken } from '../../../lib/auth/supabase-verify.mjs';

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

  return json(catalog, 200);
}
