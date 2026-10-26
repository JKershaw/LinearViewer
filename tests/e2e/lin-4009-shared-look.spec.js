import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4009: one shared look across the pages a new user meets. Witnesses in a real browser:
// titles are left-aligned on Home, Settings and Live Console; a state has its own colour on Home (needs you,
// failed and running rows read differently; a ready row takes the brand); and no page scrolls sideways at a
// 390px phone, in light or dark.

const PHONE = { width: 390, height: 844 };
const TASKS = {
  needsYou: 'LOCAL-S1',
  failed: 'LOCAL-S2',
  running: 'LOCAL-S3',
  ready: 'LOCAL-S4',
};
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

/** Four In Progress tasks under one project; sessions are seeded through the consumer API below. */
async function seedTasks(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = Object.values(TASKS).map((identifier, i) => ({
    id: id(`shared-${i}`), identifier, title: `Shared look ${identifier}`, description: 'Seeded task',
    projectId: id('shared-proj'), sortOrder: i + 1,
    state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id(`shared-${i}`)}`,
  }));
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      openRouterConnected: false,
      projects: [{ id: id('shared-proj'), name: 'Shared look project', content: 'A project', sortOrder: 1 }],
      issues,
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session on `identifier`, take it, and post its feedback lines. */
async function seedSession(page, token, identifier, { kind, feedback = [] }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: `Shared look ${identifier}`, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  for (const message of feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message },
    });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
}

async function seedStates(page) {
  const token = await runnerToken(page);
  await seedSession(page, token, TASKS.needsYou, { kind: 'implementation', feedback: ['[blocked] which API key?'] });
  await seedSession(page, token, TASKS.failed, { kind: 'implementation', feedback: ['[failed] the build broke'] });
  await seedSession(page, token, TASKS.running, { kind: 'implementation' });
}

// Scoped to the In Progress section: the same task also appears under Recent activity and in the opened panel.
const rowState = (page, identifier) =>
  page.locator(`.in-progress-section [data-testid="issue-line"][data-identifier="${identifier}"] [data-testid="issue-row-state"]`).first();

test.describe('one shared look (LIN-4009)', () => {
  test('a page title is left-aligned on Home, Settings and Live Console', async ({ page }) => {
    await seedTasks(page);
    const titles = {
      home: `/workspace/${URL_KEY}/`,
      settings: `/workspace/${URL_KEY}/settings`,
      liveConsole: `/workspace/${URL_KEY}/live-console`,
    };
    for (const [name, path] of Object.entries(titles)) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // The selector must match something first, so an absent title cannot pass by being empty.
      const locator = name === 'settings' ? page.locator('.settings-area-title') : page.locator('header h1').first();
      await expect(locator, `${name} has a title`).toHaveCount(1);
      const align = await locator.evaluate((el) => getComputedStyle(el).textAlign);
      expect(['left', 'start'], `${name} title text-align`).toContain(align);
    }
  });

  test('needs you, failed, running and ready rows read differently on Home', async ({ page }) => {
    await seedTasks(page);
    await seedStates(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const style = async (identifier) => rowState(page, identifier).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { tone: el.dataset.tone, color: cs.color, weight: cs.fontWeight, background: cs.backgroundColor };
    });
    const needsYou = await style(TASKS.needsYou);
    const failed = await style(TASKS.failed);
    const running = await style(TASKS.running);
    const ready = await style(TASKS.ready);

    expect(needsYou.tone).toBe('needs-you');
    expect(failed.tone).toBe('failed');
    expect(running.tone).toBe('running');
    expect(ready.tone).toBe('ready');

    // Running is the warm hue; the red states are not it.
    expect(running.color).not.toBe(needsYou.color);
    expect(running.color).not.toBe(failed.color);
    // Needs you and failed share the red, and read apart by weight and a soft tint (the decision in the PR).
    expect(needsYou.color).toBe(failed.color);
    expect(Number(needsYou.weight)).toBeGreaterThan(Number(failed.weight));
    expect(needsYou.background).not.toBe(failed.background);
    // A ready row is the brand, not quiet grey.
    expect(ready.color).not.toBe(running.color);
  });

  test('the count line is the page summary, with its needs-you part toned', async ({ page }) => {
    await seedTasks(page);
    await seedStates(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const count = page.locator('[data-testid="in-progress-count"]');
    // A failed task counts as needing you (rowStateOf), so two rows need you here: the blocked one and the failed one.
    await expect(count).toContainText('2 needs you');
    await expect(count.locator('[data-tone="needs-you"]')).toHaveCount(1);
    // It sits under the workspace title, in the page header, not under the In Progress heading.
    const inHeader = await count.evaluate((el) => !!el.closest('header'));
    expect(inHeader).toBe(true);
  });

  for (const { name, path } of [
    { name: 'Home', path: '/' },
    { name: 'Settings', path: '/settings' },
    { name: 'Live Console', path: '/live-console' },
    { name: 'Observation', path: '/observation' },
    { name: 'a task page', path: `/task/${TASKS.needsYou}` },
  ]) {
    for (const theme of ['light', 'dark']) {
      test(`${name} at 390px in ${theme}: no sideways scroll`, async ({ page }) => {
        await seedTasks(page);
        await seedStates(page);
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
        await page.setViewportSize(PHONE);
        await page.goto(`/workspace/${URL_KEY}${path === '/' ? '/' : path}`);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, `${name} is wider than the 390px viewport`).toBeLessThanOrEqual(overflow.client);
      });
    }
  }
});
