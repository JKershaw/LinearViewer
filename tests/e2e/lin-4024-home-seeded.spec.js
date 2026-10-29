import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4024 (witness D and E, the small seed): the opened charter, search under ancestors, and the lazy rows route's
// authz and done-task witnesses. The full ~3,700-task shape is measured on its own (tests/perf/lin-4024-home-shape.spec.js),
// since rendering it beside the other specs makes them flake.

const OLD = '2020-01-01T00:00:00Z';

let URL_KEY;

test.setTimeout(180000);

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
});

// The route's authz and done-task witnesses need a few tasks, not the whole shape. A small seed keeps this file's load on
// the shared server down, so the Home witnesses above do not starve the specs that run beside them.
async function seedSmall(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = [
    { id: id('charter'), identifier: 'LOCAL-0', title: 'Charter root, started', projectId: id('proj-0'), sortOrder: 0, createdAt: OLD, description: 'The charter, with work under it.', url: 'https://example.com/charter', state: { name: 'In Progress', type: 'started' } },
    { id: id('done'), identifier: 'LOCAL-D1', title: 'Finished item 1', projectId: id('proj-0'), sortOrder: 1, createdAt: OLD, state: { name: 'Done', type: 'completed' } },
    { id: id('todo'), identifier: 'LOCAL-T1', title: 'Open item 2', projectId: id('proj-0'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('backlog'), identifier: 'LOCAL-B1', title: 'Backlog task 3', projectId: id('proj-0'), parentId: id('charter'), sortOrder: 3, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey: URL_KEY, runnerKey: false, projects: [{ id: id('proj-0'), name: 'Project 0', content: 'Seeded', sortOrder: 0 }], issues },
  });
  expect(resp.ok()).toBeTruthy();
}

test('the charter root opens with its own state, one opened task and no box inside another', async ({ page }) => {
  await seedSmall(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/workspace/${URL_KEY}/`);

  const charter = page.locator('.in-progress-section .line[data-identifier="LOCAL-0"]');
  await expect(charter).toBeVisible();
  await charter.click();
  const opened = page.locator('[data-testid="opened-task"]').first();
  await expect(opened).toBeVisible();

  await expect(page.locator('.opened-task .opened-task')).toHaveCount(0);

  // The copy-first viewer has one primary action in the opened task.
  const primaries = await page.locator('.opened-task .btn--primary').count();
  expect(primaries).toBeLessThanOrEqual(1);

  // Every text run the opened task shows (not the hidden ones) is at least 12px on a 390px phone.
  const smallest = await page.evaluate(() => {
    const root = document.querySelector('.opened-task');
    let min = { size: Infinity };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.getClientRects().length === 0) continue;
      const size = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (size < min.size) min = { size, where: `${n.parentElement.tagName.toLowerCase()}.${n.parentElement.className}`, text: n.textContent.trim().slice(0, 40) };
    }
    return min;
  });
  console.log(`LIN-4024 measure: smallest opened-task text ${smallest.size}px at 390px: ${smallest.where} "${smallest.text}"`);
  expect(smallest.size).toBeGreaterThanOrEqual(12);
});

test('search finds a Backlog task the page does not hold, under its ancestors', async ({ page }) => {
  await seedSmall(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  await page.locator('.search-toggle').click();
  await page.locator('#search-input').fill('Backlog task 3');
  const results = page.locator('[data-testid="home-search-results"]');
  await expect(results.locator('[data-identifier="LOCAL-B1"]')).toHaveCount(1);
  // Its started parent comes with it, as the context the match sits under.
  await expect(results.locator('[data-identifier="LOCAL-0"]')).toHaveCount(1);
});

test.describe('the lazy rows route (witness E)', () => {
  test('refuses a workspace the session is not a member of, the way /api/detail refuses it', async ({ page }) => {
    await seedSmall(page);
    const rows = await page.request.get('/workspace/not-a-member-workspace/api/home-rows?kind=search&q=item');
    const detail = await page.request.get('/workspace/not-a-member-workspace/api/detail/LOCAL-1');
    expect(rows.status()).toBe(detail.status());
    expect(rows.status()).not.toBe(200);
    const body = await rows.text();
    expect(body).not.toContain('Finished item');
  });

  test('refuses a request with no session', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const rows = await anonymous.get(`/workspace/${URL_KEY}/api/home-rows?kind=search&q=item`);
    expect(rows.status()).toBe(401);
    await anonymous.dispose();
  });

  test('never returns a done task, whatever the query', async ({ page }) => {
    await seedSmall(page);
    const queries = [
      `kind=search&q=${encodeURIComponent('Finished item')}`,
      `kind=search&q=${encodeURIComponent('Finished item 4')}`,
      `kind=backlog&project=${encodeURIComponent(localSeedId(URL_KEY, 'proj-0'))}&offset=0`,
      `kind=up-next&project=${encodeURIComponent(localSeedId(URL_KEY, 'proj-0'))}&offset=0`,
    ];
    for (const query of queries) {
      const resp = await page.request.get(`/workspace/${URL_KEY}/api/home-rows?${query}`);
      expect(resp.ok(), query).toBeTruthy();
      const body = await resp.text();
      expect(body, query).not.toContain('Finished item');
      expect(body, query).not.toMatch(/class="title done"/);
    }
  });
});
