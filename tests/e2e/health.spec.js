import { test, expect } from '../fixtures/test-base.js';

// LIN-1691: deploy healthcheck. This runs against the real `node server.js`
// Playwright boots (playwright.config.js), so it proves /health survives the
// true production middleware registration order (in particular, that it is
// reachable above the HTTPS-redirect middleware), not just handler logic.

test('GET /health returns 200', async ({ page }) => {
  const response = await page.request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
