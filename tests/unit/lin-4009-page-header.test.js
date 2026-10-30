/**
 * LIN-4009 step 3: a page's title is left-aligned with its summary under it.
 *
 * Witnesses: renderPageHeader emits a summary raw when given `subtitleHtml` (its caller escapes the
 * parts), escapes a plain `subtitle` as before, and emits no `<p>` when neither is set; the
 * stylesheet left-aligns `.page-header` and keeps the centred look on every other <header>.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPageHeader } from '../../lib/components/page-header.js';
import { readSheets, appliedDecls, declOf, rulesFor } from '../helpers/css-rules.js';

const STYLE = readSheets(['/style.css']);

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
  assert.equal(declOf(STYLE, '.page-header', 'text-align'), 'left');
  assert.equal(declOf(STYLE, 'header:not(.page-header)', 'text-align'), 'center');
  assert.deepEqual(rulesFor(STYLE, 'header'), [], 'the bare header tag rule is gone; the page header owns its own alignment');
});

test('the page title is 24px at weight 600 on desktop (the phone steps keep their own sizes)', () => {
  assert.equal(declOf(STYLE, '.page-header h1', 'font-size'), '1.5rem');
  assert.equal(declOf(STYLE, '.page-header h1', 'font-weight'), '600');
});
