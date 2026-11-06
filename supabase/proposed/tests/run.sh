#!/usr/bin/env bash
# GSC-06B · Pruebas de la propuesta supabase/proposed/20261106_gsc_dimension_snapshots.sql
# en PostgreSQL DESECHABLE con datos ficticios. NUNCA apuntar PGHOST a Supabase.
#
# Uso:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#   RESULTS_DIR=docs/gsc-06b ./supabase/proposed/tests/run.sh
#
# Qué comprueba:
#   POSITIVO  : migración sobre base vacía, segunda aplicación idempotente (misma vista),
#               suite de pruebas (privilegios, RLS, restricciones, vigencia, retención,
#               inmutabilidad), rollback de una captura inválida dentro de la misma transacción,
#               concurrencia real con dos sesiones (A solicitada 10:00 confirmada la última,
#               B solicitada 11:00 confirmada primero).
#   NEGATIVO  : mutaciones de la propuesta que DEBEN romper una prueba concreta.
#   MEDIDAS   : tamaño y tiempos con 5.000 filas y URLs largas (supabase/proposed/tests/measure_*.sql).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../20261106_gsc_dimension_snapshots.sql"
TEST="$HERE/gsc_dimension_snapshots.test.sql"
MEASURE="$HERE/measure_gsc_dimension_snapshots.sql"
RESULTS_DIR="${RESULTS_DIR:-}"

: "${PGHOST:?Define PGHOST apuntando a un PostgreSQL desechable}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER

case "$PGHOST" in
  *supabase*|*.pooler.*) echo "ABORTO: PGHOST parece un servidor de Supabase."; exit 2 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_db()    { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -Atc "$2"; }

# Prólogo: roles y privilegios por defecto que Supabase concede a tablas nuevas (simulación).
cat > "$WORK/prelude.sql" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL

# new_db <nombre>: crea base desechable con prólogo (sin migración).
new_db() {
  psql_admin -c "CREATE DATABASE $1;" >/dev/null || { echo "ERROR creando base $1"; exit 2; }
  psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$WORK/prelude.sql" >/dev/null 2>&1
}
drop_db() { psql_admin -c "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1; }
rnd_db()  { echo "gsc6b_$(date +%s%N | tail -c 9)_$RANDOM"; }

# apply_mig <db> <archivo-migracion> <log>: aplica migración en una transacción.
apply_mig() {
  psql -X -v ON_ERROR_STOP=1 -1 -d "$1" -f "$2" > "$3" 2>&1
}

# run_case <nombre> <ok|fail> <patron|-> <migracion>
run_case() {
  local name="$1" expect="$2" pattern="$3" mig="$4"
  local db; db="$(rnd_db)"
  local log1="$WORK/$db.mig.log" log2="$WORK/$db.test.log"
  new_db "$db"
  apply_mig "$db" "$mig" "$log1"; local c1=$?
  local c2=0
  if [ $c1 -eq 0 ]; then
    psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$TEST" > "$log2" 2>&1; c2=$?
  fi
  drop_db "$db"

  local result=FAIL
  if [ "$expect" = ok ]; then
    [ $c1 -eq 0 ] && [ $c2 -eq 0 ] && grep -q "TODAS LAS PRUEBAS DE SQL PASARON" "$log2" && result=PASS
  else
    # Sin "grep -q" sobre un pipe: con pipefail, grep -q corta y cat recibe SIGPIPE.
    cat "$log1" "$log2" > "$log1.all" 2>/dev/null
    if { [ $c1 -ne 0 ] || [ $c2 -ne 0 ]; } && grep -Eq -- "$pattern" "$log1.all"; then
      result=PASS
    fi
  fi
  if [ "$result" = PASS ]; then
    printf 'PASS  %-60s (esperado: %s)\n' "$name" "$expect"
  else
    printf 'FAIL  %-60s (esperado: %s, migración=%s, pruebas=%s)\n' "$name" "$expect" "$c1" "$c2"
    cat "$log1" "$log2" 2>/dev/null | grep -E "ERROR|ACEPTADO|Postflight|vigente|empate|retención|FALLO|OK [0-9]" | head -n 6 | sed 's/^/        /'
    FAILS=$((FAILS+1))
  fi
}

# mutate <nombre> <expresion-sed>: genera la variante mutada de la propuesta.
mutate() { sed "$2" "$MIG" > "$WORK/$1.sql"; }

# ---------------------------------------------------------------- Positivo principal
echo "== Positivo"
DB_MAIN="$(rnd_db)"
new_db "$DB_MAIN"
LOG_M1="$WORK/main.mig1.log"
apply_mig "$DB_MAIN" "$MIG" "$LOG_M1"; c=$?
if [ $c -ne 0 ]; then echo "FAIL  primera aplicación de la propuesta (código $c)"; sed 's/^/        /' "$LOG_M1" | head -n 8; FAILS=$((FAILS+1)); fi

VIEW_DEF_1="$(psql_db "$DB_MAIN" "SELECT pg_get_viewdef('public.gsc_dimension_snapshots_current'::regclass, true)")"
if [ $c -eq 0 ]; then
  LOG_M2="$WORK/main.mig2.log"
  apply_mig "$DB_MAIN" "$MIG" "$LOG_M2"; c2=$?
  VIEW_DEF_2="$(psql_db "$DB_MAIN" "SELECT pg_get_viewdef('public.gsc_dimension_snapshots_current'::regclass, true)")"
  if [ $c2 -eq 0 ] && [ "$VIEW_DEF_1" = "$VIEW_DEF_2" ]; then
    echo "PASS  segunda aplicación idempotente (misma definición de vista)"
  else
    echo "FAIL  segunda aplicación (código $c2) o definición de vista distinta"; FAILS=$((FAILS+1))
  fi
fi

if [ $c -eq 0 ]; then
  LOG_T="$WORK/main.test.log"
  psql -X -v ON_ERROR_STOP=1 -d "$DB_MAIN" -f "$TEST" > "$LOG_T" 2>&1; ct=$?
  if [ $ct -eq 0 ] && grep -q "TODAS LAS PRUEBAS DE SQL PASARON" "$LOG_T"; then
    echo "PASS  suite SQL: privilegios, RLS, restricciones, vigencia, retención, inmutabilidad"
    grep -E "OK [0-9a-z]+:" "$LOG_T" | sed 's/^/        /'
  else
    echo "FAIL  suite SQL (código $ct)"; grep -E "ERROR|ACEPTADO|vigente|empate|retención|OK" "$LOG_T" | sed 's/^/        /'; FAILS=$((FAILS+1))
  fi

  # Rollback: captura válida + inválida en una sola transacción => no queda nada.
  PROBE="$WORK/probe.sql"
  cat > "$PROBE" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload)
