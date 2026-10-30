// Offline tests for brand-scoped measurement dates and brand labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY, summarizeKeywords } from '../lib/keywords/measurements.mjs';
import { brandLabel, formatMeasurementDate, measurementSubtitle } from '../lib/keywords/labels.mjs';

const kw = (domain, state, position = null, measured_at = null) => ({ domain, state, position, measured_at });

// ASTI measured on 8 Oct 2026; 3AV only on 17 Sep 2026. The global latest date is 8 Oct.
const ALL = [
  kw('astisl.es', DISPLAY.RANKED, 4, '2026-10-08T06:00:00Z'),
  kw('astisl.es', DISPLAY.NOT_FOUND, null, '2026-10-01T06:00:00Z'),
  kw('3av.events', DISPLAY.RANKED, 9, '2026-09-17T06:00:00Z'),
  kw('3av.events', DISPLAY.UNVERIFIED),
];

// Same derivation the dashboard uses: summary of the visible (brand-filtered) keywords.
function scopedDate(brand) {
  const visible = ALL.filter((k) => brand === 'all' || k.domain === brand);
  return summarizeKeywords(visible).lastMeasuredAt;
}

test('regression: selecting 3AV shows 3AV date, not the global ASTI date', () => {
  const text = measurementSubtitle({ status: 'ok', lastMeasuredAt: scopedDate('3av.events'), brand: '3av.events' });
  assert.equal(text, 'Última medición verificada (3AV Events): 17/9/2026');
  assert.equal(text.includes('8/10/2026'), false);
});

test('regression: selecting ASTI shows ASTI date', () => {
  const text = measurementSubtitle({ status: 'ok', lastMeasuredAt: scopedDate('astisl.es'), brand: 'astisl.es' });
  assert.equal(text, 'Última medición verificada (ASTI): 8/10/2026');
});

test('"Todas" shows the most recent date across both brands', () => {
  const text = measurementSubtitle({ status: 'ok', lastMeasuredAt: scopedDate('all'), brand: 'all' });
  assert.equal(text, 'Última medición verificada (Todas las marcas): 8/10/2026');
});

test('a brand with no verified measurement never inherits the other brand date', () => {
  const onlyUnverified = [kw('3av.events', DISPLAY.UNVERIFIED), kw('3av.events', DISPLAY.UNVERIFIED)];
  const { lastMeasuredAt } = summarizeKeywords(onlyUnverified);
  assert.equal(lastMeasuredAt, null);
  const text = measurementSubtitle({ status: 'ok', lastMeasuredAt, brand: '3av.events' });
  assert.equal(text, 'Sin mediciones verificadas (3AV Events)');
});

test('loading and error statuses keep their reliable messages', () => {
  assert.equal(measurementSubtitle({ status: 'loading', lastMeasuredAt: null, brand: 'all' }), 'Cargando mediciones…');
  assert.equal(
    measurementSubtitle({ status: 'measurements_error', lastMeasuredAt: '2026-10-08T06:00:00Z', brand: 'all' }),
    'Mediciones no disponibles en esta carga'
  );
  assert.equal(
    measurementSubtitle({ status: 'catalog_error', lastMeasuredAt: null, brand: 'all' }),
    'Mediciones no disponibles en esta carga'
  );
});

test('date is formatted in UTC, so late-evening timestamps keep their day', () => {
  assert.equal(formatMeasurementDate('2026-10-08T23:30:00Z'), '8/10/2026');
  assert.equal(formatMeasurementDate('no-es-fecha'), null);
});

test('brand labels for mobile identification in "Todas"', () => {
  assert.equal(brandLabel('astisl.es'), 'ASTI');
  assert.equal(brandLabel('3av.events'), '3AV');
  assert.equal(brandLabel('otro.example'), 'otro.example');
  assert.equal(brandLabel(undefined), '');
});
