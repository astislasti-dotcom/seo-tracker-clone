// GSC-06C · pruebas offline de la ingesta de snapshots. Datos ficticios, sin red,
// sin credenciales reales, sin Supabase. Transporte de Google y repositorio simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SNAPSHOT_ROW_LIMIT,
  snapshotBody,
  validateSnapshotRows,
  fetchSnapshotRows,
  ingestSnapshot,
  ingestAllSnapshots,
} from '../lib/gsc/snapshot-ingest.mjs';
import { createSnapshotRepo, SnapshotStorageError, PUBLISH_FUNCTION } from '../lib/gsc/snapshot-store.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
const CLOCK = () => NOW;
const SECRET = 'fixture-service-role-value-do-not-leak';
const PROPERTY = { domain: 'astisl.es', siteUrl: 'sc-domain:astisl.es' };
const CREDENTIALS = { fixture: true };

// Filas sintéticas válidas. El texto de las consultas es ficticio.
const row = (key, clicks = 2, impressions = 20) => ({
  keys: [key],
  clicks,
  impressions,
  ctr: clicks / impressions,
  position: 3.5,
});

function okTransport(rows = [row('consulta ficticia uno'), row('consulta ficticia dos', 1, 10)]) {
  const calls = [];
  const transport = async (args) => {
    calls.push(args);
    return { rows, responseAggregationType: args.body.aggregationType === 'auto' ? 'auto' : 'byProperty' };
  };
  return { transport, calls };
}

function fakeRepo(id = 101) {
  const records = [];
  return {
    records,
    repo: {
      async publish(record) {
        records.push(record);
        return id;
      },
    },
  };
}

// --- 1. Petición a Google -------------------------------------------------------

test('la petición usa una sola dimensión, datos finales y el límite de filas de la propuesta', () => {
  const window = { startDate: '2026-10-28', endDate: '2026-11-03', days: 7 };
  const query = snapshotBody({ dimension: 'query', window });
  const page = snapshotBody({ dimension: 'page', window });

  assert.deepEqual(query.dimensions, ['query']);
  assert.deepEqual(page.dimensions, ['page']);
  assert.equal(query.dataState, 'final');
  assert.equal(query.rowLimit, SNAPSHOT_ROW_LIMIT);
  assert.equal(SNAPSHOT_ROW_LIMIT, 5000);
  assert.equal(query.aggregationType, 'byProperty');
  assert.equal(page.aggregationType, 'auto');
});

test('la ventana termina tres días antes de hoy en UTC', async () => {
  const { transport, calls } = okTransport();
  const { repo } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].body.startDate, '2026-10-28');
  assert.equal(calls[0].body.endDate, '2026-11-03');
});

// --- 2. Validación de filas -----------------------------------------------------

test('acepta filas válidas y las convierte a la forma {k,c,i,ctr,p}', () => {
  const result = validateSnapshotRows([row('consulta ficticia', 2, 20)]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [{ k: 'consulta ficticia', c: 2, i: 20, ctr: 0.1, p: 3.5 }]);
});

test('rechaza una respuesta que no es lista', () => {
  assert.equal(validateSnapshotRows(null).ok, false);
  assert.equal(validateSnapshotRows({}).ok, false);
});

test('rechaza una fila con clics mayores que impresiones', () => {
  assert.deepEqual(validateSnapshotRows([row('x', 5, 3)]), { ok: false, code: 'invalid_response' });
});

test('rechaza CTR fuera de [0,1], posición negativa o no finita, y valores no enteros', () => {
  assert.equal(validateSnapshotRows([{ ...row('a'), ctr: 1.5 }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), ctr: -0.1 }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), position: -1 }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), position: Number.NaN }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), position: 100000 }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), clicks: 1.5 }]).ok, false);
});

test('rechaza claves duplicadas y filas con más de una clave', () => {
  assert.equal(validateSnapshotRows([row('igual'), row('igual')]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), keys: ['a', 'b'] }]).ok, false);
  assert.equal(validateSnapshotRows([{ ...row('a'), keys: [] }]).ok, false);
});

