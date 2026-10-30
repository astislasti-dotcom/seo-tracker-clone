import { timingSafeEqual } from 'node:crypto';

// Phase 003A: infrastructure check only. This route never runs keyword tracking,
// never calls external APIs (SerpAPI, Google, GSC, Playwright) and never touches Supabase.
// Reading request headers makes this handler dynamic under cacheComponents.

function json(body, status) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// Constant-time comparison of the full expected header value.
function isAuthorized(receivedHeader, secret) {
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const received = Buffer.from(receivedHeader ?? '', 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;

  // Fail closed: without a configured secret nothing is authorized.
  // The secret value is never echoed back in any response.
  if (!secret || secret.trim() === '') {
    return json({ error: 'cron_not_configured' }, 503);
  }

  if (!isAuthorized(request.headers.get('authorization'), secret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  return json(
    {
      status: 'disabled',
      tracking_executed: false,
      message: 'Route infrastructure check only. No keyword tracking runs in phase 003A.',
      checked_at: new Date().toISOString(),
    },
    200
  );
}
