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

// Active vs Archive split (LIN-631): recency-only, mirrored EXACTLY from the
// server (routes/dashboard.js — STALE_AFTER_MS + the recentlyActive predicate),
// so both sides bucket a session the same way.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const ARCHIVE_PAGE_SIZE = 30;               // archive "load more" page size

// Filter state.
const hiddenWorkspaces = new Set();        // urlKeys toggled off
let archiveOpen = false;

// Archive pagination state (LIN-631). The live poll always refreshes the first
// page (offset 0); "load more" requests subsequent offsets and those extra
// sessions persist across polls instead of being clobbered by the next refresh.
let archiveTotal = 0;                       // server-reported full archive size
let archiveOffset = ARCHIVE_PAGE_SIZE;      // next offset to request via load-more
let archiveLoading = false;
const loadedArchiveIds = new Set();         // sessionIds pulled in via load-more

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
// Terminal+error sessions upgraded to done-with-warning (LIN-749): the touched
// task hydrated to a Done state on drill-down. Persisted so the upgrade survives
// the next poll, which re-emits the marker-derived 'error' from the feed.
const warnedSessions = new Set();          // sessionId
const runSummaryState = new Map();         // loopId → { pending, outcome, next, error }
const runSummaryFetched = new Set();       // loopId (peeked once per run signature)
const expandedRuns = new Set();            // loopId (worker-node drill-down)

const PROVENANCE_LABEL = { seed: 'seed', descended: 'descended', 'spun-off': 'spun-off' };

// ─── Status-vocabulary reconciliation onto the theme's 4-state model (LIN-783) ──
//
// The theme's run-status StatusPill/SegmentBar own exactly four colours
// (running=amber, done=green, error=red, queued=slate). The live page carries
// five session statuses and five run states, so both are mapped down here — the
// SINGLE source of truth reused by the pill, the progress bar, and the workspace
// health dot, so a card and a chip can never disagree. No 5th colour is minted:
// `done-with-warning` stays a `done` pill plus an additive ⚠ marker, `stale`
// borrows the inert slate/queued treatment, and non-terminal `waiting` lands in
// the amber running-family with its own title (never colour-alone vs queued-slate).

// Session status (routes/dashboard.js deriveSessionStatus) → pill variant + label.
const SESSION_PILL = {
  'in-progress':       { variant: 'running', label: 'in progress' },
  done:                { variant: 'done',    label: 'done' },
  'done-with-warning': { variant: 'done',    label: 'done', warn: true },
  error:               { variant: 'error',   label: 'error' },
  stale:               { variant: 'queued',  label: 'stale' },
};

// Worker-run agentState (effectiveAgentState) → segment cell + phase-node state.
const RUN_STATE = {
  queued:   { state: 'queued',  label: 'queued' },
  running:  { state: 'running', label: 'running',  live: true },
  waiting:  { state: 'running', label: 'waiting',  live: true },
  complete: { state: 'done',    label: 'complete' },
  error:    { state: 'error',   label: 'error' },
};

// Phase-timeline node glyph per canonical state (decorative — the textual state
// label sits beside it, so state is never conveyed by glyph/colour alone).
const NODE_GLYPH = { done: '✓', error: '✕', running: '◐', queued: '○' };

function runState(agentState) {
  return RUN_STATE[agentState] || { state: 'queued', label: agentState || 'queued' };
}

