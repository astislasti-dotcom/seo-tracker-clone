# GSC-06B · Snapshots de consultas y páginas: pruebas en PostgreSQL desechable

Issue: #34 · PR de borrador: #35 · Rama: `claude/gsc-06b-snapshots-schema` · Base: `test/gsc-03-integration`

Estado: **PROPUESTA. No aplicada en Supabase.** Todo lo de aquí se ejecutó en un PostgreSQL 16.15 local, desechable, con datos ficticios. No se ha ejecutado ninguna sentencia contra Supabase, Google Search Console, Vercel ni Production.

## Qué contiene

| Ruta | Contenido |
|---|---|
| `supabase/proposed/20261106_gsc_dimension_snapshots.sql` | DDL propuesto: tabla, índice, vista `security_invoker`, RLS sin políticas, función de escritura `gsc_publish_dimension_snapshot` (inserta y aplica retención en una transacción con lock por combinación), REVOKE/GRANT mínimos, preflight estructural y postflight. |
| `supabase/proposed/tests/gsc_dimension_snapshots.test.sql` | Suite SQL: privilegios, RLS, escritura solo por función, restricciones, vigencia, desempate, retención e inmutabilidad. |
| `supabase/proposed/tests/run.sh` | Runner: positivos, idempotencia, rollback, retención concurrente con dos sesiones, tablas preexistentes incompatibles, mutaciones negativas y medidas. Rechaza hosts con `supabase` en `PGHOST`. |
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

## Diseño de escritura y retención

- **Única vía de escritura para `service_role`: `public.gsc_publish_dimension_snapshot(...)`.** Es `SECURITY DEFINER` con `search_path` fijado. `service_role` no tiene INSERT ni DELETE directos sobre la tabla (lo verifican la suite y el postflight).
- **Dentro de una sola transacción:** lock asesor transaccional por combinación (propiedad × dimensión), inserción y poda a las 3 capturas más recientes por `requested_at, id`.
- **Por qué el lock:** sin él, dos escritores de la misma combinación pueden terminar con 4 capturas. Ver la mutación "sin lock" abajo.
- **Vigencia sin cambios:** la vista sigue eligiendo por `requested_at DESC, id DESC`. `completed_at` es solo auditoría.
- **Si la captura nueva es más antigua que las 3 más recientes**, la poda la descarta. La función devuelve el `id` igualmente; la vigencia la decide `requested_at`.

## Resultados (última ejecución, PostgreSQL 16.15)

**Resultado global: 19 de 19 comprobaciones correctas, 0 fallos, código de salida 0.** Salida en `docs/gsc-06b/resultados-run.txt`.

Positivos:

- Primera aplicación de la propuesta sobre base vacía: correcta.
- Segunda aplicación: correcta, y la definición de la vista no cambia (`pg_get_viewdef` idéntica).
- Suite SQL completa: privilegios de `anon`, `authenticated` y `PUBLIC` en tabla, vista y función; `service_role` sin INSERT, UPDATE, DELETE ni TRUNCATE directos y con EXECUTE sobre la función; RLS activo sin políticas; `anon` no puede leer; 12 restricciones de tabla rechazan datos inválidos, y las mismas validaciones se aplican por la función; la captura solicitada más tarde gana aunque se guarde antes; la retención deja 3 en la misma transacción, sin estado de 4; desempate por `id`; una fila vigente por combinación; `service_role` no puede modificar capturas.
- Rollback: una captura válida seguida de una inválida en la misma transacción no deja nada.
- Retención concurrente con dos sesiones y lock por combinación (ver abajo): correcta.

Retención concurrente (dos sesiones reales):

- Estado inicial: 3 capturas confirmadas (08:00, 09:00, 10:00).
- Sesión A: publica la captura de las 12:00 y mantiene la transacción abierta 4 s.
- Sesión B: publica la de las 11:00 un segundo después. **Espera ~3 s** a que A confirme (lock por combinación).
- Mientras A está abierta: vigente 10:00, 3 filas. Ni A ni B se ven confirmadas todavía.
- Final: 3 filas (10:00, 11:00, 12:00), vigente 12:00. La captura de 11:00, más antigua que la vigente, no la desplaza.

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
| `GRANT INSERT` directo a `service_role` | Detectada por postflight |
| `GRANT SELECT` de la vista a `anon` | Detectada por postflight (ACL) |
| Sin CHECK de truncado | Detectada por la suite |
| Sin CHECK de `row_count` = nº de elementos | Detectada por la suite |
| Sin CHECK de ventana = periodo | Detectada por la suite |
| Vista eligiendo la captura más antigua (ASC) | Detectada por la suite |
| Vista sin desempate por `id` | Detectada por la guarda estructural (ver limitaciones) |
| Función sin poda (no retiene 3 en la transacción) | Detectada por la suite |
| **Función sin lock por combinación** | Detectada por el escenario concurrente: queda un estado final de 4 filas |

