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

// Home mounts the SAME shared opened-task component as Swipe (LIN-2944 P1). The
// retired inline renderer's selectors (`.label-prompt`, `.suggest-btn`,
// `.prompt-container`, `.recommend-container`, `.more-toggle`) are replaced by
// the component's DOM below — same truth conditions, different markup.
async function openTaskPrompts(page, containerSelector, issueId) {
  await page.locator(`${containerSelector} .line[data-id="${issueId}"]`).first().click();
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  await details.locator('.detail-toggle[data-toggle="prompts"]').click();
  const component = details.locator('.prompt-section');
  await expect(component).toBeVisible();
  return component;
}

/** Pick a template from "other prompts", revealing the more-group if needed. */
async function pickTemplate(component, key) {
  const other = component.locator('[data-testid="other-prompts"]');
  const target = other.locator(`.swipe-prompt-btn[data-prompt="${key}"]`);
  if (!(await target.isVisible().catch(() => false))) {
    await other.locator('[data-prompt="__more__"]').click();
  }
  await target.click();
  await expect(component).toHaveAttribute('data-phase', 'fresh');
}

/** Reveal the "more" group if the target template is currently hidden. */
async function revealTemplate(page, component, key) {
  const other = component.locator('[data-testid="other-prompts"]');
  const target = other.locator(`.swipe-prompt-btn[data-prompt="${key}"]`);
  if (!(await target.isVisible().catch(() => false))) {
    await other.locator('[data-prompt="__more__"]').click();
  }
  return target;
}

test.describe('Templates and the shared opened-task component', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Prompt GET is template/data-driven; the local provider supplies the data.
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('renders the blocked template as a button under "other prompts"', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const button = await revealTemplate(page, component, 'blocked');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('blocked');
  });

  test('regular labels are not templates (they stay metadata text)', async ({ page }) => {
    const taskLine = page.locator('.project .line[data-id="issue-1"]');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    const details = page.locator('.project .details[data-details-for="issue-1"]');
    await details.locator('.detail-toggle[data-toggle="details"]').click();
    await expect(details).toBeVisible();

    const detailsContent = details.locator('.detail-content[data-content="details"]');
    await expect(detailsContent.locator('.detail-meta')).toContainText('feature');
  });

  test('clicking a template renders its prompt in the shared component', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');

    await expect(component.locator('.swipe-prompt-name')).toContainText('blocked');
    await expect(component.locator('[data-prompt-body]')).toContainText('Goal');
  });

  test('the generated prompt contains the issue identifier', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');
    await expect(component.locator('[data-prompt-body]')).toContainText('TEST-');
  });

  test('↻ change returns the component to idle', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');
    await component.locator('[data-action="change"]').first().click();
    await expect(component).toHaveAttribute('data-phase', 'idle');
  });

  test('copy button copies the generated prompt text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');

    const copyButton = component.locator('.swipe-prompt-copy');
    await copyButton.click();
    await expect(copyButton).toHaveText('copied!');
    await expect(copyButton).toHaveText('copy', { timeout: 3000 });
  });

  test('LIN-316: download button saves the prompt as a .md file', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');

    const downloadButton = component.locator('.swipe-prompt-download');
    await expect(downloadButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    // Filename is <identifier>-<promptName>.md (TEST-11 / blocked)
    expect(download.suggestedFilename()).toBe('test-11-blocked.md');
    await expect(downloadButton).toHaveText('saved!');
    await expect(downloadButton).toHaveText('download', { timeout: 3000 });
  });

  test('the copy action exists only once a prompt is loaded', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    // Idle: no action cluster yet.
    await expect(component.locator('.swipe-prompt-copy')).toHaveCount(0);
    await pickTemplate(component, 'blocked');
    await expect(component.locator('.swipe-prompt-copy')).toBeEnabled();
  });

  test('the component has the expected structure', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');
    await expect(component.locator('.swipe-prompt-name')).toBeVisible();
    await expect(component.locator('.swipe-prompt-copy')).toBeVisible();
    await expect(component.locator('[data-prompt-body]')).toBeVisible();
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

// Templates across different labels, all served by the shared component.
test.describe('Templates across labels', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('the blocked template renders in the In Progress section', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await expect(await revealTemplate(page, component, 'blocked')).toBeVisible();
  });

  test('the bug template renders in the project section', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', BUG_ISSUE_ID);
    await expect(await revealTemplate(page, component, 'bug')).toBeVisible();
  });

  test('picking blocked renders the correct prompt', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await pickTemplate(component, 'blocked');
    await expect(component.locator('.swipe-prompt-name')).toContainText('blocked');
    await expect(component.locator('[data-prompt-body]')).toContainText('Goal');
  });

  test('the review template renders in the In Progress section', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);
    await expect(await revealTemplate(page, component, 'review')).toBeVisible();
  });

  test('picking review renders the correct prompt', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);
    await pickTemplate(component, 'review');
    await expect(component.locator('.swipe-prompt-name')).toContainText('review');
    await expect(component.locator('[data-prompt-body]')).toContainText('Goal');
  });
});

