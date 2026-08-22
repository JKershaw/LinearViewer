/**
 * Scan UI (LIN-2197 Phase 5) — the per-task "scan for blockers" widget on
 * the two production mount surfaces (dashboard nested-toggle, swipe
 * accordion). The session page is deliberately NOT covered here — the plan
 * excluded it from V1 (no `data-source` threading on its context panels;
 * see the ticket's "Third mount surface" note).
 *
 * Mirrors tests/e2e/swipe.spec.js's Brief UI block: a GENUINE
 * `provider: 'local'` session (workspaceApiLocalSeed, derived from
 * testMockData) so `shouldMockAi` re-gates the scan AI mock onto local
 * sessions with no OpenRouter key required in CI. TEST-6 ("Task needing
 * preparation") carries "research and breakdown" in its description, which
 * `buildMockScanText` (routes/workspace-api.js) recognises as
 * decision-bearing; TEST-14 ("Add pagination to user list") carries no
 * blocking language, so it exercises the zero-finding path.
 */
import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';
import { testMockData } from '../fixtures/mock-data.js';

test.describe('Scan UI — Dashboard', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // The task-decisions store is durable with no TTL by design (LIN-2212) —
    // `seedLocal` re-seeds identical issue content, so an unchanged row from
    // a prior local run would otherwise stay current and this spec would not
    // be re-runnable against the same `./data`.
    await page.request.get(`/test/clear-task-decisions?urlKey=${localWorkerUrlKey}`);
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  function openScanToggle(page, titleText) {
    const node = page.locator('.node').filter({ has: page.locator(`.line:has-text("${titleText}")`) }).first();
    return { node, row: node.locator('.line').first() };
  }

  test('a task row exposes a Scan toggle that starts missing (never auto-scans)', async ({ page }) => {
    const { node, row } = openScanToggle(page, 'Task needing preparation');
    await expect(row).toBeAttached();
    await row.click();
    await node.locator('[data-toggle="details"]').first().click();

    await node.locator('[data-toggle="scan"]').first().click();
    const section = node.locator('[data-content="scan"] .scan-section');
    // Only the cheap GET status check runs on expand — never a POST — so a
    // never-scanned task must land on "missing", not "fresh".
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });
    await expect(section.locator('[data-scan-action="scan"]')).toBeVisible();
  });

  // Scan-find and dismiss are ONE continuous test rather than two, because
  // `localWorkerUrlKey` is a per-WORKER fixture (tests/fixtures/test-base.js)
  // — every test in this file shares the same workspace urlKey, and the
  // task-decisions store is durable with no TTL by design. Splitting these
  // into separate tests would make the second depend on the first never
  // having run (an ordering assumption this suite doesn't guarantee), rather
  // than asserting a real workflow: find → dismiss → rescan-stays-dismissed.
  test('pressing scan on a decision-bearing task finds a blocker; dismissing it stamps it, and a rescan never re-opens it', async ({ page }) => {
    const { node, row } = openScanToggle(page, 'Task needing preparation');
    await row.click();
    await node.locator('[data-toggle="details"]').first().click();
    await node.locator('[data-toggle="scan"]').first().click();

    const section = node.locator('[data-content="scan"] .scan-section');
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });

    await section.locator('[data-scan-action="scan"]').click();
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });

    await expect(section.locator('[data-testid="scan-decision-question"]')).toBeVisible();
    await expect(section.locator('[data-scan-action="dismiss"]')).toBeVisible();
    await expect(section.locator('[data-scan-answer-input]')).toBeVisible();

    await section.locator('[data-scan-action="dismiss"]').click();
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    await expect(section.locator('[data-testid="scan-outcome-dismissed"]')).toBeVisible();

    // A rescan of unchanged content must never silently un-dismiss it
    // (lib/task-decisions-store.js's terminal-row-never-overwritten rule).
    await section.locator('[data-scan-action="rescan"]').click();
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    await expect(section.locator('[data-testid="scan-outcome-dismissed"]')).toBeVisible();
  });

  // Pins the 'answered' stamp round trip (LIN-2212/N5): the committed suite
  // previously only asserted the answer box was *visible*, never pressed
  // Send answer, so nothing crossed the browser -> ReplyDelivery -> comments
  // route -> store boundary for this outcome. Depends on the beforeEach
  // clear above — a stale terminal row from a prior run would report
  // 'fresh'/already-answered instead of 'missing' here.
  test('sending an answer on a decision-bearing task stamps the outcome answered', async ({ page, localWorkerUrlKey }) => {
    const taskId = testMockData.issues.find(i => i.identifier === 'TEST-6').id;
    const { node, row } = openScanToggle(page, 'Task needing preparation');
    await row.click();
    await node.locator('[data-toggle="details"]').first().click();
    await node.locator('[data-toggle="scan"]').first().click();

    const section = node.locator('[data-content="scan"] .scan-section');
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });

    await section.locator('[data-scan-action="scan"]').click();
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });

    await section.locator('[data-scan-answer-input]').fill('Proceeding with the current approach.');

    // Diagnostic only — names *which* half broke on a wiring regression, but
    // it is NOT the store-boundary proof: it passes even if the durable
    // stamp write below is disabled, since it only inspects the outgoing
    // request. Mirrors tests/e2e/observation-rulings.spec.js:133-141.
    const [commentReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      section.locator('[data-scan-action="answer"]').click()
    ]);
    const commentPayload = commentReq.postDataJSON();
    expect(commentPayload.taskDecisionIssueId).toBe(taskId);

    // The just-written answer comment is itself part of the scan's own
    // hashContext, so a successful stamp re-fetches as 'stale', not 'fresh'
    // (public/scan.js's renderAnswerSentStale) — this is the real signal
    // that the comment landed and the store recorded outcome:'answered'.
    await expect(section).toHaveAttribute('data-state', 'stale', { timeout: 5000 });
    await expect(section.locator('.scan-placeholder')).toContainText('Your answer was recorded as a comment');

    // The store-boundary proof (LIN-2217): the two assertions above are both
    // reachable from the comment write alone, regardless of whether the
    // durable stamp ran — this read-back is the only assertion that crosses
    // the taskDecisions store boundary and actually pins 'answered'.
    const { record } = await (await page.request.get(
      `/test/task-decisions?urlKey=${localWorkerUrlKey}&issueId=${taskId}`
    )).json();
    expect(record.outcome).toBe('answered');
  });

  test('pressing scan on a task with no blocking language reports no blockers found', async ({ page }) => {
    const { node, row } = openScanToggle(page, 'Add pagination to user list');
    await row.click();
    await node.locator('[data-toggle="details"]').first().click();
    await node.locator('[data-toggle="scan"]').first().click();

    const section = node.locator('[data-content="scan"] .scan-section');
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });
    await section.locator('[data-scan-action="scan"]').click();

    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    await expect(section.locator('[data-testid="scan-empty"]')).toBeVisible();
  });
});

