import { test, expect } from '../fixtures/test-base.js';

// LIN-3254 (ledger item 4): the run page's "chat about this run" flow, end to
// end — link → run-scoped turn proposes (dispatches nothing) → a "Proposed in
// chat" row on the run page → Apply dispatches exactly one follow-up → a second
// proposal → Decline dispatches nothing.
//
// Seeds the LIN-591 spine like session-page.spec.js: an autopilot anchor (cli
// target → `canReply`) whose seed issue is a fixture task the mockAi Task Chat
// can resolve (TEST-1). The task-chat route's mockAi branch takes the run-scoped
// propose path, so this needs no live LLM. The sessionId is discovered from the
// sessions feed, never guessed.

let URL_KEY;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

async function seedRun(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: {
      prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot',
      issueIdentifier: 'TEST-1', issueTitle: 'Run-chat seed', target: 'cli',
    },
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  return (await anchor.json()).item.id;
}

async function discoverSessionId(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  const seeded = all.find(s => String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session in the feed: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

async function queueCount(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dispatch`);
  expect(resp.status(), `queue read failed: ${await resp.text()}`).toBe(200);
  return (await resp.json()).items.length;
}

async function sendFollowUpTurn(page) {
  await page.locator('#task-chat-question').fill('Please follow up on this run.');
  await page.locator('#task-chat-send').click();
  await expect(page.locator('.task-chat-tool', { hasText: 'proposed a follow-up' })).toBeVisible({ timeout: 5000 });
}

test.describe('Run page: chat about this run → proposals (LIN-3254)', () => {
  test('proposes, applies once, and declines without dispatching', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ taskChat: true }))}&urlKey=${URL_KEY}`);
    await clearRuns(page);
    const sessionId = await seedRun(page).then(() => discoverSessionId(page));

    const sessionUrl = `/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`;
    const chatUrl = `/workspace/${URL_KEY}/task-chat?task=TEST-1&run=${encodeURIComponent(sessionId)}`;

    // The page's own link carries the run scope (task + run id).
    await page.goto(sessionUrl);
    await page.waitForLoadState('networkidle');
    const chatLink = page.locator('[data-testid="session-run-chat"]');
    await expect(chatLink).toBeVisible();
    await expect(chatLink).toHaveAttribute('href', /run=/);

    // A run-scoped turn proposes and dispatches nothing.
    const before = await queueCount(page);
    await page.goto(chatUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#task-chat-question')).toHaveValue(`About run ${sessionId}: `);
    await sendFollowUpTurn(page);
    expect(await queueCount(page)).toBe(before);

    // The run page shows the proposal row (always visible, no expand needed).
    await page.goto(sessionUrl);
    await page.waitForLoadState('networkidle');
    const proposals = page.locator('[data-testid="session-proposals"]');
    await expect(proposals).toBeVisible();
    await expect(proposals).toContainText('Proposed in chat');
    await expect(proposals).toContainText('Please post a status update.');
    const pendingRow = page.locator('[data-testid="session-proposal"][data-proposal-status="proposed"]');
    await expect(pendingRow).toHaveCount(1);

    // Apply dispatches exactly one follow-up and settles the row.
    await pendingRow.locator('[data-proposal-action="apply"]').click();
    await expect(page.locator('[data-testid="session-proposal"][data-proposal-status="applied"]')).toHaveCount(1);
    expect(await queueCount(page)).toBe(before + 1);

    // A second proposal, then Decline: no dispatch, row settles declined.
    await page.goto(chatUrl);
    await page.waitForLoadState('networkidle');
    await sendFollowUpTurn(page);
    await page.goto(sessionUrl);
    await page.waitForLoadState('networkidle');

    const declinedRow = page.locator('[data-testid="session-proposal"][data-proposal-status="proposed"]');
    await expect(declinedRow).toHaveCount(1);
    const queueBeforeDecline = await queueCount(page);
    await declinedRow.locator('[data-proposal-action="decline"]').click();
    await expect(page.locator('[data-testid="session-proposal"][data-proposal-status="declined"]')).toHaveCount(1);
    expect(await queueCount(page)).toBe(queueBeforeDecline);
  });
});
