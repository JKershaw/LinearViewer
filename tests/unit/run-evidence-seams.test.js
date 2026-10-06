/**
 * LIN-3311 — the run-evidence seams.
 *
 *   - `readRunEvidence` without `viewerIsOwner` builds a NON-owner model
 *     (`closeOut.owner === false`); both real callers pass the flag explicitly,
 *     and the `/api/run-evidence` route's own `() => true` default is unchanged.
 *   - The owner run page still calls the reader with exactly the arguments it
 *     did before the loader split (the split's request-free halves were removed
 *     by LIN-3325; the owner page path is pinned here).
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

describe('run page owner path (routes/dashboard.js)', () => {
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

// LIN-3329: the task page's one tracker read already carries the issue's
// comments, so it hands them in and the reader skips its own fetch. Omitted —
// as the run page omits it (pinned by the key list above) — the fetch runs.
describe('readRunEvidence: optional comments (LIN-3329)', () => {
  test('comments supplied → no fetchIssueComments; the model is built from them', async () => {
    const provider = countingProvider({ comments: [] });
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable, comments: [comment(`opened ${PR_A}`)] });
    assert.equal(provider.counts.comments, 0, 'the supplied comments were used');
    assert.equal(model.state.pr.url, PR_A);
    assert.equal(model.closeOut.owner, false, 'the viewerIsOwner default is untouched');
  });

  test('comments omitted → fetched exactly once, as before', async () => {
    const provider = countingProvider();
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable });
    assert.equal(provider.counts.comments, 1);
    assert.equal(model.state.pr.url, PR_A);
  });

  test('an empty supplied list is respected (no fetch, no PR)', async () => {
    const provider = countingProvider();
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', provider, callScope: 's', readPrStatus: unreadable, comments: [] });
    assert.equal(provider.counts.comments, 0);
    assert.equal(model.state.status, 'no-pr');
  });
});
