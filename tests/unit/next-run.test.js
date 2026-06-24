/**
 * Unit tests for lib/next-run.js (LIN-603).
 *
 * Run with: node --test tests/unit/next-run.test.js
 *
 * Coverage:
 *   - formatNextRunContext renders velocity, in-progress work, and the queue
 *   - buildNextRunMessages shape (system + user)
 *   - normalizeSize coercion
 *   - parseGoalSuggestions: clean JSON, fenced, prose-wrapped, garbage, size
 *     coercion, empty-goal drop, cap
 *   - generateGoalSuggestions always appends the continue-until-stopped option
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatNextRunContext,
  buildNextRunMessages,
  parseGoalSuggestions,
  normalizeSize,
  generateGoalSuggestions,
  CONTINUE_UNTIL_STOPPED_OPTION,
  TSHIRT_SIZES,
} from '../../lib/next-run.js';

const MODEL = {
  velocity: { tasksPerWeek: 3.5, pointsPerWeek: 8, trend: 'increasing' },
  executionQueue: [
    { identifier: 'LIN-10', title: 'In-flight work', stateType: 'started', priority: 1, projectName: 'Core', labels: [] },
    { identifier: 'LIN-11', title: 'Next up', stateType: 'unstarted', priority: 2, projectName: 'Core', labels: ['bug'] },
  ],
  milestones: [{ projectName: 'Core', subtaskDone: 4, subtaskTotal: 10 }],
};

describe('formatNextRunContext', () => {
  test('renders velocity, in-progress, queue, and milestones', () => {
    const out = formatNextRunContext(MODEL, 'Acme');
    assert.match(out, /Workspace: Acme/);
    assert.match(out, /3\.5 tasks\/week/);
    assert.match(out, /increasing/);
    assert.match(out, /In progress now/);
    assert.match(out, /LIN-10/);
    assert.match(out, /Top of the execution queue/);
    assert.match(out, /LIN-11/);
    assert.match(out, /Core — 4\/10 done/);
  });

  test('handles an empty queue without throwing', () => {
    const out = formatNextRunContext({ velocity: {}, executionQueue: [], milestones: [] });
    assert.match(out, /nothing is currently started/);
  });

  test('tolerates a null/garbage model', () => {
    assert.equal(typeof formatNextRunContext(null), 'string');
    assert.equal(typeof formatNextRunContext(undefined), 'string');
  });
});

describe('buildNextRunMessages', () => {
  test('returns a system + user pair grounded in the model', () => {
    const msgs = buildNextRunMessages(MODEL, 'Acme');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
    assert.match(msgs[1].content, /LIN-10/);
  });
});

describe('normalizeSize', () => {
  test('passes valid sizes through (case-insensitive)', () => {
    for (const s of TSHIRT_SIZES) assert.equal(normalizeSize(s.toLowerCase()), s);
  });
  test('defaults invalid/missing to M', () => {
    assert.equal(normalizeSize('huge'), 'M');
    assert.equal(normalizeSize(null), 'M');
    assert.equal(normalizeSize(undefined), 'M');
  });
});

describe('parseGoalSuggestions', () => {
  test('parses clean JSON and coerces size', () => {
    const raw = JSON.stringify({ options: [{ goal: 'Do the thing.', reasoning: 'Because.', size: 'l' }] });
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].goal, 'Do the thing.');
    assert.equal(out[0].reasoning, 'Because.');
    assert.equal(out[0].size, 'L');
  });

  test('tolerates code fences and prose around the JSON', () => {
    const raw = 'Here you go:\n```json\n{"options":[{"goal":"G","reasoning":"R","size":"S"}]}\n```\nthanks';
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].size, 'S');
  });

  test('drops options with an empty goal', () => {
    const raw = JSON.stringify({ options: [{ goal: '', reasoning: 'x', size: 'M' }, { goal: 'real', size: 'M' }] });
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].goal, 'real');
  });

  test('caps at the generated maximum', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ goal: `g${i}`, size: 'M' }));
    const out = parseGoalSuggestions(JSON.stringify({ options: many }));
    assert.ok(out.length <= 5);
  });

  test('returns [] for garbage', () => {
    assert.deepEqual(parseGoalSuggestions('not json at all'), []);
    assert.deepEqual(parseGoalSuggestions(''), []);
    assert.deepEqual(parseGoalSuggestions(null), []);
  });
});

describe('CONTINUE_UNTIL_STOPPED_OPTION', () => {
  test('is the deterministic empty-goal mapping the generator always appends', () => {
    // The generator appends a copy of this option as the guaranteed last entry, so
    // "continue until stopped" is always offered and reliably maps to an empty goal
    // (the open-ended stack walk) regardless of LLM output. Full append behaviour is
    // exercised end-to-end via the mocked suggest endpoint in the e2e spec.
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.goal, '');
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.continueUntilStopped, true);
    assert.equal(typeof generateGoalSuggestions, 'function');
  });
});
