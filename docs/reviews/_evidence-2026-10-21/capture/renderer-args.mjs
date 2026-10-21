/**
 * LIN-3748 M4: sample arguments for the intercepted renderers (error / consent /
 * email / picker family). census.mjs and the beat-4 synthetic captures call
 * RENDERERS[name]() in Node, serve the HTML through Playwright request interception
 * at a real origin (real /style.css), and sweep it like any page.
 *
 * Every entry here is SYNTHETIC input to the production renderer, never a live
 * state: the report labels them so (09-26 §7.1/7.3).
 */
import * as pages from '../../../../lib/render-pages.js';
import * as email from '../../../../lib/render-email-auth.js';
import { renderAccountHomePage } from '../../../../lib/render-account-home.js';
import { renderTaskNotFoundPage } from '../../../../lib/render-task-page.js';

const TIME = '2026-10-21T00:00:00.000Z';

export const RENDERERS = {
  // lib/render-pages.js
  renderLoginPage: () => pages.renderLoginPage({}),
  renderGitHubRepoSelectPage: () => pages.renderGitHubRepoSelectPage([{ fullName: 'acme/harbour', slug: 'acme/harbour', private: false }], { login: 'octocat' }),
  renderGitHubProjectSelectPage: () => pages.renderGitHubProjectSelectPage([{ login: 'acme', number: 4, title: 'Roadmap board' }], { login: 'octocat' }),
  renderJiraSiteSelectPage: () => pages.renderJiraSiteSelectPage([{ id: 'site-1', name: 'acme', url: 'https://acme.atlassian.net' }]),
  renderMergeConfirmPage: () => pages.renderMergeConfirmPage({ identityLabel: 'octocat (GitHub)' }),
  renderMergeReauthRequiredPage: () => pages.renderMergeReauthRequiredPage({ identityLabel: 'octocat (GitHub)', reauthUrl: '/auth/github' }),
  renderOpenRouterConsentPage: () => pages.renderOpenRouterConsentPage({ urlKey: 'test-workspace' }),
  renderErrorPage: () => pages.renderErrorPage('Not Found', 'This page does not exist.', { action: 'Go back', actionUrl: '/' }),
  renderWorkspaceLimitPage: () => pages.renderWorkspaceLimitPage(),
  renderServiceUnavailablePage: () => pages.renderServiceUnavailablePage(),
  renderUpstreamAwareErrorPage: () => pages.renderUpstreamAwareErrorPage(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), { time: TIME }),
  renderWorkspaceNotFoundPage: () => pages.renderWorkspaceNotFoundPage('nope', [{ name: 'Demo Workspace', urlKey: 'demo' }]),
  // lib/render-email-auth.js (13)
  renderEmailSignInPage: () => email.renderEmailSignInPage({ nonce: 'n0nce' }),
  renderEmailSignedInPage: () => email.renderEmailSignedInPage(),
  renderEmailRegisterPage: () => email.renderEmailRegisterPage({ nonce: 'n0nce' }),
  renderEmailLinkConfirmPage: () => email.renderEmailLinkConfirmPage({ email: 'you@example.com', token: 'tok', nonce: 'n0nce' }),
  renderEmailLinkWrongBrowserPage: () => email.renderEmailLinkWrongBrowserPage({}),
  renderEmailReproofPage: () => email.renderEmailReproofPage({ email: 'you@example.com', nonce: 'n0nce' }),
  renderEmailCheckInboxPage: () => email.renderEmailCheckInboxPage(),
  renderEmailLinkExpiredPage: () => email.renderEmailLinkExpiredPage(),
  renderEmailConfirmPage: () => email.renderEmailConfirmPage({ email: 'you@example.com', token: 'tok', nonce: 'n0nce' }),
  renderEmailConfirmSignedInRefusedPage: () => email.renderEmailConfirmSignedInRefusedPage({ email: 'you@example.com' }),
  renderEmailConfirmRefusedPage: () => email.renderEmailConfirmRefusedPage({ retryUrl: '/auth/email' }),
  renderEmailSendRefusedPage: () => email.renderEmailSendRefusedPage(),
  renderEmailUnavailablePage: () => email.renderEmailUnavailablePage(),
  // other
  renderAccountHomePage: () => renderAccountHomePage({ emails: [{ address: 'you@example.com' }] }),
  renderTaskNotFoundPage: () => renderTaskNotFoundPage({ identifier: 'TEST-999', urlKey: 'test-workspace' }),
};

// Unlisted in-remit STATES reached through renderErrorPage (plan-review N4 + the research's
// unlisted-renderer list). Same production renderer, the exact copy the route sends.
export const STATES = {
  'state-held-connection-503-retry': () => pages.renderErrorPage('Connection Not Saved', 'We could not finish saving this connection. Anything already connected is unchanged. Please try again in a moment.', { action: 'Back to GitHub', actionUrl: '/connect/github/held' }),
  'state-guest-share-404': () => pages.renderErrorPage('Not Found', 'This page does not exist.'),
  'state-guest-share-503': () => pages.renderErrorPage('Task unavailable', 'This task is temporarily unavailable. Please try again shortly.'),
  'state-library-404': () => pages.renderErrorPage('Page not found', 'There is no Library document at that address.'),
  'state-upstream-429': () => pages.renderUpstreamAwareErrorPage(Object.assign(new Error('rate limited'), { status: 429 }), { time: TIME }),
  'state-upstream-5xx': () => pages.renderUpstreamAwareErrorPage(Object.assign(new Error('bad gateway'), { status: 502 }), { time: TIME }),
  'state-upstream-auth': () => pages.renderUpstreamAwareErrorPage(Object.assign(new Error('unauthorized'), { status: 401 }), { time: TIME }),
  'state-upstream-internal': () => pages.renderUpstreamAwareErrorPage(new Error('boom'), { time: TIME }),
};
