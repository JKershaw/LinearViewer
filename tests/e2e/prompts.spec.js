import { test, expect } from '@playwright/test';

// UUIDs for test issues with promptable labels
const BREAKDOWN_ISSUE_ID = '66666666-6666-6666-6666-666666666666';
const RESEARCH_ISSUE_ID = '77777777-7777-7777-7777-777777777777';
const SCOPING_ISSUE_ID = '88888888-8888-8888-8888-888888888888';
const DESIGN_ISSUE_ID = '99999999-9999-9999-9999-999999999999';
const SPIKE_ISSUE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CONTEXT_ISSUE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const BUG_ISSUE_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddde';
const PLAN_ISSUE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef';
const CODE_REVIEW_ISSUE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

test.describe('Promptable Labels', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session
    await page.goto('/test/set-session');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders needs-breakdown label as clickable link', async ({ page }) => {
    // Find the task with needs-breakdown label and expand it (in project section, not in-progress)
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // Find the label link in the specific issue's details panel
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await expect(labelLink).toBeVisible();
    await expect(labelLink).toHaveText('needs-breakdown');
  });

  test('regular labels are not clickable', async ({ page }) => {
    // Find the task with feature label in project section (not in-progress section)
    const taskLine = page.locator('.project .line[data-id="issue-1"]');
    await expect(taskLine).toBeVisible();

    // Click to expand details
    await taskLine.click();

    // The feature label should be text, not a link
    const details = page.locator('.project .details[data-details-for="issue-1"]');
    await expect(details).toBeVisible();

    // Feature should appear as plain text, not as a .label-prompt link
    const labelLink = details.locator('.label-prompt[data-label="feature"]');
    await expect(labelLink).toHaveCount(0);

    // But feature text should appear in metadata
    await expect(details.locator('.detail-meta')).toContainText('feature');
  });

  test('clicking promptable label shows prompt container', async ({ page }) => {
    // Find and expand the task with needs-breakdown label
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label in the specific issue's details
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load (not showing "Loading...")
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Should show prompt name
    const promptName = promptContainer.locator('.prompt-name');
    await expect(promptName).toContainText('Task Breakdown');

    // Should show prompt text (now rendered as HTML, so headers don't have ##)
    const promptText = promptContainer.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    await expect(promptText).toContainText('Goal');
  });

  test('prompt contains issue identifier', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label in the specific issue's details
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptText = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"] .prompt-text`);
    await expect(promptText).not.toContainText('Loading', { timeout: 10000 });

    // Prompt should contain the task identifier (agent fetches title via MCP)
    await expect(promptText).toContainText('TEST-');
  });

  test('clicking label again hides prompt container', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label to show
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await labelLink.click();

    // Wait for container to appear
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Click again to hide
    await labelLink.click();
    await expect(promptContainer).toBeHidden();
  });

  test('copy button copies prompt text', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label in the specific issue's details
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await labelLink.click();

    // Wait for prompt to load
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
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

  test('prompt container has correct structure', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label in the specific issue's details
    const labelLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="needs-breakdown"]`);
    await labelLink.click();

    // Wait for container and prompt to load
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
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
    // Set up test session
    await page.goto('/test/set-session');
  });

  test('returns 401 for unauthenticated requests', async ({ page }) => {
    // Clear session
    await page.goto('/test/clear-session');

    // Try to fetch prompt (use valid UUID format)
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/needs-breakdown`);
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Not authenticated');
  });

  test('returns 404 for unknown label', async ({ page }) => {
    // Use valid UUID format so we get to the label check
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/unknown-label`);
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('No prompt template');
  });

  test('returns 400 for invalid issue ID format', async ({ page }) => {
    const response = await page.request.get('/api/prompt/invalid-id/needs-breakdown');
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid issue ID format');
  });

  test('returns prompt for valid request', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BREAKDOWN_ISSUE_ID}/needs-breakdown`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-breakdown');
    expect(body.promptName).toBe('Task Breakdown');
    expect(body.prompt).toContain('## Goal');
  });

  // Tests for all prompt templates
  test('returns research prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${RESEARCH_ISSUE_ID}/needs-research`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-research');
    expect(body.promptName).toBe('Research Task');
    expect(body.prompt).toContain('# Research TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns scoping prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${SCOPING_ISSUE_ID}/needs-scoping`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-scoping');
    expect(body.promptName).toBe('Scope Definition');
    expect(body.prompt).toContain('# Define scope for TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns design prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${DESIGN_ISSUE_ID}/needs-design`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-design');
    expect(body.promptName).toBe('Technical Design');
    expect(body.prompt).toContain('# Design TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns spike prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${SPIKE_ISSUE_ID}/needs-spike`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-spike');
    expect(body.promptName).toBe('Technical Spike');
    expect(body.prompt).toContain('# Spike TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns blocked prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.promptName).toBe('Blocker Analysis');
    expect(body.prompt).toContain('# Unblock TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns context prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${CONTEXT_ISSUE_ID}/needs-context`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-context');
    expect(body.promptName).toBe('Context Summary');
    expect(body.prompt).toContain('# Get context for TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns bug prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BUG_ISSUE_ID}/bug`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('bug');
    expect(body.promptName).toBe('Bug Investigation');
    expect(body.prompt).toContain('# Investigate bug TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns plan prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${PLAN_ISSUE_ID}/plan`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('plan');
    expect(body.promptName).toBe('Implementation Plan');
    expect(body.prompt).toContain('# Implement TEST-');
    expect(body.prompt).toContain('## Goal');
  });

  test('returns code-review prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${CODE_REVIEW_ISSUE_ID}/code-review`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('code-review');
    expect(body.promptName).toBe('Code Review');
    expect(body.prompt).toContain('# Review TEST-');
    expect(body.prompt).toContain('## Goal');
  });
});

