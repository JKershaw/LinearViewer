/**
 * Streaming AI Recommendation Tests
 *
 * Tests for the SSE streaming endpoint that delivers AI-generated prompts
 * incrementally with phase indicators.
 *
 * LIN-185: Stream AI suggested prompt
 * LIN-405: Migrated onto a GENUINE `provider: 'local'` session seeded from
 * `workspaceApiLocalSeed`, not the `test-token` + `testMockData` mock
 * short-circuit. The AI mock (generateMockRecommendation + mock SSE) still fires
 * because `shouldMockAi` re-gates it onto local sessions (#388/#399); the recommend
 * routes now read their DATA from the provider. The test-token 503 'AI not
 * configured' coverage stays on its own (non-local) path, untouched.
 */
import { test, expect } from '../fixtures/test-base.js';
import {
  workspaceApiLocalSeed,
} from '../fixtures/local-harness.js';

// TEST-11: a leaf task labelled `blocked` → hits the leaf fast-path of the stream.
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// A parent (container) task: TEST-1 (issue-1) has an incomplete child TEST-2, so the
// stream takes the node/descent path rather than the leaf path (LIN-327/LIN-346).
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
  test.beforeEach(async ({ page, seedLocal }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { proxy: false } });
  });

  test('returns SSE content type', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');
  });

  test('emits phase events in correct order', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const phases = events
      .filter(e => e.type === 'phase')
      .map(e => e.data.phase);

    expect(phases).toEqual(['fetching_context', 'reasoning', 'prompt']);
  });

  test('emits delta events with reasoning and prompt content', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
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

    // Verify content matches expected mock output. (LIN-357: TEST-11's blocked
    // LABEL was abolished and the local provider doesn't surface the blocking
    // relationship to the curated issue, so the deterministic mock yields the
    // generic overview reasoning — assert it streamed, not its keyword.)
    expect(reasoningText.length).toBeGreaterThan(0);
    expect(promptText).toContain('Help me with task');
    expect(promptText).toContain('TEST-11');
  });

  test('emits multiple delta chunks per section', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
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

  test('emits done event with metadata', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data.truncated).toBe(false);
    expect(doneEvents[0].data.issueUrl).toBeDefined();
  });

  test('done event is the last event', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    const text = await response.text();
    const events = parseSSE(text);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('done');
  });

  test('returns 400 for invalid issue ID', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/INVALID!!!/stream`
    );
    expect(response.status()).toBe(400);
  });

  test('returns 404 for non-existent issue', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/00000000-0000-0000-0000-000000000000/stream`
    );
    expect(response.status()).toBe(404);
  });

  test('assembled content matches non-streaming endpoint', async ({ page, localWorkerUrlKey }) => {
    // Get non-streaming response
    const jsonResponse = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`
    );
    const jsonData = await jsonResponse.json();

    // Get streaming response
    const sseResponse = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
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
  test('parent path streams delta events for both reasoning and prompt (not just phases)', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${PARENT_ISSUE_ID}/stream`
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
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Seed a local session in free-tier mode (no key, session flag) so charging
    // rides the session-flag path — CI sets no OPENROUTER_FREE_TIER_KEY (LIN-405).
    // Clear THIS workspace's counter (the route charges workspace.urlKey).
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true, features: { proxy: false } });
    await page.goto(`/test/clear-free-tier?urlKey=${localWorkerUrlKey}`);
  });

  test('the done event carries no retired daily prompt quota (LIN-3239)', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    expect(response.status()).toBe(200);
    const events = parseSSE(await response.text());

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    // The per-workspace daily prompt quota is retired; prompts are unlimited and
    // the done event no longer carries a 200-response `freeTier` meter.
    expect(doneEvent.data.freeTier).toBeUndefined();
  });

  test('a pre-filled daily count does not refuse the stream (daily quota retired)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/test/add-free-tier-usage?count=5&urlKey=${localWorkerUrlKey}`);

    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}/stream`
    );
    // The old per-workspace daily cap (5) no longer refuses prompts.
    expect(response.status()).toBe(200);
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
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // The ✦ primary requires OpenRouter to be configured.
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { proxy: false } });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  /** Expand the blocked issue's Prompts section and press ✦ next step. */
  async function pressGo(page) {
    await page.locator('.in-progress-items .line:has-text("Blocked on external API")').click();
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const component = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .prompt-section`);
    await expect(component).toBeVisible();
    await component.locator('[data-testid="opened-task-next-step"]').click();
    return component;
  }

  test('streams AI suggestion and shows final content', async ({ page }) => {
    const component = await pressGo(page);

    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
    await expect(component.locator('[data-prompt-body]')).toContainText('Help me with task', { timeout: 10000 });

    // LIN-2944 reverses LIN-70: reasoning stays VISIBLE by default.
    const reasoning = component.locator('[data-testid="opened-task-reasoning"]');
    await expect(reasoning).toBeVisible();
    await expect(reasoning).not.toBeEmpty();
  });

  test('shows the generating phase while the stream is held', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/recommend/*/stream*', async (route) => {
      await held;
      await route.continue();
    });

    const component = await pressGo(page);
    await expect(component).toHaveAttribute('data-phase', 'generating');
    await expect(component.locator('[data-prompt-body]')).toContainText('Loading');

    release();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
  });

  test('copy button copies the streamed content', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const component = await pressGo(page);
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
    await expect(component.locator('[data-prompt-body]')).toContainText('Help me with task');

    await component.locator('.swipe-prompt-copy').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Help me with task');
  });

  test('LIN-191: no actionable copy/dispatch until the prompt is ready', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, {
      openRouterConnected: true,
      features: { dispatch: true, proxy: false },
    });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/recommend/*/stream*', async (route) => {
      await held;
      await route.continue();
    });

    const component = await pressGo(page);
    await expect(component).toHaveAttribute('data-phase', 'generating');
    // While generating there is no actionable copy affordance.
    await expect(component.locator('.swipe-prompt-copy')).toHaveCount(0);

    release();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
    await expect(component.locator('.swipe-prompt-copy')).toBeEnabled();
    await expect(component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]')).toBeEnabled();
  });

  test('↻ change cancels an in-flight stream back to idle', async ({ page }) => {
    // Gate the shared reader: emit the reasoning, then hold until the test acts.
    await page.evaluate(() => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      window.__releaseStream = () => release();
      window.readSSEStream = async (response, onEvent) => {
        if (response.body) response.body.cancel().catch(() => {});
        onEvent('message', { phase: 'reasoning' });
        onEvent('message', { section: 'reasoning', content: 'Working it out.\n' });
        await gate;
      };
    });

    const component = await pressGo(page);
    await expect(component).toHaveClass(/streaming/);
    // Mid-stream the reasoning streams INTO the body ([data-prompt-body]).
    await expect(component.locator('[data-prompt-body]')).toContainText('Working it out');

    // ↻ change mid-stream aborts the request and returns to idle.
    await component.locator('[data-action="change"]').first().click();
    await expect(component).toHaveAttribute('data-phase', 'idle');
    await expect(component).not.toHaveClass(/streaming/);
  });

  test('↻ change dismisses the generated prompt back to idle', async ({ page }) => {
    const component = await pressGo(page);
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

    await component.locator('[data-action="change"]').first().click();
    await expect(component).toHaveAttribute('data-phase', 'idle');
  });
});
