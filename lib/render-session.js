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

/**
 * Credential state for ONE run, from the injected tokenId → verdict index
 * (LIN-1588, Beat 2 of LIN-1577).
 *
 * The RULE — what makes a credential dead — is `credentialVerdict` in
 * lib/proxy-events.js (LIN-1586) and runs exactly once, inside the store read the
 * route performs. Nothing here re-derives it; this maps that verdict onto the
 * three states the page shows. Deliberately NOT imported from lib/live-console.js:
 * C1 and C3 are independent surfaces (the Live Console is flag-gated and
 * experimental, this page is first-class and un-flagged), and coupling the
 * default-path page to an experimental module to share three lines of
 * presentation would be the worse trade.
 *
 * `null` and "not in the index" both mean `unknown`. No recent evidence is never
 * evidence of health — `ok` is only ever asserted when the predicate said so.
 *
 * @param {Object} loop
 * @param {Object<string, string>} credentialByToken
 * @returns {{state: 'dead'|'ok'|'unknown', label: string|null}}
 */
function resolveRunCredential(loop, credentialByToken) {
  const tokenId = loop && loop.agentTokenId != null ? loop.agentTokenId : null;
  const label = loop && loop.agentTokenLabel != null ? loop.agentTokenLabel : null;
  if (tokenId == null) return { state: 'unknown', label };
  const verdict = credentialByToken ? credentialByToken[tokenId] : undefined;
  if (verdict == null) return { state: 'unknown', label };
  return { state: verdict === 'credential_dead' ? 'dead' : 'ok', label };
}

/**
 * The session-level rollup shown in the Overview: a session is only as healthy as
 * its worst run. One dead credential makes the session dead — that is the whole
 * "which of my four trees is dead?" question this ticket exists to answer — and a
 * session with nothing but unknown runs stays `unknown`, never promoted to `ok`.
 *
 * @param {Array<Object>} loops
 * @param {Object<string, string>} credentialByToken
 * @returns {{state: 'dead'|'ok'|'unknown', label: string|null}}
 */
function resolveSessionCredential(loops, credentialByToken) {
  let best = { state: 'unknown', label: null };
  for (const loop of loops) {
    const cred = resolveRunCredential(loop, credentialByToken);
    if (cred.state === 'dead') return cred;
    if (cred.state === 'ok' && best.state === 'unknown') best = cred;
    else if (best.state === 'unknown' && best.label == null && cred.label != null) best = { ...best, label: cred.label };
  }
  return best;
}

// Copy for each credential state. `unknown` is the ORDINARY case (~99.86% of
// dispatches carry no joinable agent-status row, LIN-1585), so on this
// un-flagged, first-class page it must read as calm and normal rather than as an
// alarm. `ok` does not overclaim: Beat 1's verdict means "no death evidence in
// the last 15 minutes", not "verified healthy".
const CREDENTIAL_COPY = {
  dead:    { text: 'dead', title: 'authenticated, but the workspace token has no owner — this worker cannot do workspace work' },
  ok:      { text: 'no faults seen', title: 'no credential failures in the last 15 min' },
  unknown: { text: 'unknown', title: 'no recent credential evidence for this session' },
};

/**
 * Per-run telemetry chips (metric count, runtime, artifacts, model?), plus the
 * credential chip when this run carries a token of its own (LIN-1588).
 *
 * `credential` is optional and defaults to null, so every existing caller and
 * test keeps byte-identical output.
 */
