import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-3248 (P3 of LIN-2949): the close-out box on a finished stop-at-PR run.
// Ready (standard and stepped, for N2), the "or merge it yourself" link, the
// merged-by-you state with open ledger items marked "open at merge", and no
// straggler flags at the top of the page.
//
// GitHub is stubbed hermetically through `/test/seed-pr-status` (as P2's
// run-evidence spec does); the page's close-out state is the server-rendered
// `deriveCloseOutState` model.

const REPO = 'acme/widget';
const PR = `https://github.com/${REPO}/pull/12`;
const PR_HEAD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const REVIEW_SHA = 'abc1234';

const REVIEW_BODY = [
  '## Review — seeded',
  '',
  'CI on `abc1234` is green.',
  '',
  '### What CI Did Not Prove',
  '| # | Claim | In/Out | Discharge |',
  '|---|---|---|---|',
  '| L1 | the socket path handles a foreign user (EACCES) | inside | manual repro on a real host |',
  '| L2 | the upstream contract is unchanged | outside | follow-up LIN-9999 |',
  '',
  '**Verdict: Approve — conditional on close-out discharging the ledger.**',
].join('\n');

let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-pr-status');
  await page.goto(`/test/clear-local-store`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

test.afterEach(async ({ page }) => {
  await page.request.get('/test/clear-pr-status');
});

async function seedLocalWorkspaceWithEvidence(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const comments = [
    { id: 'c-pr', body: `Opened the pull request: ${PR}`, createdAt: '2026-07-01T10:00:00Z', user: 'Runner' },
    { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-07-02T10:00:00Z', user: 'Reviewer' },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      features: { dispatch: true },
      projects: [{ id: id('co-proj'), name: 'Close-out Project', content: 'Seeded project', sortOrder: 1 }],
      issues: [{
        id: id('co-issue'), identifier: 'LOCAL-CO1', title: 'Finished stop-at-PR run', description: 'Seeded close-out task',
        projectId: id('co-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${URL_KEY}/issue/${id('co-issue')}`,
        comments,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

// Seed a finished stop-at-PR run on LOCAL-CO1. The variant is the row's own
// `variant` field — the promptName is deliberately the SAME generic
// `Autopilot (LOCAL-CO1)` for both, mirroring a real stepper kickoff, so this
// proves the N2 copy is driven by the row variant, never by promptName.
async function seedFinishedRun(page, { variant = 'standard', stopAt = 'pr' } = {}) {
  const promptName = 'Autopilot (LOCAL-CO1)';
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName, kind: 'autopilot', issueIdentifier: 'LOCAL-CO1', issueTitle: 'Finished stop-at-PR run', target: 'cli', stopAt, variant },
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-CO1', issueTitle: 'Runner', target: 'cli', sessionId: anchorId },
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // Take the anchor too, so the run row is history-only (production shape; F3).
  await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: auth });
  await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: `[evidence] opened PR ${PR}`, url: PR, urlLabel: 'PR #12' },
  });
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[done] landed the change' },
  });
}

