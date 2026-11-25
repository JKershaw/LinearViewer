/**
 * Harbour Library page shell (LIN-3344, Part A of LIN-3342).
 *
 * Formats the catalog `lib/library.js` builds into three documents in the
 * public frame (LIN-4567; the `/templates` pattern): the index (and its
 * results view when `?q=` is present) and a single document page. It derives
 * nothing — all metadata, HTML and search come from the catalog.
 *
 * Safety: every value interpolated here is escaped; document bodies are
 * pre-rendered and pre-escaped by `lib/library.js`. No page emits an external
 * script, so the route's CSP can pin the shell's one inline theme script by
 * hash (see `themePrepaintScriptHash`).
 */

import { escapeHtml } from './utils/html.js';
import { renderPublicFrame } from './components/frame.js';
import { canonicalTag, descriptionTag } from './components/head-meta.js';
import { GITHUB_TREE_BASE, htmlToText } from './library.js';
import { dirname, relative } from 'node:path';

const INTRO = 'Papers, essays and documents written while building Harbour.';

/** The way back from a search or a document: the Library's index. */
const BACK_TO_LIBRARY = Object.freeze({ href: '/library', label: 'Library' });

/**
 * LIN-4567 (LIN-4342 piece 6): every Library page sits in the public frame. The frame owns the page's one h1 (its own
 * name, no longer "Harbour"), the tab title (`<Page> · Harbour`), the way back and the footer every page shares. No page
 * passes a script, so the route's CSP still pins only the shell's inline theme script.
 */
function shell({ title, subtitle, back, headExtra, content }) {
  return renderPublicFrame({
    title,
    subtitle,
    back,
    stylesheets: ['/style.css', '/library.css'],
    bodyClass: 'is-landing',
    followSystemTheme: true,
    headExtra,
    content,
  });
}

/**
 * A rendered document's first `<h1>`, taken out: its text (the page's name in the frame) and the HTML without it. A
 * document that renders its own H1 would otherwise put a second h1 under the frame's. `null` text when there is none.
 * @param {string} html
 * @returns {{text: string|null, html: string}}
 */
export function takeFirstH1(html) {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/.exec(html);
  if (!match) return { text: null, html };
  return { text: htmlToText(match[1]).trim() || null, html: html.slice(0, match.index) + html.slice(match.index + match[0].length) };
}

function searchForm(query) {
  return `<form class="library-search" method="get" action="/library" role="search">
      <input type="search" name="q" value="${escapeHtml(query)}" placeholder="Search the Library" aria-label="Search the Library" autocomplete="off" data-testid="library-search-input">
      <button type="submit" data-testid="library-search-submit">Search</button>
    </form>`;
}

/**
 * The muted line under an entry's title: date · N min read · N figures, each
 * part omitted when absent rather than printed blank. Every part is derived
 * from the catalog (LIN-3350); nothing here is hand-maintained.
 */