VALUES ('astisl.es','query',28,'2026-11-06 07:00+00','2026-10-10','2026-11-06','final','byProperty',25000,1,false,'[{"k":"probe-valida"}]');
INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload)
VALUES ('astisl.es','query',28,'2026-11-06 07:01+00','2026-10-10','2026-11-06','final','byProperty',25000,2,false,'[{"k":"solo una"}]');
COMMIT;
SQL
  # ON_ERROR_STOP: la segunda sentencia debe fallar y el COMMIT no debe llegar a confirmar nada.
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB_MAIN" -f "$PROBE" >/dev/null 2>&1; cp=$?
  left="$(psql_db "$DB_MAIN" "SELECT count(*) FROM public.gsc_dimension_snapshots WHERE payload::text LIKE '%probe-valida%'")"
  if [ $cp -ne 0 ] && [ "$left" = "0" ]; then
    echo "PASS  rollback: captura válida se revierte si la segunda de la transacción falla"
  else
    echo "FAIL  rollback (código $cp, filas probe=$left)"; FAILS=$((FAILS+1))
  fi
fi

# Concurrencia real: A (solicitada 10:00) confirma DESPUÉS que B (solicitada 11:00).
if [ $c -eq 0 ]; then
  A_SQL="$WORK/conc_a.sql"
  cat > "$A_SQL" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload)
