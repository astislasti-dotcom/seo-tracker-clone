#!/usr/bin/env bash
# GSC-06B · Pruebas de la propuesta supabase/proposed/20261106_gsc_dimension_snapshots.sql
# en PostgreSQL DESECHABLE con datos ficticios. NUNCA apuntar PGHOST a Supabase.
#
# Uso:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#   RESULTS_DIR=docs/gsc-06b ./supabase/proposed/tests/run.sh
#
# Qué comprueba:
#   POSITIVO  : migración sobre base vacía; segunda aplicación idempotente (misma vista); suite SQL
#               (privilegios, RLS, escritura solo por función, restricciones, vigencia, retención,
#               inmutabilidad); rollback dentro de la misma transacción; retención CONCURRENTE con
#               dos sesiones y lock por combinación (B espera a A; sin estado transitorio de 4).
#   TABLA PREEXISTENTE: tres fixtures con las mismas 15 columnas que deben abortar el preflight.
#   NEGATIVO  : mutaciones de la propuesta que DEBEN romper una prueba concreta, incluida
#               la retención concurrente sin lock.
#   MEDIDAS   : tamaño y tiempos con 5.000 filas (supabase/proposed/tests/measure_*.sql).
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

# run_preexisting <nombre> <fixture> <patron>: la tabla ya existe con otra forma. La migración debe
# abortar en el preflight, sin crear la vista ni tocar la tabla (la transacción lo garantiza).
run_preexisting() {
  local name="$1" fixture="$2" pattern="$3"
  local db; db="$(rnd_db)"
  local log="$WORK/$db.pre.log"
  new_db "$db"
  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$fixture" >/dev/null 2>&1; then
    echo "ERROR cargando fixture $fixture"; drop_db "$db"; FAILS=$((FAILS+1)); return
  fi
  apply_mig "$db" "$MIG" "$log"; local c=$?
  local view_created
  view_created="$(psql_db "$db" "SELECT to_regclass('public.gsc_dimension_snapshots_current') IS NOT NULL")"
  drop_db "$db"
  cat "$log" > "$log.all"
  if [ $c -ne 0 ] && [ "$view_created" = "f" ] && grep -Eq -- "$pattern" "$log.all"; then
    printf 'PASS  %-60s (esperado: fail)\n' "$name"
  else
    printf 'FAIL  %-60s (migración=%s, vista_creada=%s)\n' "$name" "$c" "$view_created"
    grep -E "ERROR|Preflight" "$log" | head -n 3 | sed 's/^/        /'
    FAILS=$((FAILS+1))
  fi
}

# ---------------------------------------------------------------- Escenario de retención concurrente
# Llamadas a la función de escritura (la única vía de escritura de service_role).
PUB_R08="SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',7::smallint,'2026-11-05 08:00+00','2026-10-30','2026-11-05','final','byProperty',NULL,25000,1,false,'[{\"k\":\"R08\"}]');"
PUB_R09="SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',7::smallint,'2026-11-05 09:00+00','2026-10-30','2026-11-05','final','byProperty',NULL,25000,1,false,'[{\"k\":\"R09\"}]');"
PUB_R10="SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',7::smallint,'2026-11-05 10:00+00','2026-10-30','2026-11-05','final','byProperty',NULL,25000,1,false,'[{\"k\":\"R10\"}]');"
PUB_R11="SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',7::smallint,'2026-11-05 11:00+00','2026-10-30','2026-11-05','final','byProperty',NULL,25000,1,false,'[{\"k\":\"R11\"}]');"
PUB_R12="SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',7::smallint,'2026-11-05 12:00+00','2026-10-30','2026-11-05','final','byProperty',NULL,25000,1,false,'[{\"k\":\"R12\"}]');"

cat > "$WORK/scn_seed.sql" <<SQL
SET ROLE service_role;
$PUB_R08
$PUB_R09
$PUB_R10
SQL
# A: publica R12 (12:00) y mantiene la transacción abierta 4 s (el lock queda tomado).
cat > "$WORK/scn_a.sql" <<SQL
BEGIN;
SET LOCAL ROLE service_role;
$PUB_R12
SELECT pg_sleep(4);
COMMIT;
SQL
# B: publica R11 (11:00). Con el lock debe ESPERAR a que A confirme.
cat > "$WORK/scn_b.sql" <<SQL
SET ROLE service_role;
$PUB_R11
SQL

