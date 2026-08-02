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

/**
 * First-paint fit zoom (LIN-1221 F1). Mirror of lib/ship-layout.js
 * computeFitZoom — pick the largest scale at which the content box fits the
 * viewport (with padding), clamped to [minZoom, maxZoom]; never zoom IN on
 * fit (maxZoom default 1). Keep in sync with the pure version.
 * @global
 */
window.computeFitZoom = function computeFitZoom(opts) {
  var contentWidth = opts.contentWidth, contentHeight = opts.contentHeight;
  var availWidth = opts.availWidth, availHeight = opts.availHeight;
  var pad = opts.pad === undefined ? 24 : opts.pad;
  var minZoom = opts.minZoom === undefined ? 0.3 : opts.minZoom;
  var maxZoom = opts.maxZoom === undefined ? 1 : opts.maxZoom;
  if (!(contentWidth > 0) || !(contentHeight > 0) ||
      !(availWidth > 0) || !(availHeight > 0)) {
    return Math.min(1, maxZoom);
  }
  var usableW = Math.max(1, availWidth - 2 * pad);
  var usableH = Math.max(1, availHeight - 2 * pad);
  var raw = Math.min(usableW / contentWidth, usableH / contentHeight);
  return Math.max(minZoom, Math.min(maxZoom, raw));
};

// Default window bounds for the Live Console timeline zoom/pan primitives —
// mirrors lib/timeline-zoom.js's TIMELINE_MIN_SPAN_MS/TIMELINE_MAX_SPAN_MS.
var TIMELINE_MIN_SPAN_MS = 60 * 60 * 1000; // 1h
var TIMELINE_MAX_SPAN_MS = 24 * 60 * 60 * 1000; // 24h

function clampTimelineWindow(startMs, endMs, nowMs, maxSpanMs) {
  var span = endMs - startMs;
  var boundEnd = nowMs;
  var boundStart = nowMs - maxSpanMs;
  var s = startMs, e = endMs;
  if (e > boundEnd) { e = boundEnd; s = e - span; }
  if (s < boundStart) { s = boundStart; e = s + span; }
  return { startMs: s, endMs: e };
}

/**
 * Live Console timeline zoom (LIN-1743). Mirror of lib/timeline-zoom.js
 * computeTimelineZoom — zoom the window around a focal point, keeping the
 * instant at `focalX` stationary. Keep in sync with the pure version.
 * @global
 */
window.computeTimelineZoom = function computeTimelineZoom(opts) {
  var startMs = opts.startMs, endMs = opts.endMs;
  var focalX = opts.focalX, deltaZoom = opts.deltaZoom;
  var viewportWidthPx = opts.viewportWidthPx, nowMs = opts.nowMs;
  var minSpanMs = opts.minSpanMs === undefined ? TIMELINE_MIN_SPAN_MS : opts.minSpanMs;
  var maxSpanMs = opts.maxSpanMs === undefined ? TIMELINE_MAX_SPAN_MS : opts.maxSpanMs;
  if (!(viewportWidthPx > 0) || !(endMs > startMs)) return { startMs: startMs, endMs: endMs };
  var span = endMs - startMs;
  var factor = Math.exp(deltaZoom);
  var newSpan = Math.max(minSpanMs, Math.min(maxSpanMs, span * factor));
  var ratio = Math.max(0, Math.min(1, focalX / viewportWidthPx));
  var focalMs = startMs + ratio * span;
  var newStart = focalMs - ratio * newSpan;
  var newEnd = newStart + newSpan;
  return clampTimelineWindow(newStart, newEnd, nowMs, maxSpanMs);
};

/**
 * Live Console timeline pan (LIN-1743). Mirror of lib/timeline-zoom.js
 * computeTimelinePan — shift the window by deltaPx, preserving its span,
 * clamped to the same axis bounds computeTimelineZoom uses. Keep in sync
 * with the pure version.
 * @global
 */
window.computeTimelinePan = function computeTimelinePan(opts) {
  var startMs = opts.startMs, endMs = opts.endMs;
  var deltaPx = opts.deltaPx, viewportWidthPx = opts.viewportWidthPx, nowMs = opts.nowMs;
  var maxSpanMs = opts.maxSpanMs === undefined ? TIMELINE_MAX_SPAN_MS : opts.maxSpanMs;
  if (!(viewportWidthPx > 0) || !(endMs > startMs)) return { startMs: startMs, endMs: endMs };
  var span = endMs - startMs;
  var deltaMs = (deltaPx / viewportWidthPx) * span;
  var newStart = startMs - deltaMs;
  var newEnd = endMs - deltaMs;
  return clampTimelineWindow(newStart, newEnd, nowMs, maxSpanMs);
};

/**
 * Live Console timeline run/window overlap test (LIN-1743 F1). Mirror of
 * lib/timeline-zoom.js timelineRunOverlapsWindow — keep in sync with the pure
 * version.
 * @global
 */
