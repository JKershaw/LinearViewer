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
 * other project. Counts derived from this seed (used by the dashboard spec; the
 * tree-row status glyph renders as `.status-pill--bare.status-pill--<state>`
 * since LIN-850):
 *   in-progress = 4   (issue-1 + issue-4, each in the In Progress section
 *                             AND its project section)
 *   todo        = 2   (the child, in both sections)
 *   done        = 1   (issue-3, in the completed section)
 *   In Progress lines  = 3   (issue-1, its child issue-2, issue-4)
 * issue-1 carries two comments (Alice, Bob) so the detail surface's comments
 * toggle has something to load through fetchIssueComments.
 *
 * Project names are kept substring-distinct ("Local Project" vs "Local Beta") so
 * `:has-text("Local Project")` matches a single header (no strict-mode clash).
 *
 * urlKey-aware (LIN-625 S1): a function mirroring `localSeedFromLinearFixture`,
 * so the embedded `url:` fields point at the seeding worker's per-worker
 * workspace. Defaults to `LOCAL_WORKSPACE_URL_KEY` for un-swept callers, leaving
 * their seed byte-identical to the previous constant.
 */
/**
 * Namespace a seed document id by its workspace scope (LIN-800).
 *
 * The LocalStore is one collection partitioned by `scope` (urlKey), but a
 * collection enforces a single globally-unique `_id` (createIssue/createProject
 * upsert by `{_id}` alone — fine in production where ids are UUIDs). The shared
 * `defaultLocalSeed` reused the SAME hardcoded ids (`local-issue-1`, …) for every
 * scope, so two parallel workers seeding concurrently clobbered each other's doc
 * `scope` via the `{_id}` upsert — the victim's `getIssue(scope, id)` then missed
 * with `Issue not found`. Prefixing the seed's `_id`s by the per-worker urlKey
 * makes them globally unique, so parallel seeds can't collide. The human-facing
 * `identifier` (LOCAL-1) is NOT namespaced — it isn't the colliding field and is
 * what specs/the proxy resolve against (getIssue falls back to identifier).
 */
export function localSeedId(urlKey, rawId) {
  return `${urlKey}--${rawId}`;
}

export function defaultLocalSeed(urlKey = LOCAL_WORKSPACE_URL_KEY) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  return {
    projects: [
      { id: id('local-proj-1'), name: 'Local Project', content: 'A local backend project', sortOrder: 1 },
      { id: id('local-proj-2'), name: 'Local Beta', content: 'A second local project', sortOrder: 2 },
    ],
    issues: [
      { id: id('local-issue-1'), identifier: 'LOCAL-1', title: 'Local parent task', description: 'Seeded parent', projectId: id('local-proj-1'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, labels: ['local-label'], url: `/workspace/${urlKey}/issue/${id('local-issue-1')}`, comments: [
        { id: 'local-comment-1', body: 'This is a test comment with **markdown**.', createdAt: '2024-01-15T10:00:00Z', user: 'Alice' },
        { id: 'local-comment-2', body: 'Second comment with `code`.', createdAt: '2024-01-16T14:30:00Z', user: 'Bob' },
      ] },
      { id: id('local-issue-2'), identifier: 'LOCAL-2', title: 'Local child task', description: 'Seeded child', projectId: id('local-proj-1'), parentId: id('local-issue-1'), sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${urlKey}/issue/${id('local-issue-2')}` },
      { id: id('local-issue-3'), identifier: 'LOCAL-3', title: 'Local done task', description: 'Seeded done', projectId: id('local-proj-1'), sortOrder: 3, state: { name: 'Done', type: 'completed' }, completedAt: '2024-01-10T00:00:00Z', url: `/workspace/${urlKey}/issue/${id('local-issue-3')}` },
      { id: id('local-issue-4'), identifier: 'LOCAL-4', title: 'Second project task', description: 'Seeded second-project task', projectId: id('local-proj-2'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('local-issue-4')}` },
    ],
  };
}

/**
 * Assignee-filter dashboard fixture (LIN-2529). `local.viewer()` returns the
 * synthetic constant `{ id: 'local-user', name: 'Local User', ... }`
 * regardless of what's seeded (lib/providers/local/index.js) — the local
 * provider's `assignee` field is an unvalidated passthrough
 * (`assignee: doc.assignee ?? null`, this file's `localSeedFromLinearFixture`),
 * so the `me` spec exercises nothing unless at least one issue is actually
 * seeded `assignee: { name: 'Local User' }` (F7).
 *
 * Shape, each case isolated to its own root so assertions can't cross-talk:
 *   - `filter-parent` (Backlog, unassigned) → `filter-child` (Todo, assigned
 *     'Local User'): filtering by Local User must pull the UNASSIGNED PARENT
 *     in as ancestor context (matched sub-issue's unmatched parent).
 *   - `filter-ip-parent` (In Progress, assigned 'Local User') →
 *     `filter-ip-child` (Todo, unassigned): filtering by Local User must keep
 *     the child visible both in the project tree (descendant context) AND in
 *     the In Progress section (buildInProgressForest's OWN walk over the
 *     already-filtered `issues`, LIN-2525's seam ordering).
 *   - `filter-other` (Todo, assigned 'Other User'): proves an unrelated
 *     assignee's issue is excluded when filtering by Local User.
 *   - `filter-unrelated` (Backlog, unassigned, no relation to any match):
 *     proves an issue with no relation to any match is dropped.
 */
