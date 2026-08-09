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
  // LIN-1973 — the dedicated /task/new page end-to-end against the writable
  // Local provider, superseding LIN-1553's inline form (removed). Drives the
  // real route + renderer + client wiring through the unchanged Session A
  // session-auth route (POST /workspace/:urlKey/api/issues) and asserts
  // persistence via the same Local provider read seam the dashboard renders
  // from. Selects through the task-create `data-testid` contract only.
  //
  // Carries forward BOTH distinguishing assertions from the LIN-1972 close-out
  // ledger (a permanent pin the old form's spec never provided, since it typed
  // a fake teamId and selected the project by NAME):
  //   1. teamId is never even renderable — Local's createFields() excludes it,
  //      so an empty/absent team input is structural, not just untyped.
  //   2. the project is set via its real, provider-native COMPOSITE id (the
  //      server-rendered <option value>, prefilled from the "+ Add task" link's
  //      ?projectId=), never a name substitution — proving the LIN-1972
  //      resolveProjectRef exact-id-match-first fix on the path that needs it.
  // ===========================================================================
  test('the task-create page creates a task through the Session A route and it persists', async ({ page }) => {
    const CREATE_TITLE = 'Created via task-create page';
    const project = page.locator('.project').first();

    // The Local provider derives ui.inlineCreate, so the create affordance is a
    // link to the dedicated page, carrying the project as ?projectId= — the
    // provider's own composite id, not a name.
    const trigger = project.locator('[data-testid="create-task-trigger"]');
    const href = await trigger.getAttribute('href');
    expect(href).toMatch(/\/task\/new\?projectId=/);
    await trigger.click();
    await page.waitForLoadState('networkidle');

    const form = page.locator('[data-testid="task-create-form"]');
    await expect(form).toBeVisible();

    // Distinguishing assertion 1: no team control exists at all for a teamless
    // provider — not just left empty, structurally absent.
    await expect(form.locator('[data-testid="task-create-teamId"]')).toHaveCount(0);

    await form.locator('[data-testid="task-create-title"]').fill(CREATE_TITLE);

    // Distinguishing assertion 2: the project select's pre-selected option is
    // the REAL composite id carried in from ?projectId= — prove it round-trips
    // by submitting without touching the control at all.
    const projectSelect = form.locator('[data-testid="task-create-projectId"]');
    await expect(projectSelect).toHaveCount(1);
    const selectedProjectId = await projectSelect.inputValue();
    expect(selectedProjectId).toBe(new URL(href, page.url()).searchParams.get('projectId'));

    // Create it as started so the state clearly took (visible in In Progress).
    // Local's state ids are name-valued slugs (LOCAL_STATES), so this selects
    // by the same value the old inline form's free-text box sent.
    await form.locator('[data-testid="task-create-stateId"]').selectOption('In Progress');

    await form.locator('[data-testid="task-create-submit"]').click();
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

  // LIN-1575 review. The case above seeds the PLAIN string "Seeded parent", so
  // `toContainText('Seeded parent')` cannot tell rendering from echoing — the
  // reviewer proved it by replacing the render call with
  // `preview.textContent = textarea.value` and watching the whole suite stay
  // green. This case closes that hole with a real Markdown document, and closes
  // the round-trip's blind spot too: the existing one saves from the WRITE tab,
  // which is not the flow the feature invites.
  //
  // A whole-string ``` fence is deliberately NOT used as the fixture:
  // `window.renderMarkdown` runs `stripCodeBlockWrapper` first, which unwraps one
  // — a real fidelity gap, but an inherited one recorded on the ticket and out of
  // this pass's scope. The fenced block below sits inside a larger document, so
  // it is untouched by that helper.
  const MARKDOWN = [
    '# Heading',
    '',
    'Some **bold** text and `inline code`.',
    '',
    '- top bullet',
    '  - nested bullet',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted line',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '[a link](https://example.com)',
  ].join('\n');

  test('description Preview renders real Markdown, styles it, and saving from Preview round-trips the raw source', async ({ page }) => {
    await page.locator('.in-progress-items .line', { hasText: 'Local parent task' }).first().click();
    await page.locator('.detail-toggle[data-toggle="details"]').first().click();
    await page.locator('[data-testid="issue-edit-link"]').first().click();

    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();
    const editUrl = page.url();

    const textarea = form.locator('[data-testid="task-edit-description"]');
    const preview = form.locator('[data-testid="task-edit-preview"]');
    await textarea.fill(MARKDOWN);

    // The tabs are real tabs (review finding 2). getByRole only resolves these
    // if `role="tab"`/`role="tablist"` are actually on the elements, so this is
    // a genuine assertion of the ARIA fix, not a selector convenience.
    await expect(page.getByRole('tablist', { name: 'Description view' })).toBeVisible();
    const writeTab = page.getByRole('tab', { name: 'Write' });
    const previewTab = page.getByRole('tab', { name: 'Preview' });
    await expect(writeTab).toHaveAttribute('aria-selected', 'true');
    await expect(previewTab).toHaveAttribute('aria-selected', 'false');
    // Each tab points at the element it reveals.
    await expect(writeTab).toHaveAttribute('aria-controls', 'task-edit-description');
    await expect(previewTab).toHaveAttribute('aria-controls', 'task-edit-description-preview');

    await previewTab.click();
    await expect(preview).toBeVisible();
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(writeTab).toHaveAttribute('aria-selected', 'false');

    // RENDERED, not echoed. Every one of these is an element marked-up by
    // `marked`; none of them can exist if the pane is fed textContent.
    await expect(preview.locator('h1')).toHaveText('Heading');
    await expect(preview.locator('strong')).toHaveText('bold');
    await expect(preview.locator('code').first()).toHaveText('inline code');
    await expect(preview.locator('ul > li')).toHaveCount(2); // top + nested
    await expect(preview.locator('ul ul > li')).toHaveText('nested bullet');
    await expect(preview.locator('ol > li')).toHaveCount(2);
    await expect(preview.locator('blockquote')).toContainText('quoted line');
    await expect(preview.locator('pre > code')).toContainText('const x = 1;');
    await expect(preview.locator('a[href="https://example.com"]')).toHaveText('a link');
    // Sanitized on the way through: DOMPurify is in the pipeline, so the raw
    // Markdown source must not survive as literal syntax in the output.
    await expect(preview).not.toContainText('**bold**');

    // STYLED (review finding 1). The pane used to borrow `.comment-body`, which
    // styles p/code/a only — lists did not indent, fenced blocks had no box, and
    // blockquotes had no rule. Assert the treatment exists rather than exact
    // values, so a token or spacing tweak doesn't fail this for the wrong reason.
    const styles = await preview.evaluate((el) => {
      const px = (v) => parseFloat(v) || 0;
      const ul = el.querySelector('ul');
      const pre = el.querySelector('pre');
      const quote = el.querySelector('blockquote');
      return {
        ulPaddingLeft: px(getComputedStyle(ul).paddingLeft),
        prePadding: px(getComputedStyle(pre).paddingLeft),
        preBackground: getComputedStyle(pre).backgroundColor,
        quotePaddingLeft: px(getComputedStyle(quote).paddingLeft),
        quoteBorderLeft: px(getComputedStyle(quote).borderLeftWidth),
      };
    });
    expect(styles.ulPaddingLeft).toBeGreaterThan(0);
    expect(styles.prePadding).toBeGreaterThan(0);
    expect(styles.preBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.quotePaddingLeft).toBeGreaterThan(0);
    expect(styles.quoteBorderLeft).toBeGreaterThan(0);

    // Save WHILE PREVIEW IS THE SHOWING TAB — the flow a preview toggle invites,
    // and the one CI did not cover. The textarea is `hidden` here; a hidden
    // control is still submitted, and the toggle never writes to it, so the
    // stored value must come back as the raw Markdown that went in — not HTML,
    // not re-serialized Markdown.
    await expect(textarea).toBeHidden();
    await form.locator('[data-testid="task-edit-submit"]').click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/workspace\/[^/]+\/$/);

    await page.goto(editUrl);
    await expect(page.locator('[data-testid="task-edit-description"]')).toHaveValue(MARKDOWN);
  });
});
