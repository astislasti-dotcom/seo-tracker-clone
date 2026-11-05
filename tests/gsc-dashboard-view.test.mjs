// GSC-04 · pruebas offline de la vista de rendimiento GSC. Fixtures sintéticos marcados DEMO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  VIEW_STATES,
  buildGscView,
  chartGeometry,
  combinedSeries,
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
  assert.equal(isValidPayload(null, 'astisl.es'), false);
  assert.equal(isValidPayload({ properties: [] }, 'astisl.es'), false);
  assert.equal(isValidPayload({ properties: [{ domain: 'astisl.es' }] }, 'astisl.es'), false);
  const broken = demoPayload({ brand: 'astisl.es', asti, tres });
  broken.properties[0].series[0].clicks = '10';
  assert.equal(isValidPayload(broken, 'astisl.es'), false, 'clicks must be number or null');
  const mismatched = demoPayload({ brand: 'all', asti, tres, combinedTotals: { clicks: 1, impressions: 1, ctr: 1, averagePosition: null } });
  mismatched.properties[1] = demoProperty('3av.events', 6, TRES_ROWS);
  assert.equal(isValidPayload(mismatched, 'all'), false, 'series lengths must match');
  const noCombined = demoPayload({ brand: 'all', asti, tres });
  delete noCombined.combined;
  assert.equal(isValidPayload(noCombined, 'all'), false, 'all requires combined totals');
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
  assert.match(byId.position.note, /No es la posición en Google/);
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
  assert.match(texts, /no se representan como cero/);
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

test('the chart is accessible: role img with a text summary and a native table of daily values', async () => {
  const src = await readFile(new URL('../app/dashboard/GscPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /role="img"/);
  assert.match(src, /aria-label=\{summary\}/);
  assert.match(src, /<details/);
  assert.match(src, /Sin registro/);
});

test('the new CSS has no horizontal scroll rules on the page and includes the three responsive widths', async () => {
  const css = await readFile(new URL('../app/dashboard/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 1080px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(css, /\.sd-main\s*\{[^}]*overflow-x:\s*scroll/);
});
