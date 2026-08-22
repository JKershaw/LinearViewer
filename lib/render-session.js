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
    if (telemetry.model) chips.push(`<span class="sess-chip" data-testid="session-run-model">◇ ${escapeHtml(telemetry.model)}</span>`);
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
 * from the run's OWN last feedback entry — deliberately NOT the session-level
 * `waiting` rollup (which is keyed session-wide and can't say *which* run is
 * parked; see `renderInlineReplyBox` above). A run only counts as waiting while
 * it is itself non-terminal — a finished run's last entry could still carry a
 * `[blocked]` marker from earlier in its life, and that's not "waiting" anymore.
 * A run superseded by a follow-up loop (see `computeSupersededLoopIds`) is also
 * excluded — it has since been replied to, even though its own stale feedback
 * still ends on a blocked marker.
 */
function runIsWaiting(loop, supersededLoopIds = EMPTY_SET) {
  if (loop.terminalStatus) return false;
  if (supersededLoopIds.has(loop.loopId)) return false;
  const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (!entries.length) return false;
  return isBlockedEntry(entries[entries.length - 1]?.message);
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
  ].join(' ');
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
  const { urlKey = '', canReply = false, waiting = false, supersededLoopIds = EMPTY_SET, showReplyBox = true, credentialByToken = {} } = options;
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const sm = runStatusMeta(loop);
  const status = `<span class="sess-run-status status-pill status-pill--${sm.state}" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(sm.label)}</span>`;
  // LIN-1163 item 5: a visible flag on the (possibly collapsed) card face when
  // this run's own last feedback entry is a `[blocked]`/`[pending]` marker.
  const waitingFlag = runIsWaiting(loop, supersededLoopIds)
    ? `<span class="sess-run-waiting-flag" data-testid="session-run-waiting-flag">◐ waiting for input</span>`
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

  return `<li class="sess-run" data-testid="session-run" data-status="${sm.state}" data-loop-id="${escapeHtml(String(loop.loopId || ''))}">
        <div class="sess-run-head" data-testid="session-run-toggle" role="button" tabindex="0" aria-expanded="false">
          <span class="sess-run-toggle-icon" aria-hidden="true">▸</span>
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status} ${waitingFlag}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          ${timesBody}
        </div>
        ${renderRunChips(loop.telemetry, loop.agentTokenId
          ? { state: resolveCredentialState(loop.agentTokenId, credentialByToken), label: loop.agentTokenLabel || null }
          : null)}
        ${expandedBody}
      </li>`;
}

/**
 * Group a session's loops by lineage (LIN-1478 S-C: fold the card chrome, not
 * the run nodes) — `loop.lineageId ?? loop.loopId` (the same `item.rootItemId
 * ?? loop.loopId` key `lib/pipeline-loops.js` already derives; never
 * backfilled here), preserving the ORDER loops already come in from
 * `_assembleSession` (ascending `dispatchedAt`, `loopId` tiebreak —
 * `lib/pipeline-loops.js:616-621`). A lineage's loops are moved together at
 * its first-seen position, not left interleaved with other lineages/loops
 * that happen to fall between them in time.
 *
 * Tail = the LAST loop in a group, in this same order. This is unambiguous
 * only because a lineage is a linear chain: siblings never share a
 * `rootItemId` (the two-tier rule at `lib/dispatch-store.js:31`). If that
 * rule ever grew a third (`sessionId`) tier, siblings would collapse into one
 * lineage and "tail" would become arbitrary — see LIN-1461.
 *
 * @param {Array<Object>} loops
 * @returns {Array<Array<Object>>} groups, each one lineage's loops in order
 */
function groupLoopsByLineage(loops) {
  const order = [];
  const byLineage = new Map();
  for (const loop of loops) {
    const key = loop.lineageId ?? loop.loopId;
    if (!byLineage.has(key)) {
      byLineage.set(key, []);
      order.push(key);
    }
    byLineage.get(key).push(loop);
  }
  return order.map(key => byLineage.get(key));
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
  const { urlKey = '', canReply = false, waiting = false } = options;
  const tail = group[group.length - 1];
  const runsHtml = group.map(l => renderRun(l, { ...options, showReplyBox: false })).join('');
  const replyHtml = (canReply && tail.loopId) ? renderInlineReplyBox(tail, urlKey, waiting) : '';
  const lineageId = group[0].lineageId ?? group[0].loopId;
  return `<li class="sess-lineage" data-testid="session-lineage" data-lineage-id="${escapeHtml(String(lineageId || ''))}">
        <ul class="sess-lineage-runs">${runsHtml}</ul>
        ${replyHtml}
      </li>`;
}

