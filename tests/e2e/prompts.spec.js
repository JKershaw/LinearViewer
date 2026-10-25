import { test, expect } from '../fixtures/test-base.js';
import {
  workspaceApiLocalSeed,
} from '../fixtures/local-harness.js';

// UUIDs for test issues — workspaceApiLocalSeed shares the linear fixture's
// identity, so these resolve unchanged on the local provider (LIN-406).
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BUG_ISSUE_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddde';
const PLAN_ISSUE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef';
const CODE_REVIEW_ISSUE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// LIN-3833: Home's opened task is state first. A viewer with no runner (this local workspace) gets the
// copy-first view: the step is named from the task's status alone (Todo: Plan), "✦ Write the prompt" is the
// one control, then Copy, the bounded box with Rewrite and Download. There is no template list on Home any
// more: Swipe's card keeps its own. TEST-13 is Todo, so its step needs no AI.
const TODO_ISSUE_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddde';

async function openTaskPrompts(page, containerSelector, issueId) {
  await page.locator(`${containerSelector} .line[data-id="${issueId}"]`).first().click();
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  // The opened task's control is part of the task: no Prompts fold to open.
  const component = details.locator('.prompt-section');
  await expect(component).toBeVisible();
  return component;
}

/** Write the step's prompt (the copy-first "✦ Write the prompt") and wait for it to land. */
async function writePrompt(component) {
  await component.locator('[data-testid="opened-task-write"]').click();
  await expect(component).toHaveAttribute('data-phase', 'fresh');
}

test.describe('The opened task on Home, copy-first (LIN-3833)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Prompt GET is template/data-driven; the local provider supplies the data.
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('a Todo task names its step from its status: Plan, written by "✦ Write the prompt"', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    const write = component.locator('[data-testid="opened-task-write"]');
    await expect(write).toBeVisible();
    await expect(write).toHaveAttribute('data-prompt', 'plan');
    await expect(component.locator('[data-testid="opened-task-step"]')).toContainText('the first step for a task in Todo');
  });

  test('the copy action exists only once a prompt is written', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await expect(component.locator('[data-testid="opened-task-copy"]')).toHaveCount(0);
    await writePrompt(component);
    await expect(component.locator('[data-testid="opened-task-copy"]')).toBeEnabled();
  });

  test('the written prompt names the issue identifier, in the bounded box', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await writePrompt(component);
    await expect(component.locator('.opened-task-box [data-prompt-body]')).toContainText('TEST-');
  });

  test('copy button copies the written prompt text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await writePrompt(component);

    const copyButton = component.locator('[data-testid="opened-task-copy"]');
    await copyButton.click();
    await expect(copyButton).toHaveText('copied!');
  });

  test('LIN-316: download button saves the prompt as a .md file', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await writePrompt(component);

    const downloadButton = component.locator('[data-action="download"]');
    await expect(downloadButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    // Filename is <identifier>-<promptName>.md (TEST-13 / plan)
    expect(download.suggestedFilename()).toBe('test-13-plan.md');
  });

  test('Rewrite writes the step again: the view goes back through generating to a fresh prompt', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await writePrompt(component);
    await component.locator('.opened-task-regenerate').click();
    await expect(component).toHaveAttribute('data-phase', 'fresh');
    await expect(component.locator('[data-testid="opened-task-copy"]')).toBeVisible();
  });

  test('the copy-first view has the expected structure', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', TODO_ISSUE_ID);
    await writePrompt(component);
    await expect(component.locator('[data-testid="opened-task-copy"]')).toBeVisible();
    await expect(component.locator('[data-prompt-body]')).toBeVisible();
    await expect(component.locator('[data-testid="opened-task-progress-key"]')).toBeVisible();
  });
});

test.describe('Prompt API', () => {
  test.beforeEach(async ({ page, seedLocal }) => {
    // Prompt GET short-circuits 400/404 before any data fetch; positive GETs are
    // served by the local provider.
    await seedLocal(workspaceApiLocalSeed);
  });

  // NOTE: the 401-unauthenticated negative path is dropped on migration (LIN-406),
  // mirroring the sibling brief/recap migrations. It exercises the shared auth
  // middleware (lib/errors.js `unauthorized`), not the prompt surface, and is not
  // expressible on a session-scoped local workspace — clearing the session removes
  // the workspace itself (→ 404 at workspaceFromUrl, before any auth check). The
  // generic 401 contract stays covered on the PAT/Linear path (audit.spec.js).

  // NOTE: the recommend-stream parent-descent contract (LIN-327) lives in
  // streaming.spec.js ('parent path streams delta events …'); it was duplicate
  // coverage mis-filed under Prompt API and is dropped here on migration (LIN-406).

  test('returns 404 for unknown label', async ({ page, localWorkerUrlKey }) => {
    // Use valid UUID format so we get to the label check
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/unknown-label`);
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('No prompt template');
  });

  test('returns 400 for invalid issue ID format', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/INVALID!!!/blocked`);
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid issue ID format');
  });

  test('returns 404 for removed phase labels', async ({ page, localWorkerUrlKey }) => {
    // Old phase labels should no longer have templates
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/in-breakdown`);
    expect(response.status()).toBe(404);
  });

  test('returns blocked prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.promptName).toBe('blocked');
    expect(body.prompt).toContain('# Unblock TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('LIN-316: ?format=md returns prompt as a downloadable markdown file', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/blocked?format=md`);
    expect(response.status()).toBe(200);

    // Markdown content type + attachment headers
    expect(response.headers()['content-type']).toContain('text/markdown');
    expect(response.headers()['content-disposition']).toContain('attachment');
    expect(response.headers()['content-disposition']).toContain('test-11-blocked.md');

    // Body is the bare prompt string (not a JSON envelope)
    const body = await response.text();
    expect(body).toContain('# Unblock TEST-');
    expect(body).toContain('## Goal');
    expect(body.trimStart().startsWith('{')).toBe(false);
  });

  test('LIN-316: prompt route still returns JSON without ?format=md', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.prompt).toContain('# Unblock TEST-');
  });

  test('returns bug prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BUG_ISSUE_ID}/bug`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('bug');
    expect(body.promptName).toBe('bug');
    expect(body.prompt).toContain('# Investigate bug TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns plan prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${PLAN_ISSUE_ID}/plan`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('plan');
    expect(body.promptName).toBe('plan');
    expect(body.prompt).toContain('# Plan TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns review prompt (code-review consolidated into review — LIN-523)', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${CODE_REVIEW_ISSUE_ID}/review`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('review');
    expect(body.promptName).toBe('review');
    expect(body.prompt).toContain('# Review TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns look-into prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/look-into`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('look-into');
    expect(body.promptName).toBe('look into');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns triage prompt', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/prompt/${BLOCKED_ISSUE_ID}/triage`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('triage');
    expect(body.promptName).toBe('triage');
    expect(body.prompt).toContain('## Goal');
  });
});

