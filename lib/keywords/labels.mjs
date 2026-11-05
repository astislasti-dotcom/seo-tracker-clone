// Display labels for the dashboard. Pure functions: no DOM, no network.
// Dates are formatted in UTC so the same stored timestamp always shows the same day.

const BRAND_SHORT = Object.freeze({ '3av.events': '3AV', 'astisl.es': 'ASTI' });
const BRAND_SCOPE = Object.freeze({
  all: 'Todas las marcas',
  '3av.events': '3AV Events',
  'astisl.es': 'ASTI',
});

export function brandLabel(domain) {
  return BRAND_SHORT[domain] ?? String(domain ?? '');
}

export function formatMeasurementDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-ES', { timeZone: 'UTC' });
}

// Header and sidebar text for the SERP keyword block only (not Search Console).
// `lastMeasuredAt` must come from the SAME scope as `brand`
// (the summary of the visible keywords), never from the global model.
export function measurementSubtitle({ status, lastMeasuredAt, brand }) {
  if (status === 'loading') return 'Cargando mediciones SERP…';
  if (status !== 'ok') return 'Mediciones SERP no disponibles en esta carga';

  const scope = BRAND_SCOPE[brand] ?? String(brand ?? '');
  const date = lastMeasuredAt ? formatMeasurementDate(lastMeasuredAt) : null;
  return date
    ? `Última medición SERP verificada (${scope}): ${date}`
    : `Sin mediciones SERP verificadas (${scope})`;
}
