import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDashboardRoutes } from '../../routes/dashboard.js';

// LIN-1003 Phase 1: route-level proof that GET
// /workspace/:urlKey/observation/session/:sessionId (1) reads a real
// reconstructed session end-to-end through the renderer, (2) NEVER auto-spends
// an LLM call on load — the brief/recap cache stores see only `.get()`, never a
// generate/`.put()` — and (3) 404s on an unknown/foreign sessionId.

// A spy cache store that records every method invoked and only implements
// `get` (a pure read). Its mutators are poisoned so any generate/`.put()` on
// the render path fails loudly rather than silently spending.
function makeSpy(getImpl = async () => null) {
  const calls = [];
  const store = {
    get: async (...args) => { calls.push('get'); return getImpl(...args); },
    // Poisoned mutators: if the render path ever tries to generate, the test
    // fails loudly instead of silently spending.
    put: async () => { calls.push('put'); throw new Error('cache.put must not be called on page load'); },
    delete: async () => { calls.push('delete'); throw new Error('cache.delete must not be called on page load'); }
  };
  return { store, calls };
}

// One autopilot history item reconstructs into a single session whose sessionId
// equals the anchor loop's id (LIN-591 spine). Carries feedback[] (transcript)
// and an issueId UUID so the brief/recap join fires.
function historyItem() {
  return {
    id: 'sess-1',
    issueIdentifier: 'LIN-1',
    issueId: 'uuid-1',
    issueTitle: 'Seed task',
    issueUrl: 'https://linear.app/x/LIN-1',
    kind: 'autopilot',
    promptName: 'autopilot',
    dispatchedAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
    status: 'done',
    feedback: [
      { message: 'working on the plan', url: null, urlLabel: null, timestamp: new Date().toISOString() },
      { message: '[evidence] opened PR', url: 'https://gh/pr/1', urlLabel: 'PR #1', timestamp: new Date().toISOString() }
    ]
  };
}

function buildApp(spies) {
  const dispatchQueueStore = {
    listItems: async () => [],
    listHistory: async () => ({ items: [historyItem()] })
  };
  const agentStatusStore = { listStatus: async () => ({ items: [] }) };
  const app = express();
  app.use(createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; req.session = { workspaces: [] }; next(); },
    dispatchQueueStore,
    agentStatusStore,
    briefCacheStore: spies.brief.store,
    recapCacheStore: spies.recap.store,
    getDeployInfo: () => ({}),
    getOpenRouterSource: () => null
  }));
  return app;
}

let server, base, spies;

before(async () => {
  spies = { brief: makeSpy(), recap: makeSpy() };
  const app = buildApp(spies);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => { server?.close(); });

describe('session page route (LIN-1003)', () => {
  test('renders the reconstructed session with transcript + tasks, spending no LLM call', async () => {
    const res = await fetch(`${base}/workspace/ws-a/observation/session/sess-1`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-testid="session-page"/);
    assert.match(html, /data-testid="session-transcript"/);
    assert.ok(html.includes('working on the plan'), 'transcript message rendered from feedback[]');
    assert.ok(html.includes('https://gh/pr/1'), 'evidence link rendered');
    assert.match(html, /data-testid="session-tasks"/);

    // The no-auto-spend guarantee: the cache stores were touched, and ONLY via
    // `.get()` — never put/delete/generate.
    assert.ok(spies.brief.calls.length > 0, 'brief cache was read');
    assert.ok(spies.recap.calls.length > 0, 'recap cache was read');
    assert.deepEqual([...new Set(spies.brief.calls)], ['get'], 'brief cache: only .get()');
    assert.deepEqual([...new Set(spies.recap.calls)], ['get'], 'recap cache: only .get()');
  });

  test('404s on an unknown sessionId (also the cross-workspace-isolation case)', async () => {
    const res = await fetch(`${base}/workspace/ws-a/observation/session/does-not-exist`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.ok(html.includes('was not found'), '404 body explains the miss');
    assert.ok(html.includes('/workspace/ws-a/observation'), '404 still offers a back link');
  });
});
