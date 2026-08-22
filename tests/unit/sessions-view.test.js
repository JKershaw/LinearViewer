/**
 * Unit tests for lib/sessions-view.js — the pure adapters that turn pipeline
 * Loop records into the Swipe "Dispatched Sessions" shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionCounts, toSessionView } from '../../lib/sessions-view.js';

describe('buildSessionCounts', () => {
  it('returns an empty object for empty / non-array input', () => {
    assert.deepEqual(buildSessionCounts([]), {});
    assert.deepEqual(buildSessionCounts(null), {});
    assert.deepEqual(buildSessionCounts(undefined), {});
  });

  it('counts loops per issueIdentifier', () => {
    const loops = [
      { issueIdentifier: 'LIN-1' },
      { issueIdentifier: 'LIN-1' },
      { issueIdentifier: 'LIN-2' }
    ];
    assert.deepEqual(buildSessionCounts(loops), { 'LIN-1': 2, 'LIN-2': 1 });
  });

  it('skips records without an identifier', () => {
    const loops = [
      { issueIdentifier: 'LIN-1' },
      { issueIdentifier: '' },
      { foo: 'bar' },
      null
    ];
    assert.deepEqual(buildSessionCounts(loops), { 'LIN-1': 1 });
  });
});

describe('toSessionView', () => {
  it('returns null for a null loop', () => {
    assert.equal(toSessionView(null), null);
  });

  it('projects the fields the accordion needs and drops promptText', () => {
    const loop = {
      loopId: 'd1',
      issueIdentifier: 'LIN-1',
      issueId: 'uuid-1',
      issueTitle: 'Title',
      issueUrl: 'https://linear.app/x',
      iteration: 2,
      promptName: 'implementation',
      promptText: 'a very long prompt body that should not be sent',
      stage: 'implementation',
      agentState: 'complete',
      dispatchedAt: '2026-01-01T00:00:00.000Z',
      resolvedAt: '2026-01-01T01:00:00.000Z',
      target: 'cli',
      repo: 'org/repo',
      source: 'history',
      historyStatus: 'taken',
      agentSummary: 'done',
      agentStatus: 'completed',
      feedback: []
    };
    const view = toSessionView(loop);
    assert.equal(view.promptText, undefined);
    assert.equal(view.issueId, undefined);
    assert.equal(view.agentStatus, undefined);
    assert.equal(view.loopId, 'd1');
    assert.equal(view.iteration, 2);
    assert.equal(view.promptName, 'implementation');
    assert.equal(view.stage, 'implementation');
    assert.equal(view.agentState, 'complete');
    assert.equal(view.target, 'cli');
    assert.equal(view.agentSummary, 'done');
    assert.deepEqual(view.feedback, []);
  });

  it('normalises feedback entries to message + timestamp', () => {
    const loop = {
      loopId: 'd2',
      feedback: [
        { message: 'looks good', timestamp: '2026-01-01T00:00:00.000Z', extra: 'drop me' },
        { timestamp: '2026-01-02T00:00:00.000Z' },
        { message: 'no time' },
        'garbage'
      ]
    };
    const view = toSessionView(loop);
    assert.deepEqual(view.feedback, [
      { message: 'looks good', timestamp: '2026-01-01T00:00:00.000Z' },
      { message: '', timestamp: '2026-01-02T00:00:00.000Z' },
      { message: 'no time', timestamp: null },
      { message: '', timestamp: null }
    ]);
  });

  it('defaults missing optional fields to null and feedback to []', () => {
    const view = toSessionView({ loopId: 'd3', iteration: 1 });
    assert.equal(view.promptName, null);
    assert.equal(view.stage, null);
    assert.equal(view.agentState, null);
    assert.equal(view.agentSummary, null);
    assert.deepEqual(view.feedback, []);
  });

  // LIN-2184 (H5, beat 5): the ticket's fifth named acceptance test. H3
  // derives decision/decisionCase onto the loop (LIN-2182) and feedback
  // entries now carry a real `kind` (S2's `[decision]` entries); toSessionView
  // is explicitly OUT OF SCOPE for this ticket and its dropping of both is
  // INTENTIONAL — this is a regression guard proving that exclusion
  // deliberately (byte-identical output with/without the fields present),
  // not merely the absence of a test that happens not to cover them.
  it('LIN-2184: decision/decisionCase and feedback kind are dropped — output is byte-identical with or without them', () => {
    const base = {
      loopId: 'd4',
      iteration: 3,
      promptName: 'implementation',
      stage: 'implementation',
      agentState: 'complete',
      dispatchedAt: '2026-08-01T00:00:00.000Z',
      resolvedAt: '2026-08-01T01:00:00.000Z',
      target: 'cli',
      source: 'history',
      historyStatus: 'taken',
      agentSummary: 'shipped it',
      feedback: [
        { kind: 'assistant-text', message: 'Considered the schema diff.', timestamp: '2026-08-01T00:30:00.000Z' },
        { kind: 'decision', message: '[decision] {"decision_id":"d-1","question":"Proceed?"}', timestamp: '2026-08-01T00:31:00.000Z' },
        { kind: 'status', message: '[done] resolved and shipped', timestamp: '2026-08-01T01:00:00.000Z' }
      ]
    };
    const withDecision = {
      ...base,
      decision: { decision_id: 'd-1', question: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }] },
      decisionCase: ['Considered the schema diff.']
    };

    const viewWith = toSessionView(withDecision);
    const viewWithout = toSessionView(base);
    assert.deepEqual(viewWith, viewWithout, 'presence of decision/decisionCase must not change the projected view at all');

    assert.ok(!('decision' in viewWith), 'decision is dropped from the top-level view');
    assert.ok(!('decisionCase' in viewWith), 'decisionCase is dropped from the top-level view');
    assert.deepEqual(viewWith.feedback, [
      { message: 'Considered the schema diff.', timestamp: '2026-08-01T00:30:00.000Z' },
      { message: '[decision] {"decision_id":"d-1","question":"Proceed?"}', timestamp: '2026-08-01T00:31:00.000Z' },
      { message: '[done] resolved and shipped', timestamp: '2026-08-01T01:00:00.000Z' }
    ], '`kind` is dropped from every feedback entry, including the decision entry itself');
  });
});
