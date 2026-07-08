/**
 * Session Page Renderer (LIN-1003, Phase 1 of LIN-950; LIN-1133 per-run transcripts).
 *
 * The dedicated per-session page — the Observation in-feed drill-down promoted
 * into a real, server-rendered HTML page with its own URL
 * (`GET /workspace/:urlKey/observation/session/:sessionId`).
 *
 * LIN-1133: per-run expandable transcripts with client-side markdown rendering
 * and per-run inline reply boxes. The page moves from a no-JS snapshot to a
 * JS-enhanced surface: the server embeds feedback data as JSON data-attributes
 * and emits expanded/collapsed run cards; the client renders transcripts with
 * `renderMarkdown()` and wires inline reply boxes scoped to each run's `loopId`.
 *
 * What it renders:
 *   - Overview: seed issue, tasks touched, session timings + telemetry.
 *   - Per-run rows: each loop's kind/iteration, terminal status, timings,
 *     telemetry chips, and a collapsed expandable section containing that run's
 *     transcript and an inline reply box.
 *   - Context: per-issue brief/recap panels with widget containers
 *     (BriefSection/RecapSection) seeded with pre-rendered cached content.
 *   - Global reply: kept as fallback at the bottom of the page.
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

/**
 * A single transcript feedback entry rendered server-side as an escaped
 * fallback (for no-JS viewing). The LIN-1133 client overrides this by reading
 * `data-feedback` from the parent `.sess-run-tx` container and rendering each
 * entry as markdown via `renderMarkdown()`.
 */
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

/**
 * One worker-run row (LIN-1133: expandable). The run head doubles as a toggle
 * button; the expandable section below holds the per-run transcript (client-side
 * markdown rendering from embedded JSON feedback) and the inline reply box.
 */
function renderRun(loop, { canReply, replyTarget, urlKey }) {
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const status = loop.terminalStatus
    ? `<span class="sess-run-status" data-testid="session-run-status">${escapeHtml(loop.terminalStatus)}</span>`
    : '<span class="sess-run-status sess-run-status--live">running</span>';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';

  const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
  const hasFeedback = entries.length > 0;
  const terminal = loop.terminalStatus === 'done' || loop.terminalStatus === 'failed';

  const feedbackJson = hasFeedback ? escapeHtml(JSON.stringify(entries)) : '';
  const inlineReply = canReply
    ? renderInlineReplyBox({ loopId: loop.loopId, iteration: loop.iteration, target: replyTarget, urlKey, terminal })
    : '';

  const hasExpand = hasFeedback || inlineReply;

  const headHtml = `<span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status}
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          <span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>
        </div>
        ${renderRunChips(loop.telemetry)}`;

  const toggleButton = `<button type="button" class="sess-run-toggle" aria-expanded="false" data-session-run-toggle>
    <span class="sess-run-toggle-icon" aria-hidden="true">▶</span>
    <span class="sess-run-toggle-body">
      ${headHtml}
    </span>
  </button>`;

  const expandHtml = hasExpand
    ? `<div class="sess-run-expand hidden">
        ${hasFeedback ? `<div class="sess-run-tx" data-session-run-tx data-feedback="${feedbackJson}">
          <div class="sess-run-tx-fallback">
            <ul class="sess-tx-list">${entries.map(renderTranscriptEntry).join('')}</ul>
          </div>
        </div>` : ''}
        ${inlineReply}
      </div>`
    : '';

  return `<li class="sess-run sess-run--expandable" data-testid="session-run" data-loop-id="${escapeHtml(loop.loopId || '')}">
        ${toggleButton}
        ${expandHtml}
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
 * The human follow-up reply box (LIN-1004, Phase 2 of LIN-950) — kept as the
 * GLOBAL fallback at the bottom of the page. LIN-1133 adds per-run inline reply
 * boxes within each expandable run card; this global box remains for single-run
 * sessions and as an alternate fallback.
 */
function renderReplyBox({ canReply, session, urlKey, replyTarget, sessionTerminal }) {
  if (!canReply || !session) return '';
  const note = sessionTerminal
    ? 'This session has finished — a reply attempts to resume it, but if the session has ended you\'ll see "no live session to resume" in the transcript on reload.'
    : 'Your reply is queued into this session as a follow-up; reload to see it continue.';
  const body = `<textarea class="sess-reply-input" data-testid="session-reply-input" rows="3" placeholder="Reply to this session…" aria-label="Reply to this session"></textarea>
      <div class="sess-reply-actions">
        <button type="button" class="action-btn sess-reply-send" data-testid="session-reply-send">send reply</button>
        <span class="sess-reply-feedback" data-testid="session-reply-feedback" role="status" aria-live="polite"></span>
      </div>
      <p class="sess-reply-note" data-testid="session-reply-note">${escapeHtml(note)}</p>`;
  const attrs = [
    'data-testid="session-reply"',
    'data-session-reply',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-session-id="${escapeHtml(String(session.sessionId || ''))}"`,
    `data-target="${escapeHtml(replyTarget || 'cli')}"`,
    `data-session-terminal="${sessionTerminal ? 'true' : 'false'}"`
  ].join(' ');
  return renderSection({ className: 'sess-section sess-reply-section', title: 'Reply', body, attrs });
}

