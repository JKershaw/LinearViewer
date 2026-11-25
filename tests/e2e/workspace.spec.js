import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';

// LIN-4563 (LIN-4342 piece 2): Home moved onto the frame, whose rail carries the workspace menu (switch and add only).
// LIN-4566 (piece 5) moved Settings, the last signed-in page whose old bar a person could open, onto the frame: the one
// workspace page still drawing the old bar, the Project backlog (routes/project-page.js), loads no script, so its menu
// cannot open. The selector cases read the rail's menu (on Settings, MENU_PAGE) instead, and the old bar's markup is
// checked for what it must no longer offer. Removing a workspace lives in Settings › Sources: neither menu offers it.
const MENU_PAGE = 'settings';
const OLD_BAR_PAGE = 'project';

// Mixed-harness boundary split (LIN-428, parent S3/LIN-389).
//   - The two single-workspace selector cases ('single workspace shows in
//     selector', 'clicking outside closes workspace selector') migrate onto a
//     GENUINE `provider: 'local'` session (seedLocalWorkspace).
//   - Every multi-workspace / switch / removal / max-workspaces case stays
//     PINNED on the Linear `test-token` path: the single-workspace local harness
//     cannot represent the `multiWorkspace`/`maxWorkspaces` session state those
//     cases exercise.

// Workspace URL for the PINNED (test-token) sessions below, bound per-test from
// the per-worker key (LIN-628). The multiWorkspace siblings come from the
// `secondWorkerUrlKey` / `workerSuffix` fixtures so every workspace in the
// session is partition-distinct per worker.
let WORKSPACE_URL;

test.beforeEach(({ workerUrlKey }) => {
  WORKSPACE_URL = `/workspace/${workerUrlKey}/${MENU_PAGE}`;
});

const railRows = (page) => page.locator(`${SELECTORS.nav.workspaceMenu} li`);

test.describe('Workspace Selector', () => {
  test('single workspace shows in selector', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.goto(`/workspace/${urlKey}/${MENU_PAGE}`);

    const workspaceToggle = page.locator(SELECTORS.nav.workspaceToggle);
    await expect(workspaceToggle).toBeVisible();
    await expect(page.locator(SELECTORS.nav.workspaceName)).toHaveText('Local Workspace');

    // Click to open options
    await workspaceToggle.click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();

    // Should show workspace rows (1 workspace + Linear +add + Jira +add + local
    // +add row). Jira renders here because the shared Playwright webServer sets
    // JIRA_CLIENT_ID/SECRET/REDIRECT_URI for the whole run (LIN-2802).
    // The local-create row is always present (LIN-377), independent of OAuth/PAT.
    await expect(railRows(page)).toHaveCount(4);

    // Row order (LIN-2802 acceptance bullet 3): the workspace row, then the
    // registry-driven provider add rows in registry order (linear before
    // jira; github would sort between them if configured here), with Local
    // always the true last row.
    const rows = railRows(page);
    await expect(rows.nth(0)).toContainText('Local Workspace');
    await expect(rows.nth(1).locator('[data-testid="rail-workspace-add-linear"]')).toContainText('+ Linear');
    await expect(rows.nth(2).locator('[data-testid="rail-workspace-add-jira"]')).toContainText('+ Jira');
    await expect(rows.nth(3).locator('[data-testid="rail-workspace-add-local"]')).toContainText('+ Local workspace');
  });

  test('multiple workspaces show in selector', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();

    // Should show 2 workspaces + Linear +add + Jira +add + local +add option
    await expect(railRows(page)).toHaveCount(5);

    // First workspace should be the current one (has ● marker)
    await expect(page.locator(`${SELECTORS.nav.workspaceMenu} [aria-current="true"]`)).toContainText('Test Workspace');
  });

  test('clicking outside closes workspace selector', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.goto(`/workspace/${urlKey}/${MENU_PAGE}`);

    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();

    // Click outside (a bare corner of the page's <main>)
    await page.locator(SELECTORS.nav.main).click({ position: { x: 2, y: 2 } });

    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeHidden();
  });
});

