/**
 * Dashboard Page Client-Side Logic (LIN-509).
 *
 * The combined, realtime autopilot dashboard. The poll source is the Mongo-only
 * merged-loops endpoint (/api/dashboard/loops); everything below is presentation:
 *
 * - Status banner: one at-a-glance line (active / done / errors), refreshed each poll.
 * - Sessions: runs are grouped by task (workspace + issue) into expandable session
 *   cards. A session is "active" if any of its runs is still going, else "recent".
 *   Autopilot orchestrator runs nest the steps they drove under the same task.
 * - Scope toggle: default to autopilot-only; flip to "All runs" to see every dispatch.
 * - Workspace chips: pure client-side filter over already-merged data (no refetch).
 * - Expand a session → AI run summary at the TOP (one-line outcome + flags), then a
 *   streamlined, expandable feed of the session's runs/events below.
 * - On-demand run summary: GET ?cachedOnly first (free), then a button POSTs to
 *   generate (terminal runs only — the immutable-run cache contract).
 *
 * Loaded only on the /dashboard page. Requires common.js (escapeHtml, window.api).
 */

let dashboardData = null;
let pollId = null;
let visibilityHandler = null;

const POLL_MS = 5000;
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Filter state.
let scope = 'autopilot';                 // 'autopilot' | 'all'
const hiddenWorkspaces = new Set();       // urlKeys toggled off

// Live data + view state preserved across polls.
const runIndex = new Map();               // loopId → run
const activeCards = new Map();            // sessionKey → <li>
const recentCards = new Map();            // sessionKey → <li>
const expandedSessions = new Set();       // sessionKey
const expandedRuns = new Set();           // loopId
const summaryState = new Map();           // loopId → { status, summary }
const knownSessions = new Set();          // sessionKey (for new-row animation)

const TERMINAL = new Set(['complete', 'error']);
const STATE_ICON = { complete: '✓', error: '✕', running: '◐', waiting: '◌', queued: '○' };
const STATE_RANK = { running: 4, waiting: 3, queued: 2, error: 1, complete: 0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(value) {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ms).toLocaleDateString();
}

function activityValue(run) {
  return run.completedAt || run.foremanTimestamp || run.resolvedAt || run.dispatchedAt || '';
}
function activityMs(run) {
  const ms = new Date(activityValue(run)).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function setPollStatus(text) {
  const el = document.getElementById('dashboard-poll-status');
  if (el) el.textContent = text || '';
}

function isVisibleWs(urlKey) {
  return !hiddenWorkspaces.has(urlKey);
}

function sessionKey(run) {
  return `${run.workspaceUrlKey || ''}::${run.issueIdentifier || run.loopId}`;
}

// ─── Session model ──────────────────────────────────────────────────────────

/**
 * Group the indexed runs into sessions (one per task), newest activity first.
 * Each session rolls up its runs' state and tags itself autopilot if any run is
 * an autopilot orchestrator kickoff.
 */
function buildSessions() {
  const byKey = new Map();
  for (const run of runIndex.values()) {
    const key = sessionKey(run);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        workspaceUrlKey: run.workspaceUrlKey || '',
        workspaceName: run.workspaceName || run.workspaceUrlKey || '',
        issueIdentifier: run.issueIdentifier || '',
        issueTitle: run.issueTitle || '',
        issueUrl: run.issueUrl || '',
        runs: []
      });
    }
    byKey.get(key).runs.push(run);
  }

  const sessions = [];
  for (const s of byKey.values()) {
    s.runs.sort((a, b) => activityMs(b) - activityMs(a) || (b.iteration || 0) - (a.iteration || 0));
    s.latest = s.runs[0];
    s.lastActivity = activityValue(s.latest);
    s.isAutopilot = s.runs.some(r => r.kind === 'autopilot');
    s.isBug = s.runs.some(r => r.kind === 'bug');
    s.runCount = s.runs.length;
    s.errorCount = s.runs.filter(r => r.agentState === 'error').length;
    s.activeRuns = s.runs.filter(r => !TERMINAL.has(r.agentState));
    s.active = s.activeRuns.length > 0;
    // Roll-up state: the most "alive" active state, else the latest terminal state.
    if (s.active) {
      s.state = s.activeRuns.map(r => r.agentState).sort((a, b) => (STATE_RANK[b] || 0) - (STATE_RANK[a] || 0))[0];
    } else {
      s.state = s.errorCount > 0 ? 'error' : (s.latest ? s.latest.agentState : 'complete');
    }
    // The run a "summarise" affordance targets: the most recent terminal run.
    s.summaryRun = s.runs.find(r => TERMINAL.has(r.agentState)) || null;
    sessions.push(s);
  }

  sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return sessions;
}

