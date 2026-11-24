/**
 * LIN-4554 (LIN-4546 piece 6) evidence maker: the task page in a workspace shaped like the real one, at 1280px and 390px, light
 * and dark, as the owner and as a member who can act, with the record tools folded and opened, and as a signed-out reader.
 *
 * The workspace: one open question of real length (several hundred words with lists, four long options: POST
 * /test/seed-question-record with `long: true`) asked by a run parked on `[blocked]`; a Records trail of every kind and end, with
 * stage, Harbour, person, member and unknown writers (POST /test/seed-task-page-records, routes/test.js), including a person's
 * dismissal in the LIN-4550 form and in the stored form from before it, and an agent's own withdrawal; two running runs.
 *
 * Run (not part of `npm test`), on a server of your own (the base URL is the config's):
 *   LIN4554_SHOTS=after npx playwright test --config=playwright.visual.config.js tests/visual/lin-4554-task-page-screenshots.spec.js
 * Output: docs/reviews/_evidence-2026-11-24-lin4546/lin4554-<LIN4554_SHOTS>/task-<role>-<fold>-<theme>-<width>.png, and beside them
 * scroll-390.json (each 390px load's scroll width) and order-390.json (the page's sections top to bottom at 390px).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, runnerTokenFor, seedLongQuestion } from '../fixtures/question-records.js';
import { RUNNING_PROGRESS } from '../../lib/sample-data/question-workload.js';

const SET = process.env.LIN4554_SHOTS || 'after';
const DIR = `docs/reviews/_evidence-2026-11-24-lin4546/lin4554-${SET}`;
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const TICKET = 'LOCAL-16';
const TITLE = 'The task page: the question once, records that read as a person would';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

async function seed(page, urlKey) {
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, append: true, runnerKey: true,
      projects: [{ id: id('proj'), name: 'Questions and notes', content: '', sortOrder: 1 }],
      issues: [
        { id: id('task'), identifier: TICKET, title: TITLE, description: 'Seeded for the task page walk', projectId: id('proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('task')}` },
      ],
    },
  });
  expect(resp.ok(), `local seed failed: ${await resp.text()}`).toBeTruthy();
  const records = await page.request.post('/test/seed-task-page-records', { data: { urlKey, ticket: TICKET } });
  // The "before" set runs on main with only the seeds added; the route is part of them.
  expect(records.status(), `records seed failed: ${await records.text()}`).toBe(200);
  const runId = await askingRun(page, urlKey, TICKET, { title: TITLE });
  await seedLongQuestion(page, urlKey, { ticket: TICKET, title: TITLE, runId, variant: 0 });
  // Running stages of other kinds (one dispatch per issue and kind at a time), as a runner leaves them mid-work.
  const token = await runnerTokenFor(page, urlKey);
  for (const [n, kind] of ['review', 'plan'].entries()) {
    const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, { data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: TICKET, issueTitle: TITLE, target: 'cli' } });
    expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
    const itemId = (await res.json()).item.id;
    expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
    await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: { message: RUNNING_PROGRESS[n % RUNNING_PROGRESS.length] } });
  }
}

async function setTheme(page, theme, baseURL) {
  await page.context().addCookies([{ name: 'theme', value: theme, url: baseURL }]);
}

const scroll390 = [];
const order390 = [];
async function shootAll(page, baseURL, name, url, { openFolds = false } = {}) {
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme, baseURL);
    for (const width of [1280, 390]) {
      await page.setViewportSize(WIDTHS[width]);
      await page.goto(url);
      await page.waitForLoadState('networkidle').catch(() => {});
      const shot = `${name}-${openFolds ? 'open' : 'closed'}-${theme}-${width}`;
      if (openFolds) {
        for (const summary of await page.locator('[data-testid="task-records-tools"] > summary, [data-testid="task-record-tools"] > summary').all()) {
          await summary.click().catch(() => {});
        }
      }
      if (width === 390) {
        scroll390.push({ shot, scrollWidth: await page.evaluate(() => document.body.scrollWidth), clientWidth: await page.evaluate(() => document.body.clientWidth) });
        if (theme === 'light') {
          order390.push({ shot, order: await page.evaluate(() => [...document.querySelectorAll('main > *')]
            .filter((el) => el.getBoundingClientRect().height > 0)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .map((el) => el.getAttribute('data-testid') || el.className)) });
        }
      }
      await page.screenshot({ path: `${DIR}/${shot}.png`, fullPage: true });
    }
  }
}

test.beforeAll(() => { mkdirSync(DIR, { recursive: true }); });
test.afterAll(() => {
  writeFileSync(`${DIR}/scroll-390.json`, `${JSON.stringify(scroll390, null, 2)}\n`);
  writeFileSync(`${DIR}/order-390.json`, `${JSON.stringify(order390, null, 2)}\n`);
});

test('owner, member and reader: the task page with its question and records', async ({ page, browser, baseURL, localWorkerUrlKey: urlKey }) => {
  await seed(page, urlKey);
  const url = `/workspace/${urlKey}/task/${TICKET}`;
  await shootAll(page, baseURL, 'task-owner', url);
  await shootAll(page, baseURL, 'task-owner', url, { openFolds: true });

  // A signed-out reader of a share link (minted while still the owner).
  const minted = await page.request.post(`/workspace/${urlKey}/api/task/${TICKET}/share`, { data: { source: 'local' } });
  expect(minted.status(), `mint failed: ${await minted.text()}`).toBe(201);
  const { path } = await minted.json();
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await shootAll(guest, baseURL, 'task-reader', `${baseURL}${path}`);
  await guestCtx.close();

  // The workspace's owner is someone else now: the session is a member who can act.
  const own = await page.request.get(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
  expect(own.ok(), `ownership seam failed: ${await own.text()}`).toBeTruthy();
  await shootAll(page, baseURL, 'task-member', url);
  await shootAll(page, baseURL, 'task-member', url, { openFolds: true });
});
