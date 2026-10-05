/**
 * Share links E2E (LIN-3244, Session B of LIN-3073).
 *
 * Proves LIN-3073's Done line end to end against a real `NODE_ENV=test` server:
 *   - a SIGNED-OUT context gets 200 on `/s/<token>` and sees the collection's
 *     live children with their state labels (excluded states absent);
 *   - revoking through the owner route makes the same URL 410 and drops the
 *     children;
 *   - the workspace owner creates label and parent shares in the Settings
 *     "Share links" section, sees the URL once, sees the list without a token,
 *     and revokes from the list;
 *   - `scanPublicPages({ explicitPages })` over `['/', '/kpis', '/s/<token>']`
 *     is clean and lists the share.
 *
 * The share is seeded through the test-only `POST /test/seed-share`, which uses
 * the real ShareStore + buildShareSnapshot path, so the page renders exactly as
 * production would. Owner routes run on the session cookie (`page.request`).
 */
import { test, expect } from '../fixtures/test-base.js';
import { createSession } from '../helpers.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { scanPublicPages } from '../../lib/scan-public-pages.js';
import { scanText } from '../../lib/secret-scan.js';

async function seedShare(request, urlKey, body) {
  const res = await request.post(`/test/seed-share?urlKey=${encodeURIComponent(urlKey)}`, { data: body });
  expect(res.ok(), `seed-share failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function listShares(request, urlKey) {
  const res = await request.get(`/workspace/${encodeURIComponent(urlKey)}/shares`);
  expect(res.status()).toBe(200);
  return (await res.json()).shares;
}

async function revokeShare(request, urlKey, id) {
  const res = await request.post(`/workspace/${encodeURIComponent(urlKey)}/shares/${encodeURIComponent(id)}/revoke`);
  expect(res.status()).toBe(200);
  return res.json();
}

/** Revoke every share in the workspace so a test starts from a known list. */
async function clearShares(request, urlKey) {
  for (const share of await listShares(request, urlKey)) {
    if (!share.revokedAt) await revokeShare(request, urlKey, share.id);
  }
}

test.describe('Share link — guest view (LIN-3244)', () => {
  test('a signed-out /s/<token> lists the label children with states and no console errors', async ({ page, browser, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const seeded = await seedShare(page.request, workerUrlKey, { subject: { kind: 'label', id: 'bug' } });

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    const consoleErrors = [];
    guestPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const response = await guestPage.goto(`/s/${seeded.token}`);
    expect(response.status()).toBe(200);

    // The label `bug` members in the mock: TEST-3 (Done) and TEST-13 (Todo).
    const rows = guestPage.locator('[data-testid="share-task"]');
    await expect(rows).toHaveCount(2);

    const doneRow = rows.filter({ hasText: 'TEST-3' });
    await expect(doneRow).toBeVisible();
    await expect(doneRow.locator('.task-title')).toHaveText('Completed task');
    await expect(doneRow.locator('[data-status]')).toHaveAttribute('data-status', 'done');
    await expect(doneRow.locator('[data-status]')).toHaveAttribute('aria-label', 'Status: Completed');

    const todoRow = rows.filter({ hasText: 'TEST-13' });
    await expect(todoRow).toBeVisible();
    await expect(todoRow.locator('[data-status]')).toHaveAttribute('data-status', 'todo');
    await expect(todoRow.locator('[data-status]')).toHaveAttribute('aria-label', 'Status: To Do');

    // Exactly the two `bug` members — no other task (e.g. TEST-1, `feature`) leaked in.
    await expect(rows.locator('.task-identifier')).toHaveText(['TEST-3', 'TEST-13']);

    expect(consoleErrors).toEqual([]);
    await guest.close();
  });

  test('a parent share renders priority and last-updated, and descriptions only when opted in', async ({ page, browser, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const parentId = 'p-1';
    const issues = [
      { id: parentId, identifier: 'PAR-1', title: 'Parent', description: 'Parent body', state: { type: 'started' }, priority: 0, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c-open', identifier: 'PAR-2', title: 'Open child', description: 'Child body', parent: { id: parentId }, state: { type: 'started' }, priority: 2, updatedAt: '2026-01-02T00:00:00Z' }
    ];
    const on = await seedShare(page.request, workerUrlKey, { subject: { kind: 'parent', id: parentId }, includeDescriptions: true, issues });
    const off = await seedShare(page.request, workerUrlKey, { subject: { kind: 'parent', id: parentId }, includeDescriptions: false, issues });

    const guest = await browser.newContext();

    const onPage = await guest.newPage();
    expect((await onPage.goto(`/s/${on.token}`)).status()).toBe(200);
    await expect(onPage.locator('.share-description')).toHaveText('Parent body');
    await expect(onPage.locator('.task-description')).toHaveText('Child body');
    await expect(onPage.locator('[data-testid="share-task-priority"]')).toHaveText('High');
    const time = onPage.locator('time.task-updated');
    await expect(time).toHaveAttribute('datetime', '2026-01-02T00:00:00.000Z');
    await expect(time).toHaveText('2026-01-02');

    const offPage = await guest.newPage();
    expect((await offPage.goto(`/s/${off.token}`)).status()).toBe(200);
    await expect(offPage.locator('.share-description')).toHaveCount(0);
    await expect(offPage.locator('.task-description')).toHaveCount(0);
    // Priority and last-updated are unconditional fields, present either way.
    await expect(offPage.locator('[data-testid="share-task-priority"]')).toHaveText('High');
    await expect(offPage.locator('time.task-updated')).toHaveText('2026-01-02');

    await guest.close();
  });

  test('a label share shows task descriptions but never a parent description', async ({ page, browser, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const issues = [
      // A parent-looking issue with a description but NOT carrying the label.
      { id: 'p-1', identifier: 'PAR-1', title: 'Parent', description: 'Parent body', state: { type: 'started' }, priority: 0, updatedAt: '2026-01-01T00:00:00Z', labels: { nodes: [{ name: 'feature' }] } },
      { id: 'c-1', identifier: 'BUG-1', title: 'Bug task', description: 'Bug body', state: { type: 'started' }, priority: 3, updatedAt: '2026-01-03T00:00:00Z', labels: { nodes: [{ name: 'bug' }] } }
    ];
    const seeded = await seedShare(page.request, workerUrlKey, { subject: { kind: 'label', id: 'bug' }, includeDescriptions: true, issues });

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    expect((await guestPage.goto(`/s/${seeded.token}`)).status()).toBe(200);

    await expect(guestPage.locator('.share-description')).toHaveCount(0);
    await expect(guestPage.locator('.task-description')).toHaveText('Bug body');
    await expect(guestPage.locator('time.task-updated')).toHaveText('2026-01-03');

    await guest.close();
  });

  test('a parent share lists only the live children — canceled and duplicate are absent', async ({ page, browser, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const issues = [
      { id: 'p-1', identifier: 'PAR-1', title: 'Parent', state: { type: 'started' }, priority: 1, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c-done', identifier: 'PAR-2', title: 'Done child', parent: { id: 'p-1' }, state: { type: 'completed' }, priority: 2, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c-open', identifier: 'PAR-3', title: 'Open child', parent: { id: 'p-1' }, state: { type: 'started' }, priority: 2, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c-canceled', identifier: 'PAR-4', title: 'Canceled child', parent: { id: 'p-1' }, state: { type: 'canceled' }, priority: 2, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c-dup', identifier: 'PAR-5', title: 'Duplicate child', parent: { id: 'p-1' }, state: { type: 'duplicate' }, priority: 2, updatedAt: '2026-01-01T00:00:00Z' }
    ];
    const seeded = await seedShare(page.request, workerUrlKey, { subject: { kind: 'parent', id: 'p-1' }, issues });

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    const response = await guestPage.goto(`/s/${seeded.token}`);
    expect(response.status()).toBe(200);

    const rows = guestPage.locator('[data-testid="share-task"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'PAR-2' })).toBeVisible();
    await expect(rows.filter({ hasText: 'PAR-3' })).toBeVisible();
    await expect(rows.filter({ hasText: 'PAR-4' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'PAR-5' })).toHaveCount(0);
    await guest.close();
  });
});

test.describe('Share link — revoke (LIN-3244)', () => {
  test('revoking through the owner route makes the signed-out page 410 and drops the children', async ({ page, browser, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const seeded = await seedShare(page.request, workerUrlKey, { subject: { kind: 'label', id: 'bug' } });

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    expect((await guestPage.goto(`/s/${seeded.token}`)).status()).toBe(200);
    await expect(guestPage.locator('[data-testid="share-task"]').first()).toBeVisible();

    // Revoke the exact seeded share through the real owner route.
    await revokeShare(page.request, workerUrlKey, seeded.id);

    const after = await guestPage.goto(`/s/${seeded.token}`);
    expect(after.status()).toBe(410);
    await expect(guestPage.locator('[data-testid="share-task"]')).toHaveCount(0);
    await guest.close();
  });
});

test.describe('Share links — owner Settings (LIN-3244)', () => {
  test('owner creates label and parent shares, sees the URL once, lists without a token, revokes from the list', async ({ page, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    await page.goto(`/workspace/${workerUrlKey}/settings`);
    // Shares are durable; start from a known list.
    await clearShares(page.request, workerUrlKey);
    await page.reload();

    const section = page.locator('[data-testid="settings-section-share-links"]');
    await expect(section).toBeVisible();

    // Revoked rows are retained in the list; "active" = not revoked.
    const activeItems = section.locator('.share-item[data-revoked="false"]');
    await expect(activeItems).toHaveCount(0);

    // --- label share ---
    await section.locator('[data-testid="share-kind-select"]').selectOption('label');
    await section.locator('[data-testid="share-subject-input"]').fill('bug');
    await section.locator('[data-testid="share-create-btn"]').click();

    const createdUrl = section.locator('[data-testid="share-created-url"]');
    await expect(createdUrl).toContainText('/s/');
    const labelUrl = (await createdUrl.textContent()).trim();
    expect(labelUrl).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    const labelToken = labelUrl.split('/s/')[1];

    const labelItem = activeItems.filter({ hasText: 'bug' });
    await expect(labelItem).toHaveCount(1);
    await expect(labelItem).toBeVisible();
    // The list carries no token.
    expect(await section.locator('[data-testid="share-list"]').textContent()).not.toContain(labelToken);

    // --- parent share, using the identifier input (L9) ---
    await section.locator('[data-testid="share-kind-select"]').selectOption('parent');
    await section.locator('[data-testid="share-subject-input"]').fill('TEST-1');
    await section.locator('[data-testid="share-create-btn"]').click();
    // The mock parent TEST-1 has provider id `issue-1`; the row shows the id.
    await expect(activeItems.filter({ hasText: 'issue-1' })).toHaveCount(1);
    await expect(activeItems).toHaveCount(2);

    // --- revoke the label share from the list ---
    page.on('dialog', (dialog) => dialog.accept());
    await labelItem.locator('.share-revoke').click();
    await expect(activeItems.filter({ hasText: 'bug' })).toHaveCount(0);
    await expect(activeItems).toHaveCount(1);
  });
});

test.describe('Share link — local scan proof (LIN-3244)', () => {
  test('scanPublicPages over /, /kpis and the seeded share is clean and lists the share', async ({ page, workerUrlKey }) => {
    await createSession(page, { urlKey: workerUrlKey });
    const seeded = await seedShare(page.request, workerUrlKey, { subject: { kind: 'label', id: 'bug' } });

    // Scan the same origin this page is talking to (CI: http://localhost:3001).
    const baseUrl = new URL(page.url()).origin;
    const result = await scanPublicPages({
      baseUrl,
      explicitPages: ['/', '/kpis', `/s/${seeded.token}`]
    });

    expect(result.errors).toEqual([]);
    expect(result.clean).toBe(true);
    expect(result.scannedPages).toContain('/');
    expect(result.scannedPages).toContain('/kpis');
    expect(result.scannedPages).toContain(`/s/${seeded.token}`);
  });
});
// ---------------------------------------------------------------------------
// Run share links (LIN-3313, Phase 3 of LIN-2950). The run is a REAL
// reconstructed session on a local workspace (seeded through the dispatch API
// as tests/e2e/run-evidence.spec.js does), its PR state primed through the
// LIN-3251 seam (`/test/seed-pr-status` fills the shared PR-state store the
// share reader reads, so no live GitHub call is made), and the share is created
// through the OWNER route. The guest is a signed-out browser context with no
// storage, reaching `/s/<token>` through the real `/s/` exemption.
// ---------------------------------------------------------------------------

const RUN_REPO = 'acme/widget';
const RUN_PR = `https://github.com/${RUN_REPO}/pull/12`;
const RUN_REVIEW_BODY = [
  '## Review — seeded',
  '',
  'CI on `abc1234` is green.',
  '',
  '### What CI Did Not Prove',
  '| # | Claim | In/Out | Discharge |',
  '|---|---|---|---|',
  '| L1 | the socket path handles a foreign user (EACCES) | inside | manual repro on a real host |',
  '',
  '**Verdict: Approve.**',
].join('\n');

async function seedRunWorkspace(page, urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey,
      features: { dispatch: true },
      projects: [{ id: id('share-run-proj'), name: 'Share Run Project', content: `repo=${RUN_REPO}`, sortOrder: 1 }],
      issues: [{
        id: id('share-run-issue'), identifier: 'LOCAL-SR1', title: 'Shared run task', description: 'Seeded shared-run task',
        projectId: id('share-run-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${urlKey}/issue/${id('share-run-issue')}`,
        comments: [
          { id: 'c-pr', body: `Opened the pull request: ${RUN_PR}`, createdAt: '2026-07-01T10:00:00Z', user: 'Runner' },
          { id: 'c-review', body: RUN_REVIEW_BODY, createdAt: '2026-07-02T10:00:00Z', user: 'Reviewer' },
        ],
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function seedFinishedRunFor(page, urlKey) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LOCAL-SR1', issueTitle: 'Shared run task', target: 'cli', stopAt: 'pr' },
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;
  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-SR1', issueTitle: 'Shared run worker', target: 'cli', sessionId: anchorId },
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  expect((await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth })).status()).toBe(200);
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: `[evidence] opened PR ${RUN_PR}`, url: RUN_PR, urlLabel: 'PR #12' },
  });
  await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: auth, data: { message: '[done] landed the change' } });
}

