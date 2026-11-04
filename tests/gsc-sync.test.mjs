// GSC-02b · pruebas offline. Sin red, sin credenciales reales, sin Supabase.
// El transporte de Google y el repositorio son simulados; un transporte sin inyectar falla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSyncDays, planSyncWindow, splitBlocks, validateDailyRows, classifyDailyRows, BLOCK_DAYS } from '../lib/gsc/sync-plan.mjs';
import { fetchDailyRows } from '../lib/gsc/client.mjs';
import { writeDailyRows } from '../lib/gsc/store.mjs';
import { syncProperty } from '../lib/gsc/sync.mjs';
import { handleSync } from '../lib/gsc/sync-handler.mjs';
import { createSupabaseRepo, StorageError } from '../lib/gsc/store-supabase.mjs';

const NOW = new Date('2026-11-04T12:00:00Z');
const OWNER = 'owner@example.test';
const BEGIN = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const FIXTURE_KEY = `${BEGIN}\nFIXTURE-NOT-A-KEY\n-----END PRIVATE KEY-----\n`;
const FIXTURE_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
  private_key: FIXTURE_KEY,
});
const SERVICE_KEY_FIXTURE = 'fixture-service-role-value-do-not-leak';
const CONFIG = {
  'astisl.es': { brand: 'ASTI', siteUrl: 'sc-domain:astisl.es' },
  '3av.events': { brand: '3AV', siteUrl: 'https://3av.events/' },
};

const DAY = 86_400_000;
const isoOffset = (days) => new Date(Date.UTC(2026, 10, 4) + days * DAY).toISOString().slice(0, 10);

// Dataset: days 0..87 are final; the last two days (88, 89) exist only in 'all'.
function makeDataset(domainShift = 0) {
  const data = {};
  for (let i = -89; i <= 0; i += 1) {
    const date = isoOffset(i);
    const index = i + 89;
    const clicks = index + 1 + domainShift;
    data[date] = { final: index < 88, clicks, impressions: clicks * 10, position: 4.5 + (index % 5) };
  }
  return data;
}

// Fake Search Console transport. Enforces the real request shape and can fail on the nth call.
function gscTransport(dataset, { errorAt = null, error = null } = {}) {
  const calls = [];
  const transport = async ({ body }) => {
    calls.push(body);
    if (errorAt !== null && calls.length === errorAt) throw error;
    const rows = [];
    for (const [date, value] of Object.entries(dataset)) {
      if (date < body.startDate || date > body.endDate) continue;
      if (body.dataState === 'final' && !value.final) continue;
      rows.push({
        keys: [date],
        clicks: value.clicks,
        impressions: value.impressions,
        ctr: value.clicks / value.impressions,
        position: value.position,
      });
    }
    return rows.length ? { rows, metadata: { first_incomplete_date: body.dataState === 'all' ? isoOffset(-1) : null } } : {};
  };
  transport.calls = calls;
  return transport;
}
const noNetwork = async () => {
  throw new Error('transport must not be called in this test');
};

// In-memory repository with the same guards as the SQL: a provisional-only UPDATE and an
// insert that never overwrites.
function memoryRepo({ failInsert = false, failStart = false } = {}) {
  const rows = new Map();
  const runs = new Map();
  let seq = 0;
  return {
    rows,
    runs,
    async insertMissing(records) {
      if (failInsert) throw new Error('db down');
      const inserted = [];
      for (const record of records) {
        const key = `${record.property_domain}|${record.metric_date}`;
        if (!rows.has(key)) {
          rows.set(key, { ...record });
          inserted.push(record.metric_date);
        }
      }
      return inserted;
    },
    async updateProvisional(domain, date, values) {
      const key = `${domain}|${date}`;
      const current = rows.get(key);
      if (!current || current.data_state !== 'provisional') return false;
      const rest = Object.fromEntries(
        Object.entries(values).filter(([k]) => k !== 'property_domain' && k !== 'metric_date')
      );
      rows.set(key, { ...current, ...rest });
      return true;
    },
    async startRun(run) {
      if (failStart) throw new Error('db down');
      seq += 1;
      const id = `run-${seq}`;
      runs.set(id, { ...run });
      return id;
    },
    async finishRun(id, patch) {
      runs.set(id, { ...runs.get(id), ...patch });
    },
  };
}

