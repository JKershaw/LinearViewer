/**
 * Session Page Renderer (LIN-1003, Phase 1 of LIN-950; LIN-1133 per-run expansion).
 *
 * The dedicated per-session page — the Observation in-feed drill-down promoted
 * into a real, server-rendered HTML page with its own URL
 * (`GET /workspace/:urlKey/observation/session/:sessionId`). Renders a JS-enhanced
 * page (common.js, marked.min.js, purify.min.js, brief.js, recap.js) for per-run
 * expandable transcripts, inline reply boxes, and BriefSection/RecapSection widgets.
 *
 * What it renders:
 *   - Overview: seed issue, tasks touched, session timings + telemetry.
 *   - Per-run expandable cards: each run shows its own transcript (feedback
 *     entries embedded as data for client-side markdown rendering) + inline
 *     reply box scoped to that run's loopId.
 *   - Context: per-issue brief/recap, joined from the caches by the route.
 *     CACHE-ONLY on load — a miss renders an explicit, cost-aware generate
 *     affordance, NEVER an auto-LLM-spend on page load. When present, the
 *     container is tagged for BriefSection/RecapSection client-side init.
 *
 * Zero LLM/network/store I/O here — the route does the reads and hands this a
 * plain data object. `data.session === null` renders the 404 not-found body.
 */

import { escapeHtml } from './utils/html.js';
import { resolveCredentialState } from './credential-state.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { buildRunView, tierOf } from './run-view.js';
import { findWakeEvent } from './dispatch-terminal.js';
import { renderRunEvidence } from './render-run-evidence.js';

/** Short, safe machine-fact rendering of a timestamp (mono face upstream). */
function fmtTs(ts) {
  if (!ts) return '—';
  return escapeHtml(String(ts));
}

/** A telemetry runtime → a compact `Ns` / `—` label. */
function fmtRuntime(runtime) {
  if (!runtime || runtime.ms == null) return null;
  const secs = Math.round(runtime.ms / 1000);
  return `${secs}s`;
}

/** A byte count (e.g. peak RSS) → a compact `N MB` label. LIN-1789. */
function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

/**
 * Credential display vocabulary (LIN-1588, Beat 2 of LIN-1577).
 *
 * This page is NOT flag-gated — it ships on the default path — and `unknown` is
 * the ordinary state (~99.86% of dispatches carry no joinable credential
 * identity, LIN-1585). So the copy for it has to read as calm and normal, not
 * as an alarm. `ok` is deliberately hedged too: Beat 1's verdict means "no
 * death evidence in the last 15 minutes", never "verified healthy".
 */
const CREDENTIAL_COPY = {
  dead: { label: 'dead — re-issue the token', pill: 'error', title: 'This session’s workspace-scoped calls report token_ownerless while its workspace-free calls still succeed.' },
  ok: { label: 'ok', pill: 'done', title: 'No credential-death evidence in the last 15 minutes. Not a verified-healthy check.' },
  unknown: { label: 'unknown', pill: 'queued', title: 'No recent credential evidence for this session — the ordinary case, not a fault.' },
};

/**
 * The session-level credential rollup: DEAD wins, then OK, else UNKNOWN.
 *
 * Asymmetric on purpose — one stranded run is the whole reason a human opened
 * this page ("which of my four trees is dead?"), so it must not be averaged
 * away by its healthier siblings.
 */
function rollupCredential(loops, credentialByToken) {
  let ok = null;
  for (const loop of Array.isArray(loops) ? loops : []) {
    const state = resolveCredentialState(loop && loop.agentTokenId, credentialByToken);
    const label = (loop && loop.agentTokenLabel) || null;
    if (state === 'dead') return { state, label };
    if (state === 'ok' && !ok) ok = { state, label };
  }
  return ok || { state: 'unknown', label: null };
}

/** Per-run telemetry chips (metric count, runtime, artifacts, model?, peak RSS?, credential?). */
function renderRunChips(telemetry, credential = null) {
  if (!telemetry && !credential) return '';
  const chips = [];
  if (telemetry) {
    const runtime = fmtRuntime(telemetry.runtime);
    if (runtime) chips.push(`<span class="sess-chip" data-testid="session-run-runtime">⏱ ${escapeHtml(runtime)}</span>`);
    const metricCount = Array.isArray(telemetry.metrics) ? telemetry.metrics.length : 0;
    if (metricCount) chips.push(`<span class="sess-chip" data-testid="session-run-metrics">◐ ${metricCount} heartbeats</span>`);
    const artifactCount = Array.isArray(telemetry.producedArtifacts) ? telemetry.producedArtifacts.length : 0;
    if (artifactCount) chips.push(`<span class="sess-chip" data-testid="session-run-artifacts">✎ ${artifactCount} artifacts</span>`);
    // LIN-3250: the realised model is shown by TIER only — the identifier is
    // never printed on the page (the raw value stays in operator data).
    if (telemetry.model) {
      const tier = tierOf(telemetry.model);
      chips.push(`<span class="sess-chip" data-testid="session-run-model" data-tier="${escapeHtml(tier)}">◇ ${escapeHtml(tier)}</span>`);
    }
    // LIN-1789: peakRssBytes only — the other nine `resources` fields are
    // host/session-wide snapshots, not per-run facts, so they get no chip here.
    const peakRss = fmtBytes(telemetry.resources && telemetry.resources.peakRssBytes);
    if (peakRss) chips.push(`<span class="sess-chip" data-testid="session-run-resources">▤ ${escapeHtml(peakRss)} peak</span>`);
  }
  // LIN-1588: only a run that carries its own credential identity earns a chip —
  // a run with no token has nothing run-specific to say, and the Overview line
  // already states the session's state. `label` is display-only and is escaped
  // HERE: renderSessionPage's helpers are raw-by-contract, so user-controlled
  // text escapes at the call site (the 8aa32eaf / LIN-1567 convention).
  if (credential) {
    const copy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
    const label = credential.label ? ` · ${escapeHtml(String(credential.label))}` : '';
    chips.push(`<span class="sess-chip sess-chip--cred" data-state="${escapeHtml(credential.state)}" data-testid="session-run-credential" title="${escapeHtml(copy.title)}">⚿ credential ${escapeHtml(copy.label)}${label}</span>`);
  }
  return chips.length ? `<div class="sess-chips">${chips.join('')}</div>` : '';
}

// LIN-2242/LIN-2243: a worker-lane's [ticket] marker state → the shared
// status-pill vocabulary. `blocked`/`refused`/`dissolved` map to `error` —
// deliberately the SAME loud pill class a `failed` run gets, not a dimmer one,
// per the ticket's own "not buried prose" acceptance test: a non-success
// outcome is a first-class row, not a footnote.
const TICKET_PILL_STATE = {
  done: 'done',
  started: 'running',
  blocked: 'error',
  refused: 'error',
  dissolved: 'error',
  trimmed: 'queued',
};

