/**
 * LIN-1118 close-out — the COMPOSED seam: a relaxed `sessionId` accepted at the
 * dispatch ingress, stored verbatim, then rendered into the session page's
 * `<title>`.
 *
 * Why this file exists. LIN-1118 relaxed `sessionId` from UUID-only to an opaque
 * string, which is what first let `"`, `<`, `>` and `/` reach the page title —
 * the stored-XSS sink LIN-1567 escaped. Both halves are pinned independently:
 *
 *   - the ingress half by tests/unit/dispatch-payload-validation.test.js
 *     (the validator accepts an opaque string), and
 *   - the render half by tests/unit/render-session.test.js (renderSessionPage
 *     escapes the title), which calls the renderer DIRECTLY and so never runs
 *     validation.
 *
 * Nothing ran the two together. This file does: the value asserted on in the
 * rendered document is the value the dispatch route actually handed to the store,
 * never a fresh literal — so it cannot pass while the ingress silently coerces,
 * truncates or rejects what the renderer is then asked to escape.
 *
 * Assertion scope. Assertions target the `<title>` ELEMENT, not the whole `<head>`.
 * The shared page shell puts its own inline `<script>` in the head, so a
 * head-wide "contains no <script>" check would be a false positive that fails
 * with the escape perfectly intact.
 *
 * Set NODE_ENV before importing the routes so the proxy test-mode short-circuit
 * and the module-level rate-limiter skip apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';

// HTML-significant and, since LIN-1118, a VALID sessionId: non-empty, under 128
// chars, no C0 control characters, not the reserved `__meta__`. Every character
// that makes it dangerous in markup is one the relaxation newly admits.
const HOSTILE_SESSION_ID = '</title><script>alert(1)</script>';

// ─── Ingress: the real POST /api/proxy/dispatch route ──────────────────────────

function buildDispatchApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-25T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function postDispatch(app, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/dispatch`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ─── Egress: the real GET /observation/session/:sessionId route ────────────────

const NOW_ISO = new Date().toISOString();

// A taken worker run stamped with the caller-supplied sessionId. This is the
// faithful shape for a relaxed id: a composite/opaque `sessionId` is never itself
// a dispatch `_id`, so the session exists ONLY as the group of rows stamped with it.
function workerHistoryItem(id, identifier, sessionId) {
  return {
    id, sessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
    promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO,
    status: 'taken', feedback: [{ message: 'pr opened', timestamp: NOW_ISO }]
  };
}

function agentStatusDone(dispatchId, identifier) {
  return {
    id: `as-${dispatchId}`, dispatchId, taskIdentifier: identifier,
    action: 'implementation', status: 'completed', summary: 'all done', timestamp: NOW_ISO
  };
}

function sessionStores(items) {
  const match = (arr, opts) => {
    let r = arr;
    if (opts.issueIdentifier) r = r.filter(i => i.issueIdentifier === opts.issueIdentifier);
    if (opts.sessionId) r = r.filter(i => i.sessionId === opts.sessionId);
    return r;
  };
  return {
    dispatchQueueStore: {
      async getItemStatus(_urlKey, id) {
        return [...items.live, ...items.history].find(i => i.id === id) || null;
      },
      async listItems(_urlKey, opts = {}) { return match(items.live, opts); },
      async listHistory(_urlKey, opts = {}) { return { items: match(items.history, opts) }; }
    },
    agentStatusStore: {
      async listStatus(_urlKey, opts = {}) {
        const r = (items.agentStatus || []).filter(s => !opts.taskIdentifier || s.taskIdentifier === opts.taskIdentifier);
        return { items: r };
      }
    }
  };
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes({ params = {} } = {}) {
  const req = {
    session: { features: {}, workspaces: [{ urlKey: 'acme', name: 'Acme' }] },
    workspace: { urlKey: 'acme' },
    params, query: {}, body: {}, protocol: 'http', get: () => 'localhost'
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    send(b) { this.sentBody = b; return this; },
    end(b) { this.endedWith = b; return this; }
  };
  return { req, res };
}

async function renderSessionRoute(sessionId, items) {
  const stores = sessionStores(items);
  const router = createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    observationSessionsStore: null,
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    briefCacheStore: { async get() { return null; } },
    recapCacheStore: { async get() { return null; } },
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    fetchIssueContext: async () => ({}),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({})
  });
  const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
  const { req, res } = makeReqRes({ params: { sessionId } });
  await handler(req, res);
  return res;
}

// ─── Title extraction ──────────────────────────────────────────────────────────

function headOf(html) {
  const m = html.match(/<head>([\s\S]*?)<\/head>/i);
  assert.ok(m, 'the rendered document has a <head>');
  return m[1];
}

function titleOf(html) {
  const m = headOf(html).match(/<title>([\s\S]*?)<\/title>/);
  return m ? m[1] : null;
}

describe('LIN-1118 seam: a relaxed sessionId survives dispatch storage and stays escaped in <title>', () => {
  test('hostile sessionId: accepted at ingress, stored verbatim, escaped in the rendered title', async () => {
    // 1. INGRESS — the real route, the real validator. Under the LIN-1118
    //    relaxation this payload is ACCEPTED; before it, the UUID guard 400'd.
    const captured = {};
    const res = await postDispatch(buildDispatchApp(captured), {
      prompt: 'do the thing',
      issueIdentifier: 'LIN-1118',
      target: 'cli',
      sessionId: HOSTILE_SESSION_ID
    });
    assert.equal(res.status, 201,
      `the relaxation must accept an HTML-significant sessionId (got ${res.status}: ${JSON.stringify(res.body)})`);

    // 2. STORAGE — verbatim, no sanitising hop between ingress and render. This
    //    is the whole reason the render layer has to carry the escape.
    const storedSessionId = captured.item?.sessionId;
    assert.equal(storedSessionId, HOSTILE_SESSION_ID,
      'the dispatch store receives the caller value verbatim — nothing sanitises it in transit');

    // 3. EGRESS — the STORED value (not a fresh literal) drives the page read.
    const page = await renderSessionRoute(storedSessionId, {
      live: [],
      history: [workerHistoryItem('w-seam', 'LIN-1118', storedSessionId)],
      agentStatus: [agentStatusDone('w-seam', 'LIN-1118')]
    });
    assert.equal(page.statusCode, 200, 'the session page rendered for the relaxed sessionId');

    // 4. The title element specifically — NOT the whole head: the page shell
    //    ships its own inline <script>, so a head-wide markup check false-positives.
    const title = titleOf(page.sentBody);
    assert.ok(title != null, 'the rendered document has a <title>');
    assert.ok(!/[<>]/.test(title),
      `no markup characters may survive into <title> (got: ${JSON.stringify(title)})`);
    assert.ok(!title.includes('<script'), 'no script tag may be reconstructed inside the title');

    // 5. A payload whose whole point is forging a second title must not manage it.
    const head = headOf(page.sentBody);
    assert.equal((head.match(/<title>/g) || []).length, 1, 'exactly one <title> open tag');
    assert.equal((head.match(/<\/title>/g) || []).length, 1,
      'exactly one </title> close tag — the payload must not forge a second');
  });

  test('the ordinary composite sessionId LIN-1118 exists to enable renders unescaped-but-intact', async () => {
    // The counterpart to the hostile case: the readable composite id the ticket
    // was filed for must survive the same seam with NO over-escaping, so the
    // escape cannot be "fixed" by mangling every id.
    const COMPOSITE = 'LIN-1117-autopilot-standalone-2026-07-07';
    const captured = {};
    const res = await postDispatch(buildDispatchApp(captured), {
      prompt: 'do the thing',
      issueIdentifier: 'LIN-1118',
      target: 'cli',
      sessionId: COMPOSITE
    });
    assert.equal(res.status, 201, 'the composite id the ticket exists to enable is accepted');
    assert.equal(captured.item?.sessionId, COMPOSITE, 'stored verbatim');

    const page = await renderSessionRoute(COMPOSITE, {
      live: [],
      history: [workerHistoryItem('w-ok', 'LIN-1118', COMPOSITE)],
      agentStatus: [agentStatusDone('w-ok', 'LIN-1118')]
    });
    assert.equal(page.statusCode, 200, 'the session page rendered');
    // LIN-1801: this session has no seedIssue, so the anchor-loop fallback
    // (session.loops[0], per routes/dashboard.js) is the worker carrying
    // issueTitle 'Title LIN-1118' — distinct from the composite id, so it now
    // renders as a title suffix. The escape-fidelity claim this test exists for
    // still holds: the composite id itself reaches the title unescaped-but-intact.
    assert.equal(titleOf(page.sentBody), `Session · ${COMPOSITE} — Title LIN-1118`,
      'a benign composite id reaches the title unchanged — the escape must not over-escape');
  });
});
