/**
 * "The Ship's Biscuit" page renderer (experimental, LIN-818, V1).
 *
 * The standalone newspaper page on the shared shell (renderPage / renderNavBar /
 * renderPageHeader / renderPageFooter / renderSection): a masthead + dateline, a
 * Generate control, and a newspaper front-page hierarchy (LIN-1198) — a lead story
 * (headline + optional standfirst + lede), then weighted section columns over the
 * existing DESKS, then lower-prominence stubs. Index headlines are clickable but
 * INERT in V1 — the on-demand article-body pass is deferred to V2. Clicking a
 * headline surfaces a "coming in a later edition" note rather than loading a body
 * (public/ship-biscuit.js). The lead headline is inert plain text, not a link.
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

/**
 * Weight at/above which an index stub earns a place in the weighted section columns;
 * below it a stub drops to the lower-prominence "In brief" list. Kept in lockstep with
 * the client mirror in public/ship-biscuit.js (COLUMN_WEIGHT_FLOOR).
 */
const COLUMN_WEIGHT_FLOOR = 3;

/**
 * Canonical desk order (mirrors DESKS in lib/ship-biscuit.js) — the tie-break for
 * columns of equal weight, so column order is deterministic across builds and matches
 * the client. Unknown sections sort last.
 */
const DESK_ORDER = ['Front Page', 'The Wire', 'Deep Dive', 'The Column', 'Weather'];

/** Format an ISO instant as a human dateline; tolerant of bad input. */
function formatDateline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toUTCString().replace(/ GMT$/, ' UTC');
}

/**
 * Partition an edition's index into weighted section columns + lower-prominence stubs.
 * PURE and deterministic; this exact logic is mirrored in public/ship-biscuit.js so the
 * server first-paint and the client post-generate render produce the same shape.
 *
 *  - Column tier: stubs with weight ≥ COLUMN_WEIGHT_FLOOR, grouped by section/desk.
 *    Columns are ordered heaviest-first (max stub weight), DESK_ORDER breaking ties.
 *    Within a column, stubs are ordered by descending weight.
 *  - Stub tier: the remaining low-weight stubs, kept in their incoming (weight-desc) order.
 *
 * @param {Array} index - edition.index (article stubs).
 * @returns {{ columns: Array<{section: string, weight: number, stubs: Array}>, stubs: Array }}
 */
export function layoutIndex(index) {
  const items = Array.isArray(index) ? index.filter(s => s && typeof s === 'object') : [];
  const weightOf = (s) => (Number.isFinite(Number(s.weight)) ? Number(s.weight) : 0);
  const deskRank = (section) => {
    const i = DESK_ORDER.indexOf(section);
    return i === -1 ? DESK_ORDER.length : i;
  };

  const bySection = new Map();
  const stubs = [];
  for (const s of items) {
    if (weightOf(s) >= COLUMN_WEIGHT_FLOOR) {
      const key = s.section || 'The Wire';
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(s);
    } else {
      stubs.push(s);
    }
  }

  const columns = [];
  for (const [section, colStubs] of bySection) {
    colStubs.sort((a, b) => weightOf(b) - weightOf(a));
    const weight = colStubs.reduce((m, s) => Math.max(m, weightOf(s)), 0);
    columns.push({ section, weight, stubs: colStubs });
  }
  columns.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const ra = deskRank(a.section);
    const rb = deskRank(b.section);
    if (ra !== rb) return ra - rb;
    return a.section < b.section ? -1 : a.section > b.section ? 1 : 0;
  });

  return { columns, stubs };
}

/**
 * Server-render one edition's body (lead story → weighted section columns → stubs) into
 * HTML. Mirrors the shape public/ship-biscuit.js builds client-side after a Generate, so
 * first paint and post-generate render match (LIN-1198).
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
  const headline = escapeHtml(edition.frontPage?.headline || '');
  const standfirst = escapeHtml(edition.frontPage?.standfirst || '');
  const lede = escapeHtml(edition.frontPage?.lede || '');

  // Lead story: dateline, the catchy lead headline (inert), an optional standfirst, then
  // the lede. Each line is tolerated-absent so a headline-only edition still renders.
  const leadHtml = `<header class="ship-biscuit-lead" data-testid="ship-biscuit-lead">
      <p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">${escapeHtml(dateline)}${windowLabel ? ` · ${windowLabel}` : ''}</p>
      ${headline ? `<h2 class="ship-biscuit-lead-headline" data-testid="ship-biscuit-lead-headline">${headline}</h2>` : ''}
      ${standfirst ? `<p class="ship-biscuit-standfirst" data-testid="ship-biscuit-standfirst">${standfirst}</p>` : ''}
      ${lede ? `<p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">${lede}</p>` : ''}
    </header>`;

  const { columns, stubs } = layoutIndex(edition.index);

  let bodyHtml;
  if (edition.isQuiet || (columns.length === 0 && stubs.length === 0)) {
    bodyHtml = `<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>`;
  } else {
    const columnsHtml = columns.map((col) => {
      const section = escapeHtml(col.section || '');
      const weight = Math.max(1, Math.round(col.weight || 1));
      const articles = col.stubs.map((stub) => renderColumnArticle(stub)).join('');
      return `<section class="ship-biscuit-column" data-section="${section}" style="--ship-biscuit-col-weight:${weight}">
        <h3 class="ship-biscuit-column-title">${section}</h3>
        <ul class="ship-biscuit-column-list">${articles}</ul>
      </section>`;
    }).join('');
    const columnsBlock = columns.length
      ? `<div class="ship-biscuit-columns" data-testid="ship-biscuit-columns">${columnsHtml}</div>`
      : '';

    const stubsHtml = stubs.map((stub) => renderStubArticle(stub)).join('');
    const stubsBlock = stubs.length
      ? `<ul class="ship-biscuit-stubs" data-testid="ship-biscuit-stubs">${stubsHtml}</ul>`
      : '';

    bodyHtml = `${columnsBlock}${stubsBlock}`;
  }

  return `${leadHtml}
    <div class="ship-biscuit-articles">${bodyHtml}</div>`;
}

/** One article inside a weighted section column: headline (inert link) + optional dek. */
function renderColumnArticle(stub) {
  const headline = escapeHtml(stub.headline || '');
  const dek = escapeHtml(stub.dek || '');
  const id = escapeHtml(stub.id || '');
  const weight = Math.max(1, Math.round(Number(stub.weight) || 1));
  return `<li class="ship-biscuit-article" data-article-id="${id}" data-weight="${weight}">
        <a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="${id}">${headline}</a>
        ${dek ? `<p class="ship-biscuit-dek">${dek}</p>` : ''}
      </li>`;
}

/** One lower-prominence stub: keeps its section kicker since it is not column-grouped. */
function renderStubArticle(stub) {
  const section = escapeHtml(stub.section || '');
  const headline = escapeHtml(stub.headline || '');
  const dek = escapeHtml(stub.dek || '');
  const id = escapeHtml(stub.id || '');
  const weight = Math.max(1, Math.round(Number(stub.weight) || 1));
  return `<li class="ship-biscuit-article ship-biscuit-stub" data-article-id="${id}" data-weight="${weight}">
        <span class="ship-biscuit-section">${section}</span>
        <a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="${id}">${headline}</a>
        ${dek ? `<p class="ship-biscuit-dek">${dek}</p>` : ''}
      </li>`;
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
