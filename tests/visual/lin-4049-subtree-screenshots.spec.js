/**
 * LIN-4049 evidence maker: the opened box and the task page over a subtree, in light and dark, at 1280px and 390px, for
 * the runner owner and for a new user with no runner. Like the other makers in this directory it writes PNGs and asserts
 * nothing (the E2E witnesses in tests/e2e/lin-4049-subtree-box.spec.js assert):
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4049-subtree-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-10-30-lin4049/<surface>-<user>-<theme>-<width>.png
 *   - task-LOCAL-30: a three-level parent whose leaf (LOCAL-33) runs; its page reads running and offers no run
 *   - home: Home's top task is the running subtask of LOCAL-70 (the homeSubtreeLocalSeed shape)
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, subtreeLocalSeed, homeSubtreeLocalSeed, seedSessionOnTask } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-10-30-lin4049';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const USERS = [
  { name: 'owner', runnerKey: true },
  { name: 'new-user', runnerKey: false },
];

test.describe.configure({ mode: 'serial' });

// Each capture seeds its own sessions; a DUPLICATE_DISPATCH guard refuses a second dispatch of the same task and kind
// within five minutes, so the queue and history are cleared before every capture.
test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-task-decisions']) {
    await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
  }
});

for (const user of USERS) {
  for (const theme of ['light', 'dark']) {
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      test(`task page LOCAL-30, ${user.name}, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
        await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: user.runnerKey });
        await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-33', state: 'running' });
        await page.context().clearCookies({ name: 'theme' });
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: test.info().project.use.baseURL }]);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/task/LOCAL-30`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('[data-testid="task-page-status-pill"]')).toHaveText('running');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        await page.screenshot({ path: `${DIR}/task-LOCAL-30-${user.name}-${theme}-${label}.png`, fullPage: true });
      });

      test(`home, ${user.name}, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
        await seedLocalWorkspace(page, homeSubtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: user.runnerKey });
        await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-71', state: 'running' });
        await page.context().clearCookies({ name: 'theme' });
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: test.info().project.use.baseURL }]);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/`);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        await page.screenshot({ path: `${DIR}/home-${user.name}-${theme}-${label}.png`, fullPage: true });
      });
    }
  }
}
