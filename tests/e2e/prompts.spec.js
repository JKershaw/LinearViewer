import { test, expect } from '@playwright/test';

// UUID for the test issue with needs-breakdown label
const BREAKDOWN_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Promptable Labels', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session
    await page.goto('/test/set-session');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders needs-breakdown label as clickable link', async ({ page }) => {
    // Find the task with needs-breakdown label and expand it (in project section, not in-progress)
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // Find the label link in the details
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await expect(labelLink).toBeVisible();
    await expect(labelLink).toHaveText('needs-breakdown');
  });

  test('regular labels are not clickable', async ({ page }) => {
    // Find the task with feature label in project section (not in-progress section)
    const taskLine = page.locator('.project .line[data-id="issue-1"]');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // The feature label should be text, not a link
    const details = page.locator('.project .details[data-details-for="issue-1"]');
    await expect(details).toBeVisible();

    // Feature should appear as plain text, not as a .label-prompt link
    const labelLink = details.locator('.label-prompt[data-label="feature"]');
    await expect(labelLink).toHaveCount(0);

    // But feature text should appear in metadata
    await expect(details.locator('.detail-meta')).toContainText('feature');
  });

  test('clicking promptable label shows prompt container', async ({ page }) => {
    // Find and expand the task with needs-breakdown label
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load (not showing "Loading...")
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Should show prompt name
    const promptName = promptContainer.locator('.prompt-name');
    await expect(promptName).toContainText('Task Breakdown');

    // Should show prompt text
    const promptText = promptContainer.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    await expect(promptText).toContainText('Linear MCP');
  });

  test('prompt contains issue context', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for prompt to load
    const promptText = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"] .prompt-text`);
    await expect(promptText).not.toContainText('Loading', { timeout: 10000 });

    // Prompt should contain the task title
    await expect(promptText).toContainText('Task needing breakdown');
  });

  test('clicking label again hides prompt container', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label to show
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for container to appear
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Click again to hide
    await labelLink.click();
    await expect(promptContainer).toBeHidden();
  });

  test('copy button copies prompt text', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Click copy button
    const copyButton = promptContainer.locator('.prompt-copy');
    await copyButton.click();

    // Button should show "copied!"
    await expect(copyButton).toHaveText('copied!');

    // Button should revert after a delay
    await expect(copyButton).toHaveText('copy', { timeout: 3000 });
  });

  test('prompt container has correct structure', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for container and prompt to load
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Should have header with name and copy button
    await expect(promptContainer.locator('.prompt-header')).toBeVisible();
    await expect(promptContainer.locator('.prompt-name')).toBeVisible();
    await expect(promptContainer.locator('.prompt-copy')).toBeVisible();

    // Should have prompt text
    await expect(promptContainer.locator('.prompt-text')).toBeVisible();
  });
});

test.describe('Prompt API', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session
    await page.goto('/test/set-session');
  });

  test('returns 401 for unauthenticated requests', async ({ page }) => {
    // Clear session
    await page.goto('/test/clear-session');

    // Try to fetch prompt (use valid UUID format)
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/needs-breakdown`);
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Not authenticated');
  });

  test('returns 404 for unknown label', async ({ page }) => {
    // Use valid UUID format so we get to the label check
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/unknown-label`);
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('No prompt template');
  });

  test('returns 400 for invalid issue ID format', async ({ page }) => {
    const response = await page.request.get('/api/prompt/invalid-id/needs-breakdown');
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid issue ID format');
  });

  test('returns prompt for valid request', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/needs-breakdown`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-breakdown');
    expect(body.promptName).toBe('Task Breakdown');
    expect(body.prompt).toContain('Linear MCP');
  });
});
