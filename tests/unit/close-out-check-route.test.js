// Route tests for the P3 close-out check + press record (LIN-3248, P3 of LIN-2949).
//
//   POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check
//   POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press
//
// Mounts the REAL router with an injected provider + PR reader + markDone seam
// and a real CloseOutEventsStore on MangoDB, so this exercises the actual
// handler: the person-session-only rule, R1's four Done bounds, the multi-PR
// partial merge, idempotency and the retried Done write.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const CHECK_PATH = '/workspace/:urlKey/api/run-evidence/:issueIdentifier/check';
const PRESS_PATH = '/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press';
const PR_A = 'https://github.com/acme/widget/pull/41';
const PR_B = 'https://github.com/acme/widget/pull/42';

before(() => { process.env.NODE_ENV = 'test'; });

const harness = createMangoTmpdir('lin-3248-close-out-route-');
before(() => harness.connect());
after(() => harness.close());

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeProvider({ repo = 'acme/widget', comments = [] } = {}) {
  return {
    async fetchIssueComments() { return comments; },
    async fetchProjects() {
      return { projects: [{ id: 'p1', name: 'P', content: `repo=${repo}` }], issues: [] };
    },
  };
}

function openStatus(number, sha = 'aaaaaaa', over = {}) {
  return { readable: true, repo: 'acme/widget', number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [], ...over };
}
function mergedStatus(number, sha = 'aaaaaaa') {
  return { readable: true, repo: 'acme/widget', number, state: 'closed', merged: true, head: { ref: 'f', sha }, ref: sha, checks: [] };
}
function unknownStatus(number) {
  return { readable: false, repo: 'acme/widget', number, state: 'unknown', reason: 'stub' };
}

const reviewBody = (verdict = 'Approve') => `## Review\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: ${verdict}**`;
const comment = (body, createdAt) => ({ body, createdAt, user: 'reviewer' });

function makeRouter({
  repo = 'acme/widget',
  comments = [],
  statuses = {},
  readPrStatus = null,
  isStopAtRun = null,
  runnerReady = () => true,
  markDone = null,
} = {}) {
  const collection = harness.freshDb().collection('close-out-events');
  const store = new CloseOutEventsStore({ collection });
  const calls = { markDone: 0, statuses: [] };
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    closeOutEventsStore: store,
    closeOut: {
      resolveProvider: () => ({ provider: fakeProvider({ repo, comments }), callScope: 'scope' }),
      readPrStatus: readPrStatus || (async ({ number }) => statuses[number] || unknownStatus(number)),
      isStopAtRun: isStopAtRun || (async () => 'pr'),
      runnerReady,
      markDone: async (args) => { calls.markDone += 1; if (markDone) return markDone(args); },
    },
  });
  return { router, collection, calls };
}

function baseReq(over = {}) {
  return {
    session: { accountId: 'acct-1', workspaces: ['ws'] },
    workspace: { urlKey: 'ws', id: 'ws', accessToken: 't' },
    params: { urlKey: 'ws', issueIdentifier: 'LIN-1' },
    query: {},
    body: {},
    ...over,
  };
}

