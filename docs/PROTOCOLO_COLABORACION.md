# Protocolo de colaboración — SEO Tracker

**Estado:** propuesta operativa pendiente de incorporación a `main` mediante PR #1.  
**Ámbito:** Claude, ChatGPT y cualquier agente que acceda al repositorio `astislasti-dotcom/seo-tracker-clone`.  
**Propietario de las decisiones:** la persona responsable del proyecto; los asistentes no sustituyen su autorización.

> **Regla principal: consultar antes de crear, coordinar antes de modificar y revisar antes de integrar.**

## 0. Modo lectura por defecto: no crear ni subir nada

**La primera acción de cualquier conversación es consultar, nunca escribir.** Cuando el encargo sea leer, verificar, revisar o planificar, están **prohibidas** todas las modificaciones en el repositorio: crear/recrear ramas locales o remotas para este trabajo, editar archivos, hacer commits, ejecutar `git push` o `git push --set-upstream`, abrir PR nuevos, fusionar, revertir o resincronizar cambios anteriores. `git fetch` y las consultas de solo lectura sí están permitidas.

**No existe autorización implícita de escritura por tener acceso al repositorio.** Solo se autoriza implementar cuando el usuario lo ordena expresamente y, tras comprobar ramas/issues/PR, se acuerda quién implementa, qué archivos toca y en qué rama. Si el usuario pide «lee los documentos y confirma», **la única entrega permitida es una respuesta en el chat**. Si los documentos ya existen, no volver a crearlos.

**No reactivar trabajos cancelados:** si el usuario ha ordenado retirar una rama o un commit, no volver a publicar el mismo trabajo aunque siga disponible en el entorno local. Antes de ejecutar un `push` comprobar que se trata de un encargo vigente y aprobado; nunca sincronizar automáticamente una rama antigua. Si la plataforma crea una rama o la publica automáticamente incluso durante una lectura, detener el flujo y usar Claude.ai en modo chat con conector GitHub de lectura o comunicar la limitación antes de continuar.

