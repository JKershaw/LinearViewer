/**
 * Regression tests for scripts/plan-review-round-trips.mjs's `getJson`
 * (LIN-1984). Mirrors tests/unit/follow-on-ratio-script.test.js on `main` —
 * this script carries a byte-identical `getJson` copy, and the LIN-1984
 * research flagged this branch's copy as the high-confidence actual offender
 * during the incident (1,193/1,200 reads silently skipped on auth failure).
 *
 * `tries: 1` bounds the retryable cases to a single ~2s backoff sleep rather
 * than the default 4-attempt widening backoff.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getJson } from '../../scripts/plan-review-round-trips.mjs';

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

  test('a successful 200 returns the parsed body regardless of tolerate', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
    const result = await getJson('https://proxy.example/issues/x', 'tok', { tolerate: true });
    assert.deepEqual(result, { hello: 'world' });
  });
});
