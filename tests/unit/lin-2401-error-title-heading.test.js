/**
 * LIN-2401: every `.error-title` surface in lib/render-pages.js must expose the
 * page's actual subject as a real heading, not a plain `<div>` — otherwise
 * screen-reader heading navigation only ever reaches the "Harbour" chrome
 * `<h1>` and never the reason the page exists.
 *
 * Covers all 9 sites (re-grounded against HEAD: the ticket's research counted
 * 8, but LIN-2412 (#1307, landed 2026-08-30 after this ticket was created)
 * added renderOpenRouterConsentPage with its own `.error-title` div, making 9).
 *
 * Run with: node --test tests/unit/lin-2401-error-title-heading.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  renderGitHubRepoSelectPage,
  renderGitHubProjectSelectPage,
  renderJiraLinkForm,
  renderJiraSiteSelectPage,
  renderMergeConfirmPage,
  renderMergeReauthRequiredPage,
  renderOpenRouterConsentPage,
  renderErrorPage,
  renderWorkspaceNotFoundPage,
} from '../../lib/render-pages.js';

// A real heading element (h1-h6) OR role="heading" with a numeric aria-level.
const HEADING_TAG_RE = /<(h[1-6])\b[^>]*class="[^"]*\berror-title\b[^"]*"[^>]*>/i;
const HEADING_ROLE_RE = /<[a-z0-9]+\b[^>]*class="[^"]*\berror-title\b[^"]*"[^>]*role="heading"[^>]*aria-level="\d+"/i;
const PLAIN_DIV_RE = /<div\b[^>]*class="[^"]*\berror-title\b[^"]*"[^>]*>(?!.*(?:role="heading"))/i;

function assertExposedAsHeading(html, label) {
  const isHeadingTag = HEADING_TAG_RE.test(html);
  const isAriaHeading = HEADING_ROLE_RE.test(html);
  assert.ok(
    isHeadingTag || isAriaHeading,
    `${label}: .error-title must be a real heading (h1-h6, or role="heading" + aria-level) — got: ${html.match(/<[a-z0-9]+\b[^>]*class="[^"]*error-title[^"]*"[^>]*>/i)?.[0]}`
  );
  assert.ok(
    !PLAIN_DIV_RE.test(html),
    `${label}: .error-title must not render as a plain, non-heading <div>`
  );
}

test('renderGitHubRepoSelectPage — subject exposed as a heading', () => {
  const html = renderGitHubRepoSelectPage([{ slug: 'a/b', name: 'a/b' }], { mode: 'new' });
  assertExposedAsHeading(html, 'renderGitHubRepoSelectPage');
});

test('renderGitHubProjectSelectPage — subject exposed as a heading', () => {
  const html = renderGitHubProjectSelectPage([{ login: 'a', number: 1, title: 't' }], { mode: 'new' });
  assertExposedAsHeading(html, 'renderGitHubProjectSelectPage');
});

test('renderJiraLinkForm — subject exposed as a heading', () => {
  const html = renderJiraLinkForm({ workspaceUrlKey: 'acme' });
  assertExposedAsHeading(html, 'renderJiraLinkForm');
});

test('renderJiraSiteSelectPage — subject exposed as a heading', () => {
  const html = renderJiraSiteSelectPage([{ cloudId: '1', url: 'https://x', name: 'X' }]);
  assertExposedAsHeading(html, 'renderJiraSiteSelectPage');
});

test('renderMergeConfirmPage — subject exposed as a heading', () => {
  const html = renderMergeConfirmPage({ identityLabel: 'GitHub' });
  assertExposedAsHeading(html, 'renderMergeConfirmPage');
});

test('renderMergeReauthRequiredPage — subject exposed as a heading', () => {
  const html = renderMergeReauthRequiredPage({ identityLabel: 'GitHub', reauthUrl: '/auth/linear' });
  assertExposedAsHeading(html, 'renderMergeReauthRequiredPage');
});

test('renderOpenRouterConsentPage — subject exposed as a heading (LIN-2412 site, post-ticket addition)', () => {
  const html = renderOpenRouterConsentPage({ urlKey: 'acme' });
  assertExposedAsHeading(html, 'renderOpenRouterConsentPage');
});

test('renderErrorPage — subject exposed as a heading', () => {
  const html = renderErrorPage('Something Broke', 'It broke.');
  assertExposedAsHeading(html, 'renderErrorPage');
});

test('renderWorkspaceNotFoundPage — subject exposed as a heading', () => {
  const html = renderWorkspaceNotFoundPage('missing-key', []);
  assertExposedAsHeading(html, 'renderWorkspaceNotFoundPage');
});

test('heading level stays subordinate to the page chrome <h1>Harbour</h1> (no duplicate h1)', () => {
  const html = renderErrorPage('Something Broke', 'It broke.');
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  assert.strictEqual(h1Count, 1, 'expected exactly one <h1> (the "Harbour" chrome) per page');
  assert.match(html, /<h1>Harbour<\/h1>/);
});
