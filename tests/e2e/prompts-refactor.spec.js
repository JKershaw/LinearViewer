import { test, expect } from '@playwright/test';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const DISPATCH_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/dispatch`;

test.describe('Research Prompt Refactoring Instructions', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session with mock data
    await page.goto('/test/set-session');
  });

  test('research prompt includes refactor logic in the UI preview', async ({ page }) => {
    await page.goto(DISPATCH_URL);

    // Find a "research" button to select the template
    const researchButton = page.locator('button:has-text("research")').first();
    await researchButton.click();

    // The prompt preview should appear
    const promptPreview = page.locator('.prompt-preview');
    await expect(promptPreview).toBeVisible();

    const promptText = await promptPreview.innerText();

    // Verify the presence of the new refactoring requirements
    expect(promptText).toMatch(/Refactor Identification/i);
    expect(promptText).toMatch(/Refactoring recommendations/i);
    
    // Verify it's part of the "Workflow" section
    const workflowSection = page.locator('.prompt-preview:has-text("Workflow")');
    await expect(workflowSection).toContainText(/refactor/i);
  });
});