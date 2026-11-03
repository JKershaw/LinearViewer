import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4107 (type, D7): the task page ends at about four to five computed font sizes, measured in the running app, not read
// off the stylesheet. Every element that carries its own text reports one of the three token sizes (lg 20px, base 16px,
// sm 13.6px), so a browser default heading size or an em value nested inside an em-sized parent fails here. Measured at
// 1280px and 390px, and the two lists must be the same: body text does not shrink on a phone.
//
// Seeding goes through tests/fixtures/local-harness.js. The worker session (the "Change" button, the stage run link, the
// session value rows) comes from a dispatch the way a runner writes it, as tests/visual/lin-4024-home-screenshots.spec.js does.

const ALLOWED = ['13.6px', '16px', '20px'];
const OLD = '2020-01-01T00:00:00Z';
const TASK = 'LOCAL-S7';

async function seedTaskWithSession(page, urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey,
      runnerKey: true,
      projects: [{ id: id('s7-proj'), name: 'Type project', content: 'The type scale', sortOrder: 1 }],
      issues: [{
        id: id('s7-task'), identifier: TASK, title: 'Settle the type sizes on the task page', createdAt: OLD,
        url: `https://example.com/${TASK}`, projectId: id('s7-proj'), sortOrder: 1,
        description: '## Why\n\nThe task page reads the same at 1280px and at 390px.\n\n### Notes\n\nOne more line of body text.',
        state: { name: 'In Progress', type: 'started' },
      }],
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'research prompt', promptName: 'research', kind: 'research', issueIdentifier: TASK, issueTitle: TASK, target: 'cli' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
  expect((await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: '[blocked] the research session was cancelled; re-dispatch it?' } })).status()).toBe(200);
}

// This spec seeds its own workspace (the worker key with a suffix), so the state it leaves cannot reach a spec that reads
// the worker's workspace: a dispatch in a shared workspace makes the look-alike spec's page draw a run preview on mount.
const typeKey = (base) => `${base}-type`;
test.afterEach(async ({ page, localWorkerUrlKey }) => {
  const key = typeKey(localWorkerUrlKey);
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-dispatch-tokens', 'clear-task-mode-events', 'clear-observation-sessions', 'clear-sessions-feed-cache', 'clear-agent-status', 'clear-task-decisions']) {
    await page.request.get(`/test/${reset}?urlKey=${key}`);
  }
});

async function distinctSizes(page) {
  return page.evaluate(() => {
    const sizes = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own) sizes.add(getComputedStyle(el).fontSize);
    }
    return [...sizes].sort();
  });
}

for (const [label, viewport] of [['1280px', { width: 1280, height: 900 }], ['390px', { width: 390, height: 844 }]]) {
  test(`task page computes only the token sizes at ${label}`, async ({ page, localWorkerUrlKey }) => {
    const key = typeKey(localWorkerUrlKey);
    await seedTaskWithSession(page, key);
    await page.setViewportSize(viewport);
    await page.goto(`/workspace/${key}/task/${TASK}`);
    await page.waitForLoadState('networkidle');
    const sizes = await distinctSizes(page);
    const stray = sizes.filter((s) => !ALLOWED.includes(s));
    expect(stray, `sizes outside the token set on the task page: ${stray.join(', ')} (all: ${sizes.join(', ')})`).toEqual([]);
    expect(sizes.length).toBeLessThanOrEqual(4);
  });
}

test('the task page reads the same sizes at 1280px and 390px', async ({ page, localWorkerUrlKey }) => {
  const key = typeKey(localWorkerUrlKey);
  await seedTaskWithSession(page, key);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${key}/task/${TASK}`);
  await page.waitForLoadState('networkidle');
  const desktop = await distinctSizes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const phone = await distinctSizes(page);
  expect(phone).toEqual(desktop);
});
