/**
 * Unit tests for lib/recap.js (prompt shape + response parser).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildRecapMessages, parseRecapResponse } from '../../lib/recap.js';

const SAMPLE_ISSUE = {
  id: 'uuid-1',
  identifier: 'LIN-1',
  title: 'Sample task',
  description: 'Implement the thing.',
  state: { name: 'In Progress', type: 'started' },
  labels: ['preparing'],
  url: 'https://linear.app/w/issue/LIN-1'
};

const SAMPLE_CONTEXT = {
  issue: SAMPLE_ISSUE,
  project: { name: 'Product' },
  parent: null,
  siblings: [],
  children: [],
  comments: [
    { id: 'c1', body: 'Started research.', createdAt: '2026-04-18T10:00:00Z', user: { name: 'Alice' } }
  ],
  focusedChild: null
};

describe('buildRecapMessages', () => {
  test('returns system + user messages', () => {
    const msgs = buildRecapMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].role, 'system');
    assert.strictEqual(msgs[1].role, 'user');
  });

  test('system prompt instructs JSON-only response', () => {
    const msgs = buildRecapMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.match(msgs[0].content, /JSON/);
    assert.match(msgs[0].content, /"done"/);
    assert.match(msgs[0].content, /"pending"/);
    assert.match(msgs[0].content, /"deviations"/);
  });

  test('user content includes issue details', () => {
    const msgs = buildRecapMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.match(msgs[1].content, /LIN-1/);
    assert.match(msgs[1].content, /Sample task/);
  });
});

describe('parseRecapResponse', () => {
  test('parses a valid JSON response', () => {
    const raw = JSON.stringify({
      done: [{ item: 'Research done', evidence: 'Comment confirms' }],
      pending: [{ item: 'Implement it', predicted: 'Next session' }],
      deviations: []
    });
    const parsed = parseRecapResponse(raw);
    assert.strictEqual(parsed.done.length, 1);
    assert.strictEqual(parsed.done[0].item, 'Research done');
    assert.strictEqual(parsed.pending.length, 1);
    assert.deepStrictEqual(parsed.deviations, []);
  });

  test('strips markdown code fences', () => {
    const raw = '```json\n{"done":[{"item":"x","evidence":"y"}],"pending":[],"deviations":[]}\n```';
    const parsed = parseRecapResponse(raw);
    assert.strictEqual(parsed.done[0].item, 'x');
  });

  test('recovers JSON from leading/trailing prose', () => {
    const raw = 'Here is the recap:\n{"done":[{"item":"a","evidence":""}],"pending":[],"deviations":[]}\nDone.';
    const parsed = parseRecapResponse(raw);
    assert.strictEqual(parsed.done[0].item, 'a');
  });

  test('returns empty recap on malformed JSON', () => {
    const parsed = parseRecapResponse('not json at all');
    assert.deepStrictEqual(parsed, { done: [], pending: [], deviations: [] });
  });

  test('returns empty recap on null/undefined input', () => {
    assert.deepStrictEqual(parseRecapResponse(null), { done: [], pending: [], deviations: [] });
    assert.deepStrictEqual(parseRecapResponse(undefined), { done: [], pending: [], deviations: [] });
    assert.deepStrictEqual(parseRecapResponse(''), { done: [], pending: [], deviations: [] });
  });

  test('sanitizes non-object entries and missing fields', () => {
    const raw = JSON.stringify({
      done: [{ item: 'ok' }, null, 'bad', { evidence: 'no item' }],
      pending: [{ item: 'x', predicted: 'y' }],
      deviations: [{ item: 'z', type: 'blocker', evidence: 'w' }]
    });
    const parsed = parseRecapResponse(raw);
    assert.strictEqual(parsed.done.length, 1);
    assert.strictEqual(parsed.done[0].item, 'ok');
    assert.strictEqual(parsed.done[0].evidence, '');
    assert.strictEqual(parsed.deviations[0].type, 'blocker');
  });

  test('treats non-array sections as empty', () => {
    const raw = JSON.stringify({ done: 'not an array', pending: null, deviations: {} });
    const parsed = parseRecapResponse(raw);
    assert.deepStrictEqual(parsed, { done: [], pending: [], deviations: [] });
  });
});
