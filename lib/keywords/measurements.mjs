// Measurement display model. Pure functions: no network, no Supabase, no Next.js.
//
// Rule: a position is shown only when a real measurement says so (state "ranked" with an
// integer position >= 1). Legacy rows (position 0, no state) are UNVERIFIED, never shown
// as "no ranking". A row can only be attributed to a keyword through its logical key
// (`keyword_key`); rows without one cannot be attributed and are ignored.
import { buildCatalog } from './contract.mjs';

export const DISPLAY = Object.freeze({
  RANKED: 'ranked',
  NOT_FOUND: 'not_found',
  UNVERIFIED: 'unverified',
});

// Keeps the most recent measurement per logical key. Invalid timestamps are ignored.
export function latestByKey(rows) {
  const latest = new Map();
  if (!Array.isArray(rows)) return latest;

  for (const row of rows) {
    const key = typeof row?.keyword_key === 'string' ? row.keyword_key : null;
    if (!key) continue;
    const at = Date.parse(row.measured_at);
    if (Number.isNaN(at)) continue;

    const previous = latest.get(key);
    if (!previous || at > Date.parse(previous.measured_at)) {
      latest.set(key, row);
    }
  }
  return latest;
}

export function describeMeasurement(row) {
  if (row?.state === 'ranked' && Number.isInteger(row.position) && row.position >= 1) {
    return { state: DISPLAY.RANKED, position: row.position, measured_at: row.measured_at };
  }
  if (row?.state === 'not_found') {
    return { state: DISPLAY.NOT_FOUND, position: null, measured_at: row.measured_at };
  }
  return { state: DISPLAY.UNVERIFIED, position: null, measured_at: null };
}

// Builds the dashboard model. Never fabricates values: missing or unattributable data
// stays UNVERIFIED, and a failed read is reported as such instead of as zeros.
export function buildDashboardModel({ catalogRaw, rows, error }) {
  const catalog = buildCatalog(catalogRaw);
  if (!catalog.ok) {
    return { status: 'catalog_error', keywords: [], counts: emptyCounts(), averagePosition: null, lastMeasuredAt: null };
  }
  if (catalog.keywords.length === 0) {
    return { status: 'empty', keywords: [], counts: emptyCounts(), averagePosition: null, lastMeasuredAt: null };
  }
  if (error) {
    return {
      status: 'measurements_error',
      keywords: catalog.keywords.map((kw) => ({ ...kw, ...describeMeasurement(null) })),
      counts: { ...emptyCounts(), total: catalog.keywords.length },
      averagePosition: null,
      lastMeasuredAt: null,
    };
  }

  const latest = latestByKey(rows);
  const keywords = catalog.keywords.map((kw) => ({ ...kw, ...describeMeasurement(latest.get(kw.key)) }));

  const counts = emptyCounts();
  counts.total = keywords.length;
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

  return {
    status: 'ok',
    keywords,
    counts,
    averagePosition: counts.ranked > 0 ? sum / counts.ranked : null,
    lastMeasuredAt,
  };
}

function emptyCounts() {
  return { total: 0, ranked: 0, top10: 0, notFound: 0, unverified: 0 };
}
