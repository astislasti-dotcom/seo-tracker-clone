// Totals from a request WITHOUT dimensions: Google returns one combined row. Rows are
// never summed here. Average position is Search Console's average, not a SERP ranking.
//
// "No data" is accepted only for a plain object whose shape Google documents for an empty
// result: no `rows`, or `rows: []`, plus at most the metadata fields. Anything else
// (null, arrays, strings, a `rows` that is not an array, unknown fields) is an invalid
// response, never a silent zero.

const NO_DATA_KEYS = new Set(['responseAggregationType', 'metadata']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function buildTotals(response) {
  if (!isPlainObject(response)) return { ok: false, code: 'invalid_response' };

  const hasRows = Object.prototype.hasOwnProperty.call(response, 'rows');
  if (hasRows && !Array.isArray(response.rows)) return { ok: false, code: 'invalid_response' };

  if (!hasRows || response.rows.length === 0) {
    const unknown = Object.keys(response).some((key) => !NO_DATA_KEYS.has(key) && key !== 'rows');
    if (unknown) return { ok: false, code: 'invalid_response' };
    return {
      ok: true,
      noData: true,
      totals: { clicks: 0, impressions: 0, ctr: null, averagePosition: null },
      firstIncompleteDate: response?.metadata?.first_incomplete_date ?? null,
    };
  }

  if (response.rows.length > 1) return { ok: false, code: 'invalid_response' };

  const row = response.rows[0];
  if (!isPlainObject(row)) return { ok: false, code: 'invalid_response' };

  const clicks = Number(row.clicks);
  const impressions = Number(row.impressions);
  const position = Number(row.position);
  if (![clicks, impressions, position].every(Number.isFinite)) return { ok: false, code: 'invalid_response' };

  return {
    ok: true,
    noData: false,
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      averagePosition: impressions > 0 ? position : null,
    },
    firstIncompleteDate: response?.metadata?.first_incomplete_date ?? null,
  };
}
