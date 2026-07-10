/**
 * Structural guards for routes/ship-biscuit.js — the editor-in-chief LLM call wiring
 * (LIN-1185).
 *
 * The live editor round-trip runs against OpenRouter, not in CI, so these pin the
 * regression-catching invariants CI *can* assert without a network call. The
 * behavioural half (a truncated reply is a failure, not a quiet edition) lives in
 * tests/unit/ship-biscuit-editor.test.js against the pure assessEditorOutcome seam;
 * these confirm the route actually wires that seam and the raised token budget.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createShipBiscuitRoutes } from '../../routes/ship-biscuit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(__dirname, '../../routes/ship-biscuit.js'), 'utf8');

describe('ship-biscuit editor-call budget wiring (LIN-1185)', () => {
  test('routes the editor call through resolveReasoningBudget, not a fixed cap', () => {
    assert.match(ROUTE_SRC, /resolveReasoningBudget\s*\(\s*\{\s*model:\s*modelId/);
    // The old fixed cap that truncated busy weeks must be gone.
    assert.doesNotMatch(ROUTE_SRC, /maxTokens:\s*1600/);
    // The editor call passes the derived reasoning + maxTokens through to streamChat.
    assert.match(ROUTE_SRC, /maxTokens,\s*reasoning/);
  });

  test('captures finishReason from the streamChat done event', () => {
    assert.match(ROUTE_SRC, /type\s*===\s*'done'/);
    assert.match(ROUTE_SRC, /finishReason\s*=\s*data\?\.finishReason/);
  });

  test('surfaces a non-quiet parse failure instead of degrading to a quiet edition', () => {
    // The failure branch asks assessEditorOutcome and THROWS an editorFailure …
    assert.match(ROUTE_SRC, /assessEditorOutcome\s*\(\s*body\s*,\s*finishReason\s*\)/);
    assert.match(ROUTE_SRC, /editorFailure/);
    // … it does NOT reassign body to a quiet edition on that path (the old silent
    // degrade). buildQuietEdition survives only for the genuinely-quiet window.
    const quietCalls = ROUTE_SRC.match(/buildQuietEdition\s*\(/g) || [];
    assert.strictEqual(quietCalls.length, 1, 'buildQuietEdition should only serve the real quiet-window path');
    assert.doesNotMatch(ROUTE_SRC, /empty→quiet/);
  });

  test('the outer handler maps an editorFailure to a clear, retryable error', () => {
    assert.match(ROUTE_SRC, /error\.editorFailure/);
    // Post LIN-1203 the error rides through the keepalive guard, so the 502 is
    // emitted via keepalive.send (works whether or not the guard already flushed)
    // rather than a bare res.status(502).
    assert.match(ROUTE_SRC, /keepalive\.send\(502/);
  });
});

describe('ship-biscuit H12 keepalive guard (LIN-1203)', () => {
  test('imports and arms the shared http-keepalive guard', () => {
    assert.match(ROUTE_SRC, /import\s*\{\s*armKeepalive\s*\}\s*from\s*'\.\.\/lib\/http-keepalive\.js'/);
    // Armed once, before the slow gather + editor-in-chief call.
    assert.match(ROUTE_SRC, /const keepalive = armKeepalive\(res\)/);
  });

  test('every terminal response inside the guarded path rides through keepalive.send', () => {
    // Success edition, the free-tier 429, and both error branches must all use
    // keepalive.send so they stay valid after the guard flushes HTTP 200 past H12.
    assert.match(ROUTE_SRC, /keepalive\.send\(200,\s*\{\s*edition:\s*saved\s*\}\)/);
    assert.match(ROUTE_SRC, /keepalive\.send\(429/);
    assert.match(ROUTE_SRC, /keepalive\.send\(401/);
    // Guard is torn down before every send (no dangling heartbeat interval).
    assert.match(ROUTE_SRC, /keepalive\.stop\(\)/);
    // The old unguarded success/error response shapes must be gone from the handler.
    assert.doesNotMatch(ROUTE_SRC, /res\.json\(\{\s*edition:\s*saved\s*\}\)/);
  });
});

// ─── Behavioural coverage of the flushed branch (LIN-1203 close-out) ───────────
// The structural guards above pin that the handler WIRES keepalive.send; this
// drives the flushed branch itself — the flush-HTTP-200 → heartbeat → post-flush
// keepalive.send path that is the entire point of the fix and that the review
// ledger flagged as not exercised end-to-end (mocked AI never trips the 25s
// delayMs in CI). Rather than a real Heroku >30s generation, this forces the
// timers so the guard flushes, then asserts the edition still rides through
// res.end on the committed-200 path — the reviewer's stated alternative discharge,
// mirroring the LIN-615 dashboard keepalive test.

// A res that records both the flushed-heartbeat path (status/setHeader/flushHeaders/
// write/end) and the fast json() path.
function makeFlushRes() {
  return {
    statusCode: 200,
    headers: {},
    flushedHeaders: false,
    writes: [],
    endedWith: undefined,
    jsonBody: null,
    writableEnded: false,
    destroyed: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    flushHeaders() { this.flushedHeaders = true; return this; },
    write(chunk) { this.writes.push(chunk); return true; },
    json(b) { this.jsonBody = b; return this; },
    end(b) { this.endedWith = b; this.writableEnded = true; return this; }
  };
}

// Grab the actual route handler (last in the route stack, after workspaceFromUrl).
function getRouteHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('ship-biscuit generate survives H12 via the flushed keepalive branch (LIN-1203 close-out)', () => {
  test('a >25s generation flushes 200 + a heartbeat, then delivers the edition via res.end', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

    // Stall the first gather read so the handler stays pending past the 25s flush
    // threshold — the same stall-then-release technique as the LIN-615 test.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const router = createShipBiscuitRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      workspacePreferencesStore: null,
      getOpenRouterSource: () => 'oauth',
      getDeployInfo: () => ({}),
      observationSessionsStore: { async findByWorkspace() { await gate; return { sessions: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      llmCallLogStore: { async summarize() { return null; } },
      taskSnapshotStore: { async listByWorkspace() { return { items: [] }; } },
      shipBiscuitHistoryStore: { async save(_urlKey, edition) { return { id: 'ed-1', ...edition }; } }
    });

    const handler = getRouteHandler(router, 'post', '/workspace/:urlKey/api/ship-biscuit/generate');
    // shipBiscuit flag on + a session OpenRouter key so we clear the pre-guard
    // 503; empty sources make the window quiet, so no real LLM call is made.
    const req = {
      workspace: { urlKey: 'ws-a', name: 'Alpha' },
      session: { features: { shipBiscuit: true }, openRouterApiKey: 'sk-test' },
      body: {}
    };
    const res = makeFlushRes();

    const done = handler(req, res);

    // Past the 25s flush threshold: HTTP 200 + JSON committed, no body yet.
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the slow gather finished');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    assert.equal(res.endedWith, undefined, 'no body committed yet — still gathering past H12');

    // One heartbeat interval later: a single JSON-safe whitespace byte.
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written past the H12 cap');

    // Release the stalled gather; the edition now rides the *flushed* send path.
    release();
    await done;

    // The client receives the edition via res.end (committed-200), NOT an H12/timeout error.
    assert.ok(res.endedWith, 'final edition delivered via res.end on the committed-200 path');
    const body = JSON.parse(res.endedWith);
    assert.ok(body.edition, 'the client receives the edition instead of a timeout/network error');
    assert.equal(res.statusCode, 200);
    assert.ok(body.edition.frontPage && Array.isArray(body.edition.index), 'a well-formed edition body');
    // The fast json() path must NOT have been used — the whole point is the flushed branch.
    assert.equal(res.jsonBody, null, 'edition rode the flushed res.end path, not the fast res.json path');
  });
});
