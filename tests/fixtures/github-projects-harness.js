/**
 * Reusable GitHub Projects v2 provider E2E harness (LIN-560).
 *
 * Mirrors the GitHub Issues harness (github-harness.js): it seeds an in-memory
 * fake GitHub Projects backend and establishes a `provider: 'github-projects'`
 * session, so the dashboard renders a GENUINE board backend through the real
 * getProviderForWorkspace read seam — no `test-token` mock short-circuit, no
 * network, no GitHub auth (the project-picker/login wiring is a second session).
 *
 * The binding credential is an INSTALLATION TOKEN and the board is the binding
 * SCOPE (`org/projectNumber`). The provider authenticates per-request: the seam
 * threads `{ token, scope }` and the provider builds a request-time GraphQL client
 * from the installation token. The test route wires a `clientFactory` so that
 * request-time client resolves to the same fake backend (offline).
 */

/** urlKey of the seeded GitHub Projects workspace. */
export const GITHUB_PROJECTS_WORKSPACE_URL_KEY = 'github-projects-workspace';

/** The board slug (`org/projectNumber`) the seeded workspace's binding is scoped to. */
export const GITHUB_PROJECTS_BOARD = 'octocat/5';

/** Dashboard URL for the GitHub Projects workspace. */
export function githubProjectsDashboardUrl(urlKey = GITHUB_PROJECTS_WORKSPACE_URL_KEY) {
  return `/workspace/${urlKey}/`;
}

/**
 * Canonical seed for a GitHub Projects v2 board, in the CLEAN shape the client
 * unwraps the GraphQL envelope into (the fake returns it verbatim, so the
 * provider's mapping runs unchanged): one board with four items exercising the
 * status heuristic — In Progress (→ started), Todo (→ unstarted), Done
 * (→ completed), and a draft item with no Status (→ unstarted fallback).
 */
export const defaultGitHubProjectsSeed = {
  project: {
    id: 'PVT_board_1',
    number: 5,
    title: 'Roadmap',
    url: `https://github.com/orgs/octocat/projects/5`,
    shortDescription: 'The cross-repo roadmap board',
  },
  items: [
    {
      id: 'PVTI_open', type: 'ISSUE', status: 'In Progress',
      content: {
        number: 1, title: 'Board task in progress', body: 'An in-progress board item',
        url: `https://github.com/octocat/hello-world/issues/1`, createdAt: '2026-01-01T00:00:00Z',
        closedAt: null, author: 'octocat', assignees: ['octocat'], labels: ['bug'],
      },
    },
    {
      id: 'PVTI_todo', type: 'ISSUE', status: 'Todo',
      content: {
        number: 2, title: 'Board task to do', body: 'A todo board item',
        url: `https://github.com/octocat/hello-world/issues/2`, createdAt: '2026-01-02T00:00:00Z',
        closedAt: null, author: 'octocat', assignees: [], labels: [],
      },
    },
    {
      id: 'PVTI_done', type: 'ISSUE', status: 'Done',
      content: {
        number: 3, title: 'Board task shipped', body: 'A completed board item',
        url: `https://github.com/octocat/hello-world/issues/3`, createdAt: '2026-01-03T00:00:00Z',
        closedAt: '2026-01-05T00:00:00Z', author: 'octocat', assignees: [], labels: [],
      },
    },
    {
      id: 'PVTI_draft', type: 'DRAFT_ISSUE', status: null,
      content: {
        number: null, title: 'Draft idea', body: 'A draft with no status column',
        url: null, createdAt: '2026-01-04T00:00:00Z', closedAt: null,
        author: null, assignees: [], labels: [],
      },
    },
  ],
};

/**
 * Seed the fake GitHub Projects backend and establish a `provider:
 * 'github-projects'` session for `page`. Shares the page's cookie jar so a
 * subsequent page.goto is authenticated. @returns {Promise<{urlKey, board, dashboard}>}
 */
export async function seedGitHubProjectsWorkspace(page, seed = defaultGitHubProjectsSeed, { features } = {}) {
  const data = { seed };
  if (features) data.features = features;
  const resp = await page.request.post('/test/set-github-projects-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedGitHubProjectsWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, board: body.board, dashboard: githubProjectsDashboardUrl(body.urlKey) };
}
