import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// Periodicals feature (LIN-341): a synthetic, workspace-flag-gated group on the
// main workspace view containing the periodical template rows. The LIN-354 set
// is Documentation Review, Test Coverage Gap Review, Security Review, API
// Quality Review, and Code Quality Review. This spec keys only on the
// Documentation Review row and never asserts a total row count, so it is
// agnostic to the rest of the registry.

// Local-provider workspace seeded via /test/set-local-session (LIN-410). The
// Periodicals group is injected in buildDashboardData purely from the
// workspace-scoped `periodicals` flag, independent of which provider supplies
// the real issues/projects — so the local provider fully backs this surface.
// The `periodicals` flag is WORKSPACE-scoped (read from workspacePreferencesStore
// by urlKey), NOT a session feature — so it must be set through the
// workspace-feature route targeting THIS workspace's partition, not via
// seedLocal's session `features`. The urlKey must be threaded on both
// set and reset, or the flag lands on (or leaks into) the wrong partition.
async function setPeriodicalsFlag(page, urlKey, enabled) {
  const res = await page.goto(
    `/test/set-workspace-feature?key=periodicals&value=${enabled}&urlKey=${urlKey}`
  );
  expect(res.ok()).toBeTruthy();
}

test.describe('Periodicals group', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    // Isolate the dispatch queue so the queue-the-periodical test stays
    // deterministic against other specs sharing the local-workspace partition.
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
  });

  test.afterEach(async ({ page, localWorkerUrlKey }) => {
    // Reset so the flag never leaks into other specs sharing the store.
    await setPeriodicalsFlag(page, localWorkerUrlKey, false);
  });

  test('flag OFF: no Periodicals group, behaviour unchanged', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, false);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-project-type="periodicals"]')).toHaveCount(0);
    await expect(page.locator('.line:has-text("Documentation Review")')).toHaveCount(0);

    // Real projects still render (sanity: unchanged behaviour).
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible();
  });

  test('flag ON: distinct Periodicals group with a dispatchable Documentation Review row', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    await expect(group).toBeVisible();
    await expect(group.locator('.project-header:has-text("Periodicals")')).toBeVisible();

    // The single Documentation Review row.
    const row = group.locator('.line:has-text("Documentation Review")');
    await expect(row).toHaveCount(1);

    // Distinct colour hook resolves to the purple accent.
    const headerColor = await group.locator('.project-header').evaluate(
      el => getComputedStyle(el).color
    );
    // --purple: #7c3aed → rgb(124, 58, 237)
    expect(headerColor).toBe('rgb(124, 58, 237)');

    // Row is dispatchable: expand it and confirm its dispatch container is tagged
    // kind=periodical (no Linear add-task link inside the synthetic group). Scope
    // the count to this row's node — the group now holds more than one periodical.
    await row.click();
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    await expect(docNode.locator('[data-kind="periodical"]')).toHaveCount(1);
    await expect(group.locator('[data-action="create-task"]')).toHaveCount(0);
  });

  // LIN-345: the periodical row is issueless (no Linear issue backing it), so the
  // shared dispatch handler must opt out of the issue-link contract. Before the
  // fix, clicking dispatch threw `dispatchPrompt: issue with id and identifier is
  // required` (common.js) because the handler always built an `issue` object with
  // null fields and never passed `issueless: true`. The earlier test only asserts
  // the row *renders* a dispatch container — it never clicks dispatch, which is
  // why this regression slipped through. This test drives the real click path.
  test('flag ON: clicking dispatch on a Periodical actually queues it', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    // Scope to this row's node — the group now holds more than one periodical,
    // so group-wide locators for the disclosure/dispatch button are ambiguous.
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    const row = docNode.locator('.line:has-text("Documentation Review")');
    await row.click();

    // Open the dispatch disclosure, then dispatch to the cli target.
    await docNode.locator('.dispatch-disclosure').click();
    const dispatchBtn = docNode.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // The button reaches the success state (it showed "failed" before the fix).
    await expect(dispatchBtn).toHaveText('dispatched!');

    // The item lands on the workspace queue, issueless, tagged kind=periodical.
    const listResponse = await page.request.get(`/workspace/${localWorkerUrlKey}/api/dispatch`);
    const { items } = await listResponse.json();
    const periodicalItem = items.find(i => i.kind === 'periodical');
    expect(periodicalItem).toBeDefined();
    expect(periodicalItem.promptName).toBe('Documentation Review');
    expect(periodicalItem.issueIdentifier ?? null).toBeNull();
  });
});