/**
 * Per-run inline reply box (LIN-1133). Scoped to a single run within an
 * expandable run card. followUpTo is the run's own `loopId` (dispatch UUID),
 * not the session's root id, so replies resume that specific run.
 */
function renderInlineReplyBox({ loopId, iteration, target, urlKey, terminal }) {
  const body = `<textarea class="sess-reply-input sess-inline-reply-input" data-testid="session-inline-reply-input" rows="2" placeholder="Reply to run #${escapeHtml(String(iteration))}…" aria-label="Reply to this run"></textarea>
      <div class="sess-reply-actions">
        <button type="button" class="action-btn sess-reply-send" data-testid="session-inline-reply-send">send reply</button>
        <span class="sess-inline-reply-feedback" data-testid="session-inline-reply-feedback" role="status" aria-live="polite"></span>
      </div>`;
  const attrs = [
    'data-testid="session-inline-reply"',
    'data-session-inline-reply',
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-loop-id="${escapeHtml(String(loopId || ''))}"`,
    `data-target="${escapeHtml(target || 'cli')}"`,
    `data-terminal="${terminal ? 'true' : 'false'}"`
  ].join(' ');
  return `<div class="sess-inline-reply" ${attrs}>${body}</div>`;
}

const RECAP_GROUPS = [
  { key: 'done', label: 'Done', icon: '✓', secondary: 'evidence' },
  { key: 'pending', label: 'Pending', icon: '○', secondary: 'predicted' },
  { key: 'deviations', label: 'Deviations', icon: '◐', secondary: 'evidence' }
];

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

function renderContextBody(kind, body) {
  if (body == null) return '';
  if (typeof body === 'string') {
    return body.trim() ? `<div class="sess-ctx-body-wrap"><pre class="sess-ctx-body">${escapeHtml(body)}</pre></div>` : '';
  }
  if (kind === 'recap' && typeof body === 'object') return renderRecapBody(body);
  return '';
}

/**
 * A brief or recap panel (LIN-1133): emits a container tagged for client-side
 * BriefSection/RecapSection widget initialisation via `data-session-brief` /
 * `data-session-recap` + `data-url-key` + `data-identifier`. Server pre-renders
 * the cached content so first paint shows it; the client widget validates via GET
 * and refreshes if stale.
 */
function renderContextPanel({ label, kind, issueIdentifier, issueId, body, model, generatedAt, urlKey }) {
  const heading = `<div class="sess-ctx-head">
          <span class="sess-ctx-kind">${escapeHtml(label)}</span>
          <span class="sess-ctx-ident" data-testid="session-ctx-ident">${escapeHtml(issueIdentifier || issueId || '')}</span>
        </div>`;
  const renderedBody = renderContextBody(kind, body);
  const widgetAttrs = [
    `data-url-key="${escapeHtml(urlKey || '')}"`,
    `data-identifier="${escapeHtml(issueIdentifier || issueId || '')}"`
  ].join(' ');
  if (renderedBody) {
    const meta = [
      model ? `model ${escapeHtml(String(model))}` : null,
      generatedAt ? `generated ${fmtTs(generatedAt)}` : null
    ].filter(Boolean).join(' · ');
    return `<div class="sess-ctx-panel sess-ctx-panel--present" data-testid="session-${kind}" data-session-${kind} ${widgetAttrs}>
        ${heading}
        ${renderedBody}
        ${meta ? `<div class="sess-ctx-meta">${meta}</div>` : ''}
      </div>`;
  }
  return `<div class="sess-ctx-panel sess-ctx-panel--miss" data-testid="session-${kind}" data-session-${kind} ${widgetAttrs}>
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
 * @param {boolean} [data.canReply]       - the session is a cli/web target → render per-run inline replies + global fallback
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

  // ── Per-run rows (LIN-1133: expandable, transcript + inline reply within) ───
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const runsBody = loops.length
    ? `<ul class="sess-runs">${loops.map(l => renderRun(l, { canReply, replyTarget, urlKey })).join('')}</ul>`
    : '<p class="sess-muted">no runs in this session</p>';

  // ── Context (brief + recap, cache-joined by the route — LIN-1133 widget containers) ─
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

  // LIN-1133: load marked/purify for client-side markdown rendering, common.js
  // for renderMarkdown + api + dispatchPrompt, brief.js + recap.js for context
  // panel widgets, and session.js for the per-run expandable transcript +
  // inline reply + widget initialisation.
  const baseScripts = [
    '/marked.min.js',
    '/purify.min.js',
    '/common.js',
    '/brief.js',
    '/recap.js'
  ];
  const scripts = canReply
    ? [...baseScripts, '/session.js']
    : (issueContext.length ? baseScripts : []);

  return renderPage({
    title: `Session · ${session.seedIssue || session.sessionId || ''}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css'],
    nav: navHtml,
    content,
    scripts
  });
}