// Emit the canonical `.status-pill` run-status markup (LIN-786 primitive) from
// client JS. The shared contract is the global CSS class API, not the server
// helper (`lib/components/status-pill.js`), which cards can't reach client-side —
// the class strings are hand-mirrored here (the tracked Phase-B seam).
function statusPillHtml(variant, label, { warn = false } = {}) {
  const warnMark = warn
    ? `<span class="status-pill__warn" title="a run errored" aria-label="warning">⚠</span>`
    : '';
  return `<span class="status-pill status-pill--dot status-pill--${escapeHtml(variant)}">`
    + `<span class="status-pill__dot" aria-hidden="true"></span>`
    + `<span class="status-pill__label">${escapeHtml(label)}</span>${warnMark}</span>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A Linear workflow state of type `completed` is the "Done" signal (LIN-749).
function isDoneState(state) {
  return !!state && state.type === 'completed';
}

// The status string actually rendered on a card. The server feed never carries
// `done-with-warning` (its no-Linear cost contract leaves it emitting 'error'),
// so the terminal-boundary upgrade is applied here from drill-down hydration
// recorded in `warnedSessions`. Every other status passes through unchanged.
function displayStatus(s) {
  if (s.terminal && s.status === 'error' && warnedSessions.has(s.sessionId)) {
    return 'done-with-warning';
  }
  return s.status;
}

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

// Recency-only Active/Archive predicate (LIN-631) — mirrors the server
// (routes/dashboard.js recentlyActive) exactly: Active iff touched within 24h,
// regardless of terminal state.
function isRecentlyActive(session) {
  const t = Date.parse(session.lastActivity);
  return Number.isFinite(t) && (Date.now() - t) <= STALE_AFTER_MS;
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
  return [displayStatus(s), s.runCount, s.lastActivity,
    s.runs.map(r => `${r.loopId}:${r.agentState}`).join(',')].join('|');
}

// ─── Session cards (Level 2) ──────────────────────────────────────────────────

function renderProgressBar(s) {
  if (!s.runs.length) {
    return `<div class="obs-progress-row"><span class="segment-bar obs-progress" role="img" aria-label="no worker runs yet"><span class="segment-bar__cell segment-bar__cell--empty" title="no worker runs yet"></span></span></div>`;
  }
  // Canonical SegmentBar cells (LIN-786): one equal cell per worker run, coloured
  // by the run→4-state map. `data-live` drives the running-cell pulse (page CSS).
  const cells = s.runs.map(r => {
    const m = runState(r.agentState);
    const title = `${r.issueIdentifier || 'run'}${r.stage ? ' · ' + r.stage : ''} — ${m.label}`;
    return `<span class="segment-bar__cell segment-bar__cell--${m.state}"${m.live ? ' data-live="1"' : ''} title="${escapeHtml(title)}"></span>`;
  }).join('');
  // N/M count beside the bar (mockup): finished worker runs over total (LIN-608).
  const total = s.runCount || s.runs.length;
  const done = s.runs.filter(r => r.agentState === 'complete' || r.agentState === 'error').length;
  return `<div class="obs-progress-row">
      <span class="segment-bar obs-progress" role="img" aria-label="${s.runCount} worker run${s.runCount === 1 ? '' : 's'}">${cells}</span>
      <span class="obs-progress-count">${done}/${total}</span>
    </div>`;
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
  if (!s.terminal) {
    const kind = s.recentKind ? ` <span class="obs-summary-kind">${escapeHtml(String(s.recentKind))}</span>` : '';
    return `<span class="obs-summary-line obs-summary-dim">◐ working…${kind}</span>`;
  }
  // Terminal but no cached summary → offer to generate (explicit spend only).
  return `<button type="button" class="obs-summary-gen" data-session="${escapeHtml(s.sessionId)}">summarise this session</button>`;
}

function fillSessionHead(li, s) {
  const status = displayStatus(s);
  const pill = SESSION_PILL[status] || { variant: 'queued', label: status || '' };
  const ident = s.seedIssue || `run ${shortSessionId(s.sessionId)}`;
  // Bug 1 (LIN-783): the identifier already appears once, on the topline. The
  // name line must never fall back to the id (that duplicated it when a session
  // had no seedTitle) — use a neutral placeholder, and drop the name line
  // entirely if it would only echo the ident.
  const title = s.seedTitle || (s.seedIssue ? '' : 'autopilot session');
  const showName = title && title !== ident;
  const runtime = formatRuntime(s.runtime);

  // Prominent labelled meta line (mockup): runtime / model, with workspace + task
  // count kept as trailing context so multi-workspace info is not lost (LIN-608).
  const metaBits = [];
  if (runtime) metaBits.push(`<span class="obs-meta"><span class="obs-meta-k">runtime</span> <span class="obs-meta-v">${escapeHtml(runtime)}</span></span>`);
  if (s.model) metaBits.push(`<span class="obs-meta"><span class="obs-meta-k">model</span> <span class="obs-meta-v">${escapeHtml(String(s.model))}</span></span>`);
  if (s.workspaceName) metaBits.push(`<span class="obs-meta obs-meta-ws">${escapeHtml(s.workspaceName)}</span>`);
  if (s.tasksTouched.length > 1) metaBits.push(`<span class="obs-meta">${s.tasksTouched.length} tasks</span>`);

  // Header anatomy (LIN-928, design §4): status dot · mono id on line 1, the
  // truncating title on line 2 (the growing `headmain` cluster), and a fixed
  // right column that STACKS the status pill above the relative time. The ident
  // and title are the only flexible cells (they ellipsize); the right column is
  // fixed, so the "updated …" stamp never squeezes shut at narrow widths.
  li.querySelector('.obs-session-head').innerHTML = `
    <div class="obs-session-topline">
      <div class="obs-session-headmain">
        <span class="obs-session-idline">
          <span class="obs-session-dot" data-state="${escapeHtml(pill.variant)}" aria-hidden="true"></span>
          <span class="obs-session-ident">${escapeHtml(String(ident))}</span>
        </span>
        ${showName ? `<span class="obs-session-name">${escapeHtml(String(title))}</span>` : ''}
      </div>
      <div class="obs-session-side">
        ${statusPillHtml(pill.variant, pill.label, { warn: pill.warn })}
        <span class="obs-session-time">updated ${escapeHtml(relativeTime(s.lastActivity))}</span>
      </div>
    </div>
    <span class="obs-session-summary">${renderSummaryLine(s)}</span>
    ${metaBits.length ? `<span class="obs-session-meta-line">${metaBits.join('')}</span>` : ''}
    ${renderProgressBar(s)}
    ${renderDisclosure(s)}`;
}

// Disclosure control (LIN-928, design §7): the header is no longer the toggle —
// a dedicated control below the meta/progress row owns expand/collapse, with NO
// caret on the header. The count is the real number of worker runs the card will
// render (one node per run in `runsByTask`), not a flattened phase list. The
// show/hide label swaps via the `.is-open` class (CSS), so this markup is
// expansion-state-agnostic and re-renders cleanly on every poll.
function renderDisclosure(s) {
  const n = s.runs.length;
  const show = n ? `Show run detail · ${n} run${n === 1 ? '' : 's'}` : 'Show run detail';
  return `<button type="button" class="obs-disc" aria-expanded="false">`
    + `<span class="obs-disc-show">${escapeHtml(show)}</span>`
    + `<span class="obs-disc-hide">Hide run detail</span></button>`;
}

function makeSessionCard(s) {
  const li = document.createElement('li');
  li.className = 'obs-session';
  li.dataset.session = s.sessionId;
  // The head is a plain container, NOT the toggle (LIN-928, design §7). Only the
  // `.obs-disc` control below the meta row expands/collapses the card. The head's
  // inner markup is replaced on every poll (innerHTML), so the toggle is bound
  // once here via delegation on the stable head element rather than on the disc
  // button itself.
  const head = document.createElement('div');
  head.className = 'obs-session-head';
  const body = document.createElement('div');
  body.className = 'obs-session-body';
  body.hidden = true;
  li.appendChild(head);
  li.appendChild(body);
  head.addEventListener('click', (e) => {
    // Let the inline "summarise" button act without toggling the card.
    if (e.target.closest('.obs-summary-gen')) return;
    if (e.target.closest('.obs-disc')) toggleSession(s.sessionId);
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
  li.dataset.status = displayStatus(s);
  const expanded = expandedSessions.has(s.sessionId);
  // The disclosure control (not the head) owns the expanded state (LIN-928).
  const disc = li.querySelector('.obs-disc');
  if (disc) disc.setAttribute('aria-expanded', expanded ? 'true' : 'false');
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
    // Q5 (LIN-783): freeze an expanded (being-read) card's list position. Every
    // poll otherwise re-appends cards in server order, so a card could jump mid-
    // read as its activity ranking changes. An already-placed expanded card keeps
    // its slot; genuinely new cards (and every collapsed card) still order/animate
    // normally, so `cell-new` and the removal loop above are untouched.
    const frozen = !isNew && expandedSessions.has(s.sessionId) && el.parentNode === list;
    if (!frozen) list.appendChild(el);
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
  // Recency-only split (LIN-631), mirroring the server: Active iff touched within
  // 24h, else Archive — regardless of terminal state. Old non-terminal sessions
  // therefore land in Archive, where the stale render branch still labels them.
  const active = sessions.filter(isRecentlyActive);
  const recent = sessions.filter(s => !isRecentlyActive(s));
  diffSessionList('obs-active', 'obs-active-empty', activeCards, active);
  diffSessionList('obs-recent', 'obs-recent-empty', recentCards, recent);

  // Active-section eyebrow live count (LIN-929): design §3.4/§8 reads
  // `Active · N running`. N is the number of Active sessions whose pill resolves
  // to the running variant — the SAME session→pill map the cards and chip-health
  // dot use (single source of truth), so the eyebrow can never disagree with the
  // feed below it.
  const running = active.filter(
    s => ((SESSION_PILL[displayStatus(s)] || {}).variant) === 'running'
  ).length;
  const runningN = document.querySelector('#obs-active-count .obs-active-count-n');
  if (runningN) runningN.textContent = String(running);

  // Count reflects the full server-side archive (LIN-631), not just the pages
  // loaded so far, so the badge stays honest before "load more" is used.
  const count = document.getElementById('obs-archive-count');
  if (count) count.textContent = String(Math.max(archiveTotal, recent.length));
  updateLoadMore();
  updateChipHealth();
}

// Q6 (LIN-783): a filter chip's dot reports its workspace's HEALTH — the worst
// live status among that workspace's sessions — not the filter's on/off state
// (which the chip's own `is-on` class already shows). Derived client-side from
// the already-merged feed via the SAME session→state map the pills use (single
// source of truth), so a chip can never disagree with a card. No new fetch.
const HEALTH_RANK = { error: 3, running: 2, done: 1, queued: 0 };

function updateChipHealth() {
  const chips = document.getElementById('obs-chips');
  if (!chips) return;
  const worst = new Map(); // workspaceUrlKey → pill variant
  for (const s of sessionIndex.values()) {
    const variant = (SESSION_PILL[displayStatus(s)] || {}).variant || 'queued';
    const cur = worst.get(s.workspaceUrlKey);
    if (cur == null || (HEALTH_RANK[variant] || 0) > (HEALTH_RANK[cur] || 0)) {
      worst.set(s.workspaceUrlKey, variant);
    }
  }
  for (const chip of chips.querySelectorAll('.obs-chip')) {
    const dot = chip.querySelector('.obs-chip-dot');
    if (!dot) continue;
    const variant = worst.get(chip.dataset.ws);
    if (variant) { dot.dataset.state = variant; dot.title = `workspace health: ${variant}`; }
    else { delete dot.dataset.state; dot.title = 'no sessions'; }
  }
}

function updateLoadMore() {
  const btn = document.getElementById('obs-archive-more');
  if (!btn) return;
  const hasMore = archiveOffset < archiveTotal;
  btn.hidden = !hasMore;
  btn.disabled = archiveLoading;
  btn.textContent = archiveLoading ? 'loading…' : 'load more';
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
    ${renderObjective(s)}
    ${statusLine ? `<p class="obs-body-status"><span class="obs-body-lbl">status</span> ${escapeHtml(statusLine)}</p>` : ''}
    ${renderTasks(s)}`;
}

