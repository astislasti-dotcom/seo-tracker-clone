# CLAUDE.md — SEO Tracker

> Guía operativa para Claude Code y cualquier otro asistente que trabaje en este repositorio.
> Proyecto: SEO Tracker · ASTI / 3AV Events
> Propietario de producto: usuario responsable del proyecto. Ningún asistente sustituye su aprobación.
> Estado: guía inicial de colaboración. Las funcionalidades propuestas no deben darse por implementadas.

## 1. Para qué existe este producto

SEO Tracker es una aplicación interna para medir y mejorar el posicionamiento orgánico de dos marcas **independientes**:

- **3AV Events** — https://3av.events — producción audiovisual integral para congresos, convenciones, eventos corporativos y agencias MICE.
- **ASTI** — https://astisl.es — interpretación simultánea, congresos multilingües y tecnología de interpretación.

El objetivo no es construir otro Semrush: es una herramienta clara, útil y fiable para responder:

1. ¿Ganamos o perdemos visibilidad en búsquedas relevantes para cada negocio?
2. ¿Qué consultas, páginas y servicios presentan oportunidades reales?
3. ¿Qué debemos optimizar ahora, con qué prioridad?
4. ¿Qué cambios se hicieron y qué resultados tuvieron?
5. En el futuro, ¿cómo evoluciona nuestra presencia en respuestas de motores de IA (GEO)?

**Principios de producto:** rigor en los datos, facilidad de uso, acciones antes que gráficos decorativos, costes controlados y separación de las dos marcas.

## 2. El acuerdo de colaboración: usuario + Claude + ChatGPT

- **Usuario:** fija objetivos, prioridades y alcance; valida la dirección visual, el coste de servicios externos y la publicación en producción.
- **Claude:** puede investigar el código, proponer arquitectura, implementar funcionalidades, refactorizar, ejecutar pruebas y abrir pull requests (PR).
- **ChatGPT:** puede auditar código, elaborar especificaciones, trabajar UX/UI y SEO-GEO, proponer/implementar cambios y revisar PR.
- **GitHub:** es la **fuente compartida y persistente** de código, requisitos, decisiones, tareas y revisiones.
- **Vercel:** publica la aplicación y, si su configuración lo permite, despliega previews para probar cada PR.
- **Supabase:** almacena los datos; cualquier modificación del esquema debe revisarse y documentarse.

**No existe una memoria compartida automática entre las conversaciones de Claude y ChatGPT.** Nunca supongas que el otro motor ha leído una conversación, una preferencia o un archivo fuera del repositorio. Toda decisión relevante debe quedar escrita en un issue, PR o documento versionado.

Ambos motores pueden programar y revisar: el reparto anterior es una organización práctica, no una limitación de capacidades.

## 3. Procedimiento obligatorio antes de trabajar

