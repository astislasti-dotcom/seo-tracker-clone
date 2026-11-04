// Static checks for the GSC-02a SQL proposal. Reads files only: no database, no network.
// The behavioural tests (RLS, idempotency) run in a disposable PostgreSQL:
// supabase/pending/tests/gsc_daily_metrics.test.sql
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const sql = await readFile(new URL('supabase/pending/20261104_gsc_daily_metrics.sql', ROOT), 'utf8');
const runner = await readFile(new URL('supabase/pending/tests/run.sh', ROOT), 'utf8');
const testSql = await readFile(new URL('supabase/pending/tests/gsc_daily_metrics.test.sql', ROOT), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('both GSC tables enable row level security and define no policies', () => {
  assert.match(code, /ALTER TABLE public\.gsc_daily_metrics ENABLE ROW LEVEL SECURITY;/);
  assert.match(code, /ALTER TABLE public\.gsc_sync_runs ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(code, /CREATE POLICY/i);
});

test('anon, authenticated and PUBLIC lose every privilege on the GSC tables', () => {
  assert.match(code, /REVOKE ALL ON public\.gsc_daily_metrics FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(code, /REVOKE ALL ON public\.gsc_sync_runs\s+FROM PUBLIC, anon, authenticated, service_role;/);
});

test('only service_role receives privileges, and never DELETE or TRUNCATE', () => {
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.gsc_daily_metrics TO service_role;/);
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.gsc_sync_runs\s+TO service_role;/);
  assert.doesNotMatch(code, /\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  assert.doesNotMatch(code, /\bGRANT\b[^;]*\b(DELETE|TRUNCATE)\b/i); // la postflight comprueba DELETE, pero nunca lo concede
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|POLICY|INDEX)\b/i);
});

test('the migration is idempotent and does not run its own transaction', () => {
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.gsc_daily_metrics/);
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.gsc_sync_runs/);
  assert.match(code, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(code, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
});

test('daily key is (property_domain, metric_date) and properties are restricted to the two domains', () => {
  assert.match(code, /PRIMARY KEY \(property_domain, metric_date\)/);
  assert.match(code, /property_domain IN \('astisl\.es', '3av\.events'\)/);
});

test('postflight checks every privilege for anon, authenticated and PUBLIC via has_table_privilege and aclexplode', () => {
  assert.match(code, /'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'/);
  assert.match(code, /aclexplode\(c\.relacl\)/);
  assert.match(code, /acl\.grantee = 0/);
  assert.match(code, /service_role privilege % on % is not the expected one/);
});

test('preflight refuses pre-existing tables with an incompatible structure or primary key', () => {
  assert.match(code, /incompatible structure/);
  assert.match(code, /incompatible primary key/);
  assert.match(code, /information_schema\.columns/);
  assert.match(code, /ARRAY\['property_domain', 'metric_date'\]/);
  assert.match(code, /ARRAY\['id'\]/);
});

test('the database test checks privileges and the runner covers negative controls', () => {
  assert.match(testSql, /1b\) Privilegios/);
  assert.match(runner, /no-revoke\.sql/);
  assert.match(runner, /grant-truncate\.sql/);
  assert.match(runner, /pre_incompatible_type\.sql/);
  assert.match(runner, /pre_no_pk\.sql/);
});
