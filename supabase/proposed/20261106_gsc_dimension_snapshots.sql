-- GSC-06B · Snapshots de consultas y páginas de Search Console (PROPUESTA, NO APLICADA)
--
-- ESTADO: propuesta para revisión. NO aplicar en Supabase sin autorización expresa y específica.
-- Ubicación fuera de supabase/migrations/ a propósito: ninguna herramienta debe aplicarla sola.
-- Prueba: supabase/proposed/tests/run.sh (PostgreSQL desechable, nunca Supabase).
--
-- Decisiones (issue #34, aprobadas por el propietario el 06/11/2026):
--   * Una fila = un snapshot COMPLETO: todas las filas de una captura en un único jsonb.
--     Se inserta en una sola sentencia; un lector nunca ve una captura a medias.
--   * Vigencia: el lector toma, para cada propiedad × dimensión × periodo, la captura con mayor
--     requested_at (fijado por el servidor ANTES de llamar a Google) y, en empate, mayor id.
--     completed_at es solo auditoría. Ver supabase/proposed/tests/run.sh (caso de concurrencia).
--   * Límite: 5.000 filas por captura. Si se alcanza, truncated = true.
--   * Retención: 3 snapshots por combinación, limpieza manual y selectiva (DELETE).
--   * Inmutable: sin UPDATE. Escritura y limpieza solo desde servidor con service_role.
--   * anon, authenticated y PUBLIC sin ningún privilegio. RLS activo y sin políticas.
--   * La vista de lectura usa security_invoker: aplica los privilegios del invocador.
--
-- Ejecutar dentro de UNA transacción (psql -1). No incluye BEGIN/COMMIT.

-- Preflight 1: service_role debe existir y saltarse RLS (patrón de GSC-02a).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Preflight failed: service_role must exist and bypass RLS';
  END IF;
END $$;

-- Preflight 2: si la tabla ya existe, debe coincidir con la definición propuesta. IF NOT EXISTS no
-- compara nada, así que se verifica explícitamente: columnas (nombre, tipo, nulabilidad), identidad,
-- clave primaria sobre id, número de CHECK y las cinco restricciones con nombre. Si no coincide,
-- se aborta sin tocar la tabla existente.
DO $$
DECLARE
  n       integer;
  bad     integer;
  tbl     constant text := 'gsc_dimension_snapshots';
  id_attn smallint;
BEGIN
  IF to_regclass('public.gsc_dimension_snapshots') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl;
  IF n <> 15 THEN
    RAISE EXCEPTION 'Preflight failed: incompatible structure: public.% has % columns (expected 15)', tbl, n;
  END IF;

  WITH expected(column_name, data_type, is_nullable) AS (VALUES
    ('id',                        'bigint',      'NO'),
    ('property_domain',           'text',        'NO'),
    ('dimension',                 'text',        'NO'),
    ('period_days',               'smallint',    'NO'),
    ('requested_at',              'timestamp with time zone', 'NO'),
    ('completed_at',              'timestamp with time zone', 'NO'),
    ('window_start',              'date',        'NO'),
    ('window_end',                'date',        'NO'),
    ('data_state',                'text',        'NO'),
    ('aggregation_type',          'text',        'NO'),
    ('response_aggregation_type', 'text',        'YES'),
    ('row_limit',                 'integer',     'NO'),
    ('row_count',                 'integer',     'NO'),
    ('truncated',                 'boolean',     'NO'),
    ('payload',                   'jsonb',       'NO'))
  SELECT count(*) INTO bad
    FROM expected e
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = tbl AND c.column_name = e.column_name
   WHERE c.column_name IS NULL
      OR c.data_type <> e.data_type
      OR c.is_nullable <> e.is_nullable;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'Preflight failed: incompatible structure: % column(s) differ in name, type or nullability', bad;
  END IF;

  SELECT attnum INTO id_attn FROM pg_attribute
   WHERE attrelid = 'public.gsc_dimension_snapshots'::regclass AND attname = 'id';
  IF (SELECT attidentity FROM pg_attribute
       WHERE attrelid = 'public.gsc_dimension_snapshots'::regclass AND attname = 'id') <> 'a' THEN
    RAISE EXCEPTION 'Preflight failed: incompatible structure: id must be GENERATED ALWAYS AS IDENTITY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.gsc_dimension_snapshots'::regclass
                    AND contype = 'p' AND conkey = ARRAY[id_attn]) THEN
    RAISE EXCEPTION 'Preflight failed: incompatible primary key: id must be the primary key';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.gsc_dimension_snapshots'::regclass AND contype = 'c') <> 13 THEN
    RAISE EXCEPTION 'Preflight failed: incompatible checks: expected 13 CHECK constraints';
  END IF;
  SELECT count(*) INTO bad FROM unnest(ARRAY[
      'gsc_dim_snap_window_ck', 'gsc_dim_snap_agg_ck', 'gsc_dim_snap_rows_ck',
      'gsc_dim_snap_trunc_ck', 'gsc_dim_snap_time_ck']) AS req(name)
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'public.gsc_dimension_snapshots'::regclass AND conname = req.name);
  IF bad <> 0 THEN
    RAISE EXCEPTION 'Preflight failed: incompatible checks: % named constraint(s) missing', bad;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gsc_dimension_snapshots (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_domain           text        NOT NULL CHECK (property_domain IN ('astisl.es', '3av.events')),
  dimension                 text        NOT NULL CHECK (dimension IN ('query', 'page')),
  period_days               smallint    NOT NULL CHECK (period_days IN (7, 28, 90)),
  -- Fijado por el servidor una sola vez, antes de la llamada a Google. No lo envía el navegador.
  requested_at              timestamptz NOT NULL,
  -- Solo auditoría. No decide vigencia.
  completed_at              timestamptz NOT NULL DEFAULT now(),
  window_start              date        NOT NULL,
  window_end                date        NOT NULL,
  -- Solo datos finales. Los provisionales no se guardan en esta versión.
  data_state                text        NOT NULL CHECK (data_state = 'final'),
  -- Google exige 'auto' al agrupar o filtrar por página; 'byProperty' no se admite con página.
  aggregation_type          text        NOT NULL CHECK (aggregation_type IN ('auto', 'byProperty')),
  response_aggregation_type text,
  row_limit                 integer     NOT NULL CHECK (row_limit BETWEEN 1 AND 25000),
  row_count                 integer     NOT NULL CHECK (row_count BETWEEN 0 AND 5000),
  truncated                 boolean     NOT NULL,
  payload                   jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'array'),
  CONSTRAINT gsc_dim_snap_window_ck CHECK (window_end >= window_start AND window_end - window_start + 1 = period_days),
  CONSTRAINT gsc_dim_snap_agg_ck    CHECK (dimension = 'query' OR aggregation_type = 'auto'),
  -- CASE garantiza el orden: jsonb_array_length lanza error (no violación) si payload no es array.
  CONSTRAINT gsc_dim_snap_rows_ck   CHECK (CASE WHEN jsonb_typeof(payload) = 'array'
                                                THEN jsonb_array_length(payload) = row_count
                                                ELSE false END),
  CONSTRAINT gsc_dim_snap_trunc_ck  CHECK (truncated = (row_count >= 5000)),
  CONSTRAINT gsc_dim_snap_time_ck   CHECK (completed_at >= requested_at)
);

