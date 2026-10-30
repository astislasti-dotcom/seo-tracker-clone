// Offline tests for the keyword catalog contract and the dashboard measurement model.
// No network, no Supabase, no SerpAPI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, logicalKey, normalizeKeyword } from '../lib/keywords/contract.mjs';
import {
  DISPLAY,
  buildDashboardModel,
  describeMeasurement,
  latestByKey,
} from '../lib/keywords/measurements.mjs';

const CATALOG = [
  { id: 1, keyword: 'interpretación simultánea', domain: 'astisl.es', priority: 'P1', intent: 'servicio' },
  { id: 2, keyword: 'eventos corporativos', domain: '3av.events', priority: 'P2', intent: 'servicio' },
];
const K_ASTI = 'astisl.es|interpretación simultánea';
const K_3AV = '3av.events|eventos corporativos';

const ok = (rows) => ({ ok: true, rows });
const failed = (reason) => ({ ok: false, reason });

// ---------- catalog contract ----------

test('catalog ignores JSON id: identity is the logical key', () => {
  const result = buildCatalog(CATALOG);
  assert.equal(result.ok, true);
  assert.equal(result.keywords[0].key, K_ASTI);
  assert.equal(Object.hasOwn(result.keywords[0], 'id'), false);
});

test('duplicates by logical key are rejected, case and spacing insensitive', () => {
  const dup = [
    ...CATALOG,
    { id: 9, keyword: '  Interpretación   SIMULTÁNEA ', domain: 'astisl.es', priority: 'P3', intent: 'x' },
  ];
  const result = buildCatalog(dup);
  assert.equal(result.ok, false);
  assert.deepEqual(result.keywords, []);
  assert.match(result.errors.join(' '), /duplicate_keyword/);
});

test('same keyword under different domains is not a duplicate', () => {
  const pair = [
    { keyword: 'congresos', domain: 'astisl.es', priority: 'P1', intent: 'x' },
    { keyword: 'congresos', domain: '3av.events', priority: 'P1', intent: 'x' },
  ];
  assert.equal(buildCatalog(pair).ok, true);
});

test('catalog errors never echo keyword text', () => {
  const bad = [{ keyword: 'secreto-no-mostrar', domain: 'evil.example', priority: 'P1', intent: 'x' }];
  const result = buildCatalog(bad);
  assert.equal(result.ok, false);
  assert.equal(result.errors.join(' ').includes('secreto-no-mostrar'), false);
});

test('invalid priority, domain or missing intent fail closed', () => {
  assert.equal(buildCatalog([{ keyword: 'a', domain: 'astisl.es', priority: 'P9', intent: 'x' }]).ok, false);
  assert.equal(buildCatalog([{ keyword: 'a', domain: 'otro.es', priority: 'P1', intent: 'x' }]).ok, false);
  assert.equal(buildCatalog([{ keyword: 'a', domain: 'astisl.es', priority: 'P1' }]).ok, false);
});

test('non-array catalog is rejected', () => {
  assert.deepEqual(buildCatalog(null).errors, ['catalog_not_array']);
});

test('normalizeKeyword and logicalKey are stable', () => {
  assert.equal(normalizeKeyword('  Hola   Mundo '), 'hola mundo');
  assert.equal(logicalKey('3av.events', 'Hola  Mundo'), '3av.events|hola mundo');
});

// ---------- single row classification ----------

test('a measurement with a DB id (5) is not attributed to JSON id 1', () => {
  const legacyRow = { keyword_id: 5, domain: 'astisl.es', position: 3, measured_at: '2026-10-01T06:00:00Z' };
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: ok([legacyRow]) });
  assert.equal(model.status, 'ok');
  assert.equal(model.counts.ranked, 0);
  assert.equal(model.counts.unverified, 2);
  assert.equal(model.averagePosition, null);
});

test('state ranked requires a positive integer position and a valid date', () => {
  const at = '2026-10-08T06:00:00Z';
  assert.equal(describeMeasurement({ state: 'ranked', position: 0, measured_at: at }).state, DISPLAY.UNVERIFIED);
  assert.equal(describeMeasurement({ state: 'ranked', position: 2.5, measured_at: at }).state, DISPLAY.UNVERIFIED);
  assert.equal(describeMeasurement({ state: 'ranked', position: 4, measured_at: at }).state, DISPLAY.RANKED);
  assert.equal(describeMeasurement({ state: 'ranked', position: 4 }).state, DISPLAY.UNVERIFIED);
});

test('not_found is shown as absent, not as position 0', () => {
  const state = describeMeasurement({ state: 'not_found', position: null, measured_at: '2026-10-01T06:00:00Z' });
  assert.equal(state.state, DISPLAY.NOT_FOUND);
  assert.equal(state.position, null);
});

test('all rows with position 0 are unverified and a historic all-zero history shows no top-10 zero', () => {
  const rows = [
    { keyword_key: K_ASTI, position: 0, measured_at: '2026-10-01T06:00:00Z' },
    { keyword_key: K_ASTI, position: 0, measured_at: '2026-10-02T06:00:00Z' },
  ];
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: ok(rows) });
  const kw = model.keywords.find((k) => k.keyword === 'interpretación simultánea');
  assert.equal(kw.state, DISPLAY.UNVERIFIED);
  assert.equal(kw.position, null);
  assert.equal(model.counts.ranked, 0);
  assert.equal(model.counts.top10, null);
  assert.equal(model.averagePosition, null);
  assert.equal(model.lastMeasuredAt, null);
});

