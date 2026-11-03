// Offline tests for GSC-01. No network, no credentials. Every Google call goes through
// a fake transport that fails the test if it is reached without being injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_PERIODS, ASSUMED_FINAL_LAG_DAYS, GSC_SCOPE } from '../lib/gsc/constants.mjs';
import { parsePeriod, periodWindow } from '../lib/gsc/periods.mjs';
import { resolveProperty } from '../lib/gsc/config.mjs';
import { parseServiceAccount } from '../lib/gsc/credentials.mjs';
import { gscErrorMessage, mapGoogleError } from '../lib/gsc/errors.mjs';
import { buildTotals } from '../lib/gsc/summary.mjs';
import { fetchTotals } from '../lib/gsc/client.mjs';
import { handleSummary } from '../lib/gsc/handler.mjs';
import { readFile } from 'node:fs/promises';

const OWNER = 'owner@example.test';
const NOW = new Date('2026-11-03T12:00:00Z');
const BEGIN = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const FIXTURE_KEY = `${BEGIN}\nFIXTURE-NOT-A-KEY\n-----END PRIVATE KEY-----\n`;
const FIXTURE_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
  private_key: FIXTURE_KEY,
});
const CONFIG = {
  _nota: 'ignored',
  'astisl.es': { brand: 'ASTI', siteUrl: 'sc-domain:astisl.es' },
  '3av.events': { brand: '3AV', siteUrl: null },
};
const noNetwork = async () => { throw new Error('transport must not be called in this test'); };
const verifyAs = (email) => async () => ({ email });
const req = (query = '', authorization = 'Bearer fixture-token') =>
  new Request(`http://localhost/api/gsc/summary${query}`, { headers: authorization ? { authorization } : {} });
const deps = (overrides = {}) => ({
  config: CONFIG,
  ownerEmail: OWNER,
  verifyAccessToken: verifyAs(OWNER),
  rawCredentials: FIXTURE_JSON,
  now: () => NOW,
  transport: noNetwork,
  ...overrides,
});

// ---- scope and periods ----

test('scope is strictly read-only', () => {
  assert.equal(GSC_SCOPE, 'https://www.googleapis.com/auth/webmasters.readonly');
});

test('only 7, 28 and 90 days are accepted', () => {
  assert.deepEqual(ALLOWED_PERIODS, [7, 28, 90]);
  for (const bad of ['30', '', 'abc', '7.5', '-7', '0', '9999']) assert.equal(parsePeriod(bad), null, bad);
  assert.equal(parsePeriod('28'), 28);
});

test('windows end at today minus the assumed lag and span the requested days inclusively', () => {
  assert.equal(ASSUMED_FINAL_LAG_DAYS, 3);
  const w7 = periodWindow(7, NOW);
  assert.deepEqual([w7.startDate, w7.endDate], ['2026-10-25', '2026-10-31']);
  const w28 = periodWindow(28, NOW);
  assert.deepEqual([w28.startDate, w28.endDate], ['2026-10-04', '2026-10-31']);
  const w90 = periodWindow(90, NOW);
  assert.deepEqual([w90.startDate, w90.endDate], ['2026-08-03', '2026-10-31']);
  for (const w of [w7, w28, w90]) {
    const span = (Date.parse(w.endDate) - Date.parse(w.startDate)) / 86_400_000 + 1;
    assert.equal(span, w.days);
  }
});

test('windows are computed in UTC, so the local clock cannot shift them', () => {
  const late = new Date('2026-11-03T23:30:00Z');
  assert.equal(periodWindow(7, late).endDate, '2026-10-31');
});

test('unsupported periods are rejected by periodWindow', () => {
  assert.throws(() => periodWindow(30, NOW), RangeError);
});

// ---- property configuration ----

test('unconfirmed properties are not usable (null, empty or malformed)', () => {
  assert.equal(resolveProperty(CONFIG, '3av.events').code, 'property_not_configured');
  const empty = { 'x.example': { brand: 'X', siteUrl: '   ' } };
  assert.equal(resolveProperty(empty, 'x.example').code, 'property_not_configured');
  const bad = { 'x.example': { brand: 'X', siteUrl: 'javascript:alert(1)' } };
  assert.equal(resolveProperty(bad, 'x.example').code, 'property_not_configured');
});

