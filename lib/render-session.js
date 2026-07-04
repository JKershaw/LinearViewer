/**
 * Per-session Page Renderer (LIN-1003, Phase 1).
 *
 * Renders ONE assembled autopilot session as a standalone, server-rendered HTML
 * page — the promoted Observation drill-down at
 * `GET /workspace/:urlKey/observation/session/:sessionId`. A pure
 * `(data, options) → HTML string` on the shared page shell
 * (`lib/components/page.js`), mirroring the `render-*.js` convention
 * (`render-observation.js`). Zero I/O: the route hands it an already-assembled
 * NON-lean session object (so `loop.feedback[]` — the transcript — is present).
 *
 * Sections:
 *   - Overview  — sessionId, status/phase, runtime, model (when present),
 *                 tasks-touched count.
 *   - Tasks     — the distinct issues the session's loops touched (identifier +
 *                 title), each linking out to the issue.
 *   - Runs      — per loop/run: kind/phase, runtime, model?, metric chips, and
 *                 produced-artifact links (from `lib/session-telemetry.js`,
 *                 baked pre-lean onto `loop.telemetry`).
 *   - Transcript— the core content: every `loop.feedback[]` entry
 *                 `{message, url, urlLabel, timestamp}`, chronological per run,
 *                 each with its timestamp and an evidence link when present.
 *   - Context   — per touched-issue brief + recap panels, rendered from the
 *                 route's CACHE-ONLY join (pure Mongo `.get()` by issue UUID);
 *                 on a miss, an explicit `<form method="post">` generate
 *                 affordance — generation fires only on submit, never on load.
 *
 * Read-only/additive: never spends an LLM call, never mutates the session.
 * `telemetry.model` is OPTIONAL (omitted until the runner emits it) and rendered
 * only when present. Follows the typographic split — mono (`--font-structural`)
 * for machine facts (IDs, counts, timestamps, runtimes), sans (`--font-content`)
 * for prose/labels.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderEmptyState } from './components/empty-state.js';

// ─── Formatting helpers (pure) ────────────────────────────────────────────────

// Human duration from milliseconds: `1h 5m`, `8m 11s`, `45s`, `—` when absent.
function fmtRuntime(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

// A stable, locale-independent timestamp for a feedback entry. Renders the ISO
// string as-is (already a machine fact); returns '' for a missing timestamp so
// the caller can omit the element.
function fmtTimestamp(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

// Session status glyph + label from the assembled session. Terminal when
// `completedAt` is set (assembly only sets it once EVERY loop is terminal —
// LIN-637); an error terminalStatus on any loop surfaces as ✕.
function sessionStatus(session) {
  const loops = session.loops || [];
  const anyError = loops.some(l => l.terminalStatus === 'failed' || l.agentState === 'error');
  if (session.completedAt) {
    return anyError ? { glyph: '✕', label: 'completed with errors' } : { glyph: '✓', label: 'completed' };
  }
  return { glyph: '◐', label: 'in progress' };
}

// Distinct issues touched, in first-seen order, carrying title + out-link. The
// seed issue is flagged. `session.tasksTouched` is identifiers only, so the
// title/url are recovered from the loops (best-effort; nulls tolerated).
function distinctIssues(session) {
  const bySeen = new Map();
  for (const loop of (session.loops || [])) {
    const id = loop.issueIdentifier;
    if (!id || bySeen.has(id)) continue;
    bySeen.set(id, {
      identifier: id,
      title: loop.issueTitle || null,
      url: loop.issueUrl || null,
      isSeed: id === session.seedIssue
    });
  }
  return [...bySeen.values()];
}

// ─── Section builders ─────────────────────────────────────────────────────────

function renderMetaLine(session) {
  const status = sessionStatus(session);
  const runtime = fmtRuntime(session.telemetry?.runtime?.ms);
  const model = session.telemetry?.model || null;
  const taskCount = distinctIssues(session).length;
  const runCount = (session.loops || []).length;

  const chips = [
    `<span class="sp-meta-chip" data-testid="session-status"><span class="sp-glyph">${escapeHtml(status.glyph)}</span> ${escapeHtml(status.label)}</span>`,
    `<span class="sp-meta-chip">runtime <code class="sp-num">${escapeHtml(runtime)}</code></span>`,
    `<span class="sp-meta-chip">runs <code class="sp-num">${runCount}</code></span>`,
    `<span class="sp-meta-chip">tasks <code class="sp-num">${taskCount}</code></span>`
  ];
  // model chip only when present — omitted by design until the runner emits it.
  if (model) {
    chips.push(`<span class="sp-meta-chip" data-testid="session-model">model <code class="sp-num">${escapeHtml(model)}</code></span>`);
  }
  return `<div class="sp-meta" data-testid="session-meta">${chips.join('')}</div>`;
}

function renderTasks(session) {
  const issues = distinctIssues(session);
  if (!issues.length) {
    return renderEmptyState({ tag: 'p', className: 'sp-empty', text: '○ no tasks recorded for this session' });
  }
  const rows = issues.map(issue => {
    const label = escapeHtml(issue.identifier);
    const idHtml = issue.url
      ? `<a class="sp-task-id" href="${escapeHtml(issue.url)}">${label}</a>`
      : `<span class="sp-task-id">${label}</span>`;
    const seed = issue.isSeed ? '<span class="sp-seed-tag">seed</span>' : '';
    const title = issue.title ? `<span class="sp-task-title">${escapeHtml(issue.title)}</span>` : '';
    return `<li class="sp-task" data-testid="session-task">${idHtml}${seed}${title}</li>`;
  }).join('');
  return `<ul class="sp-tasks" data-testid="session-tasks">${rows}</ul>`;
}

// One run's telemetry block: kind/phase, runtime, model?, metric + artifact
// chips. `session-telemetry` wraps the chips so e2e can assert on them.
function renderRunTelemetry(loop) {
  const t = loop.telemetry || {};
  const runtime = fmtRuntime(t.runtime?.ms);
  const model = t.model || null;
  const metrics = Array.isArray(t.metrics) ? t.metrics : [];
  const artifacts = Array.isArray(t.producedArtifacts) ? t.producedArtifacts : [];

  const chips = [`<span class="sp-chip">runtime <code class="sp-num">${escapeHtml(runtime)}</code></span>`];
  if (model) chips.push(`<span class="sp-chip">model <code class="sp-num">${escapeHtml(model)}</code></span>`);
  if (metrics.length) {
    const last = metrics[metrics.length - 1];
    const tools = last?.total ?? last?.toolCount;
    if (tools != null) chips.push(`<span class="sp-chip">tools <code class="sp-num">${escapeHtml(String(tools))}</code></span>`);
  }

  const artifactHtml = artifacts.length
    ? `<ul class="sp-artifacts">${artifacts.map(a => {
        const label = escapeHtml(a.label || a.url || 'artifact');
        return `<li class="sp-artifact"><a href="${escapeHtml(a.url)}">${label}</a></li>`;
      }).join('')}</ul>`
    : '';

  return `<div class="sp-telemetry" data-testid="session-telemetry">`
    + `<div class="sp-chips">${chips.join('')}</div>${artifactHtml}</div>`;
}

function renderRuns(session) {
  const loops = session.loops || [];
  if (!loops.length) {
    return renderEmptyState({ tag: 'p', className: 'sp-empty', text: '○ no runs in this session' });
  }
  const rows = loops.map(loop => {
    const iter = loop.iteration != null ? loop.iteration : '';
    const kind = loop.kind || loop.stage || loop.promptName || 'run';
    const id = loop.issueIdentifier ? escapeHtml(loop.issueIdentifier) : '—';
    const title = loop.issueTitle ? `<span class="sp-run-title">${escapeHtml(loop.issueTitle)}</span>` : '';
    return `<li class="sp-run" data-testid="session-run">
      <div class="sp-run-head">
        <code class="sp-run-iter">#${escapeHtml(String(iter))}</code>
        <span class="sp-run-kind">${escapeHtml(kind)}</span>
        <code class="sp-run-id">${id}</code>${title}
      </div>
      ${renderRunTelemetry(loop)}
    </li>`;
  }).join('');
  return `<ol class="sp-runs">${rows}</ol>`;
}

// The core content: every feedback entry, grouped per run in chronological
// order, each with timestamp + evidence link when present.
function renderTranscript(session) {
  const loops = session.loops || [];
  const groups = loops.map(loop => {
    const entries = Array.isArray(loop.feedback) ? loop.feedback : [];
    if (!entries.length) return '';
    const heading = loop.issueIdentifier
      ? `<code class="sp-tr-run">#${escapeHtml(String(loop.iteration ?? ''))} ${escapeHtml(loop.issueIdentifier)}</code>`
      : `<code class="sp-tr-run">#${escapeHtml(String(loop.iteration ?? ''))}</code>`;
    const rows = entries.map(entry => {
      const ts = fmtTimestamp(entry?.timestamp);
      const tsHtml = ts ? `<time class="sp-tr-ts">${escapeHtml(ts)}</time>` : '';
      const msg = escapeHtml(entry?.message || '');
      const link = entry?.url
        ? ` <a class="sp-tr-link" href="${escapeHtml(entry.url)}">${escapeHtml(entry.urlLabel || 'link')}</a>`
        : '';
      return `<li class="sp-tr-entry" data-testid="session-transcript-entry">${tsHtml}<span class="sp-tr-msg">${msg}</span>${link}</li>`;
    }).join('');
    return `<div class="sp-tr-group"><div class="sp-tr-grouphead">${heading}</div><ul class="sp-tr-list">${rows}</ul></div>`;
  }).filter(Boolean).join('');

  if (!groups) {
    return renderEmptyState({ tag: 'p', className: 'sp-empty', text: '○ no transcript recorded for this session' });
  }
  return `<div class="sp-transcript" data-testid="session-transcript">${groups}</div>`;
}

// ─── Brief / recap panels (LIN-1003, the ticket's key new wiring) ─────────────
//
// Rendered from the CACHE-ONLY join the route handler already built
// (`joinBriefRecap` → `briefCacheStore.get`/`recapCacheStore.get`, pure Mongo
// reads keyed by issue UUID). This renderer only ever READS that pre-fetched
// data — it holds no store handle and issues no request, so a page render can
// NEVER auto-spend an LLM call. On a cache miss it emits an explicit,
// user-initiated generate affordance (a `<form method="post">` to the existing
// session-authed on-demand endpoint) — generation happens only on submit, never
// on load.
//
// The brief is AI-authored Markdown; with no server-side HTML sanitizer
// available we render it as escaped, whitespace-preserving text (XSS-safe, fully
// readable) rather than piping raw HTML through `marked`. The recap is already a
// structured `{done,pending,deviations}` object of sanitized strings, so it
// renders as escaped labelled lists.

// Explicit, no-JS generate affordance: an HTML form that POSTs to the existing
// session-authed on-demand endpoint. Fires only on user submit — never on load.
function renderGenerateForm(kind, urlKey, issueId) {
  const action = `/workspace/${encodeURIComponent(urlKey || '')}/api/${kind}/${encodeURIComponent(issueId)}`;
  return `<form class="sp-generate" method="post" action="${escapeHtml(action)}" data-testid="session-${kind}-generate">`
    + `<p class="sp-muted">No cached ${kind}. </p>`
    + `<button type="submit" class="sp-generate-btn">Generate ${kind}</button>`
    + `</form>`;
}

// Small meta line for a cached panel: when it was generated + the model, both
// machine facts (mono). `model` omitted when absent.
function panelMeta(cached) {
  const ts = fmtTimestamp(cached?.generatedAt);
  const bits = [];
  if (ts) bits.push(`<code class="sp-num">${escapeHtml(ts)}</code>`);
  if (cached?.model) bits.push(`<code class="sp-num">${escapeHtml(cached.model)}</code>`);
  return bits.length ? `<div class="sp-panel-meta">${bits.join(' · ')}</div>` : '';
}

function renderBriefPanel(brief, urlKey, issueId) {
  if (!brief || !brief.brief || !String(brief.brief).trim()) {
    return `<div class="sp-brief" data-testid="session-brief">`
      + `<div class="sp-panel-label">brief</div>`
      + renderGenerateForm('brief', urlKey, issueId)
      + `</div>`;
  }
  return `<div class="sp-brief" data-testid="session-brief">`
    + `<div class="sp-panel-label">brief</div>`
    + panelMeta(brief)
    + `<pre class="sp-brief-body">${escapeHtml(String(brief.brief))}</pre>`
    + `</div>`;
}

function recapList(label, items, fields) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(it => {
    const main = escapeHtml(it[fields[0]] || '');
    const extra = fields.slice(1)
      .map(f => it[f] ? `<span class="sp-recap-extra">${escapeHtml(it[f])}</span>` : '')
      .join('');
    return `<li class="sp-recap-item">${main}${extra}</li>`;
  }).join('');
  return `<div class="sp-recap-group"><div class="sp-recap-grouplabel">${escapeHtml(label)}</div><ul class="sp-recap-list">${rows}</ul></div>`;
}

function renderRecapPanel(recap, urlKey, issueId) {
  const payload = recap?.recap || null;
  const hasContent = payload && (
    (payload.done && payload.done.length) ||
    (payload.pending && payload.pending.length) ||
    (payload.deviations && payload.deviations.length)
  );
  if (!hasContent) {
    return `<div class="sp-recap" data-testid="session-recap">`
      + `<div class="sp-panel-label">recap</div>`
      + renderGenerateForm('recap', urlKey, issueId)
      + `</div>`;
  }
  return `<div class="sp-recap" data-testid="session-recap">`
    + `<div class="sp-panel-label">recap</div>`
    + panelMeta(recap)
    + recapList('Done', payload.done, ['item', 'evidence'])
    + recapList('Pending', payload.pending, ['item', 'predicted'])
    + recapList('Deviations', payload.deviations, ['item', 'type', 'evidence'])
    + `</div>`;
}

// Per touched-issue context panel: cached brief + recap, or explicit-generate on
// a miss. `briefRecap` is the route's cache-only join array.
function renderContext(briefRecap, urlKey) {
  const entries = Array.isArray(briefRecap) ? briefRecap : [];
  if (!entries.length) {
    return renderEmptyState({ tag: 'p', className: 'sp-empty', text: '○ no issue context available (no cache-joinable issues in this session)' });
  }
  const panels = entries.map(entry => {
    const label = escapeHtml(entry.issueIdentifier || entry.issueId || 'issue');
    const title = entry.issueTitle ? `<span class="sp-ctx-title">${escapeHtml(entry.issueTitle)}</span>` : '';
    return `<div class="sp-ctx" data-testid="session-context">
      <div class="sp-ctx-head"><code class="sp-ctx-id">${label}</code>${title}</div>
      ${renderBriefPanel(entry.brief, urlKey, entry.issueId)}
      ${renderRecapPanel(entry.recap, urlKey, entry.issueId)}
    </div>`;
  }).join('');
  return `<div class="sp-context">${panels}</div>`;
}

/**
 * @param {Object}  data
 * @param {Object}  data.session - Assembled NON-lean session (from
 *   `getSessionsForWorkspace(...).find(...)`): `{ sessionId, seedIssue,
 *   tasksTouched[], loops[], dispatchedAt, completedAt, telemetry }`.
 * @param {Object}  [options]
 * @param {string}  [options.urlKey]         - Anchoring workspace urlKey.
 * @param {Object}  [options.deployInfo]
 * @param {string}  [options.openRouterSource]
 * @param {Array}   [options.workspaces]     - Session workspaces (for navbar).
 * @param {Object}  [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderSessionPage(data = {}, options = {}) {
  const session = data.session || {};
  const briefRecap = data.briefRecap || [];
  const {
    urlKey = '',
    deployInfo = {},
    openRouterSource = null,
    workspaces = [],
    featureFlags = {}
  } = options;

  const encodedUrlKey = escapeHtml(urlKey || '');
  const sessionId = String(session.sessionId || '');
  const backHref = `/workspace/${encodeURIComponent(urlKey || '')}/observation`;

  const navHtml = renderNavBar({
    workspaces,
    urlKey,
    currentPage: 'observation',
    featureFlags
  });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/observation', urlKey, openRouterSource, featureFlags });

  const titleHtml = `Session <code class="sp-title-id">${escapeHtml(sessionId)}</code>`;

  const content = `<main class="sp-page" data-testid="session-page" data-url-key="${encodedUrlKey}" data-session-id="${escapeHtml(sessionId)}">
    <p class="sp-back"><a href="${escapeHtml(backHref)}" data-testid="session-back">← back to feed</a></p>
    ${renderPageHeader({ titleHtml, headerClass: 'sp-header' })}
    ${renderMetaLine(session)}

    ${renderSection({ className: 'sp-section sp-tasks-section', title: 'Tasks touched', body: renderTasks(session) })}

    ${renderSection({ className: 'sp-section sp-runs-section', title: 'Runs', body: renderRuns(session) })}

    ${renderSection({ className: 'sp-section sp-transcript-section', title: 'Transcript', body: renderTranscript(session) })}

    ${renderSection({ className: 'sp-section sp-context-section', title: 'Context', body: renderContext(briefRecap, urlKey) })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Session ${sessionId}`,
    stylesheets: ['/style.css', '/common-actions.css', '/session.css'],
    nav: navHtml,
    content
  });
}
