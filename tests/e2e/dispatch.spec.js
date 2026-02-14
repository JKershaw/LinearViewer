import { test, expect } from '@playwright/test';

// Test workspace URL key (from test session setup)
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}`;

// Test issue ID (from mock-data.js - blocked issue has prompts)
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * Helper to expand Prompts section for an issue
 * Use after clicking the task line to expand details
 */
async function expandPromptsSection(page, containerSelector, issueId) {
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
  await promptsToggle.click();
}

/**
 * Helper to reveal hidden prompts behind "more" toggle
 * Use after expanding the Prompts section
 */
async function clickMoreToggle(page, containerSelector, issueId) {
  const moreToggle = page.locator(`${containerSelector} .more-toggle[data-issue-id="${issueId}"]`);
  await moreToggle.click();
}

test.describe('Dispatch Queue', () => {
  test.beforeEach(async ({ page }) => {
    // Clear dispatch queue and tokens before each test
    await page.goto('/test/clear-dispatch-queue');
    await page.goto('/test/clear-dispatch-tokens');

    // Set up test session with dispatch feature enabled
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}`);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('two dispatch buttons appear in prompt container with correct targets', async ({ page }) => {
    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label to show prompt
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Verify two dispatch buttons exist with correct data-target attributes
    const dispatchBtns = promptContainer.locator('.prompt-dispatch');
    await expect(dispatchBtns).toHaveCount(2);

    const cliBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await expect(cliBtn).toBeVisible();
    await expect(cliBtn).toHaveText('dispatch');

    const webBtn = promptContainer.locator('.prompt-dispatch[data-target="web"]');
    await expect(webBtn).toBeVisible();
    await expect(webBtn).toContainText('web');
  });

  test('clicking dispatch adds item to queue and shows feedback', async ({ page }) => {
    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label to show prompt
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Click dispatch button
    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Should show "dispatched!" feedback
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Should revert to "dispatch" after timeout
    await expect(dispatchBtn).toHaveText('dispatch', { timeout: 3000 });
  });

  test('queue badge appears after dispatch', async ({ page }) => {
    // Initially badge should be hidden (queue is empty)
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).toHaveClass(/hidden/);

    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label and dispatch
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Wait for dispatch to complete
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Badge should now be visible (wait for async badge update)
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await expect(badge.locator('.queue-count')).toHaveText('1');
  });

  test('clicking queue badge shows queue panel', async ({ page }) => {
    // First dispatch something to have items in queue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Click the queue badge (wait for async badge update)
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await badge.click();

    // Queue panel should appear
    const panel = page.locator('.queue-panel');
    await expect(panel).toBeVisible();

    // Should show the dispatched item
    const queueItem = panel.locator('.queue-item');
    await expect(queueItem).toBeVisible();
  });

  test('can remove item from queue panel', async ({ page }) => {
    // First dispatch something
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Open queue panel (wait for async badge update)
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await badge.click();

    const panel = page.locator('.queue-panel');
    await expect(panel).toBeVisible();

    // Click remove button
    const removeBtn = panel.locator('.queue-item-remove');
    await removeBtn.click();

    // Item should be removed
    await expect(panel.locator('.queue-item')).toHaveCount(0);

    // Panel should show empty message
    await expect(panel.locator('.queue-panel-empty')).toContainText('Queue is empty');

    // Badge should be hidden (queue is empty)
    await expect(badge).toHaveClass(/hidden/);
  });

  test('can close queue panel with close button', async ({ page }) => {
    // Dispatch something first
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await promptContainer.locator('.prompt-dispatch[data-target="cli"]').click();

    // Open panel (wait for async badge update)
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await badge.click();

    const panel = page.locator('.queue-panel');
    await expect(panel).toBeVisible();

    // Click close button
    await panel.locator('.queue-panel-close').click();

    // Panel should be hidden
    await expect(panel).not.toBeVisible();
  });

  test('badge updates via polling when consumer claims item', async ({ page, request }) => {
    // Create a consumer token
    const tokenResponse = await request.get('/test/create-dispatch-token');
    const { token } = await tokenResponse.json();

    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label to show prompt
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load and dispatch
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Badge should show 1 queued
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await expect(badge.locator('.queue-count')).toHaveText('1');

    // Consumer claims the item via API
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { items } = await pollResponse.json();
    expect(items.length).toBe(1);

    await request.post(`/api/dispatch/take/${items[0].id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Badge should update via polling (within 2 seconds given 1s interval)
    await expect(badge).toHaveClass(/hidden/, { timeout: 3000 });
  });
});

test.describe('Dispatch API', () => {
  test.beforeEach(async ({ page }) => {
    // Clear dispatch queue before each test
    await page.goto('/test/clear-dispatch-queue');
    await page.goto('/test/set-session');
  });

  test('POST /api/dispatch creates queue item', async ({ request }) => {
    // Set session first
    await request.get('/test/set-session');

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt content',
        promptName: 'Test Prompt',
        issueId: BLOCKED_ISSUE_ID,
        issueTitle: 'Test Issue'
      }
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.item).toBeDefined();
    expect(data.item.id).toBeDefined();
    expect(data.item.promptName).toBe('Test Prompt');
  });

  test('GET /api/dispatch lists queue items', async ({ request }) => {
    await request.get('/test/set-session');

    // Create an item first
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt',
        promptName: 'Test'
      }
    });

    // List items
    const response = await request.get(`${API_PREFIX}/api/dispatch`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.items).toBeDefined();
    expect(data.items.length).toBe(1);
    expect(data.items[0].prompt).toBe('Test prompt');
  });

  test('DELETE /api/dispatch/:itemId removes item', async ({ request }) => {
    await request.get('/test/set-session');

    // Create an item
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Test' }
    });
    const { item } = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);
    expect(deleteResponse.status()).toBe(200);

    // Verify it's gone
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items.length).toBe(0);
  });

  test('POST /api/dispatch with target=web stores target correctly', async ({ request }) => {
    await request.get('/test/set-session');

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Web prompt content',
        promptName: 'Web Prompt',
        target: 'web'
      }
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.item.target).toBe('web');

    // Verify via list endpoint
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items[0].target).toBe('web');
  });

  test('POST /api/dispatch without target defaults to cli', async ({ request }) => {
    await request.get('/test/set-session');

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Default target prompt',
        promptName: 'Default'
      }
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.item.target).toBe('cli');

    // Verify via list endpoint
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items[0].target).toBe('cli');
  });

  test('POST /api/dispatch with invalid target returns 400', async ({ request }) => {
    await request.get('/test/set-session');

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Invalid target prompt',
        promptName: 'Bad',
        target: 'invalid'
      }
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('target must be one of');
  });

  test('GET /api/dispatch/count returns count', async ({ request }) => {
    await request.get('/test/set-session');

    // Initially empty
    let response = await request.get(`${API_PREFIX}/api/dispatch/count`);
    let data = await response.json();
    expect(data.count).toBe(0);

    // Add an item
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test', promptName: 'Test' }
    });

    // Count should be 1
    response = await request.get(`${API_PREFIX}/api/dispatch/count`);
    data = await response.json();
    expect(data.count).toBe(1);
  });
});

test.describe('Consumer API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-dispatch-queue');
    await page.goto('/test/clear-dispatch-tokens');
  });

  test('poll returns 401 without token', async ({ request }) => {
    const response = await request.get('/api/dispatch/poll');
    expect(response.status()).toBe(401);
  });

  test('poll returns items with valid token', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get('/test/create-dispatch-token');
    const { token } = await tokenResponse.json();

    // Add item to queue via session
    await request.get('/test/set-session');
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Test' }
    });

    // Poll with token
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(pollResponse.status()).toBe(200);

    const data = await pollResponse.json();
    expect(data.items).toBeDefined();
    expect(data.items.length).toBe(1);
  });

  test('take atomically removes item', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get('/test/create-dispatch-token');
    const { token } = await tokenResponse.json();

    // Add item to queue
    await request.get('/test/set-session');
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Test' }
    });
    const { item } = await createResponse.json();

    // Take the item
    const takeResponse = await request.post(`/api/dispatch/take/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(takeResponse.status()).toBe(200);

    const takeData = await takeResponse.json();
    expect(takeData.item).toBeDefined();
    expect(takeData.item.prompt).toBe('Test prompt');

    // Item should be gone from queue
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const pollData = await pollResponse.json();
    expect(pollData.items.length).toBe(0);
  });

  test('poll returns target field for items', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get('/test/create-dispatch-token');
    const { token } = await tokenResponse.json();

    // Add items with different targets
    await request.get('/test/set-session');
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'CLI prompt', promptName: 'CLI', target: 'cli' }
    });
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Web prompt', promptName: 'Web', target: 'web' }
    });

    // Poll with token - should see both items with targets
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(pollResponse.status()).toBe(200);

    const data = await pollResponse.json();
    expect(data.items.length).toBe(2);

    const targets = data.items.map(item => item.target).sort();
    expect(targets).toEqual(['cli', 'web']);
  });

  test('take returns 404 for non-existent item', async ({ request }) => {
    const tokenResponse = await request.get('/test/create-dispatch-token');
    const { token } = await tokenResponse.json();

    const response = await request.post('/api/dispatch/take/00000000-0000-0000-0000-000000000000', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('Token Management API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-dispatch-tokens');
    await page.goto('/test/set-session');
  });

  test('can create dispatch token', async ({ request }) => {
    await request.get('/test/set-session');

    const response = await request.post(`${API_PREFIX}/api/dispatch/tokens`, {
      data: { label: 'My Token' }
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.tokenId).toBeDefined();
    expect(data.token).toBeDefined(); // Plain text token returned once
    expect(data.label).toBe('My Token');
  });

  test('can list tokens (without secrets)', async ({ request }) => {
    await request.get('/test/set-session');

    // Create a token
    await request.post(`${API_PREFIX}/api/dispatch/tokens`, {
      data: { label: 'Token 1' }
    });

    // List tokens
    const response = await request.get(`${API_PREFIX}/api/dispatch/tokens`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.tokens).toBeDefined();
    expect(data.tokens.length).toBe(1);
    expect(data.tokens[0].label).toBe('Token 1');
    expect(data.tokens[0].token).toBeUndefined(); // Token hash should not be exposed
  });

  test('can revoke token', async ({ request }) => {
    await request.get('/test/set-session');

    // Create a token
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch/tokens`, {
      data: { label: 'To Delete' }
    });
    const { tokenId, token } = await createResponse.json();

    // Revoke it
    const revokeResponse = await request.delete(`${API_PREFIX}/api/dispatch/tokens/${tokenId}`);
    expect(revokeResponse.status()).toBe(200);

    // Token should no longer work
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(pollResponse.status()).toBe(401);
  });
});

test.describe('Custom Prompt Dispatch', () => {
  test.beforeEach(async ({ page }) => {
    // Clear state before each test
    await page.goto('/test/clear-dispatch-queue');
    await page.goto('/test/clear-dispatch-tokens');
    await page.goto('/test/clear-recent-prompts');

    // Set up test session with dispatch feature enabled
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}`);
  });

  /**
   * Helper: seed a dispatch item via page's API context so the queue badge
   * becomes visible, then navigate to workspace and open the queue panel.
   * Uses page.request to share session cookies with the browser context.
   */
  async function openQueuePanel(page) {
    // Navigate first so the session is established
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Seed an item via page's request context (shares session cookies)
    await page.request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Seed item', promptName: 'Seed' }
    });

    // Trigger badge update
    await page.evaluate(async () => {
      const badge = document.querySelector('[data-queue-badge]');
      if (badge) {
        const urlKey = badge.dataset.urlKey;
        const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/count`);
        const { count } = await res.json();
        const countEl = badge.querySelector('.queue-count');
        if (countEl) countEl.textContent = count;
        badge.classList.toggle('hidden', count === 0);
      }
    });

    // Wait for badge to appear and click it
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/, { timeout: 10000 });
    await badge.click();

    const panel = page.locator('.queue-panel');
    await expect(panel).toBeVisible();
    return panel;
  }

  test('custom prompt input visible in queue panel', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Verify textarea exists
    const textarea = panel.locator('.queue-custom-prompt');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', 'Type a custom prompt or /command...');

    // Verify two dispatch buttons with correct targets
    const buttons = panel.locator('.queue-custom-dispatch');
    await expect(buttons).toHaveCount(2);

    const cliBtn = panel.locator('.queue-custom-dispatch[data-target="cli"]');
    await expect(cliBtn).toBeVisible();
    await expect(cliBtn).toHaveText('dispatch');

    const webBtn = panel.locator('.queue-custom-dispatch[data-target="web"]');
    await expect(webBtn).toBeVisible();
  });

  test('can dispatch custom freeform text', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Type custom prompt
    const textarea = panel.locator('.queue-custom-prompt');
    await textarea.fill('Review the auth module for security issues');

    // Click dispatch (cli target)
    const dispatchBtn = panel.locator('.queue-custom-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Should show "dispatched!" feedback
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Textarea should be cleared
    await expect(textarea).toHaveValue('');

    // Verify item appears in queue via API
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    const customItem = items.find(i => i.promptName === 'Custom');
    expect(customItem).toBeDefined();
    expect(customItem.prompt).toBe('Review the auth module for security issues');
    expect(customItem.target).toBe('cli');
  });

  test('can dispatch custom prompt with web target', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Type and dispatch with web target
    const textarea = panel.locator('.queue-custom-prompt');
    await textarea.fill('Check deployment status');

    const webBtn = panel.locator('.queue-custom-dispatch[data-target="web"]');
    await webBtn.click();

    // Should show feedback
    await expect(webBtn).toContainText('dispatched!');

    // Verify target is "web" via API
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    const customItem = items.find(i => i.prompt === 'Check deployment status');
    expect(customItem).toBeDefined();
    expect(customItem.target).toBe('web');
  });

  test('empty input shows validation feedback', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Click dispatch with empty textarea
    const dispatchBtn = panel.locator('.queue-custom-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Should show "empty" feedback
    await expect(dispatchBtn).toHaveText('empty');

    // Should revert to "dispatch"
    await expect(dispatchBtn).toHaveText('dispatch', { timeout: 3000 });

    // No new item should be in queue (only the seed item)
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    expect(items.filter(i => i.promptName === 'Custom').length).toBe(0);
  });

  test('slash command dispatched as literal text', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Type a slash command
    const textarea = panel.locator('.queue-custom-prompt');
    await textarea.fill('/plan');

    const dispatchBtn = panel.locator('.queue-custom-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    await expect(dispatchBtn).toHaveText('dispatched!');

    // Verify prompt is literally "/plan"
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    const customItem = items.find(i => i.promptName === 'Custom');
    expect(customItem).toBeDefined();
    expect(customItem.prompt).toBe('/plan');
  });

  test('recent custom prompts appear after dispatch', async ({ page }) => {
    const panel = await openQueuePanel(page);

    // Dispatch a custom prompt
    const textarea = panel.locator('.queue-custom-prompt');
    await textarea.fill('First custom prompt');
    const dispatchBtn = panel.locator('.queue-custom-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Wait for recents to render (async update after dispatch)
    const recentItem = panel.locator('.queue-recent-item');
    await expect(recentItem.first()).toBeVisible({ timeout: 5000 });
    await expect(recentItem.first()).toContainText('First custom prompt');
  });

  test('clicking recent prompt fills textarea', async ({ page }) => {
    // Navigate and set up session first
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Populate recents via page's API context (shares session)
    await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'Reusable prompt text' }
    });

    const panel = await openQueuePanel(page);

    // Wait for recent items to load
    const recentItem = panel.locator('.queue-recent-item');
    await expect(recentItem.first()).toBeVisible({ timeout: 5000 });

    // Click the recent prompt
    await recentItem.first().click();

    // Textarea should be filled
    const textarea = panel.locator('.queue-custom-prompt');
    await expect(textarea).toHaveValue('Reusable prompt text');
  });
});

test.describe('Recent Prompts API', () => {
  test.beforeEach(async ({ request }) => {
    await request.get('/test/clear-recent-prompts');
    await request.get('/test/set-session');
  });

  test('GET recent-prompts returns empty array initially', async ({ request }) => {
    await request.get('/test/set-session');
    const response = await request.get(`${API_PREFIX}/api/dispatch/recent-prompts`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.prompts).toEqual([]);
  });

  test('POST recent-prompts saves and GET retrieves', async ({ request }) => {
    await request.get('/test/set-session');

    const postResponse = await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'Test recent prompt' }
    });
    expect(postResponse.status()).toBe(200);
    const postData = await postResponse.json();
    expect(postData.success).toBe(true);

    const getResponse = await request.get(`${API_PREFIX}/api/dispatch/recent-prompts`);
    const getData = await getResponse.json();
    expect(getData.prompts).toEqual(['Test recent prompt']);
  });

  test('recent prompts are deduplicated and most-recent-first', async ({ request }) => {
    await request.get('/test/set-session');

    await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'First' }
    });
    await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'Second' }
    });
    await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'First' } // Duplicate - should move to top
    });

    const response = await request.get(`${API_PREFIX}/api/dispatch/recent-prompts`);
    const data = await response.json();
    expect(data.prompts).toEqual(['First', 'Second']);
  });

  test('recent prompts limited to 10', async ({ request }) => {
    await request.get('/test/set-session');

    // Add 12 prompts
    for (let i = 1; i <= 12; i++) {
      await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: `Prompt ${i}` }
      });
    }

    const response = await request.get(`${API_PREFIX}/api/dispatch/recent-prompts`);
    const data = await response.json();
    expect(data.prompts.length).toBe(10);
    // Most recent should be first
    expect(data.prompts[0]).toBe('Prompt 12');
    expect(data.prompts[9]).toBe('Prompt 3');
  });

  test('POST recent-prompts validates input', async ({ request }) => {
    await request.get('/test/set-session');

    // Empty prompt
    const emptyResponse = await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: '' }
    });
    expect(emptyResponse.status()).toBe(400);

    // Missing prompt
    const missingResponse = await request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: {}
    });
    expect(missingResponse.status()).toBe(400);
  });
});
