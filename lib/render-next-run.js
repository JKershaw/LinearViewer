/**
 * Suggested Next Run page renderer (experimental, LIN-603).
 *
 * Renders the experimental "suggest the next autopilot run" shell: a Generate
 * button asks an LLM (grounded in the workspace roadmap model + in-progress work
 * + the top of the execution queue) for 1–N candidate goal options, each with
 * reasoning and a t-shirt size — plus an always-present "continue until stopped"
 * option (empty goal). Accepting an option hands its goal paragraph to the
 * existing dispatch launch path (the dispatch page goal field), reusing
 * buildAutopilotKickoff — this page invents no new run mechanism.
 *
 * Zero business logic here — generation (SSE/JSON) and card rendering live in
 * public/next-run.{css,js}. The page is provider-free; the suggest endpoint
 * fetches the workspace data on demand.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';

/**
 * @param {Object} data
 * @param {boolean} [data.aiConfigured] - Whether an OpenRouter key is available.
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @param {boolean} [options.isLocalhost] - Whether to offer the `local`/harbour dispatch target.
 * @returns {string} Complete HTML document.
 */
export function renderNextRunPage(data = {}, options = {}) {
  const { aiConfigured = true } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
    isLocalhost = false,
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'next-run', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/next-run', urlKey, openRouterSource, featureFlags });

  // proxyEnabled drives whether the client offers inline `Dispatch ▾` options
  // (the goal kickoff is built via /api/autopilot-prompt, which is proxy-gated);
  // when off, the client keeps the navigate-to-/dispatch?goal= fallback (LIN-640).
  const nextRunData = {
    urlKey: urlKey || '',
    proxyEnabled: featureFlags.proxy === true,
    isLocalhost: !!isLocalhost,
  };
  const encodedUrlKey = escapeHtml(urlKey || '');

  const aiWarning = aiConfigured
    ? ''
    : `<p class="next-run-warning" data-ai-unconfigured>⚠ AI is not configured on the server (connect OpenRouter in settings or set <code>OPENROUTER_API_KEY</code>). Generating suggestions needs it.</p>`;

  const setupBody = `<div class="tree">
        <p class="next-run-experimental">⚗ Experimental — generate grounded goal options for the next autopilot run. Each option is a goal paragraph with reasoning and a t-shirt size; one option is always "continue until stopped" (an open-ended stack walk).</p>
        ${aiWarning}
        <div class="next-run-actions">
          <button type="button" id="next-run-generate" class="action-btn save">generate suggestions</button>
          <span class="next-run-feedback" id="next-run-feedback"></span>
        </div>
      </div>`;

  // Deterministic intro paragraph above the options (LIN-638), then the model's
  // global think-first reasoning preamble (LIN-642 — the "how I chose", distinct
  // from each card's per-option "why this one"). Both hidden until a generation
  // returns; filled by next-run.js from the suggest response `summary`/`analysis`.
  const optionsBody = `<p class="next-run-summary" id="next-run-summary" hidden></p>
      <section class="next-run-analysis" id="next-run-analysis" hidden>
        <span class="next-run-analysis-label">analysis</span>
        <p class="next-run-analysis-body" id="next-run-analysis-body"></p>
      </section>
      <ul class="next-run-options" id="next-run-options"></ul>
      ${renderEmptyState({ tag: 'p', className: 'next-run-empty', id: 'next-run-empty', text: '○ click "generate suggestions" to get grounded goal options for the next run' })}`;

  // Page-level expandable panel showing the exact deterministic grounding blob the
  // model was given (LIN-633). One shared context per generation — NOT per-option.
  // Hidden until a generation returns; the body is filled + toggled by next-run.js
  // (which replicates the Observation caret/collapse pattern without importing
  // observation.js). Markup reuses obs-* classes from /observation.css.
  const contextBody = `<button type="button" class="next-run-context-toggle" id="next-run-context-toggle" aria-expanded="false" aria-controls="next-run-context-body">
        <span class="obs-session-caret next-run-context-caret" aria-hidden="true">▸</span>
        <span class="next-run-context-label">context the suggestions were grounded in</span>
      </button>
      <pre class="obs-session-body next-run-context-body" id="next-run-context-body" hidden></pre>`;

  return renderPage({
    title: 'Suggested Next Run - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/next-run.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__NEXT_RUN_DATA__', value: nextRunData },
    scripts: ['/common.js', '/next-run.js'],
    content: `<main class="next-run-page" data-url-key="${encodedUrlKey}">
    <header class="next-run-header">
      <h1>Suggested Next Run</h1>
      <p class="next-run-subtitle">Let the project propose where autopilot should go next.</p>
    </header>

    ${renderSection({ boxed: true, className: 'next-run-section next-run-setup', titleClass: 'section-header', title: 'Generate', body: setupBody })}

    ${renderSection({ boxed: true, className: 'next-run-section next-run-live', titleClass: 'section-header', title: 'Options', body: optionsBody })}

    ${renderSection({ boxed: true, className: 'next-run-section next-run-context-section', titleClass: 'section-header', title: 'Context', body: contextBody, attrs: 'id="next-run-context-section" hidden' })}
  </main>
  ${footerHtml}`,
  });
}
