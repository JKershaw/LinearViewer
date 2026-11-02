/**
 * LIN-4115 (UI round 3 · S3d): Home's halt banner, end to end.
 *
 * A workspace halt set from the owner's session shows on Home as "Runs are paused/stopped · cleared on Dispatch ›".
 * The owner gets a link to Dispatch; a member reads the same sentence with no link. The run buttons stay while
 * halted. Resume (DELETE) removes the banner. A phone-width page with the banner has no horizontal scroll.
 *
 * The cold-cache + failed-read case is not here: a store read cannot be failed from E2E without a new production
 * test hook, so it is covered at unit level (tests/unit/lin-4115-dashboard-refresh-halt.test.js) with its warm-cache
 * positive control.
 *
 * Seeding goes through the local harness (`seedLocal`, the per-worker urlKey) and ownership through
 * `seedWorkspaceOwnership`. Selectors come from `SELECTORS` (tests/helpers.js). Every spec clears the halt and resets
 * ownership to the owner in afterEach, so neither can leak to another spec on this worker.
 *
 * Run: npx playwright test tests/e2e/lin-4115-home-halt-banner.spec.js
 */
import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS } from '../helpers.js';

const PAUSE = 'Runs are paused · cleared on Dispatch ›';
const STOP = 'Runs are stopped · cleared on Dispatch ›';
const PHONE = { width: 390, height: 844 };

