// Offline tests for owner password login and logout. No network, no Supabase, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MSG_CREDENTIALS,
  MSG_NETWORK,
  MSG_RATE_LIMIT,
  loginErrorMessage,
  normalizeEmail,
  signOutSafely,
} from '../lib/auth/password-login.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');

test('normalizeEmail trims and lowercases, and rejects non-strings', () => {
  assert.equal(normalizeEmail('  Marketing@AstiSL.es '), 'marketing@astisl.es');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(42), '');
});

test('loginErrorMessage: no error means no message', () => {
  assert.equal(loginErrorMessage(null), null);
  assert.equal(loginErrorMessage(undefined), null);
});

test('loginErrorMessage: rate limits are reported as rate limits', () => {
  assert.equal(loginErrorMessage({ status: 429, code: 'over_request_rate_limit' }), MSG_RATE_LIMIT);
  assert.equal(loginErrorMessage({ status: 400, code: 'over_email_send_rate_limit' }), MSG_RATE_LIMIT);
  assert.equal(loginErrorMessage({ status: 429 }), MSG_RATE_LIMIT);
});

test('loginErrorMessage: all credential failures share one generic message (no enumeration)', () => {
  const wrongPassword = loginErrorMessage({ status: 400, code: 'invalid_credentials' });
  const unknownUser = loginErrorMessage({ status: 400, code: 'user_not_found' });
  const notConfirmed = loginErrorMessage({ status: 400, code: 'email_not_confirmed' });
  const notAllowed = loginErrorMessage({ status: 403, code: 'signup_disabled' });
  assert.equal(wrongPassword, MSG_CREDENTIALS);
  assert.equal(unknownUser, MSG_CREDENTIALS);
  assert.equal(notConfirmed, MSG_CREDENTIALS);
  assert.equal(notAllowed, MSG_CREDENTIALS);
  for (const msg of [wrongPassword, unknownUser, notConfirmed]) {
    assert.doesNotMatch(msg, /existe|registrad|confirm|no encontr|not found/i);
  }
});

test('loginErrorMessage: server and network failures are not blamed on the credentials', () => {
  assert.equal(loginErrorMessage({ status: 503 }), MSG_NETWORK);
  assert.equal(loginErrorMessage(new TypeError('fetch failed')), MSG_NETWORK);
  assert.equal(loginErrorMessage({ status: 0 }), MSG_NETWORK);
});

test('messages are fixed Spanish strings and never echo raw error text', () => {
  const raw = 'secret-internal-detail-xyz';
  const msg = loginErrorMessage({ status: 400, message: raw, code: 'invalid_credentials' });
  assert.equal(msg.includes(raw), false);
  assert.match(MSG_CREDENTIALS, /contraseña/);
});

test('signOutSafely: local scope, returns true on success', async () => {
  const calls = [];
  const auth = { signOut: async (opts) => { calls.push(opts); return { error: null }; } };
  assert.equal(await signOutSafely(auth), true);
  assert.deepEqual(calls, [{ scope: 'local' }]);
});

test('signOutSafely: an error from Supabase returns false and does not throw', async () => {
  const auth = { signOut: async () => ({ error: { message: 'boom' } }) };
  assert.equal(await signOutSafely(auth), false);
});

test('signOutSafely: a thrown error returns false and does not throw', async () => {
  const auth = { signOut: async () => { throw new Error('network'); } };
  assert.equal(await signOutSafely(auth), false);
});

test('login page uses password sign-in only, with no OTP, no sign-up and no email redirect', async () => {
  const src = await read('app/login/page.jsx');
  assert.match(src, /signInWithPassword\(/);
  assert.doesNotMatch(src, /signInWithOtp/);
  assert.doesNotMatch(src, /signUp\(/);
  assert.doesNotMatch(src, /emailRedirectTo/);
  assert.match(src, /type="password"/);
  assert.match(src, /autoComplete="current-password"/);
});

test('login page never stores the password in storage, URLs or logs', async () => {
  const src = await read('app/login/page.jsx');
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
  assert.doesNotMatch(src, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(src, /NEXT_PUBLIC_[A-Z_]*PASSWORD/);
});

test('dashboard exposes logout through the shared helper', async () => {
  const src = await read('app/dashboard/page.jsx');
  assert.match(src, /signOutSafely\(supabase\.auth\)/);
  assert.match(src, /Cerrar sesión/);
  assert.match(src, /MSG_LOGOUT_FAILED/);
});

test('owner gate files are unchanged by this change (server boundary stays in lib/auth)', async () => {
  const owner = await read('lib/auth/owner.mjs');
  assert.match(owner, /export async function authorizeOwner/);
  assert.match(owner, /status: 403/);
});
