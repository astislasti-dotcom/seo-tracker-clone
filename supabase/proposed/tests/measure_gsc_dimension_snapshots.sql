-- GSC-06B · Medidas en PostgreSQL DESECHABLE con datos FICTICIOS. Nunca Supabase.
-- Lo invoca run.sh sobre una base con la propuesta ya aplicada.
-- Escenario de peor caso: 5.000 filas (límite), URLs largas, 3 capturas retenidas por combinación.
\set ON_ERROR_STOP on
\timing on
\echo '== Medidas GSC-06B (datos ficticios)'
SET ROLE service_role;

-- Filas sintéticas: URLs de ~200 caracteres con parámetros, consultas de ~60 caracteres.
CREATE TEMP TABLE syn AS
SELECT g AS n,
       'https://astisl.es/blog/categoria-' || (g % 97) || '/articulo-de-prueba-con-slug-largo-' || g
         || '-' || repeat('abcdefghij', 12) || '?utm_source=demo&utm_medium=organic&ref=seo-sintetico' AS url,
       'consulta sintetica numero ' || g || ' con texto de longitud media para la medicion' AS query,
       ((g * 131) % 20000) + 10                                AS impr,
       ((g * 7) % 500)                                          AS clicks,
       round(1 + (g % 400) / 10.0, 1)                           AS pos
  FROM generate_series(1, 5000) g;

\echo '-- 1) Inserción de una captura completa de 5.000 filas (página, 28 días): una sola sentencia'
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
SELECT 'astisl.es', 'page', 28, timestamptz '2026-11-05 08:00+00', date '2026-10-09', date '2026-11-05',
       'final', 'auto', 25000, 5000, true,
       jsonb_agg(jsonb_build_object('k', url, 'c', clicks, 'i', impr,
                                    'ctr', round(clicks::numeric / impr, 4), 'p', pos))
  FROM syn;

\echo '-- 2) Inserción de una captura de consultas de 5.000 filas (28 días)'
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
SELECT 'astisl.es', 'query', 28, timestamptz '2026-11-05 08:00+00', date '2026-10-09', date '2026-11-05',
       'final', 'byProperty', 25000, 5000, true,
       jsonb_agg(jsonb_build_object('k', query, 'c', clicks, 'i', impr,
                                    'ctr', round(clicks::numeric / impr, 4), 'p', pos))
  FROM syn;

\echo '-- 3) Tamaño de cada captura (payload jsonb) y de la tabla'
SELECT dimension,
       row_count,
       pg_size_pretty(pg_column_size(payload)::bigint)              AS payload_comprimido_en_disco,
       pg_size_pretty(octet_length(payload::text)::bigint)           AS payload_texto_json,
       round(octet_length(payload::text)::numeric / row_count, 1)    AS bytes_json_por_fila
  FROM public.gsc_dimension_snapshots
;
SELECT pg_size_pretty(pg_total_relation_size('public.gsc_dimension_snapshots')) AS tabla_con_indices,
       pg_size_pretty(pg_relation_size('public.gsc_dimension_snapshots'))         AS tabla_sin_indices;

\echo '-- 4) Lectura de la vigente (plan real con búferes)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT * FROM public.gsc_dimension_snapshots_current
 WHERE property_domain = 'astisl.es' AND dimension = 'page' AND period_days = 28;

\echo '-- 4b) Lectura que MATERIALIZA el jsonb (no solo el índice): bytes de texto y tiempo de extraer 5.000 filas'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT sum(octet_length(payload::text)) FROM public.gsc_dimension_snapshots_current
 WHERE property_domain = 'astisl.es' AND dimension = 'page' AND period_days = 28;
\timing on
\copy (SELECT payload FROM public.gsc_dimension_snapshots_current WHERE property_domain = 'astisl.es' AND dimension = 'page' AND period_days = 28) TO '/dev/null'
\echo '   (tiempo de la línea anterior = extracción + serialización del jsonb a texto; sin HTTP)'

\echo '-- 5) Tres capturas más para la misma combinación, después limpieza a 3 (coste del DELETE)'
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
SELECT 'astisl.es', 'page', 28, timestamptz '2026-11-05 08:00+00' + make_interval(hours => g),
       date '2026-10-09', date '2026-11-05', 'final', 'auto', 25000, 5000, true,
       (SELECT jsonb_agg(jsonb_build_object('k', url, 'c', clicks, 'i', impr,
                                            'ctr', round(clicks::numeric / impr, 4), 'p', pos))
          FROM syn)
  FROM generate_series(1, 3) g;

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
DELETE FROM public.gsc_dimension_snapshots d
 WHERE d.property_domain = 'astisl.es' AND d.dimension = 'page' AND d.period_days = 28
   AND d.id NOT IN (
     SELECT id FROM public.gsc_dimension_snapshots
      WHERE property_domain = 'astisl.es' AND dimension = 'page' AND period_days = 28
      ORDER BY requested_at DESC, id DESC
      LIMIT 3);

\echo '-- 6) Comprobación: quedan 3 capturas de la combinación y la vigente es la de mayor requested_at'
SELECT count(*) AS capturas_retenidas
  FROM public.gsc_dimension_snapshots
 WHERE property_domain = 'astisl.es' AND dimension = 'page' AND period_days = 28;

\echo '-- 7) Escenario de URLs POCO repetitivas (md5), 90 días, para no mezclarlo con el escenario comprimible'
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
SELECT 'astisl.es', 'page', 90, timestamptz '2026-11-05 08:00+00', date '2026-08-08', date '2026-11-05',
       'final', 'auto', 25000, 5000, true,
       jsonb_agg(jsonb_build_object(
         'k', 'https://astisl.es/servicios/' || md5(g::text) || '/' || md5((g*7+3)::text)
              || '-' || md5((g*13+5)::text) || '?utm_source=gsc&utm_medium=organic&variant=' || md5((g*11)::text),
         'c', (g * 7) % 500, 'i', (g * 131) % 20000 + 10,
         'ctr', round(((g * 7) % 500)::numeric / ((g * 131) % 20000 + 10), 4),
         'p', round(1 + (g % 400) / 10.0, 1)))
  FROM generate_series(1, 5000) g;

\echo '-- 8) Tamaño comparado de las capturas de 5.000 filas (escenario comprimible vs poco repetitivo)'
SELECT period_days, dimension,
       pg_size_pretty(pg_column_size(payload)::bigint)       AS payload_en_disco,
       pg_size_pretty(octet_length(payload::text)::bigint)   AS texto_json,
       round(pg_column_size(payload)::numeric / octet_length(payload::text), 3) AS ratio_compresion
  FROM public.gsc_dimension_snapshots
 WHERE row_count = 5000
 ORDER BY period_days, dimension;

