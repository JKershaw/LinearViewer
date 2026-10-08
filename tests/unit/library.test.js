/**
 * LIN-3344 — lib/library.js catalog + routes/library.js (Part A of LIN-3342).
 *
 * Hermetic: reads the real `docs/` tree and a loopback test server only. The
 * acceptance witnesses are the exhaustive ones — every catalogued document must
 * resolve metadata and serve both a page and its verbatim `.md`.
 *
 * Run with: node --test tests/unit/library.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadLibrary, GITHUB_BASE, DEFAULT_DOCS_ROOT } from '../../lib/library.js';
import { createLibraryRouter, escapeXml, sitemapEntries } from '../../routes/library.js';
import { LISTED_DOCS, START_HERE } from '../../lib/library-metadata.js';
import { themeSvg, THEME_MARKER, DARK_PALETTE, LIGHT_ONLY } from '../../scripts/lib/figure-theme.mjs';
import { listFigures, FIGURES_DIR } from '../../scripts/figure-theme.mjs';

const docsRoot = DEFAULT_DOCS_ROOT;
const papersDir = join(docsRoot, 'papers', 'harbour');
const catalog = loadLibrary(docsRoot);

const papersOnDisk = readdirSync(papersDir).filter(f => f.endsWith('.md'));

let server;
let base;

before(async () => {
  const app = express();
  app.use(createLibraryRouter({ docsRoot }));
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

async function get(path) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return res;
}

describe('library catalog', () => {
  test('every papers file on disk and the 14 listed docs is catalogued and served', () => {
    assert.equal(catalog.docs.length, papersOnDisk.length + LISTED_DOCS.length,
      'one catalog entry per .md file plus the listed docs');
    assert.equal(catalog.listed.length, LISTED_DOCS.length, 'all 14 listed docs resolve');
  });

  test('shelf membership comes from the document front matter kind (allow-list)', () => {
    // Every shelf entry declares a shelf kind; nothing else is shelved.
    assert.ok(catalog.essays.length > 0, 'essays shelf is non-empty');
    assert.ok(catalog.papers.length > 0, 'papers shelf is non-empty');
    for (const doc of catalog.essays) assert.equal(doc.docKind, 'essay', `${doc.slug}: docKind essay`);
    for (const doc of catalog.papers) assert.equal(doc.docKind, 'paper', `${doc.slug}: docKind paper`);

    // Every papers-folder document is either on a shelf or off it for a reason
    // its own kind states — never for its location or name.
    const shelved = new Set([...catalog.essays, ...catalog.papers].map(d => d.slug));
    const offShelf = catalog.docs.filter(d => d.kind === 'paper' && !shelved.has(d.slug));
    assert.ok(offShelf.length > 0, 'there are off-shelf documents');
    const shelfKinds = new Set(['essay', 'paper']);
    for (const doc of offShelf) {
      assert.ok(!shelfKinds.has(doc.docKind), `${doc.slug}: off-shelf for a non-shelf kind (${doc.docKind})`);
    }
    // The expected off-shelf set: 19 checks, the pre-registration, the data appendix.
    assert.equal(offShelf.length, 21, 'exactly the 21 non-shelf documents are off the shelves');
    for (const slug of [
      'survey-check', 'survey-check-7', 'steady-base-check', 'paid-where-written-check',
      'learning-while-the-tools-change-check', 'between-the-sessions-check',
      'what-should-an-agent-leave-behind-check', 'coherence-as-it-grows-check',
      'replay-small-work-preregistration', 'what-should-an-agent-leave-behind-evidence',
    ]) {
      assert.ok(offShelf.some(d => d.slug === slug), `${slug} is off-shelf`);
    }
    // A paper whose name looks like a check stays on the shelf (kind is truth).
    assert.ok(catalog.papers.some(d => d.slug === 'what-the-reviews-checked'), 'what-the-reviews-checked stays on Papers');
  });

  test('off-shelf documents stay in the catalog and keep their URL', () => {
    const shelved = new Set([...catalog.essays, ...catalog.papers, ...catalog.listed].map(d => d.slug));
    const off = catalog.docs.filter(d => !shelved.has(d.slug));
    for (const doc of off) {
      assert.ok(catalog.bySlug.has(doc.slug), `${doc.slug}: still in bySlug`);
    }
  });

  test('every document has a title, date, author, summary and non-empty html', () => {
    for (const doc of catalog.docs) {
      assert.ok(doc.title, `${doc.slug}: title`);
      assert.ok(doc.date, `${doc.slug}: date`);
      assert.ok(doc.author, `${doc.slug}: author`);
      assert.ok(doc.summary, `${doc.slug}: summary`);
      assert.ok(doc.html.trim().length > 0, `${doc.slug}: html`);
    }
  });

  test('summaries carry no raw blockquote markers (R1)', () => {
    for (const doc of catalog.docs) {
      assert.doesNotMatch(doc.summary, /(^|\s)>(\s|$)/, `${doc.slug}: no raw '>' marker`);
    }
    assert.match(catalog.docForSlug('doc/charter').summary, /^Status: DRAFT/);
  });

  test('the 15 front-matter-less documents all get date and author from the tables', () => {
    const overrides = [
      'fleet-complexity-read',
      ...LISTED_DOCS.map(d => `doc/${d.path.replace(/\.md$/, '').split('/').pop()}`),
    ];
    assert.equal(overrides.length, 15);
    for (const slug of overrides) {
      const doc = catalog.docForSlug(slug);
      assert.ok(doc, `${slug} resolves`);
      assert.ok(doc.date && doc.author, `${slug} has date + author`);
    }
  });

  test('slugs are unique and no paper is named `doc` (which would shadow /library/doc)', () => {
    const slugs = catalog.docs.map(d => d.slug);
    assert.equal(new Set(slugs).size, slugs.length, 'unique slugs');
    assert.equal(catalog.docForSlug('doc'), null, 'no paper slug `doc`');
  });

  test('essays, papers and listed docs are newest first (undated last)', () => {
    const isSorted = list => list.every((doc, i) => {
      if (i === 0) return true;
      const prev = Date.parse(list[i - 1].date || 0);
      const cur = Date.parse(doc.date || 0);
      return prev >= cur;
    });
    assert.ok(isSorted(catalog.essays), 'essays sorted');
    assert.ok(isSorted(catalog.papers), 'papers sorted');
    assert.ok(isSorted(catalog.listed), 'listed sorted');
  });

  // Characterization guard: the excerpt skip rule is for the papers folder
  // only, so it must change the six essays and nothing on the papers or listed
  // shelves. The fixture is the summaries as they were before this change.
  test('the excerpt rule changes only the essays, never a shelf paper or listed doc', () => {
    const before = JSON.parse(readFileSync(
      new URL('../fixtures/library-doc-summaries.json', import.meta.url), 'utf8'));
    for (const doc of [...catalog.papers, ...catalog.listed]) {
      assert.equal(doc.summary, before[doc.slug], `${doc.slug}: summary unchanged`);
    }
    assert.equal(catalog.essays.length, 6, 'six essays');
    for (const doc of catalog.essays) {
      assert.notEqual(doc.summary, before[doc.slug], `${doc.slug}: no longer the italic subtitle`);
    }
  });

  test('figureCount equals the number of <img> tags', () => {
    for (const doc of catalog.docs) {
      assert.equal(doc.figureCount, (doc.html.match(/<img\b/g) || []).length, `${doc.slug}: figureCount`);
    }
    assert.ok(catalog.docs.some(d => d.figureCount > 0), 'at least one document has figures');
  });

  test('Start-here slugs all resolve', () => {
    for (const item of START_HERE) {
      if (!item.slug) continue;
      assert.ok(catalog.docForSlug(item.slug), `${item.slug} resolves`);
    }
  });

  test('every heading anchor resolves and no relative href/src survives', () => {
    for (const doc of catalog.docs) {
      const ids = new Set(doc.headings);
      for (const match of doc.html.matchAll(/href="#([^"]+)"/g)) {
        assert.ok(ids.has(match[1]), `${doc.slug}: anchor #${match[1]} resolves`);
      }
      for (const match of doc.html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const url = match[1];
        const ok = url.startsWith('#') || url.startsWith('/library/') ||
          /^https?:/i.test(url) || url.startsWith('mailto:');
        assert.ok(ok, `${doc.slug}: rewritten url is absolute or library-relative: ${url}`);
      }
    }
  });

  test('the three broken survey-check-7 links are preserved as written (GitHub URLs)', () => {
    const doc = catalog.docForSlug('survey-check-7');
    for (const name of ['held-or-fresh', 'survey-check-7', 'where-judgement-happens']) {
      const hrefs = [...doc.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
      const hit = hrefs.find(h => h.startsWith(GITHUB_BASE) && h.endsWith(`papers/harbour/${name}.md`));
      assert.ok(hit, `broken ${name} link goes to GitHub as written`);
    }
  });

  test('every image reference resolves into the figure map', () => {
    for (const doc of catalog.docs) {
      for (const match of doc.html.matchAll(/src="\/library\/figures\/([^"]+)"/g)) {
        assert.ok(catalog.figureFor(decodeURIComponent(match[1])), `${doc.slug}: figure ${match[1]}`);
      }
    }
  });

  test('backlinks are reciprocal', () => {
    let checked = 0;
    for (const doc of catalog.docs) {
      for (const back of catalog.backlinksFor(doc.slug)) {
        assert.ok(back.linkSlugs.has(doc.slug), `${back.slug} links to ${doc.slug}`);
        checked += 1;
      }
    }
    assert.ok(checked > 0, 'there is at least one backlink');
  });
});

describe('library routes', () => {
  test('every document serves a 200 page and a 200 .md equal to the file bytes', async () => {
    for (const doc of catalog.docs) {
      const page = await get(`/library/${doc.slug}`);
      assert.equal(page.status, 200, `${doc.slug} page`);
      assert.match(page.headers.get('content-type'), /text\/html/, `${doc.slug} page content-type`);
      assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

      const md = await get(`/library/${doc.slug}.md`);
      assert.equal(md.status, 200, `${doc.slug}.md`);
      assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');
      assert.equal(md.headers.get('x-content-type-options'), 'nosniff');
      const body = await md.text();
      assert.equal(body, readFileSync(doc.sourcePath, 'utf8'), `${doc.slug}.md bytes equal the source`);
    }
  });

  test('every document page renders exactly one H1 with the byline right after it', async () => {
    for (const doc of catalog.docs) {
      const res = await get(`/library/${doc.slug}`);
      const html = await res.text();
      const main = /<main class="library[^"]*">([\s\S]*?)<\/main>/.exec(html);
      assert.ok(main, `${doc.slug}: has a <main>`);
      const h1Count = (main[1].match(/<h1\b/g) || []).length;
      assert.equal(h1Count, 1, `${doc.slug}: exactly one H1 in main (no duplicated title)`);
      assert.match(
        main[1],
        /<h1\b[\s\S]*?<\/h1>\s*<p class="library-doc__byline">/,
        `${doc.slug}: byline directly follows the H1`,
      );
      assert.equal((main[1].match(/library-doc__byline/g) || []).length, 1, `${doc.slug}: one byline`);
    }
  });

  test('wrong-form slugs 404 (canonical URL per document)', async () => {
    for (const path of ['/library/ladder', '/library/doc/writing-length', '/library/nope']) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
    }
  });

  test('the index shelves essays, papers and other documents with a derived meta line', async () => {
    const html = await (await get('/library')).text();
    assert.match(html, /<h2>Essays<\/h2>/);
    assert.match(html, /<h2>Papers<\/h2>/);
    assert.match(html, /<h2>Other documents<\/h2>/);
    assert.doesNotMatch(html, /Papers and essays/);
    // The papers shelf is a list of items, not every .md file on disk.
    const papersSection = /<h2>Papers<\/h2>[\s\S]*?<\/section>/.exec(html)[0];
    assert.equal((papersSection.match(/data-testid="library-item-link"/g) || []).length, catalog.papers.length);
    assert.doesNotMatch(papersSection, /survey-check/);

    const entry = slug => {
      const re = new RegExp(`<li class="library-item">(?:(?!</li>)[\\s\\S])*?href="/library/${slug}"[\\s\\S]*?</li>`);
      return re.exec(html);
    };
    // A dated, figure-heavy paper prints date · N min read · N figures.
    const costMix = entry('cost-mix')[0];
    const costMeta = /<p class="library-item__meta">([^<]*)<\/p>/.exec(costMix)[1];
    assert.match(costMeta, /min read/);
    assert.match(costMeta, new RegExp(`\\b${catalog.docForSlug('cost-mix').figureCount} figures`));
    // A zero-figure document omits the figure part entirely.
    const reviewLoops = entry('review-loops')[0];
    const reviewMeta = /<p class="library-item__meta">([^<]*)<\/p>/.exec(reviewLoops)[1];
    assert.match(reviewMeta, /min read/);
    assert.doesNotMatch(reviewMeta, /figure/);
  });

  test('the document page has a back link, an aside and a folder GitHub link', async () => {
    const html = await (await get('/library/cost-mix')).text();
    assert.match(html, /<a href="\/library" data-testid="library-back-link">← Library<\/a>/, 'back link to the Library');
    assert.match(html, /<aside class="library-doc__aside">/, 'further-reading aside');
    assert.match(
      html,
      /href="https:\/\/github\.com\/JKershaw\/LinearViewer\/tree\/main\/docs\/papers\/harbour"/,
      'GitHub link points at the document folder',
    );
    assert.doesNotMatch(html, /\/blob\/main\/docs\/papers\/harbour\/cost-mix\.md/, 'not a file blob link');
    assert.match(html, /data-testid="library-markdown-link"/, 'Markdown link kept');
    assert.doesNotMatch(html, /library-doc__footer/, 'the old footer is gone');
  });

  test('search works with no JavaScript and is noindexed', async () => {
    const res = await get('/library?q=review+loops');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    const html = await res.text();
    assert.ok(html.includes('review-loops'), 'a matching document is listed');
    assert.ok(html.includes('<mark>'), 'a snippet highlight is present');
    assert.ok(!/<script>alert/.test(html), 'the query is escaped');
  });

  test('unknown figure 404s', async () => {
    const res = await get('/library/figures/does/not/exist.svg');
    assert.equal(res.status, 404);
  });
});

// LIN-3345, Part B of LIN-3342: the crawler-facing files. The catalogue is the
// same `loadLibrary` instance the routes use, so the sitemap cannot drift from
// the routes by construction.
describe('crawler files (LIN-3345)', () => {
  test('/sitemap.xml lists the canonical, query-free URL set', async () => {
    const res = await get('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/xml; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');

    const xml = await res.text();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    for (const loc of locs) {
      assert.ok(loc.startsWith(`${base}/`), `absolute loc: ${loc}`);
      assert.ok(!loc.includes('?'), `no query string in loc: ${loc}`);
    }
    assert.ok(locs.includes(`${base}/`));
    assert.ok(locs.includes(`${base}/library`));
    for (const doc of catalog.docs) {
      assert.ok(locs.includes(`${base}/library/${doc.slug}`), `${doc.slug} listed`);
    }
    for (const edition of catalog.archiveEditions) {
      assert.ok(locs.includes(`${base}/archive/${edition.n}`), `archive ${edition.n} listed`);
    }
    assert.equal(locs.length, 2 + catalog.docs.length + catalog.archiveEditions.length);

    // `lastmod` only where the date is a real YYYY-MM-DD.
    const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]);
    const dated = catalog.docs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date || ''));
    assert.equal(lastmods.length, dated.length);
    for (const value of lastmods) assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('every <loc> served by this router resolves 200 without noindex', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    // `/` is the landing, and Archive editions are served by server.js — both
    // outside this router; e2e covers those. Here prove every Library loc.
    const routerLocs = locs.filter(loc => new URL(loc).pathname.startsWith('/library'));
    assert.ok(routerLocs.length > 0);
    for (const loc of routerLocs) {
      const res = await fetch(loc, { redirect: 'manual' });
      assert.equal(res.status, 200, loc);
      assert.notEqual(res.headers.get('x-robots-tag'), 'noindex', loc);
    }
  });

  test('/robots.txt allows crawling and points at the sitemap', async () => {
    const res = await get('/robots.txt');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const body = await res.text();
    assert.match(body, /^User-agent: \*$/m);
    assert.match(body, /^Allow: \/$/m);
    assert.ok(body.includes(`Sitemap: ${base}/sitemap.xml`), 'absolute sitemap line');
    // Blocking the results page would hide its noindex from crawlers (A's rule).
    assert.ok(!/Disallow:/.test(body), 'no Disallow rules');
  });

  test('case-variant /Sitemap.xml reaches the same handler (pins the shared predicate)', async () => {
    const res = await get('/Sitemap.xml');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-type'), /application\/xml/);
  });

  // The real catalog cannot exercise these two claims (every doc has an ISO date
  // and no slug carries an XML-special character), so pin them directly against
  // the exported helpers — a mutation of either must turn these red.
  test('sitemapEntries omits `lastmod` unless the date is a real YYYY-MM-DD', () => {
    const entries = sitemapEntries({
      docs: [{ slug: 'a&b', date: '2026-01' }, { slug: 'c' }],
      archiveEditions: [],
    });
    const docEntries = entries.filter(e => e.path.startsWith('/library/'));
    assert.deepEqual(docEntries, [
      { path: '/library/a&b', lastmod: null },
      { path: '/library/c', lastmod: null },
    ]);
  });

  test('escapeXml escapes every XML-special character', () => {
    assert.equal(escapeXml(`a&b<"'>`), 'a&amp;b&lt;&quot;&apos;&gt;');
  });
});

describe('figure dark-mode theme (LIN-3351)', () => {
  const figureFiles = listFigures();

  test('every figure SVG carries the theme block (new or regenerated figures fail until themed)', () => {
    assert.ok(figureFiles.length > 0, 'figures found');
    const untreated = figureFiles
      .filter(f => !readFileSync(f, 'utf8').includes(`<style ${THEME_MARKER}=`))
      .map(f => relative(FIGURES_DIR, f));
    assert.deepEqual(untreated, [], `untreated figures — run \`npm run figures:theme\`: ${untreated.join(', ')}`);
  });

  test('every figure is exactly what the transform produces (no stale palette)', () => {
    const stale = figureFiles.filter(f => {
      const text = readFileSync(f, 'utf8');
      return themeSvg(text, relative(FIGURES_DIR, f)) !== text;
    }).map(f => relative(FIGURES_DIR, f));
    assert.deepEqual(stale, [], `stale figures — run \`npm run figures:theme\`: ${stale.join(', ')}`);
  });

  test("the transform's dark values equal the .theme-dark tokens in style.css (drift guard)", () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'style.css'), 'utf8');
    const block = /^\.theme-dark\s*\{([^}]*)\}/m.exec(css)[1];
    const token = name => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block)[1].toLowerCase();
    assert.deepEqual({ ...DARK_PALETTE }, {
      bg: token('bg'), panel: token('bg-muted'), fg: token('fg'), dim: token('fg-dim'), border: token('border'),
    });
  });

  test('themeSvg is idempotent and rebuilds rather than stacks the block', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#fff"/><text fill="#1f2937">x</text></svg>';
    const once = themeSvg(svg);
    assert.equal(themeSvg(once), once);
    assert.equal(once.match(new RegExp(THEME_MARKER, 'g')).length, 1);
    assert.ok(once.includes('@media (prefers-color-scheme: dark)'));
  });

  test('translucent rects are flattened over white; circle opacity and white overlays are not', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<rect fill="#000000" fill-opacity="0.5"/><circle fill="#2a78d6" fill-opacity="0.4"/>'
      + '<rect fill="#fff" fill-opacity="0.55"/><rect fill="#ffffff" fill-opacity="0.92"/></svg>';
    const out = themeSvg(svg);
    assert.match(out, /<rect fill="#808080"\/>/);
    assert.match(out, /<circle fill="#2a78d6" fill-opacity="0.4"\/>/);
    assert.match(out, /<rect fill="#fff" fill-opacity="0.55"\/>/, 'pale white overlay stays white');
    // Near-opaque white plates sit behind text that turns light, so only they get a dark rule.
    assert.match(out, /rect\[fill="#ffffff"\]\[fill-opacity="0.92"\]/);
    assert.doesNotMatch(out, /fill-opacity="0.55"\]/);
  });

  test('white non-rect shapes (hollow markers) get the dark canvas fill; coloured shapes do not', () => {
    const out = themeSvg('<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#fff" stroke="#1f2937"/><path fill="#ffffff" d="M0 0"/>'
      + '<circle fill="#ffffff" fill-opacity="0.9"/><circle fill="#2a78d6"/></svg>');
    assert.match(out, /circle\[fill="#fff"\]:not\(\[fill-opacity\]\)/);
    assert.match(out, /path\[fill="#ffffff"\]:not\(\[fill-opacity\]\)/);
    assert.match(out, /circle\[fill="#ffffff"\]\[fill-opacity="0.9"\]/);
    assert.doesNotMatch(out, /circle\[fill="#2a78d6"\]/);
  });

  test('dark labels on light data fills are marked and left unremapped; others are not', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="40" fill="#fff"/>'
      + '<rect x="10" y="10" width="40" height="20" fill="#cbd5e1"/><text x="30" y="24" fill="#1f2937" text-anchor="middle">on</text>'
      + '<rect x="60" y="10" width="30" height="20" fill="#1e40af"/><text x="75" y="24" fill="#1f2937">dark data</text>'
      + '<text x="5" y="8" fill="#1f2937">canvas</text></svg>';
    const out = themeSvg(svg);
    assert.match(out, /<text data-on-fill="1" x="30"/, 'label over a pale data fill is marked');
    assert.doesNotMatch(out, /<text data-on-fill="1" x="75"/, 'label over a saturated (dark) fill is not');
    assert.doesNotMatch(out, /<text data-on-fill="1" x="5"/, 'label on the white canvas is not');
    assert.match(out, /text\[fill="#1f2937"\]:not\(\[data-on-fill\]\)/);
    assert.equal(themeSvg(out), out, 'marking is idempotent');
  });

  test('dark-neutral data fills are lifted off the canvas', () => {
    const out = themeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="5" height="5" fill="#1f2937"/></svg>');
    assert.match(out, /rect\[fill="#1f2937"\],circle\[fill="#1f2937"\],path\[fill="#1f2937"\]\{fill:#4b5563\}/);
  });

  test('LIGHT_ONLY figures get an empty dark block and stay light', () => {
    assert.deepEqual([...LIGHT_ONLY], ['steady-base-menu/menu-size-vs-risk.svg']);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>';
    const out = themeSvg(svg, LIGHT_ONLY[0]);
    assert.ok(out.includes(`<style ${THEME_MARKER}="light-only">`));
    assert.doesNotMatch(out, /prefers-color-scheme/);
    assert.equal(themeSvg(out, LIGHT_ONLY[0]), out);
  });

  test('library.css sets the figure color-scheme for both dark paths, scoped to Library figures', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'library.css'), 'utf8');
    assert.match(css, /\.library-doc__body img\s*\{\s*color-scheme:\s*light;/);
    assert.match(css, /\.theme-dark \.library-doc__body img\s*\{\s*color-scheme:\s*dark;/);
    assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*body\.is-landing \.library-doc__body img\s*\{\s*color-scheme:\s*dark;/);
    // The light-only figure is dimmed on both dark paths, by exact src.
    assert.match(css, /\.theme-dark \.library-doc__body img\[src\$="\/steady-base-menu\/menu-size-vs-risk\.svg"\]\s*\{\s*filter:\s*brightness\(0\.85\)/);
    assert.match(css, /body\.is-landing \.library-doc__body img\[src\$="\/steady-base-menu\/menu-size-vs-risk\.svg"\]\s*\{\s*filter:\s*brightness\(0\.85\)/);
  });
});
