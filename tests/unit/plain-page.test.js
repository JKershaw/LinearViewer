// LIN-3950: the Plain page layout, built once from the shared builders. An unknown section kind throws, so a new kind is
// a deliberate change here.
//
// LIN-4567 (LIN-4342 piece 6): a Plain page sits in the public frame, which owns its one h1, its way back, its footer and
// its tab title. The document entries that drew a "Harbour" brand h1 over a Plain-title h2 (`renderPlainPage`,
// `renderPlainDocument`) are gone; what is left is the sections (`renderPlainSections`), the column a page hands the frame
// (`renderPlainColumn`, sections at h2 under the frame's h1) and the form (`plainFormHtml`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as plain from '../../lib/components/plain-page.js';
import { renderPlainSections, renderPlainColumn } from '../../lib/components/plain-page.js';

test('the document entries are gone: the frame draws the page, the helper draws its sections', () => {
  assert.deepEqual(Object.keys(plain).sort(), ['plainFormHtml', 'renderPlainColumn', 'renderPlainSections']);
});

test('the column: the sections at h2 in the 40em Plain column, with no h1 and no title of its own', () => {
  const html = renderPlainColumn({ attrs: 'data-testid="plain"', sections: [{ kind: 'html', title: 'What we store', body: '<p>Text.</p>' }] });
  assert.match(html, /^<div class="plain-page plain-column" data-testid="plain">/);
  assert.match(html, /<h2 class="section-header">What we store<\/h2>/);
  assert.doesNotMatch(html, /<h1|plain-title|<main/);
});

test('fields kind renders one field row per entry, escaping the text', () => {
  const html = renderPlainSections([{ kind: 'fields', title: 'You', fields: [{ label: 'Email', value: 'a<b' }] }]);
  assert.match(html, /<div class="field"><span class="field-label">Email<\/span><span class="field-value">a&lt;b<\/span><\/div>/);
});

// LIN-3956: rows is a Plain section over the Settings rows list. Its heading takes the page's tag, never group()'s h2,
// and it has no group wrapper.
test('rows kind is a Plain section: its heading takes the page tag, not the group heading', () => {
  const html = renderPlainSections([{ kind: 'rows', title: 'For you', rowsHtml: '<div class="settings-row">x</div>', note: 'Only you see this.' }]);
  assert.match(html, /<section class="section">\s*<h2 class="section-header">For you<\/h2>/);
  assert.doesNotMatch(html, /settings-group-title|settings-group-block/);
  assert.match(html, /<div class="settings-rows"><div class="settings-row">x<\/div>/);
  assert.match(html, /<p class="settings-note">Only you see this\.<\/p>/);
  assert.match(renderPlainSections([{ kind: 'rows', title: 'For you', rowsHtml: '' }], 'h3'), /<h3 class="section-header">For you<\/h3>/, 'a sample nested under an h2 heads rows with h3');
});

test('rows kind carries its testid on the section', () => {
  const html = renderPlainSections([{ kind: 'rows', title: 'Sources', rowsHtml: '', testid: 'account-home-sources' }]);
  assert.match(html, /<section class="section" data-testid="account-home-sources">/);
});

test('form kind posts to its action with one field per entry and a primary submit', () => {
  const html = renderPlainSections([{ kind: 'form', title: 'Details', action: '/go', method: 'POST', fields: [{ name: 'label', label: 'Name', value: 'x' }], submitLabel: 'Create' }]);
  assert.match(html, /<form action="\/go" method="POST"/);
  assert.match(html, /<input name="label" type="text" class="token-label-input" aria-label="Name" value="x">/);
  assert.match(html, /<button class="btn btn--primary" type="submit">/);
});

// LIN-3956: the workspace-create form keeps what the page did: the canonical text control, its accessible
// name, the placeholder and the maxlength. The class is the form's hook, and the input's is the control's.
test('form kind passes the placeholder and maxlength through, and names the input by its label', () => {
  const html = renderPlainSections([{ kind: 'form', title: 'Workspace', action: '/workspace/new', fields: [{ name: 'name', label: 'Workspace name', placeholder: 'Local Workspace', maxlength: 50 }], submitLabel: 'Create' }]);
  assert.match(html, /<input name="name" type="text" class="token-label-input" aria-label="Workspace name" value="" placeholder="Local Workspace" maxlength="50">/);
});

test('empty kind renders the empty-state builder', () => {
  const html = renderPlainSections([{ kind: 'empty', title: 'Nothing queued', text: 'No items yet.' }]);
  assert.match(html, /<div class="emptyState">No items yet\.<\/div>/);
});

test('an unknown section kind throws', () => {
  assert.throws(() => renderPlainSections([{ kind: 'tabs', title: 'x' }]), /unknown section kind "tabs"/);
});
