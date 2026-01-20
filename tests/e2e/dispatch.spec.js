import { test, expect } from '@playwright/test';

// Test workspace URL key (from test session setup)
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}`;

// Test issue ID (from mock-data.js - blocked issue has prompts)
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

test.describe('Dispatch Queue', () => {
  test.beforeEach(async ({ page }) => {
    // Clear dispatch queue and tokens before each test
    await page.goto('/test/clear-dispatch-queue');
    await page.goto('/test/clear-dispatch-tokens');

    // Set up test session
    await page.goto('/test/set-session');
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('dispatch button appears in prompt container', async ({ page }) => {
    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Click the promptable label to show prompt
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Verify dispatch button exists
    const dispatchBtn = promptContainer.locator('.prompt-dispatch');
    await expect(dispatchBtn).toBeVisible();
    await expect(dispatchBtn).toHaveText('dispatch');
  });

  test('clicking dispatch adds item to queue and shows feedback', async ({ page }) => {
    // Find and expand a task with prompts
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Click the promptable label to show prompt
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Click dispatch button
    const dispatchBtn = promptContainer.locator('.prompt-dispatch');
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

    // Click the promptable label and dispatch
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch');
    await dispatchBtn.click();

    // Wait for dispatch to complete
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Badge should now be visible
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.queue-count')).toHaveText('1');
  });

  test('clicking queue badge shows queue panel', async ({ page }) => {
    // First dispatch something to have items in queue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Click the queue badge
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/);
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

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    const dispatchBtn = promptContainer.locator('.prompt-dispatch');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Open queue panel
    const badge = page.locator('[data-queue-badge]');
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

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await promptContainer.locator('.prompt-dispatch').click();

    // Open panel
    const badge = page.locator('[data-queue-badge]');
    await expect(badge).not.toHaveClass(/hidden/);
    await badge.click();

    const panel = page.locator('.queue-panel');
    await expect(panel).toBeVisible();

    // Click close button
    await panel.locator('.queue-panel-close').click();

    // Panel should be hidden
    await expect(panel).not.toBeVisible();
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