/**
 * A worker-lane's per-ticket walk (LIN-2243), parsed from its own [ticket]
 * markers (lib/session-telemetry.js). Each row is a first-class outcome —
 * `blocked`/`refused`/`dissolved` render with the same loud pill a `failed`
 * run gets, never buried in prose — with the outcome line (if any) shown
 * alongside. Returns '' when the run isn't a lane (no markers observed).
 *
 * @param {Array<{identifier: string, state: string, outcomeLine: string|null}>} ticketWalk
 * @returns {string}
 */
function renderTicketWalk(ticketWalk) {
  if (!Array.isArray(ticketWalk) || !ticketWalk.length) return '';
  const rows = ticketWalk.map((t) => {
    const pillState = TICKET_PILL_STATE[t.state] || 'queued';
    const outcome = t.outcomeLine
      ? `<span class="sess-ticket-outcome" data-testid="session-ticket-outcome">${escapeHtml(t.outcomeLine)}</span>`
      : '';
    return `<li class="sess-ticket" data-testid="session-ticket-row" data-state="${escapeHtml(t.state)}">
        <span class="sess-ticket-ident" data-testid="session-ticket-ident">${escapeHtml(t.identifier)}</span>
        <span class="status-pill status-pill--${pillState}" data-testid="session-ticket-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(t.state)}</span>
        ${outcome}
      </li>`;
  }).join('');
  return `<ol class="sess-ticket-walk" data-testid="session-ticket-walk">${rows}</ol>`;
}

/**
 * The `[blocked]`/`[pending]` feedback-marker vocabulary (LIN-1163) — a run
 * paused on human input. Computed once here so the collapsed-run waiting flag
 * (item 5) and the transcript's blocked-message highlight (item 6) share a
 * single definition instead of two divergent client-side regexes.
 */
const BLOCKED_MARKER_REGEX = /^\s*\[(blocked|pending)\]/i;

/** Whether a single feedback entry's message carries a blocked/pending marker. */
function isBlockedEntry(message) {
  return BLOCKED_MARKER_REGEX.test(message || '');
}

const EMPTY_SET = new Set();

// The wake markers that count as "waiting on a human" (LIN-1005/LIN-1025).
// Mirrors `WAITING_WAKE_MARKERS` in `routes/dashboard.js` and
// `lib/pipeline-loops.js` — keep in parity. ONLY `[blocked]` qualifies:
// `[pending]` is an agent-to-agent orchestrator handoff (LIN-843), not a
// request for user input.
const WAITING_WAKE_MARKERS = new Set(['blocked']);

/**
 * Encode per-run feedback entries as a JSON data attribute for client-side rendering.
 *
 * LIN-2184 (H5): carries `kind` (null when absent) so a `decision` entry can be
 * styled distinctly client-side, parallel to the existing `blocked` flag below.
 * Not `waiting`-gated — this renders any entry present, blocked or complete.
 */
function encodeFeedbackJSON(feedback) {
  const safe = Array.isArray(feedback)
    ? feedback.map(e => ({ message: e.message || '', url: e.url || null, urlLabel: e.urlLabel || null, timestamp: e.timestamp || null, blocked: isBlockedEntry(e.message), kind: e.kind || null }))
    : [];
  return escapeHtml(JSON.stringify(safe));
}

/**
 * A per-run "waiting for input" signal (LIN-1163, item 5), derived read-only
 * from the run's OWN feedback — deliberately NOT the session-level `waiting`
 * rollup (which is keyed session-wide and can't say *which* run is parked;
 * see `renderInlineReplyBox` above). A run only counts as waiting while it is
 * itself non-terminal — a finished run's last entry could still carry a
 * `[blocked]` marker from earlier in its life, and that's not "waiting" anymore.
 * A run superseded by a follow-up loop (see `computeSupersededLoopIds`) is also
 * excluded — it has since been replied to, even though its own stale feedback
 * still ends on a blocked marker.
 *
 * LIN-2264: this used to walk back from `feedback[]`'s LAST entry, skipping
 * only `decision-answer` stamps — positional adjacency, not a semantic scan.
 * Simple Dispatcher posts a `[usage]` bookkeeping entry at the same Stop
 * boundary immediately after a `[blocked]` status entry, and that predicate
 * didn't skip it, so on real data (measured: 19/19 blocked loops) the walk
 * stopped on `[usage]` and this always read false — the flag was effectively
 * dead in production. It now uses the same SEMANTIC scan
 * `routes/dashboard.js`'s `loopIsWaiting` uses: the build-time `wakeMarker`
 * baked onto every loop `_buildLoops` produces (lean or not —
 * `lib/pipeline-loops.js`), falling back to `findWakeEvent` over raw
 * `feedback[]` for a loop built elsewhere (e.g. a test fixture). Both scan
 * for the LAST *wake* marker (`[done]`/`[complete]`/`[failed]`/`[aborted]`/
 * `[blocked]`/`[pending]`) regardless of what non-wake bookkeeping — `[usage]`,
 * a `decision`/`decision-answer` entry, a plain heartbeat — sits after it, so
 * this is robust to `WORKER_USAGE_RELAY` being on or off and to future
 * bookkeeping entries alike. Only `[blocked]` counts as waiting-on-a-human
 * (`WAITING_WAKE_MARKERS` above); `[pending]` no longer does, matching
 * `loopIsWaiting` — this is what keeps the per-run flag and the session
 * banner from disagreeing (the divergence this ticket closes).
 */
function runIsWaiting(loop, supersededLoopIds = EMPTY_SET) {
  if (loop.terminalStatus) return false;
  if (supersededLoopIds.has(loop.loopId)) return false;
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return marker != null && WAITING_WAKE_MARKERS.has(marker);
}

/**
 * A run's transcript — a `.chat-thread` (LIN-1298 shared chat primitives)
 * populated client-side from the embedded `data-feedback` JSON, matching the
 * Task Chat conversational idiom (LIN-1309). Structure mirrors
 * `public/task-chat.*`'s `.task-chat-transcript.chat-thread`: one class-bearing
 * element, no extra wrapper div — `session.js` reads `data-feedback` straight
 * off this element and appends one `.chat-msg` bubble per entry.
 */
function renderTranscriptEntries(loop) {
  const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (!entries.length) return '';
  const json = encodeFeedbackJSON(loop.feedback);
  return `<ul class="sess-run-tx chat-thread" data-testid="session-run-transcript" data-feedback="${json}"></ul>`;
}

/**
 * Map a run's terminal status → the shared `.status-pill` vocabulary (LIN-1225).
 * The per-run status is now a real status pill (dot + AA-safe label) and drives
 * the card's coloured left accent, so the runs list speaks the same green/amber/
 * red language as the Observation feed instead of a bare green word.
 */
function runStatusMeta(loop) {
  const t = loop.terminalStatus;
  if (t === 'done') return { state: 'done', label: 'done' };
  if (t === 'failed') return { state: 'error', label: 'failed' };
  if (t) return { state: 'queued', label: String(t) };
  return { state: 'running', label: 'running' };
}

