import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js';

// LIN-378: the dashboard surface is fully modeled by the local provider, so this
// spec rides the seeded local workspace (no `test-token` mock). Assertions are
// derived from defaultLocalSeed (2 projects; an in-progress parent + todo child +
// completed issue in "Local Project"; a second in-progress task in "Local Beta").
const TEST_WORKSPACE_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

test.describe('Authenticated Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Seed a real local-provider workspace and establish its session.
    await seedLocalWorkspace(page);

    // Navigate to workspace page (authenticated users are redirected here)
    await page.goto(WORKSPACE_URL);
  });

  test('renders project tree with issues', async ({ page }) => {
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Should show both seeded projects (names are substring-distinct)
    await expect(page.locator('.project-header:has-text("Local Project")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Local Beta")')).toBeVisible();
  });

  test('shows In Progress section with active issues', async ({ page }) => {
    // Should have In Progress section header
    const inProgressHeader = page.locator('.in-progress-header');
    await expect(inProgressHeader).toBeVisible();
    await expect(inProgressHeader).toContainText('In Progress');

    // In-progress trees: local-issue-1 (started) + its child local-issue-2 (todo,
    // hidden) + local-issue-4 (started) = 3 lines total.
    await expect(page.locator('.in-progress-items .line')).toHaveCount(3);

    // Top-level started items are visible
    await expect(page.locator('.in-progress-items .line:has-text("Local parent task")')).toBeVisible();
    await expect(page.locator('.in-progress-items .line:has-text("Second project task")')).toBeVisible();

    // Child task exists but is hidden (depth > 0) until parent is expanded.
    // Note: hidden class is on the .node wrapper, not the .line.
    const childTask = page.locator('.in-progress-items .line:has-text("Local child task")');
    await expect(childTask).toHaveCount(1);
    const childNode = page.locator('.in-progress-items .node[data-id="local-issue-2"]');
    await expect(childNode).toHaveClass(/hidden/);
  });

  test('displays correct state indicators', async ({ page }) => {
    // Started issues (local-issue-1, local-issue-4) each appear 2x: once in the
    // In Progress section and once in their project section → 2 x 2 = 4.
    await expect(page.locator('.state.in-progress')).toHaveCount(4);

    // Todo issue (local-issue-2) appears 2x: In Progress subtree + project tree.
    await expect(page.locator('.state.todo')).toHaveCount(2);

    // Completed issue (local-issue-3) renders once in the completed section.
    await expect(page.locator('.state.done')).toHaveCount(1);
  });

  test('shows text-based navigation bar', async ({ page }) => {
    // Should have nav bar
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Logout should NOT be in nav bar (moved to settings page)
    await expect(page.locator('.nav-action[href="/logout"]')).not.toBeVisible();

    // Reset and audit should NOT be in nav bar
    await expect(page.locator('.nav-bar .reset-view')).not.toBeVisible();
    await expect(page.locator('.nav-bar .nav-action[href="/audit"]')).not.toBeVisible();
  });

  test('shows footer with reset, all navigation links, and deploy info', async ({ page }) => {
    // Footer should be visible
    await expect(page.locator('.page-footer')).toBeVisible();

    // Should have reset link in footer
    await expect(page.locator('.footer-action.reset-view')).toBeVisible();

    // Should have all navigation links with workspace prefix (dashboard has no "current page" so all are links)
    await expect(page.locator(`.footer-action[href="/workspace/${TEST_WORKSPACE_URL_KEY}/settings"]`)).toBeVisible();
    await expect(page.locator(`.footer-action[href="/workspace/${TEST_WORKSPACE_URL_KEY}/swim"]`)).toBeVisible();

    // Should NOT have any bold current page indicator on dashboard
    await expect(page.locator('.footer-current')).not.toBeVisible();

    // Should have deploy info section with GitHub link (fallback in test mode)
    await expect(page.locator('.footer-deploy')).toBeVisible();
    await expect(page.locator('.footer-link')).toBeVisible();
  });

  test('shows organization name from the local provider', async ({ page }) => {
    // The h1 should contain the provider's organization name (the local provider
    // reports "Local"), not the landing page title "Linear Projects Viewer".
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).not.toContainText('Linear Projects Viewer');
  });

  test('renders CSS-based tree structure', async ({ page }) => {
    // Tree structure is now rendered with CSS pseudo-elements instead of box-drawing characters
    // Verify the .tree container exists and contains nodes
    const treeContainer = page.locator('.project .tree');
    await expect(treeContainer.first()).toBeVisible();

    // Verify nodes are inside tree container
    const nodesInTree = page.locator('.project .tree > .node');
    await expect(nodesInTree.first()).toBeVisible();

    // Verify the node has padding-left for indentation (applied by CSS)
    const nodeStyle = await nodesInTree.first().evaluate(el => getComputedStyle(el).paddingLeft);
    expect(parseFloat(nodeStyle)).toBeGreaterThan(0);
  });
});
