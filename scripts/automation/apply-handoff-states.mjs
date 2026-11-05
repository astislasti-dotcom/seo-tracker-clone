// AUTOMATION-01 · Capa 1: aplica en GitHub las decisiones de lib/automation/handoff-states.mjs.
// Se ejecuta desde el workflow con el código de la rama por defecto (nunca de la PR).
// Sin IA, sin secretos distintos de GITHUB_TOKEN, sin escribir código ni contenido.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { LABELS, decideForEvent } from '../../lib/automation/handoff-states.mjs';

const LABEL_SPEC = {
  [LABELS.READY]: { color: '0E8A16', description: 'Entrega lista para revisión (automatización, sin IA)' },
  [LABELS.CHANGES]: { color: 'D93F0B', description: 'Cambios solicitados en revisión (automatización, sin IA)' },
};

// Cliente mínimo de la API REST de GitHub. Solo las llamadas necesarias.
export function githubApi({ repo, token, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response;
  }
  return {
    async getPull(number) {
      const response = await call('GET', `/pulls/${number}`);
      if (!response.ok) throw new Error(`pull_get_${response.status}`);
      return response.json();
    },
    // Crea la etiqueta si no existe. 422 (ya existe) se ignora: la operación es idempotente.
    async ensureLabel(name) {
      const spec = LABEL_SPEC[name];
      const response = await call('POST', '/labels', { name, ...spec });
      if (!response.ok && response.status !== 422) throw new Error(`label_create_${response.status}`);
    },
    async addLabels(number, names) {
      const response = await call('POST', `/issues/${number}/labels`, { labels: names });
      if (!response.ok) throw new Error(`label_add_${response.status}`);
    },
    async removeLabel(number, name) {
      const response = await call('DELETE', `/issues/${number}/labels/${encodeURIComponent(name)}`);
      // 404: la etiqueta ya no estaba. Es el caso normal en operaciones repetidas.
      if (!response.ok && response.status !== 404) throw new Error(`label_remove_${response.status}`);
    },
  };
}

// Aplica una decisión sobre una PR. `api` se inyecta para poder probarla sin red.
export async function applyDecision(decision, number, api) {
  if (decision.action === 'ignore') return { applied: false, reason: decision.reason };

  for (const name of decision.remove) {
    await api.removeLabel(number, name);
  }
  for (const name of decision.add) {
    await api.ensureLabel(name);
  }
  if (decision.add.length > 0) {
    await api.addLabels(number, decision.add);
  }
  return { applied: true, action: decision.action, add: decision.add, remove: decision.remove };
}

export async function main(env = process.env, fetchImpl = fetch) {
  const eventName = env.GITHUB_EVENT_NAME;
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!eventName || !repo || !token || !env.GITHUB_EVENT_PATH) {
    throw new Error('entorno de GitHub incompleto');
  }

  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const api = githubApi({ repo, token, fetchImpl });

  // issue_comment no trae el sha de la PR: se pide a la API para validar marcadores antiguos.
  const number = payload.pull_request?.number ?? payload.issue?.number ?? payload.number ?? null;
  if (eventName === 'issue_comment' && payload.issue?.pull_request) {
    payload.pull_request = await api.getPull(payload.issue.number);
  }

  const decision = decideForEvent(eventName, payload);
  if (!decision) {
    console.log(`evento no tratado: ${eventName}`);
    return { applied: false, reason: 'evento no tratado' };
  }
  if (number === null) throw new Error('sin número de PR');
  const result = await applyDecision(decision, number, api);
  console.log(`PR #${number}: ${result.applied ? `${result.action} +[${result.add}] -[${result.remove}]` : `sin cambios (${result.reason})`}`);
  return result;
}

// Solo se ejecuta al lanzar el archivo directamente; importarlo no hace nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Sin volcar el payload ni cabeceras: solo el código de error.
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  });
}