/**
 * Per-run inline reply box, scoped to the run's loopId.
 *
 * `data-terminal` is the run's OWN terminal status (done/failed); `data-session-waiting`
 * is the SESSION-level paused-on-human signal (LIN-1252) — the client sends `force`
 * when either is set, so a reply to a parked/waiting session kill-firsts and lands
 * even though the run itself is non-terminal. Waiting is keyed at session granularity
 * (not per-run) because the reported symptom is session-scoped.
 *
 * `data-issue-id`/`data-issue-identifier` (LIN-2154): the run's own issue identity,
 * read off `loop.issueId`/`loop.issueIdentifier` — used client-side to compose the
 * durable comment write's `:issueId` path segment (`issueId || issueIdentifier`,
 * since the e2e fixtures and many real runs carry only the latter) and to gate
 * Save / Save-and-continue on "is this run issue-bound at all" (keyed on
 * `issueIdentifier`, matching `renderRun`'s own `(no task)` definition above).
 * Deliberately NO `data-source` — a prior revision threaded `loop.source` (the
 * dispatch collection, 'live'/'history') as if it were provider provenance; it
 * isn't, and wiring it achieved nothing. Real provenance is LIN-2188's job.
 *
 * LIN-3252 S2: the decision half is GONE from this box — an unanswered decision
 * is answered by the pinned question card above the steps, not by a per-run
 * reply. Only the free-text follow-up for a non-decision run remains here.
 */
function renderInlineReplyBox(loop, urlKey, waiting = false) {
  const terminal = loop.terminalStatus === 'done' || loop.terminalStatus === 'failed';
  const attrs = [
    'data-testid="session-inline-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-loop-id="${escapeHtml(String(loop.loopId || ''))}"`,
    `data-target="${escapeHtml(loop.target || 'cli')}"`,
    `data-terminal="${terminal ? 'true' : 'false'}"`,
    `data-session-waiting="${waiting ? 'true' : 'false'}"`,
    `data-issue-id="${escapeHtml(String(loop.issueId || ''))}"`,
    `data-issue-identifier="${escapeHtml(String(loop.issueIdentifier || ''))}"`
  ].filter(Boolean).join(' ');
  // LIN-1298: adopt the shared Task Chat conversational idiom — an echo thread the
  // client fills with a "you" bubble on send, above a chat composer. The
  // interactive hooks (classes + testids) are unchanged, so session.js and the
  // existing tests keep working; only the surrounding chrome is conversational.
  //
  // LIN-2154: Save writes the reply as a durable task comment only; Save and
  // continue writes the comment AND delivers the existing dispatch follow-up.
  // Save is hidden client-side for an issueless run (public/session.js) —
  // rendered here regardless so a stitched/issueless run degrades gracefully
  // rather than never rendering the button markup at all.
  return `<div class="sess-inline-reply" ${attrs}>
      <ul class="chat-thread" data-testid="session-inline-reply-thread" hidden></ul>
      <div class="chat-composer">
        <textarea class="sess-inline-reply-input chat-composer__input" rows="2" placeholder="Reply to this run…" aria-label="Reply to this run"></textarea>
        <div class="sess-inline-reply-actions chat-composer__actions">
          <button type="button" class="action-btn sess-reply-save" data-testid="session-inline-reply-save">save</button>
          <button type="button" class="action-btn sess-reply-send" data-testid="session-inline-reply-send">save and continue</button>
          <span class="sess-reply-feedback" role="status" aria-live="polite"></span>
        </div>
      </div>
    </div>`;
}

/**
 * One "Proposed in chat" row (LIN-3254): the proposed prompt as escaped text.
 * A still-pending proposal shows Apply / Decline; once decided it shows a quiet
 * one-line state instead. The row is a record only — the dispatched follow-up
 * appears in the lineage transcript through the normal dispatch path.
 */
function renderProposalRow(proposal) {
  const status = proposal.status || 'proposed';
  const decided = status !== 'proposed';
  const stateText = status === 'applied' ? 'applied' : 'declined';
  const controls = decided
    ? `<span class="sess-proposal-state" data-testid="session-proposal-state">${escapeHtml(stateText)}</span>`
    : `<span class="sess-proposal-actions">
          <button type="button" class="action-btn sess-proposal-apply" data-proposal-action="apply">Apply</button>
          <button type="button" class="action-btn sess-proposal-decline" data-proposal-action="decline">Decline</button>
        </span>`;
  const attrs = [
    'data-testid="session-proposal"',
    `data-proposal-id="${escapeHtml(String(proposal.id || ''))}"`,
    `data-run-id="${escapeHtml(String(proposal.runId || ''))}"`,
    `data-proposal-status="${escapeHtml(status)}"`,
  ].join(' ');
  return `<li class="sess-proposal" ${attrs}>
          <span class="sess-proposal-prompt">${escapeHtml(String(proposal.prompt || ''))}</span>
          ${controls}
        </li>`;
}

/**
 * The proposal block for one step. Rendered INSIDE the same actions region as
 * the reply box (so guest mode, which hides reply boxes, hides this too), and
 * only when replies are allowed.
 */
function renderProposalBlock(proposals, urlKey) {
  if (!Array.isArray(proposals) || proposals.length === 0) return '';
  return `<div class="sess-proposals" data-testid="session-proposals" data-url-key="${escapeHtml(urlKey || '')}">
        <div class="sess-proposals-title">Proposed in chat</div>
        <ul class="sess-proposal-list">${proposals.map(renderProposalRow).join('')}</ul>
      </div>`;
}

/**
 * One worker-run row — expandable with per-run transcript + inline reply.
 *
 * `showReplyBox` (LIN-1478 S-C, default true): within a folded multi-run
 * lineage, only the TAIL's reply box renders, and it is hoisted to the
 * lineage container's footer rather than left inline in the tail's own card
 * (see `renderLineageGroup`) — so every non-tail (and, for the tail, its
 * would-be inline) box is suppressed here. A lineage of one never sets this,
 * so it stays byte-identical to pre-fold behavior.
 */
