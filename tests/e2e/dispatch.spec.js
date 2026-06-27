import { test, expect } from '../fixtures/test-base.js';

// Per-worker workspace URL key (LIN-628): bound from the worker-scoped fixture
// so session, nav, the dispatch token, and the teardown query params all address
// this worker's partition. Playwright workers are separate processes, so these
// module-scoped lets are per-worker state.
let URL_KEY;
let WORKSPACE_URL;
let API_PREFIX;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  WORKSPACE_URL = `/workspace/${URL_KEY}/`;
  API_PREFIX = `/workspace/${URL_KEY}`;
});

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

/**
 * Helper to open the collapsed "Dispatch ▾" options panel within a prompt
 * container so the cli/web/dash/harbour target buttons become interactable.
 * No-op if the panel is already open.
 */
async function openDispatchOptions(container) {
  const toggle = container.locator('.disclosure-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}

test.describe('Dispatch Queue', () => {
  test.beforeEach(async ({ page }) => {
    // These tests verify real badge polling behavior, so remove the count mock
    await page.unroute('**/api/dispatch/count');

    // Clear dispatch queue and tokens before each test
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);

    // Set up test session with dispatch feature enabled
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('three dispatch buttons appear in prompt container with correct targets', async ({ page }) => {
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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

    // Verify four dispatch buttons exist with correct data-target attributes (includes local on localhost)
    const dispatchBtns = promptContainer.locator('.prompt-dispatch');
    await expect(dispatchBtns).toHaveCount(4);

    const cliBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await expect(cliBtn).toBeVisible();
    await expect(cliBtn).toHaveText('cli');

    const webBtn = promptContainer.locator('.prompt-dispatch[data-target="web"]');
    await expect(webBtn).toBeVisible();
    await expect(webBtn).toHaveText('web');

    const dashBtn = promptContainer.locator('.prompt-dispatch[data-target="dash"]');
    await expect(dashBtn).toBeVisible();
    await expect(dashBtn).toHaveText('dash');

    const localBtn = promptContainer.locator('.prompt-dispatch[data-target="local"]');
    await expect(localBtn).toBeVisible();
    await expect(localBtn).toHaveText('harbour');
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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

    // Click dispatch button
    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Should show "dispatched!" feedback
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Should revert to "cli" after timeout
    await expect(dispatchBtn).toHaveText('cli', { timeout: 3000 });
  });

  test('dispatching a prompt includes repo from project description', async ({ page, request }) => {
    // Create a consumer token
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Find and expand a task with prompts (blocked issue is in proj-alpha which has repo=test-repo)
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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

    // Click dispatch button
    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Wait for dispatch to complete
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Verify the dispatched item has the repo field via consumer API
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await pollResponse.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].repo).toBe('test-repo');
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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

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
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
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

    // Dispatch targets are now collapsed behind a "Dispatch ▾" disclosure.
    await openDispatchOptions(promptContainer);

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

  // ==========================================================================
  // LIN-295 Phase 2: "Dispatch ▾" disclosure on the main tree view
  // ==========================================================================

  // Reveal a loaded prompt container for the blocked issue (without opening the
  // dispatch panel — these tests drive the disclosure explicitly).
  async function revealPrompt(page) {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });
    return promptContainer;
  }

  test('dispatch targets are collapsed behind a Dispatch ▾ trigger', async ({ page }) => {
    const promptContainer = await revealPrompt(page);
    const toggle = promptContainer.locator('.disclosure-toggle');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Targets are hidden until expanded.
    await expect(promptContainer.locator('.prompt-dispatch[data-target="cli"]')).toBeHidden();

    // Expand.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(promptContainer.locator('.prompt-dispatch[data-target="cli"]')).toBeVisible();

    // Collapse via the trigger.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(promptContainer.locator('.prompt-dispatch[data-target="cli"]')).toBeHidden();
  });

  test('Dispatch panel closes on outside click and Escape', async ({ page }) => {
    const promptContainer = await revealPrompt(page);
    const toggle = promptContainer.locator('.disclosure-toggle');

    // Outside click (the prompt name is outside both trigger and panel) closes it.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await promptContainer.locator('.prompt-name').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Escape closes it.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('dispatch still fires from inside the expanded panel', async ({ page }) => {
    const promptContainer = await revealPrompt(page);
    await openDispatchOptions(promptContainer);

    const dispatchBtn = promptContainer.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // The panel stays open after dispatch so the button feedback remains visible.
    await expect(promptContainer.locator('.disclosure-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('Dispatch API', () => {
  test.beforeEach(async ({ page }) => {
    // Clear dispatch queue before each test
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  });

  test('POST /api/dispatch creates queue item', async ({ request }) => {
    // Set session first
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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

  test('POST /api/dispatch with target=dash stores target correctly', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Dash prompt content',
        promptName: 'Dash Prompt',
        target: 'dash'
      }
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.item.target).toBe('dash');

    // Verify via list endpoint
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items[0].target).toBe('dash');
  });

  test('POST /api/dispatch without target defaults to cli', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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

  test('POST /api/dispatch rejects repo exceeding max length', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const longRepo = 'a'.repeat(1001);
    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt',
        promptName: 'Test',
        repo: longRepo
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('repo exceeds maximum length');
  });

  test('POST /api/dispatch rejects repo with null bytes', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt',
        promptName: 'Test',
        repo: 'my-repo\x00injected'
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('repo contains invalid characters');
  });

  test('POST /api/dispatch without repo stores null repo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt',
        promptName: 'Test'
      }
    });

    expect(response.status()).toBe(201);

    // Verify via list endpoint that repo is null
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items[0].repo).toBeNull();
  });

  test('POST /api/dispatch accepts an explicit kind and surfaces it', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Plan it', promptName: 'Custom', kind: 'research' }
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    // Explicit kind wins over what promptName ('Custom') would derive.
    expect(data.item.kind).toBe('research');

    // And it round-trips through the list projection.
    const listResponse = await request.get(`${API_PREFIX}/api/dispatch`);
    const listData = await listResponse.json();
    expect(listData.items[0].kind).toBe('research');
  });

  test('POST /api/dispatch accepts the autopilot meta-kind', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: "You're Autopilot…", promptName: 'Autopilot (stack walk)', kind: 'autopilot' }
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    // 'autopilot' isn't a prompt-template key, so it must be accepted explicitly
    // (not derivable from promptName) and surfaced verbatim.
    expect(data.item.kind).toBe('autopilot');
  });

  test('POST /api/dispatch derives kind from promptName when omitted', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // 'implement' is the display name of the 'implementation' template key.
    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Build it', promptName: 'implement' }
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.item.kind).toBe('implementation');
  });

  test('POST /api/dispatch defaults kind to custom for freeform prompts', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Freeform text', promptName: 'Custom' }
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.item.kind).toBe('custom');
  });

  // Follow-up dispatch plumbing (LIN-415): a follow-up is an ordinary item
  // carrying followUpTo = the original dispatchId whose session to resume.
  test('POST /api/dispatch follow-up: a second item references the first by id and surfaces followUpTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // 1. Dispatch a custom item.
    const original = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Implement the thing', promptName: 'Custom', target: 'cli' }
    });
    expect(original.status()).toBe(201);
    const originalId = (await original.json()).item.id;

    // 2. Dispatch a follow-up pointing at the original item's id.
    const followUp = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Now confirm CI is green',
        promptName: 'Custom',
        target: 'cli',
        followUpTo: originalId
      }
    });
    expect(followUp.status()).toBe(201);

    // The consumer-facing list projection carries followUpTo for the follow-up
    // and null for the original.
    const listData = await (await request.get(`${API_PREFIX}/api/dispatch`)).json();
    const byPrompt = Object.fromEntries(listData.items.map(i => [i.prompt, i]));
    expect(byPrompt['Now confirm CI is green'].followUpTo).toBe(originalId);
    expect(byPrompt['Implement the thing'].followUpTo).toBeNull();
  });

  test('POST /api/dispatch rejects a non-UUID followUpTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Resume please', followUpTo: 'not-a-uuid' }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('followUpTo');
  });

  test('POST /api/dispatch rejects followUpTo for non-cli/web targets', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Resume please',
        target: 'dash',
        followUpTo: '11111111-1111-4111-8111-111111111111'
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('cli/web');
  });

  test('POST /api/dispatch without followUpTo stores null', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Fresh task', promptName: 'Custom' }
    });
    expect(response.status()).toBe(201);

    const listData = await (await request.get(`${API_PREFIX}/api/dispatch`)).json();
    expect(listData.items[0].followUpTo).toBeNull();
  });

  // Abort dispatch plumbing (LIN-743): an abort is an ordinary item carrying
  // abort:true + abortTo (the dispatchId of the session to cancel) and NO prompt.
  test('POST /api/dispatch abort: cancels an existing session by id and surfaces abort/abortTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // 1. Dispatch a normal item (on dash, to prove eligibility is keyed off the
    //    abort item's own target, not the aborted session's substrate).
    const original = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Implement the thing', promptName: 'Custom', target: 'dash' }
    });
    expect(original.status()).toBe(201);
    const originalId = (await original.json()).item.id;

    // 2. Dispatch an abort (no prompt) pointing at the original item's id, on cli.
    const abortResp = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { abort: true, abortTo: originalId, target: 'cli' }
    });
    expect(abortResp.status()).toBe(201);

    // The consumer-facing list projection carries abort/abortTo for the abort item.
    const listData = await (await request.get(`${API_PREFIX}/api/dispatch`)).json();
    const abortItem = listData.items.find(i => i.abort === true);
    expect(abortItem).toBeDefined();
    expect(abortItem.abortTo).toBe(originalId);
    expect(abortItem.target).toBe('cli');
    const normalItem = listData.items.find(i => i.prompt === 'Implement the thing');
    expect(normalItem.abort).toBe(false);
    expect(normalItem.abortTo).toBeNull();
  });

  test('POST /api/dispatch abort requires abortTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { abort: true }
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('abortTo');
  });

  test('POST /api/dispatch abort rejects a non-UUID abortTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { abort: true, abortTo: 'not-a-uuid' }
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('abortTo');
  });

  test('POST /api/dispatch abort rejects a non-poll-eligible (local) target', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { abort: true, abortTo: '11111111-1111-4111-8111-111111111111', target: 'local' }
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('poll-eligible');
  });

  test('POST /api/dispatch rejects combining abort and followUpTo', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        abort: true,
        abortTo: '11111111-1111-4111-8111-111111111111',
        followUpTo: '22222222-2222-4222-8222-222222222222'
      }
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('mutually exclusive');
  });

  test('POST /api/dispatch with invalid kind returns 400', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Test', kind: 'not-a-real-kind' }
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('kind must be one of');
  });

  test('GET /api/dispatch/count returns count', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
  });

  test('poll returns 401 without token', async ({ request }) => {
    const response = await request.get('/api/dispatch/poll');
    expect(response.status()).toBe(401);
  });

  test('poll returns items with valid token', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Add item to queue via session
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
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
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Add item to queue
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
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
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Add items with different targets
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
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

  test('poll returns repo field when included in dispatch', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Add item with repo field
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Repo prompt', promptName: 'Test', repo: 'my-repo' }
    });

    // Add item without repo field
    await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'No repo prompt', promptName: 'Test' }
    });

    // Poll with token - should see repo on first item, null on second
    const pollResponse = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(pollResponse.status()).toBe(200);

    const data = await pollResponse.json();
    expect(data.items.length).toBe(2);

    const withRepo = data.items.find(i => i.prompt === 'Repo prompt');
    const withoutRepo = data.items.find(i => i.prompt === 'No repo prompt');
    expect(withRepo.repo).toBe('my-repo');
    expect(withoutRepo.repo).toBeNull();
  });

  test('take returns repo field in claimed item', async ({ request }) => {
    // Create a token
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    // Add item with repo
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Test', repo: 'dash-build' }
    });
    const { item } = await createResponse.json();

    // Take the item
    const takeResponse = await request.post(`/api/dispatch/take/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(takeResponse.status()).toBe(200);

    const takeData = await takeResponse.json();
    expect(takeData.item.repo).toBe('dash-build');
  });

  test('take returns 404 for non-existent item', async ({ request }) => {
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    const response = await request.post('/api/dispatch/take/00000000-0000-0000-0000-000000000000', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('Token Management API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  });

  test('can create dispatch token', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
  // Per-worker (LIN-628): bound in beforeEach, after the file-level hook sets URL_KEY.
  let DISPATCH_URL;

  test.beforeEach(async ({ page }) => {
    DISPATCH_URL = `/workspace/${URL_KEY}/dispatch`;
    // Clear state before each test
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-recent-prompts?urlKey=${URL_KEY}`);

    // Set up test session with dispatch feature enabled
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);
  });

  /**
   * Helper: navigate to the dispatch page where custom prompt input lives.
   */
  async function openDispatchPage(page) {
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    // Dispatch options now live behind a disclosure trigger; expand it so the
    // option buttons are interactable.
    await page.locator('.dispatch-toggle').click();
    await expect(page.locator('#dispatch-options')).not.toHaveClass(/\bhidden\b/);
  }

  test('custom prompt input visible on dispatch page', async ({ page }) => {
    await openDispatchPage(page);

    // Verify textarea exists
    const textarea = page.locator('.dispatch-prompt-input');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', 'Type a custom prompt or /command...');

    // Verify four dispatch buttons with correct targets (includes local on localhost)
    const buttons = page.locator('.dispatch-prompt-send');
    await expect(buttons).toHaveCount(4);

    const cliBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    await expect(cliBtn).toBeVisible();
    await expect(cliBtn).toHaveText('cli');

    const webBtn = page.locator('.dispatch-prompt-send[data-target="web"]');
    await expect(webBtn).toBeVisible();
    await expect(webBtn).toHaveText('web');

    const dashBtn = page.locator('.dispatch-prompt-send[data-target="dash"]');
    await expect(dashBtn).toBeVisible();
    await expect(dashBtn).toHaveText('dash');

    const localBtn = page.locator('.dispatch-prompt-send[data-target="local"]');
    await expect(localBtn).toBeVisible();
    await expect(localBtn).toHaveText('harbour');
  });

  test('can dispatch custom freeform text', async ({ page }) => {
    await openDispatchPage(page);

    // Type custom prompt
    const textarea = page.locator('.dispatch-prompt-input');
    await textarea.fill('Review the auth module for security issues');

    // Click dispatch (cli target)
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
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
    await openDispatchPage(page);

    // Type and dispatch with web target
    const textarea = page.locator('.dispatch-prompt-input');
    await textarea.fill('Check deployment status');

    const webBtn = page.locator('.dispatch-prompt-send[data-target="web"]');
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

  test('can dispatch custom prompt with dash target', async ({ page }) => {
    await openDispatchPage(page);

    // Type and dispatch with dash target
    const textarea = page.locator('.dispatch-prompt-input');
    await textarea.fill('Run quick lint check');

    const dashBtn = page.locator('.dispatch-prompt-send[data-target="dash"]');
    await dashBtn.click();

    // Should show feedback
    await expect(dashBtn).toContainText('dispatched!');

    // Verify target is "dash" via API
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    const customItem = items.find(i => i.prompt === 'Run quick lint check');
    expect(customItem).toBeDefined();
    expect(customItem.target).toBe('dash');
  });

  test('empty input shows validation feedback', async ({ page }) => {
    await openDispatchPage(page);

    // Click dispatch with empty textarea
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    await dispatchBtn.click();

    // Should show "prompt is empty" feedback
    const feedback = page.locator('.dispatch-prompt-feedback');
    await expect(feedback).toHaveText('prompt is empty');

    // Feedback should clear after delay
    await expect(feedback).toHaveText('', { timeout: 3000 });

    // No item should be in queue
    const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
    const { items } = await listResponse.json();
    expect(items.filter(i => i.promptName === 'Custom').length).toBe(0);
  });

  test('slash command dispatched as literal text', async ({ page }) => {
    await openDispatchPage(page);

    // Type a slash command
    const textarea = page.locator('.dispatch-prompt-input');
    await textarea.fill('/plan');

    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
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
    await openDispatchPage(page);

    // Dispatch a custom prompt
    const textarea = page.locator('.dispatch-prompt-input');
    await textarea.fill('First custom prompt');
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!');

    // Wait for recents to render (async update after dispatch)
    const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
    await expect(recentItem.first()).toBeVisible({ timeout: 5000 });
    await expect(recentItem.first()).toContainText('First custom prompt');
  });

  test('clicking recent prompt fills textarea', async ({ page }) => {
    // Navigate to dispatch page first to establish session
    await openDispatchPage(page);

    // Populate recents via page's API context (shares session)
    await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
      data: { prompt: 'Reusable prompt text' }
    });

    // Reload dispatch page to load recents
    await openDispatchPage(page);

    // Wait for recent items to load
    const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
    await expect(recentItem.first()).toBeVisible({ timeout: 5000 });

    // Click the recent prompt
    await recentItem.first().click();

    // Textarea should be filled
    const textarea = page.locator('.dispatch-prompt-input');
    await expect(textarea).toHaveValue('Reusable prompt text');
  });
});

