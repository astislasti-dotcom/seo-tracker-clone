// AUTOMATION-01 · pruebas offline de la Capa 1. Payloads sintéticos, fetch simulado, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LABELS, isAuthorized, decideFromIssueComment, decideFromReview, decideFromSynchronize, decideForEvent } from '../lib/automation/handoff-states.mjs';
import { applyDecision, githubApi, loadAllowedLogins } from '../scripts/automation/apply-handoff-states.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const ALLOWED = ['astislasti-dotcom'];
const ready = (extra = '') => `Listo para revisar.\n<!-- handoff: ready-for-review${extra} -->`;
const changes = (extra = '') => `Revisad esto.\n<!-- handoff: changes-requested${extra} -->`;
const comment = (body, overrides = {}) => ({
  body,
  authorAssociation: 'OWNER',
  login: 'astislasti-dotcom',
  allowedLogins: ALLOWED,
  isPullRequest: true,
  headSha: SHA,
  action: 'created',
  ...overrides,
});
const review = (overrides = {}) => ({
  state: 'changes_requested',
  authorAssociation: 'OWNER',
  login: 'astislasti-dotcom',
  allowedLogins: ALLOWED,
  action: 'submitted',
  ...overrides,
});

// ---------- autorización: rol Y login ----------

test('isAuthorized requires an authorized role AND a login in the explicit list', () => {
  assert.equal(isAuthorized({ association: 'OWNER', login: 'astislasti-dotcom', allowedLogins: ALLOWED }), true);
  assert.equal(isAuthorized({ association: 'OWNER', login: 'ASTISLASTI-dotcom ', allowedLogins: ALLOWED }), true, 'case and spaces');
});

test('MEMBER and COLLABORATOR are NOT authorized unless their login is in the list', () => {
  assert.equal(isAuthorized({ association: 'MEMBER', login: 'otro-miembro', allowedLogins: ALLOWED }), false);
  assert.equal(isAuthorized({ association: 'COLLABORATOR', login: 'colaborador', allowedLogins: ALLOWED }), false);
  assert.equal(decideFromIssueComment(comment(ready(), { authorAssociation: 'MEMBER', login: 'otro-miembro' })).action, 'ignore');
  assert.equal(decideFromIssueComment(comment(ready(), { authorAssociation: 'COLLABORATOR', login: 'colaborador' })).action, 'ignore');
});

test('an OWNER role with a login outside the list is not authorized', () => {
  assert.equal(isAuthorized({ association: 'OWNER', login: 'otra-cuenta', allowedLogins: ALLOWED }), false);
});

test('an empty or missing allowlist fails closed for everyone', () => {
  assert.equal(isAuthorized({ association: 'OWNER', login: 'astislasti-dotcom', allowedLogins: [] }), false);
  assert.equal(isAuthorized({ association: 'OWNER', login: 'astislasti-dotcom', allowedLogins: undefined }), false);
  assert.equal(decideFromIssueComment(comment(ready(), { allowedLogins: [] })).action, 'ignore');
  assert.equal(decideFromReview(review({ allowedLogins: [] })).action, 'ignore');
});

test('a missing login never matches, even if the allowlist contains empty strings', () => {
  assert.equal(isAuthorized({ association: 'OWNER', login: undefined, allowedLogins: ['', ALLOWED[0]] }), false);
  assert.equal(isAuthorized({ association: 'OWNER', login: '', allowedLogins: [''] }), false);
});

// ---------- comentarios de entrega ----------

test('ready marker on a PR sets listo-revision and removes cambios-solicitados', () => {
  const d = decideFromIssueComment(comment(ready()));
  assert.equal(d.action, 'set');
  assert.deepEqual(d.add, [LABELS.READY]);
  assert.deepEqual(d.remove, [LABELS.CHANGES]);
});

test('changes marker sets cambios-solicitados and removes listo-revision', () => {
  const d = decideFromIssueComment(comment(changes()));
  assert.deepEqual(d.add, [LABELS.CHANGES]);
  assert.deepEqual(d.remove, [LABELS.READY]);
});

test('a marker with the current sha is accepted, short or long', () => {
  assert.equal(decideFromIssueComment(comment(ready(' sha=0123456'))).action, 'set');
  assert.equal(decideFromIssueComment(comment(ready(` sha=${SHA}`))).action, 'set');
});