function passesFilter(session) {
  if (!isVisibleWs(session.workspaceUrlKey)) return false;
  if (scope === 'autopilot' && !session.isAutopilot) return false;
  return true;
}

// ─── Status banner ────────────────────────────────────────────────────────────

function renderBanner(sessions) {
  const line = document.getElementById('dashboard-banner-line');
  const banner = document.getElementById('dashboard-banner');
  if (!line) return;

  let active = 0, done = 0, errors = 0;
  for (const s of sessions) {
    if (!passesFilter(s)) continue;
    if (s.active) active += 1;
    else if (s.state === 'error') errors += 1;
    else done += 1;
  }

  const parts = [];
  parts.push(`<span class="dashboard-stat dashboard-stat-active">◐ ${active} active</span>`);
  parts.push(`<span class="dashboard-stat dashboard-stat-done">✓ ${done} done</span>`);
  if (errors > 0) parts.push(`<span class="dashboard-stat dashboard-stat-error">✕ ${errors} error${errors === 1 ? '' : 's'}</span>`);
  line.innerHTML = parts.join('<span class="dashboard-stat-sep">·</span>');
  if (banner) banner.classList.toggle('has-error', errors > 0);
}

// ─── Session cards ──────────────────────────────────────────────────────────

function sessionSignature(s) {
  return s.state + '|' + s.runs.map(r => `${r.loopId}:${r.agentState}:${(r.feedback || []).length}`).join(',');
}

function fillSessionHead(li, s) {
  const icon = STATE_ICON[s.state] || '○';
  // Meta: run count + the latest meaningful stage. The bare "autopilot" stage is
  // implied by scope/flag, so it is not repeated here.
  const bits = [`${s.runCount} run${s.runCount === 1 ? '' : 's'}`];
  const stage = s.latest && s.latest.stage;
  if (stage && stage !== 'autopilot') bits.push(stage);

  // Flags shown inline with the title — the things you most need to spot.
  let flags = '';
  // The autopilot marker only earns a chip when it isn't already implied (i.e.
  // in the relaxed "All runs" scope); in autopilot-only it would be on every row.
  if (s.isAutopilot && scope === 'all') flags += '<span class="dashboard-flag dashboard-flag-auto">auto</span>';
  if (s.isBug) flags += '<span class="dashboard-flag dashboard-flag-warn">bug</span>';
  if (s.errorCount > 0) flags += '<span class="dashboard-flag dashboard-flag-error">error</span>';

  const title = s.issueTitle || s.issueIdentifier || 'task';
  li.querySelector('.dashboard-session-head').innerHTML = `
    <span class="dashboard-run-icon" data-state="${escapeHtml(s.state)}">${escapeHtml(icon)}</span>
    <span class="dashboard-session-main">
      <span class="dashboard-session-title">
        <span class="dashboard-session-name">${escapeHtml(String(title))}</span>${flags}
      </span>
      <span class="dashboard-session-sub">
        <span class="dashboard-run-ws">${escapeHtml(s.workspaceName)}</span>
        <span class="dashboard-run-id">${escapeHtml(s.issueIdentifier)}</span>
        <span class="dashboard-run-meta">${escapeHtml(bits.join(' · '))}</span>
      </span>
    </span>
    <span class="dashboard-session-time">${escapeHtml(relativeTime(s.lastActivity))}</span>
    <span class="dashboard-session-caret" aria-hidden="true">▸</span>`;
}

function makeSessionCard(s) {
  const li = document.createElement('li');
  li.className = 'dashboard-session';
  li.dataset.key = s.key;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'dashboard-session-head';
  head.setAttribute('aria-expanded', 'false');
  const body = document.createElement('div');
  body.className = 'dashboard-session-body';
  body.hidden = true;
  li.appendChild(head);
  li.appendChild(body);
  head.addEventListener('click', () => toggleSession(s.key));
  return li;
}

