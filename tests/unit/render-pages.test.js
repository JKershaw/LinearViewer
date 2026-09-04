/**
 * Unit tests for the standalone page renderers touched by GitHub login (LIN-541):
 *   - renderLoginPage gates the "Continue with GitHub" button on OAuth config;
 *   - renderGitHubRepoSelectPage renders the post-OAuth repo picker (and the
 *     empty-account fallback), with option values escaped.
 *
 * Run with: node --test tests/unit/render-pages.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderLoginPage, renderGitHubRepoSelectPage, renderGitHubProjectSelectPage, renderMergeConfirmPage, renderMergeReauthRequiredPage, renderOpenRouterConsentPage } from '../../lib/render-pages.js';

describe('renderLoginPage — GitHub CTA gating (LIN-541)', () => {
  test('shows the GitHub button when GitHub OAuth is enabled', () => {
    const html = renderLoginPage({ githubEnabled: true });
    assert.match(html, /data-testid="login-github"/);
    assert.match(html, /href="\/auth\/github"/);
    assert.match(html, /Continue with GitHub/);
  });

  test('GitHub CTA carries a distinct class so it is styled apart from the primary login CTA (LIN-860)', () => {
    const html = renderLoginPage({ githubEnabled: true });
    // The GitHub CTA reuses the base .login-button but must also carry the
    // .login-button-github differentiation hook (filled brand vs. outline).
    assert.match(html, /class="login-button login-button-github"/);
  });

  test('omits the GitHub button when GitHub OAuth is not enabled', () => {
    const html = renderLoginPage({ githubEnabled: false });
    assert.doesNotMatch(html, /data-testid="login-github"/);
    // Linear login is always offered.
    assert.match(html, /href="\/auth\/linear"/);
  });
});

describe('renderGitHubProjectSelectPage (LIN-560 Session 2)', () => {
  const boards = [
    { login: 'octocat', number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5' },
    { login: 'octocat', number: 7, title: 'Bugs' },
  ];

  test('renders a board picker form posting to the Projects link route', () => {
    const html = renderGitHubProjectSelectPage(boards, { mode: 'new', login: 'octocat' });
    assert.match(html, /action="\/auth\/github-projects\/link"/);
    assert.match(html, /data-testid="github-projects-board-select"/);
    // Option value is the org/projectNumber slug; label folds in the board title.
    assert.match(html, /<option value="octocat\/5">Roadmap \(octocat\/5\)<\/option>/);
    assert.match(html, /Installed for octocat/);
  });

  test('uses add-source heading when linking onto an existing workspace', () => {
    const html = renderGitHubProjectSelectPage(boards, { mode: 'add-source', login: 'octocat' });
    assert.match(html, /Add a GitHub project board/);
  });

  test('empty state names the Projects (read) permission prerequisite (no form)', () => {
    const html = renderGitHubProjectSelectPage([], { mode: 'new', login: 'octocat' });
    assert.match(html, /Projects \(read\)/);
    assert.doesNotMatch(html, /github-projects-board-form/);
  });

  test('escapes board slugs/titles to prevent injection', () => {
    const html = renderGitHubProjectSelectPage([{ login: 'a', number: 1, title: '<b>x</b>' }], {});
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});

describe('renderGitHubRepoSelectPage (LIN-541)', () => {
  const repos = [
    { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false },
    { slug: 'octocat/secret', name: 'octocat/secret', private: true },
  ];

  test('renders a repo picker form posting to the link route', () => {
    const html = renderGitHubRepoSelectPage(repos, { mode: 'new', login: 'octocat' });
    assert.match(html, /action="\/auth\/github\/link"/);
    assert.match(html, /data-testid="github-repo-select"/);
    assert.match(html, /<option value="octocat\/hello-world">/);
    // private repos are annotated
    assert.match(html, /octocat\/secret \(private\)/);
    // signed-in identity surfaced
    assert.match(html, /octocat/);
  });

  test('uses add-source heading when linking onto an existing workspace', () => {
    const html = renderGitHubRepoSelectPage(repos, { mode: 'add-source', login: 'octocat' });
    assert.match(html, /Add a GitHub repository/);
  });

  test('shows a no-repositories fallback (no form) for an empty account', () => {
    const html = renderGitHubRepoSelectPage([], { mode: 'new', login: 'octocat' });
    assert.match(html, /No repositories were found/);
    assert.doesNotMatch(html, /github-repo-form/);
  });

  test('escapes option values to prevent injection', () => {
    const html = renderGitHubRepoSelectPage([{ slug: 'a/<b>', name: 'a/<b>' }], {});
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;b&gt;/);
  });

  // Already-installed re-bind path (LIN-728): repos may carry an installationId.
  test('keeps a flat option list (no optgroups) for a single installation', () => {
    const single = [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
      { slug: 'octocat/secret', name: 'octocat/secret', private: true, installationId: '77' },
    ];
    const html = renderGitHubRepoSelectPage(single, { mode: 'new' });
    assert.doesNotMatch(html, /<optgroup/);
    assert.match(html, /<option value="octocat\/hello-world">/);
  });

  test('groups options by account when repos span more than one installation (LIN-728)', () => {
    const multi = [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
      { slug: 'acme/widgets', name: 'acme/widgets', private: false, installationId: '88' },
    ];
    const html = renderGitHubRepoSelectPage(multi, { mode: 'new' });
    assert.match(html, /<optgroup label="octocat">/);
    assert.match(html, /<optgroup label="acme">/);
    // Still submits only the repo slug — server maps repo -> installation.
    assert.match(html, /<option value="octocat\/hello-world">/);
    assert.match(html, /<option value="acme\/widgets">/);
  });
});

describe('renderMergeConfirmPage — differentiated consent actions (LIN-2400)', () => {
  test('the decline button carries the differentiated-secondary hook; the merge button stays the plain primary', () => {
    const html = renderMergeConfirmPage({ identityLabel: 'Linear' });
    // Mirrors the login-github assertion above: same chromeless-outline hook,
    // reused here to keep the irreversible merge action from reading
    // identically to its safe decline (both were plain .login-button before).
    assert.match(html, /class="login-button" data-testid="merge-confirm-submit"/);
    assert.match(html, /class="login-button login-button-secondary" data-testid="merge-decline-submit"/);
  });

  test('LIN-2497: the OpenRouter consent page uses the SAME hook, in the same direction', () => {
    // Introduced plain in 2392a537 (LIN-2412), after LIN-2400 was filed, so
    // both choices were pixel-identical apart from label length. Asserting
    // DIRECTION, not mere difference (LIN-2400 review F1): the grant is the
    // filled primary, the decline the chromeless outline.
    const html = renderOpenRouterConsentPage({ urlKey: 'acme' });
    assert.match(html, /class="login-button" data-testid="openrouter-consent-grant-submit"/);
    assert.match(html, /class="login-button login-button-secondary" data-testid="openrouter-consent-decline-submit"/);
  });

  // LIN-2496 — the exit asymmetry between merge-confirm and its reauth sibling,
  // settled as a decision rather than closed as a bug. Pinned so nobody
  // "restores consistency" by adding a link that strands session state.
  test('LIN-2496: merge-confirm offers exactly two exits, both of which clear pendingMerge', () => {
    const html = renderMergeConfirmPage({ identityLabel: 'Linear' });
    // No bare navigation link. Its decline button IS the safe way out —
    // POST /auth/merge/decline deletes pendingMerge and redirects to '/'
    // (routes/account-merge.js) — whereas an <a href="/"> would leave the
    // offer stranded in the session while the other two exits clear it.
    assert.doesNotMatch(html, /error-home-link/);
    assert.match(html, /action="\/auth\/merge\/confirm"/);
    assert.match(html, /action="\/auth\/merge\/decline"/);
  });

  test('LIN-2496: the reauth sibling DOES keep its home link — it has no decline to fall back on', () => {
    // The contrast that makes the asymmetry deliberate: this page sets no
    // pendingMerge (lib/account-conflict.js returns before the assignment), and
    // its only action is "Sign in again", so the home link is the only exit for
    // a user who does not want to re-authenticate.
    const html = renderMergeReauthRequiredPage({ identityLabel: 'Linear', reauthUrl: '/auth/linear' });
    assert.match(html, /class="error-home-link"/);
    assert.doesNotMatch(html, /action="\/auth\/merge\/decline"/);
  });

  test('behaviour is unchanged: same routes, form structure, testids, and copy', () => {
    const html = renderMergeConfirmPage({ identityLabel: 'Linear' });
    assert.match(html, /<form action="\/auth\/merge\/confirm" method="POST" class="github-repo-form" data-testid="merge-confirm-form">/);
    assert.match(html, /<form action="\/auth\/merge\/decline" method="POST" class="github-repo-form" data-testid="merge-decline-form">/);
    assert.match(html, />Yes, merge these accounts</);
    assert.match(html, />No, keep them separate</);
  });
});
