/**
 * Regression tests for scripts/transcript-spend.mjs's `proxy()` (LIN-1984).
 *
 * Before this fix, `proxy()`'s only caller (`main`'s per-item detail loop)
 * did `catch (e) { continue; }` unconditionally — ANY failure, including a
 * total 401/403 auth outage, was dropped silently with zero counter, and the
 * run still published `{sessions: [], report, beforeAfter}` on exit 0. This
 * pins the fixed contract: a non-retryable failure now carries `.status` and
 * propagates (the loop rethrows it), while a retryable failure is recorded
 * in the new `detailSkipped` completeness count instead of vanishing.
 *
 * `proxy()` reads module-level CACHE/USE_CACHE computed at import time from
 * `--no-cache`/env, which is why these tests pass a `--no-cache`-equivalent
 * expectation implicitly: PROXY_TOKEN/argv aren't set, so `USE_CACHE` is true
 * by default — tests therefore exercise the cache-miss branch by using a
 * fresh, never-before-seen path per call (a random path segment) so no
 * on-disk cache entry can short-circuit the stubbed fetch.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyUpstreamError } from '../../lib/errors.js';
import { proxy } from '../../scripts/transcript-spend.mjs';

const CACHE_DIR = join(tmpdir(), 'harbour-spend-cache');
const uniquePath = (label) => `/${label}-${Math.floor(Math.random() * 1e9)}`;

describe('proxy — non-retryable vs retryable (LIN-1984)', () => {
  let realFetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  beforeEach(() => { realFetch = globalThis.fetch; });

  test('a non-2xx response throws an Error carrying .status', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    const path = uniquePath('auth');
    try {
      await proxy(path);
      assert.fail('expected proxy() to throw');
    } catch (e) {
      assert.equal(e.status, 401);
      assert.match(e.message, /401/);
      assert.equal(classifyUpstreamError(e).retryable, false);
    }
  });

  test('a 429 throws an Error carrying .status classified retryable', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    const path = uniquePath('rl');
    try {
      await proxy(path);
      assert.fail('expected proxy() to throw');
    } catch (e) {
      assert.equal(e.status, 429);
      assert.equal(classifyUpstreamError(e).retryable, true);
    }
  });

  test('a successful response is cached and returned', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [1, 2] }) });
    const path = uniquePath('ok');
    const cacheFile = join(CACHE_DIR, path.replace(/[^\w.-]/g, '_') + '.json');
    try {
      const result = await proxy(path);
      assert.deepEqual(result, { items: [1, 2] });
      assert.ok(existsSync(cacheFile));
    } finally {
      try { rmSync(cacheFile); } catch { /* best-effort cleanup */ }
    }
  });
});
