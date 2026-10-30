-- SEO Tracker / TAREA 003B2 - propuesta de endurecimiento de public.keyword_tracking
-- IMPORTANTE: revisar PR y obtener autorizacion independiente antes de aplicar
-- No borra ni modifica filas. Mantiene temporalmente SELECT publico para el dashboard.
-- NO protege la confidencialidad de los resultados: anon sigue pudiendo leerlos.

BEGIN;

-- Evitar esperas indefinidas si la tabla esta bloqueada durante la aplicacion.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Si el esquema o permisos especificos por columna cambiaron desde la auditoria,
-- abortar por completo para exigir una nueva revision.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'keyword_tracking'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'Preflight failed: keyword_tracking missing or RLS already changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'keyword_tracking'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: existing policies require a new review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.keyword_tracking'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Preflight failed: unexpected column-level privileges';
  END IF;
END;
$preflight$;

-- Las tres instrucciones siguientes y la politica se confirman juntas.
-- El rol service_role conserva sus privilegios previos.
ALTER TABLE public.keyword_tracking ENABLE ROW LEVEL SECURITY;

-- Incluye INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER.
-- Revocar tambien a PUBLIC evita herencias accidentales.
REVOKE ALL PRIVILEGES ON TABLE public.keyword_tracking
  FROM PUBLIC, anon, authenticated;

-- Acceso de lectura publico TEMPORAL: requerido por app/dashboard/page.jsx,
-- que consulta la tabla desde el navegador usando la clave publica de Supabase.
GRANT SELECT ON TABLE public.keyword_tracking TO anon, authenticated;

CREATE POLICY keyword_tracking_lectura_temporal
  ON public.keyword_tracking
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Postcondiciones dentro de la misma transaccion.
-- Si alguna falla, PostgreSQL revierte TODOS los cambios.
DO $postflight$
DECLARE
  client_role text;
BEGIN
  IF NOT (
    SELECT c.relrowsecurity FROM pg_class c
    WHERE c.oid = 'public.keyword_tracking'::regclass
  ) THEN
    RAISE EXCEPTION 'Postflight failed: RLS not enabled';
  END IF;

  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF NOT has_table_privilege(client_role, 'public.keyword_tracking', 'SELECT')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'INSERT')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'UPDATE')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'DELETE')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'TRUNCATE')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'REFERENCES')
       OR has_table_privilege(client_role, 'public.keyword_tracking', 'TRIGGER')
    THEN
      RAISE EXCEPTION 'Postflight failed: unexpected grants for %', client_role;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.keyword_tracking', 'INSERT') THEN
    RAISE EXCEPTION 'Postflight failed: service_role lost INSERT';
  END IF;
END;
$postflight$;

COMMIT;
