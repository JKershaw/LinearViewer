/**
 * Unit tests for lib/prompts/autopilot-manual.js
 *
 * Run with: node --test tests/unit/autopilot-manual.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildAutopilotManual, extractPrincipleZeroSection } from '../../lib/prompts/autopilot-manual.js';

describe('buildAutopilotManual (unchanged)', () => {
  test('still returns the whole manual, starting with the handbook title', () => {
    const manual = buildAutopilotManual();
    assert.ok(manual.startsWith('# The Autopilot Handbook'));
  });

  test('still contains the Principle 0 section inline (the extractor slices this same text)', () => {
    const manual = buildAutopilotManual();
    assert.ok(manual.includes("## The human's edge, and how to hand back"));
  });
});

describe('extractPrincipleZeroSection', () => {
  test('starts with the anchor heading, byte-identical', () => {
    const section = extractPrincipleZeroSection();
    assert.ok(section.startsWith("## The human's edge, and how to hand back"));
  });

  test('carries the Principle 0 gate, the self-sufficient ruling format, and the sibling-merge rule, in order', () => {
    const section = extractPrincipleZeroSection();
    const gateAt = section.indexOf('Gate on Principle 0 first');
    const rulingAt = section.indexOf('make the ruling self-sufficient');
    const mergeAt = section.indexOf('Merge sibling blockers before you bubble up');
    assert.ok(gateAt > -1, 'the Principle 0 gate anchor is present');
    assert.ok(rulingAt > gateAt, 'the self-sufficient ruling anchor follows the gate');
    assert.ok(mergeAt > rulingAt, 'the sibling-merge anchor follows the ruling format');
  });

  test('stops before the next section — excludes "Knowing when to stop"', () => {
    const section = extractPrincipleZeroSection();
    assert.ok(!section.includes('## Knowing when to stop'));
  });

  test('excludes prose from the preceding section', () => {
    const section = extractPrincipleZeroSection();
    assert.ok(!section.includes('An issue-bearing child autopilot counts as one task'));
  });

  test('is an exact substring of the full manual (a pure slice, not a rewrite)', () => {
    const manual = buildAutopilotManual();
    const section = extractPrincipleZeroSection();
    assert.ok(manual.includes(section));
  });
});

/**
 * LIN-2334 — the `blocked` carve-out on the coordinator's PER-CHILD liveness
 * clock.
 *
 * This is not documentation: `lib/prompts/autopilot-manual.js` reads this file
 * as its single source of truth and it is inlined verbatim into every autopilot
 * kickoff, so prose here reaches the model on every run. Before this ticket the
 * per-child clock stated the ~30-minute rule with no carve-out, which told the
 * coordinator to nudge and re-dispatch a child that is silent *because a human
 * is parked on it* — out from under that human.
 *
 * Pinned the way the four `lib/prompts/autopilot-kickoff.js` statements of the
 * same rule are pinned (tests/unit/autopilot-kickoff.test.js), and asserted on
 * the BUILT manual rather than on the file, because the built string is what
 * actually reaches the model.
 */
describe('LIN-2334: the blocked carve-out on the per-child liveness clock', () => {
  // The manual is hard-wrapped Markdown, so every assertion below runs against
  // the whitespace-flattened text — the same idiom the sibling kickoff pins use
  // (tests/unit/autopilot-kickoff.test.js), and the right one here because a
  // re-wrap of the paragraph is not a prompt change and must not fail the suite.
  const flat = () => buildAutopilotManual().replace(/\s+/g, ' ');

  test('the manual carries the adjudicated carve-out sentence', () => {
    assert.ok(
      flat().includes("don't nudge or re-dispatch it on this rule, surface it to the human so they can unblock it"),
      'the carve-out must be present in the manual the kickoff inlines'
    );
  });

  test('it names a human parked on the child, and does not promise silence (LIN-2332)', () => {
    assert.ok(flat().includes('a child already woken to you as `blocked` has a human parked on it'));
    assert.ok(flat().includes('so that silence is not a wedge'));
    // LIN-2332: the "expected to stay silent" premise is false since LIN-2297
    // made the wake guard class-aware — a later terminal on that row does now
    // reach the coordinator. The carve-out must not reinstate it.
    assert.ok(!flat().includes('expected to stay silent'));
    assert.ok(flat().includes('You may be woken again on it'));
  });

  test('it uses "surface it to the human", never LIN-2269\'s rejected "keep waiting for the unblock"', () => {
    // LIN-2269 adjudicated this correction: a `blocked` step consumes the
    // once-only terminal-wake slot, so "keep waiting" waits on a wake that
    // (at the time) could never arrive. The rejected phrasing must not
    // reappear here by way of a later well-meaning edit.
    //
    // Asserts BOTH halves: the negative alone stays green if the carve-out is
    // deleted wholesale, which would make this test's name a lie.
    assert.ok(flat().includes('surface it to the human'));
    assert.ok(!flat().includes('keep waiting for the unblock'));
  });

  test('the carve-out sits INSIDE the per-child liveness clock, not merely somewhere in the file', () => {
    // The defect was location-specific: the rule at the per-child clock had no
    // carve-out even though the kickoff's statements of the same rule did. A
    // carve-out elsewhere in the manual would not fix it, so assert adjacency
    // rather than mere presence.
    const text = flat();
    const clockAt = text.indexOf('each outstanding child carries its own ~30-minute liveness clock');
    const carveAt = text.indexOf("don't nudge or re-dispatch it on this rule, surface it to the human so they can unblock it");
    const nextBulletAt = text.indexOf('**Judge its report on evidence and advance.**');
    assert.ok(clockAt > -1, 'the per-child liveness clock is present');
    assert.ok(carveAt > clockAt, 'the carve-out follows the clock it qualifies');
    assert.ok(nextBulletAt > carveAt, 'the carve-out is still inside that bullet, before the next one');
  });

  test('the per-child probe is still forbidden from becoming a standing poll', () => {
    // Regression guard: the carve-out was spliced mid-bullet, so the sentence
    // it was inserted ahead of must survive.
    assert.ok(flat().includes('Never promote that per-child probe into a standing poll'));
  });
});
