import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-3833: the two "↻ change" guards in streaming.spec.js and the one in prompts.spec.js pinned Home's old
// opened task. The opened task on Home now has a run control, not "↻ change", so those guards moved here, to
// Swipe, which still renders the classic card with `data-action="change"`. Same assertions, Swipe's selectors:
// change aborts an in-flight stream back to idle, and change dismisses a generated prompt back to idle.

test.describe('Swipe — "↻ change" guards moved from Home (LIN-3833)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, proxyDefault: false });
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  /** Open the front card's Prompts on Swipe and press its ✦ next step; returns the card's prompt section. */
  async function pressGo(page) {
    await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().click();
    const component = page.locator('.prompt-section').first();
    await expect(component).toBeVisible();
    await component.locator('[data-testid="opened-task-next-step"]').click();
    return component;
  }

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
