/**
 * Observation Page Client-Side Logic (LIN-595).
 *
 * The first-class autopilot Observation page. The poll source is the Mongo-only
 * sessionId-grouped feed (/api/dashboard/sessions) — the LIN-591 session spine, a
 * seed/epic with its descended + spun-off tasks — NOT the older per-task issue
 * grouping. Everything below is presentation:
 *
 * - Status banner: one at-a-glance line (active / done / errors), refreshed each poll.
 * - Level 1: a feed of ACTIVE sessions; a collapsible ARCHIVE of completed sessions
 *   (with a count) below. Both sorted by most-recent activity (server-sorted).
 * - Level 2 session card (collapsed): status pill, run id + seed task title, the
 *   one-sentence summary (LIN-592), runtime + model (LIN-594), and a per-worker-run
 *   progress bar (the live segment pulses). Expanding shows a status line + the run
 *   list (Level 3 worker-tree drill-down is a later session).
 * - Workspace chips: pure client-side filter over already-merged data (no refetch).
 *
 * Cost contract (LIN-595): the poll never spends an LLM call. Session summaries are
 * fetched lazily, once per session, and never auto-generated for a terminal session
 * (we peek `?cachedOnly=1`); a live session's status line is the endpoint's cheap,
 * generation-free proxy. Generation only happens on an explicit button.
 *
 * Loaded only on the /observation page. Requires common.js (escapeHtml, window.api,
 * relativeTime).
 */

let observationData = null;
let pollId = null;
let visibilityHandler = null;

const POLL_MS = 5000;
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Filter state.
const hiddenWorkspaces = new Set();        // urlKeys toggled off
let archiveOpen = false;

// Live data + view state preserved across polls.
const sessionIndex = new Map();            // sessionId → session payload
const activeCards = new Map();             // sessionId → <li>
const recentCards = new Map();             // sessionId → <li>
const expandedSessions = new Set();        // sessionId
const summaryState = new Map();            // sessionId → { live, outcome, statusLine, pending }
const summaryFetched = new Set();          // sessionId already peeked/fetched this session sig
const knownSessions = new Set();           // sessionId (for new-row animation)