// Objective / Related eyebrow block (LIN-928, design §4.6). `Objective` is the
// session's seed goal (`seedTitle`), stated in full at the top of the detail —
// the header title truncates, so this is the complementary full-text home for
// the goal, and it deliberately never reprints the id (design §4 id-once). No
// session-level `Related` list is synthesised here: `Related` stays aligned with
// the real per-task relationship rendering (`renderRelationships`, one level
// down), honouring the session→tasks→worker-runs IA over the mock's flat model.
function renderObjective(s) {
  const objective = s.seedTitle && String(s.seedTitle).trim();
  if (!objective) return '';
  return `<p class="obs-objective"><span class="obs-body-lbl">objective</span> ${escapeHtml(objective)}</p>`;
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
  const m = runState(run.agentState);
  const glyph = NODE_GLYPH[m.state] || '○';
  const expanded = expandedRuns.has(run.loopId);
  const detail = expanded ? renderWorkerDetail(run) : '';
  const loop = escapeHtml(String(run.loopId));
  // Q2 (LIN-783): surface Harbour's existing per-issue `iteration` as the mockup's
  // "attempt N" — no third vocabulary term, just a friendlier label for the count.
  const attempt = run.iteration != null
    ? `<span class="obs-worker-attempt">attempt ${escapeHtml(String(run.iteration))}</span>` : '';
  // Phase-timeline rail node: a status glyph anchored on the connector rail. The
  // run's textual state sits on the right of the phase line, so the node's colour
  // is never the sole signal.
  return `<li class="obs-worker" data-state="${escapeHtml(m.state)}"${expanded ? ' data-open="1"' : ''}>
      <span class="obs-worker-node" data-state="${escapeHtml(m.state)}"${m.live ? ' data-live="1"' : ''} aria-hidden="true">${escapeHtml(glyph)}</span>
      <button type="button" class="obs-worker-head" data-loop="${loop}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="obs-worker-caret" aria-hidden="true">▸</span>
        <span class="obs-worker-main">
          <span class="obs-worker-line">
            <span class="obs-worker-phase">${escapeHtml(workerPhase(run))}</span>
            ${attempt}
            <span class="obs-worker-state" data-state="${escapeHtml(m.state)}">${escapeHtml(m.label)}</span>
          </span>
          ${renderRecapLine(run)}
          ${renderChips(run)}
        </span>
      </button>
      ${detail ? `<div class="obs-worker-body">${detail}</div>` : ''}
    </li>`;
}

