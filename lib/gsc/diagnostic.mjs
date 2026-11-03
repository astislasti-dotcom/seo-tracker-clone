// Temporary diagnostic helpers for /gsc-test. Pure, no network, no storage.
// The page exists only in Vercel Preview deployments; see diagnosticEnabled().

export const DIAG_BRANDS = Object.freeze([
  Object.freeze({ domain: 'astisl.es', label: 'ASTI' }),
  Object.freeze({ domain: '3av.events', label: '3AV' }),
]);

export const DIAG_PERIODS = Object.freeze([7, 28, 90]);

// Only the Preview environment of Vercel enables the page. Production, development and
// unset values keep it hidden (404).
export function diagnosticEnabled(env) {
  return env?.VERCEL_ENV === 'preview';
}

// Builds the API path. The token never goes here: it is sent in the Authorization header.
export function buildSummaryPath({ brand, period }) {
  const known = DIAG_BRANDS.some((b) => b.domain === brand);
  const days = Number(period);
  if (!known || !DIAG_PERIODS.includes(days)) return null;
  const query = new URLSearchParams({ brand, period: String(days) });
  return `/api/gsc/summary?${query.toString()}`;
}

export function describeSuccess(body) {
  return {
    brand: typeof body?.brand === 'string' ? body.brand : '',
    period: body?.period ?? null,
    startDate: body?.startDate ?? null,
    endDate: body?.endDate ?? null,
    fetchedAt: body?.fetchedAt ?? null,
    noData: body?.noData === true,
    clicks: body?.totals?.clicks ?? null,
    impressions: body?.totals?.impressions ?? null,
    ctr: body?.totals?.ctr ?? null,
    averagePosition: body?.totals?.averagePosition ?? null,
    positionLabel: body?.positionLabel ?? '',
  };
}

// Shows only the fixed message for a known code; anything else gets a generic line.
// The server's raw text is never rendered.
export const DIAG_GENERIC_ERROR = 'Error no identificado al consultar Search Console.';

// Decision used by proxy.js. Pure, so it can be tested without the Next runtime.
export function proxyDecision(env) {
  return diagnosticEnabled(env) ? 'allow' : 'deny';
}
