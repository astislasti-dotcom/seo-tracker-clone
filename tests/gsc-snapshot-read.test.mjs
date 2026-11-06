// GSC-06D · pruebas offline de la lectura owner-only de capturas. Datos ficticios, sin red,
// sin Supabase real, sin Google. Repositorio y verificador de token simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseSnapshotParams,
  domainsFor,
  validateStoredSnapshot,
  sortRows,
  pageSnapshot,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
} from '../lib/gsc/snapshot-read.mjs';
import { handleSnapshotRead } from '../lib/gsc/snapshot-read-handler.mjs';
import { SNAPSHOT_VIEW } from '../lib/gsc/snapshot-read-store.mjs';
// Configuración compartida real: única fuente de propiedades (sin copiar siteUrl en el test).
import CONFIG from '../config/gsc-properties.json' with { type: 'json' };

const OWNER = 'owner@example.test';
const OTHER = 'otro@example.test';
const TOKEN_OWNER = 'token-owner-ficticio';
const TOKEN_OTHER = 'token-otro-ficticio';
const SECRET = 'fixture-service-role-value-do-not-leak';
const END_DATE = '2026-11-03';

function shiftDate(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const item = (key, clicks = 2, impressions = 20, position = 3.5) => ({
  k: key,
  c: clicks,
  i: impressions,
  ctr: clicks / impressions,
  p: position,
});

// Fila almacenada con la forma de la vista (PR #35), sin datos reales.
function storedRow(domain, dimension, period, payload, overrides = {}) {
  const rowCount = payload.length;
  return {
    property_domain: domain,
    dimension,
    period_days: period,
    requested_at: '2026-11-04T08:00:00.000Z',
    window_start: shiftDate(END_DATE, -(period - 1)),
    window_end: END_DATE,
    data_state: 'final',
    aggregation_type: dimension === 'query' ? 'byProperty' : 'auto',
    response_aggregation_type: 'auto',
    row_limit: 5000,
    row_count: rowCount,
    truncated: rowCount >= 5000,
    payload,
    ...overrides,
  };
}

// Repositorio simulado: solo tiene readCurrent. Cualquier otra operación no existe.
function fakeRepo(store = {}, { failWith = null } = {}) {
  const calls = [];
  return {
    calls,
    repo: {
      async readCurrent(domain, dimension, period) {
        calls.push({ name: 'readCurrent', domain, dimension, period });
        if (failWith) throw failWith;
        return store[`${domain}|${dimension}|${period}`] ?? null;
      },
    },
  };
}

const verifyAccessToken = async (token) => {
  if (token === TOKEN_OWNER) return { email: OWNER };
  if (token === TOKEN_OTHER) return { email: OTHER };
  throw new Error('invalid token');
};

function request({ method = 'GET', query = '', token = TOKEN_OWNER } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return new Request(`https://seo.example.test/api/gsc/snapshots${query}`, { method, headers });
}

function deps(overrides = {}) {
  const { repo, calls } = fakeRepo(overrides.store ?? {}, overrides.repoOpts ?? {});
  return {
    deps: {
      config: CONFIG,
      ownerEmail: OWNER,
      verifyAccessToken,
      supabaseUrl: 'https://supabase.example.test',
      serviceKey: SECRET,
      createRepo: () => repo,
      ...overrides.deps,
    },
    calls,
  };
}

// --- 1. Parámetros -----------------------------------------------------------------

test('parámetros válidos y valores por defecto (limit 100, offset 0)', () => {
  const params = new URLSearchParams('brand=astisl.es&dimension=query&period=28');
  const parsed = parseSnapshotParams(params, CONFIG);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.limit, DEFAULT_LIMIT);
  assert.equal(parsed.offset, 0);
  assert.deepEqual(parsed.domains, ['astisl.es']);
});

test('brand=all devuelve las dos propiedades configuradas, sin mezclarlas', () => {
  assert.deepEqual(domainsFor('all', CONFIG), ['astisl.es', '3av.events']);
});

test('una marca fuera de la lista admitida o ausente de la configuración se rechaza', () => {
  assert.equal(domainsFor('evil.example', CONFIG).length, 0);
  assert.equal(domainsFor('otro.example', { 'otro.example': CONFIG['astisl.es'] }).length, 0);
  for (const brand of ['', 'evil.example', 'ASTISL.ES']) {
    const r = parseSnapshotParams(new URLSearchParams(`brand=${brand}&dimension=query&period=7`), CONFIG);
    assert.equal(r.code, 'invalid_brand', `brand=${brand}`);
  }
  assert.equal(parseSnapshotParams(new URLSearchParams('dimension=query&period=7'), CONFIG).code, 'invalid_brand');
});

