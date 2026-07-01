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
 * Canonical client-side escaper (LIN-422) — the single implementation used
 * across every page; page-specific copies/fallbacks delegate here.
 * Mirrors the server-side escaper in lib/utils/html.js, except this guards
 * only null/undefined so a legitimate `0` renders as "0" rather than being
 * silently dropped (the more careful guard reconciled from the ship-page copy).
 * @global
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
window.escapeHtml = function(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// =============================================================================
// Theme Primitives (client-side replicas of lib/components/* — LIN-861)
// =============================================================================
//
// The server render helpers in lib/components/* (renderStatusPill / renderSurface
// / renderTag / renderChip) return HTML strings, but the experimental Collective,
// Task-chat and Next-run views build their live content in the browser and can't
// import server modules. These are byte-faithful client replicas of that
// canonical markup, so those views compose the shared primitives (styled by the
// shared /style.css rules) instead of hand-rolling divergent chips/panels. Keep
// them in lock-step with lib/components/*: ONE replica, many consumers, no drift.
// Text inputs are escaped via window.escapeHtml (plain-text-in contract); `body`
// / `attrs` are raw (slot convention), exactly like the server helpers.

// Default state glyphs — mirrors STATE_GLYPHS in lib/components/status-pill.js.
const STATUS_PILL_GLYPHS = {
  done: '✓',
  'in-progress': '◐',
  todo: '○',
  backlog: '○',
  failed: '✕',
};

/**
 * Client replica of lib/components/status-pill.js `renderStatusPill`.
 * @global
 * @returns {string} Status pill HTML.
 */
window.renderStatusPill = function renderStatusPill({ state, label, char, dot, variant, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  const glyph = has(char) ? char : (state ? STATUS_PILL_GLYPHS[state] : undefined);
  if (!dot && !has(glyph) && !has(label)) {
    throw new Error('renderStatusPill requires at least one of `char`, `label`, `dot`, or a known `state`.');
  }
  const classes = ['status-pill'];
  if (dot) classes.push('status-pill--dot');
  if (state) classes.push(`status-pill--${state}`);
  if (variant) classes.push(`status-pill--${variant}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  const markerHtml = dot
    ? '<span class="status-pill__dot" aria-hidden="true"></span>'
    : (has(glyph) ? `<span class="status-pill__char">${window.escapeHtml(glyph)}</span>` : '');
  const labelHtml = has(label) ? `<span class="status-pill__label">${window.escapeHtml(label)}</span>` : '';
  return `<span class="${classes.join(' ')}"${attrStr}>${markerHtml}${labelHtml}</span>`;
};

/**
 * Client replica of lib/components/surface.js `renderSurface`. `body` is RAW.
 * @global
 * @returns {string} Surface HTML.
 */
window.renderSurface = function renderSurface({ body, variant, as = 'div', className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(body)) throw new Error('renderSurface requires a `body`.');
  const tag = window.escapeHtml(as);
  const classes = ['surface'];
  if (variant) classes.push(`surface--${variant}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<${tag} class="${classes.join(' ')}"${attrStr}>${body}</${tag}>`;
};

/**
 * Client replica of lib/components/tag.js `renderTag` (soft sans label chip).
 * @global
 * @returns {string} Tag HTML.
 */
window.renderTag = function renderTag({ label, count, tone, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(label)) throw new Error('renderTag requires a `label`.');
  const classes = ['tag'];
  if (tone) classes.push(`tag--${tone}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  const countHtml = has(count) ? `<span class="tag__count">${window.escapeHtml(String(count))}</span>` : '';
  return `<span class="${classes.join(' ')}"${attrStr}><span class="tag__name">${window.escapeHtml(label)}</span>${countHtml}</span>`;
};

/**
 * Client replica of lib/components/tag.js `renderChip` (hard-edged mono data chip).
 * @global
 * @returns {string} Chip HTML.
 */
window.renderChip = function renderChip({ label, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(label)) throw new Error('renderChip requires a `label`.');
  const classes = ['chip'];
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<code class="${classes.join(' ')}"${attrStr}>${window.escapeHtml(label)}</code>`;
};

// =============================================================================
// Markdown Rendering
// =============================================================================

/**
 * Strip a whole-string Markdown code-fence wrapper.
 *
 * When a model returns its entire output wrapped in a single ```lang … ```
 * fence, we want the inner content rendered as Markdown, not as one code block.
 * Only strips when the fence wraps the ENTIRE string; inline/partial fences are
 * left untouched. Byte-identical to the prior copies in prompt-section.js and
 * swipe.js (LIN-421).
 *
 * @global
 * @param {string} text
 * @returns {string} The unwrapped inner text, or the original text unchanged.
 */
window.stripCodeBlockWrapper = function(text) {
  if (!text) return text;
  const m = text.match(/^\s*```[a-z]*\s*\n([\s\S]*?)\n\s*```\s*$/);
  return m ? m[1] : text;
};

/**
 * Render Markdown to sanitized HTML.
 *
 * Canonical superset hoisted from prompt-section.js (LIN-421): strips a
 * whole-string fence wrapper, renders with `marked.parse(cleaned, opts)` when
 * marked is available (falling back to escaped text when it isn't), then
 * sanitizes with DOMPurify when available. Returns '' for falsy input.
 *
 * @global
 * @param {string} text            Markdown source
 * @param {Object} [opts]          Passed through to `marked.parse` (e.g. {breaks:true})
 * @returns {string} Sanitized HTML (or escaped text when marked is absent).
 */
window.renderMarkdown = function(text, opts) {
  if (!text) return '';
  const cleaned = window.stripCodeBlockWrapper(text);
  const html = typeof marked !== 'undefined' ? marked.parse(cleaned, opts) : window.escapeHtml(cleaned);
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
};

// =============================================================================
// Relative Time Formatting
// =============================================================================

/**
 * Format a timestamp as friendly relative time (LIN-421 canonical, "Behavior B").
 *
 * Standardizes the previously divergent per-page formatters onto one behavior:
 * `just now` / `Nm ago` / `Nh ago` / `yesterday` / `Nd ago` (<7d) / short date
 * ("Jan 5"). Polymorphic input: accepts either an ISO/parseable date string or a
 * millisecond-epoch number. Returns '' for falsy or unparseable input.
 *
 * Note: pipeline.js deliberately keeps its own 30-day-cap variant and is NOT a
 * consumer of this helper.
 *
 * @global
 * @param {string|number} value  ISO date string or millisecond epoch
 * @returns {string} Human-readable relative time, or '' when input is empty/invalid.
 */
window.relativeTime = function(value) {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
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
// Proxy Toggle (append workspace API proxy instructions + token to prompts)
// =============================================================================

/**
 * Single shared home for the `+proxy` toggle (LIN-525 #7). Previously this
 * logic was copy-pasted into app.js and prompt-section.js and had already
 * drifted; both now consume this one module. Lives in common.js because it is
 * loaded on every authenticated surface (tree, dispatch, swipe, …).
 *
 * State model:
 *  - The toggle's on/off lives in a single localStorage key.
 *  - The *rendered* active look is driven by a `data-proxy-active` attribute on
 *    <body> + CSS, NOT a per-button class — so buttons injected after load
 *    (lazy issue-detail blocks, swipe re-renders) inherit it automatically and
 *    can't "miss the restore" (LIN-525 #1).
 *  - The proxy feature flag is per-user/per-workspace and known only to the
 *    server; the page shell emits it as `data-proxy-feature` on <body>. When it
 *    is absent/off the toggle is inert — no block appended, no token minted —
 *    even if the global toggle key is on from a flag-on workspace (LIN-525 #2).
 *  - Minted tokens are cached per workspace `urlKey` (LIN-525 #3) and can be
 *    dropped via invalidate() after a revoke; a failed/401 mint never populates
 *    the cache, so the next append re-mints (LIN-525 #4).
 *
 * @global
 */
window.ProxyToggle = (function () {
  const TOGGLE_KEY = 'proxy-toggle-active';
  // urlKey -> minted token string. Keyed by workspace so a page that dispatches
  // to more than one workspace never embeds the first workspace's token.
  const tokenCache = new Map();

  function isActive() {
    try {
      return localStorage.getItem(TOGGLE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  // The server-emitted proxy feature flag for the current workspace/user.
  function isFeatureEnabled() {
    return document.body && document.body.dataset.proxyFeature === 'true';
  }

  // Mirror the persisted toggle onto <body> so CSS styles every (current AND
  // future-injected) +proxy button without per-button bookkeeping.
  function syncBodyState() {
    if (document.body) document.body.dataset.proxyActive = isActive() ? 'true' : 'false';
  }

  function setActive(active) {
    try {
      localStorage.setItem(TOGGLE_KEY, active ? 'true' : 'false');
    } catch {
      // ignore persistence failures (private mode etc.)
    }
    syncBodyState();
  }

  /**
   * Get or create a proxy token for a workspace, cached per urlKey for the page
   * session. on401:false — a failed mint (incl. 401 or token rate-limit) falls
   * through to null so the caller surfaces it, rather than redirecting to
   * /logout. A null result is never cached, so the next call re-mints.
   * @param {string} urlKey
   * @returns {Promise<string|null>}
   */
  async function getOrCreateToken(urlKey) {
    if (!urlKey) return null;
    if (tokenCache.has(urlKey)) return tokenCache.get(urlKey);
    try {
      const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/proxy/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'prompt-proxy', scope: 'readWrite', singleUse: false }),
        on401: false
      });
      const token = (data && data.token) || null;
      if (token) tokenCache.set(urlKey, token);
      return token;
    } catch {
      return null;
    }
  }

  /**
   * Drop cached token(s) so the next append re-mints. Called after a token is
   * revoked in the Tokens UI (LIN-525 #4). With no urlKey, clears everything.
   * @param {string} [urlKey]
   */
  function invalidate(urlKey) {
    if (urlKey) tokenCache.delete(urlKey);
    else tokenCache.clear();
  }

  function buildBlock(token) {
    const baseUrl = window.location.origin;
    return `\n\n## Workspace API access\n\nYou have access to a workspace API proxy (source-neutral; currently backed by Linear). Use it to read and modify workspace issues, projects, and more.\n\nTo get started, fetch the full API documentation:\n\n  curl -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/instructions\n\nThis will return all available endpoints with examples. Your token scope is: readWrite.`;
  }

  /**
   * If +proxy is active AND the feature is enabled for this surface, append the
   * proxy instructions block to a prompt. No-op when the toggle is off or the
   * feature flag is off (LIN-525 #2). When active+enabled but the block cannot
   * be produced (no workspace context, or the token mint fails/rate-limits) this
   * THROWS, so callers surface the failure instead of silently copying or
   * dispatching a bare prompt while the toggle still shows active.
   *
   * `opts.force` (LIN-645) bypasses BOTH the toggle and the feature-flag gate to
   * append unconditionally. It is for surfaces whose prompt REQUIRES the proxy
   * regardless of user toggle — e.g. the next-run autopilot kickoff, which
   * promises a `readWrite` token in its body but exposes no +proxy toggle. The
   * urlKey + token requirements (and their throw-on-failure) still hold, so a
   * forced append never silently dispatches a tokenless prompt.
   * @param {string} text
   * @param {string} urlKey
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<string>}
   * @throws {Error} when (active+enabled OR forced) but no block can be produced
   */
  async function maybeAppend(text, urlKey, opts) {
    const force = !!(opts && opts.force);
    if (!force) {
      if (!isActive()) return text;
      if (!isFeatureEnabled()) return text;
    }
    if (!urlKey) throw new Error('Proxy is enabled but no workspace context was found for this prompt.');
    const token = await getOrCreateToken(urlKey);
    if (!token) throw new Error('Proxy is enabled but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.');
    return text + buildBlock(token);
  }

  /**
   * Restore the rendered state and wire a single delegated click handler for
   * every +proxy button on the page (current and future-injected).
   */
  function init() {
    syncBodyState();
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.prompt-proxy-toggle');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      setActive(!isActive());
    });
  }

  return { isActive, isFeatureEnabled, getOrCreateToken, invalidate, buildBlock, maybeAppend, init, setActive };
})();