test.describe('Home halt banner (LIN-4115)', () => {
  let WS;
  let API;

  // Clears the halt on this worker's urlKey and proves it by reading it back (the same proof dispatch-halt.spec.js uses).
  async function clearHaltAndProve(page) {
    const clearRes = await page.request.get(`/test/clear-workspace-halt?urlKey=${WS}`);
    expect(clearRes.status()).toBe(200);
    const readBack = await page.request.get(`${API}/api/dispatch/halt`);
    expect(readBack.status()).toBe(200);
    expect(await readBack.json()).toEqual({ halt: null });
  }

  // Seeds this worker's workspace, then makes the session its owner. The halt POST is owner-gated, and a
  // run-control page needs a runner (`runner: true`) to show the Next step / Run to PR / Run to Done rungs.
  async function seed(page, seedLocal, { runner = true } = {}) {
    // A kickoff queued by an earlier spec on this worker's key hides the run button ("busy as a fact"), so start clean.
    for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-task-mode-events']) {
      await page.request.get(`/test/${route}?urlKey=${WS}`);
    }
    await seedLocal(workspaceApiLocalSeed, { runnerKey: runner, openRouterConnected: true });
    await seedWorkspaceOwnership(page, WS, 'owner');
  }

  async function setHalt(page, mode) {
    const res = await page.request.post(`${API}/api/dispatch/halt`, { data: { mode } });
    expect(res.status()).toBe(200);
  }

  async function gotoHome(page) {
    await page.goto(`/workspace/${WS}/`);
    await page.waitForLoadState('networkidle');
  }

  // Opens Home's marked top task (its row) unless it is already open, and returns the opened box.
  async function openTopTask(page) {
    const box = page.locator(SELECTORS.openedTask.box).first();
    if (!(await box.isVisible())) await page.locator(SELECTORS.openedTask.top).click();
    await expect(box).toBeVisible();
    return box;
  }

  /**
   * Each run rung: whether it is drawn and, if so, whether it is enabled. A rung is found by its visible label, not its
   * test id: the filled rung carries `opened-task-go` (its own id is only on the other two), so a test id would miss it.
   */
  async function runRungs(box) {
    const read = async (label) => {
      const locator = box.getByRole('button', { name: label, exact: true });
      const present = (await locator.count()) > 0;
      return { present, enabled: present ? await locator.first().isEnabled() : false };
    };
    return {
      next: await read('Next step'),
      pr: await read('Run to PR'),
      done: await read('Run to Done'),
    };
  }

  /** Light is the default; dark is the opt-in `.theme-dark` hook on <html> (see CLAUDE.md, Design Principles). */
  async function setTheme(page, theme) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('theme-dark', dark), theme === 'dark');
  }

  /** Horizontal overflow of the page in CSS pixels: 0 or less means the page fits the viewport. */
  function horizontalOverflow(page) {
    return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }

  test.beforeEach(async ({ page, localWorkerUrlKey }) => {
    WS = localWorkerUrlKey;
    API = `/workspace/${WS}`;
  });

  test.afterEach(async ({ page }) => {
    await clearHaltAndProve(page);
    await seedWorkspaceOwnership(page, WS, 'owner');
  });

  test('owner: a pause shows the exact sentence, with a Dispatch link to this workspace', async ({ page, seedLocal }) => {
    await seed(page, seedLocal);
    await setHalt(page, 'pause');
    await gotoHome(page);

    const banner = page.locator(SELECTORS.homeHalt.bannerPause);
    await expect(banner).toHaveCount(1);
    await expect(banner).toHaveText(PAUSE);
    await expect(banner.locator(SELECTORS.homeHalt.dispatchLink)).toHaveAttribute('href', `/workspace/${WS}/dispatch`);
  });

  test('owner: a stop shows the stop sentence, with the same Dispatch link', async ({ page, seedLocal }) => {
    await seed(page, seedLocal);
    await setHalt(page, 'stop');
    await gotoHome(page);

    const banner = page.locator(SELECTORS.homeHalt.bannerStop);
    await expect(banner).toHaveCount(1);
    await expect(banner).toHaveText(STOP);
    await expect(banner.locator(SELECTORS.homeHalt.dispatchLink)).toHaveAttribute('href', `/workspace/${WS}/dispatch`);
  });

  test('resume (DELETE) removes the banner on the next load', async ({ page, seedLocal }) => {
    await seed(page, seedLocal);
    await setHalt(page, 'pause');
    await gotoHome(page);
    await expect(page.locator(SELECTORS.homeHalt.banner)).toHaveCount(1);

    const resume = await page.request.delete(`${API}/api/dispatch/halt`);
    expect(resume.status()).toBe(200);
    await gotoHome(page);
    await expect(page.locator(SELECTORS.homeHalt.banner)).toHaveCount(0);
  });

  test('a member sees the exact sentence and no link', async ({ page, seedLocal }) => {
    await seed(page, seedLocal);
    // The owner sets the halt (the POST is owner-gated), then the session becomes a member of the workspace.
    await setHalt(page, 'pause');
    await seedWorkspaceOwnership(page, WS, 'foreign');
    await gotoHome(page);

    const banner = page.locator(SELECTORS.homeHalt.bannerPause);
    await expect(banner).toHaveCount(1);
    await expect(banner).toHaveText(PAUSE);
    await expect(banner.locator('a')).toHaveCount(0);
    await expect(page.locator(SELECTORS.homeHalt.dispatchLink)).toHaveCount(0);
  });

  test('a new user with no runner sees the link', async ({ page, seedLocal }) => {
    await seed(page, seedLocal, { runner: false });
    await setHalt(page, 'pause');
    await gotoHome(page);

    const banner = page.locator(SELECTORS.homeHalt.bannerPause);
    await expect(banner).toHaveText(PAUSE);
    await expect(banner.locator(SELECTORS.homeHalt.dispatchLink)).toHaveAttribute('href', `/workspace/${WS}/dispatch`);
  });

  test('the run buttons stay while halted: the same rungs, with Next step and Run to PR enabled and Run to Done as it was', async ({ page, seedLocal }) => {
    await seed(page, seedLocal);

    await gotoHome(page);
    const unhalted = await runRungs(await openTopTask(page));

    await setHalt(page, 'pause');
    await gotoHome(page);
    const box = await openTopTask(page);
    await expect(page.locator(SELECTORS.homeHalt.bannerPause)).toHaveCount(1);
    await expect(box.locator(SELECTORS.openedTask.go)).toBeVisible();

    const halted = await runRungs(box);
    expect(halted.next).toEqual({ present: true, enabled: true });
    expect(halted.pr).toEqual({ present: true, enabled: true });
    // Run to Done is as drawn without a halt (the prompt section can draw it disabled until its kickoff lands).
    expect(halted.done).toEqual(unhalted.done);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

    for (const theme of ['light', 'dark']) {
      test(`the banner shows with no horizontal scrolling at 390px, ${theme}`, async ({ page, seedLocal }) => {
        await seed(page, seedLocal);
        await setHalt(page, 'pause');
        await gotoHome(page);
        await setTheme(page, theme);

        await expect(page.locator(SELECTORS.homeHalt.bannerPause)).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  });
});
