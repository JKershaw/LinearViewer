/**
 * LIN-3846 — Settings is a page per area, built from three kinds of row.
 *
 * Layout: every area is reachable on desktop and phone, light and dark, with no sideways
 * scroll (`expectNoClippedOverflow`, LIN-3715, not `scrollWidth`). Behaviour: the phone shows
 * the list, then the page with "‹ Settings"; a change for everyone asks why in place, is
 * listed in the change log, and is undone there; pause and stop are owner-only; keys revoke
 * from the one list; the theme is chosen on Account.
 *
 * Seeding goes through `tests/fixtures/local-harness.js` (`seedLocal`); selection through
 * `SELECTORS` / the `settings(page)` object and `data-testid`s.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS, settings, expectNoClippedOverflow } from '../helpers.js';

const AREAS = ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account'];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 } };

test.describe('Settings areas: layout', () => {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const theme of ['light', 'dark']) {
      test(`every area is reachable with no sideways scroll (${vpName}, ${theme})`, async ({ page, context, seedLocal, baseURL }) => {
        const { urlKey } = await seedLocal();
        await seedWorkspaceOwnership(page, urlKey);
        await page.setViewportSize(viewport);
        await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);

        await page.goto(`/workspace/${urlKey}/settings`);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /theme-dark/ : /^(?!.*theme-dark).*$/);
        await expectNoClippedOverflow(page);

        for (const id of AREAS) {
          await settings(page).gotoArea(urlKey, id);
          await expect(settings(page).area(id)).toBeVisible();
          // On a phone the area page hides the list and shows "‹ Settings"; on desktop both show.
          if (vpName === 'phone') {
            await expect(page.getByTestId('settings-back')).toBeVisible();
            await expect(page.getByTestId('settings-nav')).toBeHidden();
          } else {
            await expect(settings(page).navRow(id)).toBeVisible();
          }
          await expectNoClippedOverflow(page);
        }
      });
    }
  }

  test('on a phone the index is the list of areas, and a tap opens the page with a way back', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto(`/workspace/${urlKey}/settings`);
    await expect(page.getByTestId('settings-nav')).toBeVisible();
    await expect(page.locator(SELECTORS.settings.pane)).toBeHidden();
    await settings(page).navRow('features').click();
    await expect(settings(page).area('features')).toBeVisible();
    await expect(page.getByTestId('settings-nav')).toBeHidden();
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('settings-nav')).toBeVisible();
  });

  test('Models keeps its slot and the legacy forms, with the presets anchor', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.setViewportSize(VIEWPORTS.desktop);
    await settings(page).gotoArea(urlKey, 'models');
    await expect(page.locator('#dispatch-presets')).toBeVisible();
    await expect(settings(page).section('ai-model')).toBeVisible();
    await expect(settings(page).section('dispatch-defaults')).toBeVisible();
  });
});

test.describe('Settings areas: everyone-changes ask why, are logged, and can be undone', () => {
  test.beforeEach(async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await seedWorkspaceOwnership(page, urlKey);
    await page.request.get(`/test/clear-workspace-halt?urlKey=${urlKey}`);
  });

  test('pause from Running asks in place, shows in the change log, and Undo resumes', async ({ page, localWorkerUrlKey }) => {
    const reason = `Deploy window ${Date.now()}`;
    await settings(page).gotoArea(localWorkerUrlKey, 'running');

    // Nothing pops up: the form is inside the opened row.
    const pause = page.getByTestId('settings-halt-pause');
    await expect(page.getByTestId('settings-halt-pause-confirm')).toBeHidden();
    await pause.locator('summary').click();
    await expect(page.getByTestId('settings-halt-pause-confirm')).toBeVisible();
    await page.getByTestId('settings-halt-pause-reason').fill(reason);
    await page.getByTestId('settings-halt-pause-confirm').click();

    await expect(page.getByTestId('settings-halt-state')).toContainText('Paused');
    await expect(settings(page).navState('running')).toHaveText('Paused');

    await settings(page).gotoArea(localWorkerUrlKey, 'change-log');
    const row = page.locator('[data-testid="settings-change-workspace"]', { hasText: reason });
    await expect(row).toContainText('Runs paused');

    await row.locator('[data-testid^="settings-undo-"] summary').click();
    await row.locator('textarea[name="reason"]').fill('Window is over');
    await row.getByRole('button', { name: 'Undo this change' }).click();
    await expect(page.getByTestId('settings-flash')).toContainText('Change undone');

    await settings(page).gotoArea(localWorkerUrlKey, 'running');
    await expect(page.getByTestId('settings-halt-state')).toContainText('Running');
  });

  test('periodic reviews ask why, and without a reason nothing changes', async ({ page, localWorkerUrlKey }) => {
    await settings(page).gotoArea(localWorkerUrlKey, 'running');
    const row = page.getByTestId('settings-toggle-periodicals');
    const before = await page.getByTestId('settings-periodicals-state').innerText();
    await row.locator('summary').click();
    // The browser refuses an empty required reason, so the form does not submit.
    await row.locator('[data-testid$="-confirm"]').click();
    await expect(page).toHaveURL(/\/settings\/running$/);
    await expect(page.getByTestId('settings-periodicals-state')).toContainText(before);

    await row.locator('textarea[name="reason"]').fill('Try the weekly reviews');
    await row.locator('[data-testid$="-confirm"]').click();
    await expect(page.getByTestId('settings-periodicals-state')).not.toContainText(before);
  });

  test('a member sees the state and an owner-only note, never the pause / stop buttons', async ({ page, localWorkerUrlKey }) => {
    await seedWorkspaceOwnership(page, localWorkerUrlKey, 'foreign');
    await settings(page).gotoArea(localWorkerUrlKey, 'running');
    await expect(page.getByTestId('settings-halt-state')).toBeVisible();
    await expect(page.getByTestId('settings-halt-pause')).toHaveCount(0);
    await expect(page.getByTestId('settings-halt-stop')).toHaveCount(0);
    // Periodic reviews are for any member.
    await expect(page.getByTestId('settings-toggle-periodicals')).toBeVisible();
  });
});

test.describe('Settings areas: keys and the theme', () => {
  test('the one list: New key shows the secret once, then revokes from the list', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await seedWorkspaceOwnership(page, urlKey);
    await settings(page).gotoArea(urlKey, 'agent-access');

    await page.getByTestId('settings-newkey').locator('summary').click();
    await page.locator(SELECTORS.settings.newKeyLabel).fill('ci-reader');
    await page.getByTestId('settings-newkey-submit').click();
    await expect(page.getByTestId('settings-newkey-secret')).toContainText('shown once');

    await page.reload();
    const key = page.getByTestId('settings-key-proxy').filter({ hasText: 'ci-reader' });
    await expect(key).toHaveCount(1);
    await key.locator('summary').click();
    await expect(key).toContainText('expires 2');
    await key.getByTestId('settings-key-revoke').click();
    await expect(page.getByTestId('settings-key-proxy').filter({ hasText: 'ci-reader' })).toHaveCount(0);
  });

  test('the theme is chosen on Account and sticks (the footer has no theme link)', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await settings(page).gotoArea(urlKey, 'account');
    await expect(page.getByTestId('footer-theme-toggle')).toHaveCount(0);
    await page.getByTestId('settings-theme-dark').click();
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    await page.getByTestId('settings-theme-light').click();
    await expect(page.locator('html')).not.toHaveClass(/theme-dark/);
  });
});