function docItemMeta(doc) {
  const parts = [
    doc.date ? formatDate(doc.date) : null,
    `${doc.readingTime} min read`,
    doc.figureCount > 0 ? `${doc.figureCount} figure${doc.figureCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return `<p class="library-item__meta">${parts.map(escapeHtml).join(' · ')}</p>`;
}

function docListItem(doc) {
  return `<li class="library-item">
        <a class="library-item__link" href="/library/${escapeHtml(doc.slug)}" data-testid="library-item-link">${escapeHtml(doc.title)}</a>
        ${docItemMeta(doc)}
        ${doc.summary ? `<p class="library-item__summary">${escapeHtml(doc.summary)}</p>` : ''}
      </li>`;
}

function startHereList(catalog) {
  const items = catalog.startHere.map(item => {
    const href = item.href || (item.doc ? `/library/${item.doc.slug}` : null);
    if (!href) return '';
    const title = item.doc ? item.doc.title : item.title;
    return `<li class="library-start__item">
        <a href="${escapeHtml(href)}">${escapeHtml(title)}</a>
        <span class="library-start__note">${escapeHtml(item.note)}</span>
      </li>`;
  }).filter(Boolean).join('\n      ');
  return `<ol class="library-start">
      ${items}
    </ol>`;
}

/**
 * Render the Library index, or its results view when a query is supplied.
 *
 * @param {Object} catalog - from `loadLibrary()`
 * @param {Object} [opts]
 * @param {string} [opts.query] - raw search query
 * @param {string} [opts.canonicalUrl] - absolute canonical URL for the page
 * @returns {string} complete HTML document
 */
export function renderLibraryIndex(catalog, { query = '', canonicalUrl = '' } = {}) {
  const q = String(query || '');
  const searching = q.trim() !== '';

  if (searching) {
    const { results } = catalog.search(q);
    const resultsHtml = results.length
      ? `<ul class="library-results">
      ${results.map(r => `<li class="library-result">
        <a class="library-result__link" href="/library/${escapeHtml(r.doc.slug)}" data-testid="library-result-link">${escapeHtml(r.doc.title)}</a>
        <p class="library-result__snippet">${r.snippet}</p>
      </li>`).join('\n      ')}
    </ul>`
      : '<p class="library-empty">No documents match that search.</p>';
    return shell({
      title: 'Library search',
      back: BACK_TO_LIBRARY,
      headExtra: `<meta name="robots" content="noindex">\n  ${descriptionTag('Search results in the Harbour Library.')}`,
      content: `<div class="library">
    ${searchForm(q)}
    <p class="library-count">${results.length} ${results.length === 1 ? 'result' : 'results'} for “${escapeHtml(q)}”.</p>
    ${resultsHtml}
  </div>`,
    });
  }

  const archiveHtml = catalog.archiveEditions.length
    ? `<section class="library-section">
      <h2>Archive editions</h2>
      <ul class="library-list">
        ${catalog.archiveEditions.map(e => `<li class="library-item"><a class="library-item__link" href="/archive/${e.n}">${escapeHtml(e.title)}</a></li>`).join('\n        ')}
      </ul>
    </section>`
    : '';

  return shell({
    title: 'Library',
    subtitle: INTRO,
    headExtra: `${descriptionTag(INTRO)}\n  ${canonicalTag(canonicalUrl)}`,
    content: `<div class="library">
    ${searchForm('')}

    <section class="library-section">
      <h2>Start here</h2>
      ${startHereList(catalog)}
    </section>

    ${shelfSection('Essays', catalog.essays)}
    ${shelfSection('Papers', catalog.papers)}
    ${shelfSection('Other documents', catalog.listed)}
    ${archiveHtml}
  </div>`,
  });
}

/** A titled shelf of document entries, or nothing at all when it is empty. */
function shelfSection(title, docs) {
  if (!docs.length) return '';
  return `<section class="library-section">
      <h2>${escapeHtml(title)}</h2>
      <ul class="library-list">
        ${docs.map(docListItem).join('\n        ')}
      </ul>
    </section>`.trim();
}

/** The next Start-here item after `doc`, or null. */
function nextStartHere(catalog, doc) {
  const index = catalog.startHere.findIndex(item => item.doc && item.doc.slug === doc.slug);
  if (index === -1 || index + 1 >= catalog.startHere.length) return null;
  const next = catalog.startHere[index + 1];
  return { href: next.href || `/library/${next.doc.slug}`, title: next.doc ? next.doc.title : next.title };
}

/**
 * Render one Library document page.
 *
 * @param {Object} doc - a catalog document
 * @param {Object} catalog - from `loadLibrary()`
 * @param {Object} [opts]
 * @param {string} [opts.canonicalUrl]
 * @returns {string} complete HTML document
 */
export function renderLibraryDoc(doc, catalog, { canonicalUrl = '' } = {}) {
  const bylineParts = [
    doc.date ? formatDate(doc.date) : null,
    `${doc.readingTime} min read`,
    doc.author || null,
  ].filter(Boolean);
  const byline = bylineParts.join(' · ');

  const next = nextStartHere(catalog, doc);
  const backlinks = catalog.backlinksFor(doc.slug);
  const sourceRel = relative(catalog.repoRoot, doc.sourcePath).split('\\').join('/');
  // The GitHub link points at the document's folder, not the file, so the
  // reader lands among its versions, checks and data (LIN-3350).
  const sourceDir = dirname(sourceRel).split('\\').join('/');

  const footerBits = [];
  if (next) {
    footerBits.push(`<p class="library-next">Next in Start here: <a href="${escapeHtml(next.href)}">${escapeHtml(next.title)}</a></p>`);
  }
  if (backlinks.length) {
    footerBits.push(`<p class="library-linked-from">Linked from ${backlinks.map(b => `<a href="/library/${escapeHtml(b.slug)}">${escapeHtml(b.title)}</a>`).join(', ')}.</p>`);
  }
  footerBits.push(`<p class="library-markdown"><a href="/library/${escapeHtml(doc.slug)}.md" data-testid="library-markdown-link">View as Markdown</a></p>`);
  footerBits.push(`<p class="library-source"><a href="${escapeHtml(GITHUB_TREE_BASE + sourceDir)}" rel="noopener noreferrer">View source on GitHub</a></p>`);

  // The leading-H1 rule (LIN-3344), now in the frame (LIN-4567): the page's name is the frame's one h1 and the byline
  // is its subtitle, so the title never renders twice. A document whose body renders its own H1 gives the page that
  // heading's words (what the reader always saw there), and the body loses it; a body with no H1 is named by its title.
  // `doc.hasBodyH1` is "has an H1" rather than "leads with an H1" because `fleet-complexity-read` opens with an
  // attribution blockquote before its H1 (lib/library.js).
  const body = doc.hasBodyH1 ? takeFirstH1(doc.html) : { text: null, html: doc.html };

  return shell({
    title: body.text || doc.title,
    subtitle: byline,
    back: BACK_TO_LIBRARY,
    headExtra: `${descriptionTag(doc.summary)}\n  ${canonicalTag(canonicalUrl)}`,
    content: `<div class="library library--doc">
    <article class="library-doc">
      <aside class="library-doc__aside">
        ${footerBits.join('\n        ')}
      </aside>
      <div class="library-doc__body">
        ${body.html}
      </div>
    </article>
  </div>`,
  });
}

/** `2026-09-30` → `30 September 2026` (the byline's human form). */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
