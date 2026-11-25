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
 * LIN-4567 moved the subject up: the public frame's one h1 is the page's name (see assertExposedAsHeading).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-2401-error-title-heading.test.js
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

// LIN-4567 (LIN-4342 piece 6): the page sits in the public frame, whose one h1 is the page's own name. The subject that
// LIN-2401 promoted to an `.error-title` h2 under a "Harbour" h1 is that h1 now: still a real heading, and the first.
function assertExposedAsHeading(html, label, subject) {
  const h1s = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  assert.strictEqual(h1s.length, 1, `${label}: exactly one <h1>`);
  if (subject) assert.match(h1s[0], new RegExp(`>${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`), `${label}: the h1 names the subject`);
  assert.doesNotMatch(html, /<h1>Harbour<\/h1>/, `${label}: "Harbour" is the wordmark, never the h1`);
  assert.doesNotMatch(html, /\berror-title\b/, `${label}: no second heading for the subject`);
}

test('renderGitHubRepoSelectPage — subject exposed as a heading', () => {
  const html = renderGitHubRepoSelectPage([{ slug: 'a/b', name: 'a/b' }], { mode: 'new' });
  assertExposedAsHeading(html, 'renderGitHubRepoSelectPage', 'Choose a GitHub repository');
});

test('renderGitHubProjectSelectPage — subject exposed as a heading', () => {
  const html = renderGitHubProjectSelectPage([{ login: 'a', number: 1, title: 't' }], { mode: 'new' });
  assertExposedAsHeading(html, 'renderGitHubProjectSelectPage', 'Choose a GitHub project board');
});

test('renderJiraLinkForm — subject exposed as a heading', () => {
  const html = renderJiraLinkForm({ workspaceUrlKey: 'acme' });
  assertExposedAsHeading(html, 'renderJiraLinkForm', 'Connect Jira');
});

test('renderJiraSiteSelectPage — subject exposed as a heading', () => {
  const html = renderJiraSiteSelectPage([{ cloudId: '1', url: 'https://x', name: 'X' }]);
  assertExposedAsHeading(html, 'renderJiraSiteSelectPage', 'Choose a Jira site');
});

test('renderMergeConfirmPage — subject exposed as a heading', () => {
  const html = renderMergeConfirmPage({ identityLabel: 'GitHub' });
  assertExposedAsHeading(html, 'renderMergeConfirmPage', 'Merge these accounts?');
});

test('renderMergeReauthRequiredPage — subject exposed as a heading', () => {
  const html = renderMergeReauthRequiredPage({ identityLabel: 'GitHub', reauthUrl: '/auth/linear' });
  assertExposedAsHeading(html, 'renderMergeReauthRequiredPage', 'Sign in again to confirm');
});

test('renderOpenRouterConsentPage — subject exposed as a heading (LIN-2412 site, post-ticket addition)', () => {
  const html = renderOpenRouterConsentPage({ urlKey: 'acme' });
  assertExposedAsHeading(html, 'renderOpenRouterConsentPage', 'Connect OpenRouter');
});

test('renderErrorPage — subject exposed as a heading', () => {
  const html = renderErrorPage('Something Broke', 'It broke.');
  assertExposedAsHeading(html, 'renderErrorPage', 'Something Broke');
});

test('renderWorkspaceNotFoundPage — subject exposed as a heading', () => {
  const html = renderWorkspaceNotFoundPage('missing-key', []);
  assertExposedAsHeading(html, 'renderWorkspaceNotFoundPage', 'Workspace Not Found');
});

test('the subject is the page\'s one h1 and its tab title (LIN-4567: the public frame)', () => {
  const html = renderErrorPage('Something Broke', 'It broke.');
  assert.strictEqual((html.match(/<h1\b/gi) || []).length, 1, 'exactly one <h1> per page');
  assert.match(html, /<h1>Something Broke<\/h1>/);
  assert.match(html, /<title>Something Broke · Harbour<\/title>/);
});
