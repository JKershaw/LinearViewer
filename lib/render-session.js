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

// Every attribute list below is `[...].filter(Boolean).join(' ')`: a falsy entry
// is an attribute that is emitted only when stamped (sparse, so legacy rows stay
// byte-identical).
const joinAttrs = (list) => list.filter(Boolean).join(' ');
const esc = (v) => escapeHtml(String(v || ''));

/** Whether this run may show reply/proposal controls (a run with no loopId has no reply target). */
const canReplyTo = (canReply, loop) => !!(canReply && loop.loopId);

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

// ─── Transcript and reply ───────────────────────────────────────────────────────

/**
 * The `[blocked]`/`[pending]` feedback-marker vocabulary (LIN-1163) — a run
 * paused on human input. One definition shared by the transcript's
 * blocked-message highlight instead of divergent client-side regexes.
 */
const BLOCKED_MARKER_REGEX = /^\s*\[(blocked|pending)\]/i;

/**
 * A run's transcript — a `.chat-thread` (LIN-1298 shared chat primitives)
 * populated client-side from the embedded `data-feedback` JSON, matching the
 * Task Chat idiom (LIN-1309): one class-bearing element, no wrapper div —
 * `session.js` reads `data-feedback` straight off it.
 *
 * LIN-2184 (H5): each entry carries `kind` (null when absent) so a `decision`
 * entry can be styled distinctly client-side, parallel to `blocked`.
 */
function renderTranscript(loop) {
  if (!Array.isArray(loop.feedback) || !loop.feedback.length) return '';
  const entries = loop.feedback.map(e => ({
    message: e.message || '',
    url: e.url || null,
    urlLabel: e.urlLabel || null,
    timestamp: e.timestamp || null,
    blocked: BLOCKED_MARKER_REGEX.test(e.message || ''),
    kind: e.kind || null
  }));
  return `<ul class="sess-run-tx chat-thread" data-testid="session-run-transcript" data-feedback="${escapeHtml(JSON.stringify(entries))}"></ul>`;
}

/**
 * Per-run inline reply box, scoped to the run's loopId.
 *
 * `data-terminal` is the run's OWN terminal status (done/failed);
 * `data-session-waiting` is the SESSION-level paused-on-human signal (LIN-1252)
 * — the client sends `force` when either is set, so a reply to a parked session
 * kill-firsts and lands even though the run itself is non-terminal.
 *
 * `data-issue-id`/`data-issue-identifier` (LIN-2154): the run's own issue
 * identity, used client-side to compose the durable comment write's `:issueId`
 * (`issueId || issueIdentifier`) and to gate Save on "is this run issue-bound".
 * `data-source` is the issue's provider kind (`loop.issueSource`), emitted only
 * when stamped — deliberately NOT the dispatch-collection `loop.source`
 * ('live'/'history'), which is not provider provenance.
 *
 * LIN-3252 S2: no decision half here — an unanswered decision is answered by
 * the pinned question card. LIN-2154: Save writes a durable task comment only;
 * Save and continue also delivers the dispatch follow-up. Save is hidden
 * client-side for an issueless run (public/session.js) but always rendered.
 */