test('configured properties accept both documented formats and nothing else', () => {
  assert.equal(resolveProperty(CONFIG, 'astisl.es').siteUrl, 'sc-domain:astisl.es');
  const prefix = { 'x.example': { brand: 'X', siteUrl: 'https://x.example/' } };
  assert.equal(resolveProperty(prefix, 'x.example').siteUrl, 'https://x.example/');
  const notDomain = { 'x.example': { brand: 'X', siteUrl: 'x.example' } };
  assert.equal(resolveProperty(notDomain, 'x.example').code, 'property_not_configured');
});

test('unknown brands and non-brand keys (such as the note) are invalid_brand', () => {
  assert.equal(resolveProperty(CONFIG, 'nope.example').code, 'invalid_brand');
  assert.equal(resolveProperty(CONFIG, '_nota').code, 'invalid_brand');
  assert.equal(resolveProperty(CONFIG, undefined).code, 'invalid_brand');
});

// ---- credentials ----

test('credentials: missing, malformed or wrong-type input fails closed', () => {
  assert.equal(parseServiceAccount(undefined).code, 'credentials_missing');
  assert.equal(parseServiceAccount('   ').code, 'credentials_missing');
  assert.equal(parseServiceAccount('{not json').code, 'credentials_invalid');
  assert.equal(parseServiceAccount(JSON.stringify({ type: 'authorized_user' })).code, 'credentials_invalid');
  assert.equal(parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'a@b' })).code, 'credentials_invalid');
});

test('valid credentials keep only the two fields needed and never echo them in errors', () => {
  const ok = parseServiceAccount(FIXTURE_JSON);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.credentials).sort(), ['client_email', 'private_key']);
  const bad = parseServiceAccount(FIXTURE_JSON.replace('"service_account"', '"other"'));
  assert.equal(JSON.stringify(bad).includes('FIXTURE-NOT-A-KEY'), false);
  assert.equal(JSON.stringify(bad).includes('fixture@'), false);
});

// ---- error mapping ----

test('Google failures map to stable codes', () => {
  assert.equal(mapGoogleError({ code: 401 }).code, 'credentials_invalid');
  assert.equal(mapGoogleError({ message: 'invalid_grant: bad token' }).code, 'credentials_invalid');
  assert.equal(mapGoogleError({ response: { status: 403 } }).code, 'permission_denied');
  assert.equal(mapGoogleError({ code: 404 }).code, 'property_not_found');
  assert.equal(mapGoogleError({ code: 429 }).code, 'quota_exceeded');
  assert.equal(mapGoogleError({ code: 503 }).code, 'unavailable');
  assert.equal(mapGoogleError({ code: 418 }).code, 'unknown');
  assert.equal(mapGoogleError(new Error('anything')).code, 'unknown');
});

test('error messages are fixed sentences, never raw text', () => {
  for (const code of ['credentials_invalid', 'permission_denied', 'quota_exceeded', 'unknown']) {
    assert.equal(typeof gscErrorMessage(code), 'string');
    assert.equal(gscErrorMessage(code).includes('FIXTURE'), false);
  }
});

// ---- totals ----

test('no rows means no data: zeros and null ratios, not an error', () => {
  const r = buildTotals({ rows: [] });
  assert.equal(r.ok, true);
  assert.equal(r.noData, true);
  assert.deepEqual(r.totals, { clicks: 0, impressions: 0, ctr: null, averagePosition: null });
});

test('one combined row gives totals; CTR is computed and never divides by zero', () => {
  const r = buildTotals({ rows: [{ clicks: 10, impressions: 200, position: 7.4 }] });
  assert.equal(r.totals.ctr, 0.05);
  assert.equal(r.totals.averagePosition, 7.4);
  const zero = buildTotals({ rows: [{ clicks: 0, impressions: 0, position: 0 }] });
  assert.equal(zero.totals.ctr, null);
  assert.equal(zero.totals.averagePosition, null);
});

test('several rows are rejected: totals are never summed locally', () => {
  const r = buildTotals({ rows: [{ clicks: 1, impressions: 2, position: 3 }, { clicks: 1, impressions: 2, position: 3 }] });
  assert.equal(r.code, 'invalid_response');
});

test('non-numeric values are rejected', () => {
  assert.equal(buildTotals({ rows: [{ clicks: 'x', impressions: 1, position: 1 }] }).code, 'invalid_response');
});

// ---- client with a fake transport ----

