import { test, expect } from '../fixtures/test-base.js';

// Periodicals feature (LIN-341): a synthetic, workspace-flag-gated group on the
// main workspace view containing the periodical template rows. The LIN-354 set
// is Documentation Review, Test Coverage Gap Review, Security Review, API
// Quality Review, and Code Quality Review. This spec keys only on the
// Documentation Review row and never asserts a total row count, so it is
// agnostic to the rest of the registry.

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

async function setPeriodicalsFlag(page, enabled) {
  const res = await page.goto(`/test/set-workspace-feature?key=periodicals&value=${enabled}`);
  expect(res.ok()).toBeTruthy();
}

test.describe('Periodicals group', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test.afterEach(async ({ page }) => {
    // Reset so the flag never leaks into other specs sharing the store.
    await setPeriodicalsFlag(page, false);
  });

  test('flag OFF: no Periodicals group, behaviour unchanged', async ({ page }) => {
    await setPeriodicalsFlag(page, false);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-project-type="periodicals"]')).toHaveCount(0);
    await expect(page.locator('.line:has-text("Documentation Review")')).toHaveCount(0);

    // Real projects still render (sanity: unchanged behaviour).
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible();
  });

  test('flag ON: distinct Periodicals group with a dispatchable Documentation Review row', async ({ page }) => {
    await setPeriodicalsFlag(page, true);
    await page.goto(WORKSPACE_URL);
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
  test('flag ON: clicking dispatch on a Periodical actually queues it', async ({ page }) => {
    await setPeriodicalsFlag(page, true);
    await page.goto(WORKSPACE_URL);
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
    const listResponse = await page.request.get(`${WORKSPACE_URL}api/dispatch`);
    const { items } = await listResponse.json();
    const periodicalItem = items.find(i => i.kind === 'periodical');
    expect(periodicalItem).toBeDefined();
    expect(periodicalItem.promptName).toBe('Documentation Review');
    expect(periodicalItem.issueIdentifier ?? null).toBeNull();
  });
});
