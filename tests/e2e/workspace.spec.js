import { test, expect } from '../fixtures/test-base.js';

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
  WORKSPACE_URL = `/workspace/${workerUrlKey}/`;
});

test.describe('Workspace Selector', () => {
  test('single workspace shows in selector', async ({ page, seedLocal }) => {
    const { dashboard } = await seedLocal();
    await page.goto(dashboard);

    const workspaceToggle = page.locator('#workspace-toggle');
    await expect(workspaceToggle).toBeVisible();
    await expect(workspaceToggle).toHaveText('Local Workspace');

    // Click to open options
    await workspaceToggle.click();

    const workspaceOptions = page.locator('#workspace-options');
    await expect(workspaceOptions).toBeVisible();

    // Should show workspace rows (1 workspace + Linear +add + local +add row).
    // The local-create row is always present (LIN-377), independent of OAuth/PAT.
    await expect(workspaceOptions.locator('.nav-options-row')).toHaveCount(3);
    await expect(workspaceOptions.locator('.nav-option-add')).toContainText('+add');
    await expect(workspaceOptions.locator('.nav-option-add-local')).toContainText('+local workspace');
  });

  test('multiple workspaces show in selector', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    const workspaceToggle = page.locator('#workspace-toggle');
    await workspaceToggle.click();

    const workspaceOptions = page.locator('#workspace-options');
    await expect(workspaceOptions).toBeVisible();

    // Should show 2 workspaces + Linear +add + local +add option
    const options = workspaceOptions.locator('.nav-options-row');
    await expect(options).toHaveCount(4); // 2 workspaces + Linear +add + local +add

    // First workspace should be selected (has ● marker)
    await expect(workspaceOptions.locator('.nav-option.selected')).toContainText('Test Workspace');
  });

  test('clicking outside closes workspace selector', async ({ page, seedLocal }) => {
    const { dashboard } = await seedLocal();
    await page.goto(dashboard);

    const workspaceToggle = page.locator('#workspace-toggle');
    await workspaceToggle.click();

    await expect(page.locator('#workspace-options')).toBeVisible();

    // Click outside (on the header)
    await page.locator('header').click();

    await expect(page.locator('#workspace-options')).toHaveClass(/hidden/);
  });
});

test.describe('Workspace Switching', () => {
  test('can switch to second workspace', async ({ page, workerUrlKey, secondWorkerUrlKey }) => {
    // Set up multiWorkspace session
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    // Initially showing first workspace
    await expect(page.locator('#workspace-toggle')).toHaveText('Test Workspace');

    // Open workspace selector
    await page.locator('#workspace-toggle').click();
    await expect(page.locator('#workspace-options')).toBeVisible();

    // Click the second workspace and wait for navigation to the new workspace URL
    await Promise.all([
      page.waitForURL(`/workspace/${secondWorkerUrlKey}/`),
      page.getByRole('option', { name: /Second Workspace/ }).click()
    ]);

    // Force a reload to bypass any caching issues
    await page.reload();

    // Should now show second workspace
    await expect(page.locator('#workspace-toggle')).toHaveText('Second Workspace');
  });

  test('switching workspace from settings stays on settings', async ({ page, workerUrlKey, secondWorkerUrlKey }) => {
    // Set up multiWorkspace session
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/settings`);

    // Verify we're on settings page
    await expect(page.locator('h1')).toHaveText('Settings');

    // Open workspace selector
    await page.locator('#workspace-toggle').click();
    await expect(page.locator('#workspace-options')).toBeVisible();

    // Click the second workspace and wait for navigation to settings in new workspace
    await Promise.all([
      page.waitForURL(`/workspace/${secondWorkerUrlKey}/settings`),
      page.getByRole('option', { name: /Second Workspace/ }).click()
    ]);

    // Should still be on settings page
    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('#workspace-toggle')).toHaveText('Second Workspace');
  });
});

test.describe('Workspace Removal', () => {
  test('remove button appears on active workspace', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    await page.locator('#workspace-toggle').click();

    // Remove button should be visible next to active workspace
    const removeButton = page.locator('#workspace-options .nav-option-danger');
    await expect(removeButton).toBeVisible();
    await expect(removeButton).toHaveText('remove');
  });

  test('removing last workspace logs out', async ({ page, workerUrlKey }) => {
    // Single workspace
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    await page.locator('#workspace-toggle').click();

    // Set up dialog handler for confirmation
    page.on('dialog', dialog => dialog.accept());

    // Click remove and wait for redirect to landing page
    await Promise.all([
      page.waitForURL('/'),
      page.locator('#workspace-options .nav-option-danger').click()
    ]);

    // Should redirect to landing page (logged out)
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  // Note: Testing the full removal flow with multiple workspaces is flaky due to
  // form submission timing. We test single workspace removal (logs out) and
  // verify remove button exists for multi-workspace setups.
  test('remove button exists for multi-workspace setup', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${workerUrlKey}`);
    await page.goto(WORKSPACE_URL);

    await page.locator('#workspace-toggle').click();
    await expect(page.locator('#workspace-options')).toBeVisible();

    // Remove button should be present
    const removeButton = page.locator('#workspace-options .nav-option-danger');
    await expect(removeButton).toBeVisible();
    await expect(removeButton).toHaveText('remove');
  });
});

test.describe('Workspace Limit', () => {
  test('at max workspaces, all are displayed', async ({ page, workerUrlKey, workerSuffix }) => {
    await page.goto(`/test/set-session?maxWorkspaces=true&urlKey=${workerUrlKey}`);
    // Use workspace-0's URL key for max workspaces test (per-worker suffixed)
    await page.goto(`/workspace/workspace-0${workerSuffix}/`);

    await page.locator('#workspace-toggle').click();

    const workspaceOptions = page.locator('#workspace-options');
    await expect(workspaceOptions).toBeVisible();

    // Should show 10 workspaces + Linear +add + local +add = 12 rows
    const options = workspaceOptions.locator('.nav-options-row');
    await expect(options).toHaveCount(12);
  });
});
