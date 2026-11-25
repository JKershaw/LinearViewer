import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderWordmark } from '../../lib/components/wordmark.js';
import { renderRail, renderPublicFrame } from '../../lib/components/frame.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

// --- the shared partial (LIN-725) ------------------------------------------

test('renderWordmark emits the lowercase brand with a teal accent dot', () => {
  const html = renderWordmark({ context: 'rail', href: '/workspace/abc/' });
  // Lowercase brand text, not capitalised, no serif opt-in.
  assert.match(html, />harbour</);
  assert.doesNotMatch(html, /Harbour</); // the visible mark is lowercase
  // The accent dot is its own teal-token span and hidden from assistive tech.
  assert.match(html, /<span class="wordmark-accent" aria-hidden="true">\.cat<\/span>/);
});

test('renderWordmark links home when given an href, plain label otherwise', () => {
  const linked = renderWordmark({ context: 'rail', href: '/workspace/abc/' });
  assert.match(linked, /^<a href="\/workspace\/abc\/"/);
  assert.match(linked, /data-testid="rail-brand"/);
  assert.match(linked, /aria-label="Harbour home"/);

  const label = renderWordmark({ context: 'rail', href: null });
  assert.match(label, /^<span /);
  assert.match(label, /data-testid="rail-brand"/);
  assert.match(label, /aria-label="Harbour"/);
  assert.doesNotMatch(label, /<a /);
});

test('renderWordmark escapes the href', () => {
  const html = renderWordmark({ context: 'rail', href: '/workspace/a"b/' });
  assert.doesNotMatch(html, /href="\/workspace\/a"b\//);
  assert.match(html, /&quot;/);
});

// --- frame wiring (LIN-4568: the old bar and old footer that also drew it are gone) -------

test('the rail carries the wordmark linking to the workspace home', () => {
  const html = renderRail({ workspaces: [{ urlKey: 'abc', name: 'Acme' }], urlKey: 'abc' });
  assert.match(html, /<a href="\/workspace\/abc\/" class="wordmark wordmark-rail" data-testid="rail-brand"/);
});

test('the public band carries the wordmark linking to the front page for a signed-out viewer', () => {
  const html = renderPublicFrame({ title: 'Library', viewer: { signedIn: false, homeHref: null } });
  assert.match(html, /<a href="\/" class="wordmark wordmark-rail" data-testid="rail-brand"/);
});

test('the footer every page shares carries no wordmark (the brand leads the rail or band)', () => {
  const html = renderPublicFrame({ title: 'Library', viewer: { signedIn: false, homeHref: null } });
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.doesNotMatch(footer, /wordmark/);
});

// --- styling contract -------------------------------------------------------

test('wordmark styles use the teal token and the mono stack, never a serif', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf('.wordmark {'), css.indexOf('.queue-count {'));
  assert.match(block, /font-family:\s*var\(--font-structural\)/); // mono stack
  assert.match(block, /\.wordmark-accent\s*\{\s*color:\s*var\(--teal\)/); // teal accent
  assert.doesNotMatch(block, /serif/i); // DM Serif Display explicitly rejected
});
