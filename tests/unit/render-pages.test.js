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
import { renderLoginPage, renderGitHubRepoSelectPage } from '../../lib/render-pages.js';

describe('renderLoginPage — GitHub CTA gating (LIN-541)', () => {
  test('shows the GitHub button when GitHub OAuth is enabled', () => {
    const html = renderLoginPage({ githubEnabled: true });
    assert.match(html, /data-testid="login-github"/);
    assert.match(html, /href="\/auth\/github"/);
    assert.match(html, /Continue with GitHub/);
  });

  test('omits the GitHub button when GitHub OAuth is not enabled', () => {
    const html = renderLoginPage({ githubEnabled: false });
    assert.doesNotMatch(html, /data-testid="login-github"/);
    // Linear login is always offered.
    assert.match(html, /href="\/auth\/linear"/);
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
});
