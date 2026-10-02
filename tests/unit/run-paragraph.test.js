/**
 * Unit tests for lib/run-paragraph.js (LIN-3253, LIN-2948 S3).
 *
 * Run with: node --test tests/unit/run-paragraph.test.js
 *
 * Fully offline: the single model call is stubbed via the `chat` seam, so these
 * tests assert the prompt is grounded in the run view (the sparse case proves no
 * invented facts), that exactly one call is made, and that the `inputHash` gate
 * is stable for identical input and moves only when a finished step changes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  generateRunParagraph,
  buildRunParagraphMessages,
  formatRunViewContext,
  cleanRunParagraph,
  inputHash
} from '../../lib/run-paragraph.js';

function step(overrides = {}) {
  const s = {
    lineageId: 'l',
    kind: 'plan',
    status: 'done',
    terminalStatus: 'done',
    finished: true,
    iteration: 1,
    model: 'small-model',
    tier: 'small',
    summary: 'plan · done',
    loops: [],
    loopCosts: [],
    cost: {},
    ...overrides
  };
  // The gate reads a step's loops, so carry the real `buildRunView` shape: a
  // step's `loops` hold every loop of its lineage, ended or not.
  if (!s.loops || s.loops.length === 0) {
    s.loops = [{
      loopId: `${s.lineageId}-l0`,
      lineageId: s.lineageId,
      kind: s.kind,
      terminalStatus: s.terminalStatus,
      iteration: s.iteration,
      telemetry: {},
      feedback: []
    }];
  }
  return s;
}

function runningView() {
  return {
    runId: 'run-running',
    title: 'Add a dark-mode toggle',
    progress: { mode: 'stages', reached: 2, total: 4, label: '2 of 4 stages' },
    next: 'review',
    cost: { status: 'not-reported', usd: null, label: 'not reported' },
    time: { activeMs: 120000, wall: { start: '2026-10-02T10:00:00.000Z', end: null, ms: 300000 } },
    waiting: { active: false, since: null, ms: null, loopId: null },
    steps: [
      step({ lineageId: 'l1', kind: 'plan', finished: true, status: 'done' }),
      step({ lineageId: 'l2', kind: 'implementation', finished: false, status: 'running', terminalStatus: null })
    ]
  };
}

function finishedView() {
  return {
    runId: 'run-finished',
    title: 'Fix the session timeout',
    progress: { mode: 'stages', reached: 4, total: 4, label: '4 of 4 stages' },
    next: null,
    cost: { status: 'not-reported', usd: null, label: 'not reported' },
    time: { activeMs: 900000, wall: { start: '2026-10-02T10:00:00.000Z', end: '2026-10-02T10:30:00.000Z', ms: 1800000 } },
    waiting: { active: false, since: null, ms: null, loopId: null },
    outcome: 'The session timeout fix shipped.',
    evidence: ['All tests pass.', 'Opened a pull request.'],
    steps: [
      step({ lineageId: 'l1', kind: 'plan' }),
      step({ lineageId: 'l2', kind: 'implementation' }),
      step({ lineageId: 'l3', kind: 'review' }),
      step({ lineageId: 'l4', kind: 'close-out' })
    ]
  };
}

function sparseView() {
  return {
    runId: 'run-sparse',
    title: null,
    progress: { mode: 'steps', reached: null, total: null, label: '0 steps so far' },
    next: null,
    cost: { status: 'not-reported', usd: null, label: 'not reported' },
    time: { activeMs: 0, wall: { start: null, end: null, ms: null } },
    waiting: { active: false, since: null, ms: null, loopId: null },
    steps: []
  };
}

/** A stub `chat` that records calls and emits the given text as tokens. */
function makeStubChat(responseText) {
  const calls = [];
  return {
    calls,
    async chat(messages, options, onEvent) {
      calls.push({ messages, options });
      if (responseText) onEvent('token', { token: responseText });
      onEvent('done', {});
    }
  };
}

