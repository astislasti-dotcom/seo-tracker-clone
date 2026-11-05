// GSC-04 · lógica pura de la vista de rendimiento GSC. Sin React, sin red, sin reloj propio.
// Recibe la respuesta de GET /api/gsc/metrics y devuelve exactamente lo que pinta el panel.
//
// Reglas:
//   · Un día sin fila es null, nunca 0. El gráfico corta la línea en ese día.
//   · En «Todas» se suman solo las métricas aditivas (clics, impresiones). El CTR sale de los
//     totales. La posición no se combina entre marcas: se muestra por marca.
//   · Un día con datos de una sola marca en «Todas» es PARCIAL: se marca en el gráfico y en la
//     tabla, indicando qué marca aporta datos.
//   · Si la respuesta no cumple el contrato (marca, periodo, fechas, cifras, cobertura), no se
//     pinta ninguna cifra: estado INVALID.
//   · No hay comparativa con periodo anterior: la API no la ofrece, se avisa en vez de inventarla.

import { brandLabel } from '../keywords/labels.mjs';

export const VIEW_STATES = Object.freeze({
  LOADING: 'loading',
  OK: 'ok',
  EMPTY: 'empty',
  AUTH: 'auth',
  FORBIDDEN: 'forbidden',
  CONFIG: 'config',
  ERROR: 'error',
  NETWORK: 'network',
  INVALID: 'invalid',
});

export const ALLOWED_PERIODS = Object.freeze([7, 28, 90]);
const ALL_DOMAINS = Object.freeze(['3av.events', 'astisl.es']);

// Espacio fino: el formato español de Intl pone un espacio no separable antes del %.
// useGrouping 'always': el español omite el separador en cuatro cifras por defecto (8.232).
const FORMAT_COUNT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
const FORMAT_PCT = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FORMAT_POS = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const FORMAT_DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FORMAT_FETCHED = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonNeg = (v) => isNum(v) && v >= 0;
const isNullOr = (v, check) => v === null || check(v);
const isMissing = (v) => v === null || v === undefined;

export function formatCount(v) {
  return isMissing(v) ? '—' : FORMAT_COUNT.format(v);
}

export function formatCtr(v) {
  return isMissing(v) ? '—' : FORMAT_PCT.format(v);
}

export function formatPosition(v) {
  return isMissing(v) ? '—' : FORMAT_POS.format(v);
}

export function formatDay(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? FORMAT_DAY.format(ms) : '';
}

export function formatFetchedAt(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? FORMAT_FETCHED.format(ms) : null;
}

// Estado de la interfaz ante un error HTTP. 401/403/503 tienen mensajes propios; el resto, genérico.
export function stateFromHttp(status) {
  if (status === 401) return VIEW_STATES.AUTH;
  if (status === 403) return VIEW_STATES.FORBIDDEN;
  if (status === 503) return VIEW_STATES.CONFIG;
  return VIEW_STATES.ERROR;
}

// Fecha ISO de la posición `i` a partir de `start` (YYYY-MM-DD), o null si no es válida.
function isoAt(start, i) {
  const ms = Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + i * 86_400_000).toISOString().slice(0, 10);
}

function validDay(d, expectedDate) {
  if (!d || typeof d !== 'object') return false;
  if (d.date !== expectedDate || typeof d.hasRow !== 'boolean') return false;
  if (d.hasRow) {
    if (!isNonNeg(d.clicks) || !isNonNeg(d.impressions)) return false;
    if (!isNullOr(d.ctr, isNonNeg) || !isNullOr(d.avgPosition, (v) => isNum(v) && v > 0)) return false;
    return d.dataState === 'final' || d.dataState === 'provisional';
  }
  return d.clicks === null && d.impressions === null && d.ctr === null && d.avgPosition === null && d.dataState === null;
}

function validTotals(t) {
  return (
    t &&
    typeof t === 'object' &&
    isNullOr(t.clicks, isNonNeg) &&
    isNullOr(t.impressions, isNonNeg) &&
    isNullOr(t.ctr, isNonNeg) &&
    isNullOr(t.averagePosition, (v) => isNum(v) && v > 0)
  );
}

