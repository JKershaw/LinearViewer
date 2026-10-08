/**
 * LIN-3344 — Library safety (Part A of LIN-3342).
 *
 * Renders a deliberately hostile fixture document through the real router and
 * asserts the output cannot run script: raw HTML is escaped, dangerous hrefs
 * and image srcs are neutralised, traversal and wrong-form slugs 404, figures
 * are served script-blocked, and the page's CSP hash covers exactly the one
 * inline script the shell emits.
 *
 * Run with: node --test tests/unit/library-security.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLibraryRouter, LIBRARY_CSP, MARKDOWN_CSP, FIGURE_CSP } from '../../routes/library.js';

const docsRoot = fileURLToPath(new URL('../fixtures/library-docs', import.meta.url));

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

const get = path => fetch(`${base}${path}`, { redirect: 'manual' });

/**
 * Send a path verbatim. `fetch` resolves `..` on the client, so it can never
 * prove what the router does with a traversal; `http.get` transmits the path
 * unnormalised, as a raw client would (LIN-3344 review F4).
 */
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

describe('library rendering is script-safe', () => {
  let html;

  before(async () => {
    const res = await get('/library/hostile');
    assert.equal(res.status, 200);
    html = await res.text();
  });

  test('raw HTML is escaped, not executed', () => {
    assert.ok(html.includes('&lt;script&gt;'), 'script tag shown as text');
    assert.ok(!/<script>alert/.test(html), 'no live inline alert script');
    assert.ok(!/<iframe/.test(html), 'no live iframe');
    assert.ok(!/<img[^>]*onerror=/i.test(html), 'no live onerror attribute');
  });

  test('dangerous link schemes are neutralised, safe links survive', () => {
    assert.ok(!/href="javascript:/i.test(html), 'no javascript: href');
    assert.ok(!/href="data:text/i.test(html), 'no data:text href (the favicon data: icon still counts as safe)');
    assert.ok(html.includes('href="https://example.com"'), 'absolute https link kept');
    assert.ok(html.includes('href="#section"'), 'same-page anchor kept');
  });

  test('dangerous image srcs are neutralised, library figures resolve', () => {
    assert.ok(!/src="javascript:/i.test(html), 'no javascript: img src');
    assert.ok(!/src="data:image\/svg/i.test(html), 'no data: svg img src');
    assert.ok(html.includes('src="/library/figures/hostile/x.svg"'), 'figure rewritten');
  });

  test('CSP is present and its hash covers exactly the one inline script', () => {
    const res = LIBRARY_CSP;
    assert.ok(res.includes("script-src 'sha256-"), 'script-src is a hash');

    const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.equal(bodies.length, 1, 'the shell emits exactly one inline script');
    const hashes = new Set(bodies.map(b => `sha256-${createHash('sha256').update(b, 'utf8').digest('base64')}`));
    assert.equal(hashes.size, 1);
    assert.ok([...hashes].every(h => LIBRARY_CSP.includes(`'${h}'`)), 'the CSP hash matches the emitted script body');
    assert.ok(!/<script src=/.test(html), 'no external scripts on a Library page');
  });

  test('the search query is escaped in results', async () => {
    const res = await get('/library?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!/<script>alert/.test(body), 'no live script echo');
    assert.ok(body.includes('&lt;script&gt;'), 'query escaped');
  });
});

describe('library response headers and 404s', () => {
  test('html pages are CSP + nosniff', async () => {
    const res = await get('/library');
    assert.equal(res.headers.get('content-security-policy'), LIBRARY_CSP);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('case-variant Library URLs behave like the lowercase ones', async () => {
    const index = await get('/Library');
    assert.equal(index.status, 200, 'uppercase index serves');
    assert.equal(index.headers.get('content-security-policy'), LIBRARY_CSP);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff', 'nosniff on a case-variant index');

    const page = await get('/Library/hostile');
    assert.equal(page.status, 200, 'uppercase path serves the page');
    assert.equal(page.headers.get('content-security-policy'), LIBRARY_CSP);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff', 'nosniff on a case-variant page');

    const md = await get('/LIBRARY/hostile.md');
    assert.equal(md.status, 200, 'uppercase path serves the markdown');
    assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(md.headers.get('content-security-policy'), MARKDOWN_CSP);
    assert.equal(md.headers.get('x-content-type-options'), 'nosniff', 'nosniff on a case-variant .md');
  });

  test('.md is markdown, sandboxed and nosniff', async () => {
    const res = await get('/library/hostile.md');
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(res.headers.get('content-security-policy'), MARKDOWN_CSP);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await res.text(), readFileSync(`${docsRoot}/papers/harbour/hostile.md`, 'utf8'));
  });

  test('figures are script-blocked svg with nosniff', async () => {
    const res = await get('/library/figures/hostile/x.svg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), FIGURE_CSP);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  });

  test('wrong-form slugs 404 at the router', async () => {
    const res = await get('/library/doc/hostile');
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-security-policy'), LIBRARY_CSP);
  });

  test('traversal paths 404 at the router (raw, unnormalised paths)', async () => {
    for (const path of [
      '/library/figures/../../../server.js',
      '/library/figures/..%2f..%2f..%2fserver.js',
      '/library/figures/%2e%2e/%2e%2e/%2e%2e/server.js',
    ]) {
      const res = await rawGet(path);
      assert.equal(res.status, 404, path);
      // The router's own 404 carries the Library CSP; Express's default 404 does
      // not. Asserting it proves the request reached the router, which `fetch`
      // could not (it resolves `..` before sending).
      assert.equal(res.headers['content-security-policy'], LIBRARY_CSP, `${path} 404 came from the router`);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
    }
  });
});
