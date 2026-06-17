/**
 * Reusable local-provider test harness (LIN-378).
 *
 * Promotes the LIN-356 seeding flow into shared helpers so specs can ride a
 * GENUINE second provider instead of the
 * `NODE_ENV === 'test' && accessToken === 'test-token'` mock short-circuit
 * (which returns `testMockData`). Two consumers share ONE canonical seed:
 *
 *   - Unit tests: createLocalStore() / createLocalProvider() build an in-memory
 *     LocalStore (+ provider) over the mock collection — no server, no session.
 *   - Playwright E2E: seedLocalWorkspace(page, seed?) POSTs the seed to
 *     /test/set-local-session, which seeds the REAL LocalStore and establishes a
 *     `provider: 'local'` session whose token is its own urlKey. The dashboard
 *     then renders from the store via the real getProviderForWorkspace +
 *     getWorkspaceToken read seam — no mock fires.
 *
 * Boundary (LIN-378): flows the local provider deliberately does NOT model stay
 * on the Linear `test-token` path and must NOT be migrated here:
 *   - OAuth / PAT auth bootstrap        (auth.spec, pat-auth.spec, openrouter-auth.spec)
 *   - the Linear API proxy contract     (proxy.spec, proxy-toggle-copy.spec)
 *   - the dispatch API contract         (dispatch.spec; provider re-point of the
 *     proxy data-fetch tracked under LIN-306)
 *   - cycles / teams / estimate-driven surfaces (the provider declares these off)
 *   - the boundary (pinned) cases of two mixed-harness specs (LIN-428): the
 *     Team-Filtering (teams off) + OAuth-error cases of error-handling.spec, and
 *     the multi-workspace switch / removal / max-workspaces cases of
 *     workspace.spec (the single-workspace local harness cannot represent
 *     `multiWorkspace`/`maxWorkspaces`)
 *   - visual-regression specs (tests/visual/*) — pinned to the mock fixtures so
 *     the committed reference screenshots stay byte-stable
 * Migrate a spec onto this harness only when the local provider fully backs the
 * surface under test. Migrated so far: dashboard, swim (lanes/flow/vertical),
 * ship (+ orientation mode), interactions/detail (incl. the comments toggle), the
 * swipe surface (page, dispatched sessions, and the recap/brief accordions —
 * LIN-427), the workspace-api cluster (LIN-403..412): recap, brief,
 * recommend/streaming, prompts, custom-prompts, and the workspace-model UI path,
 * and the migrated subsets of two mixed-harness boundary specs (LIN-428):
 * error-handling.spec's Input-Validation + Session-State cases and
 * workspace.spec's two single-workspace selector cases.
 *
 * The detail-surface comments path is now fully provider-backed, so its
 * `routes/workspace-api.js` `testMockData` data-mock branch was orphaned and
 * deleted (LIN-413). With swipe migrated (LIN-427), the recap / brief mock
 * branches no longer back any test-token surface and are now orphaned too, but
 * their deletion is owned by sibling work — they are NOT removed here. The other
 * workspace-api mock branches are still live, serving UNMIGRATED test-token
 * surfaces that share the same endpoints:
 *   - free-tier suggest button + GET (free-tier.spec)  → recommend (stream + GET)
 *   - feature-toggles (feature-toggles.spec)           → prompt
 *   - autopilot kickoff (proxy.spec)                   → autopilot prompt endpoint
 *   - roadmap generate (roadmap.spec)                  → roadmap data branch
 *   - audit (option b, LIN-412)                        → retained by design
 * The remaining cross-surface `testMockData` branches are now the PERMANENT
 * boundary, not migration leftovers (LIN-385 closed; LIN-390 was S4, last):
 *   - server.js:462 (`fetchAndPrepareProjects`, the shared authed-render seam) is
 *     co-owned: its `mockOverride` arm feeds the swim/ship VISUAL specs
 *     (swim-sample-data.js — `swimSampleData`/`shipDenseSampleData`, NOT
 *     mock-data.js), and its `testMockData` arm backs the LIN-428 boundary E2E
 *     (workspace multiWorkspace/maxWorkspaces, error-handling Team-Filtering,
 *     dispatch Queue).
 *   - server.js:1331 (dispatch page) is pinned by dispatch.spec's Custom Prompt
 *     Dispatch case.
 *   - routes/proxy.js stays for the Linear API proxy + agent-status contract (provider
 *     re-point tracked under LIN-306).
 * `mock-data.js`/`testMockData` is therefore co-owned by proxy.spec + the boundary
 * E2E and is NOT retireable; `swim-sample-data.js` stays for the visual arm.
 * `routes/pipeline.js` no longer has a mock branch (deleted in S1, LIN-387) and
 * the server.js roadmap branch was orphaned (roadmap.spec migrated in LIN-409) and
 * deleted in S4 (LIN-390).
 */
import { LocalStore } from '../../lib/local-store.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createMockCollection } from './mock-collection.js';
import { swimSampleProjects, swimSampleIssues } from './swim-sample-data.js';
import { testMockData } from './mock-data.js';

