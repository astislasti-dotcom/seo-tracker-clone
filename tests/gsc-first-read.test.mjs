// Offline tests for the controlled Search Console read script. No network, no real keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  PROPERTIES, checkIdentity, checkKeyPath, describeError, fingerprint, formatRow, parseKeyFile, windowFor,
} from '../scripts/gsc/gsc-first-read.mjs';

const ROOT = new URL('../', import.meta.url);
const FAKE_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'fake-project-test',
  client_email: 'reader@example.test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE-TEST-ONLY\n-----END PRIVATE KEY-----\n',
});

test('the two documented properties are configured exactly', () => {
  assert.deepEqual(PROPERTIES.map((p) => [p.brand, p.siteUrl]), [['ASTI', 'https://astisl.es/'], ['3AV', 'sc-domain:3av.events']]);
});

test('parseKeyFile accepts a service account and rejects other shapes', () => {
  assert.equal(parseKeyFile(FAKE_KEY).ok, true);
  assert.equal(parseKeyFile('no json').ok, false);
  assert.equal(parseKeyFile(JSON.stringify({ type: 'authorized_user' })).ok, false);
  assert.equal(parseKeyFile(JSON.stringify({ type: 'service_account', client_email: 'x@y', private_key: 'nope' })).ok, false);
  assert.equal(parseKeyFile(JSON.stringify({ type: 'service_account', private_key: '-----BEGIN PRIVATE KEY-----' })).ok, false);
});

test('parseKeyFile failure reasons never include the key material', () => {
  const bad = JSON.stringify({ type: 'service_account', client_email: 'x@y', private_key: 'SECRET-VALUE-123' });
  const result = parseKeyFile(bad);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.reason, /SECRET-VALUE-123/);
});

