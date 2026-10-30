// Complete, verifiable read of a paginated table. Pure: the caller injects `fetchPage`.
//
// Supabase's Data API can silently cap the rows it returns per request. A read is only
// accepted when the rows collected equal the exact total reported by the server. A
// partial read is never returned as if it were complete.

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 100;

// fetchPage(from, to) must resolve to { data, error, count } where `count` is the exact
// total of matching rows (e.g. Supabase `select('*', { count: 'exact' })`).
export async function readAllRows(fetchPage, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  if (typeof fetchPage !== 'function') {
    throw new TypeError('readAllRows: `fetchPage` must be a function');
  }

  const rows = [];
  let total = null;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let response;
    try {
      response = await fetchPage(from, to);
    } catch {
      return { ok: false, reason: 'read_failed', rows: [] };
    }
    if (!response || response.error) {
      return { ok: false, reason: 'read_failed', rows: [] };
    }

    if (total === null) {
      if (!Number.isInteger(response.count)) {
        return { ok: false, reason: 'count_unavailable', rows: [] };
      }
      total = response.count;
    }

    const data = Array.isArray(response.data) ? response.data : [];
    rows.push(...data);

    // A short page means the server has no more rows to give. Completeness is then
    // checked against the exact total, which catches silent server-side caps.
    if (data.length < pageSize) {
      if (rows.length !== total) {
        return { ok: false, reason: 'incomplete', rows: [], expected: total, received: rows.length };
      }
      return { ok: true, rows, total };
    }
  }

  return { ok: false, reason: 'max_pages_exceeded', rows: [] };
}