// Back-compat global consumed by app.js / dispatch.js call sites
// (and their `typeof maybeAppendProxyBlock === 'function'` guards).
window.maybeAppendProxyBlock = (text, urlKey) => window.ProxyToggle.maybeAppend(text, urlKey);

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
 *    autopilot), so a single shared listener avoids per-instance wiring and the
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

// Team selection is remembered per workspace (LIN-727): a single global key let
// one workspace's team overwrite another's, so returning to a workspace lost the
// filter. Namespacing by urlKey keeps each workspace's selection independent. The
// server (user-preferences) is the cross-device source of truth; this localStorage
// cache only drives the no-param instant redirect below.
function teamStorageKey(urlKey) {
  return urlKey ? `${TEAM_STORAGE_KEY}:${urlKey}` : TEAM_STORAGE_KEY
}

// Safe localStorage helpers for team selection
function getTeamSelection(urlKey) {
  try {
    return localStorage.getItem(teamStorageKey(urlKey))
  } catch (e) {
    console.warn('Failed to read team selection:', e)
    return null
  }
}

function setTeamSelection(teamId, urlKey) {
  try {
    localStorage.setItem(teamStorageKey(urlKey), teamId)
  } catch (e) {
    console.warn('Failed to save team selection:', e)
  }
}

function clearTeamSelection(urlKey) {
  try {
    localStorage.removeItem(teamStorageKey(urlKey))
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
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = teamOptions.dataset.urlKey
      setTeamSelection(teamId, urlKey)
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      // Always carry the param — including ?team=all — so the server records the
      // explicit choice (and clears any remembered team) rather than treating a
      // bare URL as "restore the prior selection" (LIN-727).
      const url = `${workspacePrefix}/?team=${teamId}`
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
    // Native confirm() is the ratified destructive-action primitive (LIN-511):
    // accessible/focus-trapped/keyboard-ready for free, and showModal is
    // display-only. See docs/ui-divergences.md.
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
    // Per-workspace key (LIN-727) so one workspace's selection can't shadow another's.
    const urlKey = teamOptions?.dataset.urlKey
    const savedTeam = getTeamSelection(urlKey)

    // Check if saved team still exists in options
    const teamOptionsAll = document.querySelectorAll('#team-options .nav-option[data-team]')
    const savedTeamExists = savedTeam === 'all' ||
      [...teamOptionsAll].some(opt => opt.dataset.team === savedTeam)

    // If URL has no team but localStorage does (and team still exists), redirect
    if (!urlTeam && savedTeam && savedTeam !== 'all' && savedTeamExists) {
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      window.location.href = `${workspacePrefix}/?team=${savedTeam}`
      return
    }

    // Clear invalid saved team
    if (savedTeam && !savedTeamExists) {
      clearTeamSelection(urlKey)
    }

    // Save current selection
    setTeamSelection(urlTeam || 'all', urlKey)
  }
}

