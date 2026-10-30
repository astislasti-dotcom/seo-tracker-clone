# Estado técnico — SEO Tracker (ASTI y 3AV)

**Documento operativo.** Fuente de referencia técnica para sesiones futuras. No sustituye a [`CLAUDE.md`](../CLAUDE.md), [`AGENTS.md`](../AGENTS.md) ni [`docs/PROTOCOLO_COLABORACION.md`](PROTOCOLO_COLABORACION.md); léelos antes de actuar.

- **Fecha de verificación:** 30/10/2026 (tarde).
- **`main`:** [`21279f9`](https://github.com/astislasti-dotcom/seo-tracker-clone/commit/21279f9) (fusión del PR #14).
- **Rama de trabajo E1:** `claude/e1-access-unification`, [PR #16](https://github.com/astislasti-dotcom/seo-tracker-clone/pull/16) en **borrador, sin fusionar**. Commit anterior a este documento: `0a9614c`.
- **Issue de coordinación:** [#15](https://github.com/astislasti-dotcom/seo-tracker-clone/issues/15) (producto V1, plan v3, calendario 2–6 de noviembre).
- **Reglas:** ningún agente fusiona, aplica SQL, despliega a producción, cambia permisos ni activa servicios de pago sin autorización expresa del propietario.

Leyenda de estado: **Fusionado** (en `main`) · **En PR** (existe, sin fusionar) · **Probado offline** (tests locales) · **Verificado en servicio real** · **Propuesto** · **Bloqueado** (requiere autorización o acción externa).

---

## 1. Foto del proyecto

- **Producto:** panel interno de posicionamiento orgánico para dos marcas independientes: ASTI (`astisl.es`) y 3AV Events (`3av.events`). Vista «Todas» con sumas; nunca mezclar posiciones entre dominios.
- **Usuario:** una sola persona (propietario). El CEO recibirá informes por correo (E5); no tendrá acceso al panel.
- **Catálogo:** `keywords-31.json`, 31 keywords (16 de 3AV, 15 de ASTI). Punto de partida, no límite funcional.
- **Estado de producto:** la aplicación muestra el panel con datos de `keyword_tracking`. **No hay seguimiento automático de posiciones activo.** El cron del seguimiento está desactivado por diseño.

---

## 2. Matriz de realidad

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Protección de credenciales en el código (SerpAPI hardcodeada) | **Fusionado** (retirada en el código). La clave sigue en el **historial de Git**; revocación **no verificada** | PR #2; commits [`72cbae5`](https://github.com/astislasti-dotcom/seo-tracker-clone/commit/72cbae5), [`791be9f`](https://github.com/astislasti-dotcom/seo-tracker-clone/commit/791be9f) |
| Ruta cron con `CRON_SECRET`, desactivada por `TRACKING_ENABLED` | **Fusionado**, probado offline | PR #5 y #7; `app/api/cron/track-keywords/route.js` |
| Motor SERP (clasificación, runner) | **Fusionado**, no conectado a persistencia | PR #7; `lib/serp-tracking/*` |
| Integridad de catálogo y mediciones verificadas | **Fusionado** | PR #13 (`5bcc1d8`) |
| Paginación completa con conteo exacto y orden total | **Fusionado** | PR #13 (`0698693`) |
| Rediseño visual del dashboard, marca por fecha y móvil | **Fusionado** | PR #14 (`21279f9`) |
| Migración RLS de `keyword_tracking` (PR #9) | **Fusionado en el repositorio; NO aplicada** en Supabase | PR #9; `supabase/migrations/20261030083000_*` |
| E1: `/` redirige a `/dashboard` | **En PR #16** | `app/page.jsx` |
| E1: `/api/keywords` retirado (410) | **En PR #16** | `app/api/keywords/route.js` |
| E1: lectura owner-only en servidor (`/api/keyword-tracking`) | **En PR #16**, probado offline; **no verificado con sesión real** | `app/api/keyword-tracking/route.js`, `lib/auth/*` |
| E1: login de enlace único (`/login`) | **En PR #16**; requiere configurar Supabase Auth | `app/login/page.jsx` |
| E1: revocación del SELECT público de `keyword_tracking` | **Propuesto** en `supabase/pending/`; **probado en PostgreSQL 16 desechable**; **no aplicado** | `supabase/pending/20261030_revoke_keyword_tracking_public_read.sql` |
| Vercel Authentication sobre producción y previews | **Bloqueado** (no activada; cron bajo protección sin verificar) | Issue #15 |
| E2 Google Search Console | **Propuesto** (plan v3). Sin conexión, sin credenciales, sin tablas nuevas | Issue #15 |
| E3 KPIs, gráfico y comparativas | **Propuesto** | Issue #15 |
| E4 consultas, páginas y oportunidades | **Propuesto** | Issue #15 |
| E5 informes Brevo (semanal jueves; mensual día 5) | **Propuesto**; sin cuenta verificada | Issue #15 |
| Backlinks F1 (CSV GSC/Bing), F2 (DataForSEO Sandbox), F3 (API real) | **Propuesto**; F3 bloqueada | Issue #15 (comentario de propuesta) |
| GA4 y SERP real | **Fuera de fase** | Issue #15 |
| GEO/AEO | **Fuera de fase** (módulo futuro) | `CLAUDE.md` §9 |
| Seguimiento SERP semanal con SerpAPI | **Bloqueado**: desactivado y sin persistencia verificada | Issue #6, #8 |

---

## 3. Stack y mapa de código

**Stack:** Next.js 16.4.3 (App Router, `cacheComponents: true`), React 19.3, Supabase JS 2, Vercel (cron). Dependencias `googleapis`, `google-auth-library`, `playwright`, `serpapi`, `axios` y `jsonwebtoken`: solo las importan scripts y ficheros legacy, no las rutas activas.

**Rutas (`app/`):**
- `page.jsx` → redirección a `/dashboard` (E1).
- `dashboard/page.jsx` → panel. Lee el catálogo de `public/keywords.json` y las mediciones de `/api/keyword-tracking` (E1).
- `login/page.jsx` → acceso del propietario (E1).
- `api/keyword-tracking/route.js` → lectura owner-only (E1).
- `api/keywords/route.js` → 410, retirada (E1).
- `api/cron/track-keywords/route.js` → cron protegido, desactivado.

**Componentes heredados sin uso desde E1:** `app/components/Dashboard.jsx`, `KeywordTable.jsx`, `StatsCards.jsx` y `app/components/globals.css`. Candidatos a retirada en un PR aparte.

**Librerías (`lib/`):**
- `keywords/contract.mjs`, `measurements.mjs`, `paginate.mjs`, `labels.mjs`, `history-range.mjs`: lógica pura del panel.
- `auth/owner.mjs`, `auth/supabase-verify.mjs`: gate de propietario único.
- `serp-tracking/classify.mjs`, `runner.mjs`: motor SERP, sin conexión a servicios.

**Scripts (`scripts/`), todos legacy y no ejecutados por la aplicación:**
- `track-keywords-serpapi.mjs`, `track-keywords-gsc.mjs`, `track-keywords-improved.mjs`, `track-keywords.mjs`. Escriben en `keyword_tracking` con la clave anon y deben retirarse. `track-keywords-gsc.mjs` toma la posición de una sola fila y la redondea: **no es Search Console válido**.
- `app/api/cron/track-keywords.js` y `api-cron-track-keywords.js`: no son rutas de Next (no son `route.js`), pero usan la clave anon para escribir. Retirar.

**Comandos:**
- `npm test`: 102/102 (offline).
- `npx eslint <archivos cambiados>`: correcto en E1. El lint global tiene errores anteriores (ver `.github/workflows`).
- `npx next build --webpack`: correcto. Turbopack falla en este sandbox por el mock de fuentes de Google. En local hacen falta variables públicas **de prueba**, porque el prerender de `/dashboard` las exige.

**Configuración:** `vercel.json` con cron `0 6 * * 1` (`/api/cron/track-keywords`). Protegido con `CRON_SECRET` (Bearer).

**CI:** el único workflow es `.github/workflows/pr-quality.yml` (ESLint en archivos cambiados y sintaxis de scripts, PR #3). No hay workflow de despliegue.

---

## 4. Arquitectura: actual y objetivo

**Actual (en `main`):**
- Navegador → Supabase REST con clave anon → `keyword_tracking` y `keywords`. **Lectura pública vigente** (política `keyword_tracking_lectura_temporal` del PR #9 aplicada según la auditoría; ver §5).
- `keywords.json` estático para el catálogo.
- Sin autenticación en la aplicación. Sin protección en Vercel verificada.

**Objetivo tras E1 (en PR #16, pendiente de activación):**
- Navegador → sesión de Supabase Auth del propietario → `GET /api/keyword-tracking` → servidor valida token y correo del propietario → Supabase con clave de servicio (solo servidor).
- Acceso anónimo directo a la tabla: denegado tras aplicar el SQL pendiente.
- Vercel Authentication como capa perimetral adicional (no sustituye la validación de servidor).

**Objetivo E2–E5 (propuesto):**
- Search Console API (solo lectura, cuenta de servicio) → sincronización manual de servidor → tablas nuevas con RLS (escritura solo de servidor) → lecturas de servidor → dashboard.
- Informes Brevo desde datos almacenados, nunca métricas inventadas.

---

## 5. Modelo de datos y seguridad verificados

**Tablas:**
- `keywords`: 31 filas esperadas en el catálogo (no re-verificado en esta sesión).
- `keyword_tracking`: **256 filas legacy** con `position = 0` (auditoría del 30/10/2026; no re-verificado). Sin `keyword_key`, `state` ni `measured_at`. El panel las trata como «sin medición verificada».

**Estado de seguridad (auditoría de solo lectura del 30/10/2026, [`docs/SEGURIDAD_SUPABASE_KEYWORD_TRACKING.md`](SEGURIDAD_SUPABASE_KEYWORD_TRACKING.md)):**
- `keyword_tracking`: RLS desactivado antes de la migración del PR #9; `anon` con privilegios de escritura. **Riesgo alto de integridad y de confidencialidad.**
- `service_role`: `BYPASSRLS = true` y `INSERT` (confirmado el 30/10/2026).
- Tras la migración del PR #9: RLS activo, escrituras cliente revocadas, **lectura pública temporal** (`keyword_tracking_lectura_temporal`, `USING (true)`). Aplicación en producción **no confirmada**; la auditoría describe el estado previo.
- `public.rls_auto_enable()`: función SECURITY DEFINER ejecutable por roles cliente. Asunto separado, sin tratar.

**SQL pendiente** (`supabase/pending/20261030_revoke_keyword_tracking_public_read.sql`): retira la política temporal y revoca `SELECT` a `anon`/`authenticated`. Probado en PostgreSQL 16 desechable con datos ficticios: escrituras denegadas a clientes, lectura denegada a clientes, `service_role` con acceso, 256 filas conservadas, segunda ejecución detenida en el preflight. **No aplicado. Requiere autorización expresa y, antes, verificar el acceso del propietario y la ruta protegida.**

**Restricciones sobre migraciones:** no reejecutar la migración del PR #9 (su preflight la rechaza si ya se aplicó); no copiarla sin revisión (ver issue #15).

---

## 6. Calidad histórica y riesgos

| Riesgo | Estado | Acción |
|---|---|---|
| Clave SerpAPI publicada en el historial de Git | **Activo**: la clave aparece en commits antiguos; revocación **no verificada** | El propietario debe revocarla en SerpAPI. No reproducir el valor en ningún documento |
| Lectura pública de `keyword_tracking` | **Activo** hasta aplicar el SQL pendiente | Secuencia de E1 (ver §9) |
| Escrituras con clave anon en scripts y ficheros legacy | Riesgo (no ejecutados) | Retirar en PR separado |
| 256 filas legacy con `position = 0` | Histórico sin valor de posición | No mostrar como posiciones; no migrar sin revisión |
| IDs del catálogo (JSON 1–31 frente a BD) | Conocido; el panel usa la clave lógica | Verificar antes de E2 |
| Posición media de GSC confundida con posición SERP | Riesgo de producto | Etiquetar siempre la fuente; no mezclar métodos |
| Cron bajo Vercel Authentication | **No verificado** | Prueba controlada autorizada antes de proteger producción |
| Dashboard con latencia de ~8 s ante fallo de red | Abierto, causa no identificada | Investigar en E2 |
| Dependencia de la cuenta de servicio de GSC | Pendiente de creación | Responsable y rotación definidos antes de conectar |

---

## 7. Roadmap E1–E5 (plan v3, issue #15)

| Entrega | Contenido | Horas (estimadas) | Estado | Criterio de aceptación |
|---|---|---|---|---|
| **E1** Acceso y unificación | Vercel Authentication (todos los entornos); guarda de servidor; cierre de `/api/keywords`; portada redirigida; lectura owner-only; revocación de lectura pública | 8 | **En PR #16; no cerrada** | Anónimo sin acceso a datos; propietario con acceso; SQL aplicado tras verificación; cron verificado |
| **E2** Conexión GSC y sincronización | Cliente de solo lectura con paginación, reintentos y cuotas; tablas nuevas (SQL aparte); sincronización manual; días finalizados y recarga de recientes; backfill por bloques | 26 | Propuesto; bloqueado por E1 y autorizaciones | Ensayo de migración en PostgreSQL; dos sincronizaciones no duplican; ninguna clave en logs |
| **E3** Dashboard de rendimiento | Totales del sitio por periodo (7/28/90 días) y marca; gráfico diario real; comparativa; «Todas» con CTR ponderado | 18 | Propuesto | Totales contrastados con la consulta sin dimensiones; «—» si la comparación no es homogénea |
| **E4** Consultas, páginas y oportunidades | Tablas paginadas, búsqueda, filtros, deltas; reglas de oportunidad a–d con umbrales | 18 | Propuesto | Paginación verificada; cada oportunidad muestra fuente, periodo y criterio |
| **E5** Informes Brevo | Semanal (jueves, propietario) y mensual (día 5, CEO); generación idempotente; reintentos; pie con marca, periodo, fuente y fecha | 21 | Propuesto; cuenta Brevo no verificada | Ningún dato inventado; envío de prueba interno antes de programar |

**Total estimado:** 91 h (no significa gasto). Estimaciones no verificadas.

**Fuera de fase:**
- **Backlinks:** F1 (CSV GSC/Bing, sin coste, ~22 h), F2 (DataForSEO Sandbox con datos ficticios, ~34 h, solo si se confirma sin cargo), F3 (API real, bloqueada por presupuesto y autorización). La API de Search Console no expone enlaces. Cuenta DataForSEO en modalidad gratuita con **saldo 0; no se recarga**.
- **GA4 y SERP real:** proyectos separados, con autorización propia.
- **GEO/AEO:** módulo futuro independiente.

---

## 8. Costes y accesos

| Concepto | Estado | Cifra |
|---|---|---|
| Vercel Pro | Precio verificado en documentación; plan actual **no verificado** | 20 $/mes por asiento de desarrollador; visualizadores gratis |
| Vercel Password Protection | **No contratar** (recomendación) | 20 $/mes por proyecto |
| Supabase | Reportado como Free en el issue #15; **no re-verificado** desde esta sesión | Por confirmar |
| Brevo | Plan gratuito verificado en documentación; cuenta **no verificada** | 300 correos/día |
| Search Console API | Gratuita (verificado en documentación oficial) | 0 € |
| DataForSEO | Cuenta gratuita, saldo 0; **sin recarga** | 0 € hasta autorización |
| Mantenimiento estimado | Estimación | ~2 h/mes |

**Accesos pendientes del propietario:** planes reales de Vercel y Supabase, número de asientos, correos autorizados (propietario y CEO), dominio remitente de Brevo y DNS, identificadores de propiedades GSC (`sc-domain:` o prefijo de URL), cuenta de servicio de GSC.

---

## 9. Checklist de activación (orden obligatorio)

**E1 — cierre:**
1. Revisión y fusión de PR #16 **con autorización expresa**.
2. Supabase Auth: desactivar registro público; crear la cuenta del propietario. *(Acción del propietario.)*
3. Vercel, variables de **servidor**: `DASHBOARD_OWNER_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`. Nunca `NEXT_PUBLIC_`. *(Acción del propietario.)*
4. Desplegar y comprobar en preview con datos ficticios: 401 sin token, 403 con otro usuario, carga con sesión del propietario.
5. Prueba controlada del cron con protección activa, autorizada por el propietario. Decidir según el resultado.
6. Activar Vercel Authentication para el único miembro autorizado. *(Acción del propietario.)*
7. Aplicar `supabase/pending/20261030_revoke_keyword_tracking_public_read.sql` **solo después de 3 y 6**, con autorización expresa.
8. Comprobar desde REST con la clave pública que la lectura directa queda denegada, y que el dashboard sigue funcionando.
9. Retirar los scripts y ficheros legacy con escrituras anon (PR aparte).
10. Revocar la clave SerpAPI expuesta (propietario) y verificar en el proveedor.

**E2 — antes de iniciar:** E1 cerrada; autorización expresa para empezar; cuenta de servicio y propiedades confirmadas; SQL de tablas nuevas aprobado por separado.

**Cualquier activación real** (GSC, Brevo, SerpAPI, DataForSEO, cron, Vercel Pro): autorización expresa y registro en el issue #15.

---

## 10. Handoff compacto

- **Cierto hoy:** `main` en `21279f9`; 102 tests pasan; PR #16 en borrador con E1 implementada y probada offline y en PostgreSQL desechable.
- **No cierto todavía:** E1 cerrada (faltan activaciones y verificaciones de producción); lectura pública de `keyword_tracking` vigente; Vercel Authentication no activada; SQL de revocación no aplicado.
- **Bloqueado:** activar cualquier servicio real; conectar GSC; cron bajo protección; DataForSEO.
- **Siguiente paso:** cerrar E1 en PR #16 (revisión de ChatGPT y decisiones del propietario); después E2 offline.
- **Primer archivo a leer en la próxima sesión:** este documento, después `CLAUDE.md`, `AGENTS.md`, `docs/PROTOCOLO_COLABORACION.md` y el issue #15.
