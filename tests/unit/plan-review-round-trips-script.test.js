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

describe('fetchAll — H12 scope guard: every /dispatch list URL carries a non-empty issueIdentifier (LIN-2043 N1)', () => {
  let realFetch;
  let cacheDir;
  afterEach(() => { globalThis.fetch = realFetch; rmSync(cacheDir, { recursive: true, force: true }); });
  beforeEach(() => {
    realFetch = globalThis.fetch;
    // A real cache path is required even under noCache: true —
    // fetchIssuePlanReviewShape:196 computes join(cache, …) unconditionally,
    // before the noCache check runs, so cache: undefined throws a TypeError
    // from path.join and would pass this test for the wrong reason.
    cacheDir = mkdtempSync(join(tmpdir(), 'plan-review-round-trips-cache-test-'));
  });

  test('a valid row: every /dispatch LIST url carries a non-empty issueIdentifier, and detail urls are not mistaken for list urls', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === '/issues/issue-1') {
        return { ok: true, status: 200, json: async () => ({ id: 'issue-1', identifier: 'LIN-1', description: '', comments: [] }) };
      }
      if (u.pathname === '/dispatch') {
        return {
          ok: true, status: 200,
          json: async () => ({ items: [{ id: 'row-1', kind: 'plan-review', status: 'taken', dispatchedAt: '2026-08-01T00:00:00Z', completedAt: null }] }),
        };
      }
      if (u.pathname === '/dispatch/row-1') {
        return { ok: true, status: 200, json: async () => ({ feedback: ['DONE: ok'] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const row = { id: 'issue-1', identifier: 'LIN-1', state: { type: 'started' } };
    const { issues, skipped } = await fetchAll(
      [row],
      { base: 'https://proxy.example', token: 'tok', cache: cacheDir, noCache: true },
    );

    assert.equal(issues.length, 1);
    assert.deepEqual(skipped, []);

    // Only /dispatch LIST urls (no further path segment) carry issueIdentifier
    // as a query param — /dispatch/{rowId} detail urls carry no query params
    // at all and must not be swept into this assertion (LIN-2043 review NB-3).
    const listUrls = calls.map((c) => new URL(c)).filter((u) => u.pathname === '/dispatch');
    assert.ok(listUrls.length > 0, 'expected at least one /dispatch list call');
    for (const u of listUrls) {
      assert.ok(u.searchParams.get('issueIdentifier'), `list url missing non-empty issueIdentifier: ${u}`);
    }

    const detailUrls = calls.map((c) => new URL(c)).filter((u) => u.pathname === '/dispatch/row-1');
    assert.equal(detailUrls.length, 1);
    assert.equal(detailUrls[0].searchParams.get('issueIdentifier'), null);
  });

  test('a falsy identifier (list row AND fetched detail both empty) rejects before any /dispatch read', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === '/issues/issue-2') {
        return { ok: true, status: 200, json: async () => ({ id: 'issue-2', identifier: '', description: '', comments: [] }) };
      }
      throw new Error(`fetchAll should not reach /dispatch for an unscoped row: ${url}`);
    };

    const row = { id: 'issue-2', identifier: '', state: { type: 'started' } };
    await assert.rejects(
      () => fetchAll(
        [row],
        { base: 'https://proxy.example', token: 'tok', cache: cacheDir, noCache: true },
      ),
      /issueIdentifier/,
    );

    const dispatchCalls = calls.map((c) => new URL(c)).filter((u) => u.pathname.startsWith('/dispatch'));
    assert.deepEqual(dispatchCalls, []);
  });
});
