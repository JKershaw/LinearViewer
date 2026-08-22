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
