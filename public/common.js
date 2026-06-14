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
// API (shared fetch wrapper)
// =============================================================================

/**
 * Shared JSON fetch wrapper — one error/401 contract for the client.
 *
 * The client carried five divergent fetch error/401 shapes across ~69 call
 * sites (generic throw, `HTTP <status>` throw, 401→redirect, silent swallow,
 * parse-body+special-case). `api()` is a strict superset: it does the fetch,
 * returns the parsed JSON body on 2xx, and on a non-2xx best-effort parses the
 * error body and throws an Error carrying `.status` and `.body`, so callers can
 * still branch (e.g. 429 freeTier reads `err.body.freeTier`, 401 reads
 * `err.status`). Adoption is incremental — streaming/SSE readers and pollers
 * that intentionally swallow failures are deliberately left on raw `fetch`.
 *
 * @global
 * @param {string} url                       Request URL
 * @param {Object} [opts]                     Passed to fetch (method, headers, body, …) plus:
 * @param {string|false} [opts.on401='/logout'] On a 401, redirect here; `false` opts out
 *                                            (the error is thrown like any other so the
 *                                            caller can branch on `.status`). Other 401
 *                                            targets are supported (e.g. audit.js → `/`).
 * @param {boolean} [opts.toastOnError=false] When true, surface the error via
 *                                            `window.toast(msg, {type:'error'})` before throwing.
 * @returns {Promise<*>} Parsed JSON body on success (null if the body is empty/non-JSON).
 * @throws {Error} On a non-2xx response. The error carries `.status` and `.body`
 *                 (the parsed error payload, or null if it wasn't JSON).
 */
window.api = async function api(url, opts = {}) {
  const { on401 = '/logout', toastOnError = false, ...fetchOpts } = opts;

  const response = await fetch(url, fetchOpts);

  // 401 → redirect by default (session expired). `on401:false` falls through to
  // the normal throw path so the caller can branch on `err.status === 401`.
  if (response.status === 401 && on401 !== false) {
    window.location.href = on401;
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  // Parse the body once, best-effort — used for both the success value and the
  // error shape. An empty/non-JSON body leaves it null.
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    // Non-JSON or empty body — leave body null.
  }

  if (!response.ok) {
    const message = (body && (body.error || body.message)) || `HTTP ${response.status}`;
    if (toastOnError && typeof window.toast === 'function') {
      window.toast(message, { type: 'error' });
    }
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
};

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
 * @param {string} [opts.kind]               Explicit dispatch kind (e.g. 'autopilot'); omit to derive from promptName
 * @returns {Promise<Object>} Parsed JSON response body
 * @throws {Error} on missing required args or a non-ok response. The thrown
 *                 error carries `.status` so callers can branch (e.g. 401).
 */
window.dispatchPrompt = async function dispatchPrompt(opts = {}) {
  const { urlKey, prompt, issue, issueless = false, promptName = 'Prompt', target = 'cli', repo, kind } = opts;

  if (!urlKey) throw new Error('dispatchPrompt: urlKey is required');
  if (!prompt) throw new Error('dispatchPrompt: prompt is required');
  // Issue-anchored dispatches must carry both id and identifier — every Linear
  // issue has both, and `issueIdentifier` is the key dispatch history joins on
  // (lib/pipeline-loops.js). The custom-prompt page opts out via `issueless`.
  if (!issueless && !(issue && issue.id && issue.identifier)) {
    throw new Error('dispatchPrompt: issue with id and identifier is required (pass issueless:true to opt out)');
  }

  const payload = { prompt, promptName, target };
  // `kind` is normally derived server-side from promptName; pass it explicitly
  // only for meta-loops that don't map to a prompt template (e.g. 'autopilot').
  if (kind) payload.kind = kind;
  if (issue) {
    if (issue.id) payload.issueId = issue.id;
    if (issue.identifier) payload.issueIdentifier = issue.identifier;
    if (issue.title) payload.issueTitle = issue.title;
    if (issue.url) payload.issueUrl = issue.url;
  }
  if (repo) payload.repo = repo;

  // on401:false — dispatch surfaces (swipe etc.) branch on err.status rather
  // than redirecting, so the 401 is thrown like any other error.
  const result = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    on401: false
  });

  // Refresh the nav queue badge where that machinery exists (dashboard etc.).
  if (typeof window.updateQueueBadge === 'function') {
    window.updateQueueBadge(urlKey);
  }

  return result;
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
// Modal (shared overlay dialog)
// =============================================================================

// Tracks the currently-open modal's teardown so closeModal()/a second showModal()
// can dismiss it cleanly (remove DOM + detach the Escape listener). Only one
// modal is ever open at a time, so a single reference suffices.
let activeModalClose = null;

