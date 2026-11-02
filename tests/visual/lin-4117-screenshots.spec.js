/**
 * LIN-4117 evidence maker: Home's top task sits in In Progress under a Todo context parent, with the parent's
 * "show N more" fold reaching its open sibling. Also the manual repro of the review's ledger item (a fold on an ancestor
 * that is not started), run end to end in a real browser. Shots are for a runner owner and a new user with no runner,
 * at 1280px and 390px, light and dark:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4117-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Seed: Todo parent P ("Context parent") with a Todo top task T (urgent, so it is the front card) and a Todo sibling S.
 *
 * Output: docs/reviews/_evidence-2026-11-02-lin4117/{owner,newuser}-{light,dark}-{1280,390}.png
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-11-02-lin4117';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const OLD = '2020-01-01T00:00:00Z';

test.describe.configure({ mode: 'serial' });

async function seed(page, urlKey, runner) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  const id = (raw) => localSeedId(urlKey, raw);
  const todo = { name: 'Todo', type: 'unstarted' };
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey,
      runnerKey: runner,
      projects: [{ id: id('proj'), name: 'Context project', content: 'Seeded for LIN-4117', sortOrder: 1 }],
      issues: [
        { id: id('p'), identifier: 'LOCAL-P1', title: 'Context parent', projectId: id('proj'), sortOrder: 1, createdAt: OLD, state: todo },
        { id: id('t'), identifier: 'LOCAL-P2', title: 'Top task under the parent', projectId: id('proj'), parentId: id('p'), priority: 1, sortOrder: 2, createdAt: OLD, state: todo },
        { id: id('s'), identifier: 'LOCAL-P3', title: 'Open sibling behind the fold', projectId: id('proj'), parentId: id('p'), priority: 4, sortOrder: 3, createdAt: OLD, state: todo },
      ],
    },
  });
  expect(resp.ok()).toBeTruthy();
}

async function setTheme(page, theme) {
  const baseURL = test.info().project.use.baseURL;
  await page.context().clearCookies({ name: 'theme' });
  if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: baseURL }]);
}

for (const [who, runner] of [['owner', true], ['newuser', false]]) {
  for (const theme of ['light', 'dark']) {
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      test(`${who}, ${theme}, ${label}px: top task in In Progress under its context parent; the fold reaches the sibling`, async ({ page, localWorkerUrlKey }) => {
        await seed(page, localWorkerUrlKey, runner);
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/`);
        await page.waitForLoadState('networkidle');

        // The top task is in In Progress, once on the page, and not under its project.
        const mark = page.locator('[data-top-task="1"]');
        await expect(mark).toHaveCount(1);
        await expect(page.locator('.running-section [data-top-task="1"]')).toHaveCount(1);
        await expect(page.locator('.project [data-top-task="1"]')).toHaveCount(0);
        await expect(page.locator('.running-section [data-identifier="LOCAL-P2"]')).toHaveCount(1);
        await expect(page.locator('[data-identifier="LOCAL-P2"]')).toHaveCount(1);

        // The context parent is a Todo, not started: its fold must still reach the open sibling.
        const parentLine = page.locator('.running-section .line[data-identifier="LOCAL-P1"]');
        await expect(parentLine).toBeVisible();
        await parentLine.click();
        const more = page.locator('.running-section [data-home-fetch="more-of-parent"]');
        await expect(more).toBeVisible();
        await expect(more).toContainText('show 1 more');
        await more.click();
        await expect(page.locator('.running-section .line[data-identifier="LOCAL-P3"]')).toBeVisible();
        await expect(page.locator('[data-identifier="LOCAL-P3"]')).toHaveCount(1);

        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        mkdirSync(DIR, { recursive: true });
        await page.screenshot({ path: `${DIR}/${who}-${theme}-${label}.png`, fullPage: true });
      });
    }
  }
}