window.timelineRunOverlapsWindow = function timelineRunOverlapsWindow(run, windowStart, windowEnd, nowMs) {
  if (!run || run.start == null) return false;
  var end = run.end != null ? run.end : nowMs;
  return run.start < windowEnd && end > windowStart;
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
// Dispatch queue row (LIN-1244)
// =============================================================================

/**
 * First non-empty line of a prompt, trimmed and length-capped.
 *
 * FIRST-LINE-ONLY is a security boundary, not just cosmetics (LIN-1244): the
 * dispatch list payload's raw `prompt` may embed a multi-line single-use
 * bootstrap proxy-token block, so collapsing to the first line ensures the row
 * never dumps the token block into the UI. The cap bounds row height.
 *
 * @param {string} prompt - Raw prompt text (may be multi-line / undefined).
 * @param {number} cap - Maximum characters before an ellipsis is appended.
 * @returns {string} A single, capped line (empty string when nothing to show).
 */
function firstPromptLine(prompt, cap) {
  if (!prompt || typeof prompt !== 'string') return '';
  const line = prompt.split('\n').map(l => l.trim()).find(Boolean) || '';
  if (line.length <= cap) return line;
  return line.slice(0, cap - 1).trimEnd() + '…';
}

/**
 * Shared dispatch queue-row renderer (LIN-1244). The single source of the
 * `.queue-item*` markup for BOTH twin renderers — `app.js` `renderQueueItems()`
 * (the nav-badge popover, loaded on every page) and `dispatch.js`
 * `renderDispatchQueueList()` (the /dispatch Queue section) — so the two cannot
 * drift apart again.
 *
 * Renders richer always-visible content from fields the list endpoint already
 * returns (no server/store/API change): the prompt name/kind, the issue as a
 * link, a one-line prompt snippet, execution model/harness chips, and
 * follow-up/force flags. This is deliberately by-default content, NOT a hidden
 * auto-expanding panel — the queue lists wholesale-replace `innerHTML` on poll,
 * which would wipe any JS-toggled expand state.
 *
 * Security (LIN-1244): the raw `prompt` may embed a single-use bootstrap
 * proxy-token block, so the snippet is first-line-only and length-capped (see
 * `firstPromptLine`); the `bootstrapToken` field is never surfaced.
 *
 * @param {Object} item - A dispatch list item (from GET .../api/dispatch).
 * @param {string} urlKey - Workspace url key (for the remove button).
 * @param {{card?: boolean}} [opts] - `card:true` adds the `.card` wrapper class
 *   the /dispatch page's list uses; the nav popover omits it.
 * @global
 * @returns {string} Queue-row HTML.
 */
window.renderQueueRow = function renderQueueRow(item, urlKey, { card = false } = {}) {
  const esc = window.escapeHtml;
  const time = new Date(item.dispatchedAt).toLocaleString();
  const title = item.issueTitle || item.promptName || 'Prompt';
  // Display the 'local' API value as the user-facing 'harbour' label on BOTH
  // surfaces. app.js historically omitted this mapping that dispatch.js had —
  // sharing this helper resolves that pre-existing drift.
  const target = item.target === 'local' ? 'harbour' : (item.target || 'cli');

  // Issue rendered as a link when a URL is present; plain identifier otherwise.
  const issueHtml = item.issueIdentifier
    ? (item.issueUrl
        ? `<a class="queue-item-issue" href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${esc(item.issueIdentifier)}</a>`
        : `<span class="queue-item-issue">${esc(item.issueIdentifier)}</span>`)
    : '';
  const metaHtml = [issueHtml, ...[item.repo, target, time].filter(Boolean).map(esc)]
    .filter(Boolean)
    .join(' · ');

  const snippet = firstPromptLine(item.prompt, 140);
  const snippetHtml = snippet ? `<div class="queue-item-snippet">${esc(snippet)}</div>` : '';

  // Field chips — surface the prompt's real identity + execution intent that the
  // opaque title/meta hid. The kind chip is suppressed when it would just repeat
  // the title (e.g. an issueless custom prompt whose title already IS its name).
  const chip = (label, extra) =>
    window.renderChip({ label, className: extra ? `queue-item-chip ${extra}` : 'queue-item-chip' });
  const kindLabel = item.promptName && item.promptName !== 'Prompt'
    ? item.promptName
    : (item.kind && item.kind !== 'custom' ? item.kind : '');
  const chips = [];
  if (kindLabel && kindLabel !== title) chips.push(chip(kindLabel));
  if (item.model) chips.push(chip(item.model));
  if (item.harness) chips.push(chip(item.harness));
  if (item.followUpTo) chips.push(chip('follow-up', 'queue-item-flag'));
  if (item.force) chips.push(chip('force', 'queue-item-flag'));
  const chipsHtml = chips.length ? `<div class="queue-item-chips">${chips.join('')}</div>` : '';

  const wrapperClass = card ? 'card queue-item' : 'queue-item';
  return `
      <div class="${wrapperClass}" data-item-id="${esc(item.id)}">
        <div class="queue-item-header">
          <span class="queue-item-title">${esc(title)}</span>
          <button class="queue-item-remove" data-item-id="${esc(item.id)}" data-url-key="${esc(urlKey)}">remove</button>
        </div>
        <div class="queue-item-meta">${metaHtml}</div>
        ${snippetHtml}
        ${chipsHtml}
      </div>
    `;
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
 * Proxy-context appending is handled by the SERVER for dispatch (LIN-1162): callers
 * pass the raw prompt and `dispatchPrompt` sends an `attachProxy` boolean (true when
 * the +proxy toggle is on, or `proxyForce` is set) so routes/dispatch.js mints the
 * bootstrap and attaches the access block through the harness-aware
 * attachProxyContext seam — a claude-code dispatch then carries the token as the
 * structured `bootstrapToken` field instead of injectable prose. The client no
 * longer mints or appends for dispatch (that would double-append and could never
 * take the MCP path). Copy/download flows keep their own client-side
 * `ProxyToggle.maybeAppend` calls (dashboard manual copy/paste, unaffected).
 *
 * @global
 * @param {Object} opts
 * @param {string} opts.urlKey               Workspace URL key (required)
 * @param {string} opts.prompt               Prompt text BEFORE proxy append (required)
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
 * @param {string} [opts.model]              Execution model (opaque string, LIN-1084); blank/omitted inherits the consumer's own default (LIN-1094)
 * @param {string} [opts.harness]            Execution harness (opaque string, LIN-1084); blank/omitted inherits the consumer's own default (LIN-1094)
 * @param {boolean} [opts.appendProxyContext=true]  When true, let the server attach proxy context (send `attachProxy`) if the toggle/force says so (LIN-1162); false opts out entirely
 * @param {boolean} [opts.proxyForce=false]         Force `attachProxy:true` regardless of the toggle (LIN-645) — for surfaces whose prompt requires the proxy (e.g. next-run kickoff)
 * @param {string} [opts.followUpTo]                Resume a prior session (cli/web only); forwarded to the server as an opaque id
 * @param {boolean} [opts.force]                    Whether to force-follow-up even into a terminal session
 * @param {string} [opts.presetId]                  Selected dispatch preset id (LIN-1391); blank/omitted sends no presetId, so the consumer's own default resolution applies unchanged (LIN-1094/1390)
 * @param {number} [opts.maxTasks]                  Task-budget scope bound (LIN-1737/LIN-1751); blank/omitted sends no maxTasks, so the run stays unbounded exactly as before this field existed
 * @returns {Promise<Object>} Parsed JSON response body
 * @throws {Error} on missing required args or a non-ok response. The thrown
 *                 error carries `.status` so callers can branch (e.g. 401).
 */
window.dispatchPrompt = async function dispatchPrompt(opts = {}) {
  const { urlKey, prompt, issue, issueless = false, promptName = 'Prompt', target = 'cli', repo, kind, periodicalId, model, harness, appendProxyContext = true, proxyForce = false, followUpTo, force, presetId, maxTasks } = opts;

  if (!urlKey) throw new Error('dispatchPrompt: urlKey is required');
  if (!prompt) throw new Error('dispatchPrompt: prompt is required');
  // Issue-anchored dispatches must carry both id and identifier — every Linear
  // issue has both, and `issueIdentifier` is the key dispatch history joins on
  // (lib/pipeline-loops.js). The custom-prompt page opts out via `issueless`.
  if (!issueless && !(issue && issue.id && issue.identifier)) {
    throw new Error('dispatchPrompt: issue with id and identifier is required (pass issueless:true to opt out)');
  }

  // Proxy context is attached SERVER-SIDE for dispatch (LIN-1162): send the raw
  // prompt plus an `attachProxy` intent and let routes/dispatch.js mint the bootstrap
  // and append the harness-aware block (claude-code → structured `bootstrapToken`
  // field, no injectable token/curl prose). `appendProxyContext:false` opts out
  // entirely; otherwise the +proxy toggle (or `proxyForce`) decides. No client mint,
  // so no double-append and no client-side throw — a failed server mint surfaces as
  // a 503 from the POST below, preserving the "surface, don't silently drop" contract.
  const attachProxy = appendProxyContext
    && window.ProxyToggle.shouldAppend(urlKey, { force: proxyForce });

  const payload = { prompt, promptName, target };
  if (attachProxy) payload.attachProxy = true;
  // `kind` is normally derived server-side from promptName; pass it explicitly
  // only for meta-loops that don't map to a prompt template (e.g. 'autopilot').
  if (kind) payload.kind = kind;
  // Periodical-template join key (LIN-1825): truthy gate, like `kind` — unlike
  // `maxTasks` it has no legitimate falsy value, so there's no need for the
  // nullish gate maxTasks uses below.
  if (periodicalId) payload.periodicalId = periodicalId;
  if (issue) {
    if (issue.id) payload.issueId = issue.id;
    if (issue.identifier) payload.issueIdentifier = issue.identifier;
    if (issue.title) payload.issueTitle = issue.title;
    if (issue.url) payload.issueUrl = issue.url;
  }
  if (repo) payload.repo = repo;
  // Blank/omitted model+harness stay off the payload entirely (not sent as
  // empty strings) so the consumer's own default resolution still applies
  // (LIN-1094) — never send a value that overrides a real default with "".
  if (model) payload.model = model;
  if (harness) payload.harness = harness;
  if (followUpTo) payload.followUpTo = followUpTo;
  if (force !== undefined) payload.force = force;
  if (presetId) payload.presetId = presetId;
  if (maxTasks !== undefined && maxTasks !== null) payload.maxTasks = maxTasks;

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
// Dispatch Execution Controls (model/harness) — LIN-1096
// =============================================================================
//
// Every dispatch-time UI surface (Dispatch page, dashboard tree, the shared
// prompt-compose section, Suggested-next-run) needs the same harness
// select-or-custom + model text input pair feeding into window.dispatchPrompt's
// `model`/`harness` fields. Factored once here (the client choke point every
// surface already loads) instead of tripling the markup and read logic across
// public/dispatch.js, app.js, prompt-section.js and next-run.js. Mirrors the
// settings page's dispatch-defaults control shape (public/settings.css,
// LIN-1095) with its own class names, since settings.css isn't loaded on these
// surfaces. Harness stays an opaque string everywhere (LIN-1084/LIN-438) — this
// suggestion list is UI-only, not a registry.
const DISPATCH_HARNESS_SUGGESTIONS = ['claude-code', 'opencode'];

// UI-only default (LIN-1111): the harness select below pre-selects this value
// so a user dispatching without touching the control explicitly sends
// 'claude-code' instead of blank. This is purely client-side — it does not
// touch routes/dispatch.js resolution or the null-passthrough contract for
// consumers who bypass this UI (proxy/API omitting harness still means
// "apply your own default" on the server).
const DEFAULT_HARNESS = 'claude-code';

// Small, distinctly-named recommended-models list for the dispatch-EXECUTION
// model inputs (LIN-1111) — deliberately separate from AVAILABLE_MODELS in
// lib/openrouter.js, which recommends models for the unrelated Workspace AI
// Model selector (the model that WRITES prompts, not the one a dispatched
// agent executes with). Rendered as <datalist> suggestions, not hard options,
// so free text is still accepted and blank still resolves to null.
const DISPATCH_MODEL_SUGGESTIONS = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol'
];

// Claude Code's model presets (LIN-1282, `fable` added LIN-1763). Unlike OpenCode —
// which reaches the full OpenRouter-derived DISPATCH_MODEL_SUGGESTIONS list above
// plus the live catalog — Claude Code only offers Haiku / Sonnet / Opus / Fable.
// These are the Claude Code `--model` aliases, so they stay stable across model generations (the
// Simple Dispatcher launch-with-model wiring is a separate follow-up). The model
// input's datalist swaps between this list and the OpenCode one based on the
// selected harness (syncHarnessModelList, below); the live catalog is merged only
// into the OpenCode datalist.
const DISPATCH_CLAUDE_MODEL_SUGGESTIONS = ['haiku', 'sonnet', 'opus', 'fable'];

// =============================================================================
// Live OpenRouter model catalog (LIN-1111 Session 2)
// =============================================================================
//
// Supplements DISPATCH_MODEL_SUGGESTIONS with the full live catalog fetched
// from GET /workspace/:urlKey/api/openrouter/models (routes/workspace-api.js),
// itself backed by the SAME cache module (lib/openrouter-catalog.js) the
// Settings server-render path calls directly — one source of truth for both
// surfaces (never a fourth duplicated list). Fetched once per page load
// (module-scoped promise cache), regardless of how many dispatch-exec-controls
// instances render on the page. Never blocks the initial render: a control
// renders immediately with the static suggestions, and the datalist is
// enriched in place once the fetch resolves (or left as-is on failure).
let _dispatchModelCatalogPromise = null;
let _dispatchModelCatalog = null;

/**
 * Best-effort urlKey extraction from the current page path (every dispatch-exec
 * surface lives under `/workspace/:urlKey/...`), so the catalog fetch needs no
 * wiring at any of the four call sites.
 */
function inferWorkspaceUrlKeyFromLocation() {
  const match = window.location.pathname.match(/^\/workspace\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * De-duped `<option>` markup for catalog ids not already in DISPATCH_MODEL_SUGGESTIONS.
 */
function buildCatalogModelOptionsHtml(models) {
  if (!Array.isArray(models) || !models.length) return '';
  const seen = new Set(DISPATCH_MODEL_SUGGESTIONS);
  const parts = [];
  for (const m of models) {
    if (!m || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    parts.push(`<option value="${window.escapeHtml(m.id)}"></option>`);
  }
  return parts.join('');
}

/**
 * Append the live catalog's options to every dispatch-exec model datalist
 * already in the page. Called once, after the first (and only) catalog fetch
 * resolves — any control rendered AFTER that point gets the catalog inlined
 * directly by renderDispatchExecControls instead, so a given datalist is never
 * populated by both paths.
 */
function applyDispatchModelCatalogToPage(models) {
  const optionsHtml = buildCatalogModelOptionsHtml(models);
  if (!optionsHtml) return;
  // Only the OpenCode datalists take the catalog (LIN-1282) — the Claude Code
  // datalist stays fixed at its presets.
  document.querySelectorAll('.dispatch-exec-model-datalist-opencode').forEach(dl => {
    dl.insertAdjacentHTML('beforeend', optionsHtml);
  });
}

/**
 * Fetch the live OpenRouter model catalog for a workspace, once per page load.
 * Non-fatal: a fetch failure resolves to `[]` and the page just keeps the
 * static suggestions. Safe to call repeatedly (e.g. once per rendered
 * control) — subsequent calls reuse the same in-flight/resolved promise.
 * @global
 * @param {string} [urlKey] - Defaults to the urlKey inferred from the current page path.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
window.fetchDispatchModelCatalog = function fetchDispatchModelCatalog(urlKey) {
  if (_dispatchModelCatalogPromise) return _dispatchModelCatalogPromise;
  const key = urlKey || inferWorkspaceUrlKeyFromLocation();
  if (!key) return Promise.resolve([]);

  _dispatchModelCatalogPromise = window.api(`/workspace/${encodeURIComponent(key)}/api/openrouter/models`, { on401: false })
    .then(result => {
      _dispatchModelCatalog = Array.isArray(result?.models) ? result.models : [];
      applyDispatchModelCatalogToPage(_dispatchModelCatalog);
      return _dispatchModelCatalog;
    })
    .catch(() => {
      _dispatchModelCatalog = [];
      return _dispatchModelCatalog;
    });
  return _dispatchModelCatalogPromise;
};

/**
 * Renders the shared dispatch-time model/harness control markup: a harness
 * select plus a free-text model input whose suggestion datalist is harness-aware
 * (LIN-1282), scoped under one `idPrefix` so multiple instances can coexist on a
 * page. Read the chosen values back with `window.readDispatchExecControls`.
 *
 * The free-text "custom harness" input was removed in LIN-1282 — there are only
 * two real harnesses. The model input carries two datalists: the OpenCode one
 * (full OpenRouter list + live catalog) and the Claude Code one (fixed presets).
 * It starts on the datalist matching the pre-selected harness; the shared
 * document-level `change` handler (`syncHarnessModelList`) swaps `list` between
 * them when the harness select changes.
 * @global
 * @param {string} idPrefix - Unique prefix distinguishing this instance (e.g. an issue id)
 * @param {Object} [opts]
 * @param {string} [opts.modelPlaceholder] - Placeholder for the model input (UX-only resolved-default hint, LIN-1096)
 * @param {string} [opts.harnessDefault] - The workspace's actual resolved default harness, when the caller knows it (LIN-1111; only the Dispatch page threads this today, via data-default-harness). When given and it matches a known suggestion, it wins over the static DEFAULT_HARNESS so a configured non-Claude default (e.g. 'opencode') still pre-selects correctly instead of being silently shadowed. When given but NOT a known suggestion, nothing is pre-selected — a `<select>` can't represent an arbitrary value.
 * @returns {string} HTML for the control pair
 */
window.renderDispatchExecControls = function renderDispatchExecControls(idPrefix, opts = {}) {
  const { modelPlaceholder = 'model', harnessDefault } = opts;
  const prefix = window.escapeHtml(idPrefix || '');
  const preselectedHarness = harnessDefault === undefined
    ? DEFAULT_HARNESS
    : (DISPATCH_HARNESS_SUGGESTIONS.includes(harnessDefault) ? harnessDefault : '');
  const optionsHtml = DISPATCH_HARNESS_SUGGESTIONS
    .map(h => `<option value="${window.escapeHtml(h)}"${h === preselectedHarness ? ' selected' : ''}>${window.escapeHtml(h)}</option>`)
    .join('');
  const opencodeListId = `dispatch-exec-model-list-${prefix}`;
  const claudeListId = `dispatch-exec-model-list-claude-${prefix}`;
  const opencodeOptionsHtml = DISPATCH_MODEL_SUGGESTIONS
    .map(m => `<option value="${window.escapeHtml(m)}"></option>`)
    .join('');
  const claudeOptionsHtml = DISPATCH_CLAUDE_MODEL_SUGGESTIONS
    .map(m => `<option value="${window.escapeHtml(m)}"></option>`)
    .join('');
  // If the catalog already resolved (a prior control on this page kicked off
  // the fetch), inline it now (OpenCode datalist only); otherwise kick off the
  // fetch — it will patch this datalist (via applyDispatchModelCatalogToPage)
  // once it resolves.
  const catalogModelOptionsHtml = _dispatchModelCatalog ? buildCatalogModelOptionsHtml(_dispatchModelCatalog) : '';
  if (!_dispatchModelCatalog) window.fetchDispatchModelCatalog();
  const initialListId = preselectedHarness === 'claude-code' ? claudeListId : opencodeListId;
  return `<span class="dispatch-exec-controls" data-exec-prefix="${prefix}">
    <select class="dispatch-exec-harness-select" aria-label="Harness">
      <option value="">&mdash;</option>
      ${optionsHtml}
    </select>
    <input type="text" class="dispatch-exec-model" maxlength="200" list="${initialListId}" data-model-list-claude="${claudeListId}" data-model-list-opencode="${opencodeListId}" placeholder="${window.escapeHtml(modelPlaceholder)}" aria-label="Model">
    <datalist id="${opencodeListId}" class="dispatch-exec-model-datalist dispatch-exec-model-datalist-opencode">${opencodeOptionsHtml}${catalogModelOptionsHtml}</datalist>
    <datalist id="${claudeListId}" class="dispatch-exec-model-datalist-claude">${claudeOptionsHtml}</datalist>
  </span>`;
};

/**
 * Reads the current `{model, harness}` values back out of a container holding
 * a `.dispatch-exec-controls` block (or that block itself). The harness is the
 * select's value (the free-text "custom harness" input was removed in LIN-1282).
 * The harness select pre-selects `claude-code` (LIN-1111), so an untouched
 * control reads back `harness: 'claude-code'` rather than null — pick the blank
 * "—" option to still send null explicitly. The model field has no such default
 * (only suggestions), so a blank model still resolves to `null`, and
 * `window.dispatchPrompt` omits it so the consumer's own default resolution
 * applies (LIN-1094).
 * @global
 * @param {Element|null} [scopeEl]
 * @returns {{model: string|null, harness: string|null}}
 */
window.readDispatchExecControls = function readDispatchExecControls(scopeEl) {
  const scope = scopeEl && (scopeEl.matches && scopeEl.matches('.dispatch-exec-controls')
    ? scopeEl
    : scopeEl.querySelector && scopeEl.querySelector('.dispatch-exec-controls'));
  if (!scope) return { model: null, harness: null };
  const select = scope.querySelector('.dispatch-exec-harness-select');
  const modelInput = scope.querySelector('.dispatch-exec-model');
  const harness = (select && select.value) || '';
  const model = modelInput ? modelInput.value.trim() : '';
  return { model: model || null, harness: harness || null };
};

/**
 * Harness-aware model datalist sync (LIN-1282). Swaps a model input's `list`
 * between its Claude Code and OpenCode datalists based on the sibling harness
 * select's value: Claude Code exposes only its presets, OpenCode the full
 * OpenRouter list. Surface-agnostic — it works for both the Dispatch-page exec
 * controls (`.dispatch-exec-*`, datalists inside the control) and the Settings
 * dispatch-defaults rows (`.harness-select`/`.dispatch-model-input`, shared
 * page-level datalists) because the model input names both datalist ids via
 * `data-model-list-claude` / `data-model-list-opencode`.
 * @param {Element} select - The harness `<select>` that changed
 */
function syncHarnessModelList(select) {
  const row = select.closest('.dispatch-exec-controls, .dispatch-default-row');
  if (!row) return;
  const input = row.querySelector('.dispatch-exec-model, .dispatch-model-input');
  if (!input) return;
  const claudeId = input.getAttribute('data-model-list-claude');
  const opencodeId = input.getAttribute('data-model-list-opencode');
  if (!claudeId || !opencodeId) return;
  input.setAttribute('list', select.value === 'claude-code' ? claudeId : opencodeId);
}

// One delegated listener drives every harness/model control on the page,
// including any rendered after load (the Dispatch-page/feedback exec controls
// are injected client-side). The initial `list` is set correctly at render time
// on both surfaces, so only the change reaction needs wiring here.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('.dispatch-exec-harness-select, .harness-select')) {
      syncHarnessModelList(t);
    }
  });
}

// =============================================================================
// Dispatch Disclosure (shared dispatch toggle + options panel) — LIN-1137
// =============================================================================

/**
 * Shared client-side renderer for the "Dispatch ▾" disclosure toggle, target
 * buttons, and exec controls. Replaces the three divergent approaches (server
 * string in lib/render.js, inline HTML in prompt-section.js, DOM-building in
 * next-run.js) with one reusable function that composes the existing shared
 * infrastructure: renderDispatchExecControls() + initDisclosure().
 *
 * Emits the same `.disclosure-toggle` + `.prompt-options` class contract that
 * E2E tests and CSS expect by default. Callers that need custom classes (e.g.
 * swipe, which delegates via `data-action="dispatch"` and its own selectors)
 * can override via the optional `opts`.
 *
 * @global
 * @param {Object} opts
 * @param {string} opts.idPrefix - Unique prefix for this instance (e.g. issue id or synthetic id)
 * @param {boolean} [opts.isLocalhost=false] - Whether to include the local-only harbour target button
 * @param {string} [opts.toggleClass='dispatch-disclosure disclosure-toggle'] - CSS classes for the toggle button
 * @param {string} [opts.panelClass='prompt-options'] - CSS class for the hidden options panel
 * @param {string} [opts.buttonClass='prompt-dispatch dispatch-btn'] - CSS class for each dispatch target button
 * @param {string} [opts.buttonDataAction=''] - Value for `data-action` attribute on dispatch buttons (swipe uses 'dispatch')
 * @returns {string} HTML for the disclosure toggle + hidden options panel
 */
window.renderDispatchDisclosure = function renderDispatchDisclosure({ idPrefix, isLocalhost = false, toggleClass = 'dispatch-disclosure disclosure-toggle', panelClass = 'prompt-options', buttonClass = 'prompt-dispatch dispatch-btn', buttonDataAction = '' } = {}) {
  const prefix = idPrefix ? window.escapeHtml(String(idPrefix)) : 'unknown';
  const panelId = `dispatch-options-${prefix}`;
  const localButton = isLocalhost
    ? `<button class="${buttonClass}" data-target="local"${buttonDataAction ? ` data-action="${window.escapeHtml(buttonDataAction)}"` : ''}>harbour</button>`
    : '';
  const dataActionAttr = buttonDataAction ? ` data-action="${window.escapeHtml(buttonDataAction)}"` : '';

  return `<button class="${toggleClass}" aria-expanded="false" aria-haspopup="true" aria-controls="${panelId}">Dispatch ▾</button>` +
    `<span class="${panelClass} hidden" id="${panelId}">` +
    window.renderDispatchExecControls(panelId) +
    `<button class="${buttonClass}" data-target="cli"${dataActionAttr}>cli</button>` +
    `<button class="${buttonClass}" data-target="web"${dataActionAttr}>web</button>` +
    `<button class="${buttonClass}" data-target="dash"${dataActionAttr}>dash</button>` +
    localButton +
    '</span>';
};

// =============================================================================
// Autopilot Kickoff (shared fetch helper) — LIN-1137
// =============================================================================

/**
 * Shared fetch for the autopilot kickoff prompt (GET /api/autopilot-prompt).
 * Replaces four duplicated raw GET calls across dashboard, dispatch page, swipe,
 * and next-run with one parameterized helper.
 *
 * @global
 * @param {Object} opts
 * @param {string} opts.urlKey                  Workspace URL key (required)
 * @param {string} [opts.issueId]               Issue-scoped kickoff: appends `/${issueId}` to the URL
 * @param {string} [opts.goal]                  Goal-scoped kickoff: appends `?goal=<goal>` to the URL
 * @param {string} [opts.variant]               Optional `?variant=<variant>` query param
 * @param {number} [opts.maxTasks]              Optional task-budget scope bound (LIN-1737/LIN-1751):
 *   `?maxTasks=<n>` query param on the general (goal-scoped) kickoff only — the
 *   issue-scoped kickoff has no budget concept, so this is a no-op there.
 * @param {AbortSignal} [opts.signal]           Passed through to the fetch
 * @param {boolean} [opts.on401=false]          Passed through to window.api
 * @returns {Promise<{prompt: string, promptName: string, kind: string, repo?: string}>}
 */
window.fetchAutopilotKickoff = async function fetchAutopilotKickoff({ urlKey, issueId, goal, variant, maxTasks, signal, on401 = false } = {}) {
  if (!urlKey) throw new Error('fetchAutopilotKickoff: urlKey is required');

  let url;

  if (issueId) {
    const variantQuery = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    url = `/workspace/${encodeURIComponent(urlKey)}/api/autopilot-prompt/${encodeURIComponent(issueId)}${variantQuery}`;
  } else {
    const params = new URLSearchParams();
    if (goal) params.set('goal', goal);
    if (variant) params.set('variant', variant);
    if (maxTasks !== undefined && maxTasks !== null) params.set('maxTasks', String(maxTasks));
    const query = params.toString() ? `?${params.toString()}` : '';
    url = `/workspace/${encodeURIComponent(urlKey)}/api/autopilot-prompt${query}`;
  }

  return window.api(url, { signal, on401 });
};

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
 *  - Bootstrap tokens are single-use (LIN-376): each is spent by the agent's
 *    one exchange at `POST /api/proxy/token`. They are therefore minted FRESH on
 *    every append and never cached — caching one and serving it to a later
 *    copy/download would re-embed an already-consumed credential (LIN-1140). A
 *    failed/401 mint yields null and appends nothing, so the next append re-mints
 *    (LIN-525 #4). Each mint is scoped to the passed `urlKey`, so a page that
 *    targets more than one workspace never embeds the wrong workspace's token.
 *
 * @global
 */
window.ProxyToggle = (function () {
  const TOGGLE_KEY = 'proxy-toggle-active';

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
   * Mint a fresh single-use bootstrap proxy token for a workspace. Bootstrap
   * tokens are single-use (LIN-376), so this ALWAYS mints — it never caches or
   * reuses a token, which would embed an already-consumed credential in a later
   * copy/download from the same page load (LIN-1140). on401:false — a failed mint
   * (incl. 401 or token rate-limit) falls through to null so the caller surfaces
   * it, rather than redirecting to /logout.
   * @param {string} urlKey
   * @returns {Promise<string|null>}
   */
  async function getOrCreateToken(urlKey) {
    if (!urlKey) return null;
    try {
      const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/proxy/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // LIN-376: single-use bootstrap embedded in the appended block; the agent
        // exchanges it for a working token rather than reusing a standing one.
        body: JSON.stringify({ label: 'prompt-proxy', scope: 'readWrite', bootstrap: true }),
        on401: false
      });
      return (data && data.token) || null;
    } catch {
      return null;
    }
  }

  function buildBlock(token) {
    const baseUrl = window.location.origin;
    return `\n\n## Workspace API access\n\nYou have access to a workspace API proxy (source-neutral; currently backed by Linear). Use it to read and modify workspace issues, projects, and more.\n\nThis proxy is the workspace's own Harbour control-plane at ${baseUrl} — not a third-party service. An operator of this workspace attached this token for you; you do not have to take that on faith, because the exchange below returns live workspace data, which is itself the proof the channel is real. The token is scoped to this one workspace, is revocable, and every call is audit-logged.\n\nFirst, exchange your single-use bootstrap token for a working token:\n\n  curl -X POST -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/token\n\nThat returns { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "...", "notes": "…" }. The bootstrap is single-use — this exchange spends it — so use <WORKING_TOKEN> from here on. Then fetch the full API documentation:\n\n  curl -H "Authorization: Bearer <WORKING_TOKEN>" ${baseUrl}/api/proxy/instructions\n\nThis will return all available endpoints with examples. Your token scope is: readWrite.`;
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
   * Decide whether a prompt SHOULD carry proxy context, WITHOUT minting a token or
   * appending anything (LIN-1162). Same gate as `maybeAppend` — active + feature-on,
   * or `force` — but it returns only the boolean intent. The dispatch choke point
   * uses this to set `attachProxy` on the payload and let the SERVER mint + append
   * (harness-aware, so claude-code takes the MCP `bootstrapToken` field path). The
   * "surface, don't silently drop" contract moves to the server, which 503s when the
   * mint fails rather than enqueuing a bare prompt. Copy/download keep `maybeAppend`.
   * @param {string} urlKey
   * @param {{ force?: boolean }} [opts]
   * @returns {boolean}
   */
  function shouldAppend(urlKey, opts) {
    if (opts && opts.force) return true;
    return isActive() && isFeatureEnabled();
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

  return { isActive, isFeatureEnabled, getOrCreateToken, buildBlock, maybeAppend, shouldAppend, init, setActive };
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

  // "⋯ more" view-overflow — the shared, in-flow disclosure (LIN-1058 / LIN-1286),
  // wired below. An IN-FLOW disclosure: the `.nav-views-overflow` block sits below
  // the tab strip in NORMAL FLOW — no floating panel, no backdrop, no click-catcher
  // (LIN-984 safe by construction). Deliberately NOT wired through the selector
  // dropdown machinery above (no `.nav-dropdown-overlay`, no closeAllSelectors).
  setupNavViewsOverflow(navBar)

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
// Shared `⋯ more` view-overflow — mobile media query + desktop measured overflow
// =============================================================================
//
// The overflow group (`#nav-views-overflow`), the `⋯ more` toggle, and the
// `.nav-views-overflow--open` card are ONE shared mechanism across both viewports
// (LIN-1058 / LIN-1286):
//
//   - Mobile (≤640px): pure CSS. The `@media (max-width:640px)` block collapses the
//     whole group and reveals the toggle; JS only keeps the full group in the
//     container and resets the open state.
//   - Desktop (>640px): JS width-measured "priority+" overflow. Starting from the
//     CSS default (all overflow links inline, horizontal-scroll fallback), a
//     measuring loop collapses ONLY the items that don't fit into the SAME group and
//     marks the strip `.nav-views--collapsed` — revealing the toggle only when
//     something is actually hidden. A strip that already fits never collapses
//     (avoids the over-collapse of a pure breakpoint rule) and the horizontal
//     scrollbar disappears (the reported LIN-1286 defect).
//
// The active-hoisted current tab is a primary child of `.nav-views`, never inside
// `#nav-views-overflow`, so it is structurally un-collapsible — the active-hoist
// invariant holds for free. The disclosure a11y (aria-expanded/aria-controls) is
// the same one toggle/one group on both viewports.
function setupNavViewsOverflow(navBar) {
  const strip = navBar.querySelector('.nav-views')
  const toggle = navBar.querySelector('.nav-more-toggle')
  const overflow = navBar.querySelector('#nav-views-overflow')
  // No overflow group rendered (no flag-gated views) → nothing to manage.
  if (!strip || !toggle || !overflow) return

  // The collapsible set, captured once in server order. The active-hoisted tab is
  // NOT among these (it lives inline in `.nav-views`), so it can never be collapsed.
  const collapsible = Array.from(overflow.children)
  const mobileMq = window.matchMedia('(max-width: 640px)')

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    overflow.classList.toggle('nav-views-overflow--open', open)
    // Desktop: an open card needs the strip to wrap so the full-width card can drop
    // to its own row (like mobile) instead of fighting the nowrap strip.
    strip.classList.toggle('nav-views--open', open)
  }

  // One toggle, one group, both viewports: flip the shared open/closed card state.
  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    setOpen(toggle.getAttribute('aria-expanded') !== 'true')
  })

  function moveAllToOverflow() {
    for (const item of collapsible) {
      if (item.parentElement !== overflow) overflow.appendChild(item)
    }
  }

  // True when the strip is not horizontally overflowing (with a 1px sub-pixel
  // tolerance). Valid because measurement runs with the strip nowrap and the
  // collapsed group `display:none`, so only the inline items + toggle count.
  const fits = () => strip.scrollWidth <= strip.clientWidth + 1

  function layout() {
    // Start from a known state every pass: card closed, full group re-collapsed.
    setOpen(false)
    moveAllToOverflow()

    // Mobile: the media query owns the collapse entirely — leave the full group in
    // the container and don't mark the desktop-managed state.
    if (mobileMq.matches) {
      strip.classList.remove('nav-views--collapsed')
      return
    }

    // Desktop: collapse the group first (hidden items don't count toward width),
    // then inline as many as fit, front-first (server order preserved).
    strip.classList.add('nav-views--collapsed')
    while (overflow.firstElementChild) {
      const item = overflow.firstElementChild
      strip.insertBefore(item, toggle) // tentatively inline it
      if (!fits()) {
        overflow.insertBefore(item, overflow.firstElementChild) // overshot — put it back
        break
      }
    }
    // Nothing left hidden → drop the managed state so the toggle hides and the strip
    // is the plain inline row again (no toggle, no collapse when everything fits).
    if (!overflow.firstElementChild) strip.classList.remove('nav-views--collapsed')
  }

  // Re-measure only when the strip's WIDTH actually changes. Opening/closing the
  // card changes the strip's HEIGHT (the flex card drops to its own row), which the
  // ResizeObserver also reports — re-running layout on that would immediately reset
  // the open state the user just toggled (a feedback loop). Guarding on width breaks
  // it: a viewport resize changes width and relayouts; a card toggle does not.
  let lastWidth = null
  let scheduled = false
  function remeasure() {
    scheduled = false
    const w = strip.clientWidth
    if (w === lastWidth) return
    layout()
    lastWidth = strip.clientWidth
  }
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(remeasure)
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(schedule).observe(strip)
  }
  // The media crossing (mobile⇄desktop) forces a relayout regardless of the width
  // guard, and a window resize is the fallback for no-ResizeObserver environments.
  mobileMq.addEventListener('change', () => { lastWidth = null; schedule() })
  window.addEventListener('resize', schedule)

  // Re-measure once the self-hosted fonts finish loading. The first pass can run
  // with fallback fonts (narrower), which mis-measures how many tabs fit; the font
  // swap then widens the labels WITHOUT changing the strip's clientWidth, so the
  // width guard would otherwise suppress the correcting relayout. Force it.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(() => { lastWidth = null; schedule() })
  }

  layout() // initial pass (before first paint settles, so no flash-of-collapsed)
  lastWidth = strip.clientWidth
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