const snapshot = (repo) => JSON.stringify([...repo.rows.entries()].sort());
const windowFor = (days) => planSyncWindow(days, NOW);
const property = (domain) => ({ domain, brand: CONFIG[domain].brand, siteUrl: CONFIG[domain].siteUrl });

// ---------- planificación ----------

test('parseSyncDays: default 90, only 28 or 90 allowed, anything else rejected', () => {
  assert.equal(parseSyncDays(null), 90);
  assert.equal(parseSyncDays(undefined), 90);
  assert.equal(parseSyncDays('28'), 28);
  assert.equal(parseSyncDays('90'), 90);
  assert.equal(parseSyncDays('30'), null);
  assert.equal(parseSyncDays('0'), null);
  assert.equal(parseSyncDays('90.0'), null);
  assert.equal(parseSyncDays('9999'), null);
});

test('planSyncWindow ends today in UTC with no fixed lag', () => {
  assert.deepEqual(windowFor(90), { startDate: '2026-08-07', endDate: '2026-11-04', days: 90 });
  assert.deepEqual(windowFor(28), { startDate: '2026-10-08', endDate: '2026-11-04', days: 28 });
  assert.throws(() => planSyncWindow(30, NOW), RangeError);
});

test('splitBlocks: contiguous, non-overlapping, at most 28 days, full coverage', () => {
  const blocks = splitBlocks('2026-08-07', '2026-11-04');
  assert.equal(blocks.length, 4);
  let expectedDays = 0;
  let previousEnd = null;
  for (const block of blocks) {
    const days = (Date.parse(block.endDate) - Date.parse(block.startDate)) / DAY + 1;
    assert.ok(days >= 1 && days <= BLOCK_DAYS);
    if (previousEnd) assert.equal(Date.parse(block.startDate) - Date.parse(previousEnd), DAY);
    previousEnd = block.endDate;
    expectedDays += days;
  }
  assert.equal(expectedDays, 90);
  assert.equal(blocks[0].startDate, '2026-08-07');
  assert.equal(blocks.at(-1).endDate, '2026-11-04');
  assert.throws(() => splitBlocks('2026-11-04', '2026-08-07'), RangeError);
  assert.throws(() => splitBlocks('2026-02-30', '2026-03-01'), RangeError);
});

// ---------- validación ----------

const BLOCK = { startDate: '2026-10-01', endDate: '2026-10-03' };
const good = (date, extra = {}) => ({ keys: [date], clicks: 3, impressions: 30, ctr: 0.1, position: 7.2, ...extra });

test('validateDailyRows accepts well-formed rows and empty blocks', () => {
  const result = validateDailyRows([good('2026-10-01'), good('2026-10-03')], BLOCK);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].metricDate, '2026-10-01');
  assert.deepEqual(validateDailyRows([], BLOCK), { ok: true, rows: [] });
});

test('validateDailyRows rejects every malformed case without partial output', () => {
  const bad = [
    'not-an-array',
    [null],
    [{ keys: ['2026-10-01', 'x'], clicks: 1, impressions: 1, ctr: 1, position: 1 }],
    [good('2026-13-01')],
    [good('2026-09-30')],
    [good('2026-10-01'), good('2026-10-01')],
    [good('2026-10-01', { clicks: -1 })],
    [good('2026-10-01', { clicks: 1.5 })],
    [good('2026-10-01', { clicks: 40, impressions: 30 })],
    [good('2026-10-01', { ctr: 1.2 })],
    [good('2026-10-01', { ctr: NaN })],
    [good('2026-10-01', { position: -1 })],
    [good('2026-10-01', { position: 100000 })],
  ];
  for (const rows of bad) {
    assert.deepEqual(validateDailyRows(rows, BLOCK), { ok: false, code: 'invalid_response' }, JSON.stringify(rows));
  }
});

