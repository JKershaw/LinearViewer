import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { nav, workspaceKpis } from '../helpers.js';

/**
 * LIN-3689 — the in-Harbour workspace KPIs page, GET /workspace/:urlKey/kpis.
 *
 * Two local workspaces in one session: A is this worker's key, B is `${A}-b`.
 * Every figure on A's page is A's; B's activity changes nothing there. The real
 * redirect-to-`/` and 404 gating live in server.js's workspaceFromUrl, which
 * unit tests cannot run, so they are witnessed here.
 */
let keyA;
let keyB;

async function clearBoth(page) {
  for (const key of [keyA, keyB]) {
    for (const clear of ['dispatch-queue', 'dispatch-history', 'agent-status', 'proxy-events']) {
      await page.request.get(`/test/clear-${clear}?urlKey=${key}`);
    }
  }
}

async function dispatch(page, key, promptName, count) {
  for (let i = 0; i < count; i++) {
    const res = await page.request.post(`/workspace/${key}/api/dispatch`, {
      data: { prompt: 'p', promptName, kind: promptName, issueIdentifier: `KPI-${promptName}-${i}`, issueTitle: 'KPI fixture', target: 'cli' }
    });
    expect(res.status()).toBe(201);
  }
}

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  keyA = localWorkerUrlKey;
  keyB = `${localWorkerUrlKey}-b`;
  await seedLocalWorkspace(page, null, { urlKey: keyA, features: { dispatch: true } });
  await seedLocalWorkspace(page, null, { urlKey: keyB, append: true, features: { dispatch: true } });
  await clearBoth(page);
});

test.describe('LIN-3689 — workspace KPIs page (e2e)', () => {
  test('an empty workspace shows the empty line and the stored block', async ({ page }) => {
    await page.goto(`/workspace/${keyA}/kpis`);
    await expect(workspaceKpis(page).empty()).toBeVisible();
    await expect(workspaceKpis(page).section('activity')).toHaveCount(0);
    await expect(workspaceKpis(page).section('stored')).toBeVisible();
  });

  test('every number is that workspace\'s: B\'s activity does not reach A\'s page', async ({ page }) => {
    await dispatch(page, keyA, 'implementation', 2);
    await dispatch(page, keyB, 'autopilot', 3);

    await page.goto(`/workspace/${keyA}/kpis`);
    await expect(workspaceKpis(page).value('dispatches', '30d')).toHaveText('2');
    await expect(workspaceKpis(page).value('dispatches', '7d')).toHaveText('2');
    await expect(workspaceKpis(page).value('autopilot-runs', '30d')).toHaveText('0');
    await expect(workspaceKpis(page).kindRows()).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText(keyB);

    await page.goto(`/workspace/${keyB}/kpis`);
    await expect(workspaceKpis(page).value('dispatches', '30d')).toHaveText('3');
    await expect(workspaceKpis(page).value('autopilot-runs', '30d')).toHaveText('3');
  });

  test('kpis sits in the header next to settings, links there, and is current on its own page', async ({ page }) => {
    await page.goto(`/workspace/${keyA}/settings`);
    await expect(nav(page).getView('kpis')).toBeVisible();
    await nav(page).getView('kpis').click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${keyA}/kpis$`));
    const current = nav(page).getView('kpis');
    await expect(current).toBeVisible();
    await expect(current).toHaveClass(/nav-view-current/);
    expect(await current.evaluate(el => el.tagName)).not.toBe('A');
  });

  test('a workspace the session lacks gets the 404 page; no session redirects to /', async ({ page, playwright, baseURL }) => {
    const missing = await page.request.get(`/workspace/not-in-this-session/kpis`, { maxRedirects: 0 });
    expect(missing.status()).toBe(404);

    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const res = await anonymous.get(`/workspace/${keyA}/kpis`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers()['location']).toBe('/');
    } finally {
      await anonymous.dispose();
    }
  });
});
