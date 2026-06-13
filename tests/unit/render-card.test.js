import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderCard } from '../../lib/components/card.js';

test('renders the canonical .card wrapper around a body', () => {
  const html = renderCard({ body: '<p>hi</p>' });
  assert.match(html, /^<div class="card"><p>hi<\/p><\/div>$/);
});

test('requires at least one of title or body', () => {
  assert.throws(() => renderCard({}), /requires at least one of `title` or `body`/);
  assert.throws(() => renderCard({ meta: 'x', labels: 'y' }), /title.*or.*body/);
  // title-only and body-only are both valid.
  assert.doesNotThrow(() => renderCard({ title: 'T' }));
  assert.doesNotThrow(() => renderCard({ body: 'B' }));
});

test('builds a .card-header from title, labels and meta in slot order', () => {
  const html = renderCard({ title: 'Name', meta: '12 chars', labels: '<span>a</span>', body: 'x' });
  assert.match(
    html,
    /<div class="card-header"><span class="card-title">Name<\/span><span class="card-labels"><span>a<\/span><\/span><span class="card-meta">12 chars<\/span><\/div>/
  );
});

test('omits the header entirely when no header slots are given', () => {
  const html = renderCard({ body: 'only body' });
  assert.doesNotMatch(html, /card-header/);
});

test('raw `header` slot wins over title/meta/labels', () => {
  const html = renderCard({ header: '<b>raw</b>', title: 'ignored', body: 'x' });
  assert.match(html, /<div class="card-header"><b>raw<\/b><\/div>/);
  assert.doesNotMatch(html, /card-title/);
});

test('accent adds card-accent + a state modifier class', () => {
  for (const state of ['in-progress', 'done', 'todo', 'backlog', 'failed']) {
    const html = renderCard({ accent: state, body: 'x' });
    assert.match(html, new RegExp(`class="card card-accent card-accent--${state}"`));
  }
});

test('className rides alongside .card as a semantic/E2E hook; attrs extend the wrapper', () => {
  const html = renderCard({ className: 'prompt-card', attrs: 'data-prompt-id="p1"', body: 'x' });
  assert.match(html, /^<div class="card prompt-card" data-prompt-id="p1">/);
});

test('slots are emitted as raw HTML (caller escapes its own text)', () => {
  const html = renderCard({ title: '<span class="prompt-name">n</span>', body: 'x' });
  assert.match(html, /<span class="card-title"><span class="prompt-name">n<\/span><\/span>/);
});