async function callRoute(router, path, method, req) {
  const handler = getHandler(router, method, path);
  const res = {
    statusCode: 200, jsonBody: null, ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    end() { this.ended = true; return this; },
  };
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

const check = (built, req = baseReq()) => callRoute(built.router, CHECK_PATH, 'post', req);
const press = (built, req = baseReq({ body: { prUrl: PR_A, headSha: 'abc1234', dispatchId: 'd-9' } })) => callRoute(built.router, PRESS_PATH, 'post', req);

const rows = async (collection) => collection.find({}).toArray();

describe('POST /api/run-evidence/:issueIdentifier/check', () => {
  test('auth required: no signed-in account → 401, nothing recorded', async () => {
    const built = makeRouter({ comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')], statuses: { 41: mergedStatus(41) } });
    const res = await check(built, baseReq({ session: {} }));
    assert.equal(res.statusCode, 401);
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('person-session-only rule: a proxy/worker token is refused and never sets Done', async () => {
    const built = makeRouter({ comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')], statuses: { 41: mergedStatus(41) } });
    const res = await check(built, baseReq({ proxyTokenId: 'pt-1', proxyUrlKey: 'ws' }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.jsonBody.code, 'PERSON_SESSION_REQUIRED');
    assert.equal((await rows(built.collection)).length, 0);
    assert.equal(built.calls.markDone, 0);
  });

  test('issue scoping: a PR for a repo the workspace does not name is dropped (no-pr, nothing recorded)', async () => {
    const built = makeRouter({ repo: 'acme/other', comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')] });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'no-pr');
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('fails open on an unreadable PR state: unknown, no record, no Done', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      readPrStatus: async () => { throw new Error('rate limited'); },
    });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'unknown');
    assert.equal(res.jsonBody.done, false);
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('a non-stop-at-PR run is never ready: no record, no Done', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: openStatus(41) },
      isStopAtRun: async () => null,
    });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'not-ready');
    assert.equal(res.jsonBody.state.reason, 'not-stop-at-run');
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('R1 all hold: merged + Approve + no other PR + person session → records and sets Done', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'merged');
    assert.equal(res.jsonBody.done, true);
    assert.equal(built.calls.markDone, 1);
    const stored = await rows(built.collection);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].by, 'person');
    assert.equal(stored[0].prUrl, PR_A);
    assert.equal(stored[0].merged, true);
    assert.deepEqual(stored[0].openItems, { inside: 1, outside: 0, unknown: 0, total: 1 });
  });

  test('R1 bound: the PR is not merged → no Done, nothing recorded', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: openStatus(41) },
    });
    const res = await check(built);
    assert.equal(res.jsonBody.done, false);
    assert.equal(built.calls.markDone, 0);
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('R1 bound: the latest review verdict is not Approve → records the merge, withholds Done', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody('Request Changes'), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    const res = await check(built);
    assert.equal(res.jsonBody.done, false);
    assert.equal(built.calls.markDone, 0);
    assert.equal((await rows(built.collection)).length, 1);
  });

  test('multi-PR partial merge: records the merged PR, leaves the task open, returns the partial copy', async () => {
    const built = makeRouter({
      comments: [comment(`${PR_A} and ${PR_B}`, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41), 42: openStatus(42) },
    });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'partial');
    assert.match(res.jsonBody.state.message, /PR #41 merged · 1 more PR open/);
    assert.equal(res.jsonBody.done, false);
    assert.equal(built.calls.markDone, 0);
    const stored = await rows(built.collection);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].prUrl, PR_A);
  });

  test('R1 bound: another PR in the run evidence is still unmerged → withholds Done', async () => {
    const built = makeRouter({
      comments: [comment(`${PR_A} and ${PR_B}`, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41), 42: openStatus(42) },
    });
    const res = await check(built);
    assert.equal(res.jsonBody.done, false);
    assert.equal(built.calls.markDone, 0);
  });

  test('idempotency: a repeated check writes no second event', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    await check(built);
    await check(built);
    assert.equal((await rows(built.collection)).length, 1);
  });

  test('a failed Done write never blocks the record and is retried on the next check', async () => {
    let fail = true;
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
      markDone: async () => { if (fail) { const e = new Error('provider down'); throw e; } },
    });
    const first = await check(built);
    assert.equal(first.jsonBody.done, false);
    assert.match(first.jsonBody.doneError, /provider down/);
    assert.equal((await rows(built.collection)).length, 1);

    fail = false;
    const second = await check(built);
    assert.equal(second.jsonBody.done, true);
    assert.equal((await rows(built.collection)).length, 1); // still idempotent
    assert.equal(built.calls.markDone, 2);
  });
});

describe('POST /api/run-evidence/:issueIdentifier/close-out-press', () => {
  test('records a press with its dispatchId', async () => {
    const built = makeRouter();
    const res = await press(built);
    assert.equal(res.statusCode, 201);
    const stored = await rows(built.collection);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].by, 'press');
    assert.equal(stored[0].dispatchId, 'd-9');
    assert.equal(stored[0].prUrl, PR_A);
    assert.equal(stored[0].headSha, 'abc1234');
    assert.equal(stored[0].merged, false);
  });

  test('rejects a press with no dispatchId', async () => {
    const built = makeRouter();
    const res = await press(built, baseReq({ body: { prUrl: PR_A, headSha: 'abc1234' } }));
    assert.equal(res.statusCode, 400);
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('person-session-only rule: a proxy/worker token cannot record a press', async () => {
    const built = makeRouter();
    const res = await press(built, baseReq({ proxyTokenId: 'pt-1', body: { prUrl: PR_A, headSha: 'abc1234', dispatchId: 'd-9' } }));
    assert.equal(res.statusCode, 403);
    assert.equal((await rows(built.collection)).length, 0);
  });
});
