/**
 * "The Ship's Biscuit" page renderer (experimental, LIN-818, V1).
 *
 * The standalone newspaper page on the shared shell (renderPage / renderNavBar /
 * renderPageHeader / renderPageFooter / renderSection): a masthead + dateline, a
 * Generate control, and a newspaper-style front page (LIN-1198, Theme B) — a lead
 * story (headline + optional standfirst/dek + lede), then weighted section blocks,
 * then lower-prominence stubs — whose headlines are clickable but INERT in V1 (the
 * on-demand article-body pass is deferred to V2). Clicking a stub headline surfaces a
 * "coming in a later edition" note rather than loading a body (public/ship-biscuit.js).
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

// Newspaper hierarchy split (LIN-1198, Theme B). The editor's index arrives already
// sorted by descending weight (1-5). Items above STUB_WEIGHT_MAX become prominent
// "weighted section" blocks; the rest render as compact lower-prominence stubs beneath
// them. The client renderer (public/ship-biscuit.js) MUST replicate this exact split
// and the prominence mapping so first paint and post-generate render match.
const STUB_WEIGHT_MAX = 2;

/**
 * Map an item's weight (1-5) to a prominence tier for the weighted-section blocks.
 * Higher weight → more prominent. Pure; tolerant of bad input.
 * @param {number} weight
 * @returns {'high'|'medium'|'standard'}
 */
export function prominenceForWeight(weight) {
  const w = Number(weight) || 0;
  if (w >= 5) return 'high';
  if (w >= 4) return 'medium';
  return 'standard';
}

/**
 * Partition a weight-sorted edition index into prominent weighted-section items and
 * lower-prominence stubs, preserving the incoming (descending-weight) order. The client
 * renderer replicates this so both sides render the same three-tier hierarchy.
 * @param {Array} index
 * @returns {{ weighted: Array, stubs: Array }}
 */
export function partitionEditionIndex(index) {
  const items = Array.isArray(index) ? index : [];
  const weighted = items.filter((s) => (Number(s?.weight) || 0) > STUB_WEIGHT_MAX);
  const stubs = items.filter((s) => (Number(s?.weight) || 0) <= STUB_WEIGHT_MAX);
  return { weighted, stubs };
}

/** Format an ISO instant as a human dateline; tolerant of bad input. */
function formatDateline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toUTCString().replace(/ GMT$/, ' UTC');
}

/**
 * Shared inner markup for an index item (weighted block OR stub): the section label, the
 * INERT clickable headline link, and an optional dek. The `.ship-biscuit-headline` link
 * and enclosing `.ship-biscuit-article` are the click seam the client's inert-note
 * handler keys off, so both tiers carry them identically.
 */
function renderArticleInner(stub) {
  const section = escapeHtml(stub.section || '');
  const headline = escapeHtml(stub.headline || '');
  const dek = escapeHtml(stub.dek || '');
  const id = escapeHtml(stub.id || '');
  return `<span class="ship-biscuit-section">${section}</span>
        <a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="${id}">${headline}</a>
        ${dek ? `<p class="ship-biscuit-dek">${dek}</p>` : ''}`;
}

/** A prominent weighted-section block, carrying the weight + prominence hooks. */
function renderWeightedArticle(stub) {
  const id = escapeHtml(stub.id || '');
  const section = escapeHtml(stub.section || '');
  const weight = Number(stub.weight) || 0;
  const prominence = prominenceForWeight(weight);
  return `<article class="ship-biscuit-article ship-biscuit-weighted" data-testid="ship-biscuit-weighted-section" data-article-id="${id}" data-section="${section}" data-weight="${weight}" data-prominence="${prominence}">
        ${renderArticleInner(stub)}
      </article>`;
}

/** A compact lower-prominence stub. */
function renderStubArticle(stub) {
  const id = escapeHtml(stub.id || '');
  const section = escapeHtml(stub.section || '');
  const weight = Number(stub.weight) || 0;
  return `<li class="ship-biscuit-article ship-biscuit-stub" data-testid="ship-biscuit-stub" data-article-id="${id}" data-section="${section}" data-weight="${weight}">
        ${renderArticleInner(stub)}
      </li>`;
}

/**
 * Server-render one edition's body into the newspaper hierarchy (LIN-1198, Theme B):
 * a lead story (headline + optional standfirst/dek + lede), weighted section blocks,
 * then lower-prominence stubs. Mirrors the shape public/ship-biscuit.js builds
 * client-side after a Generate, so first paint and post-generate render match.
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
  const fp = edition.frontPage || {};
  const headline = escapeHtml(fp.headline || '');
  const standfirst = escapeHtml(fp.standfirst || '');
  const lede = escapeHtml(fp.lede || '');

  // Lead story: the headline (an <h2>, distinct from the <h1> masthead and inert — no
  // link) over the optional standfirst/dek, then the lede. Standfirst is omitted
  // entirely when absent (no empty node), so the client can match the shape exactly.
  const leadStoryHtml = `<header class="ship-biscuit-hero ship-biscuit-lead-story" data-testid="ship-biscuit-lead-story">
      <p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">${escapeHtml(dateline)}${windowLabel ? ` · ${windowLabel}` : ''}</p>
      ${headline ? `<h2 class="ship-biscuit-lead-headline" data-testid="ship-biscuit-lead-headline">${headline}</h2>` : ''}
      ${standfirst ? `<p class="ship-biscuit-standfirst" data-testid="ship-biscuit-standfirst">${standfirst}</p>` : ''}
      <p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">${lede}</p>
    </header>`;

  let indexHtml;
  if (edition.isQuiet || !Array.isArray(edition.index) || edition.index.length === 0) {
    indexHtml = `<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>`;
  } else {
    const { weighted, stubs } = partitionEditionIndex(edition.index);
    const weightedHtml = weighted.map(renderWeightedArticle).join('');
    const stubsHtml = stubs.map(renderStubArticle).join('');
    indexHtml = `<div class="ship-biscuit-sections" data-testid="ship-biscuit-sections">${weightedHtml}</div>`
      + `<ul class="ship-biscuit-stubs" data-testid="ship-biscuit-stubs">${stubsHtml}</ul>`;
  }

  return `${leadStoryHtml}
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

    ${renderSection({ boxed: true, className: 'ship-biscuit-setup', titleClass: 'section-header', title: 'Run the presses', body: setupBody })}

    ${renderSection({ boxed: true, className: 'ship-biscuit-live', titleClass: 'section-header', title: 'Front page', body: editionBody })}
  </main>
  ${footerHtml}`,
  });
}