function renderInlineReplyBox(loop, urlKey, waiting = false) {
  const terminal = loop.terminalStatus === 'done' || loop.terminalStatus === 'failed';
  const attrs = joinAttrs([
    'data-testid="session-inline-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-loop-id="${esc(loop.loopId)}"`,
    `data-target="${escapeHtml(loop.target || 'cli')}"`,
    `data-terminal="${terminal}"`,
    `data-session-waiting="${!!waiting}"`,
    `data-issue-id="${esc(loop.issueId)}"`,
    `data-issue-identifier="${esc(loop.issueIdentifier)}"`,
    loop.issueSource ? `data-source="${esc(loop.issueSource)}"` : ''
  ]);
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

// ─── Proposals (LIN-3254) ───────────────────────────────────────────────────────

/**
 * One "Proposed in chat" row: the proposed prompt as escaped text. A pending
 * proposal shows Apply / Decline; a decided one a quiet one-line state. The row
 * is a record only — the dispatched follow-up appears through the normal path.
 */
function renderProposalRow(proposal) {
  const status = proposal.status || 'proposed';
  const controls = status !== 'proposed'
    ? `<span class="sess-proposal-state" data-testid="session-proposal-state">${status === 'applied' ? 'applied' : 'declined'}</span>`
    : `<span class="sess-proposal-actions">
          <button type="button" class="action-btn sess-proposal-apply" data-proposal-action="apply">Apply</button>
          <button type="button" class="action-btn sess-proposal-decline" data-proposal-action="decline">Decline</button>
        </span>`;
  const attrs = joinAttrs([
    'data-testid="session-proposal"',
    `data-proposal-id="${esc(proposal.id)}"`,
    `data-run-id="${esc(proposal.runId)}"`,
    `data-proposal-status="${escapeHtml(status)}"`
  ]);
  return `<li class="sess-proposal" ${attrs}>
          <span class="sess-proposal-prompt">${esc(proposal.prompt)}</span>
          ${controls}
        </li>`;
}

/**
 * The proposal block for one step. It lives in the same canReply-gated region
 * as the reply box, so a non-owner view hides both.
 */
function renderProposalBlock(proposals, urlKey) {
  if (!Array.isArray(proposals) || proposals.length === 0) return '';
  return `<div class="sess-proposals" data-testid="session-proposals" data-url-key="${escapeHtml(urlKey || '')}">
        <div class="sess-proposals-title">Proposed in chat</div>
        <ul class="sess-proposal-list">${proposals.map(renderProposalRow).join('')}</ul>
      </div>`;
}

// ─── Runs and lineages ──────────────────────────────────────────────────────────

/**
 * One worker-run row. The always-visible *face* is `renderStepFace`
 * (LIN-3328, shared with the task page); this adds the run-page-only proposal
 * block and the transcript/reply body.
 *
 * `showReplyBox` (LIN-1478 S-C): inside a folded multi-run lineage only the
 * tail's box renders, hoisted to the lineage footer, so every run there is
 * rendered with it suppressed. A pending proposal needs attention, so it sits
 * in the always-visible part of the card, never in the collapsed body, under
 * the same `canReply && showReplyBox` gate.
 */
function renderRun(loop, options = {}) {
  const { urlKey = '', canReply = false, waiting = false, showReplyBox = true, stepProposals = null } = options;
  const mayReply = showReplyBox && canReplyTo(canReply, loop);
  const body = [renderTranscript(loop), mayReply ? renderInlineReplyBox(loop, urlKey, waiting) : ''].filter(Boolean);
  const expandedBody = body.length
    ? `<div class="sess-run-body" data-testid="session-run-body">${body.join('')}</div>`
    : '';
  const proposalBlock = mayReply ? renderProposalBlock(stepProposals, urlKey) : '';

  return `<li class="sess-run" data-testid="session-run" data-status="${runStatusMeta(loop).state}" data-loop-id="${esc(loop.loopId)}">
        ${renderStepFace(loop, options)}
        ${proposalBlock}
        ${expandedBody}
      </li>`;
}

/**
 * One lineage: a bare `renderRun()` for a group of one (no added chrome, and
 * that run is its own tail), or a `session-lineage` container around each
 * run's unchanged output for two-or-more.
 *
 * Reply targeting + the `force` safety rule (LIN-1478 S-C, LIN-1252): the
 * lineage's ONE reply box is the TAIL's own box, hoisted to the footer — never
 * aggregated, so `data-terminal` and `data-loop-id` are exactly the tail's and
 * a reply targets the tail via `followUpTo`. Aggregating (`any()`/`all()`)
 * would kill-first a live tail behind a done root or omit `force` for a done
 * tail behind a running root.
 */
function renderLineageGroup(group, options) {
  if (group.length === 1) return renderRun(group[0], options);
  const { urlKey = '', canReply = false, waiting = false, stepProposals = null } = options;
  const tail = group[group.length - 1];
  const runsHtml = group.map(l => renderRun(l, { ...options, showReplyBox: false })).join('');
  const mayReply = canReplyTo(canReply, tail);
  const replyHtml = mayReply ? renderInlineReplyBox(tail, urlKey, waiting) : '';
  const proposalsHtml = mayReply ? renderProposalBlock(stepProposals, urlKey) : '';
  const lineageId = group[0].lineageId ?? group[0].loopId;
  return `<li class="sess-lineage" data-testid="session-lineage" data-lineage-id="${esc(lineageId)}">
        <ul class="sess-lineage-runs">${runsHtml}</ul>
        ${replyHtml}${proposalsHtml}
      </li>`;
}

// ─── Pinned question cards (LIN-3252 S2) ────────────────────────────────────────

/**
 * "If you don't answer" line (S2.3ii): the agent's own
 * `decision.if_unanswered.summary` when present, else a fallback worded by
 * whether the session has ENDED (`sessionTerminal`), not by the effect.
 */
function ifUnansweredText(decision, sessionTerminal) {
  const summary = decision && decision.if_unanswered && decision.if_unanswered.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  return sessionTerminal
    ? 'Nothing further runs; the run has ended.'
    : 'Harbour keeps waiting for your answer.';
}

/**
 * One pinned question card. `case` chunks render verbatim, each its own node,
 * inside an expandable "why is Harbour asking? ›" (a chunk may carry a baked-in
 * `(recap i/n)` header — never re-derived here). A non-interactive card says
 * Harbour is still working and offers no input.
 *
 * The card carries the reply target (`data-loop-id`, the followUpTo anchor) and
 * the stamp target (`data-stamp-loop-id`) separately — a lineage's decision may
 * be raised on the root while the content loop is a later member.
 */
function renderQuestionCard(card) {
  const attrs = joinAttrs([
    'data-testid="session-question-card"',
    `data-url-key="${escapeHtml(card.urlKey || '')}"`,
    `data-loop-id="${esc(card.followUpTo)}"`,
    `data-stamp-loop-id="${esc(card.stampLoopId)}"`,
    `data-decision-id="${esc(card.decisionId)}"`,
    `data-target="${escapeHtml(card.target || 'cli')}"`,
    `data-issue-id="${esc(card.issueId)}"`,
    `data-issue-identifier="${esc(card.issueIdentifier)}"`,
    // LIN-3126 residual: the anchor's provider-kind source, so the card's
    // answer/dismiss senders forward the issue's provider. Sparse.
    card.source ? `data-source="${esc(card.source)}"` : '',
    `data-disposition="${escapeHtml(card.disposition || '')}"`,
    `data-effect="${escapeHtml(card.effect || '')}"`,
    `data-record-on="${escapeHtml(card.recordOn || '')}"`,
    `data-session-waiting="${!!card.sessionWaiting}"`
  ]);

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
    const radioGroup = escapeHtml(String(card.stampLoopId || card.decisionId || 'q'));
    const optionsHtml = options.length
      ? `<ul class="sess-qcard-options" data-testid="session-question-card-options">${options.map(o => `<li class="sess-qcard-option">
            <label class="sess-qcard-option-label">
              <input type="radio" class="sess-qcard-option-input" name="qcard-${radioGroup}" data-option-id="${esc(o.id)}" value="${esc(o.label)}">
              <span class="sess-qcard-option-text" data-testid="session-question-card-option">${esc(o.label)}</span>
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

/** One decision row → its pinned card. Dismiss is offered on decision cards only (S2.5/C2). */
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
    disposition: row.disposition || '',
    effect: row.effect || '',
    recordOn: (decision.on_answer && decision.on_answer.record_on) || '',
    sessionWaiting,
    question: decision.question ? String(decision.question) : 'Harbour needs your input.',
    case: Array.isArray(row.decisionCase) ? row.decisionCase : [],
    options: Array.isArray(decision.options) ? decision.options : [],
    ifUnanswered: ifUnansweredText(decision, sessionTerminal),
    interactive: !readOnly && row.canReply !== false && canReply,
    dismissable: true
  });
}

