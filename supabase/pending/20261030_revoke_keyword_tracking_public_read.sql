-- SEO Tracker / E1 — revoke public read of public.keyword_tracking.
-- ESTADO: PENDIENTE. NO EJECUTAR sin autorizacion expresa del propietario.
-- Esta carpeta NO es supabase/migrations: la CLI no la aplica automaticamente.
-- Requisito previo: el dashboard debe leer mediante /api/keyword-tracking (servidor)
-- y el acceso del propietario debe estar verificado en produccion.
-- No modifica filas. No concede nada a anon ni a authenticated.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preflight: aborta si el estado no es el que dejo la migracion 20261030083000.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'keyword_tracking' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Preflight failed: RLS is not enabled on keyword_tracking';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'keyword_tracking'
      AND policyname = 'keyword_tracking_lectura_temporal'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: temporary read policy not found; review before continuing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Preflight failed: service_role must bypass RLS';
  END IF;
END;
$preflight$;

-- Quitar la lectura publica temporal.
DROP POLICY keyword_tracking_lectura_temporal ON public.keyword_tracking;
REVOKE SELECT ON TABLE public.keyword_tracking FROM anon, authenticated;

-- Postflight: ningun rol cliente puede leer ni escribir; service_role conserva acceso.
DO $postflight$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_table_privilege(client_role, 'public.keyword_tracking', 'SELECT')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'INSERT')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'UPDATE')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'DELETE')
    THEN
      RAISE EXCEPTION 'Postflight failed: % still has table privileges', client_role;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.keyword_tracking', 'INSERT') THEN
    RAISE EXCEPTION 'Postflight failed: service_role lost INSERT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Postflight failed: service_role does not bypass RLS';
  END IF;
END;
$postflight$;

COMMIT;

-- ROLLBACK (solo con autorizacion nueva): si el panel deja de funcionar, NO reabrir
-- escrituras publicas. Corregir hacia delante: revisar la ruta /api/keyword-tracking
-- y el acceso del propietario. Una reapertura temporal de SELECT requiere aprobacion
-- expresa y debe registrarse en el issue #15.