const STATUS_ICON = { 'in-progress': '◐', done: '✓', error: '✕' };
const STATE_ICON = { complete: '✓', error: '✕', running: '◐', waiting: '◌', queued: '○' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setPollStatus(text) {
  const el = document.getElementById('obs-poll-status');
  if (el) el.textContent = text || '';
}

function isVisibleWs(urlKey) {
  return !hiddenWorkspaces.has(urlKey);
}

function passesFilter(session) {
  return isVisibleWs(session.workspaceUrlKey);
}

function shortSessionId(id) {
  const s = String(id || '');
  return s.length > 8 ? s.slice(0, 8) : s;
}

function formatRuntime(runtime) {
  const ms = runtime && typeof runtime.ms === 'number' ? runtime.ms : null;
  if (ms == null || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

// A signature that changes when anything the card displays changes — drives
// minimal re-render and gates the one-time summary fetch.
function sessionSignature(s) {
  return [s.status, s.runCount, s.lastActivity,
    s.runs.map(r => `${r.loopId}:${r.agentState}`).join(',')].join('|');
}

// ─── Status banner ────────────────────────────────────────────────────────────

function renderBanner() {
  const line = document.getElementById('obs-banner-line');
  const banner = document.getElementById('obs-banner');
  if (!line) return;

  let active = 0, done = 0, errors = 0;
  for (const s of sessionIndex.values()) {
    if (!passesFilter(s)) continue;
    if (!s.terminal) active += 1;
    else if (s.status === 'error') errors += 1;
    else done += 1;
  }

  const parts = [];
  parts.push(`<span class="obs-stat obs-stat-active">◐ ${active} active</span>`);
  parts.push(`<span class="obs-stat obs-stat-done">✓ ${done} done</span>`);
  if (errors > 0) parts.push(`<span class="obs-stat obs-stat-error">✕ ${errors} error${errors === 1 ? '' : 's'}</span>`);
  line.innerHTML = parts.join('<span class="obs-stat-sep">·</span>');
  if (banner) banner.classList.toggle('has-error', errors > 0);
}

// ─── Session cards (Level 2) ──────────────────────────────────────────────────

function renderProgressBar(s) {
  if (!s.runs.length) {
    return `<div class="obs-progress obs-progress-empty" aria-label="no worker runs yet"></div>`;
  }
  const segs = s.runs.map(r => {
    const live = r.agentState === 'running' || r.agentState === 'waiting' || r.agentState === 'queued';
    const title = `${r.issueIdentifier || 'run'}${r.stage ? ' · ' + r.stage : ''} — ${r.agentState}`;
    return `<span class="obs-seg" data-state="${escapeHtml(r.agentState || '')}"${live ? ' data-live="1"' : ''} title="${escapeHtml(title)}"></span>`;
  }).join('');
  return `<div class="obs-progress" aria-label="${s.runCount} worker run${s.runCount === 1 ? '' : 's'}">${segs}</div>`;
}

function renderSummaryLine(s) {
  const st = summaryState.get(s.sessionId);
  if (st && st.pending) return `<span class="obs-summary-line obs-summary-pending">summarising…</span>`;
  if (st && st.outcome) return `<span class="obs-summary-line">${escapeHtml(st.outcome)}</span>`;
  if (st && st.statusLine) return `<span class="obs-summary-line obs-summary-status">${escapeHtml(st.statusLine)}</span>`;
  if (!s.terminal) return `<span class="obs-summary-line obs-summary-dim">◐ working…</span>`;
  // Terminal but no cached summary → offer to generate (explicit spend only).
  return `<button type="button" class="obs-summary-gen" data-session="${escapeHtml(s.sessionId)}">summarise this session</button>`;
}

function fillSessionHead(li, s) {
  const icon = STATUS_ICON[s.status] || '○';
  const title = s.seedTitle || s.seedIssue || 'autopilot session';
  const runtime = formatRuntime(s.runtime);

  const metaBits = [`run ${escapeHtml(shortSessionId(s.sessionId))}`];
  if (s.tasksTouched.length > 1) metaBits.push(`${s.tasksTouched.length} tasks`);
  if (runtime) metaBits.push(escapeHtml(runtime));
  if (s.model) metaBits.push(escapeHtml(String(s.model)));

  li.querySelector('.obs-session-head').innerHTML = `
    <span class="obs-pill" data-status="${escapeHtml(s.status)}">${escapeHtml(icon)}</span>
    <span class="obs-session-main">
      <span class="obs-session-title">
        <span class="obs-session-name">${escapeHtml(String(title))}</span>
        ${s.seedIssue ? `<span class="obs-session-seed">${escapeHtml(s.seedIssue)}</span>` : ''}
      </span>
      <span class="obs-session-summary">${renderSummaryLine(s)}</span>
      ${renderProgressBar(s)}
      <span class="obs-session-sub">
        <span class="obs-session-ws">${escapeHtml(s.workspaceName)}</span>
        <span class="obs-session-meta">${metaBits.join(' · ')}</span>
      </span>
    </span>
    <span class="obs-session-time">${escapeHtml(relativeTime(s.lastActivity))}</span>
    <span class="obs-session-caret" aria-hidden="true">▸</span>`;
}

function makeSessionCard(s) {
  const li = document.createElement('li');
  li.className = 'obs-session';
  li.dataset.session = s.sessionId;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'obs-session-head';
  head.setAttribute('aria-expanded', 'false');
  const body = document.createElement('div');
  body.className = 'obs-session-body';
  body.hidden = true;
  li.appendChild(head);
  li.appendChild(body);
  head.addEventListener('click', (e) => {
    // Let the inline "summarise" button act without toggling the card.
    if (e.target.closest('.obs-summary-gen')) return;
    toggleSession(s.sessionId);
  });
  return li;
}

function applySessionState(li, s) {
  li.dataset.status = s.status;
  const expanded = expandedSessions.has(s.sessionId);
  const head = li.querySelector('.obs-session-head');
  head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  li.classList.toggle('is-open', expanded);
  const body = li.querySelector('.obs-session-body');
  body.hidden = !expanded;
  if (expanded && body.dataset.sig !== sessionSignature(s)) {
    renderSessionBody(body, s);
  }
}

function diffSessionList(listId, emptyId, cardMap, sessions) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list) return;

  const nextKeys = new Set(sessions.map(s => s.sessionId));
  for (const [key, el] of cardMap) {
    if (!nextKeys.has(key)) { el.remove(); cardMap.delete(key); }
  }

  for (const s of sessions) {
    let el = cardMap.get(s.sessionId);
    const isNew = !el;
    if (!el) { el = makeSessionCard(s); cardMap.set(s.sessionId, el); }
    fillSessionHead(el, s);
    wireSummaryGen(el, s);
    applySessionState(el, s);
    list.appendChild(el);
    if (isNew && !knownSessions.has(s.sessionId) && !REDUCED_MOTION) {
      el.classList.add('cell-new');
      setTimeout(() => el.classList.remove('cell-new'), 1200);
    }
    knownSessions.add(s.sessionId);
    maybeFetchSummary(s);
  }

  if (empty) empty.classList.toggle('hidden', sessions.length > 0);
}

function renderFeeds() {
  const sessions = [...sessionIndex.values()].filter(passesFilter);
  const active = sessions.filter(s => !s.terminal);
  const recent = sessions.filter(s => s.terminal);
  diffSessionList('obs-active', 'obs-active-empty', activeCards, active);
  diffSessionList('obs-recent', 'obs-recent-empty', recentCards, recent);

  const count = document.getElementById('obs-archive-count');
  if (count) count.textContent = String(recent.length);
  renderBanner();
}

// ─── Session body (expanded) ──────────────────────────────────────────────────

function renderSessionBody(body, s) {
  body.dataset.sig = sessionSignature(s);
  const st = summaryState.get(s.sessionId);
  const statusLine = st && (st.statusLine || st.outcome);
  const tasksHtml = s.tasksTouched.length
    ? `<p class="obs-body-tasks"><span class="obs-body-lbl">tasks</span> ${s.tasksTouched.map(t => escapeHtml(t)).join(' · ')}</p>`
    : '';

  const runsHtml = s.runs.length
    ? `<ul class="obs-runs">${s.runs.map(renderRunRow).join('')}</ul>`
    : `<p class="obs-dim">No worker runs recorded yet.</p>`;

  body.innerHTML = `
    ${statusLine ? `<p class="obs-body-status"><span class="obs-body-lbl">status</span> ${escapeHtml(statusLine)}</p>` : ''}
    ${tasksHtml}
    ${runsHtml}`;
}

function renderRunRow(run) {
  const icon = STATE_ICON[run.agentState] || '○';
  const label = run.kind === 'autopilot' ? 'autopilot' : (run.promptName || run.stage || 'run');
  return `<li class="obs-run" data-state="${escapeHtml(run.agentState || '')}">
      <span class="obs-run-icon" data-state="${escapeHtml(run.agentState || '')}">${escapeHtml(icon)}</span>
      <span class="obs-run-label">${run.iteration != null ? '#' + run.iteration + ' · ' : ''}${escapeHtml(label)}</span>
      <span class="obs-run-id">${escapeHtml(run.issueIdentifier || '')}</span>
    </li>`;
}

function toggleSession(sessionId) {
  if (expandedSessions.has(sessionId)) expandedSessions.delete(sessionId);
  else expandedSessions.add(sessionId);
  const el = activeCards.get(sessionId) || recentCards.get(sessionId);
  const s = sessionIndex.get(sessionId);
  if (el && s) applySessionState(el, s);
}

// ─── Session summary (lazy, cost-aware) ───────────────────────────────────────

// Fetch a session's one-sentence summary once per session signature. Live
// sessions get the endpoint's free status-line proxy; terminal sessions are only
// PEEKED (?cachedOnly=1) so a poll never auto-spends an LLM call.
async function maybeFetchSummary(s) {
  const sig = s.sessionId + '|' + sessionSignature(s);
  if (summaryFetched.has(sig)) return;
  summaryFetched.add(sig);

  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  const base = `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/session-summary/${encodeURIComponent(s.sessionId)}`;
  const url = s.terminal ? `${base}?cachedOnly=1` : base;
  try {
    const res = await fetch(url);
    if (res.status !== 200) return; // 204 = terminal but uncached → leave the affordance
    const data = await res.json();
    storeSummary(s.sessionId, data);
    repaintSession(s.sessionId);
  } catch { /* best-effort */ }
}

function storeSummary(sessionId, data) {
  const summary = data && data.summary ? data.summary : {};
  summaryState.set(sessionId, {
    live: !!data.live,
    outcome: summary.outcome || '',
    statusLine: summary.statusLine || '',
    pending: false
  });
}

function wireSummaryGen(li, s) {
  const btn = li.querySelector('.obs-summary-gen');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); generateSummary(s.sessionId); });
}

