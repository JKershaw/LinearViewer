/**
 * LIN-4104 evidence maker (beat 5): the three-button run control, its filled variants, the Next step confirm, busy,
 * answer-first, and the running wording (Running to PR / Running to Done / Harbour is deciding), for the owner (with a
 * runner) at 1280px and 390px, light and dark, and for a new user with no runner (copy-first). Like the other makers in
 * this directory it writes PNGs and asserts only what it needs to frame the picture:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4104-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-02-lin4104/
 *   filled-next-step-owner-{light,dark}-{1280,390}.png  no prior dispatch: Next step is filled, Run to PR beside it
 *   filled-pr-owner-{light,dark}-1280.png              last dispatch a Run to PR: Run to PR is filled
 *   filled-done-owner-{light,dark}-1280.png            last dispatch a Run to Done: Run to Done is filled (enabled)
 *   next-step-confirm-owner-{light,dark}-1280.png      Next step recommended a subtask: stage, why, target, Run
 *   busy-owner-light-1280.png                          a subtask runs: the container offers no run
 *   answer-first-owner-light-1280.png                  a subtask needs a ruling: the box leads with the question
 *   running-to-pr-owner-light-1280.png                 a Run to PR is running: "Running to PR · started with ..."
 *   harbour-deciding-owner-light-1280.png              a worker whose run row is missing: "Harbour is deciding"
 *   copy-first-newuser-{light,dark}-{1280,390}.png     a new user with no runner: the copy-first view, no run control
 *
 * Data seam: the local provider, since the states need real dispatch rows. Runs, workers and rulings are written through
 * the public dispatch API the way a runner writes them (as lin-4103 does). The recommend stream is stubbed at the network
 * edge for the confirm only (this server has no AI key); everything else is the real page.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-11-02-lin4104';
const OLD = '2020-01-01T00:00:00Z';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const PARENT = 'LOCAL-1';
const CHILD = 'LOCAL-2';
const LEAF = 'LOCAL-3';

test.describe.configure({ mode: 'serial' });

/** A clean workspace: no dispatch history, no task-mode record, one container with one Todo subtask and one leaf. */
async function seedFresh(page, urlKey, { runnerKey = true } = {}) {
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  await page.request.get(`/test/clear-task-mode-events?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  const issue = (raw, identifier, title, type, more = {}) => ({
    id: id(raw), identifier, title, createdAt: OLD, url: `https://example.com/${raw}`,
    description: `## Why\n\n${title}, seeded for the LIN-4104 evidence.`,
    state: { name: { started: 'In Progress', unstarted: 'Todo' }[type], type },
    ...more,
  });
  const p = id('p-run');
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, runnerKey,
      issues: [
        issue('parent', PARENT, 'Next step container: the run control on a container', 'started', { projectId: p, sortOrder: 0 }),
        issue('child', CHILD, 'Write the next step', 'unstarted', { projectId: p, parentId: id('parent'), sortOrder: 1 }),
        issue('leaf', LEAF, 'A leaf task with its own run control', 'started', { projectId: p, sortOrder: 2 }),
      ],
      projects: [{ id: p, name: 'Run control', content: 'The run control and its states', sortOrder: 0 }],
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
}

async function runnerAuth(page, urlKey) {
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Enqueue a dispatch and take it (it runs). Returns the item id. */
async function startRun(page, urlKey, auth, body) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, { data: { target: 'cli', ...body } });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
  return itemId;
}

async function finish(page, auth, itemId, message) {
  expect((await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message } })).status()).toBe(200);
}

/** A finished autopilot run: the workspace's last dispatch reaches the stop the kickoff named (pr, or done with no stop). */
async function finishedAutopilot(page, urlKey, auth, { stopAt = null } = {}) {
  const body = { prompt: 'autopilot prompt', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: PARENT, issueTitle: 'Next step container', entryRung: 'run-task' };
  if (stopAt) body.stopAt = stopAt;
  const itemId = await startRun(page, urlKey, auth, body);
  await finish(page, auth, itemId, '[done] ran to the end');
}

async function openTask(page, urlKey, identifier, { viewport, theme }) {
  await page.context().clearCookies({ name: 'theme' });
  if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
  await page.setViewportSize(viewport);
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
  await page.locator(`.running-section .line[data-identifier="${identifier}"]`).first().click();
  const box = page.locator('[data-testid="opened-task"]').first();
  await expect(box).toBeVisible();
  await page.waitForLoadState('networkidle');
  return box;
}

