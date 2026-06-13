import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, LOCAL_WORKSPACE_URL_KEY, localDashboardUrl } from '../fixtures/local-harness.js';

// LIN-356 (F) / LIN-378: provider-agnostic E2E against a GENUINE second provider.
//
// Unlike the `test-token` specs, this one rides NO mock short-circuit. The
// seedLocalWorkspace() harness (LIN-378) seeds a real LocalStore and establishes
// a `provider: 'local'` workspace whose token is its own urlKey (the store
// partition key). The dashboard therefore renders from the seeded store via the
// real getProviderForWorkspace + getWorkspaceToken read seam (#382) — proving the
// abstraction serves a backend that is not Linear, with no mock and no
// third-party dependency.

const LOCAL_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const DASHBOARD = localDashboardUrl(LOCAL_URL_KEY);

test.describe('Local provider (no test-token mock)', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page);
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
  });

  test('dashboard renders seeded local project + issues from the store', async ({ page }) => {
    // Project from the seeded LocalStore — not from testMockData.
    await expect(page.locator('.project-header:has-text("Local Project")')).toBeVisible();
    // Started issue surfaces in the In Progress section.
    await expect(page.locator('.in-progress-items .line:has-text("Local parent task")')).toBeVisible();
    // Child issue is in the DOM (hidden until its parent is expanded).
    await expect(page.locator('.line:has-text("Local child task")').first()).toBeAttached();
  });

  test('detail link is provider-aware: "View in Local" (not Linear)', async ({ page }) => {
    // render.js interpolates provider.ui.displayName ('Local') into the link.
    // LIN-442: the detail block is lazy — expand an issue to load it first.
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.detail-link', { hasText: 'View in Local' }).first()).toBeAttached();
    // No dashboard detail link should still say "View in Linear" for this workspace.
    await expect(page.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
  });

  test('swim popover link is provider-aware (E2E proof of the F1 fix)', async ({ page }) => {
    await page.goto(`/workspace/${LOCAL_URL_KEY}/swim`);
    await expect(page.locator('#swim-popover-link')).toContainText('View in Local');
  });

  test('ship popover link is provider-aware (E2E proof of the F1 fix)', async ({ page }) => {
    await page.goto(`/workspace/${LOCAL_URL_KEY}/ship`);
    await expect(page.locator('#ship-popover-link')).toContainText('View in Local');
  });

  test('write round-trip: an issue created through provider.createIssue renders back', async ({ page }) => {
    // Create via the registered Local provider — NOT the proxy. This is the
    // declared-but-unimplemented-until-now write path the provider exists to prove.
    const resp = await page.request.get('/test/local-create-issue?title=Created via provider');
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.issue.title).toBe('Created via provider');

    // Reload the dashboard — the read seam surfaces the freshly written issue.
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.line:has-text("Created via provider")').first()).toBeAttached();
  });
});
