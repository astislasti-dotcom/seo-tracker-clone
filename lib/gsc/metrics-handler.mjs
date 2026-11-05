// GSC-03 · lectura owner-only de métricas diarias almacenadas. Todas las dependencias se inyectan.
// Orden: método → propietario → parámetros → configuración → clave de servidor → lectura.
// Solo SELECT en gsc_daily_metrics. Nunca llama a Google ni escribe.
import { authorizeOwner } from '../auth/owner.mjs';
import { gscErrorMessage } from './errors.mjs';
import { buildCombinedBlock, buildPropertyBlock, metricsWindow, parseMetricsParams } from './metrics.mjs';

const STATUS_BY_CODE = Object.freeze({
  invalid_brand: 400,
  invalid_period: 400,
  service_role_missing: 503,
  storage_error: 502,
  invalid_response: 502,
  unknown: 502,
});

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Mensajes propios de lectura. No se reutilizan los de sincronización (errors.mjs), que hablan
// de guardar o de repetir la sincronización y no aplican a un endpoint que solo lee Supabase.
const READ_MESSAGES = Object.freeze({
  storage_error: 'No se pudieron leer las métricas almacenadas. Inténtalo de nuevo más tarde.',
  service_role_missing: 'La clave de servidor de Supabase no está configurada; no se pueden leer las métricas.',
  invalid_response: 'Los datos almacenados no tienen el formato esperado. No se muestran.',
});

function errorBody(code) {
  return { error: code, message: READ_MESSAGES[code] ?? gscErrorMessage(code) };
}

// Dominios a leer: una marca concreta, o todas las propiedades configuradas (sin claves "_").
function domainsFor(brand, config) {
  if (brand === 'all') return Object.keys(config ?? {}).filter((key) => !key.startsWith('_'));
  return Object.prototype.hasOwnProperty.call(config ?? {}, brand) ? [brand] : [];
}

// Fecha de actualización más reciente entre las filas leídas. Se llama así a propósito: no es
// la última sincronización correcta, que vive en gsc_sync_runs.
function latestFetchedAt(rows) {
  let latest = null;
  let latestMs = -Infinity;
  for (const row of rows) {
    const ms = Date.parse(row.fetched_at);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = row.fetched_at;
    }
  }
  return latest;
}

export async function handleMetrics(request, deps) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const auth = await authorizeOwner({
    authorization: request.headers.get('authorization'),
    ownerEmail: deps.ownerEmail,
    verifyAccessToken: deps.verifyAccessToken,
  });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const params = parseMetricsParams(new URL(request.url).searchParams);
  if (!params.ok) return json(errorBody(params.code), STATUS_BY_CODE[params.code]);

  const domains = domainsFor(params.brand, deps.config);
  if (domains.length === 0) return json(errorBody('invalid_brand'), 400);

  // Sin clave de servidor no se lee nada: 503 antes de cualquier consulta.
  if (!deps.supabaseUrl || !deps.serviceKey || typeof deps.createRepo !== 'function') {
    return json(errorBody('service_role_missing'), 503);
  }

  const now = deps.now ? deps.now() : new Date();
  const window = metricsWindow(params.period, now);
  const repo = deps.createRepo({ url: deps.supabaseUrl, serviceKey: deps.serviceKey });

  let rows;
  try {
    rows = await repo.readDaily(domains, window.startDate, window.endDate);
  } catch {
    return json(errorBody('storage_error'), 502);
  }

  // Como mucho una fila por propiedad y día (clave primaria). Más filas indican datos corruptos.
  if (rows.length > domains.length * params.period) return json(errorBody('invalid_response'), 502);

  const properties = domains.map((domain) =>
    buildPropertyBlock({
      domain,
      brand: deps.config[domain].brand ?? domain,
      rows: rows.filter((row) => row.property_domain === domain),
      window,
    })
  );

  const body = {
    source: 'supabase_gsc_daily_metrics',
    brand: params.brand,
    period: params.period,
    startDate: window.startDate,
    endDate: window.endDate,
    lastMetricsFetchedAt: latestFetchedAt(rows),
    properties,
    generatedAt: now.toISOString(),
  };
  if (params.brand === 'all') body.combined = buildCombinedBlock(rows);

  return json(body, 200);
}
