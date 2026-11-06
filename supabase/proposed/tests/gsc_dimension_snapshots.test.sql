-- Pruebas de GSC-06B en PostgreSQL DESECHABLE (nunca Supabase). Datos ficticios.
-- No ejecutar a mano: lo invoca supabase/proposed/tests/run.sh tras aplicar la propuesta.
-- Cada ASSERT falla la sesión si no se cumple; psql usa ON_ERROR_STOP.
--
-- Escritura: service_role SOLO puede llamar a public.gsc_publish_dimension_snapshot (inserta y aplica
-- retención en una transacción). Las restricciones de tabla se prueban como administrador, porque
-- son propiedades de la tabla y no de quien escribe.
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

-- Helper temporal: publica una captura final con límite 25.000 y truncado = (filas >= 5.000).
CREATE OR REPLACE FUNCTION pg_temp.pub(
  p_domain text, p_dim text, p_period integer, p_req timestamptz,
  p_ws date, p_we date, p_agg text, p_rows integer, p_payload jsonb) RETURNS bigint
LANGUAGE sql AS $$
  SELECT public.gsc_publish_dimension_snapshot(
    p_domain, p_dim, p_period::smallint, p_req, p_ws, p_we, 'final', p_agg, NULL,
    25000, p_rows, (p_rows >= 5000), p_payload);
$$;

-- ---------------------------------------------------------------- 1. Privilegios (como admin)
DO $$
DECLARE
  rel  regclass := 'public.gsc_dimension_snapshots'::regclass;
  priv text;
  fn   text := 'public.gsc_publish_dimension_snapshot(text, text, smallint, timestamptz, date, date, text, text, text, integer, integer, boolean, jsonb)';
BEGIN
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    ASSERT NOT has_table_privilege('anon', rel, priv), format('anon tiene %s', priv);
    ASSERT NOT has_table_privilege('authenticated', rel, priv), format('authenticated tiene %s', priv);
  END LOOP;
  ASSERT has_table_privilege('service_role', rel, 'SELECT'), 'service_role sin SELECT (necesario para la vista)';
  ASSERT NOT has_table_privilege('service_role', rel, 'INSERT'), 'service_role tiene INSERT directo';
  ASSERT NOT has_table_privilege('service_role', rel, 'DELETE'), 'service_role tiene DELETE directo';
  ASSERT NOT has_table_privilege('service_role', rel, 'UPDATE'), 'service_role tiene UPDATE';
  ASSERT NOT has_table_privilege('service_role', rel, 'TRUNCATE'), 'service_role tiene TRUNCATE';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = rel), 'RLS desactivado';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename = 'gsc_dimension_snapshots') = 0, 'hay políticas RLS';
  ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role no puede ejecutar la función de escritura';
  ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon puede ejecutar la función de escritura';
  ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), 'authenticated puede ejecutar la función de escritura';
  RAISE NOTICE 'OK 1: privilegios y RLS correctos; escritura solo por función';
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

-- ---------------------------------------------------------------- 3. Escritura directa denegada (service_role)
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload)
    VALUES ('astisl.es','query',28,now(),'2026-10-09','2026-11-05','final','byProperty',25000,0,false,'[]');
    RAISE EXCEPTION 'service_role pudo INSERT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.gsc_dimension_snapshots;
    RAISE EXCEPTION 'service_role pudo DELETE directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 3: service_role no puede INSERT ni DELETE directos';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- 4. Restricciones de tabla (como admin)
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
DO $$ BEGIN RAISE NOTICE 'OK 4: 12 restricciones de tabla rechazan datos inválidos'; END $$;

