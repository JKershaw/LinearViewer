/**
 * LIN-1162 — route-level: the user-facing POST /workspace/:urlKey/api/dispatch
 * now attaches the workspace-API proxy-context block SERVER-SIDE when the client
 * asks (`attachProxy:true`), through the same finalizePrompt→attachProxyContext
 * seam the proxy dispatch routes use (LIN-1155/1157/1139). This closes the gap
 * where the UI dispatch path minted + appended the block in the BROWSER and so
 * could never take the claude-code MCP `bootstrapToken` field path.
 *
 * Key behaviors pinned here:
 *  - harness claude-code -> token travels as the structured `bootstrapToken` field,
 *    stripped from the prompt (no token / no `curl -X POST`).
 *  - harness opencode (explicit non-claude-code) -> historical prose block, token
 *    embedded, `bootstrapToken:null`.
 *  - BLANK harness -> prose (NOT MCP): the session route keeps applyDefaultHarness:false
 *    (LIN-1159 scoped the claude-code interpose to the proxy boundary), so a null
 *    resolved harness does NOT flip to the MCP path here. Load-bearing (LIN-1111 blank
 *    escape hatch).
 *  - attachProxy omitted/false -> no block at all, byte-for-byte the raw prompt.
 *  - attachProxy:true but the mint fails -> 503 and NO item enqueued ("surface, don't
 *    silently drop", LIN-525): the route never ships a bare prompt while the UI shows
 *    +proxy active.
 *  - attachProxy non-boolean -> 400.
 *
 * Mirrors the buildApp/call scaffolding of dispatch-route-defaults.test.js plus an
 * injected proxyTokenStore, and the assertMcp/assertProse shape of
 * proxy-dispatch-bootstrap-token.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const MARKER = '## Workspace API access (auto-appended)';
const MINTED = 'bootstrap-xyz';

function buildApp(captured, opts = {}) {
  // Honor an EXPLICIT null (the "store absent" case) — a plain `|| default` would
  // silently swap it back for the working mock and mask the degradation path.
  const proxyTokenStore = 'proxyTokenStore' in opts
    ? opts.proxyTokenStore
    : { createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }) };
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-09T00:00:00.000Z', ...item };
      },
      // Omitted by default so every pre-LIN-1431 test in this file stays
      // structurally immune to anchor harness inheritance: createDispatchItem
      // only looks up an anchor when this method exists at all. The LIN-1431
      // follow-up tests below opt in and count the calls, so they cannot pass
      // vacuously with the anchor never consulted.
      ...(opts.getItemStatus
        ? {
            getItemStatus: async (...args) => {
              captured.getItemStatusCalls = (captured.getItemStatusCalls || 0) + 1;
              return opts.getItemStatus(...args);
            }
          }
        : {})
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    // No workspacePreferencesStore -> blank model/harness stay null (the common
    // "user typed nothing extra" case); the UI sends an explicit harness anyway.
    proxyTokenStore
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
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/workspace/acme/api/dispatch';

function assertMcp(item) {
  assert.equal(item.bootstrapToken, MINTED, 'claude-code carries the token as a field');
  assert.ok(item.prompt.includes(MARKER), 'still gets the access block');
  assert.ok(!item.prompt.includes(MINTED), 'token is NOT in the prompt text');
  assert.ok(!item.prompt.includes('curl -X POST'), 'no curl exchange command in the prompt');
}
function assertProse(item) {
  assert.equal(item.bootstrapToken, null, 'no field when the token is in the prose');
  assert.ok(item.prompt.includes(MARKER));
  assert.ok(item.prompt.includes(MINTED), 'token stays embedded in the prose');
  assert.ok(item.prompt.includes('curl -X POST'), 'prose keeps the curl exchange');
}

describe('LIN-1162 — server-side proxy-context attach on UI dispatch', () => {
  test('harness claude-code + attachProxy:true -> MCP token-field path', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code');
    // The per-issue brief endpoint is threaded from issueIdentifier.
    assert.ok(captured.item.prompt.includes('/api/proxy/brief/LIN-42'));
  });

  test('harness opencode + attachProxy:true -> prose token, no field', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'opencode', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertProse(captured.item);
    assert.equal(captured.item.harness, 'opencode');
  });

  test('BLANK harness + attachProxy:true -> prose (applyDefaultHarness:false preserved, NOT MCP)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Null resolved harness stays null here (no claude-code interpose), so the
    // MCP gate does NOT fire — the block is the historical prose with the token.
    assert.strictEqual(captured.item.harness, null);
    assertProse(captured.item);
  });

  test('attachProxy omitted -> no proxy block, raw prompt unchanged, bootstrapToken null', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.prompt, 'do the thing');
    assert.strictEqual(captured.item.bootstrapToken, null);
    assert.ok(!captured.item.prompt.includes(MARKER));
  });

  test('attachProxy:false -> no proxy block (explicit opt-out)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: false
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.prompt, 'do the thing');
    assert.strictEqual(captured.item.bootstrapToken, null);
  });

  test('attachProxy non-boolean -> 400', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', attachProxy: 'yes'
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /attachProxy must be a boolean/);
    assert.equal(captured.item, undefined, 'nothing enqueued on a bad request');
  });
});

describe('LIN-1162 — surface, don\'t silently drop when the server mint fails', () => {
  test('mint returns no token -> 503 and NO item enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      proxyTokenStore: { createToken: async () => ({ token: null }) }
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(res.body.error, /proxy token could not be created/i);
    assert.equal(captured.item, undefined, 'a bare prompt is NOT enqueued on mint failure');
  });

  test('mint throws -> 503 and NO item enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      proxyTokenStore: { createToken: async () => { throw new Error('rate limited'); } }
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.item, undefined, 'a bare prompt is NOT enqueued on mint failure');
  });

  test('proxyTokenStore absent -> attach cannot happen -> 503 (never a silent bare dispatch)', async () => {
    const captured = {};
    const app = buildApp(captured, { proxyTokenStore: null });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.item, undefined);
  });
});

/**
 * LIN-1431 S3 #1 — the human reply box (public/session.js) posts only
 * { prompt, followUpTo, target, force }: it never sets `attachProxy`, so
 * `wantProxyContext` is false. Pre-LIN-1431 that meant NO finalizePrompt was
 * passed at all, so a follow-up resuming a claude-code session was enqueued
 * with `bootstrapToken: null` — and the broker that held its original
 * credential died with its window (LIN-1362/1375), leaving the resumed session
 * unable to write back.
 *
 * The fix is a SERVER-SIDE default keyed on the RESOLVED harness (never a new
 * client flag, never a flip of applyDefaultHarness — 7926ee8). These tests pin
 * both directions: a claude-code-resolved anchor provisions, a blank-harness
 * anchor still does not (the LIN-1111 escape hatch, which the test at the top
 * of this file locks for the fresh-dispatch case).
 */
