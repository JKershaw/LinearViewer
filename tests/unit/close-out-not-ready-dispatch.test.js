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

import { FINDINGS_NONE, findingsRead, findingsNotRead } from '../../lib/close-out-findings.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { closeOutNotReady, CLOSE_OUT_NOT_READY_CODE } from '../../lib/close-out-readiness.js';
import { clearFailOpenPrStatus } from '../../lib/github-pr-status.js';
import { ISSUE_NOT_FOUND_CODE } from '../../lib/dispatch-referent-guard.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';
import { before, after } from 'node:test';

const harness = createMangoTmpdir('lin-3634-close-out-not-ready-');
before(() => harness.connect());
after(() => harness.close());

const PR = 'https://github.com/acme/widget/pull/41';
const REVIEWED = 'aaaaaaa1111111';
const MOVED = 'bbbbbbb2222222';

const reviewBody = `## Review\n\nReviewed head \`${REVIEWED}\`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**`;
const comment = (body, createdAt) => ({ body, createdAt, user: 'reviewer' });
// LIN-4438: a blind read naming the PR, after the review, so the head-moved cases below meet the head
// check rather than the blind-read gate in front of it.
const readBody = (url = PR) => `## Blind read\nVerdict: same. It gave the readiness rule one owner and left nothing worse.\n\nRead: ${url} at \`${REVIEWED}\` against \`0000000\`.`;
const NO_READ = [comment(PR, '2026-07-01T00:00:00.000Z'), comment(reviewBody, '2026-07-02T00:00:00.000Z')];
const COMMENTS = [...NO_READ, comment(readBody(), '2026-07-03T00:00:00.000Z')];
// LIN-4518 step 3: the same trails as records, which the guard reads (lib/close-out-readiness.js).
const PR42 = 'https://github.com/acme/widget/pull/42';
const PR40 = 'https://github.com/acme/widget/pull/40';
const BASE_EVENTS = [ev.pr(1, PR, REVIEWED), ev.review(2, PR, { heads: { [PR]: REVIEWED } }), ev.read(3, PR)];
const NO_READ_EVENTS = [ev.pr(1, PR, REVIEWED), ev.review(2, PR, { heads: { [PR]: REVIEWED } })];
const openStatus = (number, sha, over = {}) => ({ readable: true, repo: 'acme/widget', number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [], ...over });

function makeStore() {
  const collection = createMockCollection();
  let insertCount = 0;
  const original = collection.insertOne.bind(collection);
  collection.insertOne = async (...args) => { insertCount++; return original(...args); };
  return { store: new DispatchQueueStore({ collection, historyCollection: createMockCollection() }), getInsertCount: () => insertCount };
}