-- La misma validación debe aplicarse cuando se escribe por la función (service_role).
SET ROLE service_role;
SELECT pg_temp.expect_rejected($q$SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 08:00+00','2026-10-10','2026-11-05','byProperty',1,'[{"k":"x"},{"k":"y"}]')$q$, 'función: row_count distinto de payload');
SELECT pg_temp.expect_rejected($q$SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 08:00+00','2026-10-10','2026-11-05','byProperty',1,'{"k":"no es array"}')$q$, 'función: payload no es array');
SELECT pg_temp.expect_rejected($q$SELECT pg_temp.pub('astisl.es','page',28,'2026-11-05 08:00+00','2026-10-09','2026-11-05','byProperty',0,'[]')$q$, 'función: página con byProperty');
DO $$ BEGIN RAISE NOTICE 'OK 4b: la función rechaza datos inválidos con las mismas restricciones'; END $$;

-- ---------------------------------------------------------------- 5. Vigencia y retención en la función
-- Captura de referencia (08:00) y tres más (10:00, 11:00 y 09:00 llegada tarde). Con 4 capturas
-- para la misma combinación, la retención de la MISMA transacción deja 3: 09:00, 10:00, 11:00.
SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 08:00+00','2026-10-09','2026-11-05','byProperty',2,
  '[{"k":"captura solicitada a las 08:00"},{"k":"fila 2"}]');
SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 10:00+00','2026-10-09','2026-11-05','byProperty',1,'[{"k":"captura solicitada a las 10:00"}]');
SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 11:00+00','2026-10-09','2026-11-05','byProperty',1,'[{"k":"captura solicitada a las 11:00"}]');
SELECT pg_temp.pub('astisl.es','query',28,'2026-11-05 09:00+00','2026-10-09','2026-11-05','byProperty',1,'[{"k":"captura solicitada a las 09:00 (tardía)"}]');

DO $$
DECLARE winner text; n integer;
BEGIN
  SELECT payload->0->>'k' INTO winner FROM public.gsc_dimension_snapshots_current
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 28;
  ASSERT winner = 'captura solicitada a las 11:00', format('vigente incorrecta: %s', winner);
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 28;
  ASSERT n = 3, format('retención en la misma transacción dejó %s, debía dejar 3', n);
  ASSERT NOT EXISTS (SELECT 1 FROM public.gsc_dimension_snapshots
                      WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 28
                        AND payload->0->>'k' = 'captura solicitada a las 08:00'),
         'la captura más antigua sobrevivió a la retención';
  RAISE NOTICE 'OK 5a: gana la captura solicitada más tarde (no la guardada más tarde); retención a 3 sin estado de 4';
END $$;

-- Desempate determinista: mismo requested_at, gana el id mayor.
SELECT pg_temp.pub('3av.events','page',7,'2026-11-05 12:00+00','2026-10-30','2026-11-05','auto',1,'[{"k":"primera en empate"}]');
SELECT pg_temp.pub('3av.events','page',7,'2026-11-05 12:00+00','2026-10-30','2026-11-05','auto',1,'[{"k":"segunda en empate"}]');
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
  RAISE NOTICE 'OK 5b: empate en requested_at resuelto por id (determinista, comprobado en vista)';
END $$;

-- Retención de otra combinación: cinco capturas de ASTI consulta 7 días => quedan 3 y la vigente es la última.
SELECT pg_temp.pub('astisl.es','query',7,timestamptz '2026-11-01 00:00+00' + make_interval(hours => g),
                   '2026-10-30','2026-11-05','byProperty',1,
                   jsonb_build_array(jsonb_build_object('k', 'retención ' || g)))
  FROM generate_series(1, 5) g;

DO $$
DECLARE n integer; winner text;
BEGIN
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 7;
  ASSERT n = 3, format('retención dejó %s, debía dejar 3', n);
  SELECT payload->0->>'k' INTO winner FROM public.gsc_dimension_snapshots_current
   WHERE property_domain = 'astisl.es' AND dimension = 'query' AND period_days = 7;
  ASSERT winner = 'retención 5', format('vigente tras retención incorrecta: %s', winner);
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots
   WHERE property_domain = '3av.events' AND dimension = 'page' AND period_days = 7;
  ASSERT n = 2, 'la retención tocó otra combinación';
  SELECT count(*) INTO n FROM public.gsc_dimension_snapshots_current;
  ASSERT n = 3, format('la vista debe tener una fila por combinación con datos (3), tiene %s', n);
  RAISE NOTICE 'OK 5c: retención por combinación, una vigente por combinación, sin tocar otras';
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
