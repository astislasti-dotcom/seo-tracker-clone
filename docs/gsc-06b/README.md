# GSC-06B · Snapshots de consultas y páginas: pruebas en PostgreSQL desechable

Issue: #34 · PR de borrador: #35 · Rama: `claude/gsc-06b-snapshots-schema` · Base: `test/gsc-03-integration`

Estado: **PROPUESTA. No aplicada en Supabase.** Todo lo de aquí se ejecutó en un PostgreSQL 16.15 local, desechable, con datos ficticios. No se ha ejecutado ninguna sentencia contra Supabase, Google Search Console, Vercel ni Production.

## Qué contiene

| Ruta | Contenido |
|---|---|
| `supabase/proposed/20261106_gsc_dimension_snapshots.sql` | DDL propuesto: tabla, índice, vista `security_invoker`, RLS sin políticas, REVOKE/GRANT mínimos, preflight estructural y postflight. |
| `supabase/proposed/tests/gsc_dimension_snapshots.test.sql` | Suite SQL: privilegios, RLS, restricciones, vigencia, desempate, retención, inmutabilidad. |
| `supabase/proposed/tests/run.sh` | Runner: positivos, idempotencia, rollback, concurrencia de inserciones, retención concurrente, tablas preexistentes incompatibles, mutaciones negativas y medidas. Rechaza hosts con `supabase` en `PGHOST`. |
| `supabase/proposed/tests/fixtures/` | Tres tablas preexistentes incompatibles con el mismo número de columnas. |
| `supabase/proposed/tests/measure_gsc_dimension_snapshots.sql` | Medidas con 5.000 filas: escenario comprimible y escenario poco repetitivo. |
| `docs/gsc-06b/resultados-run.txt` | Salida completa de la última ejecución del runner. |
| `docs/gsc-06b/medidas-salida-psql.txt` | Salida de las medidas. |

