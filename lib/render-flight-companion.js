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

/**
 * @param {Object} data
 * @param {string} data.prompt - The Flight Companion kickoff prompt to surface.
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderFlightCompanionPage(data = {}, options = {}) {
  const { prompt = '' } = data;
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

  return renderPage({
    title: 'Flight Companion - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/flight-companion.css'],
    // LIN-525 #2: live proxy flag → ProxyToggle.maybeAppend no-ops when off.
    bodyAttrs: featureFlags.proxy === true ? 'data-proxy-feature="true"' : undefined,
    nav: navBarHtml,
    scripts: ['/common.js', '/flight-companion.js'],
    content: `<main class="flight-companion-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Flight Companion', subtitle: 'Chat with work in flight — via a real Claude Code session standing in for the model.' })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'How to use', body: introBody })}

    ${renderSection({ boxed: true, className: 'flight-companion-section', titleClass: 'section-header', title: 'Kickoff prompt', body: promptBody })}
  </main>
  ${footerHtml}`,
  });
}
