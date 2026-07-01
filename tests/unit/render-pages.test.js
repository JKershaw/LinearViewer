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
import { renderLoginPage, renderGitHubRepoSelectPage, renderGitHubProjectSelectPage } from '../../lib/render-pages.js';

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
