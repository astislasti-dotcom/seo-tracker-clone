-- Pruebas de GSC-06B en PostgreSQL DESECHABLE (nunca Supabase). Datos ficticios.
-- No ejecutar a mano: lo invoca supabase/proposed/tests/run.sh tras aplicar la propuesta.
-- Cada ASSERT falla la sesión si no se cumple; psql usa ON_ERROR_STOP.
\set ON_ERROR_STOP on

-- Helper temporal: el SQL dado debe fallar con una violación de restricción o de NOT NULL.
CREATE OR REPLACE FUNCTION pg_temp.expect_rejected(stmt text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'ACEPTADO indebidamente: %', label;
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RETURN;
END $$;

-- ---------------------------------------------------------------- 1. Privilegios (como admin)
DO $$
DECLARE
  rel regclass := 'public.gsc_dimension_snapshots'::regclass;
  priv text;
BEGIN
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    ASSERT NOT has_table_privilege('anon', rel, priv), format('anon tiene %s', priv);
    ASSERT NOT has_table_privilege('authenticated', rel, priv), format('authenticated tiene %s', priv);
  END LOOP;
  ASSERT has_table_privilege('service_role', rel, 'SELECT'), 'service_role sin SELECT';
  ASSERT has_table_privilege('service_role', rel, 'INSERT'), 'service_role sin INSERT';
  ASSERT has_table_privilege('service_role', rel, 'DELETE'), 'service_role sin DELETE';
  ASSERT NOT has_table_privilege('service_role', rel, 'UPDATE'), 'service_role tiene UPDATE (las capturas son inmutables)';
  ASSERT NOT has_table_privilege('service_role', rel, 'TRUNCATE'), 'service_role tiene TRUNCATE';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = rel), 'RLS desactivado';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename = 'gsc_dimension_snapshots') = 0, 'hay políticas RLS';
  RAISE NOTICE 'OK 1: privilegios y RLS correctos';
END $$;

-- Vista: solo service_role puede leerla.
DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'public.gsc_dimension_snapshots_current', 'SELECT'), 'anon lee la vista';
  ASSERT NOT has_table_privilege('authenticated', 'public.gsc_dimension_snapshots_current', 'SELECT'), 'authenticated lee la vista';
  ASSERT has_table_privilege('service_role', 'public.gsc_dimension_snapshots_current', 'SELECT'), 'service_role no lee la vista';
  RAISE NOTICE 'OK 1b: vista de lectura restringida a service_role';
END $$;

-- ---------------------------------------------------------------- 2. Acceso real por rol
-- anon no puede insertar ni leer, aunque la tabla exista.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.gsc_dimension_snapshots LIMIT 1;
    RAISE EXCEPTION 'anon pudo leer snapshots';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'OK 2: anon no lee snapshots (permiso denegado)'; END $$;

-- ---------------------------------------------------------------- 3. Escritura y restricciones (service_role)
SET ROLE service_role;

-- Captura válida de referencia (periodo 28: 2026-10-09 .. 2026-11-05 son 28 días).
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, response_aggregation_type, row_limit, row_count, truncated, payload)
VALUES ('astisl.es', 'query', 28, '2026-11-05 08:00:00+00', '2026-10-09', '2026-11-05', 'final',
        'byProperty', 'byProperty', 25000, 2, false,
        '[{"k":"consulta demo 1","c":3,"i":40,"ctr":0.075,"p":8.1},{"k":"consulta demo 2","c":0,"i":12,"ctr":0,"p":14.0}]');
DO $$ BEGIN RAISE NOTICE 'OK 3a: captura válida aceptada'; END $$;

-- Restricciones: cada caso debe ser rechazado.
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('www.astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'host no permitido');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','device',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'dimensión device');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',14,now(),'2026-10-22','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'periodo 14');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','provisional','byProperty',25000,0,false,'[]')$q$, 'datos provisionales');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','page',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'página con byProperty');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-10','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'ventana de 27 días con periodo 28');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,5001,true,'[]')$q$, 'más de 5.000 filas');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,1,false,'{"k":"no es array"}')$q$, 'payload no es array');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,2,false,'[{"k":"solo una"}]')$q$, 'row_count distinto de payload');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,5000,false,(SELECT jsonb_agg('{"k":"x"}'::jsonb) FROM generate_series(1,5000)))$q$, 'truncated=false con 5.000 filas');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,completed_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,'2026-11-05 09:00+00','2026-11-05 08:00+00','2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'completed_at anterior a requested_at');
SELECT pg_temp.expect_rejected($q$INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','query',28,NULL,'2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]')$q$, 'requested_at nulo');
DO $$ BEGIN RAISE NOTICE 'OK 3b: 12 restricciones rechazan datos inválidos'; END $$;

