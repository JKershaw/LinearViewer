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
// NOT proven here (plan R1): nothing drives `/auth/jira/oauth` as HTTP. The
// config predicate guards the callback as well as the entry route, so on this
// unconfigured e2e server both 503 — the bootstrap is unit-proven only.
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
