// GSC-03 · pruebas offline de la API de lectura. Sin red, sin Google, sin Supabase real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { metricsWindow, parseMetricsParams, buildSeries, aggregateRows, coverageOf, buildPropertyBlock, buildCombinedBlock } from '../lib/gsc/metrics.mjs';
import { handleMetrics } from '../lib/gsc/metrics-handler.mjs';
import { createMetricsRepo, MetricsStorageError } from '../lib/gsc/metrics-store.mjs';

const NOW = new Date('2026-11-04T12:00:00Z');
const OWNER = 'owner@example.test';
const CONFIG = {
  'astisl.es': { brand: 'ASTI', siteUrl: 'sc-domain:astisl.es' },
  '3av.events': { brand: '3AV', siteUrl: 'https://3av.events/' },
};
const SERVICE_KEY_FIXTURE = 'fixture-service-role-value-do-not-leak';
const DAY = 86_400_000;
const dayOffset = (n) => new Date(Date.UTC(2026, 10, 4) + n * DAY).toISOString().slice(0, 10);
const row = (domain, date, extra = {}) => ({
  property_domain: domain,
  metric_date: date,
  clicks: 2,
  impressions: 20,
  ctr: 0.1,
  avg_position: 5,
  data_state: 'final',
  fetched_at: '2026-11-04T10:00:00+00:00',
  ...extra,
});

// Fake repo: returns the rows of the requested domains and date range, and records the call.
function fakeRepo(rows, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async readDaily(domains, startDate, endDate) {
      calls.push({ domains, startDate, endDate });
      if (fail) throw new MetricsStorageError();
      return rows.filter((r) => domains.includes(r.property_domain) && r.metric_date >= startDate && r.metric_date <= endDate);
    },
  };
}
const verifyAs = (email) => async () => ({ email });
const get = (query = '', authorization = 'Bearer fixture-token') =>
  new Request(`http://localhost/api/gsc/metrics${query}`, { method: 'GET', headers: authorization ? { authorization } : {} });
const deps = (overrides = {}) => ({
  config: CONFIG,
  ownerEmail: OWNER,
  verifyAccessToken: verifyAs(OWNER),
  supabaseUrl: 'https://fixture-project.supabase.co',
  serviceKey: SERVICE_KEY_FIXTURE,
  createRepo: () => fakeRepo([]),
  now: () => NOW,
  ...overrides,
});

// ---------- parámetros y ventana ----------

test('parseMetricsParams: brand required, period 7/28/90 with 28 as default', () => {
  assert.deepEqual(parseMetricsParams(new URLSearchParams('brand=astisl.es')), { ok: true, brand: 'astisl.es', period: 28 });
  assert.deepEqual(parseMetricsParams(new URLSearchParams('brand=all&period=90')), { ok: true, brand: 'all', period: 90 });
  assert.deepEqual(parseMetricsParams(new URLSearchParams('brand=3av.events&period=7')), { ok: true, brand: '3av.events', period: 7 });
  assert.equal(parseMetricsParams(new URLSearchParams('')).code, 'invalid_brand');
  assert.equal(parseMetricsParams(new URLSearchParams('brand=evil.example')).code, 'invalid_brand');
  assert.equal(parseMetricsParams(new URLSearchParams('brand=all&period=30')).code, 'invalid_period');
  assert.equal(parseMetricsParams(new URLSearchParams('brand=all&period=28.0')).code, 'invalid_period');
});

test('metricsWindow ends today in UTC and has exactly the requested length', () => {
  assert.deepEqual(metricsWindow(7, NOW), { startDate: '2026-10-29', endDate: '2026-11-04', days: 7 });
  assert.deepEqual(metricsWindow(90, NOW).startDate, '2026-08-07');
});

// ---------- serie: días ausentes no son ceros ----------

