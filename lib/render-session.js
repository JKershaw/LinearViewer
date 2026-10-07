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
import { taskPageHref } from './task-page-href.js';
import { buildRunView } from './run-view.js';
import { renderEvidence, renderCloseOutBox } from './render-run-evidence.js';
import { prStateCopy } from './pr-state-copy.js';
import {
  renderStepFace,
  runStatusMeta,
  renderContextPanel,
  stepKindWord,
  fmtDuration,
  fmtUsd,
  CREDENTIAL_COPY,
} from './render-run-steps.js';

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
 * Deliberately NO `data-source` for the dispatch-collection `loop.source`
 * ('live'/'history') — that is not provider provenance. The issue's OWN binding
 * provenance is the separate `data-source`/`data-binding-scope` pair below
 * (LIN-3126 residual), read off `loop.issueSource`/`loop.issueBindingScope` so
 * the run page's reply and Close out senders forward the issue's binding. Emitted
 * only when stamped, so an unstamped/legacy run stays byte-identical.
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
    `data-issue-identifier="${escapeHtml(String(loop.issueIdentifier || ''))}"`,
    loop.issueSource ? `data-source="${escapeHtml(String(loop.issueSource))}"` : '',
    loop.issueBindingScope ? `data-binding-scope="${escapeHtml(String(loop.issueBindingScope))}"` : ''
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
 * the reply box (so a non-owner view, which hides reply boxes, hides this too), and
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
 * LIN-3328: the row's always-visible *face* (head, title, times, chips, ticket
 * walk) is `renderStepFace` from `lib/render-run-steps.js`, shared with the task
 * page; this function composes it with the run-page-only proposal block and the
 * transcript/reply body and wraps it in the `<li>`. Output is byte-identical.
 *
 * `showReplyBox` (LIN-1478 S-C, default true): within a folded multi-run
 * lineage, only the TAIL's reply box renders, and it is hoisted to the
 * lineage container's footer rather than left inline in the tail's own card
 * (see `renderLineageGroup`) — so every non-tail (and, for the tail, its
 * would-be inline) box is suppressed here. A lineage of one never sets this,
 * so it stays byte-identical to pre-fold behavior.
 */
