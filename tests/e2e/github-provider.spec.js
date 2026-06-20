import { test, expect } from '../fixtures/test-base.js';
import { seedGitHubWorkspace, GITHUB_WORKSPACE_URL_KEY, githubDashboardUrl } from '../fixtures/github-harness.js';

// LIN-178: end-to-end proof of the GitHub Issues provider — the abstraction's
// first FOREIGN backend.
//
// Like the Local-provider spec, this rides NO `test-token` mock short-circuit.
// seedGitHubWorkspace() configures the registered `github` singleton with an
// in-memory fake GitHub backend (GitHub-REST-shaped data) and establishes a
// `provider: 'github'` workspace whose token is the repo slug. The dashboard
// therefore renders GitHub issues mapped into the canonical model via the real
// getProviderForWorkspace + getWorkspaceToken read seam — proving the canonical
// state model + provider contract survive GitHub's hostile schema (no subtasks,
// no estimates, repos-not-teams, binary open/closed state) with no network and
// no GitHub auth (OAuth/login is LIN-541).

const URL_KEY = GITHUB_WORKSPACE_URL_KEY;
const DASHBOARD = githubDashboardUrl(URL_KEY);

test.describe('GitHub provider (no test-token mock)', () => {
  test.beforeEach(async ({ page }) => {
    await seedGitHubWorkspace(page);
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
  });

  test('dashboard renders the GitHub milestone (→ project) + issues from the fake backend', async ({ page }) => {
    // Milestone "Sprint 1" maps to a canonical project header.
    await expect(page.locator('.project-header:has-text("Sprint 1")')).toBeVisible();
    // The open issue (mapped to unstarted) is in the DOM under its project.
    await expect(page.locator('.line:has-text("GitHub open task")').first()).toBeAttached();
    // The closed/completed issue surfaces too.
    await expect(page.locator('.line:has-text("GitHub shipped task")').first()).toBeAttached();
  });

  test('detail link is provider-aware: "View in GitHub" (not Linear)', async ({ page }) => {
    // render.js interpolates provider.ui.displayName ('GitHub') into the link.
    // The detail block is lazy — expand an issue to load it first.
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.detail-link', { hasText: 'View in GitHub' }).first()).toBeAttached();
    await expect(page.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
  });

  test('write round-trip: an issue created through provider.createIssue renders back', async ({ page }) => {
    // Create via the registered GitHub provider — NOT the proxy. This is the
    // write path the provider declares (capability write:true).
    const resp = await page.request.get('/test/github-create-issue?title=Created via GitHub provider');
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.issue.title).toBe('Created via GitHub provider');

    // Reload the dashboard — the read seam surfaces the freshly written issue.
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.line:has-text("Created via GitHub provider")').first()).toBeAttached();
  });
});
