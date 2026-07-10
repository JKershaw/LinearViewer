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
