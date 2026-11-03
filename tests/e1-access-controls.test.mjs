// Offline tests for E1 access controls. No network, no Supabase, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authorizeOwner, bearerToken } from '../lib/auth/owner.mjs';
import { parseRange } from '../lib/keywords/history-range.mjs';
import { PAGE_SIZE } from '../lib/keywords/paginate.mjs';
import { buildDashboardModel } from '../lib/keywords/measurements.mjs';
import { GET as getTracking } from '../app/api/keyword-tracking/route.js';

const ROOT = new URL('../', import.meta.url);
const OWNER = 'owner@example.test';
const verifyAs = (email) => async () => ({ email });
const neverCalled = async () => { throw new Error('verifier must not run'); };

test('bearerToken accepts only a well-formed Bearer header', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken('Bearer '), null);
  assert.equal(bearerToken(undefined), null);
});

test('owner gate: missing owner configuration fails closed with 503', async () => {
  const r = await authorizeOwner({ authorization: 'Bearer t', ownerEmail: '', verifyAccessToken: verifyAs(OWNER) });
  assert.deepEqual([r.ok, r.status], [false, 503]);
});

test('owner gate: no token gives 401 and never calls the verifier', async () => {
  const r = await authorizeOwner({ authorization: undefined, ownerEmail: OWNER, verifyAccessToken: neverCalled });
  assert.deepEqual([r.ok, r.status], [false, 401]);
});

test('owner gate: verifier error or empty identity gives 401', async () => {
  const thrown = await authorizeOwner({
    authorization: 'Bearer t', ownerEmail: OWNER, verifyAccessToken: async () => { throw new Error('boom'); },
  });
  assert.equal(thrown.status, 401);
  const empty = await authorizeOwner({ authorization: 'Bearer t', ownerEmail: OWNER, verifyAccessToken: async () => null });
  assert.equal(empty.status, 401);
});

test('owner gate: a valid user who is not the owner gets 403', async () => {
  const r = await authorizeOwner({ authorization: 'Bearer t', ownerEmail: OWNER, verifyAccessToken: verifyAs('other@example.test') });
  assert.deepEqual([r.ok, r.status], [false, 403]);
});

test('owner gate: owner email matches case-insensitively', async () => {
  const r = await authorizeOwner({ authorization: 'Bearer t', ownerEmail: OWNER, verifyAccessToken: verifyAs('OWNER@Example.test') });
  assert.equal(r.ok, true);
});

test('range parser accepts one page and rejects malformed or oversized windows', () => {
  const p = (q) => parseRange(new URLSearchParams(q));
  assert.deepEqual(p('from=0&to=999'), { ok: true, from: 0, to: 999 });
  assert.equal(p('from=0&to=1000').error, 'range_too_large');
  assert.equal(p('from=-1&to=5').error, 'invalid_range');
  assert.equal(p('from=5&to=1').error, 'invalid_range');
  assert.equal(p('from=abc&to=1').error, 'invalid_range');
  assert.equal(p('to=1').error, 'invalid_range');
  assert.equal(PAGE_SIZE, 1000);
});