// Tests for promptable label rendering across different labels
test.describe('Multiple Promptable Labels UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders needs-research as clickable link', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Research authentication options")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Use specific selector scoped to the issue's details panel
    const labelLink = page.locator(`.details[data-details-for="${RESEARCH_ISSUE_ID}"] .label-prompt[data-label="needs-research"]`);
    await expect(labelLink).toBeVisible();
  });

  test('renders blocked as clickable link in in-progress section', async ({ page }) => {
    // Blocked task is in-progress, so it appears in the In Progress section
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Use specific issue ID to avoid ambiguity (task appears in both In Progress and Project sections)
    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('renders bug as clickable link', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Login fails with special characters")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    // Use specific issue ID to avoid ambiguity (bug label also exists on completed issue-3)
    const labelLink = page.locator(`.label-prompt[data-label="bug"][data-issue-id="${BUG_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('clicking needs-research shows correct prompt', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Research authentication options")');
    await taskLine.click();

    // Use specific selector scoped to the issue's details panel
    const labelLink = page.locator(`.details[data-details-for="${RESEARCH_ISSUE_ID}"] .label-prompt[data-label="needs-research"]`);
    await labelLink.click();

    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${RESEARCH_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await expect(promptContainer.locator('.prompt-name')).toContainText('Research Task');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Goal');
  });

  test('renders code-review as clickable link in in-progress section', async ({ page }) => {
    // Code-review issue is in "In Review" state (started), so it appears in In Progress section
    const taskLine = page.locator('.in-progress-items .line:has-text("Refactor authentication module")');
    await expect(taskLine).toBeVisible();
    await taskLine.click();

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="code-review"][data-issue-id="${CODE_REVIEW_ISSUE_ID}"]`);
    await expect(labelLink).toBeVisible();
  });

  test('clicking code-review shows correct prompt', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Refactor authentication module")');
    await taskLine.click();

    const labelLink = page.locator(`.in-progress-items .label-prompt[data-label="code-review"][data-issue-id="${CODE_REVIEW_ISSUE_ID}"]`);
    await labelLink.click();

    // Use more specific locator since issue appears in both In Progress and Project sections
    const promptContainer = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${CODE_REVIEW_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await expect(promptContainer.locator('.prompt-name')).toContainText('Code Review');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Goal');
  });
});

// Tests for "more" inline expansion feature
test.describe('More Prompts Inline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders "more" link for issues with additional prompts', async ({ page }) => {
    // Expand an issue that has promptable labels
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Should show "more" link inline with other labels
    const moreLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .more-toggle`);
    await expect(moreLink).toBeVisible();
    await expect(moreLink).toHaveText('more');
  });

  test('clicking "more" reveals hidden prompts inline', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Hidden prompts should not be visible initially
    const hiddenPrompts = page.locator(`[data-more-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(hiddenPrompts).toBeHidden();

    // Click "more"
    const moreLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .more-toggle`);
    await moreLink.click();

    // Hidden prompts should now be visible
    await expect(hiddenPrompts).toBeVisible();

    // "more" link should be removed
    await expect(moreLink).toHaveCount(0);

    // Check some revealed prompts are visible (these are not on the issue's labels)
    await expect(hiddenPrompts.locator('.label-prompt:has-text("Bug Investigation")')).toBeVisible();
    await expect(hiddenPrompts.locator('.label-prompt:has-text("Implementation Plan")')).toBeVisible();
  });

  test('clicking revealed prompt loads it into container', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click "more" to reveal prompts
    const moreLink = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .more-toggle`);
    await moreLink.click();

    // Click a revealed prompt
    const bugLink = page.locator(`[data-more-for="${BREAKDOWN_ISSUE_ID}"] .label-prompt[data-label="bug"]`);
    await bugLink.click();

    // Prompt container should show the prompt
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });
    await expect(promptContainer.locator('.prompt-name')).toContainText('Bug Investigation');
  });

  test('works in In Progress section', async ({ page }) => {
    // Blocked issue appears in In Progress section
    const inProgressLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await inProgressLine.click();

    // Should have "more" link
    const moreLink = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .more-toggle`);
    await expect(moreLink).toBeVisible();

    // Click to reveal
    await moreLink.click();

    const hiddenPrompts = page.locator(`.in-progress-items [data-more-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(hiddenPrompts).toBeVisible();
  });
});

