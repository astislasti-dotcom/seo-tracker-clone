#!/usr/bin/env bash
# Pruebas de la migración GSC-02a en PostgreSQL DESECHABLE.
# Nunca apuntar PGHOST a Supabase: crea y borra bases de datos de prueba.
#
# Uso (PostgreSQL 13+ local o en contenedor):
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/pending/tests/run.sh
#
# Casos:
#   POSITIVOS: migración sobre base vacía; sobre tablas preexistentes compatibles; segunda aplicación.
#   NEGATIVOS (deben fallar con el mensaje esperado): REVOKE retirado; privilegio de TRUNCATE
#   para anon; SELECT para PUBLIC; DELETE para service_role; tabla preexistente con tipo
#   incompatible; sin clave primaria; columna nullable incompatible.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../20261104_gsc_daily_metrics.sql"
TEST="$HERE/gsc_daily_metrics.test.sql"
FIX="$HERE/fixtures"
: "${PGHOST:?Define PGHOST apuntando a un PostgreSQL desechable}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

# mutate <src> <dst> <sed-expression>  -> variante de la migración para un caso negativo
mutate() { sed "$3" "$1" > "$2"; }

# run_case <nombre> <esperado: ok|fail> <patron-de-error|-> <archivo-prefijo|-> <migracion>
run_case() {
  local name="$1" expect="$2" pattern="$3" prefix="$4" mig="$5"
  local db="gsc_t_$(date +%s%N | tail -c 9)_$RANDOM"
  local script="$WORK/$db.sql" log="$WORK/$db.log"
  psql_admin -c "CREATE DATABASE $db;" >/dev/null || { echo "ERROR creando base de prueba"; exit 2; }
  { [ "$prefix" != "-" ] && cat "$prefix"; cat "$TEST"; } > "$script"
  psql -X -v ON_ERROR_STOP=1 -d "$db" -v migration="$mig" -f "$script" > "$log" 2>&1
  local code=$?
  psql_admin -c "DROP DATABASE $db;" >/dev/null 2>&1

  local result
  if [ "$expect" = ok ]; then
    if [ $code -eq 0 ] && grep -Eq "transacción revertida" "$log"; then result=PASS; else result=FAIL; fi
  else
    if [ $code -ne 0 ] && grep -Eq -- "$pattern" "$log"; then result=PASS; else result=FAIL; fi
  fi
  if [ "$result" = PASS ]; then
    printf 'PASS  %-58s (esperado: %s)\n' "$name" "$expect"
  else
    printf 'FAIL  %-58s (esperado: %s, código %s)\n' "$name" "$expect" "$code"
    grep -E "ERROR|Postflight|Preflight|FAILED|OK [0-9]" "$log" | head -n 5 | sed 's/^/        /'
    FAILS=$((FAILS+1))
  fi
}

# Variantes de la migración para los casos negativos.
mutate "$MIG" "$WORK/no-revoke.sql"      '/^REVOKE ALL ON public.gsc_daily_metrics/d; /^REVOKE ALL ON public.gsc_sync_runs/d'
mutate "$MIG" "$WORK/grant-truncate.sql" '/^GRANT SELECT, INSERT, UPDATE ON public.gsc_sync_runs/a GRANT TRUNCATE ON public.gsc_daily_metrics TO anon;'
mutate "$MIG" "$WORK/grant-public.sql"   '/^GRANT SELECT, INSERT, UPDATE ON public.gsc_sync_runs/a GRANT SELECT ON public.gsc_sync_runs TO PUBLIC;'
mutate "$MIG" "$WORK/grant-delete-sr.sql" '/^GRANT SELECT, INSERT, UPDATE ON public.gsc_sync_runs/a GRANT DELETE ON public.gsc_sync_runs TO service_role;'

echo "== Positivos"
run_case "base vacía: migración + pruebas completas"           ok   -                                 -                          "$MIG"
run_case "tablas preexistentes compatibles (no-op seguro)"     ok   -                                 "$FIX/pre_compatible.sql"  "$MIG"
echo "== Negativos (deben fallar)"
run_case "control: sin REVOKE a anon/authenticated/PUBLIC"     fail "anon or authenticated has"       -                          "$WORK/no-revoke.sql"
run_case "anon con TRUNCATE sobre gsc_daily_metrics"           fail "anon or authenticated has"       -                          "$WORK/grant-truncate.sql"
run_case "SELECT para PUBLIC en gsc_sync_runs"                 fail "ACL entries|anon or authenticated has" -                    "$WORK/grant-public.sql"
run_case "DELETE para service_role (no permitido)"            fail "service_role privilege DELETE"  -                          "$WORK/grant-delete-sr.sql"
run_case "tabla preexistente con clicks text"                  fail "incompatible structure"          "$FIX/pre_incompatible_type.sql" "$MIG"
run_case "tabla preexistente sin clave primaria"               fail "incompatible structure|incompatible primary key" "$FIX/pre_no_pk.sql" "$MIG"
run_case "gsc_sync_runs.status nullable (incompatible)"        fail "incompatible structure"          "$FIX/pre_sync_nullable.sql" "$MIG"

echo
if [ $FAILS -eq 0 ]; then echo "TODOS LOS CASOS SE COMPORTAN COMO SE ESPERABA."; exit 0; fi
echo "$FAILS caso(s) no se comportaron como se esperaba."; exit 1