// Activity log (net-new pattern): each heartbeat is a row of tool chips with a
// right-aligned duration column, replacing the old flat mono `ran` list.
function renderActivityLog(run) {
  const metrics = Array.isArray(run.metrics) ? run.metrics : [];
  if (metrics.length) {
    const lines = metrics.slice(-6).map(m => {
      const breakdown = m.breakdown ? Object.entries(m.breakdown) : [];
      const chips = [];
      // §6.3: the per-tool chips already sum the burst, so render the breakdown and
      // drop the redundant per-burst total; fall back to the bare count only when
      // there is no breakdown to sum it.
      if (breakdown.length) {
        for (const [k, v] of breakdown) chips.push(`<span class="obs-act-chip">${escapeHtml(k)}×${escapeHtml(String(v))}</span>`);
      } else if (m.toolCount) {
        chips.push(`<span class="obs-act-chip">${m.toolCount} tool${m.toolCount === 1 ? '' : 's'}</span>`);
      }
      const dur = m.elapsedSeconds != null ? formatRuntime({ ms: m.elapsedSeconds * 1000 }) : '';
      // §6.3: an empty burst (a tool heartbeat with zero calls) reads as a quiet
      // "no tools", never "0 tools"; a non-tool metric keeps its raw line.
      let main;
      if (chips.length) main = chips.join('');
      else if (m.toolCount != null) main = `<span class="obs-act-chip obs-act-idle">no tools</span>`;
      else main = `<span class="obs-act-raw">${escapeHtml(m.raw || 'activity')}</span>`;
      return `<li class="obs-act"><span class="obs-act-main">${main}</span>${dur ? `<span class="obs-act-dur">${escapeHtml(dur)}</span>` : ''}</li>`;
    }).join('');
    return `<div class="obs-detail-block"><span class="obs-body-lbl">activity</span><ul class="obs-acts">${lines}</ul></div>`;
  }
  if (run.agentSummary) {
    return `<div class="obs-detail-block"><span class="obs-body-lbl">activity</span> <span class="obs-detail-text">${escapeHtml(run.agentSummary)}</span></div>`;
  }
  return `<div class="obs-detail-block obs-dim"><span class="obs-body-lbl">activity</span> no activity recorded</div>`;
}

