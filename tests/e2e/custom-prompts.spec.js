import { test, expect } from '../fixtures/test-base.js';
import {
  workspaceApiLocalSeed,
} from '../fixtures/local-harness.js';

// TEST-6 "Task needing preparation" — present in workspaceApiLocalSeed (shares
// the pipeline fixture identity), so prompt-generation assertions resolve
// unchanged on the local provider.
const TEST_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Custom Prompts API', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.request.get(`/test/clear-custom-prompts?urlKey=${localWorkerUrlKey}`);
  });

  // =========================================================================
  // CRUD operations
  // =========================================================================

  test('GET returns empty array when no custom prompts exist', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompts/custom`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompts).toEqual([]);
  });

  test('POST creates a new custom prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'My Prompt', template: 'Help with {{title}}' }
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt.name).toBe('My Prompt');
    expect(data.prompt.template).toBe('Help with {{title}}');
    expect(data.prompt.id).toBeTruthy();
  });

  test('GET returns created prompts', async ({ page, localWorkerUrlKey }) => {
    // Create two prompts
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Prompt A', template: 'Template A' }
    });
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Prompt B', template: 'Template B' }
    });

    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompts/custom`);
    const data = await response.json();
    expect(data.prompts).toHaveLength(2);
    expect(data.prompts[0].name).toBe('Prompt A');
    expect(data.prompts[1].name).toBe('Prompt B');
  });

  test('PUT updates an existing prompt', async ({ page, localWorkerUrlKey }) => {
    // Create a prompt
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Original', template: 'Original template' }
    });
    const { prompt } = await createRes.json();

    // Update it
    const updateRes = await page.request.put(`/workspace/${localWorkerUrlKey}/api/prompts/custom/${prompt.id}`, {
      data: { name: 'Updated', template: 'Updated template' }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.prompt.name).toBe('Updated');
    expect(updated.prompt.template).toBe('Updated template');
    expect(updated.prompt.id).toBe(prompt.id);
  });

  test('DELETE removes a custom prompt', async ({ page, localWorkerUrlKey }) => {
    // Create a prompt
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'To Delete', template: 'Bye' }
    });
    const { prompt } = await createRes.json();

    // Delete it
    const deleteRes = await page.request.delete(`/workspace/${localWorkerUrlKey}/api/prompts/custom/${prompt.id}`);
    expect(deleteRes.ok()).toBeTruthy();

    // Verify it's gone
    const listRes = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompts/custom`);
    const data = await listRes.json();
    expect(data.prompts).toHaveLength(0);
  });

  // =========================================================================
  // Validation
  // =========================================================================

  test('POST rejects missing name', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { template: 'Some template' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST rejects missing template', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Some name' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST rejects name longer than 50 chars', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'A'.repeat(51), template: 'Template' }
    });
    expect(response.status()).toBe(400);
  });

  test('POST enforces max 20 custom prompts', async ({ page, localWorkerUrlKey }) => {
    // Create 20 prompts
    for (let i = 0; i < 20; i++) {
      const res = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
        data: { name: `Prompt ${i}`, template: `Template ${i}` }
      });
      expect(res.ok()).toBeTruthy();
    }

    // 21st should fail
    const response = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'One too many', template: 'Template' }
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('maximum');
  });

  test('PUT returns 404 for non-existent prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.put(`/workspace/${localWorkerUrlKey}/api/prompts/custom/nonexistent-id`, {
      data: { name: 'Updated', template: 'Updated' }
    });
    expect(response.status()).toBe(404);
  });

  test('DELETE returns 404 for non-existent prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.delete(`/workspace/${localWorkerUrlKey}/api/prompts/custom/nonexistent-id`);
    expect(response.status()).toBe(404);
  });

  // =========================================================================
  // Prompt generation with variable substitution
  // =========================================================================

  test('generates prompt with variable substitution', async ({ page, localWorkerUrlKey }) => {
    // Create a custom prompt with variables
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'My Custom', template: 'Work on {{title}} ({{identifier}})' }
    });
    const { prompt } = await createRes.json();

    // Generate the prompt for a specific issue
    const genRes = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    expect(genRes.ok()).toBeTruthy();
    const data = await genRes.json();
    expect(data.prompt).toContain('Work on');
    expect(data.prompt).toContain('Task needing preparation');
    expect(data.promptName).toBe('My Custom');
  });

  test('custom prompt respects linearMcp feature flag', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Create a custom prompt mentioning the provider write surface.
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Linear Test', template: 'Update the task in Linear with your findings' }
    });
    const { prompt } = await createRes.json();

    // With linearMcp ON (default, writable provider), the provider-write mention
    // stays — capability-awareness (LIN-177) rewrites "Linear" to the active
    // provider's display name, which is "Local" on the local provider.
    const onRes = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    const onData = await onRes.json();
    expect(onData.prompt).toContain('in Local');

    // With linearMcp OFF — re-establish the local session with the flag cleared.
    // The custom-prompts store is partitioned by urlKey (unchanged), so the
    // prompt created above survives the re-seed.
    await seedLocal(workspaceApiLocalSeed, { features: { linearMcp: false } });
    const offRes = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/custom:${prompt.id}`
    );
    const offData = await offRes.json();
    expect(offData.prompt).not.toContain('in Local');
  });

  // Note: the '401 when not authenticated' case is dropped for the local-session
  // migration (LIN-408). Clearing the session removes the local workspace, so the
  // request 404s before the auth check can return 401; the generic 401 contract
  // stays covered on the PAT/Linear path.
});

