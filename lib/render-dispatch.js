/**
 * Dispatch Page Renderer
 *
 * Generates HTML for the standalone /dispatch page.
 * Consolidates dispatch-related UI: custom prompt dispatcher,
 * queue list, token management, and dispatch history.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderField } from './components/field.js';

/**
 * Options for renderDispatchPage
 * @typedef {Object} DispatchPageOptions
 * @property {Object} [deployInfo] - Deploy information (see lib/deploy-info.js)
 * @property {string} [urlKey] - Current workspace URL key
 * @property {'oauth'|'env'|'free'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 * @property {Object} [featureFlags] - Current feature toggle states
 * @property {{model?: string, harness?: string}} [dispatchDefaults] - Workspace-wide dispatch defaults (LIN-1094), used only for the model/harness placeholder nicety (LIN-1096)
 */

/**
 * Renders the dispatch page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {DispatchPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderDispatchPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, isLocalhost = false, dispatchDefaults = {}, proxyDefault = true } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'dispatch', featureFlags });

  // LIN-3849: the page stays reachable by URL for a member, read-only. The send
  // controls (the Dispatch menu and its cli / web / dash / harbour targets) are
  // run controls and render only for the owner of a workspace with a live runner
  // key or queue token; the Autopilot loaders and +proxy are key tools and stay.
  const canRun = featureFlags.runControls === true;
  // Owner-only writes (halt, queue-token mint and revoke) are refused by the
  // server for a member, so a member sees the page without those controls. The
  // owner of a workspace with no way to run yet (`runSetup`) still sees them.
  const isOwner = canRun || featureFlags.runSetup === true;

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/dispatch',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const encodedUrlKey = escapeHtml(urlKey);

  // LIN-2818: the general-run goal textarea below keeps maxlength="1000". Its
  // value round-trips through the URL query string (`?goal=` → workspace-api.js's
  // `slice(0, 1000)`), and Node's default 16KB header ceiling can't reliably
  // carry more — so the textarea must not offer input the transport can't send.
  // The scoped POST body cap is the surface raised (routes/proxy-kickoff.js).

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Dispatch`,
    stylesheets: ['/style.css', '/common-actions.css', '/dispatch.css'],
    // LIN-2944 P3 (addendum 16): emit the account's proxy-default state.
    // (LIN-3849: the LIN-525 #2 body attribute for the proxy switch is
    // gone; key tools are always on.)
    bodyAttrs: `data-proxy-active="${proxyDefault !== false ? 'true' : 'false'}"`,
    nav: navBarHtml,
    scripts: ['/common.js', '/app.js', '/dispatch.js'],
    content: `${renderPageHeader({ title: 'Dispatch', subtitle: 'Queue prompts for AI agents and automation tools', subtitleClass: 'dispatch-subtitle' })}

  <main>
    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-send-prompt"', title: 'Send Prompt', body: `<div class="tree">
        <div class="node">
          <div class="line dispatch-prompt-line">
            <span class="field-label">prompt:</span>
            <div class="dispatch-prompt-wrapper">
              <textarea class="dispatch-prompt-input" data-url-key="${encodedUrlKey}" placeholder="Type a custom prompt or /command..." rows="3"></textarea>
            </div>
          </div>
          <div class="children">
            <div class="node">
              ${renderField({ label: 'model/harness:', valueHtml: `<span class="dispatch-exec-controls-container" data-testid="dispatch-exec-controls-container" data-default-model="${escapeHtml(dispatchDefaults.model || '')}" data-default-harness="${escapeHtml(dispatchDefaults.harness || '')}"></span>` })}
            </div>
            <div class="node">
              ${renderField({ label: 'preset:', valueHtml: `<span class="dispatch-preset-picker-container" data-testid="dispatch-preset-picker-container" data-url-key="${encodedUrlKey}"></span>` })}
            </div>
            <div class="node">
              <div class="line dispatch-prompt-actions">
                ${canRun ? `<button class="action-btn save dispatch-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="dispatch-options">Dispatch &#9662;</button>` : ''}
                <textarea class="dispatch-autopilot-goal" placeholder="goal (optional — leave empty to continue until stopped)" aria-label="Autopilot goal" maxlength="1000" rows="2"></textarea>
                <button class="action-btn dispatch-load-autopilot" title="Load a general Autopilot kickoff — orient off the stack and run the loop until it needs you. Type a goal (paragraphs are fine) first to focus the run.">load Autopilot</button>
                <button class="action-btn dispatch-load-autopilot" data-variant="stepper" title="Load a general Autopilot kickoff in stepped mode — drips ordered beats into one warm session, judging each before advancing.">load Autopilot · stepped</button>
                <button class="action-btn dispatch-continue-until-stopped" title="Load a general Autopilot kickoff with no goal — walk the stack under the precedence policy until it needs you.">continue until stopped</button>
                <span class="dispatch-prompt-feedback"></span>
                ${canRun ? `<div class="dispatch-options hidden" id="dispatch-options">
                  <button class="action-btn save dispatch-prompt-send" data-target="cli">cli</button>
                  <button class="action-btn save dispatch-prompt-send" data-target="web">web</button>
                  <button class="action-btn save dispatch-prompt-send" data-target="dash">dash</button>${isLocalhost ? `
                  <button class="action-btn save dispatch-prompt-send" data-target="local">harbour</button>` : ''}
                  <button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>
                </div>` : `<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>`}
              </div>
            </div>
            <div class="node dispatch-favorites-container"></div>
            <div class="node dispatch-recents-container"></div>
          </div>
        </div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-halt"', title: 'Workspace Halt', body: `
      <div class="halt-status" data-testid="dispatch-halt-status" data-url-key="${encodedUrlKey}">Loading…</div>
      <p class="halt-disclaimer" data-testid="dispatch-halt-disclaimer">This page can load slowly when Linear or the database is degraded. If it hasn't loaded, use <code>POST /api/proxy/dispatch/halt</code> directly. That needs a read-write proxy token, so mint one on the Proxy page before an incident. Only the workspace owner can halt or resume this way: the token must be one the owner minted on the Proxy page after this check shipped. A member's token is refused, and any other token (including an older Proxy-page token) is answered 409 &mdash; mint a new one, or use the controls on this page.</p>
      ${isOwner ? `
      <form class="dispatch-form halt-form" data-url-key="${encodedUrlKey}">
        <button type="button" class="action-btn halt-pause" data-testid="dispatch-halt-pause">Pause</button>
        <button type="button" class="action-btn halt-stop" data-testid="dispatch-halt-stop">Stop</button>
        <button type="button" class="action-btn halt-resume" data-testid="dispatch-halt-resume">Resume</button>
      </form>` : ''}` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-queue"', title: 'Queue', body: `<div class="queue-list" data-url-key="${encodedUrlKey}">
        <div class="queue-list-loading">Loading queue...</div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-tokens"', title: 'Tokens', body: `<p class="dispatch-runner-setup">Run on your own machine instead: <a href="/workspace/${encodedUrlKey}/runner" data-testid="dispatch-runner-setup-link">set up a runner \u203A</a></p>
      <div class="tree">
        <div class="node">
          <div class="line token-create">
            <span class="field-label">new token:</span>
            <form class="dispatch-form token-form" id="create-token-form" data-url-key="${encodedUrlKey}">
              <input type="text" name="label" class="token-label-input" maxlength="50" placeholder="Token label (optional)"${isOwner ? '' : ' disabled'}>
              <button type="submit" class="action-btn save"${isOwner ? '' : ' disabled'}>generate</button>
            </form>${isOwner ? '' : `
            <span class="field-hint" data-testid="dispatch-token-owner-only">only the workspace owner can make a queue token</span>`}
          </div>
        </div>
      </div>
      <p class="field-hint" data-testid="dispatch-keys-link-row">Queue tokens are listed with every other key, with their expiry, last use and Revoke: <a href="/workspace/${encodedUrlKey}/settings/agent-access" data-testid="dispatch-keys-link">Settings › Agent access \u203A</a></p>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-guide"', title: 'Integration Guide', body: `<p class="guide-summary">Build a consumer that polls for and processes dispatched prompts.</p>
      <div class="tree">
        <div class="node">
          <div class="line"><span class="guide-step">1.</span> <code class="guide-code">GET /api/dispatch/poll</code> <span class="guide-desc">— check for available items</span></div>
        </div>
        <div class="node">
          <div class="line"><span class="guide-step">2.</span> <code class="guide-code">POST /api/dispatch/take/:id</code> <span class="guide-desc">— atomically claim an item</span></div>
        </div>
        <div class="node">
          <div class="line"><span class="guide-step">3.</span> <code class="guide-code">POST /api/dispatch/feedback/:id</code> <span class="guide-desc">— report results back</span></div>
        </div>
      </div>
      <p class="guide-halt-note">A poll response may also carry a top-level <code>halt</code> key when an operator has requested a halt (see Workspace Halt above). The runner honors it: pause leaves fresh items, stop sweeps.</p>
      <p class="guide-link-line">
        <a href="https://github.com/JKershaw/LinearViewer/blob/main/docs/dispatch-integration.md" target="_blank" rel="noopener noreferrer" class="guide-link">Full integration guide →</a>
      </p>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', attrs: 'data-testid="dispatch-section-history"', title: 'History <button class="action-btn history-refresh">refresh</button>', body: `<div class="history-list" data-url-key="${encodedUrlKey}">
        <div class="history-list-loading">Loading history...</div>
      </div>` })}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by dispatch.js and app.js -->`
  });
}
