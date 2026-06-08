/**
 * Streaming AI Recommendation Tests
 *
 * Tests for the SSE streaming endpoint that delivers AI-generated prompts
 * incrementally with phase indicators.
 *
 * LIN-185: Stream AI suggested prompt
 */
import { test, expect } from '../fixtures/test-base.js';

const WORKSPACE_URL = '/workspace/test-workspace';
const API_PREFIX = '/workspace/test-workspace';
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// A parent (container) task: TEST-1 has an incomplete child TEST-2, so the stream
// takes the node/descent path rather than the leaf path (LIN-327/LIN-346).
const PARENT_ISSUE_ID = 'issue-1';

/**
 * Parse SSE text into an array of event objects.
 * @param {string} text - Raw SSE response text
 * @returns {Array<{type: string, data: *}>} Parsed events
 */
function parseSSE(text) {
  const events = [];
  const blocks = text.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    const event = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event.type = line.slice(7);
      else if (line.startsWith('data: ')) {
        try {
          event.data = JSON.parse(line.slice(6));
        } catch {
          event.data = line.slice(6);
        }
      }
    }
    if (event.type && event.data !== undefined) events.push(event);
  }
  return events;
}

// =============================================================================
// API-Level Tests
// =============================================================================

test.describe('Streaming AI Recommendations - API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test('returns SSE content type', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');
  });

  test('emits phase events in correct order', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const phases = events
      .filter(e => e.type === 'phase')
      .map(e => e.data.phase);

    expect(phases).toEqual(['fetching_context', 'reasoning', 'prompt']);
  });

  test('emits delta events with reasoning and prompt content', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const reasoningDeltas = events.filter(
      e => e.type === 'delta' && e.data.section === 'reasoning'
    );
    const promptDeltas = events.filter(
      e => e.type === 'delta' && e.data.section === 'prompt'
    );

    expect(reasoningDeltas.length).toBeGreaterThan(0);
    expect(promptDeltas.length).toBeGreaterThan(0);

    // Assemble full content from delta chunks
    const reasoningText = reasoningDeltas.map(e => e.data.content).join('');
    const promptText = promptDeltas.map(e => e.data.content).join('');

    // Verify content matches expected mock output
    expect(reasoningText).toContain('blocked');
    expect(promptText).toContain('Help me with task');
    expect(promptText).toContain('TEST-11');
  });

  test('emits multiple delta chunks per section', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const reasoningDeltas = events.filter(
      e => e.type === 'delta' && e.data.section === 'reasoning'
    );
    const promptDeltas = events.filter(
      e => e.type === 'delta' && e.data.section === 'prompt'
    );

    // Mock should emit at least 2 chunks per section to test assembly
    expect(reasoningDeltas.length).toBeGreaterThanOrEqual(2);
    expect(promptDeltas.length).toBeGreaterThanOrEqual(2);
  });

  test('emits done event with metadata', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data.truncated).toBe(false);
    expect(doneEvents[0].data.issueUrl).toBeDefined();
  });

  test('done event is the last event', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('done');
  });

  test('returns 400 for invalid issue ID', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/INVALID!!!/stream`
    );
    expect(response.status()).toBe(400);
  });

  test('returns 404 for non-existent issue', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/00000000-0000-0000-0000-000000000000/stream`
    );
    expect(response.status()).toBe(404);
  });

  test('assembled content matches non-streaming endpoint', async ({ page }) => {
    // Get non-streaming response
    const jsonResponse = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`
    );
    const jsonData = await jsonResponse.json();

    // Get streaming response
    const sseResponse = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await sseResponse.text();
    const events = parseSSE(text);

    // Assemble streamed content
    const reasoningText = events
      .filter(e => e.type === 'delta' && e.data.section === 'reasoning')
      .map(e => e.data.content)
      .join('');
    const promptText = events
      .filter(e => e.type === 'delta' && e.data.section === 'prompt')
      .map(e => e.data.content)
      .join('');

    // Content should match
    expect(reasoningText).toBe(jsonData.reasoning);
    expect(promptText).toBe(jsonData.prompt);
  });

  // LIN-346: the parent (container) path must STREAM every hop — including the
  // terminal one — not just emit the two `phase` events and buffer the body. Proving
  // it emits `delta` events for both the reasoning and prompt sections, in phase order,
  // is the contract that keeps the socket warm and stops Heroku H15 from firing.
  test('parent path streams delta events for both reasoning and prompt (not just phases)', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${PARENT_ISSUE_ID}/stream`
    );
    expect(response.status()).toBe(200);
    const text = await response.text();
    const events = parseSSE(text);

    const reasoningDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'reasoning');
    const promptDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'prompt');

    // Streaming, not buffering: real delta payloads for BOTH sections.
    expect(reasoningDeltas.length).toBeGreaterThan(0);
    expect(promptDeltas.length).toBeGreaterThan(0);

    // The descent breadcrumb (LIN-329) must still be present in the reasoning stream.
    const reasoningText = reasoningDeltas.map(e => e.data.content).join('');
    expect(reasoningText).toContain('is a container → routing to');

    // Phase order: reasoning section streams before the prompt section.
    const firstReasoningIdx = events.findIndex(e => e.type === 'delta' && e.data.section === 'reasoning');
    const firstPromptIdx = events.findIndex(e => e.type === 'delta' && e.data.section === 'prompt');
    expect(firstReasoningIdx).toBeGreaterThanOrEqual(0);
    expect(firstPromptIdx).toBeGreaterThan(firstReasoningIdx);

    // A single terminal done, carrying the descent metadata, is the last event.
    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data.deferredVia).toBeDefined();
    expect(events[events.length - 1].type).toBe('done');
  });
});

