# GSC-06B · Snapshots de consultas y páginas: pruebas en PostgreSQL desechable

Issue: #34 · Rama: `claude/gsc-06b-snapshots-schema` · Base: `test/gsc-03-integration`

Estado: **PROPUESTA. No aplicada en Supabase.** Todo lo de aquí se ejecutó en un PostgreSQL 16.15 local, desechable, con datos ficticios. No se ha ejecutado ninguna sentencia contra Supabase, Google Search Console, Vercel ni Production.

## Qué contiene

| Ruta | Contenido |
|---|---|
| `supabase/proposed/20261106_gsc_dimension_snapshots.sql` | DDL propuesto: tabla, índice, vista `security_invoker`, RLS sin políticas, REVOKE/GRANT mínimos, postflight. |
| `supabase/proposed/tests/gsc_dimension_snapshots.test.sql` | Suite SQL: privilegios, RLS, restricciones, vigencia, desempate, retención, inmutabilidad. |
| `supabase/proposed/tests/run.sh` | Runner: positivos, idempotencia, rollback, concurrencia con dos sesiones, mutaciones negativas, medidas. Rechaza hosts con `supabase` en `PGHOST`. |
| `supabase/proposed/tests/measure_gsc_dimension_snapshots.sql` | Medidas con 5.000 filas y URLs largas. |
| `docs/gsc-06b/resultados-run.txt` | Salida completa de la última ejecución del runner. |
| `docs/gsc-06b/medidas-salida-psql.txt` | Salida de las medidas. |

