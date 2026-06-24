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
  const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
  await expect(detailsToggle).toBeVisible();
  await detailsToggle.click();

  return details;
}

test.describe('Tree view: Brief / Recap sections (LIN-522)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal();
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());
  });

  for (const section of ['brief', 'recap']) {
    test(`${section} toggle appears nested inside Details`, async ({ page }) => {
      const details = await openIssueDetails(page);
      const toggle = details.locator(`.detail-toggle[data-toggle="${section}"]`);
      await expect(toggle).toBeVisible();
      await expect(toggle).toContainText(section === 'brief' ? 'Brief' : 'Recap');
    });

    test(`${section} content starts hidden and lazy-mounts on first expand`, async ({ page }) => {
      const details = await openIssueDetails(page);
      const toggle = details.locator(`.detail-toggle[data-toggle="${section}"]`);
      const content = details.locator(`.detail-content[data-content="${section}"]`);
      const sectionEl = content.locator(`.${section}-section`);

      // Hidden, and the shared module has NOT been initialised yet (placeholder
      // still present, no data-state).
      await expect(content).toHaveClass(/hidden/);
      await expect(sectionEl).toHaveAttribute(`data-${section}-placeholder`, '1');
      await expect(sectionEl).not.toHaveAttribute('data-state', /.+/);

      // First expand initialises the module.
      await toggle.click();
      await expect(content).not.toHaveClass(/hidden/);
      await expect(toggle).toContainText('▼');
      await expect(sectionEl).not.toHaveAttribute(`data-${section}-placeholder`, '1');
      // The shared renderer always stamps a data-state; settles off 'loading'.
      await expect(sectionEl).toHaveAttribute('data-state', /missing|fresh|stale|generating|error/, { timeout: 5000 });
    });

    test(`${section} toggle arrow flips on expand/collapse`, async ({ page }) => {
      const details = await openIssueDetails(page);
      const toggle = details.locator(`.detail-toggle[data-toggle="${section}"]`);

      await expect(toggle).toContainText('▶');
      await toggle.click();
      await expect(toggle).toContainText('▼');
      await toggle.click();
      await expect(toggle).toContainText('▶');
    });

    test(`${section} mounts only once (cached across collapse/expand)`, async ({ page }) => {
      const details = await openIssueDetails(page);
      const toggle = details.locator(`.detail-toggle[data-toggle="${section}"]`);
      const content = details.locator(`.detail-content[data-content="${section}"]`);
      const sectionEl = content.locator(`.${section}-section`);

      await toggle.click();
      await expect(sectionEl).toHaveAttribute('data-state', /missing|fresh|stale|generating|error/, { timeout: 5000 });
      // Collapse then re-expand: content is marked loaded, so it is not re-mounted.
      await toggle.click();
      await expect(content).toHaveClass(/hidden/);
      await expect(content).toHaveAttribute('data-loaded', 'true');
      await toggle.click();
      await expect(content).not.toHaveClass(/hidden/);
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
// Context section (LIN-572) — relationship diagram, nested inside Details.
// Reuses the same lazy-toggle plumbing as Brief/Recap; the section is
// deterministic (no AI), so it settles directly to data-state="loaded".
// LOCAL-1 (the first project issue) is the parent of LOCAL-2, so the diagram
// renders the root node and a Children lane.
// ============================================================================
test.describe('Tree view: Context section (LIN-572)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal();
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());
  });

  test('context toggle appears nested inside Details', async ({ page }) => {
    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="context"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Context');
  });

  test('context content starts hidden and lazy-mounts the diagram on first expand', async ({ page }) => {
    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="context"]');
    const content = details.locator('.detail-content[data-content="context"]');
    const sectionEl = content.locator('.context-section');

    await expect(content).toHaveClass(/hidden/);
    await expect(sectionEl).toHaveAttribute('data-context-placeholder', '1');
    await expect(sectionEl).not.toHaveAttribute('data-state', /.+/);

    await toggle.click();
    await expect(content).not.toHaveClass(/hidden/);
    await expect(toggle).toContainText('▼');
    await expect(sectionEl).not.toHaveAttribute('data-context-placeholder', '1');
    await expect(sectionEl).toHaveAttribute('data-state', 'loaded', { timeout: 5000 });

    // The root node always renders; LOCAL-1's child LOCAL-2 appears as a node.
    await expect(sectionEl.locator('.context-node--root')).toBeVisible();
    await expect(sectionEl.locator('.context-node[data-context-nav="LOCAL-2"]')).toBeVisible();
  });

  test('context mounts only once (cached across collapse/expand)', async ({ page }) => {
    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="context"]');
    const content = details.locator('.detail-content[data-content="context"]');
    const sectionEl = content.locator('.context-section');

    await toggle.click();
    await expect(sectionEl).toHaveAttribute('data-state', 'loaded', { timeout: 5000 });
    await toggle.click();
    await expect(content).toHaveClass(/hidden/);
    await expect(content).toHaveAttribute('data-loaded', 'true');
    await toggle.click();
    await expect(content).not.toHaveClass(/hidden/);
  });
});

// ============================================================================
// Dispatched Sessions — gated behind the dispatch feature flag.
// Seeds real sessions by acting as a dispatch consumer (mirrors swipe.spec.js).
// ============================================================================
test.describe('Tree view: Dispatched Sessions (LIN-522)', () => {
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

  test('sessions toggle is absent when the dispatch flag is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(undefined, { features: { dispatch: false } });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    const details = await openIssueDetails(page);
    await expect(details.locator('.detail-toggle[data-toggle="sessions"]')).toHaveCount(0);
  });

  test('sessions toggle lazy-loads and lists dispatched sessions', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await clearSessions(page, localWorkerUrlKey);
    await seedLocal(undefined, { features: { dispatch: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    // The first project issue is LOCAL-1 (see defaultLocalSeed); seed two sessions.
    await dispatchForIssue(page, localWorkerUrlKey, 'LOCAL-1', 'research');
    await dispatchForIssue(page, localWorkerUrlKey, 'LOCAL-1', 'implementation');

    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="sessions"]');
    const content = details.locator('.detail-content[data-content="sessions"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Dispatched Sessions');

    await toggle.click();
    await expect(content).not.toHaveClass(/hidden/);
    await expect(content.locator('.session-entry')).toHaveCount(2);
  });

  test('sessions toggle shows the empty state for an undispatched issue', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await clearSessions(page, localWorkerUrlKey);
    await seedLocal(undefined, { features: { dispatch: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.evaluate(() => localStorage.clear());

    const details = await openIssueDetails(page);
    const toggle = details.locator('.detail-toggle[data-toggle="sessions"]');
    const content = details.locator('.detail-content[data-content="sessions"]');

    await toggle.click();
    await expect(content.locator('.sessions-empty')).toContainText('No sessions yet');
  });
});
