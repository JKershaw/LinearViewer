/**
 * LIN-3313 (Phase 3 of LIN-2950, S4) — run share refresh, revalidate and the
 * settling gate, through the REAL `/s/:token` route.
 *
 * Run with: node --test tests/unit/share-run-refresh.test.js
 *
 * The route, the run reader, the dashboard router's `readRunExternal`, the
 * real `readRunEvidence`, the PR-state store, the projection, the guest
 * renderer and the scan are all real (tests/fixtures/share-run-harness.js).
 * The edges count: tracker (`comments`, `fetchProjects`), GitHub (`github`),
 * the owner credential (`access`) and the Mongo-only local half (`local`).
 * The session the local half returns is mutable, so a test can change the
 * run "between two probes".
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunHarness, makeShareStore, runRecord, buildShareApp, request, age, resetCounts, loopAt,
  TOKEN, URL_KEY, REPO, SID, DONE, RUNNING, MARKERLESS_COMPLETE
} from '../fixtures/share-run-harness.js';
import { guestParagraphKey, guestSession, PARAGRAPH_GRACE_MS } from '../../lib/guest-run.js';
import { PR_STATE_UPSTREAM_LIMIT, PR_STATE_OPEN_TTL_MS } from '../../lib/pr-state-store.js';
import { createShareRoutes, MIN_REFRESH_INTERVAL_MS, FAILURE_BACKOFF_MS, SNAPSHOT_TTL_MS } from '../../routes/share.js';

const MIN = 60 * 1000;
let priorEnv;
before(() => { priorEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test'; });
after(() => { process.env.NODE_ENV = priorEnv; });

/** A harness + store + app whose first GET has already stored a snapshot. */
async function seeded({ mutate } = {}) {
  const h = createRunHarness();
  if (mutate) mutate(h);
  const store = makeShareStore(runRecord());
  const app = buildShareApp({ store, harness: h });
  const first = await request(app, `/s/${TOKEN}`);
  assert.equal(first.status, 200, 'the seeding refresh served');
  return { h, store, app, first };
}

function savedSnapshots(store) {
  return store.calls.saveSnapshot.filter(c => c.snapshot != null);
}

describe('settled revalidate', () => {
  test('a settled snapshot whose run is unchanged is revalidated: zero tracker/GitHub/credential reads, snapshotAt bumped', async () => {
    const { h, store, app } = await seeded();
    const frozen = structuredClone(store.record.snapshot);
    assert.equal(frozen.settled, true, 'precondition: the first refresh settled');
    age(store);
    const agedAt = store.record.snapshotAt.getTime();
    resetCounts(h.counts);

    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      { comments: h.counts.comments, fetchProjects: h.counts.fetchProjects, github: h.counts.github, access: h.counts.access },
      { comments: 0, fetchProjects: 0, github: 0, access: 0 }
    );
    assert.equal(h.counts.local, 1, 'exactly one local probe');
    assert.deepEqual(store.record.snapshot, frozen, 'the same snapshot, re-saved');
    assert.ok(store.record.snapshotAt.getTime() > agedAt, 'snapshotAt moved forward');
    assert.ok(!res.body.includes('data-testid="share-stale"'), 'a revalidated serve is not stale');
  });

  test('revoke on a frozen snapshot is 410 with no read at all', async () => {
    const { h, store, app } = await seeded();
    store.record.revokedAt = new Date();
    age(store);
    resetCounts(h.counts);
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 410);
    assert.ok(!res.body.includes('Shared run task'));
    assert.equal(h.counts.local + h.counts.access + h.counts.comments + h.counts.github, 0);
  });
});

