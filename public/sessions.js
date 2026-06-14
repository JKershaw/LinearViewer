/**
 * Sessions Section — shared client renderer.
 *
 * Renders the "Dispatched Sessions" list (pipeline Loops for one issue) inside a
 * container. Lazy-loaded when the Swipe accordion opens; fetches from
 * GET /workspace/:urlKey/api/sessions/:identifier and shows one of:
 *   - loading:  fetch in flight
 *   - empty:    issue has never been dispatched
 *   - list:     one or more sessions, newest-first, with feedback
 *   - error:    fetch failed (retryable)
 *
 * Exposed as a global `SessionsSection` since the Swipe page is a plain script
 * (no module loader / build step). Visual language mirrors the pipeline overlay
 * loop history (public/pipeline.js renderLoopEntry).
 */
(function () {
  'use strict';

  const STATE_INDICATORS = {
    queued: { symbol: '○', css: 'state-queued' },
    running: { symbol: '◐', css: 'state-running' },
    waiting: { symbol: '◑', css: 'state-waiting' },
    complete: { symbol: '✓', css: 'state-complete' },
    error: { symbol: '✕', css: 'state-error' }
  };

  const STAGE_LABELS = {
    research: 'research',
    plan: 'plan',
    breakdown: 'breakdown',
    implementation: 'impl',
    review: 'review',
    blocked: 'blocked',
    bug: 'bug'
  };

  function esc(str) {
    return window.escapeHtml ? window.escapeHtml(str) : String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage || '—';
  }

  function stateIndicator(agentState) {
    return STATE_INDICATORS[agentState] || STATE_INDICATORS.queued;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffSec = Math.floor((Date.now() - then) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  function sessionsUrl(urlKey, identifier) {
    return `/workspace/${encodeURIComponent(urlKey)}/api/sessions/${encodeURIComponent(identifier)}`;
  }

  async function fetchSessions(urlKey, identifier) {
    const res = await fetch(sessionsUrl(urlKey, identifier));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Sessions GET failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function renderFeedback(feedback) {
    if (!feedback || feedback.length === 0) return '';
    const entries = feedback.map((f) => {
      const time = relativeTime(f.timestamp);
      const timeHtml = time ? ` <span class="session-feedback-time">· ${esc(time)}</span>` : '';
      return `<div class="session-feedback-entry">${esc(f.message || '')}${timeHtml}</div>`;
    }).join('');
    return `<div class="session-feedback">${entries}</div>`;
  }

  function renderSession(s) {
    const si = stateIndicator(s.agentState);
    const time = relativeTime(s.dispatchedAt);
    const summaryHtml = s.foremanSummary
      ? `<div class="session-summary">${esc(s.foremanSummary)}</div>`
      : '';
    return `
      <div class="session-entry" data-agent-state="${esc(s.agentState || '')}">
        <div class="session-header">
          <span class="session-state ${si.css}">${si.symbol}</span>
          <span class="session-stage badge">${esc(stageLabel(s.stage))}</span>
          <span class="session-prompt-name">${esc(s.promptName || '')}</span>
          ${s.iteration ? `<span class="session-iteration">#${esc(s.iteration)}</span>` : ''}
          <span class="session-time">${esc(time)}</span>
        </div>
        ${summaryHtml}
        ${renderFeedback(s.feedback)}
      </div>`;
  }

  function header(count) {
    const refresh = `<button type="button" class="sessions-refresh" data-sessions-refresh>↻ refresh</button>`;
    return `
      <div class="sessions-header">
        <span class="sessions-status-label">dispatched sessions</span>
        <span class="sessions-count-meta">${count}</span>
        ${refresh}
      </div>`;
  }

  function renderList(sessions) {
    if (!sessions || sessions.length === 0) {
      return `
        ${header(0)}
        <div class="sessions-empty">No sessions yet. Dispatch a prompt to start one.</div>`;
    }
    return `${header(sessions.length)}${sessions.map(renderSession).join('')}`;
  }

  function renderLoading() {
    return `
      ${header('…')}
      <div class="sessions-empty sessions-loading">Loading sessions…</div>`;
  }

  function renderError(message) {
    return `
      <div class="sessions-header">
        <span class="sessions-status-label">dispatched sessions · error</span>
        <button type="button" class="sessions-refresh" data-sessions-refresh>↻ retry</button>
      </div>
      <div class="sessions-empty sessions-error">${esc(message || 'Could not load sessions.')}</div>`;
  }

  function applyState(container, html, state) {
    container.innerHTML = html;
    container.setAttribute('data-state', state);
  }

  function wireRefresh(container, opts) {
    const btn = container.querySelector('[data-sessions-refresh]');
    if (!btn) return;
    btn.addEventListener('click', () => load(container, opts));
  }

  async function load(container, opts) {
    applyState(container, renderLoading(), 'loading');
    try {
      const data = await fetchSessions(opts.urlKey, opts.identifier);
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      applyState(container, renderList(sessions), sessions.length ? 'list' : 'empty');
      // Self-heal the accordion header count from the authoritative fetch.
      if (typeof opts.onCount === 'function') opts.onCount(sessions.length);
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, opts);
  }

  /**
   * Initialise a sessions section inside the given container.
   *
   * @param {HTMLElement} container
   * @param {Object} opts
   * @param {string} opts.urlKey      - Workspace url key.
   * @param {string} opts.identifier  - Linear issue identifier (LIN-123) or id.
   * @param {Function} [opts.onCount] - Called with the fetched session count.
   */
  function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('sessions-section');
    load(container, opts);
  }

  window.SessionsSection = { init };
})();