test('a marker with an older sha is ignored (stale delivery)', () => {
  const d = decideFromIssueComment(comment(ready(' sha=aaaaaaa')));
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /commit anterior/);
});

test('comments on plain issues are ignored', () => {
  assert.equal(decideFromIssueComment(comment(ready(), { isPullRequest: false })).action, 'ignore');
});

test('comments from accounts without an authorized role are ignored', () => {
  for (const association of ['CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'MANNEQUIN']) {
    assert.equal(decideFromIssueComment(comment(ready(), { authorAssociation: association })).action, 'ignore', association);
  }
});

test('edited or deleted comments do not change state', () => {
  assert.equal(decideFromIssueComment(comment(ready(), { action: 'edited' })).action, 'ignore');
  assert.equal(decideFromIssueComment(comment(ready(), { action: 'deleted' })).action, 'ignore');
});

test('contradictory markers in one comment are ignored', () => {
  const d = decideFromIssueComment(comment(`${ready()}\n${changes()}`));
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /contradictorios/);
});

test('a marker must be a standalone line; text that merely quotes it is not a handoff', () => {
  assert.equal(decideFromIssueComment(comment('Usa `<!-- handoff: ready-for-review -->` en tu entrega.')).action, 'ignore');
});

test('comments without a marker are ignored', () => {
  assert.equal(decideFromIssueComment(comment('Buen trabajo.')).action, 'ignore');
});

// ---------- revisiones formales ----------

test('changes_requested review from an allowlisted account sets cambios-solicitados', () => {
  const d = decideFromReview(review());
  assert.deepEqual(d.add, [LABELS.CHANGES]);
  assert.deepEqual(d.remove, [LABELS.READY]);
});

test('changes_requested review from a MEMBER or COLLABORATOR outside the list is ignored', () => {
  assert.equal(decideFromReview(review({ authorAssociation: 'MEMBER', login: 'otro-miembro' })).action, 'ignore');
  assert.equal(decideFromReview(review({ authorAssociation: 'COLLABORATOR', login: 'colaborador' })).action, 'ignore');
});

test('approved and commented reviews never change state', () => {
  assert.equal(decideFromReview(review({ state: 'approved' })).action, 'ignore');
  assert.equal(decideFromReview(review({ state: 'commented' })).action, 'ignore');
});

test('reviews with edited action or no authorized role are ignored', () => {
  assert.equal(decideFromReview(review({ action: 'edited' })).action, 'ignore');
  assert.equal(decideFromReview(review({ authorAssociation: 'NONE' })).action, 'ignore');
});

// ---------- nuevo commit ----------

test('synchronize clears both state labels so an old state cannot describe a new commit', () => {
  const d = decideFromSynchronize({ action: 'synchronize' });
  assert.equal(d.action, 'clear');
  assert.deepEqual(d.add, []);
  assert.deepEqual(d.remove.sort(), [LABELS.CHANGES, LABELS.READY].sort());
});

test('other pull_request actions do nothing', () => {
  assert.equal(decideFromSynchronize({ action: 'opened' }).action, 'ignore');
  assert.equal(decideFromSynchronize({ action: 'closed' }).action, 'ignore');
});

// ---------- invariantes ----------

test('the automation never sets estado:aprobado and never merges', () => {
  const outputs = [
    decideFromIssueComment(comment(ready())),
    decideFromIssueComment(comment(changes())),
    decideFromReview(review({ state: 'approved' })),
    decideFromReview(review()),
    decideFromSynchronize({ action: 'synchronize' }),
  ];
  for (const d of outputs) {
    assert.ok(![...d.add, ...d.remove].includes('estado:aprobado'));
    assert.ok(!JSON.stringify(d).match(/merge/i));
  }
});

test('state changes are mutually exclusive: an add is never also a remove', () => {
  for (const d of [decideFromIssueComment(comment(ready())), decideFromIssueComment(comment(changes()))]) {
    for (const label of d.add) assert.ok(!d.remove.includes(label));
  }
});

// ---------- dispatch por evento ----------

