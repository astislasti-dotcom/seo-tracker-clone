// Owner-only summary handler. Every dependency is injected, so the whole flow can be
// tested offline. Order: owner gate → parameters → configuration → credentials → Google.
import { authorizeOwner } from '../auth/owner.mjs';
import { fetchTotals } from './client.mjs';
import { resolveProperty } from './config.mjs';
import { parseServiceAccount } from './credentials.mjs';
import { gscErrorMessage } from './errors.mjs';
import { parsePeriod, periodWindow } from './periods.mjs';

const POSITION_LABEL = 'posición media de Search Console (no es una posición en los resultados de Google)';

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorBody(code) {
  return { error: code, message: gscErrorMessage(code) };
}

const STATUS_BY_CODE = Object.freeze({
  invalid_brand: 400,
  property_not_configured: 503,
  credentials_missing: 503,
  credentials_invalid: 503,
  permission_denied: 403,
  property_not_found: 404,
  quota_exceeded: 429,
  unavailable: 503,
  invalid_response: 502,
  unknown: 502,
});

export async function handleSummary(request, deps) {
  const auth = await authorizeOwner({
    authorization: request.headers.get('authorization'),
    ownerEmail: deps.ownerEmail,
    verifyAccessToken: deps.verifyAccessToken,
  });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const params = new URL(request.url).searchParams;
  const period = parsePeriod(params.get('period'));
  if (!period) return json({ error: 'invalid_period' }, 400);

  const property = resolveProperty(deps.config, params.get('brand'));
  if (!property.ok) return json(errorBody(property.code), STATUS_BY_CODE[property.code]);

  const credentials = parseServiceAccount(deps.rawCredentials);
  if (!credentials.ok) return json(errorBody(credentials.code), STATUS_BY_CODE[credentials.code]);

  const now = deps.now ? deps.now() : new Date();
  const window = periodWindow(period, now);
  const result = await fetchTotals({
    credentials: credentials.credentials,
    siteUrl: property.siteUrl,
    window,
    transport: deps.transport,
  });
  if (!result.ok) return json(errorBody(result.code), STATUS_BY_CODE[result.code] ?? 502);

  return json(
    {
      source: 'google_search_console',
      brand: property.brand,
      period,
      startDate: result.startDate,
      endDate: result.endDate,
      firstIncompleteDate: result.firstIncompleteDate,
      noData: result.noData,
      totals: result.totals,
      positionLabel: POSITION_LABEL,
      fetchedAt: now.toISOString(),
    },
    200
  );
}
