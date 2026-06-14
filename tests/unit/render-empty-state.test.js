import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderEmptyState } from '../../lib/components/empty-state.js';

test('renders the canonical .emptyState wrapper as a div by default', () => {
  const html = renderEmptyState({ text: 'No custom prompts yet.' });
  assert.equal(html, '<div class="emptyState">No custom prompts yet.</div>');
});

test('className rides alongside .emptyState (the retained per-page variant)', () => {
  const html = renderEmptyState({ text: 'No items', className: 'custom-prompts-empty' });
  assert.equal(html, '<div class="emptyState custom-prompts-empty">No items</div>');
});

test('tag selects the wrapper element (roadmap/pipeline use p)', () => {
  const html = renderEmptyState({ tag: 'p', text: '○ queue empty', className: 'roadmap-empty' });
  assert.equal(html, '<p class="emptyState roadmap-empty">○ queue empty</p>');
});

test('id and attrs extend the wrapper, class then id then attrs (pipeline contract)', () => {
  const html = renderEmptyState({
    tag: 'p',
    text: '○ queue empty',
    className: 'pipeline-queue-empty hidden',
    id: 'pipeline-queue-empty',
  });
  assert.equal(
    html,
    '<p class="emptyState pipeline-queue-empty hidden" id="pipeline-queue-empty">○ queue empty</p>'
  );
});

test('text is escaped (plain text in, like field)', () => {
  const html = renderEmptyState({ text: 'a & <b>' });
  assert.equal(html, '<div class="emptyState">a &amp; &lt;b&gt;</div>');
});

test('requires text', () => {
  assert.throws(() => renderEmptyState({}), /requires `text`/);
  assert.throws(() => renderEmptyState({ text: '' }), /requires `text`/);
});
