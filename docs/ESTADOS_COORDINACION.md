# Estados de coordinación en PR (Capa 1, sin IA)

**Estado:** PR #28 en revisión; workflow todavía no activado. Solo se activará tras una fusión en `main` expresamente autorizada por el propietario.

## Qué hace

Un workflow de GitHub Actions (`.github/workflows/handoff-states.yml`) mantiene dos etiquetas de estado en cada PR. No llama a ningún modelo, no usa secretos distintos de `GITHUB_TOKEN`, no fusiona ni despliega.

| Etiqueta | Cuándo se pone |
|---|---|
| `estado:listo-revision` | Una cuenta incluida en la lista de autorización, con rol válido en el repositorio, publica el marcador de entrega en un comentario de la PR. |
| `estado:cambios-solicitados` | Una cuenta incluida en la lista de autorización, con rol válido, envía una revisión «Cambios solicitados» o publica el marcador de cambios. |

Las dos son mutuamente excluyentes. `estado:aprobado` **no** lo pone la automatización: solo lo decide una persona y no equivale a permiso de merge.

## Marcadores

Deben ir solos en una línea del comentario:

```
<!-- handoff: ready-for-review -->
<!-- handoff: changes-requested -->
```

Opcionalmente, con el commit de la entrega para evitar entregas antiguas:

```
<!-- handoff: ready-for-review sha=0123abc -->
```

Si el `sha` no corresponde al commit actual de la PR, el comentario se ignora. Un marcador citado dentro de una frase no cuenta. Ojo: si el marcador ocupa una línea entera dentro de un bloque de código, sí se detecta, así que evita pegarlo así en comentarios que no sean entregas.

## Reglas

- **Dos condiciones obligatorias:** el autor debe tener asociación `OWNER`, `MEMBER` o `COLLABORATOR` **y**, además, su nombre de usuario de GitHub debe estar en `config/automation-authorized-accounts.json`. Actualmente solo está autorizada la cuenta `astislasti-dotcom`. Tener uno de esos roles no basta por sí solo.
- Si falta la lista de cuentas autorizadas o el usuario no está en ella, se ignora el evento y no se cambian etiquetas.
- Al subir un nuevo commit a la PR (`synchronize`) se quitan ambas etiquetas: un estado anterior no describe la versión nueva.
- Un comentario editado o borrado no cambia el estado.
- Los comentarios en issues normales se descartan antes de asignar runner, para no consumir minutos.

## Limitaciones

- La misma cuenta de GitHub publica PR, comentarios y revisiones. La automatización verifica tanto el rol como el login autorizado, pero **no puede saber si esa cuenta la está utilizando Claude, ChatGPT o el propietario**.
- Un comentario de un agente no despierta a otro agente. Los avisos externos y cualquier ejecución de Claude quedan fuera de esta capa.
- Un PR desde un fork puede no tener permiso para cambiar etiquetas; en ese caso el job falla sin efectos.

## Desactivar

Eliminar `.github/workflows/handoff-states.yml` o desactivarlo desde la pestaña Actions. Las etiquetas existentes se pueden borrar a mano.
