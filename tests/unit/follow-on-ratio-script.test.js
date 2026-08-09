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
import { getJson } from '../../scripts/follow-on-ratio.mjs';

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