describe('reopen and the settledKey', () => {
  test('a running follow-up reopens the run: full read, un-frozen, the step shown as running', async () => {
    const { h, store, app } = await seeded();
    h.state.session.loops.push(loopAt(h.clock, 'f1', RUNNING, { startedAgoMin: 2 }));
    age(store);
    resetCounts(h.counts);
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(h.counts.comments, 1, 'a full read');
    assert.equal(store.record.snapshot.settled, false, 'un-frozen');
    assert.ok(store.record.snapshot.session.loops.some(l => l.loopId === 'f1'));
    assert.match(res.body, /Step f1/);
  });

  test('a follow-up that started AND ended between two probes moves the key → full read, the step included', async () => {
    const { h, store, app } = await seeded();
    const oldKey = store.record.snapshot.settledKey;
    h.state.session.loops.push(loopAt(h.clock, 'f1', DONE, { startedAgoMin: 15, endedAgoMin: 12 }));
    const probe = await h.reader.probeRun(URL_KEY, SID);
    assert.equal(probe.settled, true, 'still settled: every loop is terminal');
    assert.notEqual(probe.settledKey, oldKey, 'but the key moved');
    age(store);
    resetCounts(h.counts);
    await request(app, `/s/${TOKEN}`);
    assert.equal(h.counts.comments, 1, 'a full read, not a revalidate');
    assert.ok(store.record.snapshot.session.loops.some(l => l.loopId === 'f1'));
    assert.equal(store.record.snapshot.settledKey, probe.settledKey);
  });

  test('R4: a markerless agentState "complete" follow-up between probes keeps the run settled but forces a FULL read whose snapshot has the step', async () => {
    const { h, store, app } = await seeded();
    const oldKey = store.record.snapshot.settledKey;
    h.state.session.loops.push(loopAt(h.clock, 'f2', MARKERLESS_COMPLETE, { startedAgoMin: 15, endedAgoMin: 12 }));
    const probe = await h.reader.probeRun(URL_KEY, SID);
    assert.equal(probe.settled, true, 'sessionIsSettled stays true (markerless complete is terminal)');
    assert.notEqual(probe.settledKey, oldKey);
    age(store);
    resetCounts(h.counts);
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(h.counts.comments, 1, 'full read');
    assert.equal(h.counts.access, 1);
    const stub = store.record.snapshot.session.loops.find(l => l.loopId === 'f2');
    assert.ok(stub, 'the new step is in the snapshot');
    assert.match(res.body, /Step f2/);
  });

  test('an unrelated revalidate leaves the key alone (no full read)', async () => {
    const { h, store, app } = await seeded();
    // A field the key does not read (the issue title of a step) changes.
    h.state.session.loops[1].issueTitle = 'Step w1 (renamed)';
    age(store);
    resetCounts(h.counts);
    await request(app, `/s/${TOKEN}`);
    assert.equal(h.counts.comments, 0, 'revalidated');
  });
});

describe('F1 end to end', () => {
  test('a settled snapshot of a merged PR serves the open-at-merge ledger marker, and still does after a revalidate', async () => {
    const { h, store, app, first } = await seeded({ mutate: (h) => { h.state.pr = { state: 'closed', merged: true }; } });
    assert.equal(store.record.snapshot.settled, true);
    assert.equal(store.record.snapshot.runEvidence.closeOut.status, 'merged');
    assert.match(first.body, /data-testid="run-evidence-ledger-open-at-merge"/);
    age(store);
    resetCounts(h.counts);
    const again = await request(app, `/s/${TOKEN}`);
    assert.equal(h.counts.github, 0, 'revalidated');
    assert.match(again.body, /data-testid="run-evidence-ledger-open-at-merge"/);
  });
});

