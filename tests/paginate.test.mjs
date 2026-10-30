// Offline tests for the complete paginated read. Fake `fetchPage` only: no Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows } from '../lib/keywords/paginate.mjs';

// Simulates a table of `total` rows served in pages of at most `serverCap` rows per request.
function fakeTable(total, { serverCap = Infinity, count = total } = {}) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return async (from, to) => {
    const end = Math.min(to + 1, total, from + serverCap);
    return { data: all.slice(from, end), error: null, count };
  };
}

test('reads a table that fits in one page', async () => {
  const result = await readAllRows(fakeTable(3), { pageSize: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);
});

test('reads across several pages and keeps every row', async () => {
  const result = await readAllRows(fakeTable(7), { pageSize: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.rows.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7]);
});

test('exact page boundary (total is a multiple of the page size) is complete', async () => {
  const result = await readAllRows(fakeTable(6), { pageSize: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 6);
});

test('empty table is complete with zero rows', async () => {
  const result = await readAllRows(fakeTable(0), { pageSize: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
});

test('silent server-side cap is detected: fewer rows than the exact count is incomplete', async () => {
  // Server returns at most 4 rows per request while the table has 10, with page size 6.
  const result = await readAllRows(fakeTable(10, { serverCap: 4 }), { pageSize: 6 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
  assert.deepEqual(result.rows, []);
});

test('an error on a later page discards partial rows (no partial result accepted)', async () => {
  let calls = 0;
  const flaky = async (from, to) => {
    calls++;
    if (calls === 2) return { data: null, error: { message: 'boom' }, count: 10 };
    return { data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null, count: 10 };
  };
  const result = await readAllRows(flaky, { pageSize: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'read_failed');
  assert.deepEqual(result.rows, []);
});

test('a thrown error during fetch is reported as read_failed', async () => {
  const throwing = async () => {
    throw new Error('network');
  };
  const result = await readAllRows(throwing, { pageSize: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'read_failed');
});

test('missing exact count fails closed: completeness cannot be verified', async () => {
  const noCount = async () => ({ data: [{ id: 1 }], error: null, count: null });
  const result = await readAllRows(noCount, { pageSize: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'count_unavailable');
});

test('a runaway table is stopped at the page limit instead of looping forever', async () => {
  // Every page is full and the count keeps growing: must stop, not loop.
  const endless = async (from, to) => ({
    data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
    error: null,
    count: Number.MAX_SAFE_INTEGER,
  });
  const result = await readAllRows(endless, { pageSize: 2, maxPages: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'max_pages_exceeded');
  assert.deepEqual(result.rows, []);
});

test('requests use contiguous, non-overlapping ranges', async () => {
  const ranges = [];
  const spy = async (from, to) => {
    ranges.push([from, to]);
    return { data: Array.from({ length: Math.max(0, Math.min(to, 4) - from + 1) }, (_, i) => ({ id: from + i })), error: null, count: 5 };
  };
  await readAllRows(spy, { pageSize: 3 });
  assert.deepEqual(ranges, [[0, 2], [3, 5]]);
});

test('rejects a non-function fetchPage', async () => {
  await assert.rejects(() => readAllRows(null), TypeError);
});
