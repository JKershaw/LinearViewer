/**
 * Unit tests for lib/prompts/autopilot-kickoff.js
 *
 * Run with: node --test tests/unit/autopilot-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT } from '../../lib/prompts/autopilot-kickoff.js';

const BASE_URL = 'https://example.com';

describe('buildAutopilotKickoff (shared guide)', () => {
  test('starts with the Autopilot persona header', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.startsWith("# You're Autopilot"));
  });

  test('embeds the proxy base URL and instructions pointer', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/instructions`));
  });

  test('carries the four invariants and the halt rule', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('Evidence beats self-report'));
    assert.ok(text.includes('Stay light'));
    assert.ok(text.includes('When to halt'));
  });

  test('warns that a terminal done is a session boundary, not proof of success', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('the session ended'));
    assert.ok(text.includes('[stalled?]'));
  });

  test('defaults to write/merge-gated mode', () => {
    assert.strictEqual(AUTOPILOT_MODE_DEFAULT, 'write');
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('WRITE, merge-gated'));
    assert.ok(text.includes('Merging is allowed'));
  });
});

describe('buildAutopilotKickoff (general / stack-walk)', () => {
  test('no goal → walks the stack under the precedence policy', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('none this run — walk the stack'));
  });

  test('first act fetches the stack', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/stack?limit=5`));
  });

  test('a free-text goal is surfaced in the snapshot', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'finish the Ship view' });
    assert.ok(text.includes('finish the Ship view'));
  });
});

describe('buildAutopilotKickoff (scoped to an issue)', () => {
  const issue = { identifier: 'LIN-42', title: 'Fix login bug' };

  test('goal is pinned to the task and the precedence policy is moot', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('run on autopilot until **LIN-42** (Fix login bug)'));
    assert.ok(text.includes('precedence policy is moot'));
  });

  test('first act reads the issue and triggers recommend-and-dispatch for it', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('GET /issues/LIN-42'));
    // The fused verb (LIN-321) replaces the two-step GET /recommend -> POST /dispatch:
    // the scoped first act triggers recommend-and-dispatch with the issue identifier.
    assert.ok(text.includes('POST /recommend-and-dispatch'));
    assert.ok(text.includes('issueIdentifier: "LIN-42"'));
  });

  test('does not pull other tasks off the stack', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('Do not pull other tasks off the stack'));
  });
});

describe('buildAutopilotKickoff (read-only mode)', () => {
  test('restricts the worker to findings-only and names the boundary', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly' });
    assert.ok(text.includes('READ-ONLY'));
    assert.ok(text.includes('no code changes, no PRs, no Linear state changes'));
    assert.ok(!text.includes('WRITE, merge-gated'));
  });

  test('AUTOPILOT_MODES enumerates the supported modes', () => {
    assert.deepStrictEqual(AUTOPILOT_MODES, ['write', 'readonly']);
  });
});
