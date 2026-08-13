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

  // Canonical HTML-escape helper lives in common.js (window.escapeHtml,
  // LIN-422). Alias to the shared copy — behaviour-neutral (&#039; renders
  // identically to the old &#39;, and the nullish guard is preserved).
  const esc = window.escapeHtml;

  // Canonical relative-time helper lives in common.js (window.relativeTime,
  // LIN-421); converges onto the shared "Behavior B" formatter.
  const relativeTime = window.relativeTime;

  // LIN-1910: `source` (the resolved provider, stamped server-side in
  // lib/render.js) forwards as `?source=` so the fetch resolves THIS issue's
  // own binding instead of the workspace's active provider. Optional — a
  // caller with no source (or a same-binding workspace) gets no query change.
  function recapUrl(urlKey, identifier, source) {
    const base = `/workspace/${encodeURIComponent(urlKey)}/api/recap/${encodeURIComponent(identifier)}`;
    if (!source) return base;
    const params = new URLSearchParams();
    params.set('source', source);
    return `${base}?${params.toString()}`;
  }

  // on401:false — recap errors (incl. 401) throw with .status/.body so the
  // inline renderError path shows them, rather than redirecting to /logout.
  async function fetchRecapStatus(urlKey, identifier, source) {
    return window.api(recapUrl(urlKey, identifier, source), { on401: false });
  }

  async function postRecap(urlKey, identifier, source) {
    return window.api(recapUrl(urlKey, identifier, source), { method: 'POST', on401: false });
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

  function wireRefresh(container, urlKey, identifier, source) {
    const btn = container.querySelector('[data-recap-refresh]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await refresh(container, urlKey, identifier, source);
    });
  }

  async function refresh(container, urlKey, identifier, source) {
    applyState(container, renderGenerating(), 'generating');
    try {
      const data = await postRecap(urlKey, identifier, source);
      applyState(container, renderFresh(data), 'fresh');
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, urlKey, identifier, source);
  }

  /**
   * Initialise a recap section inside the given container.
   *
   * @param {HTMLElement} container - The element to render into.
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.identifier - Linear issue id (UUID) or identifier (LIN-123).
   * @param {string} [opts.source] - Resolved provider name (LIN-1910), forwarded as `?source=`.
   */
  async function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('recap-section');
    applyState(container, renderGenerating(), 'loading');
    const { urlKey, identifier, source } = opts;

    try {
      const data = await fetchRecapStatus(urlKey, identifier, source);
      if (data.status === 'fresh') {
        applyState(container, renderFresh(data), 'fresh');
      } else if (data.status === 'stale') {
        applyState(container, renderStale(data), 'stale');
      } else {
        // Auto-generate on the first open of a missing recap, mirroring the
        // Context section's populate-on-open behavior (LIN-998). The cheap GET
        // above already confirmed `missing`, so this is the only branch that
        // spends an LLM call — `fresh` renders the cache and `stale` keeps its
        // manual ↻ refresh, so fresh content is never clobbered and we never
        // re-spend on every reopen. `refresh()` renders generating→fresh/error
        // and wires its own button, so return before the shared wireRefresh
        // below to avoid double-wiring the refresh handler.
        await refresh(container, urlKey, identifier, source);
        return;
      }
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, urlKey, identifier, source);
  }

  window.RecapSection = { init, refresh };
})();
