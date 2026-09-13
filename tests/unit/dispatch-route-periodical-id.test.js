/**
 * LIN-1825 Beat 2 — route-level: both dispatch-creation entry points accept
 * an optional `periodicalId`, validate it against the live periodicals
 * registry (lib/periodicals.js getPeriodicals()) before it reaches the
 * store, and thread it into the `fields:` block the shared factory persists
 * via addItem — mirroring the `maxTasks` validation pattern (LIN-1737).
 *
 *   - POST /workspace/:urlKey/api/dispatch (session auth, routes/dispatch.js)
 *   - POST /api/proxy/dispatch (bearer token, routes/proxy.js) — the entry
 *     point that makes "works from any entry point, including a bare-token
 *     agent POST" true; skipping validation here would silently drop/accept
 *     a bad id for exactly the unbounded direct-dispatch case.
 *
 * The round-trip test uses the REAL DispatchQueueStore (not a captured-item
 * stub) and reads back through listItems() — never the raw addItem() doc —
 * per the same read-path discipline as the Beat 1 store tests.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { testMockData } from '../fixtures/mock-data.js';
import { buildPeriodicalGateMarker } from '../../lib/periodical-report-gate.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { guardNetwork } from '../fixtures/network-guard.js';

const KNOWN_ID = 'documentation-review';
const UNKNOWN_ID = 'not-a-real-template';

async function call(app, method, path, body, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// routes/dispatch.js — session-auth
// ---------------------------------------------------------------------------

function buildDispatchApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-02T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

const DISPATCH_PATH = '/workspace/acme/api/dispatch';

describe('LIN-1825 Beat 2 — POST /workspace/:urlKey/api/dispatch periodicalId', () => {
  test('no periodicalId at all: byte-identical, defaults to null', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'periodical', periodicalId: KNOWN_ID });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('an unknown/typo periodicalId is rejected 400 with the exact error text', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'periodical', periodicalId: UNKNOWN_ID });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});

// ---------------------------------------------------------------------------
// routes/proxy.js — bearer-token consumer API (the direct-agent entry point)
// ---------------------------------------------------------------------------

function buildProxyApp(captured) {
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
        return { _id: 'disp-1', dispatchedAt: '2026-08-02T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

const AUTH = { Authorization: 'Bearer anything' };

describe('LIN-1825 Beat 2 — POST /api/proxy/dispatch periodicalId (direct-agent entry point)', () => {
  test('no periodicalId at all: byte-identical, defaults to null', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'periodical', periodicalId: KNOWN_ID }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('an unknown/typo periodicalId is rejected 400 with the exact error text', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'periodical', periodicalId: UNKNOWN_ID }, AUTH);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});

// ---------------------------------------------------------------------------
// End-to-end round trip through the REAL store, both entry points, read back
// via listItems() — never the raw addItem() doc.
// ---------------------------------------------------------------------------

function buildProxyAppWithRealStore(store) {
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
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

describe('LIN-1825 Beat 2 — direct proxy dispatch (no UI) round-trips through the real store', () => {
  test('a bare readWrite proxy-token POST with { kind: "periodical", periodicalId, prompt } survives to listItems()', async () => {
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildProxyAppWithRealStore(store);

    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'run the periodical', kind: 'periodical', periodicalId: KNOWN_ID
    }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const items = await store.listItems('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].periodicalId, KNOWN_ID);
    assert.equal(items[0].kind, 'periodical');
  });
});

// ---------------------------------------------------------------------------
// LIN-2385 B6 — POST /api/proxy/recommend-and-dispatch has TWO
// createDispatchItem `fields` blocks (the verb-override branch, `kind` set,
// and the recommendation-derived branch, `kind` omitted — the branch every
// autopilot loop's normal "Trigger the next step" call actually takes). Both
// must carry `periodicalId`, or the stamping capability is wired onto the
// rare path and silently dropped on the everyday one — reproducing, on the
// fused verb, the exact defect this beat exists to close.
//
// TEST-1 / TEST-14 mirror tests/unit/proxy-dispatch-defaults.test.js's own
// fixtures for these two branches: with `kind` set, the verb-override branch
// short-circuits before the LLM; TEST-14 (no `kind`) resolves via the
// test-token short-circuit to an `implement` action, landing on the
// recommendation-derived branch.
// ---------------------------------------------------------------------------

function buildRecommendApp(captured) {
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
        return { _id: 'disp-1', dispatchedAt: '2026-08-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

describe('LIN-2385 B6 — POST /api/proxy/recommend-and-dispatch stamps periodicalId on BOTH createDispatchItem branches', () => {
  test('verb-override branch (kind set): a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', periodicalId: KNOWN_ID
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('verb-override branch (kind set): no periodicalId defaults to null', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('verb-override branch (kind set): an unknown/typo periodicalId is rejected 400, parity with POST /dispatch', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', periodicalId: UNKNOWN_ID
    }, AUTH);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });

  // TEST-14: no `kind` in the request body — resolves via the test-token
  // short-circuit to an `implement` action, landing on the
  // recommendation-derived `createDispatchItem` call, never the
  // verb-override one (see tests/unit/proxy-dispatch-defaults.test.js's own
  // comment establishing this fixture's branch).
  test('recommendation-derived branch (no kind — the everyday autopilot trigger): a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', periodicalId: KNOWN_ID
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.equal(captured.item.kind, 'implementation', 'sanity: this must be the recommendation-derived branch, not the override one');
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('recommendation-derived branch (no kind): no periodicalId defaults to null', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('recommendation-derived branch (no kind): an unknown/typo periodicalId is rejected 400', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', periodicalId: UNKNOWN_ID
    }, AUTH);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});

// ---------------------------------------------------------------------------
// LIN-2575 — derive periodicalId from the dispatched issue's LIN-694 gate
// marker at the dispatch seam, so a lane/batch dispatch of a minted periodical
// review task is stamped without the caller having to know the template id.
//
// The registry id and the marker slug deliberately differ for most templates
// ('Code Quality Review' -> marker 'code-quality-review', id 'code-quality'),
// so these tests pin the slug -> canonical-id resolution, not string equality.
// TEST-1 (In Progress) exercises the verb-override branch; TEST-14 (started)
// exercises the recommendation-derived branch the everyday autopilot/lane
// trigger actually lands on (same fixtures as the B6 tests above).
// ---------------------------------------------------------------------------

describe('LIN-2575 — recommend-and-dispatch derives periodicalId from the issue gate marker', () => {
  const CODE_MARKER = buildPeriodicalGateMarker('Code Quality Review'); // slug 'code-quality-review', id 'code-quality'

  function withDescription(identifier, description) {
    const issue = testMockData.issues.find(i => i.identifier === identifier);
    const prior = issue.description;
    issue.description = description;
    return () => { issue.description = prior; };
  }

  test('verb-override branch (kind set): no caller periodicalId + marker -> derived canonical id', async () => {
    const restore = withDescription('TEST-1', `${CODE_MARKER}\n\nRun the review.`);
    try {
      const captured = {};
      const res = await call(buildRecommendApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
        issueIdentifier: 'TEST-1', kind: 'review'
      }, AUTH);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(captured.item.periodicalId, 'code-quality');
    } finally {
      restore();
    }
  });

  test('verb-override branch: an explicit caller periodicalId still wins over the derived one', async () => {
    const restore = withDescription('TEST-1', `${CODE_MARKER}\n\nRun the review.`);
    try {
      const captured = {};
      const res = await call(buildRecommendApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
        issueIdentifier: 'TEST-1', kind: 'review', periodicalId: KNOWN_ID
      }, AUTH);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
    } finally {
      restore();
    }
  });

  test('verb-override branch: an ordinary description (no marker) still stamps null', async () => {
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'review'
    }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('recommendation-derived branch (no kind — the everyday autopilot/lane trigger): marker -> derived canonical id', async () => {
    const restore = withDescription('TEST-14', `${buildPeriodicalGateMarker('Documentation Review')}\n\nRun the review.`);
    try {
      const captured = {};
      const res = await call(buildRecommendApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
        issueIdentifier: 'TEST-14'
      }, AUTH);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(captured.item.kind, 'implementation', 'sanity: this must be the recommendation-derived branch');
      assert.strictEqual(captured.item.periodicalId, 'documentation-review');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// LIN-2575 review — pin the LIVE `computeRecommendation` derivation.
//
// routes/proxy.js carries TWO literal derivation expressions: the test-mode
// `mockIssue.description` one (routes/proxy.js:1446) and the live
// `issue.description` one (routes/proxy.js:1514). Every route test above
// reaches the app via `resolveWorkspaceAccess -> { token: 'test-token' }`, so
// `isTestMode === true` and they all assert the FIRST. The second is the only
// line that runs when a real autopilot lane calls this verb against a live
// provider, and independent review proved the whole unit suite stayed green
// with it deleted — so the ticket's own deliverable rested on an unpinned line.
//
// This block uses the live-path harness the review named: an injected provider
// (the `provider` test seam) plus a workspace-access token that is deliberately
// NOT 'test-token', so `isTestMode === false` and the request genuinely reaches
// `provider.fetchRecommendationContext` and then the live derivation line. The
// LLM transport is intercepted at the module's own `setFetchImpl` seam
// (LIN-1848), so no network call leaves the process, and the network guard
// asserts that.
// ---------------------------------------------------------------------------

const LIVE_NON_TEST_TOKEN = 'fake-live-token-not-test-token';

// Same `→ **implement**` action signal the test-mode fixtures resolve to, so
// the recommendation lands on the recommendation-derived (no `kind`) branch —
// the branch that carries the live derivation line.
const LIVE_LLM_REPLY = [
  '## Reasoning',
  '**Assessment:**',
  '- Preparation: ✓ Complete - ready',
  '- Blockers: ✓ None - none',
  '- Ready: ✓ Yes - ready',
  '→ **implement**',
  '**Next:** Ship it.',
  '## Prompt',
  'Do the thing in the fake tracker.'
].join('\n');

function liveContext(description) {
  return {
    issue: {
      id: 'live-issue-1',
      identifier: 'ENG-9',
      title: 'A minted periodical review task',
      description,
      state: { name: 'In Progress', type: 'started' },
      labels: [],
      url: 'https://example.test/ENG-9',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: [],
    attachments: [],
    focusedChild: null
  };
}

class FakeLivePeriodicalProvider extends ProviderInterface {
  constructor(description) {
    super();
    this.name = 'lin2575-live-fake';
    this.calls = [];
    // Instance-property overrides make ProviderInterface.supports() report both
    // capabilities as implemented (the route gates on both before the branch),
    // and make each call observable rather than a silent fallback.
    this.fetchIssueContext = async (...args) => {
      this.calls.push({ fn: 'fetchIssueContext', args });
      return liveContext(description);
    };
    this.fetchRecommendationContext = async (...args) => {
      this.calls.push({ fn: 'fetchRecommendationContext', args });
      return liveContext(description);
    };
  }
}

function buildLiveRecommendApp({ description, captured }) {
  const provider = new FakeLivePeriodicalProvider(description);
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
    resolveWorkspaceAccess: async () => ({ token: LIVE_NON_TEST_TOKEN, reason: 'ok' }),
    getWorkspaceAccessToken: async () => LIVE_NON_TEST_TOKEN,
    getWorkspaceOpenRouterKey: async () => 'sk-live-test',
    getWorkspaceNorthStar: async () => null,
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {}, put: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {}, put: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-live-1', dispatchedAt: '2026-08-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider
  }));
  return app;
}

function mockOpenRouterSuccess() {
  return {
    ok: true,
    json: async () => ({
      model: 'openai/gpt-test',
      choices: [{ message: { content: LIVE_LLM_REPLY }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 12 }
    })
  };
}

describe('LIN-2575 — LIVE recommend-and-dispatch pins the production computeRecommendation derivation', () => {
  let networkGuard;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    networkGuard = guardNetwork();
  });

  afterEach(() => {
    setFetchImpl(null);
    networkGuard.restore();
    assert.equal(
      networkGuard.attempts.length,
      0,
      `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`
    );
  });

  test('live path (non-test-token, injected provider): no caller periodicalId + gate marker -> derived canonical id', async () => {
    let llmHits = 0;
    setFetchImpl(async () => {
      llmHits += 1;
      return mockOpenRouterSuccess();
    });

    const captured = {};
    const app = buildLiveRecommendApp({
      description: `${buildPeriodicalGateMarker('Code Quality Review')}\n\nRun the review.`,
      captured
    });

    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'ENG-9', appendProxyContext: false
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(llmHits, 1, 'the live path must actually have issued the LLM recommendation call');
    assert.ok(captured.item, 'the live recommendation-derived branch must dispatch an item');
    assert.strictEqual(captured.item.periodicalId, 'code-quality');
  });

  test('live path: an ordinary description (no gate marker) still stamps null — the derivation is not a constant', async () => {
    setFetchImpl(async () => mockOpenRouterSuccess());

    const captured = {};
    const app = buildLiveRecommendApp({
      description: 'An ordinary issue with no periodical gate marker.',
      captured
    });

    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'ENG-9', appendProxyContext: false
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'the live recommendation-derived branch must dispatch an item');
    assert.strictEqual(captured.item.periodicalId, null);
  });
});