async function generateSummary(sessionId) {
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  summaryState.set(sessionId, { pending: true, outcome: '', statusLine: '', live: false });
  repaintSession(sessionId);
  try {
    const data = await window.api(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/session-summary/${encodeURIComponent(sessionId)}`,
      { method: 'POST', on401: false }
    );
    storeSummary(sessionId, data);
  } catch {
    summaryState.delete(sessionId);
    summaryFetched.delete(sessionId + '|' + (sessionIndex.get(sessionId) ? sessionSignature(sessionIndex.get(sessionId)) : ''));
  }
  repaintSession(sessionId);
}

// Re-render just the head (and body if open) of one session after its summary
// state changes, without waiting for the next poll.
function repaintSession(sessionId) {
  const s = sessionIndex.get(sessionId);
  const el = activeCards.get(sessionId) || recentCards.get(sessionId);
  if (!s || !el) return;
  fillSessionHead(el, s);
  wireSummaryGen(el, s);
  const body = el.querySelector('.obs-session-body');
  if (body && !body.hidden) renderSessionBody(body, s);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollSessions() {
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/sessions`);
    if (res.status === 401) { window.location.href = '/logout'; return; }
    if (!res.ok) { setPollStatus('● disconnected'); return; }

    const data = await res.json();
    const active = Array.isArray(data.active) ? data.active : [];
    const recent = Array.isArray(data.recent) ? data.recent : [];

    sessionIndex.clear();
    for (const s of [...active, ...recent]) sessionIndex.set(String(s.sessionId), s);

    renderFeeds();
    setPollStatus('● live');
  } catch (e) {
    setPollStatus('● disconnected');
    console.warn('Observation poll failed:', e);
  }
}

