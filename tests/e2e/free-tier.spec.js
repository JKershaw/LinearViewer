import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-3239 S2 — the free-tier RUN contract.
//
// Prompts are unlimited: a prompt is never refused for a workspace's daily
// usage (only the global hourly safety net can refuse one). The bounded thing
// is fresh RUNS per account per UTC day. This spec runs against the dedicated
// free-tier twin (port 3003, OPENROUTER_FREE_TIER_KEY set — see
// playwright.config.js) so the ENV-KEY free tier, its per-account run gate and
// its `GET .../api/dispatch/quota` read are all reachable. The default 3001
// server leaves the key empty and many specs assert that state.
//
// The run count reads dispatch rows (`dispatchedBy`, `countFreshRunsSince`), so
// these tests clear the dispatch queue AND history, never just the free-tier
// store. Counts are the session account's own merge group only.
test.use({ baseURL: 'http://localhost:3003' });

// UUID for TEST-11 ("Blocked on external API access", In Progress) — a leaf task,
// preserved by workspaceApiLocalSeed so existing locators/ids survive.
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Drop this workspace's counter and every dispatch row (queue + history). */
async function clearRuns(page, urlKey) {
  await page.goto(`/test/clear-free-tier?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
}

/** The caller's own run allowance. */
async function readQuota(page, urlKey) {
  const res = await page.request.get(`/workspace/${urlKey}/api/dispatch/quota`);
  expect(res.status()).toBe(200);
  return res.json();
}

/** Start one fresh run through the session dispatch lane. */
async function postRun(page, urlKey, i = 0) {
  return page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: `run ${i}`, kind: 'implementation' },
  });
}

/** Open the shared opened-task component's Prompts accordion on Swipe. */
async function openPrompts(page) {
  await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().click();
  await expect(page.locator('.prompt-section').first()).toBeVisible();
}

/** Expand the Prompts accordion for an issue on a tree surface (Home). */
async function expandPromptsSection(page, containerSelector, issueId) {
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  await details.locator('.detail-toggle[data-toggle="prompts"]').click();
}

// =============================================================================
// Run contract — API
// =============================================================================

test.describe('Free Tier run contract (API)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    await clearRuns(page, localWorkerUrlKey);
  });

  test('the quota read reports the caller\'s own run counts', async ({ page, localWorkerUrlKey }) => {
    const q = await readQuota(page, localWorkerUrlKey);
    expect(q.limited).toBe(true);
    expect(q.runsUsed).toBe(0);
    expect(q.limit).toBeGreaterThan(0);
    expect(q.remaining).toBe(q.limit);
    expect(typeof q.resetsAt).toBe('string');
  });

  test('prompts are never refused for daily usage (more than the old daily 5 all succeed)', async ({ page, localWorkerUrlKey }) => {
    // The retired per-workspace daily prompt cap was 5; seven prompts in a row
    // must now all succeed (only the global hourly net can refuse, set high in
    // the Playwright env).
    for (let i = 0; i < 7; i++) {
      const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
      expect(res.status(), `prompt ${i + 1} must not be refused`).toBe(200);
    }
    // Prompts never consume runs.
    const q = await readQuota(page, localWorkerUrlKey);
    expect(q.runsUsed).toBe(0);
  });

  test('fresh runs are admitted under the limit and refused at it with RUN_LIMIT_REACHED', async ({ page, localWorkerUrlKey }) => {
    const { limit } = await readQuota(page, localWorkerUrlKey);

    for (let i = 0; i < limit; i++) {
      const res = await postRun(page, localWorkerUrlKey, i);
      expect(res.status(), `run ${i + 1} of ${limit} admitted`).toBe(201);
    }

    const at = await readQuota(page, localWorkerUrlKey);
    expect(at.runsUsed).toBe(limit);
    expect(at.remaining).toBe(0);

    const refused = await postRun(page, localWorkerUrlKey, limit);
    expect(refused.status()).toBe(429);
    const body = await refused.json();
    expect(body.code).toBe('RUN_LIMIT_REACHED');
    expect(body.freeTier.used).toBe(true);
    expect(body.freeTier.runsUsed).toBe(limit);
    expect(body.freeTier.remaining).toBe(0);
  });

  test('a paid/own key is not limited: the quota read reports limited:false', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // A session OpenRouter key overrides the env free tier (once per caller).
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    const q = await readQuota(page, localWorkerUrlKey);
    expect(q.limited).toBe(false);
    expect(q.runsUsed).toBe(null);
  });
});

// =============================================================================
// Run contract — the Go ladder (shared opened-task component, on Swipe)
// =============================================================================

test.describe('Free Tier run contract (ladder)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // dispatch + proxy enable the run rungs so the run-limit state is visible.
    await seedLocal(workspaceApiLocalSeed, {
      freeTierEnabled: true,
      features: { dispatch: true, proxy: true },
    });
    await clearRuns(page, localWorkerUrlKey);
  });

  test('N>0: the ladder shows "N of <limit> runs left today" and the run rungs are ready', async ({ page, localWorkerUrlKey }) => {
    const { limit, remaining } = await readQuota(page, localWorkerUrlKey);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
    await openPrompts(page);

    const component = page.locator('.prompt-section').first();
    const quotaEl = component.locator('[data-testid="opened-task-run-quota"]');
    await expect(quotaEl).toBeVisible();
    await expect(quotaEl).toHaveText(`${remaining} of ${limit} runs left today`);

    const ladder = component.locator('[data-testid="opened-task-ladder"]');
    const runTask = ladder.locator('[data-rung="run-task"]');
    await expect(runTask).toBeEnabled();
    await expect(runTask).not.toContainText(/run limit/i);

    // ✦ generation stays enabled regardless of the run allowance.
    await expect(component.locator('[data-testid="opened-task-go"]')).toBeEnabled();
  });

  test('N=0: only the run rungs are disabled; generation still works', async ({ page, localWorkerUrlKey }) => {
    const { limit } = await readQuota(page, localWorkerUrlKey);
    for (let i = 0; i < limit; i++) {
      const res = await postRun(page, localWorkerUrlKey, i);
      expect(res.status()).toBe(201);
    }

    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
    await openPrompts(page);

    const component = page.locator('.prompt-section').first();
    const quotaEl = component.locator('[data-testid="opened-task-run-quota"]');
    await expect(quotaEl).toHaveText(`0 of ${limit} runs left today`);

    const ladder = component.locator('[data-testid="opened-task-ladder"]');
    const runTask = ladder.locator('[data-rung="run-task"]');
    await expect(runTask).toBeDisabled();
    await expect(runTask).toContainText(/run limit reached/i);

    // Generation is NOT gated by the run limit: the ✦ primary is enabled and
    // produces a prompt.
    const go = component.locator('[data-testid="opened-task-go"]');
    await expect(go).toBeEnabled();
    await go.click();
    await expect(component.locator('[data-testid="opened-task-reasoning"]')).toBeVisible({ timeout: 10000 });

    // Once a prompt exists, run-this-step would otherwise be ready — it too is
    // disabled by the run limit.
    const runStep = ladder.locator('[data-rung="run-step"]');
    await expect(runStep).toBeDisabled();
    await expect(runStep).toContainText(/run limit reached/i);
  });
});

// =============================================================================
// Run contract — Home (the shared opened-task component mounted by #1720)
// =============================================================================

test.describe('Free Tier UI', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    await clearRuns(page, localWorkerUrlKey);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('shows the ✦ primary enabled for free tier users', async ({ page }) => {
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Free tier acts like having a key: the ✦ primary is runnable.
    const go = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] [data-testid="opened-task-go"]`);
    await expect(go).toBeVisible();
    await expect(go).toBeEnabled();
  });

  test('footer shows the free tier status with no daily-prompt count', async ({ page }) => {
    const footerStatus = page.locator('.footer-ai-status.free');
    await expect(footerStatus).toBeVisible();
    await expect(footerStatus).toContainText('ai:');
    await expect(footerStatus).toContainText('free');
    await expect(footerStatus).not.toContainText('daily');
  });

  // Ledger item 1: #1720 put Home on the shared component, so the LIN-3239 run
  // allowance now renders there too. This is the Home witness that the ladder
  // quota renders (the Swipe ladder owns the N=0 / rung-disabled cases).
  test('Home renders the run allowance and no retired daily-prompt meter', async ({ page, localWorkerUrlKey }) => {
    const { limit, remaining } = await readQuota(page, localWorkerUrlKey);

    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const component = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .prompt-section`);
    await expect(component.locator('[data-testid="opened-task-run-quota"]'))
      .toHaveText(`${remaining} of ${limit} runs left today`);

    // Generating a prompt still works, and the retired free-tier prompt meter
    // (the old daily-prompt allowance) never appears (LIN-3239).
    await component.locator('[data-testid="opened-task-go"]').click();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });
    await expect(component.locator('[data-prompt-body]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="free-tier-info"]')).toHaveCount(0);
  });

  test('Home: exhausting runs disables only the run rungs; ✦ stays enabled', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // dispatch + proxy render the run rungs, so the run-limit state is visible.
    await seedLocal(workspaceApiLocalSeed, {
      freeTierEnabled: true,
      features: { dispatch: true, proxy: true },
    });
    await clearRuns(page, localWorkerUrlKey);
    const { limit } = await readQuota(page, localWorkerUrlKey);
    for (let i = 0; i < limit; i++) {
      const res = await postRun(page, localWorkerUrlKey, i);
      expect(res.status()).toBe(201);
    }

    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    const component = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .prompt-section`);
    await expect(component.locator('[data-testid="opened-task-run-quota"]'))
      .toHaveText(`0 of ${limit} runs left today`);

    const ladder = component.locator('[data-testid="opened-task-ladder"]');
    const runTask = ladder.locator('[data-rung="run-task"]');
    await expect(runTask).toBeDisabled();
    await expect(runTask).toContainText(/run limit reached/i);

    // Generation is NOT gated by run state, and the retired prompt-quota reason
    // is nowhere on the component (LIN-3239).
    await expect(component.locator('[data-testid="opened-task-go"]')).toBeEnabled();
    await expect(component).not.toContainText(/daily free-tier limit reached/i);
  });
});

test.describe('Free Tier Settings', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    await clearRuns(page, localWorkerUrlKey);
  });

  test('settings page shows free tier status and the runs allowance', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const freeTierStatus = page.locator('[data-free-tier-status]');
    await expect(freeTierStatus).toBeVisible();
    await expect(freeTierStatus).toContainText('free tier');
    await expect(page.locator('.action-btn.connect')).toContainText('connect for unlimited');

    // The usage slot is the run allowance, filled from the own-counts quota read.
    const usageEl = page.locator('[data-free-tier-usage]');
    const { limit, remaining } = await readQuota(page, localWorkerUrlKey);
    await expect(usageEl).toContainText(`${remaining} of ${limit} runs left today`, { timeout: 5000 });
  });
});