test('buildSeries: every day of the window appears ascending; missing days are null, never zero', () => {
  const window = metricsWindow(7, NOW);
  const series = buildSeries([row('astisl.es', '2026-11-02', { clicks: 4, impressions: 40 })], window);
  assert.equal(series.length, 7);
  assert.deepEqual(series.map((d) => d.date), [...series.map((d) => d.date)].sort());
  const present = series.find((d) => d.date === '2026-11-02');
  assert.equal(present.hasRow, true);
  assert.equal(present.clicks, 4);
  const missing = series.find((d) => d.date === '2026-11-03');
  assert.deepEqual([missing.hasRow, missing.clicks, missing.impressions, missing.ctr, missing.avgPosition], [false, null, null, null, null]);
});

test('buildSeries: a day with zero impressions has ctr null (no division by zero)', () => {
  const series = buildSeries([row('astisl.es', '2026-11-04', { clicks: 0, impressions: 0, avg_position: null })], metricsWindow(7, NOW));
  const day = series.at(-1);
  assert.equal(day.hasRow, true);
  assert.equal(day.ctr, null);
  assert.equal(day.clicks, 0);
});

// ---------- agregados ----------

test('aggregateRows: CTR is sum(clicks)/sum(impressions), not an average of daily CTRs', () => {
  const rows = [
    row('astisl.es', '2026-11-01', { clicks: 1, impressions: 10, ctr: 0.1 }),
    row('astisl.es', '2026-11-02', { clicks: 9, impressions: 30, ctr: 0.3 }),
  ];
  const totals = aggregateRows(rows);
  assert.equal(totals.clicks, 10);
  assert.equal(totals.impressions, 40);
  assert.equal(totals.ctr, 0.25);
});

test('aggregateRows: position is weighted by impressions and ignores days without impressions', () => {
  const rows = [
    row('astisl.es', '2026-11-01', { impressions: 10, avg_position: 2 }),
    row('astisl.es', '2026-11-02', { impressions: 30, avg_position: 6 }),
    row('astisl.es', '2026-11-03', { impressions: 0, clicks: 0, avg_position: 50 }),
  ];
  assert.equal(aggregateRows(rows).averagePosition, 5);
});

test('aggregateRows: no rows → totals null, never zero', () => {
  assert.deepEqual(aggregateRows([]), { clicks: null, impressions: null, ctr: null, averagePosition: null });
});

test('aggregateRows: rows without impressions give null position and null ctr', () => {
  const totals = aggregateRows([row('astisl.es', '2026-11-01', { clicks: 0, impressions: 0, ctr: null, avg_position: null })]);
  assert.equal(totals.ctr, null);
  assert.equal(totals.averagePosition, null);
});

test('buildCombinedBlock: combined has sums and weighted CTR but never a combined position', () => {
  const combined = buildCombinedBlock([
    row('astisl.es', '2026-11-01', { clicks: 2, impressions: 20, avg_position: 3 }),
    row('3av.events', '2026-11-01', { clicks: 6, impressions: 60, avg_position: 40 }),
  ]);
  assert.equal(combined.totals.clicks, 8);
  assert.equal(combined.totals.ctr, 0.1);
  assert.equal(combined.totals.averagePosition, null);
});

// ---------- cobertura y provisionalidad ----------

test('coverageOf counts requested, rows, final, provisional and missing days', () => {
  const window = metricsWindow(7, NOW);
  const rows = [
    row('astisl.es', '2026-11-01'),
    row('astisl.es', '2026-11-02', { data_state: 'provisional' }),
    row('astisl.es', '2026-11-03'),
  ];
  assert.deepEqual(coverageOf(rows, window), { requestedDays: 7, daysWithRows: 3, finalDays: 2, provisionalDays: 1, missingDays: 4 });
});

test('buildPropertyBlock flags provisional data', () => {
  const block = buildPropertyBlock({ domain: 'astisl.es', brand: 'ASTI', rows: [row('astisl.es', '2026-11-04', { data_state: 'provisional' })], window: metricsWindow(7, NOW) });
  assert.equal(block.containsProvisional, true);
  assert.match(block.positionNote, /No es una posición/);
});

// ---------- manejador HTTP ----------

test('handleMetrics: only GET is accepted', async () => {
  const res = await handleMetrics(new Request('http://localhost/api/gsc/metrics?brand=all', { method: 'POST', headers: { authorization: 'Bearer x' } }), deps());
  assert.equal(res.status, 405);
});