test('rechaza claves vacías o demasiado largas', () => {
  assert.equal(validateSnapshotRows([row('')]).ok, false);
  assert.equal(validateSnapshotRows([row('x'.repeat(2049))]).ok, false);
  assert.equal(validateSnapshotRows([row('x'.repeat(2048))]).ok, true);
});

test('acepta exactamente 5000 filas y rechaza 5001', () => {
  const exact = Array.from({ length: 5000 }, (_, i) => row(`consulta ${i}`));
  assert.equal(validateSnapshotRows(exact).ok, true);
  const over = Array.from({ length: 5001 }, (_, i) => row(`consulta ${i}`));
  assert.equal(validateSnapshotRows(over).ok, false);
});

test('una fila dudosa invalida el snapshot entero: no hay escritura parcial', async () => {
  const { transport } = okTransport([row('buena'), { ...row('mala'), clicks: 9, impressions: 1 }]);
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 28, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.deepEqual(result.code, 'invalid_response');
  assert.equal(result.ok, false);
  assert.equal(records.length, 0);
});

// --- 3. Orden: requested_at antes de Google -------------------------------------

test('requested_at se fija con el reloj antes de llamar a Google', async () => {
  const log = [];
  const clock = () => {
    log.push('clock');
    return NOW;
  };
  const transport = async () => {
    log.push('google');
    return { rows: [row('x')] };
  };
  const { repo, records } = fakeRepo();
  await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 7, clock, credentials: CREDENTIALS, transport, repo,
  });
  assert.deepEqual(log, ['clock', 'google']);
  assert.equal(records[0].p_requested_at, NOW.toISOString());
});

// --- 4. Errores de Google: sin escritura y sin texto reenviado -------------------

test('un error de Google no llama a publish y devuelve solo un código fijo', async () => {
  const transport = async () => {
    const error = new Error(`denied for ${SECRET}`);
    error.code = 403;
    throw error;
  };
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'page', periodDays: 90, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.equal(records.length, 0);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('códigos de Google se mapean a códigos fijos sin llamar a publish', async () => {
  for (const [status, code] of [[401, 'credentials_invalid'], [404, 'property_not_found'], [429, 'quota_exceeded'], [503, 'unavailable'], [418, 'unknown']]) {
    const transport = async () => {
      throw Object.assign(new Error('x'), { code: status });
    };
    const { repo, records } = fakeRepo();
    const result = await ingestSnapshot({
      property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
    });
    assert.equal(result.code, code, `status ${status}`);
    assert.equal(records.length, 0);
  }
});

test('una respuesta con agregación desconocida se rechaza', async () => {
  const transport = async () => ({ rows: [row('x')], responseAggregationType: 'inventado' });
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.code, 'invalid_response');
  assert.equal(records.length, 0);
});

// --- 5. Registro para la función SQL ----------------------------------------------

test('el registro usa exactamente los parámetros de gsc_publish_dimension_snapshot (PR #35)', async () => {
  const { transport } = okTransport();
  const { repo, records } = fakeRepo(7);
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 28, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 7);

  // Lista literal de la firma de la PR #35, en el mismo orden que el SQL.
  const expectedKeys = [
    'p_property_domain', 'p_dimension', 'p_period_days', 'p_requested_at', 'p_window_start', 'p_window_end',
    'p_data_state', 'p_aggregation_type', 'p_response_aggregation_type', 'p_row_limit', 'p_row_count',
    'p_truncated', 'p_payload',
  ];
  assert.deepEqual(Object.keys(records[0]).sort(), [...expectedKeys].sort());
  assert.equal(records[0].p_data_state, 'final');
  assert.equal(records[0].p_row_limit, 5000);
  assert.equal(records[0].p_period_days, 28);
  assert.equal(records[0].p_row_count, 2);
  assert.equal(records[0].p_truncated, false);
  assert.equal(records[0].p_payload.length, 2);
});

