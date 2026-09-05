/**
 * Flight Companion page renderer (experimental; LIN-922 origin, live chat
 * since LIN-751 Phase A §A.8 / LIN-2435).
 *
 * Renders the live in-page chat thread (`.chat-thread`/`.chat-composer`,
 * chat.css/window.ChatUI) that public/flight-companion.js drives — streaming
 * turns, history, proposal Approve/Dismiss controls, and its own client wake
 * cadence. Alongside it, still renders the original, older Flight Companion
 * kickoff prompt (built server-side by buildFlightCompanionKickoff) in a
 * copyable block, so a human who wants a full agent session rather than a
 * chat turn can paste it into a real Claude Code session with a readWrite
 * proxy token — kept, not replaced, by the newer chat.
 *
 * Provider-free (mirrors render-next-run.js / render-task-chat.js): the route
 * builds the prompt and passes it in; there is zero business logic here.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderDisclosure } from './components/disclosure.js';

/**
 * Renders the read-only "latest observer report" panel (LIN-2395). Pure
 * presentation over an `ObserverStateStore` document — never a write path
 * (the route handing this in only ever calls `readCurrent`).
 *
 * `observerReportDoc` is `null` when the observer-pass instance has never
 * been seeded (the pass job has not run for this workspace yet — an honest
 * empty state, not an error) or when its state still carries the seed
 * marker (`state.seeded === true`), which means it was seeded but has not
 * yet completed one real tick.
 *
 * Report freshness and census (fleet) freshness are two DISTINCT stamps,
 * shown separately rather than conflated: `doc.updatedAt` is when this
 * pass's own report last genuinely changed; `report.censusGroundedAt` is
 * the `updatedAt` of the sweep census the report was grounded on — which
 * can be older, since the two jobs run on different cadences (LIN-2395
 * plan, "Report freshness vs. census freshness").
 *
 * @param {Object|null} observerReportDoc - `observerStateStore.readCurrent('pass:v1:<urlKey>')` result.
 * @returns {string}
 */
