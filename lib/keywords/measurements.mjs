// Measurement display model. Pure functions: no network, no Supabase, no Next.js.
//
// Rule: a position is shown only when a real, dated measurement says so (state "ranked"
// with an integer position >= 1, or state "not_found"). Anything else is UNVERIFIED.
// Legacy rows (position 0, no state) are never shown as "no ranking".
// Rows are attributed to a keyword only through their logical key (`keyword_key`).
// When the read itself failed or was incomplete, the model reports UNKNOWN and returns
// no counters: a missing number is never shown as a measured zero.
import { buildCatalog } from './contract.mjs';

export const DISPLAY = Object.freeze({
  RANKED: 'ranked',
  NOT_FOUND: 'not_found',
  UNVERIFIED: 'unverified',
  UNKNOWN: 'unknown',
});

function validTimestamp(value) {
  if (typeof value !== 'string' || value === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

// Classifies one stored row. Anything that is not a valid observation is UNVERIFIED.
export function describeMeasurement(row) {
  const at = validTimestamp(row?.measured_at);
  if (at !== null && row?.state === 'ranked' && Number.isInteger(row.position) && row.position >= 1) {
    return { state: DISPLAY.RANKED, position: row.position, measured_at: at };
  }
  if (at !== null && row?.state === 'not_found') {
    return { state: DISPLAY.NOT_FOUND, position: null, measured_at: at };
  }
  return { state: DISPLAY.UNVERIFIED, position: null, measured_at: null };
}

// Most recent VALID observation per logical key. Invalid or error rows are skipped before
// comparing dates, so a later broken row can never hide an earlier valid measurement.
export function latestByKey(rows) {
  const latest = new Map();
  if (!Array.isArray(rows)) return latest;

  for (const row of rows) {
    const key = typeof row?.keyword_key === 'string' ? row.keyword_key : null;
    if (!key) continue;

    const measurement = describeMeasurement(row);
    if (measurement.state === DISPLAY.UNVERIFIED) continue;

    const previous = latest.get(key);
    if (!previous || Date.parse(measurement.measured_at) > Date.parse(previous.measured_at)) {
      latest.set(key, measurement);
    }
  }
  return latest;
}

const UNVERIFIED_MEASUREMENT = Object.freeze({ state: DISPLAY.UNVERIFIED, position: null, measured_at: null });
const UNKNOWN_MEASUREMENT = Object.freeze({ state: DISPLAY.UNKNOWN, position: null, measured_at: null });

function unavailable(status, keywords = []) {
  return { status, keywords, counts: null, averagePosition: null, lastMeasuredAt: null };
}

// `read` is the result of readAllRows: { ok: true, rows } or { ok: false, reason }.
export function buildDashboardModel({ catalogRaw, read }) {
  const catalog = buildCatalog(catalogRaw);
  if (!catalog.ok) return unavailable('catalog_error');
  if (catalog.keywords.length === 0) return unavailable('empty');

  if (!read || read.ok !== true) {
    const status = read?.reason === 'incomplete' ? 'measurements_incomplete' : 'measurements_error';
    return unavailable(
      status,
      catalog.keywords.map((kw) => ({ ...kw, ...UNKNOWN_MEASUREMENT }))
    );
  }

  const latest = latestByKey(read.rows);
  const keywords = catalog.keywords.map((kw) => ({ ...kw, ...(latest.get(kw.key) ?? UNVERIFIED_MEASUREMENT) }));

  const counts = { total: keywords.length, ranked: 0, top10: 0, notFound: 0, unverified: 0 };
  let sum = 0;
  let lastMeasuredAt = null;
  for (const kw of keywords) {
    if (kw.state === DISPLAY.RANKED) {
      counts.ranked++;
      sum += kw.position;
      if (kw.position <= 10) counts.top10++;
    } else if (kw.state === DISPLAY.NOT_FOUND) {
      counts.notFound++;
    } else {
      counts.unverified++;
    }
    if (kw.measured_at && (!lastMeasuredAt || Date.parse(kw.measured_at) > Date.parse(lastMeasuredAt))) {
      lastMeasuredAt = kw.measured_at;
    }
  }
  // No verified positions yet: top-10 is "no data", not a measured zero.
  counts.top10 = counts.ranked > 0 ? counts.top10 : null;

  return {
    status: 'ok',
    keywords,
    counts,
    averagePosition: counts.ranked > 0 ? sum / counts.ranked : null,
    lastMeasuredAt,
  };
}
