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
 *   - cycles / teams / estimate-driven surfaces (the provider declares these off)
 * Migrate a spec onto this harness only when the local provider fully backs the
 * surface under test (tree/dashboard/swim/ship/detail rendering, reads, writes).
 */
import { LocalStore } from '../../lib/local-store.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createMockCollection } from './mock-collection.js';

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
    { id: 'local-issue-1', identifier: 'LOCAL-1', title: 'Local parent task', description: 'Seeded parent', projectId: 'local-proj-1', sortOrder: 1, state: { name: 'In Progress', type: 'started' }, labels: ['local-label'], url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-1` },
    { id: 'local-issue-2', identifier: 'LOCAL-2', title: 'Local child task', description: 'Seeded child', projectId: 'local-proj-1', parentId: 'local-issue-1', sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-2` },
    { id: 'local-issue-3', identifier: 'LOCAL-3', title: 'Local done task', description: 'Seeded done', projectId: 'local-proj-1', sortOrder: 3, state: { name: 'Done', type: 'completed' }, completedAt: '2024-01-10T00:00:00Z', url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-3` },
    { id: 'local-issue-4', identifier: 'LOCAL-4', title: 'Second project task', description: 'Seeded second-project task', projectId: 'local-proj-2', sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${LOCAL_WORKSPACE_URL_KEY}/issue/local-issue-4` },
  ],
};

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
 * @returns {Promise<{urlKey: string, dashboard: string}>}
 */
export async function seedLocalWorkspace(page, seed = defaultLocalSeed) {
  const resp = await page.request.post('/test/set-local-session', { data: seed });
  if (!resp.ok()) {
    throw new Error(`seedLocalWorkspace failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { urlKey: body.urlKey, dashboard: localDashboardUrl(body.urlKey) };
}