// ---------- latest valid observation ----------

test('latest observation per logical key wins, regardless of row order', () => {
  const rows = [
    { keyword_key: 'k|a', state: 'ranked', position: 7, measured_at: '2026-10-01T06:00:00Z' },
    { keyword_key: 'k|a', state: 'ranked', position: 3, measured_at: '2026-10-08T06:00:00Z' },
    { keyword_key: 'k|a', state: 'ranked', position: 9, measured_at: '2026-09-24T06:00:00Z' },
  ];
  assert.equal(latestByKey(rows).get('k|a').position, 3);
});

test('a later error row never hides an earlier valid measurement (any row order)', () => {
  const valid = { keyword_key: K_ASTI, state: 'ranked', position: 4, measured_at: '2026-10-01T06:00:00Z' };
  const laterError = { keyword_key: K_ASTI, state: 'error', position: null, measured_at: '2026-10-08T06:00:00Z' };
  const laterInvalidPosition = { keyword_key: K_ASTI, state: 'ranked', position: 0, measured_at: '2026-10-09T06:00:00Z' };

  for (const rows of [
    [valid, laterError],
    [laterError, valid],
    [valid, laterInvalidPosition, laterError],
  ]) {
    const model = buildDashboardModel({ catalogRaw: CATALOG, read: ok(rows) });
    const kw = model.keywords.find((k) => k.keyword === 'interpretación simultánea');
    assert.equal(kw.state, DISPLAY.RANKED, 'valid measurement must survive');
    assert.equal(kw.position, 4);
    assert.equal(kw.measured_at, '2026-10-01T06:00:00Z');
    assert.equal(model.lastMeasuredAt, '2026-10-01T06:00:00Z');
  }
});

test('the displayed date is the real date of the old valid measurement', () => {
  const rows = [{ keyword_key: K_3AV, state: 'ranked', position: 12, measured_at: '2026-09-17T06:00:00Z' }];
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: ok(rows) });
  assert.equal(model.lastMeasuredAt, '2026-09-17T06:00:00Z');
});

test('rows with invalid timestamps are ignored', () => {
  const rows = [{ keyword_key: 'k|a', state: 'ranked', position: 2, measured_at: 'no-fecha' }];
  assert.equal(latestByKey(rows).size, 0);
});

// ---------- read failures ----------

test('a failed read reports an error with no counters, never measured zeros', () => {
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: failed('read_failed') });
  assert.equal(model.status, 'measurements_error');
  assert.equal(model.counts, null);
  assert.equal(model.averagePosition, null);
  assert.equal(model.lastMeasuredAt, null);
  assert.equal(model.keywords.length, 2);
  assert.ok(model.keywords.every((k) => k.state === DISPLAY.UNKNOWN));
});

test('an incomplete read is reported as incomplete with no counters', () => {
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: failed('incomplete') });
  assert.equal(model.status, 'measurements_incomplete');
  assert.equal(model.counts, null);
  assert.equal(model.averagePosition, null);
});

test('a missing read result is treated as a failure, not as an empty history', () => {
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: undefined });
  assert.equal(model.status, 'measurements_error');
  assert.equal(model.counts, null);
});

test('empty catalog is reported as empty', () => {
  const model = buildDashboardModel({ catalogRaw: [], read: ok([]) });
  assert.equal(model.status, 'empty');
  assert.equal(model.keywords.length, 0);
  assert.equal(model.counts, null);
});

test('invalid catalog is reported as catalog_error with no keywords', () => {
  const model = buildDashboardModel({ catalogRaw: null, read: ok([]) });
  assert.equal(model.status, 'catalog_error');
  assert.equal(model.keywords.length, 0);
  assert.equal(model.counts, null);
});

// ---------- aggregates ----------

test('a new keyword added to the catalog appears without any code change', () => {
  const extended = [...CATALOG, { keyword: 'nueva keyword', domain: '3av.events', priority: 'P2', intent: 'x' }];
  const model = buildDashboardModel({ catalogRaw: extended, read: ok([]) });
  assert.equal(model.counts.total, 3);
  assert.ok(model.keywords.some((k) => k.keyword === 'nueva keyword'));
});

test('verified positions feed counts and average only from verified rows', () => {
  const rows = [
    { keyword_key: K_ASTI, state: 'ranked', position: 4, measured_at: '2026-10-08T06:00:00Z' },
    { keyword_key: K_3AV, state: 'ranked', position: 12, measured_at: '2026-10-08T06:00:00Z' },
  ];
  const model = buildDashboardModel({ catalogRaw: CATALOG, read: ok(rows) });
  assert.equal(model.counts.ranked, 2);
  assert.equal(model.counts.top10, 1);
  assert.equal(model.averagePosition, 8);
  assert.equal(model.lastMeasuredAt, '2026-10-08T06:00:00Z');
});
