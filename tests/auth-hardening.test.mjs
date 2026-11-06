// Offline checks for the AUTH-02 hardening: internal identity, noindex and anti-framing.
// Reads source files only: no network, no Supabase, no Vercel, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');

test('login metadata asks search engines not to index or follow the page', async () => {
  const src = await read('app/login/layout.jsx');
  assert.match(src, /robots: \{ index: false, follow: false/);
  assert.match(src, /title: 'Acceso · Panel interno ASTI y 3AV Events'/);
});

test('login page identifies the tool as internal to ASTI and 3AV Events', async () => {
  const src = await read('app/login/page.jsx');
  assert.match(src, /Panel interno · ASTI y 3AV Events/);
  assert.match(src, /Acceso restringido al personal autorizado/);
  assert.doesNotMatch(src, /Acceso al panel</);
});

test('anti-framing headers apply to every route', async () => {
  const src = await read('next.config.ts');
  assert.match(src, /async headers\(\)/);
  assert.match(src, /source: "\/\(\.\*\)"/);
  assert.match(src, /key: "X-Frame-Options", value: "DENY"/);
  assert.match(src, /key: "Content-Security-Policy", value: "frame-ancestors 'none'"/);
});

test('no general CSP is introduced: the only CSP value is frame-ancestors', async () => {
  const src = await read('next.config.ts');
  const cspValues = [...src.matchAll(/value: "([^"]*)"/g)].map((m) => m[1]).filter((v) => /-src|default-src|script-src/.test(v));
  assert.deepEqual(cspValues, []);
});

test('authentication code is unchanged by the hardening (password sign-in, owner gate)', async () => {
  const login = await read('app/login/page.jsx');
  assert.match(login, /signInWithPassword\(/);
  assert.doesNotMatch(login, /signInWithOtp|signUp\(/);
  const owner = await read('lib/auth/owner.mjs');
  assert.match(owner, /export async function authorizeOwner/);
});
