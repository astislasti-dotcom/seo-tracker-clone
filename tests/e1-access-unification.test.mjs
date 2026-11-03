// Offline tests for E1. No network, no Supabase, no secrets. Fixtures are fictional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GET, POST } from '../app/api/keywords/route.js';

const ROOT = new URL('../', import.meta.url);

test('POST /api/keywords is retired: anonymous insert is impossible', async () => {
  const res = await POST(new Request('http://localhost/api/keywords', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ keyword: 'fixture', domain: 'example.test' }]),
  }));
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, 'endpoint_retired');
});

test('GET /api/keywords is retired and sends no-store', async () => {
  const res = await GET();
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('keywords route no longer imports Supabase or writes to it', async () => {
  const source = await readFile(new URL('app/api/keywords/route.js', ROOT), 'utf8');
  assert.equal(source.includes('@supabase/supabase-js'), false);
  assert.equal(/\.insert\(|\.from\(/.test(source), false);
});

test('home page redirects to /dashboard and fetches nothing', async () => {
  const source = await readFile(new URL('app/page.jsx', ROOT), 'utf8');
  assert.match(source, /redirect\('\/dashboard'\)/);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("'use client'"), false);
});
