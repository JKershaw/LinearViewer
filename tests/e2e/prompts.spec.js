import { test, expect } from '../fixtures/test-base.js';
import {
  seedLocalWorkspace,
  workspaceApiLocalSeed,
  LOCAL_WORKSPACE_URL_KEY,
} from '../fixtures/local-harness.js';

// UUIDs for test issues — workspaceApiLocalSeed shares the linear fixture's
// identity, so these resolve unchanged on the local provider (LIN-406).
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BUG_ISSUE_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddde';
const PLAN_ISSUE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef';
const CODE_REVIEW_ISSUE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// Local-provider workspace seeded via /test/set-local-session (LIN-406).
const URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const WORKSPACE_URL = `/workspace/${URL_KEY}/`;
const API_PREFIX = `/workspace/${URL_KEY}`;

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
 * Helper to expand Details section for an issue
 * Use after clicking the task line to expand details
 */
async function expandDetailsSection(page, containerSelector, issueId) {
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
  await detailsToggle.click();
}

/**
 * Helper to reveal hidden prompts behind "more" toggle
 * Use after expanding the Prompts section
 */
async function clickMoreToggle(page, containerSelector, issueId) {
  const moreToggle = page.locator(`${containerSelector} .more-toggle[data-issue-id="${issueId}"]`);
  await moreToggle.click();
}

test.describe('Promptable Labels', () => {
  test.beforeEach(async ({ page }) => {
    // Prompt GET is template/data-driven; the local provider supplies the data.
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders blocked label as clickable link', async ({ page }) => {
    // Blocked task is in-progress, so it appears in the In Progress section
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // Expand Prompts section to reveal prompt buttons
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Find the label link in the specific issue's details panel
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
    await expect(labelLink).toHaveText('blocked');
  });

  test('regular labels are not clickable', async ({ page }) => {
    // Find the task with feature label in project section (not in-progress section)
    const taskLine = page.locator('.project .line[data-id="issue-1"]');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // Expand Details section to reveal metadata
    await expandDetailsSection(page, '.project', 'issue-1');

    // The feature label should be text, not a link
    const details = page.locator('.project .details[data-details-for="issue-1"]');
    await expect(details).toBeVisible();

    // Feature should appear as plain text, not as a .label-prompt link in Details section
    const detailsContent = details.locator('.detail-content[data-content="details"]');
    const labelLink = detailsContent.locator('.label-prompt[data-label="feature"]');
    await expect(labelLink).toHaveCount(0);

    // But feature text should appear in metadata within Details section
    await expect(detailsContent.locator('.detail-meta')).toContainText('feature');
  });

  test('clicking promptable label shows prompt container', async ({ page }) => {
    // Find and expand the task with blocked label
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load (not showing "Loading...")
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Should show prompt name
    const promptName = promptContainer.locator('.prompt-name');
    await expect(promptName).toContainText('blocked');

    // Should show prompt text (now rendered as HTML, so headers don't have ##)
    const promptText = promptContainer.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    await expect(promptText).toContainText('Goal');
  });

  test('prompt contains issue identifier', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptText = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"] .prompt-text`);
    await expect(promptText).not.toContainText('Loading', { timeout: 10000 });

    // Prompt should contain the task identifier
    await expect(promptText).toContainText('TEST-');
  });

  test('clicking label again hides prompt container', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label to show
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for container to appear
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Click again to hide
    await labelLink.click();
    await expect(promptContainer).toBeHidden();
  });

  test('copy button copies prompt text', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Find and expand the task
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
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

  test('LIN-316: download button saves prompt as a .md file', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Click download and capture the triggered download
    const downloadButton = promptContainer.locator('.prompt-download');
    await expect(downloadButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    // Filename is <identifier>-<promptName>.md (TEST-11 / blocked)
    expect(download.suggestedFilename()).toBe('test-11-blocked.md');

    // Button gives "saved!" feedback then reverts
    await expect(downloadButton).toHaveText('saved!');
    await expect(downloadButton).toHaveText('download', { timeout: 3000 });
  });

  test('LIN-191: copy button enabled only after prompt loads', async ({ page }) => {
    // Find and expand the task with blocked label
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Copy button should now be enabled
    const copyButton = promptContainer.locator('.prompt-copy');
    await expect(copyButton).toBeEnabled();
  });

  test('prompt container has correct structure', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click the promptable label
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    // Wait for container and prompt to load
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
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
    // Prompt GET short-circuits 400/404 before any data fetch; positive GETs are
    // served by the local provider.
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
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

  test('returns 404 for unknown label', async ({ page }) => {
    // Use valid UUID format so we get to the label check
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/unknown-label`);
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('No prompt template');
  });

  test('returns 400 for invalid issue ID format', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/INVALID!!!/blocked`);
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid issue ID format');
  });

  test('returns 404 for removed phase labels', async ({ page }) => {
    // Old phase labels should no longer have templates
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/in-breakdown`);
    expect(response.status()).toBe(404);
  });

  test('returns blocked prompt', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.promptName).toBe('blocked');
    expect(body.prompt).toContain('# Unblock TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('LIN-316: ?format=md returns prompt as a downloadable markdown file', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/blocked?format=md`);
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

  test('LIN-316: prompt route still returns JSON without ?format=md', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.prompt).toContain('# Unblock TEST-');
  });

  test('returns bug prompt', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BUG_ISSUE_ID}/bug`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('bug');
    expect(body.promptName).toBe('bug');
    expect(body.prompt).toContain('# Investigate bug TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns plan prompt', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${PLAN_ISSUE_ID}/plan`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('plan');
    expect(body.promptName).toBe('plan');
    expect(body.prompt).toContain('# Plan TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns review prompt (code-review consolidated into review — LIN-523)', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${CODE_REVIEW_ISSUE_ID}/review`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('review');
    expect(body.promptName).toBe('review');
    expect(body.prompt).toContain('# Review TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns look-into prompt', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/look-into`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('look-into');
    expect(body.promptName).toBe('look into');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns triage prompt', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/prompt/${BLOCKED_ISSUE_ID}/triage`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('triage');
    expect(body.promptName).toBe('triage');
    expect(body.prompt).toContain('## Goal');
  });
});