function renderObserverReportPanel(observerReportDoc) {
  if (!observerReportDoc || observerReportDoc.state?.seeded === true) {
    return '<p class="flight-companion-observer-empty">No observer pass has run for this workspace yet.</p>';
  }

  const state = observerReportDoc.state || {};
  const report = state.report || {};
  const lanes = report.lanes && typeof report.lanes === 'object' ? report.lanes : {};
  const flags = Array.isArray(report.flags) ? report.flags : [];

  const laneItems = Object.entries(lanes)
    .map(([lane, count]) => `<li><span class="fc-obs-lane-name">${escapeHtml(lane)}</span> <span class="fc-obs-lane-count">${escapeHtml(String(count))}</span></li>`)
    .join('');

  const flagsHtml = flags.length
    ? `<ul class="flight-companion-observer-flags">${flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
    : '<p class="flight-companion-observer-empty">No flags this tick.</p>';

  const attention = Array.isArray(report.attention) ? report.attention : [];
  const attentionCount = typeof report.attentionCount === 'number' ? report.attentionCount : attention.length;
  const attentionOverflow = attentionCount > attention.length
    ? `<p class="fc-obs-attention-overflow">…and ${escapeHtml(String(attentionCount - attention.length))} more</p>`
    : '';
  const attentionHtml = attention.length
    ? `<ul class="fc-obs-attention">${attention.map((row) => `<li><span class="fc-obs-attention-lane">${escapeHtml(row.lane || '')}</span> <span class="fc-obs-attention-issue">${escapeHtml(row.issue || row.loopId || '')}</span> (${escapeHtml(row.stage || 'unknown stage')}) since ${escapeHtml(row.since || '')}</li>`).join('')}</ul>${attentionOverflow}`
    : '<p class="flight-companion-observer-empty">No attention rows this tick.</p>';

  const toIso = (v) => (v instanceof Date ? v.toISOString() : (v || null));
  const passUpdatedAt = toIso(observerReportDoc.updatedAt);
  const censusGroundedAt = report.censusGroundedAt || null;
  const authority = state.authority === 'on-unimplemented' ? 'on-unimplemented' : 'off';

  return `<div class="flight-companion-observer-report">
        <p class="flight-companion-observer-narrative">${escapeHtml(report.narrative || '')}</p>
        <ul class="flight-companion-observer-lanes">${laneItems}</ul>
        ${flagsHtml}
        ${attentionHtml}
        <p class="flight-companion-observer-meta">
          Authority: <code>${escapeHtml(authority)}</code>
          · Report generated: <time datetime="${escapeHtml(passUpdatedAt || '')}">${escapeHtml(passUpdatedAt || 'unknown')}</time>
          · Fleet census grounded as of: <time datetime="${escapeHtml(censusGroundedAt || '')}">${escapeHtml(censusGroundedAt || 'unknown')}</time>
        </p>
      </div>`;
}

/**
 * LIN-2621: the status strip — model id, tools on/off, last check-in, next
 * check-in due, sweep liveness / no-census, and the mode line. Pure
 * presentation over `buildFlightCompanionStripData`'s (routes/flight-
 * companion.js) already-derived data, matching this renderer's own header
 * contract ("zero business logic here" — the route resolves the model and
 * reads the observer-state docs; this only interpolates and escapes).
 *
 * `#flight-companion-strip-next` ("next check-in due") is rendered EMPTY —
 * an em dash placeholder — for the same reason `#flight-companion-checkin`
 * is: there is no server-side "next scheduled wake" to render, since the
 * wake cadence is the CLIENT's own in-memory, per-tab countdown
 * (public/flight-companion.js). It is filled in client-side, same house
 * pattern as the check-in line.
 *
 * `#flight-companion-strip-tab-total` (LIN-2621 beat 3, "N check-ins · $x
 * this tab") is rendered with its TRUE initial value, "0 check-ins · $0.00
 * this tab" — unlike next-check-in, a fresh tab's spend really is zero at
 * render time, so this is a fact, not a guess. Updated in place client-side
 * on every `done` frame the tab observes (silent or visible, any turn kind)
 * — the whole point being that a silent tick's cost otherwise has nowhere
 * to appear.
 *
 * @param {Object|null} strip - `buildFlightCompanionStripData`'s result, or null.
 * @returns {string}
 */
function renderStatusStrip(strip) {
  const s = strip || {};
  const modelText = s.model ? escapeHtml(s.model) : 'unknown';
  const toolsText = s.toolsOn ? 'on' : 'off';
  const lastCheckInText = s.lastCheckInAt
    ? `<time datetime="${escapeHtml(s.lastCheckInAt)}">${escapeHtml(s.lastCheckInAt)}</time>`
    : 'never';
  let sweepText;
  if (!s.sweepStatus || s.sweepStatus === 'no-census') {
    // LIN-2487's own established wording, reused verbatim — see
    // buildFlightCompanionStripData's doc comment for why this checks the
    // same null-ness the gate keys off rather than calling that ticket's
    // (browser-only, live-tick) formatter directly. A missing `strip`
    // altogether (a caller that has not wired the route's data at all)
    // degrades to this SAME honest text, never a fabricated "stale" claim.
    sweepText = 'no fleet scan yet';
  } else {
    const seenHtml = s.sweepLastSeenAt
      ? `<time datetime="${escapeHtml(s.sweepLastSeenAt)}">${escapeHtml(s.sweepLastSeenAt)}</time>`
      : 'unknown';
    sweepText = `sweep ${s.sweepStatus === 'alive' ? 'alive' : 'stale'} · last seen ${seenHtml}`;
  }
  const modeText = escapeHtml(s.mode || 'read-only · proposes, never acts · rung 1 of 3');

  return `<div class="fc-status-strip" id="flight-companion-strip">
        <span class="fc-strip-model">model: <code>${modelText}</code></span>
        <span class="fc-strip-tools">tools: ${toolsText}</span>
        <span class="fc-strip-checkin">last check-in: ${lastCheckInText}</span>
        <span class="fc-strip-next-checkin" id="flight-companion-strip-next">next check-in: —</span>
        <span class="fc-strip-sweep">${sweepText}</span>
        <span class="fc-strip-tab-total" id="flight-companion-strip-tab-total">0 check-ins · $0.00 this tab</span>
        <span class="fc-strip-mode">mode: ${modeText}</span>
      </div>`;
}

/**
 * @param {Object} data
 * @param {string} data.prompt - The Flight Companion kickoff prompt to surface.
 * @param {Object|null} [data.observerReportDoc] - LIN-2395: the observer-pass
 *   instance's current `ObserverStateStore` document, or null/absent when
 *   none exists yet. Read-only; this renderer never mutates it.
 * @param {Object|null} [data.strip] - LIN-2621: `buildFlightCompanionStripData`'s
 *   (routes/flight-companion.js) result — model/tools/check-in/sweep/mode,
 *   already resolved server-side for this page load.
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderFlightCompanionPage(data = {}, options = {}) {
  const { prompt = '', observerReportDoc = null, strip = null } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'flight-companion', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/flight-companion', urlKey, openRouterSource, featureFlags });

  const encodedUrlKey = escapeHtml(urlKey || '');

  // LIN-2443: shortened to a 2-3 line sans-serif intro (`.flight-companion-
  // experimental` carries the font-content override in flight-companion.css)
  // — the page `body` default is monospace (public/style.css), which is what
  // made the old, longer paragraph read as a wall of text above the fold.
  const introBody = `<div class="tree">
        <p class="flight-companion-experimental">⚗ Experimental — <strong>realtime chat with work in flight</strong> (LIN-751). It checks in with you on its own, or answers directly when you ask. Approve or Dismiss any follow-up it proposes.</p>
        <ol class="flight-companion-steps">
          <li>Say something in the chat above, or just leave the tab open — the companion checks in periodically on its own.</li>
          <li>When it proposes a follow-up, Approve to queue it or Dismiss to drop it.</li>
          <li>Want a full agent session instead of a chat? Copy the kickoff prompt below and hand it to a fresh Claude Code session with a <code>readWrite</code> proxy token.</li>
        </ol>
      </div>`;

  const proxyToggle = featureFlags.proxy === true
    ? '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>'
    : '';

  // LIN-2443 AC5: only the prompt `<pre>` collapses (via the canonical
  // renderDisclosure primitive, LIN-786), rendered without `open` so it is
  // closed by default. `.flight-companion-actions` stays OUTSIDE the
  // disclosure so #flight-companion-copy / .prompt-proxy-toggle /
  // #flight-companion-copy-feedback stay actionable for
  // tests/e2e/flight-companion-proxy-copy.spec.js without a disclosure step.
  const promptDisclosure = renderDisclosure({
    summary: 'show kickoff prompt',
    body: `<pre class="obs-session-body flight-companion-prompt" id="flight-companion-prompt">${escapeHtml(prompt)}</pre>`,
  });

  const promptBody = `<div class="flight-companion-actions">
        <button type="button" id="flight-companion-copy" class="action-btn save">copy prompt</button>${proxyToggle}
        <span class="flight-companion-feedback" id="flight-companion-copy-feedback"></span>
      </div>
      ${promptDisclosure}`;

  // LIN-2435 Commit 2: the chat-thread render — the one named contract gap
  // in the chosen path (Flight Companion is chat-shaped but was the only
  // such surface not consuming the shared chat.css/window.ChatUI). Server-
  // rendered as an empty, hidden thread + a composer (mirrors
  // lib/render-task-chat.js's `chat-thread`/`chat-composer` shape); all
  // populating and interaction is client-side (public/flight-companion.js,
  // Commit 3). Greenfield addition — there is no prior bespoke thread
  // markup here to migrate or displace.
  //
  // LIN-2443: `#flight-companion-checkin` is the single, non-stacking
  // check-in status line (empty/hidden until the client fills it) — the
  // client overwrites its textContent, it is never appended to.
  //
  // LIN-2622: `#flight-companion-start` and `#flight-companion-reorient` are
  // a complementary pair (public/flight-companion.js toggles them opposite
  // to one another, keyed off the empty-state's own visibility). Both are
  // direct siblings of `#flight-companion-thread`/the empty state/the
  // composer (never wrapped in a new element), which is load-bearing:
  // flight-companion.css's phone-shape media query sizes THESE elements as
  // direct flex children of `.flight-companion-chat-section` by selector —
  // see that file's own header comment. The status strip below (LIN-2621)
  // is a NEW direct sibling too, prepended above the thread — it does not
  // reorder or rewrap any of the existing siblings, so their relative order
  // (and the phone-shape selectors keyed on it) is unchanged; the media
  // query gains one more `flex: 0 0 auto` selector for the strip itself.
  //
  // LIN-2622 close-out F1 / LIN-2621 beat 2: `#flight-companion-reorient`
  // used to carry `action-btn` with no colour variant — transparent,
  // borderless, indistinguishable from body text at rest (LIN-2622 close-out
  // comment `8e2f8f7c`). Rather than fold it INTO the strip (which would
  // move it out of this load-bearing sibling position for no behavioural
  // gain), it keeps its place and gains the existing `.action-btn.connect`
  // (blue) variant already used elsewhere in the app — reused, not forked —
  // so it now renders as a real, visible button.
  const chatBody = `${renderStatusStrip(strip)}
      <ul class="chat-thread" id="flight-companion-thread" hidden></ul>
      ${renderEmptyState({ tag: 'p', className: 'flight-companion-chat-empty', id: 'flight-companion-chat-empty', text: '○ the companion checks in periodically while this tab is open — or say something now.' })}
      <button type="button" id="flight-companion-start" class="action-btn save fc-start-btn">start</button>
      <p class="fc-checkin-status" id="flight-companion-checkin" aria-live="polite" hidden></p>
      <button type="button" id="flight-companion-reorient" class="action-btn connect fc-reorient-btn hidden" title="Ask the companion to re-orient now">reorient</button>
      <div class="fc-chat-composer chat-composer chat-composer--inline">
        <input type="text" id="flight-companion-question" class="fc-composer-input" placeholder="ask the companion…" maxlength="2000" autocomplete="off">
        <button type="button" id="flight-companion-send" class="action-btn save">send</button>
      </div>`;

  return renderPage({
    title: 'Flight Companion - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/chat.css', '/flight-companion.css'],
    // LIN-525 #2: live proxy flag → ProxyToggle.maybeAppend no-ops when off.
    bodyAttrs: featureFlags.proxy === true ? 'data-proxy-feature="true"' : undefined,
    nav: navBarHtml,
    // chat.js before flight-companion.js: the proposal control calls
    // window.ChatUI (mirrors lib/render-observation.js's chat.js-before-
    // observation.js load-order comment).
    scripts: ['/common.js', '/chat.js', '/flight-companion.js'],
    content: `<main class="flight-companion-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Flight Companion', subtitle: 'Chat with work in flight — a live companion that checks in with you and proposes actions for your approval.' })}

    ${renderSection({ boxed: true, className: 'flight-companion-section flight-companion-chat-section', titleClass: 'section-header', title: 'Chat', body: chatBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'How to use', body: introBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'Kickoff prompt', body: promptBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'Latest observer report (read-only)', body: renderObserverReportPanel(observerReportDoc) })}
  </main>
  ${footerHtml}`,
  });
}