test('dimensión y periodo fuera de rango se rechazan', () => {
  assert.equal(parseSnapshotParams(new URLSearchParams('brand=all&dimension=country&period=7'), CONFIG).code, 'invalid_dimension');
  for (const period of ['30', '7x', '', '28.0', '-7']) {
    const r = parseSnapshotParams(new URLSearchParams(`brand=all&dimension=page&period=${period}`), CONFIG);
    assert.equal(r.code, 'invalid_period', `period=${period}`);
  }
});

test('limit: solo enteros entre 1 y 500', () => {
  for (const limit of ['0', '501', '1.5', '-1', '', 'abc', '1e2']) {
    const r = parseSnapshotParams(new URLSearchParams(`brand=all&dimension=query&period=7&limit=${limit}`), CONFIG);
    assert.equal(r.code, 'invalid_limit', `limit=${limit}`);
  }
  assert.equal(parseSnapshotParams(new URLSearchParams(`brand=all&dimension=query&period=7&limit=${MAX_LIMIT}`), CONFIG).limit, 500);
  assert.equal(parseSnapshotParams(new URLSearchParams('brand=all&dimension=query&period=7&limit=1'), CONFIG).limit, 1);
});

test('offset: entero no negativo acotado a 0..4999', () => {
  for (const offset of ['-1', '5000', 'x', '2.5', '']) {
    const r = parseSnapshotParams(new URLSearchParams(`brand=all&dimension=query&period=7&offset=${offset}`), CONFIG);
    assert.equal(r.code, 'invalid_offset', `offset=${offset}`);
  }
  assert.equal(MAX_OFFSET, 4999);
  assert.equal(parseSnapshotParams(new URLSearchParams(`brand=all&dimension=query&period=7&offset=${MAX_OFFSET}`), CONFIG).offset, 4999);
});

// --- 2. Validación de la captura almacenada ------------------------------------------

test('una captura válida se acepta y se normaliza a {key, clicks, impressions, ctr, position}', () => {
  const row = storedRow('astisl.es', 'query', 7, [item('consulta ficticia', 2, 20, 3.5)]);
  const result = validateStoredSnapshot(row, { domain: 'astisl.es', dimension: 'query', period: 7 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.rows, [{ key: 'consulta ficticia', clicks: 2, impressions: 20, ctr: 0.1, position: 3.5 }]);
  assert.equal(result.snapshot.window.startDate, shiftDate(END_DATE, -6));
  assert.equal(result.snapshot.window.endDate, END_DATE);
});

test('una captura que no cumple la forma esperada se rechaza completa', () => {
  const expected = { domain: 'astisl.es', dimension: 'query', period: 7 };
  const good = [item('a')];
  const cases = {
    'dominio distinto': storedRow('3av.events', 'query', 7, good),
    'dimensión distinta': storedRow('astisl.es', 'page', 7, good),
    'periodo distinto': storedRow('astisl.es', 'query', 28, good),
    'estado provisional': storedRow('astisl.es', 'query', 7, good, { data_state: 'provisional' }),
    'ventana de longitud incorrecta': storedRow('astisl.es', 'query', 7, good, { window_start: shiftDate(END_DATE, -5) }),
    'row_count distinto de la longitud': storedRow('astisl.es', 'query', 7, good, { row_count: 3 }),
    'payload no array': storedRow('astisl.es', 'query', 7, good, { payload: { k: 'x' } }),
    'clics mayores que impresiones': storedRow('astisl.es', 'query', 7, [item('a', 30, 10)]),
    'CTR fuera de rango': storedRow('astisl.es', 'query', 7, [{ ...item('a'), ctr: 1.5 }]),
    'clave vacía': storedRow('astisl.es', 'query', 7, [item('')]),
    'clave duplicada': storedRow('astisl.es', 'query', 7, [item('a'), item('a')]),
    'posición fuera de rango': storedRow('astisl.es', 'query', 7, [item('a', 1, 2, 100000)]),
    'truncated inconsistente': storedRow('astisl.es', 'query', 7, good, { truncated: true }),
  };
  for (const [label, row] of Object.entries(cases)) {
    assert.equal(validateStoredSnapshot(row, expected).ok, false, label);
  }
});

// --- 3. Orden y paginación -------------------------------------------------------------

test('orden estable: clics desc, impresiones desc, clave asc', () => {
  const rows = [
    { key: 'b', clicks: 5, impressions: 50 },
    { key: 'a', clicks: 5, impressions: 50 },
    { key: 'c', clicks: 5, impressions: 90 },
    { key: 'd', clicks: 9, impressions: 10 },
  ];
  assert.deepEqual(sortRows(rows).map((r) => r.key), ['d', 'c', 'a', 'b']);
});

test('página 1, página 2, final de resultados y hasMore correctos', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ k: `consulta ${i}`, c: 10 - i, i: 100, ctr: 0.1, p: 1 }));
  const snapshot = validateStoredSnapshot(storedRow('astisl.es', 'query', 7, rows), {
    domain: 'astisl.es', dimension: 'query', period: 7,
  }).snapshot;

  const p1 = pageSnapshot(snapshot, { limit: 2, offset: 0 });
  assert.deepEqual(p1.rows.map((r) => r.key), ['consulta 0', 'consulta 1']);
  assert.equal(p1.returned, 2);
  assert.equal(p1.totalAvailable, 5);
  assert.equal(p1.hasMore, true);

  const p2 = pageSnapshot(snapshot, { limit: 2, offset: 2 });
  assert.deepEqual(p2.rows.map((r) => r.key), ['consulta 2', 'consulta 3']);
  assert.equal(p2.hasMore, true);

  const p3 = pageSnapshot(snapshot, { limit: 2, offset: 4 });
  assert.deepEqual(p3.rows.map((r) => r.key), ['consulta 4']);
  assert.equal(p3.hasMore, false);

  const beyond = pageSnapshot(snapshot, { limit: 2, offset: 10 });
  assert.equal(beyond.returned, 0);
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.totalAvailable, 5);
});

