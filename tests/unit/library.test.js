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
import { join } from 'node:path';
import { loadLibrary, GITHUB_BASE, DEFAULT_DOCS_ROOT } from '../../lib/library.js';
import { createLibraryRouter, escapeXml, sitemapEntries } from '../../routes/library.js';
import { LISTED_DOCS, START_HERE } from '../../lib/library-metadata.js';

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
  test('every papers file on disk and the 14 listed docs is catalogued', () => {
    assert.equal(catalog.papers.length, papersOnDisk.length, 'one paper per .md file');
    assert.equal(catalog.listed.length, LISTED_DOCS.length, 'all 14 listed docs resolve');
    assert.equal(catalog.docs.length, papersOnDisk.length + LISTED_DOCS.length);
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

  test('the 16 front-matter-less documents all get date and author from the tables', () => {
    const overrides = [
      'fleet-complexity-read',
      'what-should-an-agent-leave-behind-evidence',
      ...LISTED_DOCS.map(d => `doc/${d.path.replace(/\.md$/, '').split('/').pop()}`),
    ];
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

  test('papers and listed docs are newest first (undated last)', () => {
    const isSorted = list => list.every((doc, i) => {
      if (i === 0) return true;
      const prev = Date.parse(list[i - 1].date || 0);
      const cur = Date.parse(doc.date || 0);
      return prev >= cur;
    });
    assert.ok(isSorted(catalog.papers), 'papers sorted');
    assert.ok(isSorted(catalog.listed), 'listed sorted');
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
      const main = /<main class="library">([\s\S]*?)<\/main>/.exec(html);
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
      papers: [{ slug: 'a&b', date: '2026-01' }, { slug: 'c' }],
      listed: [],
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
