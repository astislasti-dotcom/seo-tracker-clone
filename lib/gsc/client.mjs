// Read-only Search Console client. The transport is injectable: production uses the
// googleapis webmasters v3 client (loaded lazily); tests pass a fake transport and never
// reach the network.
import { GSC_SCOPE } from './constants.mjs';
import { mapGoogleError } from './errors.mjs';
import { buildTotals } from './summary.mjs';

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