## Cómo reproducir

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres \
RESULTS_DIR=docs/gsc-06b ./supabase/proposed/tests/run.sh
```

Requiere un PostgreSQL desechable al que el usuario pueda crear bases. No usar con Supabase.

## Resultados (última ejecución, PostgreSQL 16.15)

**Resultado global: 14 de 14 comprobaciones correctas, código de salida 0.**

Positivos:

- Primera aplicación de la propuesta sobre base vacía: correcta.
- Segunda aplicación: correcta, y la definición de la vista no cambia (`pg_get_viewdef` idéntica).
- Suite SQL completa: privilegios de `anon`, `authenticated` y `PUBLIC` en tabla y vista; `service_role` sin UPDATE ni TRUNCATE; RLS activo sin políticas; `anon` no puede leer; 12 restricciones rechazan datos inválidos; gana la captura solicitada más tarde, no la guardada más tarde; desempate por `id`; una fila vigente por combinación; retención a 3 sin tocar otras combinaciones; `service_role` no puede modificar capturas.
- Rollback: una captura válida seguida de una inválida en la misma transacción no deja nada.
- Concurrencia real con dos sesiones (ver abajo): correcta.

Concurrencia (dos sesiones `psql` reales):

- Sesión A: inserta una captura solicitada a las 10:00 y la confirma **después**.
- Sesión B: inserta una captura solicitada a las 11:00 y la confirma **antes**.
- Mientras A sigue abierta: la vigente es B, y las filas de A no son visibles (0).
- Tras confirmar A: la vigente sigue siendo B.

Negativos (mutaciones de la propuesta que deben romper una prueba concreta):

| Mutación | Resultado |
|---|---|
| Sin `ENABLE ROW LEVEL SECURITY` | Detectada por postflight |
| `GRANT UPDATE` a `service_role` | Detectada por postflight |
| `GRANT SELECT` de la vista a `anon` | Detectada por postflight (ACL) |
| Sin CHECK de truncado | Detectada por la suite |
| Sin CHECK de `row_count` = nº de elementos | Detectada por la suite |
| Sin CHECK de ventana = periodo | Detectada por la suite |
| Vista eligiendo la captura más antigua (ASC) | Detectada por la suite |
| Vista sin desempate por `id` | Detectada por la guarda estructural (ver limitaciones) |

## Defecto encontrado y corregido durante las pruebas

El CHECK `gsc_dim_snap_rows_ck` evaluaba `jsonb_array_length(payload)` sin comprobar antes que `payload` es un array. Con un payload que no es array, PostgreSQL lanzaba un error de función en lugar de una violación de CHECK. Corregido con `CASE WHEN jsonb_typeof(payload) = 'array' THEN ... ELSE false END`, que sí garantiza el orden de evaluación. Este cambio está en el DDL de la rama.

## Medidas (datos ficticios, peor caso del límite)

Captura de 5.000 filas (límite), URLs de ~200 caracteres con parámetros, una sola ejecución, contenedor compartido:

| Captura | Filas | Payload en disco (TOAST comprimido) | Texto JSON | Bytes JSON por fila |
|---|---|---|---|---|
| Página, 28 días | 5.000 | 121 kB | 1.493 kB | ~306 |
| Consulta, 28 días | 5.000 | 97 kB | 648 kB | ~133 |

- Insertar una captura completa en una sola sentencia: 36 ms (página) y 28 ms (consulta).
- Tabla con índices tras las pruebas: 304 kB.
- Lectura de la vigente: índice `gsc_dim_snap_current_idx`, 5 búferes, 0,03 ms de ejecución.
- Limpieza a 3 capturas: plan con índice y subconsulta `LIMIT 3`, 0,14 ms de ejecución.

**Estimación de almacenamiento en el peor caso** (2 propiedades × 3 periodos × 3 capturas retenidas): 18 capturas de página × ~121 kB + 18 de consulta × ~97 kB ≈ **4 MB** comprimidos. Es una cifra de orden de magnitud: los datos reales pueden tener URLs y consultas más largas, y eso aumentaría el tamaño.

## Limitaciones

1. **Versión de PostgreSQL.** Se probó en 16.15 local. La versión de Supabase no está verificada aquí.
2. **Roles simulados.** `anon`, `authenticated` y `service_role` se crean en el prólogo del runner, y los privilegios por defecto se simulan con `ALTER DEFAULT PRIVILEGES`. No reproduce exactamente la configuración real de Supabase. El cambio de exposición del Data API (30/10/2026) citado en el issue **no está verificado**.
3. **Sin prueba por HTTP.** No se prueba PostgREST ni el Data API. La RLS y los privilegios se verifican con `has_table_privilege`, `SET ROLE` y `pg_policies`.
4. **Desempate por `id` no detectable por comportamiento.** Con dos filas empatadas en `requested_at`, PostgreSQL 16 devuelve la correcta por el orden del heap. Quitar el desempate no rompe la prueba de comportamiento. Por eso la suite añade una guarda estructural que comprueba la definición de la vista (`requested_at DESC, id DESC`). Esto es una comprobación del texto de la definición, no del comportamiento.
5. **Concurrencia acotada.** Un solo escenario con dos sesiones y `pg_sleep`. No se prueban varios escritores simultáneos ni carga alta.
6. **Retención bajo concurrencia.** La limpieza (`DELETE ... NOT IN (top 3)`) no se ha probado con una inserción concurrente. Es un punto a probar antes de GSC-06C.
7. **Medidas no representativas.** Una ejecución en un contenedor compartido, sin repetición estadística. Sirven como orden de magnitud, no como garantía para Supabase.
8. **Zonas horarias.** El issue recoge que las fechas de Search Console se calculan en America/Los_Angeles. Esa afirmación no está verificada aquí y la propuesta no la comprueba: las ventanas se guardan como `date` sin zona. Pendiente de confirmar en la documentación oficial antes de GSC-06C.
9. **`truncated` conservador.** Se marca como truncada toda captura con 5.000 filas, aunque Google hubiera devuelto exactamente 5.000 sin más. Es intencionado (más seguro), pero debe quedar claro en la UI futura.
10. **No se ha probado el código de Node** que escribirá las capturas (GSC-06C) ni la lectura por API (GSC-06D).

## Estimación de los siguientes pasos (orientativa)

| Paso | Alcance | Estimación |
|---|---|---|
| Revisión de este PR y decisión sobre el DDL | Revisión por el propietario y ChatGPT | Según revisión |
| GSC-06C: ingesta con `requested_at` del servidor | Código Node, prueba offline, sin Google real | 1 a 2 días |
| GSC-06D: API owner-only de lectura | Handler, `no-store`, prueba offline | 0,5 a 1 día |
| GSC-06E: UI | Panel de consultas y páginas | 1 a 2 días |
| Aplicación en Supabase | Solo con autorización expresa, tras la revisión | Por decidir |

Son estimaciones de esfuerzo de desarrollo, no compromisos de fecha.

## Lo que no se ha hecho (y sigue requiriendo autorización)

- Aplicar el SQL en Supabase.
- Llamadas reales a Google Search Console.
- Merge de este PR, cambios en Production o en Vercel.
- Cambios en PR #33 o en PR #28.