function startPolling() {
  if (pollId) clearInterval(pollId);
  pollSessions();
  pollId = setInterval(() => { if (!document.hidden) pollSessions(); }, POLL_MS);
  if (!visibilityHandler) {
    visibilityHandler = () => { if (!document.hidden) pollSessions(); };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

// ─── Controls ──────────────────────────────────────────────────────────────────

function initControls() {
  const chips = document.getElementById('obs-chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.obs-chip');
      if (!chip || !chip.dataset.ws) return;
      const ws = chip.dataset.ws;
      if (hiddenWorkspaces.has(ws)) { hiddenWorkspaces.delete(ws); chip.classList.add('is-on'); }
      else { hiddenWorkspaces.add(ws); chip.classList.remove('is-on'); }
      renderFeeds();
    });
  }

  const toggle = document.getElementById('obs-archive-toggle');
  const archiveBody = document.getElementById('obs-archive-body');
  if (toggle && archiveBody) {
    toggle.addEventListener('click', () => {
      archiveOpen = !archiveOpen;
      toggle.setAttribute('aria-expanded', archiveOpen ? 'true' : 'false');
      toggle.classList.toggle('is-open', archiveOpen);
      archiveBody.hidden = !archiveOpen;
    });
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

function init() {
  observationData = window.__OBSERVATION_DATA__;
  if (!observationData) { console.warn('Observation: no initial data'); return; }
  initControls();
  startPolling();
}

window.addEventListener('beforeunload', () => {
  if (pollId) { clearInterval(pollId); pollId = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
});

document.addEventListener('DOMContentLoaded', init);
