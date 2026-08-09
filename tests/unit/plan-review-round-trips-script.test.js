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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getJson, fetchAll } from '../../scripts/plan-review-round-trips.mjs';

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

describe('fetchAll — cache-hit path with a pre-existing cache entry (LIN-1984 review F1)', () => {
  let realFetch;
  let cacheDir;
  afterEach(() => { globalThis.fetch = realFetch; rmSync(cacheDir, { recursive: true, force: true }); });
  beforeEach(() => {
    realFetch = globalThis.fetch;
    cacheDir = mkdtempSync(join(tmpdir(), 'plan-review-round-trips-cache-test-'));
  });

  test('a cache file written before the `skipped` field existed does not crash fetchAll', async () => {
    globalThis.fetch = async () => { throw new Error('fetchAll should not hit the network on a cache hit'); };
    const row = { id: 'issue-1', identifier: 'LIN-1', state: { type: 'completed' } };
    // Pre-LIN-1984 cache shape: no `skipped` key at all.
    writeFileSync(join(cacheDir, 'issue-1.json'), JSON.stringify({
      id: 'issue-1', identifier: 'LIN-1', description: '', comments: [], rows: [],
    }));

    const { issues, skipped } = await fetchAll(
      [row],
      { base: 'https://proxy.example', token: 'tok', cache: cacheDir, noCache: false },
    );

    assert.equal(issues.length, 1);
    assert.deepEqual(skipped, []);
  });
});