test('classifyDailyRows: a day is final only if the final query returns it', () => {
  const finalRows = [{ metricDate: '2026-10-01', clicks: 5, impressions: 50, ctr: 0.1, avgPosition: 3 }];
  const allRows = [
    { metricDate: '2026-10-01', clicks: 9, impressions: 90, ctr: 0.1, avgPosition: 9 },
    { metricDate: '2026-10-02', clicks: 2, impressions: 20, ctr: 0.1, avgPosition: 4 },
  ];
  const merged = classifyDailyRows(finalRows, allRows);
  assert.deepEqual(merged.map((r) => [r.metricDate, r.dataState, r.clicks]), [
    ['2026-10-01', 'final', 5],
    ['2026-10-02', 'provisional', 2],
  ]);
});

// ---------- cliente de bloque ----------

test('fetchDailyRows sends the expected read-only request shape per dataState', async () => {
  const transport = gscTransport(makeDataset());
  const block = { startDate: '2026-10-01', endDate: '2026-10-28' };
  await fetchDailyRows({ credentials: {}, siteUrl: 'sc-domain:astisl.es', block, dataState: 'final', transport });
  assert.deepEqual(transport.calls[0], { startDate: '2026-10-01', endDate: '2026-10-28', dataState: 'final', dimensions: ['date'], rowLimit: 1000 });
  const bad = await fetchDailyRows({ credentials: {}, siteUrl: 'x', block, dataState: 'partial', transport });
  assert.deepEqual(bad, { ok: false, code: 'invalid_request' });
  assert.equal(transport.calls.length, 1, 'an invalid dataState must not reach the transport');
});

test('fetchDailyRows reduces transport errors to codes and never forwards the message', async () => {
  const leaky = Object.assign(new Error(`token ${SERVICE_KEY_FIXTURE}`), { code: 403 });
  const transport = gscTransport(makeDataset(), { errorAt: 1, error: leaky });
  const result = await fetchDailyRows({ credentials: {}, siteUrl: 'x', block: { startDate: '2026-10-01', endDate: '2026-10-02' }, dataState: 'all', transport });
  assert.deepEqual(result, { ok: false, code: 'permission_denied' });
  assert.ok(!JSON.stringify(result).includes(SERVICE_KEY_FIXTURE));
});

// ---------- escritura protegida e idempotente ----------

const rowFor = (date, dataState, clicks = 1) => ({
  metricDate: date,
  clicks,
  impressions: clicks * 10,
  ctr: 0.1,
  avgPosition: 5,
  dataState,
});

test('writeDailyRows: a second identical run changes nothing (idempotent)', async () => {
  const repo = memoryRepo();
  const rows = [rowFor('2026-10-01', 'final', 4), rowFor('2026-10-02', 'provisional', 2)];
  const first = await writeDailyRows(repo, 'astisl.es', rows, NOW.toISOString());
  const afterFirst = snapshot(repo);
  const second = await writeDailyRows(repo, 'astisl.es', rows, NOW.toISOString());
  assert.equal(first.inserted, 2);
  assert.deepEqual(second, { inserted: 0, updated: 1, alreadyFinal: 1, protectedFinal: 0 });
  assert.equal(snapshot(repo), afterFirst);
  assert.equal(repo.rows.size, 2);
});

test('writeDailyRows: a provisional row never overwrites a stored final row', async () => {
  const repo = memoryRepo();
  await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'final', 4)], NOW.toISOString());
  const counts = await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'provisional', 99)], NOW.toISOString());
  assert.deepEqual(counts, { inserted: 0, updated: 0, alreadyFinal: 0, protectedFinal: 1 });
  const stored = repo.rows.get('astisl.es|2026-10-01');
  assert.equal(stored.data_state, 'final');
  assert.equal(stored.clicks, 4);
});

