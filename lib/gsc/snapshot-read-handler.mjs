// GSC-06D · lectura owner-only de capturas vigentes. Todas las dependencias se inyectan.
// Orden: método → propietario → parámetros → clave de servidor → lectura → validación → respuesta.
// Solo SELECT en la vista. Nunca llama a Google ni escribe.
import { authorizeOwner } from '../auth/owner.mjs';
import { parseSnapshotParams, pageSnapshot, validateStoredSnapshot } from './snapshot-read.mjs';

const STATUS_BY_CODE = Object.freeze({
  invalid_brand: 400,
  invalid_dimension: 400,
  invalid_period: 400,
  invalid_limit: 400,
  invalid_offset: 400,
  service_role_missing: 503,
  storage_error: 502,
  invalid_response: 502,
});

const MESSAGES = Object.freeze({
  invalid_brand: 'La marca indicada no es válida. Usa astisl.es, 3av.events o all.',
  invalid_dimension: 'La dimensión indicada no es válida. Usa query o page.',
  invalid_period: 'El periodo indicado no es válido. Usa 7, 28 o 90 días.',
  invalid_limit: 'El límite indicado no es válido. Usa un entero entre 1 y 500.',
  invalid_offset: 'El desplazamiento indicado no es válido. Usa un entero entre 0 y 4999.',
  service_role_missing: 'La clave de servidor de Supabase no está configurada; no se pueden leer las capturas.',
  storage_error: 'No se pudieron leer las capturas almacenadas. Inténtalo de nuevo más tarde.',
  invalid_response: 'Las capturas almacenadas no tienen el formato esperado. No se muestran.',
});

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorBody(code) {
  return { error: code, message: MESSAGES[code] ?? MESSAGES.storage_error };
}

export async function handleSnapshotRead(request, deps) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const auth = await authorizeOwner({
    authorization: request.headers.get('authorization'),
    ownerEmail: deps.ownerEmail,
    verifyAccessToken: deps.verifyAccessToken,
  });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const params = parseSnapshotParams(new URL(request.url).searchParams, deps.config);
  if (!params.ok) return json(errorBody(params.code), STATUS_BY_CODE[params.code]);

  // Sin clave de servidor no se lee nada.
  if (!deps.supabaseUrl || !deps.serviceKey || typeof deps.createRepo !== 'function') {
    return json(errorBody('service_role_missing'), 503);
  }

  const repo = deps.createRepo({ url: deps.supabaseUrl, serviceKey: deps.serviceKey });

  // Lectura de todas las propiedades pedidas. Cualquier fallo corta la respuesta: no hay resultados parciales.
  const found = [];
  for (const domain of params.domains) {
    let row;
    try {
      row = await repo.readCurrent(domain, params.dimension, params.period);
    } catch {
      // Cualquier fallo de lectura se reduce a storage_error; el texto original no se reenvía.
      return json(errorBody('storage_error'), 502);
    }
    if (row === null || row === undefined) {
      found.push({ domain, missing: true });
      continue;
    }
    const validated = validateStoredSnapshot(row, { domain, dimension: params.dimension, period: params.period });
    if (!validated.ok) return json(errorBody('invalid_response'), 502);
    found.push({ domain, snapshot: validated.snapshot });
  }

  const snapshots = found
    .filter((entry) => !entry.missing)
    .map((entry) => pageSnapshot(entry.snapshot, { limit: params.limit, offset: params.offset }));
  const missing = found
    .filter((entry) => entry.missing)
    .map((entry) => ({ domain: entry.domain, dimension: params.dimension, periodDays: params.period }));

  return json(
    {
      brand: params.brand,
      dimension: params.dimension,
      periodDays: params.period,
      limit: params.limit,
      offset: params.offset,
      snapshots,
      missing,
    },
    200
  );
}
