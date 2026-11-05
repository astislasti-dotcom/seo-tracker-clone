// GSC-04 · lógica pura de la vista de rendimiento GSC. Sin React, sin red, sin reloj propio.
// Recibe la respuesta de GET /api/gsc/metrics y devuelve exactamente lo que pinta el panel.
//
// Reglas:
//   · Un día sin fila es null, nunca 0. El gráfico corta la línea en ese día.
//   · En «Todas» se suman solo las métricas aditivas (clics, impresiones). El CTR sale de los
//     totales. La posición no se combina entre marcas: se muestra por marca.
//   · Un día con datos solo de una marca se marca como parcial en «Todas».
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

// useGrouping 'always': el español omite el separador en cuatro cifras por defecto; aquí va siempre (8.232).
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
const isNullNum = (v) => v === null || isNum(v);
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

function validProperty(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.domain !== 'string' || !p.totals || typeof p.totals !== 'object') return false;
  if (!p.coverage || typeof p.coverage !== 'object' || !Array.isArray(p.series)) return false;
  return p.series.every(
    (d) =>
      d &&
      typeof d.date === 'string' &&
      typeof d.hasRow === 'boolean' &&
      isNullNum(d.clicks) &&
      isNullNum(d.impressions) &&
      isNullNum(d.ctr)
  );
}

// Forma mínima que el panel necesita. Si no se cumple, no se pinta ninguna cifra.
export function isValidPayload(payload, brand) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.properties) || payload.properties.length === 0) return false;
  if (!payload.properties.every(validProperty)) return false;
  const lengths = new Set(payload.properties.map((p) => p.series.length));
  if (lengths.size !== 1) return false;
  if (brand === 'all' && !(payload.combined && payload.combined.totals)) return false;
  return true;
}

// Punto normalizado para el gráfico y la tabla de datos diarios.
function toPoint(d, dataState) {
  return {
    date: d.date,
    hasRow: d.hasRow,
    clicks: d.hasRow ? d.clicks : null,
    impressions: d.hasRow ? d.impressions : null,
    ctr: d.hasRow ? d.ctr : null,
    provisional: d.hasRow && dataState === 'provisional',
    brandsWithRows: d.hasRow ? 1 : 0,
  };
}

// Serie de una sola marca. La fila de datos provisionales se marca con su dataState.
export function singleSeries(property) {
  return property.series.map((d) => toPoint(d, d.dataState));
}

// Serie combinada de «Todas»: suma clics e impresiones por día. Si ninguna marca tiene fila,
// el día es null. Si solo tiene fila una, el día cuenta como parcial (brandsWithRows < total).
export function combinedSeries(properties) {
  const length = properties[0].series.length;
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const date = properties[0].series[i].date;
    const present = properties.map((p) => p.series[i]).filter((d) => d.hasRow);
    if (present.length === 0) {
      out.push({ date, hasRow: false, clicks: null, impressions: null, ctr: null, provisional: false, brandsWithRows: 0 });
      continue;
    }
    const clicks = present.reduce((sum, d) => sum + d.clicks, 0);
    const impressions = present.reduce((sum, d) => sum + d.impressions, 0);
    out.push({
      date,
      hasRow: true,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      provisional: present.some((d) => d.dataState === 'provisional'),
      brandsWithRows: present.length,
    });
  }
  return out;
}

// Geometría del gráfico de una métrica. Devuelve segmentos continuos (se cortan en null) y
// marcas para los días sin registro, que se dibujan en la base y nunca como cero.
export function chartGeometry(series, key, { width = 600, height = 160, pad = 8 } = {}) {
  const n = series.length;
  const values = series.map((p) => p[key]).filter(isNum);
  const max = values.length > 0 ? Math.max(...values, 1) : 1;
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
  const points = series.flatMap((p, i) => (isNum(p[key]) ? [{ x: xAt(i).toFixed(1), y: yAt(p[key]).toFixed(1) }] : []));
  return { segments, gaps, points, max, width, height };
}

// Notas visibles bajo el panel: cobertura, provisionalidad, comparativa y límites de «Todas».
function buildNotes({ properties, isAll, containsProvisional }) {
  const notes = [];
  for (const p of properties) {
    const label = brandLabel(p.domain);
    const c = p.coverage;
    if (c.missingDays > 0) {
      notes.push({
        tone: 'info',
        text: `${label}: ${c.daysWithRows} de ${c.requestedDays} días con datos. Los días sin registro no se representan como cero.`,
      });
    }
    if (p.domain === '3av.events' && c.missingDays > 0) {
      notes.push({
        tone: 'info',
        text: 'El seguimiento de 3AV se activó recientemente: los días anteriores al inicio no son caídas de tráfico.',
      });
    }
  }
  if (isAll && new Set(properties.map((p) => p.coverage.daysWithRows)).size > 1) {
    notes.push({
      tone: 'warn',
      text: 'Cobertura desigual entre marcas: en «Todas» se suman solo los días disponibles de cada una.',
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
  if (!isValidPayload(payload, brand)) return { state: VIEW_STATES.INVALID, brand, period };

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
        : 'Ponderada por impresiones. No es la posición en Google.',
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
        coverage: `${p.coverage.daysWithRows} de ${p.coverage.requestedDays} días`,
      }))
    : null;

  return {
    state: anyRows ? VIEW_STATES.OK : VIEW_STATES.EMPTY,
    brand,
    period,
    scope,
    kpis,
    series,
    breakdown,
    notes: buildNotes({ properties, isAll, containsProvisional }),
    lastFetchedAt: formatFetchedAt(payload.lastMetricsFetchedAt ?? null),
    range: { start: formatDay(payload.startDate), end: formatDay(payload.endDate) },
    containsProvisional,
  };
}
