// LIN-3950: the Plain page layout, built once. `renderPlainPage` composes only the shared builders and
// has two header shapes: brand (Legal, public and system pages: a "Harbour" brand h1, one title h2,
// sections h3) and workspace (the page-header h1 with its lede, sections h2). An unknown section kind
// throws, so a new kind is a deliberate change here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlainPage, renderPlainDocument } from '../../lib/components/plain-page.js';

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
  assert.match(html, /<main class="plain-page plain-column">/);
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

// LIN-3956: rows is a Plain section over the Settings rows list. Its heading takes the page's tag (h2 in
// the workspace shape, h3 in the brand shape), never group()'s h2, and it has no group wrapper.
test('rows kind is a Plain section: its heading takes the page tag, not the group heading', () => {
  const html = renderPlainPage({
    title: 'Runner',
    sections: [{ kind: 'rows', title: 'For you', rowsHtml: '<div class="settings-row">x</div>', note: 'Only you see this.' }],
  });
  assert.match(html, /<section class="section">\s*<h2 class="section-header">For you<\/h2>/);
  assert.doesNotMatch(html, /settings-group-title|settings-group-block/);
  assert.match(html, /<div class="settings-rows"><div class="settings-row">x<\/div>/);
  assert.match(html, /<p class="settings-note">Only you see this\.<\/p>/);
  const brand = renderPlainPage({ brand: true, title: 'T', sections: [{ kind: 'rows', title: 'For you', rowsHtml: '' }] });
  assert.match(brand, /<h3 class="section-header">For you<\/h3>/, 'the brand shape heads rows with h3');
});

test('rows kind carries its testid on the section', () => {
  const html = renderPlainPage({
    title: 'Account',
    sections: [{ kind: 'rows', title: 'Sources', rowsHtml: '', testid: 'account-home-sources' }],
  });
  assert.match(html, /<section class="section" data-testid="account-home-sources">/);
});

// LIN-3956: the document entry owns the settings.css link, so a page with rows cannot forget it.
test('the document entry links settings.css after style.css exactly when a rows section is present', () => {
  const withRows = renderPlainDocument({
    title: 'Account - Harbour',
    plain: { title: 'Account', sections: [{ kind: 'rows', title: 'For you', rowsHtml: '' }] },
  });
  const links = [...withRows.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ['/style.css', '/settings.css']);

  const noRows = renderPlainDocument({
    title: 'Terms - Harbour',
    plain: { title: 'Terms', sections: [{ kind: 'html', title: 'x', body: '<p>x</p>' }] },
  });
  assert.doesNotMatch(noRows, /settings\.css/);
});

test('the document entry places its after markup after the main, and a title from the document options', () => {
  const html = renderPlainDocument({
    title: 'Privacy Policy - Harbour',
    bodyClass: 'is-landing',
    plain: { brand: true, title: 'Privacy Policy', sections: [] },
    after: '\n  <footer>f</footer>',
  });
  assert.match(html, /<title>Privacy Policy - Harbour<\/title>/);
  assert.match(html, /<body class="is-landing">/);
  assert.match(html, /<\/main>\n  <footer>f<\/footer>/);
});

test('form kind posts to its action with one field per entry and a primary submit', () => {
  const html = renderPlainPage({
    title: 'Create',
    sections: [{ kind: 'form', title: 'Details', action: '/go', method: 'POST', fields: [{ name: 'label', label: 'Name', value: 'x' }], submitLabel: 'Create' }],
  });
  assert.match(html, /<form action="\/go" method="POST"/);
  assert.match(html, /<input name="label" type="text" class="token-label-input" aria-label="Name" value="x">/);
  assert.match(html, /<button class="btn btn--primary" type="submit">/);
});

// LIN-3956: the workspace-create form keeps what the page did: the canonical text control, its accessible
// name, the placeholder and the maxlength. The class is the form's hook, and the input's is the control's.
test('form kind passes the placeholder and maxlength through, and names the input by its label', () => {
  const html = renderPlainPage({
    title: 'Create',
    sections: [{ kind: 'form', title: 'Workspace', action: '/workspace/new', fields: [{ name: 'name', label: 'Workspace name', placeholder: 'Local Workspace', maxlength: 50 }], submitLabel: 'Create' }],
  });
  assert.match(html, /<input name="name" type="text" class="token-label-input" aria-label="Workspace name" value="" placeholder="Local Workspace" maxlength="50">/);
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

test('className and attrs extend the main element, and the column class is always there', () => {
  const html = renderPlainPage({ title: 'x', className: 'extra', attrs: 'data-testid="plain"', sections: [] });
  assert.match(html, /<main class="plain-page plain-column extra" data-testid="plain">/);
});
