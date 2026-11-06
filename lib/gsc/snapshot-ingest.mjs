// GSC-06C · ingesta offline de snapshots de consultas y páginas (sin red propia).
//
// Escritura: SOLO mediante la función public.gsc_publish_dimension_snapshot (PR #35), a través
// del repositorio inyectado (snapshot-store.mjs). Nunca inserciones directas.
//
// Orden dentro de cada snapshot:
//   1) Se valida la entrada. Si algo falla, no hay llamada a Google ni escritura.
//   2) requested_at se fija con el reloj del servidor ANTES de llamar a Google.
//   3) Se lee y valida la respuesta completa. Cualquier fila dudosa invalida el snapshot entero.
//   4) Una sola llamada a la función: inserta y aplica la retención en una transacción.
//
// Todas las dependencias se inyectan: transporte de Google, repositorio y reloj. Sin credenciales
// reales ni red en las pruebas. Los errores salen como códigos fijos; nunca se reenvía el texto
// original de Google ni de Supabase.
import { ALLOWED_PERIODS } from './constants.mjs';
import { mapGoogleError } from './errors.mjs';
import { periodWindow } from './periods.mjs';

export const SNAPSHOT_DIMENSIONS = Object.freeze(['query', 'page']);
export const SNAPSHOT_PERIODS = ALLOWED_PERIODS;
// Igual que el CHECK row_count <= 5000 de la propuesta: nunca se pide más de lo que se puede guardar.
export const SNAPSHOT_ROW_LIMIT = 5000;
export const SNAPSHOT_MAX_KEY_LENGTH = 2048;
const MAX_POSITION = 99999;

// Consultas: 'byProperty'. Páginas: 'auto' (Google no admite 'byProperty' al agrupar por página).
const AGGREGATION = Object.freeze({ query: 'byProperty', page: 'auto' });
// Valores documentados de responseAggregationType en searchanalytics.query (solo respuesta).
const RESPONSE_AGGREGATIONS = Object.freeze(['auto', 'byPage', 'byProperty']);

// Propiedades autorizadas y su siteUrl de confianza. Cualquier otro dominio, o un siteUrl que no
// coincida, se rechaza antes de llamar a Google.
const ALLOWED_PROPERTIES = Object.freeze({
  'astisl.es': Object.freeze({ siteUrl: 'sc-domain:astisl.es' }),
  '3av.events': Object.freeze({ siteUrl: 'https://3av.events/' }),
});

export function aggregationFor(dimension) {
  return AGGREGATION[dimension] ?? null;
}

// Petición a Search Console: una dimensión, datos finales, sin filtros.
export function snapshotBody({ dimension, window }) {
  return {
    startDate: window.startDate,
    endDate: window.endDate,
    dataState: 'final',
    dimensions: [dimension],
    rowLimit: SNAPSHOT_ROW_LIMIT,
    aggregationType: aggregationFor(dimension),
  };
}

// Valida todas las filas. Devuelve el payload con la forma de la propuesta: {k, c, i, ctr, p}.
export function validateSnapshotRows(rows) {
  const invalid = { ok: false, code: 'invalid_response' };
  if (!Array.isArray(rows) || rows.length > SNAPSHOT_ROW_LIMIT) return invalid;

  const seen = new Set();
  const payload = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return invalid;
    const keys = row.keys;
    if (!Array.isArray(keys) || keys.length !== 1 || typeof keys[0] !== 'string') return invalid;
    const key = keys[0];
    if (key.length === 0 || key.length > SNAPSHOT_MAX_KEY_LENGTH) return invalid;
    if (seen.has(key)) return invalid;
    seen.add(key);

    const { clicks, impressions, ctr, position } = row;
    if (!Number.isInteger(clicks) || clicks < 0) return invalid;
    if (!Number.isInteger(impressions) || impressions < 0) return invalid;
    if (clicks > impressions) return invalid;
    if (typeof ctr !== 'number' || !Number.isFinite(ctr) || ctr < 0 || ctr > 1) return invalid;
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > MAX_POSITION) {
      return invalid;
    }

    payload.push({ k: key, c: clicks, i: impressions, ctr, p: position });
  }
  return { ok: true, rows: payload };
}

