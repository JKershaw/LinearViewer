/**
 * Structural guards for routes/task-chat.js's turn wiring (LIN-990, LIN-2966).
 *
 * The live tool-call round-trip is a close-out gate exercised against a real
 * provider, not in CI (green CI cannot discharge it) — the route's own
 * pre-turn context fetch needs a real issue provider, so even the mocked
 * (`NODE_ENV=test` + `test-token`) path returns before ever reaching the turn
 * (see the mockAi branch in routes/task-chat.js). These are the cheap,
 * regression-catching invariants CI *can* pin without a network call, in this
 * file's own established idiom of asserting against the route's source text
 * rather than driving the real handler:
 *
 *   1. One quota unit per TURN, never per hop. The whole tool loop lives inside
 *      a single turn, so `freeTierStore.tryUse` must be called exactly once and
 *      must NOT be reachable from a per-hop path (the catalog/executor).
 *      LIN-2970 moved the `tryUse` call itself into `lib/chat-request.js`'s
 *      `checkFreeTierGate` (the shared chat-lane free-tier gate) — the route
 *      now calls THAT exactly once per turn instead, and the invariant is
 *      pinned across both files so the "once per turn, never per hop"
 *      guarantee still holds end to end.
 *   2. LIN-2966: the route no longer picks a model, branches on
 *      `isToolCapableModel`, or calls `streamChat`/`streamChatWithTools`/
 *      `createChatToolCatalog` itself — it delegates the whole turn to the
 *      shared agent-turn core (`lib/agent-turn.js`) via `runAgentTurn`,
 *      exactly as Flight Companion's routes already do. The core's own real,
 *      executable coverage (model resolution incl. a per-operation override,
 *      the tool-capable/degrade branch, callMeta attribution) lives in
 *      tests/unit/agent-turn-core.test.js — this file only pins that Task
 *      Chat hands the core the RIGHT inputs (`opKind: 'task-chat'`, the row's
 *      resolved binding, its own prompt).
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
const CHAT_REQUEST_SRC = readFileSync(join(__dirname, '../../lib/chat-request.js'), 'utf8');

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
  test('calls the shared free-tier gate exactly once — one quota unit per turn, not per hop', () => {
    // LIN-2970: the route no longer calls freeTierStore.tryUse directly — it
    // calls lib/chat-request.js's checkFreeTierGate, which does. Pinning both
    // ends preserves the original guarantee (once per turn, never per hop)
    // across the extraction.
    assert.doesNotMatch(ROUTE_SRC, /freeTierStore\.tryUse\s*\(/, 'the route must not call tryUse directly anymore — it goes through checkFreeTierGate');
    const routeGateCalls = ROUTE_SRC.match(/checkFreeTierGate\s*\(/g) || [];
    assert.strictEqual(routeGateCalls.length, 1, 'expected exactly one checkFreeTierGate call in the route');
    const gateTryUseCalls = CHAT_REQUEST_SRC.match(/freeTierStore\.tryUse\s*\(/g) || [];
    assert.strictEqual(gateTryUseCalls.length, 1, 'expected exactly one tryUse call inside checkFreeTierGate itself');
  });

  test('the tool catalog / executor never calls a quota store (no per-hop tryUse)', () => {
    assert.doesNotMatch(CATALOG_SRC, /tryUse/);
    assert.doesNotMatch(CATALOG_SRC, /freeTier/i);
  });

  test('LIN-2966: the route delegates the whole turn to the shared agent-turn core — no inline model pick, branch, or stream call of its own', () => {
    // The properties LIN-990 used to pin directly on this file (model branch,
    // streamChatWithTools/streamChat, createChatToolCatalog) now live in the
    // core and are proven live there (tests/unit/agent-turn-core.test.js).
    // This route must not re-implement or shadow any of them.
    assert.doesNotMatch(ROUTE_SRC, /isToolCapableModel\s*\(/,
      'the tool-capable/degrade branch lives in the core now');
    assert.doesNotMatch(ROUTE_SRC, /streamChatWithTools\s*\(/,
      'streamChatWithTools must not be CALLED in the route — only referenced, as deps.chatClient.streamChatWithTools');
    assert.doesNotMatch(ROUTE_SRC, /\bstreamChat\s*\(/,
      'streamChat must not be CALLED in the route either');
    assert.doesNotMatch(ROUTE_SRC, /createChatToolCatalog\s*\(/,
      'createChatToolCatalog must not be CALLED in the route — only referenced, as deps.createToolCatalog');
    assert.doesNotMatch(ROUTE_SRC, /resolveWorkspaceModel\s*\(/,
      'model resolution is the core\'s job now (via opKind), not the route\'s');
    assert.match(ROUTE_SRC, /runAgentTurn\s*\(/, 'the route must call the shared turn core');
  });

  test('LIN-2966: the turn core call is given task-chat\'s own opKind, prompt, and stores — never Flight Companion\'s defaults', () => {
    const start = ROUTE_SRC.indexOf('await runAgentTurn({');
    assert.ok(start > 0, 'expected the runAgentTurn call site to exist');
    const end = ROUTE_SRC.indexOf('\n      });', start);
    assert.ok(end > start, 'expected the runAgentTurn call to close with `});`');
    const callSrc = ROUTE_SRC.slice(start, end);

    assert.match(callSrc, /turnKind:\s*'user-initiated'/,
      'Task Chat never has an auto-wake/boot concept — every turn is user-initiated');
    assert.match(callSrc, /opKind:\s*'task-chat'/,
      'without its own opKind, a Settings model override would silently fall back to flight-companion\'s');
    assert.match(callSrc, /allowPlaybookWrite:\s*false/,
      'Task Chat has never exposed a remember/playbook write tool and must not inherit the core\'s default');
    assert.match(callSrc, /buildMessages:\s*buildTaskChatTurnMessages/,
      'the core must be handed Task Chat\'s OWN prompt, not fall through to the Flight Companion brief');
    // LIN-2966 item 5 (subsumes LIN-2660): the two inputs list_pending_decisions
    // needs, threaded all the way from server.js into this call.
    assert.match(callSrc, /taskDecisionsStore\s*,/);
    assert.match(callSrc, /shelvedRulingsStore\s*,/);
  });

  test('LIN-2966: the turn core is bound to the row\'s resolved binding, not the workspace-active one (LIN-2047, carried forward)', () => {
    // LIN-1910 threaded resolveIssueBinding into the context fetch but left the
    // tool catalog on the workspace-active provider/scope, so a mid-turn lookup
    // tool for a foreign-source row (e.g. a Jira row in a merged workspace)
    // resolved the WRONG binding — `Task <id> not found`, or worse, a different
    // issue's content presented as this task's. LIN-2047 fixed the direct
    // createChatToolCatalog call; LIN-2966 moved that call inside the shared
    // core, so the pin now targets the `getProvider`/`getScope` closures the
    // route hands the core instead.
    //
    // Live-invocation arg capture (spying on createChatToolCatalog) isn't
    // available here without opting the whole unit suite into Node's
    // `--experimental-test-module-mocks` flag (mock.module is undefined
    // without it, and no test in this repo currently uses it) — so, matching
    // this file's own established idiom for pinning route wiring facts
    // cheaply and without a network call, this asserts against the call
    // site's source text instead.
    const start = ROUTE_SRC.indexOf('await runAgentTurn({');
    assert.ok(start > 0, 'expected the runAgentTurn call site to exist');
    const end = ROUTE_SRC.indexOf('\n      });', start);
    assert.ok(end > start, 'expected the runAgentTurn call to close with `});`');
    const callSrc = ROUTE_SRC.slice(start, end);

    assert.match(callSrc, /getProvider:\s*\(\)\s*=>\s*issueProvider\s*,/,
      'the core must receive the row\'s resolved provider (issueProvider), not the workspace-active one');
    assert.match(callSrc, /getScope:\s*\(\)\s*=>\s*issueCallScope\s*,/,
      'the core must receive the row\'s resolved scope (issueCallScope), not the workspace-active one');
    // LIN-2967 gives `get_stack`/`get_pr_status` a DELIBERATE workspace-active
    // override via `scopeByTier.workspace` — the more precise test below pins
    // that it never leaks into these row-tier `getProvider`/`getScope`
    // closures, rather than asserting workspace-active helpers are absent
    // from the whole call (which is no longer true).
  });

  test('LIN-2967: getProviderForWorkspace / getWorkspaceCallScope are used ONLY for the workspace-tier override, never for the row-tier pair', () => {
    // LIN-2047's fix (the row-tier pair) must still never read the
    // workspace-active binding — only the NEW workspace-tier override may.
    const runAgentTurnStart = ROUTE_SRC.indexOf('await runAgentTurn({');
    const runAgentTurnEnd = ROUTE_SRC.indexOf('\n      });', runAgentTurnStart);
    const callSrc = ROUTE_SRC.slice(runAgentTurnStart, runAgentTurnEnd);
    assert.match(callSrc, /getProviderForWorkspace\(workspace\)/,
      'the workspace-tier override must resolve the workspace-active provider');
    assert.match(callSrc, /getWorkspaceCallScope\(workspace\)/,
      'the workspace-tier override must resolve the workspace-active scope');
    // Both calls must live inside `scopeByTier.workspace`, not `getProvider`/
    // `getScope` (the row-tier closures) — a regex over the FULL call would
    // pass even if they leaked into the row-tier pair, so isolate the
    // `scopeByTier` block specifically.
    const scopeByTierStart = callSrc.indexOf('scopeByTier:');
    assert.ok(scopeByTierStart > 0, 'expected a scopeByTier block in the runAgentTurn call');
    const beforeScopeByTier = callSrc.slice(0, scopeByTierStart);
    assert.doesNotMatch(beforeScopeByTier, /getProviderForWorkspace|getWorkspaceCallScope/,
      'the row-tier getProvider/getScope closures (declared before scopeByTier) must stay on issueProvider/issueCallScope');
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

  test('privacy boundary: savedChatStore reaches createProxyRoutes for exactly one creator-scoped read (LIN-2634), never createWorkspaceApiRoutes', () => {
    // Content-bearing → session-auth only, with ONE narrow, deliberate
    // exception (LIN-2634): a creator-scoped, read-only transcripts route
    // reachable over the token-auth proxy surface (GET
    // /api/proxy/flight-companion/transcripts, routes/proxy-flight-companion.js).
    // It must still reach the task-chat + test route factories, and must
    // still never reach createWorkspaceApiRoutes at all.
    const proxyLine = SERVER_SRC.split('\n').find(l => l.includes('createProxyRoutes({'));
    const wsApiLine = SERVER_SRC.split('\n').find(l => l.includes('createWorkspaceApiRoutes({'));
    assert.ok(proxyLine && /savedChatStore/.test(proxyLine), 'savedChatStore must be passed to createProxyRoutes (LIN-2634)');
    assert.ok(wsApiLine && !/savedChatStore/.test(wsApiLine), 'savedChatStore must not be passed to createWorkspaceApiRoutes');
    // It IS wired into the task-chat route factory.
    const taskChatLine = SERVER_SRC.split('\n').find(l => l.includes('createTaskChatRoutes({'));
    assert.ok(taskChatLine && /savedChatStore/.test(taskChatLine), 'savedChatStore must be passed to createTaskChatRoutes');
  });
});