function applySessionState(li, s) {
  li.dataset.state = s.state;
  li.dataset.autopilot = s.isAutopilot ? '1' : '0';
  const expanded = expandedSessions.has(s.key);
  const head = li.querySelector('.dashboard-session-head');
  head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  li.classList.toggle('is-open', expanded);
  const body = li.querySelector('.dashboard-session-body');
  body.hidden = !expanded;
  if (expanded && body.dataset.sig !== sessionSignature(s)) {
    renderSessionBody(body, s);
  }
}

function diffSessionList(listId, emptyId, cardMap, sessions) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list) return;

  const nextKeys = new Set(sessions.map(s => s.key));
  for (const [key, el] of cardMap) {
    if (!nextKeys.has(key)) { el.remove(); cardMap.delete(key); }
  }

  for (const s of sessions) {
    let el = cardMap.get(s.key);
    const isNew = !el;
    if (!el) { el = makeSessionCard(s); cardMap.set(s.key, el); }
    fillSessionHead(el, s);
    applySessionState(el, s);
    list.appendChild(el);
    if (isNew && !knownSessions.has(s.key) && !REDUCED_MOTION) {
      el.classList.add('cell-new');
      setTimeout(() => el.classList.remove('cell-new'), 1200);
    }
    knownSessions.add(s.key);
  }

  if (empty) empty.classList.toggle('hidden', sessions.length > 0);
}

function renderFeeds() {
  const sessions = buildSessions().filter(passesFilter);
  const active = sessions.filter(s => s.active);
  const recent = sessions.filter(s => !s.active);
  diffSessionList('dashboard-active', 'dashboard-active-empty', activeCards, active);
  diffSessionList('dashboard-recent', 'dashboard-recent-empty', recentCards, recent);
  renderBanner(buildSessions());
  updateEmptyHint();
}

// When autopilot-only hides everything but there ARE other sessions, nudge the
// user toward the "All runs" scope instead of leaving a bare "nothing" message.
function updateEmptyHint() {
  const all = buildSessions().filter(s => isVisibleWs(s.workspaceUrlKey));
  const shown = all.filter(passesFilter);
  const hint = document.getElementById('dashboard-active-empty');
  if (!hint) return;
  if (scope === 'autopilot' && shown.length === 0 && all.length > 0) {
    hint.textContent = `○ no autopilot sessions — ${all.length} other run${all.length === 1 ? '' : 's'} hidden (try “All runs”)`;
    hint.classList.remove('hidden');
  } else if (shown.filter(s => s.active).length === 0) {
    hint.textContent = '○ nothing running right now';
  }
}

// ─── Session body: summary at top, then the run/event feed ────────────────────