function renderRun(loop, options = {}) {
  const { urlKey = '', canReply = false, waiting = false, supersededLoopIds = EMPTY_SET, showReplyBox = true, credentialByToken = {}, loopCostsByLoopId = null, costCumulative = false, stepProposals = null } = options;
  const loopCost = loopCostsByLoopId ? (loopCostsByLoopId.get(loop.loopId ?? null) || null) : null;
  const costText = fmtLoopCost(loopCost, costCumulative);
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const sm = runStatusMeta(loop);
  const status = `<span class="sess-run-status status-pill status-pill--${sm.state}" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(sm.label)}</span>`;
  // LIN-1163 item 5: a visible flag on the (possibly collapsed) card face when
  // this run's own last WAKE marker (LIN-2264: semantic scan, not a literal
  // last-entry read) is `[blocked]`.
  const waitingFlag = runIsWaiting(loop, supersededLoopIds)
    ? `<span class="sess-run-waiting-flag" data-testid="session-run-waiting-flag">◐ waiting for input</span>`
    : '';
  // LIN-2244: a THIRD state, distinct from both "working" and "blocked on a
  // human" above — parked on a pending async wait (e.g. a ScheduleWakeup CI
  // poll), not real activity and not something a human needs to answer.
  // NOT guaranteed disjoint from waitingFlag by construction: since LIN-2264,
  // `runIsWaiting` matches a semantic wake marker of `blocked` (never
  // `pending` — LIN-1025), while `PARKED_WAIT_HINT` (lib/session-telemetry.js)
  // is a substring match anywhere in the text — a `[blocked]` message that
  // itself happens to mention "a scheduled wakeup" would satisfy both. The
  // explicit `!waitingFlag` gate is therefore real disambiguation, not a
  // redundant safety net, and it resolves in favor of blocked-on-a-human,
  // matching this ticket's "distinct from" acceptance criterion. (LIN-2264
  // note: `parseParkedWait` itself still reads `feedback[]`'s literal last
  // entry — the same positional-adjacency class this ticket fixed here — so
  // `loop.telemetry.parkedWait` is not yet reliable on real trailing-`[usage]`
  // data; that predicate's fix is tracked separately.)
  const parkedFlag = (!waitingFlag && loop.telemetry && loop.telemetry.parkedWait)
    ? `<span class="sess-run-parked-flag" data-testid="session-run-parked-flag">◐ parked on a wait since ${fmtTs(loop.telemetry.parkedWait.since)}</span>`
    : '';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';

  // LIN-1163 item 4: a genuinely finished run (terminalStatus set) shows its
  // completion time; a still-running run never shows the misleading
  // "completed —" — it shows an in-progress marker the client fills with
  // elapsed time computed from dispatchedAt.
  const runTerminal = !!loop.terminalStatus;
  const timesBody = runTerminal
    ? `<span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>`
    : `<span data-testid="session-run-elapsed" data-dispatched-at="${escapeHtml(String(loop.dispatchedAt || ''))}">in progress</span>`;

  const expandedBody = (() => {
    const pieces = [];
    // Per-run transcript — embedded feedback for client-side markdown rendering
    const txBlock = renderTranscriptEntries(loop);
    if (txBlock) pieces.push(txBlock);
    // Per-run inline reply — only when the session supports replies AND this
    // run is allowed to show one (suppressed for non-tail/tail-hoisted runs
    // inside a folded lineage — see `showReplyBox` above).
    if (canReply && showReplyBox && loop.loopId) {
      pieces.push(renderInlineReplyBox(loop, urlKey, waiting));
    }
    return pieces.length
      ? `<div class="sess-run-body" data-testid="session-run-body">${pieces.join('')}</div>`
      : '';
  })();

  // LIN-3254: proposals share the canReply-gated region with the reply box, but
  // unlike a reply box a PENDING proposal needs attention — so it renders in
  // the ALWAYS-VISIBLE part of the card, never inside the collapsed
  // `.sess-run-body`. Still gated by the same `canReply && showReplyBox` pair,
  // so guest mode hides it exactly as it hides the reply box. (A folded
  // lineage >1 hoists its block to the container footer instead; those runs are
  // rendered with `showReplyBox:false`, so this never double-renders.)
  const proposalBlock = (canReply && showReplyBox && loop.loopId)
    ? renderProposalBlock(stepProposals, urlKey)
    : '';

  return `<li class="sess-run" data-testid="session-run" data-status="${sm.state}" data-loop-id="${escapeHtml(String(loop.loopId || ''))}">
        <div class="sess-run-head" data-testid="session-run-toggle" role="button" tabindex="0" aria-expanded="false">
          <span class="sess-run-toggle-icon" aria-hidden="true">▸</span>
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status} ${waitingFlag} ${parkedFlag}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          ${timesBody}
          ${costText ? `<span class="sess-run-cost" data-testid="session-run-cost">${escapeHtml(costText)}</span>` : ''}
        </div>
        ${renderRunChips(loop.telemetry, loop.agentTokenId
          ? { state: resolveCredentialState(loop.agentTokenId, credentialByToken), label: loop.agentTokenLabel || null }
          : null)}
        ${renderTicketWalk(loop.telemetry && loop.telemetry.ticketWalk)}
        ${proposalBlock}
        ${expandedBody}
      </li>`;
}

/**
 * One lineage's rendering: a bare `renderRun()` for a group of one (NO added
 * chrome — a single-run session/lineage renders byte-identical to before this
 * fold, and that one run is trivially its own tail), or a `session-lineage`
 * container wrapping each constituent run's unchanged `renderRun()` output
 * for a group of two-or-more — still N addressable `session-run` segments
 * with their own `data-loop-id`s, testids and chips, just visually joined
 * under one lineage.
 *
 * Reply targeting + the `force` safety rule (LIN-1478 S-C, LIN-1252): the
 * lineage's ONE reply box is the TAIL's own box — `renderInlineReplyBox`
 * called on the tail loop, unmodified — hoisted to the container footer, not
 * synthesized or aggregated. Every constituent run (including the tail
 * itself) renders with its inline box suppressed so it isn't duplicated.
 * `data-terminal` therefore carries exactly the tail's own terminal status
 * and `data-loop-id` the tail's own id — replying targets the tail via
 * `followUpTo`, never the root, and `force` (derived client-side in
 * `public/session.js`, unchanged) can never be computed by aggregating
 * (`any()`/`all()`) over the lineage: an `any()` would kill-first a live tail
 * behind a done root, and an `all()` would omit `force` for a done tail
 * behind a running root and collide with the parked window (LIN-1252).
 */
function renderLineageGroup(group, options) {
  if (group.length === 1) return renderRun(group[0], options);
  const { urlKey = '', canReply = false, waiting = false, stepProposals = null } = options;
  const tail = group[group.length - 1];
  const runsHtml = group.map(l => renderRun(l, { ...options, showReplyBox: false })).join('');
  const replyHtml = (canReply && tail.loopId) ? renderInlineReplyBox(tail, urlKey, waiting) : '';
  // LIN-3254: the proposal block rides the SAME hoisted reply region, gated by
  // canReply, so it is hidden exactly when the reply box is.
  const proposalsHtml = (canReply && tail.loopId) ? renderProposalBlock(stepProposals, urlKey) : '';
  const lineageId = group[0].lineageId ?? group[0].loopId;
  return `<li class="sess-lineage" data-testid="session-lineage" data-lineage-id="${escapeHtml(String(lineageId || ''))}">
        <ul class="sess-lineage-runs">${runsHtml}</ul>
        ${replyHtml}${proposalsHtml}
      </li>`;
}

/**
 * "If you don't answer" line (LIN-3252 S2.3ii): the agent's own
 * `decision.if_unanswered.summary` when present, else a render fallback whose
 * wording depends on whether the session has ENDED — not on the effect
 * (`sessionTerminal`, not the disposition: a step can have ended while the
 * session is live). No validation path — fallback/guidance only.
 */