test('checkKeyPath refuses a file inside the project folder', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'gsc-proj-'));
  try {
    const inside = path.join(project, 'clave.json');
    await writeFile(inside, FAKE_KEY);
    await assert.rejects(checkKeyPath(inside, project), /dentro de la carpeta del proyecto/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('checkKeyPath accepts a file outside the project and rejects missing or empty files', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'gsc-proj-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'gsc-out-'));
  try {
    const file = path.join(outside, 'clave.json');
    await writeFile(file, FAKE_KEY);
    assert.equal(await checkKeyPath(file, project), path.resolve(file));
    await assert.rejects(checkKeyPath(path.join(outside, 'no-existe.json'), project), /No se encuentra/);
    const empty = path.join(outside, 'vacio.json');
    await writeFile(empty, '');
    await assert.rejects(checkKeyPath(empty, project), /tamaño/);
    await assert.rejects(checkKeyPath('', project), /Falta la ruta/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('windowFor ends three days before today (UTC) and spans 28 days inclusive', () => {
  const w = windowFor(new Date('2026-11-04T10:00:00Z'));
  assert.deepEqual(w, { startDate: '2026-10-05', endDate: '2026-11-01' });
});

test('describeError exposes only status and reason, never the message', () => {
  const err = Object.assign(new Error('Bearer ya29.SECRET-TOKEN'), { code: 403, errors: [{ reason: 'forbidden' }] });
  const text = describeError(err);
  assert.equal(text, 'estado 403, motivo forbidden');
  assert.doesNotMatch(text, /SECRET|ya29/);
  assert.equal(describeError(new Error('x')), 'estado sin_estado');
});

test('formatRow reports totals, empty data and invalid multi-row responses', () => {
  const w = { startDate: '2026-10-05', endDate: '2026-11-01' };
  assert.match(formatRow('ASTI', { rows: [{ clicks: 10, impressions: 200, position: 12.345 }] }, w), /clics 10 · impresiones 200 · CTR 5\.00 % · posición media GSC 12\.3/);
  assert.match(formatRow('3AV', { rows: [] }, w), /sin datos/);
  assert.match(formatRow('3AV', { rows: [{ clicks: 1, impressions: 0, position: 0 }] }, w), /CTR —/);
  assert.match(formatRow('3AV', { rows: [{}, {}] }, w), /respuesta inesperada/);
});

test('the script never prints credential fields and has no network writes', async () => {
  const src = await readFile(new URL('scripts/gsc/gsc-first-read.mjs', ROOT), 'utf8');
  const logged = src.split('\n').filter((line) => /console\.(log|error)/.test(line));
  for (const line of logged) {
    // Un log puede mencionar una huella (fingerprint(...)), nunca el valor en claro.
    if (/key\.(projectId|clientEmail|credentials)|private_key|credentials/.test(line)) {
      assert.match(line, /fingerprint\(/, `raw identity value printed: ${line}`);
    }
  }
  // createHash(...).update(...) is hashing, not a database write: only Supabase-style writes are forbidden.
  assert.doesNotMatch(src, /\.(insert|upsert|delete)\(|\.from\(/);
  assert.doesNotMatch(src, /@supabase|VERCEL|SERPAPI/);
  assert.match(src, /webmasters\.readonly/);
});

const KEY_OK = { ok: true, projectId: 'fake-project-test', clientEmail: 'reader@example.test.iam.gserviceaccount.com' };
const expectedFor = (key = KEY_OK) => ({
  algorithm: 'sha256',
  namespace: 'gsc-first-read:v1:',
  projectIdSha256: fingerprint(key.projectId),
  clientEmailSha256: fingerprint(key.clientEmail),
});

test('fingerprint is a stable 64-character hex digest and depends on the namespace', () => {
  const a = fingerprint('value');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, fingerprint('value'));
  assert.notEqual(a, fingerprint('value', 'other:'));
  assert.notEqual(a, fingerprint('other'));
});

test('checkIdentity fails closed when the expected identity is not configured', () => {
  assert.equal(checkIdentity(KEY_OK, null).ok, false);
  assert.equal(checkIdentity(KEY_OK, { projectIdSha256: null, clientEmailSha256: null }).ok, false);
  assert.match(checkIdentity(KEY_OK, null).reason, /--fingerprint/);
});

test('checkIdentity passes only when project and service account both match', () => {
  assert.equal(checkIdentity(KEY_OK, expectedFor()).ok, true);
  const otherProject = { ...KEY_OK, projectId: 'another-project' };
  assert.equal(checkIdentity(otherProject, expectedFor()).ok, false);
  const otherAccount = { ...KEY_OK, clientEmail: 'intruder@example.test.iam.gserviceaccount.com' };
  assert.equal(checkIdentity(otherAccount, expectedFor()).ok, false);
});

test('identity mismatch reasons never reveal the identifiers', () => {
  const result = checkIdentity({ ...KEY_OK, projectId: 'secret-proj-xyz' }, expectedFor());
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.reason, /secret-proj-xyz|reader@|example\.test/);
});

test('parseKeyFile requires project_id and exposes it only as an internal field', () => {
  const noProject = JSON.stringify({ type: 'service_account', client_email: 'x@y.z', private_key: '-----BEGIN PRIVATE KEY-----' });
  assert.equal(parseKeyFile(noProject).ok, false);
  const parsed = parseKeyFile(FAKE_KEY);
  assert.equal(parsed.projectId, 'fake-project-test');
  assert.equal(parsed.clientEmail, 'reader@example.test.iam.gserviceaccount.com');
});

test('committed identity config holds only hashes, never plain identifiers', async () => {
  const text = await readFile(new URL('config/gsc-expected-service-account.json', ROOT), 'utf8');
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /"project_id"|"client_email"/);
  const json = JSON.parse(text);
  for (const field of ['projectIdSha256', 'clientEmailSha256']) {
    assert.ok(json[field] === null || /^[0-9a-f]{64}$/.test(json[field]), `${field} must be null or a sha256 hex`);
  }
});
