/**
 * "The Ship's Biscuit" page renderer (experimental, LIN-818, V1).
 *
 * The standalone newspaper page on the shared shell (renderPage / renderNavBar /
 * renderPageHeader / renderPageFooter / renderSection): a masthead + dateline, a
 * Generate control, a front-page hero (the synthesised lede), and an index of
 * article stubs whose headlines are clickable but INERT in V1 — the on-demand
 * article-body pass is deferred to V2. Clicking a headline surfaces a "coming in a
 * later edition" note rather than loading a body (public/ship-biscuit.js).
 *
 * The server renders the latest durable edition (if any) for a good first paint and
 * so a returning reader sees the last edition without regenerating; the client
 * re-renders the same shape into `#ship-biscuit-edition` after a Generate. Business
 * logic (fetch/build/generate) lives in the route + libs, not here.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';

const MASTHEAD = "The Ship's Biscuit";

/** Format an ISO instant as a human dateline; tolerant of bad input. */
function formatDateline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toUTCString().replace(/ GMT$/, ' UTC');
}

/**
 * Server-render one edition's body (front page hero + index) into HTML. Mirrors the
 * shape public/ship-biscuit.js builds client-side after a Generate, so first paint
 * and post-generate render match.
 *
 * @param {Object|null} edition - EditionRecord from the store (or null → empty).
 * @returns {string}
 */
export function renderEditionHtml(edition) {
  if (!edition) {
    return renderEmptyState({
      tag: 'p',
      className: 'ship-biscuit-empty',
      id: 'ship-biscuit-empty',
      text: '○ no edition yet — press "run the presses" to generate the front page'
    });
  }

  const dateline = formatDateline(edition.generatedAt);
  const windowLabel = edition.window ? `the last ${escapeHtml(edition.window)}` : '';
  const lede = escapeHtml(edition.frontPage?.lede || '');

  const heroHtml = `<header class="ship-biscuit-hero" data-testid="ship-biscuit-hero">
      <p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">${escapeHtml(dateline)}${windowLabel ? ` · ${windowLabel}` : ''}</p>
      <p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">${lede}</p>
    </header>`;

  let indexHtml;
  if (edition.isQuiet || !Array.isArray(edition.index) || edition.index.length === 0) {
    indexHtml = `<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>`;
  } else {
    const items = edition.index.map((stub) => {
      const section = escapeHtml(stub.section || '');
      const headline = escapeHtml(stub.headline || '');
      const dek = escapeHtml(stub.dek || '');
      const id = escapeHtml(stub.id || '');
      return `<li class="ship-biscuit-article" data-article-id="${id}">
        <span class="ship-biscuit-section">${section}</span>
        <a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="${id}">${headline}</a>
        ${dek ? `<p class="ship-biscuit-dek">${dek}</p>` : ''}
      </li>`;
    }).join('');
    indexHtml = `<ul class="ship-biscuit-index" data-testid="ship-biscuit-index">${items}</ul>`;
  }

  return `${heroHtml}
    <div class="ship-biscuit-articles">${indexHtml}</div>`;
}

/**
 * @param {Object} data
 * @param {Object|null} [data.edition] - The latest durable edition to render on first paint.
 * @param {boolean} [data.aiConfigured]
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderShipBiscuitPage(data = {}, options = {}) {
  const { edition = null, aiConfigured = true } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'ship-biscuit', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/ship-biscuit', urlKey, openRouterSource, featureFlags });

  const encodedUrlKey = escapeHtml(urlKey || '');
  const shipBiscuitData = { urlKey: urlKey || '' };

  const aiWarning = aiConfigured
    ? ''
    : `<p class="ship-biscuit-warning" data-ai-unconfigured>⚠ AI is not configured on the server (connect OpenRouter in settings or set <code>OPENROUTER_API_KEY</code>). Running the presses needs it.</p>`;

  const setupBody = `<div class="tree">
        <p class="ship-biscuit-experimental">⚗ Experimental — a light newspaper of what your autopilot has been up to. Running the presses builds one deterministic edition (a front page + an index of headlines); the article bodies come later, on demand.</p>
        ${aiWarning}
        <div class="ship-biscuit-actions">
          <label class="ship-biscuit-window-label">window
            <select id="ship-biscuit-window" class="ship-biscuit-window">
              <option value="day">day</option>
              <option value="week" selected>week</option>
              <option value="month">month</option>
            </select>
          </label>
          <button type="button" id="ship-biscuit-generate" class="action-btn save" data-testid="ship-biscuit-generate">run the presses</button>
          <span class="ship-biscuit-feedback" id="ship-biscuit-feedback"></span>
        </div>
      </div>`;

  const editionBody = `<div class="ship-biscuit-edition" id="ship-biscuit-edition" data-testid="ship-biscuit-edition">
        ${renderEditionHtml(edition)}
      </div>`;

  return renderPage({
    title: "The Ship's Biscuit - Experimental",
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/ship-biscuit.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__SHIP_BISCUIT_DATA__', value: shipBiscuitData },
    scripts: ['/common.js', '/ship-biscuit.js'],
    content: `<main class="ship-biscuit-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: MASTHEAD, subtitle: 'An LLM-set newspaper of your autopilot, printed on demand.' })}

    ${renderSection({ boxed: true, className: 'ship-biscuit-section ship-biscuit-setup', titleClass: 'section-header', title: 'Run the presses', body: setupBody })}

    ${renderSection({ boxed: true, className: 'ship-biscuit-section ship-biscuit-live', titleClass: 'section-header', title: 'Front page', body: editionBody })}
  </main>
  ${footerHtml}`,
  });
}
