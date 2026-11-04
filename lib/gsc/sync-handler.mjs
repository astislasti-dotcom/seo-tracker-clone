// GSC-02b · sincronización manual, solo propietario. Todas las dependencias se inyectan.
// Orden: método → propietario → parámetros → configuración de Supabase → credenciales
//        → propiedades → sincronización. Cualquier fallo previo a Google no hace llamadas.
// Dentro de cada propiedad: startRun escribe el registro inicial ('running') ANTES de
// consultar Google. La validación completa ocurre ANTES de escribir métricas (no antes de
// cualquier escritura: el registro inicial sí se escribe primero).
import { authorizeOwner } from '../auth/owner.mjs';
import { resolveProperty } from './config.mjs';
import { parseServiceAccount } from './credentials.mjs';
import { gscErrorMessage } from './errors.mjs';
import { parseSyncDays, planSyncWindow } from './sync-plan.mjs';
import { syncProperty } from './sync.mjs';

const STATUS_BY_CODE = Object.freeze({
  invalid_brand: 400,
  invalid_days: 400,
  property_not_configured: 503,
  credentials_missing: 503,
  credentials_invalid: 503,
  service_role_missing: 503,
  permission_denied: 403,
  property_not_found: 404,
  quota_exceeded: 429,
  unavailable: 503,
  invalid_response: 502,
  storage_error: 502,
  run_log_failed: 502,
  unknown: 502,
});

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorBody(code) {
  return { error: code, message: gscErrorMessage(code) };
}

export async function handleSync(request, deps) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = await authorizeOwner({
    authorization: request.headers.get('authorization'),
    ownerEmail: deps.ownerEmail,
    verifyAccessToken: deps.verifyAccessToken,
  });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const params = new URL(request.url).searchParams;
  const days = parseSyncDays(params.get('days'));
  if (days === null) return json(errorBody('invalid_request'), 400);

  // Propiedades a sincronizar: una marca o "all" (solo las claves que no empiezan por "_").
  const brandParam = params.get('brand');
  const domains =
    brandParam === 'all' ? Object.keys(deps.config ?? {}).filter((key) => !key.startsWith('_')) : [brandParam];
  if (domains.length === 0) return json(errorBody('invalid_brand'), 400);

  // Clave de servidor: sin ella no se hace ninguna llamada a Google ni a Supabase.
  if (!deps.supabaseUrl || !deps.serviceKey || typeof deps.createRepo !== 'function') {
    return json(errorBody('service_role_missing'), 503);
  }

  const credentials = parseServiceAccount(deps.rawCredentials);
  if (!credentials.ok) return json(errorBody(credentials.code), STATUS_BY_CODE[credentials.code]);

  // Todas las propiedades se validan antes de empezar: no hay sincronización parcial por configuración.
  const properties = [];
  for (const domain of domains) {
    const property = resolveProperty(deps.config, domain);
    if (!property.ok) return json(errorBody(property.code), STATUS_BY_CODE[property.code]);
    properties.push(property);
  }

  const now = deps.now ? deps.now() : new Date();
  const window = planSyncWindow(days, now);
  const repo = deps.createRepo({ url: deps.supabaseUrl, serviceKey: deps.serviceKey });

  const results = [];
  for (const property of properties) {
    results.push(
      await syncProperty({
        property: { domain: property.domain, brand: property.brand, siteUrl: property.siteUrl },
        window,
        credentials: credentials.credentials,
        transport: deps.transport,
        repo,
        now,
      })
    );
  }

  const ok = results.every((result) => result.ok);
  return json(
    {
      source: 'google_search_console',
      days,
      startDate: window.startDate,
      endDate: window.endDate,
      syncedAt: now.toISOString(),
      ok,
      results: results.map((result) =>
        result.ok
          ? result
          : { ...result, message: gscErrorMessage(result.code) }
      ),
    },
    ok ? 200 : 502
  );
}