test('decideForEvent dispatches by event name, requires the allowlist, and ignores unknown events', () => {
  const issueEvent = {
    action: 'created',
    comment: { body: ready(), author_association: 'OWNER', user: { login: 'astislasti-dotcom' } },
    issue: { pull_request: {} },
    pull_request: { head: { sha: SHA } },
  };
  assert.equal(decideForEvent('issue_comment', issueEvent, { allowedLogins: ALLOWED }).action, 'set');
  assert.equal(decideForEvent('issue_comment', issueEvent).action, 'ignore', 'no allowlist → fail closed');
  const reviewEvent = { action: 'submitted', review: { state: 'changes_requested', author_association: 'OWNER', user: { login: 'astislasti-dotcom' } } };
  assert.equal(decideForEvent('pull_request_review', reviewEvent, { allowedLogins: ALLOWED }).action, 'set');
  assert.equal(decideForEvent('pull_request', { action: 'synchronize' }).action, 'clear');
  assert.equal(decideForEvent('push', {}), null);
});

// ---------- lista de cuentas (archivo de configuración) ----------

test('the allowlist file lists only the owner login and is well-formed', async () => {
  const logins = await loadAllowedLogins();
  assert.deepEqual(logins, ['astislasti-dotcom']);
});

test('loadAllowedLogins fails closed on a malformed list', async () => {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'allow-'));
  const bad = join(dir, 'bad.json');
  await writeFile(bad, JSON.stringify({ logins: ['ok', ''] }));
  await assert.rejects(loadAllowedLogins(bad), /lista de cuentas no válida/);
  await writeFile(bad, JSON.stringify({ logins: 'astislasti-dotcom' }));
  await assert.rejects(loadAllowedLogins(bad), /lista de cuentas no válida/);
});

// ---------- cliente de GitHub y aplicación (fetch simulado) ----------

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    const next = responses.shift() ?? { status: 200, body: {} };
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('applyDecision: removes the opposite label, ensures the new one, then adds it', async () => {
  const fetchImpl = fakeFetch([{ status: 200 }, { status: 201 }, { status: 200 }]);
  const api = githubApi({ repo: 'o/r', token: 'fixture', fetchImpl });
  const result = await applyDecision(decideFromIssueComment(comment(ready())), 28, api);
  assert.equal(result.applied, true);
  assert.deepEqual(fetchImpl.calls.map((c) => c.method), ['DELETE', 'POST', 'POST']);
  assert.match(fetchImpl.calls[0].url, /\/issues\/28\/labels\/estado%3Acambios-solicitados$/);
  assert.deepEqual(fetchImpl.calls[2].body, { labels: [LABELS.READY] });
});

test('applyDecision is idempotent: a 404 removal and a 422 existing label are tolerated', async () => {
  const fetchImpl = fakeFetch([{ status: 404 }, { status: 422 }, { status: 200 }]);
  const api = githubApi({ repo: 'o/r', token: 'fixture', fetchImpl });
  const result = await applyDecision(decideFromIssueComment(comment(ready())), 28, api);
  assert.equal(result.applied, true);
});

test('applyDecision: an unauthorized or ignored decision makes no API calls', async () => {
  const fetchImpl = fakeFetch([]);
  const api = githubApi({ repo: 'o/r', token: 'fixture', fetchImpl });
  const denied = decideFromIssueComment(comment(ready(), { authorAssociation: 'MEMBER', login: 'otro-miembro' }));
  const result = await applyDecision(denied, 28, api);
  assert.equal(result.applied, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test('githubApi: unexpected API failures surface as codes, without response bodies', async () => {
  const fetchImpl = fakeFetch([{ status: 403, body: { message: 'secret detail' } }]);
  const api = githubApi({ repo: 'o/r', token: 'fixture', fetchImpl });
  await assert.rejects(api.addLabels(28, [LABELS.READY]), (err) => {
    assert.equal(err.message, 'label_add_403');
    assert.ok(!err.message.includes('secret'));
    return true;
  });
});

// ---------- comprobaciones estáticas del workflow y del script ----------

test('the workflow has no privileged triggers, no schedule, no AI and no extra secrets', async () => {
  const workflow = await readFile(new URL('../.github/workflows/handoff-states.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /anthropic|openai|claude-code-action|api_key/i);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /if: \$\{\{ github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request != null \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test('the script logs decisions only, never the payload or headers', async () => {
  const script = await readFile(new URL('../scripts/automation/apply-handoff-states.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /console\.log\(payload|console\.error\(payload|headers\)/);
  assert.doesNotMatch(script, /console\.\w+\([^)]*authorization/i);
});
