/**
 * Session Page Renderer (LIN-1003, Phase 1 of LIN-950).
 *
 * The dedicated per-session page — the Observation in-feed drill-down promoted
 * into a real, server-rendered HTML page with its own URL
 * (`GET /workspace/:urlKey/observation/session/:sessionId`). It is a *snapshot*
 * (no polling, no client JS): the route reads one reconstructed session and this
 * pure `(data) → HTML` function renders it on the shared page shell, following
 * the standalone `render-*.js` convention (`renderObservationPage`).
 *
 * What it renders (all read-only derivations of the non-lean session):
 *   - Overview: seed issue, tasks touched, session timings + telemetry.
 *   - Per-run cards: each loop's kind/iteration, terminal status, timings,
 *     telemetry chips, expandable per-run transcript with inline reply
 *     (LIN-1133). `telemetry.model` renders ONLY when present — the runner
 *     does not emit worker model yet (LIN-594), so it is legitimately absent.
 *   - Task context: per-issue brief/recap, joined from the caches by the route.
 *     CACHE-ONLY on load — a miss renders an explicit, cost-aware generate
 *     affordance, NEVER an auto-LLM-spend on page load. The brief body is
 *     rendered as markdown (via `marked`) rather than escaped pre-text, and
 *     each panel carries a refresh/generate button (LIN-1133).
 *
 * Zero LLM/network/store I/O here — the route does the reads and hands this a
 * plain data object. `data.session === null` renders the 404 not-found body.
 */

import { marked } from 'marked';
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

/** A single transcript feedback entry: message + optional evidence link. */
function renderTranscriptEntry(entry) {
  const message = escapeHtml(entry.message || '');
  const time = entry.timestamp
    ? `<span class="sess-tx-time" data-testid="session-transcript-time">${fmtTs(entry.timestamp)}</span>`
    : '';
  const link = entry.url
    ? ` <a class="sess-tx-link" data-testid="session-transcript-link" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.urlLabel || entry.url)}</a>`
    : '';
  return `<li class="sess-tx-entry" data-testid="session-transcript-entry">
        ${time}
        <span class="sess-tx-msg">${message}</span>${link}
      </li>`;
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
  // Model chip ONLY when present — omitted (not "undefined") when the runner
  // does not emit it (LIN-594).
  if (telemetry.model) chips.push(`<span class="sess-chip" data-testid="session-run-model">◇ ${escapeHtml(telemetry.model)}</span>`);
  return chips.length ? `<div class="sess-chips">${chips.join('')}</div>` : '';
}

/** Run metadata (head, times, chips). */
function renderRunHead(loop) {
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const status = loop.terminalStatus
    ? `<span class="sess-run-status" data-testid="session-run-status">${escapeHtml(loop.terminalStatus)}</span>`
    : '<span class="sess-run-status sess-run-status--live">running</span>';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';
  return `<div class="sess-run-head">
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          <span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>
        </div>
        ${renderRunChips(loop.telemetry)}`;
}

/** Per-run expandable transcript (LIN-1133). */
function renderRunTranscript(loop) {
  const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (!entries.length) {
    return `<details class="sess-run-details sess-run-details--empty" data-testid="session-run-transcript">
        <summary class="sess-run-summary">transcript <span class="sess-run-summary-extra">0 entries</span></summary>
        <p class="sess-muted sess-run-tx-empty">no transcript entries for this run</p>
      </details>`;
  }
  const lis = entries.map(renderTranscriptEntry).join('');
  const issueLabel = loop.issueIdentifier || 'run';
  return `<details class="sess-run-details" data-testid="session-run-transcript">
        <summary class="sess-run-summary">transcript <span class="sess-run-summary-extra">${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'} · ${escapeHtml(issueLabel)}</span></summary>
        <div class="sess-run-tx">
          <ul class="sess-tx-list">${lis}</ul>
        </div>
      </details>`;
}

/** Inline reply box inside a per-run transcript (LIN-1133). Only rendered for cli/web sessions. */
function renderRunReply(loop, { urlKey, replyTarget, sessionTerminal }) {
  const loopId = escapeHtml(String(loop.loopId || ''));
  if (!loopId) return '';
  const note = sessionTerminal
    ? 'Reply to this run — attempts to resume the session even if it has finished.'
    : 'Reply scoped to this run — reload to see it continue.';
  const attrs = [
    'class="sess-run-reply"',
    'data-testid="session-run-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-follow-up="${loopId}"`,
    `data-target="${escapeHtml(replyTarget || 'cli')}"`,
    `data-session-terminal="${sessionTerminal ? 'true' : 'false'}"`
  ].join(' ');
  return `<div ${attrs}>
      <textarea class="sess-run-reply-input" data-testid="session-run-reply-input" rows="2" placeholder="Reply to this run…" aria-label="Reply to this run"></textarea>
      <div class="sess-run-reply-actions">
        <button type="button" class="sess-run-reply-send" data-testid="session-run-reply-send">reply</button>
        <span class="sess-run-reply-feedback" data-testid="session-run-reply-feedback" role="status" aria-live="polite"></span>
      </div>
      <p class="sess-run-reply-note">${escapeHtml(note)}</p>
    </div>`;
}

