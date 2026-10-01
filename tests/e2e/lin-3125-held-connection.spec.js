/**
 * LIN-3125 Phase 3 — the offline e2e twin.
 *
 * A signed-in user with ONE held (connection-backed) GitHub connection adds a
 * source via Settings and creates a fresh workspace via "as a new workspace" —
 * both entirely through the held picker. The browser never navigates to
 * github.com and the server-side auth/install counters stay at zero.
 *
 * Runs against the dedicated, GitHub-configured test server on port 3002 (see
 * playwright.config.js): the default 3001 server deliberately runs with no
 * GitHub App, and several specs assert the add affordances are honestly blocked
 * there. Offline: the provider is wired to the in-memory fake via `clientFactory`
 * (routes/test.js). `page.route('**github.com/**')` sees BROWSER traffic only,
 * so the SERVER-side zero-network claim is proven by `/test/github-fake-counters`.
 */
import { test, expect } from '../fixtures/test-base.js';
import { GITHUB_WORKSPACE_URL_KEY, GITHUB_REPO } from '../fixtures/github-harness.js';

test.use({ baseURL: 'http://localhost:3002' });

const REPO_B = 'octocat/repo-b';
const REPO_C = 'octocat/repo-c';

async function seedHeldSession(page) {
  const resp = await page.request.post('/test/set-github-session', {
    data: {
      connectionBacked: true,
      repos: [
        { full_name: GITHUB_REPO, private: false },
        { full_name: REPO_B, private: true },
        { full_name: REPO_C, private: false },
      ],
    },
  });
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()).urlKey;
}

async function bindingsOf(page) {
  const resp = await page.request.get('/test/session-bindings');
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()).workspaces;
}

async function counters(page) {
  const resp = await page.request.get('/test/github-fake-counters');
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

test.describe('Held connection picker (LIN-3125 Phase 3)', () => {
  test('settings add-source + fresh workspace go through the held picker with no GitHub navigation', async ({ page }) => {
    const githubHits = [];
    await page.route('**github.com/**', route => { githubHits.push(route.request().url()); return route.abort(); });

    const urlKey = await seedHeldSession(page);
    expect(urlKey).toBe(GITHUB_WORKSPACE_URL_KEY);
    expect((await counters(page)).listUserInstallations).toBe(0);

    const settingsUrl = `/workspace/${urlKey}/settings`;

    // ---- 1. add-source via the REAL Settings emitter (server.js add POST) ----
    await page.goto(settingsUrl);
    const addButton = page.locator('[data-testid="settings-provider-add-github"] button[type="submit"]');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await page.waitForURL('**/connect/github/held');
    expect(page.url()).toContain('/connect/github/held');

    // The already-bound repo is excluded; the other two are offered.
    await expect(page.locator(`input[name="repo"][value="${REPO_B}"]`)).toBeAttached();
    await expect(page.locator(`input[name="repo"][value="${GITHUB_REPO}"]`)).toHaveCount(0);
    await page.locator(`input[name="repo"][value="${REPO_B}"]`).check();
    await page.locator('[data-testid="github-repo-submit"]').click();
    await page.waitForURL(/\/settings\?provider_ok=github/);

    // Settings now lists both bindings, sharing ONE connection.
    await expect(page.locator(`[data-testid="settings-provider-binding"][data-scope="${GITHUB_REPO}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="settings-provider-binding"][data-scope="${REPO_B}"]`)).toHaveCount(1);
    let ws = await bindingsOf(page);
    expect(ws.length).toBe(1);
    expect(new Set(ws[0].bindings.map(b => b.connectionId)).size).toBe(1, 'both bindings share ONE connectionId');
    expect(ws[0].bindings.every(b => b.hasCredentials === false)).toBe(true);

    // ---- 2. fresh workspace via the REAL "as a new workspace" emitter ----
    await page.goto(settingsUrl);
    await page.locator('[data-testid="settings-provider-new-workspace-github"]').click();
    await page.waitForURL('**/connect/github/held');
    await page.locator(`input[name="repo"][value="${REPO_C}"]`).check();
    await page.locator('[data-testid="github-repo-submit"]').click();
    await page.waitForURL(/\/workspace\/repo-c\/$/);
    await expect(page.locator('.project-header:has-text("octocat/repo-c")')).toBeVisible();

    // ---- 3. one connection, all bindings share it, no credentials ----
    ws = await bindingsOf(page);
    expect(ws.length).toBe(2, 'the first workspace plus the fresh one');
    const all = ws.flatMap(w => w.bindings);
    expect(new Set(all.map(b => b.connectionId)).size).toBe(1);
    expect(all.every(b => b.hasCredentials === false)).toBe(true);
    expect([...all.map(b => b.scope)].sort()).toEqual([GITHUB_REPO, REPO_B, REPO_C].sort());

    // ---- 4. browser never reached github.com; SERVER did no auth/install round trip ----
    expect(githubHits).toEqual([]);
    expect(await counters(page)).toEqual({ listUserInstallations: 0, beginAuth: 0, beginInstall: 0, completeAuth: 0, completeInstallation: 0 });
  });
});
