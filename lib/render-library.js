/**
 * Harbour Library page shell (LIN-3344, Part A of LIN-3342).
 *
 * Formats the catalog `lib/library.js` builds into three documents on the
 * shared `is-landing` shell (the `/templates` pattern): the index (and its
 * results view when `?q=` is present) and a single document page. It derives
 * nothing — all metadata, HTML and search come from the catalog.
 *
 * Safety: every value interpolated here is escaped; document bodies are
 * pre-rendered and pre-escaped by `lib/library.js`. No page emits an external
 * script, so the route's CSP can pin the shell's one inline theme script by
 * hash (see `themePrepaintScriptHash`).
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderPageHeader } from './components/page-header.js';
import { GITHUB_TREE_BASE } from './library.js';
import { dirname, relative } from 'node:path';

const INTRO = 'Papers, essays and documents written while building Harbour.';

function canonicalTag(canonicalUrl) {
  return canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : '';
}

function descriptionTag(summary) {
  return summary ? `<meta name="description" content="${escapeHtml(summary)}">` : '';
}

function shell({ title, headExtra, content }) {
  return renderPage({
    title,
    stylesheets: ['/style.css', '/library.css'],
    bodyClass: 'is-landing',
    headExtra,
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
${content}
  ${renderPageFooter({ isLanding: true, currentPage: '/library' })}`,
  });
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
      title: 'Search - Harbour Library',
      headExtra: `<meta name="robots" content="noindex">\n  ${descriptionTag('Search results in the Harbour Library.')}`,
      content: `<main class="library">
    ${searchForm(q)}
    <p class="library-count">${results.length} ${results.length === 1 ? 'result' : 'results'} for “${escapeHtml(q)}”.</p>
    ${resultsHtml}
  </main>`,
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
    title: 'Library - Harbour',
    headExtra: `${descriptionTag(INTRO)}\n  ${canonicalTag(canonicalUrl)}`,
    content: `<main class="library">
    <p class="library-intro">${escapeHtml(INTRO)}</p>
    ${searchForm('')}

    <section class="library-section">
      <h2>Start here</h2>
      ${startHereList(catalog)}
    </section>

    ${shelfSection('Essays', catalog.essays)}
    ${shelfSection('Papers', catalog.papers)}
    ${shelfSection('Other documents', catalog.listed)}
    ${archiveHtml}
  </main>`,
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
  const byline = bylineParts.map(escapeHtml).join(' · ');

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

  // The plan's leading-H1 rule: when the document body renders its own H1 that
  // heading is the page title and the byline goes directly under it, so the
  // title never renders twice. Only a body with no H1 at all gets a synthesized
  // header. `doc.hasBodyH1` and the `data-testid` on that body H1 are set in
  // `lib/library.js`; it is "has an H1" rather than "leads with an H1" because
  // `fleet-complexity-read` opens with an attribution blockquote before its H1.
  const bylineHtml = `<p class="library-doc__byline">${byline}</p>`;
  const header = doc.hasBodyH1
    ? ''
    : `      <header class="library-doc__header">
        <h1 data-testid="library-doc-title">${escapeHtml(doc.title)}</h1>
        ${bylineHtml}
      </header>
`;
  const bodyHtml = doc.hasBodyH1
    ? doc.html.replace('</h1>', () => `</h1>\n        ${bylineHtml}`)
    : doc.html;

  return shell({
    title: `${escapeHtml(doc.title)} - Harbour Library`,
    headExtra: `${descriptionTag(doc.summary)}\n  ${canonicalTag(canonicalUrl)}`,
    content: `<main class="library library--doc">
    <nav class="library-doc__back"><a href="/library" data-testid="library-back-link">← Library</a></nav>
    <article class="library-doc">
      <aside class="library-doc__aside">
        ${footerBits.join('\n        ')}
      </aside>
${header}      <div class="library-doc__body">
        ${bodyHtml}
      </div>
    </article>
  </main>`,
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
