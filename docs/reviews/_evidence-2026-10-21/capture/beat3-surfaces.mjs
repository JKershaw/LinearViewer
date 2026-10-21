/**
 * LIN-3750 beat 3 — authenticated surfaces other than the task page (see beat3-task.mjs).
 *
 * Groups (run a subset by name):  kpis runner empty populated nav
 *   kpis       workspace KPIs: empty, populated (rate toggle), populated (total toggle), fail
 *   runner     /workspace/:urlKey/runner (+ the --green-as-text candidate, public/runner-setup.css:76)
 *   empty      every rebuilt page, default (empty) seed state
 *   populated  Live Console / Ship's Biscuit / Observation / session / Proxy / Ship Journey /
 *              Dispatch / Flight Companion via the plan's seed endpoints (empty vs populated recorded)
 *   nav        interactive nav states: team + assignee dropdowns, switcher "add" rows, ⋯ more,
 *              model-picker <select>
 *
 * The default `/test/set-session` seam (`?features=` for flagged views) carries the Linear mock
 * workspace `test-workspace`; the workspace KPIs read a real workspace partition, so that page
 * is driven through `/test/set-local-session` (the approved provider-data seam).
 *
 *   BASE_URL=http://localhost:3197 node beat3-surfaces.mjs [group ...]
 */
import { launch, captureState, newCtx, BASE, D1400, D390, MATRIX, ws, WS, ALL_FEATURES, APP_SESSION } from './beat3-lib.mjs';

const groups = process.argv.slice(2);
const want = (g) => !groups.length || groups.includes(g);
const browser = await launch();
const admin = await newCtx(browser, 'light', D1400);
await admin.request.get(`${BASE}${APP_SESSION}`);
const get = async (u) => { const r = await admin.request.get(`${BASE}${u}`); if (!r.ok()) console.log(`  warn GET ${u} -> ${r.status()}`); return r; };
const post = async (u, data) => { const r = await admin.request.post(`${BASE}${u}`, { data }); if (!r.ok()) console.log(`  warn POST ${u} -> ${r.status()} ${(await r.text()).slice(0, 160)}`); return r; };
const clearWs = async (urlKey = WS) => {
  for (const c of ['dispatch-queue', 'dispatch-history', 'agent-status', 'proxy-events', 'observation-sessions', 'sessions-feed-cache', 'report-history', 'ship-biscuit', 'kpi-rollup', 'workspace-halt', 'proxy-events']) await get(`/test/clear-${c}?urlKey=${urlKey}`);
  await get('/test/clear-comment-dedupe');
};
const all = [];
const run = async (surface) => { const rows = await captureState(browser, surface); all.push(...rows); return rows; };