// "more ▾" inline expansion, now the shared component's "other prompts" group.
test.describe('Other prompts "more" toggle', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('renders a "more ▾" control when there are hidden templates', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const more = component.locator('[data-testid="other-prompts"] [data-prompt="__more__"]');
    await expect(more).toBeVisible();
    await expect(more).toContainText(/more/i);
  });

  test('clicking "more" reveals hidden templates inline', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const hidden = component.locator('[data-testid="other-prompts"] .swipe-more-prompts');
    await expect(hidden).toBeHidden();
    await component.locator('[data-testid="other-prompts"] [data-prompt="__more__"]').click();
    await expect(hidden).toBeVisible();
    await expect(hidden.locator('.swipe-prompt-btn[data-prompt="bug"]')).toBeVisible();
  });

  test('clicking a revealed template loads it into the component', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await component.locator('[data-testid="other-prompts"] [data-prompt="__more__"]').click();
    await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn[data-prompt="bug"]').click();
    await expect(component).toHaveAttribute('data-phase', 'fresh');
    await expect(component.locator('.swipe-prompt-name')).toContainText('bug');
  });

  test('works in the project section', async ({ page }) => {
    const component = await openTaskPrompts(page, '.project', BUG_ISSUE_ID);
    const more = component.locator('[data-testid="other-prompts"] [data-prompt="__more__"]');
    await expect(more).toBeVisible();
    await more.click();
    await expect(component.locator('[data-testid="other-prompts"] .swipe-more-prompts')).toBeVisible();
  });
});

// =============================================================================
// AI Recommendation (the ✦ next-step primary), via the shared component.
// =============================================================================

test.describe('AI Recommendations', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // The ✦ primary requires OpenRouter to be configured.
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('renders the ✦ primary enabled when OpenRouter is configured', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const go = component.locator('[data-testid="opened-task-go"]');
    await expect(go).toBeVisible();
    await expect(go).toContainText(/next step/i);
    await expect(go).toBeEnabled();
  });

  test('the ✦ primary is disabled with a plain-words reason when OpenRouter is not configured', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Re-seed WITHOUT OpenRouter — the absence of the key is the thing under test,
    // so it must not inherit the block's connected seed.
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    const go = component.locator('[data-testid="opened-task-go"]');
    await expect(go).toBeDisabled();
    await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/needs OpenRouter/i);
  });

  test('the ✦ primary streams reasoning that stays visible, then the prompt', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await component.locator('[data-testid="opened-task-go"]').click();

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
    await component.locator('[data-testid="opened-task-go"]').click();
    await expect(component).toHaveAttribute('data-phase', 'generating');

    release();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });
    await expect(component.locator('[data-testid="opened-task-reasoning"]')).toBeVisible();
  });

  test('↻ change dismisses the generated prompt back to idle', async ({ page }) => {
    const component = await openTaskPrompts(page, '.in-progress-items', BLOCKED_ISSUE_ID);
    await component.locator('[data-testid="opened-task-go"]').click();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });

    await component.locator('[data-action="change"]').first().click();
    await expect(component).toHaveAttribute('data-phase', 'idle');
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
