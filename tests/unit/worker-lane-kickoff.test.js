/**
 * Unit tests for lib/prompts/worker-lane-kickoff.js (LIN-2242).
 *
 * Pins the preamble-cut contract: docs/worker-lane-prompt.md's design-artifact
 * preamble sits above the file's one `^---$` divider; only the body after it
 * is the pasteable live-session prompt. Mirrors
 * tests/unit/passage-runner-kickoff.test.js's pinning style.
 *
 * Run with: node --test tests/unit/worker-lane-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildWorkerLaneKickoff } from '../../lib/prompts/worker-lane-kickoff.js';

describe('buildWorkerLaneKickoff', () => {
  test('output is non-empty and excludes the preamble above the divider', () => {
    const text = buildWorkerLaneKickoff();
    assert.ok(text.length > 0);
    assert.ok(!text.startsWith('# Worker Lane'));
    assert.ok(!text.includes('What this is.'));
  });

  test('contains stable body-content markers — the re-grounding mandate and the refusal license', () => {
    const text = buildWorkerLaneKickoff();
    assert.ok(text.includes("the operator's framing may be wrong"));
    assert.ok(text.includes('A refused close is a good outcome'));
  });

  test('contains the [ticket] marker convention and the trim self-governance disclosure', () => {
    const text = buildWorkerLaneKickoff();
    assert.ok(text.includes('[ticket] LIN-XXXX done'));
    assert.ok(text.includes('has not yet been proven against'));
  });

  // LIN-3006: Step 3 performs close-out inline and was a missed same-kind
  // sibling of the review/close-out inside/outside rule — this pins the fix.
  test('Step 3 carries the same inside/outside scope rule as review/close-out (LIN-3006)', () => {
    const text = buildWorkerLaneKickoff();
    assert.ok(text.includes('the same way review and close-out mark it'),
      'Step 3 must carry the inside/outside scope rule');
    assert.ok(text.includes('never file it'),
      'an inside finding must never be filed from the worker lane');
    assert.ok(/Offer or accept a "file" option only for a finding outside every bounded\s+class/.test(text),
      'a "file" option is limited to outside findings');
  });
});