test.describe('Custom Prompts Page', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.request.get(`/test/clear-custom-prompts?urlKey=${localWorkerUrlKey}`);
  });

  // =========================================================================
  // Page rendering
  // =========================================================================

  test('page loads with empty state', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Custom Prompts');
    await expect(page.locator('.custom-prompts-empty')).toBeVisible();
  });

  test('page shows nav bar with workspace', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.nav-bar')).toBeVisible();
  });

  // =========================================================================
  // Creating prompts via UI
  // =========================================================================

  test('can create a new prompt via the form', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
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

  test('can edit an existing prompt', async ({ page, localWorkerUrlKey }) => {
    // Create via API
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Edit Me', template: 'Original' }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
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

  test('can delete a prompt', async ({ page, localWorkerUrlKey }) => {
    // Create via API
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Delete Me', template: 'Bye' }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
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

  test('shows variable reference section', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
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

  test('save button disabled when name is empty', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
    await page.waitForLoadState('networkidle');

    await page.locator('.custom-prompt-new-btn').click();

    // Only fill template, not name
    await page.locator('.custom-prompt-template-input').fill('Some template');

    await expect(page.locator('.custom-prompt-save-btn')).toBeDisabled();
  });

  test('save button disabled when template is empty', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/prompts/custom`);
    await page.waitForLoadState('networkidle');

    await page.locator('.custom-prompt-new-btn').click();

    // Only fill name, not template
    await page.locator('.custom-prompt-name-input').fill('Some name');

    await expect(page.locator('.custom-prompt-save-btn')).toBeDisabled();
  });

  // =========================================================================
  // Settings link
  // =========================================================================

  test('settings page links to custom prompts', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const link = page.locator('a[href*="/prompts/custom"]');
    await expect(link).toBeVisible();
  });
});

// ==========================================================================
// Custom Prompts on Dashboard
// ==========================================================================

test.describe('Custom Prompts on Dashboard', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.request.get(`/test/clear-custom-prompts?urlKey=${localWorkerUrlKey}`);
  });

  test('custom prompt buttons appear as default buttons on dashboard', async ({ page, localWorkerUrlKey }) => {
    // Create a custom prompt via API
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'My Dashboard Prompt', template: 'Analyze {{title}}' }
    });

    // Navigate to dashboard
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Click an issue to expand it
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // Custom prompt button should be visible without needing to click "more"
    const customBtn = page.locator(`.in-progress-items .custom-prompt-btn[data-issue-id="${issueId}"]`);
    await expect(customBtn).toBeVisible();
    await expect(customBtn).toHaveText('My Dashboard Prompt');
  });

  test('clicking custom prompt button generates prompt on dashboard', async ({ page, localWorkerUrlKey }) => {
    // Create a custom prompt with a variable
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Title Prompt', template: 'Work on: {{title}}' }
    });
    const { prompt } = await createRes.json();

    // Navigate to dashboard
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Click an issue to expand it
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // Click the custom prompt button (visible by default, no need to click "more")
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

  test('no custom prompt buttons when none exist', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const issueLine = page.locator('.in-progress-items .line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.in-progress-items .details[data-details-for="${issueId}"]`);

    // Expand Prompts section
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await promptsToggle.click();

    // No custom prompt buttons should exist (they render as default buttons now)
    const customBtns = page.locator(`.in-progress-items .custom-prompt-btn[data-issue-id="${issueId}"]`);
    await expect(customBtns).toHaveCount(0);
  });
});

// ==========================================================================
// Custom Prompts on Swipe Page
// ==========================================================================

test.describe('Custom Prompts on Swipe Page', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.request.get(`/test/clear-custom-prompts?urlKey=${localWorkerUrlKey}`);
  });

  async function openPromptsAccordion(page) {
    const header = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await header.click();
  }

  test('custom prompt buttons appear in more section on swipe page', async ({ page, localWorkerUrlKey }) => {
    // Create a custom prompt via API
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'My Swipe Prompt', template: 'Review {{title}}' }
    });

    // Navigate to swipe page
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');

    await openPromptsAccordion(page);

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // Custom prompt button should be visible
    const customBtn = page.locator('.swipe-prompt-btn.custom-prompt-btn');
    await expect(customBtn).toBeVisible();
    await expect(customBtn).toHaveText('My Swipe Prompt');
  });

  test('clicking custom prompt button generates prompt on swipe page', async ({ page, localWorkerUrlKey }) => {
    // Create a custom prompt with a variable
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Swipe Title', template: 'Analyze: {{title}}' }
    });
    const { prompt } = await createRes.json();

    // Navigate to swipe page
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');

    await openPromptsAccordion(page);

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // Click the custom prompt button
    const customBtn = page.locator(`.swipe-prompt-btn[data-prompt="custom:${prompt.id}"]`);
    await customBtn.click();

    // Wait for fresh result (prompt section transitions to data-phase="fresh")
    const section = page.locator('.prompt-section');
    await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

    // Verify prompt name and substitution
    await expect(section.locator('.swipe-prompt-name')).toHaveText('Swipe Title');
    await expect(section.locator('.swipe-prompt-text')).toContainText('Analyze:');
  });

  test('dispatch targets are collapsed behind a Dispatch ▾ trigger on swipe', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Enable dispatch so the action cluster renders the dispatch disclosure.
    await seedLocal(workspaceApiLocalSeed, { features: { dispatch: true } });

    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Swipe Dispatch', template: 'Analyze: {{title}}' }
    });
    const { prompt } = await createRes.json();

    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');

    await openPromptsAccordion(page);
    await page.locator('.swipe-prompt-btn-more').click();
    await page.locator(`.swipe-prompt-btn[data-prompt="custom:${prompt.id}"]`).click();

    const section = page.locator('.prompt-section');
    await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

    // Targets are collapsed behind the disclosure trigger.
    const toggle = section.locator('.disclosure-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(section.locator('.swipe-prompt-dispatch[data-target="cli"]')).toBeHidden();

    // Expand reveals the targets.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(section.locator('.swipe-prompt-dispatch[data-target="cli"]')).toBeVisible();

    // Escape collapses it.
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // LIN-1096: the shared model/harness exec controls live inside the same
  // dispatch options panel on the swipe prompt-compose section.
  test('exec controls appear in the swipe dispatch panel and flow through to the dispatched item', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { features: { dispatch: true } });

    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/prompts/custom`, {
      data: { name: 'Swipe Exec Controls', template: 'Analyze: {{title}}' }
    });
    const { prompt } = await createRes.json();

    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');

    await openPromptsAccordion(page);
    await page.locator('.swipe-prompt-btn-more').click();
    await page.locator(`.swipe-prompt-btn[data-prompt="custom:${prompt.id}"]`).click();

    const section = page.locator('.prompt-section');
    await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

    await section.locator('.disclosure-toggle').click();
    const controls = section.locator('.dispatch-exec-controls');
    await expect(controls).toBeVisible();

    await controls.locator('.dispatch-exec-harness-custom').fill('opencode');
    await controls.locator('.dispatch-exec-model').fill('openrouter/anthropic/claude-opus-4.8');

    const dispatchReq = page.waitForRequest(req =>
      req.url().includes('/api/dispatch') && req.method() === 'POST');
    await section.locator('.swipe-prompt-dispatch[data-target="cli"]').click();

    const req = await dispatchReq;
    const body = JSON.parse(req.postData() || '{}');
    expect(body.harness).toBe('opencode');
    expect(body.model).toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('no custom prompt buttons when none exist on swipe page', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');

    await openPromptsAccordion(page);

    // Click "more" to reveal hidden prompts
    const moreBtn = page.locator('.swipe-prompt-btn-more');
    await moreBtn.click();

    // No custom prompt buttons should exist
    const customBtns = page.locator('.swipe-prompt-btn.custom-prompt-btn');
    await expect(customBtns).toHaveCount(0);
  });
});