# scenario_retencion <db>: 0 si el comportamiento es el esperado; deja el detalle en stdout.
scenario_retencion() {
  local db="$1"
  # Código 2: error de infraestructura (seed). Código 1: aserción de comportamiento no cumplida.
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$WORK/scn_seed.sql" >/dev/null 2>&1 || { echo "seed fallido"; return 2; }
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$WORK/scn_a.sql" > "$WORK/$db.a.log" 2>&1 &
  local pa=$!
  sleep 1
  local t0; t0=$(date +%s%N)
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$WORK/scn_b.sql" > "$WORK/$db.b.log" 2>&1 &
  local pb=$!
  sleep 2
  local mid mid_n
  mid="$(psql_db "$db" "SELECT payload->0->>'k' FROM public.gsc_dimension_snapshots_current WHERE property_domain='astisl.es' AND dimension='query' AND period_days=7")"
  mid_n="$(psql_db "$db" "SELECT count(*) FROM public.gsc_dimension_snapshots WHERE property_domain='astisl.es' AND dimension='query' AND period_days=7")"
  wait $pa; local ra=$?
  wait $pb; local rb=$?
  local waited_ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  local fin_n fin_v fin_set
  fin_n="$(psql_db "$db" "SELECT count(*) FROM public.gsc_dimension_snapshots WHERE property_domain='astisl.es' AND dimension='query' AND period_days=7")"
  fin_v="$(psql_db "$db" "SELECT payload->0->>'k' FROM public.gsc_dimension_snapshots_current WHERE property_domain='astisl.es' AND dimension='query' AND period_days=7")"
  fin_set="$(psql_db "$db" "SELECT string_agg(payload->0->>'k', ',' ORDER BY requested_at) FROM public.gsc_dimension_snapshots WHERE property_domain='astisl.es' AND dimension='query' AND period_days=7")"
  echo "mitad: vigente='$mid' filas=$mid_n | B esperó ${waited_ms} ms | final: filas=$fin_n vigente='$fin_v' conjunto=$fin_set | A=$ra B=$rb"
  if [ $ra -ne 0 ] || [ $rb -ne 0 ]; then return 2; fi
  if [ "$mid" = "R10" ] && [ "$mid_n" = "3" ] \
     && [ "$waited_ms" -ge 2000 ] \
     && [ "$fin_n" = "3" ] && [ "$fin_v" = "R12" ] && [ "$fin_set" = "R10,R11,R12" ]; then
    return 0
  fi
  return 1
}

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
    echo "PASS  suite SQL: privilegios, RLS, escritura solo por función, restricciones, vigencia, retención, inmutabilidad"
    grep -E "OK [0-9a-z]+[ab]?:" "$LOG_T" | sed 's/^/        /'
  else
    echo "FAIL  suite SQL (código $ct)"; grep -E "ERROR|ACEPTADO|vigente|empate|retención|OK" "$LOG_T" | sed 's/^/        /'; FAILS=$((FAILS+1))
  fi

  # Rollback: captura válida + inválida en una sola transacción => no queda nada.
  PROBE="$WORK/probe.sql"
  cat > "$PROBE" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',28::smallint,'2026-11-06 07:00+00','2026-10-10','2026-11-06','final','byProperty',NULL,25000,1,false,'[{"k":"probe-valida"}]');
SELECT public.gsc_publish_dimension_snapshot('astisl.es','query',28::smallint,'2026-11-06 07:01+00','2026-10-10','2026-11-06','final','byProperty',NULL,25000,2,false,'[{"k":"solo una"}]');
COMMIT;
SQL
  # ON_ERROR_STOP: la segunda llamada debe fallar y el COMMIT no debe llegar a confirmar nada.
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB_MAIN" -f "$PROBE" >/dev/null 2>&1; cp=$?
  left="$(psql_db "$DB_MAIN" "SELECT count(*) FROM public.gsc_dimension_snapshots WHERE payload::text LIKE '%probe-valida%'")"
  if [ $cp -ne 0 ] && [ "$left" = "0" ]; then
    echo "PASS  rollback: captura válida se revierte si la segunda de la transacción falla"
  else
    echo "FAIL  rollback (código $cp, filas probe=$left)"; FAILS=$((FAILS+1))
  fi
fi
drop_db "$DB_MAIN"

# Retención concurrente con dos sesiones y lock por combinación.
DB_RET="$(rnd_db)"
new_db "$DB_RET"
apply_mig "$DB_RET" "$MIG" "$WORK/ret.mig.log"; cr=$?
if [ $cr -eq 0 ]; then
  out="$(scenario_retencion "$DB_RET")"; rs=$?
  if [ $rs -eq 0 ]; then
    echo "PASS  retención concurrente: B espera a A (lock por combinación), sin estado de 4, converge a 3"
  else
    echo "FAIL  retención concurrente (código $rs)"; FAILS=$((FAILS+1))
  fi
  echo "        $out"
else
  echo "FAIL  retención concurrente (migración=$cr)"; FAILS=$((FAILS+1))
