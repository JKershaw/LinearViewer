import { test, expect } from '../fixtures/test-base.js';
import {
  seedJiraWorkspace,
  JIRA_WORKSPACE_URL_KEY,
  jiraDashboardUrl,
} from '../fixtures/jira-harness.js';

// LIN-1885 (Phase 1 of LIN-275): end-to-end proof of the Jira Cloud provider —
// a genuinely hostile third-party schema, sibling to GitHub Issues/Projects.
//
// Like the GitHub specs, this rides NO `test-token` mock short-circuit.
// seedJiraWorkspace() configures the registered `jira` singleton with an
// in-memory fake REST client and establishes a `provider: 'jira'` workspace
// whose binding is scoped to a Jira site. The dashboard therefore renders the
// site's issues mapped into the canonical model via the real
// getProviderForWorkspace + getWorkspaceCallScope read seam — proving the
// statusCategory→canonical state mapping with no network and no live Jira
// credential (the link-form/auth flow is a separate concern, covered by
// tests/unit/jira-auth.test.js).

const URL_KEY = JIRA_WORKSPACE_URL_KEY;
const DASHBOARD = jiraDashboardUrl(URL_KEY);

test.describe('Jira provider (no test-token mock)', () => {
  test.beforeEach(async ({ page }) => {
    await seedJiraWorkspace(page);
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
  });

  test('dashboard renders the project container + its issues from the fake backend', async ({ page }) => {
    // The Jira project itself maps to a canonical project header (named by project name).
    await expect(page.locator('.project-header:has-text("Engineering")')).toBeVisible();
    // Issues render under it, across all three statusCategory states.
    await expect(page.locator('.line:has-text("Jira task to do")').first()).toBeAttached();
    await expect(page.locator('.line:has-text("Jira task in progress")').first()).toBeAttached();
    await expect(page.locator('.line:has-text("Jira task shipped")').first()).toBeAttached();
    // The best-effort subtask surfaces too (native one-level parent/child).
    await expect(page.locator('.line:has-text("Subtask of the in-progress task")').first()).toBeAttached();
  });

  test('detail link is provider-aware: "View in Jira" (not Linear) — the ui.displayName trap, rendered', async ({ page }) => {
    // render.js interpolates provider.ui.displayName into the detail link. The
    // detail block is lazy — expand an issue to load it first.
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.detail-link', { hasText: 'View in Jira' }).first()).toBeAttached();
    await expect(page.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
  });

  test('the project "View in Jira" link is a browsable /browse/ URL, never the raw REST resource URL (LIN-1885 beat 2 review finding #4)', async ({ page }) => {
    const projectLink = page.locator('.project-meta .detail-link', { hasText: 'View in Jira' }).first();
    await expect(projectLink).toBeAttached();
    const href = await projectLink.getAttribute('href');
    expect(href).toBe('https://acme.atlassian.net/browse/ENG');
    expect(href).not.toContain('/rest/api/');
  });

  test('an issue description renders the ADF→Markdown conversion, not raw ADF JSON', async ({ page }) => {
    await page.locator('.line:has-text("Jira task to do")').first().click();
    // Description/comments are nested inside the collapsed "Details" section
    // (LIN-158) — expand it before looking for either. A short description
    // (< 3 lines / 300 chars) renders as a plain .detail-line, not the
    // truncating .issue-description wrapper — either way it must be the
    // converted Markdown text, never the raw ADF document.
    await page.locator('[data-toggle="details"]').first().click();
    await expect(page.locator('.detail-content[data-content="details"]', { hasText: 'A todo Jira issue.' }).first()).toBeAttached();
    await expect(page.locator('body')).not.toContainText('"type":"doc"');
  });

  test('a comment on the in-progress issue renders via the fake client (fetchIssueComments)', async ({ page }) => {
    await page.locator('.line:has-text("Jira task in progress")').first().click();
    await page.locator('[data-toggle="details"]').first().click();
    await page.locator('[data-toggle="comments"]').first().click();
    await expect(page.locator('.comment-body', { hasText: 'Investigating.' }).first()).toBeAttached();
  });
});

// An empty / unresolved project still renders its container (empty state),
// consistent with how Linear/Local/GitHub render an empty project.
test.describe('Jira provider — empty project', () => {
  test('a project with zero issues still renders its container', async ({ page }) => {
    await seedJiraWorkspace(page, {
      projects: [{ id: '20001', key: 'EMPTY', name: 'Empty Project' }],
      issues: [],
    });
    await page.goto(jiraDashboardUrl(JIRA_WORKSPACE_URL_KEY));
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Empty Project")')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// LIN-1890 E6c — the Jira-ONLY user outcome, on an OAUTH binding.
//
// The signal that tracks a user outcome rather than proxying for one: a session
// holding ZERO Linear and ZERO GitHub bindings reaches the dashboard AND gets a
// working prompt. A CTA that renders and a callback that 200s can both be green
// while this is broken, which is why neither is asserted here.
//
// The binding is seeded OAuth-shaped (`authType: 'oauth'`), and the fixture's
// client seam now ASSERTS that shape (routes/test.js) — so if the OAuth
// projection in getWorkspaceCallScope regressed to the Basic one, every test
// below fails loudly at the seam instead of silently passing on a fake that
// ignored its credential.
//
// The prompt leg is the half that had no coverage at all and is reachable at
// HEAD. It is a real user path: a Jira-only human whose dashboard renders but
// whose prompts 500 has not been given a working workspace.
//
// NOT proven here, narrowed at close-out (review F1 corrected plan R1): the
// entry route IS driven as HTTP elsewhere — this server is Jira-OAuth-configured
// (playwright.config.js), so `landing.spec.js` asserts `/auth/jira/oauth?mode=new`
// → 302 to Atlassian and `settings-providers.spec.js` asserts the add-source
// leg. What genuinely has no e2e coverage is the CALLBACK: the code→token
// exchange has no stub seam, so the bootstrap round trip is unit-proven only.
// That is a real harness limitation, not a config one.
// ---------------------------------------------------------------------------
test.describe('LIN-1890 — a Jira-only session on an OAuth binding', () => {
  test.beforeEach(async ({ page }) => {
    await seedJiraWorkspace(page, undefined, { authType: 'oauth' });
    await page.goto(jiraDashboardUrl(JIRA_WORKSPACE_URL_KEY));
    await page.waitForLoadState('networkidle');
  });

  test('the session holds NO Linear or GitHub workspace — the premise, asserted not assumed', async ({ page }) => {
    // A co-resident Linear binding would make every assertion below pass for
    // the wrong reason, so the zero-Linear premise is checked rather than
    // trusted. The nav's workspace panel lists every connected workspace as a
    // `role="option"` row — the `+add` row shares the class but is not a
    // workspace, so the role is what makes this count the right thing.
    await expect(page.locator('.nav-options-row a.nav-option[role="option"]')).toHaveCount(1);
    await expect(page.locator('.nav-item[data-selector="workspace"] .nav-value')).toContainText('Jira Workspace');
  });

  test('the dashboard renders issues through the OAuth call scope', async ({ page }) => {
    await expect(page.locator('.project-header:has-text("Engineering")')).toBeVisible();
    await expect(page.locator('.line:has-text("Jira task in progress")').first()).toBeAttached();
  });

  test('the PROMPT leg works — the half with no prior coverage', async ({ page }) => {
    const row = page.locator('.line:has-text("Jira task in progress")').first();
    await row.click();
    await page.locator('[data-toggle="details"]').first().click();
    await page.locator('[data-toggle="prompts"]').first().click();
    await page.locator('[data-label="implementation"]').first().click();
    await expect(page.locator('.prompt-text').first()).toContainText('Jira task in progress');
  });

  test('the detail surface stays provider-aware for a Jira-only session', async ({ page }) => {
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.detail-link', { hasText: 'View in Jira' }).first()).toBeAttached();
    await expect(page.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// LIN-1942 — the Jira browser WRITE lane. Phase 2 (LIN-1886) shipped
// `updateIssue`, status transitions, and the D1-D4 refusal gates, but every
// prior E2E spec here (and detail-nonactive-binding.spec.js) only exercised
// READS. Three cases against the in-tree fake, all in THIS file rather than a
// new seeding file: `provider.configure` (routes/test.js) is a process-level
// side effect that outlives one seed call, and Playwright runs parallel BY
// FILE (playwright.config.js) — splitting these into a second file would risk
// a mid-flight reseed racing a concurrently-running read spec here.
//
// Case A proves a BENIGN, Jira-editor-shaped description (ENG-1 now carries a
// `localId` attrs key, LIN-2019 exception 3) actually SAVES — the obligation
// LIN-2019's close-out routed here, not just that a hazard refuses. Case B
// drives a genuine status transition through ENG-1's seeded `_transitions`
// sidecar. Case C is the D1 refusal this ticket exists for: an honest
// in-browser error, no navigation, no persisted change.
// ---------------------------------------------------------------------------
test.describe('Jira provider — browser write lane (LIN-1942)', () => {
  test.beforeEach(async ({ page }) => {
    await seedJiraWorkspace(page);
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
  });

  test('a benign field write persists and reads back through the UI after a fresh dashboard render', async ({ page }) => {
    await page.locator('.line:has-text("Jira task to do")').first().click();
    await page.locator('[data-toggle="details"]').first().click();
    await page.locator('[data-testid="issue-edit-link"]').first().click();

    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();
    // public/task-edit.js always resends `description` on submit (the full-body
    // replace) — ENG-1's stored description carries a `localId` attrs key, so
    // this write proves that resend does not trip the D1 gate on a benign issue.
    const NEW_TITLE = 'Jira task to do — edited (LIN-1942)';
    await form.locator('[data-testid="task-edit-title"]').fill(NEW_TITLE);
    await form.locator('[data-testid="task-edit-submit"]').click();

    await page.waitForURL(DASHBOARD);

    // Read back through a FRESH render, not just the post-save DOM.
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
    // The renamed title is a superstring of the old one ("Jira task to do —
    // edited …"), so the positive assertion below is the meaningful proof of
    // persistence — a stale/unwritten title would not contain the ` — edited`
    // suffix at all.
    await expect(page.locator('.line', { hasText: NEW_TITLE }).first()).toBeAttached();
  });

  test('a status transition moves the issue, rendered by outcome (status pill + section), not a synthetic id', async ({ page }) => {
    await page.locator('.line:has-text("Jira task to do")').first().click();
    await page.locator('[data-toggle="details"]').first().click();
    await page.locator('[data-testid="issue-edit-link"]').first().click();

    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();
    // Jira's own state ids ('in-progress') are not UUIDs, so the option VALUE
    // sent is the state NAME (stateOptionValue, lib/render-task-edit.js) —
    // select by the visible label, matching what a human actually picks.
    await form.locator('[data-testid="task-edit-stateId"]').selectOption('In Progress');
    await form.locator('[data-testid="task-edit-submit"]').click();
    await page.waitForURL(DASHBOARD);

    // Fresh render: the row now carries the "in-progress" status pill and
    // lives under the dashboard's In Progress section — the rendered outcome,
    // never the fake's internal transition id.
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
    const row = page.locator('.in-progress-items .line:has-text("Jira task to do")').first();
    await expect(row).toBeAttached();
    await expect(row.locator('[data-status="in-progress"]')).toBeAttached();
  });

  test('a D1 refusal renders honestly: the real error text, no navigation, no persisted change', async ({ page }) => {
    // ENG-6's description carries an unmodeled underline MARK — the D1 gate
    // (adfHasUnrenderableContent) refuses any write while it stands, since the
    // check runs against the CURRENT stored ADF, not the incoming patch.
    await page.locator('.line:has-text("Issue with an underline mark in its description")').first().click();
    await page.locator('[data-toggle="details"]').first().click();
    await page.locator('[data-testid="issue-edit-link"]').first().click();

    const form = page.locator('[data-testid="task-edit-form"]');
    await expect(form).toBeVisible();
    const editUrl = page.url();
    const REJECTED_TITLE = 'Should never persist (LIN-1942 D1)';
    await form.locator('[data-testid="task-edit-title"]').fill(REJECTED_TITLE);
    await form.locator('[data-testid="task-edit-submit"]').click();

    // Honest rendering: [data-task-edit-status] carries the real 422 message
    // (the toast auto-dismisses, so it is not a reliable assertion target).
    await expect(form.locator('[data-task-edit-status]')).toContainText(
      "Cannot overwrite this issue's description",
    );
    // No navigation: still on the same edit page.
    await expect(page).toHaveURL(editUrl);
    // The form is re-armed for a retry, not left stuck mid-submit.
    await expect(form.locator('[data-testid="task-edit-submit"]')).toBeEnabled();

    // No persisted change — including the title, per N1 ordering (every
    // refusable check runs before the first write): a fresh dashboard render
    // still shows the original title, never the rejected one.
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.line', { hasText: REJECTED_TITLE })).toHaveCount(0);
    await expect(page.locator('.line:has-text("Issue with an underline mark in its description")').first()).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// LIN-2001 — the Jira OAuth callback driven as real HTTP.
//
// Every other Jira OAuth spec in this repo (settings-providers.spec.js,
// landing.spec.js) stops at the begin leg's 302 to Atlassian's consent
// screen — no live Atlassian app exists (D3). The callback
// (`GET /auth/jira/oauth/callback`) and the `mode:'new'` session-bootstrap it
// drives were previously proven only by unit tests that fake `fetch`
// (tests/unit/lin-1890-jira-entry-layer.test.js); nothing exercised the
// sequence over a real cookie round-trip, which is exactly where
// `session.regenerate()` bugs live. `JIRA_OAUTH_TEST_BASE`
// (playwright.config.js) points the two direct-fetch call sites in
// `lib/providers/jira/oauth.js` at the in-process fake Atlassian routes
// (routes/test.js), so this spec drives begin → callback → dashboard for a
// zero-Linear `mode=new` session with no live Atlassian app and no other
// fake HTTP endpoint.
//
// Explicit non-goal: this does not re-prove the unit-tested error branches
// (`regenerate()` throwing → 500, refresh-token dropped on an error exit,
// the multi-site picker, add-source mode) — those stay owned by
// tests/unit/lin-1890-jira-entry-layer.test.js. This spec proves the one
// thing that suite structurally cannot: that the sequence survives a real
// cookie round-trip over real HTTP.
test.describe('LIN-2001 — Jira OAuth callback driven as real HTTP', () => {
  test('begin -> callback -> dashboard lands a zero-Linear mode=new session on a real HTTP round-trip', async ({ page, browser }) => {
    // Pin the `clientFactory` seam deterministically before touching the OAuth
    // flow at all. `provider.configure({ clientFactory })` (routes/test.js) is
    // a PROCESS-LEVEL side effect, not a per-session one — without seeding it
    // first, the identity lookup in `completeJiraOAuthLink` falls back to a
    // real `createJiraClient` and attempts genuine outbound HTTPS to
    // Atlassian. A SEPARATE, isolated browser context (not this test's own
    // `page`/`page.request`) keeps that call's session-side effects out of
    // this flow's own cookie jar. That isolation is cheap hygiene, not a fix
    // for a urlKey collision: the seeding call's own seeded workspace uses the
    // fixture's fixed `jira-workspace` urlKey, which never collides with this
    // flow's derived `acme` (deriveJiraUrlKey, routes/jira-auth.js) — the
    // fake's only load-bearing effect is the process-level `clientFactory`
    // registration, and the response/session it creates is discarded.
    const seedContext = await browser.newContext();
    await seedContext.request.post('/test/set-jira-session', { data: { authType: 'oauth' } });
    await seedContext.close();

    // Begin: the same call landing.spec.js/settings-providers.spec.js already
    // make, on THIS test's own `page.request` context so it shares cookies
    // with the callback below and the later `page.goto`.
    const beginRes = await page.request.get('/auth/jira/oauth?mode=new', { maxRedirects: 0 });
    expect(beginRes.status()).toBe(302);
    const consent = new URL(beginRes.headers()['location']);
    expect(consent.origin).toBe('https://auth.atlassian.com');
    const state = consent.searchParams.get('state');
    expect(state).toBeTruthy();

    // Callback: same context as begin, so `state !== req.session.oauthState`
    // (routes/jira-auth.js) resolves against the SAME session. `code` is
    // arbitrary — the fake token endpoint accepts any body.
    const callbackRes = await page.request.get(`/auth/jira/oauth/callback?code=fake-code&state=${encodeURIComponent(state)}`, { maxRedirects: 0 });
    expect(callbackRes.status()).toBe(302);
    // The `mode:'new'` single-site bootstrap lands IN the workspace, no query
    // string (`completeJiraNewLogin`'s `finish()`, routes/jira-auth.js) — this
    // is the add-source arm's `?provider_ok=jira`, not this one.
    // `deriveJiraUrlKey` derives `acme` from the fake accessible-resources
    // site (`https://acme.atlassian.net`) against this flow's own empty
    // `existingWorkspaces` (the seeding call never touched this session).
    expect(callbackRes.headers()['location']).toBe('/workspace/acme/');

    // Dashboard: the post-redirect read resolves through the SAME seeded
    // `clientFactory` fake (JiraProvider._clientFor's OAuth arm), proving the
    // seeding call in step 1 covers both the identity probe and this read —
    // no third fake HTTP endpoint required.
    await page.goto(callbackRes.headers()['location']);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Engineering")')).toBeVisible();

    // Session shape via a page-rendered signal, not `req.session` directly —
    // the zero-Linear/zero-GitHub premise (mirrors LIN-1890's own check
    // above): exactly one connected workspace, named from the fake site.
    await expect(page.locator('.nav-options-row a.nav-option[role="option"]')).toHaveCount(1);
    await expect(page.locator('.nav-item[data-selector="workspace"] .nav-value')).toContainText('Acme');
  });
});
