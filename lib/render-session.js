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
 *   - Global reply box: kept as fallback at the bottom of the page.
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

/** Per-run telemetry chips (metric count, runtime, artifacts, model?). */
function renderRunChips(telemetry) {
  if (!telemetry) return '';
  const chips = [];
  const runtime = fmtRuntime(telemetry.runtime);
  if (runtime) chips.push(`<span class="sess-chip" data-testid="session-run-runtime">⏱ ${escapeHtml(runtime)}</span>`);
  const metricCount = Array.isArray(telemetry.metrics) ? telemetry.metrics.length : 0;
  if (metricCount) chips.push(`<span class="sess-chip" data-testid="session-run-metrics">◐ ${metricCount} heartbeats</span>`);
  const artifactCount = Array.isArray(telemetry.producedArtifacts) ? telemetry.producedArtifacts.length : 0;
  if (artifactCount) chips.push(`<span class="sess-chip" data-testid="session-run-artifacts">✎ ${artifactCount} artifacts</span>`);
  if (telemetry.model) chips.push(`<span class="sess-chip" data-testid="session-run-model">◇ ${escapeHtml(telemetry.model)}</span>`);
  return chips.length ? `<div class="sess-chips">${chips.join('')}</div>` : '';
}

/** Encode per-run feedback entries as a JSON data attribute for client-side rendering. */
function encodeFeedbackJSON(feedback) {
  const safe = Array.isArray(feedback)
    ? feedback.map(e => ({ message: e.message || '', url: e.url || null, urlLabel: e.urlLabel || null, timestamp: e.timestamp || null }))
    : [];
  return escapeHtml(JSON.stringify(safe));
}