// Tests for promptable label rendering across different labels
test.describe('Multiple Promptable Labels UI', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders blocked as clickable link in in-progress section', async ({ page }) => {
    // Blocked task is in-progress, so it appears in the In Progress section
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Use specific issue ID to avoid ambiguity (task appears in both In Progress and Project sections)
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('renders bug as clickable link', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Login fails with special characters")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.project', BUG_ISSUE_ID);

    // Reveal hidden prompts (bug is behind "more")
    await clickMoreToggle(page, '.project', BUG_ISSUE_ID);

    // Use specific issue ID to avoid ambiguity (bug label also exists on completed issue-3)
    const labelLink = page.locator(`.label-prompt[data-label="bug"][data-issue-id="${BUG_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('clicking blocked shows correct prompt', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Reveal hidden prompts (blocked is behind "more")
    await clickMoreToggle(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await expect(promptContainer.locator('.prompt-name')).toContainText('blocked');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Goal');
  });

  test('renders review as clickable link in in-progress section', async ({ page }) => {
    // Issue is in "In Review" state (started), so it appears in In Progress section.
    // review is the universal quality gate (code-review was consolidated into it — LIN-523).
    const taskLine = page.locator('.in-progress-items .line:has-text("Refactor authentication module")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);

    // Reveal hidden prompts (review is behind "more")
    await clickMoreToggle(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="review"][data-issue-id="${CODE_REVIEW_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('clicking review shows correct prompt', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Refactor authentication module")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);

    // Reveal hidden prompts (review is behind "more")
    await clickMoreToggle(page, '.in-progress-items', CODE_REVIEW_ISSUE_ID);

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="review"][data-issue-id="${CODE_REVIEW_ISSUE_ID}"]`);
    await labelLink.click();

    // Use more specific locator since issue appears in both In Progress and Project sections
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${CODE_REVIEW_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await expect(promptContainer.locator('.prompt-name')).toContainText('review');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Goal');
  });
});

// Tests for "more" inline expansion feature
test.describe('More Prompts Inline', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders "more" link for issues with additional prompts', async ({ page }) => {
    // Expand an issue that has promptable labels
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Should show "more" link inline with other labels
    const moreLink = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .more-toggle`);
    await expect(moreLink).toBeVisible();
    await expect(moreLink).toHaveText('more');
  });

  test('clicking "more" reveals hidden prompts inline', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Hidden prompts should not be visible initially
    const hiddenPrompts = page.locator(`.in-progress-items [data-more-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(hiddenPrompts).toBeHidden();

    // Click "more"
    const moreLink = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .more-toggle`);
    await moreLink.click();

    // Hidden prompts should now be visible
    await expect(hiddenPrompts).toBeVisible();

    // "more" link should be removed
    await expect(moreLink).toHaveCount(0);

    // Check a revealed prompt is visible (most prompts are behind "more")
    await expect(hiddenPrompts.locator('.label-prompt:has-text("bug")')).toBeVisible();
  });

  test('clicking revealed prompt loads it into container', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click "more" to reveal prompts
    const moreLink = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .more-toggle`);
    await moreLink.click();

    // Click a revealed prompt
    const bugLink = page.locator(`.in-progress-items [data-more-for="${BLOCKED_ISSUE_ID}"] .label-prompt[data-label="bug"]`);
    await bugLink.click();

    // Prompt container should show the prompt
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });
    await expect(promptContainer.locator('.prompt-name')).toContainText('bug');
  });

  test('works in project section', async ({ page }) => {
    // Bug issue appears in project section
    const projectLine = page.locator('.project .line:has-text("Login fails with special characters")');
    await projectLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.project', BUG_ISSUE_ID);

    // Should have "more" link
    const moreLink = page.locator(`.project .details[data-details-for="${BUG_ISSUE_ID}"] .more-toggle`);
    await expect(moreLink).toBeVisible();

    // Click to reveal
    await moreLink.click();

    const hiddenPrompts = page.locator(`.project [data-more-for="${BUG_ISSUE_ID}"]`);
    await expect(hiddenPrompts).toBeVisible();
  });
});