function ifUnansweredText(decision, sessionTerminal) {
  const summary = decision && decision.if_unanswered && decision.if_unanswered.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  return sessionTerminal
    ? 'Nothing further runs; the run has ended.'
    : 'Harbour keeps waiting for your answer.';
}

/**
 * One pinned question card shell (LIN-3252 S2). `case` chunks render verbatim,
 * each its own node, inside an expandable "why is Harbour asking? ›". A
 * read-only / non-interactive card shows that Harbour is still working and
 * offers no input. The "if you don't answer" line is always shown.
 *
 * The card carries the reply target (`data-loop-id`, the anchor/followUpTo) and
 * the stamp target (`data-stamp-loop-id`) separately — `collectUnansweredDecisions`
 * splits them for a lineage whose decision was raised on the root but whose
 * content loop is a later member — plus the parsed `if_unanswered` default.
 */
function renderQuestionCard(card) {
  const attrs = [
    'data-testid="session-question-card"',
    `data-url-key="${escapeHtml(card.urlKey || '')}"`,
    `data-loop-id="${escapeHtml(String(card.followUpTo || ''))}"`,
    `data-stamp-loop-id="${escapeHtml(String(card.stampLoopId || ''))}"`,
    `data-decision-id="${escapeHtml(String(card.decisionId || ''))}"`,
    `data-target="${escapeHtml(card.target || 'cli')}"`,
    `data-issue-id="${escapeHtml(String(card.issueId || ''))}"`,
    `data-issue-identifier="${escapeHtml(String(card.issueIdentifier || ''))}"`,
    `data-disposition="${escapeHtml(card.disposition || '')}"`,
    `data-session-waiting="${card.sessionWaiting ? 'true' : 'false'}"`
  ].join(' ');

  // `case` is a `string[]`, deliberately NOT pre-joined upstream — each chunk is
  // its own node, preserving boundaries. A chunk may already carry a
  // `(recap i/n)` header baked in by the emitter; rendered verbatim, never
  // re-derived or stripped here.
  const chunks = Array.isArray(card.case) ? card.case : [];
  const whyHtml = chunks.length
    ? `<details class="sess-qcard-why" data-testid="session-question-card-why">
        <summary class="sess-qcard-why-summary">why is Harbour asking? ›</summary>
        <div class="sess-qcard-case">${chunks.map(chunk => `<p class="sess-qcard-case-chunk" data-testid="session-question-card-why-chunk">${escapeHtml(String(chunk))}</p>`).join('')}</div>
      </details>`
    : '';

  let controlHtml;
  if (!card.interactive) {
    controlHtml = `<p class="sess-qcard-readonly" data-testid="session-question-card-readonly">Harbour is still working; you can answer when it pauses.</p>`;
  } else {
    const options = Array.isArray(card.options) ? card.options : [];
    const optionsHtml = options.length
      ? `<ul class="sess-qcard-options" data-testid="session-question-card-options">${options.map(o => `<li class="sess-qcard-option">
            <label class="sess-qcard-option-label">
              <input type="radio" class="sess-qcard-option-input" name="qcard-${escapeHtml(String(card.stampLoopId || card.decisionId || 'q'))}" data-option-id="${escapeHtml(String(o.id || ''))}" value="${escapeHtml(String(o.label || ''))}">
              <span class="sess-qcard-option-text" data-testid="session-question-card-option">${escapeHtml(String(o.label || ''))}</span>
            </label>
          </li>`).join('')}</ul>`
      : '';
    controlHtml = `${optionsHtml}
      <textarea class="sess-qcard-input" data-testid="session-question-card-input" rows="2" placeholder="your own answer…" aria-label="Your own answer"></textarea>
      <ul class="chat-thread" data-testid="session-question-card-thread" hidden></ul>
      <div class="sess-qcard-actions">
        <button type="button" class="action-btn sess-qcard-answer" data-testid="session-question-card-answer">Answer</button>
        ${card.dismissable ? '<button type="button" class="sess-qcard-dismiss" data-testid="session-question-card-dismiss">this wasn\'t worth asking</button>' : ''}
        <span class="sess-qcard-feedback sess-reply-feedback" role="status" aria-live="polite"></span>
      </div>`;
  }

  return `<div class="sess-qcard" ${attrs}>
      <p class="sess-qcard-question" data-testid="session-question-card-question">${escapeHtml(String(card.question))}</p>
      ${whyHtml}
      ${controlHtml}
      <p class="sess-qcard-if-unanswered" data-testid="session-question-card-if-unanswered">if you don't answer: ${escapeHtml(card.ifUnanswered)}</p>
    </div>`;
}

/** One decision row → its pinned card. */
function renderDecisionCard(row, { urlKey, canReply, sessionTerminal, sessionWaiting }) {
  const decision = (row && row.decision) || {};
  const anchor = (row && row.anchor) || {};
  const readOnly = row.disposition === 'mid-turn' || row.disposition === 'indeterminate';
  return renderQuestionCard({
    urlKey,
    followUpTo: anchor.loopId || '',
    stampLoopId: row.stampLoopId || anchor.loopId || '',
    decisionId: decision.decision_id || '',
    target: anchor.target || 'cli',
    issueId: anchor.issueId || '',
    issueIdentifier: anchor.issueIdentifier || '',
    disposition: row.disposition || '',
    sessionWaiting,
    question: decision.question ? String(decision.question) : 'Harbour needs your input.',
    case: Array.isArray(row.decisionCase) ? row.decisionCase : [],
    options: Array.isArray(decision.options) ? decision.options : [],
    ifUnanswered: ifUnansweredText(decision, sessionTerminal),
    interactive: !readOnly && row.canReply !== false && canReply,
    // Dismiss is offered on decision cards only, and only where input is
    // offered (never a read-only disposition) — see S2.5/C2.
    dismissable: true
  });
}

/**
 * A bare `[blocked]` waiting loop with no `DECISION:` row (LIN-3252 S2.7): the
 * second card source. Renders the worker's message, a free-text box and the one
 * verb "Answer" (sendReply with the session waiting → forces the resume), with
 * the live-session default. No dismiss — a blocker has no decision identity to
 * key the KPI on. `producer` carries the waiting loop's own reply target and
 * issue, so the follow-up resumes THAT run (never a hard-defaulted cli target);
 * its `case` is the loop's latest assistant text — the "why" fallback when a
 * bare blocker has no `decisionCase`.
 */
function renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const p = producer || {};
  const chunks = Array.isArray(decisionCase) && decisionCase.length
    ? decisionCase
    : (Array.isArray(p.case) ? p.case : []);
  return renderQuestionCard({
    urlKey,
    followUpTo: p.loopId || '',
    stampLoopId: p.loopId || '',
    decisionId: '',
    target: p.target || 'cli',
    issueId: p.issueId || '',
    issueIdentifier: p.issueIdentifier || '',
    disposition: 'resumable',
    sessionWaiting: true,
    question: String(waitingMessage),
    case: chunks,
    options: [],
    ifUnanswered: ifUnansweredText(null, sessionTerminal),
    interactive: canReply
  });
}