// LIN-3833: the Home template chips and the "other prompts" more-toggle are gone from the opened task (a
// run-controls viewer picks a step under "Another step"; a copy-first viewer gets the status step). Swipe's
// card keeps its own template list.

test.describe('AI Recommendations', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // The ✦ primary requires OpenRouter to be configured.
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('renders the ✦ primary enabled when OpenRouter is configured', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const go = component.locator('[data-testid="opened-task-write"]');
    await expect(go).toBeVisible();
    await expect(go).toContainText(/write the prompt/i);
    await expect(go).toBeEnabled();
  });

  test('the ✦ primary is disabled with a plain-words reason when OpenRouter is not configured', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Re-seed WITHOUT OpenRouter — the absence of the key is the thing under test,
    // so it must not inherit the block's connected seed.
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const go = component.locator('[data-testid="opened-task-write"]');
    await expect(go).toBeDisabled();
    await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/needs OpenRouter/i);
  });

  test('the ✦ primary streams reasoning that stays visible, then the prompt', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await component.locator('[data-testid="opened-task-write"]').click();

    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });
    // LIN-2944 reverses LIN-70: reasoning stays visible by default.
    await expect(component.locator('[data-testid="opened-task-reasoning"]')).toBeVisible();
    await expect(component.locator('[data-prompt-body]')).not.toBeEmpty();
  });

  test('the generating phase is shown while the recommend stream is held', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/recommend/*/stream*', async (route) => {
      await held;
      await route.continue();
    });

    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await component.locator('[data-testid="opened-task-write"]').click();
    await expect(component).toHaveAttribute('data-phase', 'generating');

    release();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });
    await expect(component.locator('[data-testid="opened-task-reasoning"]')).toBeVisible();
  });

});

// =============================================================================
// Recommendation API Tests
// =============================================================================

test.describe('Recommendation API', () => {
  test.beforeEach(async ({ page, seedLocal }) => {
    // openRouterConnected is required: on a local session isTestMode is false, so
    // GET /api/recommend/status reports enabled:true only with the session key.
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
  });

  // NOTE: the 401-unauthenticated negative path is dropped on migration (LIN-406) —
  // see the Prompt API block: it tests shared auth middleware, not the recommend
  // surface, and is not expressible on a session-scoped local workspace.

  test('returns 400 for invalid issue ID format', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/INVALID!!!`);
    expect(response.status()).toBe(400);
  });

  test('returns 200 with generated prompt for valid request', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.reasoning).toBeDefined();
    expect(body.prompt).toBeDefined();
    expect(typeof body.reasoning).toBe('string');
    expect(typeof body.prompt).toBe('string');
    expect(body.reasoning.length).toBeGreaterThan(0);
    expect(body.prompt.length).toBeGreaterThan(0);
    // Check truncation metadata fields
    expect(body.truncated).toBe(false);
    expect(body.completionTokens).toBeNull(); // null for mock responses
  });

  test('returns contextual prompt based on labels', async ({ page, localWorkerUrlKey }) => {
    // Bug-labelled issue — the label drives the contextual reasoning. (LIN-357:
    // the `blocked` label was abolished, so `bug` is the remaining label signal.)
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BUG_ISSUE_ID}`);
    const body = await response.json();

    // Should mention bug in reasoning
    expect(body.reasoning.toLowerCase()).toContain('bug');
    // Prompt should include the issue identifier and goal section
    expect(body.prompt).toContain('TEST-13');
    expect(body.prompt).toContain('Goal');
  });

  test('returns status endpoint correctly', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.enabled).toBe('boolean');
    // In test mode, should be enabled
    expect(body.enabled).toBe(true);
  });

  test('returns issueUrl field', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect('issueUrl' in body).toBe(true);
    expect(typeof body.issueUrl).toBe('string');
  });
});
