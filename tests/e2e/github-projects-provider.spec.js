import { test, expect } from '../fixtures/test-base.js';
import {
  seedGitHubProjectsWorkspace,
  GITHUB_PROJECTS_WORKSPACE_URL_KEY,
  githubProjectsDashboardUrl,
} from '../fixtures/github-projects-harness.js';

// LIN-560: end-to-end proof of the GitHub Projects v2 provider — a board-shaped
// backend, sibling to the GitHub Issues provider.
//
// Like the Issues spec, this rides NO `test-token` mock short-circuit.
// seedGitHubProjectsWorkspace() configures the registered `github-projects`
// singleton with an in-memory fake GraphQL backend and establishes a
// `provider: 'github-projects'` workspace whose binding is scoped to a board
// (`org/projectNumber`). The dashboard therefore renders the board's items mapped
// into the canonical model via the real getProviderForWorkspace +
// getWorkspaceCallScope read seam — proving a Projects v2 board's Status columns
// map into the canonical state model with no network and no GitHub auth (the
// project-picker/login is a second session).

const URL_KEY = GITHUB_PROJECTS_WORKSPACE_URL_KEY;
const DASHBOARD = githubProjectsDashboardUrl(URL_KEY);

test.describe('GitHub Projects provider (no test-token mock)', () => {
  test.beforeEach(async ({ page }) => {
    await seedGitHubProjectsWorkspace(page);
    await page.goto(DASHBOARD);
    await page.waitForLoadState('networkidle');
  });

  test('dashboard renders the board container + its items from the fake backend', async ({ page }) => {
    // The board itself maps to a canonical project header (named by board title).
    await expect(page.locator('.project-header:has-text("Roadmap")')).toBeVisible();
    // Board items render under it: the In Progress, Todo, and Done items.
    await expect(page.locator('.line:has-text("Board task in progress")').first()).toBeAttached();
    await expect(page.locator('.line:has-text("Board task to do")').first()).toBeAttached();
    await expect(page.locator('.line:has-text("Board task shipped")').first()).toBeAttached();
    // The draft item (no Status column) surfaces too.
    await expect(page.locator('.line:has-text("Draft idea")').first()).toBeAttached();
  });

  test('detail link is provider-aware: "View in GitHub Projects" (not Linear)', async ({ page }) => {
    // render.js interpolates provider.ui.displayName into the detail link. The
    // detail block is lazy — expand an issue to load it first.
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.detail-link', { hasText: 'View in GitHub Projects' }).first()).toBeAttached();
    await expect(page.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
  });
});

// An empty / unresolved board still renders its container (empty state),
// consistent with how Linear/Local/Issues render an empty project.
test.describe('GitHub Projects provider — empty board', () => {
  test('a board with zero items still renders its container', async ({ page }) => {
    await seedGitHubProjectsWorkspace(page, {
      project: { id: 'PVT_e', number: 7, title: 'Empty Board', url: 'https://github.com/orgs/octocat/projects/7', shortDescription: null },
      items: [],
    });
    await page.goto(githubProjectsDashboardUrl(GITHUB_PROJECTS_WORKSPACE_URL_KEY));
    await page.waitForLoadState('networkidle');

    // The board container renders as a header...
    await expect(page.locator('.project-header:has-text("Empty Board")')).toBeVisible();
    // ...with no issue rows inside it.
    await expect(page.locator('.line')).toHaveCount(0);
  });
});
