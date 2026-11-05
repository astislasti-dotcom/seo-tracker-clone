// GSC-03 · lógica pura de lectura de métricas diarias. Sin red, sin Supabase, `now` inyectado.
//
// Reglas:
//   · Un día sin fila NO es cero: en la serie aparece con valores null y hasRow:false.
//   · CTR agregado = suma(clics) / suma(impresiones), solo si las impresiones son > 0.
//   · Posición: media ponderada por impresiones de avg_position, solo días con impresiones > 0.
//     Es una aproximación: la posición media de Search Console no es aditiva entre días.
//   · En `all` no se combinan posiciones entre dominios: cada propiedad conserva la suya y el
//     agregado combinado no tiene posición.
//   · Los totales incluyen filas provisionales; la cobertura indica cuántas hay.

import { parsePeriod } from './periods.mjs';

export const METRICS_BRANDS = Object.freeze(['astisl.es', '3av.events', 'all']);
export const DEFAULT_METRICS_PERIOD = 28;
export const POSITION_NOTE =
  'Posición media de Search Console, ponderada por impresiones. No es una posición en los resultados de Google.';

const DAY_MS = 86_400_000;

function isoFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Ventana de `days` días que termina HOY (UTC). Sin retardo fijo: el dato provisional se marca.
export function metricsWindow(days, now = new Date()) {
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    startDate: isoFromMs(todayMs - (days - 1) * DAY_MS),
    endDate: isoFromMs(todayMs),
    days,
  };
}

// Valida query params. brand: uno de METRICS_BRANDS. period: 7, 28 o 90 (por defecto 28).
export function parseMetricsParams(params) {
  const brand = params.get('brand');
  if (!METRICS_BRANDS.includes(brand)) return { ok: false, code: 'invalid_brand' };
  const rawPeriod = params.get('period');
  const period = rawPeriod === null ? DEFAULT_METRICS_PERIOD : parsePeriod(rawPeriod);
  if (!period) return { ok: false, code: 'invalid_period' };
  return { ok: true, brand, period };
}

// Serie completa de la ventana, ascendente, con un elemento por día.
// Un día sin fila aparece con hasRow:false y todos los valores en null.
export function buildSeries(rows, window) {
  const byDate = new Map(rows.map((row) => [row.metric_date, row]));
  const series = [];
  const startMs = Date.parse(`${window.startDate}T00:00:00Z`);
  for (let i = 0; i < window.days; i += 1) {
    const date = isoFromMs(startMs + i * DAY_MS);
    const row = byDate.get(date);
    if (!row) {
      series.push({ date, hasRow: false, dataState: null, clicks: null, impressions: null, ctr: null, avgPosition: null });
    } else {
      series.push({
        date,
        hasRow: true,
        dataState: row.data_state,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
        avgPosition: row.avg_position,
      });
    }
  }
  return series;
}

// Agregados sobre las filas de una propiedad. Sin filas → todos los totales en null.
export function aggregateRows(rows) {
  if (rows.length === 0) {
    return { clicks: null, impressions: null, ctr: null, averagePosition: null };
  }
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  let positionWeight = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    if (row.impressions > 0 && row.avg_position !== null) {
      weightedPosition += row.avg_position * row.impressions;
      positionWeight += row.impressions;
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    averagePosition: positionWeight > 0 ? weightedPosition / positionWeight : null,
  };
}

// Cobertura de la ventana: qué días existen, cuáles son finales y cuáles provisionales.
export function coverageOf(rows, window) {
  const finalDays = rows.filter((row) => row.data_state === 'final').length;
  const provisionalDays = rows.filter((row) => row.data_state === 'provisional').length;
  return {
    requestedDays: window.days,
    daysWithRows: rows.length,
    finalDays,
    provisionalDays,
    missingDays: window.days - rows.length,
  };
}

// Construye la respuesta de una propiedad a partir de sus filas ya leídas.
export function buildPropertyBlock({ domain, brand, rows, window }) {
  return {
    domain,
    brand,
    series: buildSeries(rows, window),
    totals: aggregateRows(rows),
    coverage: coverageOf(rows, window),
    containsProvisional: rows.some((row) => row.data_state === 'provisional'),
    positionNote: POSITION_NOTE,
  };
}

// Agregado combinado para `all`: sumas y CTR ponderado. Sin posición combinada.
// La cobertura se da por propiedad, no como suma, para no mezclar días de dos dominios.
export function buildCombinedBlock(allRows) {
  const totals = aggregateRows(allRows);
  return {
    totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.ctr, averagePosition: null },
    positionNote: 'Sin posición combinada: las posiciones se presentan por propiedad.',
  };
}
