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

// Upper bound on the teardown wait for a page's unanswered writes (LIN-3798).
const PENDING_WRITE_DRAIN_MS = 5000;

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

  // The per-worker discriminator (`-w<parallelIndex>`) shared by every key in a
  // worker's session. `/test/set-session` derives the multiWorkspace /
  // maxWorkspaces sibling keys from this same suffix (LIN-628), so set-session
  // specs that drive secondary workspaces build them as `second-workspace` +
  // suffix / `workspace-N` + suffix off this value rather than fixed literals.
  workerSuffix: [async ({}, use, workerInfo) => {
    await use(`-w${workerInfo.parallelIndex}`);
  }, { scope: 'worker' }],

  // The second workspace's per-worker key for the `multiWorkspace` set-session
  // session — the companion to `workerUrlKey` for two-workspace specs.
  secondWorkerUrlKey: [async ({}, use, workerInfo) => {
    await use(`second-workspace-w${workerInfo.parallelIndex}`);
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

    // LIN-3798: a test that ends on `waitForRequest` (or on a click whose response
    // it never reads) left its POST still being handled when the next test's
    // beforeEach ran /test/clear-dispatch-queue, so the row landed in the freshly
    // cleared partition ('Dispatch API': 2 items for 1, 1 left after DELETE, target
    // cli for web). Before the page closes, wait for every write this page sent to
    // be answered, so a test's side effects finish inside that test. Reads are not
    // waited on (polls never settle); the cap bounds a write a spec holds open with
    // its own page.route gate.
    const pendingWrites = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' || request.method() === 'HEAD') return;
      pendingWrites.push(request.response().catch(() => null));
    });

    await use(page);

    let cap;
    await Promise.race([
      Promise.allSettled(pendingWrites),
      new Promise((resolve) => { cap = setTimeout(resolve, PENDING_WRITE_DRAIN_MS); }),
    ]);
    clearTimeout(cap);
  },
});