/**
 * Show a shared overlay modal.
 *
 * Structural classes are derived from `className` so the same helper can back
 * different modals while preserving each one's E2E/CSS contract — e.g.
 * `className:'token-modal'` emits `.token-modal-overlay`, `.token-modal`,
 * `.token-modal-header`, and `.token-modal-close` exactly as the hand-rolled
 * token modals did. The caller owns the body markup (and wires any buttons
 * inside it) via the returned `modal` element.
 *
 * Behaviour standardised from the dispatch token modal: close on overlay click,
 * close button, and Escape. The pipeline overlay is intentionally NOT built on
 * this helper — it is a persistent polling singleton, a different primitive.
 *
 * @global
 * @param {Object} opts
 * @param {string} [opts.className='modal'] Base class; structural classes derive from it
 * @param {string} [opts.title='']          Header text (escaped)
 * @param {string} [opts.bodyHtml='']       Trusted body HTML appended after the header
 * @param {Function} [opts.onClose]         Called once after the modal is torn down
 * @returns {{overlay: HTMLElement, modal: HTMLElement, close: Function}}
 */
window.showModal = function showModal({ className = 'modal', title = '', bodyHtml = '', onClose } = {}) {
  // Tear down any existing modal cleanly before opening a new one.
  if (activeModalClose) activeModalClose();
  // Belt-and-suspenders: drop any stray nodes of this class not opened via showModal.
  document.querySelectorAll(`.${className}-overlay, .${className}`).forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = `${className}-overlay`;

  const modal = document.createElement('div');
  modal.className = className;
  modal.innerHTML = `
    <div class="${className}-header">
      <strong>${window.escapeHtml(title)}</strong>
      <button class="${className}-close" aria-label="Close">&times;</button>
    </div>
    ${bodyHtml}`;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    modal.remove();
    if (activeModalClose === close) activeModalClose = null;
    if (typeof onClose === 'function') onClose();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  overlay.addEventListener('click', close);
  modal.querySelector(`.${className}-close`).addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  activeModalClose = close;
  return { overlay, modal, close };
};

/**
 * Close the currently-open shared modal, if any (full teardown).
 * @global
 */
window.closeModal = function closeModal() {
  if (activeModalClose) activeModalClose();
};

// =============================================================================
// Toast (transient notifications)
// =============================================================================

/**
 * Show a transient toast notification, auto-dismissed after `duration` ms.
 * Replaces blocking `alert()` calls so error surfaces are non-modal and
 * consistent. Click a toast to dismiss it early.
 *
 * @global
 * @param {string} message            Text to display (rendered as text, not HTML)
 * @param {Object} [opts]
 * @param {string} [opts.type='info']    Visual variant: 'info' | 'error'
 * @param {number} [opts.duration=4000]  Auto-dismiss delay in ms
 * @returns {HTMLElement} The toast element
 */
window.toast = function toast(message, opts = {}) {
  const { type = 'info', duration = 4000 } = opts;

  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  container.appendChild(el);

  // Next frame so the entrance transition runs.
  requestAnimationFrame(() => el.classList.add('toast-visible'));

  function remove() {
    el.classList.remove('toast-visible');
    setTimeout(() => {
      el.remove();
      if (container && !container.children.length) container.remove();
    }, 200);
  }

  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });

  return el;
};

// =============================================================================
// Navigation Bar (workspace/team selectors)
// =============================================================================

// Lives here (not app.js) so the workspace switcher is interactive on every
// authenticated page — every page loads common.js, but only some load app.js.
const TEAM_STORAGE_KEY = 'linear-projects-selected-team'

// Safe localStorage helpers for team selection
function getTeamSelection() {
  try {
    return localStorage.getItem(TEAM_STORAGE_KEY)
  } catch (e) {
    console.warn('Failed to read team selection:', e)
    return null
  }
}

function setTeamSelection(teamId) {
  try {
    localStorage.setItem(TEAM_STORAGE_KEY, teamId)
  } catch (e) {
    console.warn('Failed to save team selection:', e)
  }
}

function clearTeamSelection() {
  try {
    localStorage.removeItem(TEAM_STORAGE_KEY)
  } catch (e) {
    console.warn('Failed to clear team selection:', e)
  }
}

