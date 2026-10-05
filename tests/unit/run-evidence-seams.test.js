/**
 * LIN-3311 (S2a of LIN-2950) — the run-evidence seams the share reader will use.
 *
 *   - `readRunEvidence({ allowlist })`: a pre-resolved allowlist (the shared
 *     PR-state store's cached one) replaces the reader's own uncached
 *     `resolveRepoAllowlist` tracker read; omitted, the read happens as before.
 *   - `readRunEvidence` without `viewerIsOwner` now builds a NON-owner model
 *     (`closeOut.owner === false`); both real callers pass the flag explicitly,
 *     and the `/api/run-evidence` route's own `() => true` default is unchanged.
 *   - The run page's loader split: `loadRunLocal` / `readRunExternal`
 *     (`router.runLoader`) take no request, default every owner-only input to
 *     the guest-safe value, and the owner page still calls the reader with
 *     exactly the arguments it did before the split.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

before(() => { process.env.NODE_ENV = 'test'; });

const PR_A = 'https://github.com/acme/widget/pull/12';
const comment = (body, createdAt = '2026-07-01T00:00:00.000Z') => ({ body, createdAt, user: 'worker' });

function countingProvider({ repo = 'acme/widget', comments = [comment(`opened ${PR_A}`)] } = {}) {
  const counts = { fetchProjects: 0, comments: 0 };
  return {
    counts,
    async fetchIssueComments() { counts.comments += 1; return comments; },
    async fetchProjects() { counts.fetchProjects += 1; return { projects: [{ id: 'p1', name: 'P', content: `repo=${repo}` }], issues: [] }; }
  };
}

const unreadable = async () => ({ readable: false, state: 'unknown', reason: 'stub' });

describe('readRunEvidence: optional allowlist', () => {
  test('a provided allowlist skips the tracker allowlist read and is the filter actually used', async () => {
    const provider = countingProvider();
    const kept = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable, allowlist: new Set(['acme/widget']) });
    assert.equal(provider.counts.fetchProjects, 0, 'no resolveRepoAllowlist read');
    assert.equal(kept.state.prUrls.length, 1);

    const filtered = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable, allowlist: new Set(['other/repo']) });
    assert.equal(provider.counts.fetchProjects, 0);
    assert.equal(filtered.state.prUrls.length, 0, 'the provided set, not the tracker one, filtered the PR out');
  });

  test('omitted, the reader resolves the allowlist itself, as before', async () => {
    const provider = countingProvider();
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable });
    assert.equal(provider.counts.fetchProjects, 1);
    assert.equal(model.state.prUrls.length, 1);
  });

  test('the provided allowlist reaches the PR reader too', async () => {
    const provider = countingProvider();
    const allowlist = new Set(['acme/widget']);
    let seen = null;
    await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', allowlist, readPrStatus: async (args) => { seen = args.allowlist; return { readable: false }; } });
    assert.equal(seen, allowlist);
  });
});

describe('readRunEvidence: viewerIsOwner defaults to false', () => {
  test('flag omitted → closeOut.owner === false', async () => {
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', provider: countingProvider(), callScope: 's', readPrStatus: unreadable });
    assert.equal(model.closeOut.owner, false);
  });

  test('explicit true and false are honoured', async () => {
    const owner = await readRunEvidence({ issueIdentifier: 'LIN-1', provider: countingProvider(), callScope: 's', readPrStatus: unreadable, viewerIsOwner: true });
    const guest = await readRunEvidence({ issueIdentifier: 'LIN-1', provider: countingProvider(), callScope: 's', readPrStatus: unreadable, viewerIsOwner: false });
    assert.equal(owner.closeOut.owner, true);
    assert.equal(guest.closeOut.owner, false);
  });

  test('the /api/run-evidence route still defaults its viewer to owner (() => true), unchanged', async () => {
    const provider = countingProvider();
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      runEvidence: { resolveProvider: () => ({ provider, callScope: 's' }), readPrStatus: unreadable }
    });
    const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/api/run-evidence/:issueIdentifier' && l.route.methods.get);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; } };
    await handler({ session: {}, workspace: { urlKey: 'ws' }, params: { urlKey: 'ws', issueIdentifier: 'LIN-1' }, query: {} }, res, (err) => { if (err) throw err; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.closeOut.owner, true, 'the route passes viewerIsOwner(req) explicitly; its default is still owner');
  });
});

describe('run page loader split (routes/dashboard.js runLoader)', () => {
  const NOW_ISO = new Date().toISOString();
  const SID = 'sess-split';

  function workspaceData() {
    return {
      live: [],
      history: [
        { id: SID, kind: 'autopilot', issueIdentifier: 'LIN-10', issueTitle: 'Anchor title', promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken' },
        { id: 'w-split', sessionId: SID, issueIdentifier: 'LIN-11', issueTitle: 'Worker', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[evidence] opened PR', url: PR_A, timestamp: NOW_ISO }] }
      ],
      agentStatus: [
        { id: `as-${SID}`, dispatchId: SID, taskIdentifier: 'LIN-10', action: 'autopilot', status: 'completed', summary: 'done', timestamp: NOW_ISO },
        { id: 'as-w-split', dispatchId: 'w-split', taskIdentifier: 'LIN-11', action: 'implementation', status: 'completed', summary: 'done', timestamp: NOW_ISO }
      ]
    };
  }

  function makeRouter({ readRunEvidence: reader = null, runParagraphStore = new InMemoryRunParagraphStore() } = {}) {
    const data = { 'ws-a': workspaceData() };
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems(urlKey) { return withFreshDigests(data[urlKey]?.live || []); },
        async listHistory(urlKey) { return { items: withFreshDigests(data[urlKey]?.history || []) }; }
      },
      agentStatusStore: { async listStatus(urlKey) { return { items: data[urlKey]?.agentStatus || [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      runParagraphStore,
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      readRunEvidence: reader
    });
  }

  function capturingReader() {
    const calls = [];
    const reader = async (args) => { calls.push(args); return null; };
    return { calls, reader };
  }

  test('the router exposes both halves, and neither takes a request', () => {
    const { loadRunLocal, readRunExternal } = makeRouter().runLoader;
    assert.equal(typeof loadRunLocal, 'function');
    assert.equal(typeof readRunExternal, 'function');
    assert.equal(loadRunLocal.length, 2, '(urlKey, sessionId[, opts])');
    assert.equal(readRunExternal.length, 2, '(workspace, session[, opts])');
  });

  test('loadRunLocal returns the local model (session, anchor title, run view, stored paragraph); null when gone', async () => {
    const paragraphs = new InMemoryRunParagraphStore();
    await paragraphs.put('ws-a', SID, { paragraph: 'Stored words.', inputHash: 'h1', final: true });
    const { loadRunLocal } = makeRouter({ runParagraphStore: paragraphs }).runLoader;

    const local = await loadRunLocal('ws-a', SID, { now: NOW_ISO });
    assert.equal(local.session.sessionId, SID);
    assert.equal(local.anchorLoop.loopId, SID);
    assert.equal(local.anchorIssueTitle, 'Anchor title');
    assert.ok(local.runView && local.runView.progress, 'the run view is built');
    assert.ok(Array.isArray(local.issueContext));
    assert.equal(local.runParagraph, 'Stored words.');
    assert.equal(local.paragraph.inputHash, 'h1', 'the stored record is kept whole for a later key match');
    assert.equal(local.paragraph.final, true);

    assert.equal(await loadRunLocal('ws-a', 'no-such-session'), null);
  });

  test('readRunExternal defaults every owner-only input to the guest-safe value', async () => {
    const { calls, reader } = capturingReader();
    const { loadRunLocal, readRunExternal } = makeRouter({ readRunEvidence: reader }).runLoader;
    const { session } = await loadRunLocal('ws-a', SID);
    await readRunExternal({ urlKey: 'ws-a' }, session);
    assert.equal(calls.length, 1);
    const args = calls[0];
    assert.equal(args.viewerIsOwner, false);
    assert.equal(args.stopAt, null);
    assert.equal(args.variant, 'unknown');
    assert.equal(args.runnerReady, false);
    assert.equal(args.asked, session.seedIssue, 'no anchor title given → the seed');
    assert.deepEqual(args.evidenceUrls, [PR_A], 'the [evidence] URLs still corroborate');
    assert.ok(!('allowlist' in args) && !('readPrStatus' in args), 'reader defaults apply unless the caller supplies them');
  });

  test('readRunExternal passes a supplied allowlist and PR reader through', async () => {
    const { calls, reader } = capturingReader();
    const { loadRunLocal, readRunExternal } = makeRouter({ readRunEvidence: reader }).runLoader;
    const { session } = await loadRunLocal('ws-a', SID);
    const allowlist = new Set(['acme/widget']);
    const readPrStatus = async () => null;
    await readRunExternal({ urlKey: 'ws-a' }, session, { allowlist, readPrStatus });
    assert.equal(calls[0].allowlist, allowlist);
    assert.equal(calls[0].readPrStatus, readPrStatus);
  });

  test('readRunExternal is skipped (null) when the reader is unwired or there is no seed, and fails open', async () => {
    const { loadRunLocal, readRunExternal } = makeRouter().runLoader;
    const { session } = await loadRunLocal('ws-a', SID);
    assert.equal(await readRunExternal({ urlKey: 'ws-a' }, session), null, 'unwired');

    const { calls, reader } = capturingReader();
    const wired = makeRouter({ readRunEvidence: reader }).runLoader;
    assert.equal(await wired.readRunExternal({ urlKey: 'ws-a' }, { ...session, seedIssue: null }), null, 'no seed');
    assert.equal(calls.length, 0);

    const throwing = makeRouter({ readRunEvidence: async () => { throw new Error('tracker down'); } }).runLoader;
    const origError = console.error;
    console.error = () => {};
    try {
      assert.equal(await throwing.readRunExternal({ urlKey: 'ws-a' }, session), null, 'fail-open');
    } finally {
      console.error = origError;
    }
  });

  test('the owner page calls the reader with exactly the pre-split arguments', async () => {
    const { calls, reader } = capturingReader();
    const router = makeRouter({ readRunEvidence: reader });
    const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/observation/session/:sessionId' && l.route.methods.get);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send(b) { this.sentBody = b; return this; } };
    let nextErr = null;
    await handler({ session: { features: { dispatch: true }, workspaces: [{ urlKey: 'ws-a', name: 'A' }] }, workspace: { urlKey: 'ws-a' }, params: { sessionId: SID }, query: {} }, res, (err) => { nextErr = err; });
    assert.equal(nextErr, null);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    const args = calls[0];
    assert.deepEqual(Object.keys(args).sort(), ['asked', 'callScope', 'evidenceUrls', 'issueIdentifier', 'provider', 'runnerReady', 'stopAt', 'urlKey', 'variant', 'viewerIsOwner'],
      'the same keys the pre-split readSessionRunEvidence passed — no allowlist/readPrStatus on the owner page');
    assert.equal(args.viewerIsOwner, true, 'the owner page still passes true explicitly');
    assert.equal(args.asked, 'Anchor title');
    assert.equal(args.issueIdentifier, 'LIN-10');
    assert.equal(args.urlKey, 'ws-a');
    assert.equal(args.runnerReady, true, 'runnerReady still comes from the request\'s dispatch flag');
    assert.equal(args.stopAt, null);
    assert.equal(args.variant, 'unknown');
  });
});