// §6.4: split the two artifact variants the telemetry can actually support. A
// `/pull/N` (or `/-/merge_requests/N`) path segment unambiguously identifies a
// PR/MR from the URL itself — no guessed `type`, which the telemetry shape
// (`{url,label}`) does not carry. Everything else is a plain external `link`. The
// third design variant (`action` — an in-app, brand-coloured control) is NOT
// representable here: it never appears in produced-artifact telemetry (LIN-866).
function classifyArtifact(a) {
  const url = a && a.url ? String(a.url) : '';
  const m = url.match(/\/([^/]+)\/(?:-\/)?(?:pull|pull-requests|merge_requests)\/(\d+)\b/);
  if (m) return { pr: true, handle: `${m[1]} #${m[2]}` };
  return { pr: false };
}

// Produced-artifacts list (net-new pattern): icon-led links out to the evidence
// (PR / file) a run produced. PRs get a branch glyph + mono handle; other
// evidence renders as a plain external link (§6.4).
function renderArtifacts(run) {
  const arts = Array.isArray(run.producedArtifacts) ? run.producedArtifacts : [];
  if (!arts.length) return '';
  const items = arts.map(a => {
    const href = escapeHtml(a.url);
    const cls = classifyArtifact(a);
    if (cls.pr) {
      return `<li><a class="obs-artifact obs-artifact-pr" href="${href}" target="_blank" rel="noopener"><span class="obs-artifact-icon" aria-hidden="true">⎇</span><span class="obs-artifact-label obs-artifact-handle">${escapeHtml(cls.handle)}</span></a></li>`;
    }
    return `<li><a class="obs-artifact" href="${href}" target="_blank" rel="noopener"><span class="obs-artifact-icon" aria-hidden="true">↗</span><span class="obs-artifact-label">${escapeHtml(a.label || a.url)}</span></a></li>`;
  }).join('');
  return `<div class="obs-detail-block"><span class="obs-body-lbl">produced</span><ul class="obs-artifacts">${items}</ul></div>`;
}

