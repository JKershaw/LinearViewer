/**
 * Common Utilities
 *
 * Shared JavaScript utilities used across multiple pages.
 * Loaded before page-specific scripts (app.js, audit.js).
 */

// =============================================================================
// HTML Escaping
// =============================================================================

/**
 * Escapes HTML special characters to prevent XSS.
 * Matches server-side implementation in lib/utils/html.js.
 * @global
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// =============================================================================
// Deploy Time Formatting
// =============================================================================

/**
 * Format deploy timestamp in viewer's local timezone.
 * Updates .deploy-time elements that have a data-timestamp attribute.
 * Changes "deployed Jan 15" to "deployed Jan 15, 2:30 PM".
 */
function initDeployTime() {
  const deployTimeEl = document.querySelector('.deploy-time[data-timestamp]');
  if (!deployTimeEl) return;

  const timestamp = deployTimeEl.dataset.timestamp;
  if (!timestamp) return;

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return;

    // Format: "deployed Jan 15, 2:30 PM"
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();

    // Format time in 12-hour format with AM/PM
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours || 12; // 0 should be 12
    const minuteStr = String(minutes).padStart(2, '0');

    deployTimeEl.textContent = `deployed ${month} ${day}, ${hours}:${minuteStr} ${ampm}`;
  } catch (e) {
    // Keep server-rendered fallback on error
    console.warn('Failed to format deploy time:', e);
  }
}

// =============================================================================
// Dispatch
// =============================================================================

/**
 * Unified client-side dispatch to POST /api/dispatch.
 *
 * Every dispatch surface (dashboard tree, dispatch page, swipe/recap/brief,
 * pipeline overlay) funnels through here so the payload contract is assembled
 * in exactly one place — no surface can silently drop the issue link again.
 * The dispatch history these records become is joined back to tasks by
 * `issueIdentifier` (see lib/pipeline-loops.js), so it is required by default.
 *
 * The `prompt` passed in is treated as final: callers append any proxy block
 * themselves beforehand (the proxy-token mechanisms differ per surface).
 *
 * @global
 * @param {Object} opts
 * @param {string} opts.urlKey               Workspace URL key (required)
 * @param {string} opts.prompt               Final prompt text (required)
 * @param {Object} [opts.issue]              Issue context — required unless `issueless`
 * @param {string} opts.issue.id             Issue UUID
 * @param {string} opts.issue.identifier     Issue identifier, e.g. "LIN-42"
 * @param {string} [opts.issue.title]
 * @param {string} [opts.issue.url]
 * @param {boolean} [opts.issueless=false]   Opt-out for issue-less dispatches (custom prompt page)
 * @param {string} [opts.promptName='Prompt']
 * @param {string} [opts.target='cli']       'cli' | 'web' | 'dash' | 'local'
 * @param {string} [opts.repo]
 * @returns {Promise<Object>} Parsed JSON response body
 * @throws {Error} on missing required args or a non-ok response. The thrown
 *                 error carries `.status` so callers can branch (e.g. 401).
 */
window.dispatchPrompt = async function dispatchPrompt(opts = {}) {
  const { urlKey, prompt, issue, issueless = false, promptName = 'Prompt', target = 'cli', repo } = opts;

  if (!urlKey) throw new Error('dispatchPrompt: urlKey is required');
  if (!prompt) throw new Error('dispatchPrompt: prompt is required');
  // Issue-anchored dispatches must carry both id and identifier — every Linear
  // issue has both, and `issueIdentifier` is the key dispatch history joins on
  // (lib/pipeline-loops.js). The custom-prompt page opts out via `issueless`.
  if (!issueless && !(issue && issue.id && issue.identifier)) {
    throw new Error('dispatchPrompt: issue with id and identifier is required (pass issueless:true to opt out)');
  }

  const payload = { prompt, promptName, target };
  if (issue) {
    if (issue.id) payload.issueId = issue.id;
    if (issue.identifier) payload.issueIdentifier = issue.identifier;
    if (issue.title) payload.issueTitle = issue.title;
    if (issue.url) payload.issueUrl = issue.url;
  }
  if (repo) payload.repo = repo;

  const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let message = 'Dispatch failed';
    try {
      const body = await response.json();
      if (body && body.error) message = body.error;
    } catch (e) {
      // Non-JSON error body — keep the generic message.
    }
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  // Refresh the nav queue badge where that machinery exists (dashboard etc.).
  if (typeof window.updateQueueBadge === 'function') {
    window.updateQueueBadge(urlKey);
  }

  return response.json();
};

// =============================================================================
// Disclosure (collapsible options panels)
// =============================================================================

/**
 * Generic, delegated disclosure behaviour shared by every collapsible options
 * panel on every page (e.g. the dashboard/swipe "Dispatch ▾" triggers).
 *
 * Markup convention: a trigger element carries `.disclosure-toggle` and
 * `aria-expanded`; its panel is resolved either via `aria-controls`
 * (getElementById) or, failing that, the trigger's immediate next sibling.
 * The panel is shown/hidden through the global `.hidden` class.
 *
 * Why delegated rather than per-element init:
 *  - The dashboard renders many triggers (one per issue × prompt/recommend/
 *    foreman), so a single shared listener avoids per-instance wiring and the
 *    id-collision footgun — the panel is resolved relative to the clicked
 *    trigger, never by a global id lookup that could match the wrong instance.
 *  - The swipe view builds its trigger client-side and re-renders it on every
 *    state change; a document-level listener catches those clicks regardless of
 *    when the element was injected, with no teardown or double-bind concerns.
 *
 * Critically, this listener never calls stopPropagation: clicks on option
 * buttons inside a panel must still reach their own delegated handlers
 * (`.prompt-dispatch` in app.js, `data-action="dispatch"` in prompt-section.js),
 * which sit on ancestors of the panel. Outside-click close uses a contains()
 * guard instead.
 *
 * @global
 */
window.initDisclosure = function initDisclosure() {
  if (window.__disclosureInit) return;
  window.__disclosureInit = true;

  function panelFor(toggle) {
    const id = toggle.getAttribute('aria-controls');
    const byId = id && document.getElementById(id);
    return byId || toggle.nextElementSibling || null;
  }

  function openToggles() {
    return document.querySelectorAll('.disclosure-toggle[aria-expanded="true"]');
  }

  function closePanel(toggle) {
    const panel = panelFor(toggle);
    toggle.setAttribute('aria-expanded', 'false');
    if (panel) panel.classList.add('hidden');
  }

  function openPanel(toggle) {
    const panel = panelFor(toggle);
    toggle.setAttribute('aria-expanded', 'true');
    if (panel) panel.classList.remove('hidden');
  }

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.disclosure-toggle');
    if (toggle) {
      const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
      // One open panel at a time (mirrors the navbar selectors).
      openToggles().forEach((t) => { if (t !== toggle) closePanel(t); });
      if (wasOpen) closePanel(toggle);
      else openPanel(toggle);
      return;
    }

    // Outside click: close any open panel whose trigger/panel doesn't contain
    // the click. In-panel option clicks are left alone (no stopPropagation), so
    // they still bubble to their own send handlers.
    openToggles().forEach((t) => {
      const panel = panelFor(t);
      if (t.contains(e.target) || (panel && panel.contains(e.target))) return;
      closePanel(t);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = openToggles();
    if (!open.length) return;
    const last = open[open.length - 1];
    open.forEach(closePanel);
    last.focus();
  });
};

// =============================================================================
// Auto-initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDeployTime();
  initDisclosure();
});