// ---------------------------------------------------------------------------------------------
// kpis
// ---------------------------------------------------------------------------------------------
if (want('kpis')) {
  const LOCAL = 'local-workspace';
  const localSession = { local: { urlKey: LOCAL, features: { dispatch: true } } };
  const dayKey = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const kpiFacts = (page) => page.evaluate(() => ({
    data: window.__WORKSPACE_KPI_DATA__ ? { doneTotal: window.__WORKSPACE_KPI_DATA__.doneTotal ? { since: window.__WORKSPACE_KPI_DATA__.doneTotal.since, through: window.__WORKSPACE_KPI_DATA__.doneTotal.through, done: (window.__WORKSPACE_KPI_DATA__.doneTotal.done || []).slice(0, 6) } : null } : null,
    empty: !!document.querySelector('[data-testid="workspace-kpis-empty"]'),
    sections: [...document.querySelectorAll('[data-testid^="workspace-kpis-section-"]')].map(e => e.dataset.testid),
    pressed: [...document.querySelectorAll('[data-testid="workspace-kpis-toggle-done-per-day"] button')].map(b => `${b.dataset.mode}:${b.getAttribute('aria-pressed')}`),
    captionVisible: (() => { const c = document.querySelector('[data-testid="workspace-kpis-total-caption"]'); return c ? !c.hidden : null; })(),
    emptyNoteVisible: (() => { const c = document.querySelector('[data-testid="workspace-kpis-total-empty"]'); return c ? !c.hidden : null; })(),
    canvases: [...document.querySelectorAll('canvas')].map(c => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
  }));
  const clickTotal = async (page) => { await page.locator('[data-testid="workspace-kpis-toggle-done-per-day"] button[data-mode="total"]').click(); await page.waitForTimeout(400); };

  await clearWs(LOCAL);
  // a fresh context that has only ever held the local session: it is the first binder, so the owner (dispatch needs one)
  const ladmin = await newCtx(browser, 'light', D1400);
  await ladmin.request.post(`${BASE}/test/set-local-session`, { data: { urlKey: LOCAL, append: true, features: { dispatch: true } } });
  await run({ id: 'ws-kpis', state: 'empty', path: `/workspace/${LOCAL}/kpis`, session: localSession, populated: false, settleMs: 900, extra: kpiFacts, note: 'local-provider workspace, no dispatches, no rollup rows' });

  for (let i = 1; i <= 3; i++) await ladmin.request.post(`${BASE}/workspace/${LOCAL}/api/dispatch`, { data: { prompt: 'p', promptName: i === 3 ? 'autopilot' : 'implementation', kind: i === 3 ? 'autopilot' : 'implementation', issueIdentifier: `LOCAL-${i}`, target: 'cli' } }).then(async r => { if (!r.ok()) console.log('  warn dispatch', r.status(), await r.text()); });
  for (const [n, done] of [[40, 2], [38, 3], [34, 5], [20, 4], [12, 6], [5, 3]]) await get(`/test/seed-kpi-rollup?urlKey=${LOCAL}&day=${dayKey(n)}&done=${done}`);
  await run({ id: 'ws-kpis', state: 'populated-rate', path: `/workspace/${LOCAL}/kpis`, session: localSession, populated: true, settleMs: 1200, extra: kpiFacts, note: '3 dispatches + 6 seed-kpi-rollup rows; done-per-day in its default (rate) toggle state' });
  await run({ id: 'ws-kpis', state: 'populated-total', path: `/workspace/${LOCAL}/kpis`, session: localSession, populated: true, settleMs: 1200, prepare: clickTotal, extra: kpiFacts, note: 'same data; done-per-day running-total toggle pressed' });

  // fail state: the next aggregate() read rejects once (the page's own loader-failure path)
  await run({ id: 'ws-kpis', state: 'fail', path: `/workspace/${LOCAL}/kpis`, session: localSession, populated: false, settleMs: 900, expect: { status: 500 }, extra: kpiFacts,
    before: async () => { await get('/test/kpis-fail-next-aggregate?collection=dispatchHistory'); }, // re-armed per cell: the injection is one-shot
    note: 'the next dispatch-history aggregate() rejects once (/test/kpis-fail-next-aggregate), armed before every cell: the page\'s fail state' });
  await get('/test/last-kpi-refresh-error');
  await get(`/test/clear-kpi-rollup?urlKey=${LOCAL}`);
}

// ---------------------------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------------------------
if (want('runner')) {
  const runnerFacts = (page) => page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (c) => 0.2126 * lum(c[0]) + 0.7152 * lum(c[1]) + 0.0722 * lum(c[2]);
    const bgOf = (el) => { for (let a = el; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] > 0.99)) return parse(c); } return [255, 255, 255]; };
    const el = document.querySelector('.runner-setup-feedback');
    const out = { feedbackEl: !!el, feedbackText: el ? el.textContent.trim().slice(0, 80) : null, feedbackHidden: el ? (el.hidden || getComputedStyle(el).display === 'none') : null };
    if (el) { const fg = parse(getComputedStyle(el).color); const bg = bgOf(el); const [hi, lo] = [L(fg), L(bg)].sort((a, b) => b - a); out.feedbackColor = getComputedStyle(el).color; out.feedbackBg = `rgb(${bg.join(',')})`; out.feedbackRatio = +((hi + 0.05) / (lo + 0.05)).toFixed(2); }
    out.greenToken = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    return out;
  });
  // exercise the copy control so the feedback line shows, without altering the page's code
  const pressCopy = async (page) => {
    await page.locator('[data-testid="runner-setup-mint"]').click();
    await page.locator('[data-testid="runner-setup-copy"]:not([hidden])').waitFor({ timeout: 8000 }).catch(() => {});
    await page.locator('[data-testid="runner-setup-copy"]').click().catch(() => {});
    await page.waitForTimeout(600);
  };
  await run({ id: 'ws-runner', state: 'default', path: ws('/runner'), session: 'app', populated: null, extra: runnerFacts, settleMs: 800, note: 'default render' });
  await run({ id: 'ws-runner', state: 'minted-and-copied', path: ws('/runner'), session: 'app', populated: null, prepare: pressCopy, permissions: ['clipboard-read', 'clipboard-write'], extra: runnerFacts, settleMs: 800, note: 'mint then copy pressed (clipboard granted) so .runner-setup-feedback "copied ✓" (color: var(--green), runner-setup.css:76) is on screen' });
}