test.describe('Workspace Switching', () => {
  test('can switch to second workspace from Home, through the rail\'s menu; the menu offers no remove', async ({ page, workerUrlKey, secondWorkerUrlKey }) => {
    // Set up multiWorkspace session
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/`);

    // Initially showing first workspace
    await expect(page.locator(SELECTORS.nav.workspaceName)).toHaveText('Test Workspace');

    // Open the rail's workspace menu: it switches and adds; removing lives in Settings.
    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();
    await expect(page.locator(`${SELECTORS.nav.workspaceMenu} .nav-option-danger, ${SELECTORS.nav.workspaceMenu} [action$="/remove"]`)).toHaveCount(0);

    // Click the second workspace and wait for navigation to the new workspace's Home
    await Promise.all([
      page.waitForURL(`/workspace/${secondWorkerUrlKey}/`),
      page.locator(`[data-testid="rail-workspace-${secondWorkerUrlKey}"]`).click()
    ]);

    // Force a reload to bypass any caching issues
    await page.reload();

    // Should now show second workspace
    await expect(page.locator(SELECTORS.nav.workspaceName)).toHaveText('Second Workspace');
  });

  test('switching workspace from settings stays on settings, through the rail\'s menu', async ({ page, workerUrlKey, secondWorkerUrlKey }) => {
    // Set up multiWorkspace session
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/settings`);

    // Verify we're on settings page (LIN-4566: in the frame)
    await expect(page.getByTestId('settings-nav')).toBeVisible();

    // Open the rail's workspace menu
    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();

    // Click the second workspace and wait for navigation to settings in new workspace
    await Promise.all([
      page.waitForURL(`/workspace/${secondWorkerUrlKey}/settings`),
      page.locator(`[data-testid="rail-workspace-${secondWorkerUrlKey}"]`).click()
    ]);

    // Should still be on settings page
    await expect(page.getByTestId('settings-nav')).toBeVisible();
    await expect(page.locator(SELECTORS.nav.workspaceName)).toHaveText('Second Workspace');
  });
});

// LIN-4566 (LIN-4342 piece 5): removing a workspace lives in Settings › Sources, as an ask in place that posts to the
// existing POST /workspace/:urlKey/remove (routes/workspace.js). The old bar's red "remove" is gone with it.
test.describe('Workspace Removal', () => {
  test('the old bar\'s workspace menu offers no remove', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/${OLD_BAR_PAGE}`);

    // The bar's menu is drawn (closed: the page loads no script to open it); it switches and adds, never removes.
    await expect(page.locator('#workspace-options')).toHaveCount(1);
    await expect(page.locator('#workspace-options [role="option"]')).toHaveCount(2);
    await expect(page.locator('#workspace-options [action$="/remove"]')).toHaveCount(0);
    await expect(page.locator('#workspace-options .nav-option-danger')).toHaveCount(0);
  });

  test('Settings › Sources removes this workspace through its confirm, and lands on the one left', async ({ page, workerUrlKey, secondWorkerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/settings/sources`);

    const ask = page.locator(SELECTORS.settings.removeWorkspace);
    await expect(ask).toBeVisible();
    // Closed, nothing is sent: the confirm is in place, and Cancel leaves the workspace where it was.
    await ask.locator('summary').click();
    await expect(ask).toContainText('your other workspaces are not affected');
    await ask.getByTestId('settings-workspace-remove-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${workerUrlKey}/settings/sources$`));
    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(`[data-testid="rail-workspace-${workerUrlKey}"]`)).toBeVisible();

    // Confirmed, the workspace goes and the person lands on the other one's Home.
    await page.goto(`/workspace/${workerUrlKey}/settings/sources`);
    await ask.locator('summary').click();
    await Promise.all([
      page.waitForURL(`/workspace/${secondWorkerUrlKey}/`),
      ask.getByTestId('settings-workspace-remove-confirm').click()
    ]);
    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(`[data-testid="rail-workspace-${secondWorkerUrlKey}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="rail-workspace-${workerUrlKey}"]`)).toHaveCount(0);
  });

  test('removing the last workspace from Settings signs out', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/settings/sources`);

    const ask = page.locator(SELECTORS.settings.removeWorkspace);
    await ask.locator('summary').click();
    await expect(ask).toContainText('you are signed out too');
    await Promise.all([
      page.waitForURL('/'),
      ask.getByTestId('settings-workspace-remove-confirm').click()
    ]);

    // Should redirect to landing page (logged out)
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });
});

test.describe('Workspace Limit', () => {
  test('at max workspaces, all are displayed', async ({ page, workerUrlKey, workerSuffix }) => {
    await page.goto(`/test/set-session?maxWorkspaces=true&urlKey=${workerUrlKey}`);
    // Use workspace-0's URL key for max workspaces test (per-worker suffixed)
    await page.goto(`/workspace/workspace-0${workerSuffix}/${MENU_PAGE}`);

    await page.locator(SELECTORS.nav.workspaceToggle).click();
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible();

    // Should show 10 workspaces + Linear +add + Jira +add + local +add = 13 rows
    await expect(railRows(page)).toHaveCount(13);
  });
});
