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
    assert.ok(text.includes('Merge on green'));
  });
});

describe('buildAutopilotKickoff (inline handbook / disposition layer)', () => {
  // Anchor on structural facts (the handbook H1, the kickoff-owned lens transition,
  // ordering, the endpoint pointer) — never on handbook prose, which stays freely
  // editable in docs/autopilot-operating-manual.md.
  test('composes the handbook inline', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('# The Autopilot Handbook'));
  });

  test('the handbook is the lens — it precedes the mechanism (the four lines)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    const handbookAt = text.indexOf('# The Autopilot Handbook');
    const fourLinesAt = text.indexOf('The four lines that are the human');
    assert.ok(handbookAt > -1 && fourLinesAt > -1);
    assert.ok(handbookAt < fourLinesAt, 'handbook should come before the four lines');
  });

  test('points at the manual endpoint for mid-run re-reference', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/autopilot/manual`));
  });
});

describe('buildAutopilotKickoff (general / stack-walk)', () => {
  test('no goal → walks the stack under the precedence policy', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('none this run — walk the stack'));
  });

  test('first act fetches the stack digest (light orientation, not full bodies)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/stack?limit=5&view=digest`));
  });

  test('a free-text goal is surfaced in the snapshot', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'finish the Ship view' });
    assert.ok(text.includes('finish the Ship view'));
  });

  test('orient verb list points at the digest view', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('GET /stack?view=digest'));
  });

  test('deliverable cross-check is kept general (not a fixed code-only checklist)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('deliverable this task was meant to produce'));
    assert.ok(text.includes('not a fixed checklist'));
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
    // Lead with the distilled brief as starting context (LIN-260); the raw /issues
    // read stays available for full detail the brief doesn't carry.
    assert.ok(text.includes('GET /brief/LIN-42'), 'scoped first act should start from the distilled brief');
    assert.ok(text.includes('GET /issues/LIN-42'), 'raw issue detail stays available');
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

  test('is honest that read-only is a convention enforced via plain dispatch, not the fused verb', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly' });
    // read-only must not lean on recommend-and-dispatch (which generates write-shaped prompts)
    assert.ok(text.includes('plain `POST /dispatch`'));
    assert.ok(text.includes('not a sandbox the platform enforces'));
  });

  test('AUTOPILOT_MODES enumerates the supported modes', () => {
    assert.deepStrictEqual(AUTOPILOT_MODES, ['write', 'readonly']);
  });
});
