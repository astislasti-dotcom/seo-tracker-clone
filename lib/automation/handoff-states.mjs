// AUTOMATION-01 · Capa 1: decisiones de etiquetas de estado para PR. Lógica pura: sin red,
// sin modelos de IA, sin secretos. El script de E/S (scripts/automation/) solo aplica lo decidido.
//
// Estados mutuamente excluyentes para una PR:
//   estado:listo-revision        ← marcador de entrega del autor
//   estado:cambios-solicitados   ← revisión 'changes_requested' o marcador de cambios
// `estado:aprobado` NO lo pone la automatización: solo lo decide una persona. No equivale a merge.
//
// Autorización (cerrada por defecto): el comentario o la revisión debe cumplir DOS condiciones:
//   1) rol de autor en el repositorio: OWNER, MEMBER o COLLABORATOR;
//   2) login incluido en la lista explícita `allowedLogins` (config/automation-authorized-accounts.json).
// El rol por sí solo no basta: MEMBER o COLLABORATOR no reciben permiso si su login no está en la lista.

export const LABELS = Object.freeze({
  READY: 'estado:listo-revision',
  CHANGES: 'estado:cambios-solicitados',
});
export const ALL_STATE_LABELS = Object.freeze([LABELS.READY, LABELS.CHANGES]);

// Marcadores exactos. Se admite un sha opcional de 7 a 40 hex para trazar la entrega al commit.
const READY_MARKER = /^\s*<!-- handoff: ready-for-review(?: sha=([0-9a-f]{7,40}))? -->\s*$/m;
const CHANGES_MARKER = /^\s*<!-- handoff: changes-requested(?: sha=([0-9a-f]{7,40}))? -->\s*$/m;

export const AUTHORIZED_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);

function normalizeLogin(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Devuelve true solo si se cumplen rol y login. Lista vacía o ausente → nadie está autorizado.
export function isAuthorized({ association, login, allowedLogins }) {
  if (!AUTHORIZED_ASSOCIATIONS.includes(association)) return false;
  if (!Array.isArray(allowedLogins) || allowedLogins.length === 0) return false;
  const candidate = normalizeLogin(login);
  if (candidate === '') return false;
  return allowedLogins.some((allowed) => normalizeLogin(allowed) === candidate);
}

// Traduce a { add, remove } manteniendo la exclusión mutua.
function setState(label) {
  const others = ALL_STATE_LABELS.filter((l) => l !== label);
  return { action: 'set', add: [label], remove: others };
}

function ignore(reason) {
  return { action: 'ignore', add: [], remove: [], reason };
}

// Comentario de issue. Solo actúa si el issue es una PR y el comentario fue creado.
// `headSha`: sha actual de la PR. Si el marcador trae sha distinto, es una entrega antigua.
export function decideFromIssueComment({ body, authorAssociation, login, allowedLogins, isPullRequest, headSha, action }) {
  if (action !== 'created') return ignore('solo comentarios creados');
  if (!isPullRequest) return ignore('no es una PR');
  if (!isAuthorized({ association: authorAssociation, login, allowedLogins })) {
    return ignore('autor no autorizado');
  }
  if (typeof body !== 'string') return ignore('cuerpo ausente');

  const ready = READY_MARKER.exec(body);
  const changes = CHANGES_MARKER.exec(body);
  if (ready && changes) return ignore('marcadores contradictorios');
  const marker = ready ?? changes;
  if (!marker) return ignore('sin marcador de coordinación');

  const markedSha = marker[1] ?? null;
  if (markedSha && headSha && !headSha.startsWith(markedSha) && !markedSha.startsWith(headSha)) {
    return ignore('marcador de un commit anterior');
  }

  return ready ? setState(LABELS.READY) : setState(LABELS.CHANGES);
}

// Revisión formal. Solo 'changes_requested' cambia estado. Aprobar o comentar no lo hace.
export function decideFromReview({ state, authorAssociation, login, allowedLogins, action }) {
  if (action !== 'submitted') return ignore('solo revisiones enviadas');
  if (!isAuthorized({ association: authorAssociation, login, allowedLogins })) {
    return ignore('revisor no autorizado');
  }
  if (state === 'changes_requested') return setState(LABELS.CHANGES);
  return ignore(`revisión ${state ?? 'desconocida'} sin cambio de estado`);
}

// Nuevo commit en la PR: el estado anterior ya no describe la versión actual. Se limpia.
export function decideFromSynchronize({ action }) {
  if (action !== 'synchronize') return ignore('solo sincronizaciones');
  return { action: 'clear', add: [], remove: [...ALL_STATE_LABELS], reason: 'nuevo commit en la PR' };
}

// Entrada única. `options.allowedLogins` es obligatorio: sin él, todo comentario o revisión se ignora.
export function decideForEvent(eventName, payload, options = {}) {
  const allowedLogins = options.allowedLogins ?? [];
  if (eventName === 'issue_comment') {
    return decideFromIssueComment({
      body: payload.comment?.body,
      authorAssociation: payload.comment?.author_association,
      login: payload.comment?.user?.login,
      allowedLogins,
      isPullRequest: payload.issue?.pull_request != null,
      headSha: payload.pull_request?.head?.sha ?? null,
      action: payload.action,
    });
  }
  if (eventName === 'pull_request_review') {
    return decideFromReview({
      state: payload.review?.state,
      authorAssociation: payload.review?.author_association,
      login: payload.review?.user?.login,
      allowedLogins,
      action: payload.action,
    });
  }
  if (eventName === 'pull_request') {
    return decideFromSynchronize({ action: payload.action });
  }
  return null;
}
