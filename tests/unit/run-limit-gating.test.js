/**
 * LIN-3238 — gated lanes at the route level (session + quota) and the
 * relay-coverage guard.
 *
 * The factory gate itself (step 1.55) and the refusal contract are pinned in
 * `dispatch-factory-run-gate.test.js`; `buildRunGate` in `build-run-gate.test.js`.
 * This suite pins the ROUTE relays and the Q6 quota read:
 *   - the session dispatch lane relays `err.runLimit` as 429 (with Retry-After)
 *     or 503, and is not gated for a non-free-tier caller;
 *   - GET .../dispatch/quota returns the caller's own merge-group usage, and
 *     `limited:false` when not free tier;
 *   - EVERY `createDispatchItem(` call that passes a `runGate` has an
 *     `err.runLimit` relay in its catch (the seven gated lanes).
 */
process.env.NODE_ENV = 'test';
delete process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_FREE_TIER_KEY = 'free-tier-test-key';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { FreeTierStore } from '../../lib/free-tier-store.js';

const FUTURE = '2026-10-03T00:00:00.000Z';
const PATH = '/workspace/acme/api/dispatch';

function buildApp({ freeTierStore, accountStore = null, session = { accountId: 'acct-1', openRouterApiKey: null }, captured = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-10-02T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = session;
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    freeTierStore,
    accountStore
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, retryAfterHeader: res.headers.get('retry-after') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const FRESH = { prompt: 'run me', kind: 'implementation' };

/**
 * The THIRD surface (LIN-3239): render the shared opened-task ladder against
 * the exact `GET .../dispatch/quota` body, so the client's displayed run count
 * is proven to agree with the route's read. Minimal vm sandbox — the ladder
 * render only needs the `window.api` quota read to resolve.
 */
async function renderLadderQuota(quotaBody) {
  const src = readFileSync(new URL('../../public/prompt-section.js', import.meta.url), 'utf8');
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => (String(url).endsWith('/api/dispatch/quota') ? quotaBody : { prompt: 'P', promptName: 'T' }),
    ProxyToggle: { maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async () => ({ item: { id: 'disp-1' } }),
    isPinnedToBottom: () => false,
    toast: () => {},
    fetchAutopilotKickoff: async () => ({ prompt: 'A', promptName: 'A', kind: 'autopilot' })
  };
  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    Blob: class {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: () => 1,
    clearTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) })
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const container = {
    innerHTML: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    contains() { return true; }, addEventListener() {}, removeEventListener() {}
  };
  window.PromptSection.init(container, {
    urlKey: 'acme',
    issue: { id: 'i-1', identifier: 'A-1', title: 'A task' },
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
    freeTier: true,
    hasAutopilot: true,
    dispatchEnabled: true,
    proxyEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: [],
    morePromptKeys: [],
    promptMeta: {}
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return container.innerHTML;
}

describe('LIN-3238 — session dispatch lane runs the gate and relays', () => {
  test('an exhausted free-tier account is refused 429 with the body and Retry-After', async () => {
    const captured = {};
    const freeTierStore = {
      checkRun: async () => ({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: FUTURE })
    };
    const res = await call(buildApp({ freeTierStore, captured }), 'post', PATH, FRESH);

    assert.equal(res.status, 429, JSON.stringify(res.body));
    assert.equal(res.body.code, 'RUN_LIMIT_REACHED');
    assert.equal(res.body.freeTier.used, true);
    assert.equal(res.body.freeTier.runsUsed, 10);
    assert.equal(res.body.freeTier.limit, 10);
    assert.equal(res.body.freeTier.remaining, 0);
    assert.equal(res.body.freeTier.resetsAt, FUTURE);
    assert.equal(res.retryAfterHeader, String(res.body.retryAfter));
    assert.equal(captured.item, undefined, 'nothing may be enqueued on refusal');
  });

  test('an unverified count is refused 503 RUN_LIMIT_UNVERIFIED', async () => {
    const captured = {};
    const freeTierStore = {
      checkRun: async () => ({ allowed: false, reason: 'unverified', runsUsed: null, limit: 10, remaining: 0, resetsAt: FUTURE })
    };
    const res = await call(buildApp({ freeTierStore, captured }), 'post', PATH, FRESH);

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'RUN_LIMIT_UNVERIFIED');
    assert.equal(captured.item, undefined);
  });

  test('a non-free-tier caller is not gated', async () => {
    const saved = process.env.OPENROUTER_FREE_TIER_KEY;
    delete process.env.OPENROUTER_FREE_TIER_KEY;
    try {
      const captured = {};
      const freeTierStore = {
        checkRun: async () => { throw new Error('must not be called'); }
      };
      const res = await call(buildApp({ freeTierStore, captured }), 'post', PATH, FRESH);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.ok(captured.item, 'an ungated caller dispatches');
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
      else process.env.OPENROUTER_FREE_TIER_KEY = saved;
    }
  });

  test('an allowed gate dispatches at the route level', async () => {
    const captured = {};
    const freeTierStore = { checkRun: async () => ({ allowed: true, runsUsed: 0, limit: 10, remaining: 10, resetsAt: FUTURE }) };
    const res = await call(buildApp({ freeTierStore, captured }), 'post', PATH, FRESH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'an admitted free-tier row dispatches');
  });
});

describe('LIN-3238 — GET /workspace/:urlKey/api/dispatch/quota (Q6)', () => {
  test('returns the caller\'s own merge-group usage when free tier', async () => {
    const freeTierStore = {
      getRunUsage: async (accountIds) => {
        assert.deepEqual(accountIds, ['acct-1'], 'the merge group of the session account only');
        return { runsUsed: 3, limit: 10, remaining: 7, resetsAt: FUTURE };
      }
    };
    const res = await call(buildApp({ freeTierStore }), 'get', `${PATH}/quota`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { limited: true, runsUsed: 3, limit: 10, remaining: 7, resetsAt: FUTURE });
  });

  test('returns limited:false when not free tier (no counts leaked)', async () => {
    const saved = process.env.OPENROUTER_FREE_TIER_KEY;
    delete process.env.OPENROUTER_FREE_TIER_KEY;
    try {
      const res = await call(buildApp({ freeTierStore: {} }), 'get', `${PATH}/quota`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.limited, false);
      assert.equal(res.body.runsUsed, null);
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
      else process.env.OPENROUTER_FREE_TIER_KEY = saved;
    }
  });
});

describe('LIN-3238 — relay coverage (static guard)', () => {
  const routesDir = fileURLToPath(new URL('../../routes/', import.meta.url));
  const files = readdirSync(routesDir).filter(f => f.endsWith('.js'));

  test('every gated lane file passes runGate to createDispatchItem AND relays err.runLimit', () => {
    const gated = files.filter(f => {
      const src = readFileSync(`${routesDir}/${f}`, 'utf8');
      return /createDispatchItem\s*\(/.test(src) && /runGate/.test(src);
    }).sort();

    // The seven gated lanes live in four files: dispatch (1), proxy-dispatch
    // (3), proxy-kickoff (1), workspace-api (2, the two feedback lanes).
    assert.deepEqual(
      gated,
      ['dispatch.js', 'proxy-dispatch.js', 'proxy-kickoff.js', 'workspace-api.js'],
      `unexpected gated-lane file set: ${gated.join(', ')}`
    );

    for (const f of gated) {
      const src = readFileSync(`${routesDir}/${f}`, 'utf8');
      // Session lanes relay inline (`err.runLimit`); proxy lanes relay through the
      // shared `refuseIfRunLimit` helper defined in routes/proxy.js.
      const hasRelay = /err\.runLimit/.test(src) || /refuseIfRunLimit\s*\(/.test(src);
      assert.ok(hasRelay, `${f} passes runGate but has no err.runLimit relay`);
    }
  });

  test('routes/proxy.js defines the shared refuseIfRunLimit which reads err.runLimit', () => {
    const src = readFileSync(`${routesDir}/proxy.js`, 'utf8');
    assert.match(src, /function refuseIfRunLimit\s*\(/, 'proxy.js must define refuseIfRunLimit');
    assert.match(src, /err\.runLimit/, 'refuseIfRunLimit must branch on err.runLimit');
  });

  test('collective.js is deliberately NOT gated (Q11)', () => {
    const src = readFileSync(`${routesDir}/collective.js`, 'utf8');
    assert.match(src, /createDispatchItem\s*\(/, 'collective does create dispatch rows');
    assert.doesNotMatch(src, /runGate/, 'collective/start stays ungated (LIN-2440)');
  });
});

describe('LIN-3238 — three-surface agreement (factory gate + quota read + ladder)', () => {
  test('the factory gate and the quota read agree on the caller\'s run count', async () => {
    // One FreeTierStore over one seeded dispatch count drives both surfaces.
    const dispatchStore = { countFreshRunsSince: async () => 10 };
    const freeTierStore = new FreeTierStore({ collection: {}, dispatchStore, runLimit: 10 });

    const post = await call(buildApp({ freeTierStore }), 'post', PATH, FRESH);
    assert.equal(post.status, 429, JSON.stringify(post.body));

    const quota = await call(buildApp({ freeTierStore }), 'get', `${PATH}/quota`);
    assert.equal(quota.status, 200, JSON.stringify(quota.body));

    assert.equal(quota.body.runsUsed, post.body.freeTier.runsUsed);
    assert.equal(quota.body.limit, post.body.freeTier.limit);
    assert.equal(quota.body.remaining, post.body.freeTier.remaining);
    assert.equal(quota.body.resetsAt, post.body.freeTier.resetsAt);
  });

  test('the ladder (third surface) displays the quota read\'s own numbers (LIN-3239)', async () => {
    // A different count so the assertion cannot pass on a coincidental default.
    const dispatchStore = { countFreshRunsSince: async () => 7 };
    const freeTierStore = new FreeTierStore({ collection: {}, dispatchStore, runLimit: 10 });

    const quota = await call(buildApp({ freeTierStore }), 'get', `${PATH}/quota`);
    assert.equal(quota.status, 200, JSON.stringify(quota.body));

    const html = await renderLadderQuota(quota.body);
    assert.match(html, new RegExp(`data-runs-remaining="${quota.body.remaining}"`), 'the ladder shows the quota read\'s remaining');
    assert.match(html, new RegExp(`data-runs-limit="${quota.body.limit}"`), 'the ladder shows the quota read\'s limit');
    assert.match(html, new RegExp(`${quota.body.remaining} of ${quota.body.limit} runs left today`), 'the human-readable ladder count agrees');
  });
});
