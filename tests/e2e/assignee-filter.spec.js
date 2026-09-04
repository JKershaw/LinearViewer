import { test, expect } from '../fixtures/test-base.js';
import { assigneeFilterLocalSeed, localSeedId } from '../fixtures/local-harness.js';
import { seedGitHubWorkspace, githubDashboardUrl } from '../fixtures/github-harness.js';

// LIN-2529: end-to-end proof that the dashboard assignee selector actually
// works over real data — the point Session B's server (LIN-2525/2526) and
// navbar (LIN-2527) plumbing finally gets wired into a live render
// (renderPage -> renderNavBar) and client click handling (LIN-2528) reaches.
//
// Local provider (assigneeFilterLocalSeed, LIN-2529 F7): local.viewer()
// returns the synthetic { name: 'Local User' } constant regardless of what's
// seeded, and the local provider's assignee field is an unvalidated
// passthrough — so `me` only exercises anything if an issue is actually
// seeded assignee: { name: 'Local User' }, which this fixture does.

test.describe('LIN-2529 — assignee filter (local provider, real `me` match)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(assigneeFilterLocalSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('the assignee selector renders, populated from the loaded issue set, `all` default, `me` present (local supports viewer)', async ({ page }) => {
    await expect(page.locator('#assignee-toggle')).toBeVisible();
    await expect(page.locator('#assignee-toggle')).toHaveText('all');

    await expect(page.locator('#assignee-options .nav-option[data-assignee="all"]')).toHaveClass(/selected/);
    await expect(page.locator('#assignee-options .nav-option[data-assignee="me"]')).toHaveCount(1);
    await expect(page.locator('#assignee-options .nav-option[data-assignee="Local User"]')).toHaveCount(1);
    await expect(page.locator('#assignee-options .nav-option[data-assignee="Other User"]')).toHaveCount(1);
  });

  test('choosing `me` from the panel navigates to ?assignee=me and stays on the dashboard', async ({ page, localWorkerUrlKey }) => {
    await page.locator('#assignee-toggle').click();
    await page.locator('#assignee-options .nav-option[data-assignee="me"]').click();

    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/\\?assignee=me$`));
    await expect(page.locator('#assignee-toggle')).toHaveText('me');
    await expect(page.locator('#assignee-options .nav-option[data-assignee="me"]')).toHaveClass(/selected/);
  });

  test('?assignee=me keeps a matched sub-issue\'s unmatched parent in place (ancestor context) and excludes unrelated assignees', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/?assignee=me`);
    await page.waitForLoadState('networkidle');

    // The unassigned parent is pulled in as ancestor context for its matched
    // child, in the PROJECT tree specifically (scoped past the separate Recent
    // Activity feed, which also surfaces newly-created issues by title and
    // would otherwise make these text locators ambiguous/strict-mode-fail).
    await expect(page.locator('.line[data-section="project"][data-identifier="FILT-1"]')).toBeVisible();
    // FILT-2 is nested under FILT-1 (depth 1) — attached but collapsed until
    // the parent is expanded, same convention as dashboard.spec.js's child-task
    // assertion.
    await expect(page.locator('.line[data-section="project"][data-identifier="FILT-2"]')).toBeAttached();

    // An unrelated assignee's issue, and an issue with no relation to any
    // match, are both excluded from the project tree.
    await expect(page.locator('.line[data-section="project"][data-identifier="FILT-5"]')).toHaveCount(0);
    await expect(page.locator('.line[data-section="project"][data-identifier="FILT-6"]')).toHaveCount(0);
  });

  test('?assignee=me — In Progress keeps a matched parent\'s subtasks (LIN-2525 seam ordering: assignee filter runs before buildInProgressForest)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/?assignee=me`);
    await page.waitForLoadState('networkidle');

    // Only the matched in-progress parent + its subtask reach the In Progress
    // section — the ancestor-context pair (Unassigned parent / Assigned child)
    // never reaches it since neither is "started".
    await expect(page.locator('.in-progress-items .line')).toHaveCount(2);
    await expect(page.locator('.in-progress-items .line:has-text("Assigned in-progress parent")')).toBeVisible();

    const childLine = page.locator('.in-progress-items .line:has-text("Unassigned in-progress subtask")');
    await expect(childLine).toHaveCount(1);
    const childNode = page.locator(`.in-progress-items .node[data-id="${localSeedId(localWorkerUrlKey, 'filter-ip-child')}"]`);
    await expect(childNode).toHaveClass(/hidden/); // depth > 0, collapsed until parent expands — same convention as dashboard.spec.js
  });

  test('?assignee=all shows every issue, unfiltered (both sentinels behave identically to absent)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/?assignee=all`);
    await page.waitForLoadState('networkidle');

    for (const identifier of ['FILT-1', 'FILT-2', 'FILT-3', 'FILT-5', 'FILT-6']) {
      await expect(page.locator(`.line[data-section="project"][data-identifier="${identifier}"]`)).toBeAttached();
    }
  });
});

// LIN-2529 AC2: a second spec on a NON-viewer-capable provider, confirming the
// `me` row is absent — proving the absence is gated on canFilterByMe, not on
// an empty assignees list (GitHub issue #1 carries assignee: {login:'octocat'},
// which the provider maps to canonical assignee.name — so `availableAssignees`
// is genuinely non-empty here; only `me` (provider.supports('viewer') === false
// for github) is gated off).
test.describe('LIN-2529 — `me` row absent on a non-`viewer`-capable provider (GitHub)', () => {
  test('the assignee selector renders with real data but no `me` row', async ({ page }) => {
    await seedGitHubWorkspace(page);
    await page.goto(githubDashboardUrl());
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#assignee-toggle')).toBeVisible();
    await expect(page.locator('#assignee-options .nav-option[data-assignee="octocat"]')).toHaveCount(1);
    await expect(page.locator('#assignee-options .nav-option[data-assignee="me"]')).toHaveCount(0);
  });
});