/** A single transcript feedback entry — rendered client-side from embedded JSON. */
function renderTranscriptEntries(loop) {
  const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (!entries.length) return '';
  const json = encodeFeedbackJSON(loop.feedback);
  return `<div class="sess-run-tx" data-testid="session-run-transcript" data-feedback="${json}">
      <ul class="sess-run-tx-list"></ul>
    </div>`;
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

/** One worker-run row — expandable with per-run transcript + inline reply. */
function renderRun(loop, options = {}) {
  const { urlKey = '', canReply = false, waiting = false } = options;
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const sm = runStatusMeta(loop);
  const status = `<span class="sess-run-status status-pill status-pill--${sm.state}" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(sm.label)}</span>`;
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';

  const expandedBody = (() => {
    const pieces = [];
    // Per-run transcript — embedded feedback for client-side markdown rendering
    const txBlock = renderTranscriptEntries(loop);
    if (txBlock) pieces.push(txBlock);
    // Per-run inline reply — only when the session supports replies
    if (canReply && loop.loopId) {
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
          ${ident} ${kind} ${status}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          <span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>
        </div>
        ${renderRunChips(loop.telemetry)}
        ${expandedBody}
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
      <p class="sess-waiting-cta" data-testid="session-waiting-cta">This session is paused and needs your input — reply in the follow-up box below to continue it.</p>
    </div>`;
}

/**
 * The human follow-up reply box (LIN-1004, Phase 2 of LIN-950). Rendered at the
 * bottom of a cli/web session so a human can inject a plain follow-up back into
 * the SAME session via the existing dispatch API. It is ADDITIVE to the
 * agent-to-agent wake path (`lib/dispatch-wake.js`) — a plain follow-up, not a
 * `kind:'wake'`, so it can't collide with the wake loop-guard.
 *
 * `data-session-terminal` and `data-session-waiting` together drive the client's
 * conditional `force`: the client sends `force:true` when the session is terminal
 * OR waiting (LIN-1252). A terminal/finalized session forces to bypass the runner
 * busy-guard if a warm process lingers (harmless if already reaped — the runner
 * still returns `[failed] no live session to resume`, surfaced honestly on reload).
 * A waiting/paused-on-human session (`!terminal && rawWaiting`, LIN-1005) also
 * forces so the router kill-firsts the parked idle window before `claude --resume`,
 * avoiding the session-id collision that drops a no-force reply (LIN-546). A
 * genuinely warm `EXECUTING` session is neither terminal nor waiting, so it still
 * omits `force`. Gated to cli/web upstream (never dash/local).
 */
function renderReplyBox({ canReply, session, urlKey, replyTarget, sessionTerminal, waiting = false }) {
  if (!canReply || !session) return '';
  const note = sessionTerminal
    ? 'This session has finished — a reply attempts to resume it, but if the session has ended you’ll see “no live session to resume” in the transcript on reload.'
    : 'Your reply is queued into this session as a follow-up; reload to see it continue.';
  // LIN-1298: the reply surface reuses the shared Task Chat conversational UI — an
  // echo thread (filled with a "you" bubble on send by session.js) above a chat
  // composer. All existing hooks (`sess-reply-input`, `session-reply-send`, the
  // note) are preserved; the wire/force behaviour is untouched.
  const body = `<ul class="chat-thread" data-testid="session-reply-thread" hidden></ul>
      <div class="chat-composer">
        <textarea class="sess-reply-input chat-composer__input" data-testid="session-reply-input" rows="3" placeholder="Reply to this session…" aria-label="Reply to this session"></textarea>
        <div class="sess-reply-actions chat-composer__actions">
          <button type="button" class="action-btn sess-reply-send" data-testid="session-reply-send">send reply</button>
          <span class="sess-reply-feedback" data-testid="session-reply-feedback" role="status" aria-live="polite"></span>
        </div>
      </div>
      <p class="sess-reply-note" data-testid="session-reply-note">${escapeHtml(note)}</p>`;
  const attrs = [
    'data-testid="session-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-session-id="${escapeHtml(String(session.sessionId || ''))}"`,
    `data-target="${escapeHtml(replyTarget || 'cli')}"`,
    `data-session-terminal="${sessionTerminal ? 'true' : 'false'}"`,
    `data-session-waiting="${waiting ? 'true' : 'false'}"`
  ].join(' ');
  return renderSection({ className: 'sess-section sess-reply-section', title: 'Reply', body, attrs });
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
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render per-run inline reply + global reply box (LIN-1004/LIN-1133)
 * @param {string} [data.replyTarget]     - dispatch target for the reply ('cli' | 'web'; LIN-1004)
 * @param {boolean} [data.sessionTerminal] - the session is finalized → replies send `force:true` (LIN-1004)
 * @param {string} [data.urlKey]
 * @param {Object} [options]
 * @returns {string} Complete HTML document
 */
export function renderSessionPage(data = {}, options = {}) {
  const {
    session = null, sessionId = '', issueContext = [], urlKey = '',
    waiting = false, waitingMessage = null,
    canReply = false, replyTarget = 'cli', sessionTerminal = false
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
  const overviewRows = [
    session.seedIssue ? `<div class="sess-kv"><span class="sess-k">seed</span><span class="sess-v" data-testid="session-seed">${escapeHtml(session.seedIssue)}</span></div>` : '',
    `<div class="sess-kv"><span class="sess-k">session id</span><span class="sess-v">${escapeHtml(String(session.sessionId || ''))}</span></div>`,
    `<div class="sess-kv"><span class="sess-k">dispatched</span><span class="sess-v">${fmtTs(session.dispatchedAt)}</span></div>`,
    `<div class="sess-kv"><span class="sess-k">completed</span><span class="sess-v">${fmtTs(session.completedAt)}</span></div>`,
    sessRuntime ? `<div class="sess-kv"><span class="sess-k">runtime</span><span class="sess-v">${escapeHtml(sessRuntime)}</span></div>` : '',
    sessTelemetry.model ? `<div class="sess-kv"><span class="sess-k">model</span><span class="sess-v" data-testid="session-model">${escapeHtml(String(sessTelemetry.model))}</span></div>` : ''
  ].filter(Boolean).join('');

  const overviewBody = `<div class="sess-kv-grid">${overviewRows}</div>
      <div class="sess-tasks-block">
        <span class="sess-tasks-label">tasks touched</span>
        <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>
      </div>`;

  // ── Per-run expandable cards + per-run transcripts merged ─────────────────
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const runsBody = loops.length
    ? `<ul class="sess-runs">${loops.map(l => renderRun(l, { urlKey, canReply, waiting })).join('')}</ul>`
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
    ${renderSection({ className: 'sess-section sess-runs-section', title: 'Runs', body: runsBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
    ${renderReplyBox({ canReply, session, urlKey, replyTarget, sessionTerminal, waiting })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Session · ${session.seedIssue || session.sessionId || ''}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css', '/chat.css'],
    nav: navHtml,
    content,
    scripts: ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/session.js']
  });
}
