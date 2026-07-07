import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderWordmark } from '../../lib/components/wordmark.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderPageFooter } from '../../lib/components/footer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

// --- the shared partial (LIN-725) ------------------------------------------

test('renderWordmark emits the lowercase brand with a teal accent dot', () => {
  const html = renderWordmark({ context: 'nav', href: '/workspace/abc/' });
  // Lowercase brand text, not capitalised, no serif opt-in.
  assert.match(html, />harbour</);
  assert.doesNotMatch(html, /Harbour</); // the visible mark is lowercase
  // The accent dot is its own teal-token span and hidden from assistive tech.
  assert.match(html, /<span class="wordmark-accent" aria-hidden="true">\.cat<\/span>/);
});

test('renderWordmark links home when given an href, plain label otherwise', () => {
  const linked = renderWordmark({ context: 'nav', href: '/workspace/abc/' });
  assert.match(linked, /^<a href="\/workspace\/abc\/"/);
  assert.match(linked, /data-testid="nav-brand"/);
  assert.match(linked, /aria-label="Harbour home"/);

  const label = renderWordmark({ context: 'footer', href: null });
  assert.match(label, /^<span /);
  assert.match(label, /data-testid="footer-brand"/);
  assert.match(label, /aria-label="Harbour"/);
  assert.doesNotMatch(label, /<a /);
});

test('renderWordmark escapes the href', () => {
  const html = renderWordmark({ context: 'nav', href: '/workspace/a"b/' });
  assert.doesNotMatch(html, /href="\/workspace\/a"b\//);
  assert.match(html, /&quot;/);
});

// --- nav bar wiring ---------------------------------------------------------

test('authenticated nav bar carries the wordmark linking to the workspace home', () => {
  const html = renderNavBar({
    workspaces: [{ urlKey: 'abc', name: 'Acme' }],
    urlKey: 'abc',
    currentPage: 'settings',
  });
  assert.match(html, /data-testid="nav-brand"/);
  assert.match(html, /href="\/workspace\/abc\/"/);
  assert.match(html, /class="wordmark wordmark-nav"/);
});

test('landing nav bar does NOT carry the wordmark (landing visuals untouched)', () => {
  const html = renderNavBar({ isLanding: true });
  assert.doesNotMatch(html, /data-testid="nav-brand"/);
  assert.doesNotMatch(html, /wordmark/);
});

// --- footer wiring ----------------------------------------------------------

test('authenticated footer carries the wordmark as a plain brand label', () => {
  const html = renderPageFooter({ urlKey: 'abc' });
  assert.match(html, /<div class="footer-brand">/);
  assert.match(html, /data-testid="footer-brand"/);
  assert.match(html, /class="wordmark wordmark-footer"/);
  // Footer wordmark is a label, not a link.
  assert.doesNotMatch(html, /<a[^>]*data-testid="footer-brand"/);
});

test('landing footer does NOT carry the wordmark', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/' });
  assert.doesNotMatch(html, /footer-brand/);
  assert.doesNotMatch(html, /data-testid="footer-brand"/);
});

// --- styling contract -------------------------------------------------------

test('wordmark styles use the teal token and the mono stack, never a serif', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf('.wordmark {'), css.indexOf('.queue-badge {'));
  assert.match(block, /font-family:\s*var\(--font-structural\)/); // mono stack
  assert.match(block, /\.wordmark-accent\s*\{\s*color:\s*var\(--teal\)/); // teal accent
  assert.doesNotMatch(block, /serif/i); // DM Serif Display explicitly rejected
});
