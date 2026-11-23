import { test, expect } from '../fixtures/test-base.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';

// LIN-1736 — the operator-facing escalation KPI audit page: escalation rate,
// time-to-response, false-escalation rate, unanswered age
// (docs/escalation-philosophy.md §7). Session-authed, cross-workspace like
// the rest of Observation — never the public /kpis surface.
//
// LIN-4538 (P7a): the KPIs are read from question records (lib/records/question-facts.js):
// an open question is unanswered, an answered one is resolved, and only a person's
// "dismissed" withdrawal is a false escalation. The fixtures ask through a question record.

let URL_KEY;
let KPIS_URL;

test.beforeEach(async ({ page, workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  KPIS_URL = `/workspace/${URL_KEY}/escalation-kpis`;
  // LIN-3198 Class A: drop the in-process comment-dedupe caches. The resolved-
  // decision test re-posts the same "Approve" body to the same (workspace,
  // LIN-KPI-2) every run; the 5-min server-side dedupe window would otherwise
  // collapse a repeat run's fresh 201 into a deduped 200, making the exact-201
  // assertion retry-fatal. Global clear (the dedupe key is hashed, so it can't
  // be urlKey-scoped).
  await page.request.get('/test/clear-comment-dedupe');
});

async function clearRuns(page) {
  await page.goto(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
}

// A run parked on `[blocked]` and the question it asked the person (tests/fixtures/question-records.js).
async function seedQuestionRun(page, { issueIdentifier }) {
  const runId = await askingRun(page, URL_KEY, issueIdentifier);
  const questionId = await seedQuestion(page, URL_KEY, { ticket: issueIdentifier, runId, asks: 'Proceed?', options: ['Approve'] });
  return { runId, questionId };
}

test.describe('Escalation KPIs page (LIN-1736)', () => {
  test('loads with an honest empty state when nothing has ever escalated', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);

    const resp = await page.goto(KPIS_URL);
    expect(resp.status()).toBe(200);
    await expect(page.locator('[data-testid="kpi-grid"]')).toBeVisible();
    for (const testId of ['kpi-escalation-rate', 'kpi-time-to-response', 'kpi-false-escalation', 'kpi-unanswered-age']) {
      await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="kpi-time-to-response"]')).toContainText('no rulings resolved in this window');
  });

  test('a real unanswered question is reflected in the unanswered-age card', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedQuestionRun(page, { issueIdentifier: 'LIN-KPI-1' });

    await page.goto(KPIS_URL);
    await expect(page.locator('[data-testid="kpi-unanswered-age"]')).toContainText('1 waiting');
  });

  test('a resolved question (answered) is reflected in time-to-response, not false-escalation', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { questionId } = await seedQuestionRun(page, { issueIdentifier: 'LIN-KPI-2' });

    // Answered through the one answer route (routes/question-answers.js), as every surface answers.
    const answerResp = await page.request.post(`/workspace/${URL_KEY}/questions/${encodeURIComponent(questionId)}/answer`, {
      data: { option: 'Approve' }
    });
    expect(answerResp.status()).toBe(200);
    const kpi = await (await page.request.get(`/workspace/${URL_KEY}/api/escalation-kpis`)).json();
    expect(kpi.falseEscalation.dismissed, 'an answer is not a dismissal').toBe(0);

    await page.goto(KPIS_URL);
    await expect(page.locator('[data-testid="kpi-time-to-response"]')).toContainText('resolved');
    await expect(page.locator('[data-testid="kpi-time-to-response"]')).not.toContainText('no rulings resolved');
  });

  test('the window selector changes windowDays and reloads', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(KPIS_URL);
    await page.selectOption('#kpi-window-days', '90');
    await page.waitForURL(/windowDays=90/);
    await expect(page.locator('#kpi-window-days')).toHaveValue('90');
  });
});