async function discoverRunSessionId(page, urlKey) {
  const resp = await page.request.get(`/workspace/${urlKey}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  const seeded = all.find(s => s.seedIssue === 'LOCAL-SR1' && String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

async function resetRunWorkspace(page, urlKey) {
  await page.request.get('/test/clear-pr-status');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.goto(`/test/clear-agent-status?urlKey=${urlKey}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${urlKey}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
}

test.describe('Run share link — signed-out guest (LIN-3313)', () => {
  test.afterEach(async ({ page }) => {
    await page.request.get('/test/clear-pr-status');
  });

  test('owner creates a run share; a signed-out /s/<token> is 200, scans clean, goes stale "as of", and 410s on revoke', async ({ page, browser, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    await resetRunWorkspace(page, urlKey);
    await seedRunWorkspace(page, urlKey);
    // The share owner routes are owner-gated: this session's account owns it.
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    await seedFinishedRunFor(page, urlKey);
    await page.request.post('/test/seed-pr-status', {
      data: { repo: RUN_REPO, number: 12, readable: true, state: 'open', merged: false, headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', checks: [{ name: 'unit', conclusion: 'success' }] },
    });
    const sessionId = await discoverRunSessionId(page, urlKey);
    await clearShares(page.request, urlKey);

    // Owner create through the REAL owner route (first snapshot read + scan).
    const created = await page.request.post(`/workspace/${encodeURIComponent(urlKey)}/shares`, {
      data: { subject: { kind: 'run', id: sessionId } },
    });
    expect(created.status(), `run share create failed: ${await created.text()}`).toBe(201);
    const { token, url } = await created.json();
    expect(url).toBe(`/s/${token}`);

    // An unknown run is refused and mints nothing.
    const unknown = await page.request.post(`/workspace/${encodeURIComponent(urlKey)}/shares`, {
      data: { subject: { kind: 'run', id: 'no-such-run' } },
    });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).code).toBe('SHARE_RUN_NOT_FOUND');

    // The owner list carries the run row (kind run, subject = the run id), no token.
    const listed = await listShares(page.request, urlKey);
    const runRow = listed.find(r => r.kind === 'run' && !r.revokedAt);
    expect(runRow).toBeTruthy();
    expect(runRow.subjectId).toBe(sessionId);
    expect(JSON.stringify(listed)).not.toContain(token);

    // A signed-out context (no storage) gets the run page in guest mode.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    const consoleErrors = [];
    guestPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const response = await guestPage.goto(`/s/${token}`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-robots-tag']).toBe('noindex');
    await expect(guestPage.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(guestPage.locator('[data-testid="session-title"]')).toContainText('Shared run task');
    await expect(guestPage.locator('[data-testid="run-evidence"]')).toBeVisible();
    await expect(guestPage.locator('[data-testid="run-evidence-done"]')).toContainText('PR #12');
    await expect(guestPage.locator('[data-testid="session-pr-link"]')).toHaveAttribute('href', RUN_PR);
    // Guest mode: no owner affordances, no close-out box, no back link.
    await expect(guestPage.locator('[data-testid="run-evidence-closeout"]')).toHaveCount(0);
    await expect(guestPage.locator('[data-testid="session-back"]')).toHaveCount(0);
    await expect(guestPage.locator('[data-testid="session-run-chat"]')).toHaveCount(0);
    await expect(guestPage.locator('[data-testid="share-stale"]')).toHaveCount(0);
    const fullHtml = await response.text();
    expect(fullHtml).not.toContain('data-url-key');
    expect(scanText(fullHtml)).toEqual([]);
    expect(consoleErrors).toEqual([]);

    // The public-pages scan over the explicit list is clean and lists the share.
    const baseUrl = new URL(page.url()).origin;
    const result = await scanPublicPages({ baseUrl, explicitPages: ['/', '/kpis', `/s/${token}`] });
    expect(result.errors).toEqual([]);
    expect(result.clean).toBe(true);
    expect(result.scannedPages).toContain(`/s/${token}`);

    // Forced stale refresh: age the snapshot past the TTL, then remove the run
    // so the due refresh fails → last-good, marked "as of" (matrix row 6).
    const aged = await page.request.post('/test/age-share', { data: { token, ageMs: 120_000 } });
    expect(aged.ok()).toBeTruthy();
    await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
    await page.goto(`/test/clear-observation-sessions?urlKey=${urlKey}`);
    const staleResponse = await guestPage.goto(`/s/${token}`);
    expect(staleResponse.status()).toBe(200);
    await expect(guestPage.locator('[data-testid="share-stale"]')).toContainText('as of');
    await expect(guestPage.locator('[data-testid="session-title"]')).toContainText('Shared run task');

    // Revoke through the owner route → the same URL is 410 with no run content.
    await revokeShare(page.request, urlKey, runRow.id);
    const gone = await guestPage.goto(`/s/${token}`);
    expect(gone.status()).toBe(410);
    expect(await gone.text()).not.toContain('Shared run task');

    await guest.close();
  });
});
