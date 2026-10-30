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

  // Hard gate: only the exact string "true" enables anything. Anything else (unset,
  // "TRUE", "1", "false", "") keeps the route disabled. No SerpAPI or Supabase code
  // is imported or instantiated on this path.
  if (process.env.TRACKING_ENABLED !== 'true') {
    return json(
      {
        status: 'disabled',
        tracking_executed: false,
        message: 'Weekly SERP tracking is disabled.',
        checked_at: new Date().toISOString(),
      },
      200
    );
  }

  // Enabled but no verified persistence adapter exists yet (issue #6, phase 003B2).
  // Nothing is measured or written. Failing loudly is preferred to a silent no-op.
  return json(
    {
      status: 'blocked',
      reason: 'persistence_not_verified',
      tracking_executed: false,
      checked_at: new Date().toISOString(),
    },
    503
  );
}
