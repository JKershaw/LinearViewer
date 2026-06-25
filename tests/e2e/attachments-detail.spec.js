/**
 * E2E for the capability-gated attachments gallery on task detail (LIN-652,
 * parent LIN-612, slice 4/4).
 *
 * Rides the `test-token` mock session, which resolves to the LINEAR provider
 * (`ui.attachments === true`) — the local provider used by most detail specs is
 * `attachments: false`, so the gallery is gated OFF there and can't exercise the
 * visible path. The lazy `/api/detail/:issueId` route renders `issue-1` (seeded
 * in testMockData with one formal image attachment) through `renderDetailsContent`,
 * so a request-level assertion over its HTML covers the full thread: detail query
 * → renderer → capability gate → /api/image relay rewrite.
 */
import { test, expect } from '../fixtures/test-base.js';

// issue-1 carries one formal image attachment in testMockData (uploads.linear.app).
const ISSUE_WITH_ATTACHMENT = 'issue-1';
const ISSUE_WITHOUT_ATTACHMENT = 'issue-2';

test.describe('Attachments gallery — task detail (LIN-652)', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    // Establish a Linear test-token session (ui.attachments = true).
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
  });

  test('detail render shows the capability-gated gallery, relayed through /api/image', async ({ page, workerUrlKey }) => {
    const res = await page.request.get(`/workspace/${workerUrlKey}/api/detail/${ISSUE_WITH_ATTACHMENT}`);
    expect(res.ok()).toBeTruthy();
    const { html } = await res.json();

    // Section present and counted.
    expect(html).toContain('data-toggle="attachments"');
    expect(html).toContain('data-testid="attachments-toggle"');
    expect(html).toContain('Attachments (1)');

    // Image bytes go through the LIN-156 session-auth relay, not a raw Linear URL.
    const relayed = `/workspace/${workerUrlKey}/api/image?url=` +
      encodeURIComponent('https://uploads.linear.app/test/shot.png');
    expect(html).toContain(relayed);
    // Lazy + error-fallback hooks the client wires on expand.
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('data-original-src="https://uploads.linear.app/test/shot.png"');
  });

  test('no gallery for an issue without images', async ({ page, workerUrlKey }) => {
    const res = await page.request.get(`/workspace/${workerUrlKey}/api/detail/${ISSUE_WITHOUT_ATTACHMENT}`);
    expect(res.ok()).toBeTruthy();
    const { html } = await res.json();
    expect(html).not.toContain('data-toggle="attachments"');
  });

  test('gallery toggle expands inside Details in the browser', async ({ page, workerUrlKey }) => {
    await page.goto(`/workspace/${workerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    // Expand the issue-1 line → lazy-load its detail block. Scope to the project
    // tree: issue-1 is in-progress so it also appears in the In Progress section.
    const project = page.locator('.project').first();
    const line = project.locator('.line[data-id="issue-1"]');
    await expect(line).toBeVisible();
    await line.click();

    const details = project.locator('.details[data-details-for="issue-1"]');
    const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
    await expect(detailsToggle).toBeVisible();
    await detailsToggle.click();

    // Attachments toggle is nested in Details, hidden-by-default, then expands.
    const attachToggle = details.locator('[data-testid="attachments-toggle"]');
    await expect(attachToggle).toBeVisible();
    await expect(attachToggle).toContainText('Attachments (1)');

    const content = details.locator('[data-testid="attachments-content"]');
    await expect(content).toHaveClass(/hidden/);
    await attachToggle.click();
    await expect(content).not.toHaveClass(/hidden/);
    await expect(content.locator('img.attachment-image')).toHaveCount(1);
  });
});
