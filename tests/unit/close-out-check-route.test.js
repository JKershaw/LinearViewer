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
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
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

function fakeProvider({ comments = [] } = {}) {
  return {
    async fetchIssueComments() { return comments; },
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
      resolveProvider: () => ({ provider: fakeProvider({ comments }), callScope: 'scope' }),
      readPrStatus: readPrStatus || (async ({ number }) => statuses[number] || unknownStatus(number)),
      isStopAtRun: isStopAtRun || (async () => 'pr'),
      runnerReady,
      markDone: async (args) => { calls.markDone += 1; if (markDone) return markDone(args); },
    },
  });
  return { router, collection, calls };
}

// A router whose `closeOut` seam omits `markDone`, so the route exercises the
// production `defaultMarkDone` against a stubbed provider.
function makeDefaultMarkDoneRouter({ throwOnUpdate = false } = {}) {
  const collection = harness.freshDb().collection('close-out-events');
  const store = new CloseOutEventsStore({ collection });
  const calls = { updateIssue: [] };
  const provider = {
    async fetchIssueComments() { return [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')]; },
    async fetchIssueContext() { return { issue: { id: 'issue-uuid', identifier: 'LIN-1', team: { id: 'team-1' } } }; },
    async issueWriteGuard() { return { team: { id: 'team-1' } }; },
    async states() { return [{ id: 'st-open', name: 'In Progress', type: 'started' }, { id: 'st-done', name: 'Done', type: 'completed' }]; },
    async updateIssue(_scope, id, input) {
      calls.updateIssue.push({ id, input });
      if (throwOnUpdate) throw new Error('provider write failed');
      return { success: true, issue: { id } };
    },
  };
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    closeOutEventsStore: store,
    closeOut: {
      resolveProvider: () => ({ provider, callScope: 'scope' }),
      readPrStatus: async ({ number }) => (number === 41 ? mergedStatus(41) : unknownStatus(number)),
      isStopAtRun: async () => 'pr',
      runnerReady: () => true,
      // deliberately no `markDone`: exercise the production default
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

  test('any repo: a PR URL is accepted now the allowlist is gone (LIN-3333)', async () => {
    const PR_FOREIGN = 'https://github.com/acme/other/pull/12';
    const built = makeRouter({ comments: [comment(PR_FOREIGN, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')], statuses: { 12: openStatus(12) } });
    const res = await check(built);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'ready');
    assert.equal(res.jsonBody.state.pr.repo, 'acme/other');
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

  test('M7: a merged PR on a non-stop-at-PR run records nothing and never sets Done', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
      isStopAtRun: async () => null,
    });
    const res = await check(built);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.deepEqual(res.jsonBody.recorded, []);
    assert.equal(res.jsonBody.done, false);
    assert.equal(built.calls.markDone, 0);
    assert.equal((await rows(built.collection)).length, 0);
  });

  test('ledger 5: the default markDone resolves the completed state and calls updateIssue with its stateId', async () => {
    const built = makeDefaultMarkDoneRouter();
    const res = await check(built);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.done, true);
    assert.equal(built.calls.updateIssue.length, 1);
    assert.equal(built.calls.updateIssue[0].id, 'issue-uuid');
    assert.equal(built.calls.updateIssue[0].input.stateId, 'st-done');
    assert.equal((await rows(built.collection)).length, 1);
  });

  test('ledger 5: a failing provider write does not throw past the recorded event', async () => {
    const built = makeDefaultMarkDoneRouter({ throwOnUpdate: true });
    const res = await check(built);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.done, false);
    assert.match(res.jsonBody.doneError, /provider write failed/);
    assert.equal((await rows(built.collection)).length, 1);
  });

  test('F1: a press recorded for the head makes the merge a close-out merge, not "by you"', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    const pressRes = await press(built, baseReq({ body: { prUrl: PR_A, headSha: 'aaaaaaa', dispatchId: 'd-1' } }));
    assert.equal(pressRes.statusCode, 201, JSON.stringify(pressRes.jsonBody));

    const res = await check(built);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.recorded.length, 1);
    assert.equal(res.jsonBody.recorded[0].by, 'close-out');
    assert.equal(res.jsonBody.state.mergedByYou, false);
    assert.match(res.jsonBody.state.message, /merged by close-out/);
    // R1's Done path is unchanged for this case.
    assert.equal(res.jsonBody.done, true);
    assert.equal(built.calls.markDone, 1);
  });

  test('F2: repeated checks after a merge call markDone exactly once (Done written once per merge)', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    const first = await check(built);
    assert.equal(first.jsonBody.done, true);
    await check(built);
    await check(built);
    assert.equal(built.calls.markDone, 1);
    assert.equal((await rows(built.collection)).length, 1);
  });

  // LIN-3340 B1' (review `a1845467`): `done` stays true on every later call once
  // the merge's event carries `doneAt`, so the client needs `doneNow` to tell
  // "this call wrote Done" from "a Done is already recorded" — otherwise a
  // reopened task (recorded Done, tracker back In Progress) loops reloading.
  test("B1': doneNow is true on the call that writes Done, false on the next call", async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      statuses: { 41: mergedStatus(41) },
    });
    const first = await check(built);
    assert.equal(first.jsonBody.done, true);
    assert.equal(first.jsonBody.doneNow, true, 'the call that wrote Done reports doneNow');
    const second = await check(built);
    assert.equal(second.jsonBody.done, true, 'still reports the recorded Done');
    assert.equal(second.jsonBody.doneNow, false, 'but this call did not write it');
    assert.equal(built.calls.markDone, 1);
  });

  test('F3: a taken (history-only) stop-at-PR run is found without a seam and sets Done', async () => {
    const db = harness.freshDb();
    const queueStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
    });
    const added = await queueStore.addItem('ws', { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt: 'pr' });
    // Take it, so the run row lives ONLY in history (`{items,total}`), the exact
    // shape `history.some(...)` used to throw on.
    await queueStore.takeItem(added._id, 'ws');

    const store = new CloseOutEventsStore({ collection: db.collection('close-out-events') });
    const calls = { markDone: 0 };
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: queueStore,
      closeOutEventsStore: store,
      closeOut: {
        resolveProvider: () => ({ provider: fakeProvider({ comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')] }), callScope: 'scope' }),
        readPrStatus: async ({ number }) => mergedStatus(number),
        runnerReady: () => true,
        markDone: async () => { calls.markDone += 1; },
        // no `isStopAtRun` seam: exercise the real defaultIsStopAtRun.
      },
    });
    const res = await callRoute(router, CHECK_PATH, 'post', baseReq({ workspace: { urlKey: 'ws', id: 'ws', accessToken: 't' } }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.recorded.length, 1);
    assert.equal(res.jsonBody.done, true);
    assert.equal(calls.markDone, 1);
  });

  test('F4: a press at a DIFFERENT head than the merge still marks the merge close-out', async () => {
    const built = makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')],
      // the merge is seen at a NEW head (a push happened after the press)
      statuses: { 41: mergedStatus(41, 'bbbbbbb') },
    });
    const pressRes = await press(built, baseReq({ body: { prUrl: PR_A, headSha: 'aaaaaaa', dispatchId: 'd-1' } }));
    assert.equal(pressRes.statusCode, 201, JSON.stringify(pressRes.jsonBody));

    const res = await check(built);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.recorded.length, 1);
    assert.equal(res.jsonBody.recorded[0].by, 'close-out');
    assert.equal(res.jsonBody.state.mergedByYou, false);
  });

  // LIN-3340 F4 (review `388f4246`): the route-level wiring from
  // `defaultIsStopAtRun` to the shared `readTaskRunFacts` reader had no test of
  // its own. A subtask worked under a parent's stop-at run carries no
  // `stopAt`/`variant` on its own rows — only a `sessionId` naming the parent
  // run row. The check route must reach Done for it, via the same hop the
  // dispatch guard makes.
  test('LIN-3340 F4: a subtask under a stop-at parent run reaches Done through the sessionId hop', async () => {
    const db = harness.freshDb();
    const queueStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
    });
    // The parent autopilot run: stop-at-PR, keyed to its own issue; its row id
    // becomes the worker's `sessionId`.
    const parent = await queueStore.addItem('ws', { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-parent', stopAt: 'pr', variant: 'standard' });
    // The subtask's own worker row carries neither fact, only the sessionId.
    await queueStore.addItem('ws', { prompt: 'build the subtask', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-sub', sessionId: parent._id });

    const store = new CloseOutEventsStore({ collection: db.collection('close-out-events') });
    const calls = { markDone: 0 };
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: queueStore,
      closeOutEventsStore: store,
      closeOut: {
        resolveProvider: () => ({ provider: fakeProvider({ comments: [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody(), '2026-07-02T00:00:00.000Z')] }), callScope: 'scope' }),
        readPrStatus: async ({ number }) => mergedStatus(number),
        runnerReady: () => true,
        markDone: async () => { calls.markDone += 1; },
        // no `isStopAtRun` seam: exercise the real defaultIsStopAtRun → helper hop.
      },
    });
    const res = await callRoute(router, CHECK_PATH, 'post', baseReq({ params: { urlKey: 'ws', issueIdentifier: 'LIN-sub' } }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.recorded.length, 1);
    assert.equal(res.jsonBody.done, true);
    assert.equal(calls.markDone, 1);
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
