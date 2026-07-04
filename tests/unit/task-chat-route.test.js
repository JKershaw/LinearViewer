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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(__dirname, '../../routes/task-chat.js'), 'utf8');
const CATALOG_SRC = readFileSync(join(__dirname, '../../lib/chat-tools.js'), 'utf8');

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
