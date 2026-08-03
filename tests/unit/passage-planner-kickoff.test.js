/**
 * Unit tests for lib/prompts/passage-planner-kickoff.js (LIN-1849).
 *
 * Pins the preamble-cut contract: docs/passage-planner-prompt.md's lines 1-37
 * are a design-artifact preamble; line 38 is the file's only `^---$`; only the
 * body after it is the pasteable live-session prompt. Mirrors
 * tests/unit/flight-companion-kickoff.test.js's pinning style.
 *
 * Run with: node --test tests/unit/passage-planner-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildPassagePlannerKickoff } from '../../lib/prompts/passage-planner-kickoff.js';

describe('buildPassagePlannerKickoff', () => {
  test('does not contain preamble markers', () => {
    const text = buildPassagePlannerKickoff();
    assert.ok(!text.includes('What this is'));
    assert.ok(!text.includes('v0.1 revises v0'));
    assert.ok(!text.includes('Graduation-lift tracking'));
  });

  test('does not start with the doc H1 title', () => {
    const text = buildPassagePlannerKickoff();
    assert.ok(!text.startsWith('# Passage Planner'));
  });

  test('contains the body markers — the session persona and the leg writeup format', () => {
    const text = buildPassagePlannerKickoff();
    assert.ok(text.includes('live passage-planning session'));
    assert.ok(text.includes('### Leg:'));
  });

  test('the wording fix at the access-block reference is conditionally accurate', () => {
    const text = buildPassagePlannerKickoff();
    assert.ok(text.includes('appended below this prompt'));
    assert.ok(!text.includes('pasted above this prompt'));
  });

  test('caches the result across calls (readFileSync happens once)', () => {
    const first = buildPassagePlannerKickoff();
    const second = buildPassagePlannerKickoff();
    assert.strictEqual(first, second);
  });

  test('ends with a trailing newline', () => {
    const text = buildPassagePlannerKickoff();
    assert.ok(text.endsWith('\n'));
  });
});