/**
 * The prominent "waiting on you" alert banner (LIN-1005). Rendered at the top of
 * the session page when the session is paused on a human — an agent-status
 * `blocked` run and/or a latest `[blocked]`/`[pending]` feedback marker (the
 * route computes the rollup; this only renders it). V1 treats a live unanswered
 * question and a longer-term close-out blocker identically — the message text
 * carries the distinction — and directs the human to the Phase 2 follow-up box.
 *
 * LIN-2184 (H5): when the rollup carries a `decision` (H3/H4's already-formed
 * loop-level fields, consumed here — never re-derived), the banner is the
 * first real consumer of the `renderSessionPage` prop-bag seam H4's review
 * left inert. Renders the full case, from its chunks, plus option labels.
 * Full prose is acceptable on THIS surface (unlike the feed card's bounded
 * excerpt, beat 4) — the operator is already on the page. The gate stays
 * `!waiting` exactly as before: a decision only ever renders on a waiting
 * loop here, same as the plain message above it.
 */
function renderWaitingBanner(waiting, waitingMessage, decision = null, decisionCase = []) {
  if (!waiting) return '';
  const msg = waitingMessage
    ? `<p class="sess-waiting-msg" data-testid="session-waiting-message">${escapeHtml(String(waitingMessage))}</p>`
    : '';
  // `decisionCase` is a `string[]`, deliberately NOT pre-joined upstream (H3's
  // correlateDecisionCase) — render each chunk as its own node, preserving
  // chunk boundaries. A chunk may itself already carry a `(recap i/n)`-style
  // header baked into its text by the emitter (simple-dispatcher's chunker) —
  // rendered verbatim, never re-derived or stripped here.
  const decisionHtml = decision ? (() => {
    const question = decision.question
      ? `<p class="sess-waiting-decision-question" data-testid="session-waiting-decision-question">${escapeHtml(String(decision.question))}</p>`
      : '';
    const caseChunks = Array.isArray(decisionCase) ? decisionCase : [];
    const caseHtml = caseChunks.length
      ? `<div class="sess-waiting-decision-case" data-testid="session-waiting-decision-case">${caseChunks.map(chunk => `<p class="sess-waiting-decision-case-chunk" data-testid="session-waiting-decision-case-chunk">${escapeHtml(String(chunk))}</p>`).join('')}</div>`
      : '';
    const options = Array.isArray(decision.options) ? decision.options : [];
    const optionsHtml = options.length
      ? `<ul class="sess-waiting-decision-options" data-testid="session-waiting-decision-options">${options.map(o => `<li class="sess-waiting-decision-option" data-testid="session-waiting-decision-option">${escapeHtml(String(o.label))}</li>`).join('')}</ul>`
      : '';
    return `<div class="sess-waiting-decision" data-testid="session-waiting-decision">${question}${caseHtml}${optionsHtml}</div>`;
  })() : '';
  return `<div class="sess-waiting" role="alert" data-testid="session-waiting-banner">
      <div class="sess-waiting-head">
        <span class="sess-waiting-icon" aria-hidden="true">◐</span>
        <span class="sess-waiting-title">Waiting on you</span>
      </div>
      ${msg}
      ${decisionHtml}
      <p class="sess-waiting-cta" data-testid="session-waiting-cta">This session is paused and needs your input — reply in the run's own reply box below to continue it.</p>
    </div>`;
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

/**
 * @param {Object} data
 * @param {Object|null} data.session   - non-lean reconstructed session, or null → 404 body
 * @param {string} [data.sessionId]    - the requested id (for the not-found body)
 * @param {Array}  [data.issueContext] - [{ issueIdentifier, issueId, brief, briefModel, briefGeneratedAt, recap, recapModel, recapGeneratedAt }]
 * @param {boolean} [data.waiting]       - session is paused on a human (LIN-1005) → render the alert banner AND make replies send `force:true` (LIN-1252)
 * @param {string|null} [data.waitingMessage] - the blocked/pending message text shown in the banner
 * @param {Object|null} [data.decision] - LIN-2184 (H5): the rollup's decision object (from the SAME producing loop as `waitingMessage`), rendered on the waiting banner when present
 * @param {Array} [data.decisionCase] - LIN-2184 (H5): the correlated case body, a `string[]` of un-joined chunks, rendered on the waiting banner alongside `decision`
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render per-run inline reply (LIN-1004/LIN-1133), each scoped to its own run's `loop.target`
 * @param {boolean} [data.sessionTerminal] - the session is finalized → the Overview "completed" row renders the timestamp instead of in-progress/elapsed (LIN-1163)
 * @param {Object<string, string>} [data.credentialByToken] - LIN-1588: route-resolved `tokenId → verdict` index (Beat 1's verdict). Omitted → every run reads `unknown`, never a false `ok`
 * @param {string|null} [data.anchorIssueTitle] - LIN-1801: the anchor loop's human-readable issue title, rendered alongside the bare `session.seedIssue` identifier when distinct from it
 * @param {string} [data.urlKey]
 * @param {Object} [options]
 * @returns {string} Complete HTML document
 */
export function renderSessionPage(data = {}, options = {}) {
  const {
    session = null, sessionId = '', issueContext = [], urlKey = '',
    waiting = false, waitingMessage = null,
    decision = null, decisionCase = [],
    canReply = false, sessionTerminal = false,
    credentialByToken = {}, anchorIssueTitle = null
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

  // ── Overview ────────────────────────────────────────────────────────────────
  // LIN-1801: never render a title equal to the bare identifier as if it were
  // a separate title (LIN-783-class regression).
  const hasDistinctTitle = !!anchorIssueTitle && anchorIssueTitle !== session.seedIssue;
  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const tasksHtml = tasks.length
    ? tasks.map(t => `<span class="sess-task" data-testid="session-task">${escapeHtml(t)}</span>`).join('')
    : '<span class="sess-muted">no tasks recorded</span>';

  const sessTelemetry = session.telemetry || {};
  const sessRuntime = fmtRuntime(sessTelemetry.runtime);
  // LIN-1163 item 4: apply the same in-progress/elapsed treatment to the
  // session-level "completed" row (identical defect, same page).
  const completedRow = sessionTerminal
    ? `<div class="sess-kv"><span class="sess-k">completed</span><span class="sess-v">${fmtTs(session.completedAt)}</span></div>`
    : `<div class="sess-kv"><span class="sess-k">completed</span><span class="sess-v" data-testid="session-elapsed" data-dispatched-at="${escapeHtml(String(session.dispatchedAt || ''))}">in progress</span></div>`;
  // LIN-1588: the session's credential state, ALWAYS rendered — never blank and
  // never silently healthy. `agentTokenLabel` is display-only (labels are shared
  // across concurrent sessions and historical rows keep `'exchanged'`), so it is
  // shown as trailing context and never used to key or join anything. Escaped
  // here at the call site, per this file's raw-by-contract convention.
  const credential = rollupCredential(session.loops, credentialByToken);
  const credCopy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
  const credLabel = credential.label ? ` <span class="sess-cred-token">${escapeHtml(String(credential.label))}</span>` : '';
  const credentialRow = `<div class="sess-kv"><span class="sess-k">credential</span><span class="sess-v sess-cred" data-state="${escapeHtml(credential.state)}" data-testid="session-credential" title="${escapeHtml(credCopy.title)}">${escapeHtml(credCopy.label)}${credLabel}</span></div>`;

  const overviewRows = [
    session.seedIssue ? `<div class="sess-kv"><span class="sess-k">seed</span><span class="sess-v" data-testid="session-seed">${escapeHtml(session.seedIssue)}</span>${hasDistinctTitle ? `<span class="sess-seed-title" data-testid="session-seed-title">${escapeHtml(anchorIssueTitle)}</span>` : ''}</div>` : '',
    `<div class="sess-kv"><span class="sess-k">session id</span><span class="sess-v">${escapeHtml(String(session.sessionId || ''))}</span></div>`,
    `<div class="sess-kv"><span class="sess-k">dispatched</span><span class="sess-v">${fmtTs(session.dispatchedAt)}</span></div>`,
    completedRow,
    sessRuntime ? `<div class="sess-kv"><span class="sess-k">runtime</span><span class="sess-v">${escapeHtml(sessRuntime)}</span></div>` : '',
    sessTelemetry.model ? `<div class="sess-kv"><span class="sess-k">model</span><span class="sess-v" data-testid="session-model">${escapeHtml(String(sessTelemetry.model))}</span></div>` : '',
    credentialRow
  ].filter(Boolean).join('');

  const overviewBody = `<div class="sess-kv-grid">${overviewRows}</div>
      <div class="sess-tasks-block">
        <span class="sess-tasks-label">tasks touched</span>
        <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>
      </div>`;

  // ── Per-run expandable cards + per-run transcripts merged ─────────────────
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const supersededLoopIds = computeSupersededLoopIds(loops);
  const lineageGroups = groupLoopsByLineage(loops);
  const runOptions = { urlKey, canReply, waiting, supersededLoopIds, credentialByToken };
  const runsBody = loops.length
    ? `<ul class="sess-runs">${lineageGroups.map(g => renderLineageGroup(g, runOptions)).join('')}</ul>`
    : '<p class="sess-muted">no runs in this session</p>';

  // ── Context (brief + recap, cache-joined, tagged for client-side widgets) ─
  const contextBody = issueContext.length
    ? issueContext.map(ctx => `<div class="sess-ctx-issue">
        ${renderContextPanel({ label: 'Brief', kind: 'brief', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.brief, model: ctx.briefModel, generatedAt: ctx.briefGeneratedAt, urlKey })}
        ${renderContextPanel({ label: 'Recap', kind: 'recap', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.recap, model: ctx.recapModel, generatedAt: ctx.recapGeneratedAt, urlKey })}
      </div>`).join('')
    : '<p class="sess-muted" data-testid="session-context-empty">○ no task context available to join</p>';

  const content = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}${hasDistinctTitle ? ' — ' + escapeHtml(anchorIssueTitle) : ''}`, headerClass: 'sess-header' })}
    ${renderWaitingBanner(waiting, waitingMessage, decision, decisionCase)}
    ${renderSection({ className: 'sess-section sess-overview', title: 'Overview', body: overviewBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
    ${renderSection({ className: 'sess-section sess-runs-section', title: 'Runs', body: runsBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}${hasDistinctTitle ? ' — ' + escapeHtml(anchorIssueTitle) : ''}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css', '/chat.css'],
    nav: navHtml,
    content,
    scripts: ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/session.js']
  });
}
