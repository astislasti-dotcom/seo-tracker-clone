// Totals from a request WITHOUT dimensions: Google returns one combined row. Rows are
// never summed here. Average position is Search Console's average, not a SERP ranking.

export function buildTotals(response) {
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  if (rows.length > 1) return { ok: false, code: 'invalid_response' };

  const row = rows[0];
  if (!row) {
    return {
      ok: true,
      noData: true,
      totals: { clicks: 0, impressions: 0, ctr: null, averagePosition: null },
    };
  }

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