// =============================================================================
// Global light/dark theme toggle (LIN-785)
// =============================================================================
//
// The shared shell applies the persisted theme to <html> pre-paint from a cookie
// (see lib/components/page.js), so this only owns the footer control: it syncs
// the control's label/state from the applied theme, and on click flips the class
// for instant feedback, writes the cookie (so the choice persists on this device
// even if the POST fails or there is no workspace), and POSTs to the durable,
// cross-device preference route.
function initThemeToggle() {
  const toggles = document.querySelectorAll('.footer-theme-toggle');
  if (!toggles.length) return;

  const currentTheme = () =>
    document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';

  const syncToggle = (el) => {
    const theme = currentTheme();
    el.dataset.theme = theme;
    el.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    el.textContent = `theme: ${theme}`;
  };

  const writeCookie = (theme) => {
    const oneYearSecs = 365 * 24 * 60 * 60;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `theme=${theme}; path=/; max-age=${oneYearSecs}; SameSite=Lax${secure}`;
  };

  toggles.forEach((el) => {
    syncToggle(el);
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('theme-dark', next === 'dark');
      writeCookie(next);
      document.querySelectorAll('.footer-theme-toggle').forEach(syncToggle);

      const urlKey = el.dataset.urlKey;
      if (urlKey) {
        fetch(`/workspace/${encodeURIComponent(urlKey)}/settings/theme`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ theme: next })
        }).catch(() => { /* cookie already persists the choice on this device */ });
      }
    });
  });
}

// =============================================================================
// Auto-initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDeployTime();
  initDisclosure();
  initNavBar();
  initThemeToggle();
  window.ProxyToggle.init();
});
