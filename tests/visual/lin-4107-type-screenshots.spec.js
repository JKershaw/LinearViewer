/**
 * LIN-4107 evidence maker (beat 3): Home and the task page, at 1280px and 390px, light and dark, for the runner owner and
 * for a new user with no runner. 2 pages x 2 widths x 2 themes x 2 personas = 16 captures. Each capture also records the
 * computed font-size and font-family of a fixed list of elements, so the type claim is measured, not read off a picture.
 * Like the other makers in this directory it writes PNGs and JSON and asserts nothing about pixels:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4107-type-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-03-lin4107/
 *   {home|task}-{owner|new-user}-{light|dark}-{1280|390}.png   the capture
 *   metrics-{home|task}-{owner|new-user}-{1280|390}.json        computed styles, per element, at that width (light)
 *
 * Data seam: the local provider (`/test/set-local-session`). The owner's ruling is written through the public dispatch
 * API the way a runner writes it (as tests/visual/lin-4024-home-screenshots.spec.js does).
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const DIR = 'docs/reviews/_evidence-2026-11-03-lin4107';
const OLD = '2020-01-01T00:00:00Z';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const BASE = 'http://localhost:3001';

test.describe.configure({ mode: 'serial' });

async function seed(page, urlKey, { runnerKey }) {
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const task = (raw, identifier, title, type, more = {}) => ({
    id: id(raw), identifier, title, createdAt: OLD, url: `https://example.com/${raw}`,
    description: `## Why\n\n${title}, seeded for the LIN-4107 evidence.`,
    state: { name: { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done' }[type], type },
    ...more,
  });
  const issues = [
    task('charter', 'LOCAL-1', 'Charter: Home and the task page read in plain words', 'started', { projectId: id('p-ui'), sortOrder: 0 }),
    task('child', 'LOCAL-2', 'Write the next step for the type change', 'unstarted', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 1 }),
    task('leaf', 'LOCAL-3', 'Settle the type sizes on Home and the task page', 'started', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 2 }),
    task('docs-1', 'LOCAL-4', 'Write the runner setup guide', 'unstarted', { projectId: id('p-docs'), sortOrder: 3 }),
    task('docs-2', 'LOCAL-5', 'Explain the rulings view', 'unstarted', { projectId: id('p-docs'), sortOrder: 4 }),
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
      decision_id: 'lin4107-evidence', question: 'The research session was cancelled. Re-dispatch it?',
      options: [{ id: 'redispatch', label: 'Re-dispatch the research' }, { id: 'skip', label: 'Skip research and plan' }],
    }),
  })).status()).toBe(200);
}

// Elements whose type the change touches. Each is read where it exists; "absent" means the page has no such element.
const METRIC_SELECTORS = {
  home: [
    ['body', 'body'],
    ['row title', '[data-testid="issue-line"] .issue-title, [data-testid="issue-line"]'],
    ['opened task box', '.opened-task'],
    ['opened task state line', '[data-testid="opened-task-sentence"], [data-testid="opened-task-state"]'],
    ['opened task fold count (N sessions)', '.opened-task-fold-count'],
    ['run control filled button', '[data-testid="opened-task-go"]'],
    ['generated line (mono ok?)', '.opened-task-generated'],
    ['Count line part', '.in-progress-count__part'],
  ],
  task: [
    ['body', 'body'],
    ['state sentence', '[data-testid="task-page-sentence"]'],
    ['question', '[data-testid="task-page-question"]'],
    ['answer box', '[data-testid="task-page-answer"]'],
    ['task ident (mono ok)', '.task-ident'],
    ['session name', '.sess-task'],
    ['run control', '[data-testid="task-page-run-control"]'],
    ['stage time (figure)', '.task-stage-time'],
  ],
};

async function measure(page, selectors) {
  return page.evaluate((list) => {
    const out = {};
    for (const [label, selector] of list) {
      const el = document.querySelector(selector);
      if (!el) { out[label] = { absent: true, selector }; continue; }
      const cs = getComputedStyle(el);
      out[label] = { selector, fontSize: cs.fontSize, fontFamily: cs.fontFamily.split(',')[0].trim(), text: (el.textContent || '').trim().slice(0, 60) };
    }
    return out;
  }, selectors);
}

// The owner's ruling moves LOCAL-3 into "Waiting on you", so Home opens the charter, whose box shows its child's question.
// The task page is still LOCAL-3 (the ruled task). The new user (no runner) opens LOCAL-3 under the charter.
const USERS = [
  { name: 'owner', runnerKey: true, open: 'LOCAL-1', task: 'LOCAL-3' },
  { name: 'new-user', runnerKey: false, open: 'LOCAL-3', task: 'LOCAL-2' },
];

for (const user of USERS) {
  for (const theme of ['light', 'dark']) {
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      test(`Home, ${user.name}, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
        mkdirSync(DIR, { recursive: true });
        await seed(page, localWorkerUrlKey, { runnerKey: user.runnerKey });
        if (user.runnerKey) await seedRuling(page, localWorkerUrlKey);
        await page.context().clearCookies({ name: 'theme' });
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: BASE }]);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/`);
        await page.waitForLoadState('networkidle');
        if (user.runnerKey) await expect(page.locator('.rulings-badge .rulings-count')).toHaveText('1', { timeout: 15000 });
        // A subtask shows once its parent is open: open the charter when the row is not visible yet, then click the row.
        const rowOf = (identifier) => page.locator(`[data-testid="issue-line"][data-identifier="${identifier}"]:visible`).first();
        if ((await page.locator(`[data-testid="issue-line"][data-identifier="${user.open}"]:visible`).count()) === 0) {
          await rowOf('LOCAL-1').click();
        }
        await rowOf(user.open).click();
        await expect(page.locator('[data-testid="opened-task"]').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        await page.screenshot({ path: `${DIR}/home-${user.name}-${theme}-${label}.png`, fullPage: true });
        if (theme === 'light') {
          const metrics = await measure(page, METRIC_SELECTORS.home);
          writeFileSync(`${DIR}/metrics-home-${user.name}-${label}.json`, JSON.stringify(metrics, null, 2));
        }
      });

      test(`Task page, ${user.name}, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
        mkdirSync(DIR, { recursive: true });
        await seed(page, localWorkerUrlKey, { runnerKey: user.runnerKey });
        if (user.runnerKey) await seedRuling(page, localWorkerUrlKey);
        await page.context().clearCookies({ name: 'theme' });
        if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: BASE }]);
        await page.setViewportSize(viewport);
        await page.goto(`/workspace/${localWorkerUrlKey}/task/${user.task}`);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
        await page.screenshot({ path: `${DIR}/task-${user.name}-${theme}-${label}.png`, fullPage: true });
        if (theme === 'light') {
          const metrics = await measure(page, METRIC_SELECTORS.task);
          writeFileSync(`${DIR}/metrics-task-${user.name}-${label}.json`, JSON.stringify(metrics, null, 2));
        }
      });
    }
  }
}