describe('the paragraph (R5) and its grace', () => {
  function recent(h) {
    // Every loop ended 2 minutes ago: inside the 10-minute paragraph grace.
    h.state.session.loops = [loopAt(h.clock, SID, DONE, { endedAgoMin: 2 }), loopAt(h.clock, 'w1', DONE, { endedAgoMin: 2 })];
  }
  const key = (h) => guestParagraphKey(guestSession(h.state.session));

  test('no paragraph inside the grace keeps the snapshot unsettled; after the grace it settles without one', async () => {
    const h = createRunHarness();
    recent(h);
    assert.equal((await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run.settled, false);
    h.clock.t += PARAGRAPH_GRACE_MS;
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(run.settled, true);
    assert.equal(run.runParagraph, null);
  });

  test('a matched FINAL paragraph settles inside the grace and is carried', async () => {
    const h = createRunHarness();
    recent(h);
    h.state.paragraph = { paragraph: 'The run shipped the link.', inputHash: key(h), final: true };
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(run.settled, true);
    assert.equal(run.runParagraph, 'The run shipped the link.');
  });

  test('R5: a matched but NON-final paragraph is dropped and keeps the snapshot unsettled until the grace', async () => {
    const h = createRunHarness();
    recent(h);
    h.state.paragraph = { paragraph: 'Draft words.', inputHash: key(h), final: false };
    const early = (await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run;
    assert.equal(early.settled, false);
    assert.equal(early.runParagraph, null);
    h.clock.t += PARAGRAPH_GRACE_MS;
    assert.equal((await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run.settled, true);
  });

  test('a mismatched paragraph (other steps) is dropped and does not settle inside the grace', async () => {
    const h = createRunHarness();
    recent(h);
    h.state.paragraph = { paragraph: 'About other steps.', inputHash: 'not-this-key', final: true };
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(run.settled, false);
    assert.equal(run.runParagraph, null);
  });
});

describe('the PR read: budget and freshness (gate b)', () => {
  test('budget exhausted at settle: settled false, no GitHub call, the old asOf kept', async () => {
    const h = createRunHarness();
    const oldFetchedAt = h.clock.t - 30 * MIN; // before the last step (20 min ago)
    h.prStateStore.cache.set(`${REPO}#12`, { value: { readable: true, state: 'open', merged: false, number: 12, checks: [] }, expiresAt: h.clock.t + PR_STATE_OPEN_TTL_MS, fetchedAt: oldFetchedAt });
    for (let i = 0; i < PR_STATE_UPSTREAM_LIMIT; i++) h.prStateStore.bucket.push(h.clock.t);
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(h.counts.github, 0);
    assert.equal(run.settled, false);
    assert.equal(run.prState.state, 'open', 'the stale value is still shown');
    assert.equal(run.prState.asOf, new Date(oldFetchedAt).toISOString(), 'with its true, older stamp');
  });

  test('a cache entry older than the last step forces exactly one fetch, then settles', async () => {
    const h = createRunHarness();
    h.prStateStore.cache.set(`${REPO}#12`, { value: { readable: true, state: 'open', merged: false, number: 12, checks: [] }, expiresAt: h.clock.t + PR_STATE_OPEN_TTL_MS, fetchedAt: h.clock.t - 30 * MIN });
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(h.counts.github, 4, 'one read (4 upstream calls)');
    assert.equal(run.settled, true);
    // A second refresh at the same instant is a pure cache hit.
    await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(h.counts.github, 4);
  });

  test('a cache entry fetched after the last step costs nothing', async () => {
    const h = createRunHarness();
    const fetchedAt = h.clock.t - 5 * MIN;
    h.prStateStore.cache.set(`${REPO}#12`, { value: { readable: true, state: 'closed', merged: true, number: 12, checks: [] }, expiresAt: h.clock.t + 60 * MIN, fetchedAt });
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(h.counts.github, 0);
    assert.equal(run.settled, true);
    assert.equal(run.prState.asOf, new Date(fetchedAt).toISOString());
  });
});

describe('failures inside the L4 try/catch (rows 6 and 7)', () => {
  test('a probe throw on a settled snapshot serves last-good "as of" and stores nothing', async () => {
    const { h, store, app } = await seeded();
    const frozen = structuredClone(store.record.snapshot);
    age(store);
    h.state.localThrows = true;
    const savesBefore = savedSnapshots(store).length;
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /data-testid="share-stale"/);
    assert.deepEqual(store.record.snapshot, frozen);
    assert.equal(savedSnapshots(store).length, savesBefore);
  });

  test('a run that is gone: last-good with a snapshot (row 6), 503 without (row 7)', async () => {
    const { h, store, app } = await seeded();
    h.state.session = null;
    age(store);
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /data-testid="share-stale"/);

    const h2 = createRunHarness();
    h2.state.session = null;
    const empty = makeShareStore(runRecord());
    const res2 = await request(buildShareApp({ store: empty, harness: h2 }), `/s/${TOKEN}`);
    assert.equal(res2.status, 503);
    assert.equal(res2.body, '');
  });

  test('a store-write throw is a refresh failure: row 6 with a snapshot, row 7 without — never a 500', async () => {
    const { store, app } = await seeded();
    age(store);
    store.saveThrows = true;
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /data-testid="share-stale"/);

    const h2 = createRunHarness();
    const empty = makeShareStore(runRecord());
    empty.saveThrows = true;
    const res2 = await request(buildShareApp({ store: empty, harness: h2 }), `/s/${TOKEN}`);
    assert.equal(res2.status, 503);
  });

  test('a credential failure on an unsettled snapshot serves last-good', async () => {
    const { h, store, app } = await seeded({ mutate: (h) => { h.state.session.loops.push(loopAt(h.clock, 'f1', RUNNING, { startedAgoMin: 2 })); } });
    assert.equal(store.record.snapshot.settled, false);
    h.state.access = { token: null, reason: 'session_expired' };
    age(store);
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /data-testid="share-stale"/);
  });
});