export function assigneeFilterLocalSeed(urlKey = LOCAL_WORKSPACE_URL_KEY) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  return {
    projects: [
      { id: id('filter-proj'), name: 'Filter Project', content: null, sortOrder: 1 },
    ],
    issues: [
      { id: id('filter-parent'), identifier: 'FILT-1', title: 'Unassigned parent', description: '', projectId: id('filter-proj'), sortOrder: 1, state: { name: 'Backlog', type: 'backlog' }, assignee: null, url: `/workspace/${urlKey}/issue/${id('filter-parent')}` },
      { id: id('filter-child'), identifier: 'FILT-2', title: 'Assigned child', description: '', projectId: id('filter-proj'), parentId: id('filter-parent'), sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'Local User' }, url: `/workspace/${urlKey}/issue/${id('filter-child')}` },
      { id: id('filter-ip-parent'), identifier: 'FILT-3', title: 'Assigned in-progress parent', description: '', projectId: id('filter-proj'), sortOrder: 3, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Local User' }, url: `/workspace/${urlKey}/issue/${id('filter-ip-parent')}` },
      { id: id('filter-ip-child'), identifier: 'FILT-4', title: 'Unassigned in-progress subtask', description: '', projectId: id('filter-proj'), parentId: id('filter-ip-parent'), sortOrder: 4, state: { name: 'Todo', type: 'unstarted' }, assignee: null, url: `/workspace/${urlKey}/issue/${id('filter-ip-child')}` },
      { id: id('filter-other'), identifier: 'FILT-5', title: 'Other assignee task', description: '', projectId: id('filter-proj'), sortOrder: 5, state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'Other User' }, url: `/workspace/${urlKey}/issue/${id('filter-other')}` },
      { id: id('filter-unrelated'), identifier: 'FILT-6', title: 'Unrelated unassigned task', description: '', projectId: id('filter-proj'), sortOrder: 6, state: { name: 'Backlog', type: 'backlog' }, assignee: null, url: `/workspace/${urlKey}/issue/${id('filter-unrelated')}` },
    ],
  };
}

/**
 * Ship radial view backlog-visibility fixture (LIN-1208). `swimLocalSeed`
 * doesn't cover the blocker/parent exemption — per LIN-1208's research, none
 * of its four backlog cards blocks or parents anything — so this is a
 * dedicated, minimal seed rather than an extension of the shared fixture
 * (which many other specs and the visual baselines assert exact counts
 * against). Shape:
 *   - project 'Mixed': one started card (ship rect), one plain unstarted card
 *     (always visible), one plain backlog card (hidden by default, shown when
 *     the toggle is on), and one backlog card that BLOCKS the started card
 *     (exempt — visible either way, still carrying `state-backlog`).
 *   - project 'Dormant': two plain backlog cards and nothing else — dropped
 *     entirely by default (skipBacklogProjects' empty-group cleanup) and
 *     reappears when the toggle is on.
 */
