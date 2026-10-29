import { test, expect } from '../fixtures/test-base.js';
import { localSeedId, defaultLocalSeedWithUpNext } from '../fixtures/local-harness.js';

// LIN-378: the dashboard surface is fully modeled by the local provider, so this
// spec rides the seeded local workspace (no `test-token` mock). Assertions are
// derived from defaultLocalSeed (2 projects; an in-progress parent + todo child +
// completed issue in "Local Project"; a second in-progress task in "Local Beta").

test.describe('Authenticated Dashboard', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Seed a real local-provider workspace and establish its session. LIN-4024: one Up next task, so a project row shows.
    await seedLocal(defaultLocalSeedWithUpNext(localWorkerUrlKey));

    // Navigate to workspace page (authenticated users are redirected here)
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
  });

  test('renders project tree with issues', async ({ page }) => {
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Should show both seeded projects (names are substring-distinct)
    await expect(page.locator('.project-header:has-text("Local Project")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Local Beta")')).toBeVisible();
  });

  test('shows In Progress section with active issues', async ({ page, localWorkerUrlKey }) => {
    // Should have In Progress section header
    const inProgressHeader = page.locator('.in-progress-header');
    await expect(inProgressHeader).toBeVisible();
    await expect(inProgressHeader).toContainText('In Progress');

    // In Progress: local-issue-1 (started) and local-issue-4 (started) = 2 lines. LIN-4024: the child, local-issue-2,
    // is an unstarted task, so it folds under its started parent ("show 1 more") instead of listing here.
    await expect(page.locator('.in-progress-items .line')).toHaveCount(2);

    // Top-level started items are visible
    await expect(page.locator('.in-progress-items .line:has-text("Local parent task")')).toBeVisible();
    await expect(page.locator('.in-progress-items .line:has-text("Second project task")')).toBeVisible();

    // The child is folded under its parent, and not on the page until the fold opens.
    const childTask = page.locator('.in-progress-items .line:has-text("Local child task")');
    await expect(childTask).toHaveCount(0);
    await expect(page.locator('.in-progress-items [data-home-fetch="more-of-parent"]')).toHaveCount(1);
    await expect(page.locator(`.in-progress-items .node[data-id="${localSeedId(localWorkerUrlKey, 'local-issue-2')}"]`)).toHaveCount(0);
  });

  test('displays correct state indicators', async ({ page }) => {
    // LIN-850: tree-row status glyphs render through the shared status primitive as the box-less bare variant.
    // LIN-4024: each section says its own state. Recent activity lists the just-created tasks too, so the counts
    // below are scoped to the section that holds each row.

    // Started issues (local-issue-1, local-issue-4) are In Progress.
    await expect(page.locator('.in-progress-items .status-pill--bare.status-pill--in-progress')).toHaveCount(2);

    // The Up next task is a project row in Todo.
    await expect(page.locator('.line[data-section="project"] .status-pill--bare.status-pill--todo')).toHaveCount(1);

    // The completed task is not a row in any project: Home counts it on its project instead.
    await expect(page.locator('.line[data-section="project"] .status-pill--bare.status-pill--done')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-done-count"]').first()).toContainText('1 done');
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

  test('shows footer with reset and deploy info, and header nav with view links', async ({ page, localWorkerUrlKey }) => {
    // Footer should be visible
    await expect(page.locator('.page-footer')).toBeVisible();

    // Reset (a client action, not a view link) stays in the footer
    await expect(page.locator('.footer-action.reset-view')).toBeVisible();

    // Cross-view links were hoisted into the shared header switcher (LIN-978).
    await expect(page.locator(`.nav-views [data-testid="nav-view-settings"][href="/workspace/${localWorkerUrlKey}/settings"]`)).toBeVisible();
    await expect(page.locator(`.nav-views [data-testid="nav-view-swim"][href="/workspace/${localWorkerUrlKey}/swim"]`)).toBeVisible();

    // The footer no longer carries any view links.
    await expect(page.locator('.footer-actions [data-testid^="footer-link-"]')).toHaveCount(0);

    // No bold current page indicator in the footer. In the header, the dashboard
    // route IS the projects view (LIN-1088), so its tab — and only its tab —
    // carries the "current" state; the other view links stay plain anchors.
    await expect(page.locator('.footer-current')).not.toBeVisible();
    await expect(page.locator('.nav-view-current')).toHaveCount(1);
    await expect(page.locator('[data-testid="nav-view-projects"].nav-view-current')).toBeVisible();

    // Should have deploy info section with GitHub link (fallback in test mode)
    await expect(page.locator('.footer-deploy')).toBeVisible();
    await expect(page.locator('.footer-link')).toBeVisible();
  });

  test('shows organization name from the local provider', async ({ page }) => {
    // The h1 should contain the provider's organization name (the local provider
    // reports "Local"), not the landing page title "Harbour".
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).not.toContainText('Harbour');
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
