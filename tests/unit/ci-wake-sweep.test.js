/**
 * LIN-3661: the CI wake sweep over REAL dispatch rows.
 *
 * Rows are built the way production builds them (a real DispatchQueueStore and the
 * real lean `getLoopsForWorkspace`), with fakes only for what is external: the PR
 * reader, the issue comments, the workspace access resolver and the sessions
 * collection. No session object anywhere: the deps are built through
 * `createTickWorkspaceResolver` the way server.js builds them. Most cases spy
 * `enqueue`; the "real enqueueFollowUp" describe drives the default one (harness
 * `null`, so the `claude-code` mint branch of `provisionResumeCredential` is not
 * exercised here).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import {
  createCiWakeSweepRun,
  createTickWorkspaceResolver,
  prRefsFromPark,
  ciWakePrompt,
  ciWakeMarker,
  MAX_PR_READS_PER_TICK,
  MAX_COMMENT_FETCHES_PER_TICK,
  PENDING_BACKOFF_CAP_MS
} from '../../lib/ci-wake-sweep.js';

const URL_KEY = 'ws-ci-wake';
const OWNER = 'acct-owner';
const PR_URL = 'https://github.com/o/r/pull/1944';
const PASSING = { readable: true, repo: 'o/r', number: 1944, state: 'open', head: { sha: 'abc1234def' }, checks: [{ name: 'unit', conclusion: 'success' }] };
const FAILING = { ...PASSING, checks: [{ name: 'unit', conclusion: 'success' }, { name: 'e2e-1', conclusion: 'failure' }] };
const PENDING = { ...PASSING, checks: [{ name: 'unit', conclusion: 'in_progress' }] };

describe('ci-wake-sweep: helpers', () => {
  test('prRefsFromPark reads the real park messages', () => {
    const full = prRefsFromPark('Unit and four E2E jobs are still pending on https://github.com/JKershaw/LinearViewer/pull/1944');
    assert.deepEqual(full.prs.map((p) => `${p.repo}#${p.number}`), ['JKershaw/LinearViewer#1944']);
    assert.equal(prRefsFromPark('PENDING-EXTERNAL: PR #1945 CI running').needsComments, true);
    const known = [{ repo: 'o/r', number: 1945, url: 'https://github.com/o/r/pull/1945' }, { repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' }];
    assert.deepEqual(prRefsFromPark('waiting on PR #1945', known).prs.map((p) => p.number), [1945]);
    for (const text of ['#1945 pending', 'PR 1945', 'pull 1945', 'pull #1945']) {
      assert.deepEqual(prRefsFromPark(text, known).prs.map((p) => p.number), [1945], text);
    }
    assert.deepEqual(prRefsFromPark('nothing to see', known), { prs: [], needsComments: false });
  });

  test('a bare number matching PRs in two repos is ambiguous (two results)', () => {
    const known = [{ repo: 'a/x', number: 5, url: 'u1' }, { repo: 'b/y', number: 5, url: 'u2' }];
    assert.equal(prRefsFromPark('PR #5', known).prs.length, 2);
  });

  test('ciWakePrompt carries PR, sha7, verdict, failing names and the marker', () => {
    const text = ciWakePrompt({ prUrl: PR_URL, sha: 'abc1234def', verdict: 'failing', failing: ['e2e-1'] });
    assert.match(text, /https:\/\/github\.com\/o\/r\/pull\/1944/);
    assert.match(text, /abc1234/);
    assert.match(text, /e2e-1/);
    assert.ok(text.split('\n').includes(ciWakeMarker('abc1234', 'failing')));
  });
});

describe('ci-wake-sweep: over a real DispatchQueueStore', () => {
  const harness = createMangoTmpdir('ci-wake-');
  let store;
  let clock;
  let posted;
  let prStatus;
  let prReads;
  let commentFetches;
  let comments;
  let accessCalls;
  let accessReason;
  let sessionsRows;
  let ownerAllowed;
  const agentStatusStore = { listStatus: async () => ({ items: [] }) };

  before(() => harness.connect());
  after(() => harness.close());

  beforeEach(() => {
    const db = harness.freshDb();
    store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    clock = Date.now();
    posted = [];
    prStatus = () => PASSING;
    prReads = [];
    commentFetches = [];
    comments = [{ body: `PR: ${PR_URL}`, createdAt: new Date().toISOString() }];
    accessCalls = [];
    accessReason = 'ok';
    ownerAllowed = true;
    sessionsRows = [{ session: JSON.stringify({ workspaces: [{ id: 'ws-id-1', urlKey: URL_KEY, provider: 'linear' }] }) }];
  });

  function buildRun({ baseUrl = 'https://harbour.test', extra = {} } = {}) {
    const resolver = createTickWorkspaceResolver({
      sessionsCollection: { find: () => ({ toArray: async () => sessionsRows }) },
      resolveWorkspaceAccess: async (urlKey, owner, opts) => {
        accessCalls.push({ urlKey, owner, opts });
        return { token: 'tok', scope: 'scope-tok', provider: 'linear', reason: accessReason };
      },
      getProviderByName: () => ({
        fetchIssueComments: async (scope, identifier) => { commentFetches.push({ scope, identifier }); return comments; }
      })
      // No `now`, as in server.js: the tick time reaches the resolver only through reset(tickNow).
    });
    const spy = async (args) => {
      posted.push(args);
      return { status: 200, body: { queued: true } };
    };
    return createCiWakeSweepRun({
      dispatchStore: store,
      agentStatusStore,
      proxyTokenStore: {},
      workspacePreferencesStore: {},
      ownerCheck: async () => ({ status: ownerAllowed ? 'owner' : 'not-owner' }),
      resolver,
      baseUrl,
      now: () => clock,
      readStatuses: async ({ prUrls, callScope, workspace }) => prUrls.map((p) => {
        prReads.push({ ...p, callScope, workspace });
        return prStatus(p);
      }),
      enqueue: spy,
      ...extra
    });
  }

  /** A worker row parked [pending], under an autopilot anchor (sessionId), as production builds them. */
  async function seedParked({ message = `[pending] Unit and four E2E jobs are still pending on ${PR_URL}`, issue = 'LIN-3647', anchor = null, dispatchedBy = OWNER, target = 'cli', park = true } = {}) {
    const worker = await store.addItem(URL_KEY, {
      prompt: 'implement', promptName: 'implementation', kind: 'implementation',
      issueIdentifier: issue, sessionId: anchor, dispatchedBy, target
    });
    await store.takeItem(worker._id, URL_KEY);
    const past = new Date(Date.now() - 30 * 60 * 1000);
    await store.historyCollection.updateOne({ _id: worker._id, urlKey: URL_KEY }, { $set: { dispatchedAt: past, resolvedAt: past } });
    if (park) await store.addFeedback(worker._id, URL_KEY, { message }, null);
    return worker;
  }

  test('parked + passing posts exactly one follow-up, to the WORKER row (not the anchor)', async () => {
    const anchor = await store.addItem(URL_KEY, { prompt: 'a', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1' });
    const worker = await seedParked({ anchor: anchor._id });
    await buildRun()();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].followUpTo, worker._id);
    assert.equal(posted[0].dispatchedBy, OWNER);
    assert.equal(posted[0].workspaceId, 'ws-id-1');
    assert.equal(posted[0].baseUrl, 'https://harbour.test');
    assert.equal(posted[0].target, 'cli');
    assert.match(posted[0].prompt, new RegExp(ciWakeMarker('abc1234', 'passing')));
    assert.match(posted[0].prompt, /pull\/1944/);
  });

  test('no-session wiring: owner reaches resolveWorkspaceAccess, bare #N resolves through comments with the call scope', async () => {
    await seedParked({ message: '[pending] PR #1944 CI is running', issue: 'LIN-3651' });
    await buildRun()();
    assert.deepEqual(accessCalls.map((c) => [c.urlKey, c.owner]), [[URL_KEY, OWNER]]);
    assert.deepEqual(commentFetches, [{ scope: 'scope-tok', identifier: 'LIN-3651' }]);
    assert.equal(prReads[0].callScope, 'scope-tok');
    assert.deepEqual(prReads[0].workspace, { urlKey: URL_KEY });
    assert.equal(posted.length, 1);
  });

  test('the issue source is forwarded to resolveWorkspaceAccess when the row carries it', async () => {
    const worker = await seedParked();
    await store.historyCollection.updateOne({ _id: worker._id }, { $set: { issueSource: 'jira' } });
    await buildRun()();
    assert.deepEqual(accessCalls[0].opts, { source: 'jira' });
  });

  test('failing carries the failing check names', async () => {
    prStatus = () => FAILING;
    await seedParked();
    await buildRun()();
    assert.equal(posted.length, 1);
    assert.match(posted[0].prompt, /failing/);
    assert.match(posted[0].prompt, /e2e-1/);
  });

  test('no live session for the urlKey, or access not ok: nothing posted', async () => {
    await seedParked();
    sessionsRows = [];
    await buildRun()();
    assert.equal(posted.length, 0);
    assert.equal(prReads.length, 0);

    sessionsRows = [{ session: JSON.stringify({ workspaces: [{ id: 'ws-id-1', urlKey: URL_KEY }] }) }];
    accessReason = 'owner_signed_out';
    clock += 60 * 60 * 1000; // past back-off
    await buildRun()();
    assert.equal(posted.length, 0);
  });

  test('the park is read from the raw tail row even though the lean feedback is empty', async () => {
    await seedParked();
    const { getLoopsForWorkspace } = await import('../../lib/pipeline-loops.js');
    const loops = await getLoopsForWorkspace(URL_KEY, { dispatchStore: store, agentStatusStore, lean: true });
    assert.deepEqual(loops[0].feedback, []);
    assert.equal(loops[0].wakeMarker, 'pending');
    await buildRun()();
    assert.equal(posted.length, 1);
  });

  test('a tail row missing from the raw read is skipped, never read from lean feedback', async () => {
    await seedParked();
    const realList = store.listHistory.bind(store);
    store.listHistory = async (...args) => ({ items: [] });
    try {
      await buildRun()();
    } finally {
      store.listHistory = realList;
    }
    assert.equal(posted.length, 0);
  });

  test('pending, unknown and unreadable post nothing and back off; pending retries within 10 min', async () => {
    await seedParked();
    const run = buildRun();
    prStatus = () => PENDING;
    await run();
    assert.equal(prReads.length, 1);
    await run(); // inside the back-off: not a candidate
    assert.equal(prReads.length, 1);
    clock += PENDING_BACKOFF_CAP_MS + 1;
    prStatus = () => PASSING;
    await run();
    assert.equal(prReads.length, 2);
    assert.equal(posted.length, 1);
  });

  test('unknown backs off longer than pending (same first miss, different cap)', async () => {
    await seedParked();
    const run = buildRun();
    const unknown = { readable: true, repo: 'o/r', head: { sha: 'abc' }, checks: [] };
    prStatus = () => unknown;
    await run();                       // miss 1: 10 min
    clock += PENDING_BACKOFF_CAP_MS + 1;
    await run();                       // miss 2: 20 min
    assert.equal(prReads.length, 2);
    clock += PENDING_BACKOFF_CAP_MS + 1;
    await run();                       // unknown is still backed off past the pending cap
    assert.equal(prReads.length, 2);
    clock += PENDING_BACKOFF_CAP_MS + 1;
    prStatus = () => ({ readable: false, reason: 'not readable' });
    await run();
    assert.equal(prReads.length, 3);
    assert.equal(posted.length, 0);
  });

  test('pending stays on the 10 min cap however many ticks it has waited', async () => {
    await seedParked();
    const run = buildRun();
    prStatus = () => PENDING;
    for (let i = 0; i < 5; i++) {
      await run();
      clock += PENDING_BACKOFF_CAP_MS + 1;
    }
    assert.equal(prReads.length, 5);
  });

  test('a second tick posts nothing once our follow-up is queued and the marker holds on re-park', async () => {
    const worker = await seedParked();
    // The same row shape the real wake path writes (createDispatchItem inherits rootItemId), minus credential minting.
    const written = [];
    const spy = async (args) => {
      const item = await store.addItem(URL_KEY, {
        prompt: args.prompt, promptName: 'follow-up', kind: 'custom', issueIdentifier: 'LIN-3647',
        followUpTo: args.followUpTo, rootItemId: worker._id, target: args.target, dispatchedBy: args.dispatchedBy
      });
      written.push(item);
      return { status: 200, body: {} };
    };
    const run = buildRun({ extra: { enqueue: spy } });
    await run();
    assert.equal(written.length, 1);
    assert.equal(written[0].followUpTo, worker._id);
    clock += 2 * 60 * 60 * 1000;
    await run();
    assert.equal(written.length, 1, 'tail is now our queued row: not parked');

    // The follow-up row is taken and the worker re-parks on the same CI result.
    await store.takeItem(written[0]._id, URL_KEY);
    await store.addFeedback(written[0]._id, URL_KEY, { message: `[pending] still waiting on ${PR_URL}` }, null);
    clock += 2 * 60 * 60 * 1000;
    await run();
    assert.equal(written.length, 1, 'same sha + verdict: marker held');

    // A pushed fix is a new sha: re-armed.
    prStatus = () => ({ ...PASSING, head: { sha: 'fff9999aaa' } });
    clock += 2 * 60 * 60 * 1000;
    await run();
    assert.equal(written.length, 2);
  });

  describe('not parked', () => {
    for (const [label, mutate] of [
      ['resumed on the same row', async (w) => store.addFeedback(w._id, URL_KEY, { message: '[working] Session resumed.' }, null)],
      ['blocked', async (w) => store.addFeedback(w._id, URL_KEY, { message: '[blocked] need a human' }, null)],
      ['done', async (w) => store.addFeedback(w._id, URL_KEY, { message: '[done] finished' }, null)],
      ['closed stamp', async (w) => store.historyCollection.updateOne({ _id: w._id }, { $set: { bookkeeping: { closedAt: new Date(), reason: 'x' } } })],
      ['history status cancelled', async (w) => store.historyCollection.updateOne({ _id: w._id }, { $set: { status: 'cancelled' } })],
      ['history status expired', async (w) => store.historyCollection.updateOne({ _id: w._id }, { $set: { status: 'expired' } })],
      ['follow-up already queued after the park', async (w) => store.addItem(URL_KEY, { prompt: 'f', promptName: 'follow-up', kind: 'custom', issueIdentifier: 'LIN-3647', followUpTo: w._id, rootItemId: w._id })]
    ]) {
      test(label, async () => {
        const worker = await seedParked();
        await mutate(worker);
        await buildRun()();
        assert.equal(posted.length, 0);
        assert.equal(prReads.length, 0);
      });
    }

    test('an [aborted] posted to an abort item against the target', async () => {
      const worker = await seedParked();
      const abort = await store.addItem(URL_KEY, { abort: true, abortTo: worker._id, promptName: 'abort', kind: 'abort' });
      await store.takeItem(abort._id, URL_KEY);
      await store.addFeedback(abort._id, URL_KEY, { message: '[aborted] stopped', rootItemId: worker._id }, null);
      await buildRun()();
      assert.equal(posted.length, 0);
    });
  });

  test('a park on a follow-up row (lineage scope) is found; a resume on a later row is not', async () => {
    const root = await seedParked({ message: '[pending] first park' });
    await store.addFeedback(root._id, URL_KEY, { message: '[working] Session resumed.' }, null);
    const follow = await store.addItem(URL_KEY, {
      prompt: 'f', promptName: 'follow-up', kind: 'custom', issueIdentifier: 'LIN-3647',
      followUpTo: root._id, rootItemId: root._id, dispatchedBy: OWNER, target: 'cli'
    });
    await store.takeItem(follow._id, URL_KEY);
    await store.addFeedback(follow._id, URL_KEY, { message: `[pending] waiting for ${PR_URL}`, rootItemId: root._id }, null);
    await buildRun()();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].followUpTo, follow._id);
  });

  test('a park naming two PRs, or none, posts nothing', async () => {
    await seedParked({ message: '[pending] https://github.com/o/r/pull/1 and https://github.com/o/r/pull/2' });
    await seedParked({ message: '[pending] waiting on a reviewer', issue: 'LIN-2' });
    await buildRun()();
    assert.equal(posted.length, 0);
    assert.equal(prReads.length, 0);
  });

  test('a bare number matching PRs in two repos is ambiguous: nothing posted', async () => {
    comments = [{ body: 'https://github.com/a/x/pull/9 https://github.com/b/y/pull/9', createdAt: new Date().toISOString() }];
    await seedParked({ message: '[pending] PR #9 CI' });
    await buildRun()();
    assert.equal(posted.length, 0);
  });

  test('PR reads and comment fetches are capped per tick', async () => {
    for (let i = 0; i < MAX_PR_READS_PER_TICK + 3; i++) {
      await seedParked({ message: `[pending] https://github.com/o/r/pull/${100 + i}`, issue: `LIN-${i + 10}` });
    }
    prStatus = () => PENDING;
    await buildRun()();
    assert.equal(prReads.length, MAX_PR_READS_PER_TICK);

    commentFetches.length = 0;
    const fresh = harness.freshDb();
    store = new DispatchQueueStore({ collection: fresh.collection('q'), historyCollection: fresh.collection('h'), ttl: 86400 });
    for (let i = 0; i < MAX_COMMENT_FETCHES_PER_TICK + 3; i++) {
      await seedParked({ message: `[pending] PR #${i}`, issue: `LIN-${i + 50}` });
    }
    await buildRun()();
    assert.equal(commentFetches.length, MAX_COMMENT_FETCHES_PER_TICK);
  });

  test('rows that stay unknown do not starve a newer passing row (slot back-off, round robin)', async () => {
    for (let i = 0; i < MAX_PR_READS_PER_TICK; i++) {
      await seedParked({ message: `[pending] https://github.com/o/r/pull/${200 + i}`, issue: `LIN-${i + 20}` });
    }
    prStatus = ({ number }) => (number === 999 ? PASSING : { readable: false, reason: 'not readable' });
    const run = buildRun();
    await run(); // all five slots consumed by unreadable rows, each now backed off
    assert.equal(posted.length, 0);
    await seedParked({ message: '[pending] https://github.com/o/r/pull/999', issue: 'LIN-99' });
    clock += 60_000;
    await run();
    assert.equal(posted.length, 1, 'the newer viable row is processed while the five are backed off');
  });

  test('missing dispatchedBy, an owner-gate refusal, and a null baseUrl post nothing', async () => {
    await seedParked({ dispatchedBy: null });
    await buildRun()();
    assert.equal(posted.length, 0);

    const refused = buildRun({ extra: { enqueue: async () => ({ status: 422, body: { error: 'owner only' } }) } });
    await seedParked({ issue: 'LIN-5' });
    await refused();
    assert.equal(posted.length, 0);

    const inert = buildRun({ baseUrl: null });
    clock += 3 * 60 * 60 * 1000;
    await inert();
    assert.equal(posted.length, 0);
  });

  test('a dash/local target is skipped', async () => {
    await seedParked({ target: 'dash' });
    await buildRun()();
    assert.equal(posted.length, 0);
  });

  test('a local target is skipped', async () => {
    await seedParked({ target: 'local' });
    await buildRun()();
    assert.equal(posted.length, 0);
  });

  test('LIN-3677: an unknown target string is skipped (a miss), not sent to cli', async () => {
    await seedParked({ target: 'carrier-pigeon' });
    await buildRun()();
    assert.equal(posted.length, 0);
  });

  test('a 403 on a PR read ends that tick\'s reads', async () => {
    for (let i = 0; i < 3; i++) {
      await seedParked({ message: `[pending] https://github.com/o/r/pull/${300 + i}`, issue: `LIN-${i + 30}` });
    }
    prStatus = () => ({ readable: false, reason: 'GitHub API error checking o/r: HTTP 403: API rate limit exceeded' });
    await buildRun()();
    assert.equal(prReads.length, 1);
    assert.equal(posted.length, 0);
  });

  test('the lineage tail moving between the PR read and the post posts nothing', async () => {
    const worker = await seedParked();
    const logs = [];
    const realLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      await buildRun({
        extra: {
          readStatuses: async ({ prUrls }) => {
            // The worker resumes (a follow-up row joins its lineage) while the checks are being read.
            await store.addItem(URL_KEY, {
              prompt: 'f', promptName: 'follow-up', kind: 'custom', issueIdentifier: 'LIN-3647',
              followUpTo: worker._id, rootItemId: worker._id, dispatchedBy: OWNER, target: 'cli'
            });
            prReads.push(prUrls[0]);
            return [PASSING];
          }
        }
      })();
    } finally {
      console.log = realLog;
    }
    assert.equal(prReads.length, 1);
    assert.equal(posted.length, 0);
    assert.ok(logs.some((l) => l.includes('lineage tail moved')), logs.join('\n'));
  });

  test('session rows are judged at the tick clock, not wall-clock time', async () => {
    await seedParked();
    clock = Date.now() + 2 * 60 * 60 * 1000;
    // Live by wall-clock time, expired at the tick's time (expiry field per lib/session-row-live.js).
    sessionsRows = [{
      expires: new Date(Date.now() + 60 * 60 * 1000),
      session: JSON.stringify({ workspaces: [{ id: 'ws-id-1', urlKey: URL_KEY, provider: 'linear' }] })
    }];
    const logs = [];
    const realLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      await buildRun()();
    } finally {
      console.log = realLog;
    }
    assert.equal(posted.length, 0);
    assert.equal(prReads.length, 0);
    assert.ok(logs.some((l) => l.includes('no-live-session-for-url-key')), logs.join('\n'));
  });

  describe('real enqueueFollowUp (default enqueue, owner-status gate)', () => {
    // `enqueue: undefined` overrides the spy so the run falls back to the real `enqueueFollowUp`.
    const real = { enqueue: undefined, proxyTokenStore: null, workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) } };

    test('an owner gets one queued row to the worker lineage, and a second tick queues nothing', async () => {
      const anchor = await store.addItem(URL_KEY, { prompt: 'a', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1' });
      const worker = await seedParked({ anchor: anchor._id });
      const run = buildRun({ extra: real });
      await run();
      const queued = await store.listItems(URL_KEY, { rootItemId: worker._id });
      const wake = queued.filter((row) => row.followUpTo === worker._id);
      assert.equal(wake.length, 1);
      assert.equal(wake[0].rootItemId, worker._id);
      assert.equal(wake[0].force, false);
      assert.equal(wake[0].target, 'cli');
      assert.equal(wake[0].dispatchedBy, OWNER);
      assert.ok(wake[0].prompt.split('\n').includes(ciWakeMarker('abc1234', 'passing')));

      clock += 2 * 60 * 60 * 1000;
      await run();
      const after = await store.listItems(URL_KEY, { rootItemId: worker._id });
      assert.equal(after.filter((row) => row.followUpTo === worker._id).length, 1);
    });

    test('a not-owner is refused (422) and nothing is queued', async () => {
      ownerAllowed = false;
      const worker = await seedParked();
      await buildRun({ extra: real })();
      const queued = await store.listItems(URL_KEY, { rootItemId: worker._id });
      assert.equal(queued.filter((row) => row.followUpTo === worker._id).length, 0);
    });
  });
});
