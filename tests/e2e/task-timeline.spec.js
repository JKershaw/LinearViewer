import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { expectNoClippedOverflow } from '../helpers.js';
import { sealAsAsked } from '../../lib/as-asked.js';

// LIN-4405: "Sessions on one clock" on the task page, at a 390px phone and on desktop.
//
// A local-provider workspace backs the tracker read, and the sessions are real dispatch rows driven through the
// consumer take + feedback flow (as task-page.spec.js seeds them), with per-request usage posted through the runner's
// own endpoint (POST /api/dispatch/usage/:itemId), so the lanes come from the real whole-life cost read.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

async function seedTask(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      projects: [{ id: id('tl-proj'), name: 'Timeline project', content: 'A project', sortOrder: 1 }],
      issues: [{
        id: id('tl-1'), identifier: 'LOCAL-TL1', title: 'A task with two sessions', description: sealAsAsked('Seeded timeline task'),
        projectId: id('tl-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('tl-1')}`,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue and take a session, post its usage records (seconds after now), then its feedback. */
async function seedSession(page, token, { kind, usageAt = [], feedback = [] }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: 'LOCAL-TL1', issueTitle: 'A task with two sessions', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  if (usageAt.length) {
    const records = usageAt.map((seconds, i) => ({
      requestId: `${kind}-${i}`, at: new Date(Date.now() + seconds * 1000).toISOString(), harness: 'claude-code', model: 'claude-haiku-4-5',
      inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    }));
    const usage = await page.request.post(`/api/dispatch/usage/${itemId}`, { headers: auth, data: { records } });
    expect(usage.status(), `usage failed: ${await usage.text()}`).toBe(200);
  }
  for (const message of feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message } });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

async function seedTwoSessions(page) {
  await seedTask(page);
  const token = await runnerToken(page);
  await seedSession(page, token, { kind: 'plan', usageAt: [1, 20], feedback: ['[done] planned it'] });
  await seedSession(page, token, { kind: 'implementation', usageAt: [2, 30] });
}

const section = page => page.locator('[data-testid="task-timeline"]');
const lanes = page => page.locator('[data-testid="task-timeline-lane"]');

test.describe('Sessions on one clock (LIN-4405)', () => {
  test('at 390px: every session on one clock, labels above full-width tracks, no horizontal scroll, a lane opens to its dispatches', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedTwoSessions(page);
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TL1`);

    await expect(section(page).locator('h2')).toHaveText('Sessions on one clock');
    await expect(lanes(page)).toHaveCount(2);
    await expect(lanes(page).nth(0)).toHaveAttribute('data-kind', 'plan');
    await expect(lanes(page).nth(1)).toHaveAttribute('data-kind', 'implementation');
    await expect(lanes(page).nth(1)).toHaveAttribute('data-state', 'running');
    await expect(lanes(page).nth(0)).toHaveAttribute('data-times', 'known');
    await expect(lanes(page).nth(0).locator('[data-testid="task-timeline-segment"]')).toHaveCount(1);
    await expect(lanes(page).nth(0).locator('[data-testid="task-timeline-meta"]')).toContainText('worked');

    // Labels sit above the tracks, and every track spans the lane's width: the same clock for each lane.
    for (const i of [0, 1]) {
      const lane = lanes(page).nth(i);
      const label = await lane.locator('.tl-label').boundingBox();
      const track = await lane.locator('.tl-track').boundingBox();
      const summary = await lane.locator('[data-testid="task-timeline-summary"]').boundingBox();
      expect(label.y + label.height, `lane ${i}: label above track`).toBeLessThanOrEqual(track.y + 1);
      expect(track.width, `lane ${i}: track spans the lane`).toBeGreaterThan(summary.width - 4);
    }
    const tracks = await page.locator('[data-testid="task-timeline-lane"] .tl-track').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
    expect(new Set(tracks.map(t => t.join(':'))).size, 'one clock: every track has the same left and width').toBe(1);

    // A lane's summary is a real control with a full name; opening it shows its dispatches.
    const planSummary = lanes(page).nth(0).locator('[data-testid="task-timeline-summary"]');
    await expect(planSummary).toContainText('Plan · fresh');
    await expect(lanes(page).nth(0).locator('[data-testid="task-timeline-dispatch"]')).toBeHidden();
    await planSummary.click();
    await expect(lanes(page).nth(0).locator('[data-testid="task-timeline-dispatch"]')).toBeVisible();
    await expect(lanes(page).nth(0).locator('[data-testid="task-timeline-dispatch"]')).toContainText('2 requests');

    await expectNoClippedOverflow(page);
    await page.screenshot({ path: test.info().outputPath('task-timeline-390.png'), fullPage: true });
  });

  test('on desktop: the label column sits beside the track', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedTwoSessions(page);
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TL1`);
    await expect(lanes(page)).toHaveCount(2);
    const lane = lanes(page).nth(0);
    const label = await lane.locator('.tl-label').boundingBox();
    const track = await lane.locator('.tl-track').boundingBox();
    expect(label.x + label.width).toBeLessThanOrEqual(track.x + 1);
    expect(Math.abs((label.y + label.height / 2) - (track.y + track.height / 2))).toBeLessThan(label.height);
    // The section sits beneath the Stages (its own row in the desktop grid).
    const stages = await page.locator('.task-stages').boundingBox();
    const timeline = await section(page).boundingBox();
    expect(timeline.y).toBeGreaterThanOrEqual(stages.y + stages.height - 1);
    await page.screenshot({ path: test.info().outputPath('task-timeline-desktop.png'), fullPage: true });
  });

  test('the fragment endpoint returns the same section body for the owner', async ({ page }) => {
    await seedTwoSessions(page);
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TL1`);
    const url = await section(page).getAttribute('data-timeline-url');
    expect(url).toMatch(new RegExp(`^/workspace/${URL_KEY}/api/task/LOCAL-TL1/timeline`));
    const res = await page.request.get(url);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.timelineHtml).toContain('data-testid="task-timeline-lane"');
  });
});