fi
drop_db "$DB_RET"

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
mutate() { sed "$2" "$MIG" > "$WORK/$1.sql"; }
mutate no-rls          '/ENABLE ROW LEVEL SECURITY/d'
mutate grant-update    '/^GRANT SELECT ON public.gsc_dimension_snapshots TO service_role;/a GRANT UPDATE ON public.gsc_dimension_snapshots TO service_role;'
mutate grant-insert    '/^GRANT SELECT ON public.gsc_dimension_snapshots TO service_role;/a GRANT INSERT ON public.gsc_dimension_snapshots TO service_role;'
mutate grant-anon-view '/^GRANT SELECT ON public.gsc_dimension_snapshots_current TO service_role;/a GRANT SELECT ON public.gsc_dimension_snapshots_current TO anon;'
mutate no-trunc-ck     '/CONSTRAINT gsc_dim_snap_trunc_ck/d'
mutate no-rows-ck      '/CONSTRAINT gsc_dim_snap_rows_ck/,/ELSE false END),/d'
mutate no-window-ck    '/CONSTRAINT gsc_dim_snap_window_ck/d'
mutate asc-order       '/^ ORDER BY property_domain/s/requested_at DESC/requested_at ASC/'
mutate no-tiebreak     '/^ ORDER BY property_domain/s/, id DESC//'
mutate no-delete       '/DELETE FROM public.gsc_dimension_snapshots d/,/LIMIT 3);/d'
mutate no-lock         '/PERFORM pg_advisory_xact_lock(/,/p_period_days::integer);/d'

run_case "sin RLS (ENABLE ROW LEVEL SECURITY retirado)"            fail "RLS is off"                       "$WORK/no-rls.sql"
run_case "service_role con UPDATE (capturas mutables)"              fail "must not have INSERT, UPDATE|must not have UPDATE" "$WORK/grant-update.sql"
run_case "service_role con INSERT directo"                          fail "must not have INSERT"            "$WORK/grant-insert.sql"
run_case "SELECT de la vista para anon"                              fail "ACL entries"                      "$WORK/grant-anon-view.sql"
run_case "sin CHECK de truncado (5.000 filas sin truncated)"        fail "ACEPTADO indebidamente"           "$WORK/no-trunc-ck.sql"
run_case "sin CHECK de row_count = jsonb_array_length"              fail "ACEPTADO indebidamente"           "$WORK/no-rows-ck.sql"
run_case "sin CHECK de ventana (27 días con periodo 28)"            fail "ACEPTADO indebidamente"           "$WORK/no-window-ck.sql"
run_case "vista eligiendo la captura MÁS ANTIGUA (ASC)"             fail "vigente incorrecta"               "$WORK/asc-order.sql"
run_case "vista sin desempate por id"                               fail "vista sin desempate|empate mal resuelto" "$WORK/no-tiebreak.sql"
run_case "función sin retención (no poda en la transacción)"        fail "retención en la misma transacción dejó|retención dejó" "$WORK/no-delete.sql"

# Sin lock: B no espera a A. Debe fallar el escenario concurrente (no la suite de un solo proceso).
DB_NOLOCK="$(rnd_db)"
new_db "$DB_NOLOCK"
apply_mig "$DB_NOLOCK" "$WORK/no-lock.sql" "$WORK/nolock.mig.log"; cn=$?
if [ $cn -ne 0 ]; then
  echo "FAIL  mutación sin lock: la migración mutada no se aplicó (infraestructura)"; FAILS=$((FAILS+1))
else
  out_nl="$(scenario_retencion "$DB_NOLOCK")"; rn=$?
  case $rn in
    1) echo "PASS  sin lock por combinación: el escenario concurrente detecta la mutación (esperado)" ;;
    0) echo "FAIL  mutación sin lock NO detectada por el escenario concurrente"; FAILS=$((FAILS+1)) ;;
    *) echo "FAIL  mutación sin lock: error de infraestructura en el escenario (código $rn)"; FAILS=$((FAILS+1)) ;;
  esac
  echo "        $out_nl"
fi
drop_db "$DB_NOLOCK"

echo "== Tabla preexistente (IF NOT EXISTS no compara: debe abortar sin tocarla)"
run_preexisting "mismas 15 columnas, row_count text"                 "$HERE/fixtures/pre_same_count_wrong_type.sql"        "incompatible structure"
run_preexisting "mismas 15 columnas, payload nullable"               "$HERE/fixtures/pre_same_count_nullable_payload.sql"  "incompatible structure"
run_preexisting "mismas 15 columnas, id sin identidad ni PK"         "$HERE/fixtures/pre_same_count_no_identity.sql"       "incompatible structure|incompatible primary key"

echo
if [ $FAILS -eq 0 ]; then echo "TODOS LOS CASOS SE COMPORTAN COMO SE ESPERABA."; exit 0; fi
echo "$FAILS caso(s) no se comportaron como se esperaba."; exit 1
