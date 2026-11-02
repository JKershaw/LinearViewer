/**
 * LIN-4115 evidence maker (beat 3): Home's halt banner, the paused and stopped states, for the owner with a runner and a
 * new user with no runner at 1280px and 390px, light and dark; and for a member at 1280px light. Like the other makers in
 * this directory it writes PNGs and asserts only what it needs to frame the picture:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4115-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-02-lin4115/
 *   owner-paused-{light,dark}-{1280,390}.png    owner with a runner, a pause: the banner with the Dispatch link
 *   newuser-paused-{light,dark}-{1280,390}.png  new user, no runner, a pause: the banner, the link, the copy-first card below
 *   owner-stopped-light-1280.png                owner, a stop: the stop sentence
 *   member-paused-light-1280.png                member, a pause: the same sentence, no link
 *
 * The halt is set through the owner-gated POST as the seeded owner; the member is the same workspace seen by a foreign
 * session, set after the halt. Theme is the `theme` cookie, the same pre-paint switch the product uses.
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS } from '../helpers.js';

const DIR = 'docs/reviews/_evidence-2026-11-02-lin4115';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };

test.describe.configure({ mode: 'serial' });

async function setTheme(page, theme) {
  const baseURL = test.info().project.use.baseURL;
  await page.context().clearCookies({ name: 'theme' });
  if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: baseURL }]);
}

/** Seeds the workspace for one framing: a runner or not, the owner's session, and no leftover halt. */
async function seed(page, seedLocal, urlKey, { runner }) {
  await seedLocal(workspaceApiLocalSeed, { runnerKey: runner, openRouterConnected: true });
  await seedWorkspaceOwnership(page, urlKey, 'owner');
  await page.request.get(`/test/clear-workspace-halt?urlKey=${urlKey}`);
}

async function setHalt(page, urlKey, mode) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch/halt`, { data: { mode } });
  expect(res.status()).toBe(200);
}

async function shoot(page, urlKey, name, viewport, theme) {
  await setTheme(page, theme);
  await page.setViewportSize(viewport);
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

for (const theme of ['light', 'dark']) {
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    test(`owner with a runner, paused, ${theme}, ${label}px`, async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seed(page, seedLocal, localWorkerUrlKey, { runner: true });
      await setHalt(page, localWorkerUrlKey, 'pause');
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${localWorkerUrlKey}/`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(SELECTORS.homeHalt.bannerPause)).toBeVisible();
      await shoot(page, localWorkerUrlKey, `owner-paused-${theme}-${label}`, viewport, theme);
      await page.request.get(`/test/clear-workspace-halt?urlKey=${localWorkerUrlKey}`);
    });

    test(`new user with no runner, paused, ${theme}, ${label}px`, async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seed(page, seedLocal, localWorkerUrlKey, { runner: false });
      await setHalt(page, localWorkerUrlKey, 'pause');
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${localWorkerUrlKey}/`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(SELECTORS.homeHalt.bannerPause)).toBeVisible();
      await shoot(page, localWorkerUrlKey, `newuser-paused-${theme}-${label}`, viewport, theme);
      await page.request.get(`/test/clear-workspace-halt?urlKey=${localWorkerUrlKey}`);
    });
  }
}

test('owner with a runner, stopped, light, 1280px', async ({ page, seedLocal, localWorkerUrlKey }) => {
  await seed(page, seedLocal, localWorkerUrlKey, { runner: true });
  await setHalt(page, localWorkerUrlKey, 'stop');
  await setTheme(page, 'light');
  await page.setViewportSize(WIDTHS[1280]);
  await page.goto(`/workspace/${localWorkerUrlKey}/`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator(SELECTORS.homeHalt.bannerStop)).toBeVisible();
  await shoot(page, localWorkerUrlKey, 'owner-stopped-light-1280', WIDTHS[1280], 'light');
  await page.request.get(`/test/clear-workspace-halt?urlKey=${localWorkerUrlKey}`);
});

test('member, paused, light, 1280px', async ({ page, seedLocal, localWorkerUrlKey }) => {
  await seed(page, seedLocal, localWorkerUrlKey, { runner: true });
  await setHalt(page, localWorkerUrlKey, 'pause');
  await seedWorkspaceOwnership(page, localWorkerUrlKey, 'foreign');
  await setTheme(page, 'light');
  await page.setViewportSize(WIDTHS[1280]);
  await page.goto(`/workspace/${localWorkerUrlKey}/`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator(SELECTORS.homeHalt.bannerPause)).toBeVisible();
  await shoot(page, localWorkerUrlKey, 'member-paused-light-1280', WIDTHS[1280], 'light');
  await page.request.get(`/test/clear-workspace-halt?urlKey=${localWorkerUrlKey}`);
  await seedWorkspaceOwnership(page, localWorkerUrlKey, 'owner');
});
