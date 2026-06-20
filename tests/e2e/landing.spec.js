import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh state for each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('renders landing page for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    // Should show the organization name from landing.md
    await expect(page.locator('h1')).toContainText('Linear Projects Viewer');
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

    // landing.md defines 7 projects: Login, Views, What This Is, AI Integration, Self-Host, Use Cases, Source
    await expect(page.locator('.project-header')).toHaveCount(7);
    await expect(page.locator('.project-header:has-text("Login")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Views")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("What This Is")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("AI Prompts")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Self-Host")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Use Cases")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Source")')).toBeVisible();
  });

  test('displays state indicators correctly', async ({ page }) => {
    await page.goto('/');

    // State counts from landing.md content:
    // - 4 done (✓): Collapsible tree view, Always fresh, Auto-logout, Works everywhere
    // - 2 in-progress (◐): Connect with Linear, Projects tree
    // - 16 todo (○): You're looking at it, Swipe, Swim lanes, Task-specific prompts, Connect OpenRouter,
    //                How it works, Run it yourself, AI-assisted setup, Customize it,
    //                Daily standups, Project reviews, Status overviews,
    //                What is Linear, View on GitHub, Bugs & feature requests, Built by John Kershaw
    await expect(page.locator('.state.done')).toHaveCount(4);
    await expect(page.locator('.state.in-progress')).toHaveCount(2);
    await expect(page.locator('.state.todo')).toHaveCount(16);
  });

  test('does not show logout link on landing page', async ({ page }) => {
    await page.goto('/');

    // Should NOT have logout link (only for authenticated users)
    await expect(page.locator('a.logout')).not.toBeVisible();
  });

  test('projects with @collapsed start collapsed by default', async ({ page }) => {
    await page.goto('/');

    // Self-Host, Use Cases, and Source should be collapsed (have ▶ arrow)
    const selfHostHeader = page.locator('.project-header:has-text("Self-Host")');
    const useCasesHeader = page.locator('.project-header:has-text("Use Cases")');
    const sourceHeader = page.locator('.project-header:has-text("Source")');

    await expect(selfHostHeader).toContainText('▶');
    await expect(useCasesHeader).toContainText('▶');
    await expect(sourceHeader).toContainText('▶');

    // Login and What This Is should be expanded (have ▼ arrow)
    const loginHeader = page.locator('.project-header:has-text("Login")');
    const whatThisIsHeader = page.locator('.project-header:has-text("What This Is")');

    await expect(loginHeader).toContainText('▼');
    await expect(whatThisIsHeader).toContainText('▼');
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

    // Should have 3 projects with data-default-collapsed
    const collapsedProjects = page.locator('.project[data-default-collapsed="true"]');
    await expect(collapsedProjects).toHaveCount(3);
  });

  // LIN-566: the sign-in CTA must be reachable for keyboard/screen-reader users.
  // The "Connect with Linear" row is the shared .line.expandable primitive; it
  // must be a focusable role=button that expands on Enter/Space and reveals the
  // /auth/linear link back into the tab order.
  test('sign-in row is a keyboard-operable control (LIN-566)', async ({ page }) => {
    await page.goto('/');

    const signInRow = page.locator('.line.expandable:has-text("Connect with Linear")');
    await expect(signInRow).toBeVisible();

    // It is announced as a control and starts collapsed.
    await expect(signInRow).toHaveAttribute('role', 'button');
    await expect(signInRow).toHaveAttribute('tabindex', '0');
    await expect(signInRow).toHaveAttribute('aria-expanded', 'false');

    // The login link is out of the tab order until the row is expanded.
    const loginLink = page.locator('a[href="/auth/linear"]');
    await expect(loginLink).not.toBeVisible();

    // Keyboard activation: focus the row and press Enter.
    await signInRow.focus();
    await expect(signInRow).toBeFocused();
    await page.keyboard.press('Enter');

    // State is announced as expanded and the login link is now reachable.
    await expect(signInRow).toHaveAttribute('aria-expanded', 'true');
    await expect(loginLink).toBeVisible();

    // The revealed anchor is a real, keyboard-focusable link (back in tab order).
    await loginLink.focus();
    await expect(loginLink).toBeFocused();
  });

  test('sign-in row toggles with Space and Space does not scroll (LIN-566)', async ({ page }) => {
    await page.goto('/');

    const signInRow = page.locator('.line.expandable:has-text("Connect with Linear")');
    const loginLink = page.locator('a[href="/auth/linear"]');

    await signInRow.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press(' ');

    // Space expands the row (single source of truth: aria-expanded flips)...
    await expect(signInRow).toHaveAttribute('aria-expanded', 'true');
    await expect(loginLink).toBeVisible();
    // ...and is prevented from scrolling the page.
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);

    // Space again collapses it (round-trips through the same toggle path).
    await page.keyboard.press(' ');
    await expect(signInRow).toHaveAttribute('aria-expanded', 'false');
    await expect(loginLink).not.toBeVisible();
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