## Cómo reproducir

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres \
RESULTS_DIR=docs/gsc-06b ./supabase/proposed/tests/run.sh
```

Requiere un PostgreSQL desechable al que el usuario pueda crear bases. No usar con Supabase.

## Resultados (última ejecución, PostgreSQL 16.15)

**Resultado global: 17 de 17 comprobaciones correctas, 0 fallos, código de salida 0.**

Positivos:

- Primera aplicación de la propuesta sobre base vacía: correcta.
- Segunda aplicación: correcta, y la definición de la vista no cambia (`pg_get_viewdef` idéntica).
- Suite SQL completa: privilegios de `anon`, `authenticated` y `PUBLIC` en tabla y vista; `service_role` sin UPDATE ni TRUNCATE; RLS activo sin políticas; `anon` no puede leer; 12 restricciones rechazan datos inválidos; gana la captura solicitada más tarde, no la guardada más tarde; desempate por `id`; una fila vigente por combinación; retención a 3 sin tocar otras combinaciones; `service_role` no puede modificar capturas.
- Rollback: una captura válida seguida de una inválida en la misma transacción no deja nada.
- Concurrencia de inserciones con dos sesiones reales: correcta (ver abajo).
- Retención concurrente con dos sesiones reales: correcta (ver abajo).

Concurrencia de inserciones:

- Sesión A: inserta una captura solicitada a las 10:00 y la confirma **después**.
- Sesión B: inserta una captura solicitada a las 11:00 y la confirma **antes**.
- Mientras A sigue abierta: la vigente es B, y las filas de A no son visibles (0).
- Tras confirmar A: la vigente sigue siendo B.

Retención concurrente:

- Estado inicial: 4 capturas confirmadas (08:00, 09:00, 10:00, 11:00).
- Sesión A: inserta una captura de las 12:00 y no la confirma durante 4 s.
- Sesión B: aplica la retención (mantener 3) y confirma mientras A está abierta. Resultado: 3 filas, vigente 11:00.
- Tras confirmar A: 4 filas (estado transitorio, por encima de 3).
- Segunda pasada de retención: 3 filas (10:00, 11:00, 12:00). La vigente (12:00) nunca se borra.

Tablas preexistentes (`IF NOT EXISTS` no compara estructura): el preflight aborta sin crear la vista en los tres casos.

| Fixture | Diferencia (mismas 15 columnas) | Resultado |
|---|---|---|
| `pre_same_count_wrong_type.sql` | `row_count` es `text` | Aborta: incompatible structure |
| `pre_same_count_nullable_payload.sql` | `payload` admite NULL | Aborta: incompatible structure |
| `pre_same_count_no_identity.sql` | `id` sin identidad ni PK | Aborta: incompatible structure |

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

Las mutaciones de CHECK se anclan a la línea `CONSTRAINT <nombre>`. Una primera versión las anclaba al nombre suelto, que también aparece en la lista del preflight, y eso rompía el bloque por motivos ajenos a la prueba.

## Cambios respecto a la revisión de ChatGPT (SHA `42a5458`)

1. **Preflight estructural (prioridad alta).** Antes solo se contaban 15 columnas. Ahora, si la tabla existe, se exige: nombre, tipo y nulabilidad de cada columna; `id` como identidad `GENERATED ALWAYS`; clave primaria sobre `id`; exactamente 13 CHECK; y las cinco restricciones con nombre. Si no coincide, se aborta sin tocar nada. Cubierto por los tres fixtures negativos.
2. **Lectura medida con el `jsonb` materializado (prioridad alta).** El plan de índice (0,02 ms) se mantiene como métrica aparte. Además, `EXPLAIN ANALYZE` con `sum(octet_length(payload::text))` sobre las 5.000 filas: 4,7 ms de ejecución. Y un `\copy` de la vigente a `/dev/null`: 8,1 ms para extraer y serializar el `jsonb` completo. **No incluye transporte HTTP**: no hay un binario de PostgREST en el entorno y no se instaló.
3. **Retención bajo concurrencia (prioridad alta).** Cubierto por la prueba de dos sesiones descrita arriba. Confirma que la limpieza no borra la vigente, que el estado transitorio es de 4 filas y que una segunda pasada converge a 3.
4. **Capacidad.** La estimación de 4 MB se retira. Era optimista: el fixture de URLs usaba un tramo muy repetido (`repeat('abcdefghij', 12)`) que favorece la compresión TOAST. Se mantiene como **escenario comprimible** y se añade un escenario poco repetitivo (MD5). Ver tabla de medidas.

## Medidas (datos ficticios, 5.000 filas por captura, una sola ejecución, contenedor compartido)

Escenario comprimible (URLs con tramo repetido):

| Captura | Payload en disco | Texto JSON | Ratio de compresión |
|---|---|---|---|
| Página, 28 días | 121 kB | 1.493 kB | 0,081 |
| Consulta, 28 días | 97 kB | 648 kB | 0,150 |

Escenario poco repetitivo (URLs y consultas con MD5, 90 días):

| Captura | Payload en disco | Texto JSON | Ratio de compresión |
|---|---|---|---|
| Página, 90 días | 777 kB | 1.265 kB | 0,615 |

No se ha medido un fixture de consultas poco repetitivas; el escenario de páginas es el más cercano a ese caso.

Tiempos:

- Inserción de una captura completa en una sola sentencia: 36 ms (página) y 28 ms (consulta).
- Lectura de la vigente, plan de índice: 0,02 ms de ejecución, 5 búferes.
- Lectura de la vigente materializando el `jsonb`: 4,7 ms (`EXPLAIN ANALYZE`) y 8,1 ms (`\copy` a `/dev/null`).
- Limpieza a 3 capturas: 0,13 ms de ejecución.
- Tabla con índices tras las pruebas: 304 kB.

**Escenario sintético de almacenamiento poco comprimible.** Hay 12 combinaciones (2 propiedades × 2 dimensiones × 3 periodos) y 3 capturas retenidas por combinación, es decir, 36 capturas. Si todas tuvieran 5.000 filas poco repetitivas como la medida (777 kB en disco), el resultado sería **36 × 777 kB ≈ 28 MB**, más índices. **No es una cota superior demostrada**: es un escenario sintético con URLs poco comprimibles. Los datos reales pueden comprimir mejor o peor, y no se han medido con datos reales de Search Console.

## Defecto encontrado y corregido durante las pruebas

El CHECK `gsc_dim_snap_rows_ck` evaluaba `jsonb_array_length(payload)` sin comprobar antes que `payload` es un array. Con un payload que no es array, PostgreSQL lanzaba un error de función en lugar de una violación de CHECK. Corregido con `CASE WHEN jsonb_typeof(payload) = 'array' THEN ... ELSE false END`, que sí garantiza el orden de evaluación.

## Limitaciones

1. **Versión de PostgreSQL.** Se probó en 16.15 local. La versión de Supabase no está verificada aquí.
2. **Roles simulados.** `anon`, `authenticated` y `service_role` se crean en el prólogo del runner, y los privilegios por defecto se simulan con `ALTER DEFAULT PRIVILEGES`. No reproduce exactamente la configuración real de Supabase. El cambio de exposición del Data API (30/10/2026) citado en el issue **no está verificado**.
3. **Sin prueba por HTTP.** No se prueba PostgREST ni el Data API, y la lectura medida tampoco incluye transporte. La RLS y los privilegios se verifican con `has_table_privilege`, `SET ROLE` y `pg_policies`.
4. **Desempate por `id` no detectable por comportamiento.** Con dos filas empatadas en `requested_at`, PostgreSQL 16 devuelve la correcta por el orden del heap, y quitar el desempate no rompe la prueba de comportamiento. La suite añade por eso una guarda estructural sobre la definición de la vista (`requested_at DESC, id DESC`). Es una comprobación del texto de la definición, no del comportamiento.
5. **Concurrencia acotada.** Dos escenarios con dos sesiones y `pg_sleep`. No se prueban varios escritores simultáneos ni carga alta.
6. **Retención concurrente: un solo escenario.** Hay un estado transitorio de 4 filas por encima del límite, que se corrige en la siguiente pasada. Un servidor real que ejecute la retención periódicamente lo absorbe, pero hay que documentarlo en GSC-06C.
7. **Medidas no representativas.** Una ejecución en un contenedor compartido, sin repetición estadística. Sirven como orden de magnitud, no como garantía para Supabase.
8. **Zona horaria.** El issue recoge que las fechas de Search Console se calculan en America/Los_Angeles. Esa afirmación no está verificada aquí y la propuesta no la comprueba: las ventanas se guardan como `date` sin zona. Pendiente de confirmar en la documentación oficial antes de GSC-06C.
9. **`truncated` conservador.** Se marca como truncada toda captura con 5.000 filas, aunque Google hubiera devuelto exactamente 5.000 sin más. Es intencionado (más seguro), pero debe quedar claro en la UI futura.
10. **Preflight no cubre todo.** El preflight compara nombres, tipos, nulabilidad, identidad, PK y número y nombres de CHECK, pero **no compara el texto de cada CHECK ni los valores por defecto**, ni los índices de una tabla preexistente. Si existe una tabla con esos detalles distintos, la migración puede aceptarla.
11. **No se ha probado el código de Node** que escribirá las capturas (GSC-06C) ni la lectura por API (GSC-06D).

## Estimación de los siguientes pasos (orientativa)

| Paso | Alcance | Estimación |
|---|---|---|
| Revisión de la PR #35 y decisión sobre el DDL | Revisión por el propietario y ChatGPT | Según revisión |
| GSC-06C: ingesta con `requested_at` del servidor | Código Node, prueba offline, sin Google real | 1 a 2 días |
| GSC-06D: API owner-only de lectura | Handler, `no-store`, prueba offline | 0,5 a 1 día |
| GSC-06E: UI | Panel de consultas y páginas | 1 a 2 días |
| Aplicación en Supabase | Solo con autorización expresa, tras la revisión | Por decidir |

Son estimaciones de esfuerzo de desarrollo, no compromisos de fecha.

## Condiciones antes de aplicar o activar escritura real

Según la segunda revisión de ChatGPT (PR #35, SHA `f01b67a`), GSC-06B queda aceptable como propuesta offline. Estas condiciones son puertas de aceptación, no son cumplidas todavía:

1. **Retención estricta.** Las pruebas demuestran que, tras dos confirmaciones concurrentes, pueden quedar **4 capturas** hasta una segunda limpieza. Sin cron ni sincronización posterior garantizada, ese estado puede durar indefinidamente. Antes de activar GSC-06C con datos reales hay que implementar y probar una estrategia acotada que garantice las 3 versiones por combinación (por ejemplo, serializar la escritura por combinación y limpiar al terminar, o un mecanismo SQL equivalente). **La segunda pasada manual de las pruebas no es una convergencia automática.**
2. **Preflight completo sobre la base real.** El preflight actual no verifica la expresión exacta de los CHECK, los valores por defecto ni los índices de una tabla preexistente. Antes de aplicar sobre Supabase hay que examinar el estado real de la tabla (solo con autorización expresa) y reforzar la idempotencia. No se repara estructura incompatible automáticamente.

Además, antes de aprobar una migración real hay que medir el transporte HTTP, la versión de PostgreSQL, los roles y los privilegios del proyecto.

No se desarrolla GSC-06C hasta recibir autorización expresa del propietario.

## Lo que no se ha hecho (y sigue requiriendo autorización)

- Aplicar el SQL en Supabase.
- Llamadas reales a Google Search Console.
- Merge de la PR #35, cambios en Production o en Vercel.
- Cambios en PR #33 o en PR #28.
