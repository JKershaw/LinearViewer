import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh state for each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('renders landing page for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    // The brand hero is the page heading (LIN-726): lowercase `harbour` wordmark
    // as the single <h1>, with the anchor mark above it.
    await expect(page.locator('[data-testid="landing-hero"]')).toBeVisible();
    await expect(page.locator('h1.landing-wordmark')).toContainText('harbour');
    await expect(page.locator('.landing-mark svg')).toBeVisible();
  });

  test('does not show login or reset in header', async ({ page }) => {
    await page.goto('/');

    // Header should not have login or reset links (login is in page content instead)
    await expect(page.locator('header a.login')).not.toBeVisible();
    await expect(page.locator('header .reset-view')).not.toBeVisible();
  });

  test('shows footer with cross-view navigation and GitHub link', async ({ page }) => {
    await page.goto('/');

    // Footer should be visible
    await expect(page.locator('.page-footer')).toBeVisible();

    // projects is current page — shown in bold, not a link
    await expect(page.locator('.footer-actions strong.footer-current')).toHaveText('projects');
    // swipe and swim are links
    await expect(page.locator('.footer-actions a[href="/swipe"]')).toBeVisible();
    await expect(page.locator('.footer-actions a[href="/swim"]')).toBeVisible();

    // Should show GitHub link (fallback when no Heroku deploy info in test mode)
    const footerLink = page.locator('.footer-link');
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', 'https://github.com/JKershaw/LinearViewer');
  });

  test('displays static project preview from landing.md', async ({ page }) => {
    await page.goto('/');

    // landing.md defines 6 sections: What Harbour Is, Views, Orchestration,
    // Self-Host, Source, Harbour OS (LIN-726: Login moved into the hero; a small
    // Harbour OS section anchors the bottom).
    await expect(page.locator('.project-header')).toHaveCount(6);
    await expect(page.locator('.project-header:has-text("What Harbour Is")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Views")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Orchestration")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Self-Host")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Source")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Harbour OS")')).toBeVisible();
  });

  test('Harbour OS section links to os.harbour.cat', async ({ page }) => {
    await page.goto('/');

    // The Harbour OS row reveals its os.harbour.cat link on expand (same CLI
    // tree pattern as the Source links).
    const osRow = page.locator('.line:has(.title:has-text("Harbour OS"))');
    await osRow.click();
    const osLink = page.locator('a[href="https://os.harbour.cat"]');
    await expect(osLink).toBeVisible();
  });

  test('displays state indicators correctly', async ({ page }) => {
    await page.goto('/');

    // State counts from landing.md content (LIN-726: the in-progress "Connect
    // with Linear" row moved into the hero; a todo Harbour OS row was added):
    // - 2 done (✓): Any backend one cockpit, Grounded prompts two ways
    // - 0 in-progress (◐)
    // - 14 todo (○): The control plane, Tree/swipe/swim, Roadmap & ship, Observation,
    //                Dispatch, Autopilot, Workspace API proxy, Run it yourself,
    //                AI-assisted setup, Customize it, View on GitHub,
    //                Bugs & feature requests, Built by John Kershaw, Harbour OS
    // LIN-850: tree-row status glyphs render through the shared status primitive
    // as the box-less bare variant (`.status-pill--bare.status-pill--<state>`),
    // replacing the legacy `.state.<state>` spans.
    await expect(page.locator('.status-pill--bare.status-pill--done')).toHaveCount(2);
    await expect(page.locator('.status-pill--bare.status-pill--in-progress')).toHaveCount(0);
    await expect(page.locator('.status-pill--bare.status-pill--todo')).toHaveCount(14);
  });

  test('does not show logout link on landing page', async ({ page }) => {
    await page.goto('/');

    // Should NOT have logout link (only for authenticated users)
    await expect(page.locator('a.logout')).not.toBeVisible();
  });

  test('projects with @collapsed start collapsed by default', async ({ page }) => {
    await page.goto('/');

    // Self-Host and Source should be collapsed (have ▶ arrow)
    const selfHostHeader = page.locator('.project-header:has-text("Self-Host")');
    const sourceHeader = page.locator('.project-header:has-text("Source")');

    await expect(selfHostHeader).toContainText('▶');
    await expect(sourceHeader).toContainText('▶');

    // What Harbour Is and Views should be expanded (have ▼ arrow)
    const whatHarbourIsHeader = page.locator('.project-header:has-text("What Harbour Is")');
    const viewsHeader = page.locator('.project-header:has-text("Views")');

    await expect(whatHarbourIsHeader).toContainText('▼');
    await expect(viewsHeader).toContainText('▼');
  });

  test('collapsed projects have hidden content', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project (should be collapsed)
    const selfHostProject = page.locator('.project[data-default-collapsed="true"]').first();
    await expect(selfHostProject).toBeVisible();

    // Lines inside collapsed project should not be visible
    const linesInCollapsed = selfHostProject.locator('.line');
    await expect(linesInCollapsed.first()).not.toBeVisible();
  });

  test('collapsed projects can be expanded by clicking header', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project
    const selfHostProject = page.locator('.project:has(.project-header:has-text("Self-Host"))');
    const selfHostHeader = selfHostProject.locator('.project-header');
    const linesInProject = selfHostProject.locator('.line');

    // Should start collapsed
    await expect(linesInProject.first()).not.toBeVisible();

    // Click to expand
    await selfHostHeader.click();

    // Lines should now be visible
    await expect(linesInProject.first()).toBeVisible();
    await expect(selfHostHeader).toContainText('▼');
  });

  test('data-default-collapsed attribute is present on collapsed projects', async ({ page }) => {
    await page.goto('/');

    // Should have 2 projects with data-default-collapsed
    const collapsedProjects = page.locator('.project[data-default-collapsed="true"]');
    await expect(collapsedProjects).toHaveCount(2);
  });

  // LIN-726: sign-in moved into the brand hero. The CTAs are plain <a> links —
  // always visible and in the tab order — a strictly simpler a11y story than the
  // old expandable "Connect with Linear" row (LIN-566).
  test('hero sign-in CTA is a directly reachable link (LIN-726)', async ({ page }) => {
    await page.goto('/');

    const linearCta = page.locator('[data-testid="landing-cta-linear"]');
    // Visible without any expand step.
    await expect(linearCta).toBeVisible();
    await expect(linearCta).toHaveAttribute('href', '/auth/linear');

    // It's a real, keyboard-focusable link in the tab order.
    await linearCta.focus();
    await expect(linearCta).toBeFocused();
  });

  test('page reload resets to default state', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project and expand it
    const selfHostProject = page.locator('.project:has(.project-header:has-text("Self-Host"))');
    const selfHostHeader = selfHostProject.locator('.project-header');
    const linesInProject = selfHostProject.locator('.line');

    // Expand it
    await selfHostHeader.click();
    await expect(linesInProject.first()).toBeVisible();

    // Reload the page
    await page.reload();

    // Should be collapsed again (landing page doesn't persist state)
    await expect(linesInProject.first()).not.toBeVisible();
    await expect(selfHostHeader).toContainText('▶');
  });
});