/**
 * A bare `[blocked]` waiting loop with no `DECISION:` row (S2.7): the second
 * card source. Free-text box and one verb, "Answer" (the session is waiting, so
 * it forces the resume). No dismiss — a blocker has no decision identity to key
 * the KPI on. `producer` is the waiting loop: its own reply target and issue
 * (never a hard-defaulted cli target) and its latest assistant text as the
 * "why" fallback when there is no `decisionCase`.
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
 * The pinned cards above the steps. Primary source is `decisions` (the route's
 * waiting-independent read, so a finished session's decision still shows); the
 * bare-blocked card is the fallback when the session is waiting on a
 * `[blocked]` loop with no ruling row.
 */
function renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const cards = rows.map(row => renderDecisionCard(row, { urlKey, canReply, sessionTerminal, sessionWaiting: waiting }));
  if (!rows.length && waiting && waitingMessage && !decision) {
    cards.push(renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }));
  }
  return cards.length ? `<div class="sess-qcards">${cards.join('')}</div>` : '';
}

// ─── Header strip (LIN-3250: the renderer only formats the view model) ─────────

/** The heading's short run id — the session id, trimmed for a heading. */
function shortRunId(sessionId) {
  const id = String(sessionId || '');
  return id.length > 12 ? id.slice(0, 8) : id;
}

