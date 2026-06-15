/**
 * Dashboard Page Client-Side Logic (LIN-509).
 *
 * - Hydrates config from window.__DASHBOARD_DATA__
 * - Live feed: visibility-gated 5s poll of /api/dashboard/loops (Mongo-only, merged
 *   across workspaces), rendered with a keyed DOM-diff + `cell-new` animation
 *   (honouring prefers-reduced-motion), copied from the pipeline poll pattern.
 * - Workspace filter chips: pure client-side filter over already-merged data.
 * - Drill-down overlay: run detail (prompt/stage/agent summary/feedback/iteration
 *   history) from the polled feed; lazy Linear hydration of live state/labels.
 * - On-demand run summary: a button (terminal runs only) that GET/POSTs the cached
 *   /api/dashboard/run-summary/:loopId endpoint.
 *
 * Loaded only on the /dashboard page. Requires common.js (escapeHtml, window.api).
 */

let dashboardData = null;
let pollId = null;
let visibilityHandler = null;

const POLL_MS = 5000;
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Workspaces currently hidden by filter chips (urlKey set).
const hiddenWorkspaces = new Set();
// Keyed maps of rendered feed rows: loopId → element.
const activeCells = new Map();
const recentCells = new Map();
// Latest merged runs by loopId, so the overlay can read full detail without refetch.
const runIndex = new Map();
// The run currently open in the overlay (loopId), so polling doesn't clobber it.
let openLoopId = null;

const TERMINAL = new Set(['complete', 'error']);
const STATE_ICON = { complete: '✓', error: '✕', running: '◐', waiting: '◌', queued: '○' };

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

function setPollStatus(text) {
  const el = document.getElementById('dashboard-poll-status');
  if (el) el.textContent = text || '';
}

function activityValue(run) {
  return run.foremanTimestamp || run.resolvedAt || run.dispatchedAt || '';
}

function isVisible(run) {
  return !hiddenWorkspaces.has(run.workspaceUrlKey);
}

// ─── Feed rows ────────────────────────────────────────────────────────────────

function renderRow(run) {
  const li = document.createElement('li');
  li.className = 'dashboard-run';
  li.dataset.loopId = run.loopId;
  li.dataset.workspace = run.workspaceUrlKey || '';
  if (run.agentState) li.dataset.agentState = run.agentState;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  fillRow(li, run);
  li.addEventListener('click', () => openOverlay(run.loopId));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOverlay(run.loopId); }
  });
  return li;
}

function fillRow(li, run) {
  if (run.agentState) li.dataset.agentState = run.agentState;
  const icon = STATE_ICON[run.agentState] || '○';
  const title = run.issueTitle || run.issueIdentifier || 'run';
  const meta = [run.promptName || run.stage, `#${run.iteration ?? 1}`].filter(Boolean).join(' · ');
  li.innerHTML = `
    <span class="dashboard-run-icon" data-state="${escapeHtml(run.agentState || '')}">${escapeHtml(icon)}</span>
    <span class="dashboard-run-main">
      <span class="dashboard-run-title">${escapeHtml(String(title))}</span>
      <span class="dashboard-run-sub">
        <span class="dashboard-run-ws">${escapeHtml(run.workspaceName || run.workspaceUrlKey || '')}</span>
        <span class="dashboard-run-id">${escapeHtml(run.issueIdentifier || '')}</span>
        <span class="dashboard-run-meta">${escapeHtml(meta)}</span>
      </span>
    </span>
    <span class="dashboard-run-time">${escapeHtml(relativeTime(activityValue(run)))}</span>`;
}

/**
 * Keyed diff of one feed list. Adds/updates/removes rows by loopId, animating
 * genuinely new rows (unless reduced-motion). Respects the workspace filter.
 */
function diffFeed(listId, emptyId, cellMap, runs) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list) return;

  const visible = runs.filter(isVisible);
  const nextIds = new Set(visible.map(r => String(r.loopId)));

  for (const [id, el] of cellMap) {
    if (!nextIds.has(id)) { el.remove(); cellMap.delete(id); }
  }

  // Render in order; re-append to keep DOM order matching sort order.
  for (const run of visible) {
    const id = String(run.loopId);
    let el = cellMap.get(id);
    if (el) {
      fillRow(el, run);
    } else {
      el = renderRow(run);
      cellMap.set(id, el);
      if (!REDUCED_MOTION) {
        el.classList.add('cell-new');
        setTimeout(() => el.classList.remove('cell-new'), 1500);
      }
    }
    list.appendChild(el);
  }

  if (empty) empty.classList.toggle('hidden', visible.length > 0);
}