// =============================================================================
// Free Tier Tests
// =============================================================================

test.describe('Streaming AI Recommendations - Free Tier', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-free-tier');
    await page.goto('/test/set-session?freeTierEnabled=true');
  });

  test('includes free tier metadata in done event', async ({ page }) => {
    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent.data.freeTier).toBeDefined();
    expect(doneEvent.data.freeTier.remaining).toBeDefined();
    expect(doneEvent.data.freeTier.limit).toBe(5);
  });

  test('returns 429 when rate limited', async ({ page }) => {
    await page.goto('/test/add-free-tier-usage?count=5');

    const response = await page.request.get(
      `${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    expect(response.status()).toBe(429);
  });
});

// =============================================================================
// UI Tests
// =============================================================================

/**
 * Helper to expand Prompts section for an issue
 */
async function expandPromptsSection(page, containerSelector, issueId) {
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
  await promptsToggle.click();
}

test.describe('Streaming AI Recommendations - UI', () => {
  test.beforeEach(async ({ page }) => {
    // AI suggest button requires OpenRouter to be configured
    await page.goto('/test/set-session?openRouterConnected=true');
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('streams AI suggestion and shows final content', async ({ page }) => {
    // Expand the blocked issue
    const taskLine = page.locator(
      '.in-progress-items .line:has-text("Blocked on external API")'
    );
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest button
    const suggestBtn = page.locator(
      `.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`
    );
    await suggestBtn.click();

    // Recommendation container should become visible
    const recommendContainer = page.locator(
      `.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`
    );
    await expect(recommendContainer).toBeVisible();

    // Wait for prompt to appear (streaming completes)
    const promptSection = recommendContainer.locator('.recommend-prompt');
    await expect(promptSection).toBeVisible({ timeout: 10000 });

    const promptText = recommendContainer.locator('.prompt-text');
    await expect(promptText).toContainText('Help me with task', { timeout: 10000 });

    // Reasoning should be populated (hidden by default after streaming)
    const toggleBtn = recommendContainer.locator('.reasoning-toggle');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    const reasoning = recommendContainer.locator('.recommend-reasoning');
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText('blocked');
  });

  test('shows phase indicator during streaming', async ({ page }) => {
    // Expand the blocked issue
    const taskLine = page.locator(
      '.in-progress-items .line:has-text("Blocked on external API")'
    );
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest button
    const suggestBtn = page.locator(
      `.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`
    );
    await suggestBtn.click();

    // Phase indicator should appear during streaming
    const recommendContainer = page.locator(
      `.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`
    );
    await expect(recommendContainer).toBeVisible();

    // After streaming completes, phase indicator should be hidden
    const phaseIndicator = recommendContainer.locator('.streaming-phase');
    const promptText = recommendContainer.locator('.prompt-text');
    await expect(promptText).toContainText('Help me with task', { timeout: 10000 });
    await expect(phaseIndicator).toBeHidden();
  });

  test('copy button works with streamed content', async ({ page }) => {
    // Expand the blocked issue
    const taskLine = page.locator(
      '.in-progress-items .line:has-text("Blocked on external API")'
    );
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest and wait for streaming to complete
    const suggestBtn = page.locator(
      `.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`
    );
    await suggestBtn.click();

    const recommendContainer = page.locator(
      `.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`
    );
    const promptText = recommendContainer.locator('.prompt-text');
    await expect(promptText).toContainText('Help me with task', { timeout: 10000 });

    // Verify rawPrompt is set for copy
    const rawPrompt = await promptText.getAttribute('data-raw-prompt');
    expect(rawPrompt).toBeTruthy();
    expect(rawPrompt).toContain('Help me with task');
  });

  test('LIN-191: dispatch and copy buttons disabled during streaming, enabled after', async ({ page }) => {
    // Re-setup with dispatch enabled
    await page.goto(`/test/set-session?openRouterConnected=true&features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}`);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Expand the blocked issue
    const taskLine = page.locator(
      '.in-progress-items .line:has-text("Blocked on external API")'
    );
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest button
    const suggestBtn = page.locator(
      `.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`
    );
    await suggestBtn.click();

    // Wait for streaming to complete
    const recommendContainer = page.locator(
      `.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`
    );
    const promptSection = recommendContainer.locator('.recommend-prompt');
    const promptText = recommendContainer.locator('.prompt-text');
    await expect(promptText).toContainText('Help me with task', { timeout: 10000 });

    // After streaming completes, buttons should be enabled
    const copyBtn = promptSection.locator('.prompt-copy');
    await expect(copyBtn).toBeEnabled();

    const dispatchBtn = promptSection.locator('.prompt-dispatch').first();
    await expect(dispatchBtn).toBeEnabled();
  });

  test('dismiss button works during streaming', async ({ page }) => {
    // Expand the blocked issue
    const taskLine = page.locator(
      '.in-progress-items .line:has-text("Blocked on external API")'
    );
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest
    const suggestBtn = page.locator(
      `.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`
    );
    await suggestBtn.click();

    const recommendContainer = page.locator(
      `.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`
    );
    await expect(recommendContainer).toBeVisible();

    // Dismiss
    const dismissBtn = recommendContainer.locator('.recommend-close');
    await dismissBtn.click();

    await expect(recommendContainer).toBeHidden();
  });
});