Notas sobre las mutaciones:

- Las mutaciones de CHECK se anclan a la línea `CONSTRAINT <nombre>`. Una primera versión las anclaba al nombre suelto, que también aparece en la lista del preflight, y eso rompía el bloque por motivos ajenos a la prueba.
- Sin lock, B **también espera** ~3 s, pero por un bloqueo de fila sobre la captura de 08:00 que A y B intentan borrar. Ese bloqueo no basta: B evalúa la poda con un snapshot que no ve la captura de A, así que conserva una más y queda en 4. Por eso el lock de combinación es el que hace la retención determinista, y el escenario concurrente comprueba el estado final, no solo la espera.

## Cambios respecto a la revisión de ChatGPT (SHA `f01b67a`)

1. **Retención estricta (condición de aceptación 1).** Implementada en la función de escritura: lock por combinación y poda en la misma transacción. `service_role` ya no puede escribir ni borrar directamente, así que la política no depende de que el servidor se acuerde de limpiar. La prueba concurrente sustituye a la «segunda pasada manual»: ya no hay estado de 4 que converger.
2. **Lectura con `jsonb` materializado.** Sin cambios respecto a la ronda anterior.
3. **Capacidad.** Sin cambios respecto a la ronda anterior: escenario sintético, no cota demostrada.

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

- Publicar una captura completa de 5.000 filas (incluye construir el `jsonb` en la consulta): 69 ms (página) y 41 ms (consulta).
- Publicar con retención sobre una combinación ya llena (lock + inserción + poda, 5.000 filas): 54 ms.
- Lectura de la vigente, plan de índice: 0,02 ms de ejecución, 5 búferes.
- Lectura de la vigente materializando el `jsonb`: 4,6 ms (`EXPLAIN ANALYZE`) y 8,4 ms (`\copy` a `/dev/null`).
- Tabla con índices tras las pruebas: 304 kB.

**Escenario sintético de almacenamiento poco comprimible.** Hay 12 combinaciones (2 propiedades × 2 dimensiones × 3 periodos) y 3 capturas retenidas por combinación, es decir, 36 capturas. Si todas tuvieran 5.000 filas poco repetitivas como la medida (777 kB en disco), el resultado sería **36 × 777 kB ≈ 28 MB**, más índices. **No es una cota superior demostrada**: es un escenario sintético con URLs poco comprimibles. Los datos reales pueden comprimir mejor o peor, y no se han medido con datos reales de Search Console.

## Defecto encontrado y corregido durante las pruebas

- El CHECK `gsc_dim_snap_rows_ck` evaluaba `jsonb_array_length(payload)` sin comprobar antes que `payload` es un array. Con un payload que no es array, PostgreSQL lanzaba un error de función en lugar de una violación de CHECK. Corregido con `CASE WHEN jsonb_typeof(payload) = 'array' THEN ... ELSE false END`, que sí garantiza el orden de evaluación.
- La primera versión de la función recibía `p_period_days smallint`, y las llamadas con literales enteros no resolvían. Los sitios de llamada llevan ahora `::smallint`.

## Limitaciones

