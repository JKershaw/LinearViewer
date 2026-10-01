import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, workspaceApiLocalSeed } from '../fixtures/local-harness.js';

/**
 * LIN-3098 S4 — the runner setup page, `/workspace/:urlKey/runner`, on a
 * phone: John's 29 Sep requirement that the runner mint be reachable from the
 * UI through "○ set up ›" and usable from a phone, not the console.
 *
 * iPhone-sized viewport with touch; every press is a `tap`. The workspace
 * comes from `append: true`, so the session's account is its OWNER
 * (LIN-1892) and can mint the runner copy (LIN-3131).
 *
 *   (a) owner, both flags on: tap 1 mints, and the textarea holds the served
 *       prompt plus the credential block (bootstrap, expiresAt, owner id);
 *       tap 2 fills the clipboard; the bootstrap exchanges to take+dispatch.
 *       A refused clipboard leaves the text selected, with the fallback note.
 *   (b) not the owner: no mint button.
 *   (c) proxy off: a notice, and no mint request at all.
 *   (d) dispatch off: the "○ set up ›" run-step notice reaches /runner.
 *   (e) both flags on: "run on my machine ›" is visible on the Swipe card
 *       (S4b: under the title, no longer beside the ladder inside Prompts) and
 *       reaches /runner. Every flag state: runner-link-entry.spec.js.
 *   (f) proxy on, dispatch off: /runner shows the dispatch note and the mint
 *       works.
 *
 * One phone-size screenshot per state lands in test-results/runner-setup/
 * (not committed).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = 'test-results/runner-setup';

async function seedOwner(page, key, features) {
  const seeded = await seedLocalWorkspace(page, workspaceApiLocalSeed, { urlKey: key, append: true, features });
  await page.goto(`/test/clear-proxy-tokens?urlKey=${seeded.urlKey}`);
  return seeded.urlKey;
}

async function sessionAccountId(page) {
  await page.goto('/test/session-account');
  return JSON.parse(await page.locator('body').innerText()).accountId;
}

async function openPrompts(page) {
  await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().tap();
  await expect(page.locator('.prompt-section').first()).toBeVisible();
}

test.describe('runner setup page (LIN-3098 S4, phone)', () => {
  test('(a) owner: tap to mint, the textarea holds the prompt and credential, tap to copy', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const urlKey = await seedOwner(page, 'runner-setup-a', { proxy: true, dispatch: true });
    const accountId = await sessionAccountId(page);

    await page.goto(`/workspace/${urlKey}/runner`);
    const main = page.getByTestId('runner-setup-page');
    await expect(main).toHaveAttribute('data-state', 'owner');
    await page.screenshot({ path: `${SHOTS}/a-owner-before-mint.png`, fullPage: true });

    await page.getByTestId('runner-setup-mint').tap();
    const output = page.getByTestId('runner-setup-output');
    await expect(output).toHaveValue(/## Your runner credential/);
    const text = await output.inputValue();
    expect(text).toContain('# Harbour runner (Claude Code)');
    expect(text).toContain(`- urlKey: ${urlKey}`);
    expect(text).toContain(`- ownerAccountId: ${accountId}`);
    expect(text).toMatch(/- expiresAt: \d{4}-\d{2}-\d{2}T/);
    const bootstrap = text.match(/- bootstrap: (\S+)/)[1];
    expect(bootstrap.length).toBeGreaterThan(20);
    // The prompt comes first, the credential block last, as the prompt expects.
    expect(text.indexOf('# Harbour runner')).toBeLessThan(text.indexOf('## Your runner credential'));
    // The text is pre-selected, ready for a long-press copy.
    expect(await output.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/a-owner-minted.png`, fullPage: true });

    await page.getByTestId('runner-setup-copy').tap();
    await expect(page.getByTestId('runner-setup-copy-feedback')).toContainText(/copied/i);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

    // This browser now counts as "a runner was set up here" (N3's marker).
    expect(await page.evaluate((k) => localStorage.getItem(`harbour-runner:${k}`), urlKey)).toBe('1');

    // The bootstrap is a real runner copy: it exchanges to take + dispatch.
    const exchange = await request.post('/api/proxy/token', { headers: { Authorization: `Bearer ${bootstrap}` } });
    expect(exchange.status()).toBe(200);
    expect((await exchange.json()).grants).toEqual(['take', 'dispatch']);
  });

  test('(a) a refused clipboard leaves the credential selected, with the long-press fallback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    });
    const urlKey = await seedOwner(page, 'runner-setup-clip', { proxy: true, dispatch: true });
    await page.goto(`/workspace/${urlKey}/runner`);
    await page.getByTestId('runner-setup-mint').tap();
    const output = page.getByTestId('runner-setup-output');
    await expect(output).toHaveValue(/## Your runner credential/);
    await page.getByTestId('runner-setup-copy').tap();
    await expect(page.getByTestId('runner-setup-fallback')).toBeVisible();
    await expect(page.getByTestId('runner-setup-fallback')).toContainText(/long-press/i);
    expect(await output.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/a-clipboard-refused.png`, fullPage: true });
  });

  test('(b) not the owner: a notice and no mint button', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-b', { proxy: true, dispatch: true });
    await page.goto(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
    await page.goto(`/workspace/${urlKey}/runner`);
    await expect(page.getByTestId('runner-setup-page')).toHaveAttribute('data-state', 'not-owner');
    await expect(page.getByTestId('runner-setup-notice')).toContainText(/Only this workspace's owner/);
    await expect(page.getByTestId('runner-setup-mint')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/b-not-owner.png`, fullPage: true });
  });

  test('(c) proxy off: a notice with a Settings link, and no mint request', async ({ page }) => {
    const mints = [];
    page.on('request', (req) => { if (req.url().includes('/api/proxy/tokens')) mints.push(req.url()); });
    const urlKey = await seedOwner(page, 'runner-setup-c', { proxy: false, dispatch: true });
    await page.goto(`/workspace/${urlKey}/runner`);
    await expect(page.getByTestId('runner-setup-page')).toHaveAttribute('data-state', 'proxy-off');
    await expect(page.getByTestId('runner-setup-notice')).toContainText(/workspace API access/i);
    await expect(page.getByTestId('runner-setup-notice').locator(`a[href="/workspace/${urlKey}/settings"]`)).toBeVisible();
    await expect(page.getByTestId('runner-setup-mint')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(mints).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/c-proxy-off.png`, fullPage: true });
  });

  test('(d) dispatch off: the ○ set up › run-step notice reaches /runner', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-d', { proxy: true, dispatch: false });
    await page.goto(`/workspace/${urlKey}/swipe`);
    await page.waitForLoadState('networkidle');
    await openPrompts(page);
    const component = page.locator('.prompt-section').first();
    await component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]').tap();
    const link = component.getByTestId('opened-task-setup-runner-link');
    await expect(link).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/d-set-up-notice.png`, fullPage: true });
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
    await expect(page.getByTestId('runner-setup-page')).toBeVisible();
  });

  test('(e) both flags on: "run on my machine ›" is visible on the Swipe card and reaches /runner', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-e', { proxy: true, dispatch: true });
    await page.goto(`/workspace/${urlKey}/swipe`);
    await page.waitForLoadState('networkidle');
    // S4b: on the card itself, so Prompts need not be opened; the ladder no
    // longer carries a second copy.
    const link = page.locator('#swipe-card').getByTestId('opened-task-runner-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('run on my machine ›');
    await openPrompts(page);
    await expect(page.locator('.prompt-section').first().getByTestId('opened-task-runner-link')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/e-card-link.png`, fullPage: true });
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
    await expect(page.getByTestId('runner-setup-page')).toHaveAttribute('data-state', 'owner');
  });

  test('(f) proxy on, dispatch off: the dispatch note, and the mint works', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-f', { proxy: true, dispatch: false });
    await page.goto(`/workspace/${urlKey}/runner`);
    await expect(page.getByTestId('runner-setup-page')).toHaveAttribute('data-state', 'owner-dispatch-off');
    await expect(page.getByTestId('runner-setup-dispatch-note')).toContainText(/Dispatch queue/);
    await page.getByTestId('runner-setup-mint').tap();
    await expect(page.getByTestId('runner-setup-output')).toHaveValue(/## Your runner credential/);
    await page.screenshot({ path: `${SHOTS}/f-dispatch-off-minted.png`, fullPage: true });
  });

  test('the Dispatch page links to the setup page', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-g', { proxy: true, dispatch: true });
    await page.goto(`/workspace/${urlKey}/dispatch`);
    const link = page.getByTestId('dispatch-runner-setup-link');
    await expect(link).toBeVisible();
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
  });

  test('no horizontal scroll at phone width', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-setup-w', { proxy: true, dispatch: true });
    await page.goto(`/workspace/${urlKey}/runner`);
    await page.getByTestId('runner-setup-mint').tap();
    await expect(page.getByTestId('runner-setup-output')).toHaveValue(/## Your runner credential/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