1. Leer este archivo **y** \`AGENTS.md\` (incluidas sus instrucciones específicas de Next.js).
2. Comprobar el estado del repositorio, rama, cambios sin confirmar, PR abiertos y tareas asignadas.
3. Leer los archivos de código afectados y las dependencias reales de \`package.json\`. No programar basándose solo en suposiciones.
4. Consultar las decisiones ya aprobadas en issues/PR y la documentación del proyecto, si existe.
5. Delimitar el trabajo: problema, objetivo, archivos afectados, riesgos, criterios de aceptación y pruebas.
6. Si falta acceso, una credencial, una guía de marca o una decisión de producto, **indicarlo**. No inventar información.
7. No iniciar cambios de diseño, base de datos, proveedor de datos o costes recurrentes fuera del alcance aprobado.

**Regla:** documentar lo que existe por separado de lo que se propone. No confundir código escrito con funcionalidad probada en producción.

## 4. Dónde buscar la información

### 4.1 Primero: fuentes internas del proyecto

| Qué necesitas | Dónde mirar |
| --- | --- |
| Dependencias y scripts | \`package.json\`, \`package-lock.json\` |
| Guía de agentes/versión Next | \`AGENTS.md\` y documentación de la versión instalada |
| Dashboard actual con datos | \`app/dashboard/page.jsx\` |
| Portada y componentes alternativos | \`app/page.jsx\`, \`app/components/Dashboard.jsx\`, \`KeywordTable.jsx\`, \`StatsCards.jsx\` |
| Estilos y tipografía | \`app/globals.css\`, \`app/components/globals.css\`, \`app/layout.jsx\` |
| Keywords iniciales y segmentación | \`public/keywords.json\`, \`keywords-31.json\`, \`keywords-31.csv\` |
| API de keywords | \`app/api/keywords/route.js\` |
| Seguimiento y experimentos previos | \`scripts/track-keywords*.mjs\` |
| Cron y rutas de seguimiento | \`vercel.json\`, \`app/api/cron/\` |
| Cambios y contexto histórico | Historial de Git, issues y pull requests de este repositorio |
| Despliegues, errores y variables configuradas | Proyecto correspondiente en Vercel, solo con permiso/acceso autorizado |
| Tablas, políticas y resultados reales | Proyecto correspondiente en Supabase, solo con permiso/acceso autorizado |

El código actual incluye **dos implementaciones de interfaz** (portada y \`/dashboard\`). Antes de refactorizar, identificar cuál debe ser la experiencia definitiva.

La lista inicial contiene **31 keywords: 16 de 3AV y 15 de ASTI**. Esto es el punto de partida del repositorio, no un límite funcional deseado.

### 4.2 Segundo: decisiones de negocio y marca

- Las decisiones expresas y recientes del usuario tienen prioridad.
- Pedir o consultar las **guías SEO-GEO de ASTI y 3AV**, su manual de identidad y la documentación comercial **cuando estén disponibles mediante archivos o enlaces accesibles**. **No están garantizados dentro de este repositorio.**
- Para contenido y servicios, consultar primero las webs oficiales: https://astisl.es y https://3av.events. Verificar cambios recientes antes de reutilizar sus textos.
- Nunca dar por hecho que una guía o conversación de ChatGPT está disponible para Claude (o viceversa). Si falta, indicarlo en el PR/issue.

### 4.3 Tercero: documentación técnica oficial (no tutoriales antiguos)

- Next.js App Router y Route Handlers: https://nextjs.org/docs/app
- Documentación instalada de Next.js: \`node_modules/next/dist/docs/\` (cuando exista localmente; respetar \`AGENTS.md\`).
- Vercel Cron: https://vercel.com/docs/cron-jobs
- Vercel Cron quickstart: https://vercel.com/docs/cron-jobs/quickstart
- Supabase: https://supabase.com/docs
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Google Search Console API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Google Search Central: https://developers.google.com/search/docs
- Google Analytics Data API (si se aprueba integrar GA4): https://developers.google.com/analytics/devguides/reporting/data/v1

Consultar la documentación de la **versión instalada**, no asumir que un ejemplo antiguo sirve para Next.js 16.

**Datos privados:** Search Console, GA4, Supabase y Vercel necesitan accesos propios; disponer de la URL pública o del código no implica disponer de esas cuentas.

## 5. Identidad visual y experiencia de usuario

El producto tendrá una **interfaz de analítica neutra, coherente y legible**, y permitirá elegir el contexto: **Todas / 3AV / ASTI**. La identidad de cada marca se aplicará en sus vistas y elementos de identificación, sin mezclarlas ni convertir sus colores en semáforos de métricas.

- **ASTI:** verde petróleo \`#004E5A\`, turquesa \`#33C4B4\`, gris \`#B4B4B4\`.
- **3AV:** negro carbón editorial \`#171717\`, acento dorado editorial \`#D6AC62\`, terracota puntual \`#A84E35\`. El logotipo oficial conserva sus variantes negro, blanco y pastilla; no inventar ni modificar el logo.
- **Tipografías de referencia:** Montserrat (títulos) y Open Sans (texto), cuando estén disponibles.
- Priorizar navegación clara, filtros consistentes, responsive, tablas útiles, contraste accesible, estados de carga/error/sin datos y fechas verificables.
- Una pantalla debe ayudar a **decidir qué acción tomar**, no acumular tarjetas redundantes.

Los activos y manuales corporativos no figuran actualmente como fuente de verdad validada en este repositorio: solicitar sus originales antes de incorporar logos o dar por oficiales otros colores.

## 6. Rigor SEO, GEO y modelo de datos

- Diferenciar **posición media de Search Console** de una **posición SERP obtenida con proveedor externo**: son métricas distintas, con fuentes, fechas, países y metodologías identificables.
- Nunca presentar un error de consulta, un dato pendiente o un resultado ausente como posición \`0\` equivalente a «no posiciona».
- Guardar la fuente, marca/dominio, keyword, fecha de medición, resultado, estado y, cuando proceda, dispositivo, idioma, país y URL.
- El dashboard debe obtener **la última observación válida por keyword y dominio**, no asumir que las últimas N filas globales representan todas las keywords.
- No afirmar «datos actualizados hoy» si no se ha verificado una ejecución correcta.
- Distinguir keywords prioritarias \`P1/P2/P3\` de posiciones de Google \`1–10\` para evitar ambigüedad.
- En GEO no afirmar «visibilidad universal en IA»: diseñar mediciones repetibles por pregunta, motor, configuración, fecha, evidencia y presencia/citación de marca.
- Antes de atribuir cambios de tráfico a una acción, considerar periodo, fuente y otras explicaciones posibles.

## 7. Seguridad, permisos y estabilidad

**Incidencia urgente identificada en el código:** una credencial de SerpAPI se publicó literalmente en \`scripts/track-keywords-serpapi.mjs\`. Tratarla como **comprometida**. El usuario/administrador debe revocarla y emitir otra en el proveedor; borrar la línea no invalida el secreto ni elimina el historial de Git.

- Nunca imprimir, copiar a un PR, volver a commitear, registrar en logs ni comunicar claves o secretos. En los informes usar **nombres de variables**, no valores.
- Variables de entorno y servicios externos: gestionarlas en Vercel/entorno seguro, diferenciando pública vs. servidor; las claves administrativas jamás al navegador.
- Revisar autenticación y políticas RLS de Supabase, especialmente endpoints de escritura; no asumir que una clave anónima autoriza cualquier operación.
- Cambios de permisos, migraciones, borrados, rotación de claves, cuotas de APIs y acciones de producción necesitan autorización explícita.
- Evitar scrapers de Google frágiles o técnicas que infrinjan condiciones de uso; valorar fiabilidad, costes y alternativas antes de decidir proveedor.
- No provocar ejecuciones masivas de tracking ni costes externos para probar algo sin consentimiento.
- No modificar \`main\` directamente, no forzar pushes ni desplegar a producción sin aprobación.

## 8. Flujo de trabajo entre motores

1. **Issue o encargo:** objetivo, contexto, resultado esperado, límites y criterios de aceptación. Una tarea delimitada por PR.
2. **Ramas independientes:** \`claude/<tema>\` para Claude y \`chatgpt/<tema>\` para ChatGPT; \`docs/<tema>\` para documentación. No trabajar sobre los mismos archivos simultáneamente sin coordinación.
3. **Implementación:** cambios mínimos y trazables; aprovechar lo existente; evitar refactorizaciones masivas no solicitadas.
4. **Pruebas:** ejecutar como mínimo \`npm ci\`, \`npm run lint\` y \`npm run build\` cuando el entorno lo permita. Si una prueba falla o no se pudo ejecutar, documentarlo; no inventar un resultado correcto. Añadir pruebas específicas cuando corresponda.
5. **Pull request a \`main\`:** incluir resumen, motivación, archivos afectados, capturas para cambios visuales, pruebas ejecutadas, riesgos, migraciones y pasos manuales.
6. **Revisión cruzada:** el otro motor revisa código, UX, coherencia SEO y riesgos; deja comentarios concretos en GitHub. La revisión no equivale a aprobación de publicación.
7. **Preview:** comprobar versión desplegada de la rama/PR en Vercel si está configurada. Los cron de Vercel se ejecutan en producción, no en los previews.
8. **Aprobación:** el usuario da el visto bueno antes de integrar a \`main\` o hacer cambios de producción.
9. **Cierre:** actualizar el issue/PR y registrar decisiones o incidencias nuevas. Nada de depender de «lo que dijimos en el chat».

**Propuesta de documentación futura (crear solo cuando haga falta):**
- \`docs/PRODUCT.md\`: objetivos, usuarios y alcance.
- \`docs/UX.md\`: decisiones UX/UI y patrones de componentes.
- \`docs/ROADMAP.md\`: tareas por fases.
- \`docs/DECISIONS.md\`: registro fechado de decisiones aprobadas.
- \`docs/DATA_SOURCES.md\`: procedencia, periodicidad y definiciones de métricas (sin secretos).

## 9. Hoja de ruta orientativa (pendiente de priorización)

**Fase 0 — Seguridad y fiabilidad:** revocación de clave expuesta; revisar cron/ruta de Next.js, credenciales y flujo GSC, permisos Supabase, obtención de la última medición, estados de error y actualización real.

**Fase 1 — UX/UI:** unificar dashboards/componentes, selector de marca, periodo y filtros, tablas con contexto, estados accesibles, responsive y sistema visual consistente.

**Fase 2 — Análisis SEO útil:** histórico, evolución, comparaciones, agrupación por servicios, rendimiento Search Console, alertas y recomendaciones trazables.

**Fase 3 — Trabajo operativo:** calendario y ficha de contenidos, vinculación a URLs, acciones/estados, registro de cambios y medición de resultados; integración GA4 si se aprueba.

**Fase 4 — GEO y automatización:** batería de consultas, monitor de menciones/citas verificables, análisis de competidores e informes recurrentes; evaluar coste, reproducibilidad y utilidad antes de implementar.

Estas fases **no autorizan** cambios por sí mismas. Siempre se trabaja sobre un alcance aprobado.

## 10. Formato esperado al terminar una tarea

Responder de manera concreta:

- **Qué se ha hecho** y qué problema resuelve.
- **Qué archivos** se han modificado.
- **Cómo se ha probado** (comandos y resultados).
- **Qué está pendiente** o no se ha podido verificar.
- **Qué debe revisar o aprobar el usuario**.
- **Enlace al PR / preview**, si existe.

Usar español claro y natural. Evitar afirmaciones de éxito sin comprobación, explicaciones grandilocuentes y cambios cosméticos sin beneficio real.

**Regla final:** primero datos fiables y seguridad; después diseño y nuevas funciones. GitHub conserva el contexto, las decisiones y la revisión. El usuario conserva el control.