// ---------------------------------------------------------------------------------------------
// empty (default seed) states of the rebuilt pages
// ---------------------------------------------------------------------------------------------
if (want('empty')) {
  await clearWs();
  const { REGISTRY } = await import('./beat3-lib.mjs');
  const pages = [
    ['ws-tree', '/'], ['ws-swipe', '/swipe'], ['ws-swim', '/swim'], ['ws-settings', '/settings'], ['ws-roadmap', '/roadmap'],
    ['ws-proxy', '/proxy'], ['ws-flight-companion', '/flight-companion'], ['ws-dispatch', '/dispatch'],
    ['ws-live-console', '/live-console'], ['ws-ship-biscuit', '/ship-biscuit'], ['ws-observation', '/observation'],
    ['ws-ship-journey', '/ship-journey'], ['ws-escalation-kpis', '/escalation-kpis'],
    ['ws-audit', '/audit'], ['ws-dashboard', '/dashboard'], ['ws-next-run', '/next-run'], ['ws-passage-planner', '/passage-planner'],
    ['ws-prompts', '/prompts'], ['ws-prompts-custom', '/prompts/custom'], ['ws-effort-readout', '/effort-readout'], ['ws-task-chat', '/task-chat'],
    ['ws-task-new', '/task/new'], ['ws-observation-session', '/observation/session/none'], ['ws-ship', '/ship'],
  ];
  const named = {
    'ws-effort-readout': 'no seed seam (beat-1 grep): empty state only — named limit',
    'ws-task-chat': 'no seed seam beyond /test/clear-saved-chats (beat-1 grep): default state only — named limit',
    'ws-observation-session': 'unknown session id: the page\'s own 404 (the populated session is captured separately)',
  };
  for (const [id, p] of pages) {
    const reg = REGISTRY.entries.find(e => e.id === id);
    await run({ id, state: 'empty', path: ws(p), session: 'app', populated: false, settleMs: reg?.settleMs || 700, expect: reg?.expect, note: named[id] || 'default seed (empty) state' });
  }
  // Scan-due: the Observation page's fourth tab; no seed seam for a due scan (beat-1 grep) -> its empty state
  await run({ id: 'ws-observation', state: 'scan-due-tab-empty', path: ws('/observation'), session: 'app', populated: false, settleMs: 700,
    prepare: async (page) => { await page.locator('.obs-tab[data-view="due"]').click(); await page.waitForTimeout(1200); },
    extra: (page) => page.evaluate(() => { const s = document.getElementById('obs-due-section'); return { dueSectionVisible: !!(s && !s.hidden && s.getBoundingClientRect().height > 0), text: s ? s.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null }; }),
    note: 'Scan-due tab clicked; no seed seam for a due scan (only /test/clear-task-decisions + read-backs) — empty state, named limit' });

  // task edit on a local workspace (the Linear-mock seed 500s: the mock cannot read the issue)
  const LOCAL = 'local-workspace';
  const lid = (r) => `${LOCAL}--${r}`;
  const localTask = { urlKey: LOCAL, features: { dispatch: true }, projects: [{ id: lid('te-proj'), name: 'Edit project', content: 'p', sortOrder: 1 }],
    issues: [{ id: lid('te-issue'), identifier: 'LOCAL-TE1', title: 'A task to edit', description: 'Seeded **description**.', projectId: lid('te-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${LOCAL}/issue/${lid('te-issue')}` }] };
  await run({ id: 'ws-task-edit', state: 'local-populated', path: `/workspace/${LOCAL}/task/${lid('te-issue')}/edit`, session: { local: localTask }, populated: true, settleMs: 900, note: 'local-provider issue (the default Linear-mock seed 500s because the mock cannot read the task: measured:error-500 in the census)' });
  await run({ id: 'ws-task-new', state: 'local', path: `/workspace/${LOCAL}/task/new`, session: { local: localTask }, populated: false, settleMs: 700, note: 'create-task form under the local provider' });
}

// ---------------------------------------------------------------------------------------------
// providers: the twin trees / settings / roadmap
// ---------------------------------------------------------------------------------------------
if (want('providers')) {
  const twins = [
    ['ws-tree-github', '/test/set-github-session', '/workspace/github-workspace/'],
    ['ws-tree-ghp', '/test/set-github-projects-session', '/workspace/github-projects-workspace/'],
    ['ws-tree-jira', '/test/set-jira-session', '/workspace/jira-workspace/'],
    ['ws-settings-jira', '/test/set-jira-session', '/workspace/jira-workspace/settings'],
  ];
  for (const [id, session, p] of twins) await run({ id, state: 'default', path: p, session, populated: null, settleMs: 800, note: `provider twin via ${session}` });
  await run({ id: 'ws-roadmap-local', state: 'default', path: '/workspace/local-workspace/roadmap', session: { local: { urlKey: 'local-workspace', features: { roadmap: true } } }, populated: null, settleMs: 800, note: 'roadmap under the local provider (the census\'s GET seed redirected; the POST seed with features.roadmap renders)' });
}

// ---------------------------------------------------------------------------------------------
// populated states
// ---------------------------------------------------------------------------------------------
if (want('populated')) {
  await clearWs();
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const status = (id, action, st, summary, minAgo) => post('/test/seed-agent-status', { urlKey: WS, taskIdentifier: id, action, status: st, summary, timestamp: iso(minAgo) });
  await status('LIN-101', 'implement', 'completed', 'Shipped the retry-with-backoff change and verified it against CI.', 95);
  await status('LIN-102', 'review', 'completed', 'Approved with one nit; ledger discharged by the close-out.', 70);
  await status('LIN-103', 'plan', 'in_progress', 'Reading the settings render path before planning the split.', 40);
  await status('LIN-104', 'implement', 'failed', 'Build red on the unit job; root cause is a stale fixture.', 25);
  await status('LIN-105', 'investigate', 'completed', 'Traced the 503 to a tracker read with no fallback.', 8);
  for (const [m, e, s, note] of [['GET', '/api/proxy/me', 200, null], ['GET', '/api/proxy/issues', 200, null], ['POST', '/api/proxy/issues/LIN-1/comments', 201, null], ['GET', '/api/proxy/issues/LIN-9', 404, 'not found'], ['GET', '/api/proxy/me', 401, 'token_ownerless']]) {
    await get(`/test/seed-proxy-event?urlKey=${WS}&method=${m}&endpoint=${encodeURIComponent(e)}&status=${s}&tokenLabel=runner${note ? `&note=${note}` : ''}`);
  }

  // Dispatch sessions (the Observation feed is built from dispatch + agent-status stores, NOT from
  // seed-agent-status alone: the plan's "Observation via seed-agent-status" renders an empty feed).
  const { token } = await (await get(`/test/create-dispatch-token?label=runner&urlKey=${WS}`)).json();
  const mk = async (data) => (await (await post(`/workspace/${WS}/api/dispatch`, data)).json()).item.id;
  const fb = (id, data) => admin.request.post(`${BASE}/api/dispatch/feedback/${id}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data });
  const take = (id) => admin.request.post(`${BASE}/api/dispatch/take/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const session = async (issue, title, outcome) => {
    const anchorId = await mk({ prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: issue, issueTitle: title, target: 'cli' });
    const workerId = await mk({ prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: issue, issueTitle: `${title} worker`, target: 'cli', sessionId: anchorId });
    await take(workerId);
    if (outcome === 'done') { await fb(workerId, { message: 'opened the pull request', url: 'https://example.com/pr/42', urlLabel: 'PR #42' }); await fb(workerId, { message: '[done] landed the change' }); }
    if (outcome === 'blocked') await fb(workerId, { message: '[blocked] need your decision on the auth flow' });
    if (outcome === 'running') await fb(workerId, { message: 'reading the render path' });
    return anchorId;
  };
  const doneAnchor = await session('LIN-1003', 'Session-page seed', 'done');
  await session('LIN-1005', 'Waiting seed', 'blocked');
  await session('LIN-1252', 'Warm seed', 'running');
  const feed = await (await get(`/workspace/${WS}/api/dashboard/sessions`)).json();
  const sessions = Array.isArray(feed) ? feed : (feed.sessions || []);
  console.log(`sessions feed: ${sessions.length} session(s); keys: ${sessions[0] ? Object.keys(sessions[0]).slice(0, 12).join(',') : '-'}`);
  const done = sessions.find(s => /Session-page seed/.test(JSON.stringify(s))) || sessions[0];
  const sid = (done && (done.sessionId || done.id)) || doneAnchor;

  const lcFacts = (page) => page.evaluate(() => {
    const out = {};
    for (const sel of ['[data-testid^="live-console-pulse-preset-"]', '[data-testid^="live-console-timeline-preset-"]']) {
      out[sel] = [...document.querySelectorAll(sel)].map(b => { const cs = getComputedStyle(b); return { testid: b.dataset.testid, fontSize: cs.fontSize, fontFamily: cs.fontFamily.slice(0, 40), fontWeight: cs.fontWeight, color: cs.color, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }; });
    }
    return out;
  });
  const P = { session: 'app', populated: true, full: true };
  await run({ ...P, id: 'ws-live-console', state: 'populated', path: ws('/live-console'), settleMs: 1800, extra: lcFacts, note: 'seed-agent-status ×5 + seed-proxy-event ×5 + 3 dispatch sessions; extra = A16 computed font-size read on the pulse/timeline preset buttons' });
  await run({ ...P, id: 'ws-observation', state: 'populated', path: ws('/observation'), settleMs: 2500, note: '3 dispatch sessions (done / blocked / running) + seed-agent-status ×5' });
  await run({ ...P, id: 'ws-observation-session', state: 'populated', path: ws(`/observation/session/${sid}`), settleMs: 1200, note: `session ${sid}: anchor + worker with a transcript (take + feedback), plus seed-agent-status and seed-proxy-event` });
  const openEvents = async (page) => { await page.evaluate(() => { const d = document.getElementById('proxy-events-collapsible'); if (d) d.open = true; }); await page.waitForTimeout(1200); };
  await run({ ...P, id: 'ws-proxy', state: 'populated', path: ws('/proxy'), settleMs: 1500, prepare: openEvents, note: 'seed-proxy-event ×5; the Event Log disclosure (#proxy-events-collapsible, closed by default) opened' });

  // Ship's Biscuit: the deterministic edition builder is persisted, so press the presses once (API), then
  // every cell server-renders the saved edition. AI is not involved (mocked workspace; deterministic model).
  const gen = await post(`/workspace/${WS}/api/ship-biscuit/generate`, { window: 'week' });
  console.log(`ship-biscuit generate -> ${gen.status()}`);
  await run({ ...P, id: 'ws-ship-biscuit', state: 'populated', path: ws('/ship-biscuit'), settleMs: 1500, note: 'seed-agent-status ×5 then one deterministic edition generated (POST .../api/ship-biscuit/generate, window=week)' });

  // Ship Journey: waypoints need completed issues in a real (local) workspace and orientation entries that name them.
  const LOCAL = 'local-workspace';
  const lid = (r) => `${LOCAL}--${r}`;
  const issues = [], orient = [];
  const bearings = ['N', 'NE', 'E', 'N', 'NW', 'N'];
  bearings.forEach((b, i) => {
    issues.push({ id: lid(`sj-issue-${i + 1}`), identifier: `LOCAL-${i + 1}`, title: `Waypoint ${i + 1}`, description: '', projectId: lid('sj-proj-1'), sortOrder: i + 1, state: { name: 'Done', type: 'completed' }, completedAt: `2026-01-${String(i * 3 + 1).padStart(2, '0')}T00:00:00Z`, url: `/workspace/${LOCAL}/issue/${lid(`sj-issue-${i + 1}`)}` });
    orient.push({ identifier: `LOCAL-${i + 1}`, bearing: b, reason: 'r', archived: false });
  });
  const journeyLocal = { urlKey: LOCAL, features: { shipJourney: true }, projects: [{ id: lid('sj-proj-1'), name: 'Journey Project', content: '', sortOrder: 1 }], issues };
  await get(`/test/clear-report-history?urlKey=${LOCAL}`);
  await post(`/test/seed-report-history?urlKey=${LOCAL}`, { records: [
    { generatedAt: '2026-01-01T00:00:00Z', northStar: 'A calm control plane', orientation: orient.slice(0, 3) },
    { generatedAt: '2026-01-20T00:00:00Z', northStar: 'Evidence over assertion', orientation: orient.slice(3) },
  ] });
  await get('/test/clear-workspace-issues-memo');
  await run({ ...P, id: 'ws-ship-journey', state: 'populated', path: `/workspace/${LOCAL}/ship-journey`, session: { local: journeyLocal }, settleMs: 2500, note: 'local-provider workspace: 6 completed issues + seed-report-history ×2 (north-star change between runs; run window spans every completion, so coverage reads 6 of 6)' });

  // Dispatch / Flight Companion
  await post(`/test/seed-dispatch-preset?urlKey=${WS}`, { name: 'Review-heavy', config: { implementation: { harness: 'claude', model: 'claude-sonnet-5-5' } } });
  await run({ ...P, id: 'ws-dispatch', state: 'populated', path: ws('/dispatch'), settleMs: 4000, note: 'seed-dispatch-preset ×1 (plus the 3 dispatch sessions)' });
  await post('/test/set-flight-companion-playbook', { urlKey: WS, playbook: '- [ ] Promise: re-read the evidence ledger before merge\n- [ ] Promise: hold the beat-3 PR until CI is green' });
  await run({ ...P, id: 'ws-flight-companion', state: 'populated', path: ws('/flight-companion'), settleMs: 1200, note: 'set-flight-companion-playbook; a live turn is NOT driven (named limit)' });
}

// ---------------------------------------------------------------------------------------------
// interactive nav states
// ---------------------------------------------------------------------------------------------
if (want('nav')) {
  await clearWs();
  const openState = (sel, name) => async (page) => {
    const t = page.locator(sel).first();
    await t.scrollIntoViewIfNeeded().catch(() => {});
    if (await t.count()) await t.click().catch(() => {});
    await page.waitForTimeout(400);
  };
  const dropFacts = (toggleSel, panelSel) => (page) => page.evaluate(([t, p]) => {
    const tg = document.querySelector(t); const pn = document.querySelector(p);
    const r = pn ? pn.getBoundingClientRect() : null;
    return {
      toggleExists: !!tg, expanded: tg ? tg.getAttribute('aria-expanded') : null,
      panelExists: !!pn, panelVisible: !!(pn && r && r.width > 0 && r.height > 0 && getComputedStyle(pn).visibility !== 'hidden'),
      panelBox: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), clippedRight: Math.round(r.right) > window.innerWidth } : null,
      options: pn ? [...pn.querySelectorAll('[role="option"], a, button')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25) : [],
    };
  }, [toggleSel, panelSel]);
  await run({ id: 'ws-tree', state: 'team-dropdown-open', path: ws('/'), session: 'app', populated: null, prepare: openState('#team-toggle'), extra: dropFacts('#team-toggle', '#team-options'), note: 'team selector opened' });
  await run({ id: 'ws-tree', state: 'assignee-dropdown-open', path: ws('/'), session: 'app', populated: null, prepare: openState('#assignee-toggle'), extra: dropFacts('#assignee-toggle', '#assignee-options'), note: 'assignee selector opened (tree/projects page only, LIN-2527)' });
  await run({ id: 'ws-tree', state: 'workspace-switcher-open', path: ws('/'), session: `/test/set-session?multiWorkspace=true&features=${encodeURIComponent(JSON.stringify(ALL_FEATURES))}`, populated: null, prepare: openState('#workspace-toggle'), extra: dropFacts('#workspace-toggle', '#workspace-options'), note: 'workspace switcher opened, two workspaces, "add" rows visible' });
  await run({ id: 'ws-tree', state: 'nav-more-expanded', path: ws('/'), session: 'app', populated: null, prepare: openState('[data-testid="nav-more-toggle"]'), extra: dropFacts('[data-testid="nav-more-toggle"]', '#nav-views-overflow'), note: '⋯ more expander opened' });
  await run({ id: 'ws-settings', state: 'model-picker-focus', path: ws('/settings'), session: 'app', populated: null, settleMs: 800,
    prepare: async (page) => { const s = page.locator('select.model-select, select.dispatch-model-input, select.harness-select').first(); if (await s.count()) { await s.scrollIntoViewIfNeeded().catch(() => {}); await s.focus().catch(() => {}); } await page.waitForTimeout(300); },
    extra: (page) => page.evaluate(() => [...document.querySelectorAll('select')].slice(0, 12).map(s => { const cs = getComputedStyle(s); const r = s.getBoundingClientRect(); return { cls: s.className, name: s.name, options: [...s.options].map(o => o.textContent.trim()).slice(0, 12), fontSize: cs.fontSize, h: Math.round(r.height), w: Math.round(r.width), color: cs.color, bg: cs.backgroundColor, focused: document.activeElement === s }; })),
    note: 'model-picker <select> focused; native popup list is not rendered in headless captures (named limit) — option sets and computed styles are in the JSON' });
}

// ---------------------------------------------------------------------------------------------
// merge: the real 409 account-merge offer (the Linear-only seam; non-Linear copies stay a named limit, 09-26 §7.1)
// ---------------------------------------------------------------------------------------------
if (want('ship')) {
  await run({ id: 'ws-ship', state: 'empty', path: ws('/ship'), session: 'app', populated: false, settleMs: 700, note: 'default seed (empty) state' });
}
if (want('merge')) {
  await run({ id: 'renderer:renderMergeConfirmPage', state: 'live-409', path: '/test/set-merge-conflict-session', session: 'none', populated: null, expect: { status: 409 }, settleMs: 500,
    note: 'real production render through /test/set-merge-conflict-session (provider hardcoded to linear); GitHub/Jira copies remain un-rendered — carried named limit' });
}

// ---------------------------------------------------------------------------------------------
// collective: A22 status-dot state colours (needs the offline flip)
// ---------------------------------------------------------------------------------------------
if (want('collective')) {
  await clearWs();
  const dotFacts = (page) => page.evaluate(() => {
    const el = document.getElementById('collective-poll-status');
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (c) => 0.2126 * lum(c[0]) + 0.7152 * lum(c[1]) + 0.0722 * lum(c[2]);
    let bg = [255, 255, 255];
    for (let a = el; a; a = a.parentElement) { const m = getComputedStyle(a).backgroundColor.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] > 0.99)) { bg = m.slice(0, 3).map(Number); break; } }
    const fg = parse(cs.color); const [hi, lo] = [L(fg), L(bg)].sort((a, b) => b - a);
    return { present: true, text: el.textContent.trim(), color: cs.color, bg: `rgb(${bg.join(',')})`, ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), className: el.className, fontSize: cs.fontSize };
  });
  const base = { id: 'ws-collective', path: ws('/collective'), session: 'app', populated: null, settleMs: 2500, extra: dotFacts };
  await run({ ...base, state: 'live', note: 'mock Yap; poll status after the first poll' });
  await run({ ...base, state: 'disconnected-offline', settleMs: 500,
    prepare: async (page, ctx) => { await page.waitForTimeout(2500); await ctx.setOffline(true); await page.waitForFunction(() => /disconnected/.test((document.getElementById('collective-poll-status') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {}); },
    note: 'A22: browser context flipped offline after load (Playwright setOffline, client-side network emulation — not a product seam), next poll fails -> "● disconnected"' });
  await run({ ...base, state: 'yap-not-configured', settleMs: 500,
    prepare: async (page) => { await page.route('**/api/collective/state*', r => r.fulfill({ status: 503, body: '{}', contentType: 'application/json' })); await page.waitForFunction(() => /not configured/.test((document.getElementById('collective-poll-status') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {}); },
    note: 'poll answered 503 via request interception (synthetic): "Yap not configured"' });
}

await admin.close(); await browser.close();
const bad = all.filter(r => !r.ok);
console.log(`\n== beat3-surfaces == captures=${all.length} ok=${all.length - bad.length} failed=${bad.length}`);
for (const r of bad) console.log('FAIL', r.key, r.reason);
process.exit(bad.length ? 1 : 0);
