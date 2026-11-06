// GSC-06E · datos COMPLETAMENTE FICTICIOS para pruebas y capturas. No son datos reales.
// Solo se usan en tests y en el arnés local de verificación. Nunca se sirven en producción.
const window = (days) => ({ startDate: shift('2026-11-03', -(days - 1)), endDate: '2026-11-03' });
function shift(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const q = (key, clicks, impressions, position) => ({ key, clicks, impressions, ctr: clicks / impressions, position });

export const DEMO_QUERIES_ASTI = [
  q('interpretacion simultanea congresos ficticia', 42, 900, 4.2),
  q('equipos de interpretacion demo', 18, 640, 6.8),
  q('traduccion simultanea ejemplo', 7, 310, 9.1),
];

export const DEMO_QUERIES_3AV = [
  q('produccion audiovisual evento ficticio', 31, 1200, 3.4),
  q('congresos audiovisuales demo', 12, 480, 7.7),
];

// Mezcla enlaces seguros e inseguros para comprobar que solo los válidos se enlazan.
export const DEMO_PAGES_ASTI = [
  q('https://astisl.es/servicios/interpretacion', 25, 700, 3.1),
  q('https://astisl.es.evil.example/falso', 4, 90, 12.0),
  q('javascript:alert(1)', 2, 50, 20.5),
  q('https://astisl.es:8443/puerto', 1, 30, 25.0),
];

export const DEMO_PAGES_3AV = [
  q('https://3av.events/', 38, 1500, 2.4),
  q('https://www.3av.events/servicios', 9, 320, 8.8),
];

function snapshot(domain, dimension, period, rows, extra = {}) {
  const w = window(period);
  return {
    domain,
    dimension,
    periodDays: period,
    window: w,
    requestedAt: '2026-11-04T08:00:00.000Z',
    dataState: 'final',
    rowCount: rows.length,
    truncatedAtSource: false,
    limit: 100,
    offset: 0,
    returned: Math.min(rows.length, 100),
    totalAvailable: rows.length,
    hasMore: rows.length > 100,
    rows,
    ...extra,
  };
}

// Respuesta de la API para una propiedad, dimensión y periodo. Devuelve { status, body }.
export function demoResponse(domain, dimension, period, offset = 0) {
  const rowsByKey = {
    'astisl.es|query': DEMO_QUERIES_ASTI,
    'astisl.es|page': DEMO_PAGES_ASTI,
    '3av.events|query': DEMO_QUERIES_3AV,
    '3av.events|page': DEMO_PAGES_3AV,
  };
  const rows = rowsByKey[`${domain}|${dimension}`] ?? [];
  if (rows.length === 0) {
    return { status: 200, body: { snapshots: [], missing: [{ domain, dimension, periodDays: period }] } };
  }
  const page = rows.slice(offset, offset + 100);
  const snap = snapshot(domain, dimension, period, rows, { offset, returned: page.length, rows: page, totalAvailable: rows.length, hasMore: offset + page.length < rows.length });
  return { status: 200, body: { snapshots: [snap], missing: [] } };
}