test('writeDailyRows: a stored final row is never replaced by a different final value', async () => {
  const repo = memoryRepo();
  await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'final', 4)], NOW.toISOString());
  const counts = await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'final', 7)], NOW.toISOString());
  assert.equal(counts.alreadyFinal, 1);
  assert.equal(repo.rows.get('astisl.es|2026-10-01').clicks, 4);
});

test('writeDailyRows: a provisional row is promoted to final when Google confirms it', async () => {
  const repo = memoryRepo();
  await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'provisional', 2)], NOW.toISOString());
  const counts = await writeDailyRows(repo, 'astisl.es', [rowFor('2026-10-01', 'final', 3)], NOW.toISOString());
  assert.equal(counts.updated, 1);
  const stored = repo.rows.get('astisl.es|2026-10-01');
  assert.equal(stored.data_state, 'final');
  assert.equal(stored.clicks, 3);
});

// ---------- orquestación por propiedad ----------

test('syncProperty: 90 days in 4 blocks, 8 read-only queries, final and provisional classified', async () => {
  const repo = memoryRepo();
  const transport = gscTransport(makeDataset());
  const result = await syncProperty({ property: property('astisl.es'), window: windowFor(90), credentials: {}, transport, repo, now: NOW });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(transport.calls.length, 8);
  assert.deepEqual([...new Set(transport.calls.map((c) => c.dataState))].sort(), ['all', 'final']);
  assert.equal(result.final, 88);
  assert.equal(result.provisional, 2);
  assert.equal(result.rowsReceived, 90);
  assert.equal(result.inserted, 90);
  const run = [...repo.runs.values()][0];
  assert.equal(run.status, 'ok');
  assert.equal(run.rows_received, 90);
  assert.equal(run.error_code ?? null, null);
});

test('syncProperty: a failing block writes nothing and records the error code', async () => {
  const repo = memoryRepo();
  const transport = gscTransport(makeDataset(), { errorAt: 5, error: Object.assign(new Error('quota'), { code: 429 }) });
  const result = await syncProperty({ property: property('astisl.es'), window: windowFor(90), credentials: {}, transport, repo, now: NOW });
  assert.deepEqual([result.ok, result.code], [false, 'quota_exceeded']);
  assert.equal(repo.rows.size, 0, 'no partial write when a later block fails');
  const run = [...repo.runs.values()][0];
  assert.equal(run.status, 'error');
  assert.equal(run.error_code, 'quota_exceeded');
  assert.equal(run.rows_received, 0);
});

test('syncProperty: an invalid Google response aborts before any write', async () => {
  const repo = memoryRepo();
  const broken = async ({ body }) => (body.dataState === 'all' && body.startDate > '2026-10-01' ? { rows: [{ keys: ['2026-10-01'], clicks: 5, impressions: 1, ctr: 0.5, position: 1 }] } : { rows: [] });
  const result = await syncProperty({ property: property('astisl.es'), window: windowFor(28), credentials: {}, transport: broken, repo, now: NOW });
  assert.equal(result.code, 'invalid_response');
  assert.equal(repo.rows.size, 0);
});

test('syncProperty: a storage failure is reported as a code, not as the raw error', async () => {
  const repo = memoryRepo({ failInsert: true });
  const transport = gscTransport(makeDataset());
  const result = await syncProperty({ property: property('astisl.es'), window: windowFor(28), credentials: {}, transport, repo, now: NOW });
  assert.deepEqual([result.ok, result.code], [false, 'storage_error']);
  assert.ok(!JSON.stringify(result).includes('db down'));
  assert.equal([...repo.runs.values()][0].status, 'error');
});

test('syncProperty: repeating the same sync leaves the table unchanged', async () => {
  const repo = memoryRepo();
  const transport = gscTransport(makeDataset());
  await syncProperty({ property: property('3av.events'), window: windowFor(90), credentials: {}, transport, repo, now: NOW });
  const before = snapshot(repo);
  const again = await syncProperty({ property: property('3av.events'), window: windowFor(90), credentials: {}, transport, repo, now: NOW });
  assert.equal(again.inserted, 0);
  assert.equal(again.protectedFinal, 0);
  assert.equal(snapshot(repo), before);
});

