# SEO Tracker — Automatización gradual de la colaboración

**Estado:** propuesta incluida en PR de configuración; no equivale a activación de agentes externos ni a autorización para fusionar código.  
**Repositorio:** [astislasti-dotcom/seo-tracker-clone](https://github.com/astislasti-dotcom/seo-tracker-clone)  
**Responsable de aprobaciones:** usuario titular del proyecto.

## Objetivo

Evitar que el usuario tenga que trasladar mensajes entre Claude y ChatGPT. GitHub aloja las tareas, los cambios y el resultado de las revisiones. Los agentes no comparten una sesión ni pueden despertarse automáticamente sin una integración de eventos específica.

Se adopta **implantación gradual** para no introducir consumo de API, tareas duplicadas, escrituras no autorizadas o bucles de revisión.

## Estado real verificado al preparar este PR

- `main` contiene `CLAUDE.md`, `AGENTS.md` y [el protocolo vigente](PROTOCOLO_COLABORACION.md).
- El PR #2 de credenciales está en otra rama (`claude/security-credentials`). Esta configuración **no lo modifica**.
- Antes de esta propuesta no existían workflows en `.github/workflows/`.
- Vercel ya comunica despliegues Preview en los PR; **eso no equivale a probar los scripts ni a revisar el código**.
- No se ha podido verificar desde la conexión el ajuste de protección de `main` (lectura de branch protection sin permisos suficientes). **No afirmar que esté activado**.
- Hay una credencial SerpAPI histórica comprometida; su revocación en el proveedor sigue siendo una tarea independiente. No reproducirla en documentación ni logs.

## Fase 1 — GitHub nativo y gratuito (única fase incluida en este PR)

### 1A. Plantilla de PR

`.github/pull_request_template.md` pide responsable, objetivo, alcance, pruebas reales, riesgos, enlace de tarea y autorización pendiente. Sirve para que Claude o ChatGPT entreguen la información sin reenviarla por chat.

### 1B. Comprobaciones técnicas de solo lectura

`.github/workflows/pr-quality.yml` escucha cambios de los pull requests destinados a `main`. Usa **únicamente** un runner estándar `ubuntu-latest`, `GITHUB_TOKEN` con `contents: read`, sin secretos ni claves de proveedores y sin permisos para escribir en el repositorio.

Ejecuta:
1. `npm ci --no-audit --no-fund`.
2. `npx eslint` **únicamente sobre los archivos JS/TS modificados por el PR**, para no bloquear cambios ajenos por deuda anterior.
3. `node --check` de los dos scripts `.mjs` de tracking.

Tiene límite de 12 minutos y cancela comprobaciones anteriores del mismo PR cuando llegan nuevos commits. Utiliza versiones oficiales recientes de las acciones y desactiva la caché compartida de npm. **No ejecuta `npm run build`**, consultas a SerpAPI/GSC, accesos a Supabase ni migraciones. El build queda a cargo de Vercel Preview y debe comprobarse aparte.

GitHub declara gratuito el uso de runners estándar en **repositorios públicos**. Si se hace privado el repositorio, se cambia a runners grandes o se ajustan las reglas de facturación, **revisar los costes antes de continuar**. Esta configuración no llama a ninguna API de IA de pago.

**Límite importante:** un CI verde solo significa que se pasaron estas comprobaciones; no demuestra ausencia de bugs, seguridad completa ni funcionamiento de Vercel. La comprobación limitada a archivos modificados **no sustituye al lint completo**. En la primera ejecución de este PR el lint completo reveló **7 errores y 5 avisos preexistentes** en componentes/páginas/scripts que este PR no cambia. Se debe abrir una tarea de saneamiento independiente; no se ha modificado el código de la aplicación.

### 1C. Activación y prueba

1. El responsable inspecciona el PR de configuración, confirma que solo hay los tres archivos previstos y **autoriza la fusión**.
2. Después de fusionarlo, comprobar en [GitHub Actions](https://github.com/astislasti-dotcom/seo-tracker-clone/actions) que aparece `PR - calidad basica`; se ejecutará al abrir/actualizar PR destinados a `main`.
3. Probar en un PR posterior y verificar los resultados. Si el lint falla por problemas **previos** del repositorio, documentar el fallo y corregir el baseline en otro PR; no falsear las comprobaciones para mostrar verde.
4. Corregir en una tarea independiente los errores ESLint existentes, y entonces proponer volver a un lint global obligatorio para todos los PR. Revisar [las reglas de ramas en GitHub](https://github.com/astislasti-dotcom/seo-tracker-clone/settings/branches) y activar restricciones de fusión y comprobaciones obligatorias **solo tras** validar que el CI funciona. La protección de ramas es un ajuste de GitHub separado; este PR no la activa.

**No confundir crear el PR de configuración con activar el workflow.** GitHub puede ejecutar workflows añadidos en el propio PR, según su política de Actions; los cambios no quedarán en `main` hasta la fusión.

## Fase 2 — Revisión de IA (requiere autorización aparte)

**No incluida en este PR y no activada.**

1. Comprobar en la configuración de Codex Code Review si la cuenta y el repositorio tienen acceso, qué límites/consumo se aplican y si el servicio requiere créditos o gasto adicional.
2. Con aprobación expresa, empezar solicitando una **única** revisión manual en un PR de prueba (si está disponible, usando `@codex review`).
3. Verificar que el revisor coloca sus observaciones en el mismo PR y no realiza commits, fusiones ni publica credenciales.
4. Solo entonces valorar las revisiones automáticas al abrir y actualizar PR. Evitar revisión continua de cada commit si genera mucho consumo o ruido.
5. Mantener al usuario como aprobador final, sin permitir auto-merge.

**Importante:** esta revisión automatizada, si se habilita, la realizará **Codex**. No se despertará por sí sola la sesión actual de ChatGPT. Los comentarios manuales desde el conector de GitHub tampoco despiertan automáticamente a Claude.

Documentación oficial: [Custom Code Review rules for Codex](https://developers.openai.com/blog/custom-code-review-rules-for-codex) y [Code Review en ChatGPT](https://help.openai.com/en/articles/20001552-review-pull-requests-with-codex).

## Fase 3 — Claude responde a revisiones (requiere autorización aparte)

**No incluida en este PR y no activada.**

Se evaluará la integración oficial [Claude Code Action](https://github.com/anthropics/claude-code-action). Antes de incorporarla deberán verificarse:
- Autenticación, permisos de GitHub y **coste real** de Anthropic/servicio contratado.
- Qué evento la activa. Preferir activación manual controlada o un evento explícito con autorización; no escuchar todos los comentarios sin filtro.
- Restricción al PR existente y a su rama original, nunca `main`.
- Límite de iteraciones para evitar un bucle entre revisor y autor.
- No entregar secretos ni permisos de escritura si no son imprescindibles.
- No habilitar auto-merge, reescritura de historial, migraciones ni despliegues de producción.
- Revisar la protección de `main` y reglas de aprobación humana.

Una vez activada la integración y **solo entonces**, Claude podrá recibir eventos de GitHub y responder a observaciones sin que el usuario copie mensajes. Hasta ese momento, los comentarios son visibles en GitHub pero no provocan por sí solos una nueva ejecución del agente.

## Reparto y autorización

| Actor | Puede hacer en fase 1 | No puede hacer sin autorización expresa |
| --- | --- | --- |
| Usuario | Autorizar tareas y fusiones | N/A |
| Claude | Desarrollar **solo encargos aprobados**, abrir PR y leer comentarios | Iniciar otra tarea, auto-merge, activar acciones de IA |
| ChatGPT | Analizar y revisar PR; preparar cambios si se solicitan | Ejecutar Claude, auto-merge, publicar producción |
| GitHub Actions | Lint y sintaxis en PR, solo lectura | Modificar archivos, crear PR, ejecutar servicios externos de tracking |
| Codex / Claude Action | **No activados** | Cualquier revisión automática de IA o auto-corrección |

**Nota de permisos:** si dos asistentes utilizan la misma identidad de GitHub, GitHub puede impedir que uno apruebe el PR creado por esa misma identidad. Los comentarios de agentes no sustituyen la **aprobación humana**.

## Reversión

Si el workflow genera fallos o comportamientos inesperados, no modificar el CI ni sus permisos silenciosamente. Documentar el incidente y, con aprobación del usuario, corregir o revertir `.github/workflows/pr-quality.yml`. Los agentes siguen en modo lectura predeterminado fuera de encargos explícitos.

## Enlaces de referencia

- [Pull requests](https://github.com/astislasti-dotcom/seo-tracker-clone/pulls)
- [GitHub Actions](https://github.com/astislasti-dotcom/seo-tracker-clone/actions)
- [Reglas de rama](https://github.com/astislasti-dotcom/seo-tracker-clone/settings/branches)
- [GitHub Actions: facturación](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Protocolo de colaboración](PROTOCOLO_COLABORACION.md)
