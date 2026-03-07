import { test, expect } from '@playwright/test';

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

    // Should show card position counter
    await expect(page.locator('.swipe-counter')).toBeVisible();
    await expect(page.locator('.swipe-counter')).not.toHaveText('No tasks');
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
    // Get initial counter text
    const counterText = await page.locator('.swipe-counter').textContent();

    // If there are multiple tasks, right arrow should advance
    if (!counterText.includes('1 of 1')) {
      const rightArrow = page.locator('.swipe-arrow-right');
      await expect(rightArrow).not.toBeDisabled();

      // Click right arrow
      await rightArrow.click();

      // Counter should update
      await expect(page.locator('.swipe-counter')).toContainText('2 of');

      // Left arrow should now be enabled
      await expect(page.locator('.swipe-arrow-left')).not.toBeDisabled();

      // Click left arrow to go back
      await page.locator('.swipe-arrow-left').click();
      await expect(page.locator('.swipe-counter')).toContainText('1 of');
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

      // Counter should reset
      const counter = await page.locator('.swipe-counter').textContent();
      expect(counter).toMatch(/^(1 of \d+|No tasks)$/);
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

  test('prompt buttons are displayed', async ({ page }) => {
    // Should have prompt buttons
    const promptBtns = page.locator('.swipe-prompt-btn');
    await expect(promptBtns.first()).toBeVisible();
  });

  test('keyboard navigation works', async ({ page }) => {
    const counterText = await page.locator('.swipe-counter').textContent();

    if (!counterText.includes('1 of 1')) {
      // Press right arrow key
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.swipe-counter')).toContainText('2 of');

      // Press left arrow key
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.swipe-counter')).toContainText('1 of');
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
});