describe('throttle, backoff and single-flight are unchanged for both kinds', () => {
  function collectionRecord(overrides = {}) {
    return runRecord({ subject: { type: 'collection', kind: 'label', id: 'bug' }, snapshot: { title: 'T', items: [] }, ...overrides });
  }

  for (const kind of ['collection', 'run']) {
    test(`${kind}: a fresh snapshot (< ${SNAPSHOT_TTL_MS / 1000} s) serves with zero reads`, async () => {
      const h = createRunHarness();
      let collectionReads = 0;
      const seededRun = kind === 'run' ? (await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run : null;
      const store = makeShareStore(kind === 'run'
        ? runRecord({ snapshot: seededRun, snapshotAt: new Date(Date.now() - 5000) })
        : collectionRecord({ snapshotAt: new Date(Date.now() - 5000) }));
      resetCounts(h.counts);
      const app = buildShareApp({ store, harness: h, readOwnerIssues: async () => { collectionReads++; return { reason: 'ok', issues: [] }; } });
      assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
      assert.equal(collectionReads + h.counts.local + h.counts.access, 0);
    });

    test(`${kind}: past the 60 s TTL and MIN_REFRESH_INTERVAL_MS a successful snapshot is due — settled or not, no TTL exemption`, async () => {
      const h = createRunHarness();
      let collectionReads = 0;
      const seededRun = kind === 'run' ? (await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run : null;
      if (seededRun) assert.equal(seededRun.settled, true, 'a SETTLED run is still re-checked');
      const at = new Date(Date.now() - Math.max(SNAPSHOT_TTL_MS, MIN_REFRESH_INTERVAL_MS) - 1000);
      const store = makeShareStore(kind === 'run'
        ? runRecord({ snapshot: seededRun, snapshotAt: at, lastRefreshAttemptAt: at })
        : collectionRecord({ snapshotAt: at, lastRefreshAttemptAt: at }));
      resetCounts(h.counts);
      const app = buildShareApp({ store, harness: h, readOwnerIssues: async () => { collectionReads++; return { reason: 'ok', issues: [] }; } });
      assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
      assert.equal(kind === 'run' ? h.counts.local : collectionReads, 1, 'one refresh (a probe, for a settled run)');
    });

    test(`${kind}: after a failure, no re-read inside FAILURE_BACKOFF_MS; last-good served`, async () => {
      const h = createRunHarness();
      let collectionReads = 0;
      const seededRun = kind === 'run' ? (await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID)).run : null;
      const snapAt = new Date(Date.now() - 10 * MIN);
      const failedAt = new Date(Date.now() - 2 * MIN); // newer than the snapshot → a failure
      const store = makeShareStore(kind === 'run'
        ? runRecord({ snapshot: seededRun, snapshotAt: snapAt, lastRefreshAttemptAt: failedAt })
        : collectionRecord({ snapshotAt: snapAt, lastRefreshAttemptAt: failedAt }));
      resetCounts(h.counts);
      const app = buildShareApp({ store, harness: h, readOwnerIssues: async () => { collectionReads++; return { reason: 'ok', issues: [] }; } });
      const res = await request(app, `/s/${TOKEN}`);
      assert.equal(res.status, 200);
      assert.match(res.body, /data-testid="share-stale"/);
      assert.equal(collectionReads + h.counts.local + h.counts.access, 0);
      assert.ok(FAILURE_BACKOFF_MS > 2 * MIN);
    });

    test(`${kind}: concurrent due GETs share one refresh (single-flight)`, async () => {
      const h = createRunHarness();
      let collectionReads = 0;
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const store = makeShareStore(kind === 'run' ? runRecord() : collectionRecord({ snapshot: null }));
      const app = buildShareApp({
        store,
        harness: h,
        readOwnerIssues: async () => { collectionReads++; await gate; return { reason: 'ok', issues: [] }; },
        withTimeout: async (p) => { await gate; return p; }
      });
      const server = app.listen(0, '127.0.0.1');
      try {
        await new Promise(resolve => server.once('listening', resolve));
        const url = `http://127.0.0.1:${server.address().port}/s/${TOKEN}`;
        const pending = [fetch(url), fetch(url), fetch(url)];
        await new Promise(resolve => setTimeout(resolve, 50));
        release();
        const statuses = (await Promise.all(pending)).map(r => r.status);
        assert.deepEqual(statuses, [200, 200, 200]);
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
      assert.equal(kind === 'run' ? h.counts.access : collectionReads, 1, 'one read for three GETs');
    });
  }
});

describe('one PR budget across the dashboard router and the share router (integration)', () => {
  test('the dashboard pr-state route fills the shared store; the share refresh then reads from it with no GitHub call, and its own read spends the same budget', async () => {
    const h = createRunHarness();
    // Re-build the dashboard router with the harness's store injected, so the
    // route and the share reader hold ONE instance (as server.js wires it).
    const { createDashboardRoutes } = await import('../../routes/dashboard.js');
    const { InMemoryRunSummaryCacheStore } = await import('../../lib/run-summary-cache.js');
    const { InMemorySessionSummaryCacheStore } = await import('../../lib/session-summary-cache.js');
    const { InMemoryRunParagraphStore } = await import('../../lib/run-paragraph-store.js');
    const dashboard = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      runParagraphStore: new InMemoryRunParagraphStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      prStateStore: h.prStateStore,
      prState: {
        resolveProvider: () => ({ provider: h.provider, callScope: 'scope' }),
        loadRun: async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] })
      }
    });
    const layer = dashboard.stack.find(l => l.route?.path === '/workspace/:urlKey/api/run/:runId/pr-state');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; } };
    await handler({ workspace: { urlKey: URL_KEY }, params: { runId: SID }, session: {}, query: {} }, res);
    assert.equal(res.jsonBody.state, 'open');
    assert.equal(h.counts.github, 4, 'the dashboard route read once');
    assert.equal(h.prStateStore.budgetUsed(h.clock.t), 4);

    // The share refresh (an UNSETTLED run, so no freshness floor) hits the cache.
    h.state.session.loops.push(loopAt(h.clock, 'f1', RUNNING, { startedAgoMin: 2 }));
    const store = makeShareStore(runRecord());
    await request(buildShareApp({ store, harness: h }), `/s/${TOKEN}`);
    assert.equal(h.counts.github, 4, 'no second GitHub read: the share router used the dashboard\'s cache entry');
    assert.equal(store.record.snapshot.prState.asOf, new Date(h.clock.t).toISOString());

    // A spent budget is spent for both: the share's settle read is refused.
    for (let i = h.prStateStore.budgetUsed(h.clock.t); i < PR_STATE_UPSTREAM_LIMIT; i++) h.prStateStore.bucket.push(h.clock.t);
    h.state.session.loops.pop();
    h.prStateStore.cache.get(`${REPO}#12`).fetchedAt = h.clock.t - 30 * MIN; // predates the last step
    const { run } = await h.reader.readOwnerRun(URL_KEY, 'acct-1', SID);
    assert.equal(h.counts.github, 4, 'the shared cap refuses the share\'s read too');
    assert.equal(run.settled, false);
  });
});

test('createShareRoutes still mounts without a run reader (old wiring): a run record fails closed to 503', async () => {
  const store = makeShareStore(runRecord());
  const app = buildShareApp({ store, harness: null });
  const res = await request(app, `/s/${TOKEN}`);
  assert.equal(res.status, 503);
  assert.equal(typeof createShareRoutes, 'function');
});
