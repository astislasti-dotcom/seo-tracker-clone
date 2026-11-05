# AUTOMATION-02 · Buzón de avisos push (diseño y plan de validación)

**Estado:** PR de implementación en borrador; no se ha fusionado, activado ni configurado tarea ChatGPT Work.

## Qué se está preparando

- PR-buzón permanente: [#30](https://github.com/astislasti-dotcom/seo-tracker-clone/pull/30). Debe quedar ABIERTA y no fusionarse. Work deberá vigilar **solo los comentarios nuevos de esta PR**.
- Workflow adicional `.github/workflows/handoff-push-inbox.yml`, solo evento `issue_comment: created`. Ignora otros issues, la PR-buzón, comentarios de bots y autores diferentes de `astislasti-dotcom` antes de asignar runner. No llama a IA.
- El script `scripts/automation/relay-to-inbox.mjs` aplica filtros completos (marcador exacto en línea independiente, roles y allowlist, PR abierta, SHA actual si se incluye), consulta los comentarios previos del buzón y escribe **un único comentario por PR + estado + commit**.
- No procesa comentarios de revisión por línea: el evento `pull_request_review_comment` no está configurado. Para pedir cambios hay que publicar el marcador en la conversación general de la PR.
- El comentario de salida incluye número, título, estado, URL del comentario original y hash del commit. No contiene credenciales.
- Sin `schedule`, sin polling, sin API de Claude/OpenAI, sin auto-merge, sin cambios en Supabase o Vercel.

## Regla de publicación

Un comentario de una PR normal es candidato solo si contiene exactamente una de estas líneas fuera de un bloque de código:

```text
<!-- handoff: ready-for-review -->
<!-- handoff: changes-requested -->
```

También se puede adjuntar `sha=<7-40 hex>` al marcador, que se compara con el HEAD de la PR. En producción recomendamos **siempre incluir SHA** para evitar avisos desfasados por una carrera entre comentario y nuevo commit.

Se mantiene la lista autorizada existente en `config/automation-authorized-accounts.json`. Un evento no autorizado no crea avisos. Si ya existe en el buzón la misma combinación de número de PR, estado y SHA, no se publica de nuevo. Un fallo al leer el historial impide publicar (fail closed).

## Limitaciones reales pendientes

1. **Work:** confirmar en la interfaz que puede filtrar por PR #30 y por comentarios. La documentación general menciona el filtro por PR, pero la configuración concreta del usuario es la que manda.
2. **Autor del aviso:** los comentarios del workflow serán de `github-actions[bot]`, no de `astislasti-dotcom`. La tarea Work deberá **INCLUIR bots** cuando vigile la PR #30, aunque el workflow **EXCLUYA bots** como origen de las entregas.
3. **Eventos externos:** GitHub documenta que las acciones realizadas con `GITHUB_TOKEN` no disparan normalmente *otros workflows de Actions*. Esto **no demuestra** que el conector de Work vaya a recibir el evento del comentario de bot. Es necesario comprobarlo con una prueba real. No se debe prometer notificación hasta observar el evento.
4. **No es mensajería instantánea entre agentes:** la tarea Work, si se activa, consumiría una ejecución de ChatGPT por aviso válido, pero no ejecutaría Claude ni modificaría las PR.
5. **Coste:** los workflows de GitHub usan un runner estándar del repositorio público (sin IA); Work consumiría cuota únicamente por los comentarios que lleguen al buzón, siempre que el filtro por PR opere antes de la ejecución.
6. **Futuro merge:** Vercel tiene una regla `Ignored Build Step` con una lista de archivos permitidos de AUTOMATION-01. **Esta nueva PR contiene nuevas rutas y por defecto provocaría build de Production si se fusiona**, aunque no cambia la aplicación. Antes de un eventual merge, revisar esa regla con autorización independiente o aceptar el build. No cambiar Vercel en esta preparación.

## Prueba controlada (solo tras autorizaciones separadas)

1. Revisar código y CI de esta PR. Mantener #30 abierta, sin merge.
2. Autorizar expresamente fusionar el workflow a `main` tras resolver la política de Vercel.
3. Configurar en Work una tarea de comentarios **solo de PR #30**, incluyendo bot; solicitud de permiso antes de activarla. Sin filtros de texto adicionales en Work.
4. Publicar en una PR de prueba un comentario válido de `astislasti-dotcom`, preferiblemente con SHA explícito. Verificar el run del workflow y **un solo comentario nuevo en PR #30**.
5. Comprobar que Work recibe el evento y que llega la push móvil. Repetir mismo estado/SHA: comprobar que no aparece segundo comentario ni segunda ejecución de Work.
6. Publicar un comentario sin marcador: confirmar que no se ejecuta job de relay. Si Work no recibe la notificación del bot, detener la tarea y no prometer la vía propuesta.

## Desactivación

Deshabilitar `handoff-push-inbox.yml` en Actions o revertir el workflow. Pausar la tarea Work. El buzón #30 y sus comentarios permanecen como registro; ninguna PR se fusiona automáticamente.
