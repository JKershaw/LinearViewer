/**
 * Unit tests for lib/routing-ruling.js (LIN-4028).
 *
 * Run with: node --test tests/unit/routing-ruling.test.js
 *
 * A recorded routing ruling is a dispatch-loop DECISION whose chosen option carries `routing`, answered
 * by a `decision-answer` stamp that names the option. These pin which ruling pins a task's execution
 * fields, and that nothing else does: a comment, a free-text answer, a dismissed one, or a decision with
 * no routing on any option.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { routingRulingFrom, loadRoutingRuling } from '../../lib/routing-ruling.js';

const decisionEntry = (id, options, extra = {}, timestamp = '2026-10-29T10:00:00.000Z') => ({
  kind: 'decision',
  message: `[decision] ${JSON.stringify({ decision_id: id, question: 'Who writes it?', options, ...extra })}`,
  timestamp
});

const answerEntry = (decisionId, optionId, timestamp = '2026-10-29T11:00:00.000Z', extra = {}) => ({
  kind: 'decision-answer',
  message: JSON.stringify({ decision_id: decisionId, ...(optionId === undefined ? {} : { option_id: optionId }), ...extra }),
  timestamp
});

const ROUTED = [
  { id: 'opus-custom', label: 'Dispatch as kind custom (opus/high)', routing: { model: 'opus', effort: 'high' } },
  { id: 'keep', label: 'Keep the default' }
];

const onIssue = (feedback, issueIdentifier = 'LIN-4023') => routingRulingFrom([{ issueIdentifier, feedback }], issueIdentifier);

describe('routingRulingFrom — which ruling pins a task (LIN-4028)', () => {
  test('an answered routing decision pins the chosen option\'s routing', () => {
    const pin = onIssue([
      decisionEntry('lin4023-writer-model', ROUTED, { on_answer: { record_on: 'LIN-4023' } }),
      answerEntry('lin4023-writer-model', 'opus-custom')
    ]);
    assert.deepEqual(pin, { decisionId: 'lin4023-writer-model', optionId: 'opus-custom', routing: { model: 'opus', effort: 'high' } });
  });

  test('a decision whose chosen option has no routing clears the pin set by an older one', () => {
    const older = decisionEntry('d-old', ROUTED, {}, '2026-10-29T10:00:00.000Z');
    const newer = decisionEntry('d-new', ROUTED, {}, '2026-10-29T12:00:00.000Z');
    const pin = onIssue([
      older, answerEntry('d-old', 'opus-custom', '2026-10-29T10:30:00.000Z'),
      newer, answerEntry('d-new', 'keep', '2026-10-29T12:30:00.000Z')
    ]);
    assert.equal(pin, null);
  });

  test('a newer routing ruling replaces an older one, by answer time', () => {
    const options = [
      { id: 'haiku', label: 'Haiku', routing: { model: 'haiku' } },
      { id: 'opus', label: 'Opus', routing: { model: 'opus', effort: 'max' } }
    ];
    const pin = onIssue([
      decisionEntry('d-1', options, {}, '2026-10-29T10:00:00.000Z'),
      answerEntry('d-1', 'haiku', '2026-10-29T10:10:00.000Z'),
      decisionEntry('d-2', options, {}, '2026-10-29T10:20:00.000Z'),
      answerEntry('d-2', 'opus', '2026-10-29T10:30:00.000Z')
    ]);
    assert.equal(pin.decisionId, 'd-2');
    assert.deepEqual(pin.routing, { model: 'opus', effort: 'max' });
  });

  test('a newer decision with no routing on any option leaves the pin in place', () => {
    const pin = onIssue([
      decisionEntry('d-route', ROUTED, {}, '2026-10-29T10:00:00.000Z'),
      answerEntry('d-route', 'opus-custom', '2026-10-29T10:10:00.000Z'),
      decisionEntry('d-plain', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], {}, '2026-10-29T11:00:00.000Z'),
      answerEntry('d-plain', 'yes', '2026-10-29T11:10:00.000Z')
    ]);
    assert.equal(pin.decisionId, 'd-route');
  });

  test('a free-text answer (no option_id) does not pin, and leaves an older pin standing', () => {
    const pin = onIssue([
      decisionEntry('d-route', ROUTED, {}, '2026-10-29T10:00:00.000Z'),
      answerEntry('d-route', 'opus-custom', '2026-10-29T10:10:00.000Z'),
      decisionEntry('d-text', ROUTED, {}, '2026-10-29T11:00:00.000Z'),
      answerEntry('d-text', undefined, '2026-10-29T11:10:00.000Z')
    ]);
    assert.equal(pin.decisionId, 'd-route');
    assert.equal(onIssue([decisionEntry('d-text', ROUTED), answerEntry('d-text', undefined)]), null);
  });

  test('an option id the decision does not offer gives no pin', () => {
    assert.equal(onIssue([decisionEntry('d-1', ROUTED), answerEntry('d-1', 'made-up')]), null);
  });

  test('an unanswered routing decision gives no pin', () => {
    assert.equal(onIssue([decisionEntry('d-1', ROUTED)]), null);
  });

  test('a dismissed routing decision gives no pin', () => {
    assert.equal(onIssue([
      decisionEntry('d-1', ROUTED),
      answerEntry('d-1', 'opus-custom', '2026-10-29T11:00:00.000Z', { outcome: 'dismissed' })
    ]), null);
  });

  test('a decision that targets another issue (record_on) is not this task\'s ruling', () => {
    assert.equal(onIssue([
      decisionEntry('d-1', ROUTED, { on_answer: { record_on: 'LIN-9999' } }),
      answerEntry('d-1', 'opus-custom')
    ]), null);
  });

  test('a decision with no routing anywhere is not a routing decision: routes exactly as today', () => {
    const plain = [{ id: 'yes', label: 'Ship it' }, { id: 'no', label: 'Hold', cost: 2 }];
    assert.equal(onIssue([decisionEntry('d-1', plain), answerEntry('d-1', 'yes')]), null);
  });

  test('a comment that names a model is never a ruling: only a structured DECISION pins', () => {
    const pin = onIssue([
      { kind: 'comment', message: 'Use opus for the rest. — Ruling recorded via Harbour', timestamp: '2026-10-29T12:00:00.000Z' }
    ]);
    assert.equal(pin, null);
  });

  test('joined copies of one ruling across rows collapse to one pin', () => {
    const rows = [
      { issueIdentifier: 'LIN-4023', feedback: [decisionEntry('d-1', ROUTED), answerEntry('d-1', 'opus-custom')] },
      { issueIdentifier: 'LIN-4023', feedback: [decisionEntry('d-1', ROUTED), answerEntry('d-1', 'opus-custom')] }
    ];
    assert.deepEqual(routingRulingFrom(rows, 'LIN-4023').decisionId, 'd-1');
  });

  test('no rows, or rows with no feedback, give no pin', () => {
    assert.equal(routingRulingFrom([], 'LIN-4023'), null);
    assert.equal(routingRulingFrom([{ issueIdentifier: 'LIN-4023' }], 'LIN-4023'), null);
  });

  test('a malformed stamp or decision is skipped without throwing', () => {
    const feedback = [
      { kind: 'decision-answer', message: 'not json', timestamp: '2026-10-29T11:00:00.000Z' },
      { kind: 'decision', message: '[decision] {"decision_id":"d-bad", not-json', timestamp: '2026-10-29T10:00:00.000Z' },
      decisionEntry('d-1', ROUTED),
      answerEntry('d-1', 'opus-custom')
    ];
    assert.equal(onIssue(feedback).decisionId, 'd-1');
  });
});

describe('loadRoutingRuling — the store read never throws (LIN-4028)', () => {
  const routedStore = (live, history) => ({
    listItems: async () => live,
    listHistory: async () => ({ items: history, total: history.length })
  });

  test('reads the task\'s live and finished rows and returns the pin they carry', async () => {
    const store = routedStore(
      [],
      [{ issueIdentifier: 'LIN-4023', feedback: [decisionEntry('d-1', ROUTED), answerEntry('d-1', 'opus-custom')] }]
    );
    const pin = await loadRoutingRuling(store, 'acme', 'LIN-4023');
    assert.equal(pin.decisionId, 'd-1');
  });

  test('asks for the identity key and a narrow projection, never the prompt', async () => {
    const calls = [];
    const store = {
      listItems: async (urlKey, opts) => { calls.push(['items', urlKey, opts]); return []; },
      listHistory: async (urlKey, opts) => { calls.push(['history', urlKey, opts]); return { items: [] }; }
    };
    await loadRoutingRuling(store, 'acme', 'LIN-4023');
    assert.equal(calls.length, 2);
    for (const [, urlKey, opts] of calls) {
      assert.equal(urlKey, 'acme');
      assert.equal(opts.issueIdentifier, 'LIN-4023');
      assert.equal(opts.limit, undefined, 'a ruling can be older than any limit, so the history read is not capped');
      assert.ok(opts.projection && opts.projection.prompt === undefined && opts.projection.feedback === 1);
    }
  });

  test('a missing store, urlKey or issue is no pin', async () => {
    assert.equal(await loadRoutingRuling(null, 'acme', 'LIN-4023'), null);
    assert.equal(await loadRoutingRuling(routedStore([], []), '', 'LIN-4023'), null);
    assert.equal(await loadRoutingRuling(routedStore([], []), 'acme', ''), null);
  });

  test('a failed read is no pin, never a throw', async () => {
    const store = {
      listItems: async () => { throw new Error('store down'); },
      listHistory: async () => ({ items: [] })
    };
    assert.equal(await loadRoutingRuling(store, 'acme', 'LIN-4023'), null);
  });
});
