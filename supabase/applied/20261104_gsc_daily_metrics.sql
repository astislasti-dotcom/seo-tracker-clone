-- GSC-02a · Esquema de métricas diarias de Search Console (sin tablas de totales)
--
-- ESTADO: APLICADA en el proyecto Supabase de SEO Tracker el 2026-11-04 (verificada por ChatGPT:
-- RLS activo, sin políticas, anon/authenticated sin permisos, service_role con SELECT/INSERT/UPDATE).
-- NO REEJECUTAR. Se conserva como registro del esquema y como prueba de regresión:
--   supabase/applied/tests/run.sh   (PostgreSQL desechable, nunca Supabase)
-- Fuera de supabase/migrations/ a propósito: ninguna herramienta debe volver a aplicarlo.
-- Ejecutar siempre dentro de UNA transacción (psql -1 o el editor SQL de Supabase): el archivo
-- no incluye BEGIN/COMMIT para poder probarse dentro de una transacción de prueba con ROLLBACK.
--
-- Decisiones (issue #20):
--   * Una fila por propiedad y día. Los totales de periodo se calculan desde estas filas.
--   * Sin tabla de totales. Sin brand: se deriva de property_domain en la aplicación.
--   * Escritura solo desde servidor con service_role (BYPASSRLS). anon, authenticated y PUBLIC
--     no tienen ningún privilegio ni políticas.
--   * Idempotente: CREATE ... IF NOT EXISTS y clave primaria (property_domain, metric_date).
--     La aplicación escribe con INSERT ... ON CONFLICT DO UPDATE.
--   * IF NOT EXISTS no basta: si una tabla ya existe con otra forma, la preflight lo detecta y aborta.
--   * No borra datos. Sin DROP, sin TRUNCATE.

-- Preflight 1: service_role debe existir y saltarse RLS (en Supabase está confirmado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Preflight failed: service_role must exist and bypass RLS';
  END IF;
END $$;

-- Preflight 2: si las tablas ya existen, deben tener exactamente la estructura esperada.
-- Compara columnas (nombre, tipo, precisión, escala, nulabilidad) y la clave primaria.
DO $$
DECLARE
  mismatches integer;
  pk_cols    text[];
BEGIN
  IF to_regclass('public.gsc_daily_metrics') IS NOT NULL THEN
    SELECT count(*) INTO mismatches
    FROM (VALUES
        ('property_domain', 'text',                      'NO',  NULL::int, NULL::int),
        ('metric_date',     'date',                      'NO',  NULL::int, NULL::int),
        ('clicks',          'integer',                   'NO',  32,        0),
        ('impressions',     'integer',                   'NO',  32,        0),
        ('ctr',             'numeric',                   'YES', 9,         8),
        ('avg_position',    'numeric',                   'YES', 8,         3),
        ('data_state',      'text',                      'NO',  NULL::int, NULL::int),
        ('fetched_at',      'timestamp with time zone',  'NO',  NULL::int, NULL::int)
      ) AS e(column_name, data_type, is_nullable, num_precision, num_scale)
    FULL OUTER JOIN (
      SELECT column_name::text AS column_name, data_type::text AS data_type, is_nullable::text AS is_nullable,
             numeric_precision::int AS num_precision, numeric_scale::int AS num_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gsc_daily_metrics'
    ) a USING (column_name)
    WHERE e.column_name IS NULL OR a.column_name IS NULL
       OR e.data_type IS DISTINCT FROM a.data_type
       OR e.is_nullable IS DISTINCT FROM a.is_nullable
       OR e.num_precision IS DISTINCT FROM a.num_precision
       OR e.num_scale IS DISTINCT FROM a.num_scale;
    IF mismatches > 0 THEN
      RAISE EXCEPTION 'Preflight failed: public.gsc_daily_metrics exists with an incompatible structure (% column differences)', mismatches;
    END IF;
    SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_cols
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = 'public.gsc_daily_metrics'::regclass AND i.indisprimary;
    IF pk_cols IS DISTINCT FROM ARRAY['property_domain', 'metric_date']::text[] THEN
      RAISE EXCEPTION 'Preflight failed: public.gsc_daily_metrics has an incompatible primary key';
    END IF;
  END IF;

  IF to_regclass('public.gsc_sync_runs') IS NOT NULL THEN
    SELECT count(*) INTO mismatches
    FROM (VALUES
        ('id',              'uuid',                      'NO',  NULL::int, NULL::int),
        ('property_domain', 'text',                      'NO',  NULL::int, NULL::int),
        ('start_date',      'date',                      'NO',  NULL::int, NULL::int),
        ('end_date',        'date',                      'NO',  NULL::int, NULL::int),
        ('started_at',      'timestamp with time zone',  'NO',  NULL::int, NULL::int),
        ('finished_at',     'timestamp with time zone',  'YES', NULL::int, NULL::int),
        ('rows_received',   'integer',                   'NO',  32,        0),
        ('status',          'text',                      'NO',  NULL::int, NULL::int),
        ('error_code',      'text',                      'YES', NULL::int, NULL::int)
      ) AS e(column_name, data_type, is_nullable, num_precision, num_scale)
    FULL OUTER JOIN (
      SELECT column_name::text AS column_name, data_type::text AS data_type, is_nullable::text AS is_nullable,
             numeric_precision::int AS num_precision, numeric_scale::int AS num_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gsc_sync_runs'
    ) a USING (column_name)
    WHERE e.column_name IS NULL OR a.column_name IS NULL
       OR e.data_type IS DISTINCT FROM a.data_type
       OR e.is_nullable IS DISTINCT FROM a.is_nullable
       OR e.num_precision IS DISTINCT FROM a.num_precision
       OR e.num_scale IS DISTINCT FROM a.num_scale;
    IF mismatches > 0 THEN
      RAISE EXCEPTION 'Preflight failed: public.gsc_sync_runs exists with an incompatible structure (% column differences)', mismatches;
    END IF;
    SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_cols
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = 'public.gsc_sync_runs'::regclass AND i.indisprimary;
    IF pk_cols IS DISTINCT FROM ARRAY['id']::text[] THEN
      RAISE EXCEPTION 'Preflight failed: public.gsc_sync_runs has an incompatible primary key';
    END IF;
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

-- Retirar TODOS los privilegios por defecto (Supabase concede ALL a los roles en tablas nuevas)
-- y volver a concederlos solo a service_role, con el mínimo necesario.
REVOKE ALL ON public.gsc_daily_metrics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.gsc_sync_runs     FROM PUBLIC, anon, authenticated, service_role;

-- Solo el servidor escribe y lee. Sin DELETE: la retención se decidirá aparte.
GRANT SELECT, INSERT, UPDATE ON public.gsc_daily_metrics TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.gsc_sync_runs     TO service_role;

-- Postflight: lo que debe ser cierto tras aplicar.
DO $$
DECLARE
  policies    integer;
  bad_grants  integer;
  rel         regclass;
  priv        text;
  allowed_sr  text[] := ARRAY['SELECT', 'INSERT', 'UPDATE'];
BEGIN
  -- RLS activo en ambas tablas.
  FOREACH rel IN ARRAY ARRAY['public.gsc_daily_metrics'::regclass, 'public.gsc_sync_runs'::regclass] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE EXCEPTION 'Postflight failed: RLS not enabled on %', rel;
    END IF;
  END LOOP;

  -- Sin políticas.
  SELECT count(*) INTO policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('gsc_daily_metrics', 'gsc_sync_runs');
  IF policies <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: unexpected policies (%)', policies;
  END IF;

  -- anon, authenticated y PUBLIC: ningún privilegio, de ningún tipo, en ninguna de las dos tablas.
  FOREACH rel IN ARRAY ARRAY['public.gsc_daily_metrics'::regclass, 'public.gsc_sync_runs'::regclass] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', rel, priv) OR has_table_privilege('authenticated', rel, priv) THEN
        RAISE EXCEPTION 'Postflight failed: anon or authenticated has % on %', priv, rel;
      END IF;
    END LOOP;
    -- Revisión directa de la ACL: ninguna entrada para PUBLIC (grantee 0), anon ni authenticated.
    SELECT count(*) INTO bad_grants
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    WHERE c.oid = rel
      AND (acl.grantee = 0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')));
    IF bad_grants <> 0 THEN
      RAISE EXCEPTION 'Postflight failed: % ACL entries for PUBLIC, anon or authenticated on %', bad_grants, rel;
    END IF;
  END LOOP;

  -- service_role: solo SELECT, INSERT y UPDATE. Nada más (ni DELETE, TRUNCATE, REFERENCES, TRIGGER).
  FOREACH rel IN ARRAY ARRAY['public.gsc_daily_metrics'::regclass, 'public.gsc_sync_runs'::regclass] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('service_role', rel, priv) <> (priv = ANY (allowed_sr)) THEN
        RAISE EXCEPTION 'Postflight failed: service_role privilege % on % is not the expected one', priv, rel;
      END IF;
    END LOOP;
  END LOOP;
END $$;
