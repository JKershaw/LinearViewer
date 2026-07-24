import { test, expect } from '../fixtures/test-base.js';
import { localDashboardUrl } from '../fixtures/local-harness.js';

// LIN-356 (F) / LIN-378: provider-agnostic E2E against a GENUINE second provider.
//
// Unlike the `test-token` specs, this one rides NO mock short-circuit. The
// seedLocalWorkspace() harness (LIN-378) seeds a real LocalStore and establishes
// a `provider: 'local'` workspace whose token is its own urlKey (the store
// partition key). The dashboard therefore renders from the seeded store via the
// real getProviderForWorkspace + getWorkspaceToken read seam (#382) — proving the
// abstraction serves a backend that is not Linear, with no mock and no
// third-party dependency.

test.describe('Local provider (no test-token mock)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // ship is gated behind its experimental flag (LIN-496); the ship test below
    // navigates to /ship, so seed it on for this provider suite.
    await seedLocal(undefined, { features: { ship: true } });
    await page.goto(localDashboardUrl(localWorkerUrlKey));
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

  test('swim popover link is provider-aware (E2E proof of the F1 fix)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await expect(page.locator('#swim-popover-link')).toContainText('View in Local');
  });

  test('ship popover link is provider-aware (E2E proof of the F1 fix)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/ship`);
    await expect(page.locator('#ship-popover-link')).toContainText('View in Local');
  });

  test('write round-trip: an issue created through provider.createIssue renders back', async ({ page, localWorkerUrlKey }) => {
    // Create via the registered Local provider — NOT the proxy. This is the
    // declared-but-unimplemented-until-now write path the provider exists to prove.
    const resp = await page.request.get(`/test/local-create-issue?title=Created via provider&urlKey=${localWorkerUrlKey}`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.issue.title).toBe('Created via provider');

    // Reload the dashboard — the read seam surfaces the freshly written issue.
    await page.goto(localDashboardUrl(localWorkerUrlKey));
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.line:has-text("Created via provider")').first()).toBeAttached();
  });

  // ===========================================================================
  // LIN-1553 — in-app create/edit UI end-to-end against the writable Local
  // provider. Drives the real beat-2 markup + beat-3 client wiring through the
  // Session A session-auth routes (POST/PATCH /workspace/:urlKey/api/issues) and
  // asserts persistence via the same Local provider read seam the dashboard
  // renders from. Selects through the beat-2 `data-testid` contract only.
  // ===========================================================================
  test('in-app create form creates a task through the Session A route and it persists', async ({ page }) => {
    const CREATE_TITLE = 'Created via inline form';
    const project = page.locator('.project').first();

    // The Local provider derives ui.inlineCreate, so the create affordance is the
    // in-app trigger + form (the external deep-link is replaced). Reveal it.
    await project.locator('[data-testid="create-task-trigger"]').click();
    const form = project.locator('[data-testid="create-task-form"]');
    await expect(form).toBeVisible();

    await form.locator('[data-testid="create-task-title"]').fill(CREATE_TITLE);
    // teamId is a required v1 field; the Local provider has no teams and ignores
    // the value, so any UUID satisfies the route's create contract.
    await form.locator('[data-testid="create-task-teamId"]').fill('00000000-0000-0000-0000-0000000000aa');
    // The symbolic ref resolver accepts a project NAME (or UUID). NOTE: the form
    // prefills projectId with the provider's project id, which for the Local
    // provider is a composite (non-UUID, non-name) id the resolver can't match —
    // so we set the project by name here. (Follow-up: prefill/resolve local ids.)
    await form.locator('[data-testid="create-task-projectId"]').fill('Local Project');
    // Create it as started so the state clearly took (visible in In Progress).
    await form.locator('[data-testid="create-task-stateId"]').fill('In Progress');

    await form.locator('[data-testid="create-task-submit"]').click();
    await page.waitForLoadState('networkidle');

    // Persisted: read back through the Local provider on the reloaded dashboard,
    // and it surfaces in the In Progress section (the started state took).
    await expect(page.locator('.line', { hasText: CREATE_TITLE }).first()).toBeAttached();
    await expect(page.locator('.in-progress-items .line', { hasText: CREATE_TITLE }).first()).toBeAttached();
  });

  test('in-app edit form updates an existing task title + state and it persists', async ({ page }) => {
    const NEW_TITLE = 'Edited via inline form';

    // Expand the seeded In Progress parent, then open its Details section (the
    // edit affordance lives inside the collapsed Details content).
    await page.locator('.in-progress-items .line', { hasText: 'Local parent task' }).first().click();
    await page.locator('.detail-toggle[data-toggle="details"]').first().click();
    const trigger = page.locator('[data-testid="edit-issue-trigger"]').first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const form = page.locator('[data-testid="edit-issue-form"]').first();
    await expect(form).toBeVisible();

    // Rename and move it to Done (a full-body description PATCH rides along).
    await form.locator('[data-testid="edit-issue-title"]').fill(NEW_TITLE);
    await form.locator('[data-testid="edit-issue-stateId"]').fill('Done');

    await form.locator('[data-testid="edit-issue-submit"]').click();
    await page.waitForLoadState('networkidle');

    // Title persisted: the old title is gone, the new one renders.
    await expect(page.locator('.line', { hasText: 'Local parent task' })).toHaveCount(0);
    await expect(page.locator('.line', { hasText: NEW_TITLE }).first()).toBeAttached();
    // State persisted: now Done, so it has left the In Progress section.
    await expect(page.locator('.in-progress-items .line', { hasText: NEW_TITLE })).toHaveCount(0);
  });
});
