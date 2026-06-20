/**
 * Reusable GitHub-provider E2E harness (LIN-178).
 *
 * Mirrors the Local-provider harness (local-harness.js): it seeds an in-memory
 * fake GitHub backend and establishes a `provider: 'github'` session, so the
 * dashboard renders a GENUINE foreign backend through the real
 * getProviderForWorkspace + getWorkspaceToken read seam — no `test-token` mock
 * short-circuit, no network, no GitHub auth (the OAuth/login wiring is LIN-541).
 *
 * The workspace credential (token) is the REPO SLUG (`owner/name`) — the value
 * the GitHub provider uses to select which repo to read/write. Auth lives on the
 * fake client, exactly as the Local provider's auth lives in its store.
 */

/** urlKey of the seeded GitHub workspace. */
export const GITHUB_WORKSPACE_URL_KEY = 'github-workspace';

/** The repo slug the seeded workspace is bound to (doubles as the read token). */
export const GITHUB_REPO = 'octocat/hello-world';

/** Dashboard URL for the GitHub workspace. */
export function githubDashboardUrl(urlKey = GITHUB_WORKSPACE_URL_KEY) {
  return `/workspace/${urlKey}/`;
}

/**
 * Canonical seed for a GitHub-backed workspace, in GitHub REST shape (the fake
 * client returns these verbatim, so the provider's mapping runs unchanged):
 * one milestone (→ canonical project), one open issue (→ unstarted), one closed
 * issue (→ completed section), and a "not planned" closed issue (→ canceled).
 * Issue #1 carries two comments so the detail comments toggle has data.
 */
export const defaultGitHubSeed = {
  milestones: [
    { number: 1, title: 'Sprint 1', description: 'The first GitHub milestone', html_url: `https://github.com/${GITHUB_REPO}/milestone/1` },
  ],
  labels: [
    { name: 'bug', color: 'd73a4a' },
    { name: 'enhancement', color: 'a2eeef' },
  ],
  issues: [
    {
      number: 1, title: 'GitHub open task', body: 'An open GitHub issue', state: 'open',
      html_url: `https://github.com/${GITHUB_REPO}/issues/1`, created_at: '2026-01-01T00:00:00Z',
      user: { login: 'octocat' }, assignee: { login: 'octocat' },
      labels: [{ name: 'bug' }], milestone: { number: 1, title: 'Sprint 1' },
      comments: [
        { id: 101, body: 'First comment with **markdown**.', created_at: '2026-01-02T10:00:00Z', user: { login: 'octocat' } },
        { id: 102, body: 'Second comment with `code`.', created_at: '2026-01-03T14:30:00Z', user: { login: 'hubot' } },
      ],
    },
    {
      number: 2, title: 'GitHub shipped task', body: 'A completed GitHub issue', state: 'closed', state_reason: 'completed',
      html_url: `https://github.com/${GITHUB_REPO}/issues/2`, created_at: '2026-01-01T00:00:00Z',
      closed_at: '2026-01-04T00:00:00Z', labels: [], milestone: { number: 1, title: 'Sprint 1' },
    },
    {
      number: 3, title: 'GitHub wont-do task', body: 'A not-planned GitHub issue', state: 'closed', state_reason: 'not_planned',
      html_url: `https://github.com/${GITHUB_REPO}/issues/3`, created_at: '2026-01-01T00:00:00Z',
      closed_at: '2026-01-05T00:00:00Z', labels: [], milestone: null,
    },
  ],
};

/**
 * Seed the fake GitHub backend and establish a `provider: 'github'` session for
 * `page`. Shares the page's cookie jar so a subsequent page.goto is
 * authenticated. @returns {Promise<{urlKey, repo, dashboard}>}
 */
export async function seedGitHubWorkspace(page, seed = defaultGitHubSeed, { features } = {}) {
  const data = { ...seed };
  if (features) data.features = features;
  const resp = await page.request.post('/test/set-github-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedGitHubWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, repo: body.repo, dashboard: githubDashboardUrl(body.urlKey) };
}
