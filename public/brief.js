/**
 * Brief Section — shared client renderer.
 *
 * Renders the Markdown task brief inside a container in one of four states:
 *   - missing:    never generated
 *   - stale:      cached but the task has since changed
 *   - fresh:      cached and matches current context
 *   - generating: POST in flight
 *
 * Mirrors recap.js. The fresh body is Markdown (rendered via marked +
 * DOMPurify) rather than structured lists. Exposed as a global `BriefSection`
 * since the swipe page is a plain script (no module loader / build step).
 */
(function () {
  'use strict';

  // Canonical HTML-escape helper lives in common.js (window.escapeHtml,
  // LIN-422). Alias to the shared copy — behaviour-neutral (&#039; renders
  // identically to the old &#39;, and the nullish guard is preserved).
  const esc = window.escapeHtml;

  // Canonical markdown + relative-time helpers live in common.js (window.*,
  // LIN-421). Alias to the shared copies — relativeTime converges onto the
  // friendlier shared "Behavior B" (yesterday/<7d/short-date) formatter.
  const renderMarkdown = window.renderMarkdown;
  const relativeTime = window.relativeTime;

  // LIN-1910: `source` (the resolved provider, stamped server-side in
  // lib/render.js) forwards as `?source=` so the fetch resolves THIS issue's
  // own binding instead of the workspace's active provider. Optional — a
  // caller with no source (or a same-binding workspace) gets no query change.
  function briefUrl(urlKey, identifier, source) {
    const base = `/workspace/${encodeURIComponent(urlKey)}/api/brief/${encodeURIComponent(identifier)}`;
    if (!source) return base;
    const params = new URLSearchParams();
    params.set('source', source);
    return `${base}?${params.toString()}`;
  }

  // on401:false — brief errors (incl. 401) throw with .status/.body so the
  // inline renderError path shows them, rather than redirecting to /logout.
  async function fetchBriefStatus(urlKey, identifier, source) {
    return window.api(briefUrl(urlKey, identifier, source), { on401: false });
  }

  async function postBrief(urlKey, identifier, source) {
    return window.api(briefUrl(urlKey, identifier, source), { method: 'POST', on401: false });
  }

  function header(label, meta, refreshLabel) {
    const metaHtml = meta ? `<span class="brief-meta">${esc(meta)}</span>` : '';
    return `
      <div class="brief-header">
        <span class="brief-status-label">${esc(label)}</span>
        ${metaHtml}
        <button type="button" class="brief-refresh" data-brief-refresh>${refreshLabel}</button>
      </div>`;
  }

  function renderFresh(data) {
    const ts = data.generatedAt ? relativeTime(data.generatedAt) : '';
    const meta = `updated ${ts || 'now'}`;
    const body = data.brief && data.brief.trim()
      ? `<div class="brief-content">${renderMarkdown(data.brief)}</div>`
      : `<div class="brief-empty">Nothing to brief yet.</div>`;
    return `${header('brief', meta, '↻ refresh')}${body}`;
  }

  function renderStale(data) {
    const ts = data && data.generatedAt ? relativeTime(data.generatedAt) : '';
    return `${header('brief · out of date', ts ? `last ${ts}` : '', '↻ refresh')}
      <div class="brief-placeholder">Inputs have changed since this brief was generated. Refresh to update.</div>`;
  }

  function renderMissing() {
    return `
      <div class="brief-header">
        <span class="brief-status-label">brief</span>
        <button type="button" class="brief-refresh" data-brief-refresh>✦ generate</button>
      </div>
      <div class="brief-placeholder">No brief yet. Generate one to see a current-state summary of the task.</div>`;
  }

  function renderGenerating() {
    return `
      <div class="brief-header">
        <span class="brief-status-label">brief · generating…</span>
      </div>
      <div class="brief-placeholder brief-generating">
        <span class="brief-spinner"></span> Distilling the task into a current-state brief.
      </div>`;
  }

  function renderError(message) {
    return `
      <div class="brief-header">
        <span class="brief-status-label">brief · error</span>
        <button type="button" class="brief-refresh" data-brief-refresh>↻ retry</button>
      </div>
      <div class="brief-placeholder brief-error">${esc(message || 'Could not load brief.')}</div>`;
  }

  function applyState(container, html, state) {
    container.innerHTML = html;
    container.setAttribute('data-state', state);
  }

  function wireRefresh(container, urlKey, identifier, source) {
    const btn = container.querySelector('[data-brief-refresh]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await refresh(container, urlKey, identifier, source);
    });
  }

  async function refresh(container, urlKey, identifier, source) {
    applyState(container, renderGenerating(), 'generating');
    try {
      const data = await postBrief(urlKey, identifier, source);
      applyState(container, renderFresh(data), 'fresh');
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireRefresh(container, urlKey, identifier, source);
  }

  /**
   * Initialise a brief section inside the given container.
   *
   * @param {HTMLElement} container - The element to render into.
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.identifier - Linear issue id (UUID) or identifier (LIN-123).
   * @param {string} [opts.source] - Resolved provider name (LIN-1910), forwarded as `?source=`.
   */
  async function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('brief-section');
    applyState(container, renderGenerating(), 'loading');
    const { urlKey, identifier, source } = opts;

    try {
      const data = await fetchBriefStatus(urlKey, identifier, source);
      if (data.status === 'fresh') {
        applyState(container, renderFresh(data), 'fresh');
      } else if (data.status === 'stale') {
        applyState(container, renderStale(data), 'stale');
      } else {
        // Auto-generate on the first open of a missing brief, mirroring the
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

  window.BriefSection = { init, refresh };
})();
