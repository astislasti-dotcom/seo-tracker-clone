// GSC-06D · benchmark SINTÉTICO y offline de la lectura de capturas. No es rendimiento real de
// PostgREST ni de red: mide validación, orden, paginación y tamaño de la respuesta JSON con
// datos ficticios (dominios .invalid). Ejecución manual: node scripts/bench-gsc06d.mjs
import { validateStoredSnapshot, pageSnapshot } from '../lib/gsc/snapshot-read.mjs';

const END = '2026-11-03';
const START = '2026-10-28';

function syntheticPayload(kind, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const key = kind === 'query' ? `consulta sintetica ${String(i).padStart(4, '0')}` : `https://ejemplo.invalid/pagina-${String(i).padStart(4, '0')}`;
    const impressions = 1000 + ((i * 7919) % 5000);
    const clicks = (i * 31) % 200;
    out.push({ k: key, c: Math.min(clicks, impressions), i: impressions, ctr: Math.min(clicks, impressions) / impressions, p: 1 + (i % 90) });
  }
  return out;
}

function storedRow(domain, dimension, payload) {
  return {
    property_domain: domain,
    dimension,
    period_days: 7,
    requested_at: '2026-11-04T08:00:00.000Z',
    window_start: START,
    window_end: END,
    data_state: 'final',
    row_count: payload.length,
    truncated: payload.length >= 5000,
    payload,
  };
}

const ms = (t0) => Number((performance.now() - t0).toFixed(2));
const mb = (bytes) => Number((bytes / 1048576).toFixed(3));

for (const kind of ['query', 'page']) {
  const payload = syntheticPayload(kind, 5000);
  const row = storedRow('astisl.es', kind, payload);
  const expected = { domain: 'astisl.es', dimension: kind, period: 7 };

  const heapBefore = process.memoryUsage().heapUsed;
  let t = performance.now();
  const validated = validateStoredSnapshot(row, expected);
  const validateMs = ms(t);
  if (!validated.ok) throw new Error('benchmark: captura sintética no válida');

  for (const limit of [100, 500]) {
    t = performance.now();
    const page = pageSnapshot(validated.snapshot, { limit, offset: 0 });
    const pageMs = ms(t);
    const bytes = Buffer.byteLength(JSON.stringify(page), 'utf8');
    console.log(JSON.stringify({ dimension: kind, rowsInSource: 5000, limit, validateMs, sortAndPageMs: pageMs, responseRows: page.returned, responseBytes: bytes, responseMiB: mb(bytes) }));
  }

  const sourceBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const heapAfter = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({ dimension: kind, sourcePayloadBytes: sourceBytes, sourcePayloadMiB: mb(sourceBytes), approxHeapDeltaMiB: mb(Math.max(0, heapAfter - heapBefore)) }));
}