// Error-as-direction box (net-new pattern): a failed run leads with its cause,
// shows how long it ran, and offers a "view log" link to the produced evidence
// (presentation-only — no retry endpoint exists, so no dead control is shown).
function renderErrorBox(run) {
  if (run.agentState !== 'error') return '';
  const rs = runSummaryState.get(run.loopId);
  const cause = (rs && rs.outcome) || run.agentSummary || 'This run ended with an error.';
  const rt = formatRuntime(run.runtime);
  const log = (Array.isArray(run.producedArtifacts) ? run.producedArtifacts : []).find(a => a && a.url);
  const viewLog = log
    ? `<a class="obs-err-action" href="${escapeHtml(log.url)}" target="_blank" rel="noopener">view log ↗</a>` : '';
  const meta = [rt ? `<span class="obs-err-rt">ran ${escapeHtml(rt)}</span>` : '', viewLog].filter(Boolean).join('');
  return `<div class="obs-error-box" role="note">
      <p class="obs-error-cause"><span class="obs-error-mark" aria-hidden="true">✕</span> ${escapeHtml(cause)}</p>
      ${meta ? `<p class="obs-error-meta">${meta}</p>` : ''}
    </div>`;
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
  return `${renderErrorBox(run)}${renderActivityLog(run)}${renderArtifacts(run)}${renderNext(run)}`;
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

// Re-render a card's head + accent from current state (LIN-749) — used when a
// drill-down hydration upgrades the session to done-with-warning, which changes
// the pill/accent in the collapsed head, not just the open body.
function refreshSessionCard(sessionId) {
  const s = sessionIndex.get(sessionId);
  const el = activeCards.get(sessionId) || recentCards.get(sessionId);
  if (!s || !el) return;
  fillSessionHead(el, s);
  wireSummaryGen(el, s);
  applySessionState(el, s);
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
        // Terminal-boundary upgrade (LIN-749): an errored terminal session whose
        // touched task is now Done renders as done-with-warning. Sourced here from
        // the drill-down hydration seam, never the per-poll feed. Refresh the card
        // head/accent (not just the body) so the pill reflects the new status.
        if (!warnedSessions.has(s.sessionId) && s.terminal && s.status === 'error' && isDoneState(data.state)) {
          warnedSessions.add(s.sessionId);
          refreshSessionCard(s.sessionId);
        }
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
    archiveTotal = Number.isFinite(data.recentTotal) ? data.recentTotal : recent.length;

    // The poll is authoritative for Active + the first archive page. Extra
    // archive pages pulled in via "load more" (loadedArchiveIds) persist across
    // polls; everything else not in this poll is dropped (LIN-631).
    const fresh = new Set([...active, ...recent].map(s => String(s.sessionId)));
    for (const id of [...sessionIndex.keys()]) {
      if (fresh.has(id) || loadedArchiveIds.has(id)) continue;
      sessionIndex.delete(id);
    }
    for (const s of [...active, ...recent]) sessionIndex.set(String(s.sessionId), s);

    renderFeeds();
    setPollStatus('● live');
  } catch (e) {
    setPollStatus('● disconnected');
    console.warn('Observation poll failed:', e);
  }
}

