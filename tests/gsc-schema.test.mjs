// Static checks for the GSC-02a SQL proposal. Reads files only: no database, no network.
// The behavioural tests (RLS, idempotency) run in a disposable PostgreSQL:
// supabase/pending/tests/gsc_daily_metrics.test.sql
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const sql = await readFile(new URL('supabase/pending/20261104_gsc_daily_metrics.sql', ROOT), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('both GSC tables enable row level security and define no policies', () => {
  assert.match(code, /ALTER TABLE public\.gsc_daily_metrics ENABLE ROW LEVEL SECURITY;/);
  assert.match(code, /ALTER TABLE public\.gsc_sync_runs ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(code, /CREATE POLICY/i);
});

test('anon, authenticated and PUBLIC lose every privilege on the GSC tables', () => {
  assert.match(code, /REVOKE ALL ON public\.gsc_daily_metrics FROM PUBLIC, anon, authenticated;/);
  assert.match(code, /REVOKE ALL ON public\.gsc_sync_runs\s+FROM PUBLIC, anon, authenticated;/);
});

test('only service_role receives privileges, and never DELETE or TRUNCATE', () => {
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.gsc_daily_metrics TO service_role;/);
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.gsc_sync_runs\s+TO service_role;/);
  assert.doesNotMatch(code, /\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  assert.doesNotMatch(code, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i);
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

test('postflight refuses to finish if anon or authenticated can read', () => {
  assert.match(code, /anon or authenticated can read GSC tables/);
});
