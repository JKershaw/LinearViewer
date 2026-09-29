import { test, expect } from '../fixtures/test-base.js';
import { defaultGitHubSeed, GITHUB_REPO, githubDashboardUrl } from '../fixtures/github-harness.js';
import { GITHUB_PROJECTS_BOARD, githubProjectsDashboardUrl } from '../fixtures/github-projects-harness.js';
import { defaultJiraSeed, JIRA_SITE, jiraDashboardUrl } from '../fixtures/jira-harness.js';

// LIN-3124 PR3 checkpoint F (T27): the connection-backed variants of the four
// `routes/test.js` fixture writers, driven through the stubbed providers.
//
// Each variant runs the REAL phase-B converter, so the binding is
// `{provider, scope, connectionId}` with no credential on it or on the
// workspace, and the credential lives on the Connection row. Every read below
// is therefore served by the per-request hydration side-table — the browser
// lane (active binding: `getWorkspaceCallScope`) and the per-binding fan-out
// lane (a non-active binding: `getBindingCallScope`). The Jira fixture's
// `clientFactory` ASSERTS the projected call scope, so an OAuth render here
// proves the Connection's `{token, authType, cloudId}` reached the provider.
//
// The legacy fixtures are untouched: the default call of each still writes
// the pre-cutover shape (asserted below), and the 38 'test-token' guards are
// byte-identical (pinned by tests/unit/lin-3124-pr1-count-pins.test.js).

async function bindingsOf(page) {
  const resp = await page.request.get('/test/session-bindings');
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()).workspaces;
}

function expectConnectionBacked(binding, provider, scope) {
  expect(binding.provider).toBe(provider);
  expect(binding.scope).toBe(scope);
  expect(binding.connectionId).toMatch(new RegExp(`::${provider}::`));
  expect(binding.hasCredentials).toBe(false);
}

test.describe('Connection-backed fixture variants (LIN-3124 T27)', () => {
  test('github: a connection-backed active binding renders the repo through hydration', async ({ page }) => {
    const resp = await page.request.post('/test/set-github-session', { data: { ...defaultGitHubSeed, connectionBacked: true } });
    expect(resp.ok()).toBeTruthy();
    const [ws] = await bindingsOf(page);
    expectConnectionBacked(ws.bindings[0], 'github', GITHUB_REPO);
    expect(ws.activeBinding).toEqual({ provider: 'github', scope: GITHUB_REPO });
    expect(ws.hasScalarMirror).toBe(false);

    await page.goto(githubDashboardUrl());
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Sprint 1")')).toBeVisible();
    await expect(page.locator('.line:has-text("GitHub open task")').first()).toBeAttached();
  });

  test('github-projects: a connection-backed board renders through hydration', async ({ page }) => {
    const resp = await page.request.post('/test/set-github-projects-session', { data: { connectionBacked: true } });
    expect(resp.ok()).toBeTruthy();
    const [ws] = await bindingsOf(page);
    expectConnectionBacked(ws.bindings[0], 'github-projects', GITHUB_PROJECTS_BOARD);
    expect(ws.hasScalarMirror).toBe(false);

    await page.goto(githubProjectsDashboardUrl());
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Roadmap")')).toBeVisible();
    await expect(page.locator('.line:has-text("Board task in progress")').first()).toBeAttached();
  });

  test('jira (OAuth): the Connection credential is projected into the asserted OAuth call scope', async ({ page }) => {
    const resp = await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed, authType: 'oauth', connectionBacked: true } });
    expect(resp.ok()).toBeTruthy();
    const [ws] = await bindingsOf(page);
    expectConnectionBacked(ws.bindings[0], 'jira', JIRA_SITE);
    expect(ws.hasScalarMirror).toBe(false);

    await page.goto(jiraDashboardUrl());
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Engineering")')).toBeVisible();
    await expect(page.locator('.line:has-text("Jira task in progress")').first()).toBeAttached();
  });

  test('jira Basic never becomes connection-backed: the variant refuses rather than silently staying legacy', async ({ page }) => {
    const resp = await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed, connectionBacked: true } });
    expect(resp.status()).toBe(500);
    expect(await resp.text()).toContain('Basic never converts');
  });

  test('local + a connection-backed NON-active Jira OAuth extra binding: the fan-out renders it through the per-binding lane', async ({ page, seedLocal }) => {
    // Configure the Jira singleton's fake (a process-level side effect).
    expect((await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } })).ok()).toBeTruthy();
    const { dashboard } = await seedLocal(null, {
      extraBindings: [{
        provider: 'jira', scope: JIRA_SITE, connectionBacked: true, refreshToken: 'fake_extra_refresh',
        credentials: { token: 'fake_extra_oauth_access', authType: 'oauth', cloudId: '11111111-2222-3333-4444-555555555555', tokenExpiresAt: Date.now() + 3600_000 },
      }],
    });
    const [ws] = await bindingsOf(page);
    expect(ws.bindings[0]).toMatchObject({ provider: 'local', connectionId: null, hasCredentials: true });
    expectConnectionBacked(ws.bindings[1], 'jira', JIRA_SITE);
    expect(ws.activeBinding).toBeNull();
    expect(ws.hasScalarMirror).toBe(true);

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');
    const jiraRow = page.locator('.line:has-text("Jira task to do")').first();
    await expect(jiraRow).toBeAttached();
    await expect(jiraRow.locator('[data-testid="issue-source"]')).toHaveText('jira');
  });

  test('the legacy fixtures are unchanged: the default calls still write the session-carried shape', async ({ page, seedLocal }) => {
    expect((await page.request.post('/test/set-github-session', { data: defaultGitHubSeed })).ok()).toBeTruthy();
    let [ws] = await bindingsOf(page);
    expect(ws.bindings[0]).toMatchObject({ provider: 'github', connectionId: null, hasCredentials: true });
    expect(ws.activeBinding).toBeNull();
    expect(ws.hasScalarMirror).toBe(true);

    expect((await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed, authType: 'oauth' } })).ok()).toBeTruthy();
    [ws] = await bindingsOf(page);
    expect(ws.bindings[0]).toMatchObject({ provider: 'jira', connectionId: null, hasCredentials: true });

    await seedLocal(null, { extraBindings: [{ provider: 'jira', scope: JIRA_SITE, credentials: { token: 't', email: 'e@x', tokenExpiresAt: Number.MAX_SAFE_INTEGER } }] });
    [ws] = await bindingsOf(page);
    expect(ws.bindings.map(b => b.connectionId)).toEqual([null, null]);
  });
});
