import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const CUSTOM_PROMPTS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/prompts/custom`;
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;
const API_BASE = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompts/custom`;
// UUID-format issue ID from mock data (issue-4 = "Beta task in progress", In Progress state)
const TEST_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Custom Prompts API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/test/clear-custom-prompts');
  });

  // =========================================================================
  // CRUD operations
  // =========================================================================

  test('GET returns empty array when no custom prompts exist', async ({ page }) => {
    const response = await page.request.get(API_BASE);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompts).toEqual([]);
  });

  test('POST creates a new custom prompt', async ({ page }) => {
    const response = await page.request.post(API_BASE, {
      data: { name: 'My Prompt', template: 'Help with {{title}}' }
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt.name).toBe('My Prompt');
    expect(data.prompt.template).toBe('Help with {{title}}');
    expect(data.prompt.id).toBeTruthy();
  });

  test('GET returns created prompts', async ({ page }) => {
    // Create two prompts
    await page.request.post(API_BASE, {
      data: { name: 'Prompt A', template: 'Template A' }
    });
    await page.request.post(API_BASE, {
      data: { name: 'Prompt B', template: 'Template B' }
    });

    const response = await page.request.get(API_BASE);
    const data = await response.json();
    expect(data.prompts).toHaveLength(2);
    expect(data.prompts[0].name).toBe('Prompt A');
    expect(data.prompts[1].name).toBe('Prompt B');
  });

  test('PUT updates an existing prompt', async ({ page }) => {
    // Create a prompt
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'Original', template: 'Original template' }
    });
    const { prompt } = await createRes.json();

    // Update it
    const updateRes = await page.request.put(`${API_BASE}/${prompt.id}`, {
      data: { name: 'Updated', template: 'Updated template' }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.prompt.name).toBe('Updated');
    expect(updated.prompt.template).toBe('Updated template');
    expect(updated.prompt.id).toBe(prompt.id);
  });

  test('DELETE removes a custom prompt', async ({ page }) => {
    // Create a prompt
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'To Delete', template: 'Bye' }
    });
    const { prompt } = await createRes.json();

    // Delete it
    const deleteRes = await page.request.delete(`${API_BASE}/${prompt.id}`);
    expect(deleteRes.ok()).toBeTruthy();

    // Verify it's gone
    const listRes = await page.request.get(API_BASE);
    const data = await listRes.json();
    expect(data.prompts).toHaveLength(0);
  });

  // =========================================================================
  // Validation
  // =========================================================================

  test('POST rejects missing name', async ({ page }) => {
    const response = await page.request.post(API_BASE, {
      data: { template: 'Some template' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST rejects missing template', async ({ page }) => {
    const response = await page.request.post(API_BASE, {
      data: { name: 'Some name' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST rejects name longer than 50 chars', async ({ page }) => {
    const response = await page.request.post(API_BASE, {
      data: { name: 'A'.repeat(51), template: 'Template' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST enforces max 20 custom prompts', async ({ page }) => {
    // Create 20 prompts
    for (let i = 0; i < 20; i++) {
      const res = await page.request.post(API_BASE, {
        data: { name: `Prompt ${i}`, template: `Template ${i}` }
      });
      expect(res.ok()).toBeTruthy();
    }

    // 21st should fail
    const response = await page.request.post(API_BASE, {
      data: { name: 'One too many', template: 'Template' }
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('maximum');
  });

  test('PUT returns 404 for non-existent prompt', async ({ page }) => {
    const response = await page.request.put(`${API_BASE}/nonexistent-id`, {
      data: { name: 'Updated', template: 'Updated' }
    });
    expect(response.status()).toBe(404);
  });

  test('DELETE returns 404 for non-existent prompt', async ({ page }) => {
    const response = await page.request.delete(`${API_BASE}/nonexistent-id`);
    expect(response.status()).toBe(404);
  });

  // =========================================================================
  // Prompt generation with variable substitution
  // =========================================================================

  test('generates prompt with variable substitution', async ({ page }) => {
    // Create a custom prompt with variables
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'My Custom', template: 'Work on {{title}} ({{identifier}})' }
    });
    const { prompt } = await createRes.json();

    // Generate the prompt for a specific issue
    const genRes = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    expect(genRes.ok()).toBeTruthy();
    const data = await genRes.json();
    expect(data.prompt).toContain('Work on');
    expect(data.prompt).toContain('Task needing preparation');
    expect(data.promptName).toBe('My Custom');
  });

  test('custom prompt respects linearMcp feature flag', async ({ page }) => {
    // Create a custom prompt mentioning Linear
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'Linear Test', template: 'Update the task in Linear with your findings' }
    });
    const { prompt } = await createRes.json();

    // With linearMcp ON (default), "in Linear" stays
    const onRes = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    const onData = await onRes.json();
    expect(onData.prompt).toContain('in Linear');

    // With linearMcp OFF
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ linearMcp: false }))}`);
    const offRes = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    const offData = await offRes.json();
    expect(offData.prompt).not.toContain('in Linear');
  });

  // =========================================================================
  // Auth
  // =========================================================================

  test('API returns 401 when not authenticated', async ({ page }) => {
    await page.goto('/test/clear-session');
    const response = await page.request.get(API_BASE);
    expect(response.status()).toBe(401);
  });
});

test.describe('Custom Prompts Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/test/clear-custom-prompts');
  });

  // =========================================================================
  // Page rendering
  // =========================================================================

  test('page loads with empty state', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Custom Prompts');
    await expect(page.locator('.custom-prompts-empty')).toBeVisible();
  });

  test('page shows nav bar with workspace', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.nav-bar')).toBeVisible();
  });

  // =========================================================================
  // Creating prompts via UI
  // =========================================================================

  test('can create a new prompt via the form', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    // Click new prompt button
    await page.locator('.custom-prompt-new-btn').click();

    // Fill in the form
    await page.locator('.custom-prompt-name-input').fill('Test Prompt');
    await page.locator('.custom-prompt-template-input').fill('Help with {{title}}');

    // Save
    await page.locator('.custom-prompt-save-btn').click();

    // Should show the prompt in the list
    await expect(page.locator('.custom-prompt-card')).toHaveCount(1);
    await expect(page.locator('.custom-prompt-card .custom-prompt-name')).toContainText('Test Prompt');
  });

  test('can edit an existing prompt', async ({ page }) => {
    // Create via API
    await page.request.post(API_BASE, {
      data: { name: 'Edit Me', template: 'Original' }
    });

    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    // Click edit button
    await page.locator('.custom-prompt-edit-btn').click();

    // Modify the name
    await page.locator('.custom-prompt-name-input').fill('Edited Name');

    // Save
    await page.locator('.custom-prompt-save-btn').click();

    // Should show updated name
    await expect(page.locator('.custom-prompt-card .custom-prompt-name')).toContainText('Edited Name');
  });

  test('can delete a prompt', async ({ page }) => {
    // Create via API
    await page.request.post(API_BASE, {
      data: { name: 'Delete Me', template: 'Bye' }
    });

    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.custom-prompt-card')).toHaveCount(1);

    // Click delete, confirm
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.custom-prompt-delete-btn').click();

    // Should be gone
    await expect(page.locator('.custom-prompt-card')).toHaveCount(0);
    await expect(page.locator('.custom-prompts-empty')).toBeVisible();
  });

  // =========================================================================
  // Variable reference
  // =========================================================================

  test('shows variable reference section', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    // Click new prompt to show editor
    await page.locator('.custom-prompt-new-btn').click();

    // Variable reference should be available
    await expect(page.locator('.variable-reference')).toBeVisible();
    await expect(page.locator('.variable-reference')).toContainText('{{title}}');
    await expect(page.locator('.variable-reference')).toContainText('{{identifier}}');
  });

  // =========================================================================
  // Validation in UI
  // =========================================================================

  test('save button disabled when name is empty', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('.custom-prompt-new-btn').click();

    // Only fill template, not name
    await page.locator('.custom-prompt-template-input').fill('Some template');

    await expect(page.locator('.custom-prompt-save-btn')).toBeDisabled();
  });

  test('save button disabled when template is empty', async ({ page }) => {
    await page.goto(CUSTOM_PROMPTS_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('.custom-prompt-new-btn').click();

    // Only fill name, not template
    await page.locator('.custom-prompt-name-input').fill('Some name');

    await expect(page.locator('.custom-prompt-save-btn')).toBeDisabled();
  });

  // =========================================================================
  // Settings link
  // =========================================================================

  test('settings page links to custom prompts', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    const link = page.locator('a[href*="/prompts/custom"]');
    await expect(link).toBeVisible();
  });
});

// ==========================================================================
// Custom Prompts on Dashboard
// ==========================================================================

test.describe('Custom Prompts on Dashboard', () => {
  const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/test/clear-custom-prompts');
  });

  test('custom prompt buttons appear in more section on dashboard', async ({ page }) => {
    // Create a custom prompt via API
    await page.request.post(API_BASE, {
      data: { name: 'My Dashboard Prompt', template: 'Analyze {{title}}' }
    });

    // Navigate to dashboard
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Click an issue to expand it
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // Click "more" to reveal hidden prompts
    const moreToggle = page.locator(`.in-progress-items .more-toggle[data-issue-id="${issueId}"]`);
    await moreToggle.click();

    // Custom prompt button should be visible with dashed border class
    const customBtn = page.locator(`.in-progress-items .custom-prompt-btn[data-issue-id="${issueId}"]`);
    await expect(customBtn).toBeVisible();
    await expect(customBtn).toHaveText('My Dashboard Prompt');
  });

  test('clicking custom prompt button generates prompt on dashboard', async ({ page }) => {
    // Create a custom prompt with a variable
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'Title Prompt', template: 'Work on: {{title}}' }
    });
    const { prompt } = await createRes.json();

    // Navigate to dashboard
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Click an issue to expand it
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // Click "more" to reveal hidden prompts
    const moreToggle = page.locator(`.in-progress-items .more-toggle[data-issue-id="${issueId}"]`);
    await moreToggle.click();

    // Click the custom prompt button (scoped to this issue's details)
    const customBtn = details.locator(`.label-prompt[data-label="custom:${prompt.id}"]`);
    await customBtn.click();

    // Wait for prompt to load in container
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${issueId}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Verify the prompt name shows
    await expect(promptContainer.locator('.prompt-name')).toHaveText('Title Prompt');

    // Verify variable substitution happened (contains "Work on:")
    await expect(promptContainer.locator('.prompt-text')).toContainText('Work on:');
  });

  test('no custom prompt buttons when none exist', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // Click "more" to reveal hidden prompts
    const moreToggle = page.locator(`.in-progress-items .more-toggle[data-issue-id="${issueId}"]`);
    await moreToggle.click();

    // No custom prompt buttons should exist
    const customBtns = page.locator(`.in-progress-items .custom-prompt-btn[data-issue-id="${issueId}"]`);
    await expect(customBtns).toHaveCount(0);
  });
});

// ==========================================================================
// Custom Prompts on Swipe Page
// ==========================================================================

test.describe('Custom Prompts on Swipe Page', () => {
  const SWIPE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swipe`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/test/clear-custom-prompts');
  });

  test('custom prompt buttons appear in more section on swipe page', async ({ page }) => {
    // Create a custom prompt via API
    await page.request.post(API_BASE, {
      data: { name: 'My Swipe Prompt', template: 'Review {{title}}' }
    });

    // Navigate to swipe page
    await page.goto(SWIPE_URL);
    await page.waitForLoadState('networkidle');

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // Custom prompt button should be visible
    const customBtn = page.locator('.swipe-prompt-btn.custom-prompt-btn');
    await expect(customBtn).toBeVisible();
    await expect(customBtn).toHaveText('My Swipe Prompt');
  });

  test('clicking custom prompt button generates prompt on swipe page', async ({ page }) => {
    // Create a custom prompt with a variable
    const createRes = await page.request.post(API_BASE, {
      data: { name: 'Swipe Title', template: 'Analyze: {{title}}' }
    });
    const { prompt } = await createRes.json();

    // Navigate to swipe page
    await page.goto(SWIPE_URL);
    await page.waitForLoadState('networkidle');

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // Click the custom prompt button
    const customBtn = page.locator(`.swipe-prompt-btn[data-prompt="custom:${prompt.id}"]`);
    await customBtn.click();

    // Wait for prompt result to load
    const promptResult = page.locator('#swipe-prompt-result');
    await expect(promptResult).not.toHaveClass(/hidden/, { timeout: 10000 });

    // Verify prompt name
    await expect(page.locator('#swipe-prompt-name')).toHaveText('Swipe Title');

    // Verify variable substitution
    await expect(page.locator('#swipe-prompt-text')).toContainText('Analyze:');
  });

  test('no custom prompt buttons when none exist on swipe page', async ({ page }) => {
    await page.goto(SWIPE_URL);
    await page.waitForLoadState('networkidle');

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // No custom prompt buttons should exist
    const customBtns = page.locator('.swipe-prompt-btn.custom-prompt-btn');
    await expect(customBtns).toHaveCount(0);
  });
});
