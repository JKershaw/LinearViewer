/**
 * LIN-1892 S3 (G3) — the one-time, skippable provider-user email prompt.
 *
 * Real server, real browser. The Playwright server runs NODE_ENV=test with the
 * capture transport, so `resolvePromptStepMode` is 'opt-in': the step fires only
 * for a session that opts in via the test-only `/test/email-prompt-opt-in`.
 *
 * Seeded through the local harness (a local workspace has no email identity).
 */
import { test, expect } from '../fixtures/test-base.js';

test.describe('provider-user email prompt (LIN-1892 S3)', () => {
  test('without opt-in, the workspace page is not interrupted (the fleet default)', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.goto(`/workspace/${urlKey}/`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/$`));
    await expect(page.getByTestId('email-register-step')).toHaveCount(0);
  });

  test('opt in: the step shows once, Skip returns to the workspace, and it never re-blocks', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await page.request.post('/test/email-prompt-opt-in');

    await page.goto(`/workspace/${urlKey}/`);
    await expect(page.getByTestId('email-register-step')).toBeVisible();
    await expect(page.getByTestId('email-register-skip')).toBeVisible();

    await page.getByTestId('email-register-skip').click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/$`));

    await page.reload();
    await expect(page.getByTestId('email-register-step')).toHaveCount(0);
  });
});
