-- GSC-02a · Esquema de métricas diarias de Search Console (sin tablas de totales)
--
-- PROPUESTA. NO APLICAR en Supabase sin aprobación expresa del propietario.
-- Probar antes en PostgreSQL desechable: supabase/pending/tests/gsc_daily_metrics.test.sql
-- Ejecutar siempre dentro de UNA transacción (psql -1 o el editor SQL de Supabase): el archivo
-- no incluye BEGIN/COMMIT para poder probarse dentro de una transacción de prueba con ROLLBACK.
--
-- Decisiones (issue #20):
--   * Una fila por propiedad y día. Los totales de periodo se calculan desde estas filas.
--   * Sin tabla de totales. Sin brand: se deriva de property_domain en la aplicación.
--   * Escritura solo desde servidor con service_role (BYPASSRLS). anon y authenticated
--     no tienen ningún acceso: ni privilegios ni políticas.
--   * Idempotente: CREATE ... IF NOT EXISTS y clave primaria (property_domain, metric_date).
--     La aplicación escribe con INSERT ... ON CONFLICT DO UPDATE.
--   * No borra datos. Sin DROP, sin TRUNCATE.

-- Preflight: service_role debe existir y saltarse RLS (en Supabase está confirmado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Preflight failed: service_role must exist and bypass RLS';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gsc_daily_metrics (
  property_domain text         NOT NULL CHECK (property_domain IN ('astisl.es', '3av.events')),
  metric_date     date         NOT NULL,
  clicks          integer      NOT NULL CHECK (clicks >= 0),
  impressions     integer      NOT NULL CHECK (impressions >= 0),
  ctr             numeric(9,8) CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1)),
  avg_position    numeric(8,3) CHECK (avg_position IS NULL OR avg_position >= 0),
  data_state      text         NOT NULL CHECK (data_state IN ('final', 'provisional')),
  fetched_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (property_domain, metric_date)
);

CREATE TABLE IF NOT EXISTS public.gsc_sync_runs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  property_domain text         NOT NULL CHECK (property_domain IN ('astisl.es', '3av.events')),
  start_date      date         NOT NULL,
  end_date        date         NOT NULL,
  started_at      timestamptz  NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  rows_received   integer      NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  status          text         NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  error_code      text,
  CHECK (end_date >= start_date),
  CHECK (error_code IS NULL OR status = 'error')
);

CREATE INDEX IF NOT EXISTS gsc_sync_runs_property_started_idx
  ON public.gsc_sync_runs (property_domain, started_at DESC);

-- RLS activado sin políticas: cualquier rol sin BYPASSRLS queda denegado por defecto.
ALTER TABLE public.gsc_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_sync_runs ENABLE ROW LEVEL SECURITY;

-- Retirar privilegios por defecto (Supabase concede ALL a anon/authenticated en tablas nuevas).
REVOKE ALL ON public.gsc_daily_metrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gsc_sync_runs     FROM PUBLIC, anon, authenticated;

-- Solo el servidor escribe y lee. Sin DELETE: la retención se decidirá aparte.
GRANT SELECT, INSERT, UPDATE ON public.gsc_daily_metrics TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.gsc_sync_runs     TO service_role;

-- Postflight: lo que debe ser cierto tras aplicar.
DO $$
DECLARE
  policies integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gsc_daily_metrics'::regclass) THEN
    RAISE EXCEPTION 'Postflight failed: RLS not enabled on gsc_daily_metrics';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gsc_sync_runs'::regclass) THEN
    RAISE EXCEPTION 'Postflight failed: RLS not enabled on gsc_sync_runs';
  END IF;
  SELECT count(*) INTO policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('gsc_daily_metrics', 'gsc_sync_runs');
  IF policies <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: unexpected policies (%)', policies;
  END IF;
  IF has_table_privilege('anon', 'public.gsc_daily_metrics', 'SELECT')
     OR has_table_privilege('authenticated', 'public.gsc_daily_metrics', 'SELECT')
     OR has_table_privilege('anon', 'public.gsc_sync_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.gsc_sync_runs', 'SELECT') THEN
    RAISE EXCEPTION 'Postflight failed: anon or authenticated can read GSC tables';
  END IF;
  IF NOT (has_table_privilege('service_role', 'public.gsc_daily_metrics', 'INSERT')
      AND has_table_privilege('service_role', 'public.gsc_sync_runs', 'INSERT')) THEN
    RAISE EXCEPTION 'Postflight failed: service_role lost INSERT';
  END IF;
END $$;