// Pull the next archive page (LIN-631). Offset-based: the live poll owns the
// first page, so we request from archiveOffset onward and merge — these extra
// sessions are tagged in loadedArchiveIds so the next poll won't evict them.
async function loadMoreArchive() {
  const urlKey = observationData?.urlKey;
  if (!urlKey || archiveLoading || archiveOffset >= archiveTotal) return;
  archiveLoading = true;
  updateLoadMore();
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dashboard/sessions?offset=${archiveOffset}&limit=${ARCHIVE_PAGE_SIZE}`);
    if (!res.ok) return;
    const data = await res.json();
    const page = Array.isArray(data.recent) ? data.recent : [];
    archiveTotal = Number.isFinite(data.recentTotal) ? data.recentTotal : archiveTotal;
    for (const s of page) {
      const id = String(s.sessionId);
      sessionIndex.set(id, s);
      loadedArchiveIds.add(id);
    }
    archiveOffset += page.length;
    renderFeeds();
  } catch (e) {
    console.warn('Observation load-more failed:', e);
  } finally {
    archiveLoading = false;
    updateLoadMore();
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

  const more = document.getElementById('obs-archive-more');
  if (more) more.addEventListener('click', loadMoreArchive);
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

// Test-only seam (inert in the browser, where `module` is undefined): expose the
// pure presentation helpers so the §6.3/§6.4 fidelity rules can be unit-tested
// without a DOM. Not part of the page's runtime contract.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderActivityLog, renderArtifacts, classifyArtifact };
}
