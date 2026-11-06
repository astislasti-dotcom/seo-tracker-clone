# GSC-06C · ingesta offline de snapshots

Estado: **solo desarrollo offline con datos ficticios.** No se ha ejecutado ninguna consulta a
Google Search Console, no se ha tocado Supabase, Vercel ni Production, y no hay merge.

## Alcance

Módulos nuevos, sin conexión a rutas, cron ni UI:

- `lib/gsc/snapshot-ingest.mjs`: lógica pura y transporte inyectado. Construye la petición
  (una dimensión `query` o `page`, `dataState: 'final'`, `rowLimit: 5000`), valida todas las
  filas y arma el registro para la función SQL.
- `lib/gsc/snapshot-store.mjs`: único adaptador de escritura. Llama a
  `rpc('gsc_publish_dimension_snapshot', registro)`. No usa `from()`, `insert()`, `upsert()`,
  `update()` ni `delete()`.
- `tests/gsc-snapshot-ingest.test.mjs`: 26 pruebas con transporte y repositorio simulados.

## Dependencia de PR #35

La escritura depende de la migración propuesta en
`supabase/proposed/20261106_gsc_dimension_snapshots.sql` (PR #35, rama
`claude/gsc-06b-snapshots-schema`). Esa migración **no está aplicada** y esta PR no la aplica.

Los nombres de los 13 parámetros del registro coinciden con la firma de la función en la PR #35.
La prueba los compara con una lista literal de esa firma. Si la PR #35 cambia, esta lista debe
actualizarse en el mismo cambio.

## Orden de una captura

1. Validar la entrada. Si no es válida, no hay llamada a Google ni escritura.
2. Fijar `requested_at` con el reloj del servidor **antes** de llamar a Google.
3. Leer la respuesta y validar todas las filas. Una sola fila dudosa invalida el snapshot
   completo: no hay escritura parcial.
4. Llamar una vez a la función, que inserta y aplica la retención (3 por combinación) en una
   transacción.

Un error de Google no llama a la función. Los errores salen como códigos fijos (`permission_denied`,
`quota_exceeded`, `storage_error`, etc.). Nunca se reenvía el texto original de Google ni de
Supabase, y la prueba comprueba que una credencial de ejemplo no aparece en el resultado.

`truncated` es `true` cuando se devuelven 5000 filas o más. Es un indicador conservador: Google
puede tener más filas que el límite.

## Qué NO se ha verificado

- La llamada `rpc` contra PostgREST real: solo se ha probado con un cliente simulado.
- Que la función devuelva `bigint` como número o como cadena en la API de Supabase: el adaptador
  acepta ambos.
- La propiedad `SECURITY DEFINER` y el rol propietario en el proyecto real (pendiente, igual que
  en GSC-06B).
- La zona horaria de Search Console y el retraso de 3 días de datos finales (`ASSUMED_FINAL_LAG_DAYS`):
  siguen siendo supuestos.
- Cuotas reales de Google y tamaño real de las respuestas.
- El comportamiento de concurrencia: las capturas se publican en serie.

## Pendiente, no autorizado

- Aplicar la migración de PR #35 en Supabase (gate 2 de GSC-06B: preflight completo sobre la base real).
- Conectar la ingesta a una ruta o cron.
- Cualquier consulta real a Google Search Console.

Ninguno de estos pasos está autorizado en esta PR.

## Cómo ejecutar

```
npm test
```

Todas las pruebas son offline: sin red, sin credenciales y sin base de datos.
