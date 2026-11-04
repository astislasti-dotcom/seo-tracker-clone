-- Prueba en PostgreSQL DESECHABLE (nunca contra Supabase). Datos ficticios.
-- Ejecutar: psql -v ON_ERROR_STOP=1 -f supabase/pending/tests/gsc_daily_metrics.test.sql
-- Simula los roles de Supabase: anon, authenticated, service_role (BYPASSRLS) y los
-- privilegios por defecto que Supabase concede a tablas nuevas. Todo se revierte al final.

\set ON_ERROR_STOP on

-- Roles de Supabase (idempotente).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Privilegios por defecto de Supabase en tablas nuevas (lo que la migración debe retirar).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

BEGIN;

\i supabase/pending/20261104_gsc_daily_metrics.sql

-- 1) La migración deja RLS activo y sin políticas.
DO $$ BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gsc_daily_metrics'::regclass), 'RLS off (daily)';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gsc_sync_runs'::regclass), 'RLS off (runs)';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename LIKE 'gsc_%') = 0, 'unexpected policies';
  RAISE NOTICE 'OK 1: RLS activo, sin políticas';
END $$;

-- 2) Idempotencia de la migración: aplicarla de nuevo no falla ni cambia el esquema.
\i supabase/pending/20261104_gsc_daily_metrics.sql
\echo 'OK 2: segunda aplicación de la migración sin error'

-- 3) service_role escribe con upsert; repetir el mismo rango no duplica filas.
SET LOCAL ROLE service_role;
INSERT INTO public.gsc_daily_metrics (property_domain, metric_date, clicks, impressions, ctr, avg_position, data_state)
VALUES
  ('astisl.es', '2026-10-30', 5, 300, 0.01666667, 12.5, 'final'),
  ('astisl.es', '2026-10-31', 7, 320, 0.02187500, 11.9, 'final'),
  ('3av.events', '2026-10-30', 0, 4, 0, 20.0, 'final');
-- Mismo rango, segunda sincronización con valores actualizados.
INSERT INTO public.gsc_daily_metrics (property_domain, metric_date, clicks, impressions, ctr, avg_position, data_state)
VALUES
  ('astisl.es', '2026-10-30', 6, 310, 0.01935484, 12.1, 'final'),
  ('astisl.es', '2026-10-31', 7, 320, 0.02187500, 11.9, 'final'),
  ('3av.events', '2026-10-30', 0, 4, 0, 20.0, 'final')
ON CONFLICT (property_domain, metric_date) DO UPDATE SET
  clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr,
  avg_position = EXCLUDED.avg_position, data_state = EXCLUDED.data_state, fetched_at = now();
-- Repetir exactamente la misma sincronización.
INSERT INTO public.gsc_daily_metrics (property_domain, metric_date, clicks, impressions, ctr, avg_position, data_state)
VALUES ('astisl.es', '2026-10-31', 7, 320, 0.02187500, 11.9, 'final')
ON CONFLICT (property_domain, metric_date) DO UPDATE SET
  clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr,
  avg_position = EXCLUDED.avg_position, data_state = EXCLUDED.data_state, fetched_at = now();
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.gsc_daily_metrics) = 3, 'upsert duplicated rows';
  ASSERT (SELECT clicks FROM public.gsc_daily_metrics WHERE property_domain='astisl.es' AND metric_date='2026-10-30') = 6, 'upsert did not update';
  RAISE NOTICE 'OK 3: upsert idempotente (3 filas tras dos sincronizaciones)';
END $$;
RESET ROLE;

-- 4) Constraints de datos: negativos, CTR fuera de rango, estado inválido, property desconocida.
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN INSERT INTO public.gsc_daily_metrics VALUES ('astisl.es', '2026-10-01', -1, 1, 0, 1, 'final', now()); RAISE EXCEPTION 'negative clicks accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.gsc_daily_metrics VALUES ('astisl.es', '2026-10-02', 1, 1, 1.5, 1, 'final', now()); RAISE EXCEPTION 'ctr > 1 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.gsc_daily_metrics VALUES ('astisl.es', '2026-10-03', 1, 1, 0, 1, 'unknown', now()); RAISE EXCEPTION 'bad data_state accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.gsc_daily_metrics VALUES ('otro.example', '2026-10-04', 1, 1, 0, 1, 'final', now()); RAISE EXCEPTION 'unknown property accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'OK 4: constraints de datos';
END $$;
RESET ROLE;

-- 5) RLS y privilegios: anon y authenticated no pueden leer ni escribir.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.gsc_daily_metrics; RAISE EXCEPTION 'anon can read daily';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.gsc_daily_metrics VALUES ('astisl.es', '2026-09-01', 1, 1, 0, 1, 'final', now()); RAISE EXCEPTION 'anon can write daily';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.gsc_sync_runs; RAISE EXCEPTION 'anon can read runs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK 5a: anon denegado (lectura y escritura)';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.gsc_daily_metrics; RAISE EXCEPTION 'authenticated can read daily';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.gsc_daily_metrics SET clicks = 0; RAISE EXCEPTION 'authenticated can update daily';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.gsc_daily_metrics; RAISE EXCEPTION 'authenticated can delete daily';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK 5b: authenticated denegado (lectura, escritura y borrado)';
END $$;
RESET ROLE;

-- 6) Defensa en profundidad: si alguien concede SELECT por error, RLS sin políticas sigue devolviendo 0 filas.
GRANT SELECT ON public.gsc_daily_metrics TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.gsc_daily_metrics) = 0, 'RLS did not hide rows from authenticated';
  RAISE NOTICE 'OK 6: RLS oculta todas las filas aunque exista SELECT concedido';
END $$;
RESET ROLE;
REVOKE SELECT ON public.gsc_daily_metrics FROM authenticated;

-- 7) service_role sí lee (BYPASSRLS).
SET LOCAL ROLE service_role;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.gsc_daily_metrics) = 3, 'service_role cannot read';
  RAISE NOTICE 'OK 7: service_role lee con RLS activo';
END $$;
RESET ROLE;

ROLLBACK;
\echo 'GSC-02a: todas las pruebas de RLS e idempotencia pasaron (transacción revertida).'