/** The distinct tiers across a run's steps; `not reported` only if nothing else. */
function tierRollup(steps) {
  const tiers = [...new Set(steps.map(s => s.tier).filter(Boolean))];
  const known = tiers.filter(t => t !== 'not reported');
  const shown = known.length ? known : tiers;
  return shown.length ? shown.join(' · ') : null;
}

/** One key/value row of the header grid; `after` sits outside the value span. */
function kvRow(key, valueClass, valueAttrs, valueHtml, after = '') {
  return `<div class="sess-kv"><span class="sess-k">${key}</span><span class="${valueClass}" ${valueAttrs}>${valueHtml}</span>${after}</div>`;
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
 * `tests/unit/render-session-golden.test.js`.
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
 * The header strip: the key/value grid, tasks touched, PR line and run-chat link.
 *
 * LIN-3331: task links go through `taskPageHref`. The provider-kind source rides
 * the session's loops (`issueSource`, projected sparsely); a task whose rows are
 * unstamped gets a plain link. The shared step face is untouched so the run
 * page and the task page's track stay byte-identical.
 */
function renderHeaderBody({ session, view, urlKey, sessionTerminal, credentialByToken, prState, distinctTitle }) {
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const sourceByIdentifier = new Map();
  for (const l of loops) {
    if (l && l.issueIdentifier && l.issueSource != null) sourceByIdentifier.set(l.issueIdentifier, l.issueSource);
  }
  const hrefFor = (identifier) => taskPageHref({ urlKey, identifier, source: sourceByIdentifier.get(identifier) });

  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const tasksHtml = tasks.length
    ? tasks.map(t => {
        const href = hrefFor(t);
        return href
          ? `<a class="sess-task task-page-link" data-testid="session-task-link" href="${escapeHtml(href)}">${escapeHtml(t)}</a>`
          : `<span class="sess-task" data-testid="session-task">${escapeHtml(t)}</span>`;
      }).join('')
    : '<span class="sess-muted">no tasks recorded</span>';

  const plainValue = 'sess-v';
  const { time, waiting: wait, cost } = view;

  // The credential state is ALWAYS rendered — never blank, never silently
  // healthy (LIN-1588). `agentTokenLabel` is display-only, escaped here.
  const credential = rollupCredential(loops, credentialByToken);
  const credCopy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
  const credLabel = credential.label ? ` <span class="sess-cred-token">${escapeHtml(String(credential.label))}</span>` : '';

  const seedHref = session.seedIssue ? hrefFor(session.seedIssue) : '';
  const seedAfter = (distinctTitle ? `<span class="sess-seed-title" data-testid="session-seed-title">${escapeHtml(distinctTitle)}</span>` : '')
    + (seedHref ? ` <a class="sess-task-page task-page-link" data-testid="session-task-page-link" href="${escapeHtml(seedHref)}">task page ↗</a>` : '');
  const tierLabel = tierRollup(view.steps);

  const rows = [
    kvRow('progress', plainValue, 'data-testid="session-progress"', escapeHtml(view.progress.label)),
    view.next && kvRow('next', plainValue, 'data-testid="session-next"', `Next: ${escapeHtml(view.next)}`),
    kvRow('active time', plainValue, 'data-testid="session-active-time"', escapeHtml(fmtDuration(time.activeMs) || '—')),
    kvRow('wall clock', plainValue, `data-testid="session-elapsed" data-start="${escapeHtml(time.wall.start || '')}" data-end="${escapeHtml(time.wall.end || '')}"`, escapeHtml(fmtDuration(time.wall.ms) || '—')),
    wait.active && kvRow('waiting', plainValue, `data-testid="session-waiting-clock" data-since="${escapeHtml(wait.since || '')}"`, `waiting ${escapeHtml(fmtDuration(wait.ms) || '—')}`),
    tierLabel && kvRow('tier', plainValue, 'data-testid="session-tiers"', escapeHtml(tierLabel)),
    // Money ONLY when every lineage is priced and cumulative. Otherwise NO money
    // markup at all — no zero, no partial sum, no "not reported" placeholder.
    cost.status === 'total' && kvRow('cost', plainValue, 'data-testid="session-cost"', escapeHtml(fmtUsd(cost.usd) || '')),
    session.seedIssue && kvRow('task', plainValue, 'data-testid="session-seed"', escapeHtml(session.seedIssue), seedAfter),
    kvRow('credential', 'sess-v sess-cred', `data-state="${escapeHtml(credential.state)}" data-testid="session-credential" title="${escapeHtml(credCopy.title)}"`, `${escapeHtml(credCopy.label)}${credLabel}`)
  ].filter(Boolean).join('');

  // LIN-3254: "chat about this run" — a run-scoped task chat that proposes
  // instead of acting. Link only; the page's turn carries the run id.
  const keySegment = encodeURIComponent(urlKey || '');
  const runChatLink = session.sessionId
    ? `<a class="sess-run-chat" data-testid="session-run-chat" href="/workspace/${keySegment}/task-chat?task=${encodeURIComponent(session.seedIssue || '')}&run=${encodeURIComponent(session.sessionId)}">💬 chat about this run</a>`
    : '';

  // LIN-3251 PR line: with a known `prState` the exact copy, otherwise the
  // neutral "checking" line carrying the poll URL + liveness for the client
  // poll. "Nothing has been merged" is never rendered without an open-PR state.
  const pollUrl = session.sessionId
    ? `/workspace/${keySegment}/api/run/${encodeURIComponent(session.sessionId)}/pr-state`
    : '';
  const prLine = renderPrLine({
    text: prState ? prStateCopy(prState) : 'Checking for a pull request…',
    pollUrl,
    live: !sessionTerminal
  });

  return `<div class="sess-kv-grid">${rows}</div>
      <div class="sess-tasks-block">
        <span class="sess-tasks-label">tasks touched</span>
        <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>
      </div>
      ${prLine}
      ${runChatLink}`;
}

// ─── Steps, context, paragraph ──────────────────────────────────────────────────

/**
 * A one-line summary above each step's lineage rows. LIN-3254: a proposal is
 * matched to the step whose lineage owns its `stepLoopId`; one that matches no
 * rendered loop falls under the last step.
 */
function renderSteps({ session, view, proposals, runOptions }) {
  const loops = Array.isArray(session.loops) ? session.loops : [];
  if (!loops.length) return '<p class="sess-muted">no runs in this session</p>';
  const allLoopIds = new Set(loops.map(l => l.loopId));
  const lastStepIndex = view.steps.length - 1;
  return view.steps.map((step, stepIndex) => {
    const stepLoopIds = new Set(step.loops.map(l => l.loopId));
    const stepProposals = proposals.filter(p =>
      stepLoopIds.has(p.stepLoopId)
      || (stepIndex === lastStepIndex && !allLoopIds.has(p.stepLoopId))
    );
    const loopCostsByLoopId = new Map(step.loopCosts.map(c => [c.loopId, c]));
    const group = renderLineageGroup(step.loops, { ...runOptions, loopCostsByLoopId, costCumulative: step.cost.cumulative, stepProposals });
    return `<div class="sess-step" data-testid="session-step">
        <div class="sess-step-summary" data-testid="session-step-summary">${escapeHtml(stepSummary(step))}</div>
        <ul class="sess-runs">${group}</ul>
      </div>`;
  }).join('');
}

/** Brief + recap per issue, cache-joined and tagged for the client-side widgets. Never an LLM call. */
function renderContext(issueContext, urlKey) {
  if (!issueContext.length) return '<p class="sess-muted" data-testid="session-context-empty">○ no task context available to join</p>';
  const panel = (label, kind, ctx) => renderContextPanel({
    label, kind, issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId,
    body: ctx[kind], model: ctx[`${kind}Model`], generatedAt: ctx[`${kind}GeneratedAt`], urlKey
  });
  return issueContext.map(ctx => `<div class="sess-ctx-issue">
        ${panel('Brief', 'brief', ctx)}
        ${panel('Recap', 'recap', ctx)}
      </div>`).join('');
}

/**
 * The run paragraph slot (LIN-3253): present → escaped text and the slot stops
 * being `aria-hidden`/`:empty` so `session.css` reveals it; a miss keeps the
 * empty, hidden placeholder.
 */
function renderParagraphSlot(runParagraph) {
  const text = typeof runParagraph === 'string' ? runParagraph.trim() : '';
  return text
    ? `<div class="sess-paragraph-slot sess-paragraph" data-testid="session-paragraph"><p class="sess-paragraph-text" data-testid="session-paragraph-text">${escapeHtml(text)}</p></div>`
    : '<div class="sess-paragraph-slot" data-testid="session-paragraph" aria-hidden="true"></div>';
}

// ─── Page ───────────────────────────────────────────────────────────────────────

const STYLESHEETS = ['/style.css', '/common-actions.css', '/session.css', '/chat.css'];
const SCRIPTS = ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/session.js'];

/**
 * @param {Object} data
 * @param {Object|null} data.session   - non-lean reconstructed session, or null → 404 body
 * @param {string} [data.sessionId]    - the requested id (for the not-found body)
 * @param {Array}  [data.issueContext] - [{ issueIdentifier, issueId, brief, briefModel, briefGeneratedAt, recap, recapModel, recapGeneratedAt }]
 * @param {boolean} [data.waiting]       - session is paused on a human (LIN-1005) → render the alert banner AND make replies send `force:true` (LIN-1252)
 * @param {string|null} [data.waitingMessage] - the waiting (`[blocked]`) message text shown in the banner
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
  const nav = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'observation', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/observation', urlKey, openRouterSource, featureFlags });
  const mainOpen = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${backLink}`;

  // Unknown / cross-workspace sessionId → the 404 body.
  if (!session) {
    const content = `${mainOpen}
    ${renderPageHeader({ titleHtml: 'Session not found', headerClass: 'sess-header' })}
    ${renderSection({
      className: 'sess-section',
      title: 'Not found',
      body: `<p class="sess-notfound" data-testid="session-not-found">○ no session <code>${escapeHtml(sessionId || '')}</code> in this workspace.</p>`
    })}
  </main>
  ${footerHtml}`;
    return renderPage({ title: 'Session not found', stylesheets: STYLESHEETS, nav, content });
  }

  // The route builds the view model once and passes it; a direct call (unit
  // tests) builds it here. `buildRunView` stays the ONE place progress, cost
  // and time are computed.
  const view = runView || buildRunView(session, { now: options.now });

  // LIN-1801: never render a title equal to the bare identifier as if it were
  // a separate title (LIN-783-class regression).
  const hasDistinctTitle = !!anchorIssueTitle && anchorIssueTitle !== session.seedIssue;
  const pageTitle = hasDistinctTitle ? anchorIssueTitle : (view.title || session.seedIssue || String(session.sessionId || ''));
  const docTitle = `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}${hasDistinctTitle ? ' — ' + escapeHtml(anchorIssueTitle) : ''}`;
  const headingHtml = `<span class="sess-heading-title" data-testid="session-title">${escapeHtml(pageTitle)}</span> <span class="sess-run-id" data-testid="session-run-id">Run ${escapeHtml(shortRunId(session.sessionId))}</span>`;

  const loops = Array.isArray(session.loops) ? session.loops : [];
  const runOptions = { urlKey, canReply, waiting, supersededLoopIds: computeSupersededLoopIds(loops), credentialByToken };

  const headerBody = renderHeaderBody({
    session, view, urlKey, sessionTerminal, credentialByToken, prState,
    distinctTitle: hasDistinctTitle ? anchorIssueTitle : ''
  });

  const content = `${mainOpen}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'sess-header' })}
    ${renderSection({ className: 'sess-section sess-run-header', body: headerBody })}
    ${renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal })}
    ${renderParagraphSlot(runParagraph)}
    ${renderEvidence(runEvidence)}
    ${renderSection({ className: 'sess-section sess-steps', title: 'Steps', body: renderSteps({ session, view, proposals, runOptions }) })}
    ${renderCloseOutBox(runEvidence ? runEvidence.closeOut : null)}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: renderContext(issueContext, urlKey) })}
  </main>
  ${footerHtml}`;

  return renderPage({ title: docTitle, stylesheets: STYLESHEETS, nav, content, scripts: SCRIPTS });
}