function renderRunChips(telemetry, credential = null) {
  const chips = [];
  if (telemetry) {
    const runtime = fmtRuntime(telemetry.runtime);
    if (runtime) chips.push(`<span class="sess-chip" data-testid="session-run-runtime">⏱ ${escapeHtml(runtime)}</span>`);
    const metricCount = Array.isArray(telemetry.metrics) ? telemetry.metrics.length : 0;
    if (metricCount) chips.push(`<span class="sess-chip" data-testid="session-run-metrics">◐ ${metricCount} heartbeats</span>`);
    const artifactCount = Array.isArray(telemetry.producedArtifacts) ? telemetry.producedArtifacts.length : 0;
    if (artifactCount) chips.push(`<span class="sess-chip" data-testid="session-run-artifacts">✎ ${artifactCount} artifacts</span>`);
    if (telemetry.model) chips.push(`<span class="sess-chip" data-testid="session-run-model">◇ ${escapeHtml(telemetry.model)}</span>`);
  }
  // Only runs that actually carry a credential get a chip — an `unknown` chip on
  // every run would be noise on the ~99.86% path, and the Overview line already
  // states the session's credential state unconditionally.
  if (credential && credential.state !== 'unknown') {
    const copy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
    // `agentTokenLabel` is display-only and attacker-influenced, so it escapes at
    // the CALL SITE — this file's raw-by-contract convention (8aa32eaf, LIN-1567).
    const label = credential.label ? ` ${escapeHtml(String(credential.label))}` : '';
    chips.push(`<span class="sess-chip sess-chip--cred" data-testid="session-run-credential" data-state="${escapeHtml(credential.state)}" title="${escapeHtml(copy.title)}">⚿ cred ${escapeHtml(copy.text)}${label}</span>`);
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
// LIN-1588: the no-credentials-resolved default. Every run then reads `unknown`,
// which is exactly what an absent read should mean.
const EMPTY_CREDENTIALS = Object.freeze({});

/** Encode per-run feedback entries as a JSON data attribute for client-side rendering. */
function encodeFeedbackJSON(feedback) {
  const safe = Array.isArray(feedback)
    ? feedback.map(e => ({ message: e.message || '', url: e.url || null, urlLabel: e.urlLabel || null, timestamp: e.timestamp || null, blocked: isBlockedEntry(e.message) }))
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
 */
function renderInlineReplyBox(loop, urlKey, waiting = false) {
  const terminal = loop.terminalStatus === 'done' || loop.terminalStatus === 'failed';
  const attrs = [
    'data-testid="session-inline-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-loop-id="${escapeHtml(String(loop.loopId || ''))}"`,
    `data-target="${escapeHtml(loop.target || 'cli')}"`,
    `data-terminal="${terminal ? 'true' : 'false'}"`,
    `data-session-waiting="${waiting ? 'true' : 'false'}"`
  ].join(' ');
  // LIN-1298: adopt the shared Task Chat conversational idiom — an echo thread the
  // client fills with a "you" bubble on send, above a chat composer. The
  // interactive hooks (classes + testids) are unchanged, so session.js and the
  // existing tests keep working; only the surrounding chrome is conversational.
  return `<div class="sess-inline-reply" ${attrs}>
      <ul class="chat-thread" data-testid="session-inline-reply-thread" hidden></ul>
      <div class="chat-composer">
        <textarea class="sess-inline-reply-input chat-composer__input" rows="2" placeholder="Reply to this run…" aria-label="Reply to this run"></textarea>
        <div class="sess-inline-reply-actions chat-composer__actions">
          <button type="button" class="action-btn sess-reply-send" data-testid="session-inline-reply-send">send reply</button>
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
  const { urlKey = '', canReply = false, waiting = false, supersededLoopIds = EMPTY_SET, showReplyBox = true, credentialByToken = EMPTY_CREDENTIALS } = options;
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
        ${renderRunChips(loop.telemetry, resolveRunCredential(loop, credentialByToken))}
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
 */
function renderWaitingBanner(waiting, waitingMessage) {
  if (!waiting) return '';
  const msg = waitingMessage
    ? `<p class="sess-waiting-msg" data-testid="session-waiting-message">${escapeHtml(String(waitingMessage))}</p>`
    : '';
  return `<div class="sess-waiting" role="alert" data-testid="session-waiting-banner">
      <div class="sess-waiting-head">
        <span class="sess-waiting-icon" aria-hidden="true">◐</span>
        <span class="sess-waiting-title">Waiting on you</span>
      </div>
      ${msg}
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
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render per-run inline reply (LIN-1004/LIN-1133), each scoped to its own run's `loop.target`
 * @param {boolean} [data.sessionTerminal] - the session is finalized → the Overview "completed" row renders the timestamp instead of in-progress/elapsed (LIN-1163)
 * @param {string} [data.urlKey]
 * @param {Object} [options]
 * @returns {string} Complete HTML document
 */
export function renderSessionPage(data = {}, options = {}) {
  const {
    session = null, sessionId = '', issueContext = [], urlKey = '',
    waiting = false, waitingMessage = null,
    canReply = false, sessionTerminal = false,
    credentialByToken = EMPTY_CREDENTIALS
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
  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const tasksHtml = tasks.length
    ? tasks.map(t => `<span class="sess-task" data-testid="session-task">${escapeHtml(t)}</span>`).join('')
    : '<span class="sess-muted">no tasks recorded</span>';

  const sessTelemetry = session.telemetry || {};
  const sessRuntime = fmtRuntime(sessTelemetry.runtime);

  // LIN-1588 — per-session credential state, rolled up from this session's runs
  // over the verdict index the route resolved via Beat 1's predicate. Rendered
  // UNCONDITIONALLY: the answer to "is this worker's credential dead?" is never
  // blank, and on the ordinary path it says `unknown` rather than implying health.
  const sessionLoops = Array.isArray(session.loops) ? session.loops : [];
  const sessCredential = resolveSessionCredential(sessionLoops, credentialByToken);
  const sessCredCopy = CREDENTIAL_COPY[sessCredential.state] || CREDENTIAL_COPY.unknown;
  // `agentTokenLabel` is display-only and attacker-influenced — escaped HERE, at
  // the call site, per this file's raw-by-contract convention (8aa32eaf, LIN-1567).
  const sessCredLabel = sessCredential.label
    ? ` <span class="sess-cred-label">${escapeHtml(String(sessCredential.label))}</span>`
    : '';
  const credentialRow = `<div class="sess-kv"><span class="sess-k">credential</span><span class="sess-v sess-cred" data-testid="session-credential" data-state="${escapeHtml(sessCredential.state)}" title="${escapeHtml(sessCredCopy.title)}">${escapeHtml(sessCredCopy.text)}${sessCredLabel}</span></div>`;
  // LIN-1163 item 4: apply the same in-progress/elapsed treatment to the
  // session-level "completed" row (identical defect, same page).
  const completedRow = sessionTerminal
    ? `<div class="sess-kv"><span class="sess-k">completed</span><span class="sess-v">${fmtTs(session.completedAt)}</span></div>`
    : `<div class="sess-kv"><span class="sess-k">completed</span><span class="sess-v" data-testid="session-elapsed" data-dispatched-at="${escapeHtml(String(session.dispatchedAt || ''))}">in progress</span></div>`;
  const overviewRows = [
    session.seedIssue ? `<div class="sess-kv"><span class="sess-k">seed</span><span class="sess-v" data-testid="session-seed">${escapeHtml(session.seedIssue)}</span></div>` : '',
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
    ${renderPageHeader({ titleHtml: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}`, headerClass: 'sess-header' })}
    ${renderWaitingBanner(waiting, waitingMessage)}
    ${renderSection({ className: 'sess-section sess-overview', title: 'Overview', body: overviewBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
    ${renderSection({ className: 'sess-section sess-runs-section', title: 'Runs', body: runsBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css', '/chat.css'],
    nav: navHtml,
    content,
    scripts: ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/session.js']
  });
}