/**
 * The pinned question cards, above the steps (LIN-3252 S2). Primary source is
 * `decisions` (the route's waiting-independent read); when the session is
 * waiting on a `[blocked]` loop with no ruling row (`decision` is null) the
 * bare-blocked card is the second source. Rendering is NOT gated on `waiting`,
 * so a finished session's decision still shows — the S2 lift of the LIN-2184
 * gate. No dismiss control yet (S2 beat 3 leaves this as its natural place).
 */
function renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const cards = rows.map(row => renderDecisionCard(row, { urlKey, canReply, sessionTerminal, sessionWaiting: waiting }));
  if (!rows.length && waiting && waitingMessage && !decision) {
    cards.push(renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }));
  }
  return cards.length ? `<div class="sess-qcards">${cards.join('')}</div>` : '';
}

/**
 * The three recap groups, in render order. Each recap item is
 * `{ item, ... }` with a group-specific secondary field (`evidence`/`predicted`);
 * deviations additionally carry a short `type` tag. See lib/recap.js for the
 * schema the recap cache stores.
 */
const RECAP_GROUPS = [
  { key: 'done', label: 'Done', icon: '✓', secondary: 'evidence' },
  { key: 'pending', label: 'Pending', icon: '○', secondary: 'predicted' },
  { key: 'deviations', label: 'Deviations', icon: '◐', secondary: 'evidence' }
];

/**
 * Render a structured recap object (`{ done, pending, deviations }`, lib/recap.js)
 * into readable HTML — the fix for the `[object Object]` defect (LIN-1023): the
 * recap cache stores an OBJECT, not a Markdown string like the brief, so it must
 * never be interpolated via `String(recap)`. Renders one group per non-empty
 * section; an all-empty recap is honestly labelled rather than hidden.
 */
function renderRecapBody(recap) {
  const groups = RECAP_GROUPS.map(g => {
    const items = Array.isArray(recap?.[g.key]) ? recap[g.key] : [];
    if (!items.length) return '';
    const lis = items.map(it => {
      const what = escapeHtml(String(it?.item || ''));
      const tag = it?.type ? ` <span class="sess-recap-tag">${escapeHtml(String(it.type))}</span>` : '';
      const sub = it?.[g.secondary]
        ? `<span class="sess-recap-sub">${escapeHtml(String(it[g.secondary]))}</span>`
        : '';
      return `<li class="sess-recap-item">
            <span class="sess-recap-what">${what}${tag}</span>
            ${sub}
          </li>`;
    }).join('');
    return `<div class="sess-recap-group" data-testid="session-recap-${g.key}">
          <div class="sess-recap-group-head"><span class="sess-recap-icon" aria-hidden="true">${g.icon}</span> ${escapeHtml(g.label)}</div>
          <ul class="sess-recap-list">${lis}</ul>
        </div>`;
  }).filter(Boolean).join('');
  return groups
    ? `<div class="sess-ctx-recap" data-testid="session-recap-body">${groups}</div>`
    : '<p class="sess-ctx-body sess-muted" data-testid="session-recap-empty">recap generated but recorded no items</p>';
}

/**
 * Render a cached context body by its shape (LIN-1023): the brief is a Markdown
 * STRING (verbatim `<pre>`), the recap is a structured OBJECT (grouped lists).
 * Returns '' for an absent/unusable body so the panel falls through to the
 * cache-miss affordance — and, critically, NEVER stringifies an object into
 * `[object Object]`.
 */
function renderContextBody(kind, body) {
  if (body == null) return '';
  if (typeof body === 'string') {
    return body.trim() ? `<pre class="sess-ctx-body">${escapeHtml(body)}</pre>` : '';
  }
  if (kind === 'recap' && typeof body === 'object') return renderRecapBody(body);
  return '';
}

/** A brief or recap panel: cached body rendered server-side, tagged for client-side widget init. */
function renderContextPanel({ label, kind, issueIdentifier, issueId, body, model, generatedAt, urlKey }) {
  const widgetClass = kind === 'brief' ? 'brief-section' : 'recap-section';
  const idForWidget = issueIdentifier || issueId || '';
  const heading = `<div class="sess-ctx-head">
          <span class="sess-ctx-kind">${escapeHtml(label)}</span>
          <span class="sess-ctx-ident" data-testid="session-ctx-ident">${escapeHtml(idForWidget)}</span>
        </div>`;
  const renderedBody = renderContextBody(kind, body);
  if (renderedBody) {
    const meta = [
      model ? `model ${escapeHtml(String(model))}` : null,
      generatedAt ? `generated ${fmtTs(generatedAt)}` : null
    ].filter(Boolean).join(' · ');
    const widgetAttrs = `data-url-key="${escapeHtml(urlKey || '')}" data-identifier="${escapeHtml(idForWidget)}"`;
    return `<div class="sess-ctx-panel sess-ctx-panel--present ${widgetClass}" data-testid="session-${kind}" ${widgetAttrs}>
        ${heading}
        ${renderedBody}
        ${meta ? `<div class="sess-ctx-meta">${meta}</div>` : ''}
      </div>`;
  }
  const widgetAttrs = `data-url-key="${escapeHtml(urlKey || '')}" data-identifier="${escapeHtml(idForWidget)}"`;
  return `<div class="sess-ctx-panel sess-ctx-panel--miss ${widgetClass}" data-testid="session-${kind}" ${widgetAttrs}>
        ${heading}
        <p class="sess-ctx-miss" data-testid="session-${kind}-generate">○ no cached ${escapeHtml(label.toLowerCase())} — generate on demand from the task view (avoids auto-spending an LLM call on page load)</p>
      </div>`;
}

// ─── Run-page formatting (LIN-3250) — the renderer only formats the view model ─

/** A compact, human duration (`5m 0s`, `2h 3m`), or null when unknown. */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** A USD figure for a priced total (the plan forbids ever rendering `0`). */
function fmtUsd(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return `$${usd.toFixed(2)}`;
}

/** The heading's short run id — the session id, trimmed for a heading. */
function shortRunId(sessionId) {
  const id = String(sessionId || '');
  if (!id) return '';
  return id.length > 12 ? id.slice(0, 8) : id;
}

/** The distinct tiers across a run's steps; `not reported` only if nothing else. */
function tierRollup(steps) {
  const tiers = [];
  for (const step of steps) {
    if (step.tier && !tiers.includes(step.tier)) tiers.push(step.tier);
  }
  const known = tiers.filter(t => t !== 'not reported');
  const shown = known.length ? known : tiers;
  return shown.length ? shown.join(' · ') : null;
}

// Plain words for a step's kind (LIN-3250 review nit): operator kinds such as
// `autopilot`/`wake` never reach the page. Unknown kinds fall back to a
// capitalised form, so a new kind degrades gracefully instead of leaking.
const STEP_KIND_WORDS = {
  autopilot: 'Kick-off',
  wake: 'Check-in',
  plan: 'Plan',
  implementation: 'Build',
  review: 'Review',
  'close-out': 'Close-out',
  research: 'Research',
  bug: 'Bug fix',
};

