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
import { createLibraryRouter } from '../../routes/library.js';
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