function validCoverage(c, period, series) {
  if (!c || typeof c !== 'object') return false;
  const present = series.filter((d) => d.hasRow).length;
  const provisional = series.filter((d) => d.hasRow && d.dataState === 'provisional').length;
  const final = present - provisional;
  return (
    c.requestedDays === period &&
    c.daysWithRows === present &&
    c.finalDays === final &&
    c.provisionalDays === provisional &&
    c.missingDays === period - present
  );
}

// Comprobación completa del contrato de /api/gsc/metrics para la petición actual.
export function isValidPayload(payload, brand, period) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.brand !== brand || payload.period !== period) return false;
  if (!ALLOWED_PERIODS.includes(period)) return false;
  if (!Array.isArray(payload.properties) || payload.properties.length === 0) return false;

  const expectedDomains = brand === 'all' ? [...ALL_DOMAINS] : [brand];
  const domains = payload.properties.map((p) => p?.domain);
  if (domains.length !== expectedDomains.length) return false;
  if (new Set(domains).size !== domains.length) return false;
  if (!expectedDomains.every((d) => domains.includes(d))) return false;

  const start = payload.startDate;
  if (isMissing(isoAt(start, 0)) || isoAt(start, period - 1) !== payload.endDate) return false;

  for (const p of payload.properties) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.series) || p.series.length !== period) return false;
    for (let i = 0; i < period; i += 1) {
      if (!validDay(p.series[i], isoAt(start, i))) return false;
    }
    if (!validTotals(p.totals) || !validCoverage(p.coverage, period, p.series)) return false;
  }

  if (brand === 'all') {
    if (!payload.combined || !validTotals(payload.combined.totals)) return false;
  }
  return true;
}

// Punto normalizado para el gráfico y la tabla diaria de una sola marca.
function singlePoint(d, property) {
  const provisional = d.hasRow && d.dataState === 'provisional';
  return {
    date: d.date,
    hasRow: d.hasRow,
    clicks: d.hasRow ? d.clicks : null,
    impressions: d.hasRow ? d.impressions : null,
    ctr: d.hasRow ? d.ctr : null,
    provisional,
    brandsWithRows: d.hasRow ? 1 : 0,
    brandCount: 1,
    partial: false,
    brandLabels: d.hasRow ? [brandLabel(property.domain)] : [],
  };
}

export function singleSeries(property) {
  return property.series.map((d) => singlePoint(d, property));
}

// Serie combinada de «Todas»: suma clics e impresiones por día. Si ninguna marca tiene fila,
// el día es null. Si solo una marca tiene fila, el día es PARCIAL y se indica qué marca aporta.
export function combinedSeries(properties) {
  const length = properties[0].series.length;
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const date = properties[0].series[i].date;
    const present = properties.map((p) => ({ property: p, day: p.series[i] })).filter((x) => x.day.hasRow);
    if (present.length === 0) {
      out.push({
        date,
        hasRow: false,
        clicks: null,
        impressions: null,
        ctr: null,
        provisional: false,
        brandsWithRows: 0,
        brandCount: properties.length,
        partial: false,
        brandLabels: [],
      });
      continue;
    }
    const clicks = present.reduce((sum, x) => sum + x.day.clicks, 0);
    const impressions = present.reduce((sum, x) => sum + x.day.impressions, 0);
    out.push({
      date,
      hasRow: true,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      provisional: present.some((x) => x.day.dataState === 'provisional'),
      brandsWithRows: present.length,
      brandCount: properties.length,
      partial: present.length < properties.length,
      brandLabels: present.map((x) => brandLabel(x.property.domain)),
    });
  }
  return out;
}

// Techo "redondo" para la escala Y: 1, 2, 2,5 ó 5 por potencia de diez, siempre ≥ value.
export function niceCeil(value) {
  if (!isNum(value) || value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * base >= value) return m * base;
  }
  return 10 * base;
}

