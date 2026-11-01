import { test, expect } from '../fixtures/test-base.js';

// LIN-4085: the agent prompt under the hero sign-in buttons on `/`. Browser witnesses for
// what the unit tests cannot see: the copy button puts the prompt on the clipboard, the
// block sits under the Linear CTA, the page does not scroll sideways at 320px, and without
// JS there is a selectable prompt and no dead button.

const BLOCK = '[data-testid="landing-agent-prompt"]';
const TEXT = '[data-testid="landing-agent-prompt-text"]';
const COPY = '[data-testid="landing-agent-prompt-copy"]';

test.describe('Landing agent prompt (LIN-4085)', () => {
  test('sits directly under the hero sign-in buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const linear = await page.locator('[data-testid="landing-cta-linear"]').boundingBox();
    const block = await page.locator(BLOCK).boundingBox();
    expect(linear).not.toBeNull();
    expect(block).not.toBeNull();
    expect(block.y).toBeGreaterThan(linear.y + linear.height);
    // Nothing else sits between the two: the block is the first section of the showcase.
    const between = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="landing-agent-prompt"]');
      return block.previousElementSibling?.tagName ?? null;
    });
    expect(between).toBe(null);
  });

  test('the copy button puts the origin-filled prompt on the clipboard', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const copy = page.locator(COPY);
    await expect(copy).toHaveText('Copy prompt');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const shown = await page.locator(TEXT).textContent();
    expect(clipboard.trim()).toBe(shown.trim());
    expect(clipboard).toContain(`${baseURL}/getting-started.md`);
  });

  test('at 320px the block fits the width, with no sideways page scroll, in light and dark', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 900 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const block = page.locator(BLOCK);
      await block.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${scheme}: page scrolls sideways`).toBeLessThanOrEqual(0);
      const box = await block.boundingBox();
      expect(box.width).toBeLessThanOrEqual(320);
      const file = testInfo.outputPath(`agent-prompt-320-${scheme}.png`);
      await block.screenshot({ path: file });
      await testInfo.attach(`agent-prompt-320-${scheme}.png`, { path: file, contentType: 'image/png' });
    }
  });

  test('at desktop width the block is visible in both themes', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator(BLOCK)).toBeVisible();
      const file = testInfo.outputPath(`agent-prompt-desktop-${scheme}.png`);
      await page.locator(BLOCK).screenshot({ path: file });
      await testInfo.attach(`agent-prompt-desktop-${scheme}.png`, { path: file, contentType: 'image/png' });
    }
  });

  test('without JS the prompt is selectable text and no copy button exists', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await expect(page.locator(TEXT)).toBeVisible();
      await expect(page.locator(COPY)).toHaveCount(0);
      expect(await page.locator(TEXT).textContent()).toContain('/getting-started.md');
    } finally {
      await context.close();
    }
  });
});