test('handleMetrics: no token → 401, wrong user → 403, owner not configured → 503', async () => {
  assert.equal((await handleMetrics(get('?brand=all', null), deps())).status, 401);
  assert.equal((await handleMetrics(get('?brand=all'), deps({ verifyAccessToken: verifyAs('other@example.test') }))).status, 403);
  assert.equal((await handleMetrics(get('?brand=all'), deps({ ownerEmail: undefined }))).status, 503);
});

test('handleMetrics: invalid brand or period → 400 without any read', async () => {
  const repo = fakeRepo([]);
  const d = deps({ createRepo: () => repo });
  assert.equal((await handleMetrics(get('?brand=evil.example'), d)).status, 400);
  const res = await handleMetrics(get('?brand=all&period=30'), d);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_period');
  assert.equal(repo.calls.length, 0);
});

test('handleMetrics: missing service key → 503 before any read', async () => {
  const res = await handleMetrics(get('?brand=all'), deps({ serviceKey: undefined, createRepo: () => { throw new Error('must not create repo'); } }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'service_role_missing');
});

test('handleMetrics: returns series, totals, coverage and provisionality for both properties', async () => {
  const rows = [
    row('astisl.es', dayOffset(-2)),
    row('astisl.es', dayOffset(0), { data_state: 'provisional', clicks: 3, impressions: 30 }),
    row('3av.events', dayOffset(-1), { clicks: 5, impressions: 50 }),
  ];
  const repo = fakeRepo(rows);
  const res = await handleMetrics(get('?brand=all&period=7'), deps({ createRepo: () => repo }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.period, 7);
  assert.equal(body.properties.length, 2);
  const asti = body.properties.find((p) => p.domain === 'astisl.es');
  assert.equal(asti.coverage.daysWithRows, 2);
  assert.equal(asti.coverage.provisionalDays, 1);
  assert.equal(asti.containsProvisional, true);
  assert.equal(asti.series.length, 7);
  assert.equal(body.combined.totals.clicks, 10);
  assert.equal(body.combined.totals.averagePosition, null);
  assert.equal(body.lastMetricsFetchedAt, '2026-11-04T10:00:00+00:00');
  assert.deepEqual(repo.calls[0].domains.sort(), ['3av.events', 'astisl.es']);
});

test('handleMetrics: a single brand reads only that property and has no combined block', async () => {
  const repo = fakeRepo([row('3av.events', dayOffset(0))]);
  const body = await (await handleMetrics(get('?brand=3av.events&period=7'), deps({ createRepo: () => repo }))).json();
  assert.deepEqual(repo.calls[0].domains, ['3av.events']);
  assert.equal(body.properties.length, 1);
  assert.equal(body.combined, undefined);
});

test('handleMetrics: no data → coverage zero and totals null, not zeros', async () => {
  const body = await (await handleMetrics(get('?brand=astisl.es&period=28'), deps({ createRepo: () => fakeRepo([]) }))).json();
  const block = body.properties[0];
  assert.equal(block.coverage.daysWithRows, 0);
  assert.equal(block.coverage.missingDays, 28);
  assert.equal(block.totals.clicks, null);
  assert.equal(body.lastMetricsFetchedAt, null);
});

test('handleMetrics: storage error → 502 with a code and no raw message', async () => {
  const res = await handleMetrics(get('?brand=all'), deps({ createRepo: () => fakeRepo([], { fail: true }) }));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.match(text, /storage_error/);
  assert.ok(!text.includes(SERVICE_KEY_FIXTURE));
});

test('handleMetrics: error messages describe reading, not saving or syncing', async () => {
  const storage = await (await handleMetrics(get('?brand=all'), deps({ createRepo: () => fakeRepo([], { fail: true }) }))).json();
  assert.equal(storage.message, 'No se pudieron leer las métricas almacenadas. Inténtalo de nuevo más tarde.');
  assert.doesNotMatch(storage.message, /guardar|sincroniz|Search Console/i);

  const missing = await (await handleMetrics(get('?brand=all'), deps({ serviceKey: undefined }))).json();
  assert.equal(missing.message, 'La clave de servidor de Supabase no está configurada; no se pueden leer las métricas.');
  assert.doesNotMatch(missing.message, /sincroniz/i);

  const corrupt = Array.from({ length: 8 }, () => row('astisl.es', dayOffset(0)));
  const invalid = await (await handleMetrics(get('?brand=astisl.es&period=7'), deps({ createRepo: () => fakeRepo(corrupt) }))).json();
  assert.equal(invalid.message, 'Los datos almacenados no tienen el formato esperado. No se muestran.');
});

test('errors.mjs keeps the sync messages unchanged for the GSC-02b endpoint', async () => {
  const { gscErrorMessage } = await import('../lib/gsc/errors.mjs');
  assert.match(gscErrorMessage('storage_error'), /Supabase\. Repite la sincronización/);
  assert.match(gscErrorMessage('service_role_missing'), /la sincronización no se ha ejecutado/);
  assert.match(gscErrorMessage('invalid_response'), /respuesta de Search Console/);
});

test('handleMetrics: more rows than properties × days → invalid_response (corrupt data is not shown)', async () => {
  const rows = [row('astisl.es', dayOffset(0)), row('astisl.es', dayOffset(-1)), row('astisl.es', dayOffset(-2))];
  const res = await handleMetrics(get('?brand=astisl.es&period=7'), deps({ createRepo: () => fakeRepo(rows) }));
  assert.equal(res.status, 200, 'three rows fit in seven days, so this is valid');
  // Ocho filas para el mismo día: imposible con la clave primaria; debe rechazarse, no mostrarse.
  const tooMany = Array.from({ length: 8 }, () => row('astisl.es', dayOffset(0)));
  const bad = await handleMetrics(get('?brand=astisl.es&period=7'), deps({ createRepo: () => fakeRepo(tooMany) }));
  assert.equal(bad.status, 502);
});

// ---------- repositorio (cliente simulado, solo SELECT) ----------

function fakeSupabase(response = { data: [], error: null }) {
  const calls = [];
  const from = (table) => {
    const call = { table, ops: [] };
    calls.push(call);
    const chain = new Proxy({}, {
      get(_, method) {
        if (method === 'then') return (resolve, reject) => Promise.resolve(response).then(resolve, reject);
        return (...args) => {
          call.ops.push([method, args]);
          return chain;
        };
      },
    });
    return chain;
  };
  return { client: { from }, calls };
}

test('metrics-store: reads only with select, in, gte, lte and order; no writes', async () => {
  const fake = fakeSupabase({ data: [row('astisl.es', '2026-11-01')], error: null });
  const repo = createMetricsRepo({ client: fake.client });
  const data = await repo.readDaily(['astisl.es'], '2026-10-29', '2026-11-04');
  assert.equal(data.length, 1);
  const ops = fake.calls[0].ops.map(([m]) => m);
  assert.deepEqual(ops, ['select', 'in', 'gte', 'lte', 'order']);
  assert.ok(!ops.some((m) => ['insert', 'upsert', 'update', 'delete'].includes(m)));
  assert.equal(fake.calls[0].table, 'gsc_daily_metrics');
});

test('metrics-store: database errors surface as a fixed code, never the database message', async () => {
  const fake = fakeSupabase({ data: null, error: { message: 'secret detail from postgres' } });
  const repo = createMetricsRepo({ client: fake.client });
  await assert.rejects(repo.readDaily(['astisl.es'], '2026-10-29', '2026-11-04'), (err) => {
    assert.equal(err.code, 'storage_error');
    assert.ok(!String(err.message).includes('secret'));
    return true;
  });
});

// ---------- comprobaciones estáticas ----------

test('the metrics route is GET-only, reads the service key without a public prefix and never writes', async () => {
  const route = await readFile(new URL('../app/api/gsc/metrics/route.js', import.meta.url), 'utf8');
  assert.match(route, /export async function GET\b/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)\b/);
  assert.match(route, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_[A-Z_]*SERVICE/);
  for (const name of ['metrics.mjs', 'metrics-handler.mjs', 'metrics-store.mjs']) {
    const source = await readFile(new URL(`../lib/gsc/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/, name);
    assert.doesNotMatch(source, /\.(insert|upsert|update|delete)\(/, name);
  }
});
