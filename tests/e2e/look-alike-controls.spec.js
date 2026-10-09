import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

// LIN-3385: ticket text must never act as one of Harbour's controls.
//
// Ticket descriptions, comments and model-authored chat are formatted onto the
// task page, the run page and the Flight Companion, and the formatting keeps
// `data-*`, `id` and `class`. Each test below puts a look-alike control (same
// labels, a fake close-out box, a fake footer toggle, a fake +proxy toggle,
// styled to cover the whole viewport and placed BEFORE the real control in
// document order) into ticket-derived text, clicks it, and asserts that no
// Harbour request fires. Then the real controls are clicked and still act.
//
// A native <form> in rendered text is closed too (FORBID_TAGS: ['form'] in
// common.js's sanitize call; FC ruling, 9 Oct): the hostile markup carries one
// and each test asserts it never reaches the DOM.

const REPO = 'acme/widget';
const PR = `https://github.com/${REPO}/pull/12`;
const PR_HEAD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
// The dispatch route validates the tracker id's shape.
const TASK_UUID = '11111111-2222-3333-4444-555555555555';
const FAKE_PR_STATE = '/fake-pr-state-url';

// One line, no blank lines: marked keeps it as a single raw HTML block, which
// DOMPurify (no config) passes through with class / id / data-* / style intact.
const HOSTILE = [
  '<div data-testid="hostile-cover" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(255,0,0,0.2)">',
  '<button type="button" data-action="closeout-press" data-testid="run-evidence-closeout-press" class="rev-closeout-press prompt-proxy-toggle footer-feedback-toggle footer-theme-toggle" data-url-key="__URLKEY__" data-enabled="false" id="flight-companion-copy" style="position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%">press</button>',
  '<div data-testid="run-evidence-closeout" data-state="ready" data-stop-at="pr" data-url-key="__URLKEY__" data-issue-id="fake-issue" data-issue-identifier="FAKE-1" data-source="local">fake box</div>',
  '<div data-testid="session-question-card"><textarea data-testid="session-question-card-input"></textarea><button data-testid="session-question-card-answer">answer</button></div>',
  '<div data-testid="session-proposals" data-url-key="__URLKEY__"><button data-proposal-action="apply" data-proposal-id="x">apply</button></div>',
  '<pre id="flight-companion-prompt">hostile prompt</pre><span id="flight-companion-copy-feedback"></span>',
  '<div id="feedback-widget-root" data-enabled="true" data-url-key="__URLKEY__"></div>',
  '<footer class="page-footer"><a href="#" class="footer-feedback-toggle" data-url-key="__URLKEY__" data-enabled="false">feedback</a></footer>',
  '<div class="sess-ctx-panel brief-section" data-url-key="__URLKEY__" data-identifier="FAKE-1"></div><div class="sess-ctx-panel recap-section" data-url-key="__URLKEY__" data-identifier="FAKE-1"></div>',
  `<div data-testid="session-pr-state" data-pr-state-url="${FAKE_PR_STATE}" data-run-live="true"><span data-testid="session-pr-line"></span></div>`,
  '<form action="/workspace/__URLKEY__/settings/features" method="post" data-testid="hostile-form"><input name="feature" value="feedbackWidget"><button type="submit">submit</button></form>',
  '</div>',
].join('');
const hostileFor = (urlKey) => HOSTILE.replaceAll('__URLKEY__', urlKey);

// Requests that would mean a look-alike drove a Harbour control.
const FORBIDDEN = [
  /\/api\/dispatch(\/|$|\?)/,
  /\/close-out-press$/,
  /\/run-evidence\/[^/]+\/check$/,
  /\/api\/prompt\/[^/]+\/close-out/,
  /\/proposals\//,
  /\/api\/run\/[^/]+\/reply/,
  /\/settings\//,
  /\/brief(\?|$)/,
  /\/recap(\?|$)/,
  /\/api\/proxy\/tokens/,
  /fake-pr-state-url/,
];

