import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';
import { SELECTORS, settings, expectNoClippedOverflow } from '../helpers.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

// LIN-3888 (Free the seam): behaviour tests for the Settings and Dispatch client hooks, selected
// through test ids and page objects, never style classes. Consolidate (LIN-3889) re-points each hook
// onto attributes; these tests are what catch a hook that stops working when it moves. Each one was
// witnessed failing with its hook removed (see the PR).

const PHONE = { width: 390, height: 844 };
const UNDO = '[data-testid="settings-undo-inline"]';

test.describe('Settings and Dispatch client hooks (LIN-3888)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(workspaceApiLocalSeed);
  });

  // Hook 1, public/app.js initFeatureToggles: the switch's XHR click handler (LIN-3401).
  test('hook 1: a feature switch saves in place over XHR, not by a full-page submit', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/features`);
    await page.waitForLoadState('networkidle');

    const roadmap = page.locator(SELECTORS.settings.switch('roadmap'));
    await expect(roadmap).toHaveText('○ off');

    let navigated = false;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true; });
    const ajaxPost = page.waitForRequest((r) =>
      r.method() === 'POST' && r.headers()['x-requested-with'] === 'XMLHttpRequest' && /\/settings\//.test(r.url())
    );

    await roadmap.click();
    await ajaxPost;

    await expect(roadmap).toHaveText('● on');
    expect(navigated, 'the switch saved in place, not by a page submit').toBe(false);
  });

  // Hook 2, public/app.js addInlineUndo and the ✓ beside the switch: the feature row is found by
  // `closest` from the switch, so both the ✓ and the Undo land in that row.
  test('hook 2: a changed switch shows ✓ and an inline Undo in its row, and Undo flips it back', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/features`);
    await page.waitForLoadState('networkidle');

    const roadmap = page.locator(SELECTORS.settings.switch('roadmap'));
    const row = page.locator(SELECTORS.settings.toggle('roadmap'));
    await expect(roadmap).toHaveText('○ off');

    await roadmap.click();
    await expect(roadmap).toHaveText('● on');
    await expect(row).toContainText('✓');
    await expect(row.locator(UNDO)).toBeVisible();

    await row.locator(UNDO).click();
    await expect(roadmap).toHaveText('○ off');
  });

  // Hook 3, public/settings.js initJsonToggles: the +proxy switch posts JSON and offers the same Undo
  // in its own row (found by `closest` from the form).
  test('hook 3: the +proxy switch saves as JSON, offers Undo, and keeps its state on reload', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/features`);
    await page.waitForLoadState('networkidle');

    const proxy = page.locator(SELECTORS.settings.switch('proxyDefault'));
    const row = page.locator(SELECTORS.settings.toggle('proxyDefault'));
    const wasOn = (await proxy.getAttribute('aria-checked')) === 'true';

    const jsonPost = page.waitForRequest((r) =>
      r.method() === 'POST' && (r.headers()['content-type'] || '').includes('application/json') && /proxy-default/.test(r.url())
    );
    await proxy.click();
    await jsonPost;

    await expect(proxy).toHaveAttribute('aria-checked', wasOn ? 'false' : 'true');
    await expect(row.locator(UNDO)).toBeVisible();

    await row.locator(UNDO).click();
    await expect(proxy).toHaveAttribute('aria-checked', wasOn ? 'true' : 'false');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.settings.switch('proxyDefault'))).toHaveAttribute('aria-checked', wasOn ? 'true' : 'false');
  });

  // Hook 4, public/dispatch.js initDispatchPagePrompt: the prompt box finds its own section by `closest`,
  // and a send there lists the prompt as a recent inside that section.
  test('hook 4: Dispatch Send Prompt dispatches, shows the send, and lists the prompt as a recent in its section', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { runnerKey: true });
    await seedWorkspaceOwnership(page, localWorkerUrlKey, 'owner'); // enqueue is owner-only (LIN-3383)
    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`);
    await page.waitForLoadState('networkidle');

    const section = page.locator(SELECTORS.dispatchSection('send-prompt'));
    // The send controls sit in a panel that opens from its own disclosure (aria-controls).
    await section.locator('[aria-controls="dispatch-options"]').click();
    const textarea = section.locator('textarea').first();
    await textarea.fill('Seam prompt');

    const send = section.locator('[data-target="cli"]');
    await send.click();

    await expect(send).toHaveText('dispatched!');
    await expect(textarea).toHaveValue('');
    await expect(section.getByText('Seam prompt').first()).toBeVisible({ timeout: 5000 });
  });

  // The phone layout that settings-components.test.js (formerly render-settings-shell.test.js) used to pin in the CSS text: the list
  // and the page are never both shown on a phone, and nothing scrolls sideways.
  test('on a phone the list and the page are never both shown, and nothing scrolls sideways', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize(PHONE);

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await expect(page.getByTestId('settings-nav')).toBeVisible();
    await expect(page.locator(SELECTORS.settings.pane)).toBeHidden();
    await expectNoClippedOverflow(page);

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/features`);
    await expect(settings(page).area('features')).toBeVisible();
    await expect(page.locator(SELECTORS.settings.pane)).toBeVisible();
    await expect(page.getByTestId('settings-nav')).toBeHidden();
    await expectNoClippedOverflow(page);
  });
});
