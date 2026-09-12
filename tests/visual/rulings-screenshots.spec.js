/**
 * Rulings Tab Screenshot Maker (LIN-2757, Acceptance criterion 3).
 *
 * Unlike the other makers in this directory, rulings state does not exist via
 * the visual family's mock-fixture path (`/test/set-session` + a static
 * fixture) — a suggested ruling row and a live bulk bar only render against
 * real dispatch/dismissal-suggestion state. So this maker rides the SAME e2e
 * seeding `tests/e2e/observation-rulings.spec.js` already uses
 * (`seedDecisionWorker` + `suggestDismissal`, real dispatch take/feedback +
 * the real proxy suggest-dismissal route) rather than a mock fixture.
 *
 * Like the other makers in this directory, this WRITES PNGs and does not
 * assert — run it manually to refresh the reference set:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/rulings-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: tests/screenshots/rulings/<name>-{desktop,mobile}.png
 */
import { test } from '../fixtures/test-base.js';

const DIR = 'tests/screenshots/rulings';
const DESKTOP = { width: 1400, height: 1000 };
const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: 'serial' });

// Unlike the other makers' `capture` helper, this does NOT re-navigate
// between the desktop and mobile shots — the rulings tab's active-tab state
// and the bulk selection are set up client-side (a click + checkbox check),
// so a reload would lose both. Resizing the viewport in place and letting the
// existing DOM reflow is what keeps both captures showing the same state.
async function captureInPlace(page, name) {
  await page.setViewportSize(DESKTOP);
  await page.screenshot({ path: `${DIR}/${name}-desktop.png`, fullPage: true });

  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${DIR}/${name}-mobile.png`, fullPage: true });
}

// Mirrors tests/e2e/observation-rulings.spec.js's own seedDecisionWorker: an
// autopilot anchor + a taken/blocked worker + a `kind: 'decision'` feedback
// entry, so the row renders with real option buttons and the recommended
// marker (LIN-2757 Step 2's `recommendedLabel: 'agent recommends'`).
async function seedDecisionWorker(page, urlKey, { issueIdentifier, issueTitle, decisionId }) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
  });
  if (anchor.status() !== 201) throw new Error(`anchor seed failed (${anchor.status()}): ${await anchor.text()}`);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli', sessionId: anchorId }
  });
  if (worker.status() !== 201) throw new Error(`worker seed failed (${worker.status()}): ${await worker.text()}`);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  if (take.status() !== 200) throw new Error(`take failed (${take.status()}): ${await take.text()}`);

  const blockedResp = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need a ruling before continuing' }
  });
  if (blockedResp.status() !== 200) throw new Error(`blocked feedback failed (${blockedResp.status()}): ${await blockedResp.text()}`);

  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: {
      kind: 'decision',
      message: JSON.stringify({
        decision_id: decisionId,
        question: 'Proceed with the proposed migration?',
        options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
        recommended: 'a'
      })
    }
  });
  if (decision.status() !== 200) throw new Error(`decision feedback failed (${decision.status()}): ${await decision.text()}`);
  return { anchorId, workerId };
}

// Mirrors observation-rulings.spec.js's own suggestDismissal: a real standing
// proposal via the actual proxy suggest-dismissal route, never a fabricated
// client-side field.
// Polls GET /api/proxy/rulings for up to ~5s: the freshly-seeded decision-
// bearing loop can take a beat to reach the reconstructed feed this route
// reads from.
async function waitForRulingVisible(page, urlKey, decisionId) {
  const tokenResp = await page.request.get(`/test/create-proxy-token?scope=read&label=wait&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  for (let i = 0; i < 20; i++) {
    const resp = await page.request.get('/api/proxy/rulings', { headers: { Authorization: `Bearer ${token}` } });
    const { rulings } = await resp.json();
    if ((rulings || []).some((r) => r.decision?.decision_id === decisionId)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`ruling ${decisionId} never became visible in /api/proxy/rulings`);
}

async function suggestDismissal(page, urlKey, decisionId, reason) {
  await waitForRulingVisible(page, urlKey, decisionId);
  const tokenResp = await page.request.get(`/test/create-proxy-token?scope=readWrite&label=suggest&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const resp = await page.request.post(`/api/proxy/rulings/${decisionId}/suggest-dismissal`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { reason }
  });
  if (resp.status() !== 201) throw new Error(`suggest-dismissal failed (${resp.status()}): ${await resp.text()}`);
}

test.describe('Rulings tab', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-dispatch-history?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-agent-status?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-observation-sessions?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${workerUrlKey}`);
    await page.request.get(`/test/clear-dismissal-suggestions?urlKey=${workerUrlKey}`);
  });

  // Both required shots (Acceptance criterion 3): a suggested row showing the
  // new banner/row-button copy, and the bulk bar showing the new select-all/
  // button copy. Two suggested rows so the bulk bar renders with a real,
  // nonzero selection.
  test('suggested row + bulk bar', async ({ page, workerUrlKey }) => {
    await seedDecisionWorker(page, workerUrlKey, {
      issueIdentifier: 'LIN-2757-SHOT-1', issueTitle: 'Retry the flaky upload step', decisionId: 'd-lin2757-shot-1'
    });
    await suggestDismissal(page, workerUrlKey, 'd-lin2757-shot-1', 'Superseded by the retry logic landing separately');

    await seedDecisionWorker(page, workerUrlKey, {
      issueIdentifier: 'LIN-2757-SHOT-2', issueTitle: 'Confirm the migration window', decisionId: 'd-lin2757-shot-2'
    });
    await suggestDismissal(page, workerUrlKey, 'd-lin2757-shot-2', 'Window already confirmed in the ops channel');

    const observationUrl = `/workspace/${workerUrlKey}/observation`;
    await page.setViewportSize(DESKTOP);
    await page.goto(observationUrl);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();
    await page.waitForSelector('.obs-ruling-suggestion');

    // Select both rows so the bulk bar's "Apply N as proposed" and its
    // kind-neutral "select all proposed" checkbox both render live.
    await page.locator('#obs-ruling-select-all').check();
    await page.waitForTimeout(150);

    await captureInPlace(page, 'suggested-row-and-bulk-bar');
  });
});