/** Record every request path after this call; returns the offenders so far. */
function watchForbidden(page) {
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    const p = u.pathname + u.search;
    if (FORBIDDEN.some((re) => re.test(p))) seen.push(`${r.method()} ${p}`);
  });
  return seen;
}

/** Click the viewport centre, the corners and a few other points. */
async function clickAround(page) {
  const { width, height } = page.viewportSize();
  for (const [x, y] of [[width / 2, height / 2], [10, 10], [width - 10, height - 10], [width / 2, 40], [width / 2, height - 40]]) {
    await page.mouse.click(x, y);
  }
}

/** Take the cover away so the real control underneath can be clicked. */
async function removeCover(page) {
  await page.evaluate(() => document.querySelectorAll('[data-testid="hostile-cover"]').forEach((e) => e.remove()));
}

test.describe('Look-alike controls in ticket text answer nothing (LIN-3385)', () => {
  let URL_KEY;

  test.beforeEach(async ({ page, localWorkerUrlKey }) => {
    URL_KEY = localWorkerUrlKey;
    await page.request.get('/test/clear-pr-status');
    await page.request.get('/test/clear-comment-dedupe');
    await page.goto('/test/clear-local-store');
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  });

  test.afterEach(async ({ page }) => {
    await page.request.get('/test/clear-pr-status');
  });

  async function seedTask(page, { description, comments = [] }) {
    const id = (raw) => localSeedId(URL_KEY, raw);
    const resp = await page.request.post('/test/set-local-session', {
      data: {
        urlKey: URL_KEY,
        features: { dispatch: true },
        projects: [{ id: id('la-proj'), name: 'Look-alike project', content: 'p', sortOrder: 1 }],
        issues: [{
          id: TASK_UUID, identifier: 'LOCAL-LA1', title: 'A task with hostile text',
          description, projectId: id('la-proj'), sortOrder: 1,
          state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${TASK_UUID}`,
          comments: [
            { id: 'c-pr', body: `Opened the pull request: ${PR}`, createdAt: '2026-10-06T09:00:00Z', user: 'Runner' },
            { id: 'c-review', body: '## Review\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**', createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' },
            ...comments,
          ],
        }],
      },
    });
    expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
  }

  async function seedFinishedRun(page, { feedbackMessage }) {
    const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'orchestrate', promptName: 'Autopilot (LOCAL-LA1)', kind: 'autopilot', issueIdentifier: 'LOCAL-LA1', issueId: TASK_UUID, issueTitle: 'A task with hostile text', target: 'cli', stopAt: 'pr', variant: 'standard' },
    });
    expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
    const anchorId = (await anchor.json()).item.id;
    const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-LA1', issueId: TASK_UUID, issueTitle: 'Runner', target: 'cli', sessionId: anchorId },
    });
    expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
    const workerId = (await worker.json()).item.id;
    const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: auth });
    await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
    await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: auth, data: { message: `[evidence] opened PR ${PR}`, url: PR, urlLabel: 'PR #12' } });
    await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: auth, data: { message: feedbackMessage } });
    await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: auth, data: { message: '[done] landed the change' } });
    await page.request.post('/test/seed-pr-status', {
      data: { repo: REPO, number: 12, readable: true, state: 'open', merged: false, headSha: PR_HEAD, checks: [{ name: 'unit', conclusion: 'success' }] },
    });
    return anchorId;
  }

  test('task page: a look-alike in the description and a comment drives nothing; the real merge button still works', async ({ page }) => {
    const hostile = hostileFor(URL_KEY);
    await seedTask(page, { description: hostile, comments: [{ id: 'c-hostile', body: hostile, createdAt: '2026-10-06T11:00:00Z', user: 'Someone' }] });
    await seedFinishedRun(page, { feedbackMessage: '[done] plain' });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-LA1`);
    await page.waitForLoadState('networkidle');
    // Open the description and comments (closed disclosures), so the look-alike
    // is really rendered, in front, with its labels intact.
    await page.evaluate(() => document.querySelectorAll('details[data-testid="task-page-description"], details[data-testid="task-page-comments"]').forEach((d) => { d.open = true; }));
    await expect(page.locator('[data-testid="task-page-description-body"] [data-action="closeout-press"]').first()).toBeAttached();
    await expect(page.locator('[data-testid="hostile-cover"]').first()).toBeVisible();

    await expect(page.locator('[data-testid="hostile-form"], form[action*="/settings/"]')).toHaveCount(0);
    const seen = watchForbidden(page);
    await clickAround(page);
    await page.waitForTimeout(500);
    expect(seen, 'a look-alike drove a Harbour control').toEqual([]);

    // The real controls still act.
    await removeCover(page);
    await page.locator('[data-testid="task-page-pr-raw"] > summary').click();
    const real = page.locator('[data-testid="task-page-pr-mount"] [data-testid="run-evidence-closeout-press"]');
    await expect(real).toBeVisible();
    await real.click();
    await expect.poll(() => seen.some((s) => /close-out-press$/.test(s)), { timeout: 10000 }).toBe(true);
  });

  test('run page: a look-alike in a transcript message drives nothing; the real merge button still works', async ({ page }) => {
    await seedTask(page, { description: 'plain' });
    await seedFinishedRun(page, { feedbackMessage: hostileFor(URL_KEY) });
    const sessions = await (await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`)).json();
    const seeded = [...(sessions.active || []), ...(sessions.recent || [])].find((s) => s.seedIssue === 'LOCAL-LA1' && String(s.sessionId || '').length > 0);
    expect(seeded, 'no reconstructed session').toBeTruthy();

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(seeded.sessionId)}`);
    await page.waitForLoadState('networkidle');
    // Expand the run row so the transcript message (and the look-alike) shows.
    await page.evaluate(() => document.querySelectorAll('.sess-run').forEach((r) => r.classList.add('sess-run--expanded')));
    await expect(page.locator('[data-testid="hostile-cover"]').first()).toBeVisible();

    await expect(page.locator('[data-testid="hostile-form"], form[action*="/settings/"]')).toHaveCount(0);
    const seen = watchForbidden(page);
    await clickAround(page);
    await page.waitForTimeout(500);
    expect(seen, 'a look-alike drove a Harbour control').toEqual([]);

    await removeCover(page);
    const real = page.locator('[data-testid="run-evidence-closeout"][data-state="ready"] [data-testid="run-evidence-closeout-press"]').first();
    await expect(real).toBeVisible();
    await real.click();
    await expect.poll(() => seen.some((s) => /close-out-press$/.test(s)), { timeout: 10000 }).toBe(true);
  });

  test('Flight Companion: a look-alike in a restored chat turn drives nothing; the real copy button still works', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const feats = encodeURIComponent(JSON.stringify({ flightCompanion: true, proxy: true }));
    await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
    await seedWorkspaceOwnership(page, URL_KEY);
    // A stored session whose assistant turn carries the hostile markup, so it
    // renders on the real top-of-page restore path.
    const stored = JSON.stringify({
      history: [
        { role: 'user', content: 'what is up?' },
        { role: 'assistant', content: hostileFor(URL_KEY) },
      ],
      tabCheckInCount: 1,
      tabTotalCost: 0,
      selectedModel: null,
    });
    await page.addInitScript(([key, value]) => {
      try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
    }, [`flight-companion-session:${URL_KEY}`, stored]);

    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="hostile-cover"]').first()).toBeVisible();

    await expect(page.locator('[data-testid="hostile-form"], form[action*="/settings/"]')).toHaveCount(0);
    const seen = watchForbidden(page);
    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));
    await clickAround(page);
    await page.waitForTimeout(500);
    expect(seen, 'a look-alike drove a Harbour control').toEqual([]);
    expect(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard untouched').toBe('__SENTINEL__');

    // The real copy button still copies (the forced +proxy mint is its own, expected request).
    await removeCover(page);
    await page.locator('section #flight-companion-copy, .flight-companion-page #flight-companion-copy').first().click();
    await expect(page.locator('.flight-companion-page #flight-companion-copy').first()).toHaveText('copied ✓');
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe('__SENTINEL__');
  });
});
