import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-3247 (P2 of LIN-2949): the run-evidence fragment mounted at the top of
// the per-session page. A finished run renders asked / done / checked (the
// review's claim and the live head, side by side), the collapsed review ledger,
// and the close-out box.
//
// GitHub is stubbed HERMETICALLY: the server-side PR-state read goes through
// `readPrStatusFailOpen`, whose cache is primed by `/test/seed-pr-status`
// (routes/test.js, test-only). No live api.github.com request is made.
//
// Guest / non-owner coverage is at unit level (tests/unit/render-run-evidence
// .test.js: "a guest / non-owner renders no box at all"): this harness has no
// non-owner session — `workspaceFromUrl` requires `req.session.workspaces` —
// and the guest view is LIN-2950's surface, not built here.

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

// Seed a local workspace whose issue carries the PR URL + the review ledger, so
// the page's run-evidence read finds them through the REAL local provider.
async function seedLocalWorkspaceWithEvidence(page, { extraPrUrl = null } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const comments = [
    { id: 'c-pr', body: `Opened the pull request: ${PR}${extraPrUrl ? ` and ${extraPrUrl}` : ''}`, createdAt: '2026-07-01T10:00:00Z', user: 'Runner' },
    { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-07-02T10:00:00Z', user: 'Reviewer' },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      projects: [{ id: id('rev-proj'), name: 'Evidence Project', content: `repo=${REPO}`, sortOrder: 1 }],
      issues: [{
        id: id('rev-issue'), identifier: 'LOCAL-EV1', title: 'Finished run evidence', description: 'Seeded run-evidence task',
        projectId: id('rev-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${URL_KEY}/issue/${id('rev-issue')}`,
        comments,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

// Seed a finished (terminal [done]) session on LOCAL-EV1 so session.seedIssue
// resolves to it and the run reconstructs with a transcript.
async function seedFinishedRun(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LOCAL-EV1', issueTitle: 'Finished run evidence', target: 'cli' },
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-EV1', issueTitle: 'Finished run worker', target: 'cli', sessionId: anchorId },
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: `[evidence] opened PR ${PR}`, url: PR, urlLabel: 'PR #12' },
  });
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[done] landed the change' },
  });
}

async function discoverSessionId(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  const seeded = all.find(s => String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

async function gotoSession(page, sessionId) {
  await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
  await page.waitForLoadState('networkidle');
}

test.describe('Run evidence on the session page (LIN-3247)', () => {
  test('ready: asked/done/checked rows, collapsed ledger, ready box — and no straggler flags', async ({ page }) => {
    await seedLocalWorkspaceWithEvidence(page);
    await seedFinishedRun(page);
    await page.request.post('/test/seed-pr-status', {
      data: { repo: REPO, number: 12, readable: true, state: 'open', merged: false, headSha: PR_HEAD, checks: [{ name: 'unit', conclusion: 'success' }] },
    });
    const sessionId = await discoverSessionId(page);
    await gotoSession(page, sessionId);

    const mount = page.locator('[data-testid="run-evidence-mount"]');
    await expect(mount).toBeVisible();

    // Mounted at the top: the evidence block precedes the run-header section.
    const mountBox = await mount.boundingBox();
    const headerBox = await page.locator('.sess-run-header').boundingBox();
    expect(mountBox.y).toBeLessThan(headerBox.y);

    // No straggler waiting/parked flags above it — a finished run is finished.
    await expect(page.locator('[data-testid="session-waiting-banner"]')).toHaveCount(0);

    // asked / done rows.
    await expect(page.locator('[data-testid="run-evidence-asked"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-done"]')).toContainText('PR #12');

    // The checked row is TWO labelled lines, never blended.
    const reviewLine = page.locator('[data-testid="run-evidence-checked-review"]');
    const nowLine = page.locator('[data-testid="run-evidence-checked-now"]');
    await expect(reviewLine).toBeVisible();
    await expect(nowLine).toBeVisible();
    await expect(reviewLine).toContainText('Approve — conditional on close-out discharging the ledger.');
    await expect(nowLine).toContainText('passing');
    // Review recorded a different head → shown, not gated.
    await expect(page.locator('[data-testid="run-evidence-head-moved"]')).toBeVisible();

    // The ledger is COLLAPSED by default and expands to items with marks.
    const ledger = page.locator('[data-testid="run-evidence-ledger"]');
    await expect(ledger).toBeAttached();
    expect(await ledger.evaluate(el => el.open)).toBe(false);
    await ledger.locator('summary').click();
    await expect(page.locator('[data-testid="run-evidence-ledger-item"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="run-evidence-ledger-item"][data-scope="inside"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="run-evidence-ledger-item"][data-scope="outside"]')).toHaveCount(1);
    // Each claim is one step from its proof: the follow-up ticket is shown.
    await expect(page.locator('[data-testid="run-evidence-ledger-followup"]')).toContainText('LIN-9999');

    // The ready box, with the "or merge it yourself" wording.
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-ready"]')).toContainText('PR ready for close-out');
    await expect(page.locator('[data-testid="run-evidence-closeout-merge-yourself"]')).toContainText('or merge it yourself on GitHub');
  });

  test('withheld: an unreadable PR read says "not checked" and shows the withheld box', async ({ page }) => {
    await seedLocalWorkspaceWithEvidence(page);
    await seedFinishedRun(page);
    await page.request.post('/test/seed-pr-status', {
      data: { repo: REPO, number: 12, readable: false, reason: 'not readable: private repository' },
    });
    const sessionId = await discoverSessionId(page);
    await gotoSession(page, sessionId);

    await expect(page.locator('[data-testid="run-evidence-checked-now"]')).toContainText('not checked');
    await expect(page.locator('[data-testid="run-evidence-not-checked"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-withheld"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toHaveCount(0);
  });

  test('withheld: more than one PR withholds the ready box and says what is known', async ({ page }) => {
    await seedLocalWorkspaceWithEvidence(page, { extraPrUrl: `https://github.com/${REPO}/pull/13` });
    await seedFinishedRun(page);
    const sessionId = await discoverSessionId(page);
    await gotoSession(page, sessionId);

    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="multiple-prs"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-withheld"]')).toContainText('more than one PR');
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toHaveCount(0);
  });
});
