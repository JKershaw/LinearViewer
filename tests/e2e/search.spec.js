import { test, expect } from '../fixtures/test-base.js';
import { searchLocalSeed } from '../fixtures/local-harness.js';

// LIN-426: the search surface is fully modeled by the local provider (the search
// index reads title, description, assignee.name, identifier, and label names), so
// this spec rides a seeded local workspace instead of the `test-token` mock. The
// bespoke `searchLocalSeed` reuses the EXACT ids the selectors below already use
// (proj-alpha/beta, issue-1..5), so assertions stay byte-identical; it preserves
// assignee `{ name: 'Charlie' }` (issue-4) and label `urgent` for the assignee /
// label search cases, and the issue-2 → issue-1 parent link for the ancestor case.

test.describe('Search Feature', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(searchLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
  });

  test('search toggle shows and hides search panel', async ({ page }) => {
    const searchToggle = page.locator('.search-toggle');
    const searchPanel = page.locator('#search-panel');

    // Panel starts hidden
    await expect(searchPanel).toHaveClass(/hidden/);

    // Click to show
    await searchToggle.click();
    await expect(searchPanel).not.toHaveClass(/hidden/);

    // Input should be focused
    await expect(page.locator('#search-input')).toBeFocused();

    // Click again to hide
    await searchToggle.click();
    await expect(searchPanel).toHaveClass(/hidden/);
  });

  test('search filters issues by title keyword', async ({ page }) => {
    const searchToggle = page.locator('.search-toggle');
    const searchInput = page.locator('#search-input');

    await searchToggle.click();

    // Search for "Beta" - should match "Beta task in progress" and "Beta todo task"
    await searchInput.fill('Beta');

    // Beta project issues should be visible
    const betaProject = page.locator('.project[data-id="proj-beta"]');
    await expect(betaProject).toBeVisible();

    // Alpha project should be hidden (no matching issues)
    const alphaProject = page.locator('.project[data-id="proj-alpha"]');
    await expect(alphaProject).toHaveClass(/hidden/);
  });

  test('search is case-insensitive', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // Search lowercase for an uppercase-containing title
    await searchInput.fill('beta');

    // Beta project should still be visible
    const betaProject = page.locator('.project[data-id="proj-beta"]');
    await expect(betaProject).toBeVisible();
  });

  test('search matches assignee name', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // Search for assignee "Charlie" - assigned to Beta task in progress
    await searchInput.fill('charlie');

    // Beta project should be visible (Charlie is assigned to issue-4)
    const betaProject = page.locator('.project[data-id="proj-beta"]');
    await expect(betaProject).toBeVisible();
  });

  test('search matches label name', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // Search for label "urgent" - on Beta task in progress
    await searchInput.fill('urgent');

    const betaProject = page.locator('.project[data-id="proj-beta"]');
    await expect(betaProject).toBeVisible();
  });

  test('shows no results message for non-matching search', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    await searchInput.fill('xyznonexistent123');

    const noResults = page.locator('#search-no-results');
    await expect(noResults).not.toHaveClass(/hidden/);
    await expect(noResults).toContainText('no matching issues');
  });

  test('clear button restores full view', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // Search for something specific
    await searchInput.fill('Beta');

    // Alpha should be hidden
    const alphaProject = page.locator('.project[data-id="proj-alpha"]');
    await expect(alphaProject).toHaveClass(/hidden/);

    // Click clear
    await page.locator('#search-clear').click();

    // Panel should be hidden
    await expect(page.locator('#search-panel')).toHaveClass(/hidden/);

    // Alpha should be visible again
    await expect(alphaProject).not.toHaveClass(/hidden/);
  });

  test('Escape key closes search and restores view', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    await searchInput.fill('Beta');

    // Press Escape
    await searchInput.press('Escape');

    // Panel should be hidden
    await expect(page.locator('#search-panel')).toHaveClass(/hidden/);

    // Both projects should be visible
    await expect(page.locator('.project[data-id="proj-alpha"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('.project[data-id="proj-beta"]')).not.toHaveClass(/hidden/);
  });

  test('/ keyboard shortcut opens search', async ({ page }) => {
    const searchPanel = page.locator('#search-panel');
    await expect(searchPanel).toHaveClass(/hidden/);

    // Press "/" on the page body
    await page.keyboard.press('/');

    await expect(searchPanel).not.toHaveClass(/hidden/);
    await expect(page.locator('#search-input')).toBeFocused();
  });

  test('search shows ancestor nodes for matching child', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // "Child task todo" is a child of "Parent task in progress"
    await searchInput.fill('Child task');

    // The child node should be visible in the project section
    // (issue-2 may appear in multiple sections, so scope to .project)
    const alphaProject = page.locator('.project[data-id="proj-alpha"]');
    const childNode = alphaProject.locator('.node[data-id="issue-2"]');
    await expect(childNode).not.toHaveClass(/hidden/);

    // The parent node should also be visible (ancestor context)
    const parentNode = alphaProject.locator('.node[data-id="issue-1"]');
    await expect(parentNode).not.toHaveClass(/hidden/);
  });

  test('search filters in-progress section', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // "Parent task in progress" appears in the in-progress section
    await searchInput.fill('Parent task');

    const ipSection = page.locator('.in-progress-section');
    await expect(ipSection).not.toHaveClass(/hidden/);

    // Now search for something not in progress
    await searchInput.fill('Beta todo');
    await expect(ipSection).toHaveClass(/hidden/);
  });

  test('empty search restores view without closing panel', async ({ page }) => {
    await page.locator('.search-toggle').click();
    const searchInput = page.locator('#search-input');

    // Search to hide some items
    await searchInput.fill('Beta');
    await expect(page.locator('.project[data-id="proj-alpha"]')).toHaveClass(/hidden/);

    // Clear the input text (but don't click clear button)
    await searchInput.fill('');

    // Both projects should be visible again
    await expect(page.locator('.project[data-id="proj-alpha"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('.project[data-id="proj-beta"]')).not.toHaveClass(/hidden/);

    // Panel should still be open
    await expect(page.locator('#search-panel')).not.toHaveClass(/hidden/);
  });
});
