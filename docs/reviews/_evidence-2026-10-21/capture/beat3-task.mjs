/**
 * LIN-3750 beat 3 — task page states (registry id ws-task-page + renderer:renderTaskNotFoundPage).
 *
 * The default `/test/set-session` Linear mock cannot read a task (`ws-task-page` at
 * /workspace/test-workspace/task/TEST-1 is a 503 "Task unavailable"). The approved seam
 * `/test/set-local-session` backs the tracker read with the real LocalStore, so the page's
 * `fetchRecommendationContext` read is genuine; sessions are real dispatch rows driven through
 * take + feedback, exactly as tests/e2e/task-page.spec.js seeds them. Server-side seed is
 * done once per state (`seedState`), then the 4-cell theme/viewport matrix is captured.
 *
 *   BASE_URL=http://localhost:3197 node beat3-task.mjs [state ...]
 */
import { launch, captureState, newCtx, BASE, D1400, D390, MATRIX } from './beat3-lib.mjs';

const URL_KEY = 'local-workspace';
const lid = (raw) => `${URL_KEY}--${raw}`;
const REVIEW_BODY = [
  '## Review — seeded', '', 'CI on `abc1234` is green.', '',
  '### What CI Did Not Prove',
  '| # | Claim | In/Out | Discharge |', '|---|---|---|---|',
  '| L1 | the task page keeps its evidence across a repaint | inside | this review |', '',
  '**Verdict: Approve — conditional on close-out discharging the ledger.**',
].join('\n');
const PR_NUM = 410000 + (Date.now() % 90000); // fresh per run: close-out events are Mongo-backed, not cleared
const PR_URL = `https://github.com/acme/app/pull/${PR_NUM}`;
const SHA = 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0';

const issue = (raw, identifier, title, state, extra = {}) => ({
  id: lid(raw), identifier, title, description: `Seeded ${title}`, projectId: lid('tp-proj'), sortOrder: 1, state,
  url: `/workspace/${URL_KEY}/issue/${lid(raw)}`, ...extra,
});
const PROJECT = [{ id: lid('tp-proj'), name: 'Task page project', content: 'A project', sortOrder: 1 }];
const localBody = (issues) => ({ urlKey: URL_KEY, append: true, features: { dispatch: true }, projects: PROJECT, issues });