test('truncated es true desde 5000 filas', async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => row(`consulta ${i}`, 1, 10));
  const transport = async () => ({ rows });
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 90, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.truncated, true);
  assert.equal(records[0].p_truncated, true);
  assert.equal(records[0].p_row_count, 5000);
});

test('una respuesta vacía se publica como snapshot de cero filas, sin error', async () => {
  const transport = async () => ({ rows: [] });
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'page', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, true);
  assert.equal(records[0].p_row_count, 0);
  assert.deepEqual(records[0].p_payload, []);
  assert.equal(records[0].p_aggregation_type, 'auto');
});

// --- 6. Errores de escritura ------------------------------------------------------

test('un fallo de publish se reduce a storage_error sin reenviar el texto', async () => {
  const { transport } = okTransport();
  const repo = {
    async publish() {
      throw new Error(`relation leaked ${SECRET}`);
    },
  };
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'storage_error');
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

// --- 7. Entradas no válidas: sin llamadas -----------------------------------------

test('entradas no válidas no llaman a Google ni a publish', async () => {
  const { transport, calls } = okTransport();
  const { repo, records } = fakeRepo();
  const base = { property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo };
  const cases = [
    { ...base, dimension: 'country' },
    { ...base, periodDays: 30 },
    { ...base, property: { domain: 'astisl.es' } },
    { ...base, clock: () => new Date('nope') },
  ];
  for (const input of cases) {
    const result = await ingestSnapshot(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_request');
  }
  assert.equal(calls.length, 0);
  assert.equal(records.length, 0);
});

// --- 8. Todas las combinaciones -----------------------------------------------------

test('ingestAllSnapshots recorre 2 propiedades × 2 dimensiones × 3 periodos = 12 snapshots', async () => {
  const { transport, calls } = okTransport();
  const { repo, records } = fakeRepo();
  const properties = [PROPERTY, { domain: '3av.events', siteUrl: 'https://3av.events/' }];
  const summary = await ingestAllSnapshots({ properties, clock: CLOCK, credentials: CREDENTIALS, transport, repo });
  assert.equal(summary.ok, true);
  assert.equal(summary.results.length, 12);
  assert.equal(calls.length, 12);
  assert.equal(records.length, 12);
});

test('un fallo en una combinación no detiene las demás', async () => {
  let n = 0;
  const transport = async (args) => {
    n += 1;
    if (n === 2) throw Object.assign(new Error('x'), { code: 429 });
    return { rows: [row('x')] };
  };
  const { repo, records } = fakeRepo();
  const summary = await ingestAllSnapshots({ properties: [PROPERTY], clock: CLOCK, credentials: CREDENTIALS, transport, repo });
  assert.equal(summary.ok, false);
  assert.equal(summary.results.filter((r) => r.ok).length, 5);
  assert.equal(records.length, 5);
});

// --- 9. Adaptador de escritura: solo rpc -------------------------------------------

test('el adaptador escribe solo con rpc a la función de publicación', async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: 42, error: null });
    },
    from() {
      throw new Error('from() no debe usarse para snapshots');
    },
  };
  const repo = createSnapshotRepo({ client });
  const id = await repo.publish({ p_property_domain: 'astisl.es' });
  assert.equal(id, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, PUBLISH_FUNCTION);
  assert.equal(PUBLISH_FUNCTION, 'gsc_publish_dimension_snapshot');
});

test('un error de rpc se reduce a storage_error sin texto de Supabase', async () => {
  const client = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: `permission denied ${SECRET}` } });
    },
  };
  const repo = createSnapshotRepo({ client });
  await assert.rejects(
    () => repo.publish({ p_property_domain: 'astisl.es' }),
    (error) => {
      assert.ok(error instanceof SnapshotStorageError);
      assert.equal(error.code, 'storage_error');
      assert.equal(error.message.includes(SECRET), false);
      return true;
    }
  );
});