-- Índice para la regla de vigencia: por combinación, la captura con mayor requested_at, id.
CREATE INDEX IF NOT EXISTS gsc_dim_snap_current_idx
  ON public.gsc_dimension_snapshots (property_domain, dimension, period_days, requested_at DESC, id DESC);

-- Vista de lectura: la captura vigente por combinación. Solo lectura, sin datos nuevos.
CREATE OR REPLACE VIEW public.gsc_dimension_snapshots_current
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_domain, dimension, period_days)
       id, property_domain, dimension, period_days, requested_at, completed_at,
       window_start, window_end, data_state, aggregation_type, response_aggregation_type,
       row_limit, row_count, truncated, payload
  FROM public.gsc_dimension_snapshots
 ORDER BY property_domain, dimension, period_days, requested_at DESC, id DESC;

-- RLS activo, sin políticas: anon y authenticated no ven ni escriben nada.
ALTER TABLE public.gsc_dimension_snapshots ENABLE ROW LEVEL SECURITY;

-- Privilegios explícitos: se retiran los que Supabase concede por defecto y se conceden solo
-- los mínimos a service_role. Sin UPDATE: las capturas son inmutables.
REVOKE ALL ON public.gsc_dimension_snapshots FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.gsc_dimension_snapshots_current FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.gsc_dimension_snapshots_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.gsc_dimension_snapshots TO service_role;
GRANT SELECT ON public.gsc_dimension_snapshots_current TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gsc_dimension_snapshots_id_seq TO service_role;

-- Postflight: verifica lo que la migración debe garantizar, sobre la ACL real.
DO $$
DECLARE
  bad_grants integer;
  rls_on     boolean;
  policies   integer;
BEGIN
  SELECT relrowsecurity INTO rls_on FROM pg_class WHERE oid = 'public.gsc_dimension_snapshots'::regclass;
  IF NOT rls_on THEN
    RAISE EXCEPTION 'Postflight failed: RLS is off on gsc_dimension_snapshots';
  END IF;

  SELECT count(*) INTO policies FROM pg_policies WHERE tablename = 'gsc_dimension_snapshots';
  IF policies <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: unexpected policies on gsc_dimension_snapshots (%)', policies;
  END IF;

  SELECT count(*) INTO bad_grants
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
   WHERE c.oid IN ('public.gsc_dimension_snapshots'::regclass,
                   'public.gsc_dimension_snapshots_current'::regclass,
                   'public.gsc_dimension_snapshots_id_seq'::regclass)
     AND (acl.grantee = 0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')));
  IF bad_grants <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: % ACL entries for PUBLIC, anon or authenticated', bad_grants;
  END IF;

  IF has_table_privilege('service_role', 'public.gsc_dimension_snapshots', 'UPDATE')
     OR has_table_privilege('service_role', 'public.gsc_dimension_snapshots', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Postflight failed: service_role must not have UPDATE or TRUNCATE on snapshots';
  END IF;
  RAISE NOTICE 'Postflight OK: RLS on, sin políticas, sin privilegios para PUBLIC/anon/authenticated, sin UPDATE ni TRUNCATE';
END $$;
