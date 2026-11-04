// GSC-02b · planificación y validación puras de la sincronización diaria.
// Sin red, sin Supabase, sin reloj implícito: `now` se inyecta.
//
// Regla de estado (acordada en el issue #20):
//   · final      → el día aparece en una consulta con dataState 'final'.
//   · provisional → el día aparece solo en la consulta 'all'.
// No se asume ningún retardo fijo: la clasificación sale de la propia respuesta de Google.

export const SYNC_ALLOWED_DAYS = Object.freeze([28, 90]);
export const SYNC_DEFAULT_DAYS = 90;
// Una consulta por bloque y por estado: como mucho 28 filas por consulta.
export const BLOCK_DAYS = 28;
export const MAX_POSITION = 99999;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isoFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && isoFromMs(ms) === value;
}

// Días de la sincronización. Ausente → valor por defecto. Solo valores permitidos.
export function parseSyncDays(value) {
  if (value === null || value === undefined || value === '') return SYNC_DEFAULT_DAYS;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return SYNC_ALLOWED_DAYS.includes(n) ? n : null;
}

// Ventana de `days` días que termina HOY (UTC). Sin retardo fijo.
export function planSyncWindow(days, now = new Date()) {
  if (!SYNC_ALLOWED_DAYS.includes(days)) throw new RangeError('unsupported sync window');
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayMs - (days - 1) * DAY_MS;
  return { startDate: isoFromMs(startMs), endDate: isoFromMs(todayMs), days };
}

// Divide [startDate, endDate] en bloques contiguos de hasta BLOCK_DAYS días, sin solapes.
export function splitBlocks(startDate, endDate) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new RangeError('invalid dates');
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (endMs < startMs) throw new RangeError('end before start');

  const blocks = [];
  for (let cursor = startMs; cursor <= endMs; cursor += BLOCK_DAYS * DAY_MS) {
    const last = Math.min(cursor + (BLOCK_DAYS - 1) * DAY_MS, endMs);
    blocks.push({ startDate: isoFromMs(cursor), endDate: isoFromMs(last) });
  }
  return blocks;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// Valida las filas de UNA consulta de bloque (dimensión date). Cualquier fila dudosa
// invalida la respuesta entera: no hay escritura parcial a partir de datos inciertos.
export function validateDailyRows(rows, block) {
  const invalid = { ok: false, code: 'invalid_response' };
  if (!Array.isArray(rows)) return invalid;

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!isPlainObject(row)) return invalid;
    const keys = row.keys;
    if (!Array.isArray(keys) || keys.length !== 1 || !isIsoDate(keys[0])) return invalid;
    const date = keys[0];
    if (date < block.startDate || date > block.endDate) return invalid;
    if (seen.has(date)) return invalid;
    seen.add(date);

    const { clicks, impressions, ctr, position } = row;
    if (!nonNegativeInteger(clicks) || !nonNegativeInteger(impressions)) return invalid;
    if (clicks > impressions) return invalid;
    if (typeof ctr !== 'number' || !Number.isFinite(ctr) || ctr < 0 || ctr > 1) return invalid;
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > MAX_POSITION) {
      return invalid;
    }

    out.push({ metricDate: date, clicks, impressions, ctr, avgPosition: position });
  }
  return { ok: true, rows: out };
}

// Combina la respuesta 'final' y la 'all' de un mismo bloque.
// Un día presente en 'final' es final (sus valores vienen de 'final'). El resto de días de
// 'all' son provisionales. Nunca se toman valores provisionales para un día final.
export function classifyDailyRows(finalRows, allRows) {
  const finalDates = new Set(finalRows.map((row) => row.metricDate));
  const merged = finalRows.map((row) => ({ ...row, dataState: 'final' }));
  for (const row of allRows) {
    if (!finalDates.has(row.metricDate)) merged.push({ ...row, dataState: 'provisional' });
  }
  return merged.sort((a, b) => (a.metricDate < b.metricDate ? -1 : a.metricDate > b.metricDate ? 1 : 0));
}
