/**
 * LIN-3313 (Phase 3 of LIN-2950, S2) — the owner-credential run reader,
 * `lib/share-run-reader.js`.
 *
 * Run with: node --test tests/unit/share-run-reader.test.js
 *
 * Pins the reader's contract: the owner credential through
 * `resolveWorkspaceAccess` (a no-token reason short-circuits), the Linear
 * test-token short-circuit, no request-coupled input, the fixed non-owner
 * posture (`viewerIsOwner:false`, `runnerReady:false`, `stopAt:null`,
 * `variant:'unknown'`), no proposals read, and PR state ONLY through the
 * shared PR-state store — never `readPrStatusFailOpen`. The composition below
 * the reader is real (tests/fixtures/share-run-harness.js); only the edges
 * are counting fakes.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShareRunReader, createStorePrStatusAdapter, RUN_NOT_FOUND } from '../../lib/share-run-reader.js';
import { readPrStatusFailOpen, primeFailOpenPrStatus, clearFailOpenPrStatus } from '../../lib/github-pr-status.js';
import { PR_STATE_VIA, PR_STATE_OPEN_TTL_MS } from '../../lib/pr-state-store.js';
import { createRunHarness, URL_KEY, OWNER, SID, REPO, RUNNING, loopAt } from '../fixtures/share-run-harness.js';

const MIN = 60 * 1000;
let priorEnv;
before(() => { priorEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test'; });
after(() => { process.env.NODE_ENV = priorEnv; clearFailOpenPrStatus(); });

describe('readOwnerRun: the owner credential', () => {
  test('resolves the owner credential for (urlKey, ownerAccountId) — never an unscoped call', async () => {
    const h = createRunHarness();
    await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.deepEqual(h.calls.access, [[URL_KEY, OWNER]]);
  });

  test('no token returns the credential reason and reads nothing else', async () => {
    const h = createRunHarness();
    h.state.access = { token: null, reason: 'session_expired', provider: null };
    const out = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.deepEqual(out, { reason: 'session_expired', run: null });
    assert.equal(h.counts.local, 0, 'no local read');
    assert.equal(h.counts.comments + h.counts.fetchProjects + h.counts.github, 0, 'no tracker or GitHub read');
  });

  test('an unknown run (or another workspace\'s) is run_not_found with no external read', async () => {
    const h = createRunHarness();
    assert.deepEqual(await h.reader.readOwnerRun(URL_KEY, OWNER, 'no-such-run'), { reason: RUN_NOT_FOUND, run: null });
    assert.deepEqual(await h.reader.readOwnerRun('ws-other', OWNER, SID), { reason: RUN_NOT_FOUND, run: null });
    assert.deepEqual(h.calls.local, [[URL_KEY, 'no-such-run'], ['ws-other', SID]], 'the local half is scoped by the share\'s urlKey');
    assert.equal(h.calls.external.length, 0);
    assert.equal(h.counts.comments + h.counts.github, 0);
  });

  test('the Linear test-token short-circuit projects the local half only (no tracker, no GitHub)', async () => {
    const h = createRunHarness();
    h.state.access = { token: 'test-token', reason: 'ok', provider: 'linear' };
    const out = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(out.reason, 'ok');
    assert.equal(out.run.session.sessionId, SID);
    assert.equal(out.run.runEvidence, null);
    assert.equal(out.run.prState.state, 'none');
    assert.equal(h.calls.external.length, 0);
    assert.equal(h.counts.comments + h.counts.fetchProjects + h.counts.github, 0);
  });

  test('a thrown external read propagates (the route turns it into row 6/7), never "no evidence"', async () => {
    const h = createRunHarness();
    h.provider.fetchIssueComments = async () => { throw new Error('tracker down'); };
    await assert.rejects(() => h.reader.readOwnerRun(URL_KEY, OWNER, SID), /tracker down/);
  });
});

describe('readOwnerRun: no request input, the fixed non-owner posture, no proposals', () => {
  test('the signatures take no request: readOwnerRun(urlKey, owner, sessionId), probeRun(urlKey, sessionId)', () => {
    const h = createRunHarness();
    assert.equal(h.reader.readOwnerRun.length, 3);
    assert.equal(h.reader.probeRun.length, 2);
    const src = createShareRunReader.toString();
    assert.ok(!/\breq\b|\breq\.|session\.workspaces|features/.test(src), 'no request-coupled input in the reader');
  });

  test('the external read is the guest posture: viewerIsOwner false, no run facts, runner not ready, fail-closed', async () => {
    const h = createRunHarness();
    await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(h.calls.external.length, 1);
    const { workspace, opts } = h.calls.external[0];
    assert.deepEqual(workspace, { urlKey: URL_KEY }, 'no request workspace is handed down');
    assert.equal(opts.viewerIsOwner, false);
    assert.equal(opts.runFacts, null);
    assert.equal(opts.runnerReady, false);
    assert.equal(opts.failOpen, false);
    assert.equal(opts.binding.provider, h.provider, 'the owner credential\'s provider');
    assert.equal(opts.binding.callScope, 'owner-scope', 'scope ?? token');
  });

  test('readRunEvidence itself receives stopAt null, variant unknown, runnerReady false, viewerIsOwner false', async () => {
    const seen = [];
    const h = createRunHarness({ readRunEvidenceImpl: async (args) => { seen.push(args); return null; } });
    await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(seen.length, 1);
    const args = seen[0];
    assert.equal(args.viewerIsOwner, false);
    assert.equal(args.stopAt, null);
    assert.equal(args.variant, 'unknown');
    assert.equal(args.runnerReady, false);
    assert.equal(args.urlKey, URL_KEY);
    assert.equal(args.provider, h.provider);
    assert.equal(args.callScope, 'owner-scope');
    assert.notEqual(args.readPrStatus, readPrStatusFailOpen, 'never the fail-open reader');
    assert.equal(args.allowlist, h.prStateStore.allowlistCache.get(URL_KEY).value, 'the store\'s cached allowlist');
  });

  test('the projection carries only closeOut.status — no owner flag, PR identity or workspace key', async () => {
    const h = createRunHarness();
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.deepEqual(Object.keys(run.runEvidence.closeOut), ['status']);
    assert.ok(!JSON.stringify(run).includes(URL_KEY), 'the workspace key is never stored');
  });

  test('proposals are never read', async () => {
    const h = createRunHarness();
    await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    await h.reader.probeRun(URL_KEY, SID);
    assert.equal(h.counts.proposals, 0);
    assert.ok(!('proposals' in h.calls.external[0].opts));
  });
});

describe('readOwnerRun: PR state only through the shared store', () => {
  test('the PR read goes through the store (cache filled, budget spent), never readPrStatusFailOpen', async () => {
    const h = createRunHarness();
    // A DIFFERENT value primed into the fail-open cache: if the reader used it,
    // the projection would say merged.
    primeFailOpenPrStatus({ repo: REPO, number: 12, value: { repo: REPO, readable: true, number: 12, state: 'closed', merged: true, head: { sha: 'f00' }, checks: [] } });
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(run.prState.state, 'open', 'the store\'s read, not the fail-open cache');
    assert.equal(h.counts.github, 4, 'one real read through the store\'s counting fetch');
    assert.equal(h.prStateStore.budgetUsed(h.clock.t), 4, 'the shared 36/h budget was spent');
    assert.ok(h.prStateStore.cache.has(`${REPO}#12`), 'the shared repo#number cache was filled');
    assert.ok(h.prStateStore.allowlistCache.has(URL_KEY), 'the allowlist came from the store\'s cache');
    const { opts } = h.calls.external[0];
    assert.notEqual(opts.readPrStatus, readPrStatusFailOpen);
    assert.equal(opts.allowlist, h.prStateStore.allowlistCache.get(URL_KEY).value);
  });

  test('the header PR state and the evidence "now" row come from one read with one asOf', async () => {
    const h = createRunHarness();
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    const asOf = new Date(h.clock.t).toISOString();
    assert.equal(run.prState.asOf, asOf);
    assert.equal(run.runEvidence.evidence.checked.now.asOf, asOf);
    assert.deepEqual(run.prRef, { repo: REPO, number: 12 });
  });

  test('a settled run\'s cache entry older than its last step forces exactly one read', async () => {
    const h = createRunHarness();
    // Cached 30 min ago and still inside its TTL, but older than the last step (20 min ago).
    h.prStateStore.cache.set(`${REPO}#12`, { value: { readable: true, state: 'closed', merged: true, number: 12, checks: [] }, expiresAt: h.clock.t + 60 * MIN, fetchedAt: h.clock.t - 30 * MIN });
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(h.counts.github, 4, 'the floor (lastFinishedAt) forced one real read');
    assert.equal(run.prState.asOf, new Date(h.clock.t).toISOString());
    assert.equal(run.settled, true);
  });

  test('an unsettled run reads the same old entry from cache (no floor, no spend)', async () => {
    const h = createRunHarness();
    h.state.session.loops.push(loopAt(h.clock, 'f1', RUNNING, { startedAgoMin: 5 }));
    const fetchedAt = h.clock.t - 30 * MIN;
    h.prStateStore.cache.set(`${REPO}#12`, { value: { readable: true, state: 'open', merged: false, number: 12, checks: [] }, expiresAt: h.clock.t + PR_STATE_OPEN_TTL_MS, fetchedAt });
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    assert.equal(h.counts.github, 0);
    assert.equal(run.prState.asOf, new Date(fetchedAt).toISOString(), 'the cache entry keeps its own stamp');
    assert.equal(run.settled, false);
  });

  test('the adapter records the store read and answers "state not reported" when nothing was read', async () => {
    const reads = [];
    const store = { async readResult(ref, nowMs, opts) { reads.push({ ref, nowMs, opts }); return { result: null, fetchedAt: null, via: PR_STATE_VIA.UNAVAILABLE }; } };
    const adapter = createStorePrStatusAdapter(store, 123, 45);
    assert.equal(adapter.recorded(), null);
    const result = await adapter.readPrStatus({ repo: REPO, number: 12, provider: {}, allowlist: new Set() });
    assert.deepEqual(result, { repo: REPO, readable: false, state: 'unknown', reason: 'state not reported' });
    assert.deepEqual(reads, [{ ref: { repo: REPO, number: 12 }, nowMs: 123, opts: { minFetchedAt: 45 } }]);
    assert.deepEqual(adapter.recorded(), { result: null, fetchedAt: null, via: PR_STATE_VIA.UNAVAILABLE });
  });
});

describe('probeRun: the Mongo-only local probe', () => {
  test('answers settled + the same settledKey the projection stores, with no credential or provider read', async () => {
    const h = createRunHarness();
    const { run } = await h.reader.readOwnerRun(URL_KEY, OWNER, SID);
    const before = { ...h.counts };
    const probe = await h.reader.probeRun(URL_KEY, SID);
    assert.deepEqual(probe, { reason: 'ok', settled: true, settledKey: run.settledKey });
    assert.equal(h.counts.access, before.access, 'no credential resolution');
    assert.equal(h.counts.comments + h.counts.fetchProjects + h.counts.github, before.comments + before.fetchProjects + before.github, 'no tracker or GitHub read');
    assert.equal(h.counts.local, before.local + 1);
  });

  test('a running follow-up makes the probe unsettled; a gone run is run_not_found', async () => {
    const h = createRunHarness();
    h.state.session.loops.push(loopAt(h.clock, 'f1', RUNNING, { startedAgoMin: 5 }));
    assert.equal((await h.reader.probeRun(URL_KEY, SID)).settled, false);
    h.state.session = null;
    assert.deepEqual(await h.reader.probeRun(URL_KEY, SID), { reason: RUN_NOT_FOUND, settled: false, settledKey: null });
  });

  test('a probe throw propagates (a failed probe is a failed refresh)', async () => {
    const h = createRunHarness();
    h.state.localThrows = true;
    await assert.rejects(() => h.reader.probeRun(URL_KEY, SID), /mongo down/);
  });
});

describe('server.js wiring', () => {
  test('the share router gets the run reader, which gets the ONE PR-state store and the injected settle predicate', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const reader = src.match(/createShareRunReader\(\{([^}]*)\}\)/);
    assert.ok(reader, 'server.js builds the run reader');
    for (const dep of ['resolveWorkspaceAccess', 'prStateStore', 'sessionSettleState', 'sessionIsSettled', 'enrichLoop', 'runLoader.loadRunLocal', 'runLoader.readRunExternal']) {
      assert.ok(reader[1].includes(dep), `the reader is given ${dep}`);
    }
    assert.ok(!/readPrStatusFailOpen/.test(reader[1]));
    const routes = src.match(/app\.use\(createShareRoutes\(\{([^}]*)\}\)\)/);
    assert.ok(routes, 'the share router is mounted');
    assert.match(routes[1], /readOwnerRun: shareRunReader\.readOwnerRun/);
    assert.match(routes[1], /probeRun: shareRunReader\.probeRun/);
    assert.equal((src.match(/createPrStateStore\(/g) || []).length, 1, 'still exactly one PR-state store');
  });
});
