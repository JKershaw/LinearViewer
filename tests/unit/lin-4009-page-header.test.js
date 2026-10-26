/**
 * LIN-4009 step 3: a page's title is left-aligned with its summary under it.
 *
 * Witnesses: renderPageHeader emits a summary raw when given `subtitleHtml` (its caller escapes the
 * parts), escapes a plain `subtitle` as before, and emits no `<p>` when neither is set; the
 * stylesheet left-aligns `.page-header` and keeps the centred look on every other <header>.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPageHeader } from '../../lib/components/page-header.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

test('renderPageHeader emits subtitleHtml raw, under the title', () => {
  const html = renderPageHeader({ title: 'Acme', subtitleHtml: '<span data-tone="running">1 running</span>' });
  assert.match(html, /<h1>Acme<\/h1>\s*<p class="page-header__subtitle"><span data-tone="running">1 running<\/span><\/p>/);
});

test('renderPageHeader still escapes a plain subtitle', () => {
  const html = renderPageHeader({ title: 'Acme', subtitle: '<b>x</b> & y' });
  assert.match(html, /<p class="page-header__subtitle">&lt;b&gt;x&lt;\/b&gt; &amp; y<\/p>/);
});

test('renderPageHeader without a summary emits no <p>', () => {
  assert.doesNotMatch(renderPageHeader({ title: 'Acme' }), /<p /);
  assert.doesNotMatch(renderPageHeader({ title: 'Acme', subtitleHtml: '' }), /<p /);
});

test('the page header is left-aligned and every other header keeps the centred look (LIN-4009)', () => {
  const body = (sel) => {
    const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(STYLE_CSS);
    assert.ok(m, `expected ${sel} { ... } in style.css`);
    return m[1];
  };
  assert.match(body('.page-header'), /text-align:\s*left/);
  assert.match(body('header:not(.page-header)'), /text-align:\s*center/);
  assert.doesNotMatch(STYLE_CSS, /(^|\n)header\s*\{/, 'the bare header tag rule is gone; the page header owns its own alignment');
});

test('the page title is 24px at weight 600 on desktop (the phone steps keep their own sizes)', () => {
  assert.match(STYLE_CSS, /\.page-header h1\s*\{[^}]*font-size:\s*1\.5rem[^}]*font-weight:\s*600/);
});
