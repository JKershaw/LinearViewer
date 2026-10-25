/**
 * E2E coverage for the Brief / Recap / Dispatched Sessions sections mounted on
 * the main projects (tree) view — LIN-522.
 *
 * These three sections reuse the view-agnostic client modules (public/brief.js,
 * recap.js, sessions.js) already proven on the swipe surface. Here we verify the
 * tree-view integration: each is a nested toggle inside the per-issue Details
 * block, lazy-mounted on first expand (mirroring the Comments lazy-load), and
 * the existing Details/Comments content is unaffected.
 *
 * Rides a seeded local-provider workspace (no `test-token` mock); the detail
 * block itself is fetched lazily from /api/detail on first expand.
 */
import { test, expect } from '../fixtures/test-base.js';

/**
 * Expand the first project issue line, then open its Details block (the nested
 * Brief/Recap/Sessions toggles live inside the Details content). Returns the
 * `.details` locator for the issue.
 */
async function openIssueDetails(page) {
  const project = page.locator('.project').first();
  const issueLine = project.locator('.line.expandable').first();
  await expect(issueLine).toBeVisible();
  await issueLine.click();

  const issueId = await issueLine.getAttribute('data-id');
  const details = project.locator(`.details[data-details-for="${issueId}"]`).first();

  // Details block is lazy-loaded from /api/detail; the Details toggle appears
  // once the fetch lands, then we expand it to reveal the nested toggles.
  const detailsToggle = details.locator('.detail-toggle[data-toggle="description"]');
  await expect(detailsToggle).toBeVisible();
  await detailsToggle.click();

  return details;
}

test.describe('Tree view: Brief / Recap / Context leave Home (LIN-522, LIN-3833)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal();
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());
  });

  // LIN-3833 (Q4): the state-first opened task on Home has no Brief, Recap, Scan or Context folds. They stay on
  // Swipe, where the card keeps them.
  for (const section of ['brief', 'recap', 'context']) {
    test(`${section} is not a fold of the opened task on Home`, async ({ page }) => {
      const details = await openIssueDetails(page);
      await expect(details.locator('.prompt-section')).toBeVisible();
      await expect(details.locator(`.detail-toggle[data-toggle="${section}"]`)).toHaveCount(0);
    });
  }

  test('does not disturb the existing Comments section', async ({ page }) => {
    const details = await openIssueDetails(page);

    // Comments still toggles and loads alongside the new sections.
    const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');
    const commentsContent = details.locator('.detail-content[data-content="comments"]');
    await expect(commentsToggle).toBeVisible();
    await commentsToggle.click();
    await expect(commentsContent).not.toHaveClass(/hidden/);
    await expect(commentsContent.locator('.comments-list')).toBeVisible();
  });
});

// ============================================================================
// Dispatched Sessions fold (LIN-522). LIN-3833: the Sessions fold stays on Home, for a viewer who can run.
// ============================================================================
async function clearSessions(page, urlKey) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-tokens?urlKey=${urlKey}`);
}

async function dispatchForIssue(page, urlKey, issueIdentifier, promptName = 'implementation') {
  const resp = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: `Work on ${issueIdentifier}`, promptName, issueIdentifier, target: 'cli' }
  });
  expect(resp.status(), `dispatch failed: ${await resp.text()}`).toBe(201);
  return (await resp.json()).item;
}

test.describe('Tree view: Dispatched Sessions (LIN-522)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal();
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());
  });

  test('sessions toggle is absent when the dispatch flag is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(undefined, { runnerKey: false });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    const details = await openIssueDetails(page);
    await expect(details.locator('.detail-toggle[data-toggle="sessions"]')).toHaveCount(0);
  });

  test('sessions toggle lazy-loads and lists dispatched sessions', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await clearSessions(page, localWorkerUrlKey);
    await seedLocal(undefined, { runnerKey: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    // The first project issue is LOCAL-1 (see defaultLocalSeed); seed two sessions.
    await dispatchForIssue(page, localWorkerUrlKey, 'LOCAL-1', 'research');
    await dispatchForIssue(page, localWorkerUrlKey, 'LOCAL-1', 'implementation');

    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="sessions"]');
    const content = details.locator('.detail-content[data-content="sessions"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Sessions');

    await toggle.click();
    await expect(content).not.toHaveClass(/hidden/);
    await expect(content.locator('.session-entry')).toHaveCount(2);
  });

  test('sessions toggle shows the empty state for an undispatched issue', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await clearSessions(page, localWorkerUrlKey);
    await seedLocal(undefined, { runnerKey: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="sessions"]');
    const content = details.locator('.detail-content[data-content="sessions"]');

    await toggle.click();
    await expect(content.locator('.sessions-empty')).toContainText('No sessions yet');
  });
});