async function discoverSessionId(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  // Select THIS spec's seeded run, not a stale session left by another local
  // spec sharing the worker's urlKey.
  const seeded = all.find(s => s.seedIssue === 'LOCAL-CO1' && String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

async function gotoSession(page, sessionId) {
  await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
  await page.waitForLoadState('networkidle');
}

async function openReadySession(page, { variant = 'standard' } = {}) {
  await seedLocalWorkspaceWithEvidence(page);
  await seedFinishedRun(page, { variant });
  await page.request.post('/test/seed-pr-status', {
    data: { repo: REPO, number: 12, readable: true, state: 'open', merged: false, headSha: PR_HEAD, checks: [{ name: 'unit', conclusion: 'success' }] },
  });
  const sessionId = await discoverSessionId(page);
  await gotoSession(page, sessionId);
}

test.describe('Close-out box on the session page (LIN-3248)', () => {
  test('ready: box sits under the evidence rows, ledger collapsed, no stragglers, standard promise', async ({ page }) => {
    await openReadySession(page);

    const evidence = page.locator('[data-testid="run-evidence"]');
    await expect(evidence).toBeVisible();

    // LIN-3251 §4 slots: evidence after the header strip and before the steps;
    // the close-out box after the steps (the old bundled `run-evidence-mount`
    // wrapper is gone in LIN-3251).
    const evidenceBox = await evidence.boundingBox();
    const headerBox = await page.locator('.sess-run-header').boundingBox();
    const stepsBox = await page.locator('.sess-steps').boundingBox();
    const boxBox = await page.locator('[data-testid="run-evidence-closeout"]').boundingBox();
    expect(headerBox.y).toBeLessThan(evidenceBox.y);
    expect(evidenceBox.y).toBeLessThan(stepsBox.y);
    expect(stepsBox.y).toBeLessThan(boxBox.y);

    // Asked / done / checked, then the collapsed ledger, then the ready box.
    await expect(page.locator('[data-testid="run-evidence-asked"]')).toBeVisible();
    const reviewLine = page.locator('[data-testid="run-evidence-checked-review"]');
    const nowLine = page.locator('[data-testid="run-evidence-checked-now"]');
    await expect(reviewLine).toBeVisible();
    await expect(nowLine).toBeVisible();
    await expect(reviewLine).toContainText('Approve — conditional on close-out discharging the ledger.');

    const ledger = page.locator('[data-testid="run-evidence-ledger"]');
    await expect(ledger).toBeAttached();
    expect(await ledger.evaluate(el => el.open)).toBe(false);

    // No straggler flags above the mount.
    await expect(page.locator('[data-testid="session-waiting-banner"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-ready"]')).toContainText('PR ready for close-out');
    await expect(page.locator('[data-testid="run-evidence-closeout-press"]')).toContainText('close out & merge');
    await expect(page.locator('[data-testid="run-evidence-closeout-merge-yourself"]')).toContainText('or merge it yourself on GitHub');
    // N2, standard direction: the promise is shown.
    await expect(page.locator('[data-testid="run-evidence-closeout-promise"]')).toContainText('Harbour never merges on its own');
  });

  test('N2, stepped direction: the promise is omitted on a stepped run', async ({ page }) => {
    await openReadySession(page, { variant: 'stepper' });

    const box = page.locator('[data-testid="run-evidence-closeout"]');
    await expect(box).toHaveAttribute('data-variant', 'stepper');
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-promise"]')).toHaveCount(0);
    // The press is still offered.
    await expect(page.locator('[data-testid="run-evidence-closeout-press"]')).toBeVisible();
  });

  test('merged by you: a reload records the self-merge (check fires for merged) and sets Done', async ({ page }) => {
    await seedLocalWorkspaceWithEvidence(page);
    await seedFinishedRun(page);
    await page.request.post('/test/seed-pr-status', {
      data: { repo: REPO, number: 12, readable: true, state: 'closed', merged: true, headSha: PR_HEAD, checks: [{ name: 'unit', conclusion: 'success' }] },
    });
    const sessionId = await discoverSessionId(page);

    // B1: a page load that already sees the merge must still call `check`, so the
    // `{by:'person'}` record is made and Done is set — not just the rendered text.
    const checkResponse = page.waitForResponse(r =>
      r.url().includes('/run-evidence/LOCAL-CO1/check') && r.request().method() === 'POST');
    await gotoSession(page, sessionId);
    const checkBody = await (await checkResponse).json();
    expect(checkBody.recorded, 'the self-merge is recorded on load').toHaveLength(1);
    expect(checkBody.recorded[0].by).toBe('person');
    expect(checkBody.done, 'R1 sets Done within its bounds').toBe(true);

    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="merged"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-merged"]')).toContainText('merged by you');

    // Open items are NOT hoisted: they stay in the collapsed ledger, marked.
    const ledger = page.locator('[data-testid="run-evidence-ledger"]');
    expect(await ledger.evaluate(el => el.open)).toBe(false);
    await ledger.locator('summary').click();
    await expect(page.locator('[data-testid="run-evidence-ledger-open-at-merge"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="run-evidence-ledger-open-no-followup"]')).toHaveCount(1);
    // Nothing above the evidence rows.
    await expect(page.locator('[data-testid="session-waiting-banner"]')).toHaveCount(0);
  });

  test('F1: a non-stop-at-PR merged run reads neutrally and never POSTs check', async ({ page }) => {
    await seedLocalWorkspaceWithEvidence(page);
    await seedFinishedRun(page, { stopAt: null });
    await page.request.post('/test/seed-pr-status', {
      data: { repo: REPO, number: 12, readable: true, state: 'closed', merged: true, headSha: PR_HEAD, checks: [{ name: 'unit', conclusion: 'success' }] },
    });
    const sessionId = await discoverSessionId(page);

    const checks = [];
    page.on('request', r => { if (r.url().includes('/run-evidence/LOCAL-CO1/check')) checks.push(r); });
    await gotoSession(page, sessionId);

    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="merged"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-neutral"]')).toContainText('already merged');
    await expect(page.locator('[data-testid="run-evidence-closeout-merged"]')).toHaveCount(0);
    // Give the on-load check a chance to (not) fire.
    await page.waitForTimeout(600);
    expect(checks, 'a non-stop-at merged page must not POST check').toHaveLength(0);
  });
});
