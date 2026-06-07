import { test, expect } from '../fixtures/test-base.js';

// Regression coverage for the "+proxy silent-drop" bug: when the +proxy toggle
// is active, copying/dispatching a prompt must append the Linear API Proxy
// block — and if the proxy token can't be minted (e.g. the token rate limiter
// trips after repeated reloads), the action must SURFACE the failure rather
// than silently copying a bare prompt while the toggle still shows active.
//
// Two parallel client paths render prompt copy buttons, so both are covered:
//   - dashboard tree  -> public/app.js (maybeAppendProxyBlock)
//   - swipe view      -> public/prompt-section.js (maybeAppendProxy)

const URL_KEY = 'test-workspace';
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROXY_FEAT = encodeURIComponent(JSON.stringify({ proxy: true }));
const PROXY_MARKER = 'Linear API Proxy';

/** Reveal a preexisting (template) prompt for the blocked task on the dashboard. */
async function selectDashboardPrompt(page) {
  const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
  await taskLine.click();
  const details = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"]`);
  await details.locator('.detail-toggle[data-toggle="prompts"]').click();
  await page.locator(`.in-progress-items .more-toggle[data-issue-id="${BLOCKED_ISSUE_ID}"]`).click();
  await page.locator(`.in-progress-items .label-prompt[data-label="blocked"][data-issue-id="${BLOCKED_ISSUE_ID}"]`).click();
  const container = page.locator(`.in-progress-items .prompt-container[data-prompt-for="${BLOCKED_ISSUE_ID}"]`);
  await expect(container.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });
  return container;
}

/** Reveal a preexisting (template) prompt on the swipe view. */
async function selectSwipePrompt(page) {
  await page.locator('.swipe-accordion-header[data-accordion="prompts"]').click();
  const btn = page.locator('.swipe-prompt-buttons .swipe-prompt-btn:not(.ai-btn):not(.foreman-btn):not(.mini-foreman-btn):not(.autopilot-btn):not(.swipe-prompt-btn-more)').first();
  await btn.click();
  const section = page.locator('.prompt-section');
  await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
  return section;
}

/** Force every proxy-token mint to fail, as a tripped rate limiter would. */
async function failTokenMint(page) {
  await page.route('**/api/proxy/tokens', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' });
    }
    return route.continue();
  });
}

test.describe('+proxy copy/dispatch — dashboard (app.js)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy appends the proxy block when +proxy is enabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${PROXY_FEAT}`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const container = await selectDashboardPrompt(page);
    await container.locator('.prompt-proxy-toggle').click();
    await expect(container.locator('.prompt-proxy-toggle')).toHaveClass(/active/);

    await container.locator('.prompt-copy').click();
    await expect(container.locator('.prompt-copy')).toHaveText('copied!');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(PROXY_MARKER);
    expect(clip).toContain('/api/proxy/instructions');
  });

  test('copy does NOT append when +proxy is disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${PROXY_FEAT}`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const container = await selectDashboardPrompt(page);
    // Leave +proxy off (default).
    await container.locator('.prompt-copy').click();
    await expect(container.locator('.prompt-copy')).toHaveText('copied!');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    expect(clip).not.toContain(PROXY_MARKER);
  });

  test('copy surfaces failure (does not silently drop) when token mint fails', async ({ page }) => {
    await page.goto(`/test/set-session?features=${PROXY_FEAT}`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await failTokenMint(page);

    const container = await selectDashboardPrompt(page);
    await container.locator('.prompt-proxy-toggle').click();
    await expect(container.locator('.prompt-proxy-toggle')).toHaveClass(/active/);

    // Seed the clipboard so we can prove nothing was written on failure.
    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));

    const copyBtn = container.locator('.prompt-copy');
    await copyBtn.click();

    // The toggle still shows active, but the copy must report failure...
    await expect(copyBtn).toHaveText('failed');
    // ...and must NOT have silently copied a bare (proxy-less) prompt.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('__SENTINEL__');
  });
});

test.describe('+proxy copy — swipe (prompt-section.js)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy appends the proxy block when +proxy is enabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${PROXY_FEAT}`);
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');

    const section = await selectSwipePrompt(page);
    await section.locator('.prompt-proxy-toggle').click();
    const copyBtn = section.locator('.swipe-prompt-copy');
    await copyBtn.click();
    // Wait for the async copy (token mint + writeText) to finish before reading.
    await expect(copyBtn).toHaveText('copied!');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(PROXY_MARKER);
  });

  test('copy surfaces failure (does not silently drop) when token mint fails', async ({ page }) => {
    await page.goto(`/test/set-session?features=${PROXY_FEAT}`);
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');
    await failTokenMint(page);

    const section = await selectSwipePrompt(page);
    await section.locator('.prompt-proxy-toggle').click();

    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));

    const copyBtn = section.locator('.swipe-prompt-copy');
    await copyBtn.click();

    await expect(copyBtn).toHaveText('failed');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('__SENTINEL__');
  });
});
