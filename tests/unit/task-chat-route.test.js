/**
 * Structural guards for routes/task-chat.js tool-calling wiring (LIN-990).
 *
 * The live tool-call round-trip is a close-out gate exercised against a real
 * provider, not in CI (green CI cannot discharge it). These are the cheap,
 * regression-catching invariants CI *can* pin without a network call:
 *
 *   1. One quota unit per TURN, never per hop. The whole tool loop lives inside
 *      a single turn, so `freeTierStore.tryUse` must be called exactly once and
 *      must NOT be reachable from a per-hop path (the catalog/executor).
 *   2. The route branches on `isToolCapableModel` and offers the read-only
 *      catalog only to a capable model, degrading to plain `streamChat` (tools
 *      off) otherwise — a silent model swap is explicitly rejected.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTaskChatRoutes } from '../../routes/task-chat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(__dirname, '../../routes/task-chat.js'), 'utf8');
const CATALOG_SRC = readFileSync(join(__dirname, '../../lib/chat-tools.js'), 'utf8');
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeSavedChatStore() {
  return { list: async () => [] };
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

describe('task-chat route tool-calling wiring (LIN-990)', () => {
  test('calls freeTierStore.tryUse exactly once — one quota unit per turn, not per hop', () => {
    const matches = ROUTE_SRC.match(/freeTierStore\.tryUse\s*\(/g) || [];
    assert.strictEqual(matches.length, 1, 'expected exactly one tryUse call in the route');
  });

  test('the tool catalog / executor never calls a quota store (no per-hop tryUse)', () => {
    assert.doesNotMatch(CATALOG_SRC, /tryUse/);
    assert.doesNotMatch(CATALOG_SRC, /freeTier/i);
  });

  test('branches on isToolCapableModel and wires streamChatWithTools + the catalog', () => {
    assert.match(ROUTE_SRC, /isToolCapableModel\s*\(\s*selectedModel\s*\)/);
    assert.match(ROUTE_SRC, /streamChatWithTools\s*\(/);
    assert.match(ROUTE_SRC, /createChatToolCatalog\s*\(/);
  });

  test('degrades to plain streamChat honoring the user model — no silent swap', () => {
    // The degrade path still calls streamChat, and every stream call carries the
    // resolved `selectedModel` (the user's choice) — the model is never reassigned
    // to a tool-capable one behind the user's back.
    assert.match(ROUTE_SRC, /streamChat\s*\(/);
    assert.match(ROUTE_SRC, /model:\s*selectedModel/);
    // selectedModel is a single `const` — declared once, never reassigned.
    assert.strictEqual((ROUTE_SRC.match(/selectedModel\s*=/g) || []).length, 1);
    assert.match(ROUTE_SRC, /const\s+selectedModel\s*=/);
  });
});

describe('task-chat saved-chats wiring (LIN-1008)', () => {
  test('literal /saved routes are registered BEFORE the /:issueId turn route', () => {
    // Express matches in registration order; if `:issueId` came first it would
    // capture `saved` as an issue id. Assert every /saved route source-position
    // precedes the turn route.
    const turnIdx = ROUTE_SRC.indexOf("'/workspace/:urlKey/api/task-chat/:issueId'");
    assert.ok(turnIdx > 0, 'expected the :issueId turn route to exist');
    for (const literal of [
      "router.get('/workspace/:urlKey/api/task-chat/saved'",
      "router.post('/workspace/:urlKey/api/task-chat/saved'",
      "router.get('/workspace/:urlKey/api/task-chat/saved/:id'",
      "router.delete('/workspace/:urlKey/api/task-chat/saved/:id'"
    ]) {
      const idx = ROUTE_SRC.indexOf(literal);
      assert.ok(idx > 0, `expected saved route: ${literal}`);
      assert.ok(idx < turnIdx, `saved route must precede the turn route: ${literal}`);
    }
  });

  test('the identity gate keys on accountId, not linearUserId (LIN-1353)', () => {
    // Isolate resolveSavedChatUser's OWN body and assert the gate reads
    // accountId, never linearUserId (LIN-1332 removed the field from the
    // session entirely, including the dispatchedBy attribution line elsewhere
    // in this file).
    const start = ROUTE_SRC.indexOf('const resolveSavedChatUser');
    assert.ok(start > 0, 'expected resolveSavedChatUser to be defined');
    const end = ROUTE_SRC.indexOf('\n  };', start);
    const gateSrc = ROUTE_SRC.slice(start, end);
    assert.match(gateSrc, /req\.session\.accountId/);
    assert.doesNotMatch(gateSrc, /linearUserId/);
    assert.match(gateSrc, /res\.status\(401\)/);
    // …and it is gated on the taskChat feature flag like the rest of the surface.
    assert.match(gateSrc, /getFeatureFlags\(req\.session\)\.taskChat\s*!==\s*true/);
  });

  test('the saved-chats gate 401s a session with linearUserId but NO accountId (proves the gate really switched keys)', async () => {
    // A stray legacy linearUserId (no longer written anywhere in production,
    // LIN-1332) must not satisfy the gate — this drives the REAL live handler
    // with the one input that discriminates old vs new behavior.
    const router = createTaskChatRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      savedChatStore: fakeSavedChatStore(),
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/task-chat/saved');
    const req = { session: { features: { taskChat: true }, linearUserId: 'legacy-linear-id' } };
    const res = makeRes();

    await handler(req, res);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonBody.error, 'Authentication required to use saved chats');
  });

  test('the saved-chats gate allows a session with accountId and NO linearUserId (GitHub/local users)', async () => {
    const router = createTaskChatRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      savedChatStore: fakeSavedChatStore(),
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/task-chat/saved');
    const req = {
      session: { features: { taskChat: true }, accountId: 'account-123' },
      workspace: { urlKey: 'acme' },
    };
    const res = makeRes();

    await handler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.jsonBody, { chats: [] });
  });

  test('the save endpoint reuses the shared sanitizeHistory shape', () => {
    // The saved transcript must go through the SAME {role, content} sanitizer the
    // turn route replays, so a stored transcript re-hydrates and replays cleanly.
    assert.match(ROUTE_SRC, /function\s+sanitizeHistory\s*\(/);
    assert.strictEqual((ROUTE_SRC.match(/sanitizeHistory\s*\(/g) || []).length >= 2, true,
      'sanitizeHistory should be used by both the turn and save paths');
  });

  test('privacy boundary: savedChatStore is NOT wired onto the proxy / workspace-api surfaces', () => {
    // Content-bearing → session-auth only. It must reach the task-chat + test
    // route factories but never createProxyRoutes / createWorkspaceApiRoutes.
    const proxyLine = SERVER_SRC.split('\n').find(l => l.includes('createProxyRoutes({'));
    const wsApiLine = SERVER_SRC.split('\n').find(l => l.includes('createWorkspaceApiRoutes({'));
    assert.ok(proxyLine && !/savedChatStore/.test(proxyLine), 'savedChatStore must not be passed to createProxyRoutes');
    assert.ok(wsApiLine && !/savedChatStore/.test(wsApiLine), 'savedChatStore must not be passed to createWorkspaceApiRoutes');
    // It IS wired into the task-chat route factory.
    const taskChatLine = SERVER_SRC.split('\n').find(l => l.includes('createTaskChatRoutes({'));
    assert.ok(taskChatLine && /savedChatStore/.test(taskChatLine), 'savedChatStore must be passed to createTaskChatRoutes');
  });
});