async function snap(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

for (const theme of ['light', 'dark']) {
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    test(`filled Next step (no prior dispatch), owner, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
      await seedFresh(page, localWorkerUrlKey);
      const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport, theme });
      const primary = box.locator('[data-testid="opened-task-go"]');
      await expect(primary).toContainText('Next step');
      await expect(box.locator('[data-testid="opened-task-run-to-pr"]')).toBeVisible();
      await snap(page, `filled-next-step-owner-${theme}-${label}`);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`filled Run to PR, owner, ${theme}, 1280px`, async ({ page, localWorkerUrlKey }) => {
    await seedFresh(page, localWorkerUrlKey);
    const auth = await runnerAuth(page, localWorkerUrlKey);
    await finishedAutopilot(page, localWorkerUrlKey, auth, { stopAt: 'pr' });
    const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme });
    await expect(box.locator('[data-testid="opened-task-go"]')).toContainText('Run to PR');
    await snap(page, `filled-pr-owner-${theme}-1280`);
  });

  test(`filled Run to Done, owner, ${theme}, 1280px`, async ({ page, localWorkerUrlKey }) => {
    await seedFresh(page, localWorkerUrlKey);
    const auth = await runnerAuth(page, localWorkerUrlKey);
    await finishedAutopilot(page, localWorkerUrlKey, auth);
    const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme });
    await expect(box.locator('[data-testid="opened-task-go"]')).toContainText('Run to Done');
    await expect(box.locator('[data-testid="opened-task-go"]')).toBeEnabled();
    await snap(page, `filled-done-owner-${theme}-1280`);
  });

  test(`Next step confirm: the stage, why and the subtask it is for, owner, ${theme}, 1280px`, async ({ page, localWorkerUrlKey }) => {
    await seedFresh(page, localWorkerUrlKey);
    const sse = (events) => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    // The recommendation defers from the container into its subtask (the stream is stubbed; this server has no AI key).
    await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        ['phase', { phase: 'reasoning' }],
        ['delta', { section: 'reasoning', content: 'The subtask is the next concrete step: writing it comes before the container can close, so the Build stage goes there.' }],
        ['phase', { phase: 'prompt' }],
        ['delta', { section: 'prompt', content: 'Write the next step for LOCAL-2.' }],
        ['done', { truncated: false, completionTokens: null, issueUrl: null, identifier: CHILD, title: 'Write the next step', deferredVia: [PARENT], kind: 'implementation', issueId: localSeedId(localWorkerUrlKey, 'child') }],
      ]),
    }));
    const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme });
    await box.locator('[data-testid="opened-task-go"]').click();
    await expect(box.locator('[data-testid="opened-task-next-confirm"]')).toBeVisible();
    await expect(box.locator('[data-testid="opened-task-next-target"]')).toContainText('a subtask of LOCAL-1');
    await snap(page, `next-step-confirm-owner-${theme}-1280`);
  });
}

test('busy: a subtask runs, so the container offers no run, owner, light, 1280px', async ({ page, localWorkerUrlKey }) => {
  await seedFresh(page, localWorkerUrlKey);
  const auth = await runnerAuth(page, localWorkerUrlKey);
  await startRun(page, localWorkerUrlKey, auth, { prompt: 'implementation prompt', promptName: 'Build', kind: 'implementation', issueIdentifier: CHILD, issueTitle: 'Write the next step' });
  const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme: 'light' });
  await expect(box.locator('[data-testid="opened-task-go"]')).toHaveCount(0);
  await snap(page, 'busy-owner-light-1280');
});

test('answer-first: a subtask needs a ruling, so the box leads with the question, owner, light, 1280px', async ({ page, localWorkerUrlKey }) => {
  await seedFresh(page, localWorkerUrlKey);
  const auth = await runnerAuth(page, localWorkerUrlKey);
  const itemId = await startRun(page, localWorkerUrlKey, auth, { prompt: 'research prompt', promptName: 'research', kind: 'research', issueIdentifier: CHILD, issueTitle: 'Write the next step' });
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data });
  expect((await feedback({ message: '[blocked] which way should the next step read?' })).status()).toBe(200);
  expect((await feedback({
    kind: 'decision',
    message: JSON.stringify({
      decision_id: 'lin4104-next-step', question: 'Which way should the next step read?',
      options: [{ id: 'rows', label: 'In the rows' }, { id: 'page', label: 'On the page' }],
    }),
  })).status()).toBe(200);
  const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme: 'light' });
  await expect(box.locator('[data-testid="opened-task-go"]')).toHaveCount(0);
  await snap(page, 'answer-first-owner-light-1280');
});

test('running wording: a Run to PR is running, owner, light, 1280px', async ({ page, localWorkerUrlKey }) => {
  await seedFresh(page, localWorkerUrlKey);
  const auth = await runnerAuth(page, localWorkerUrlKey);
  // The autopilot run (a Run to PR) is the anchor; its worker names it through sessionId, so the running line can read it.
  const anchor = await startRun(page, localWorkerUrlKey, auth, { prompt: 'autopilot prompt', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: PARENT, issueTitle: 'Next step container', stopAt: 'pr', entryRung: 'run-task' });
  await startRun(page, localWorkerUrlKey, auth, { prompt: 'build prompt', promptName: 'Build', kind: 'implementation', issueIdentifier: PARENT, issueTitle: 'Next step container', sessionId: anchor });
  const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme: 'light' });
  await expect(box.locator('.opened-task-running-title')).toContainText('Running to PR');
  await snap(page, 'running-to-pr-owner-light-1280');
});

test('running wording: a worker whose run row is missing reads Harbour is deciding, owner, light, 1280px', async ({ page, localWorkerUrlKey }) => {
  await seedFresh(page, localWorkerUrlKey);
  const auth = await runnerAuth(page, localWorkerUrlKey);
  // The worker names a run row that does not exist: the run is not found, so the line says Harbour is deciding.
  await startRun(page, localWorkerUrlKey, auth, { prompt: 'build prompt', promptName: 'Build', kind: 'implementation', issueIdentifier: PARENT, issueTitle: 'Next step container', sessionId: '6f0c2a8e-1b2d-4c3e-9f4a-5b6c7d8e9f01' });
  const box = await openTask(page, localWorkerUrlKey, PARENT, { viewport: WIDTHS[1280], theme: 'light' });
  await expect(box.locator('.opened-task-running-title')).toContainText('Harbour is deciding');
  await snap(page, 'harbour-deciding-owner-light-1280');
});

// A new user with no runner: the copy-first view. The run control is not offered; the one action is Write.
for (const theme of ['light', 'dark']) {
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    test(`copy-first for a new user with no runner, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
      await seedFresh(page, localWorkerUrlKey, { runnerKey: false });
      const box = await openTask(page, localWorkerUrlKey, LEAF, { viewport, theme });
      await expect(box.locator('[data-testid="opened-task-go"]')).toHaveCount(0);
      await snap(page, `copy-first-newuser-${theme}-${label}`);
    });
  }
}
