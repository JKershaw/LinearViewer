/**
 * Passage Planner page renderer (experimental, LIN-1849 — Flight Companion
 * parity, LIN-922 + LIN-1764).
 *
 * A deliberately minimal stub: it surfaces the exact Passage Planner kickoff
 * prompt (built server-side by buildPassagePlannerKickoff) in a copyable
 * block, so a human can paste it into a fresh Claude Code session with a
 * `readWrite` proxy token and run a live passage-planning session.
 *
 * Provider-free (mirrors render-flight-companion.js): the route builds the
 * prompt and passes it in; there is zero business logic here.
 *
 * Unlike Flight Companion, the copy path here is a FORCED proxy append — the
 * planner prompt requires the access block, so there is no user-facing
 * +proxy toggle. Only `data-proxy-available` is emitted (never
 * `data-proxy-feature`, which nothing on this page reads): one attribute, one
 * fact, one reader (public/passage-planner.js). When `proxy` is off for this
 * session, a forced mint would 403 at the server gate (routes/proxy.js), so
 * the page degrades explicitly instead of attempting a doomed mint.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';

/**
 * @param {Object} data
 * @param {string} data.prompt - The Passage Planner kickoff prompt to surface.
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderPassagePlannerPage(data = {}, options = {}) {
  const { prompt = '' } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'passage-planner', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/passage-planner', urlKey, openRouterSource, featureFlags });

  const encodedUrlKey = escapeHtml(urlKey || '');
  const proxyAvailable = featureFlags.proxy === true;

  const introBody = `<div class="tree">
        <p class="passage-planner-experimental">⚗ Experimental — a live <strong>passage-planning session</strong> kickoff (Flight Companion parity, LIN-1849). Copy the prompt below and paste it into a fresh Claude Code session with a <code>readWrite</code> proxy token: together you and it will orient off the real state of the workspace and negotiate a small ratified plan.</p>
        <ol class="passage-planner-steps">
          <li>Copy the kickoff prompt below.</li>
          <li>Paste it into a fresh Claude Code session.</li>
          <li>Work through orientation, sizing, and proposal together — nothing is written or dispatched without your explicit yes.</li>
        </ol>
      </div>`;

  const degradationNotice = !proxyAvailable
    ? `<p class="passage-planner-degraded">This prompt requires workspace API access, which is currently off for you — <a href="/workspace/${encodedUrlKey}/settings">enable it in Settings</a>. The copied prompt will not include the access block it references; the session will need you to say so, or you can enable access first.</p>`
    : '';

  const promptBody = `<div class="passage-planner-actions">
        <button type="button" id="passage-planner-copy" class="action-btn save">copy prompt</button>
        <span class="passage-planner-feedback" id="passage-planner-copy-feedback"></span>
      </div>
      ${degradationNotice}
      <pre class="obs-session-body passage-planner-prompt" id="passage-planner-prompt">${escapeHtml(prompt)}</pre>`;

  return renderPage({
    title: 'Passage Planner - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/passage-planner.css'],
    bodyAttrs: `data-proxy-available="${proxyAvailable ? 'true' : 'false'}"`,
    nav: navBarHtml,
    scripts: ['/common.js', '/passage-planner.js'],
    content: `<main class="passage-planner-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Passage Planner', subtitle: 'A live planning session kickoff — orient, size, and ratify a small passage of work together.' })}

    ${renderSection({ boxed: true, className: 'passage-planner-section', titleClass: 'section-header', title: 'How to use', body: introBody })}

    ${renderSection({ boxed: true, className: 'passage-planner-section', titleClass: 'section-header', title: 'Kickoff prompt', body: promptBody })}
  </main>
  ${footerHtml}`,
  });
}
