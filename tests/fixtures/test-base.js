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

export { expect };

export const test = base.extend({
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