describe('formatRunViewContext', () => {
  test('a running view carries its steps, progress and next', () => {
    const ctx = formatRunViewContext(runningView());
    assert.match(ctx, /Run: run-running/);
    assert.match(ctx, /Task: Add a dark-mode toggle/);
    assert.match(ctx, /Progress: 2 of 4 stages/);
    assert.match(ctx, /Next: review/);
    assert.match(ctx, /- plan · done · tier small/);
    assert.match(ctx, /- implementation · running/);
  });

  test('a finished view carries its outcome and evidence', () => {
    const ctx = formatRunViewContext(finishedView());
    assert.match(ctx, /Progress: 4 of 4 stages/);
    assert.match(ctx, /The session timeout fix shipped\./);
    assert.match(ctx, /All tests pass\./);
    assert.match(ctx, /Opened a pull request\./);
  });

  test('a sparse view carries only the facts present — nothing invented', () => {
    const ctx = formatRunViewContext(sparseView());
    assert.match(ctx, /Run: run-sparse/);
    assert.match(ctx, /Progress: 0 steps so far/);
    assert.match(ctx, /No steps recorded yet\./);
    assert.doesNotMatch(ctx, /Task:/, 'no title means no Task line');
    assert.doesNotMatch(ctx, /pull request|PR\b/i, 'no PR fact is invented');
    assert.doesNotMatch(ctx, /Outcome:|Evidence:/, 'absent sections are omitted');
  });

  test('handles a null run view without throwing', () => {
    assert.equal(typeof formatRunViewContext(null), 'string');
    assert.match(formatRunViewContext(null), /No steps recorded yet\./);
  });
});

describe('buildRunParagraphMessages', () => {
  test('produces a grounding system prompt plus a user message', () => {
    const msgs = buildRunParagraphMessages(runningView());
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.match(msgs[0].content, /never invent|Never invent/i);
    assert.equal(msgs[1].role, 'user');
    assert.match(msgs[1].content, /run-running/);
  });
});

describe('cleanRunParagraph', () => {
  test('strips code fences and collapses whitespace', () => {
    assert.equal(cleanRunParagraph('```\nThe run  is\n going well.\n```'), 'The run is going well.');
  });

  test('returns empty for null/garbage', () => {
    assert.equal(cleanRunParagraph(null), '');
    assert.equal(cleanRunParagraph(42), '');
  });
});

describe('generateRunParagraph', () => {
  test('makes exactly one cheap-tier call and returns the cleaned paragraph', async () => {
    const stub = makeStubChat('The plan is done and implementation is under way. Review is next.');
    const { paragraph, model } = await generateRunParagraph(runningView(), { chat: stub.chat });

    assert.equal(stub.calls.length, 1, 'exactly one model call');
    assert.match(paragraph, /^The plan is done/);
    assert.ok(model, 'the realised model is returned for storage');
    // The cheap-tier call path carries a model option and no upstream read.
    assert.ok(stub.calls[0].options.model, 'a model option is passed to the model call');
    assert.match(stub.calls[0].messages[1].content, /implementation · running/);
  });

  test('a sparse run view yields a paragraph that says less, never a guess', async () => {
    const stub = makeStubChat('This run has not recorded any steps yet.');
    const { paragraph } = await generateRunParagraph(sparseView(), { chat: stub.chat });
    assert.equal(stub.calls.length, 1);
    assert.equal(paragraph, 'This run has not recorded any steps yet.');
    const userMsg = stub.calls[0].messages[1].content;
    assert.doesNotMatch(userMsg, /Task:|Outcome:|Evidence:|pull request|PR\b/i);
  });

  test('an empty model response yields an empty paragraph, not a fabricated one', async () => {
    const stub = makeStubChat('');
    const { paragraph } = await generateRunParagraph(runningView(), { chat: stub.chat });
    assert.equal(paragraph, '');
  });
});

describe('inputHash', () => {
  test('is stable for identical input', () => {
    assert.equal(inputHash(runningView()), inputHash(runningView()));
  });

  test('ignores volatile time fields (same facts → same hash)', () => {
    const a = runningView();
    const b = runningView();
    b.time = { activeMs: 999999, wall: { start: '2020-01-01T00:00:00.000Z', end: null, ms: 42 } };
    assert.equal(inputHash(a), inputHash(b));
  });

  test('changes when a finished step is added', () => {
    const before = runningView();
    const after = runningView();
    after.steps = [
      ...after.steps,
      step({ lineageId: 'l3', kind: 'review', finished: true, status: 'done' })
    ];
    assert.notEqual(inputHash(before), inputHash(after));
  });

  test('a running view and a finished view differ', () => {
    assert.notEqual(inputHash(runningView()), inputHash(finishedView()));
  });

  test('handles null without throwing', () => {
    assert.equal(typeof inputHash(null), 'string');
  });
});