const ANCHOR_ID = '11111111-2222-3333-4444-555555555555';

describe('LIN-1431 — reply-box follow-up provisioning (no attachProxy)', () => {
  test('a follow-up on a claude-code-resolved anchor mints a bootstrap with NO attachProxy', async () => {
    const captured = {};
    const app = buildApp(captured, {
      getItemStatus: async (_urlKey, id) => (id === ANCHOR_ID ? { harness: 'claude-code' } : null)
    });
    // Exactly the reply box's payload shape — no attachProxy, no harness.
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', followUpTo: ANCHOR_ID, target: 'cli'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.getItemStatusCalls > 0,
      'the anchor must actually be consulted — otherwise this passes for the wrong reason');
    assert.equal(captured.item.harness, 'claude-code',
      'harness is inherited from the anchor (beat 1), which is what arms the MCP branch');
    // The exact token, not truthiness: in MCP mode provisionBootstrapToken either
    // returns a token or throws (LIN-1175), so null/undefined here would be a
    // silent contract violation.
    assert.equal(captured.item.bootstrapToken, MINTED,
      'a resumed broker-dependent session must receive a LIVE credential');
    // Provision WITHOUT appending prose — the reply text is the user's own.
    assert.equal(captured.item.prompt, 'do the thing',
      'the prompt is forwarded verbatim; provisioning never rewrites it');
    assert.ok(!captured.item.prompt.includes(MARKER), 'no proxy-context block is appended');
    assert.ok(!captured.item.prompt.includes(MINTED), 'the token never enters prompt text');
  });

  test('a follow-up on a BLANK-harness anchor stays prose-only, bootstrapToken null (LIN-1111 survives the new default)', async () => {
    const captured = {};
    const app = buildApp(captured, {
      // The store emits `harness: doc.harness || null`, so a blank-harness
      // anchor yields null — inheriting null is indistinguishable from not
      // inheriting, and shouldUseMcpTokenField(null) is false.
      getItemStatus: async () => ({ harness: null })
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', followUpTo: ANCHOR_ID, target: 'cli'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.getItemStatusCalls > 0, 'the anchor was consulted');
    assert.strictEqual(captured.item.harness, null,
      'a blank anchor must NOT be silently upgraded to claude-code');
    assert.strictEqual(captured.item.bootstrapToken, null,
      'the blank-harness escape hatch mints nothing — a prose-path token has no channel to the worker');
    assert.equal(captured.item.prompt, 'do the thing', 'prompt untouched');
  });

  test('a fresh dispatch (no followUpTo, no attachProxy) is unchanged: no mint, raw prompt', async () => {
    const captured = {};
    const app = buildApp(captured, {
      getItemStatus: async () => ({ harness: 'claude-code' })
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', target: 'cli'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.getItemStatusCalls, undefined,
      'no followUpTo means no anchor lookup at all');
    assert.strictEqual(captured.item.bootstrapToken, null,
      'the new default is scoped to follow-ups — a fresh dispatch is byte-identical to before');
    assert.equal(captured.item.prompt, 'do the thing');
  });

  test('a claude-code follow-up whose mint fails is refused with 503, nothing enqueued (fail-closed, LIN-1175/525)', async () => {
    const captured = {};
    const app = buildApp(captured, {
      proxyTokenStore: { createToken: async () => { throw new Error('rate limited'); } },
      getItemStatus: async () => ({ harness: 'claude-code' })
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', followUpTo: ANCHOR_ID, target: 'cli'
    });

    assert.equal(res.status, 503, JSON.stringify(res.body));
    // The real property: refused BEFORE enqueue. A resumed session must never
    // launch credential-less while believing it has one.
    assert.equal(captured.item, undefined, 'no item was ever enqueued');
  });
});
