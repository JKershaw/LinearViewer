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

    // Find the label link in the details
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
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

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for prompt container to appear
    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();

    // Wait for prompt to load (not showing "Loading...")
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    // Should show prompt name
    const promptName = promptContainer.locator('.prompt-name');
    await expect(promptName).toContainText('Task Breakdown');

    // Should show prompt text
    const promptText = promptContainer.locator('.prompt-text');
    await expect(promptText).toBeVisible();
    await expect(promptText).toContainText('Linear MCP');
  });

  test('prompt contains issue context', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
    await labelLink.click();

    // Wait for prompt to load
    const promptText = page.locator(`.prompt-container[data-prompt-for="${BREAKDOWN_ISSUE_ID}"] .prompt-text`);
    await expect(promptText).not.toContainText('Loading', { timeout: 10000 });

    // Prompt should contain the task title
    await expect(promptText).toContainText('Task needing breakdown');
  });

  test('clicking label again hides prompt container', async ({ page }) => {
    // Find and expand the task
    const taskLine = page.locator('.project .line:has-text("Task needing breakdown")');
    await taskLine.click();

    // Click the promptable label to show
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
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

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
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

    // Click the promptable label
    const labelLink = page.locator('.label-prompt[data-label="needs-breakdown"]');
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
    expect(body.prompt).toContain('Linear MCP');
  });

  // Tests for all 7 new prompt templates
  test('returns research prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${RESEARCH_ISSUE_ID}/needs-research`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-research');
    expect(body.promptName).toBe('Research Task');
    expect(body.prompt).toContain('Research authentication options');
    expect(body.prompt).toContain('mcp__linear__get_issue');
  });

  test('returns scoping prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${SCOPING_ISSUE_ID}/needs-scoping`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-scoping');
    expect(body.promptName).toBe('Scope Definition');
    expect(body.prompt).toContain('Define scope for user dashboard');
    expect(body.prompt).toContain('In Scope');
  });

  test('returns design prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${DESIGN_ISSUE_ID}/needs-design`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-design');
    expect(body.promptName).toBe('Technical Design');
    expect(body.prompt).toContain('Design caching layer architecture');
    expect(body.prompt).toContain('Design Options');
  });

  test('returns spike prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${SPIKE_ISSUE_ID}/needs-spike`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-spike');
    expect(body.promptName).toBe('Technical Spike');
    expect(body.prompt).toContain('WebSocket vs SSE');
    expect(body.prompt).toContain('Timebox');
  });

  test('returns blocked prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BLOCKED_ISSUE_ID}/blocked`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('blocked');
    expect(body.promptName).toBe('Blocker Analysis');
    expect(body.prompt).toContain('Blocked on external API');
    expect(body.prompt).toContain('Options to Unblock');
  });

  test('returns context prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${CONTEXT_ISSUE_ID}/needs-context`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('needs-context');
    expect(body.promptName).toBe('Context Summary');
    expect(body.prompt).toContain('Context needed for legacy migration');
    expect(body.prompt).toContain("What's Done");
  });

  test('returns bug prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${BUG_ISSUE_ID}/bug`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('bug');
    expect(body.promptName).toBe('Bug Investigation');
    expect(body.prompt).toContain('Login fails with special characters');
    expect(body.prompt).toContain('Likely Causes');
  });

  test('returns plan prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${PLAN_ISSUE_ID}/plan`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('plan');
    expect(body.promptName).toBe('Implementation Plan');
    expect(body.prompt).toContain('Add pagination to user list');
    expect(body.prompt).toContain('Implementation Steps');
    expect(body.prompt).toContain('Test Plan');
  });

  test('returns code-review prompt', async ({ page }) => {
    const response = await page.request.get(`/api/prompt/${CODE_REVIEW_ISSUE_ID}/code-review`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.label).toBe('code-review');
    expect(body.promptName).toBe('Code Review');
    expect(body.prompt).toContain('Refactor authentication module');
    expect(body.prompt).toContain('Correctness');
    expect(body.prompt).toContain('Security');
    expect(body.prompt).toContain('Checklist');
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

    const labelLink = page.locator('.label-prompt[data-label="needs-research"]');
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

    const labelLink = page.locator('.label-prompt[data-label="needs-research"]');
    await labelLink.click();

    const promptContainer = page.locator(`.prompt-container[data-prompt-for="${RESEARCH_ISSUE_ID}"]`);
    await expect(promptContainer).toBeVisible();
    await expect(promptContainer.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });

    await expect(promptContainer.locator('.prompt-name')).toContainText('Research Task');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Key Questions');
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
    await expect(promptContainer.locator('.prompt-text')).toContainText('Correctness');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Security');
    await expect(promptContainer.locator('.prompt-text')).toContainText('Checklist');
  });
});
