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
 *   progress bar (the live segment pulses). Expanding shows a status line + the
 *   Level-3 body.
 * - Level 3 body (drill-down): the tasks the session touched, each with its
 *   relationship neighborhood (session-context, LIN-593) and best-effort live
 *   Linear state (lazy hydration); under each task its worker-session tree, where
 *   a node shows phase / recap / metric chips and expands to the activity log,
 *   produced-artifact links, and next steps (run-summary + telemetry, LIN-594).
 * - Workspace chips: pure client-side filter over already-merged data (no refetch).
 *
 * Cost contract (LIN-595): the poll never spends an LLM call. Session AND per-run
 * summaries are fetched lazily, once each, and never auto-generated (we peek
 * `?cachedOnly=1`); a live session's status line is the endpoint's cheap,
 * generation-free proxy. LLM generation happens only on an explicit button. Linear
 * hydration and the relationship graph are drill-down-only — never on the feed poll.
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

// ─── Level-3 drill-down state (LIN-595 Session B) ───────────────────────────────
// All lazy and drill-down-only: nothing here is fetched until a session is opened.
const contextState = new Map();            // sessionId → { pending, graph, error }
const contextFetched = new Set();          // sessionId (context fetched once per drill-in)
const hydrationState = new Map();          // `${wsUrlKey}::${identifier}` → { state, labels, url, hydrated }
const hydrationFetched = new Set();        // `${wsUrlKey}::${identifier}` (one Linear hit per task per drill-in)
const runSummaryState = new Map();         // loopId → { pending, outcome, next, error }
const runSummaryFetched = new Set();       // loopId (peeked once per run signature)
const expandedRuns = new Set();            // loopId (worker-node drill-down)

const PROVENANCE_LABEL = { seed: 'seed', descended: 'descended', 'spun-off': 'spun-off' };