function renderFeeds(active, recent) {
  diffFeed('dashboard-active', 'dashboard-active-empty', activeCells, active);
  diffFeed('dashboard-recent', 'dashboard-recent-empty', recentCells, recent);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollLoops() {
  const urlKey = dashboardData?.urlKey;
  if (!urlKey) return;

  try {
    // Raw fetch carve-out: background poller with a bespoke status line; a transient
    // failure should degrade the status, not throw the page (matches collective.js).
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/loops`);
    if (res.status === 401) { window.location.href = '/logout'; return; }
    if (!res.ok) { setPollStatus('● disconnected'); return; }

    const data = await res.json();
    const active = Array.isArray(data.active) ? data.active : [];
    const recent = Array.isArray(data.recent) ? data.recent : [];

    runIndex.clear();
    for (const run of [...active, ...recent]) runIndex.set(String(run.loopId), run);

    renderFeeds(active, recent);
    // Keep an open overlay fresh without closing it.
    if (openLoopId && runIndex.has(openLoopId)) refreshOverlay(runIndex.get(openLoopId));

    setPollStatus(`● live · ${active.length} active`);
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

// ─── Workspace filter chips ───────────────────────────────────────────────────

function initChips() {
  const wrap = document.getElementById('dashboard-chips');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.dashboard-chip');
    if (!chip) return;
    const ws = chip.dataset.ws;
    if (!ws) return;
    if (hiddenWorkspaces.has(ws)) { hiddenWorkspaces.delete(ws); chip.classList.add('is-on'); }
    else { hiddenWorkspaces.add(ws); chip.classList.remove('is-on'); }
    // Re-filter from the indexed runs (no refetch).
    const all = Array.from(runIndex.values());
    renderFeeds(all.filter(r => !TERMINAL.has(r.agentState)), all.filter(r => TERMINAL.has(r.agentState)));
  });
}

// ─── Drill-down overlay ───────────────────────────────────────────────────────

function openOverlay(loopId) {
  const run = runIndex.get(String(loopId));
  if (!run) return;
  openLoopId = String(loopId);
  const overlay = document.getElementById('dashboard-overlay');
  if (overlay) overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  refreshOverlay(run);
  hydrateIssue(run);
}

function closeOverlay() {
  openLoopId = null;
  const overlay = document.getElementById('dashboard-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('overlay-open');
}

function refreshOverlay(run) {
  const title = document.getElementById('dashboard-overlay-title');
  const body = document.getElementById('dashboard-overlay-body');
  if (!body) return;
  if (title) title.textContent = `${run.issueIdentifier || 'run'} — iteration ${run.iteration ?? 1}`;

  const terminal = TERMINAL.has(run.agentState);
  const feedback = Array.isArray(run.feedback) ? run.feedback : [];
  const fbHtml = feedback.length
    ? `<ul class="dashboard-fb">${feedback.map(fb => {
        const msg = typeof fb === 'string' ? fb : (fb?.message || '');
        return `<li>${escapeHtml(String(msg))}</li>`;
      }).join('')}</ul>`
    : '<p class="dashboard-dim">No feedback recorded.</p>';

  body.innerHTML = `
    <dl class="dashboard-detail">
      <div><dt>workspace</dt><dd>${escapeHtml(run.workspaceName || run.workspaceUrlKey || '')}</dd></div>
      <div><dt>task</dt><dd>${escapeHtml(run.issueTitle || '')} ${run.issueUrl ? `<a href="${escapeHtml(run.issueUrl)}" target="_blank" rel="noopener">↗</a>` : ''}</dd></div>
      <div><dt>state</dt><dd data-hydrate="state">${escapeHtml(run.agentState || '')}</dd></div>
      <div><dt>labels</dt><dd data-hydrate="labels" class="dashboard-dim">…</dd></div>
      <div><dt>prompt</dt><dd>${escapeHtml(run.promptName || '—')}${run.stage ? ` · ${escapeHtml(run.stage)}` : ''}</dd></div>
      <div><dt>dispatched</dt><dd>${escapeHtml(relativeTime(run.dispatchedAt))}</dd></div>
    </dl>

    ${run.foremanSummary ? `<div class="dashboard-block"><h3>Agent summary</h3><p>${escapeHtml(String(run.foremanSummary))}</p></div>` : ''}

    <div class="dashboard-block">
      <h3>Feedback</h3>
      ${fbHtml}
    </div>

    <div class="dashboard-block dashboard-summary-block">
      <div class="dashboard-summary-head">
        <h3>Run summary</h3>
        <button type="button" class="action-btn" id="dashboard-summary-btn" ${terminal ? '' : 'disabled title="Available once the run completes"'}>summarise</button>
      </div>
      <div class="dashboard-summary-out" id="dashboard-summary-out">${terminal ? '<p class="dashboard-dim">Click summarise for a short overview.</p>' : '<p class="dashboard-dim">Run is still active.</p>'}</div>
    </div>`;

  const btn = document.getElementById('dashboard-summary-btn');
  if (btn && terminal) btn.addEventListener('click', () => requestSummary(run, btn));
}

async function hydrateIssue(run) {
  const urlKey = dashboardData?.urlKey;
  if (!urlKey || !run.issueIdentifier) return;
  try {
    const data = await window.api(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/hydrate/${encodeURIComponent(run.workspaceUrlKey)}/${encodeURIComponent(run.issueIdentifier)}`,
      { on401: false }
    );
    if (openLoopId !== String(run.loopId)) return; // overlay moved on
    const stateEl = document.querySelector('#dashboard-overlay-body [data-hydrate="state"]');
    const labelsEl = document.querySelector('#dashboard-overlay-body [data-hydrate="labels"]');
    if (data.hydrated) {
      if (stateEl && data.state) stateEl.textContent = data.state.name || data.state.type || run.agentState || '';
      if (labelsEl) {
        labelsEl.classList.remove('dashboard-dim');
        labelsEl.textContent = (data.labels && data.labels.length) ? data.labels.join(', ') : '—';
      }
    } else if (labelsEl) {
      labelsEl.textContent = '(live data unavailable)';
    }
  } catch {
    const labelsEl = document.querySelector('#dashboard-overlay-body [data-hydrate="labels"]');
    if (labelsEl) labelsEl.textContent = '(live data unavailable)';
  }
}

