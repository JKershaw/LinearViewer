// LIN-3950: the Plain page layout, built once. `renderPlainPage` composes only the shared builders and
// has two header shapes: brand (Legal, public and system pages: a "Harbour" brand h1, one title h2,
// sections h3) and workspace (the page-header h1 with its lede, sections h2). An unknown section kind
// throws, so a new kind is a deliberate change here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlainPage } from '../../lib/components/plain-page.js';

const count = (html, re) => (html.match(re) || []).length;

test('brand shape: a Harbour brand h1, one title h2, and sections as h3', () => {
  const html = renderPlainPage({
    brand: true,
    title: 'Privacy Policy',
    sections: [{ kind: 'html', title: 'What we store', body: '<p>Text.</p>' }],
  });
  assert.match(html, /<h1><a href="\/" class="header-link">Harbour<\/a><\/h1>/);
  assert.equal(count(html, /<h2/g), 1, 'exactly one h2');
  assert.match(html, /<h2 class="plain-title">Privacy Policy<\/h2>/);
  assert.match(html, /<h3 class="section-header">What we store<\/h3>/);
  assert.match(html, /<main class="plain-page">/);
});

test('workspace shape: the page-header h1 is the title, the lede its subtitle, and sections are h2', () => {
  const html = renderPlainPage({
    title: 'Templates',
    lede: 'Reusable prompts.',
    sections: [{ kind: 'html', title: 'Starters', body: '<p>Text.</p>' }],
  });
  assert.match(html, /<h1>Templates<\/h1>/);
  assert.match(html, /<p class="page-header__subtitle">Reusable prompts\.<\/p>/);
  assert.match(html, /<h2 class="section-header">Starters<\/h2>/);
  assert.equal(count(html, /plain-title/g), 0, 'no title h2 in the workspace shape');
});

test('fields kind renders one field row per entry, escaping the text', () => {
  const html = renderPlainPage({
    title: 'Account',
    sections: [{ kind: 'fields', title: 'You', fields: [{ label: 'Email', value: 'a<b' }] }],
  });
  assert.match(html, /<div class="field"><span class="field-label">Email<\/span><span class="field-value">a&lt;b<\/span><\/div>/);
});

test('rows kind groups trusted row markup with its note through the settings group builder', () => {
  const html = renderPlainPage({
    title: 'Runner',
    sections: [{ kind: 'rows', title: 'For you', rowsHtml: '<div class="settings-row">x</div>', note: 'Only you see this.' }],
  });
  assert.match(html, /class="settings-group-block settings-section\s*"/);
  assert.match(html, /<div class="settings-row">x<\/div>/);
  assert.match(html, /<p class="settings-note">Only you see this\.<\/p>/);
});

test('form kind posts to its action with one field per entry and a primary submit', () => {
  const html = renderPlainPage({
    title: 'Create',
    sections: [{ kind: 'form', title: 'Details', action: '/go', method: 'POST', fields: [{ name: 'label', label: 'Name', value: 'x' }], submitLabel: 'Create' }],
  });
  assert.match(html, /<form action="\/go" method="POST"/);
  assert.match(html, /<input name="label" value="x"/);
  assert.match(html, /<button class="btn btn--primary" type="submit">/);
});

test('empty kind renders the empty-state builder', () => {
  const html = renderPlainPage({
    title: 'Queue',
    sections: [{ kind: 'empty', title: 'Nothing queued', text: 'No items yet.' }],
  });
  assert.match(html, /<div class="emptyState">No items yet\.<\/div>/);
});

test('an unknown section kind throws', () => {
  assert.throws(
    () => renderPlainPage({ title: 'x', sections: [{ kind: 'tabs', title: 'x' }] }),
    /unknown section kind "tabs"/,
  );
});

test('className and attrs extend the main element', () => {
  const html = renderPlainPage({ title: 'x', className: 'extra', attrs: 'data-testid="plain"', sections: [] });
  assert.match(html, /<main class="plain-page extra" data-testid="plain">/);
});