// =============================================================================
// AI Recommendation Tests
// =============================================================================

test.describe('AI Recommendations', () => {
  test.beforeEach(async ({ page }) => {
    // AI suggest button requires OpenRouter to be configured
    await page.goto('/test/set-session?openRouterConnected=true');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders AI suggest button for each issue when OpenRouter is configured', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Should have AI suggest button
    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await expect(suggestBtn).toBeVisible();
    await expect(suggestBtn).toHaveText('AI suggest');
  });

  test('AI suggest button is hidden when OpenRouter is not configured', async ({ page }) => {
    // Set up session WITHOUT OpenRouter
    await page.goto('/test/set-session');
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Should NOT have AI suggest button
    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await expect(suggestBtn).toBeHidden();
  });

  test('clicking suggest button shows recommendation container', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    // Recommendation container should appear
    const recommendContainer = page.locator(`.recommend-container[data-recommend-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Wait for loading to complete
    const reasoning = recommendContainer.locator('.recommend-reasoning');
    await expect(reasoning).not.toContainText('Analyzing', { timeout: 10000 });

    // Should show reasoning
    await expect(reasoning).toContainText('breakdown');
  });

  test('recommendation shows generated prompt', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.recommend-container[data-recommend-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Wait for loading
    const reasoning = recommendContainer.locator('.recommend-reasoning');
    await expect(reasoning).not.toContainText('Analyzing', { timeout: 10000 });

    // Should show generated prompt
    const promptDiv = recommendContainer.locator('.recommend-prompt');
    await expect(promptDiv).toBeVisible();

    const promptText = promptDiv.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    // Prompt should have content (not empty)
    const text = await promptText.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('generated prompt has copy button', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.recommend-container[data-recommend-for="${BREAKDOWN_ISSUE_ID}"]`);
    const reasoning = recommendContainer.locator('.recommend-reasoning');
    await expect(reasoning).not.toContainText('Analyzing', { timeout: 10000 });

    // Should have copy button
    const copyBtn = recommendContainer.locator('.recommend-prompt .prompt-copy');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText('copy');
  });

  test('dismiss button hides recommendation', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.recommend-container[data-recommend-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Click dismiss
    const dismissBtn = recommendContainer.locator('.recommend-close');
    await dismissBtn.click();

    // Should be hidden
    await expect(recommendContainer).toBeHidden();
  });

  test('clicking suggest again toggles recommendation off', async ({ page }) => {
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    const suggestBtn = page.locator(`.details[data-details-for="${BREAKDOWN_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    const recommendContainer = page.locator(`.recommend-container[data-recommend-for="${BREAKDOWN_ISSUE_ID}"]`);
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
    await page.goto('/test/set-session');
  });

  test('returns 401 for unauthenticated requests', async ({ page }) => {
    await page.goto('/test/clear-session');
    const response = await page.request.get(`/api/recommend/${BREAKDOWN_ISSUE_ID}`);
    expect(response.status()).toBe(401);
  });

  test('returns 400 for invalid issue ID format', async ({ page }) => {
    const response = await page.request.get('/api/recommend/invalid-id');
    expect(response.status()).toBe(400);
  });

  test('returns 200 with generated prompt for valid request', async ({ page }) => {
    const response = await page.request.get(`/api/recommend/${BREAKDOWN_ISSUE_ID}`);
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
    // Issue with needs-breakdown label
    const response = await page.request.get(`/api/recommend/${BREAKDOWN_ISSUE_ID}`);
    const body = await response.json();

    // Should mention breakdown in reasoning
    expect(body.reasoning.toLowerCase()).toContain('breakdown');
    // Prompt should include the issue identifier and goal section
    expect(body.prompt).toContain('TEST-6');
    expect(body.prompt).toContain('Goal');
  });

  test('returns status endpoint correctly', async ({ page }) => {
    const response = await page.request.get('/api/recommend/status');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.enabled).toBe('boolean');
    // In test mode, should be enabled
    expect(body.enabled).toBe(true);
  });

  test('returns labelAlerts array and issueUrl fields', async ({ page }) => {
    const response = await page.request.get(`/api/recommend/${BREAKDOWN_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    // labelAlerts should be an array (empty when no mismatch detected)
    expect(Array.isArray(body.labelAlerts)).toBe(true);
    // issueUrl should be present
    expect('issueUrl' in body).toBe(true);
    expect(typeof body.issueUrl).toBe('string');
  });
});
