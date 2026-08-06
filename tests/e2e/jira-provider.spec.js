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
      projects: [{ id: '20001', key: 'EMPTY', name: 'Empty Project', self: 'https://acme.atlassian.net/rest/api/3/project/20001' }],
      issues: [],
    });
    await page.goto(jiraDashboardUrl(JIRA_WORKSPACE_URL_KEY));
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-header:has-text("Empty Project")')).toBeVisible();
  });
});