test.describe('Scan UI — Swipe', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Same re-runnability fix as the Dashboard describe above — this describe
    // shares the same per-worker urlKey and durable store.
    await page.request.get(`/test/clear-task-decisions?urlKey=${localWorkerUrlKey}`);
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders a Scan accordion', async ({ page }) => {
    const scanAccordion = page.locator('.swipe-accordion-header[data-accordion="scan"]').first();
    await expect(scanAccordion).toBeVisible();
    await expect(scanAccordion).toContainText(/Scan/i);
  });

  test('opening the scan accordion initialises the section on "missing", never auto-scanning', async ({ page }) => {
    const scanAccordion = page.locator('.swipe-accordion-header[data-accordion="scan"]').first();
    await scanAccordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="scan"]').first();
    await expect(body).toHaveClass(/open/);

    const section = body.locator('.scan-section').first();
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });
  });

  test('pressing the scan button POSTs and lands on a fresh result', async ({ page }) => {
    const scanAccordion = page.locator('.swipe-accordion-header[data-accordion="scan"]').first();
    await scanAccordion.click();

    const section = page.locator('.swipe-accordion-body[data-accordion-body="scan"] .scan-section').first();
    await expect(section).toHaveAttribute('data-state', 'missing', { timeout: 5000 });

    await section.locator('[data-scan-action="scan"]').click();
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });

    // Either outcome is a normal, non-error result — a decision (answer box +
    // dismiss) or a zero-finding empty note.
    const hasDecision = await section.locator('[data-testid="scan-decision"]').count();
    const hasEmpty = await section.locator('[data-testid="scan-empty"]').count();
    expect(hasDecision + hasEmpty).toBeGreaterThan(0);
  });
});
