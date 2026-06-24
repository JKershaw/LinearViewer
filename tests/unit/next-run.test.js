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
import { test, describe, mock, afterEach } from 'node:test';
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
import { buildRoadmapModel } from '../../lib/roadmap.js';

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

describe('TSHIRT_SIZES (LIN-633)', () => {
  test('is the S/M/L/XL scale — XS dropped, XL reserved for the open-ended option', () => {
    assert.deepEqual(TSHIRT_SIZES, ['S', 'M', 'L', 'XL']);
    assert.ok(!TSHIRT_SIZES.includes('XS'));
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
  test('the now-dropped XS coerces to the M default', () => {
    assert.equal(normalizeSize('XS'), 'M');
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

  test('owns the XL size — the open-ended option is the deterministic XL (LIN-633)', () => {
    // XL = "run the project with no specific guide", which IS this option. Concrete
    // LLM goals are constrained to S/M/L, so XL must live here and nowhere else.
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.size, 'XL');
  });
});

describe('generateGoalSuggestions return shape (LIN-633)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function mockStreamResponse(text) {
    const enc = new TextEncoder();
    const blocks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 10 } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  test('returns the grounding context verbatim plus the XL open-ended option', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'Finish the in-flight work.', reasoning: 'WIP first.', size: 'M' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );

    // context is returned and is the exact deterministic grounding blob (not discarded).
    assert.equal(typeof result.context, 'string');
    assert.ok(result.context.length > 0);
    assert.equal(result.context, formatNextRunContext(buildRoadmapModel([], []), 'Acme'));

    // The concrete option survives; the guaranteed open-ended option is appended last as XL.
    const last = result.options[result.options.length - 1];
    assert.equal(last.continueUntilStopped, true);
    assert.equal(last.goal, '');
    assert.equal(last.size, 'XL');
    assert.ok(result.options.some(o => o.goal === 'Finish the in-flight work.' && o.size === 'M'));
  });
});