test('syncProperty: ASTI and 3AV rows stay separated by property_domain', async () => {
  const repo = memoryRepo();
  await syncProperty({ property: property('astisl.es'), window: windowFor(28), credentials: {}, transport: gscTransport(makeDataset(0)), repo, now: NOW });
  await syncProperty({ property: property('3av.events'), window: windowFor(28), credentials: {}, transport: gscTransport(makeDataset(100)), repo, now: NOW });
  const domains = new Set([...repo.rows.values()].map((r) => r.property_domain));
  assert.deepEqual([...domains].sort(), ['3av.events', 'astisl.es']);
  assert.equal(repo.rows.size, 56);
});

// ---------- manejador HTTP (solo propietario) ----------

const handlerDeps = (overrides = {}) => ({
  config: CONFIG,
  ownerEmail: OWNER,
  verifyAccessToken: async () => ({ email: OWNER }),
  rawCredentials: FIXTURE_JSON,
  supabaseUrl: 'https://fixture-project.supabase.co',
  serviceKey: SERVICE_KEY_FIXTURE,
  createRepo: () => memoryRepo(),
  transport: gscTransport(makeDataset()),
  now: () => NOW,
  ...overrides,
});
const post = (query = '', authorization = 'Bearer fixture-token') =>
  new Request(`http://localhost/api/gsc/sync${query}`, {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });

test('handleSync: only POST is accepted', async () => {
  const res = await handleSync(new Request('http://localhost/api/gsc/sync?brand=astisl.es', { method: 'GET', headers: { authorization: 'Bearer x' } }), handlerDeps());
  assert.equal(res.status, 405);
});

test('handleSync: no token → 401, wrong user → 403, no owner configured → 503, all before Google', async () => {
  const noTransport = handlerDeps({ transport: noNetwork });
  assert.equal((await handleSync(post('?brand=astisl.es', null), noTransport)).status, 401);
  assert.equal((await handleSync(post('?brand=astisl.es'), { ...noTransport, verifyAccessToken: async () => ({ email: 'other@example.test' }) })).status, 403);
  assert.equal((await handleSync(post('?brand=astisl.es'), { ...noTransport, ownerEmail: undefined })).status, 503);
});

test('handleSync: missing service key fails safely before any Google or Supabase call', async () => {
  const deps = handlerDeps({ serviceKey: undefined, transport: noNetwork, createRepo: () => { throw new Error('must not create repo'); } });
  const res = await handleSync(post('?brand=astisl.es'), deps);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'service_role_missing');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('handleSync: invalid brand, days or missing credentials fail before syncing', async () => {
  const deps = handlerDeps({ transport: noNetwork });
  assert.equal((await handleSync(post('?brand=evil.example'), deps)).status, 400);
  assert.equal((await handleSync(post('?brand=astisl.es&days=30'), deps)).status, 400);
  assert.equal((await handleSync(post('?brand=astisl.es'), { ...deps, rawCredentials: undefined })).status, 503);
  assert.equal((await handleSync(post('?brand=astisl.es'), { ...deps, config: { 'astisl.es': { brand: 'ASTI', siteUrl: null } } })).status, 503);
});

test('handleSync: happy path for one brand returns counts and never leaks secrets', async () => {
  const res = await handleSync(post('?brand=astisl.es&days=28'), handlerDeps());
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.days, 28);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].domain, 'astisl.es');
  assert.ok(!text.includes(SERVICE_KEY_FIXTURE));
  assert.ok(!text.includes('FIXTURE-NOT-A-KEY'));
  assert.ok(!text.includes('PRIVATE KEY'));
});

