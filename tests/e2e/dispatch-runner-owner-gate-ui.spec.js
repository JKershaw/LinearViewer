import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { dispatchHalt } from '../helpers.js';

/**
 * LIN-3408 (LIN-3398 Part A) — a MEMBER (non-owner) session driving the
 * Dispatch page is refused on halt and on delete, through the real client.
 *
 * The unit tests run the real handlers against fake stores; this is the only
 * spec that proves the browser surfaces the refusal and keeps the row. The
 * distinguishing precondition is a foreign `role:'owner'` edge (seeded as
 * tests/e2e/runner-enqueue-owner-only.spec.js does), not an unowned workspace.
 */
const KEY = 'dispatch-runner-owner-gate-ui';
const REFUSAL = "Only this workspace's owner can act on its runner.";

let urlKey;
let api;

test.beforeEach(async ({ page }) => {
  const seeded = await seedLocalWorkspace(page, null, { urlKey: KEY, append: true, runnerKey: true });
  urlKey = seeded.urlKey;
  api = `/workspace/${urlKey}/api/dispatch`;
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-workspace-halt?urlKey=${urlKey}`);
  await seedWorkspaceOwnership(page, urlKey, 'owner');
});

test.afterEach(async ({ page }) => {
  await page.request.get(`/test/clear-workspace-halt?urlKey=${urlKey}`);
});

test.describe('LIN-3408 — non-owner member on the Dispatch page (e2e)', () => {
  test('a member sees no halt buttons (LIN-3849), and a direct halt request is still refused with nothing stored', async ({ page }) => {
    await seedWorkspaceOwnership(page, urlKey, 'foreign');
    await page.goto(`/workspace/${urlKey}/dispatch`);
    await page.waitForLoadState('networkidle');

    // The page is read-only for a member: the status line stays, the buttons are not drawn.
    await expect(dispatchHalt(page).status()).toBeVisible();
    await expect(dispatchHalt(page).pause()).toHaveCount(0);
    await expect(dispatchHalt(page).stop()).toHaveCount(0);
    await expect(dispatchHalt(page).resume()).toHaveCount(0);

    // The server gate is unchanged: the same request the button used to send is refused.
    const refused = await page.request.post(`${api}/halt`, {
      headers: { 'Content-Type': 'application/json' },
      data: { mode: 'pause' }
    });
    expect(refused.ok()).toBe(false);
    expect(JSON.stringify(await refused.json())).toContain(REFUSAL);

    const read = await page.request.get(`${api}/halt`);
    expect(read.status()).toBe(200);
    expect(await read.json()).toEqual({ halt: null });
  });

  test('✕ on a cli queue row is refused with the owner-only toast and the row stays', async ({ page }) => {
    // Enqueue as the owner, THEN make the session a member.
    const created = await page.request.post(api, {
      headers: { 'Content-Type': 'application/json' },
      data: { prompt: 'member must not remove this', target: 'cli' }
    });
    expect(created.status()).toBe(201);
    await seedWorkspaceOwnership(page, urlKey, 'foreign');

    await page.goto(`/workspace/${urlKey}/dispatch`);
    await page.waitForLoadState('networkidle');
    const row = page.locator('.queue-list .queue-item');
    await expect(row).toHaveCount(1);

    await row.locator('.queue-item-remove').click();

    const toast = page.locator('.toast.toast-error');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(REFUSAL);

    // The row stays in the list, and server-side in the queue.
    await expect(row).toHaveCount(1);
    const list = await page.request.get(api);
    expect(list.status()).toBe(200);
    expect(JSON.stringify(await list.json())).toContain('member must not remove this');
  });
});