-- ---------------------------------------------------------------- 4. Regla de vigencia (una sesión)
-- Dos capturas para la misma combinación (ASTI, query, 28). La solicitada después gana,
-- aunque se haya guardado antes. Una captura antigua que termina tarde no desplaza a la nueva.
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
VALUES ('astisl.es', 'query', 28, '2026-11-05 10:00+00', '2026-10-09', '2026-11-05', 'final',
        'byProperty', 25000, 1, false, '[{"k":"captura solicitada a las 10:00"}]');
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
VALUES ('astisl.es', 'query', 28, '2026-11-05 11:00+00', '2026-10-09', '2026-11-05', 'final',
        'byProperty', 25000, 1, false, '[{"k":"captura solicitada a las 11:00"}]');
-- Llega una captura solicitada a las 09:00 (más antigua), guardada al final.
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
VALUES ('astisl.es', 'query', 28, '2026-11-05 09:00+00', '2026-10-09', '2026-11-05', 'final',
        'byProperty', 25000, 1, false, '[{"k":"captura solicitada a las 09:00 (tardía)"}]');

DO $$
DECLARE winner text;
BEGIN
  SELECT payload->0->>'k' INTO winner FROM public.gsc_dimension_snapshots_current
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 28;
  ASSERT winner = 'captura solicitada a las 11:00', format('vigente incorrecta: %s', winner);
  RAISE NOTICE 'OK 4a: gana la captura solicitada más tarde, no la guardada más tarde';
END $$;

-- Desempate determinista: mismo requested_at, gana el id mayor.
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
VALUES ('3av.events', 'page', 7, '2026-11-05 12:00+00', '2026-10-30', '2026-11-05', 'final',
        'auto', 25000, 1, false, '[{"k":"primera en empate"}]'),
       ('3av.events', 'page', 7, '2026-11-05 12:00+00', '2026-10-30', '2026-11-05', 'final',
        'auto', 25000, 1, false, '[{"k":"segunda en empate"}]');
DO $$
DECLARE winner text;
BEGIN
  SELECT payload->0->>'k' INTO winner FROM public.gsc_dimension_snapshots_current
   WHERE property_domain = '3av.events' AND dimension = 'page' AND period_days = 7;
  ASSERT winner = 'segunda en empate', format('empate mal resuelto: %s', winner);
  -- Guarda estructural: con dos filas empatadas, el orden por heap puede acertar por casualidad,
  -- así que el desempate por id se exige también en la definición de la vista.
  ASSERT position('requested_at DESC, id DESC' IN pg_get_viewdef('public.gsc_dimension_snapshots_current'::regclass, true)) > 0,
         'vista sin desempate por id (ORDER BY debe incluir requested_at DESC, id DESC)';
  RAISE NOTICE 'OK 4b: empate en requested_at resuelto por id (determinista, comprobado en vista)';
END $$;

-- Combinaciones separadas: una página 7 días de 3AV no altera ASTI consulta 28 días.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots_current;
  ASSERT n = 2, format('la vista debe tener una fila por combinación con datos (2 en este punto), tiene %s', n);
  RAISE NOTICE 'OK 4c: una fila vigente por combinación';
END $$;

-- ---------------------------------------------------------------- 5. Retención: 3 por combinación
-- Cinco capturas para ASTI query 7 días. Se conservan las 3 solicitadas más recientes.
INSERT INTO public.gsc_dimension_snapshots
  (property_domain, dimension, period_days, requested_at, window_start, window_end, data_state,
   aggregation_type, row_limit, row_count, truncated, payload)
SELECT 'astisl.es', 'query', 7, timestamptz '2026-11-01 00:00+00' + make_interval(hours => g),
       '2026-10-30', '2026-11-05', 'final', 'byProperty', 25000, 1, false,
       jsonb_build_array(jsonb_build_object('k', 'retención ' || g))
  FROM generate_series(1, 5) g;

DELETE FROM public.gsc_dimension_snapshots d
 WHERE d.property_domain = 'astisl.es' AND d.dimension = 'query' AND d.period_days = 7
   AND d.id NOT IN (
     SELECT id FROM public.gsc_dimension_snapshots
      WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 7
      ORDER BY requested_at DESC, id DESC
      LIMIT 3);

DO $$
DECLARE n integer; winner text;
BEGIN
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 7;
  ASSERT n = 3, format('retención dejó %s, debía dejar 3', n);
  SELECT payload->0->>'k' INTO winner FROM public.gsc_dimension_snapshots_current
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 7;
  ASSERT winner = 'retención 5', format('vigente tras limpieza incorrecta: %s', winner);
  -- La única captura de su combinación nunca se elimina por la limpieza.
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots
   WHERE property_domain = '3av.events' AND dimension = 'page' AND period_days = 7;
  ASSERT n = 2, 'la limpieza tocó otra combinación';
  RAISE NOTICE 'OK 5: retención de 3 y vigente intacta';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------- 6. Inmutabilidad
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    UPDATE public.gsc_dimension_snapshots SET row_count = row_count WHERE true;
    RAISE EXCEPTION 'UPDATE permitido indebidamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 6: service_role no puede modificar capturas';
END $$;
RESET ROLE;

\echo 'TODAS LAS PRUEBAS DE SQL PASARON'
