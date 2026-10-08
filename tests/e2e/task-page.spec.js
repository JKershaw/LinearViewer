import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { defaultJiraSeed, JIRA_SITE } from '../fixtures/jira-harness.js';

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
    // the task page's): the stored-data state endpoint it polls, plus the
    // owner-only share list it loads once (LIN-3330) — never a brief/recap read
    // or generate.
    const stateRequests = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (/\/api\/(task|brief|recap)\//.test(path)) stateRequests.push(path);
    });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    await step(page, 'plan').locator('[data-testid="session-run-toggle"]').click();
    await expect(step(page, 'plan')).toHaveClass(/sess-run--expanded/);
    // The task's evidence (from the tracker's review comment) sits in the
    // Pull request section, outside every repainted mount (LIN-3340).
    const evidence = page.locator('[data-testid="task-page-pr-mount"] [data-testid="run-evidence"]');
    await expect(evidence).toHaveCount(1);

    // The build finishes; the next poll (forced as the tab-return catch-up)
    // repaints the header and the track from stored data.
    await postFeedback(page, token, buildId, '[done] built it');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('No session running. Last: Build done');
    await expect(step(page, 'implementation').locator('[data-testid="task-page-step-summary"]')).toContainText('done');
    await expect(step(page, 'plan')).toHaveClass(/sess-run--expanded/, { timeout: 1000 });
    await expect(step(page, 'implementation')).toHaveClass(/sess-run--expanded/);
    // The Pull request section lives outside every repainted mount, so a poll
    // can never touch the evidence (LIN-3340).
    await expect(evidence).toHaveCount(1, { timeout: 1000 });
    await expect(evidence.locator('[data-testid="run-evidence-checked-review-verdict"]')).toContainText('Approve');

    // The page only ever polled its stored-data state endpoint, plus the
    // one-time owner share list load and the owner widgets' one status GET each
    // (LIN-3340 G2). A poll adds nothing; opening the widgets spends no AI.
    expect(stateRequests.length).toBeGreaterThan(0);
    const stateUrl = `/workspace/${URL_KEY}/api/task/LOCAL-TP1/state`;
    const sharesUrl = `/workspace/${URL_KEY}/api/task/LOCAL-TP1/shares`;
    const briefUrl = `/workspace/${URL_KEY}/api/brief/LOCAL-TP1`;
    const recapUrl = `/workspace/${URL_KEY}/api/recap/LOCAL-TP1`;
    expect(stateRequests).toContain(stateUrl);
    for (const path of stateRequests) {
      expect([stateUrl, sharesUrl, briefUrl, recapUrl], `unexpected task-page request: ${path}`).toContain(path);
    }
    expect(stateRequests.filter(p => p === briefUrl).length, 'one brief GET on mount').toBe(1);
    expect(stateRequests.filter(p => p === recapUrl).length, 'one recap GET on mount').toBe(1);
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
      '[data-testid="task-page-description"] .disclosure__label',
      '.brief-placeholder',
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

  // LIN-3331: the task page is reachable from Home, not just by typing its URL.
  test('the Home details task-page link navigates to the task page', async ({ page }) => {
    await seedTasks(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.locator('.in-progress-items .line', { hasText: 'A task with a running build' }).first().click();
    await page.locator('.detail-toggle[data-toggle="details"]').first().click();

    const link = page.locator('[data-testid="issue-task-page-link"]').first();
    await expect(link).toBeVisible();
    // The href is the task page's own path (the binding pair is optional).
    await expect(link).toHaveAttribute('href', new RegExp(`^/workspace/${URL_KEY}/task/LOCAL-TP1(\\?|$)`));

    await link.click();
    await expect(page.locator('[data-testid="task-page-title"]')).toHaveText('A task with a running build');
  });

  // LIN-3331 / LIN-3335 (the plan's two-binding e2e): on a MERGED multi-binding
  // workspace, a foreign-source issue's task-page link must carry the issue's
  // OWN provider kind (`?source=`) and land on the task page — never the route's
  // (now-removed) BINDING_REQUIRED JSON refusal. The pair-era `bindingScope` is
  // gone; the source-only resolver reaches Jira's own connection on the task
  // page (the fixture's Jira client asserts that).
  test('a foreign-source issue on a multi-binding workspace links with its source and lands on its task page', async ({ page, seedLocal }) => {
    const jiraResp = await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    expect(jiraResp.ok()).toBeTruthy();
    const { dashboard } = await seedLocal(null, {
      extraBindings: [{
        provider: 'jira', scope: JIRA_SITE, connectionBacked: true, refreshToken: 'fake_extra_refresh',
        credentials: { token: 'fake_extra_oauth_access', authType: 'oauth', cloudId: '11111111-2222-3333-4444-555555555555', tokenExpiresAt: Date.now() + 3600_000 },
      }],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task to do")') }).first();
    await jiraNode.locator('.line').first().click();
    await jiraNode.locator('.detail-toggle[data-toggle="details"]').first().click();

    const link = jiraNode.locator('[data-testid="issue-task-page-link"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('/task/ENG-1');
    expect(href, 'the Jira issue carries source=jira').toContain('source=jira');
    expect(href, 'the pair-era bindingScope is gone').not.toContain('bindingScope=');

    await link.click();
    // Not the BINDING_REQUIRED JSON body: the real task page, resolved through
    // the issue's own (Jira, connection-backed) binding.
    await expect(page.locator('[data-testid="task-page-title"]')).toHaveText('Jira task to do');
  });

  // LIN-3340: the task page is the person's page — the PR with its evidence, the
  // merge click from the task's own data, and a guest who sees everything but
  // cannot trigger anything.
  test('the PR section: evidence, ready header and merge click for the owner; a guest sees evidence but no box', async ({ page, browser }) => {
    await page.request.get('/test/clear-pr-status');
    const id = (raw) => localSeedId(URL_KEY, raw);
    const PR_URL = 'https://github.com/acme/app/pull/41';
    // A UUID issue id (not the seeded slug): the dispatch route validates
    // `issueId` as a UUID, and this test presses the real dispatch.
    const TASK_UUID = '11111111-2222-3333-4444-555555555555';
    const resp = await page.request.post('/test/set-local-session', {
      data: {
        urlKey: URL_KEY,
        // append:true gives this session's account a FRESH workspace id so its
        // first edge marks it the owner (LIN-1892) — required to mint a share.
        append: true,
        features: { dispatch: true },
        projects: [{ id: id('tp-proj'), name: 'Task page project', content: 'A project', sortOrder: 1 }],
        issues: [{
          id: TASK_UUID, identifier: 'LOCAL-TP1', title: 'A task with a running build',
          description: 'The **task** description.', projectId: id('tp-proj'), sortOrder: 1,
          state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${TASK_UUID}`,
          comments: [
            { id: 'c-pr', body: `Opened the pull request: ${PR_URL}`, createdAt: '2026-10-06T09:00:00Z', user: 'Runner' },
            { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' },
          ],
        }],
      },
    });
    expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();

    // A stop-at-PR run keyed to the task, on its own row, plus an open PR whose
    // review approved: the ready state. GitHub is stubbed via /test/seed-pr-status.
    const token = await runnerToken(page);
    const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'orchestrate', promptName: 'Autopilot (LOCAL-TP1)', kind: 'autopilot', issueIdentifier: 'LOCAL-TP1', issueTitle: 'A task with a running build', target: 'cli', stopAt: 'pr', variant: 'standard' },
    });
    expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
    const anchorId = (await anchor.json()).item.id;
    await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: { Authorization: `Bearer ${token}` } });
    // The run finished: nothing is running, so the header can say "waiting on
    // the person to merge".
    await postFeedback(page, token, anchorId, '[done] orchestrated the run');
    await page.request.post('/test/seed-pr-status', {
      data: { repo: 'acme/app', number: 41, readable: true, state: 'open', merged: false, headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', checks: [{ name: 'unit', conclusion: 'success' }] },
    });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    await expect(page.locator('[data-testid="task-page-pr-mount"] [data-testid="run-evidence"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="ready"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-press"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-evidence-closeout-promise"]')).toContainText('Harbour never merges on its own');
    // The header says waiting on the person, and the page says it is merge-ready.
    await expect(page.locator('[data-testid="task-page-sentence"]')).toContainText('Approved. PR #41 is ready to merge.');
    await expect(page.locator('[data-testid="task-page"]')).toHaveAttribute('data-merge-ready', 'true');
    // The description and comments are visible (and markdown-upgraded).
    await expect(page.locator('[data-testid="task-page-description"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-page-comments"]')).toContainText('Comments (2)');
    await noHorizontalScroll(page);

    // The 8 Oct witness: the merge click works from the task page, which has NO
    // session reply box. It fetches the close-out prompt by the task's tracker
    // UUID (carrying source) and dispatches the close-out — nothing silent.
    const reqs = [];
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (/\/api\/prompt\/.+\/close-out$/.test(p) || p.endsWith('/api/dispatch') || /\/close-out-press$/.test(p)) reqs.push(p);
    });
    await page.locator('[data-testid="run-evidence-closeout-press"]').click();
    await expect.poll(() => reqs.some(p => /close-out-press$/.test(p)), { timeout: 10000 }).toBe(true);
    expect(reqs.some(p => /\/api\/prompt\/.+\/close-out$/.test(p)), 'the press fetched the close-out prompt').toBe(true);
    expect(reqs.some(p => p.endsWith('/api/dispatch')), 'the press dispatched the close-out').toBe(true);

    // A guest sees the evidence and the text, but no box and no widgets.
    const minted = await page.request.post(`/workspace/${URL_KEY}/api/task/LOCAL-TP1/share`, { data: { source: 'local' } });
    expect(minted.status(), `mint failed: ${await minted.text()}`).toBe(201);
    const { path } = await minted.json();
    const guestCtx = await browser.newContext({ viewport: PHONE });
    const guest = await guestCtx.newPage();
    const origin = new URL(page.url()).origin;
    await guest.goto(`${origin}${path}`);
    await expect(guest.locator('[data-testid="task-page-pr-mount"] [data-testid="run-evidence"]')).toBeVisible();
    await expect(guest.locator('[data-testid="run-evidence-closeout"]')).toHaveCount(0);
    await expect(guest.locator('[data-testid="task-page-owner-widgets"]')).toHaveCount(0);
    await expect(guest.locator('[data-testid="task-page-description-body"] p')).toHaveCount(1);
    await guestCtx.close();
    await page.request.get('/test/clear-pr-status');
  });

  // LIN-3340 B1 (review `388f4246`): once a merge has been recorded, `/check`
  // returns `done: true` on EVERY later call. An owner opening the page when the
  // PR is already merged and the tracker is already Done must NOT reload in a
  // loop — the old client reloaded unconditionally, so this end state (the one
  // the feature exists for) loaded forever.
  test('B1: an already-merged, already-Done stop-at PR settles without a reload loop', async ({ page }) => {
    await page.request.get('/test/clear-pr-status');
    const id = (raw) => localSeedId(URL_KEY, raw);
    const PR_URL = 'https://github.com/acme/app/pull/41';
    const TASK_UUID = '22222222-3333-4444-5555-666666666666';
    const resp = await page.request.post('/test/set-local-session', {
      data: {
        urlKey: URL_KEY,
        features: { dispatch: true },
        projects: [{ id: id('tp-proj'), name: 'Task page project', content: 'A project', sortOrder: 1 }],
        issues: [{
          id: TASK_UUID, identifier: 'LOCAL-TP1', title: 'A finished task',
          description: 'The task description.', projectId: id('tp-proj'), sortOrder: 1,
          state: { name: 'Done', type: 'completed' }, url: `/workspace/${URL_KEY}/issue/${TASK_UUID}`,
          comments: [
            { id: 'c-pr', body: `Opened the pull request: ${PR_URL}`, createdAt: '2026-10-06T09:00:00Z', user: 'Runner' },
            { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' },
          ],
        }],
      },
    });
    expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();

    const token = await runnerToken(page);
    const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'orchestrate', promptName: 'Autopilot (LOCAL-TP1)', kind: 'autopilot', issueIdentifier: 'LOCAL-TP1', issueTitle: 'A finished task', target: 'cli', stopAt: 'pr', variant: 'standard' },
    });
    expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
    const anchorId = (await anchor.json()).item.id;
    await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: { Authorization: `Bearer ${token}` } });
    await postFeedback(page, token, anchorId, '[done] orchestrated the run');
    // The PR is merged and the tracker is already Done: the end state.
    await page.request.post('/test/seed-pr-status', {
      data: { repo: 'acme/app', number: 41, readable: true, state: 'closed', merged: true, headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', checks: [{ name: 'unit', conclusion: 'success' }] },
    });

    let loads = 0;
    page.on('load', () => { loads++; });
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-TP1`);
    await expect(page.locator('[data-testid="task-page"]')).toHaveAttribute('data-status', 'done');
    await expect(page.locator('[data-testid="run-evidence-closeout"][data-state="merged"]')).toBeVisible();

    // Give any runaway reload a few seconds to show itself. The fixed client
    // reloads 0 times here (the page already says done); the old one loaded
    // continuously (the probe saw 15 in 8 s).
    await page.waitForTimeout(4000);
    expect(loads, `page reloaded ${loads} times in 4 s`).toBeLessThanOrEqual(2);
    await page.request.get('/test/clear-pr-status');
  });
});