// Lee un snapshot de Google. Sin filas no es un error: significa que no hay datos finales.
export async function fetchSnapshotRows({ credentials, siteUrl, dimension, window, transport }) {
  if (!SNAPSHOT_DIMENSIONS.includes(dimension)) return { ok: false, code: 'invalid_request' };

  let data;
  try {
    data = await transport({ credentials, siteUrl, body: snapshotBody({ dimension, window }) });
  } catch (error) {
    return { ok: false, code: mapGoogleError(error).code };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'invalid_response' };
  }
  const validated = validateSnapshotRows(data.rows ?? []);
  if (!validated.ok) return { ok: false, code: validated.code };

  const responseAggregationType = data.responseAggregationType ?? null;
  if (responseAggregationType !== null && !RESPONSE_AGGREGATIONS.includes(responseAggregationType)) {
    return { ok: false, code: 'invalid_response' };
  }
  return { ok: true, rows: validated.rows, responseAggregationType };
}

// Un snapshot: una combinación propiedad × dimensión × periodo.
export async function ingestSnapshot({ property, dimension, periodDays, clock, credentials, transport, repo }) {
  const base = { ok: false, domain: property?.domain ?? null, dimension, periodDays };
  const invalid = { ...base, code: 'invalid_request' };

  // Dominio y siteUrl deben estar en la lista de confianza: si no, cero llamadas a Google.
  const trusted = Object.hasOwn(ALLOWED_PROPERTIES, property?.domain) ? ALLOWED_PROPERTIES[property.domain] : null;
  if (!trusted || property.siteUrl !== trusted.siteUrl) return invalid;
  if (!SNAPSHOT_DIMENSIONS.includes(dimension) || !SNAPSHOT_PERIODS.includes(periodDays)) return invalid;
  if (typeof transport !== 'function' || !repo || typeof repo.publish !== 'function') return invalid;
  if (typeof clock !== 'function') return invalid;

  // Reloj del servidor, fijado antes de cualquier llamada a Google.
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return invalid;
  const requestedAt = now.toISOString();
  const window = periodWindow(periodDays, now);

  const fetched = await fetchSnapshotRows({
    credentials,
    siteUrl: trusted.siteUrl,
    dimension,
    window,
    transport,
  });
  if (!fetched.ok) return { ...base, code: fetched.code, window };

  const rowCount = fetched.rows.length;
  const truncated = rowCount >= SNAPSHOT_ROW_LIMIT;
  // Nombres exactos de los parámetros de gsc_publish_dimension_snapshot (ver snapshot-store.mjs).
  const record = {
    p_property_domain: property.domain,
    p_dimension: dimension,
    p_period_days: periodDays,
    p_requested_at: requestedAt,
    p_window_start: window.startDate,
    p_window_end: window.endDate,
    p_data_state: 'final',
    p_aggregation_type: aggregationFor(dimension),
    p_response_aggregation_type: fetched.responseAggregationType,
    p_row_limit: SNAPSHOT_ROW_LIMIT,
    p_row_count: rowCount,
    p_truncated: truncated,
    p_payload: fetched.rows,
  };

  let id;
  try {
    id = await repo.publish(record);
  } catch {
    return { ...base, code: 'storage_error', window };
  }

  return {
    ...base,
    ok: true,
    id,
    window,
    requestedAt,
    rowCount,
    truncated,
    responseAggregationType: fetched.responseAggregationType,
  };
}

// Todas las combinaciones de todas las propiedades, en serie. Un fallo no detiene las demás:
// cada snapshot es independiente y su resultado queda en la lista.
export async function ingestAllSnapshots({ properties, clock = () => new Date(), credentials, transport, repo }) {
  const results = [];
  for (const property of properties) {
    for (const dimension of SNAPSHOT_DIMENSIONS) {
      for (const periodDays of SNAPSHOT_PERIODS) {
        results.push(
          await ingestSnapshot({ property, dimension, periodDays, clock, credentials, transport, repo })
        );
      }
    }
  }
  return { ok: results.every((result) => result.ok), results };
}
