/**
 * LIN-3634 (LIN-3418 step 2): the session dispatch lane refuses a close-out
 * (409 CLOSE_OUT_NOT_READY) on a stop-at-PR task whose sole open PR's head moved
 * after the review approved it, and admits everything else.
 *
 * Scaffolded on close-out-is-the-persons-relay.test.js (real DispatchQueueStore on a
 * mock collection) plus the `closeOut` seam fakes of close-out-check-route.test.js.
 * No live hosts, no model calls.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { closeOutNotReady, CLOSE_OUT_NOT_READY_CODE } from '../../lib/close-out-readiness.js';
import { clearFailOpenPrStatus } from '../../lib/github-pr-status.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const PR = 'https://github.com/acme/widget/pull/41';
const REVIEWED = 'aaaaaaa1111111';
const MOVED = 'bbbbbbb2222222';

const reviewBody = `## Review\n\nReviewed head \`${REVIEWED}\`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**`;
const comment = (body, createdAt) => ({ body, createdAt, user: 'reviewer' });
const COMMENTS = [comment(PR, '2026-07-01T00:00:00.000Z'), comment(reviewBody, '2026-07-02T00:00:00.000Z')];
const openStatus = (number, sha, over = {}) => ({ readable: true, repo: 'acme/widget', number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [], ...over });

function makeStore() {
  const collection = createMockCollection();
  let insertCount = 0;
  const original = collection.insertOne.bind(collection);
  collection.insertOne = async (...args) => { insertCount++; return original(...args); };
  return { store: new DispatchQueueStore({ collection, historyCollection: createMockCollection() }), getInsertCount: () => insertCount };
}

// A closeOut seam whose reads are all counted.
function makeSeam({ comments = COMMENTS, statuses = { 41: openStatus(41, MOVED) }, stopAt = 'pr', throwComments = false, unreadable = false } = {}) {
  const calls = { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 };
  return {
    calls,
    resolveProvider: () => {
      calls.resolveProvider += 1;
      return {
        provider: { async fetchIssueComments() { calls.fetchIssueComments += 1; if (throwComments) throw new Error('boom'); return comments; } },
        callScope: 'scope'
      };
    },
    readPrStatus: async ({ number }) => {
      calls.readPrStatus += 1;
      return unreadable ? { readable: false, repo: 'acme/widget', number, state: 'unknown', reason: 'stub' } : statuses[number];
    },
    isStopAtRun: async () => stopAt
  };
}

function buildApp(store, closeOut) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined,
    closeOut
  }));
  return app;
}

async function post(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/api/dispatch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const CLOSE_OUT = { prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1' };

describe('LIN-3634: session close-out readiness stage', () => {
  test('stop-at-PR task, sole open PR head moved: 409 CLOSE_OUT_NOT_READY and no row', async () => {
    const { store, getInsertCount } = makeStore();
    const res = await post(buildApp(store, makeSeam()), CLOSE_OUT);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, CLOSE_OUT_NOT_READY_CODE);
    assert.equal(res.body.reason, 'head-moved');
    assert.equal(res.body.state.status, 'not-ready');
    assert.equal(getInsertCount(), 0, 'a refusal spends no row');
  });

  test('promptName alone (no kind) and a display-cased promptName are close-outs too', async () => {
    for (const promptName of ['close-out', 'Close Out']) {
      const { store } = makeStore();
      const res = await post(buildApp(store, makeSeam()), { prompt: 'x', promptName, issueIdentifier: 'LIN-1' });
      assert.equal(res.status, 409, `${promptName}: ${JSON.stringify(res.body)}`);
    }
  });

  test('a non-close-out dispatch with a moved head is admitted and never reads', async () => {
    const { store } = makeStore();
    const seam = makeSeam();
    const res = await post(buildApp(store, seam), { prompt: 'x', promptName: 'implementation', issueIdentifier: 'LIN-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  test('head = reviewed sha: admitted; then the head moves: the next press is refused', async () => {
    const { store } = makeStore();
    const statuses = { 41: openStatus(41, REVIEWED) };
    const app = buildApp(store, makeSeam({ statuses }));
    assert.equal((await post(app, CLOSE_OUT)).status, 201);
    statuses[41] = openStatus(41, MOVED);
    const second = await post(app, { ...CLOSE_OUT, prompt: 'close it out again' });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  test('ordinary ladder close-out (not stop-at): admitted with ZERO provider / comment / PR reads', async () => {
    const { store } = makeStore();
    const seam = makeSeam({ stopAt: null });
    const res = await post(buildApp(store, seam), CLOSE_OUT);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  test('two open PRs, a review that is not Approve, and a merged PR are not head-moved: admitted', async () => {
    const cases = {
      'two open PRs': makeSeam({ comments: [comment(`${PR} https://github.com/acme/widget/pull/42`, '2026-07-01T00:00:00.000Z'), COMMENTS[1]], statuses: { 41: openStatus(41, MOVED), 42: openStatus(42, MOVED) } }),
      'not approved': makeSeam({ comments: [COMMENTS[0], comment(reviewBody.replace('Approve', 'Request Changes'), '2026-07-02T00:00:00.000Z')] }),
      merged: makeSeam({ statuses: { 41: openStatus(41, MOVED, { state: 'closed', merged: true }) } })
    };
    for (const [name, seam] of Object.entries(cases)) {
      const { store } = makeStore();
      const res = await post(buildApp(store, seam), CLOSE_OUT);
      assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
    }
  });

  test('unreadable reads fail open: comments throw, PR status unreadable', async () => {
    for (const seam of [makeSeam({ throwComments: true }), makeSeam({ unreadable: true })]) {
      const { store } = makeStore();
      assert.equal((await post(buildApp(store, seam), CLOSE_OUT)).status, 201);
    }
  });

  test('an abort, and a close-out with no issue anywhere, never read', async () => {
    const { store } = makeStore();
    const seam = makeSeam();
    const app = buildApp(store, seam);
    const noIssue = await post(app, { prompt: 'x', kind: 'close-out' });
    assert.equal(noIssue.status, 201, JSON.stringify(noIssue.body));
    await post(app, { abort: true, kind: 'close-out', issueIdentifier: 'LIN-1' });
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  describe('follow-up close-outs (G1)', () => {
    async function warmItem(store, app) {
      const first = await post(app, { prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-1' });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      return first.body.item.id;
    }

    test('followUpTo + issueIdentifier on a moved head: 409', async () => {
      const { store } = makeStore();
      const app = buildApp(store, makeSeam());
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { ...CLOSE_OUT, followUpTo });
      assert.equal(res.status, 409, JSON.stringify(res.body));
    });

    test('followUpTo with NO issueIdentifier takes the anchor\'s issue: 409', async () => {
      const { store } = makeStore();
      const app = buildApp(store, makeSeam());
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { prompt: 'close it out', kind: 'close-out', followUpTo });
      assert.equal(res.status, 409, JSON.stringify(res.body));
    });

    test('an unknown anchor and no issue fails open without a read', async () => {
      const { store } = makeStore();
      const seam = makeSeam();
      const res = await post(buildApp(store, seam), { prompt: 'x', kind: 'close-out', followUpTo: 'no-such-item' });
      assert.notEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
    });

    test('a follow-up close-out on a task that is not stop-at is admitted', async () => {
      const { store } = makeStore();
      const seam = makeSeam({ stopAt: null });
      const app = buildApp(store, seam);
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { ...CLOSE_OUT, followUpTo });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(seam.calls.fetchIssueComments, 0);
    });
  });
});

describe('LIN-3634: the guard reads uncached (F2)', () => {
  const workspace = { urlKey: 'acme' };
  const githubFor = (heads) => async (url) => {
    const u = String(url);
    const body = u.includes('/check-runs')
      ? { check_runs: [] }
      : u.includes('/pulls/41')
        ? { number: 41, state: 'open', merged: false, head: { ref: 'f', sha: heads.current } }
        : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
  };
  const seamWith = (heads) => ({
    resolveProvider: () => ({ provider: { async fetchIssueComments() { return COMMENTS; } }, callScope: 'scope' }),
    isStopAtRun: async () => 'pr',
    githubFetch: githubFor(heads)
  });

  test('a shared-cache entry filled at head A does not hide head B from the guard', async () => {
    clearFailOpenPrStatus();
    const { readPrStatusFailOpen } = await import('../../lib/github-pr-status.js');
    const heads = { current: REVIEWED };
    const seam = seamWith(heads);
    // Fill the shared cache at the reviewed head through a real read.
    const filled = await readPrStatusFailOpen({ repo: 'acme/widget', number: 41, doFetch: seam.githubFetch });
    assert.equal(filled.readable, true, JSON.stringify(filled));
    heads.current = MOVED;
    const state = await closeOutNotReady({ workspace, issueIdentifier: 'LIN-1', seam });
    assert.equal(state?.reason, 'head-moved');
    clearFailOpenPrStatus();
  });

  test('a shared-cache unreadable entry does not hide a readable live head', async () => {
    clearFailOpenPrStatus();
    const { readPrStatusFailOpen } = await import('../../lib/github-pr-status.js');
    await readPrStatusFailOpen({ repo: 'acme/widget', number: 41, doFetch: async () => { throw new Error('rate limited'); } });
    const state = await closeOutNotReady({ workspace, issueIdentifier: 'LIN-1', seam: seamWith({ current: MOVED }) });
    assert.equal(state?.reason, 'head-moved');
    clearFailOpenPrStatus();
  });
});
