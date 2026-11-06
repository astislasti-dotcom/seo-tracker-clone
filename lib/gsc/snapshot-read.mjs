// GSC-06D · lógica pura de lectura de capturas vigentes. Sin red, sin Supabase, sin Google.
//
// Reglas:
//   · Ausencia de captura vigente = estado normal ('missing'), no un error.
//   · Cada captura se valida completa antes de devolverse. Si una falla, no se devuelve nada
//     parcial: el handler responde 502 invalid_response.
//   · Filas ordenadas por clics desc, impresiones desc y clave asc (orden estable) ANTES de paginar.
//   · Con brand=all, cada dominio conserva su captura. Nunca se suman posiciones ni se mezclan
//     consultas de propiedades distintas.
//   · Las consultas y URLs se devuelven como texto plano; el cliente debe escaparlas.

export const SNAPSHOT_DIMENSIONS = Object.freeze(['query', 'page']);
export const SNAPSHOT_PERIODS = Object.freeze([7, 28, 90]);
// Dominios que la ingesta admite (GSC-06C). Deben existir además en config/gsc-properties.json.
export const SNAPSHOT_DOMAINS = Object.freeze(['astisl.es', '3av.events']);

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
// Una captura tiene como mucho 5.000 filas: un offset por encima de 4.999 nunca tiene resultados.
export const MAX_OFFSET = 4999;
export const ROW_LIMIT_AT_SOURCE = 5000;
const MAX_KEY_LENGTH = 2048;
const MAX_POSITION = 99999;
const DAY_MS = 86_400_000;

const DECIMAL_INT = /^\d+$/;

// Un parámetro entero: solo dígitos, dentro de [min, max]. Sin signos ni decimales ni espacios.
function parseBoundedInt(raw, { min, max, fallback }) {
  if (raw === null) return { ok: true, value: fallback };
  if (!DECIMAL_INT.test(raw)) return { ok: false };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false };
  return { ok: true, value };
}

// Propiedades a leer según el parámetro brand. Solo dominios admitidos y presentes en la config.
export function domainsFor(brand, config) {
  const configured = (domain) =>
    SNAPSHOT_DOMAINS.includes(domain) &&
    Object.prototype.hasOwnProperty.call(config ?? {}, domain) &&
    typeof config[domain]?.siteUrl === 'string';
  if (brand === 'all') return SNAPSHOT_DOMAINS.filter(configured);
  return configured(brand) ? [brand] : [];
}

// Valida query params. Devuelve el conjunto de parámetros o un código de error fijo.
export function parseSnapshotParams(params, config) {
  const brandRaw = params.get('brand');
  const brand = brandRaw === 'all' || SNAPSHOT_DOMAINS.includes(brandRaw) ? brandRaw : null;
  if (brand === null) return { ok: false, code: 'invalid_brand' };
  const domains = domainsFor(brand, config);
  if (domains.length === 0) return { ok: false, code: 'invalid_brand' };

  const dimension = params.get('dimension');
  if (!SNAPSHOT_DIMENSIONS.includes(dimension)) return { ok: false, code: 'invalid_dimension' };

  const periodRaw = params.get('period');
  const period = periodRaw !== null && /^\d+$/.test(periodRaw) ? Number(periodRaw) : null;
  if (period === null || !SNAPSHOT_PERIODS.includes(period)) return { ok: false, code: 'invalid_period' };

  const limit = parseBoundedInt(params.get('limit'), { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  if (!limit.ok) return { ok: false, code: 'invalid_limit' };

  const offset = parseBoundedInt(params.get('offset'), { min: 0, max: MAX_OFFSET, fallback: 0 });
  if (!offset.ok) return { ok: false, code: 'invalid_offset' };

  return { ok: true, brand, domains, dimension, period, limit: limit.value, offset: offset.value };
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetweenInclusive(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) + 1;
}

// Valida una fila almacenada con la forma {k, c, i, ctr, p}. Devuelve la fila normalizada o null.
function validStoredRow(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
  const { k, c, i, ctr, p } = item;
  if (typeof k !== 'string' || k.length === 0 || k.length > MAX_KEY_LENGTH) return null;
  if (!Number.isInteger(c) || c < 0) return null;
  if (!Number.isInteger(i) || i < 0) return null;
  if (c > i) return null;
  if (typeof ctr !== 'number' || !Number.isFinite(ctr) || ctr < 0 || ctr > 1) return null;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > MAX_POSITION) return null;
  return { key: k, clicks: c, impressions: i, ctr, position: p };
}

// Valida una captura almacenada completa frente a lo que se pidió. Devuelve { ok, snapshot } o { ok:false }.
export function validateStoredSnapshot(row, expected) {
  const invalid = { ok: false };
  if (row === null || typeof row !== 'object') return invalid;
  if (row.property_domain !== expected.domain) return invalid;
  if (row.dimension !== expected.dimension) return invalid;
  if (row.period_days !== expected.period) return invalid;
  if (row.data_state !== 'final') return invalid;
  if (!isIsoDate(row.window_start) || !isIsoDate(row.window_end)) return invalid;
  if (row.window_end < row.window_start) return invalid;
  if (daysBetweenInclusive(row.window_start, row.window_end) !== expected.period) return invalid;

  const rowCount = row.row_count;
  if (!Number.isInteger(rowCount) || rowCount < 0 || rowCount > ROW_LIMIT_AT_SOURCE) return invalid;
  if (typeof row.truncated !== 'boolean' || row.truncated !== rowCount >= ROW_LIMIT_AT_SOURCE) return invalid;
  if (!Array.isArray(row.payload) || row.payload.length !== rowCount) return invalid;

  const seen = new Set();
  const rows = [];
  for (const item of row.payload) {
    const normalized = validStoredRow(item);
    if (normalized === null) return invalid;
    if (seen.has(normalized.key)) return invalid;
    seen.add(normalized.key);
    rows.push(normalized);
  }

  return {
    ok: true,
    snapshot: {
      domain: row.property_domain,
      dimension: row.dimension,
      periodDays: row.period_days,
      window: { startDate: row.window_start, endDate: row.window_end },
      requestedAt: typeof row.requested_at === 'string' ? row.requested_at : null,
      dataState: row.data_state,
      rowCount,
      truncatedAtSource: row.truncated,
      rows,
    },
  };
}

// Orden estable: clics desc, impresiones desc, clave asc. Se aplica antes de paginar.
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.clicks !== a.clicks) return b.clicks - a.clicks;
    if (b.impressions !== a.impressions) return b.impressions - a.impressions;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
}

// Página de una captura validada: ordena, corta y añade los metadatos de paginación.
export function pageSnapshot(snapshot, { limit, offset }) {
  const sorted = sortRows(snapshot.rows);
  const page = sorted.slice(offset, offset + limit);
  const totalAvailable = sorted.length;
  return {
    domain: snapshot.domain,
    dimension: snapshot.dimension,
    periodDays: snapshot.periodDays,
    window: snapshot.window,
    requestedAt: snapshot.requestedAt,
    dataState: snapshot.dataState,
    rowCount: snapshot.rowCount,
    truncatedAtSource: snapshot.truncatedAtSource,
    limit,
    offset,
    returned: page.length,
    totalAvailable,
    hasMore: offset + page.length < totalAvailable,
    rows: page.map((r) => ({
      key: r.key,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
  };
}
