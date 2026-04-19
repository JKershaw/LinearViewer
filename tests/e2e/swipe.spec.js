import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SWIPE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swipe`;

test.describe('Swipe Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto(SWIPE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders swipe page with card', async ({ page }) => {
    // Should have a filter dropdown
    await expect(page.locator('.swipe-filter-select')).toBeVisible();

    // Should have a card with content
    await expect(page.locator('.swipe-card')).toBeVisible();

    // Should show card position counter (dots or text)
    await expect(page.locator('.swipe-counter')).toBeVisible();
  });

  test('displays task card with correct elements', async ({ page }) => {
    // Card should have status indicator
    await expect(page.locator('.swipe-card-status .state')).toBeVisible();

    // Card should have a title
    await expect(page.locator('.swipe-card-title')).toBeVisible();

    // Card should have a position indicator
    await expect(page.locator('.swipe-card-position')).toBeVisible();
  });

  test('arrow buttons navigate between cards', async ({ page }) => {
    // Get initial card position text
    const positionText = await page.locator('.swipe-card-position').textContent();

    // If there are multiple tasks, right arrow should advance
    if (!positionText.includes('1 / 1')) {
      const rightArrow = page.locator('.swipe-arrow-right');
      await expect(rightArrow).not.toBeDisabled();

      // Click right arrow
      await rightArrow.click();

      // Card position should update to show card 2
      await expect(page.locator('.swipe-card-position')).toContainText('2 /');

      // Left arrow should now be enabled
      await expect(page.locator('.swipe-arrow-left')).not.toBeDisabled();

      // Click left arrow to go back
      await page.locator('.swipe-arrow-left').click();
      await expect(page.locator('.swipe-card-position')).toContainText('1 /');
    }
  });

  test('left arrow is disabled on first card', async ({ page }) => {
    await expect(page.locator('.swipe-arrow-left')).toBeDisabled();
  });

  test('filter dropdown changes card set', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');
    const options = await select.locator('option').allTextContents();

    // Should have at least one filter option
    expect(options.length).toBeGreaterThan(0);

    // If there are multiple options, changing filter should reset to card 1
    if (options.length > 1) {
      // First navigate to card 2 if possible
      const rightArrow = page.locator('.swipe-arrow-right');
      if (!await rightArrow.isDisabled()) {
        await rightArrow.click();
      }

      // Select a different filter
      const secondOption = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(secondOption);

      // Card position should reset to 1
      const position = await page.locator('.swipe-card-position').textContent();
      expect(position).toMatch(/^1 \//);
    }
  });

  test('description accordion expands and collapses', async ({ page }) => {
    const descHeader = page.locator('.swipe-accordion-header[data-accordion="description"]');

    // Only test if current card has a description
    if (await descHeader.count() > 0) {
      const descBody = page.locator('.swipe-accordion-body[data-accordion-body="description"]');

      // Should start closed
      await expect(descBody).not.toHaveClass(/open/);

      // Click to open
      await descHeader.click();
      await expect(descBody).toHaveClass(/open/);
      await expect(descHeader).toHaveClass(/open/);

      // Click to close
      await descHeader.click();
      await expect(descBody).not.toHaveClass(/open/);
    }
  });

  test('prompt buttons are displayed after opening Prompts accordion', async ({ page }) => {
    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await expect(promptsHeader).toBeVisible();
    await promptsHeader.click();

    const promptBtns = page.locator('.swipe-prompt-btn');
    await expect(promptBtns.first()).toBeVisible();
  });

  test('keyboard navigation works', async ({ page }) => {
    const positionText = await page.locator('.swipe-card-position').textContent();

    if (!positionText.includes('1 / 1')) {
      // Press right arrow key
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.swipe-card-position')).toContainText('2 /');

      // Press left arrow key
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.swipe-card-position')).toContainText('1 /');
    }
  });

  test('swipe link appears in footer', async ({ page }) => {
    // The current page should show "swipe" as bold (current page)
    await expect(page.locator('.footer-current:has-text("swipe")')).toBeVisible();
  });

  test('swipe link appears in dashboard footer', async ({ page }) => {
    // Navigate to main dashboard
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Footer should have swipe link
    await expect(page.locator('.footer-action[href*="/swipe"]')).toBeVisible();
  });

  test('shows blocking relationship rows on cards', async ({ page }) => {
    // Navigate through cards to find one with blocking info
    // TEST-15 (Refactor auth) blocks TEST-14 (Add pagination)
    let foundBlocks = false;
    let foundBlocked = false;
    const maxCards = 15;

    for (let i = 0; i < maxCards; i++) {
      const blocksRow = page.locator('.swipe-meta-blocks');
      const blockedRow = page.locator('.swipe-meta-blocked');

      if (await blocksRow.isVisible()) {
        foundBlocks = true;
        await expect(blocksRow.locator('.swipe-card-meta-label')).toHaveText('Blocks');
        await expect(blocksRow.locator('.swipe-blocking-issue')).toBeVisible();
      }

      if (await blockedRow.isVisible()) {
        foundBlocked = true;
        await expect(blockedRow.locator('.swipe-card-meta-label')).toHaveText('Blocked by');
        await expect(blockedRow.locator('.swipe-blocking-issue')).toBeVisible();
      }

      if (foundBlocks && foundBlocked) break;

      const rightArrow = page.locator('.swipe-arrow-right');
      if (await rightArrow.isDisabled()) break;
      await rightArrow.click();
    }

    // Mock data has TEST-15 blocks TEST-14, so both should appear
    expect(foundBlocks).toBe(true);
    expect(foundBlocked).toBe(true);
  });

  test('shows parent/subtask relationship rows on cards', async ({ page }) => {
    // TEST-2 is a child of TEST-1 (parent/child relationship)
    // Navigate to TEST-2 which should show a "Parent" row
    await page.goto(`${SWIPE_URL}/TEST-2`);
    await page.waitForLoadState('networkidle');

    const parentRow = page.locator('.swipe-meta-parent');
    await expect(parentRow).toBeVisible();
    await expect(parentRow.locator('.swipe-card-meta-label')).toHaveText('Parent');
    const parentLink = parentRow.locator('a.swipe-relation-issue');
    await expect(parentLink).toHaveText('TEST-1');
    // Parent is in-progress, so link should have the in-progress colour class
    await expect(parentLink).toHaveClass(/swipe-relation-in-progress/);

    // Navigate to TEST-1 which should show a "Subtasks" row
    await parentLink.click();
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-1');

    const subtasksRow = page.locator('.swipe-meta-subtasks');
    await expect(subtasksRow).toBeVisible();
    await expect(subtasksRow.locator('.swipe-card-meta-label')).toHaveText('Subtasks');
    const subtaskLink = subtasksRow.locator('a.swipe-relation-issue');
    await expect(subtaskLink).toHaveText('TEST-2');
    // Subtask is todo, so link should have the todo colour class
    await expect(subtaskLink).toHaveClass(/swipe-relation-todo/);
  });

  test('project filter includes in-progress issues and starts on first todo', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');

    // Select "Project Alpha" filter
    const options = await select.locator('option').allTextContents();
    const alphaOption = options.find(o => o.includes('Project Alpha'));
    expect(alphaOption).toBeTruthy();

    // Count should include in-progress issues (3 started + 4 incomplete = 7)
    const match = alphaOption.match(/\((\d+)\)/);
    expect(match).toBeTruthy();
    expect(parseInt(match[1], 10)).toBe(7);

    await select.selectOption({ label: alphaOption });

    // Should NOT start on an in-progress card
    const stateClass = await page.locator('.swipe-card-status .state').getAttribute('class');
    expect(stateClass).not.toContain('in-progress');

    // Left arrow should be enabled (in-progress cards are before this one)
    await expect(page.locator('.swipe-arrow-left')).not.toBeDisabled();

    // Navigate backward to reach an in-progress card
    await page.locator('.swipe-arrow-left').click();
    const prevStateClass = await page.locator('.swipe-card-status .state').getAttribute('class');
    expect(prevStateClass).toContain('in-progress');
  });

  test('clicking subtask link navigates to that card', async ({ page }) => {
    // Load TEST-1 which has TEST-2 as a subtask
    await page.goto(`${SWIPE_URL}/TEST-1`);
    await page.waitForLoadState('networkidle');

    const subtaskLink = page.locator('.swipe-meta-subtasks a.swipe-relation-issue');
    await expect(subtaskLink).toHaveText('TEST-2');
    await subtaskLink.click();

    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-2');
    expect(page.url()).toContain('/swipe/TEST-2');
  });

  test('URL updates with task identifier when navigating', async ({ page }) => {
    // Start on a card with a known identifier
    await page.goto(`${SWIPE_URL}/TEST-15`);
    await page.waitForLoadState('networkidle');

    // URL should contain the identifier
    expect(page.url()).toContain('/swipe/TEST-15');

    // Navigate away and back — URL should update each time
    const rightArrow = page.locator('.swipe-arrow-right');
    if (!await rightArrow.isDisabled()) {
      await rightArrow.click();
      // URL should no longer point to TEST-15
      expect(page.url()).not.toContain('/swipe/TEST-15');
    }

    await page.locator('.swipe-arrow-left').click();
    expect(page.url()).toContain('/swipe/TEST-15');
  });

  test('deep-link URL loads specific card', async ({ page }) => {
    // Navigate directly to TEST-15 (session already set by beforeEach)
    await page.goto(`${SWIPE_URL}/TEST-15`);
    await page.waitForLoadState('networkidle');

    // Should display the TEST-15 card
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-15');
  });

  test('clicking blocking issue link navigates to that card', async ({ page }) => {
    // Load TEST-15 which blocks TEST-14 (session already set by beforeEach)
    await page.goto(`${SWIPE_URL}/TEST-15`);
    await page.waitForLoadState('networkidle');

    // Should see "Blocks" row with a clickable link
    const blocksRow = page.locator('.swipe-meta-blocks');
    await expect(blocksRow).toBeVisible();
    const link = blocksRow.locator('a.swipe-blocking-issue');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('TEST-14');

    // Click the link
    await link.click();

    // Should navigate to TEST-14 in-place
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-14');
    expect(page.url()).toContain('/swipe/TEST-14');
  });
});