test('protected read route answers 401 to anonymous requests without touching the database', async () => {
  const saved = { owner: process.env.DASHBOARD_OWNER_EMAIL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.DASHBOARD_OWNER_EMAIL = OWNER;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-not-a-key';
  try {
    const res = await getTracking(new Request('http://localhost/api/keyword-tracking?from=0&to=9'));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json()).error, 'unauthorized');
  } finally {
    if (saved.owner === undefined) delete process.env.DASHBOARD_OWNER_EMAIL; else process.env.DASHBOARD_OWNER_EMAIL = saved.owner;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('protected read route answers 503 when the owner is not configured', async () => {
  const saved = process.env.DASHBOARD_OWNER_EMAIL;
  delete process.env.DASHBOARD_OWNER_EMAIL;
  try {
    const res = await getTracking(new Request('http://localhost/api/keyword-tracking?from=0&to=9', {
      headers: { authorization: 'Bearer fixture' },
    }));
    assert.equal(res.status, 503);
  } finally {
    if (saved !== undefined) process.env.DASHBOARD_OWNER_EMAIL = saved;
  }
});

test('dashboard model reports auth_required, never measurements, when the session is missing', () => {
  const catalog = [{ id: 1, keyword: 'fixture keyword', domain: 'astisl.es', priority: 'P1', intent: 'servicio' }];
  const model = buildDashboardModel({ catalogRaw: catalog, read: { ok: false, reason: 'unauthorized' } });
  assert.equal(model.status, 'auth_required');
  assert.equal(model.counts, null);
});

test('pending revoke SQL lives outside supabase/migrations and is not applied by the CLI', async () => {
  const sql = await readFile(new URL('supabase/pending/20261030_revoke_keyword_tracking_public_read.sql', ROOT), 'utf8');
  assert.match(sql, /NO EJECUTAR/);
  assert.match(sql, /REVOKE SELECT ON TABLE public\.keyword_tracking FROM anon, authenticated/);
  assert.match(sql, /DROP POLICY keyword_tracking_lectura_temporal/);
  assert.equal(/GRANT\s+SELECT[^;]*\b(anon|authenticated)\b/i.test(sql), false);
  await assert.rejects(readFile(new URL('supabase/migrations/20261030_revoke_keyword_tracking_public_read.sql', ROOT)));
});

test('dashboard no longer queries the database directly with the anon client', async () => {
  const source = await readFile(new URL('app/dashboard/page.jsx', ROOT), 'utf8');
  assert.equal(source.includes(".from('keyword_tracking')"), false);
  assert.equal(source.includes("/api/keyword-tracking?from="), true);
});

// ---- Catalog exposure (E1 correction) ----
import { existsSync } from 'node:fs';
import { GET as getCatalog } from '../app/api/keyword-catalog/route.js';

test('catalog file is no longer published under public/', () => {
  assert.equal(existsSync(new URL('public/keywords.json', ROOT)), false);
  assert.equal(existsSync(new URL('data/keywords.json', ROOT)), true);
});

test('anonymous request to the catalog API gets 401 and no keyword data', async () => {
  const saved = process.env.DASHBOARD_OWNER_EMAIL;
  process.env.DASHBOARD_OWNER_EMAIL = OWNER;
  try {
    const res = await getCatalog(new Request('http://localhost/api/keyword-catalog'));
    assert.equal(res.status, 401);
    const body = await res.text();
    assert.equal(body.includes('keyword'), false);
    assert.equal(body.includes('domain'), false);
  } finally {
    if (saved === undefined) delete process.env.DASHBOARD_OWNER_EMAIL; else process.env.DASHBOARD_OWNER_EMAIL = saved;
  }
});

test('catalog API fails closed (503) when the owner is not configured', async () => {
  const saved = process.env.DASHBOARD_OWNER_EMAIL;
  delete process.env.DASHBOARD_OWNER_EMAIL;
  try {
    const res = await getCatalog(new Request('http://localhost/api/keyword-catalog', { headers: { authorization: 'Bearer x' } }));
    assert.equal(res.status, 503);
  } finally {
    if (saved !== undefined) process.env.DASHBOARD_OWNER_EMAIL = saved;
  }
});

test('dashboard checks the session before any catalog or measurement request', async () => {
  const source = await readFile(new URL('app/dashboard/page.jsx', ROOT), 'utf8');
  assert.equal(source.includes("fetch('/keywords.json')"), false);
  const sessionAt = source.indexOf('getSession()');
  const catalogAt = source.indexOf('/api/keyword-catalog');
  const historyAt = source.indexOf('makeHistoryFetcher(session.access_token');
  assert.ok(sessionAt > 0 && catalogAt > sessionAt, 'session must be checked before the catalog request');
  assert.ok(historyAt > catalogAt, 'catalog must be loaded before measurements');
});

test('without a session the model is auth_required, even with no catalog', () => {
  const model = buildDashboardModel({ catalogRaw: null, read: { ok: false, reason: 'unauthorized' } });
  assert.equal(model.status, 'auth_required');
  assert.deepEqual(model.keywords, []);
});

test('legacy scripts and cron files read the catalog from data/, not public/', async () => {
  const files = [
    'app/api/cron/api-cron-track-keywords.js',
    'app/api/cron/track-keywords.js',
    'scripts/track-keywords-gsc.mjs',
    'scripts/track-keywords.mjs',
    'scripts/track-keywords-serpapi.mjs',
    'scripts/track-keywords-improved.mjs',
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, ROOT), 'utf8');
    assert.equal(source.includes("'public', 'keywords.json'"), false, `${file} still points to public/`);
    assert.equal(source.includes("'data', 'keywords.json'"), true, `${file} must read data/keywords.json`);
  }
});