// A closeOut seam whose reads are all counted, over the records of `events` (or records that throw when `throwRecords`).
async function makeSeam({ events = BASE_EVENTS, statuses = { 41: openStatus(41, MOVED) }, stopAt = 'pr', throwRecords = false, unreadable = false } = {}) {
  const calls = { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 };
  const recordsStore = throwRecords
    ? { async taskForTicket() { throw new Error('boom'); } }
    : await seededRecordsStore(harness, events, { urlKey: 'acme', tickets: ['LIN-1'] });
  return {
    calls, recordsStore,
    openFindings: FINDINGS_NONE, resolveProvider: () => {
      calls.resolveProvider += 1;
      return {
        provider: { async fetchIssueComments() { calls.fetchIssueComments += 1; return []; } },
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

function buildApp(store, closeOut, { provider, accessToken } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, ...(accessToken ? { id: 'ws-1', accessToken } : {}) };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined,
    ...(provider ? { provider } : {}),
    closeOut,
    recordsStore: closeOut?.recordsStore ?? null,
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
    const res = await post(buildApp(store, await makeSeam()), CLOSE_OUT);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, CLOSE_OUT_NOT_READY_CODE);
    assert.equal(res.body.reason, 'head-moved');
    assert.equal(res.body.state.status, 'not-ready');
    assert.equal(getInsertCount(), 0, 'a refusal spends no row');
  });

  // LIN-4495: an open finding to close-out is what close-out exists to end, so it never refuses the close-out
  // dispatch (the guard and the press read the same state). Readiness and Done stay held by the decision.
  test('LIN-4495: an open finding to close-out admits close-out on both lanes; the head and blind-read refusals stand', async () => {
    for (const stopAt of ['pr', null]) {
      for (const openFindings of [findingsRead(['finding-1']), findingsNotRead('store down')]) {
        const { store } = makeStore();
        const seam = await makeSeam({ stopAt, statuses: { 41: openStatus(41, REVIEWED) } });
        seam.openFindings = openFindings;
        const res = await post(buildApp(store, seam), CLOSE_OUT);
        assert.equal(res.status, 201, `${stopAt} ${openFindings.state}: ${JSON.stringify(res.body)}`);
      }
    }
    // Still refused: the head moved, and no blind read on record (both refusals are not about findings).
    const moved = await makeSeam({ statuses: { 41: openStatus(41, MOVED) } });
    moved.openFindings = findingsRead(['finding-1']);
    assert.equal((await post(buildApp(makeStore().store, moved), CLOSE_OUT)).body.reason, 'head-moved');
    const unread = await makeSeam({ events: NO_READ_EVENTS, statuses: { 41: openStatus(41, REVIEWED) } });
    unread.openFindings = findingsRead(['finding-1']);
    const refused = await post(buildApp(makeStore().store, unread), CLOSE_OUT);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.reason, 'blind-read-missing');
  });

  test('promptName alone (no kind) and a display-cased promptName are close-outs too', async () => {
    for (const promptName of ['close-out', 'Close Out']) {
      const { store } = makeStore();
      const res = await post(buildApp(store, await makeSeam()), { prompt: 'x', promptName, issueIdentifier: 'LIN-1' });
      assert.equal(res.status, 409, `${promptName}: ${JSON.stringify(res.body)}`);
    }
  });

  test('a non-close-out dispatch with a moved head is admitted and never reads', async () => {
    const { store } = makeStore();
    const seam = await makeSeam();
    const res = await post(buildApp(store, seam), { prompt: 'x', promptName: 'implementation', issueIdentifier: 'LIN-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  test('head = reviewed sha: admitted; then the head moves: the next press is refused', async () => {
    const { store } = makeStore();
    const statuses = { 41: openStatus(41, REVIEWED) };
    const app = buildApp(store, await makeSeam({ statuses }));
    assert.equal((await post(app, CLOSE_OUT)).status, 201);
    statuses[41] = openStatus(41, MOVED);
    const second = await post(app, { ...CLOSE_OUT, prompt: 'close it out again' });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  // LIN-4438 reverses LIN-3634's "zero reads" pin on purpose: the ladder lane reads the ticket's records (its gate) and
  // still no PR or GitHub read, so the session lane cannot close out past the blind-read gate.
  test('ordinary ladder close-out (not stop-at) with a read on record: admitted with one records read and NO PR read', async () => {
    const { store } = makeStore();
    const seam = await makeSeam({ stopAt: null });
    const res = await post(buildApp(store, seam), CLOSE_OUT);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  test('two open PRs at their reviewed heads, a review that is not Approve, and a merged PR are not head-moved: admitted', async () => {
    const TWO_OPEN = [ev.pr(1, PR, REVIEWED), ev.pr(1, PR42, REVIEWED), ev.review(2, [PR, PR42], { heads: { [PR]: REVIEWED, [PR42]: REVIEWED } }), ev.read(3, [PR, PR42])];
    const cases = {
      'two open PRs': await makeSeam({ events: TWO_OPEN, statuses: { 41: openStatus(41, REVIEWED), 42: openStatus(42, REVIEWED) } }),
      'not approved': await makeSeam({ events: [ev.pr(1, PR, REVIEWED), ev.review(2, PR, { outcome: 'request-changes', heads: { [PR]: REVIEWED } })] }),
      merged: await makeSeam({ statuses: { 41: openStatus(41, MOVED, { state: 'closed', merged: true }) } })
    };
    for (const [name, seam] of Object.entries(cases)) {
      const { store } = makeStore();
      const res = await post(buildApp(store, seam), CLOSE_OUT);
      assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
    }
  });

  // LIN-4518 step 3 (finding: a moved PR of a two-PR landing refuses): one of two open PRs moved refuses, on records.
  test('two open PRs, one moved since the review: refused head-moved (the LIN-4469 flaw, on records)', async () => {
    const TWO_OPEN = [ev.pr(1, PR, REVIEWED), ev.pr(1, PR42, REVIEWED), ev.review(2, [PR, PR42], { heads: { [PR]: REVIEWED, [PR42]: REVIEWED } }), ev.read(3, [PR, PR42])];
    const seam = await makeSeam({ events: TWO_OPEN, statuses: { 41: openStatus(41, REVIEWED), 42: openStatus(42, MOVED) } });
    const res = await post(buildApp(makeStore().store, seam), CLOSE_OUT);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.reason, 'head-moved');
  });

  test('unreadable reads fail open: the records throw, PR status unreadable', async () => {
    for (const seam of [await makeSeam({ throwRecords: true }), await makeSeam({ unreadable: true })]) {
      const { store } = makeStore();
      assert.equal((await post(buildApp(store, seam), CLOSE_OUT)).status, 201);
    }
  });

  test('a dangling issue answers 422 before any readiness read', async () => {
    // The dangling stage needs a credential-bearing workspace and a guarded provider
    // (name in GUARDED_PROVIDERS) whose issueWriteGuard answers a definitive null.
    const { store, getInsertCount } = makeStore();
    const seam = await makeSeam();
    const provider = { name: 'local', supports: () => true, issueWriteGuard: async () => null };
    const res = await post(buildApp(store, seam, { provider, accessToken: 'test-token' }), CLOSE_OUT);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, ISSUE_NOT_FOUND_CODE);
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
    assert.equal(getInsertCount(), 0);
  });

  test('an unreadable PR admits and leaves a warn line naming the task', async () => {
    const { store } = makeStore();
    const warns = [];
    const original = console.warn;
    console.warn = (...args) => { warns.push(args); };
    try {
      const res = await post(buildApp(store, await makeSeam({ unreadable: true })), CLOSE_OUT);
      assert.equal(res.status, 201, JSON.stringify(res.body));
    } finally {
      console.warn = original;
    }
    assert.ok(
      warns.some(a => a[0] === '[close-out-readiness] PR unreadable, admitting:' && a[1] === 'LIN-1'),
      `expected the unreadable-PR warn, got ${JSON.stringify(warns)}`
    );
  });

  test('an abort, and a close-out with no issue anywhere, never read', async () => {
    const { store } = makeStore();
    const seam = await makeSeam();
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
      const app = buildApp(store, await makeSeam());
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { ...CLOSE_OUT, followUpTo });
      assert.equal(res.status, 409, JSON.stringify(res.body));
    });

    test('followUpTo with NO issueIdentifier takes the anchor\'s issue: 409', async () => {
      const { store } = makeStore();
      const app = buildApp(store, await makeSeam());
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { prompt: 'close it out', kind: 'close-out', followUpTo });
      assert.equal(res.status, 409, JSON.stringify(res.body));
    });

    test('an unknown anchor and no issue fails open without a read', async () => {
      const { store } = makeStore();
      const seam = await makeSeam();
      const res = await post(buildApp(store, seam), { prompt: 'x', kind: 'close-out', followUpTo: 'no-such-item' });
      assert.notEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
    });

    test('a follow-up close-out on a task that is not stop-at is admitted', async () => {
      const { store } = makeStore();
      const seam = await makeSeam({ stopAt: null });
      const app = buildApp(store, seam);
      const followUpTo = await warmItem(store, app);
      const res = await post(app, { ...CLOSE_OUT, followUpTo });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(seam.calls.fetchIssueComments, 0, 'the ladder lane reads no comments (LIN-4518 step 3: its one read is the records)');
      assert.equal(seam.calls.readPrStatus, 0);
    });
  });
});