const STATUS_ICON = { 'in-progress': '◐', done: '✓', error: '✕', stale: '○' };
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
  // Staleness takes precedence over the "live" status line so a day-dead session is
  // not shown as a live one (Bug 3, LIN-608).
  if (s.stale) return `<span class="obs-summary-line obs-summary-dim">○ idle — no activity for over a day</span>`;
  if (st && st.statusLine) return `<span class="obs-summary-line obs-summary-status">${escapeHtml(st.statusLine)}</span>`;
  // Live status line served on the feed itself (no per-poll backend fetch).
  if (s.statusLine) return `<span class="obs-summary-line obs-summary-status">${escapeHtml(s.statusLine)}</span>`;
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
  // Delegated Level-3 interactions inside the body (re-rendered on every poll, so
  // per-node listeners would leak — delegate once on the stable body element).
  body.addEventListener('click', (e) => {
    const gen = e.target.closest('.obs-run-gen');
    if (gen) { e.stopPropagation(); generateRunSummary(s.sessionId, gen.dataset.loop); return; }
    const workerHead = e.target.closest('.obs-worker-head');
    if (workerHead) { toggleRun(s.sessionId, workerHead.dataset.loop); }
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
  // Stale sessions (derived server-side, >24h idle) drop out of Active into the
  // completed archive (Bug 3, LIN-608) — they are no longer "live".
  const active = sessions.filter(s => !s.terminal && !s.stale);
  const recent = sessions.filter(s => s.terminal || s.stale);
  diffSessionList('obs-active', 'obs-active-empty', activeCards, active);
  diffSessionList('obs-recent', 'obs-recent-empty', recentCards, recent);

  const count = document.getElementById('obs-archive-count');
  if (count) count.textContent = String(recent.length);
}

// ─── Session body (expanded — Level 3 drill-down) ───────────────────────────────
//
// Composes three reused, drill-down-only sources into the progressive-disclosure
// spec (LIN-595): the deterministic session-context relationship graph (tasks
// touched + their neighborhood, LIN-593), best-effort live Linear state (lazy
// hydration), and per-task worker-run nodes — each carrying its read-only
// telemetry evidence (LIN-594) and an on-demand run-summary recap. No parallel
// data path: every fetch targets an endpoint Session A already shipped.

function renderSessionBody(body, s) {
  body.dataset.sig = sessionSignature(s);
  const st = summaryState.get(s.sessionId);
  const statusLine = (st && (st.statusLine || st.outcome)) || s.statusLine;

  body.innerHTML = `
    ${statusLine ? `<p class="obs-body-status"><span class="obs-body-lbl">status</span> ${escapeHtml(statusLine)}</p>` : ''}
    ${renderTasks(s)}`;
}

// Group a session's worker runs by the task they ran against.
function runsByTask(s) {
  const groups = new Map();
  for (const r of s.runs) {
    const key = r.issueIdentifier || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

// Task display order: tasksTouched first (seed-first, as the server emits), then
// any run-only task not already covered.
function taskOrder(s, groups) {
  const order = [];
  const seen = new Set();
  for (const t of s.tasksTouched) { if (!seen.has(t)) { seen.add(t); order.push(t); } }
  for (const k of groups.keys()) { if (!seen.has(k)) { seen.add(k); order.push(k); } }
  return order;
}

function renderTasks(s) {
  const ctx = contextState.get(s.sessionId);
  const groups = runsByTask(s);
  const order = taskOrder(s, groups);
  if (!order.length) return `<p class="obs-dim">No tasks recorded for this session yet.</p>`;

  // Index context task-nodes by identifier (case-insensitive) for the merge.
  const ctxByIdent = new Map();
  if (ctx && ctx.graph && Array.isArray(ctx.graph.tasks)) {
    for (const t of ctx.graph.tasks) {
      if (t.root && t.root.identifier) ctxByIdent.set(String(t.root.identifier).toLowerCase(), t);
    }
  }

  const ctxNote = ctx && ctx.pending
    ? `<p class="obs-context-note obs-dim">loading relationships…</p>`
    : (ctx && ctx.error ? `<p class="obs-context-note obs-dim">relationships unavailable</p>` : '');

  const blocks = order.map(ident => {
    const node = ctxByIdent.get(String(ident).toLowerCase()) || null;
    return renderTaskBlock(s, ident, node, groups.get(ident) || []);
  }).join('');

  return `<div class="obs-tasks">${ctxNote}${blocks}</div>`;
}

function renderTaskBlock(s, ident, node, runs) {
  const root = node && node.root;
  const title = (root && root.title) || (runs[0] && runs[0].issueTitle) || '';
  const provenance = node && node.provenance;
  const prov = provenance
    ? `<span class="obs-prov" data-prov="${escapeHtml(provenance)}">${escapeHtml(PROVENANCE_LABEL[provenance] || provenance)}</span>`
    : '';

  // Live Linear state/labels win when hydrated; otherwise fall back to the
  // deterministic context node's state (still no network on the feed path).
  const hydration = hydrationState.get(`${s.workspaceUrlKey}::${ident}`);
  const state = (hydration && hydration.state) || (root ? { name: root.stateName, type: root.stateType } : null);
  const stateChip = state && state.name
    ? `<span class="obs-task-state" data-type="${escapeHtml(state.type || '')}">${escapeHtml(state.name)}</span>` : '';
  const labels = hydration && Array.isArray(hydration.labels) ? hydration.labels : [];
  const labelChips = labels.slice(0, 4).map(l => `<span class="obs-task-label">${escapeHtml(l)}</span>`).join('');
  const url = (hydration && hydration.url) || (root && root.url) || null;
  const identHtml = url
    ? `<a class="obs-task-ident" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(ident)}</a>`
    : `<span class="obs-task-ident">${escapeHtml(ident)}</span>`;

  const runsHtml = runs.length
    ? `<ul class="obs-worker-tree">${runs.map(renderWorkerNode).join('')}</ul>`
    : `<p class="obs-dim obs-worker-empty">No worker runs under this task.</p>`;

  return `<div class="obs-task">
      <div class="obs-task-head">
        ${prov}${identHtml}
        <span class="obs-task-title">${escapeHtml(String(title))}</span>
        ${stateChip}${labelChips}
      </div>
      ${node ? renderRelationships(node) : ''}
      ${runsHtml}
    </div>`;
}

function relList(nodes, max = 3) {
  const ids = nodes.map(n => n.identifier);
  const shown = ids.slice(0, max).map(escapeHtml).join(', ');
  return shown + (ids.length > max ? ` +${ids.length - max}` : '');
}

function renderRelationships(node) {
  const bits = [];
  if (node.parent && node.parent.identifier) {
    bits.push(`<span class="obs-rel"><span class="obs-rel-k">parent</span> ${escapeHtml(node.parent.identifier)}</span>`);
  }
  if (Array.isArray(node.children) && node.children.length) {
    const n = node.children.length + (node.childrenTruncated || 0);
    bits.push(`<span class="obs-rel"><span class="obs-rel-k">children</span> ${n}</span>`);
  }
  if (Array.isArray(node.blockers) && node.blockers.length) {
    bits.push(`<span class="obs-rel obs-rel-block"><span class="obs-rel-k">blocked by</span> ${relList(node.blockers)}</span>`);
  }
  if (Array.isArray(node.blocked) && node.blocked.length) {
    bits.push(`<span class="obs-rel"><span class="obs-rel-k">blocks</span> ${relList(node.blocked)}</span>`);
  }
  if (Array.isArray(node.related) && node.related.length) {
    bits.push(`<span class="obs-rel"><span class="obs-rel-k">related</span> ${relList(node.related)}</span>`);
  }
  return bits.length ? `<div class="obs-rels">${bits.join('')}</div>` : '';
}

// ─── Worker-session node (one run) ──────────────────────────────────────────────

function workerPhase(run) {
  if (run.kind === 'autopilot') return 'autopilot';
  return run.stage || run.promptName || run.kind || 'run';
}

function isTerminalRun(run) {
  return run.agentState === 'complete' || run.agentState === 'error';
}

// Pick the richest tool-activity figure across a run's heartbeats.
function toolActivity(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) return null;
  let best = null;
  for (const m of metrics) {
    const v = m.total != null ? m.total : m.toolCount;
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

function renderChips(run) {
  const chips = [];
  const rt = formatRuntime(run.runtime);
  if (rt) chips.push(`<span class="obs-chip-metric">${escapeHtml(rt)}</span>`);
  // Prefer the server-precomputed peak (the feed ships only the metrics tail now);
  // fall back to scanning the tail for older payloads.
  const tools = run.toolPeak != null ? run.toolPeak : toolActivity(run.metrics);
  if (tools != null) chips.push(`<span class="obs-chip-metric">${tools} tool${tools === 1 ? '' : 's'}</span>`);
  const arts = Array.isArray(run.producedArtifacts) ? run.producedArtifacts.length : 0;
  if (arts) chips.push(`<span class="obs-chip-metric">${arts} link${arts === 1 ? '' : 's'}</span>`);
  return chips.length ? `<span class="obs-chips-metric">${chips.join('')}</span>` : '';
}

function renderRecapLine(run) {
  const rs = runSummaryState.get(run.loopId);
  if (rs && rs.pending) return `<span class="obs-worker-recap obs-dim">summarising…</span>`;
  if (rs && rs.outcome) return `<span class="obs-worker-recap">${escapeHtml(rs.outcome)}</span>`;
  if (run.agentSummary) return `<span class="obs-worker-recap">${escapeHtml(run.agentSummary)}</span>`;
  if (!isTerminalRun(run)) return `<span class="obs-worker-recap obs-dim">◐ running…</span>`;
  return `<span class="obs-worker-recap obs-dim">—</span>`;
}

function renderWorkerNode(run) {
  const icon = STATE_ICON[run.agentState] || '○';
  const expanded = expandedRuns.has(run.loopId);
  const detail = expanded ? renderWorkerDetail(run) : '';
  const loop = escapeHtml(String(run.loopId));
  return `<li class="obs-worker" data-state="${escapeHtml(run.agentState || '')}"${expanded ? ' data-open="1"' : ''}>
      <button type="button" class="obs-worker-head" data-loop="${loop}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="obs-worker-icon" data-state="${escapeHtml(run.agentState || '')}">${escapeHtml(icon)}</span>
        <span class="obs-worker-main">
          <span class="obs-worker-line">
            <span class="obs-worker-phase">${run.iteration != null ? '#' + run.iteration + ' · ' : ''}${escapeHtml(workerPhase(run))}</span>
            ${renderChips(run)}
          </span>
          ${renderRecapLine(run)}
        </span>
        <span class="obs-worker-caret" aria-hidden="true">▸</span>
      </button>
      ${detail ? `<div class="obs-worker-body">${detail}</div>` : ''}
    </li>`;
}

function renderActivityLog(run) {
  const metrics = Array.isArray(run.metrics) ? run.metrics : [];
  if (metrics.length) {
    const lines = metrics.slice(-6).map(m => {
      const parts = [];
      if (m.toolCount != null) parts.push(`${m.toolCount} tool${m.toolCount === 1 ? '' : 's'}`);
      if (m.elapsedSeconds != null) parts.push(formatRuntime({ ms: m.elapsedSeconds * 1000 }));
      if (m.breakdown) parts.push(Object.entries(m.breakdown).map(([k, v]) => `${k}×${v}`).join(' '));
      return `<li class="obs-act">${escapeHtml(parts.join(' · ') || m.raw || 'activity')}</li>`;
    }).join('');
    return `<div class="obs-detail-block"><span class="obs-body-lbl">ran</span><ul class="obs-acts">${lines}</ul></div>`;
  }
  if (run.agentSummary) {
    return `<div class="obs-detail-block"><span class="obs-body-lbl">ran</span> <span class="obs-detail-text">${escapeHtml(run.agentSummary)}</span></div>`;
  }
  return `<div class="obs-detail-block obs-dim"><span class="obs-body-lbl">ran</span> no activity recorded</div>`;
}

function renderArtifacts(run) {
  const arts = Array.isArray(run.producedArtifacts) ? run.producedArtifacts : [];
  if (!arts.length) return '';
  const items = arts.map(a =>
    `<li><a class="obs-artifact" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.label || a.url)}</a></li>`
  ).join('');
  return `<div class="obs-detail-block"><span class="obs-body-lbl">produced</span><ul class="obs-artifacts">${items}</ul></div>`;
}

function renderNext(run) {
  const rs = runSummaryState.get(run.loopId);
  if (rs && rs.next) {
    return `<div class="obs-detail-block"><span class="obs-body-lbl">next</span> <span class="obs-detail-text">${escapeHtml(rs.next)}</span></div>`;
  }
  // A terminal run with no cached recap → offer an explicit, cost-aware generate
  // (a poll/drill-in never auto-spends an LLM call).
  if (isTerminalRun(run) && !(rs && (rs.outcome || rs.next || rs.pending))) {
    return `<div class="obs-detail-block"><button type="button" class="obs-run-gen" data-loop="${escapeHtml(String(run.loopId))}">summarise this run</button></div>`;
  }
  return '';
}

function renderWorkerDetail(run) {
  return `${renderActivityLog(run)}${renderArtifacts(run)}${renderNext(run)}`;
}

// ─── Expand / collapse + lazy drill-down loaders ────────────────────────────────

function toggleSession(sessionId) {
  if (expandedSessions.has(sessionId)) expandedSessions.delete(sessionId);
  else expandedSessions.add(sessionId);
  const el = activeCards.get(sessionId) || recentCards.get(sessionId);
  const s = sessionIndex.get(sessionId);
  if (el && s) applySessionState(el, s);
  if (s && expandedSessions.has(sessionId)) ensureSessionDetail(s);
}

function toggleRun(sessionId, loopId) {
  if (expandedRuns.has(loopId)) expandedRuns.delete(loopId);
  else expandedRuns.add(loopId);
  const s = sessionIndex.get(sessionId);
  if (!s) return;
  if (expandedRuns.has(loopId)) {
    const run = s.runs.find(r => String(r.loopId) === String(loopId));
    if (run) ensureRunSummary(s, run);
  }
  repaintSessionBody(sessionId);
}

// Re-render only an open session's body from current state (after a lazy fetch).
function repaintSessionBody(sessionId) {
  const s = sessionIndex.get(sessionId);
  const el = activeCards.get(sessionId) || recentCards.get(sessionId);
  if (!s || !el) return;
  const body = el.querySelector('.obs-session-body');
  if (body && !body.hidden) renderSessionBody(body, s);
}

// On drill-in: lazily load the relationship graph + best-effort live Linear
// state. Both are drill-down-only (never on the feed poll) and fetched once.
function ensureSessionDetail(s) {
  ensureSessionContext(s);
  ensureHydration(s);
}

async function ensureSessionContext(s) {
  if (contextFetched.has(s.sessionId)) return;
  contextFetched.add(s.sessionId);
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  contextState.set(s.sessionId, { pending: true, graph: null, error: false });
  repaintSessionBody(s.sessionId);
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/session-context/${encodeURIComponent(s.sessionId)}`);
    if (!res.ok) throw new Error('context ' + res.status);
    const data = await res.json();
    contextState.set(s.sessionId, { pending: false, graph: data.graph || null, error: false });
  } catch {
    contextState.set(s.sessionId, { pending: false, graph: null, error: true });
    contextFetched.delete(s.sessionId); // allow a retry on the next drill-in
  }
  repaintSessionBody(s.sessionId);
}

async function ensureHydration(s) {
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  const wsKey = s.workspaceUrlKey;
  for (const ident of s.tasksTouched) {
    const key = `${wsKey}::${ident}`;
    if (hydrationFetched.has(key)) continue;
    hydrationFetched.add(key);
    try {
      const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/hydrate/${encodeURIComponent(wsKey)}/${encodeURIComponent(ident)}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.hydrated) {
        hydrationState.set(key, { hydrated: true, state: data.state || null, labels: data.labels || [], url: data.url || null });
        repaintSessionBody(s.sessionId);
      }
    } catch { /* best-effort: a hydration miss still leaves the Mongo-sourced detail */ }
  }
}

// Peek a terminal worker run's cached run-summary (outcome + next) without
// spending — mirrors the session-summary cost contract. Active runs are skipped
// (the endpoint 409s; the recap falls back to the run's own agentSummary).
async function ensureRunSummary(s, run) {
  const loopId = run.loopId;
  if (!isTerminalRun(run) || runSummaryFetched.has(loopId)) return;
  runSummaryFetched.add(loopId);
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/run-summary/${encodeURIComponent(loopId)}?cachedOnly=1`);
    if (res.status !== 200) return; // 204 miss → leave the "summarise this run" affordance
    const data = await res.json();
    storeRunSummary(loopId, data);
    repaintSessionBody(s.sessionId);
  } catch { /* best-effort */ }
}

function storeRunSummary(loopId, data) {
  const summary = (data && data.summary) || {};
  runSummaryState.set(loopId, { pending: false, outcome: summary.outcome || '', next: summary.next || '', error: false });
}

async function generateRunSummary(sessionId, loopId) {
  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  runSummaryState.set(loopId, { pending: true, outcome: '', next: '', error: false });
  repaintSessionBody(sessionId);
  try {
    const data = await window.api(
      `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/run-summary/${encodeURIComponent(loopId)}`,
      { method: 'POST', on401: false }
    );
    storeRunSummary(loopId, data);
  } catch {
    runSummaryState.delete(loopId);
    runSummaryFetched.delete(loopId);
  }
  repaintSessionBody(sessionId);
}

// ─── Session summary (lazy, cost-aware) ───────────────────────────────────────

// Peek a TERMINAL session's cached one-sentence summary, once. Live/stale
// sessions are deliberately NOT fetched here: their status line is served on the
// feed (s.statusLine), so there is no per-poll request for them. This was the
// memory crash — a running session's signature changes every poll (lastActivity
// advances on each heartbeat), so the old code re-fetched every 5s and each
// fetch re-scanned the whole workspace; multiplied by every active session it
// exhausted memory within minutes. Terminal sessions don't churn, so the peek
// fires once and never auto-spends an LLM call (?cachedOnly=1).
async function maybeFetchSummary(s) {
  if (!s.terminal) return;

  const sig = s.sessionId + '|' + sessionSignature(s);
  if (summaryFetched.has(sig)) return;
  summaryFetched.add(sig);

  const urlKey = observationData?.urlKey;
  if (!urlKey) return;
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/session-summary/${encodeURIComponent(s.sessionId)}?cachedOnly=1`);
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
  if (pollId) { clearTimeout(pollId); pollId = null; }
  // Self-scheduling loop: wait for each poll to finish before queuing the next,
  // so a slow backend can never stack overlapping /sessions scans (each reads the
  // whole workspace). Request pile-up was a memory-pressure path.
  const tick = async () => {
    if (!document.hidden) await pollSessions();
    pollId = setTimeout(tick, POLL_MS);
  };
  tick();
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
  if (pollId) { clearTimeout(pollId); pollId = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
});

document.addEventListener('DOMContentLoaded', init);