// Geometría del gráfico de una métrica. Segmentos continuos (se cortan en null), huecos para los
// días sin registro, cuadrados para los días parciales de «Todas», y referencias Y (0, mitad, máximo)
// con la escala redondeada. Las posiciones X son las mismas para todos los elementos.
export function chartGeometry(series, key, { width = 600, height = 160, pad = 8 } = {}) {
  const n = series.length;
  const values = series.map((p) => p[key]).filter(isNum);
  const max = niceCeil(values.length > 0 ? Math.max(...values, 1) : 1);
  const xAt = (i) => (n <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const yAt = (v) => height - pad - (v / max) * (height - 2 * pad);

  const segments = [];
  let current = [];
  series.forEach((p, i) => {
    if (isNum(p[key])) {
      current.push(`${current.length === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(p[key]).toFixed(1)}`);
    } else if (current.length > 0) {
      segments.push(current.join(' '));
      current = [];
    }
  });
  if (current.length > 0) segments.push(current.join(' '));

  const gaps = series.flatMap((p, i) => (p.hasRow ? [] : [{ x: xAt(i).toFixed(1), y: (height - pad).toFixed(1) }]));
  const points = series.flatMap((p, i) =>
    isNum(p[key]) && !p.partial ? [{ x: xAt(i).toFixed(1), y: yAt(p[key]).toFixed(1) }] : []
  );
  const partials = series.flatMap((p, i) =>
    isNum(p[key]) && p.partial ? [{ x: xAt(i).toFixed(1), y: yAt(p[key]).toFixed(1) }] : []
  );
  const ticks = [max, max / 2, 0].map((value) => ({ value, y: yAt(value).toFixed(1), label: formatCount(value) }));
  const xs = series.map((_, i) => Number(xAt(i).toFixed(1)));
  return { segments, gaps, points, partials, ticks, xs, max, width, height, pad };
}

// Índice del día más cercano a una posición X en el viewBox del gráfico (pointer o tacto).
export function indexAtX(vbX, n, { width = 600, pad = 8 } = {}) {
  if (n <= 1) return 0;
  const raw = ((vbX - pad) * (n - 1)) / (width - 2 * pad);
  return Math.min(n - 1, Math.max(0, Math.round(raw)));
}

// Movimiento por teclado: flechas ±1, Inicio y Fin. Siempre dentro del rango.
export function moveIndex(current, key, n) {
  if (n <= 0) return null;
  const from = current === null || current === undefined ? n - 1 : current;
  if (key === 'ArrowLeft') return Math.max(0, from - 1);
  if (key === 'ArrowRight') return Math.min(n - 1, from + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return current ?? null;
}

const FORMAT_LONG_DAY = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Lectura de un día: fecha, valor, ámbito y estado. Un día sin registro nunca se muestra como 0.
export function describeDay(point, metricKey, metricLabel) {
  const ms = Date.parse(`${point.date}T00:00:00Z`);
  const date = Number.isFinite(ms) ? FORMAT_LONG_DAY.format(ms) : point.date;
  if (!point.hasRow || !isNum(point[metricKey])) {
    return { date, value: 'Sin registro', scope: '', provisional: false, missing: true, text: `${date}: sin registro en Search Console.` };
  }
  const value = formatCount(point[metricKey]);
  const labels = point.brandLabels ?? [];
  let scope = '';
  if (point.partial) scope = `Solo ${labels.join(' + ')} (parcial)`;
  else if (point.brandCount > 1) scope = labels.join(' + ');
  else if (labels.length > 0) scope = labels.join(' + ');
  const provisional = point.provisional === true;
  const parts = [`${date}`, `${metricLabel}: ${value}`];
  if (scope) parts.push(scope);
  if (provisional) parts.push('provisional');
  return { date, value, scope, provisional, missing: false, text: parts.join('. ') + '.' };
}

// Cobertura por marca: definitivos, provisionales y sin registro. Nunca se mezcla con ceros.
export function coverageLine(property) {
  const c = property.coverage;
  return {
    domain: property.domain,
    label: brandLabel(property.domain),
    text: `${c.finalDays} definitivos · ${c.provisionalDays} provisionales · ${c.missingDays} sin registro (de ${c.requestedDays} días)`,
  };
}

// Notas visibles bajo el panel: cobertura desigual, 3AV, datos parciales, provisionalidad y límites.
function buildNotes({ properties, isAll, containsProvisional }) {
  const notes = [];
  const sameCoverage = new Set(properties.map((p) => p.coverage.daysWithRows)).size === 1;
  if (isAll && !sameCoverage) {
    notes.push({
      tone: 'warn',
      text: 'Cobertura desigual entre marcas. En «Todas» se suman solo los días disponibles de cada una; los días marcados como parciales tienen datos de una sola marca.',
    });
  }
  const tres = properties.find((p) => p.domain === '3av.events');
  if (tres && tres.coverage.missingDays > 0) {
    notes.push({
      tone: 'info',
      text: 'El seguimiento de 3AV se activó recientemente: los días anteriores al inicio no son caídas de tráfico.',
    });
  }
  if (isAll) {
    notes.push({ tone: 'info', text: 'Las posiciones no se combinan entre marcas. Consulta cada marca por separado.' });
  }
  if (containsProvisional) {
    notes.push({ tone: 'info', text: 'Incluye datos provisionales de Search Console; pueden cambiar.' });
  }
  notes.push({ tone: 'info', text: 'Comparativa con el periodo anterior: no disponible con los datos actuales.' });
  return notes;
}

// Modelo completo del panel. `brand` y `period` se devuelven para descartar respuestas antiguas.
export function buildGscView({ payload, brand, period }) {
  if (!isValidPayload(payload, brand, period)) return { state: VIEW_STATES.INVALID, brand, period };

  const properties = payload.properties;
  const isAll = brand === 'all';
  const totals = isAll ? payload.combined.totals : properties[0].totals;
  const series = isAll ? combinedSeries(properties) : singleSeries(properties[0]);
  const anyRows = properties.some((p) => p.coverage.daysWithRows > 0);
  const containsProvisional = properties.some((p) => p.containsProvisional === true);
  const scope = isAll ? 'Todas las marcas' : brandLabel(properties[0].domain);
  const scopeNote = `${scope} · últimos ${period} días`;

  const kpis = [
    { id: 'clicks', label: 'Clics', value: formatCount(totals.clicks), note: scopeNote },
    { id: 'impressions', label: 'Impresiones', value: formatCount(totals.impressions), note: scopeNote },
    { id: 'ctr', label: 'CTR', value: formatCtr(totals.ctr), note: 'Clics ÷ impresiones' },
    {
      id: 'position',
      label: 'Posición media GSC',
      value: isAll ? '—' : formatPosition(totals.averagePosition),
      note: isAll
        ? 'Sin posición combinada: cada marca tiene la suya'
        : 'Media de posiciones en Search Console; no equivale a una posición SERP exacta.',
    },
  ];

  const breakdown = isAll
    ? properties.map((p) => ({
        domain: p.domain,
        label: brandLabel(p.domain),
        clicks: formatCount(p.totals.clicks),
        impressions: formatCount(p.totals.impressions),
        ctr: formatCtr(p.totals.ctr),
        position: formatPosition(p.totals.averagePosition),
      }))
    : null;

  return {
    state: anyRows ? VIEW_STATES.OK : VIEW_STATES.EMPTY,
    brand,
    period,
    scope,
    kpis,
    series,
    partialDays: isAll ? series.filter((p) => p.partial).length : 0,
    coverage: properties.map(coverageLine),
    breakdown,
    notes: buildNotes({ properties, isAll, containsProvisional }),
    lastFetchedAt: formatFetchedAt(payload.lastMetricsFetchedAt ?? null),
    range: { start: formatDay(payload.startDate), end: formatDay(payload.endDate) },
    containsProvisional,
  };
}