// Navigation bar interactions (workspace/team selectors)
function initNavBar() {
  const navBar = document.querySelector('.nav-bar')
  if (!navBar) return

  const workspaceToggle = document.getElementById('workspace-toggle')
  const teamToggle = document.getElementById('team-toggle')
  const workspaceOptions = document.getElementById('workspace-options')
  const teamOptions = document.getElementById('team-options')

  // Create overlay element for mobile dropdown backdrop
  let dropdownOverlay = document.querySelector('.nav-dropdown-overlay')
  if (!dropdownOverlay) {
    dropdownOverlay = document.createElement('div')
    dropdownOverlay.className = 'nav-dropdown-overlay hidden'
    document.body.appendChild(dropdownOverlay)
  }

  // Track currently open selector
  let openSelector = null

  function closeAllSelectors() {
    ;[workspaceToggle, teamToggle].forEach(btn => {
      if (btn) btn.setAttribute('aria-expanded', 'false')
    })
    ;[workspaceOptions, teamOptions].forEach(panel => {
      if (panel) panel.classList.add('hidden')
    })
    if (dropdownOverlay) dropdownOverlay.classList.add('hidden')
    openSelector = null
  }

  function toggleSelector(toggle, options, selectorName) {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true'

    if (isOpen) {
      closeAllSelectors()
    } else {
      closeAllSelectors()
      toggle.setAttribute('aria-expanded', 'true')
      options.classList.remove('hidden')
      if (dropdownOverlay) dropdownOverlay.classList.remove('hidden')
      openSelector = selectorName
    }
  }

  // Workspace toggle
  if (workspaceToggle && workspaceOptions) {
    workspaceToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSelector(workspaceToggle, workspaceOptions, 'workspace')
    })
  }

  // Team toggle
  if (teamToggle && teamOptions) {
    teamToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSelector(teamToggle, teamOptions, 'team')
    })
  }

  // Team option selection (workspace uses form submission)
  if (teamOptions) {
    teamOptions.addEventListener('click', (e) => {
      const option = e.target.closest('.nav-option[data-team]')
      if (!option) return

      e.stopPropagation()
      const teamId = option.dataset.team
      setTeamSelection(teamId)
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = teamOptions.dataset.urlKey
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      const url = teamId === 'all' ? `${workspacePrefix}/` : `${workspacePrefix}/?team=${teamId}`
      window.location.href = url
    })
  }

  // Close on outside click
  document.addEventListener('click', () => {
    if (openSelector) closeAllSelectors()
  })

  // Prevent clicks inside options panels from triggering "close on outside click"
  // Links still navigate, forms still submit - we just don't hide the panel first
  ;[workspaceOptions, teamOptions].forEach(panel => {
    if (panel) {
      panel.addEventListener('click', (e) => e.stopPropagation())
    }
  })

  // Close on overlay click (mobile backdrop)
  if (dropdownOverlay) {
    dropdownOverlay.addEventListener('click', closeAllSelectors)
  }

  // Handle forms with confirmation dialogs (replaces inline onsubmit)
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-confirm]')
    if (form && !confirm(form.dataset.confirm)) {
      e.preventDefault()
    }
  })

  // Keyboard navigation
  function handleKeyboard(e, toggle, options) {
    if (!options || options.classList.contains('hidden')) return

    const allOptions = [...options.querySelectorAll('.nav-option')]
    const focusedOption = document.activeElement
    const currentIndex = allOptions.indexOf(focusedOption)

    switch (e.key) {
      case 'Escape':
        closeAllSelectors()
        toggle?.focus()
        break
      case 'ArrowDown':
        e.preventDefault()
        if (currentIndex < allOptions.length - 1) {
          allOptions[currentIndex + 1]?.focus()
        } else {
          allOptions[0]?.focus()
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (currentIndex > 0) {
          allOptions[currentIndex - 1]?.focus()
        } else {
          allOptions[allOptions.length - 1]?.focus()
        }
        break
    }
  }

  document.addEventListener('keydown', (e) => {
    if (openSelector === 'workspace') {
      handleKeyboard(e, workspaceToggle, workspaceOptions)
    } else if (openSelector === 'team') {
      handleKeyboard(e, teamToggle, teamOptions)
    }
  })

  // Sync team selection with localStorage on initial load
  if (teamToggle) {
    const urlParams = new URLSearchParams(window.location.search)
    const urlTeam = urlParams.get('team')
    const savedTeam = getTeamSelection()

    // Check if saved team still exists in options
    const teamOptionsAll = document.querySelectorAll('#team-options .nav-option[data-team]')
    const savedTeamExists = savedTeam === 'all' ||
      [...teamOptionsAll].some(opt => opt.dataset.team === savedTeam)

    // If URL has no team but localStorage does (and team still exists), redirect
    if (!urlTeam && savedTeam && savedTeam !== 'all' && savedTeamExists) {
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = teamOptions?.dataset.urlKey
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      window.location.href = `${workspacePrefix}/?team=${savedTeam}`
      return
    }

    // Clear invalid saved team
    if (savedTeam && !savedTeamExists) {
      clearTeamSelection()
    }

    // Save current selection
    setTeamSelection(urlTeam || 'all')
  }
}

// =============================================================================
// Auto-initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDeployTime();
  initDisclosure();
  initNavBar();
});
