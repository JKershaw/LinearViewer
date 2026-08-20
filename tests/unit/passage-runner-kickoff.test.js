/**
 * Unit tests for lib/prompts/passage-runner-kickoff.js (LIN-2162).
 *
 * Pins the preamble-cut contract: docs/passage-runner-prompt.md's
 * design-artifact preamble sits above the file's one `^---$` divider; only
 * the body after it is the pasteable live-session prompt. Mirrors
 * tests/unit/passage-planner-kickoff.test.js's pinning style.
 *
 * Run with: node --test tests/unit/passage-runner-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildPassageRunnerKickoff } from '../../lib/prompts/passage-runner-kickoff.js';

describe('buildPassageRunnerKickoff', () => {
  test('output is non-empty and excludes the preamble above the divider', () => {
    const text = buildPassageRunnerKickoff();
    assert.ok(text.length > 0);
    assert.ok(!text.startsWith('# Passage Runner'));
    assert.ok(!text.includes('What this is.'));
  });

  test('contains a stable body-content marker — the required leg-block heading', () => {
    const text = buildPassageRunnerKickoff();
    assert.ok(text.includes('### Leg:'));
  });
});
