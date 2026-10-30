// Route-level gate for TRACKING_ENABLED. Offline: fetch is replaced by a stub that
// fails the test if called. Fixture secret only.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ROUTE = '../app/api/cron/track-keywords/route.js';
const FIXTURE_SECRET = 'fixture-cron-secret-flag';

const saved = { fetch: globalThis.fetch, secret: process.env.CRON_SECRET, flag: process.env.TRACKING_ENABLED };
let networkCalls = 0;

beforeEach(() => {
  networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('network access is not allowed in this test');
  };
  process.env.CRON_SECRET = FIXTURE_SECRET;
});

afterEach(() => {
  globalThis.fetch = saved.fetch;
  for (const [name, value] of [['CRON_SECRET', saved.secret], ['TRACKING_ENABLED', saved.flag]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function callGET(authorization = `Bearer ${FIXTURE_SECRET}`) {
  const { GET } = await import(ROUTE);
  const headers = authorization === undefined ? {} : { authorization };
  const response = await GET(new Request('http://localhost/api/cron/track-keywords', { headers }));
  return { status: response.status, body: await response.json() };
}

test('la bandera ausente, vacía o distinta de "true" deja la ruta desactivada, sin red', async () => {
  const values = [undefined, '', 'TRUE', 'True', '1', 'yes', 'false', ' true'];
  for (const value of values) {
    if (value === undefined) delete process.env.TRACKING_ENABLED;
    else process.env.TRACKING_ENABLED = value;
    const r = await callGET();
    assert.equal(r.status, 200, `flag=${JSON.stringify(value)}`);
    assert.equal(r.body.status, 'disabled');
    assert.equal(r.body.tracking_executed, false);
  }
  assert.equal(networkCalls, 0);
});

test('TRACKING_ENABLED="true" sin persistencia verificada: bloqueado, sin medir ni escribir', async () => {
  process.env.TRACKING_ENABLED = 'true';
  const r = await callGET();
  assert.equal(r.status, 503);
  assert.equal(r.body.status, 'blocked');
  assert.equal(r.body.reason, 'persistence_not_verified');
  assert.equal(r.body.tracking_executed, false);
  assert.equal(networkCalls, 0);
});

test('la autenticación sigue primero: bandera activa + sin secreto = 503 cron_not_configured', async () => {
  process.env.TRACKING_ENABLED = 'true';
  delete process.env.CRON_SECRET;
  const r = await callGET(`Bearer ${FIXTURE_SECRET}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'cron_not_configured');
  assert.equal(networkCalls, 0);
});

test('bandera activa + autorización incorrecta = 401, sin red', async () => {
  process.env.TRACKING_ENABLED = 'true';
  const r = await callGET('Bearer wrong');
  assert.equal(r.status, 401);
  assert.equal(networkCalls, 0);
});