/** urlKey of the seeded local workspace; doubles as its store partition key. */
export const LOCAL_WORKSPACE_URL_KEY = 'local-workspace';

/** Dashboard URL for a (default: the) local workspace. */
export function localDashboardUrl(urlKey = LOCAL_WORKSPACE_URL_KEY) {
  return `/workspace/${urlKey}/`;
}

/**
 * Canonical seed for a local-backed workspace — the single source of truth for
 * both the route default (routes/test.js) and the E2E helper. Shaped to back the
 * dashboard surface: two projects, an in-progress parent with a todo child, a
 * completed issue (→ completed section), and a second in-progress task in the
 * other project. Counts derived from this seed (used by the dashboard spec):
 *   .state.in-progress = 4   (issue-1 + issue-4, each in the In Progress section
 *                             AND its project section)
 *   .state.todo        = 2   (the child, in both sections)
 *   .state.done        = 1   (issue-3, in the completed section)
 *   In Progress lines  = 3   (issue-1, its child issue-2, issue-4)
 * issue-1 carries two comments (Alice, Bob) so the detail surface's comments
 * toggle has something to load through fetchIssueComments.
 *
 * Project names are kept substring-distinct ("Local Project" vs "Local Beta") so
 * `:has-text("Local Project")` matches a single header (no strict-mode clash).
 */
export const defaultLocalSeed = {
  projects: [
    { id: 'local-proj-1', name: 'Local Project', content: 'A local backend project', sortOrder: 1 },
    { id: 'local-proj-2', name: 'Local Beta', content: 'A second local project', sortOrder: 2 },
  ],
  issues: [
    { id: 'local-issue-1', identifier: 'LOCAL-1', title: 'Local parent task', description: 'Seeded parent', projectId: 'local-proj-1', sortOrder: 1, state: { name: 'In Progress', type: 'started' }, labels: ['local-label'], url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-1`, comments: [
      { id: 'local-comment-1', body: 'This is a test comment with **markdown**.', createdAt: '2024-01-15T10:00:00Z', user: 'Alice' },
      { id: 'local-comment-2', body: 'Second comment with `code`.', createdAt: '2024-01-16T14:30:00Z', user: 'Bob' },
    ] },
    { id: 'local-issue-2', identifier: 'LOCAL-2', title: 'Local child task', description: 'Seeded child', projectId: 'local-proj-1', parentId: 'local-issue-1', sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-2` },
    { id: 'local-issue-3', identifier: 'LOCAL-3', title: 'Local done task', description: 'Seeded done', projectId: 'local-proj-1', sortOrder: 3, state: { name: 'Done', type: 'completed' }, completedAt: '2024-01-10T00:00:00Z', url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-3` },
    { id: 'local-issue-4', identifier: 'LOCAL-4', title: 'Second project task', description: 'Seeded second-project task', projectId: 'local-proj-2', sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-4` },
  ],
};

/**
 * Convert a Linear-shaped fixture (`{ projects, issues }` as mock-data.js /
 * swim-sample-data.js export them) into the LocalStore seed shape:
 * `parent/project` objects flatten to `parentId/projectId`, `labels.nodes`
 * flattens to a name array, `relations.nodes` flattens to
 * `[{ type, relatedIssueId }]`, and team is dropped (the local provider has no
 * teams). URLs are rewritten to local workspace paths — the local provider owns
 * its own links, so seeded data must not point at linear.app.
 */
export function localSeedFromLinearFixture({ projects, issues }, urlKey = LOCAL_WORKSPACE_URL_KEY) {
  return {
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      content: p.content ?? null,
      sortOrder: p.sortOrder ?? 0,
    })),
    issues: issues.map(i => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description ?? '',
      estimate: i.estimate ?? null,
      priority: i.priority ?? 0,
      sortOrder: i.sortOrder ?? 0,
      createdAt: i.createdAt,
      dueDate: i.dueDate ?? null,
      completedAt: i.completedAt ?? null,
      parentId: i.parent?.id ?? null,
      projectId: i.project?.id ?? null,
      state: i.state,
      assignee: i.assignee ?? null,
      labels: (i.labels?.nodes || []).map(l => l.name),
      relations: (i.relations?.nodes || [])
        .map(r => ({ type: r.type, relatedIssueId: r.relatedIssue?.id }))
        .filter(r => r.relatedIssueId),
      url: `/workspace/${urlKey}/issue/${i.id}`,
    })),
  };
}

/**
 * The swim/ship sample fixture as a local seed: 4 projects, ~20 issues with
 * deep blocking chains, nested subtask groups, and labels — everything the
 * dependency-driven views (swim lanes/flow, ship sectors) need. Backed by the
 * relations surfaced through LocalProvider._toCanonicalIssue (LIN-378).
 */
export const swimLocalSeed = localSeedFromLinearFixture({
  projects: swimSampleProjects,
  issues: swimSampleIssues,
});

