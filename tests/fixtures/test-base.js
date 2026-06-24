/**
 * Shared Playwright test fixture that intercepts polling routes.
 *
 * Problem: app.js polls /api/dispatch/count every 1s on all authenticated pages.
 * Playwright's networkidle waits for 500ms of zero network activity. A 1s poll
 * with variable server latency means networkidle can't reliably settle — creating
 * race conditions that add 0–1500ms delays or cause 40-second timeouts.
 *
 * Fix: intercept the badge count endpoint with an instant mock response. The
 * setInterval still fires and fetch still runs, but route.fulfill() completes
 * in <1ms, leaving ~999ms of silence between polls (well above the 500ms
 * networkidle threshold).
 *
 * Usage: replace `import { test, expect } from '@playwright/test'` with
 *        `import { test, expect } from '../fixtures/test-base.js'`
 */
import { test as base, expect } from '@playwright/test';
import { TEST_WORKSPACE_URL_KEY } from '../helpers.js';
import { LOCAL_WORKSPACE_URL_KEY, seedLocalWorkspace } from './local-harness.js';

export { expect };

export const test = base.extend({
  // ── Per-worker urlKey seam (LIN-625 S1) ──────────────────────────────────
  // The SINGLE producer of each per-worker key `${base}-w${parallelIndex}`,
  // computed once per worker (worker scope). At `workers:1` parallelIndex is 0
  // for every spec; once S3 flips `workers > 1`, each parallel worker gets a
  // partition-distinct key. These fixtures are additive: specs that don't opt
  // in keep the bare `test-workspace` / `local-workspace` defaults, so the
  // suite stays byte-identical and green at `workers:1`. The S2 sweep wires the
  // existing session helpers to these keys (set-session via `createSession`'s
  // `urlKey` override; local via `seedLocal` / `seedLocalWorkspace`'s `urlKey`).
  workerUrlKey: [async ({}, use, workerInfo) => {
    await use(`${TEST_WORKSPACE_URL_KEY}-w${workerInfo.parallelIndex}`);
  }, { scope: 'worker' }],

  localWorkerUrlKey: [async ({}, use, workerInfo) => {
    await use(`${LOCAL_WORKSPACE_URL_KEY}-w${workerInfo.parallelIndex}`);
  }, { scope: 'worker' }],

  // The local seed helper bound to this worker's local key — the "seed helper"
  // companion to the key. Same `(seed?, options?)` shape as seedLocalWorkspace,
  // with `urlKey` pre-filled (a caller-supplied `options.urlKey` still wins).
  seedLocal: async ({ page, localWorkerUrlKey }, use) => {
    await use((seed = null, options = {}) =>
      seedLocalWorkspace(page, seed, { urlKey: localWorkerUrlKey, ...options }));
  },

  page: async ({ page }, use) => {
    // Intercept queue badge polling (app.js — every 1s on all authenticated pages).
    // This is the primary cause of networkidle flakiness. The 3s dispatch list
    // poll is left unintercepted because dispatch-page tests need real data.
    await page.route('**/api/dispatch/count', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
    );

    await use(page);
  },
});
