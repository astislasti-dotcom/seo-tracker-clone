// Comprobaciones estaticas OFFLINE de la migracion propuesta.
// No conectan con Supabase ni ejecutan SQL.
// Las pruebas de privilegios reales se haran solo tras autorizacion de despliegue.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync(
  new URL('../supabase/migrations/20261030083000_keyword_tracking_rls_readonly.sql', import.meta.url),
  'utf8'
);

test('migracion transaccional con bloqueo y limites de espera', () => {
  assert.match(migration, /\bBEGIN\s*;/i);
  assert.match(migration, /\bCOMMIT\s*;/i);
  assert.match(migration, /SET LOCAL lock_timeout\s*=/i);
  assert.match(migration, /SET LOCAL statement_timeout\s*=/i);
});

test('preflight aborta ante cambio de RLS, politicas o grants por columna', () => {
  assert.match(migration, /relrowsecurity\s*=\s*false/i);
  assert.match(migration, /FROM pg_policies/i);
  assert.match(migration, /attacl IS NOT NULL/i);
  assert.match(migration, /RAISE EXCEPTION 'Preflight failed:/i);
});

test('activa RLS, retira privilegios publicos y solo restaura SELECT', () => {
  assert.match(migration, /ALTER TABLE public\.keyword_tracking ENABLE ROW LEVEL SECURITY\s*;/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.keyword_tracking\s+FROM PUBLIC, anon, authenticated\s*;/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.keyword_tracking TO anon, authenticated\s*;/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\s+ON TABLE public\.keyword_tracking/i);
});

test('politica SELECT temporal conserva acceso del dashboard sin escritura', () => {
  assert.match(
    migration,
    /CREATE POLICY keyword_tracking_lectura_temporal\s+ON public\.keyword_tracking\s+AS PERMISSIVE\s+FOR SELECT\s+TO anon, authenticated\s+USING \(true\)\s*;/i
  );
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*?FOR\s+(?:ALL|INSERT|UPDATE|DELETE)/i);
});

test('postflight exige ausencia de escritura y protege service_role', () => {
  for (const permission of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    assert.ok(migration.includes(`has_table_privilege(client_role, 'public.keyword_tracking', '${permission}')`));
  }
  assert.match(migration, /has_table_privilege\('service_role', 'public\.keyword_tracking', 'INSERT'\)/);
  assert.match(migration, /RAISE EXCEPTION 'Postflight failed:/i);
});

test('service_role necesita INSERT y BYPASSRLS antes y despues del cambio', () => {
  const preflightStart = migration.indexOf('DO $preflight$');
  const preflightEnd = migration.indexOf('$preflight$;', preflightStart);
  const postflightStart = migration.indexOf('DO $postflight$');
  const postflightEnd = migration.indexOf('$postflight$;', postflightStart);
  assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);
  assert.ok(postflightStart >= 0 && postflightEnd > postflightStart);

  const preflight = migration.slice(preflightStart, preflightEnd);
  const postflight = migration.slice(postflightStart, postflightEnd);
  for (const section of [preflight, postflight]) {
    assert.match(section, /FROM pg_roles/);
    assert.match(section, /rolname = 'service_role' AND rolbypassrls/);
    assert.match(section, /RAISE EXCEPTION/);
  }
  assert.match(postflight, /has_table_privilege\('service_role', 'public\.keyword_tracking', 'INSERT'\)/);

  const enablePos = migration.indexOf('ALTER TABLE public.keyword_tracking ENABLE ROW LEVEL SECURITY;');
  assert.ok(preflightEnd < enablePos);
  assert.ok(enablePos < postflightStart);
});

test('no modifica datos ni otras tablas, no reabre RLS', () => {
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+public\.|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/i);
  assert.doesNotMatch(migration, /DISABLE\s+ROW LEVEL SECURITY/i);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?!keyword_tracking\b)/i);
});