export function shipBacklogLocalSeed(urlKey = LOCAL_WORKSPACE_URL_KEY) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  return {
    projects: [
      { id: id('ship-proj-mixed'), name: 'Mixed', content: null, sortOrder: 1 },
      { id: id('ship-proj-dormant'), name: 'Dormant', content: null, sortOrder: 2 },
    ],
    issues: [
      { id: id('ship-wip'), identifier: 'SHIP-1', title: 'In-progress work', description: '', projectId: id('ship-proj-mixed'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('ship-wip')}` },
      { id: id('ship-todo'), identifier: 'SHIP-2', title: 'Plain todo card', description: '', projectId: id('ship-proj-mixed'), sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${urlKey}/issue/${id('ship-todo')}` },
      { id: id('ship-plain-backlog'), identifier: 'SHIP-3', title: 'Plain backlog card', description: '', projectId: id('ship-proj-mixed'), sortOrder: 3, state: { name: 'Backlog', type: 'backlog' }, url: `/workspace/${urlKey}/issue/${id('ship-plain-backlog')}` },
      {
        id: id('ship-blocker-backlog'), identifier: 'SHIP-4', title: 'Backlog card blocking in-progress work', description: '',
        projectId: id('ship-proj-mixed'), sortOrder: 4, state: { name: 'Backlog', type: 'backlog' },
        url: `/workspace/${urlKey}/issue/${id('ship-blocker-backlog')}`,
        relations: [{ id: 'ship-rel-blocks', type: 'blocks', relatedIssueId: id('ship-wip') }],
      },
      { id: id('ship-dormant-1'), identifier: 'SHIP-5', title: 'Dormant backlog card 1', description: '', projectId: id('ship-proj-dormant'), sortOrder: 5, state: { name: 'Backlog', type: 'backlog' }, url: `/workspace/${urlKey}/issue/${id('ship-dormant-1')}` },
      { id: id('ship-dormant-2'), identifier: 'SHIP-6', title: 'Dormant backlog card 2', description: '', projectId: id('ship-proj-dormant'), sortOrder: 6, state: { name: 'Backlog', type: 'backlog' }, url: `/workspace/${urlKey}/issue/${id('ship-dormant-2')}` },
    ],
  };
}

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
 * Re-key every `_id` (and the internal references that point at one) in a local
 * seed by its workspace scope (LIN-801, extending LIN-800 to the fixture seeds).
 *
 * `localSeedFromLinearFixture` copies the fixture's RAW ids verbatim (`dash-1b`,
 * `auth-3`, …). Because the LocalStore upserts by a single globally-unique `_id`
 * (createIssue/createProject key on `{_id}` alone, ignoring `scope`), two
 * parallel workers seeding the SAME fixture ids clobber each other's doc `scope`
 * — the victim's `listIssues(scope)` then reads back partial/empty data and the
 * ship/swim page renders with missing cards (the LIN-801 reload-determinism
 * flake at `workers: 2`). Prefixing each `_id` by the per-worker urlKey makes
 * them globally unique, so parallel seeds can't collide. Internal references
 * (`projectId`, `parentId`, `relations[].relatedIssueId`) are rewritten with the
 * same prefix so the graph stays connected; the human-facing `identifier` is NOT
 * namespaced (it isn't the colliding field and is what specs resolve against).
 */
function namespaceLocalSeed(seed, urlKey) {
  const ns = (raw) => (raw == null ? raw : localSeedId(urlKey, raw));
  return {
    projects: seed.projects.map(p => ({ ...p, id: ns(p.id) })),
    issues: seed.issues.map(i => ({
      ...i,
      id: ns(i.id),
      projectId: ns(i.projectId),
      parentId: ns(i.parentId),
      relations: (i.relations || []).map(r => ({ ...r, relatedIssueId: ns(r.relatedIssueId) })),
      url: `/workspace/${urlKey}/issue/${ns(i.id)}`,
    })),
  };
}

/**
 * The swim/ship sample fixture as a local seed: 4 projects, ~20 issues with
 * deep blocking chains, nested subtask groups, and labels — everything the
 * dependency-driven views (swim lanes/flow, ship sectors) need. Backed by the
 * relations surfaced through LocalProvider._toCanonicalIssue (LIN-378).
 *
 * urlKey-aware (LIN-801): like `defaultLocalSeed`, this is a function so its
 * `_id`s are namespaced per worker scope and parallel seeds can't collide. Pass
 * the seeding `urlKey` (the `localWorkerUrlKey` worker fixture) so the seed ids
 * match the scope they're seeded into.
 */
export function swimLocalSeed(urlKey = LOCAL_WORKSPACE_URL_KEY) {
  return namespaceLocalSeed(
    localSeedFromLinearFixture({ projects: swimSampleProjects, issues: swimSampleIssues }, urlKey),
    urlKey
  );
}

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
 * @param {{projects?: Array, issues?: Array}} [seed] - defaults to the urlKey-aware
 *   defaultLocalSeed for the resolved `urlKey`
 * @param {{features?: Object, openRouterConnected?: boolean, freeTierEnabled?: boolean, extraBindings?: Array, urlKey?: string}} [options] -
 *   session feature flags (whitelist-validated server-side); `openRouterConnected`
 *   to provision a mock OpenRouter key on the local session (so e.g. roadmap specs
 *   reach the AI mock instead of resolveRoadmapLLM's 503); `freeTierEnabled` to
 *   simulate free-tier mode (no key, session flag) for the recommend free-tier
 *   block (LIN-405); and `urlKey` to seed a per-worker workspace partition
 *   (LIN-625 S1 — defaults to `LOCAL_WORKSPACE_URL_KEY`, supplied by the
 *   `localWorkerUrlKey` worker fixture once specs are swept).
 * @returns {Promise<{urlKey: string, dashboard: string}>}
 */
export async function seedLocalWorkspace(page, seed = null, { features, openRouterConnected, freeTierEnabled, extraBindings, urlKey = LOCAL_WORKSPACE_URL_KEY, append } = {}) {
  const data = { ...(seed ?? defaultLocalSeed(urlKey)), urlKey };
  if (features) data.features = features;
  if (openRouterConnected) data.openRouterConnected = openRouterConnected;
  if (freeTierEnabled) data.freeTierEnabled = freeTierEnabled;
  // Make the seeded workspace explicitly multi-binding (LIN-717): the local
  // binding stays active, with each extra appended so the providers settings
  // surface can exercise the active-provider switch end-to-end.
  if (extraBindings) data.extraBindings = extraBindings;
  // LIN-2226: a SECOND local workspace in the same session (cross-workspace
  // task-bound coverage) — call this a second time with a different `urlKey`
  // and `append: true` to add it alongside the first rather than replacing it.
  if (append) data.append = true;
  const resp = await page.request.post('/test/set-local-session', { data });
  if (!resp.ok()) {
    throw new Error(`seedLocalWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, dashboard: localDashboardUrl(body.urlKey) };
}
