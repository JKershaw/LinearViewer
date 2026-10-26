/**
 * LIN-3980 outcome 6: the footer suits a visitor. On `/` nothing is marked
 * current (the visitor is in no view), and the cross-view row names the
 * previews. On the previews, swipe and swim keep their current marking, and the
 * first link no longer says "projects".
 *
 * LIN-3995 outcome 1: on the previews the row names the previews too, and its
 * home link carries the same name as the preview's back link (PREVIEW_HOME_LABEL).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPageFooter, PREVIEW_HOME_LABEL } from '../../lib/components/footer.js';

test('on / nothing in the cross-view row is marked current, and the row names the previews', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/' });
  assert.doesNotMatch(html, /footer-current/);
  assert.doesNotMatch(html, /footer-link-projects/);
  assert.match(html, /previews:/);
  assert.match(html, /<a href="\/swipe" class="footer-action" data-testid="footer-link-swipe">swipe<\/a>/);
  assert.match(html, /<a href="\/swim" class="footer-action" data-testid="footer-link-swim">swim<\/a>/);
});

test('on /swipe, the row names the previews, swipe is the current view, and the home link is named as the back link', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/swipe' });
  assert.match(html, /<span class="footer-label">previews:<\/span>/);
  assert.match(html, /<strong class="footer-current" data-testid="footer-link-swipe">swipe<\/strong>/);
  assert.match(html, new RegExp(`<a href="/" class="footer-action" data-testid="footer-link-landing">${PREVIEW_HOME_LABEL}</a>`));
  assert.doesNotMatch(html, /projects/);
  assert.doesNotMatch(html, />landing</);
});

test('on /swim, the row names the previews and swim is the current view', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/swim' });
  assert.match(html, /<span class="footer-label">previews:<\/span>/);
  assert.match(html, /<strong class="footer-current" data-testid="footer-link-swim">swim<\/strong>/);
  assert.match(html, new RegExp(`data-testid="footer-link-landing">${PREVIEW_HOME_LABEL}</a>`));
});

test('the legal links still mark the current legal page on /privacy', () => {
  const html = renderPageFooter({ isLanding: true, currentPage: '/privacy' });
  assert.match(html, /<strong class="footer-current">privacy<\/strong>/);
});
