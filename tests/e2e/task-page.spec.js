import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-3329: the task page, owner view
// (GET /workspace/:urlKey/task/:identifier), at a 360px phone width.
//
// A local-provider workspace backs the tracker read (real LocalStore, so the
// page's one `fetchRecommendationContext` read is genuine), and the sessions
// are real dispatch rows driven through the consumer take + feedback flow, the
// way session-page.spec.js seeds the run page.

const PHONE = { width: 360, height: 780 };

// A review summary comment on the tracker, so the page's evidence read finds a
// ledger (the same seed shape run-evidence.spec.js uses). No PR URL: nothing
// here reaches GitHub.
const REVIEW_BODY = [
  '## Review — seeded',
  '',
  'CI on `abc1234` is green.',
  '',
  '### What CI Did Not Prove',
  '| # | Claim | In/Out | Discharge |',
  '|---|---|---|---|',
  '| L1 | the task page keeps its evidence across a repaint | inside | this spec |',
  '',
  '**Verdict: Approve — conditional on close-out discharging the ledger.**',
].join('\n');
let URL_KEY;

test.use({ viewport: PHONE });

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

async function seedTasks(page, { omit = [], reviewed = false } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issue = (raw, identifier, title, state, extra = {}) => ({
    id: id(raw), identifier, title, description: `Seeded ${title}`, projectId: id('tp-proj'), sortOrder: 1, state,
    url: `/workspace/${URL_KEY}/issue/${id(raw)}`, ...extra,
  });
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      features: { dispatch: true },
      projects: [{ id: id('tp-proj'), name: 'Task page project', content: 'A project', sortOrder: 1 }],
      issues: [
        issue('tp-gone', 'LOCAL-TP5', 'A task the tracker later loses', { name: 'In Progress', type: 'started' }),
        issue('tp-run', 'LOCAL-TP1', 'A task with a running build', { name: 'In Progress', type: 'started' },
          reviewed ? { comments: [{ id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' }] } : {}),
        issue('tp-sub', 'LOCAL-TP4', 'A subtask of the running task', { name: 'Todo', type: 'unstarted' }, { parentId: id('tp-run') }),
        issue('tp-done', 'LOCAL-TP2', 'A finished task', { name: 'Done', type: 'completed' }),
        issue('tp-wait', 'LOCAL-TP3', 'A task waiting on an answer', { name: 'In Progress', type: 'started' }),
      ].filter(i => !omit.includes(i.identifier)),
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session; take it unless `take:false`; post each feedback message. */
async function seedSession(page, token, { identifier, title, kind, feedback = [], take = true }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: title, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  if (!take) return itemId;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  for (const message of feedback) await postFeedback(page, token, itemId, message);
  return itemId;
}

async function postFeedback(page, token, itemId, message) {
  const data = typeof message === 'string' ? { message } : message;
  const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
  expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
}

async function noHorizontalScroll(page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page scrolls sideways: ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

const step = (page, kind) => page.locator(`[data-testid="task-page-step"][data-kind="${kind}"]`);

test.describe('Task page, owner view (LIN-3329)', () => {
  test('running: the header answers, the running row is open, the rest are closed and calm', async ({ page }) => {
    await seedTasks(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'plan', feedback: [{ message: '[evidence] wrote the plan', url: 'https://example.com/plan', urlLabel: 'plan doc' }, '[done] planned it'] });
    await seedSession(page, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'implementation' });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    await expect(page.locator('[data-testid="task-page-title"]')).toHaveText('A task with a running build');
    await expect(page.locator('[data-testid="task-page-status"]')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('Build running since');

    // Oldest-first, the running row open, the finished one closed.
    await expect(page.locator('[data-testid="task-page-step"]')).toHaveCount(2);
    await expect(step(page, 'plan')).not.toHaveClass(/sess-run--expanded/);
    await expect(step(page, 'implementation')).toHaveClass(/sess-run--expanded/);
    await expect(step(page, 'implementation').locator('[data-testid="task-page-step-body"]')).toBeVisible();
    await expect(step(page, 'plan').locator('[data-testid="task-page-step-body"]')).toBeHidden();

    // Phone calm: a closed row shows no chips; opening it shows them.
    const planChips = step(page, 'plan').locator('.sess-chips');
    await expect(planChips).toHaveCount(1);
    await expect(planChips).toBeHidden();
    await step(page, 'plan').locator('[data-testid="session-run-toggle"]').click();
    await expect(step(page, 'plan')).toHaveClass(/sess-run--expanded/);
    await expect(planChips).toBeVisible();
    await expect(step(page, 'plan').locator('[data-testid="task-page-step-message"]')).toHaveText('planned it');
    await expect(step(page, 'plan').locator('[data-testid="task-page-step-link"]')).toHaveText('plan doc');

    // The quiet guesses after the furthest stage reached, and details closed.
    await expect(page.locator('[data-testid="task-page-guess"]')).toHaveText([/Review/, /Close-out/]);
    await expect(page.locator('[data-testid="task-page-details"]')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-testid="task-page-subtasks-link"]')).toHaveText('LOCAL-TP4');

    await noHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('task-page-running-360.png'), fullPage: true });
  });

  test('done: the tracker says done; nothing more is guessed', async ({ page }) => {
    await seedTasks(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { identifier: 'LOCAL-TP2', title: 'A finished task', kind: 'implementation', feedback: ['[done] shipped'] });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP2`);
    await expect(page.locator('[data-testid="task-page-status"]')).toHaveAttribute('data-status', 'done');
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('Finished');
    await expect(page.locator('[data-testid="task-page-guess"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="task-page"]')).toHaveAttribute('data-status', 'done');
    await noHorizontalScroll(page);
  });

  test('waiting: the blocked session is open and the header says why', async ({ page }) => {
    await seedTasks(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'plan', feedback: ['[done] planned'] });
    await seedSession(page, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'implementation', feedback: ['[blocked] which API key should the build use?'] });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP3`);
    await expect(page.locator('[data-testid="task-page-status"]')).toHaveAttribute('data-status', 'waiting');
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('which API key should the build use?');
    await expect(page.locator('[data-testid="task-page-sentence"]')).not.toContainText('[blocked]');
    await expect(step(page, 'implementation')).toHaveClass(/sess-run--expanded/);
    await expect(step(page, 'implementation').locator('[data-testid="task-page-step-summary"]')).toContainText('blocked: which API key');
    await noHorizontalScroll(page);
  });

  test('it updates itself, and a repaint keeps the rows the reader opened and the evidence', async ({ page }) => {
    await seedTasks(page, { reviewed: true });
    const token = await runnerToken(page);
    await seedSession(page, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'plan', feedback: ['[done] planned it'] });
    const buildId = await seedSession(page, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'implementation' });

    // The page's own requests (the shared navbar's rulings badge poll is not
    // the task page's): only the state endpoint, never a brief/recap read or
    // generate.
    const stateRequests = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (/\/api\/(task|brief|recap)\//.test(path)) stateRequests.push(path);
    });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    await step(page, 'plan').locator('[data-testid="session-run-toggle"]').click();
    await expect(step(page, 'plan')).toHaveClass(/sess-run--expanded/);
    // The task's evidence (from the tracker's review comment) sits in the build row.
    const evidence = step(page, 'implementation').locator('[data-testid="task-page-evidence"] [data-testid="run-evidence"]');
    await expect(evidence).toHaveCount(1);

    // The build finishes; the next poll (forced as the tab-return catch-up)
    // repaints the header and the track from stored data.
    await postFeedback(page, token, buildId, '[done] built it');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('No session running. Last: Build done');
    await expect(step(page, 'implementation').locator('[data-testid="task-page-step-summary"]')).toContainText('done');
    await expect(step(page, 'plan')).toHaveClass(/sess-run--expanded/, { timeout: 1000 });
    await expect(step(page, 'implementation')).toHaveClass(/sess-run--expanded/);
    // The state endpoint can't read evidence (it needs the tracker); the client
    // carried the page's evidence into the repainted row.
    await expect(evidence).toHaveCount(1, { timeout: 1000 });
    await expect(evidence.locator('[data-testid="run-evidence-checked-review-verdict"]')).toContainText('Approve');

    // The page only ever polled its stored-data state endpoint.
    expect(stateRequests.length).toBeGreaterThan(0);
    expect([...new Set(stateRequests)]).toEqual([`/workspace/${URL_KEY}/api/task/LOCAL-TP1/state`]);
  });

  test('no stored-only page; unknown and signed-out', async ({ page, browser }) => {
    await seedTasks(page);
    const token = await runnerToken(page);
    // A stored session for a task the tracker then loses: the tracker's answer
    // wins — the not-found page, nothing stored rendered in its place.
    await seedSession(page, token, { identifier: 'LOCAL-TP5', title: 'A task the tracker later loses', kind: 'implementation', feedback: ['[done] built'] });
    await seedTasks(page, { omit: ['LOCAL-TP5'] });
    const lost = await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP5`);
    expect(lost.status()).toBe(404);
    await expect(page.locator('[data-testid="task-page-not-found"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-page-track"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('A task the tracker later loses');

    const missing = await page.goto(`/workspace/${URL_KEY}/task/LOCAL-NOPE`);
    expect(missing.status()).toBe(404);
    await expect(page.locator('[data-testid="task-page-not-found"]')).toBeVisible();

    const fresh = await browser.newContext();
    const anon = await fresh.newPage();
    await anon.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    expect(new URL(anon.url()).pathname).toBe('/');
    await fresh.close();
  });

  test('dark theme: the page text and controls clear AA', async ({ page }) => {
    await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
    await seedTasks(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'plan', feedback: ['[done] planned'] });
    await seedSession(page, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'implementation', feedback: ['[blocked] which API key?'] });
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP3`);
    await expect(page.locator('html')).toHaveClass(/theme-dark/);

    const selectors = [
      '[data-testid="task-page-sentence"]',
      '[data-testid="task-page-status-pill"]',
      '[data-testid="task-page-ident"]',
      '[data-kind="plan"] [data-testid="task-page-step-stage"]',
      '[data-kind="plan"] [data-testid="task-page-step-summary"]',
      '[data-kind="implementation"] [data-testid="task-page-step-summary"]',
      '[data-kind="implementation"] [data-testid="task-page-step-message"]',
      '.task-guesses-label',
      '[data-testid="task-page-guess"]',
      '[data-testid="task-page-ask-brief"]',
      '[data-testid="session-brief-generate"]',
      '[data-testid="task-page-back"]',
      '.task-details .disclosure__label',
    ];
    const results = await page.evaluate((sels) => {
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return null;
        const p = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) layers.push(parse(getComputedStyle(n).backgroundColor));
        let base = { r: 255, g: 255, b: 255 };
        for (let i = layers.length - 1; i >= 0; i--) {
          const c = layers[i];
          if (!c || c.a === 0) continue;
          base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
        }
        return base;
      };
      return sels.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true };
        const fg = parse(getComputedStyle(el).color);
        const bg = bgOf(el);
        return { sel, ratio: ratio(fg, bg), color: getComputedStyle(el).color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` };
      });
    }, selectors);
    for (const r of results) {
      expect(r.missing, `no element for ${r.sel}`).toBeFalsy();
      expect(r.ratio, `${r.sel}: ${r.color} on ${r.bg} = ${r.ratio}`).toBeGreaterThanOrEqual(4.5);
    }
    await noHorizontalScroll(page);
    await page.screenshot({ path: test.info().outputPath('task-page-dark-360.png'), fullPage: true });
  });
});
