import { test, expect } from '../fixtures/test-base.js';

// LIN-1736 — the operator-facing escalation KPI audit page: escalation rate,
// time-to-response, false-escalation rate, unanswered age
// (docs/escalation-philosophy.md §7). Session-authed, cross-workspace like
// the rest of Observation — never the public /kpis surface.

let URL_KEY;
let KPIS_URL;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  KPIS_URL = `/workspace/${URL_KEY}/escalation-kpis`;
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
}

// Seed a taken worker carrying a `kind: 'decision'` entry — the same real
// take+feedback flow observation-rulings.spec.js's seedDecisionWorker uses.
async function seedDecisionWorker(page, { issueIdentifier, decisionId }) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle: 'KPI fixture', target: 'cli' }
  });
  expect(anchor.status()).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle: 'KPI fixture', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status()).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status()).toBe(200);

  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need a ruling before continuing' }
  });
  expect(blocked.status()).toBe(200);

  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed?', options: [{ id: 'a', label: 'Approve' }] }) }
  });
  expect(decision.status()).toBe(200);
  return { workerId };
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

  test('a real unanswered decision is reflected in the unanswered-age card', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-KPI-1', decisionId: 'd-kpi-1' });

    await page.goto(KPIS_URL);
    await expect(page.locator('[data-testid="kpi-unanswered-age"]')).toContainText('1 waiting');
  });

  test('a resolved decision (answered) is reflected in time-to-response, not false-escalation', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-KPI-2', decisionId: 'd-kpi-2' });

    const commentResp = await page.request.post(`/workspace/${URL_KEY}/api/comments/LIN-KPI-2`, {
      data: { body: 'Approve', decisionLoopId: workerId, decisionId: 'd-kpi-2' }
    });
    expect(commentResp.status()).toBe(201);

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
