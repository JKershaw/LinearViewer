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
 *   - Per-run rows: each loop's kind/iteration, terminal status, timings and
 *     telemetry chips. `telemetry.model` renders ONLY when present — the runner
 *     does not emit worker model yet (LIN-594), so it is legitimately absent.
 *   - Transcript: the raw, link-rich `loop.feedback[]` entries, chronological
 *     per loop. Genuinely new — nothing else renders the raw transcript.
 *   - Context: per-issue brief/recap, joined from the caches by the route.
 *     CACHE-ONLY on load — a miss renders an explicit, cost-aware generate
 *     affordance, NEVER an auto-LLM-spend on page load.
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

/** One worker-run row. */
function renderRun(loop) {
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const status = loop.terminalStatus
    ? `<span class="sess-run-status" data-testid="session-run-status">${escapeHtml(loop.terminalStatus)}</span>`
    : '<span class="sess-run-status sess-run-status--live">running</span>';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';
  return `<li class="sess-run" data-testid="session-run">
        <div class="sess-run-head">
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          <span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>
        </div>
        ${renderRunChips(loop.telemetry)}
      </li>`;
}

/** A brief or recap panel: cached body when present, generate affordance on miss. */
function renderContextPanel({ label, kind, issueIdentifier, issueId, body, model, generatedAt }) {
  const heading = `<div class="sess-ctx-head">
          <span class="sess-ctx-kind">${escapeHtml(label)}</span>
          <span class="sess-ctx-ident" data-testid="session-ctx-ident">${escapeHtml(issueIdentifier || issueId || '')}</span>
        </div>`;
  if (body) {
    const meta = [
      model ? `model ${escapeHtml(String(model))}` : null,
      generatedAt ? `generated ${fmtTs(generatedAt)}` : null
    ].filter(Boolean).join(' · ');
    return `<div class="sess-ctx-panel sess-ctx-panel--present" data-testid="session-${kind}">
        ${heading}
        <pre class="sess-ctx-body">${escapeHtml(String(body))}</pre>
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
 * @param {string} [data.urlKey]
 * @param {Object} [options]
 * @returns {string} Complete HTML document
 */
export function renderSessionPage(data = {}, options = {}) {
  const { session = null, sessionId = '', issueContext = [], urlKey = '' } = data;
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

  // ── Per-run rows ────────────────────────────────────────────────────────────
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const runsBody = loops.length
    ? `<ul class="sess-runs">${loops.map(renderRun).join('')}</ul>`
    : '<p class="sess-muted">no runs in this session</p>';

  // ── Transcript (raw link-rich feedback, chronological per loop) ──────────────
  const transcriptBlocks = loops.map(loop => {
    const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
    if (!entries.length) return '';
    const heading = `<div class="sess-tx-loop-head">${escapeHtml(loop.issueIdentifier || '(run)')} · #${escapeHtml(String(loop.iteration ?? ''))}</div>`;
    return `<div class="sess-tx-loop">
        ${heading}
        <ul class="sess-tx-list">${entries.map(renderTranscriptEntry).join('')}</ul>
      </div>`;
  }).filter(Boolean).join('');
  const transcriptBody = transcriptBlocks
    ? `<div class="sess-tx" data-testid="session-transcript">${transcriptBlocks}</div>`
    : '<p class="sess-muted" data-testid="session-transcript-empty">○ no transcript recorded for this session</p>';

  // ── Context (brief + recap, cache-joined by the route) ──────────────────────
  const contextBody = issueContext.length
    ? issueContext.map(ctx => `<div class="sess-ctx-issue">
        ${renderContextPanel({ label: 'Brief', kind: 'brief', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.brief, model: ctx.briefModel, generatedAt: ctx.briefGeneratedAt })}
        ${renderContextPanel({ label: 'Recap', kind: 'recap', issueIdentifier: ctx.issueIdentifier, issueId: ctx.issueId, body: ctx.recap, model: ctx.recapModel, generatedAt: ctx.recapGeneratedAt })}
      </div>`).join('')
    : '<p class="sess-muted" data-testid="session-context-empty">○ no task context available to join</p>';

  const content = `<main class="sess-page" data-url-key="${encodedUrlKey}" data-testid="session-page">
    ${renderPageHeader({ titleHtml: `Session · ${escapeHtml(session.seedIssue || String(session.sessionId || ''))}`, headerClass: 'sess-header' })}
    ${backLink}
    ${renderSection({ className: 'sess-section sess-overview', title: 'Overview', body: overviewBody })}
    ${renderSection({ className: 'sess-section sess-runs-section', title: 'Runs', body: runsBody })}
    ${renderSection({ className: 'sess-section sess-transcript-section', title: 'Transcript', body: transcriptBody })}
    ${renderSection({ className: 'sess-section sess-context-section', title: 'Task context', body: contextBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Session · ${session.seedIssue || session.sessionId || ''}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css'],
    nav: navHtml,
    content
  });
}
