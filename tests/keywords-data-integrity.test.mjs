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

test('catalog ignores JSON id: identity is the logical key', () => {
  const result = buildCatalog(CATALOG);
  assert.equal(result.ok, true);
  assert.equal(result.keywords[0].key, 'astisl.es|interpretación simultánea');
  assert.equal(Object.hasOwn(result.keywords[0], 'id'), false);
});

test('a measurement with a DB id (5) is not attributed to JSON id 1', () => {
  // Legacy rows carry keyword_id 5 and no keyword_key: they must not map to JSON id 1.
  const legacyRow = { keyword_id: 5, domain: 'astisl.es', position: 3, measured_at: '2026-10-01T06:00:00Z' };
  const model = buildDashboardModel({ catalogRaw: CATALOG, rows: [legacyRow], error: null });
  assert.equal(model.status, 'ok');
  assert.equal(model.counts.ranked, 0);
  assert.equal(model.counts.unverified, 2);
  assert.equal(model.averagePosition, null);
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

test('all rows with position 0 are unverified, never shown as ranked or "no ranking"', () => {
  const rows = [
    { keyword_key: 'astisl.es|interpretación simultánea', position: 0, measured_at: '2026-10-01T06:00:00Z' },
    { keyword_key: 'astisl.es|interpretación simultánea', position: 0, measured_at: '2026-10-02T06:00:00Z' },
  ];
  const model = buildDashboardModel({ catalogRaw: CATALOG, rows, error: null });
  const kw = model.keywords.find((k) => k.keyword === 'interpretación simultánea');
  assert.equal(kw.state, DISPLAY.UNVERIFIED);
  assert.equal(kw.position, null);
  assert.equal(model.counts.ranked, 0);
  assert.equal(model.averagePosition, null);
  assert.equal(model.lastMeasuredAt, null);
});

test('state ranked requires a positive integer position', () => {
  assert.equal(describeMeasurement({ state: 'ranked', position: 0 }).state, DISPLAY.UNVERIFIED);
  assert.equal(describeMeasurement({ state: 'ranked', position: 2.5 }).state, DISPLAY.UNVERIFIED);
  assert.equal(describeMeasurement({ state: 'ranked', position: 4 }).state, DISPLAY.RANKED);
});

test('not_found is shown as absent, not as position 0', () => {
  const state = describeMeasurement({ state: 'not_found', position: null, measured_at: '2026-10-01T06:00:00Z' });
  assert.equal(state.state, DISPLAY.NOT_FOUND);
  assert.equal(state.position, null);
});

test('latest observation per logical key wins, regardless of row order', () => {
  const rows = [
    { keyword_key: 'k|a', state: 'ranked', position: 7, measured_at: '2026-10-01T06:00:00Z' },
    { keyword_key: 'k|a', state: 'ranked', position: 3, measured_at: '2026-10-08T06:00:00Z' },
    { keyword_key: 'k|a', state: 'ranked', position: 9, measured_at: '2026-09-24T06:00:00Z' },
  ];
  assert.equal(latestByKey(rows).get('k|a').position, 3);
});

test('rows with invalid timestamps are ignored', () => {
  const rows = [{ keyword_key: 'k|a', state: 'ranked', position: 2, measured_at: 'no-fecha' }];
  assert.equal(latestByKey(rows).size, 0);
});

test('a read error is reported, not converted into zeros', () => {
  const model = buildDashboardModel({ catalogRaw: CATALOG, rows: null, error: new Error('boom') });
  assert.equal(model.status, 'measurements_error');
  assert.equal(model.averagePosition, null);
  assert.equal(model.keywords.length, 2);
  assert.ok(model.keywords.every((k) => k.state === DISPLAY.UNVERIFIED));
});

test('empty catalog is reported as empty', () => {
  const model = buildDashboardModel({ catalogRaw: [], rows: [], error: null });
  assert.equal(model.status, 'empty');
  assert.equal(model.keywords.length, 0);
});

test('invalid catalog is reported as catalog_error with no keywords', () => {
  const model = buildDashboardModel({ catalogRaw: null, rows: [], error: null });
  assert.equal(model.status, 'catalog_error');
  assert.equal(model.keywords.length, 0);
});

test('a new keyword added to the catalog appears without any code change', () => {
  const extended = [...CATALOG, { keyword: 'nueva keyword', domain: '3av.events', priority: 'P2', intent: 'x' }];
  const model = buildDashboardModel({ catalogRaw: extended, rows: [], error: null });
  assert.equal(model.counts.total, 3);
  assert.ok(model.keywords.some((k) => k.keyword === 'nueva keyword'));
});

test('verified positions feed counts and average only from verified rows', () => {
  const rows = [
    { keyword_key: 'astisl.es|interpretación simultánea', state: 'ranked', position: 4, measured_at: '2026-10-08T06:00:00Z' },
    { keyword_key: '3av.events|eventos corporativos', state: 'ranked', position: 12, measured_at: '2026-10-08T06:00:00Z' },
  ];
  const model = buildDashboardModel({ catalogRaw: CATALOG, rows, error: null });
  assert.equal(model.counts.ranked, 2);
  assert.equal(model.counts.top10, 1);
  assert.equal(model.averagePosition, 8);
  assert.equal(model.lastMeasuredAt, '2026-10-08T06:00:00Z');
});

test('normalizeKeyword and logicalKey are stable', () => {
  assert.equal(normalizeKeyword('  Hola   Mundo '), 'hola mundo');
  assert.equal(logicalKey('3av.events', 'Hola  Mundo'), '3av.events|hola mundo');
});