test('una respuesta sin id se trata como error de almacenamiento', async () => {
  const client = { rpc: () => Promise.resolve({ data: null, error: null }) };
  const repo = createSnapshotRepo({ client });
  await assert.rejects(() => repo.publish({}), { code: 'storage_error' });
});

// --- 9b. Revisión PR #36: byPage, dominios autorizados ----------------------------------

test('páginas con responseAggregationType byPage se publican end-to-end', async () => {
  const transport = async (args) => {
    assert.equal(args.body.dimensions[0], 'page');
    assert.equal(args.body.aggregationType, 'auto');
    return { rows: [row('https://astisl.es/ficticia')], responseAggregationType: 'byPage' };
  };
  const { repo, records } = fakeRepo(55);
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'page', periodDays: 28, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 55);
  assert.equal(records.length, 1);
  assert.equal(records[0].p_dimension, 'page');
  assert.equal(records[0].p_aggregation_type, 'auto');
  assert.equal(records[0].p_response_aggregation_type, 'byPage');
  assert.equal(records[0].p_row_count, 1);
});

test('byNewsShowcasePanel no es un valor válido de respuesta', async () => {
  const transport = async () => ({ rows: [row('x')], responseAggregationType: 'byNewsShowcasePanel' });
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: PROPERTY, dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.code, 'invalid_response');
  assert.equal(records.length, 0);
});

test('un dominio no autorizado se rechaza sin ninguna llamada a Google', async () => {
  const { transport, calls } = okTransport();
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: { domain: 'evil.example', siteUrl: 'sc-domain:evil.example' },
    dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_request');
  assert.equal(calls.length, 0);
  assert.equal(records.length, 0);
});

test('un siteUrl que no coincide con la configuración de confianza se rechaza sin llamadas', async () => {
  const { transport, calls } = okTransport();
  const { repo, records } = fakeRepo();
  const result = await ingestSnapshot({
    property: { domain: 'astisl.es', siteUrl: 'sc-domain:otra-propiedad.example' },
    dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(result.code, 'invalid_request');
  assert.equal(calls.length, 0);
  assert.equal(records.length, 0);
});

test('el siteUrl enviado a Google sale de la configuración de confianza', async () => {
  const { transport, calls } = okTransport();
  const { repo } = fakeRepo();
  await ingestSnapshot({
    property: { domain: '3av.events', siteUrl: 'https://3av.events/' },
    dimension: 'query', periodDays: 7, clock: CLOCK, credentials: CREDENTIALS, transport, repo,
  });
  assert.equal(calls[0].siteUrl, 'https://3av.events/');
});

// --- 10. Sin escrituras directas en el código de GSC-06C ------------------------------

test('los módulos de GSC-06C no contienen escrituras directas a la tabla', async () => {
  const sources = await Promise.all([
    readFile(new URL('../lib/gsc/snapshot-ingest.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/gsc/snapshot-store.mjs', import.meta.url), 'utf8'),
  ]);
  for (const source of sources) {
    assert.equal(/\.from\(\s*['"`]gsc_dimension_snapshots/.test(source), false);
    assert.equal(/\.from\(/.test(source), false, 'snapshot modules must not call from()');
    assert.equal(/\.(insert|upsert|update|delete)\(/.test(source), false);
    assert.equal(source.includes(SECRET), false);
  }
});

test('el transporte de Google se llama solo con credenciales inyectadas, sin red propia', async () => {
  const { transport, calls } = okTransport();
  const rows = await fetchSnapshotRows({
    credentials: CREDENTIALS,
    siteUrl: PROPERTY.siteUrl,
    dimension: 'query',
    window: { startDate: '2026-10-28', endDate: '2026-11-03', days: 7 },
    transport,
  });
  assert.equal(rows.ok, true);
  assert.equal(calls[0].siteUrl, PROPERTY.siteUrl);
  assert.equal(calls[0].credentials, CREDENTIALS);
});