test('client asks for a dimension-less, final-data query over the window', async () => {
  let sent;
  const transport = async ({ body }) => {
    sent = body;
    return { rows: [{ clicks: 1, impressions: 10, position: 2 }] };
  };
  const window = periodWindow(7, NOW);
  const r = await fetchTotals({ credentials: {}, siteUrl: 'sc-domain:astisl.es', window, transport });
  assert.equal(r.ok, true);
  assert.deepEqual(sent, { startDate: '2026-10-25', endDate: '2026-10-31', dataState: 'final' });
  assert.equal('dimensions' in sent, false);
});

test('client returns only a code when the transport throws, not the raw error text', async () => {
  const transport = async () => {
    const e = new Error(`denied for ${FIXTURE_KEY}`);
    e.code = 403;
    throw e;
  };
  const r = await fetchTotals({ credentials: {}, siteUrl: 'sc-domain:astisl.es', window: periodWindow(7, NOW), transport });
  assert.deepEqual(r, { ok: false, code: 'permission_denied' });
  assert.equal(JSON.stringify(r).includes('FIXTURE'), false);
});

// ---- handler (owner gate, parameters, configuration, credentials, Google) ----

test('anonymous request gets 401 and no Google call is made', async () => {
  const res = await handleSummary(req('?brand=astisl.es&period=28', null), deps({ verifyAccessToken: async () => { throw new Error('must not verify'); } }));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('another user gets 403', async () => {
  const res = await handleSummary(req('?brand=astisl.es&period=28'), deps({ verifyAccessToken: verifyAs('other@example.test') }));
  assert.equal(res.status, 403);
});

test('invalid period and unknown brand are rejected before credentials are read', async () => {
  assert.equal((await handleSummary(req('?brand=astisl.es&period=30'), deps())).status, 400);
  assert.equal((await handleSummary(req('?brand=nope.example&period=28'), deps())).status, 400);
});

test('an unconfirmed property returns 503 and never calls Google', async () => {
  const res = await handleSummary(req('?brand=3av.events&period=28'), deps());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'property_not_configured');
});

test('missing or invalid credentials return 503 without exposing them', async () => {
  const missing = await handleSummary(req('?brand=astisl.es&period=28'), deps({ rawCredentials: undefined }));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'credentials_missing');
  const broken = await handleSummary(req('?brand=astisl.es&period=28'), deps({ rawCredentials: '{"private_key":"' + FIXTURE_KEY }));
  const text = await broken.text();
  assert.equal(broken.status, 503);
  assert.equal(text.includes('FIXTURE'), false);
});

test('success returns totals with source, window, date and the position caveat', async () => {
  const transport = async () => ({ rows: [{ clicks: 12, impressions: 300, position: 9.5 }] });
  const res = await handleSummary(req('?brand=astisl.es&period=28'), deps({ transport }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'google_search_console');
  assert.equal(body.brand, 'ASTI');
  assert.equal(body.period, 28);
  assert.deepEqual([body.startDate, body.endDate], ['2026-10-04', '2026-10-31']);
  assert.equal(body.totals.ctr, 0.04);
  assert.match(body.positionLabel, /no es una posición en los resultados/);
  assert.equal(body.fetchedAt, NOW.toISOString());
  assert.equal(JSON.stringify(body).includes('BEGIN'), false);
  assert.equal(JSON.stringify(body).includes('fixture@'), false);
});

test('Google 403 becomes a 403 with a fixed message and no raw text', async () => {
  const transport = async () => {
    const e = new Error(`raw detail ${FIXTURE_JSON}`);
    e.code = 403;
    throw e;
  };
  const res = await handleSummary(req('?brand=astisl.es&period=7'), deps({ transport }));
  const text = await res.text();
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(text).error, 'permission_denied');
  assert.equal(text.includes('raw detail'), false);
  assert.equal(text.includes('FIXTURE'), false);
});

test('quota and unavailable errors map to 429 and 503', async () => {
  const quota = async () => { const e = new Error('x'); e.code = 429; throw e; };
  const down = async () => { const e = new Error('x'); e.code = 500; throw e; };
  assert.equal((await handleSummary(req('?brand=astisl.es&period=7'), deps({ transport: quota }))).status, 429);
  assert.equal((await handleSummary(req('?brand=astisl.es&period=7'), deps({ transport: down }))).status, 503);
});

test('the route wires only the server environment and the owner gate', async () => {
  const source = await readFile(new URL('../app/api/gsc/summary/route.js', import.meta.url), 'utf8');
  assert.equal(source.includes('NEXT_PUBLIC'), false);
  assert.equal(source.includes('GSC_SERVICE_ACCOUNT_JSON'), true);
  assert.equal(/return\s+Response\.json\(\s*process\.env/.test(source), false);
});
