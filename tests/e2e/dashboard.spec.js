import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';
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

  test('renders project tree with issues', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Should show both seeded projects (names are substring-distinct)
    await expect(page.locator('.project-header:has-text("Local Project")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Local Beta")')).toBeVisible();
  });

  test('shows the Running and recently moved section with active issues', async ({ page, localWorkerUrlKey }) => {
    // LIN-4113: Home's first section is "Running and recently moved" (the In Progress view, then the recent block).
    const inProgressHeader = page.locator('.running-header');
    await expect(inProgressHeader).toBeVisible();
    await expect(inProgressHeader).toContainText('Running and recently moved');

    // In Progress: local-issue-1 (started) and local-issue-4 (started) = 2 lines. LIN-4024: the child, local-issue-2,
    // is an unstarted task, so it folds under its started parent ("show 1 more") instead of listing here.
    // LIN-4117: the child is the top task, so it is In Progress under its parent (not folded). It is hidden until the
    // parent opens, and the parent has no fold left: the top task is its only open child.
    await expect(page.locator('.running-items .line')).toHaveCount(3);

    // Top-level started items are visible
    await expect(page.locator('.running-items .line:has-text("Local parent task")')).toBeVisible();
    await expect(page.locator('.running-items .line:has-text("Second project task")')).toBeVisible();

    const childTask = page.locator('.running-items .line:has-text("Local child task")');
    await expect(childTask).toHaveCount(1);
    await expect(childTask).toBeHidden();
    await expect(page.locator('.running-items [data-home-fetch="more-of-parent"]')).toHaveCount(0);
    await expect(page.locator(`.running-items .node[data-id="${localSeedId(localWorkerUrlKey, 'local-issue-2')}"]`)).toHaveCount(1);
  });

  test('displays correct state indicators', async ({ page, localWorkerUrlKey }) => {
    // LIN-850: tree-row status glyphs render through the shared status primitive as the box-less bare variant.
    // LIN-4024: each section says its own state. Recent activity lists the just-created tasks too, so the counts
    // below are scoped to the section that holds each row.

    // Started issues (local-issue-1, local-issue-4) are In Progress. In Progress is Home's, so this is read there.
    await expect(page.locator('.running-items .status-pill--bare.status-pill--in-progress')).toHaveCount(2);

    // LIN-4119: the project rows and their done count are the backlog page's.
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await page.waitForLoadState('networkidle');

    // The Up next task is a project row in Todo.
    await expect(page.locator('.line[data-section="project"] .status-pill--bare.status-pill--todo')).toHaveCount(1);

    // The completed task is not a row in any project: Home counts it on its project instead.
    await expect(page.locator('.line[data-section="project"] .status-pill--bare.status-pill--done')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-done-count"]').first()).toContainText('1 done');
  });

  // LIN-4563: Home sits in the frame: the rail, not the bar; the frame's footer; reset on the Backlog page.
  test('shows the rail with Home marked, and no logout, reset or audit in it', async ({ page }) => {
    await expect(page.locator(SELECTORS.nav.rail)).toBeVisible();
    await expect(page.locator(SELECTORS.nav.railMarked)).toHaveAttribute('data-place', 'home');

    // Logout is on the Settings page; reset is Backlog's; audit is reached from Settings.
    await expect(page.locator(`${SELECTORS.nav.rail} a[href="/logout"]`)).toHaveCount(0);
    await expect(page.locator(`${SELECTORS.nav.rail} .reset-view`)).toHaveCount(0);
    await expect(page.locator(`${SELECTORS.nav.rail} a[href$="/audit"]`)).toHaveCount(0);
  });

  test('shows the frame footer with the deploy stamp, the rail with view links, and reset on the Backlog page', async ({ page, localWorkerUrlKey }) => {
    await expect(page.locator(SELECTORS.nav.footer)).toBeVisible();
    await expect(page.locator('.page-footer')).toHaveCount(0);

    // The places are the rail's.
    await expect(page.locator(`${SELECTORS.nav.place('settings')}[href="/workspace/${localWorkerUrlKey}/settings"]`)).toBeVisible();
    await expect(page.locator(`${SELECTORS.nav.place('swim')}[href="/workspace/${localWorkerUrlKey}/swim"]`)).toBeVisible();

    // Reset is not on Home; it is in the Backlog page's control line, next to the folds it resets.
    await expect(page.locator('.reset-view')).toHaveCount(0);
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await expect(page.locator('[data-testid="backlog-controls"] [data-testid="backlog-reset"]')).toBeVisible();
    await expect(page.locator(`${SELECTORS.nav.footer} .reset-view`)).toHaveCount(0);

    // The footer's source link (the deploy stamp only when the deploy says what it is).
    await expect(page.locator('[data-testid="frame-footer-source"]')).toBeVisible();
  });

  test('shows organization name from the local provider', async ({ page }) => {
    // LIN-4563: Home's h1 is the page's name; the workspace (the local provider's organization) names the tab.
    const h1 = page.locator('h1');
    await expect(h1).toHaveText('Home');
    await expect(page).toHaveTitle(/^Home · /);
    await expect(page).not.toHaveTitle(/Harbour/);
  });

  test('renders CSS-based tree structure', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
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
