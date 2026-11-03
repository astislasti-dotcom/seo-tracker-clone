// Offline tests for the temporary /gsc-test diagnostic. No network, no credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diagnosticEnabled, buildSummaryPath, describeSuccess, DIAG_BRANDS, DIAG_PERIODS, DIAG_GENERIC_ERROR } from '../lib/gsc/diagnostic.mjs';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('the diagnostic page is enabled only in Vercel Preview', () => {
  assert.equal(diagnosticEnabled({ VERCEL_ENV: 'preview' }), true);
  assert.equal(diagnosticEnabled({ VERCEL_ENV: 'production' }), false);
  assert.equal(diagnosticEnabled({ VERCEL_ENV: 'development' }), false);
  assert.equal(diagnosticEnabled({}), false);
  assert.equal(diagnosticEnabled(undefined), false);
});

test('only the two brands and the three periods are offered', () => {
  assert.deepEqual(DIAG_BRANDS.map((b) => b.domain), ['astisl.es', '3av.events']);
  assert.deepEqual(DIAG_BRANDS.map((b) => b.label), ['ASTI', '3AV']);
  assert.deepEqual([...DIAG_PERIODS], [7, 28, 90]);
});

test('the request path carries brand and period only, never a token', () => {
  assert.equal(buildSummaryPath({ brand: 'astisl.es', period: 28 }), '/api/gsc/summary?brand=astisl.es&period=28');
  const path = buildSummaryPath({ brand: '3av.events', period: '90' });
  assert.equal(path, '/api/gsc/summary?brand=3av.events&period=90');
  assert.equal(/token|access|bearer|authorization/i.test(path), false);
});

test('unknown brands and periods produce no path', () => {
  assert.equal(buildSummaryPath({ brand: 'evil.example', period: 28 }), null);
  assert.equal(buildSummaryPath({ brand: 'astisl.es', period: 30 }), null);
  assert.equal(buildSummaryPath({ brand: 'astisl.es&x=1', period: 28 }), null);
});

test('a success body is reduced to the fields the page shows', () => {
  const view = describeSuccess({
    brand: 'ASTI', period: 28, startDate: '2026-10-04', endDate: '2026-10-31', fetchedAt: '2026-11-03T15:00:00.000Z',
    noData: false, totals: { clicks: 12, impressions: 300, ctr: 0.04, averagePosition: 9.5 },
    positionLabel: 'posición media de Search Console', extra: 'ignored', fetchedBy: 'ignored',
  });
  assert.deepEqual(Object.keys(view).sort(), ['averagePosition', 'brand', 'clicks', 'ctr', 'endDate', 'fetchedAt', 'impressions', 'noData', 'period', 'positionLabel', 'startDate']);
  assert.equal(view.ctr, 0.04);
});

test('the generic error text is fixed and not derived from server text', () => {
  assert.equal(DIAG_GENERIC_ERROR, 'Error no identificado al consultar Search Console.');
});

test('the page is hidden outside Preview and is not indexed', async () => {
  const page = await read('app/gsc-test/page.jsx');
  assert.match(page, /notFound\(\)/);
  assert.match(page, /diagnosticEnabled\(process\.env\)/);
  assert.match(page, /await connection\(\)/);
  assert.match(page, /index: false/);
});

test('the client sends the token only in the Authorization header, never in a URL or storage', async () => {
  const client = await read('app/gsc-test/GscTestClient.jsx');
  assert.match(client, /headers: \{ Authorization: `Bearer \$\{token\}` \}/);
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(client), false);
  assert.equal(/console\.(log|error|warn|info)\(.*token/.test(client), false);
  assert.equal(/access_token=|\?token=|&token=/.test(client), false);
});

test('the client never fetches on mount and only queries on the button', async () => {
  const client = await read('app/gsc-test/GscTestClient.jsx');
  assert.equal(client.includes('useEffect'), false);
  assert.match(client, /Consultar GSC/);
  assert.match(client, /onClick=\{onQuery\}/);
});

test('the client cannot reach the service-account secret or Google directly', async () => {
  const client = await read('app/gsc-test/GscTestClient.jsx');
  assert.equal(client.includes('GSC_SERVICE_ACCOUNT_JSON'), false);
  assert.equal(client.includes('googleapis'), false);
  assert.equal(/NEXT_PUBLIC_GSC/.test(client), false);
});

test('the diagnostic page is not linked from the main navigation', async () => {
  for (const file of ['app/page.jsx', 'app/dashboard/page.jsx', 'app/layout.jsx']) {
    const source = await read(file);
    assert.equal(source.includes('/gsc-test'), false, file);
  }
});

test('the proxy decision denies everything except Preview', async () => {
  const { proxyDecision } = await import('../lib/gsc/diagnostic.mjs');
  assert.equal(proxyDecision({ VERCEL_ENV: 'preview' }), 'allow');
  assert.equal(proxyDecision({ VERCEL_ENV: 'production' }), 'deny');
  assert.equal(proxyDecision({ VERCEL_ENV: 'development' }), 'deny');
  assert.equal(proxyDecision({}), 'deny');
  const proxySource = await read('proxy.js');
  assert.match(proxySource, /status: 404/);
  assert.match(proxySource, /matcher: \['\/gsc-test'\]/);
});
