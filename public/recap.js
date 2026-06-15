/**
 * Recap Section — shared client renderer (LIN-261).
 *
 * Renders the ✓/○/⚠ recap list inside a container in one of four states:
 *   - missing:    never generated
 *   - stale:      cached but the task has since changed
 *   - fresh:      cached and matches current context
 *   - generating: POST in flight
 *
 * Exposed as a global `RecapSection` since the swipe and pipeline pages
 * are plain scripts (no module loader / build step).
 */
(function () {
  'use strict';

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function recapUrl(urlKey, identifier) {
    return `/workspace/${encodeURIComponent(urlKey)}/api/recap/${encodeURIComponent(identifier)}`;
  }

  // on401:false — recap errors (incl. 401) throw with .status/.body so the
  // inline renderError path shows them, rather than redirecting to /logout.
  async function fetchRecapStatus(urlKey, identifier) {
    return window.api(recapUrl(urlKey, identifier), { on401: false });
  }

  async function postRecap(urlKey, identifier) {
    return window.api(recapUrl(urlKey, identifier), { method: 'POST', on401: false });
  }

  function renderItems(items, { marker, markerClass }) {
    if (!items || items.length === 0) return '';
    return items.map(it => {
      const title = esc(it.item || '');
      const secondary = esc(it.evidence || it.predicted || '');
      const type = it.type ? `<span class="recap-type">${esc(it.type)}</span>` : '';
      return `
        <li class="recap-item">
          <span class="recap-marker ${markerClass}">${marker}</span>
          <span class="recap-body">
            <span class="recap-item-title">${title}</span>
            ${type}
            ${secondary ? `<span class="recap-item-evidence">${secondary}</span>` : ''}
          </span>
        </li>`;
    }).join('');
  }

  function renderFresh(data) {
    const recap = data.recap || { done: [], pending: [], deviations: [] };
    const done = renderItems(recap.done, { marker: '\u2713', markerClass: 'recap-marker-done' });
    const pending = renderItems(recap.pending, { marker: '\u25CB', markerClass: 'recap-marker-pending' });
    const deviations = renderItems(recap.deviations, { marker: '\u26A0', markerClass: 'recap-marker-deviation' });
    const hasAny = done || pending || deviations;

    const ts = data.generatedAt ? relativeTime(data.generatedAt) : '';
    const meta = `<span class="recap-meta">updated ${esc(ts) || 'now'}</span>`;
    const refreshBtn = `<button type="button" class="recap-refresh" data-recap-refresh>\u21BB refresh</button>`;

    if (!hasAny) {
      return `
        <div class="recap-header">
          <span class="recap-status-label">recap</span>
          ${meta}
          ${refreshBtn}
        </div>
        <div class="recap-empty">Nothing to recap yet.</div>`;
    }

    return `
      <div class="recap-header">
        <span class="recap-status-label">recap</span>
        ${meta}
        ${refreshBtn}
      </div>
      ${done ? `<ul class="recap-list recap-list-done"><li class="recap-section-title">done</li>${done}</ul>` : ''}
      ${pending ? `<ul class="recap-list recap-list-pending"><li class="recap-section-title">pending</li>${pending}</ul>` : ''}
      ${deviations ? `<ul class="recap-list recap-list-deviations"><li class="recap-section-title">deviations</li>${deviations}</ul>` : ''}`;
  }

  function renderStale(data) {
    const ts = data && data.generatedAt ? relativeTime(data.generatedAt) : '';
    return `
      <div class="recap-header">
        <span class="recap-status-label">recap · out of date</span>
        ${ts ? `<span class="recap-meta">last ${esc(ts)}</span>` : ''}
        <button type="button" class="recap-refresh" data-recap-refresh>\u21BB refresh</button>
      </div>
      <div class="recap-placeholder">Inputs have changed since this recap was generated. Refresh to update.</div>`;
  }

  function renderMissing() {
    return `
      <div class="recap-header">
        <span class="recap-status-label">recap</span>
        <button type="button" class="recap-refresh" data-recap-refresh>\u2726 generate</button>
      </div>
      <div class="recap-placeholder">No recap yet. Generate one to see a summary of progress so far.</div>`;
  }

  function renderGenerating() {
    return `
      <div class="recap-header">
        <span class="recap-status-label">recap · generating\u2026</span>
      </div>
      <div class="recap-placeholder recap-generating">
        <span class="recap-spinner"></span> Asking the model for a progress summary.
      </div>`;
  }

  function renderError(message) {
    return `
      <div class="recap-header">
        <span class="recap-status-label">recap · error</span>
        <button type="button" class="recap-refresh" data-recap-refresh>\u21BB retry</button>
      </div>
      <div class="recap-placeholder recap-error">${esc(message || 'Could not load recap.')}</div>`;
  }

  function applyState(container, html, state) {
    container.innerHTML = html;
    container.setAttribute('data-state', state);
  }

  function wireRefresh(container, urlKey, identifier) {
    const btn = container.querySelector('[data-recap-refresh]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await refresh(container, urlKey, identifier);
    });
  }

  async function refresh(container, urlKey, identifier) {
    applyState(container, renderGenerating(), 'generating');
    try {
      const data = await postRecap(urlKey, identifier);
      applyState(container, renderFresh(data), 'fresh');
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, urlKey, identifier);
  }

  /**
   * Initialise a recap section inside the given container.
   *
   * @param {HTMLElement} container - The element to render into.
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.identifier - Linear issue id (UUID) or identifier (LIN-123).
   */
  async function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('recap-section');
    applyState(container, renderGenerating(), 'loading');

    try {
      const data = await fetchRecapStatus(opts.urlKey, opts.identifier);
      if (data.status === 'fresh') {
        applyState(container, renderFresh(data), 'fresh');
      } else if (data.status === 'stale') {
        applyState(container, renderStale(data), 'stale');
      } else {
        applyState(container, renderMissing(), 'missing');
      }
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, opts.urlKey, opts.identifier);
  }

  window.RecapSection = { init, refresh };
})();
