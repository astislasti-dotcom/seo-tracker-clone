// GSC-04 · pruebas offline de la vista de rendimiento GSC. Fixtures sintéticos marcados DEMO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  VIEW_STATES,
  buildGscView,
  chartGeometry,
  combinedSeries,
  describeDay,
  indexAtX,
  moveIndex,
  niceCeil,
  formatCount,
  formatCtr,
  formatDay,
  formatFetchedAt,
  formatPosition,
  isValidPayload,
  singleSeries,
  stateFromHttp,
} from '../lib/gsc/dashboard-view.mjs';

const START = '2026-10-09';
const DAY_MS = 86_400_000;
const dateAt = (i) => new Date(Date.parse(`${START}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);

// DEMO: serie de `days` días. `rows` es un mapa índice→{clicks, impressions, avg_position, state}.
function demoProperty(domain, days, rows = {}) {
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const r = rows[i];
    series.push(
      r
        ? {
            date: dateAt(i),
            hasRow: true,
            dataState: r.state ?? 'final',
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
            avgPosition: r.avg_position ?? null,
          }
        : { date: dateAt(i), hasRow: false, dataState: null, clicks: null, impressions: null, ctr: null, avgPosition: null }
    );
  }
  const present = series.filter((d) => d.hasRow);
  const clicks = present.length ? present.reduce((s, d) => s + d.clicks, 0) : null;
  const impressions = present.length ? present.reduce((s, d) => s + d.impressions, 0) : null;
  return {
    domain,
    brand: domain,
    series,
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      averagePosition: present.length ? 12.3 : null,
    },
    coverage: {
      requestedDays: days,
      daysWithRows: present.length,
      finalDays: present.filter((d) => d.dataState === 'final').length,
      provisionalDays: present.filter((d) => d.dataState === 'provisional').length,
      missingDays: days - present.length,
    },
    containsProvisional: present.some((d) => d.dataState === 'provisional'),
    positionNote: 'DEMO',
  };
}

function demoPayload({ brand, period = 7, asti, tres, combinedTotals }) {
  const properties = brand === 'all' ? [asti, tres] : [brand === 'astisl.es' ? asti : tres];
  const payload = {
    source: 'supabase_gsc_daily_metrics',
    brand,
    period,
    startDate: dateAt(0),
    endDate: dateAt(period - 1),
    lastMetricsFetchedAt: '2026-11-05T08:30:00.000Z',
    properties,
    generatedAt: '2026-11-05T09:00:00.000Z',
  };
  if (brand === 'all') {
    payload.combined = { totals: combinedTotals ?? { clicks: 0, impressions: 0, ctr: null, averagePosition: null }, positionNote: 'DEMO' };
  }
  return payload;
}

// Fixture base: ASTI con 6 de 7 días; 3AV con 2 de 7 días.
const ASTI_ROWS = { 0: { clicks: 10, impressions: 100, avg_position: 8 }, 1: { clicks: 12, impressions: 120, avg_position: 9 }, 2: { clicks: 0, impressions: 50, avg_position: 15 }, 4: { clicks: 20, impressions: 200, avg_position: 7 }, 5: { clicks: 8, impressions: 80, avg_position: 10, state: 'provisional' }, 6: { clicks: 5, impressions: 60, avg_position: 11 } };
const TRES_ROWS = { 5: { clicks: 1, impressions: 30, avg_position: 20 }, 6: { clicks: 1, impressions: 40, avg_position: 18 } };

// ---------- estados HTTP ----------

test('HTTP errors map to distinct states, never to an empty dashboard', () => {
  assert.equal(stateFromHttp(401), VIEW_STATES.AUTH);
  assert.equal(stateFromHttp(403), VIEW_STATES.FORBIDDEN);
  assert.equal(stateFromHttp(503), VIEW_STATES.CONFIG);
  assert.equal(stateFromHttp(502), VIEW_STATES.ERROR);
  assert.equal(stateFromHttp(400), VIEW_STATES.ERROR);
  assert.equal(stateFromHttp(500), VIEW_STATES.ERROR);
});

// ---------- validación de la respuesta ----------

test('a payload with the wrong shape produces INVALID and no figures', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  assert.equal(isValidPayload(null, 'astisl.es', 7), false);
  assert.equal(isValidPayload({ properties: [] }, 'astisl.es', 7), false);
  assert.equal(isValidPayload({ properties: [{ domain: 'astisl.es' }] }, 'astisl.es', 7), false);
  const broken = demoPayload({ brand: 'astisl.es', asti, tres });
  broken.properties[0].series[0].clicks = '10';
  assert.equal(isValidPayload(broken, 'astisl.es', 7), false, 'clicks must be number or null');
  const mismatched = demoPayload({ brand: 'all', asti, tres, combinedTotals: { clicks: 1, impressions: 1, ctr: 1, averagePosition: null } });
  mismatched.properties[1] = demoProperty('3av.events', 6, TRES_ROWS);
  assert.equal(isValidPayload(mismatched, 'all', 7), false, 'series lengths must match');
  const noCombined = demoPayload({ brand: 'all', asti, tres });
  delete noCombined.combined;
  assert.equal(isValidPayload(noCombined, 'all', 7), false, 'all requires combined totals');
  assert.equal(buildGscView({ payload: null, brand: 'astisl.es', period: 7 }).state, VIEW_STATES.INVALID);
});

// ---------- cifras por marca ----------

test('single brand KPIs come from the property totals; position is shown with its caveat', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const view = buildGscView({ payload: demoPayload({ brand: 'astisl.es', asti, tres: null }), brand: 'astisl.es', period: 7 });
  assert.equal(view.state, VIEW_STATES.OK);
  const byId = Object.fromEntries(view.kpis.map((k) => [k.id, k]));
  assert.equal(byId.clicks.value, '55');
  assert.equal(byId.impressions.value, '610');
  assert.match(byId.ctr.value, /9,02/);
  assert.equal(byId.position.value, '12,3');
  assert.match(byId.position.note, /no equivale a una posición SERP exacta/);
  assert.equal(view.breakdown, null);
});

test('"Todas" sums additive metrics, computes CTR from totals and never combines positions', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const combinedTotals = { clicks: asti.totals.clicks + tres.totals.clicks, impressions: asti.totals.impressions + tres.totals.impressions, ctr: null, averagePosition: null };
  combinedTotals.ctr = combinedTotals.clicks / combinedTotals.impressions;
  const view = buildGscView({ payload: demoPayload({ brand: 'all', asti, tres, combinedTotals }), brand: 'all', period: 7 });
  const byId = Object.fromEntries(view.kpis.map((k) => [k.id, k]));
  assert.equal(byId.clicks.value, '57');
  assert.equal(byId.impressions.value, '680');
  assert.equal(byId.position.value, '—');
  assert.match(byId.position.note, /Sin posición combinada/);
  assert.equal(view.breakdown.length, 2);
  assert.equal(view.breakdown[0].position, '12,3');
});

test('reference validation values: 120 clicks, 8.232 impressions, 1,46 % CTR, combined position empty', () => {
  const asti = demoProperty('astisl.es', 28, { 0: { clicks: 118, impressions: 8078 } });
  const tres = demoProperty('3av.events', 28, { 0: { clicks: 2, impressions: 154 } });
  const combinedTotals = { clicks: 120, impressions: 8232, ctr: 120 / 8232, averagePosition: null };
  const view = buildGscView({ payload: demoPayload({ brand: 'all', period: 28, asti, tres, combinedTotals }), brand: 'all', period: 28 });
  const byId = Object.fromEntries(view.kpis.map((k) => [k.id, k]));
  assert.equal(byId.clicks.value, '120');
  assert.equal(byId.impressions.value, '8.232');
  assert.match(byId.ctr.value, /^1,46\s%$/, 'es-ES uses a no-break space before %');
  assert.equal(byId.position.value, '—');
});

test('formatters: Spanish separators, dash for missing values, never zero for null', () => {
  assert.equal(formatCount(null), '—');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(8232), '8.232');
  assert.equal(formatCtr(null), '—');
  assert.match(formatCtr(0), /^0,00\s%$/);
  assert.equal(formatPosition(null), '—');
  assert.equal(formatPosition(3.46), '3,5');
  assert.equal(formatFetchedAt(null), null);
  assert.equal(typeof formatFetchedAt('2026-11-05T08:30:00.000Z'), 'string');
  assert.equal(formatDay('2026-11-05'), '5 nov');
});

// ---------- serie diaria: null, nunca cero ----------

test('a day without a row stays null in the series, not zero', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const series = singleSeries(asti);
  assert.equal(series[3].hasRow, false);
  assert.equal(series[3].clicks, null);
  assert.equal(series[3].impressions, null);
  assert.equal(series[2].clicks, 0, 'a real zero stays zero');
  assert.equal(series[5].provisional, true);
});

test('combined series: both brands missing gives null; one brand missing gives a partial day', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const series = combinedSeries([asti, tres]);
  assert.equal(series[3].hasRow, false, 'no brand has a row');
  assert.equal(series[3].clicks, null);
  assert.equal(series[0].brandsWithRows, 1, 'only ASTI has data that day');
  assert.equal(series[0].clicks, 10);
  assert.equal(series[5].brandsWithRows, 2);
  assert.equal(series[5].clicks, 9);
  assert.equal(series[5].provisional, true);
});

// ---------- cobertura y notas ----------

test('coverage differences are reported; 3AV recent tracking is not presented as a drop', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const combinedTotals = { clicks: 57, impressions: 640, ctr: 57 / 640, averagePosition: null };
  const view = buildGscView({ payload: demoPayload({ brand: 'all', asti, tres, combinedTotals }), brand: 'all', period: 7 });
  const texts = view.notes.map((n) => n.text).join('\n');
  assert.match(texts, /Cobertura desigual/);
  assert.match(texts, /seguimiento de 3AV se activó recientemente/);
  const tresCoverage = view.coverage.find((c) => c.domain === '3av.events');
  assert.equal(tresCoverage.text, '2 definitivos · 0 provisionales · 5 sin registro (de 7 días)');
  assert.match(texts, /Comparativa con el periodo anterior: no disponible/);
  assert.match(texts, /Las posiciones no se combinan/);
  const warn = view.notes.find((n) => n.tone === 'warn');
  assert.ok(warn, 'unequal coverage is a warning');
});

test('provisional data is flagged in the notes', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const view = buildGscView({ payload: demoPayload({ brand: 'astisl.es', asti, tres: null }), brand: 'astisl.es', period: 7 });
  assert.equal(view.containsProvisional, true);
  assert.ok(view.notes.some((n) => /provisionales/.test(n.text)));
});

test('a window with no rows at all is EMPTY, with dashes and no zeros', () => {
  const asti = demoProperty('astisl.es', 7, {});
  const view = buildGscView({ payload: demoPayload({ brand: 'astisl.es', asti, tres: null }), brand: 'astisl.es', period: 7 });
  assert.equal(view.state, VIEW_STATES.EMPTY);
  const byId = Object.fromEntries(view.kpis.map((k) => [k.id, k]));
  assert.equal(byId.clicks.value, '—');
  assert.equal(byId.ctr.value, '—');
});

test('the view carries brand and period so stale responses can be discarded', () => {
  const asti = demoProperty('astisl.es', 28, ASTI_ROWS);
  const view = buildGscView({ payload: demoPayload({ brand: 'astisl.es', period: 28, asti, tres: null }), brand: 'astisl.es', period: 28 });
  assert.equal(view.brand, 'astisl.es');
  assert.equal(view.period, 28);
});

// ---------- geometría del gráfico ----------

test('the chart cuts the line at null days and marks them as gaps, never as zero points', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const series = singleSeries(asti);
  const geo = chartGeometry(series, 'clicks', { width: 600, height: 160, pad: 8 });
  assert.equal(geo.segments.length, 2, 'day 3 is missing, so the line is cut in two');
  assert.equal(geo.gaps.length, 1);
  assert.equal(geo.points.length, 6 - 0, 'six days with clicks, including the real zero on day 2');
  assert.equal(geo.max, 20);
  assert.ok(geo.segments.every((d) => d.startsWith('M')));
});

test('an all-null metric gives no path and a sane maximum', () => {
  const empty = demoProperty('astisl.es', 3, {});
  const geo = chartGeometry(singleSeries(empty), 'impressions');
  assert.deepEqual(geo.segments, []);
  assert.deepEqual(geo.points, []);
  assert.equal(geo.max, 1);
});

// ---------- comprobaciones estáticas del panel y la página ----------

test('the panel only calls the owner route with the session token and never uses service_role', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /\/api\/gsc\/metrics\?brand=/);
  assert.match(src, /Authorization: `Bearer \$\{token\}`/);
  assert.match(src, /getSession\(\)/);
  assert.doesNotMatch(src, /service_role|SERVICE_ROLE|serviceKey/i);
  assert.doesNotMatch(src, /\.from\(['"]gsc_/);
  assert.doesNotMatch(src, /\/api\/gsc\/sync/);
});

test('the panel renders a retry path, an aborted-request guard and a brand/period match guard', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /controller\.abort\(\)/);
  assert.match(src, /AbortError/);
  assert.match(src, /result\.key === key/);
  assert.match(src, /Reintentar/);
});

test('the dashboard shows the GSC section above the SERP block without removing its checks', async () => {
  const page = await readFile(new URL('../app/dashboard/page.jsx', import.meta.url), 'utf8');
  assert.match(page, /import GscPanel from '\.\/GscPanel\.jsx'/);
  const gscAt = page.indexOf('<GscPanel supabase={supabase} brand={brand} />');
  const serpAt = page.indexOf('Posiciones verificadas (seguimiento SERP)');
  assert.ok(gscAt > 0 && serpAt > gscAt, 'GSC section comes first, SERP block is labelled separately');
  assert.match(page, /makeHistoryFetcher\(session\.access_token/);
  assert.match(page, /signOutSafely\(supabase\.auth\)/);
});

test('the chart is accessible: focusable group with a summary, live readout and native daily table', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /role="group"/);
  assert.match(src, /tabIndex=\{0\}/);
  assert.match(src, /aria-label=\{summary\}/);
  assert.match(src, /aria-describedby=\{readoutId\}/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /<details/);
  assert.match(src, /Sin registro/);
  assert.match(src, /Toca el gráfico o usa las flechas/);
});

test('the chart reacts to keyboard (arrows, Home, End, Escape) and to pointer or touch', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /onKeyDown=\{onKeyDown\}/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /moveIndex\(active, e\.key, n\)/);
  assert.match(src, /onPointerDown=\{onPointer\}/);
  assert.match(src, /indexAtX\(vbX, n/);
  assert.match(src, /key=\{`\$\{brand\}-\$\{period\}-clicks`\}/, 'readout resets when brand or period changes');
});

test('niceCeil returns round scale tops at or above the data maximum', () => {
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(3), 5);
  assert.equal(niceCeil(20), 20);
  assert.equal(niceCeil(21), 25);
  assert.equal(niceCeil(8232), 10000);
  for (const v of [0.4, 7, 19, 33, 480, 8232]) assert.ok(niceCeil(v) >= v);
});

test('chart ticks are 0, half and the rounded maximum, placed on the same scale as the line', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const geo = chartGeometry(singleSeries(asti), 'clicks', { width: 600, height: 160, pad: 8 });
  assert.deepEqual(geo.ticks.map((t) => t.value), [20, 10, 0]);
  assert.deepEqual(geo.ticks.map((t) => t.label), ['20', '10', '0']);
  assert.equal(Number(geo.ticks[0].y), 8);
  assert.equal(Number(geo.ticks[2].y), 152);
  assert.equal(geo.xs.length, 7);
});

test('Y-axis ticks keep exact fractional labels for low traffic (not rounded counts)', () => {
  const one = chartGeometry([{ date: '2026-11-05', hasRow: true, clicks: 1, partial: false }], 'clicks');
  assert.deepEqual(one.ticks.map((t) => t.label), ['1', '0,5', '0']);
  const five = chartGeometry([{ date: '2026-11-05', hasRow: true, clicks: 5, partial: false }], 'clicks');
  assert.deepEqual(five.ticks.map((t) => t.label), ['5', '2,5', '0']);
  const twentyFive = chartGeometry([{ date: '2026-11-05', hasRow: true, clicks: 21, partial: false }], 'clicks');
  assert.deepEqual(twentyFive.ticks.map((t) => t.label), ['25', '12,5', '0']);
  assert.equal(formatCount(1), '1', 'daily click counts are still formatted as integers');
});

test('indexAtX maps a pointer position to the nearest day and stays inside the range', () => {
  assert.equal(indexAtX(8, 7), 0);
  assert.equal(indexAtX(592, 7), 6);
  assert.equal(indexAtX(-50, 7), 0);
  assert.equal(indexAtX(9999, 7), 6);
  assert.equal(indexAtX(300, 1), 0);
});

test('moveIndex: arrows, Home and End stay in range; Escape is not a move', () => {
  assert.equal(moveIndex(null, 'ArrowLeft', 7), 5, 'first press from nothing starts at the last day');
  assert.equal(moveIndex(3, 'ArrowRight', 7), 4);
  assert.equal(moveIndex(6, 'ArrowRight', 7), 6);
  assert.equal(moveIndex(0, 'ArrowLeft', 7), 0);
  assert.equal(moveIndex(3, 'Home', 7), 0);
  assert.equal(moveIndex(3, 'End', 7), 6);
  assert.equal(moveIndex(3, 'Escape', 7), 3);
  assert.equal(moveIndex(3, 'ArrowLeft', 0), null);
});

test('describeDay never presents a missing day as zero and names the contributing brand', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const series = combinedSeries([asti, tres]);

  const missing = describeDay(series[3], 'clicks', 'Clics');
  assert.equal(missing.value, 'Sin registro');
  assert.equal(missing.missing, true);
  assert.doesNotMatch(missing.text, /: 0/);

  const partial = describeDay(series[0], 'clicks', 'Clics');
  assert.equal(partial.scope, 'Solo ASTI (parcial)');
  assert.match(partial.text, /Clics: 10/);

  const complete = describeDay(series[6], 'clicks', 'Clics'); // both brands, both final
  assert.equal(complete.scope, 'ASTI + 3AV');
  assert.equal(complete.provisional, false);

  const realZero = describeDay(singleSeries(asti)[2], 'clicks', 'Clics');
  assert.equal(realZero.value, '0', 'a real zero is shown as zero');
  assert.equal(realZero.missing, false);

  const provisional = describeDay(singleSeries(asti)[5], 'clicks', 'Clics');
  assert.equal(provisional.provisional, true);
  assert.match(provisional.text, /provisional/);
});

test('describeDay formats the date in Spanish with the weekday and month name', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const day = describeDay(singleSeries(asti)[0], 'clicks', 'Clics');
  assert.match(day.date, /octubre|noviembre/);
  assert.match(day.date, /de 20\d\d/);
});

test('the new CSS has no horizontal scroll rules on the page and includes the three responsive widths', async () => {
  const css = await readFile(new URL('../app/dashboard/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 1080px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(css, /\.sd-main\s*\{[^}]*overflow-x:\s*scroll/);
});

// ---------- revisión PR #33: contrato estricto, parciales, cobertura y contraste ----------

function strictFixture() {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const combinedTotals = { clicks: 57, impressions: 680, ctr: 57 / 680, averagePosition: null };
  return demoPayload({ brand: 'all', asti, tres, combinedTotals });
}

test('strict contract: rejects a payload that answers a different brand or period', () => {
  const payload = strictFixture();
  assert.equal(isValidPayload(payload, 'all', 7), true, 'control: the fixture is valid');
  assert.equal(isValidPayload({ ...payload, brand: 'astisl.es' }, 'all', 7), false);
  assert.equal(isValidPayload(payload, 'all', 28), false, 'period mismatch');
  assert.equal(isValidPayload({ ...payload, period: 28 }, 'all', 7), false);
});

test('strict contract: rejects wrong domains, duplicated domains and wrong dates', () => {
  const payload = strictFixture();
  const extra = structuredClone(payload);
  extra.properties[1].domain = 'otro.example';
  assert.equal(isValidPayload(extra, 'all', 7), false, 'unexpected domain in all');
  const dup = structuredClone(payload);
  dup.properties[1].domain = 'astisl.es';
  assert.equal(isValidPayload(dup, 'all', 7), false, 'duplicate domain');
  const shifted = structuredClone(payload);
  shifted.properties[0].series[0].date = '2026-10-10';
  assert.equal(isValidPayload(shifted, 'all', 7), false, 'series date out of sequence');
  const badEnd = { ...payload, endDate: '2026-11-01' };
  assert.equal(isValidPayload(badEnd, 'all', 7), false, 'endDate must match startDate + period - 1');
});

test('strict contract: rejects impossible figures and inconsistent coverage', () => {
  const payload = strictFixture();
  const negative = structuredClone(payload);
  negative.properties[0].series[0].clicks = -1;
  assert.equal(isValidPayload(negative, 'all', 7), false, 'negative clicks');
  const phantomZero = structuredClone(payload);
  phantomZero.properties[0].series[3].clicks = 0; // day without row must not carry a 0
  assert.equal(isValidPayload(phantomZero, 'all', 7), false, 'a missing day must stay null, not 0');
  const badTotals = structuredClone(payload);
  badTotals.properties[0].totals.ctr = Number.NaN;
  assert.equal(isValidPayload(badTotals, 'all', 7), false, 'NaN is not a valid total');
  const badCoverage = structuredClone(payload);
  badCoverage.properties[1].coverage.missingDays = 0;
  assert.equal(isValidPayload(badCoverage, 'all', 7), false, 'coverage must agree with the rows');
  const badSplit = structuredClone(payload);
  badSplit.properties[0].coverage.provisionalDays = 9;
  assert.equal(isValidPayload(badSplit, 'all', 7), false, 'final + provisional must equal rows');
});

test('strict contract: an empty window with all nulls is valid, not an error', () => {
  const asti = demoProperty('astisl.es', 7, {});
  const tres = demoProperty('3av.events', 7, {});
  const payload = demoPayload({ brand: 'all', asti, tres, combinedTotals: { clicks: null, impressions: null, ctr: null, averagePosition: null } });
  assert.equal(isValidPayload(payload, 'all', 7), true);
  assert.equal(buildGscView({ payload, brand: 'all', period: 7 }).state, VIEW_STATES.EMPTY);
});

test('partial days in "Todas" are flagged with the brand that contributes data', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const series = combinedSeries([asti, tres]);
  assert.equal(series[0].partial, true);
  assert.deepEqual(series[0].brandLabels, ['ASTI']);
  assert.equal(series[5].partial, false, 'both brands present');
  assert.deepEqual(series[5].brandLabels, ['ASTI', '3AV']);
  assert.equal(series[3].partial, false, 'no brand at all is a gap, not a partial day');
  const geo = chartGeometry(series, 'clicks');
  assert.equal(geo.partials.length, 4, 'days 0, 1, 2 and 4 have only ASTI');
  assert.equal(geo.points.length, 2, 'only complete days use a regular dot');
});

test('the view exposes partial-day count, per-brand coverage and no combined position', () => {
  const asti = demoProperty('astisl.es', 7, ASTI_ROWS);
  const tres = demoProperty('3av.events', 7, TRES_ROWS);
  const combinedTotals = { clicks: 57, impressions: 680, ctr: 57 / 680, averagePosition: null };
  const view = buildGscView({ payload: demoPayload({ brand: 'all', asti, tres, combinedTotals }), brand: 'all', period: 7 });
  assert.equal(view.partialDays, 4);
  assert.deepEqual(view.coverage.map((c) => c.label), ['ASTI', '3AV']);
  assert.match(view.coverage[0].text, /1 provisionales|1 provisional/);
  assert.equal(view.breakdown[0].coverage, undefined, 'coverage lives in its own block');
});

test('the chart summary tells a screen reader how many days come from one brand only', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /días con datos de una sola marca/);
  assert.match(src, /sd-gsc-partial/);
  assert.match(src, /Cobertura por marca/);
});

test('impressions line keeps at least 4:1 contrast on white (WCAG graphics need 3:1)', async () => {
  const css = await readFile(new URL('../app/dashboard/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /--gsc-impr: #748092/);
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio('#748092', '#ffffff') >= 4, `contrast ${ratio('#748092', '#ffffff').toFixed(2)}`);
});
