// Local tests for the cron route. No network: fetch is replaced by a stub that
// fails the test if called. No secrets are printed; fixtures are fictional.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ROUTE = '../app/api/cron/track-keywords/route.js';
const FIXTURE_SECRET = 'fixture-cron-secret-0000';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.CRON_SECRET;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error('network access is not allowed in this test');
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function makeRequest(authorization) {
  const headers = authorization === undefined ? {} : { authorization };
  return new Request('http://localhost/api/cron/track-keywords', { headers });
}

async function callGET(authorization) {
  const { GET } = await import(ROUTE);
  const response = await GET(makeRequest(authorization));
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

test('(a) sin CRON_SECRET no autoriza, aunque llegue una cabecera "correcta"', async () => {
  delete process.env.CRON_SECRET;
  const r = await callGET(`Bearer ${FIXTURE_SECRET}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'cron_not_configured');
  assert.equal(fetchCalls, 0);
});

test('(a2) CRON_SECRET vacío o solo espacios equivale a no configurado', async () => {
  for (const value of ['', '   ']) {
    process.env.CRON_SECRET = value;
    const r = await callGET('Bearer ');
    assert.equal(r.status, 503);
  }
  assert.equal(fetchCalls, 0);
});

test('(b) secreto definido + autorización inválida devuelve 401 sin revelar el secreto', async () => {
  process.env.CRON_SECRET = FIXTURE_SECRET;
  for (const header of [undefined, 'Bearer wrong-token', `Basic ${FIXTURE_SECRET}`, FIXTURE_SECRET]) {
    const r = await callGET(header);
    assert.equal(r.status, 401, `header=${header === undefined ? '<none>' : 'provided'}`);
    assert.equal(r.body.error, 'unauthorized');
    assert.ok(!r.text.includes(FIXTURE_SECRET), 'la respuesta no debe contener el secreto');
  }
  assert.equal(fetchCalls, 0);
});

test('(c) secreto definido + autorización correcta devuelve desactivado, sin tracking', async () => {
  process.env.CRON_SECRET = FIXTURE_SECRET;
  const r = await callGET(`Bearer ${FIXTURE_SECRET}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'disabled');
  assert.equal(r.body.tracking_executed, false);
  assert.ok(!Number.isNaN(Date.parse(r.body.checked_at)), 'checked_at debe ser fecha ISO válida');
  assert.ok(!r.text.includes(FIXTURE_SECRET));
  assert.equal(fetchCalls, 0, 'no debe llamar a ninguna API externa');
});
