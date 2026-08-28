import { test, expect } from '../fixtures/test-base.js';

// LIN-2285 close-out ledger item 2: no E2E spec exercised the account-merge
// confirm flow at all before this — `git grep -l 'merge-confirm|auth/merge'
// -- tests/e2e` returned nothing, so the four green E2E shards were silent on
// this surface. Drives the real production seam: `/test/set-merge-conflict-session`
// (routes/test.js) builds the LIN-2285 scenario (B merged into A, a third
// account C offered a merge of B's identity) via the real `establishAccount` +
// `respondToAccountConflict` functions, then this spec submits the REAL
// `POST /auth/merge/confirm` form the response renders — no part of the
// confirm step is test-only.
test.describe('Account merge confirm flow (LIN-2285)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-session');
  });

  test('409 merge offer names the canonical absorber and confirming redirects into the merged workspace', async ({ page }) => {
    const response = await page.goto('/test/set-merge-conflict-session');
    expect(response.status()).toBe(409);

    const offerPage = page.locator('[data-testid="merge-confirm-page"]');
    await expect(offerPage).toBeVisible();
    await expect(offerPage).toContainText('This Linear account is already connected to a different Harbour account');
    // LIN-2285 close-out ledger item 3: the copy update naming that the
    // absorbing account may itself already include prior merges.
    await expect(offerPage).toContainText('which may itself already include other previously-merged identities and data');

    const confirmForm = page.locator('[data-testid="merge-confirm-form"]');
    await expect(confirmForm).toBeVisible();
    await expect(page.locator('[data-testid="merge-decline-form"]')).toBeVisible();

    await Promise.all([
      page.waitForNavigation(),
      page.click('[data-testid="merge-confirm-submit"]'),
    ]);

    // Confirming redirects into the arriving identity's workspace (mode:'new')
    // rather than erroring — no 500 "Merge Failed" dead end.
    await expect(page).toHaveURL(/\/workspace\/merge-conflict-b-[0-9a-f]+\//);
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/is-landing/);
  });

  test('declining a merge offer leaves the session on the canonical account with no pending merge', async ({ page }) => {
    const response = await page.goto('/test/set-merge-conflict-session');
    expect(response.status()).toBe(409);

    await Promise.all([
      page.waitForNavigation(),
      page.click('[data-testid="merge-decline-submit"]'),
    ]);

    // POST /auth/merge/decline redirects to '/', which itself redirects an
    // authenticated session on to its first workspace (server.js) — C's own
    // workspace, byte-identical to before the offer, since decline writes
    // nothing to either account.
    await expect(page).toHaveURL(/\/workspace\/merge-conflict-c-[0-9a-f]+\//);
    await expect(page.locator('.nav-bar')).toBeVisible();
  });
});