// --- 4. Handler: autorización, errores y respuestas --------------------------------------

test('método distinto de GET → 405, sin lecturas', async () => {
  const { deps: d, calls } = deps();
  const res = await handleSnapshotRead(request({ method: 'POST', query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 405);
  assert.equal(calls.length, 0);
});

test('sin token → 401 y sin lecturas', async () => {
  const { deps: d, calls } = deps();
  const res = await handleSnapshotRead(request({ token: null, query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('token de otro email → 403 y sin lecturas', async () => {
  const { deps: d, calls } = deps();
  const res = await handleSnapshotRead(request({ token: TOKEN_OTHER, query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('token que no verifica (lanza) → 401 y sin lecturas', async () => {
  const { deps: d, calls } = deps({ deps: { verifyAccessToken: async () => { throw new Error('boom'); } } });
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('propietario no configurado → 503 sin lecturas', async () => {
  const { deps: d, calls } = deps({ deps: { ownerEmail: undefined } });
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('parámetro inválido → 400 sin lecturas', async () => {
  const { deps: d, calls } = deps();
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=30' }), d);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_period');
  assert.equal(calls.length, 0);
});

test('clave de servidor ausente → 503 sin lecturas', async () => {
  const { deps: d, calls } = deps({ deps: { serviceKey: undefined } });
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'service_role_missing');
  assert.equal(calls.length, 0);
});

test('brand=all con captura faltante: 200, missing identifica dominio, dimensión y periodo', async () => {
  const store = {
    'astisl.es|query|7': storedRow('astisl.es', 'query', 7, [item('consulta A', 4, 40)]),
  };
  const { deps: d, calls } = deps({ store });
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.snapshots.length, 1);
  assert.equal(body.snapshots[0].domain, 'astisl.es');
  assert.deepEqual(body.missing, [{ domain: '3av.events', dimension: 'query', periodDays: 7 }]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.name === 'readCurrent'));
});

test('sin ninguna captura → 200 con snapshots vacío y todo en missing', async () => {
  const { deps: d } = deps({ store: {} });
  const res = await handleSnapshotRead(request({ query: '?brand=astisl.es&dimension=page&period=90' }), d);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.snapshots, []);
  assert.deepEqual(body.missing, [{ domain: 'astisl.es', dimension: 'page', periodDays: 90 }]);
});

test('paginación en la respuesta: página 2 con limit y offset', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => item(`consulta ${i}`, 10 - i, 100));
  const store = { 'astisl.es|query|7': storedRow('astisl.es', 'query', 7, rows) };
  const { deps: d } = deps({ store });
  const res = await handleSnapshotRead(request({ query: '?brand=astisl.es&dimension=query&period=7&limit=2&offset=2' }), d);
  const body = await res.json();
  const [snap] = body.snapshots;
  assert.deepEqual(snap.rows.map((r) => r.key), ['consulta 2', 'consulta 3']);
  assert.equal(snap.totalAvailable, 5);
  assert.equal(snap.hasMore, true);
  assert.equal(snap.returned, 2);
});

test('dos dominios en brand=all: cada uno con su captura, sin mezclar', async () => {
  const store = {
    'astisl.es|query|28': storedRow('astisl.es', 'query', 28, [item('consulta ASTI', 3, 30, 2)]),
    '3av.events|query|28': storedRow('3av.events', 'query', 28, [item('consulta 3AV', 9, 90, 8)]),
  };
  const { deps: d } = deps({ store });
  const body = await (await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=28' }), d)).json();
  assert.equal(body.snapshots.length, 2);
  const byDomain = Object.fromEntries(body.snapshots.map((s) => [s.domain, s]));
  assert.equal(byDomain['astisl.es'].rows[0].key, 'consulta ASTI');
  assert.equal(byDomain['3av.events'].rows[0].key, 'consulta 3AV');
  assert.equal(body.missing.length, 0);
});

test('captura corrupta → 502 invalid_response, sin ninguna fila en la respuesta', async () => {
  const store = {
    'astisl.es|query|7': storedRow('astisl.es', 'query', 7, [item('ok')], { row_count: 9 }),
  };
  const { deps: d } = deps({ store });
  const res = await handleSnapshotRead(request({ query: '?brand=astisl.es&dimension=query&period=7' }), d);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.equal(text.includes('ok'), false);
  assert.equal(JSON.parse(text).error, 'invalid_response');
});

test('error de almacenamiento → 502 con mensaje fijo, sin texto original ni secretos', async () => {
  const { deps: d, calls } = deps({ repoOpts: { failWith: new Error(`relation leaked ${SECRET}`) } });
  const res = await handleSnapshotRead(request({ query: '?brand=all&dimension=query&period=7' }), d);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.equal(text.includes(SECRET), false);
  assert.equal(JSON.parse(text).error, 'storage_error');
  assert.equal(calls.length, 1);
});

test('respuestas con Cache-Control no-store y sin clave de servicio', async () => {
  const store = { 'astisl.es|query|7': storedRow('astisl.es', 'query', 7, [item('x')]) };
  const { deps: d } = deps({ store });
  const ok = await handleSnapshotRead(request({ query: '?brand=astisl.es&dimension=query&period=7' }), d);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await ok.text()).includes(SECRET), false);
  const bad = await handleSnapshotRead(request({ query: '?brand=x' }), d);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});

// --- 5. Solo lectura de la vista ----------------------------------------------------------

test('el lector usa la vista y solo SELECT: sin insert, update, delete, upsert ni rpc', async () => {
  const store = await readFile(new URL('../lib/gsc/snapshot-read-store.mjs', import.meta.url), 'utf8');
  assert.match(store, new RegExp(`from\\(SNAPSHOT_VIEW\\)`));
  assert.equal(SNAPSHOT_VIEW, 'gsc_dimension_snapshots_current');
  for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', 'gsc_dimension_snapshots\'']) {
    assert.equal(store.includes(forbidden), false, forbidden);
  }
});

test('la ruta exporta solo GET', async () => {
  const route = await readFile(new URL('../app/api/gsc/snapshots/route.js', import.meta.url), 'utf8');
  assert.match(route, /export async function GET/);
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(new RegExp(`export (async )?function ${verb}\\b`).test(route), false, verb);
  }
});

test('los módulos de lectura no llaman a Google ni contienen escrituras', async () => {
  for (const file of ['../lib/gsc/snapshot-read.mjs', '../lib/gsc/snapshot-read-handler.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.equal(/googleapis|searchanalytics|google-auth/.test(source), false, file);
    assert.equal(/\.(insert|update|delete|upsert|rpc)\(/.test(source), false, file);
    assert.equal(source.includes(SECRET), false, file);
  }
});
