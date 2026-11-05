import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  findHandoffMarker, selectHandoff, notificationKey, notificationBody, relay, githubClient,
} from '../scripts/automation/relay-to-inbox.mjs';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const REPO = 'astislasti-dotcom/seo-tracker-clone';
const INBOX = 30;
const ALLOW = ['astislasti-dotcom'];
const makeEvent = (body, extra = {}) => ({
  action: 'created',
  issue: { number: 26, pull_request: {} },
  comment: { id: 123, user: { login: 'astislasti-dotcom' }, author_association: 'OWNER', body },
  ...extra,
});
const ready = '<!-- handoff: ready-for-review -->';
const changes = '<!-- handoff: changes-requested -->';
const makeApi = (comments = []) => {
  const calls = [];
  return {
    calls,
    async pull(number) {
      calls.push(['pull', number]);
      return { state: 'open', title: 'GSC 03', head: { sha: SHA } };
    },
    async comments(number, page) {
      calls.push(['comments', number, page]);
      return comments;
    },
    async postComment(number, body) {
      calls.push(['post', number, body]);
      return { id: 456 };
    },
  };
};
const run = (event, api, overrides = {}) => relay({
  eventName: 'issue_comment', event, api, repo: REPO, mailboxPr: INBOX,
  authorizedLogins: ALLOW, ...overrides,
});