// =============================================================================
// AI Recommendation Tests
// =============================================================================

test.describe('AI Recommendations', () => {
  test.beforeEach(async ({ page }) => {
    // AI suggest button requires OpenRouter to be configured
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { openRouterConnected: true });
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders AI suggest button for each issue when OpenRouter is configured', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Should have AI suggest button
    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await expect(suggestBtn).toBeVisible();
    await expect(suggestBtn).toHaveText('AI suggest');
  });

  test('AI suggest button is hidden when OpenRouter is not configured', async ({ page }) => {
    // Re-seed WITHOUT OpenRouter — the absence of the key is the thing under test,
    // so it must not inherit the block's connected seed.
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Should NOT have AI suggest button (it's not rendered, not just hidden)
    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await expect(suggestBtn).toHaveCount(0);
  });

  test('clicking suggest button shows recommendation container', async ({ page }) => {
    // Intercept the recommend API to add delay so we can test loading state
    let resolveDelay;
    const delayPromise = new Promise(resolve => { resolveDelay = resolve; });

    await page.route(`**/api/recommend/${BLOCKED_ISSUE_ID}/stream`, async (route) => {
      // Wait for our signal before continuing with the request
      await delayPromise;
      await route.continue();
    });

    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    // Recommendation container should appear
    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Reasoning shows "Analyzing..." during loading, then hides after loading
    const reasoning = recommendContainer.locator('.recommend-reasoning');
    const toggleBtn = recommendContainer.locator('.reasoning-toggle');

    // Toggle button should be hidden during loading (LIN-111 fix)
    await expect(toggleBtn).toBeHidden();
    // Reasoning element is hidden during loading (SSE streams into it once response arrives)
    await expect(reasoning).toBeHidden();

    // Now release the API request to complete
    resolveDelay();

    // Wait for loading to complete (reasoning becomes hidden)
    await expect(reasoning).toBeHidden({ timeout: 10000 });
    // Toggle button should become visible after loading
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText('show reasoning');

    // Click show reasoning toggle
    await toggleBtn.click();

    // Reasoning should now be visible
    await expect(reasoning).toBeVisible();
    await expect(toggleBtn).toHaveText('hide reasoning');

    // Should contain reasoning content
    await expect(reasoning).toContainText('blocked');
  });

  test('recommendation shows generated prompt', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Wait for prompt to be generated (prompt text should have content)
    const promptDiv = recommendContainer.locator('.recommend-prompt');
    await expect(promptDiv).toBeVisible({ timeout: 10000 });

    const promptText = promptDiv.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    // Prompt should have content (not empty)
    const text = await promptText.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('generated prompt has copy button', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);

    // Wait for prompt to be generated
    const promptDiv = recommendContainer.locator('.recommend-prompt');
    await expect(promptDiv).toBeVisible({ timeout: 10000 });

    // Should have copy button
    const copyBtn = promptDiv.locator('.prompt-copy');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText('copy');
  });

  test('dismiss button hides recommendation', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Click dismiss
    const dismissBtn = recommendContainer.locator('.recommend-close');
    await dismissBtn.click();

    // Should be hidden
    await expect(recommendContainer).toBeHidden();
  });

  test('clicking suggest again toggles recommendation off', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Click suggest again
    await suggestBtn.click();

    // Should be hidden
    await expect(recommendContainer).toBeHidden();
  });
});

// =============================================================================
// Recommendation API Tests
// =============================================================================

test.describe('Recommendation API', () => {
  test.beforeEach(async ({ page }) => {
    // openRouterConnected is required: on a local session isTestMode is false, so
    // GET /api/recommend/status reports enabled:true only with the session key.
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { openRouterConnected: true });
  });

  // NOTE: the 401-unauthenticated negative path is dropped on migration (LIN-406) —
  // see the Prompt API block: it tests shared auth middleware, not the recommend
  // surface, and is not expressible on a session-scoped local workspace.

  test('returns 400 for invalid issue ID format', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/INVALID!!!`);
    expect(response.status()).toBe(400);
  });

  test('returns 200 with generated prompt for valid request', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
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

  test('returns contextual prompt based on labels', async ({ page }) => {
    // Issue with blocked label
    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    const body = await response.json();

    // Should mention blocked in reasoning
    expect(body.reasoning.toLowerCase()).toContain('blocked');
    // Prompt should include the issue identifier and goal section
    expect(body.prompt).toContain('TEST-11');
    expect(body.prompt).toContain('Goal');
  });

  test('returns status endpoint correctly', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.enabled).toBe('boolean');
    // In test mode, should be enabled
    expect(body.enabled).toBe(true);
  });

  test('returns issueUrl field', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect('issueUrl' in body).toBe(true);
    expect(typeof body.issueUrl).toBe('string');
  });
});
