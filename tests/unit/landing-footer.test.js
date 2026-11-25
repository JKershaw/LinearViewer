/**
 * LIN-3980 outcome 6: the footer suits a visitor. On `/` nothing is marked
 * current (the visitor is in no view), and the cross-view row names the
 * previews. LIN-4564: the previews sit in the public frame and draw its footer,
 * so the row is only ever drawn on `/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPageFooter } from '../../lib/components/footer.js';

test('on / nothing in the cross-view row is marked current, and the row names the previews', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/' });
  assert.doesNotMatch(html, /footer-current/);
  assert.doesNotMatch(html, /footer-link-projects/);
  assert.match(html, /previews:/);
  assert.match(html, /<a href="\/swipe" class="footer-action" data-testid="footer-link-swipe">swipe<\/a>/);
  assert.match(html, /<a href="\/swim" class="footer-action" data-testid="footer-link-swim">swim<\/a>/);
});

test('the legal links still mark the current legal page on /privacy', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/privacy' });
  assert.match(html, /<strong class="footer-current">privacy<\/strong>/);
});