async function api(admin, method, url, opts = {}) {
  const r = await admin.request[method](`${BASE}${url}`, opts);
  if (!r.ok()) throw new Error(`${method} ${url} -> ${r.status()} ${(await r.text()).slice(0, 200)}`);
  return r;
}
export async function clearAll(admin) {
  await admin.request.get(`${BASE}/test/clear-pr-status`);
  await admin.request.get(`${BASE}/test/clear-comment-dedupe`);
  for (const p of ['clear-local-store', `clear-dispatch-queue?urlKey=${URL_KEY}`, `clear-dispatch-history?urlKey=${URL_KEY}`, `clear-agent-status?urlKey=${URL_KEY}`, `clear-observation-sessions?urlKey=${URL_KEY}`, `clear-sessions-feed-cache?urlKey=${URL_KEY}`, `clear-task-shares?urlKey=${URL_KEY}`]) {
    await admin.request.get(`${BASE}/test/${p}`);
  }
}
async function runnerToken(admin) {
  return (await (await api(admin, 'get', `/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
}
const feedback = (admin, token, id, message) => api(admin, 'post', `/api/dispatch/feedback/${id}`, {
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  data: typeof message === 'string' ? { message } : message,
});
async function seedSession(admin, token, { identifier, title, kind, fb = [], take = true, extra = {} }) {
  const res = await api(admin, 'post', `/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: title, target: 'cli', ...extra },
  });
  const itemId = (await res.json()).item.id;
  if (!take) return itemId;
  await api(admin, 'post', `/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  for (const m of fb) await feedback(admin, token, itemId, m);
  return itemId;
}
const prIssue = (state, title) => issue('tp-pr', 'LOCAL-TP1', title, state, {
  description: 'The **task** description.',
  comments: [
    { id: 'c-pr', body: `Opened the pull request: ${PR_URL}`, createdAt: '2026-10-06T09:00:00Z', user: 'Runner' },
    { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' },
  ],
});
async function anchorRun(admin, title) {
  const token = await runnerToken(admin);
  const id = await seedSession(admin, token, { identifier: 'LOCAL-TP1', title, kind: 'autopilot', fb: ['[done] orchestrated the run'], extra: { stopAt: 'pr', variant: 'standard', promptName: 'Autopilot (LOCAL-TP1)' } });
  return { token, id };
}
const seedPr = (admin, o) => api(admin, 'post', '/test/seed-pr-status', { data: { repo: 'acme/app', number: PR_NUM, readable: true, headSha: SHA, checks: [{ name: 'unit', conclusion: 'success' }], ...o } });

const openRaw = async (page) => { const s = page.locator('[data-testid="task-page-pr-raw"] > summary'); if (await s.count()) await s.click().catch(() => {}); };
const taskFacts = (page) => page.evaluate(() => {
  const g = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : null; };
  const root = document.querySelector('[data-testid="task-page"]');
  return {
    dataStatus: root ? root.getAttribute('data-status') : null, mergeReady: root ? root.getAttribute('data-merge-ready') : null,
    title: g('task-page-title'), sentence: g('task-page-sentence'), stageCount: document.querySelectorAll('[data-testid="task-page-stage"]').length,
    prLead: g('task-page-pr-lead'), closeoutState: (document.querySelector('[data-testid="run-evidence-closeout"]') || {}).dataset?.state || null,
    hasPress: !!document.querySelector('[data-testid="run-evidence-closeout-press"]'), ownerWidgets: !!document.querySelector('[data-testid="task-page-owner-widgets"]'),
    notFound: !!document.querySelector('[data-testid="task-page-not-found"]'),
  };
});

// state -> { seed(admin) -> session/path overrides, surface fields }
export const STATES = {
  running: {
    path: `/workspace/${URL_KEY}/task/LOCAL-TP1`, populated: true,
    async seed(admin) {
      const token = await runnerToken(admin);
      await api(admin, 'post', '/test/set-local-session', { data: localBody([
        issue('tp-run', 'LOCAL-TP1', 'A task with a running build', { name: 'In Progress', type: 'started' }, { comments: [{ id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' }] }),
        issue('tp-sub', 'LOCAL-TP4', 'A subtask of the running task', { name: 'Todo', type: 'unstarted' }, { parentId: lid('tp-run') }),
      ]) });
      await seedSession(admin, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'plan', fb: [{ message: '[evidence] wrote the plan', url: 'https://example.com/plan', urlLabel: 'plan doc' }, '[done] planned it'] });
      await seedSession(admin, token, { identifier: 'LOCAL-TP1', title: 'A task with a running build', kind: 'implementation' });
      return localBody([
        issue('tp-run', 'LOCAL-TP1', 'A task with a running build', { name: 'In Progress', type: 'started' }, { comments: [{ id: 'c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' }] }),
        issue('tp-sub', 'LOCAL-TP4', 'A subtask of the running task', { name: 'Todo', type: 'unstarted' }, { parentId: lid('tp-run') }),
      ]);
    },
  },
  done: {
    path: `/workspace/${URL_KEY}/task/LOCAL-TP2`, populated: true,
    async seed(admin) {
      const token = await runnerToken(admin);
      const body = localBody([issue('tp-done', 'LOCAL-TP2', 'A finished task', { name: 'Done', type: 'completed' })]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      await seedSession(admin, token, { identifier: 'LOCAL-TP2', title: 'A finished task', kind: 'implementation', fb: ['[done] shipped'] });
      return body;
    },
  },
  waiting: {
    path: `/workspace/${URL_KEY}/task/LOCAL-TP3`, populated: true,
    async seed(admin) {
      const token = await runnerToken(admin);
      const body = localBody([issue('tp-wait', 'LOCAL-TP3', 'A task waiting on an answer', { name: 'In Progress', type: 'started' })]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      await seedSession(admin, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'plan', fb: ['[done] planned'] });
      await seedSession(admin, token, { identifier: 'LOCAL-TP3', title: 'A task waiting on an answer', kind: 'implementation', fb: ['[blocked] which API key should the build use?'] });
      return body;
    },
  },
  'pr-ready-owner': {
    path: `/workspace/${URL_KEY}/task/LOCAL-TP1`, populated: true, prepare: openRaw,
    async seed(admin) {
      const body = localBody([prIssue({ name: 'In Progress', type: 'started' }, 'A task with an approved PR')]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      await anchorRun(admin, 'A task with an approved PR');
      await seedPr(admin, { state: 'open', merged: false });
      return body;
    },
  },
  'merged-done': { // B1: already merged + tracker Done
    path: `/workspace/${URL_KEY}/task/LOCAL-TP1`, populated: true, prepare: openRaw, settleMs: 3500,
    async seed(admin) {
      const body = localBody([prIssue({ name: 'Done', type: 'completed' }, 'A finished task with a merged PR')]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      await anchorRun(admin, 'A finished task with a merged PR');
      await seedPr(admin, { state: 'closed', merged: true });
      return body;
    },
  },
  'reopened': { // B1': merge recorded Done, tracker reopened. Phase 1 writes the Done, phase 2 reopens.
    path: `/workspace/${URL_KEY}/task/LOCAL-TP1`, populated: true, prepare: openRaw, settleMs: 3500,
    async seed(admin, browser) {
      const started = localBody([prIssue({ name: 'In Progress', type: 'started' }, 'A reopened task')]);
      await api(admin, 'post', '/test/set-local-session', { data: started });
      await anchorRun(admin, 'A reopened task');
      await seedPr(admin, { state: 'closed', merged: true });
      // phase 1: the first check on an In Progress + merged PR writes Done
      const c = await newCtx(browser, 'light', D1400);
      await c.request.post(`${BASE}/test/set-local-session`, { data: started });
      const p = await c.newPage();
      await p.goto(`${BASE}/workspace/${URL_KEY}/task/LOCAL-TP1`);
      await p.waitForTimeout(3500);
      await c.close();
      return started; // phase 2: tracker back In Progress; the recorded Done survives
    },
  },
  'pr-ready-guest': { // a guest share link: evidence + text, no merge box, no owner widgets
    session: 'none', populated: true, prepare: openRaw,
    async seed(admin) {
      const body = localBody([prIssue({ name: 'In Progress', type: 'started' }, 'A task with an approved PR')]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      await anchorRun(admin, 'A task with an approved PR');
      await seedPr(admin, { state: 'open', merged: false });
      const minted = await api(admin, 'post', `/workspace/${URL_KEY}/api/task/LOCAL-TP1/share`, { data: { source: 'local' } });
      this.path = (await minted.json()).path;
      return null;
    },
  },
  'not-found': { // tracker has no such task: the real route's 404 (renderTaskNotFoundPage)
    path: `/workspace/${URL_KEY}/task/LOCAL-NOPE`, populated: false, expect: { status: 404 }, alsoAs: 'renderer:renderTaskNotFoundPage',
    async seed(admin) {
      const body = localBody([issue('tp-run', 'LOCAL-TP1', 'A task with a running build', { name: 'In Progress', type: 'started' })]);
      await api(admin, 'post', '/test/set-local-session', { data: body });
      return body;
    },
  },
  'signed-out': { // no session: the route redirects to the landing page
    path: `/workspace/${URL_KEY}/task/LOCAL-TP1`, session: 'none', populated: false, expect: { status: 200, finalPath: '/' },
    async seed(admin) { return null; },
  },
};

async function main() {
  const wanted = process.argv.slice(2);
  const browser = await launch();
  const admin = await newCtx(browser, 'light', D1400);
  const results = [];
  for (const [state, def] of Object.entries(STATES)) {
    if (wanted.length && !wanted.includes(state)) continue;
    await clearAll(admin);
    let sessionBody;
    try { sessionBody = await def.seed(admin, browser); } catch (e) { console.log(`SEED-FAIL ${state}: ${e.message}`); results.push({ state, seeded: false, error: e.message }); continue; }
    const surface = {
      id: 'ws-task-page', state, path: def.path, session: def.session ?? { local: sessionBody }, populated: def.populated,
      prepare: def.prepare, settleMs: def.settleMs, full: true, expect: def.expect || { status: 200 },
      note: `local-provider seed (${def.session === 'none' ? 'no owner session' : 'owner'}); ${state}`, extra: taskFacts,
    };
    const rows = await captureState(browser, surface);
    if (def.alsoAs) await captureState(browser, { ...surface, id: def.alsoAs, note: `the real route's render of ${def.alsoAs}; ${state}` });
    results.push({ state, ok: rows.every(r => r.ok), outcomes: rows.map(r => `${r.httpStatus}:${r.outcome}`) });
  }
  console.log(JSON.stringify(results, null, 1));
  await admin.close(); await browser.close();
}
if (process.argv[1] && process.argv[1].endsWith('beat3-task.mjs')) await main();