function stepKindWord(kind) {
  if (!kind) return 'Step';
  return STEP_KIND_WORDS[kind] || kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * One per-loop cost cell from `step.loopCosts` (LIN-3250 plan §2): the lineage's
 * final loop carries the figure, earlier loops read "included in the step
 * total", an unpriced/missing/harness-only lineage reads "not reported". A
 * per-turn harness figure is labelled "as reported" (LIN-3230/LIN-1426); the
 * cumulative snapshot keeps the bare figure.
 */
function fmtLoopCost(loopCost, cumulative) {
  if (!loopCost) return null;
  if (loopCost.status === 'included') return 'included in the step total';
  if (loopCost.status === 'figure') {
    const usd = fmtUsd(loopCost.usd);
    if (!usd) return null;
    return cumulative ? usd : `${usd} as reported`;
  }
  return loopCost.label || 'not reported';
}

/** One-line step summary: plain-kind · status · tier, plus the cost wording. */
function stepSummary(step) {
  let line = step.summary;
  if (step.kind) line = stepKindWord(step.kind) + line.slice(String(step.kind).length);
  if (step.tier && step.tier !== 'not reported') line += ` · ${step.tier}`;
  if (step.cost && step.cost.status === 'priced') {
    const usd = fmtUsd(step.cost.usd);
    if (usd) line += step.cost.cumulative ? ` · ${usd}` : ` · ${usd} as reported`;
  } else {
    line += ` · ${(step.cost && step.cost.label) || 'not reported'}`;
  }
  return line;
}

/**
 * @param {Object} data
 * @param {Object|null} data.session   - non-lean reconstructed session, or null → 404 body
 * @param {string} [data.sessionId]    - the requested id (for the not-found body)
 * @param {Array}  [data.issueContext] - [{ issueIdentifier, issueId, brief, briefModel, briefGeneratedAt, recap, recapModel, recapGeneratedAt }]
 * @param {boolean} [data.waiting]       - session is paused on a human (LIN-1005) → render the alert banner AND make replies send `force:true` (LIN-1252)
 * @param {string|null} [data.waitingMessage] - the blocked/pending message text shown in the banner
 * @param {Object|null} [data.decision] - LIN-2184 (H5): the rollup's decision object (from the SAME producing loop as `waitingMessage`), used as the bare-blocked card's signal when no ruling row exists
 * @param {Array} [data.decisionCase] - LIN-2184 (H5): the correlated case body, a `string[]` of un-joined chunks
 * @param {string|null} [data.producer] - LIN-3252 S2.7: the waiting loop backing a bare-blocked card — its `loopId`/`target`/`issueId`/`issueIdentifier` and latest-assistant-text `case` (reply/resume target and "why" fallback)
 * @param {Array} [data.decisions] - LIN-3252 S2: the session's unanswered decisions from `collectUnansweredDecisions`, one pinned card each, shown whether or not the session is waiting
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render per-run inline reply (LIN-1004/LIN-1133), each scoped to its own run's `loop.target`
 * @param {boolean} [data.sessionTerminal] - the session is finalized → the Overview "completed" row renders the timestamp instead of in-progress/elapsed (LIN-1163)
 * @param {Object<string, string>} [data.credentialByToken] - LIN-1588: route-resolved `tokenId → verdict` index (Beat 1's verdict). Omitted → every run reads `unknown`, never a false `ok`
 * @param {string|null} [data.anchorIssueTitle] - LIN-1801: the anchor loop's human-readable issue title, rendered alongside the bare `session.seedIssue` identifier when distinct from it
 * @param {string} [data.urlKey]
 * @param {Object|null} [data.runEvidence] - LIN-3247: the run-evidence model (`{ state, evidence, ledger, closeOut }`). The ONE seam LIN-2948 replaces; when present, the evidence rows + close-out box mount at the top of the page.
 * @param {Object} [options]
 * @returns {string} Complete HTML document
 */
export function renderSessionPage(data = {}, options = {}) {
  const {
    session = null, sessionId = '', issueContext = [], urlKey = '',
    waiting = false, waitingMessage = null,
    decision = null, decisionCase = [], producer = null, decisions = [],
    canReply = false, sessionTerminal = false,
    credentialByToken = {}, anchorIssueTitle = null, runView = null,
    proposals = [], runEvidence = null, runParagraph = null
  } = data;
  const {
    deployInfo = {},
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {}
  } = options;

  const encodedUrlKey = escapeHtml(urlKey || '');
  const backHref = `/workspace/${encodeURIComponent(urlKey || '')}/observation`;
  const backLink = `<a class="sess-back" data-testid="session-back" href="${escapeHtml(backHref)}">← back to feed</a>`;

  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'observation', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/observation', urlKey, openRouterSource, featureFlags });

  // ── Not-found body (unknown / cross-workspace sessionId) ────────────────────
  if (!session) {
    const content = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: 'Session not found', headerClass: 'sess-header' })}
    ${renderSection({
      className: 'sess-section',
      title: 'Not found',
      body: `<p class="sess-notfound" data-testid="session-not-found">○ no session <code>${escapeHtml(sessionId || '')}</code> in this workspace.</p>`
    })}
  </main>
  ${footerHtml}`;
    return renderPage({
      title: 'Session not found',
      stylesheets: ['/style.css', '/common-actions.css', '/session.css', '/chat.css'],
      nav: navHtml,
      content
    });
  }

  // ── View model (LIN-3250) ───────────────────────────────────────────────────
  // The route builds this once and passes it; a direct call (unit tests) builds
  // it here. `buildRunView` stays the ONE place progress/cost/time are computed.
  const view = runView || buildRunView(session, { now: options.now });

  // LIN-1801: never render a title equal to the bare identifier as if it were
  // a separate title (LIN-783-class regression).
  const hasDistinctTitle = !!anchorIssueTitle && anchorIssueTitle !== session.seedIssue;
  const pageTitle = hasDistinctTitle ? anchorIssueTitle : (view.title || session.seedIssue || String(session.sessionId || ''));
  const docTitle = `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}${hasDistinctTitle ? ' — ' + escapeHtml(anchorIssueTitle) : ''}`;
  const headingHtml = `<span class="sess-heading-title" data-testid="session-title">${escapeHtml(pageTitle)}</span> <span class="sess-run-id" data-testid="session-run-id">Run ${escapeHtml(shortRunId(session.sessionId))}</span>`;

  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const tasksHtml = tasks.length
    ? tasks.map(t => `<span class="sess-task" data-testid="session-task">${escapeHtml(t)}</span>`).join('')
    : '<span class="sess-muted">no tasks recorded</span>';

  // ── Header strip ────────────────────────────────────────────────────────────
  const progressRow = `<div class="sess-kv"><span class="sess-k">progress</span><span class="sess-v" data-testid="session-progress">${escapeHtml(view.progress.label)}</span></div>`;
  const nextRow = view.next
    ? `<div class="sess-kv"><span class="sess-k">next</span><span class="sess-v" data-testid="session-next">Next: ${escapeHtml(view.next)}</span></div>`
    : '';
  const activeRow = `<div class="sess-kv"><span class="sess-k">active time</span><span class="sess-v" data-testid="session-active-time">${escapeHtml(fmtDuration(view.time.activeMs) || '—')}</span></div>`;
  const wallRow = `<div class="sess-kv"><span class="sess-k">wall clock</span><span class="sess-v" data-testid="session-elapsed" data-start="${escapeHtml(view.time.wall.start || '')}" data-end="${escapeHtml(view.time.wall.end || '')}">${escapeHtml(fmtDuration(view.time.wall.ms) || '—')}</span></div>`;
  const waitingRow = view.waiting.active
    ? `<div class="sess-kv"><span class="sess-k">waiting</span><span class="sess-v" data-testid="session-waiting-clock" data-since="${escapeHtml(view.waiting.since || '')}">waiting ${escapeHtml(fmtDuration(view.waiting.ms) || '—')}</span></div>`
    : '';
  const tierLabel = tierRollup(view.steps);
  const tierRow = tierLabel
    ? `<div class="sess-kv"><span class="sess-k">tier</span><span class="sess-v" data-testid="session-tiers">${escapeHtml(tierLabel)}</span></div>`
    : '';
  // Money ONLY when every lineage is priced and cumulative. Otherwise NO money
  // markup at all — no zero, no partial sum, no "not reported" placeholder.
  const moneyRow = view.cost.status === 'total'
    ? `<div class="sess-kv"><span class="sess-k">cost</span><span class="sess-v" data-testid="session-cost">${escapeHtml(fmtUsd(view.cost.usd) || '')}</span></div>`
    : '';
  const seedRow = session.seedIssue
    ? `<div class="sess-kv"><span class="sess-k">task</span><span class="sess-v" data-testid="session-seed">${escapeHtml(session.seedIssue)}</span>${hasDistinctTitle ? `<span class="sess-seed-title" data-testid="session-seed-title">${escapeHtml(anchorIssueTitle)}</span>` : ''}</div>`
    : '';
  // LIN-1588: the credential state is ALWAYS rendered — never blank and never
  // silently healthy. `agentTokenLabel` is display-only, escaped at the call
  // site per this file's raw-by-contract convention.
  const credential = rollupCredential(session.loops, credentialByToken);
  const credCopy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
  const credLabel = credential.label ? ` <span class="sess-cred-token">${escapeHtml(String(credential.label))}</span>` : '';
  const credentialRow = `<div class="sess-kv"><span class="sess-k">credential</span><span class="sess-v sess-cred" data-state="${escapeHtml(credential.state)}" data-testid="session-credential" title="${escapeHtml(credCopy.title)}">${escapeHtml(credCopy.label)}${credLabel}</span></div>`;

  const headerRows = [progressRow, nextRow, activeRow, wallRow, waitingRow, tierRow, moneyRow, seedRow, credentialRow].filter(Boolean).join('');
  // LIN-3254: "chat about this run" — a run-scoped task chat that proposes
  // instead of acting. Link only; the page's turn carries the run id.
  const runChatLink = session.sessionId
    ? `<a class="sess-run-chat" data-testid="session-run-chat" href="/workspace/${encodeURIComponent(urlKey || '')}/task-chat?task=${encodeURIComponent(session.seedIssue || '')}&run=${encodeURIComponent(session.sessionId)}">💬 chat about this run</a>`
    : '';
  const headerBody = `<div class="sess-kv-grid">${headerRows}</div>
      <div class="sess-tasks-block">
        <span class="sess-tasks-label">tasks touched</span>
        <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>
      </div>
      ${runChatLink}`;

  // ── Steps: a one-line summary above the existing per-loop rows ─────────────
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const supersededLoopIds = computeSupersededLoopIds(loops);
  const runOptions = { urlKey, canReply, waiting, supersededLoopIds, credentialByToken };
  // LIN-3254: match each proposal to the step whose lineage it belongs to (its
  // stepLoopId); a proposal whose stepLoopId matches no rendered loop falls
  // under the last step.
  const allLoopIds = new Set(loops.map(l => l.loopId));
  const lastStepIndex = view.steps.length - 1;
  const stepsBody = loops.length
    ? view.steps.map((step, stepIndex) => {
        const loopCostsByLoopId = new Map(step.loopCosts.map(c => [c.loopId, c]));
        const stepLoopIds = new Set(step.loops.map(l => l.loopId));
        const stepProposals = proposals.filter(p =>
          stepLoopIds.has(p.stepLoopId)
          || (stepIndex === lastStepIndex && !allLoopIds.has(p.stepLoopId))
        );
        return `<div class="sess-step" data-testid="session-step">
        <div class="sess-step-summary" data-testid="session-step-summary">${escapeHtml(stepSummary(step))}</div>
        <ul class="sess-runs">${renderLineageGroup(step.loops, { ...runOptions, loopCostsByLoopId, costCumulative: step.cost.cumulative, stepProposals })}</ul>
      </div>`;
      }).join('')
    : '<p class="sess-muted">no runs in this session</p>';

  // ── Context (brief + recap, cache-joined, tagged for client-side widgets) ─
  const contextBody = issueContext.length
    ? issueContext.map(ctx => `<div class="sess-ctx-issue">
        ${renderContextPanel({ label: 'Brief', kind: 'brief', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.brief, model: ctx.briefModel, generatedAt: ctx.briefGeneratedAt, urlKey })}
        ${renderContextPanel({ label: 'Recap', kind: 'recap', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.recap, model: ctx.recapModel, generatedAt: ctx.recapGeneratedAt, urlKey })}
      </div>`).join('')
    : '<p class="sess-muted" data-testid="session-context-empty">○ no task context available to join</p>';

  // ── Run paragraph (LIN-3253, S3): the slot S1 left ─────────────────────────
  // Present → the escaped text, and the slot stops being `aria-hidden`/`:empty`
  // (so `session.css` reveals it). A miss keeps S1's empty, hidden placeholder.
  const paragraphText = typeof runParagraph === 'string' ? runParagraph.trim() : '';
  const paragraphSlot = paragraphText
    ? `<div class="sess-paragraph-slot sess-paragraph" data-testid="session-paragraph"><p class="sess-paragraph-text" data-testid="session-paragraph-text">${escapeHtml(paragraphText)}</p></div>`
    : '<div class="sess-paragraph-slot" data-testid="session-paragraph" aria-hidden="true"></div>';

  const content = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'sess-header' })}
    ${renderRunEvidence(runEvidence)}
    ${renderSection({ className: 'sess-section sess-run-header', body: headerBody })}
    ${paragraphSlot}
    ${renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal })}
    ${renderSection({ className: 'sess-section sess-steps', title: 'Steps', body: stepsBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: docTitle,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css', '/chat.css'],
    nav: navHtml,
    content,
    scripts: ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/session.js']
  });
}
