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

  // LIN-1565 ported this from the inline form (which no longer exists) onto the
  // dedicated task-edit page. Same two persistence assertions, read back through
  // the same Local provider seam — but ONE interaction from the row to a focused
  // edit field instead of four, and a real state <select> instead of a free-text
  // box. Selects through the page's `data-testid` contract only.
  test('task-edit page updates an existing task title + state and it persists', async ({ page }) => {
    const NEW_TITLE = 'Edited via the task edit page';

    // Expand the seeded In Progress parent, then open its Details section (the
    // edit link lives inside the collapsed Details content, beside Comments).
    await page.locator('.in-progress-items .line', { hasText: 'Local parent task' }).first().click();
    await page.locator('.detail-toggle[data-toggle="details"]').first().click();

    // One click: the link navigates to the task's own edit page.
    await page.locator('[data-testid="issue-edit-link"]').first().click();
    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();

    // Rename and move it to Done (a full-body description PATCH rides along).
    // The Local provider implements states(), so State is a real <select> whose
    // option values are LOCAL_STATES names — selectOption asserts that too.
    await form.locator('[data-testid="task-edit-title"]').fill(NEW_TITLE);
    await form.locator('[data-testid="task-edit-stateId"]').selectOption('Done');

    await form.locator('[data-testid="task-edit-submit"]').click();
    await page.waitForLoadState('networkidle');

    // Saving returns to the dashboard, which re-reads through the provider.
    // Assert the NAVIGATION, not the tree's shape: this test moves the only
    // in-progress task to Done, and renderInProgressSection returns '' when it
    // has nothing to show — so the In Progress section is legitimately absent
    // here, and keying on it would make the check order-dependent on whichever
    // sibling test last left a started task in the partition.
    await expect(page).toHaveURL(/\/workspace\/[^/]+\/$/);
    // Title persisted: the old title is gone, the new one renders.
    await expect(page.locator('.line', { hasText: 'Local parent task' })).toHaveCount(0);
    await expect(page.locator('.line', { hasText: NEW_TITLE }).first()).toBeAttached();
    // State persisted: now Done, so it has left the In Progress section.
    await expect(page.locator('.in-progress-items .line', { hasText: NEW_TITLE })).toHaveCount(0);
  });

  // LIN-1575: the description field grew a Write/Preview toggle (marked +
  // DOMPurify via window.renderMarkdown — the same vendored pair every other
  // Markdown surface already loads, no new dependency). Proves two things: (1)
  // Preview actually renders the Markdown, and (2) opening Preview — the editor
  // being "touched" — never mutates the underlying textarea, so a save with the
  // description otherwise untouched round-trips it byte-identical, never
  // HTML-ified. The seeded description is plain text ("Seeded parent"), so this
  // also proves render/round-trip work for the common no-Markdown-syntax case.
  test('description Preview renders live and saving round-trips the untouched doc unchanged', async ({ page }) => {
    await page.locator('.in-progress-items .line', { hasText: 'Local parent task' }).first().click();
    await page.locator('.detail-toggle[data-toggle="details"]').first().click();
    await page.locator('[data-testid="issue-edit-link"]').first().click();

    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();
    // Capture the edit URL so the read-back below can return DIRECTLY. Walking
    // the tree a second time is not just longer, it is wrong: the dashboard
    // restores its collapse state from localStorage, so after the save the row
    // comes back already expanded and a second click would COLLAPSE it, hiding
    // the details toggle the edit link lives under.
    const editUrl = page.url();
    const textarea = form.locator('[data-testid="task-edit-description"]');
    const preview = form.locator('[data-testid="task-edit-preview"]');
    await expect(textarea).toHaveValue('Seeded parent');
    await expect(preview).toBeHidden();

    // Preview: textarea hides, the rendered pane shows, and it actually rendered
    // (not just echoed) the current content.
    await form.locator('[data-testid="task-edit-tab-preview"]').click();
    await expect(textarea).toBeHidden();
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Seeded parent');

    // Back to Write: the textarea returns with its value untouched by the
    // render/sanitize round trip.
    await form.locator('[data-testid="task-edit-tab-write"]').click();
    await expect(textarea).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(textarea).toHaveValue('Seeded parent');

    // Save with the description untouched (only having opened Preview), then
    // come back and confirm it persisted byte-identical — the editor never
    // rewrote the stored Markdown to HTML or anything else.
    await form.locator('[data-testid="task-edit-submit"]').click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/workspace\/[^/]+\/$/);

    await page.goto(editUrl);
    await expect(page.locator('[data-testid="task-edit-description"]')).toHaveValue('Seeded parent');
  });
});
