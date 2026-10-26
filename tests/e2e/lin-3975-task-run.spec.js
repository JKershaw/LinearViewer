import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { expectNoClippedOverflow } from '../helpers.js';

// LIN-3975 (PRs 1 and 2): the task page moves the task on, in a browser.
//
//   - the owner's page has the shared run control under the answer, and it offers the step after the finished one;
//   - a member reads the page with no run control, no share slot, and the next step in its place;
//   - an attempt's link opens the run page that shows that attempt;
//   - at 390×844 the answer and the run control are on the first screen, with no sideways scroll.
//
// Seeding goes through tests/fixtures/local-harness.js and dispatch takes, as task-page.spec.js does.

const TASK = 'LOCAL-RC1';
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

async function seedTask(page, { description = 'Seeded run control task' } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      projects: [{ id: id('rc-proj'), name: 'Run control project', content: 'A project', sortOrder: 1 }],
      issues: [{
        id: id('rc-task'), identifier: TASK, title: 'A task with a plan done', description,
        projectId: id('rc-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${URL_KEY}/issue/${id('rc-task')}`,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue one session for TASK, take it, and post its feedback. Returns the item id. */
async function seedRun(page, token, { kind, feedback = [] }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: TASK, issueTitle: 'A task with a plan done', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  for (const message of feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message } });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

test.describe('LIN-3975 — the task page moves the task on', () => {
  test('the owner gets the run control, offering the step after the finished one', async ({ page }) => {
    await seedTask(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, { kind: 'plan', feedback: ['[done] planned it'] });

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    const control = page.locator('[data-testid="task-page-run-control"]');
    await expect(control).toHaveCount(1);
    await expect(control.locator('[data-testid="opened-task-go"]')).toContainText('Run Build');
    await expect(page.locator('[data-testid="task-page-next"]')).toHaveCount(0);
  });

  test('a member reads the page with no run control and no share slot, and the next step in its place', async ({ page }) => {
    await seedTask(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedWorkspaceOwnership(page, URL_KEY, 'foreign');

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    await expect(page.locator('[data-testid="task-page-answer"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-page-run-control"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="task-page-share-slot"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="task-page-next"]')).toContainText('comes next');
  });

  test('an attempt links to its run page, and the run page opens', async ({ page }) => {
    await seedTask(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, { kind: 'plan', feedback: ['[done] planned it'] });

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    // A stage's attempts are drawn when its row opens (a click on its head), as task-page.spec.js does.
    await page.locator('[data-testid="task-page-stage-head"]').first().click();
    const link = page.locator('[data-testid="task-page-attempt-run"]').first();
    await expect(link).toHaveAttribute('href', /\/observation\/session\/[^/?#]+$/);
    const href = await link.getAttribute('href');
    const response = await page.request.get(href);
    expect(response.status(), `the run link ${href} opens`).toBe(200);
  });

  test('a moment reads as words, and a tap (or Enter) shows its exact local time with the zone named', async ({ page }) => {
    await seedTask(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, { kind: 'plan', feedback: ['[done] planned it'] });

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    await page.locator('[data-testid="task-page-stage-head"]').first().click();
    const moment = page.locator('[data-testid="task-page-session-line"] time[data-local-time="tap"]').first();
    const words = await moment.textContent();
    expect(words, 'the relative words are on the page').toMatch(/ago|just now/);
    await moment.click();
    await expect(moment).toHaveAttribute('aria-expanded', 'true');
    await expect(moment).toHaveText(/\d{1,2}:\d{2}/);
    await expect(moment).not.toHaveText(words);
    await moment.focus();
    await page.keyboard.press('Enter');
    await expect(moment).toHaveText(words);
    await expect(moment).toHaveAttribute('aria-expanded', 'false');
  });

  test('a long description is cut, and "Read all of it" shows the rest', async ({ page }) => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph line ${i}.`).join('\n\n');
    await seedTask(page, { description: long });
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    const body = page.locator('[data-testid="task-page-description-body"]');
    await expect(body).toHaveClass(/task-md--cut/);
    const more = page.locator('[data-testid="task-page-description-more"]');
    await more.click();
    await expect(body).not.toHaveClass(/task-md--cut/);
    await expect(more).toBeHidden();
  });

  test('at 390×844 the answer and the run control sit on the first screen, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedTask(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedRun(page, token, { kind: 'implementation', feedback: ['[done] built it'] });

    await page.goto(`/workspace/${URL_KEY}/task/${TASK}`);
    await expect(page.locator('[data-testid="task-page-run-control"]')).toBeVisible();
    const answerBottom = (await page.locator('[data-testid="task-page-answer"]').boundingBox()).y
      + (await page.locator('[data-testid="task-page-answer"]').boundingBox()).height;
    const controlBox = await page.locator('[data-testid="task-page-run-control"]').boundingBox();
    expect(answerBottom, 'the answer ends on the first screen').toBeLessThanOrEqual(844);
    expect(controlBox.y + controlBox.height, 'the run control ends on the first screen').toBeLessThanOrEqual(844);
    await expectNoClippedOverflow(page);
  });
});