VALUES ('astisl.es','page',28,'2026-11-05 10:00+00','2026-10-09','2026-11-05','final','auto',25000,1,false,'[{"k":"A solicitada 10:00"}]');
SELECT pg_sleep(4);
COMMIT;
SQL
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB_MAIN" -f "$A_SQL" > "$WORK/conc_a.log" 2>&1 &
  PID_A=$!
  sleep 1
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB_MAIN" -c "SET ROLE service_role;" \
    -c "INSERT INTO public.gsc_dimension_snapshots (property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,aggregation_type,row_limit,row_count,truncated,payload) VALUES ('astisl.es','page',28,'2026-11-05 11:00+00','2026-10-09','2026-11-05','final','auto',25000,1,false,'[{\"k\":\"B solicitada 11:00\"}]');" \
    > /dev/null 2>&1; cb=$?
  sleep 1
  mid="$(psql_db "$DB_MAIN" "SELECT payload->0->>'k' FROM public.gsc_dimension_snapshots_current WHERE property_domain='astisl.es' AND dimension='page' AND period_days=28")"
  mid_a="$(psql_db "$DB_MAIN" "SELECT count(*) FROM public.gsc_dimension_snapshots WHERE payload::text LIKE '%A solicitada%'")"
  wait $PID_A; ca=$?
  end="$(psql_db "$DB_MAIN" "SELECT payload->0->>'k' FROM public.gsc_dimension_snapshots_current WHERE property_domain='astisl.es' AND dimension='page' AND period_days=28")"
  if [ $cb -eq 0 ] && [ $ca -eq 0 ] && [ "$mid" = "B solicitada 11:00" ] && [ "$mid_a" = "0" ] && [ "$end" = "B solicitada 11:00" ]; then
    echo "PASS  concurrencia: A (10:00, confirmada tarde) no desplaza a B (11:00); A sin confirmar invisible"
    echo "        mientras A está abierta -> vigente: '$mid' | filas de A visibles: $mid_a"
    echo "        tras confirmar A        -> vigente: '$end'"
  else
    echo "FAIL  concurrencia (B=$cb, A=$ca, mitad='$mid', filasA_visibles=$mid_a, final='$end')"
    FAILS=$((FAILS+1))
  fi
fi
drop_db "$DB_MAIN"

# Medidas en base aparte (5.000 filas, URLs largas, datos ficticios).
if [ -f "$MEASURE" ]; then
  DB_MEAS="$(rnd_db)"
  new_db "$DB_MEAS"
  apply_mig "$DB_MEAS" "$MIG" "$WORK/meas.mig.log"
  psql -X -d "$DB_MEAS" -f "$MEASURE" > "$WORK/medidas.txt" 2>&1; cm=$?
  drop_db "$DB_MEAS"
  if [ $cm -eq 0 ]; then echo "PASS  medidas registradas"; else echo "FAIL  medidas (código $cm)"; FAILS=$((FAILS+1)); fi
  if [ -n "$RESULTS_DIR" ]; then mkdir -p "$RESULTS_DIR"; cp "$WORK/medidas.txt" "$RESULTS_DIR/medidas-salida-psql.txt"; fi
fi

# ---------------------------------------------------------------- Negativos (deben fallar)
echo "== Negativos (la propuesta mutada debe romper la prueba indicada)"
mutate no-rls          '/ENABLE ROW LEVEL SECURITY/d'
mutate grant-update    '/^GRANT SELECT, INSERT, DELETE ON public.gsc_dimension_snapshots TO service_role;/a GRANT UPDATE ON public.gsc_dimension_snapshots TO service_role;'
mutate grant-anon-view '/^GRANT SELECT ON public.gsc_dimension_snapshots_current TO service_role;/a GRANT SELECT ON public.gsc_dimension_snapshots_current TO anon;'
mutate no-trunc-ck     '/gsc_dim_snap_trunc_ck/d'
mutate no-rows-ck      '/gsc_dim_snap_rows_ck/,/ELSE false END),/d'
mutate no-window-ck    '/gsc_dim_snap_window_ck/d'
mutate asc-order       '/^ ORDER BY property_domain/s/requested_at DESC/requested_at ASC/'
mutate no-tiebreak     '/^ ORDER BY property_domain/s/, id DESC//'

run_case "sin RLS (ENABLE ROW LEVEL SECURITY retirado)"            fail "RLS is off"                       "$WORK/no-rls.sql"
run_case "service_role con UPDATE (capturas mutables)"              fail "must not have UPDATE"             "$WORK/grant-update.sql"
run_case "SELECT de la vista para anon"                              fail "ACL entries"                      "$WORK/grant-anon-view.sql"
run_case "sin CHECK de truncado (5.000 filas sin truncated)"        fail "ACEPTADO indebidamente"           "$WORK/no-trunc-ck.sql"
run_case "sin CHECK de row_count = jsonb_array_length"              fail "ACEPTADO indebidamente"           "$WORK/no-rows-ck.sql"
run_case "sin CHECK de ventana (27 días con periodo 28)"            fail "ACEPTADO indebidamente"           "$WORK/no-window-ck.sql"
run_case "vista eligiendo la captura MÁS ANTIGUA (ASC)"             fail "vigente incorrecta"               "$WORK/asc-order.sql"
run_case "vista sin desempate por id"                               fail "vista sin desempate|empate mal resuelto" "$WORK/no-tiebreak.sql"

echo
if [ $FAILS -eq 0 ]; then echo "TODOS LOS CASOS SE COMPORTAN COMO SE ESPERABA."; exit 0; fi
echo "$FAILS caso(s) no se comportaron como se esperaba."; exit 1
