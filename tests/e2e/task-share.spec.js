import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { expectNoClippedOverflow } from '../helpers.js';

// LIN-3330: a task share link, end to end. The owner mints a link from the task
// page; a fresh SIGNED-OUT browser context opens it at 360px and sees the same
// task page with only the owner controls hidden; the owner revokes it and the
// same URL is gone. `/s/<anything>` stays 404 (the retired share surface).
//
// A local-provider workspace backs the tracker read (a real LocalStore), so the
// guest's owner-away credential resolution (`resolveWorkspaceAccess`) is
// exercised for real, with no session cookie on the guest.

const PHONE = { width: 360, height: 780 };
const BASE = 'http://localhost:3001';
let URL_KEY;

test.use({ viewport: PHONE });

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-task-shares?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
});

async function seedTask(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      // append:true gives this session's account a FRESH workspace id, so its
      // first edge marks it the owner (LIN-1892) — the fixed LOCAL_WS_UUID can
      // already be owned by another worker's account. Same seam runner-setup uses.
      append: true,
      features: { dispatch: true },
      projects: [{ id: id('share-proj'), name: 'Share project', content: 'A project', sortOrder: 1 }],
      issues: [
        {
          id: id('share-task'), identifier: 'LOCAL-SHARE1', title: 'A shared task', description: 'Seeded for sharing',
          projectId: id('share-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
          url: `/workspace/${URL_KEY}/issue/${id('share-task')}`,
        },
      ],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function seedSession(page) {
  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const token = (await tokenResp.json()).token;
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-SHARE1', issueTitle: 'A shared task', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status()).toBe(200);
}

test.describe('Task share link (LIN-3330)', () => {
  test('owner mints, a signed-out guest reads, owner revokes, then it is gone', async ({ page, browser }) => {
    await seedTask(page);
    await seedSession(page);

    // The owner's task page carries the real share controls.
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-SHARE1`);
    await expect(page.locator('[data-testid="task-share-create"]')).toBeVisible();

    const minted = await page.request.post(`/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/share`, {
      data: { source: 'local' },
    });
    expect(minted.status(), `mint failed: ${await minted.text()}`).toBe(201);
    const { id, path } = await minted.json();
    expect(path).toMatch(/^\/t\/[A-Za-z0-9_-]{43}$/);
    expect(path).not.toContain(id, 'the path carries the token, never the share id');

    // A FRESH signed-out context: no cookies, no redirect, the same page.
    const guestCtx = await browser.newContext({ viewport: PHONE });
    const guest = await guestCtx.newPage();
    const guestRes = await guest.goto(`${BASE}${path}`);
    expect(guestRes.status()).toBe(200);
    expect(new URL(guest.url()).pathname).toBe(path, 'no redirect for a signed-out guest');

    await expect(guest.locator('[data-testid="task-page-title"]')).toHaveText('A shared task');
    await expect(guest.locator('[data-testid="task-page-stage"]')).toHaveCount(1);
    // Owner controls are omitted server-side; in-page Harbour chrome stays.
    await expect(guest.locator('[data-testid="task-page-owner-widgets"]')).toHaveCount(0);
    await expect(guest.locator('[data-testid="run-evidence-closeout"]')).toHaveCount(0);
    await expect(guest.locator('[data-testid="task-share-create"]')).toHaveCount(0);
    await expect(guest.locator('[data-testid="task-page-back"]')).toBeVisible();

    await expectNoClippedOverflow(guest);
    await guestCtx.close();

    // The owner sees the link listed (id, no token), then revokes it.
    const listed = await (await page.request.get(`/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/shares`)).json();
    expect(listed.shares.length).toBe(1);
    expect(listed.shares[0].id).toBe(id);
    expect(JSON.stringify(listed)).not.toContain(path.slice(3));

    const revoked = await page.request.post(`/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/shares/${id}/revoke`);
    expect(revoked.status()).toBe(200);

    // The same URL is now 404, indistinguishable from a never-issued token.
    const goneCtx = await browser.newContext();
    const gone = await goneCtx.newPage();
    expect((await gone.goto(`${BASE}${path}`)).status()).toBe(404);
    const never = `${BASE}/t/${'A'.repeat(43)}`;
    expect((await gone.goto(never)).status()).toBe(404);
    // The retired /s/ surface stays 404.
    expect((await gone.goto(`${BASE}/s/${'A'.repeat(43)}`)).status()).toBe(404);
    await goneCtx.close();
  });

  // LIN-3447: the guest-only 404 gate in the page's own init(). A guest who
  // already has the page open when the owner revokes sees "no longer available"
  // on the next poll, instead of a stale task that silently stopped updating.
  test('a guest page that is open when the owner revokes the link shows the gone notice on its next poll', async ({ page, browser }) => {
    await seedTask(page);
    await seedSession(page);
    const minted = await page.request.post(`/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/share`, { data: { source: 'local' } });
    expect(minted.status(), `mint failed: ${await minted.text()}`).toBe(201);
    const { id, path } = await minted.json();

    const guestCtx = await browser.newContext({ viewport: PHONE });
    const guest = await guestCtx.newPage();
    expect((await guest.goto(`${BASE}${path}`)).status()).toBe(200);
    await expect(guest.locator('[data-testid="task-page-title"]')).toHaveText('A shared task');
    await expect(guest.locator('[data-testid="task-share-gone"]')).toHaveCount(0);

    const revoked = await page.request.post(`/workspace/${URL_KEY}/api/task/LOCAL-SHARE1/shares/${id}/revoke`);
    expect(revoked.status()).toBe(200);

    // One poll, forced the way the tab-return catch-up forces it.
    await guest.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(guest.locator('[data-testid="task-share-gone"]')).toHaveText('This link is no longer available.');
    await expect(guest.locator('[data-testid="task-page-title"]')).toHaveCount(0);
    await guestCtx.close();
  });

  test('the owner share controls create a link from the page and list it', async ({ page }) => {
    await seedTask(page);
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-SHARE1`);
    await page.locator('[data-testid="task-share-create"]').click();
    await expect(page.locator('[data-testid="task-share-url"]')).toBeVisible();
    const url = await page.locator('[data-testid="task-share-url"]').inputValue();
    expect(url).toMatch(new RegExp(`^${BASE.replace(/\./g, '\\.')}/t/[A-Za-z0-9_-]{43}$`));
    await expect(page.locator('[data-testid="task-share-row"]')).toHaveCount(1);
    await page.locator('[data-testid="task-share-revoke"]').click();
    await expect(page.locator('[data-testid="task-share-row"]')).toHaveAttribute('data-revoked', 'true');
  });
});
