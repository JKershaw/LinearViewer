/**
 * LIN-4113 evidence maker: Home's desk (Running and recently moved, then Up next), for a runner owner and a new user
 * without a runner, at 1280px and 390px, light and dark. A twelfth shot seeds more than ten recent rows, so the recent
 * block shows its "show N more" fold. Run:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4113-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Seed: a started task (Running), five Todo tasks across two projects (Up next), and twelve tasks finished today (the
 * recent block: ten drawn, the rest folded).
 *
 * Output: docs/reviews/_evidence-2026-11-02-lin4113/{owner,newuser}-{light,dark}-{1280,390}.png and owner-folded-1280.png
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-11-02-lin4113';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const OLD = '2020-01-01T00:00:00Z';

test.describe.configure({ mode: 'serial' });

async function seed(page, urlKey, runner, { finished = 12 } = {}) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  const id = (raw) => localSeedId(urlKey, raw);
  const todo = { name: 'Todo', type: 'unstarted' };
  const issues = [
    { id: id('r1'), identifier: 'LOCAL-R1', title: 'Running task: the first step is underway', projectId: id('alpha'), sortOrder: 1, createdAt: OLD, description: 'Seeded for LIN-4113', state: { name: 'In Progress', type: 'started' } },
    { id: id('n1'), identifier: 'LOCAL-N1', title: 'Next task in alpha', projectId: id('alpha'), priority: 2, sortOrder: 2, createdAt: OLD, description: 'Seeded for LIN-4113', state: todo },
    { id: id('n2'), identifier: 'LOCAL-N2', title: 'Next task in alpha, second', projectId: id('alpha'), priority: 3, sortOrder: 3, createdAt: OLD, state: todo },
    { id: id('n3'), identifier: 'LOCAL-N3', title: 'Next task in beta', projectId: id('beta'), priority: 1, sortOrder: 4, createdAt: OLD, state: todo },
    { id: id('n4'), identifier: 'LOCAL-N4', title: 'Next task in beta, second', projectId: id('beta'), priority: 4, sortOrder: 5, createdAt: OLD, state: todo },
    { id: id('n5'), identifier: 'LOCAL-N5', title: 'Next task in alpha, third', projectId: id('alpha'), priority: 4, sortOrder: 6, createdAt: OLD, state: todo },
  ];
  const finishedAt = new Date().toISOString();
  for (let i = 1; i <= finished; i += 1) {
    issues.push({ id: id(`d${i}`), identifier: `LOCAL-D${i}`, title: `Finished today ${i}`, projectId: id('beta'), sortOrder: 10 + i, createdAt: OLD, completedAt: finishedAt, updatedAt: finishedAt, state: { name: 'Done', type: 'completed' } });
  }
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey,
      runnerKey: runner,
      projects: [
        { id: id('alpha'), name: 'Alpha project', content: 'Seeded for LIN-4113', sortOrder: 1 },
        { id: id('beta'), name: 'Beta project', content: 'Seeded for LIN-4113', sortOrder: 2 },
      ],
      issues,
    },
  });
  expect(resp.ok()).toBeTruthy();
}

async function setTheme(page, theme) {
  const baseURL = test.info().project.use.baseURL;
  await page.context().clearCookies({ name: 'theme' });
  if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: baseURL }]);
}

async function shoot(page, path) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

for (const [who, runner] of [['owner', true], ['newuser', false]]) {
  for (const theme of ['light', 'dark']) {
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      test(`${who}, ${theme}, ${label}px: the desk, Running then Up next`, async ({ page, localWorkerUrlKey }) => {
        await seed(page, localWorkerUrlKey, runner);
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/`);
        await page.waitForLoadState('networkidle');

        // Running shows the started task; the recent block shows ten rows and its fold; Up next shows five rows.
        await expect(page.locator('[data-testid="running-section"] [data-identifier="LOCAL-R1"]')).toHaveCount(1);
        await expect(page.locator('[data-testid="running-recent-items"] [data-testid="issue-line"]')).toHaveCount(10);
        await expect(page.locator('[data-testid="home-fold-recent"]')).toHaveText('show 2 more ▶');
        await expect(page.locator('[data-testid="home-up-next-section"] [data-testid="issue-line"][data-section="home-up-next"]')).toHaveCount(5);
        await expect(page.locator('[data-testid="project"]')).toHaveCount(0);
        await shoot(page, `${DIR}/${who}-${theme}-${label}.png`);
      });
    }
  }
}

test('owner, light, 1280px: more than ten recent rows, the fold shows its count', async ({ page, localWorkerUrlKey }) => {
  await seed(page, localWorkerUrlKey, true, { finished: 26 });
  await setTheme(page, 'light');
  await page.setViewportSize(WIDTHS[1280]);
  await page.goto(`/workspace/${localWorkerUrlKey}/`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-testid="home-fold-recent"]')).toHaveText('show 16 more ▶');
  await shoot(page, `${DIR}/owner-folded-1280.png`);
});
