// AUTOMATION-02: relay de avisos a PR-buzon; no usa modelos ni secretos ajenos a GitHub.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ACCOUNTS_PATH = new URL('../../config/automation-authorized-accounts.json', import.meta.url);
const STATES = Object.freeze({
  'ready-for-review': 'Lista para revision',
  'changes-requested': 'Cambios solicitados',
});

// Marcadores exactos en linea independiente, fuera de bloques de codigo Markdown.
export function findHandoffMarker(body) {
  if (typeof body !== 'string') return null;
  let fenceChar = null;
  const matches = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    const char = trimmed[0];
    const startsFence = (char === '~' || char === String.fromCharCode(96))
      && trimmed.startsWith(char.repeat(3));
    if (startsFence) {
      if (fenceChar === null) fenceChar = char;
      else if (fenceChar === char) fenceChar = null;
      continue;
    }
    if (fenceChar !== null) continue;
    const found = /^<!-- handoff: (ready-for-review|changes-requested)(?: sha=([a-f0-9]{7,40}))? -->$/.exec(line);
    if (found) matches.push({ state: found[1], markedSha: found[2] || null });
  }
  return matches.length === 1 ? matches[0] : null;
}

export function selectHandoff(eventName, event, mailboxPr, authorizedLogins) {
  if (eventName !== 'issue_comment' || event?.action !== 'created') return null;
  const number = event?.issue?.number;
  if (!Number.isSafeInteger(number) || !event?.issue?.pull_request || number === mailboxPr) return null;
  const login = event?.comment?.user?.login;
  const role = event?.comment?.author_association;
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(role)) return null;
  if (typeof login !== 'string' || !Array.isArray(authorizedLogins)
      || !authorizedLogins.some(x => x.toLowerCase() === login.toLowerCase())) return null;
  const marker = findHandoffMarker(event?.comment?.body);
  if (!marker || !Number.isSafeInteger(event?.comment?.id)) return null;
  return { ...marker, number, commentId: event.comment.id };
}

export function notificationKey({ number, state, sha }) {
  if (!Number.isSafeInteger(number) || !Object.hasOwn(STATES, state) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('notification_key_invalid');
  }
  return '<!-- automation-inbox:v1 pr=' + number + ' state=' + state + ' sha=' + sha + ' -->';
}

export function notificationBody({ repo, number, title, state, sha, commentId }) {
  const action = state === 'ready-for-review'
    ? 'Revisar esta PR y decidir si hacen falta cambios.'
    : 'Revisar los cambios solicitados y decidir el siguiente paso.';
  const cleanTitle = String(title).replace(/[\r\n]+/g, ' ').slice(0, 160);
  return [
    notificationKey({ number, state, sha }),
    '### ' + STATES[state] + ': PR #' + number + ' - ' + cleanTitle,
    '',
    '**Accion:** ' + action,
    '**Commit:** ' + sha.slice(0, 12),
    '**Comentario original:** https://github.com/' + repo + '/pull/' + number + '#issuecomment-' + commentId,
    '',
    '_Aviso filtrado por GitHub Actions, sin IA ni modificaciones del codigo._',
  ].join('\n');
}

export function githubClient({ repo, token, fetchImpl = fetch }) {
  const base = 'https://api.github.com/repos/' + repo;
  const headers = {
    authorization: 'Bearer ' + token,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
  async function call(method, path, body) {
    const response = await fetchImpl(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('github_' + method.toLowerCase() + '_' + response.status);
    return response.json();
  }
  return {
    pull(number) { return call('GET', '/pulls/' + number); },
    comments(number, page) { return call('GET', '/issues/' + number + '/comments?per_page=100&page=' + page); },
    postComment(number, body) { return call('POST', '/issues/' + number + '/comments', { body }); },
  };
}

export async function relay({ eventName, event, repo, mailboxPr, authorizedLogins, api }) {
  const signal = selectHandoff(eventName, event, mailboxPr, authorizedLogins);
  if (!signal) return { status: 'ignored' };

  const pr = await api.pull(signal.number);
  if (pr.state !== 'open' || !/^[a-f0-9]{40}$/.test(pr.head?.sha || '')) {
    return { status: 'ignored', reason: 'pull request closed or invalid SHA' };
  }
  const sha = pr.head.sha;
  if (signal.markedSha && !sha.startsWith(signal.markedSha)) {
    return { status: 'ignored', reason: 'marker refers to another commit' };
  }
  const key = notificationKey({ number: signal.number, state: signal.state, sha });

  // Scanea la bandeja entera. Si no se puede, falla sin publicar (fail closed).
  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const comments = await api.comments(mailboxPr, page);
    if (!Array.isArray(comments)) throw new Error('inbox_comments_invalid');
    if (comments.some(c => typeof c.body === 'string' && c.body.includes(key))) {
      return { status: 'duplicate', number: signal.number, state: signal.state };
    }
    if (comments.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('inbox_history_limit');
  const body = notificationBody({ repo, number: signal.number, title: pr.title, state: signal.state,
    sha, commentId: signal.commentId });
  await api.postComment(mailboxPr, body);
  return { status: 'posted', number: signal.number, state: signal.state, sha };
}

export async function main(env = process.env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const mailboxPr = Number(env.HANDOFF_INBOX_PR);
  if (!repo || !token || !env.GITHUB_EVENT_PATH
      || !Number.isSafeInteger(mailboxPr) || mailboxPr <= 0) throw new Error('relay_config_incomplete');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const config = JSON.parse(await readFile(ACCOUNTS_PATH, 'utf8'));
  if (!Array.isArray(config.logins) || !config.logins.every(x => typeof x === 'string')) {
    throw new Error('allowlist_invalid');
  }
  const result = await relay({ eventName: env.GITHUB_EVENT_NAME, event, repo, mailboxPr,
    authorizedLogins: config.logins, api: githubClient({ repo, token, fetchImpl }) });
  console.log('Handoff inbox: ' + result.status + (result.number ? ' PR #' + result.number : ''));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('relay_error: ' + error.message);
    process.exitCode = 1;
  });
}
