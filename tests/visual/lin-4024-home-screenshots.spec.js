/**
 * LIN-4024 evidence maker: Home in light and dark, at 1280px and 390px, for the runner owner and for a new user
 * with no runner (the copy-first view). Like the other makers in this directory it writes PNGs and asserts nothing:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4024-home-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-10-30-lin4024/home-<user>-<theme>-<width>.png
 *
 * Data seam: the local provider (`/test/set-local-session`), since Home's states need real dispatch rows. The owner's
 * ruling is written through the public dispatch API the way a runner writes it, as tests/e2e/lin-4024-home-seeded.spec.js
 * does. Each capture opens one task, so the opened task is in the picture with the header, the count line and the rows.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-10-30-lin4024';
const OLD = '2020-01-01T00:00:00Z';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };

test.describe.configure({ mode: 'serial' });

async function seed(page, urlKey, { runnerKey }) {
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const task = (raw, identifier, title, type, more = {}) => ({
    id: id(raw), identifier, title, createdAt: OLD, url: `https://example.com/${raw}`,
    description: `## Why\n\n${title}, seeded for the LIN-4024 evidence.`,
    state: { name: { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done' }[type], type },
    ...more,
  });
  const issues = [
    task('charter', 'LOCAL-1', 'Charter: the pages a new user meets are clean', 'started', { projectId: id('p-ui'), sortOrder: 0 }),
    task('home', 'LOCAL-2', 'Home works with a real backlog', 'started', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 1 }),
    task('models', 'LOCAL-3', 'Settings › Models shows its numbers in the rows', 'unstarted', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 2 }),
    task('theseus', 'LOCAL-4', 'Theseus the stylesheet', 'backlog', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 3 }),
    task('done', 'LOCAL-5', 'Shared look across the pages', 'completed', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 4 }),
    task('docs-1', 'LOCAL-6', 'Write the runner setup guide', 'unstarted', { projectId: id('p-docs'), sortOrder: 5 }),
    task('docs-2', 'LOCAL-7', 'Explain the rulings view', 'unstarted', { projectId: id('p-docs'), sortOrder: 6 }),
    task('docs-3', 'LOCAL-8', 'Archive the old prompt notes', 'backlog', { projectId: id('p-docs'), sortOrder: 7 }),
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, runnerKey, issues,
      projects: [
        { id: id('p-ui'), name: 'UI finish', content: 'The pages a new user meets', sortOrder: 0 },
        { id: id('p-docs'), name: 'Docs', content: 'Guides and notes', sortOrder: 1 },
      ],
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
}

// A worker on LOCAL-3 waiting on a ruling: enqueue, take, `[blocked]`, then the structured `[decision]`.
async function seedRuling(page, urlKey) {
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'research prompt', promptName: 'research', kind: 'research', issueIdentifier: 'LOCAL-3', issueTitle: 'LOCAL-3', target: 'cli' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data });
  expect((await feedback({ message: '[blocked] the research session was cancelled; re-dispatch it?' })).status()).toBe(200);
  expect((await feedback({
    kind: 'decision',
    message: JSON.stringify({
      decision_id: 'lin4024-evidence', question: 'The research session was cancelled. Re-dispatch it?',
      options: [{ id: 'redispatch', label: 'Re-dispatch the research' }, { id: 'skip', label: 'Skip research and plan' }],
    }),
  })).status()).toBe(200);
}

const USERS = [
  { name: 'owner', runnerKey: true, open: 'LOCAL-3' },
  { name: 'new-user', runnerKey: false, open: 'LOCAL-2' },
];

for (const user of USERS) {
  for (const theme of ['light', 'dark']) {
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      test(`Home, ${user.name}, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
        await seed(page, localWorkerUrlKey, { runnerKey: user.runnerKey });
        if (user.runnerKey) await seedRuling(page, localWorkerUrlKey);
        await page.context().clearCookies({ name: 'theme' });
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/`);
        await page.waitForLoadState('networkidle');
        // The owner's badge fills from a 5s poll; wait for it so the header reads what the count line says.
        if (user.runnerKey) await expect(page.locator('.rulings-badge .rulings-count')).toHaveText('1', { timeout: 15000 });
        // A subtask's row shows once its parent is open, so the charter is opened first when the row is folded under it.
        const row = page.locator(`.in-progress-section .line[data-identifier="${user.open}"]`).first();
        if (!(await row.isVisible())) await page.locator('.in-progress-section .line[data-identifier="LOCAL-1"]').first().click();
        await row.click();
        await expect(page.locator('[data-testid="opened-task"]').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        // A full-page capture draws the sticky header away from the top (the committed pages/*.png show the same band),
        // so for the picture only the header is static. At the top of the page the two look the same.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        await page.screenshot({ path: `${DIR}/home-${user.name}-${theme}-${label}.png`, fullPage: true });
      });
    }
  }
}