test.describe('Recent Prompts API', () => {
  test.beforeEach(async ({ request }) => {
    await request.get(`/test/clear-recent-prompts?urlKey=${URL_KEY}`);
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
  });

  test('GET recent-prompts returns empty array initially', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    const response = await request.get(`${API_PREFIX}/api/dispatch/recent-prompts`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.prompts).toEqual([]);
  });

  test('POST recent-prompts saves and GET retrieves', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

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

test.describe('Dispatch History API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  });

  test('taken items appear in history', async ({ request }) => {
    // Create token and session
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // Dispatch an item
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: {
        prompt: 'Test prompt',
        promptName: 'Test',
        issueIdentifier: 'LIN-42',
        issueTitle: 'Test Issue'
      }
    });
    const { item } = await createResponse.json();

    // Take it via consumer API
    await request.post(`/api/dispatch/take/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Check history
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    expect(historyResponse.status()).toBe(200);

    const historyData = await historyResponse.json();
    expect(historyData.items.length).toBe(1);
    expect(historyData.total).toBe(1);
    expect(historyData.items[0].status).toBe('taken');
    expect(historyData.items[0].promptName).toBe('Test');
    expect(historyData.items[0].issueIdentifier).toBe('LIN-42');
    expect(historyData.items[0].takenByTokenLabel).toBe('test-token');
  });

  test('cancelled items appear in history', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // Dispatch and then cancel
    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'To cancel', promptName: 'Cancel Me' }
    });
    const { item } = await createResponse.json();

    await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

    // Check history
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const historyData = await historyResponse.json();
    expect(historyData.items.length).toBe(1);
    expect(historyData.items[0].status).toBe('cancelled');
    expect(historyData.items[0].promptName).toBe('Cancel Me');
  });

  test('history returns newest-first', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // Dispatch and cancel two items sequentially
    const resp1 = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'First', promptName: 'First' }
    });
    const item1 = (await resp1.json()).item;
    await request.delete(`${API_PREFIX}/api/dispatch/${item1.id}`);

    const resp2 = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Second', promptName: 'Second' }
    });
    const item2 = (await resp2.json()).item;
    await request.delete(`${API_PREFIX}/api/dispatch/${item2.id}`);

    // Check history order
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const { items } = await historyResponse.json();
    expect(items.length).toBe(2);
    expect(items[0].promptName).toBe('Second');
    expect(items[1].promptName).toBe('First');
  });

  test('history pagination works', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    // Create 3 items and cancel them
    for (let i = 1; i <= 3; i++) {
      const resp = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: `Prompt ${i}`, promptName: `Item ${i}` }
      });
      const { item } = await resp.json();
      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);
    }

    // Fetch with limit=2, offset=0
    const page1 = await request.get(`${API_PREFIX}/api/dispatch/history?limit=2&offset=0`);
    const data1 = await page1.json();
    expect(data1.items.length).toBe(2);
    expect(data1.total).toBe(3);

    // Fetch with limit=2, offset=2
    const page2 = await request.get(`${API_PREFIX}/api/dispatch/history?limit=2&offset=2`);
    const data2 = await page2.json();
    expect(data2.items.length).toBe(1);
    expect(data2.total).toBe(3);
  });

  test('history endpoint returns empty when no history', async ({ request }) => {
    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const response = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const data = await response.json();
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });
});

test.describe('Consumer Feedback API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  });

  /**
   * Helper: create a token, dispatch an item, take it, and return all references
   */
  async function setupTakenItem(request) {
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test prompt', promptName: 'Feedback Test', issueIdentifier: 'LIN-42' }
    });
    const { item } = await createResponse.json();

    await request.post(`/api/dispatch/take/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    return { token, itemId: item.id };
  }

  test('can post feedback on a taken item', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    const response = await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: { message: 'Working on it...' }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.feedbackCount).toBe(1);
  });

  test('feedback appears in history API', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: { message: 'Analyzing issue...', url: 'https://example.com/pr/1', urlLabel: 'PR #1' }
    });

    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const { items } = await historyResponse.json();

    expect(items.length).toBe(1);
    expect(items[0].feedback).toBeDefined();
    expect(items[0].feedback.length).toBe(1);
    expect(items[0].feedback[0].message).toBe('Analyzing issue...');
    expect(items[0].feedback[0].url).toBe('https://example.com/pr/1');
    expect(items[0].feedback[0].urlLabel).toBe('PR #1');
    expect(items[0].feedback[0].timestamp).toBeDefined();
  });

  test('multiple feedback entries accumulate', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'Starting work...' }
    });

    await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'Done!', url: 'https://example.com/result' }
    });

    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const { items } = await historyResponse.json();

    expect(items[0].feedback.length).toBe(2);
    expect(items[0].feedback[0].message).toBe('Starting work...');
    expect(items[0].feedback[1].message).toBe('Done!');
  });

  test('feedback returns 401 without token', async ({ request }) => {
    const response = await request.post('/api/dispatch/feedback/00000000-0000-0000-0000-000000000000', {
      data: { message: 'test' }
    });
    expect(response.status()).toBe(401);
  });

  test('feedback returns 400 without message', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    const response = await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {}
    });
    expect(response.status()).toBe(400);
  });

  test('feedback returns 400 for javascript: url (XSS prevention)', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    const response = await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'xss attempt', url: 'javascript:alert(document.cookie)' }
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('http');
  });

  test('feedback returns 400 for data: url', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    const response = await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'data uri attempt', url: 'data:text/html,<script>alert(1)</script>' }
    });
    expect(response.status()).toBe(400);
  });

  test('feedback returns 400 for invalid item ID', async ({ request }) => {
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    const response = await request.post('/api/dispatch/feedback/not-a-uuid', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'test' }
    });
    expect(response.status()).toBe(400);
  });

  test('feedback returns 404 for non-existent item', async ({ request }) => {
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    const response = await request.post('/api/dispatch/feedback/00000000-0000-0000-0000-000000000000', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'test' }
    });
    expect(response.status()).toBe(404);
  });

  test('feedback returns 404 for cancelled item', async ({ request }) => {
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    await request.get(`/test/set-session?urlKey=${URL_KEY}`);

    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Test', promptName: 'Test' }
    });
    const { item } = await createResponse.json();

    // Cancel instead of take
    await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

    const response = await request.post(`/api/dispatch/feedback/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'test' }
    });
    expect(response.status()).toBe(404);
  });

  test('feedback enforces strict ownership (different token rejected)', async ({ request }) => {
    const { itemId } = await setupTakenItem(request);

    // Create a second token with a different label
    const token2Response = await request.get(`/test/create-dispatch-token?label=other-agent&urlKey=${URL_KEY}`);
    const { token: token2 } = await token2Response.json();

    const response = await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
      data: { message: 'From different token' }
    });
    expect(response.status()).toBe(404);
  });

  test('feedback without url does not include url in history', async ({ request }) => {
    const { token, itemId } = await setupTakenItem(request);

    await request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'No link here' }
    });

    await request.get(`/test/set-session?urlKey=${URL_KEY}`);
    const historyResponse = await request.get(`${API_PREFIX}/api/dispatch/history`);
    const { items } = await historyResponse.json();

    expect(items[0].feedback[0].url).toBeNull();
    expect(items[0].feedback[0].urlLabel).toBeNull();
  });
});

test.describe('Dispatch History UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);
  });

  test('history section shows on dispatch page with dispatch enabled', async ({ page }) => {
    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    const historyList = page.locator('.history-list');
    await expect(historyList).toBeVisible();

    // Should show empty state
    const empty = page.locator('.history-list-empty');
    await expect(empty).toContainText('No dispatch history yet');
  });

  test('dispatch page redirects to settings when dispatch disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: false }))}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    // Should redirect to settings page
    expect(page.url()).toContain('/settings');
  });

  test('taken item shows with correct status indicator', async ({ page, request }) => {
    // Create token and dispatch+take an item
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token } = await tokenResponse.json();

    await request.get(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);

    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Taken prompt', promptName: 'Taken Test', issueIdentifier: 'LIN-99' }
    });
    const { item } = await createResponse.json();

    await request.post(`/api/dispatch/take/${item.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Navigate to dispatch page
    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    // History item should be visible
    const historyItem = page.locator('.history-item[data-status="taken"]');
    await expect(historyItem).toBeVisible();
    await expect(historyItem.locator('.history-status')).toHaveClass(/status-taken/);
    await expect(historyItem.locator('.history-name')).toContainText('Taken Test');
  });

  test('cancelled item shows with correct status indicator', async ({ page, request }) => {
    await request.get(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);

    const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
      data: { prompt: 'Cancelled prompt', promptName: 'Cancel Test' }
    });
    const { item } = await createResponse.json();

    await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    const historyItem = page.locator('.history-item[data-status="cancelled"]');
    await expect(historyItem).toBeVisible();
    await expect(historyItem.locator('.history-status')).toHaveClass(/status-cancelled/);
    await expect(historyItem.locator('.history-name')).toContainText('Cancel Test');
  });

  test('all history items load without pagination', async ({ page, request }) => {
    await request.get(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&urlKey=${URL_KEY}`);

    // Create 25 history items
    for (let i = 1; i <= 25; i++) {
      const resp = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: `Prompt ${i}`, promptName: `Item ${i}` }
      });
      const { item } = await resp.json();
      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);
    }

    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    // Should show all 25 items at once (no pagination limit)
    const items = page.locator('.history-item');
    await expect(items).toHaveCount(25);

    // No show more button needed
    await expect(page.locator('.history-show-more')).toHaveCount(0);
  });
});