/** One worker-run card: head + expandable transcript + inline reply (LIN-1133). */
function renderRun(loop, replyOpts) {
  const transcriptHtml = renderRunTranscript(loop);
  const replyHtml = replyOpts?.canReply ? renderRunReply(loop, replyOpts) : '';
  return `<li class="sess-run" data-testid="session-run">
        ${renderRunHead(loop)}
        ${transcriptHtml}
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
 * `data-session-terminal` drives the client's conditional `force` (LIN-1004
 * research resolves the open question): a terminal/finalized session sends
 * `force:true` (bypass the runner busy-guard if a warm process lingers; harmless
 * if already reaped — the runner still returns `[failed] no live session to
 * resume`, surfaced honestly on reload), while a waiting/non-terminal session
 * omits `force` (it's warm, just parked). Gated to cli/web upstream (never
 * dash/local). The scoped `/session.js` this feeds is the page's ONLY client JS
 * — the rest is a LIN-1003 no-JS snapshot.
 */
function renderReplyBox({ canReply, session, urlKey, replyTarget, sessionTerminal }) {
  if (!canReply || !session) return '';
  const note = sessionTerminal
    ? 'This session has finished — a reply attempts to resume it, but if the session has ended you’ll see “no live session to resume” in the transcript on reload.'
    : 'Your reply is queued into this session as a follow-up; reload to see it continue.';
  const body = `<textarea class="sess-reply-input" data-testid="session-reply-input" rows="3" placeholder="Reply to this session…" aria-label="Reply to this session"></textarea>
      <div class="sess-reply-actions">
        <button type="button" class="action-btn sess-reply-send" data-testid="session-reply-send">send reply</button>
        <span class="sess-reply-feedback" data-testid="session-reply-feedback" role="status" aria-live="polite"></span>
      </div>
      <p class="sess-reply-note" data-testid="session-reply-note">${escapeHtml(note)}</p>`;
  const attrs = [
    'data-testid="session-reply"',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-session-id="${escapeHtml(String(session.sessionId || ''))}"`,
    `data-target="${escapeHtml(replyTarget || 'cli')}"`,
    `data-session-terminal="${sessionTerminal ? 'true' : 'false'}"`
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
 * STRING → rendered HTML (LIN-1133), the recap is a structured OBJECT (grouped
 * lists). Returns '' for an absent/unusable body so the panel falls through to
 * the cache-miss affordance — and, critically, NEVER stringifies an object into
 * `[object Object]`.
 */
function renderContextBody(kind, body) {
  if (body == null) return '';
  if (typeof body === 'string') {
    return body.trim() ? `<div class="sess-ctx-body rendered-markdown">${marked.parse(body)}</div>` : '';
  }
  if (kind === 'recap' && typeof body === 'object') return renderRecapBody(body);
  return '';
}

/** A brief or recap panel: cached body when present, generate affordance on miss.
 *  Each panel now carries a refresh/generate button (LIN-1133). */
function renderContextPanel({ label, kind, issueIdentifier, issueId, body, model, generatedAt, urlKey }) {
  const ident = escapeHtml(issueIdentifier || issueId || '');
  const refreshLabel = body != null ? '↻ refresh' : '✦ generate';
  const refreshTestId = body != null ? `session-${kind}-refresh` : `session-${kind}-generate`;
  const refreshAttrs = [
    `data-testid="${refreshTestId}"`,
    `data-sess-kind="${escapeHtml(kind)}"`,
    `data-sess-identifier="${escapeHtml(issueIdentifier || issueId || '')}"`,
    `data-sess-url-key="${escapeHtml(urlKey || '')}"`
  ].join(' ');
  const heading = `<div class="sess-ctx-head">
          <span class="sess-ctx-kind">${escapeHtml(label)}</span>
          <span class="sess-ctx-ident" data-testid="session-ctx-ident">${ident}</span>
          <button type="button" class="sess-ctx-refresh" ${refreshAttrs}>${refreshLabel}</button>
        </div>`;
  const renderedBody = renderContextBody(kind, body);
  if (renderedBody) {
    const meta = [
      model ? `model ${escapeHtml(String(model))}` : null,
      generatedAt ? `generated ${fmtTs(generatedAt)}` : null
    ].filter(Boolean).join(' · ');
    return `<div class="sess-ctx-panel sess-ctx-panel--present" data-testid="session-${kind}">
        ${heading}
        ${renderedBody}
        ${meta ? `<div class="sess-ctx-meta">${meta}</div>` : ''}
      </div>`;
  }
  // Cache MISS: explicit, cost-aware affordance — never an auto-spend on load.
  return `<div class="sess-ctx-panel sess-ctx-panel--miss" data-testid="session-${kind}">
        ${heading}
        <p class="sess-ctx-miss" data-testid="session-${kind}-generate">○ no cached ${escapeHtml(label.toLowerCase())} — generate on demand from the task view (avoids auto-spending an LLM call on page load)</p>
      </div>`;
}

/**
 * @param {Object} data
 * @param {Object|null} data.session   - non-lean reconstructed session, or null → 404 body
 * @param {string} [data.sessionId]    - the requested id (for the not-found body)
 * @param {Array}  [data.issueContext] - [{ issueIdentifier, issueId, brief, briefModel, briefGeneratedAt, recap, recapModel, recapGeneratedAt }]
 * @param {boolean} [data.waiting]       - session is paused on a human (LIN-1005) → render the alert banner
 * @param {string|null} [data.waitingMessage] - the blocked/pending message text shown in the banner
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render the Phase 2 reply box (LIN-1004)
 * @param {string} [data.replyTarget]     - dispatch target for the reply ('cli' | 'web'; LIN-1004)
 * @param {boolean} [data.sessionTerminal] - the session is finalized → the reply sends `force:true` (LIN-1004)
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
    ${renderPageHeader({ titleHtml: 'Session not found', headerClass: 'sess-header' })}
    ${backLink}
    ${renderSection({
      className: 'sess-section',
      title: 'Not found',
      body: `<p class="sess-notfound" data-testid="session-not-found">○ no session <code>${escapeHtml(sessionId || '')}</code> in this workspace.</p>`
    })}
  </main>
  ${footerHtml}`;
    return renderPage({
      title: 'Session not found',
      stylesheets: ['/style.css', '/common-actions.css', '/session.css'],
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

  const overviewBody = `${overviewRows}
      <div class="sess-tasks" data-testid="session-tasks">${tasksHtml}</div>`;

  // ── Per-run cards (with expandable transcript + inline reply; LIN-1133) ────
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const runReplyOpts = canReply ? { canReply, urlKey, replyTarget, sessionTerminal } : null;
  const runsBody = loops.length
    ? `<ul class="sess-runs">${loops.map(l => renderRun(l, runReplyOpts)).join('')}</ul>`
    : '<p class="sess-muted">no runs in this session</p>';

  // ── Context (brief + recap, cache-joined by the route) ──────────────────────
  const contextBody = issueContext.length
    ? issueContext.map(ctx => `<div class="sess-ctx-issue">
        ${renderContextPanel({ label: 'Brief', kind: 'brief', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.brief, model: ctx.briefModel, generatedAt: ctx.briefGeneratedAt, urlKey })}
        ${renderContextPanel({ label: 'Recap', kind: 'recap', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.recap, model: ctx.recapModel, generatedAt: ctx.recapGeneratedAt, urlKey })}
      </div>`).join('')
    : '<p class="sess-muted" data-testid="session-context-empty">○ no task context available to join</p>';

  const content = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${renderPageHeader({ titleHtml: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}`, headerClass: 'sess-header' })}
    ${backLink}
    ${renderWaitingBanner(waiting, waitingMessage)}
    ${renderSection({ className: 'sess-section sess-overview', title: 'Overview', body: overviewBody })}
    ${renderSection({ className: 'sess-section sess-runs-section', title: 'Runs', body: runsBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
    ${renderReplyBox({ canReply, session, urlKey, replyTarget, sessionTerminal })}
  </main>
  ${footerHtml}`;

  const pageScripts = [];
  if (issueContext.length > 0) pageScripts.push('/common.js');
  if (canReply) pageScripts.push('/session.js');

  return renderPage({
    title: `Session · ${session.seedIssue || session.sessionId || ''}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css'],
    nav: navHtml,
    content,
    scripts: pageScripts
  });
}
