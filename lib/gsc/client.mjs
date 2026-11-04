// Read-only Search Console client. The transport is injectable: production uses the
// googleapis webmasters v3 client (loaded lazily); tests pass a fake transport and never
// reach the network.
import { GSC_SCOPE } from './constants.mjs';
import { mapGoogleError } from './errors.mjs';
import { buildTotals } from './summary.mjs';
import { validateDailyRows } from './sync-plan.mjs';

export async function defaultTransport({ credentials, siteUrl, body }) {
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [GSC_SCOPE] });
  const webmasters = google.webmasters({ version: 'v3', auth });
  const response = await webmasters.searchanalytics.query({ siteUrl, requestBody: body });
  return response.data;
}

// Totals for one property and one window. No dimensions, final data only.
export async function fetchTotals({ credentials, siteUrl, window, transport = defaultTransport }) {
  const body = { startDate: window.startDate, endDate: window.endDate, dataState: 'final' };

  let data;
  try {
    data = await transport({ credentials, siteUrl, body });
  } catch (error) {
    return { ok: false, code: mapGoogleError(error).code };
  }

  const built = buildTotals(data);
  if (!built.ok) return { ok: false, code: built.code };
  return { ok: true, ...built, startDate: window.startDate, endDate: window.endDate };
}

// GSC-02b: one block, one dataState, grouped by date. Only 'final' and 'all' are allowed.
// Errors are reduced to a code; the transport's own message is never forwarded.
export async function fetchDailyRows({ credentials, siteUrl, block, dataState, transport = defaultTransport }) {
  if (dataState !== 'final' && dataState !== 'all') return { ok: false, code: 'invalid_request' };
  const body = {
    startDate: block.startDate,
    endDate: block.endDate,
    dataState,
    dimensions: ['date'],
    rowLimit: 1000,
  };

  let data;
  try {
    data = await transport({ credentials, siteUrl, body });
  } catch (error) {
    return { ok: false, code: mapGoogleError(error).code };
  }

  // Google omits `rows` when a block has no data; any other non-object shape is invalid.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'invalid_response' };
  }
  const validated = validateDailyRows(data.rows ?? [], block);
  if (!validated.ok) return { ok: false, code: validated.code };

  return {
    ok: true,
    rows: validated.rows,
    firstIncompleteDate: data?.metadata?.first_incomplete_date ?? null,
  };
}
