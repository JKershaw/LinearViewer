/**
 * Reusable Jira Cloud provider E2E harness (LIN-1885, Phase 1 of LIN-275).
 *
 * Mirrors the GitHub Projects harness (github-projects-harness.js): it seeds
 * an in-memory fake Jira backend and establishes a `provider: 'jira'` session,
 * so the dashboard renders a GENUINE second-backend proof through the real
 * getProviderForWorkspace + getWorkspaceCallScope read seam — no `test-token`
 * mock short-circuit, no network, no live Jira credential.
 *
 * The binding credential is `{email, apiToken}` and the SITE is the binding
 * SCOPE (mirrors GitHub Projects' `{token, scope}` shape, substituting Jira's
 * three-field Basic-auth credential — see JiraProvider._clientFor). The test
 * route wires a `clientFactory` so the provider's per-request client resolves
 * to the same fake backend (offline).
 */

/** urlKey of the seeded Jira workspace. */
export const JIRA_WORKSPACE_URL_KEY = 'jira-workspace';

/** The Jira Cloud site the seeded workspace's binding is scoped to. */
export const JIRA_SITE = 'https://acme.atlassian.net';

/** Dashboard URL for the Jira workspace. */
export function jiraDashboardUrl(urlKey = JIRA_WORKSPACE_URL_KEY) {
  return `/workspace/${urlKey}/`;
}

/**
 * Canonical seed for a Jira Cloud site, in the REST v3 shape createFakeJiraClient
 * expects (the fake returns it close to verbatim, so the provider's mapping runs
 * unchanged): one project with three issues exercising the statusCategory
 * mapping — new (→ unstarted), indeterminate (→ started), done (→ completed) —
 * plus a native one-level subtask (best-effort parent/children).
 */
export const defaultJiraSeed = {
  projects: [
    // Deliberately no `self` field: the provider's canonical project `url`
    // must come from `${site}/browse/${key}` (LIN-1885 beat 2 review finding
    // #4 — the old `project.self` REST resource URL leaked into the
    // user-facing "View in Jira →" link). A seed carrying `self` could let a
    // regression back to `project.self` pass unnoticed.
    { id: '10001', key: 'ENG', name: 'Engineering' },
  ],
  issues: [
    {
      id: '20001', key: 'ENG-1',
      fields: {
        summary: 'Jira task to do',
        description: { type: 'doc', version: 1, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A todo Jira issue.' }] },
        ] },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    },
    {
      id: '20002', key: 'ENG-2',
      fields: {
        summary: 'Jira task in progress',
        description: { type: 'doc', version: 1, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'An in-progress Jira issue.' }] },
        ] },
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-02T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: ['bug'], assignee: { displayName: 'Ada Lovelace' }, parent: null,
        _comments: [
          { id: '1', body: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Investigating.' }] },
          ] }, created: '2026-01-02T12:00:00.000Z', author: { displayName: 'Ada Lovelace' } },
        ],
      },
    },
    {
      id: '20003', key: 'ENG-3',
      fields: {
        summary: 'Jira task shipped',
        description: null,
        status: { name: 'Done', statusCategory: { key: 'done' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-03T00:00:00.000Z', duedate: null, resolutiondate: '2026-01-05T00:00:00.000Z',
        labels: [], assignee: null, parent: null,
      },
    },
    {
      id: '20004', key: 'ENG-4',
      fields: {
        summary: 'Subtask of the in-progress task',
        description: null,
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-04T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: { id: '20002', key: 'ENG-2' },
      },
    },
    // LIN-1886 (Phase 2, write path): two issues whose description ADF carries
    // content the write-side D1 policy (adfHasUnrenderableContent) must refuse
    // to overwrite — one via an unmodeled NODE, one via an unmodeled MARK only
    // (no unmodeled node anywhere), so both refusal branches have a live seed
    // to drive an E2E "editing this issue's description is refused" spec
    // against, not just the unit-level fake-client coverage.
    {
      id: '20005', key: 'ENG-5',
      fields: {
        summary: 'Issue with a table in its description',
        description: { type: 'doc', version: 1, content: [
          { type: 'table', content: [] },
        ] },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-05T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    },
    {
      id: '20006', key: 'ENG-6',
      fields: {
        summary: 'Issue with an underline mark in its description',
        description: { type: 'doc', version: 1, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'underlined', marks: [{ type: 'underline' }] }] },
        ] },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-06T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    },
  ],
};

/**
 * Seed the fake Jira backend and establish a `provider: 'jira'` session for
 * `page`. Shares the page's cookie jar so a subsequent page.goto is
 * authenticated. @returns {Promise<{urlKey, site, dashboard}>}
 */
export async function seedJiraWorkspace(page, seed = defaultJiraSeed, { features } = {}) {
  const data = { seed };
  if (features) data.features = features;
  const resp = await page.request.post('/test/set-jira-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedJiraWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, site: body.site, dashboard: jiraDashboardUrl(body.urlKey) };
}
