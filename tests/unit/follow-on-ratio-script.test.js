/**
 * Regression tests for scripts/follow-on-ratio.mjs's `getJson` (LIN-1984).
 *
 * `getJson` is the shared fetch/retry chokepoint. Before this fix, a
 * `tolerate: true` caller swallowed ANY non-2xx response as a skip, including
 * a total, non-retryable auth failure (401/403) — which converted a loud
 * outage into a silently-corrupt "success" artifact (see the incident
 * write-up cited on LIN-1984). These tests pin the fixed contract at the one
 * seam every scoped script shares: a non-retryable status THROWS regardless
 * of `tolerate`, while the transient (429/5xx/network) path is byte-identical
 * to before.
 *
 * `tries: 1` bounds the retryable cases to a single ~2s backoff sleep rather
 * than the default 4-attempt widening backoff — real timers, no fake-timer
 * choreography needed for a two-case file this small.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, render } from '../../scripts/follow-on-ratio.mjs';
import { computeFollowOnRatio } from '../../lib/follow-on-ratio.js';

describe('getJson — non-retryable vs retryable (LIN-1984)', () => {
  let realFetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  beforeEach(() => { realFetch = globalThis.fetch; });

  test('a 401 with tolerate:true still THROWS — the regression this ticket fixes', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 401, text: async () => '{"error":"unauthorized"}',
    });
    await assert.rejects(
      () => getJson('https://proxy.example/issues/x', 'tok', { tolerate: true }),
      /proxy 401/,
    );
  });

  test('a 403 with tolerate:true still THROWS', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 403, text: async () => '{"error":"forbidden"}',
    });
    await assert.rejects(
      () => getJson('https://proxy.example/issues/x', 'tok', { tolerate: true }),
      /proxy 403/,
    );
  });

  test('without tolerate, a 401 still throws (unchanged baseline)', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 401, text: async () => '{"error":"unauthorized"}',
    });
    await assert.rejects(() => getJson('https://proxy.example/issues/x', 'tok'), /proxy 401/);
  });

  test('a 429 exhausted with tolerate:true still returns null — transient path untouched', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    const result = await getJson('https://proxy.example/issues/x', 'tok', { tolerate: true, tries: 1 });
    assert.equal(result, null);
  });

  test('a thrown network error exhausted with tolerate:true still returns null', async () => {
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    const result = await getJson('https://proxy.example/issues/x', 'tok', { tolerate: true, tries: 1 });
    assert.equal(result, null);
  });

  test('a 500 exhausted with tolerate:true still returns null', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 502 });
    const result = await getJson('https://proxy.example/issues/x', 'tok', { tolerate: true, tries: 1 });
    assert.equal(result, null);
  });

  test('a successful 200 returns the parsed body regardless of tolerate', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
    const result = await getJson('https://proxy.example/issues/x', 'tok', { tolerate: true });
    assert.deepEqual(result, { hello: 'world' });
  });
});

describe('render — the review-ledger line says what it is (LIN-4519)', () => {
  const DONE = '2026-06-10T00:00:00.000Z';
  const issue = (id, extra = {}) => ({
    id, identifier: `LIN-${id}`, title: id, description: '', state: { name: 'Done', type: 'completed' }, trashed: null,
    createdAt: '2026-05-01T00:00:00.000Z', completedAt: DONE, parent: null, children: [], relations: [], inverseRelations: [],
    comments: [{ id: `c-${id}`, body: '## Review — LIN-1\n- finding', createdAt: DONE }], ...extra,
  });

  test('the ledger line reads "not measured" with its reason, never a percentage', () => {
    const result = computeFollowOnRatio([issue('a'), issue('b')], {
      windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-07-01T00:00:00.000Z', asOf: '2026-07-01T12:00:00.000Z',
    });
    const text = render(result, { listCalls: 1, detailCalls: 2 });
    const line = text.split('\n').find((l) => l.includes('with a review ledger'));
    assert.ok(line, 'the line is still printed');
    assert.match(line, /with a review ledger\s+not measured/);
    assert.doesNotMatch(line, /\d\.\d%/, 'no percentage is printed for a retired diagnostic');
  });
});
