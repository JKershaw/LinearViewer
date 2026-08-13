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

/** Jira's own epic-level `issuetype` marker (LIN-2011) — `hierarchyLevel: 1`. */
const EPIC_ISSUETYPE = { id: '10000', name: 'Epic', hierarchyLevel: 1 };

/**
 * Canonical seed for a Jira Cloud site, in the REST v3 shape createFakeJiraClient
 * expects (the fake returns it close to verbatim, so the provider's mapping runs
 * unchanged): one project with three issues exercising the statusCategory
 * mapping — new (→ unstarted), indeterminate (→ started), done (→ completed) —
 * plus a native one-level subtask (best-effort parent/children), plus a native
 * epic (ENG-0) that ENG-1 is parented to (LIN-2011: epic -> canonical
 * project). ENG-0's summary is deliberately "Engineering", matching the Jira
 * PROJECT's own name — the canonical project header this fixture renders was
 * "Engineering" before LIN-2011 too (then via the Jira project, now via this
 * epic), so the many pre-existing `.project-header:has-text("Engineering")`
 * assertions stay meaningful without themselves needing to change.
 */
// LIN-2018: ENG's real per-project workflow statuses (one issue type is
// enough for this fixture's purposes) — `states()` now reads THIS, not a
// fixed synthetic vocabulary. Every seeded issue's `status`/`_transitions.to`
// below carries the matching real id, mirroring what real Jira REST payloads
// always carry.
//
// LIN-2032: carries a CUSTOM status name ('Ready for QA') and a second
// done-category status ("Won't Do", alongside 'Done') — mirroring
// `tests/unit/jira-provider.test.js`'s local `ENG_PROJECT_STATUSES`, which had
// these but this SHARED harness didn't (LIN-2018 plan item 3's fixture drift).
// Without them here, the browser/e2e lane could never reach the ambiguous
// `stateId: 'done'` 422 path (`docs/proxy-integration.md`) — only the unit
// lane, driven off the local seed, could.
export const defaultJiraProjectStatuses = {
  ENG: [
    {
      id: '1', name: 'Task', subtask: false,
      statuses: [
        { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
        { id: '102', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        { id: '103', name: 'Done', statusCategory: { key: 'done' } },
        { id: '104', name: "Won't Do", statusCategory: { key: 'done' } },
        { id: '105', name: 'Ready for QA', statusCategory: { key: 'indeterminate' } },
      ],
    },
  ],
};

export const defaultJiraSeed = {
  projects: [
    // Deliberately no `self` field: the provider's canonical project `url`
    // must come from `${site}/browse/${key}` (LIN-1885 beat 2 review finding
    // #4 — the old `project.self` REST resource URL leaked into the
    // user-facing "View in Jira →" link). A seed carrying `self` could let a
    // regression back to `project.self` pass unnoticed.
    { id: '10001', key: 'ENG', name: 'Engineering' },
  ],
  projectStatuses: defaultJiraProjectStatuses,
  issues: [
    {
      id: '10500', key: 'ENG-0',
      fields: {
        summary: 'Engineering',
        description: null,
        issuetype: EPIC_ISSUETYPE,
        status: { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2025-12-01T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null, parent: null,
      },
    },
    {
      id: '20001', key: 'ENG-1',
      fields: {
        summary: 'Jira task to do',
        // LIN-1942: the description carries a `localId` attrs key (LIN-2019
        // exception 3) so this issue is Jira-editor-shaped — proving a write
        // lane E2E can save a BENIGN issue of exactly the kind the D1 gate now
        // permits, not just an issue the gate never had an opinion on.
        description: { type: 'doc', version: 1, content: [
          { type: 'paragraph', attrs: { localId: '0647076c05f3' }, content: [{ type: 'text', text: 'A todo Jira issue.' }] },
        ] },
        status: { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: '10001', key: 'ENG', name: 'Engineering' },
        created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
        labels: [], assignee: null,
        // LIN-2011: a native team-managed epic link (ENG-0) — routes to
        // canonical `project`, not `parent` (an epic is not a subtask-parent).
        parent: { id: '10500', key: 'ENG-0', fields: { issuetype: EPIC_ISSUETYPE, summary: 'Engineering' } },
        // LIN-1942: one forward transition (To Do → In Progress), seeded so the
        // write-lane E2E can drive a genuine status move through the browser.
        // Inert for detail-nonactive-binding.spec.js's Jira read test, which
        // asserts title/description/priority-absence only. `to.id` (LIN-2018)
        // is what the provider's D2 write path now matches EXACTLY.
        _transitions: [
          { id: '31', name: 'Start Progress', to: { id: '102', name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
        ],
      },
    },
    {
      id: '20002', key: 'ENG-2',
      fields: {
        summary: 'Jira task in progress',
        description: { type: 'doc', version: 1, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'An in-progress Jira issue.' }] },
        ] },
        status: { id: '102', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
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
        status: { id: '103', name: 'Done', statusCategory: { key: 'done' } },
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
        status: { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
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
        status: { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
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
        status: { id: '101', name: 'To Do', statusCategory: { key: 'new' } },
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
export async function seedJiraWorkspace(page, seed = defaultJiraSeed, { features, authType } = {}) {
  const data = { seed };
  if (features) data.features = features;
  // LIN-1890 E6b: `authType: 'oauth'` seeds the binding shape the LIN-1890
  // landing bootstrap writes (Bearer access token + cloudId + a real finite
  // expiry) rather than Phase 1's Basic {email, apiToken}. Omitted, the fixture
  // stays byte-identical for every existing caller.
  if (authType) data.authType = authType;
  const resp = await page.request.post('/test/set-jira-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedJiraWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, site: body.site, dashboard: jiraDashboardUrl(body.urlKey) };
}