describe('LIN-4438: the session lane holds the blind-read gate', () => {
  test('ladder lane, approve and no read: 409 CLOSE_OUT_NOT_READY / blind-read-missing, no row, no PR read', async () => {
    const { store, getInsertCount } = makeStore();
    const seam = await makeSeam({ stopAt: null, events: NO_READ_EVENTS });
    const res = await post(buildApp(store, seam), CLOSE_OUT);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, CLOSE_OUT_NOT_READY_CODE);
    assert.equal(res.body.reason, 'blind-read-missing');
    assert.equal(res.body.error, 'No blind read on record since the review');
    assert.equal(getInsertCount(), 0);
    assert.deepEqual(seam.calls, { resolveProvider: 0, fetchIssueComments: 0, readPrStatus: 0 });
  });

  test('stop-at lane, approve and no read: 409 blind-read-missing, even with the head unmoved', async () => {
    const { store } = makeStore();
    const res = await post(buildApp(store, await makeSeam({ events: NO_READ_EVENTS, statuses: { 41: openStatus(41, REVIEWED) } })), CLOSE_OUT);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.reason, 'blind-read-missing');
  });

  test('ladder lane: with a read admitted; with no review admitted; a read of another PR only refused', async () => {
    // The read of PR40 names a PR the landing does not hold: PR40 was merged by a close-out before the review.
    const OLDER = [ev.pr(0, PR40, REVIEWED), ev.close(0), ev.merged(0, PR40)];
    const cases = {
      'read on record': [BASE_EVENTS, 201],
      'no review': [[ev.pr(1, PR, REVIEWED)], 201],
      'read names another PR': [[...OLDER, ev.pr(1, PR, REVIEWED), ev.review(2, PR, { heads: { [PR]: REVIEWED } }), ev.read(3, PR40)], 409],
      'request changes': [[ev.pr(1, PR, REVIEWED), ev.review(2, PR, { outcome: 'request-changes', heads: { [PR]: REVIEWED } })], 201],
    };
    for (const [name, [events, status]] of Object.entries(cases)) {
      const { store } = makeStore();
      const res = await post(buildApp(store, await makeSeam({ stopAt: null, events })), CLOSE_OUT);
      assert.equal(res.status, status, `${name}: ${JSON.stringify(res.body)}`);
    }
  });

  test('ladder lane: an unreadable comment read admits and logs', async () => {
    const { store } = makeStore();
    const errors = [];
    const original = console.error;
    console.error = (...args) => { errors.push(args); };
    try {
      const res = await post(buildApp(store, await makeSeam({ stopAt: null, throwRecords: true })), CLOSE_OUT);
      assert.equal(res.status, 201, JSON.stringify(res.body));
    } finally {
      console.error = original;
    }
    assert.ok(errors.some(a => a[0] === '[close-out-readiness] guard read failed, admitting:'), JSON.stringify(errors));
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
    openFindings: FINDINGS_NONE, resolveProvider: () => ({ provider: { async fetchIssueComments() { return COMMENTS; } }, callScope: 'scope' }),
    isStopAtRun: async () => 'pr',
    githubFetch: githubFor(heads)
  });

  // The guard reads the ticket's records (LIN-4518 step 3): the same trail as the rest of this file, seeded once per test.
  const recordsStore = () => seededRecordsStore(harness, BASE_EVENTS, { urlKey: 'acme', tickets: ['LIN-1'] });

  test('a shared-cache entry filled at head A does not hide head B from the guard', async () => {
    clearFailOpenPrStatus();
    const { readPrStatusFailOpen } = await import('../../lib/github-pr-status.js');
    const heads = { current: REVIEWED };
    const seam = seamWith(heads);
    // Fill the shared cache at the reviewed head through a real read.
    const filled = await readPrStatusFailOpen({ repo: 'acme/widget', number: 41, doFetch: seam.githubFetch });
    assert.equal(filled.readable, true, JSON.stringify(filled));
    heads.current = MOVED;
    const state = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: 'LIN-1', seam, recordsStore: await recordsStore() });
    assert.equal(state?.reason, 'head-moved');
    clearFailOpenPrStatus();
  });

  test('a shared-cache unreadable entry does not hide a readable live head', async () => {
    clearFailOpenPrStatus();
    const { readPrStatusFailOpen } = await import('../../lib/github-pr-status.js');
    await readPrStatusFailOpen({ repo: 'acme/widget', number: 41, doFetch: async () => { throw new Error('rate limited'); } });
    const state = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: 'LIN-1', seam: seamWith({ current: MOVED }), recordsStore: await recordsStore() });
    assert.equal(state?.reason, 'head-moved');
    clearFailOpenPrStatus();
  });
});