test('exact ready and changes markers accepted independently', () => {
  assert.deepEqual(findHandoffMarker('Entrega\n' + ready), { state: 'ready-for-review', markedSha: null });
  assert.deepEqual(findHandoffMarker(changes), { state: 'changes-requested', markedSha: null });
});
test('marker with commit SHA accepted', () => {
  assert.deepEqual(findHandoffMarker('<!-- handoff: ready-for-review sha=' + SHA + ' -->'), {
    state: 'ready-for-review', markedSha: SHA,
  });
});
test('inline marker and quoted marker are ignored', () => {
  assert.equal(findHandoffMarker('Usa ' + ready + ' en la entrega'), null);
  assert.equal(findHandoffMarker('> ' + ready), null);
});
test('marker inside code fence is ignored', () => {
  assert.equal(findHandoffMarker('Ejemplo:\n' + String.fromCharCode(96).repeat(3) + '\n' + ready +
    '\n' + String.fromCharCode(96).repeat(3)), null);
});
test('ambiguous or repeated markers are ignored', () => {
  assert.equal(findHandoffMarker(ready + '\n' + changes), null);
  assert.equal(findHandoffMarker(ready + '\n' + ready), null);
});
test('valid general PR comment passes filter', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready), INBOX, ALLOW)?.number, 26);
});
test('comments in normal issues are ignored', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, { issue: { number: 23 } }), INBOX, ALLOW), null);
});
test('comments on inbox PR are ignored, preventing loops', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, {
    issue: { number: INBOX, pull_request: {} },
  }), INBOX, ALLOW), null);
});
test('other event types and edits ignored', () => {
  assert.equal(selectHandoff('pull_request_review_comment', makeEvent(ready), INBOX, ALLOW), null);
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, { action: 'edited' }), INBOX, ALLOW), null);
});
test('bots and non-allowlisted commenters ignored', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, {
    comment: { id: 123, body: ready, user: { login: 'github-actions[bot]' }, author_association: 'COLLABORATOR' },
  }), INBOX, ALLOW), null);
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, {
    comment: { id: 123, body: ready, user: { login: 'unknown' }, author_association: 'OWNER' },
  }), INBOX, ALLOW), null);
});
test('non-privileged role ignored even if login matches', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, {
    comment: { id: 123, body: ready, user: { login: 'astislasti-dotcom' }, author_association: 'NONE' },
  }), INBOX, ALLOW), null);
});
test('missing comment id and missing allowlist are rejected', () => {
  assert.equal(selectHandoff('issue_comment', makeEvent(ready, {
    comment: { body: ready, user: { login: 'astislasti-dotcom' }, author_association: 'OWNER' },
  }), INBOX, ALLOW), null);
  assert.equal(selectHandoff('issue_comment', makeEvent(ready), INBOX, []), null);
});
test('dedupe key is stable per PR, state and full SHA', () => {
  const k = notificationKey({ number: 26, state: 'ready-for-review', sha: SHA });
  assert.match(k, /automation-inbox:v1 pr=26 state=ready-for-review/);
  assert.notEqual(k, notificationKey({ number: 26, state: 'changes-requested', sha: SHA }));
  assert.notEqual(k, notificationKey({ number: 27, state: 'ready-for-review', sha: SHA }));
});
test('valid new handoff creates one inbox comment and includes original link', async () => {
  const api = makeApi();
  const result = await run(makeEvent(ready), api);
  assert.equal(result.status, 'posted');
  const p = api.calls.find(x => x[0] === 'post');
  assert.equal(p[1], INBOX);
  assert.match(p[2], /pull\/26#issuecomment-123/);
  assert.match(p[2], /PR #26/);
});
test('duplicate state and commit does not publish', async () => {
  const key = notificationKey({ number: 26, state: 'ready-for-review', sha: SHA });
  const api = makeApi([{ body: key }]);
  assert.equal((await run(makeEvent(ready), api)).status, 'duplicate');
  assert.ok(!api.calls.some(x => x[0] === 'post'));
});
test('different state on same SHA still publishes', async () => {
  const key = notificationKey({ number: 26, state: 'ready-for-review', sha: SHA });
  const api = makeApi([{ body: key }]);
  assert.equal((await run(makeEvent(changes), api)).status, 'posted');
});
test('stale SHA is ignored without notification', async () => {
  const api = makeApi();
  const result = await run(makeEvent('<!-- handoff: ready-for-review sha=abcdef0 -->'), api);
  assert.equal(result.status, 'ignored');
  assert.ok(!api.calls.some(x => x[0] === 'post'));
});
test('closed PR does not notify', async () => {
  const api = makeApi();
  api.pull = async () => ({ state: 'closed', title: 'Closed', head: { sha: SHA } });
  assert.equal((await run(makeEvent(ready), api)).status, 'ignored');
});
test('unrelated event does no API calls', async () => {
  const api = makeApi();
  const result = await run(makeEvent('Hello'), api);
  assert.equal(result.status, 'ignored');
  assert.equal(api.calls.length, 0);
});
test('API failure propagates and does not post', async () => {
  const api = makeApi();
  api.comments = async () => { throw new Error('github_get_403'); };
  await assert.rejects(run(makeEvent(ready), api), /github_get_403/);
  assert.ok(!api.calls.some(x => x[0] === 'post'));
});
test('formatting strips line breaks from PR titles', () => {
  const body = notificationBody({ repo: REPO, number: 26, title: 'Headline\nInjected',
    sha: SHA, state: 'ready-for-review', commentId: 123 });
  assert.match(body, /Headline Injected/);
  assert.doesNotMatch(body, /Headline\nInjected/);
});
test('GitHub client uses only bounded endpoints for read and comment', async () => {
  const urls = [];
  const api = githubClient({ repo: REPO, token: 'fixture', fetchImpl: async (url, options) => {
    urls.push([url, options.method]);
    return { ok: true, json: async () => [] };
  } });
  await api.pull(26);
  await api.comments(30, 1);
  await api.postComment(30, 'test');
  assert.deepEqual(urls.map(x => x[1]), ['GET','GET','POST']);
  assert.match(urls[2][0], /\/issues\/30\/comments$/);
});
test('workflow is issue_comment only, no cron, no model, no secret or PR code checkout', async () => {
  const content = await readFile(new URL('../.github/workflows/handoff-push-inbox.yml', import.meta.url), 'utf8');
  assert.match(content, /issue_comment:/);
  assert.doesNotMatch(content, /pull_request_target|schedule:|pull_request_review_comment:|secrets\.|anthropic|claude-code-action/i);
  assert.match(content, /persist-credentials: false/);
  assert.match(content, /default_branch/);
  assert.match(content, /HANDOFF_INBOX_PR: "30"/);
  assert.match(content, /github\.event\.comment\.user\.login == 'astislasti-dotcom'/);
});