/**
 * The pipeline mock fixture as a local seed (LIN-387). Reuses the SAME
 * `testMockData` the old `routes/pipeline.js` mock branch returned, so the
 * migrated pipeline specs assert on identical data — TEST-1 'Parent task in
 * progress' (started) parenting TEST-2 (unstarted) → parentChain, the started
 * leaves TEST-14 'Add pagination to user list' / TEST-15 (started), and the
 * backlog/unstarted queue items (TEST-5/6/13) with priorities. Team is dropped
 * (local has no teams; pipeline does not filter by team) and URLs rewrite to
 * local paths (the overlay test asserts link *text*, not href).
 */
export const pipelineLocalSeed = localSeedFromLinearFixture(testMockData);

/**
 * Same-identity alias of `pipelineLocalSeed` for the workspace-api migration
 * cluster (LIN-402, parent LIN-388). The cluster (LIN-403..413) imports this
 * semantically-named seed rather than `pipelineLocalSeed` directly, so its seed
 * source can later evolve in ONE place. Today it MUST NOT diverge — aliasing the
 * object (not re-deriving via `localSeedFromLinearFixture`) makes divergence
 * structurally impossible and guarantees migrated specs reproduce the pipeline
 * fixture's data byte-for-byte.
 */
export const workspaceApiLocalSeed = pipelineLocalSeed;

/**
 * Bespoke seed for the search spec (LIN-426). Derives from `testMockData` so the
 * data stays byte-faithful to what the old `/test/set-session` mock served, then
 * narrows to the exact subset the 13 search cases exercise: projects
 * `proj-alpha`/`proj-beta` and issues `issue-1..5`. Seeding the EXACT ids the
 * spec's selectors already use (`.project[data-id="proj-alpha"]`,
 * `.node[data-id="issue-2"]`, …) means zero selector churn and byte-identical
 * assertions. The route through `localSeedFromLinearFixture` preserves the two
 * coverage-critical shapes: assignee as an object (`issue-4` → `{ name: 'Charlie' }`,
 * for the assignee-search case) and labels round-tripping to `labels.nodes[].name`
 * (`issue-4` → `urgent`, for the label-search case). The `issue-2 → issue-1`
 * parent link (ancestor-match case) flattens to `parentId` via the fixture
 * converter. `testMockData`/mock-data.js itself is untouched (S2/S4-owned).
 */
const SEARCH_PROJECT_IDS = new Set(['proj-alpha', 'proj-beta']);
const SEARCH_ISSUE_IDS = new Set(['issue-1', 'issue-2', 'issue-3', 'issue-4', 'issue-5']);
export const searchLocalSeed = localSeedFromLinearFixture({
  projects: testMockData.projects.filter(p => SEARCH_PROJECT_IDS.has(p.id)),
  issues: testMockData.issues.filter(i => SEARCH_ISSUE_IDS.has(i.id)),
});

// ---------------------------------------------------------------------------
// Unit-side helpers — in-memory collection + LocalStore (no server/session).
// ---------------------------------------------------------------------------

/**
 * Build a LocalStore over a fresh in-memory mock collection.
 * @returns {{ store: LocalStore, collection: object }}
 */
export function createLocalStore() {
  const collection = createMockCollection();
  return { store: new LocalStore({ collection }), collection };
}

/**
 * Build a LocalProvider wired to a fresh in-memory LocalStore.
 * @returns {{ provider: LocalProvider, store: LocalStore, collection: object }}
 */
export function createLocalProvider() {
  const { store, collection } = createLocalStore();
  return { provider: new LocalProvider({ store }), store, collection };
}

// ---------------------------------------------------------------------------
// Playwright-side helper — seed the real store + establish a local session.
// ---------------------------------------------------------------------------

/**
 * Seed the local store and establish a `provider: 'local'` session for `page`.
 * Shares the page's cookie jar (so a subsequent page.goto is authenticated) and
 * returns the workspace urlKey plus its dashboard URL.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{projects?: Array, issues?: Array}} [seed] - defaults to defaultLocalSeed
 * @param {{features?: Object, openRouterConnected?: boolean, freeTierEnabled?: boolean}} [options] -
 *   session feature flags (whitelist-validated server-side); `openRouterConnected`
 *   to provision a mock OpenRouter key on the local session (so e.g. roadmap specs
 *   reach the AI mock instead of resolveRoadmapLLM's 503); and `freeTierEnabled` to
 *   simulate free-tier mode (no key, session flag) for the recommend free-tier
 *   block (LIN-405).
 * @returns {Promise<{urlKey: string, dashboard: string}>}
 */
export async function seedLocalWorkspace(page, seed = defaultLocalSeed, { features, openRouterConnected, freeTierEnabled } = {}) {
  const data = { ...seed };
  if (features) data.features = features;
  if (openRouterConnected) data.openRouterConnected = openRouterConnected;
  if (freeTierEnabled) data.freeTierEnabled = freeTierEnabled;
  const resp = await page.request.post('/test/set-local-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedLocalWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, dashboard: localDashboardUrl(body.urlKey) };
}
