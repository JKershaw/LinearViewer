/**
 * Flight Companion page renderer (experimental, LIN-922 — prototype for LIN-751).
 *
 * A deliberately minimal stub: it surfaces the exact Flight Companion kickoff
 * prompt (built server-side by buildFlightCompanionKickoff) in a copyable block,
 * so a human can paste it into a real Claude Code session with a readWrite proxy
 * token and watch it behave as LIN-751's "chat with work in flight" companion.
 * The transparency requirement is met for free by the session's own transcript,
 * so there is no separate inspector here — this page is just the prompt + copy.
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
 * @param {Object} data
 * @param {string} data.prompt - The Flight Companion kickoff prompt to surface.
 * @param {Object|null} [data.observerReportDoc] - LIN-2395: the observer-pass
 *   instance's current `ObserverStateStore` document, or null/absent when
 *   none exists yet. Read-only; this renderer never mutates it.
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderFlightCompanionPage(data = {}, options = {}) {
  const { prompt = '', observerReportDoc = null } = data;
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

  const introBody = `<div class="tree">
        <p class="flight-companion-experimental">⚗ Experimental — a prototype for <strong>realtime chat with work in flight</strong> (LIN-751). Instead of waiting on model tool-calling, hand this kickoff prompt to a real Claude Code session with a <code>readWrite</code> proxy token: its curls become its tools, and it acts as a friendly companion that watches the dispatch feed and only kicks off work once you say go.</p>
        <ol class="flight-companion-steps">
          <li>Turn on <code>+proxy</code> below to have a proxy token appended automatically, or mint one yourself (Settings → Linear API proxy).</li>
          <li>Copy the kickoff prompt below.</li>
          <li>Paste it into a fresh Claude Code session.</li>
          <li>Watch it boot, orient off the stack, monitor in-flight dispatches, and propose actions for your approval.</li>
        </ol>
      </div>`;

  const proxyToggle = featureFlags.proxy === true
    ? '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>'
    : '';

  const promptBody = `<div class="flight-companion-actions">
        <button type="button" id="flight-companion-copy" class="action-btn save">copy prompt</button>${proxyToggle}
        <span class="flight-companion-feedback" id="flight-companion-copy-feedback"></span>
      </div>
      <pre class="obs-session-body flight-companion-prompt" id="flight-companion-prompt">${escapeHtml(prompt)}</pre>`;

  // LIN-2435 Commit 2: the chat-thread render — the one named contract gap
  // in the chosen path (Flight Companion is chat-shaped but was the only
  // such surface not consuming the shared chat.css/window.ChatUI). Server-
  // rendered as an empty, hidden thread + a composer (mirrors
  // lib/render-task-chat.js's `chat-thread`/`chat-composer` shape); all
  // populating and interaction is client-side (public/flight-companion.js,
  // Commit 3). Greenfield addition — there is no prior bespoke thread
  // markup here to migrate or displace.
  const chatBody = `<ul class="chat-thread" id="flight-companion-thread" hidden></ul>
      ${renderEmptyState({ tag: 'p', className: 'flight-companion-chat-empty', id: 'flight-companion-chat-empty', text: '○ the companion checks in periodically while this tab is open — or say something now.' })}
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
    ${renderPageHeader({ title: 'Flight Companion', subtitle: 'Chat with work in flight — via a real Claude Code session standing in for the model.' })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'How to use', body: introBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section flight-companion-chat-section', titleClass: 'section-header', title: 'Chat', body: chatBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'Kickoff prompt', body: promptBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'Latest observer report (read-only)', body: renderObserverReportPanel(observerReportDoc) })}
  </main>
  ${footerHtml}`,
  });
}