1. **Versión de PostgreSQL.** Se probó en 16.15 local. La versión de Supabase no está verificada aquí.
2. **Roles simulados.** `anon`, `authenticated` y `service_role` se crean en el prólogo del runner, y los privilegios por defecto se simulan con `ALTER DEFAULT PRIVILEGES`. No reproduce exactamente la configuración real de Supabase. El cambio de exposición del Data API (30/10/2026) citado en el issue **no está verificado**.
3. **Propietario de la función.** La función se ejecuta como `SECURITY DEFINER` con los privilegios de quien ejecuta la migración. En la prueba es `postgres`. En Supabase hay que verificar que la migración la crea con un propietario que pueda escribir la tabla y que `service_role` no hereda más de lo previsto.
4. **Aislamiento READ COMMITTED.** La poda y la vigencia se han probado con el nivel por defecto de PostgreSQL. Con otro nivel de aislamiento, el comportamiento no está probado.
5. **Sin prueba por HTTP.** No se prueba PostgREST ni el Data API, y la lectura medida tampoco incluye transporte. La RLS y los privilegios se verifican con `has_table_privilege`, `has_function_privilege`, `SET ROLE` y `pg_policies`.
6. **Desempate por `id` no detectable por comportamiento.** Con dos filas empatadas en `requested_at`, PostgreSQL 16 devuelve la correcta por el orden del heap, y quitar el desempate no rompe la prueba de comportamiento. La suite añade por eso una guarda estructural sobre la definición de la vista (`requested_at DESC, id DESC`). Es una comprobación del texto de la definición, no del comportamiento.
7. **Concurrencia acotada.** Dos escenarios con dos sesiones y `pg_sleep`. No se prueban varios escritores simultáneos ni carga alta, ni la combinación de escritores de propiedades distintas.
8. **Medidas no representativas.** Una ejecución en un contenedor compartido, sin repetición estadística. Sirven como orden de magnitud, no como garantía para Supabase.
9. **Zona horaria.** El issue recoge que las fechas de Search Console se calculan en America/Los_Angeles. Esa afirmación no está verificada aquí y la propuesta no la comprueba: las ventanas se guardan como `date` sin zona. Pendiente de confirmar en la documentación oficial antes de GSC-06C.
10. **`truncated` conservador.** Se marca como truncada toda captura con 5.000 filas, aunque Google hubiera devuelto exactamente 5.000 sin más. Es intencionado (más seguro), pero debe quedar claro en la UI futura.
11. **Preflight no cubre todo.** El preflight compara nombres, tipos, nulabilidad, identidad, PK y número y nombres de CHECK, pero **no compara el texto de cada CHECK ni los valores por defecto**, ni los índices de una tabla preexistente. Si existe una tabla con esos detalles distintos, la migración puede aceptarla.
12. **Disciplina de llamada.** La garantía de retención vale solo si el servidor escribe **exclusivamente** con la función. Esto se cumple en la propuesta porque `service_role` no tiene otra vía, pero GSC-06C debe llamar solo a la función.
13. **No se ha probado el código de Node** que llamará a la función (GSC-06C) ni la lectura por API (GSC-06D).

## Estimación de los siguientes pasos (orientativa)

| Paso | Alcance | Estimación |
|---|---|---|
| Revisión de la PR #35 y decisión sobre el DDL | Revisión por el propietario y ChatGPT | Según revisión |
| GSC-06C: ingesta que llama a la función con `requested_at` del servidor | Código Node, prueba offline, sin Google real | 1 a 2 días |
| GSC-06D: API owner-only de lectura | Handler, `no-store`, prueba offline | 0,5 a 1 día |
| GSC-06E: UI | Panel de consultas y páginas | 1 a 2 días |
| Aplicación en Supabase | Solo con autorización expresa, tras la revisión | Por decidir |

Son estimaciones de esfuerzo de desarrollo, no compromisos de fecha.

## Condiciones antes de aplicar o activar escritura real

Según la segunda revisión de ChatGPT (PR #35, SHA `f01b67a`), estas condiciones son puertas de aceptación:

1. **Retención estricta.** **Implementada y probada offline** en esta ronda (función con lock por combinación; prueba concurrente). Pendiente de revisión por ChatGPT y el propietario.
2. **Preflight completo sobre la base real.** **Pendiente.** El preflight actual no verifica la expresión exacta de los CHECK, los valores por defecto ni los índices de una tabla preexistente. Antes de aplicar sobre Supabase hay que examinar el estado real de la tabla (solo con autorización expresa) y reforzar la idempotencia. No se repara estructura incompatible automáticamente.

Además, antes de aprobar una migración real hay que medir el transporte HTTP, la versión de PostgreSQL, los roles, los privilegios y el propietario de la función en el proyecto.

No se desarrolla GSC-06C hasta recibir autorización expresa del propietario.

## Lo que no se ha hecho (y sigue requiriendo autorización)

- Aplicar el SQL en Supabase.
- Llamadas reales a Google Search Console.
- Merge de la PR #35, cambios en Production o en Vercel.
- Cambios en PR #33 o en PR #28.
