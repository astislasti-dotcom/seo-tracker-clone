# Propuesta de seguridad Supabase — `public.keyword_tracking`

**Estado: PROPUESTA. NO EJECUTADA EN SUPABASE.**  
Tarea: [Issue #8](https://github.com/astislasti-dotcom/seo-tracker-clone/issues/8) · Proyecto: SEO Tracker (ASTI y 3AV).

## Alcance aprobado para preparación

- Migración propuesta: [`supabase/migrations/20261030083000_keyword_tracking_rls_readonly.sql`](../supabase/migrations/20261030083000_keyword_tracking_rls_readonly.sql).
- **No se autoriza** ejecutar la migración, modificar políticas en Production, fusionar el PR o habilitar `TRACKING_ENABLED` por el hecho de tener esta propuesta en GitHub.
- El propietario debe aprobar **por separado** cualquier aplicación real a Supabase. La migración no se ejecuta desde la aplicación ni desde CI.
- En este repositorio no había migraciones Supabase versionadas. El archivo sigue la convención de nomenclatura `YYYYMMDDHHMMSS_descripcion.sql`; la CLI Supabase no estaba disponible en el entorno del autor al prepararlo. **Verificar compatibilidad y estado de historial de migraciones antes de desplegarlo con CLI.**

## Estado comprobado con consultas de solo lectura (30/10/2026)

| Aspecto | Antes |
| --- | --- |
| Tabla | `public.keyword_tracking` |
| Filas históricas | 256 (todas con `position=0`, calidad desconocida) |
| RLS | **Desactivado** |
| Políticas | Ninguna |
| Permisos `anon` y `authenticated` | SELECT, INSERT, UPDATE, DELETE (y privilegios adicionales) |
| `service_role` | Puede insertar; no cambiar su concesión |
| Cliente | `app/dashboard/page.jsx` hace `.from('keyword_tracking').select('*')` directamente desde el navegador con `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Otros hallazgos | `public.rls_auto_enable()` es SECURITY DEFINER ejecutable desde roles cliente; asunto **separado** |

El esquema y el dashboard tienen otros problemas funcionales (IDs JSON 1–31 frente a DB 5–35 y un `.limit(31)` global), **no abordados por este parche**.

## Efecto deseado

1. Una única transacción activa RLS, revoca **todos** los privilegios heredables de `PUBLIC` y directos de `anon`/`authenticated` sobre esta tabla.
2. Restaura exclusivamente `SELECT` para `anon` y `authenticated`.
3. Crea política de lectura `USING (true)` **temporal** para conservar la carga actual del dashboard.
4. Una comprobación SQL dentro de la transacción verifica que cada rol cliente puede leer pero no puede escribir, truncar, referenciar o crear triggers, y que `service_role` puede seguir insertando.
5. Las precondiciones abortan si RLS, políticas o privilegios por columna ya cambiaron desde la auditoría. Un error revierte la transacción completa.

**Importante: SELECT público sigue siendo público.** Cualquier cliente con la clave publicable del proyecto podrá acceder a los registros. Esto es una mitigación urgente de **integridad**, no una solución completa de **confidencialidad**. Para obtener privacidad: autenticar el dashboard, servir observaciones desde un endpoint autorizado y retirar la política pública en un cambio posterior.

Los scripts legacy que usan la clave anónima para insertar dejarán de funcionar por diseño. El cron actual sigue bloqueado y no realizará búsquedas externas.

## Pruebas antes de desplegar

- `npm test`: incluye `tests/keyword-tracking-rls-migration.test.mjs`; es una comprobación **estática**, no ejecuta SQL y **no sustituye** una prueba de integración PostgreSQL.
- GitHub Actions ejecuta las pruebas offline sin conexión a Supabase.
- Obtener un backup/punto de restauración viable y anotar el recuento de registros.
- Verificar que el uso de `keyword_tracking` por la app sigue siendo exclusivamente `SELECT` desde cliente. Revisar si existen consumidores externos que dependan de escrituras anónimas.
- Confirmar que el esquema, privilegios y políticas **no han cambiado** con consultas de solo lectura antes de ejecutar la migración.
- Ensayar en una base de desarrollo con esquema equivalente, especialmente la lectura con rol `anon` y las escrituras rechazadas.

## Validación posterior a la aplicación (SQL de solo lectura)

Ejecutar **solo tras autorización independiente y aplicación**, desde un rol con acceso para inspeccionar metadatos:

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'keyword_tracking';

SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'keyword_tracking';

SELECT
  has_table_privilege('anon', 'public.keyword_tracking', 'SELECT') AS anon_can_read,
  has_table_privilege('anon', 'public.keyword_tracking', 'INSERT') AS anon_can_insert,
  has_table_privilege('anon', 'public.keyword_tracking', 'UPDATE') AS anon_can_update,
  has_table_privilege('anon', 'public.keyword_tracking', 'DELETE') AS anon_can_delete,
  has_table_privilege('authenticated', 'public.keyword_tracking', 'SELECT') AS auth_can_read,
  has_table_privilege('authenticated', 'public.keyword_tracking', 'INSERT') AS auth_can_insert,
  has_table_privilege('authenticated', 'public.keyword_tracking', 'UPDATE') AS auth_can_update,
  has_table_privilege('authenticated', 'public.keyword_tracking', 'DELETE') AS auth_can_delete,
  has_table_privilege('service_role', 'public.keyword_tracking', 'INSERT') AS service_can_insert;

SELECT count(*) AS preserved_rows FROM public.keyword_tracking;
```

**Esperado:** RLS `true`, una política SELECT temporal, lecturas cliente `true`, escrituras cliente `false`, escritura de `service_role` `true`, recuento de filas sin cambios por esta migración. Abrir el dashboard después y comprobar que no devuelve `42501` ni error de RLS. Las posiciones erróneas preexistentes no se consideran un fallo de esta migración.

Volver a ejecutar los avisos de seguridad de Supabase. La función `public.rls_auto_enable()` será aún una advertencia hasta ser revisada por separado.

## Incidencias / reversión

- **Antes de COMMIT:** el propio motor revierte automáticamente todos los cambios si falla una precondición o postcondición.
- **Después de COMMIT:** no desactivar RLS ni reabrir escrituras públicas como «rollback rápido»; si falla el dashboard, revisar el `SELECT` concedido, la política SELECT y el código cliente, y aplicar una corrección hacia delante autorizada.
- Si una integración interna necesita escribir, migrarla a un camino seguro exclusivamente de servidor, nunca restaurar `INSERT` público.
- Todo cambio real debe anotarse en el issue #8 con fecha, responsable, evidencia de pruebas y autorización del propietario.

## Referencias oficiales

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
