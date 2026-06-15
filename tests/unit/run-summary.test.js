/**
 * Unit tests for lib/run-summary.js (LIN-509).
 *
 * Run with: node --test tests/unit/run-summary.test.js
 *
 * Coverage:
 *   - formatRunContext renders the load-bearing Loop fields
 *   - buildRunSummaryMessages shape (system + user)
 *   - parseRunSummaryResponse: clean JSON, fenced, prose-wrapped, garbage,
 *     bullet cap, type coercion
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatRunContext,
  buildRunSummaryMessages,
  parseRunSummaryResponse
} from '../../lib/run-summary.js';

const LOOP = {
  loopId: 'd1',
  issueIdentifier: 'LIN-42',
  issueTitle: 'Fix the thing',
  iteration: 2,
  promptName: 'implementation',
  stage: 'implement',
  agentState: 'complete',
  foremanSummary: 'Implemented the fix and added a test.',
  feedback: [{ message: 'opened PR #7' }, 'done'],
  promptText: 'Please implement the fix.'
};

describe('formatRunContext', () => {
  test('includes identifier, iteration, stage, summary and feedback', () => {
    const out = formatRunContext(LOOP);
    assert.match(out, /LIN-42/);
    assert.match(out, /Fix the thing/);
    assert.match(out, /Iteration: 2/);
    assert.match(out, /Stage: implement/);
    assert.match(out, /Implemented the fix/);
    assert.match(out, /opened PR #7/);
  });

  test('tolerates a null/garbage loop', () => {
    assert.equal(typeof formatRunContext(null), 'string');
    assert.equal(typeof formatRunContext(undefined), 'string');
  });
});

describe('buildRunSummaryMessages', () => {
  test('returns a system + user pair', () => {
    const msgs = buildRunSummaryMessages(LOOP);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
    assert.match(msgs[1].content, /LIN-42/);
  });
});

describe('parseRunSummaryResponse', () => {
  test('parses a clean JSON object', () => {
    const raw = JSON.stringify({
      outcome: 'Shipped the fix',
      whatHappened: ['edited file', 'added test'],
      blockers: [],
      next: 'review'
    });
    const out = parseRunSummaryResponse(raw);
    assert.equal(out.outcome, 'Shipped the fix');
    assert.deepEqual(out.whatHappened, ['edited file', 'added test']);
    assert.deepEqual(out.blockers, []);
    assert.equal(out.next, 'review');
  });

  test('strips markdown code fences', () => {
    const raw = '```json\n{"outcome":"ok","whatHappened":["a"]}\n```';
    const out = parseRunSummaryResponse(raw);
    assert.equal(out.outcome, 'ok');
    assert.deepEqual(out.whatHappened, ['a']);
  });

  test('extracts JSON from surrounding prose', () => {
    const raw = 'Here you go: {"outcome":"x","whatHappened":["y"]} hope that helps';
    const out = parseRunSummaryResponse(raw);
    assert.equal(out.outcome, 'x');
  });

  test('caps whatHappened at 3 bullets', () => {
    const raw = JSON.stringify({ outcome: 'o', whatHappened: ['1', '2', '3', '4', '5'] });
    const out = parseRunSummaryResponse(raw);
    assert.equal(out.whatHappened.length, 3);
  });

  test('coerces non-string fields safely', () => {
    const raw = JSON.stringify({ outcome: 42, whatHappened: 'nope', blockers: [1, 'real'], next: null });
    const out = parseRunSummaryResponse(raw);
    assert.equal(out.outcome, '');
    assert.deepEqual(out.whatHappened, []);
    assert.deepEqual(out.blockers, ['real']);
    assert.equal(out.next, '');
  });

  test('returns empty summary on garbage', () => {
    const out = parseRunSummaryResponse('not json at all');
    assert.deepEqual(out, { outcome: '', whatHappened: [], blockers: [], next: '' });
  });

  test('returns empty summary on non-string input', () => {
    assert.deepEqual(parseRunSummaryResponse(null), { outcome: '', whatHappened: [], blockers: [], next: '' });
  });
});