**Caso real:** el commit `8e04ad5` de `claude/documentation` fue retirado de la rama remota y reapareció después. Esto **no** es una tarea nueva ni está autorizado; debe permanecer retirado. El único PR documental vigente es [PR #1](https://github.com/astislasti-dotcom/seo-tracker-clone/pull/1), a la espera de aprobación del usuario.

## 1. Documentos que hay que leer antes de cada encargo

**Siempre y en este orden:**

1. [`CLAUDE.md`](../CLAUDE.md): propósito del producto, fuentes, arquitectura actual, criterios SEO-GEO, marca, seguridad y hoja de ruta.
2. [`AGENTS.md`](../AGENTS.md): instrucciones específicas de la versión instalada de Next.js. No borrar ni sobrescribir su contenido.
3. **Este protocolo**: quién hace qué, cómo evitar duplicidades y cómo entregar los cambios.
4. El issue/PR del encargo y cualquier decisión vigente relacionada. Para conocer el trabajo **en curso**, los issues y PR de GitHub tienen prioridad sobre resúmenes antiguos de conversaciones.
5. Los archivos de código realmente afectados, el historial de cambios reciente y la documentación oficial del proveedor o librería correspondiente.

**Fuentes de información de negocio:** documentación SEO-GEO aprobada de ASTI y 3AV, manuales y activos corporativos originales y las webs oficiales. Si esas guías no están disponibles en el repositorio o como archivos accesibles, **pedirlas; no fingir haberlas leído**. Consultar el apartado «Dónde buscar la información» de `CLAUDE.md`.

**No existe memoria de chat compartida.** Claude no puede suponer lo que ChatGPT dijo y viceversa. Solo se considera compartido lo que se haya dejado por escrito en el repositorio, en GitHub Issues o en un PR accesible.

## 2. Comprobación obligatoria de trabajo existente — antes de editar nada

Cada motor debe comprobar:

- La rama de referencia `main` y su último commit.
- Las ramas remotas `claude/*`, `chatgpt/*` y `docs/*`.
- Los **PR abiertos y en borrador**, su objetivo, ramas y archivos afectados.
- Los **issues abiertos**, quién está trabajando en ellos y su estado.
- El estado del árbol de trabajo y los cambios sin confirmar, si tiene acceso a un entorno de código.
- Si el documento, funcionalidad o solución solicitada **ya existe** en otra rama o PR.

**Con terminal (si está disponible):**

```bash
git fetch origin --prune
git status --short --branch
git branch -r
gh pr list --repo astislasti-dotcom/seo-tracker-clone --state open
gh issue list --repo astislasti-dotcom/seo-tracker-clone --state open
```

**En Claude.ai conector GitHub o en otro entorno sin terminal:** realizar las comprobaciones equivalentes mediante las herramientas de GitHub y los enlaces del repositorio. No asumir que un comando se ejecutó si no hay consola.

Si existe ya un PR o una rama para la misma tarea:

1. **No crear** otro archivo, rama o PR duplicado.
2. Leer la propuesta existente y determinar si falta algo.
3. Anotar mejoras, preguntas o correcciones **en el PR/issue existente**.
4. Si hay que editar los mismos archivos, acordar el responsable o pedir permiso antes de tocar su rama.
5. Explicar al usuario que el trabajo ya estaba iniciado y enlazarlo.

**Ejemplo real:** la tarea de crear `CLAUDE.md` ya tenía el PR #1 antes de que Claude generase una copia en `claude/documentation`. Esa duplicidad no debe repetirse.

## 3. Asignación, alcance y responsabilidades

- **Usuario:** solicita objetivos, valida prioridades y decide cuándo integrar y publicar.
- **Claude:** normalmente lleva la implementación y pruebas de tareas de desarrollo que se le asignen.
- **ChatGPT:** normalmente lleva análisis de producto, UX/UI, definición funcional, auditoría y revisión cruzada; también puede programar cuando se le encargue.
- **El reparto no es exclusivo.** La persona que recibe el encargo debe comprobar antes que nadie esté ya trabajando en él.

Para cada tarea se debe registrar en un **issue** o, si es una tarea mínima, en el **PR existente**:

- Objetivo y problema que se resuelve.
- Entrega verificable y criterios de aceptación.
- Responsable inicial (Claude o ChatGPT) y revisor.
- Archivos o zonas previstas; dependencias con otras tareas.
- Riesgos, datos/credenciales necesarios y necesidad de aprobación externa.
- Estado: **pendiente / en curso / en revisión / aprobado / cerrado**.

Si el usuario pide **solo una auditoría o propuesta**, no escribir código sin autorización. Si pide desarrollar una función, no empezar una segunda tarea distinta por iniciativa propia.

## 4. Política de ramas y cambios

- `main`: código de referencia y, si Vercel está enlazado, potencial producción. **Nunca escribir directamente en `main` sin una orden expresa.**
- `claude/<issue-o-tema>`: tareas cuya implementación se asigna a Claude.
- `chatgpt/<issue-o-tema>`: tareas cuya implementación se asigna a ChatGPT.
- `docs/<issue-o-tema>`: documentación coordinada.

**Una tarea = una rama de trabajo y un PR**, salvo acuerdo explícito. Crear una nueva rama desde la base vigente solo cuando se haya descartado que ya exista una rama de esa tarea. Si hay cambios ajenos no confirmados, detenerse y coordinar.

No utilizar `git push --force`, no rebobinar ramas de otro agente ni cerrar, eliminar o fusionar su PR sin una instrucción expresa del usuario. Si se solicita eliminar trabajo duplicado, verificar primero archivos, commits y alcance; después actuar solo sobre lo identificado.

## 5. Ciclo exacto de una tarea

1. **Recepción:** leer documentos, issues, PR, ramas y archivos. Mostrar brevemente qué existe y qué falta.
2. **Delimitación:** explicitar objetivo, criterios de aceptación, responsable, rama propuesta y si existen costes o riesgos. Pedir aprobación para decisiones no cubiertas por el encargo.
3. **Registro:** abrir o actualizar el issue y señalar que la tarea está en curso. No duplicar el trabajo de otros.
4. **Implementación:** usar la rama asignada. Hacer cambios acotados; no reestructurar el proyecto por iniciativa propia.
5. **Validación:** ejecutar las pruebas aplicables: `npm ci`, `npm run lint`, `npm run build` y pruebas funcionales de la tarea si el entorno lo permite. Registrar lo que se ejecutó y lo que no; nunca inventar pruebas superadas.
6. **Entrega:** abrir un PR hacia `main` (borrador si faltan comprobaciones) con resumen, archivos cambiados, pruebas, riesgos, pasos manuales y enlace de Preview de Vercel si existe. Un enlace `/pull/new/...` **no es** un PR abierto.
7. **Revisión cruzada:** el otro motor revisa el mismo PR y deja comentarios específicos. El autor hace las correcciones en **la misma rama**. Evitar nuevas ramas para cada comentario.
8. **Aprobación:** el usuario revisa el PR y da conformidad explícita para integrar o publicar.
9. **Integración:** solo después de aprobación, fusionar el PR según la estrategia acordada. Verificar el resultado y el despliegue de Vercel; no confundir PR aprobado con despliegue satisfactorio.
10. **Cierre:** cerrar el issue y registrar decisiones duraderas. Indicar al usuario qué quedó hecho, qué no y qué tarea sería la siguiente; no empezarla automáticamente.

## 6. Traspaso de trabajo entre Claude y ChatGPT

El **único lugar válido para un traspaso permanente es GitHub**. Al terminar una intervención, dejar en el issue o PR:

- **Contexto y objetivo**: qué se pretendía resolver.
- **Estado real**: implementado, pendiente, bloqueado, probado o no probado.
- **Archivos/commits/PR**: enlaces concretos, no solo afirmaciones.
- **Pruebas y evidencias**: comandos, resultado y capturas de Preview cuando sea visual.
- **Riesgos y decisiones abiertas**: especificar quién debe decidir.
- **Siguiente acción concreta**: por ejemplo, «revisión UX por ChatGPT» o «corregir fallo de build por Claude».

El revisor debe leer ese traspaso **y comprobar el código**. No tomar el resumen del otro motor como evidencia suficiente.

### Formato de mensaje al usuario

```text
Tarea:
Estado comprobado:
Rama / PR:
Archivos modificados:
Pruebas realizadas (resultado):
Pendiente / riesgos:
Qué debes aprobar:
Siguiente responsable / acción:
```

## 7. Orden de prioridad ante conflictos

1. Instrucciones y aprobaciones expresas del usuario.
2. Seguridad, integridad de datos y protección de producción.
3. Decisiones ya aprobadas y documentación vigente de GitHub.
4. Código y funcionamiento comprobados.
5. Propuestas todavía no aprobadas o conversaciones anteriores.

Si las fuentes discrepan, **detener la parte afectada**, señalar la contradicción y presentar opciones. No declarar «aprobado» un diseño, librería, gasto recurrente o integración solo por aparecer en una hoja de ruta.

## 8. Restricciones específicas del proyecto

- Mantener separados los datos y posicionamientos comerciales de ASTI y 3AV. No intercambiar logotipos, textos ni colores de una marca por los de la otra.
- Mantener diferencias claras entre las métricas de Google Search Console, las mediciones SERP y el seguimiento GEO.
- No mostrar `0` como «no posiciona» si la API falló o aún no se ha ejecutado.
- No ejecutar consultas pagadas, migraciones, borrados, rotación de secretos o despliegues sin aprobación.
- Una clave de SerpAPI quedó expuesta en código público; está considerada **comprometida** y debe revocarse en SerpAPI por el responsable. Nunca copiar su valor en comentarios ni documentación.
- No exponer secretos de servidor en componentes de cliente ni almacenar credenciales en GitHub.
- La documentación no demuestra que una funcionalidad funcione: comprobar código, datos y Preview/producción según corresponda.

## 9. Qué hacer al abrir una nueva conversación

**Claude debe empezar por consultar GitHub, no por crear código o documentos.**

1. Confirmar que ha podido consultar `CLAUDE.md`, este protocolo y `AGENTS.md`.
2. Comprobar ramas, PR e issues en curso; informar de coincidencias con el nuevo encargo.
3. Identificar en una o dos frases el estado del proyecto relevante para la petición actual.
4. Proponer siguiente acción, responsable y rama/PR a utilizar.
5. Esperar la instrucción del usuario cuando no esté claro el alcance o haya decisiones no aprobadas.

Lo mismo aplica a ChatGPT. Ambos trabajan **con el mismo repositorio, sin asumir que comparten conversación ni contexto invisible**.

---

**Enlaces de referencia:** [Repositorio](https://github.com/astislasti-dotcom/seo-tracker-clone) · [Pull requests](https://github.com/astislasti-dotcom/seo-tracker-clone/pulls) · [Issues](https://github.com/astislasti-dotcom/seo-tracker-clone/issues) · [PR documental inicial](https://github.com/astislasti-dotcom/seo-tracker-clone/pull/1)