function renderSessionBody(body, s) {
  body.dataset.sig = sessionSignature(s);
  const summaryHtml = `<div class="dashboard-summary-block" data-summary-loop="${escapeHtml(s.summaryRun ? String(s.summaryRun.loopId) : '')}">
      ${renderSummaryInner(s)}
    </div>`;

  const runsHtml = s.runs.map(run => renderEventRow(run)).join('');

  body.innerHTML = `${summaryHtml}
    <p class="dashboard-live" data-hydrate hidden></p>
    <ul class="dashboard-runs">${runsHtml}</ul>`;

  // Wire summary button.
  const btn = body.querySelector('.dashboard-summary-btn');
  if (btn && s.summaryRun) btn.addEventListener('click', () => requestSummary(s.summaryRun, body));

  // Wire event-row expansion.
  body.querySelectorAll('.dashboard-event-head').forEach(head => {
    head.addEventListener('click', () => {
      const row = head.closest('.dashboard-event');
      const id = row?.dataset.loopId;
      if (!id) return;
      if (expandedRuns.has(id)) expandedRuns.delete(id); else expandedRuns.add(id);
      const eb = row.querySelector('.dashboard-event-body');
      const open = expandedRuns.has(id);
      if (eb) eb.hidden = !open;
      row.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Auto-load a cached summary (free) so a re-opened/known run shows it at the top.
  if (s.summaryRun && !summaryState.has(String(s.summaryRun.loopId))) {
    peekSummary(s.summaryRun, body);
  }

  // Best-effort live Linear state/labels for the task (drill-down only, one call).
  hydrateSession(s, body);
}

async function hydrateSession(s, body) {
  const urlKey = dashboardData?.urlKey;
  if (!urlKey || !s.issueIdentifier) return;
  try {
    const res = await fetch(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/hydrate/${encodeURIComponent(s.workspaceUrlKey)}/${encodeURIComponent(s.issueIdentifier)}`
    );
    if (!res.ok) return;
    const data = await res.json();
    const el = body.querySelector('.dashboard-live');
    if (!el || !data.hydrated) return;
    const bits = [];
    if (data.state) bits.push(`live state: ${data.state.name || data.state.type}`);
    if (data.labels && data.labels.length) bits.push(data.labels.join(', '));
    if (!bits.length) return;
    el.textContent = bits.join(' · ');
    el.hidden = false;
  } catch { /* best-effort */ }
}

function renderSummaryInner(s) {
  if (!s.summaryRun) {
    return `<p class="dashboard-summary-pending">○ Summary will be available once a run completes.</p>`;
  }
  const cached = summaryState.get(String(s.summaryRun.loopId));
  if (cached && cached.summary) {
    return renderSummaryMarkup(cached.summary, s.summaryRun);
  }
  return `<div class="dashboard-summary-cta">
      <button type="button" class="action-btn dashboard-summary-btn">summarise this run</button>
      <span class="dashboard-summary-hint">a short overview of iteration #${s.summaryRun.iteration ?? 1}</span>
    </div>`;
}

function renderSummaryMarkup(summary, run) {
  const flags = [];
  if (run && run.agentState === 'error') flags.push('<span class="dashboard-flag dashboard-flag-error">error</span>');
  for (const b of (summary.blockers || [])) flags.push(`<span class="dashboard-flag dashboard-flag-warn">${escapeHtml(b)}</span>`);

  const bullets = (summary.whatHappened || []).map(b => `<li>${escapeHtml(b)}</li>`).join('');
  const next = summary.next ? `<p class="dashboard-summary-next"><span class="dashboard-summary-lbl">next</span> ${escapeHtml(summary.next)}</p>` : '';

  return `<div class="dashboard-summary">
      <div class="dashboard-summary-top">
        <p class="dashboard-summary-outcome">${escapeHtml(summary.outcome || 'No summary.')}</p>
        <button type="button" class="dashboard-summary-refresh dashboard-summary-btn" title="Regenerate">↻</button>
      </div>
      ${flags.length ? `<div class="dashboard-flags">${flags.join('')}</div>` : ''}
      ${bullets ? `<ul class="dashboard-summary-what">${bullets}</ul>` : ''}
      ${next}
    </div>`;
}

function renderEventRow(run) {
  const icon = STATE_ICON[run.agentState] || '○';
  const open = expandedRuns.has(String(run.loopId));
  const label = [run.kind === 'autopilot' ? 'autopilot' : (run.promptName || run.stage || 'run')].filter(Boolean).join(' ');
  const feedback = Array.isArray(run.feedback) ? run.feedback : [];
  const fbHtml = feedback.length
    ? `<ul class="dashboard-fb">${feedback.map(fb => {
        const msg = typeof fb === 'string' ? fb : (fb?.message || '');
        return `<li>${escapeHtml(String(msg))}</li>`;
      }).join('')}</ul>`
    : '<p class="dashboard-dim">No feedback recorded.</p>';

  return `<li class="dashboard-event${open ? ' is-open' : ''}" data-loop-id="${escapeHtml(String(run.loopId))}" data-state="${escapeHtml(run.agentState || '')}">
      <button type="button" class="dashboard-event-head" aria-expanded="${open ? 'true' : 'false'}">
        <span class="dashboard-run-icon" data-state="${escapeHtml(run.agentState || '')}">${escapeHtml(icon)}</span>
        <span class="dashboard-event-label">#${run.iteration ?? 1} · ${escapeHtml(label)}</span>
        <span class="dashboard-event-time">${escapeHtml(relativeTime(activityValue(run)))}</span>
      </button>
      <div class="dashboard-event-body" ${open ? '' : 'hidden'}>
        ${run.foremanSummary ? `<div class="dashboard-block"><h4>Agent summary</h4><p>${escapeHtml(String(run.foremanSummary))}</p></div>` : ''}
        <div class="dashboard-block"><h4>Feedback</h4>${fbHtml}</div>
        ${run.issueUrl ? `<a class="dashboard-event-link" href="${escapeHtml(run.issueUrl)}" target="_blank" rel="noopener">open in Linear ↗</a>` : ''}
      </div>
    </li>`;
}

function toggleSession(key) {
  if (expandedSessions.has(key)) expandedSessions.delete(key);
  else expandedSessions.add(key);
  // Re-apply state to the affected card only (both feeds may hold it).
  const el = activeCards.get(key) || recentCards.get(key);
  const sessions = buildSessions();
  const s = sessions.find(x => x.key === key);
  if (el && s) applySessionState(el, s);
}

// ─── Run summary (peek cached, then generate on demand) ───────────────────────

async function peekSummary(run, body) {
  const urlKey = dashboardData?.urlKey;
  if (!urlKey) return;
  try {
    const res = await fetch(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/run-summary/${encodeURIComponent(run.loopId)}?cachedOnly=1`
    );
    if (res.status !== 200) return; // 204 = not cached → leave the button
    const data = await res.json();
    if (data && data.summary) {
      summaryState.set(String(run.loopId), { status: 'cached', summary: data.summary });
      repaintSummary(run, body);
    }
  } catch { /* best-effort */ }
}

async function requestSummary(run, body) {
  const urlKey = dashboardData?.urlKey;
  const block = body.querySelector('.dashboard-summary-block');
  if (!urlKey || !block) return;
  block.innerHTML = '<p class="dashboard-summary-pending">summarising…</p>';
  try {
    const data = await window.api(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/run-summary/${encodeURIComponent(run.loopId)}`,
      { method: 'POST', on401: false }
    );
    summaryState.set(String(run.loopId), { status: 'fresh', summary: data.summary });
    repaintSummary(run, body);
  } catch (e) {
    block.innerHTML = `<p class="dashboard-error">${escapeHtml((e.body && e.body.error) || 'Could not generate a summary.')}</p>
      <button type="button" class="action-btn dashboard-summary-btn">try again</button>`;
    const retry = block.querySelector('.dashboard-summary-btn');
    if (retry) retry.addEventListener('click', () => requestSummary(run, body));
  }
}

function repaintSummary(run, body) {
  const block = body.querySelector('.dashboard-summary-block');
  if (!block) return;
  block.innerHTML = renderSummaryMarkup(summaryState.get(String(run.loopId)).summary, run);
  const refresh = block.querySelector('.dashboard-summary-btn');
  if (refresh) refresh.addEventListener('click', () => requestSummary(run, body));
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollLoops() {
  const urlKey = dashboardData?.urlKey;
  if (!urlKey) return;
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/loops`);
    if (res.status === 401) { window.location.href = '/logout'; return; }
    if (!res.ok) { setPollStatus('● disconnected'); return; }

    const data = await res.json();
    const active = Array.isArray(data.active) ? data.active : [];
    const recent = Array.isArray(data.recent) ? data.recent : [];

    runIndex.clear();
    for (const run of [...active, ...recent]) runIndex.set(String(run.loopId), run);

    renderFeeds();
    setPollStatus('● live');
  } catch (e) {
    setPollStatus('● disconnected');
    console.warn('Dashboard poll failed:', e);
  }
}

function startPolling() {
  if (pollId) clearInterval(pollId);
  pollLoops();
  pollId = setInterval(() => { if (!document.hidden) pollLoops(); }, POLL_MS);
  if (!visibilityHandler) {
    visibilityHandler = () => { if (!document.hidden) pollLoops(); };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

// ─── Filter controls ──────────────────────────────────────────────────────────

function initControls() {
  const chips = document.getElementById('dashboard-chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.dashboard-chip');
      if (!chip || !chip.dataset.ws) return;
      const ws = chip.dataset.ws;
      if (hiddenWorkspaces.has(ws)) { hiddenWorkspaces.delete(ws); chip.classList.add('is-on'); }
      else { hiddenWorkspaces.add(ws); chip.classList.remove('is-on'); }
      renderFeeds();
    });
  }

  const scopeEl = document.getElementById('dashboard-scope');
  if (scopeEl) {
    scopeEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.dashboard-scope-btn');
      if (!btn || !btn.dataset.scope) return;
      scope = btn.dataset.scope;
      scopeEl.querySelectorAll('.dashboard-scope-btn').forEach(b => {
        const on = b.dataset.scope === scope;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderFeeds();
    });
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

function init() {
  dashboardData = window.__DASHBOARD_DATA__;
  if (!dashboardData) { console.warn('Dashboard: no initial data'); return; }
  initControls();
  startPolling();
}

window.addEventListener('beforeunload', () => {
  if (pollId) { clearInterval(pollId); pollId = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
});

document.addEventListener('DOMContentLoaded', init);