function renderRun(loop, options = {}) {
  const { urlKey = '', canReply = false, waiting = false, showReplyBox = true, stepProposals = null } = options;
  const sm = runStatusMeta(loop);

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
  // so a non-owner view hides it exactly as it hides the reply box. (A folded
  // lineage >1 hoists its block to the container footer instead; those runs are
  // rendered with `showReplyBox:false`, so this never double-renders.)
  const proposalBlock = (canReply && showReplyBox && loop.loopId)
    ? renderProposalBlock(stepProposals, urlKey)
    : '';

  return `<li class="sess-run" data-testid="session-run" data-status="${sm.state}" data-loop-id="${escapeHtml(String(loop.loopId || ''))}">
        ${renderStepFace(loop, options)}
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
    // LIN-3126 residual: the ruling anchor's own binding pair, so the run-page
    // card's answer/dismiss senders forward the issue's binding. Sparse.
    card.source ? `data-source="${escapeHtml(String(card.source))}"` : '',
    card.bindingScope ? `data-binding-scope="${escapeHtml(String(card.bindingScope))}"` : '',
    `data-disposition="${escapeHtml(card.disposition || '')}"`,
    `data-effect="${escapeHtml(card.effect || '')}"`,
    `data-record-on="${escapeHtml(card.recordOn || '')}"`,
    `data-session-waiting="${card.sessionWaiting ? 'true' : 'false'}"`
  ].filter(Boolean).join(' ');

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
    source: anchor.source || '',
    bindingScope: anchor.bindingScope || '',
    disposition: row.disposition || '',
    effect: row.effect || '',
    recordOn: (decision.on_answer && decision.on_answer.record_on) || '',
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
    source: p.issueSource || '',
    bindingScope: p.issueBindingScope || '',
    disposition: 'resumable',
    effect: 'resume',
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

// ─── Run-page formatting (LIN-3250) — the renderer only formats the view model ─

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
 * The LIN-3251 header PR line, extracted (LIN-3311) so it has one emitter.
 * Owner output is pinned byte-for-byte by
 * `tests/unit/render-session-golden.test.js`: the owner passes
 * the poll URL beat 3's client poll reads and the run's liveness.
 *
 * @param {Object} args
 * @param {string} args.text     - the line copy (already chosen; escaped here)
 * @param {string} [args.pollUrl] - the `pr-state` poll URL (`data-pr-state-url`)
 * @param {boolean} [args.live]  - the run is still in progress (`data-run-live`)
 * @returns {string}
 */
export function renderPrLine({ text = '', pollUrl = '', live = false } = {}) {
  return `<div class="sess-pr-state" data-testid="session-pr-state" data-pr-state-url="${escapeHtml(pollUrl)}" data-run-live="${live ? 'true' : 'false'}"><span class="sess-pr-line" data-testid="session-pr-line">${escapeHtml(text)}</span></div>`;
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
 * @param {Object|null} [data.runEvidence] - LIN-3247/LIN-3251: the run-evidence model (`{ state, evidence, ledger, closeOut }`). When present, `renderEvidence` mounts after the paragraph (before the steps) and `renderCloseOutBox` mounts after the steps (before Task context). The two fragments are separate mounts, per LIN-2948 §4.
 * @param {Object|null} [data.prState] - LIN-3251: an already-known PR state (`{ state, number, checks }`, the beat-1 `pr-state` shape). When present the header PR line is built from `prStateCopy`; when absent the line is the neutral "checking" copy beat 3's poll replaces.
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
    proposals = [], runEvidence = null, runParagraph = null, prState = null
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

  // LIN-3331: links through to a task's page. The binding pair rides the
  // session's loops (lib/pipeline-loops.js projects `issueSource`/
  // `issueBindingScope` sparsely); a task whose rows are unstamped gets a plain
  // link, the single-binding fallback. The shared face (`render-run-steps.js`)
  // is untouched so the run page's step rows and the task page's track stay
  // byte-identical; these links are added around it, in this file.
  const loopPairByIdent = new Map();
  for (const l of Array.isArray(session.loops) ? session.loops : []) {
    if (!l || !l.issueIdentifier) continue;
    if (l.issueSource != null || l.issueBindingScope != null) {
      loopPairByIdent.set(l.issueIdentifier, { source: l.issueSource, bindingScope: l.issueBindingScope });
    }
  }
  const taskPageHrefFor = (identifier) => {
    const pair = loopPairByIdent.get(identifier) || {};
    return taskPageHref({ urlKey, identifier, source: pair.source, bindingScope: pair.bindingScope });
  };
  const tasksHtml = tasks.length
    ? tasks.map(t => {
        const href = taskPageHrefFor(t);
        return href
          ? `<a class="sess-task task-page-link" data-testid="session-task-link" href="${escapeHtml(href)}">${escapeHtml(t)}</a>`
          : `<span class="sess-task" data-testid="session-task">${escapeHtml(t)}</span>`;
      }).join('')
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
  const seedTaskHref = session.seedIssue ? taskPageHrefFor(session.seedIssue) : '';
  const seedLink = seedTaskHref
    ? ` <a class="sess-task-page task-page-link" data-testid="session-task-page-link" href="${escapeHtml(seedTaskHref)}">task page ↗</a>`
    : '';
  const seedRow = session.seedIssue
    ? `<div class="sess-kv"><span class="sess-k">task</span><span class="sess-v" data-testid="session-seed">${escapeHtml(session.seedIssue)}</span>${hasDistinctTitle ? `<span class="sess-seed-title" data-testid="session-seed-title">${escapeHtml(anchorIssueTitle)}</span>` : ''}${seedLink}</div>`
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
  // LIN-3251 PR line (header strip): one line from the beat-1 shared copy helper.
  // With a known `prState` it renders the exact copy; otherwise it renders the
  // neutral "checking" line and carries the poll URL + liveness for beat 3.
  // "Nothing has been merged" is never rendered without an open-PR state.
  const prLineUrl = session.sessionId
    ? `/workspace/${encodeURIComponent(urlKey || '')}/api/run/${encodeURIComponent(session.sessionId)}/pr-state`
    : '';
  const prLineText = prState ? prStateCopy(prState) : 'Checking for a pull request…';
  const prStateLine = renderPrLine({ text: prLineText, pollUrl: prLineUrl, live: !sessionTerminal });
  const headerBody = `<div class="sess-kv-grid">${headerRows}</div>
      <div class="sess-tasks-block">
        <span class="sess-tasks-label">tasks touched</span>
        <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>
      </div>
      ${prStateLine}
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
    ${renderSection({ className: 'sess-section sess-run-header', body: headerBody })}
    ${renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal })}
    ${paragraphSlot}
    ${renderEvidence(runEvidence)}
    ${renderSection({ className: 'sess-section sess-steps', title: 'Steps', body: stepsBody })}
    ${renderCloseOutBox(runEvidence ? runEvidence.closeOut : null)}
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
