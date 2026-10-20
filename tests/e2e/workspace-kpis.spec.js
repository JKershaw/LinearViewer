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

// One dispatch per seeded local issue (LOCAL-1..3): a made-up identifier is
// refused as a dangling referent (422), and a second dispatch for the same
// issue and prompt would trip the duplicate guard.
async function dispatch(page, key, promptName, count) {
  for (let i = 0; i < count; i++) {
    const res = await page.request.post(`/workspace/${key}/api/dispatch`, {
      data: { prompt: 'p', promptName, kind: promptName, issueIdentifier: `LOCAL-${i + 1}`, target: 'cli' }
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

  // LIN-3711: trend charts. Done and priced lineages cannot be created through
  // the app's dispatch API (a `[done]` marker and a usage entry arrive from the
  // runner), so those series are covered by tests/unit/workspace-kpi-stats.test.js
  // and these tests check the page shape on dispatch-only data.
  test.describe('trend charts', () => {
    const CHARTS = ['done-per-day', 'runs-by-kind', 'cost'];

    // html and body are `overflow-x: clip` (public/style.css), so the document
    // never reports spill: measure the boxes themselves, as tests/e2e/kpis.spec.js does.
    async function expectNoClippedOverflow(page) {
      const m = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        boxes: [...document.querySelectorAll('[data-testid^="workspace-kpis-section-"], [data-testid^="workspace-kpis-card-"]')]
          .map(el => ({ id: el.dataset.testid, over: el.scrollWidth - el.clientWidth }))
          .filter(b => b.over > 0),
      }));
      expect(m.body).toBeLessThanOrEqual(0);
      expect(m.root).toBeLessThanOrEqual(0);
      expect(m.boxes).toEqual([]);
    }

    test('with JavaScript every canvas or its empty note has size, and the sparklines draw', async ({ page }) => {
      await dispatch(page, keyA, 'implementation', 2);
      await page.goto(`/workspace/${keyA}/kpis`);
      for (const name of CHARTS) await expect(workspaceKpis(page).section(name)).toBeVisible();
      await expect(workspaceKpis(page).spark('dispatches').locator('svg')).toBeVisible();
      await expect(workspaceKpis(page).spark('autopilot-runs').locator('svg')).toBeVisible();
      await expect(workspaceKpis(page).spark('agent-actions').locator('svg')).toBeVisible();
      await expect(page.locator('[data-testid="workspace-kpis-spark-feedback-notes"]')).toHaveCount(0);

      // runs-by-kind has data (two dispatches), so its canvas stays and is drawn.
      const box = await workspaceKpis(page).chart('runs-by-kind').boundingBox();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      // The other two have nothing to draw yet: the page script swaps the canvas
      // for a note that fills the same sized box.
      for (const name of ['done-per-day', 'cost']) {
        const note = workspaceKpis(page).section(name).locator('.kpi-chart-empty');
        await expect(note).toBeVisible();
        const b = await note.boundingBox();
        expect(b.height).toBeGreaterThan(0);
      }
    });

    test('without JavaScript the tables are in the page, the noscript line shows, and nothing errors', async ({ browser, page }) => {
      await dispatch(page, keyA, 'implementation', 2);
      const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
      const plain = await context.newPage();
      const errors = [];
      plain.on('pageerror', err => errors.push(err.message));
      try {
        const res = await plain.goto(new URL(`/workspace/${keyA}/kpis`, page.url()).toString());
        expect(res.status()).toBe(200);
        await expect(plain.locator('[data-testid="workspace-kpis-noscript"]')).toBeVisible();
        for (const name of CHARTS) {
          await plain.locator(`[data-testid="workspace-kpis-numbers-${name}"] summary`).click();
          const rows = plain.locator(`[data-testid="workspace-kpis-table-${name}"] tbody tr`);
          expect(await rows.count()).toBeGreaterThan(0);
          await expect(plain.locator(`[data-testid="workspace-kpis-table-${name}"]`)).toBeVisible();
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });

    for (const theme of ['light', 'dark']) {
      test(`at 390px nothing spills sideways (${theme})`, async ({ page }) => {
        await dispatch(page, keyA, 'implementation', 2);
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto(`/workspace/${keyA}/kpis`);
        if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
        for (const name of CHARTS) await workspaceKpis(page).numbers(name).locator('summary').click();
        await expectNoClippedOverflow(page);
        // A table is wider than a phone: its wrapper scrolls instead of the page.
        const wrap = await page.locator('.kpi-numbers-wrap').first().evaluate(el => getComputedStyle(el).overflowX);
        expect(wrap).toBe('auto');
      });
    }
  });
});