async function requestSummary(run, btn) {
  const urlKey = dashboardData?.urlKey;
  const out = document.getElementById('dashboard-summary-out');
  if (!urlKey || !out) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'summarising…';
  out.innerHTML = '<p class="dashboard-dim">Working…</p>';
  try {
    const data = await window.api(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/run-summary/${encodeURIComponent(run.loopId)}`,
      { method: 'POST', on401: false }
    );
    renderSummary(out, data.summary);
  } catch (e) {
    out.innerHTML = `<p class="dashboard-error">${escapeHtml((e.body && e.body.error) || 'Could not generate a summary.')}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderSummary(out, summary) {
  if (!summary) { out.innerHTML = '<p class="dashboard-dim">No summary.</p>'; return; }
  const bullets = (summary.whatHappened || []).map(b => `<li>${escapeHtml(b)}</li>`).join('');
  const blockers = (summary.blockers || []).length
    ? `<div class="dashboard-summary-sec"><span class="dashboard-summary-lbl">blockers</span><ul>${summary.blockers.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>`
    : '';
  const next = summary.next
    ? `<div class="dashboard-summary-sec"><span class="dashboard-summary-lbl">next</span><p>${escapeHtml(summary.next)}</p></div>`
    : '';
  out.innerHTML = `
    <p class="dashboard-summary-outcome">${escapeHtml(summary.outcome || '')}</p>
    ${bullets ? `<ul class="dashboard-summary-what">${bullets}</ul>` : ''}
    ${blockers}
    ${next}`;
}

// ─── Initialization ───────────────────────────────────────────────────────────

function init() {
  dashboardData = window.__DASHBOARD_DATA__;
  if (!dashboardData) { console.warn('Dashboard: no initial data'); return; }

  initChips();
  document.getElementById('dashboard-overlay-close')?.addEventListener('click', closeOverlay);
  document.getElementById('dashboard-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'dashboard-overlay') closeOverlay();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openLoopId) closeOverlay(); });

  startPolling();
}

window.addEventListener('beforeunload', () => {
  if (pollId) { clearInterval(pollId); pollId = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
});

document.addEventListener('DOMContentLoaded', init);