test('handleSync: brand=all syncs both properties and reports partial failure as 502', async () => {
  const repo = memoryRepo();
  const transport = gscTransport(makeDataset(), { errorAt: 2, error: Object.assign(new Error('x'), { code: 404 }) });
  const res = await handleSync(post('?brand=all&days=28'), handlerDeps({ createRepo: () => repo, transport }));
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.ok, false);
  assert.deepEqual(body.results.map((r) => [r.domain, r.ok]), [['astisl.es', false], ['3av.events', true]]);
  assert.equal(body.results[0].code, 'property_not_found');
});

// ---------- adaptador de Supabase (llamadas simuladas, sin red) ----------

function fakeSupabase(response = { data: [], error: null }) {
  const calls = [];
  const from = (table) => {
    const call = { table, ops: [] };
    calls.push(call);
    const chain = new Proxy(
      {},
      {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => Promise.resolve(response).then(resolve, reject);
          return (...args) => {
            call.ops.push([method, args]);
            return chain;
          };
        },
      }
    );
    return chain;
  };
  return { client: { from }, calls };
}

test('store-supabase: insertMissing uses ON CONFLICT DO NOTHING semantics on the composite key', async () => {
  const fake = fakeSupabase({ data: [{ metric_date: '2026-10-01' }], error: null });
  const repo = createSupabaseRepo({ client: fake.client });
  const inserted = await repo.insertMissing([{ property_domain: 'astisl.es', metric_date: '2026-10-01' }]);
  assert.deepEqual(inserted, ['2026-10-01']);
  const upsert = fake.calls[0].ops.find(([m]) => m === 'upsert');
  assert.equal(fake.calls[0].table, 'gsc_daily_metrics');
  assert.deepEqual(upsert[1][1], { onConflict: 'property_domain,metric_date', ignoreDuplicates: true });
});

test('store-supabase: updateProvisional filters on data_state = provisional and strips key columns', async () => {
  const fake = fakeSupabase({ data: [{ metric_date: '2026-10-01' }], error: null });
  const repo = createSupabaseRepo({ client: fake.client });
  const changed = await repo.updateProvisional('astisl.es', '2026-10-01', { property_domain: 'astisl.es', metric_date: '2026-10-01', clicks: 3, data_state: 'final' });
  assert.equal(changed, true);
  const ops = fake.calls[0].ops;
  assert.ok(ops.some(([m, a]) => m === 'eq' && a[0] === 'data_state' && a[1] === 'provisional'));
  const update = ops.find(([m]) => m === 'update')[1][0];
  assert.deepEqual(Object.keys(update).sort(), ['clicks', 'data_state']);
});

test('store-supabase: storage errors surface as a fixed code, never the database message', async () => {
  const fake = fakeSupabase({ data: null, error: { message: 'secret detail from postgres' } });
  const repo = createSupabaseRepo({ client: fake.client });
  await assert.rejects(repo.startRun({ property_domain: 'astisl.es' }), (err) => {
    assert.ok(err instanceof StorageError);
    assert.equal(err.code, 'storage_error');
    assert.ok(!String(err.message).includes('secret'));
    return true;
  });
});

// ---------- comprobaciones estáticas de seguridad ----------

test('the sync route is POST-only and reads the service key without a public prefix', async () => {
  const route = await readFile(new URL('../app/api/gsc/sync/route.js', import.meta.url), 'utf8');
  assert.match(route, /export async function POST\b/);
  assert.doesNotMatch(route, /export async function GET\b/);
  assert.match(route, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_[A-Z_]*SERVICE/);
});

test('no sync module logs, prints or exposes the service key or identities', async () => {
  const files = ['sync-plan.mjs', 'sync.mjs', 'sync-handler.mjs', 'store.mjs', 'store-supabase.mjs'];
  for (const name of files) {
    const source = await readFile(new URL(`../lib/gsc/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/, name);
    assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z_]*SERVICE/, name);
  }
});

test('vercel.json schedules no GSC sync (manual only)', async () => {
  const config = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /gsc/i);
});
