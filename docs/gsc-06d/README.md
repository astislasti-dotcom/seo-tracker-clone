# GSC-06D · lectura owner-only de capturas vigentes

Estado: **implementación offline con datos ficticios.** No se ha consultado Google Search Console, no se ha tocado Supabase real, Vercel ni Production, no hay cron y no hay merge.

## Alcance

- `GET /api/gsc/snapshots`: lectura owner-only de la captura vigente por propiedad, dimensión y periodo.
- `lib/gsc/snapshot-read.mjs`: lógica pura. Valida parámetros, valida cada captura completa, ordena y pagina.
- `lib/gsc/snapshot-read-handler.mjs`: orden de la petición, autorización, errores y respuesta.
- `lib/gsc/snapshot-read-store.mjs`: lector de la vista `gsc_dimension_snapshots_current`. Solo `SELECT` con columnas explícitas.
- `tests/gsc-snapshot-read.test.mjs`: 27 pruebas offline.
- `scripts/bench-gsc06d.mjs`: benchmark sintético, ejecución manual. No forma parte de `npm test`.

**Fuera de alcance:** interfaz del dashboard (GSC-06E), llamadas a Google, escrituras, RPC, cron, migraciones y cambios en `main`.

## Dependencias

Esta rama se crea desde `test/gsc-03-integration` y **no contiene** el código de GSC-06C. Las dependencias son:

- **PR #35** (migración propuesta en `supabase/proposed/`): la vista `gsc_dimension_snapshots_current` debe existir. **No está aplicada.** Sin ella, la ruta devuelve 502 `storage_error`.
- **PR #36** (GSC-06C, ingesta): es quien escribe las capturas que esta ruta lee. Hoy está en borrador.

Por tanto, la integración real no está verificada. Solo se han probado los módulos con un repositorio simulado.

## Contrato de la respuesta

`GET /api/gsc/snapshots?brand=astisl.es|3av.events|all&dimension=query|page&period=7|28|90&limit=1..500&offset=0..4999`

- Por defecto: `limit=100`, `offset=0`.
- Éxito, incluida ausencia de capturas: **HTTP 200** con `snapshots` (una entrada por captura encontrada) y `missing` (`domain`, `dimension`, `periodDays` de cada captura que falta). La ausencia **no** es un error.
- Cada entrada de `snapshots` incluye `window`, `requestedAt`, `dataState`, `rowCount`, `truncatedAtSource`, `limit`, `offset`, `returned`, `totalAvailable`, `hasMore` y `rows` (`key`, `clicks`, `impressions`, `ctr`, `position`).
- Las filas se ordenan por clics descendentes, impresiones descendentes y clave ascendente, **antes** de paginar.
- Con `brand=all`, cada propiedad conserva su propia captura. No se suman posiciones ni se mezclan consultas.

| Código | Cuándo |
| --- | --- |
| 200 | Éxito, incluidas capturas ausentes |
| 400 | Parámetro fuera de la lista admitida o de rango |
| 401 | Sin token o token no verificable |
| 403 | Token de otro email |
| 405 | Método distinto de GET |
| 502 | Error de almacenamiento o captura que no cumple la forma esperada |
| 503 | Propietario o clave de servidor sin configurar |

Todas las respuestas llevan `Cache-Control: no-store`. Los mensajes de error son fijos; nunca se reenvía el texto de Supabase ni la clave.

## Validación

Cada captura se valida completa antes de devolverse. Si una falla, la respuesta completa es 502 y no se devuelve ninguna fila parcial. Se comprueba:

- dominio, dimensión y periodo iguales a los pedidos;
- `data_state = 'final'`;
- ventana con longitud igual al periodo;
- `row_count` entre 0 y 5000 e igual a la longitud de `payload`;
- `truncated` coherente con `row_count`;
- por fila: clave no vacía y de hasta 2048 caracteres, clics e impresiones enteros, clics no mayores que impresiones, CTR entre 0 y 1, posición entre 0 y 99999;
- claves sin duplicados.

## Configuración

Los dominios salen de `config/gsc-properties.json`, la única fuente de propiedades. Solo se admiten `astisl.es` y `3av.events`. No se copia `siteUrl` en el código de lectura.

## Seguridad

- `authorizeOwner` se ejecuta antes de cualquier lectura.
- `service_role` solo en servidor; no se devuelve ni se registra.
- Solo `SELECT` sobre la vista, con columnas explícitas. Las pruebas comprueban que el lector no usa `insert`, `update`, `delete`, `upsert` ni `rpc`, y que la ruta exporta solo `GET`.
- Las consultas de búsqueda son datos comerciales. Las pruebas usan datos ficticios. El benchmark usa dominios `.invalid`.

## Benchmark sintético (no es rendimiento real)

Salida completa en `docs/gsc-06d/benchmark-salida.txt`. Con 5.000 filas sintéticas por dimensión:

| Dimensión | Limit | Validación | Orden y página | Tamaño respuesta |
| --- | --- | --- | --- | --- |
| query | 100 | 3,4 ms | 1,4 ms | 10,9 KB |
| query | 500 | 3,4 ms | 1,1 ms | 53,3 KB |
| page | 100 | 1,3 ms | 1,6 ms | 12,1 KB |
| page | 500 | 1,3 ms | 0,6 ms | 59,3 KB |

La captura completa de 5.000 filas ocupa unos 0,39 MiB (query) y 0,45 MiB (page) como JSON. **Esto no mide PostgREST ni la red.** Cada lectura sigue transfiriendo la columna `payload` completa desde la base de datos. Si eso resulta excesivo al medirlo con datos reales, la alternativa es una función SQL de lectura paginada, que requiere migración y autorización aparte.

## Pruebas

`npm test`: suite completa en verde (270/270). Las pruebas de GSC-06D son 27 y cubren: autorización (401, 403, 503 y verificador que lanza), método (405), parámetros (400), `missing`, `brand=all` con dos dominios, paginación (página 1, página 2, final y offset fuera de rango), validación de capturas corruptas (502 sin filas), error de almacenamiento (502 sin texto original), `no-store`, ausencia de clave en respuestas y solo lectura de la vista.

## Pendiente, no autorizado

- Integración real con la vista: requiere PR #35 aplicada y autorización específica.
- Medición con datos reales de PostgREST.
- Interfaz del dashboard (GSC-06E).
- Verificación de identificadores de propiedad en Search Console y de la zona horaria.
