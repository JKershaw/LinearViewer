import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

test.describe('Interactive Features', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session first
    await page.goto('/test/set-session');

    // Clear localStorage once (after navigation so we have a page context)
    await page.evaluate(() => localStorage.clear());

    // Navigate to workspace page
    await page.goto(WORKSPACE_URL);
  });

  test('expands issue details on click', async ({ page }) => {
    // Find an expandable issue line in project section (not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await expect(issueLine).toBeVisible();

    // Details should be hidden initially
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    await expect(details).toHaveClass(/hidden/);

    // Click to expand
    await issueLine.click();

    // Details should now be visible
    await expect(details).not.toHaveClass(/hidden/);
  });

  test('collapses issue details on second click', async ({ page }) => {
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);

    // Click to expand
    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click again to collapse
    await issueLine.click();
    await expect(details).toHaveClass(/hidden/);
  });

  test('collapses entire project on header click', async ({ page }) => {
    const projectHeader = page.locator('.project-header').first();
    const project = page.locator('.project').first();

    // Get issue lines in this project
    const linesInProject = project.locator('.line');
    await expect(linesInProject.first()).toBeVisible();

    // Click header to collapse
    await projectHeader.click();

    // Lines should be hidden (have hidden class or not visible)
    await expect(linesInProject.first()).not.toBeVisible();

    // Click again to expand
    await projectHeader.click();

    // Lines should be visible again
    await expect(linesInProject.first()).toBeVisible();
  });

  test('toggles In Progress section', async ({ page }) => {
    const inProgressHeader = page.locator('.in-progress-header');
    const inProgressItems = page.locator('.in-progress-items');

    // Initially visible
    await expect(inProgressItems).toBeVisible();

    // Click to collapse
    await inProgressHeader.click();
    await expect(inProgressItems).not.toBeVisible();

    // Click to expand
    await inProgressHeader.click();
    await expect(inProgressItems).toBeVisible();
  });

  test('shows completed issues when toggle clicked', async ({ page }) => {
    // Find completed toggle button (mock data has completed issues, so this should exist)
    const completedToggle = page.locator('.completed-toggle').first();
    await expect(completedToggle).toBeVisible();
    await expect(completedToggle).toContainText('show');

    // Get the project ID
    const projectId = await completedToggle.getAttribute('data-project-id');
    const completedSection = page.locator(`[data-completed-for="${projectId}"]`);

    // Initially hidden
    await expect(completedSection).toHaveClass(/hidden/);

    // Click to show
    await completedToggle.click();

    // Should now be visible
    await expect(completedSection).not.toHaveClass(/hidden/);
    await expect(completedToggle).toContainText('hide');
  });

  test('reset button restores default state', async ({ page }) => {
    // Expand something first (use project section, not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);

    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click reset
    const resetButton = page.locator('.reset-view');
    await resetButton.click();

    // Details should be hidden again
    await expect(details).toHaveClass(/hidden/);
  });

  test('state persists after page reload', async ({ page }) => {
    // Expand an issue (use project section, not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');

    await issueLine.click();

    // Verify localStorage was updated
    const storageState = await page.evaluate(() => {
      return localStorage.getItem('linear-projects-state');
    });
    expect(storageState).toBeTruthy();
    const parsed = JSON.parse(storageState);
    // expanded is now an array of { id, section } objects
    expect(parsed.expanded).toContainEqual({ id: issueId, section: 'project' });

    // Reload page
    await page.reload();

    // Re-query locators after reload
    const projectAfterReload = page.locator('.project').first();
    const detailsAfterReload = projectAfterReload.locator(`.details[data-details-for="${issueId}"]`);

    // Issue should still be expanded
    await expect(detailsAfterReload).not.toHaveClass(/hidden/);
  });
});

test.describe('Detail Section Toggles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.evaluate(() => localStorage.clear());
    await page.goto(WORKSPACE_URL);
  });

  test('Details toggle shows/hides description and metadata', async ({ page }) => {
    // Find and expand an issue in project section
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
    const detailsContent = details.locator('.detail-content[data-content="details"]');

    // Details content should be hidden initially
    await expect(detailsToggle).toBeVisible();
    await expect(detailsToggle).toContainText('Details ▶');
    await expect(detailsContent).toHaveClass(/hidden/);

    // Click to expand
    await detailsToggle.click();
    await expect(detailsContent).not.toHaveClass(/hidden/);
    await expect(detailsToggle).toContainText('Details ▼');

    // Click to collapse
    await detailsToggle.click();
    await expect(detailsContent).toHaveClass(/hidden/);
    await expect(detailsToggle).toContainText('Details ▶');
  });

  test('Prompts toggle shows/hides prompt buttons', async ({ page }) => {
    // Find and expand an issue
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    const promptsContent = details.locator('.detail-content[data-content="prompts"]');

    // Prompts content should be hidden initially
    await expect(promptsToggle).toBeVisible();
    await expect(promptsToggle).toContainText('Prompts ▶');
    await expect(promptsContent).toHaveClass(/hidden/);

    // Click to expand
    await promptsToggle.click();
    await expect(promptsContent).not.toHaveClass(/hidden/);
    await expect(promptsToggle).toContainText('Prompts ▼');

    // Prompt buttons should be visible inside
    await expect(promptsContent.locator('.label-prompt').first()).toBeVisible();
  });

  test('Details and Prompts toggles work independently', async ({ page }) => {
    // Find and expand an issue
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
    const detailsContent = details.locator('.detail-content[data-content="details"]');
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    const promptsContent = details.locator('.detail-content[data-content="prompts"]');

    // Expand Details only
    await detailsToggle.click();
    await expect(detailsContent).not.toHaveClass(/hidden/);
    await expect(promptsContent).toHaveClass(/hidden/);

    // Expand Prompts too
    await promptsToggle.click();
    await expect(detailsContent).not.toHaveClass(/hidden/);
    await expect(promptsContent).not.toHaveClass(/hidden/);

    // Collapse Details, Prompts stays open
    await detailsToggle.click();
    await expect(detailsContent).toHaveClass(/hidden/);
    await expect(promptsContent).not.toHaveClass(/hidden/);
  });

  test('same issue in different sections has independent toggles', async ({ page }) => {
    // Find an in-progress issue (appears in both In Progress and Project sections)
    const inProgressItems = page.locator('.in-progress-items');
    const inProgressLine = inProgressItems.locator('.line.expandable').first();

    // Skip if no in-progress issues
    if (await inProgressLine.count() === 0) {
      test.skip();
      return;
    }

    const issueId = await inProgressLine.getAttribute('data-id');

    // Expand in In Progress section
    await inProgressLine.click();
    const inProgressDetails = inProgressItems.locator(`.details[data-details-for="${issueId}"]`);
    const inProgressDetailsToggle = inProgressDetails.locator('.detail-toggle[data-toggle="details"]');

    // Expand Details in In Progress section
    await inProgressDetailsToggle.click();
    const inProgressDetailsContent = inProgressDetails.locator('.detail-content[data-content="details"]');
    await expect(inProgressDetailsContent).not.toHaveClass(/hidden/);

    // Find same issue in project section (if it exists there)
    const projectDetails = page.locator(`.project .details[data-details-for="${issueId}"]`);
    if (await projectDetails.count() > 0) {
      // Project section's Details should still be collapsed (independent state)
      const projectDetailsContent = projectDetails.locator('.detail-content[data-content="details"]');
      await expect(projectDetailsContent).toHaveClass(/hidden/);
    }
  });

  test('View in Linear link remains visible outside toggles', async ({ page }) => {
    // Find and expand an issue with a URL
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    const viewInLinearLink = details.locator('.detail-link');

    // Link should be visible immediately (not inside a toggle)
    await expect(viewInLinearLink).toBeVisible();
    await expect(viewInLinearLink).toContainText('View in Linear');
  });

  test('Create task link is visible for authenticated users', async ({ page }) => {
    const project = page.locator('.project').first();
    const projectId = await project.getAttribute('data-id');

    // Link is now at end of task list, not hidden in project-meta
    const createTaskLink = project.locator('[data-action="create-task"]');
    await expect(createTaskLink).toBeVisible();
    await expect(createTaskLink).toContainText('+ Add task');

    const href = await createTaskLink.getAttribute('href');
    expect(href).toContain('linear.app/');
    expect(href).toContain('/new?project=');
    expect(href).toContain(projectId);
    await expect(createTaskLink).toHaveAttribute('target', '_blank');
  });

});

test.describe('Landing Page Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate first to have a page context, then clear localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('Create task link is NOT visible on landing page', async ({ page }) => {
    await page.reload();
    const createTaskLinks = page.locator('[data-action="create-task"]');
    await expect(createTaskLinks).toHaveCount(0);
  });

  test('collapse and expand work on landing page', async ({ page }) => {
    // Reload to start with clean localStorage state
    await page.reload();

    // Find an expandable issue
    const issueLine = page.locator('.line.expandable').first();

    // Landing page uses content/landing.md (not mock data) - skip if no expandable issues
    const count = await issueLine.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.details[data-details-for="${issueId}"]`);

    // Click to expand
    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click to collapse
    await issueLine.click();
    await expect(details).toHaveClass(/hidden/);
  });

  test('project headers collapse on landing page', async ({ page }) => {
    await page.reload();

    const projectHeader = page.locator('.project-header').first();
    const project = page.locator('.project').first();
    const linesInProject = project.locator('.line');

    // Click to collapse
    await projectHeader.click();
    await expect(linesInProject.first()).not.toBeVisible();

    // Click to expand
    await projectHeader.click();
    await expect(linesInProject.first()).toBeVisible();
  });

  test('landing page has Details toggle but no Prompts toggle', async ({ page }) => {
    await page.reload();

    // Find an expandable issue on landing page
    const issueLine = page.locator('.line.expandable').first();

    // Skip if no expandable issues on landing page
    if (await issueLine.count() === 0) {
      test.skip();
      return;
    }

    // Expand the issue
    await issueLine.click();

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.details[data-details-for="${issueId}"]`);

    // Details toggle should exist
    const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
    await expect(detailsToggle).toBeVisible();

    // Prompts toggle should NOT exist (landing page has no prompts)
    const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
    await expect(promptsToggle).toHaveCount(0);
  });
});

// =============================================================================
// LIN-156: Description Expansion and Comments
// =============================================================================
test.describe('Description Expansion (LIN-156)', () => {
  test.describe('Authenticated', () => {
    test.beforeEach(async ({ page }) => {
      // Set up test session (server will use mock data in test mode)
      await page.goto('/test/set-session');
      await page.goto('/workspace/test-workspace/');
    });

    test('Comments toggle appears for authenticated users', async ({ page }) => {
      // Find an expandable issue (use project section, first() to avoid duplicates)
      const issueLine = page.locator('.project .line.expandable').first();
      await expect(issueLine).toBeVisible();

      // Expand the issue to show details
      await issueLine.click();

      const issueId = await issueLine.getAttribute('data-id');
      // Use .project to get the details in project section specifically
      const details = page.locator(`.project .details[data-details-for="${issueId}"]`).first();

      // LIN-158: Comments is now nested inside Details, so expand Details first
      const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
      await expect(detailsToggle).toBeVisible();
      await detailsToggle.click();

      // Comments toggle should be visible inside Details content
      const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');
      await expect(commentsToggle).toBeVisible();
      await expect(commentsToggle).toContainText('Comments');
    });

    test('Clicking Comments toggle expands section and loads comments', async ({ page }) => {
      // Find an expandable issue
      const issueLine = page.locator('.project .line.expandable').first();
      await expect(issueLine).toBeVisible();

      // Expand issue details
      await issueLine.click();

      const issueId = await issueLine.getAttribute('data-id');
      const details = page.locator(`.project .details[data-details-for="${issueId}"]`).first();

      // LIN-158: Comments is now nested inside Details, so expand Details first
      const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
      await detailsToggle.click();

      const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');
      const commentsContent = details.locator('[data-content="comments"]');

      // Comments content should start hidden
      await expect(commentsContent).toHaveClass(/hidden/);

      // Click comments toggle
      await commentsToggle.click();

      // Comments content should now be visible
      await expect(commentsContent).not.toHaveClass(/hidden/);

      // Arrow should change from ▶ to ▼
      await expect(commentsToggle).toContainText('▼');

      // Should load and display mock comments
      const commentsList = commentsContent.locator('.comments-list');
      await expect(commentsList).toBeVisible();

      // Wait for comments to load (mock data has 2 comments)
      const comments = commentsList.locator('.comment');
      await expect(comments).toHaveCount(2);

      // Check first comment has expected content
      const firstComment = comments.first();
      await expect(firstComment.locator('.comment-meta')).toContainText('Alice');
      await expect(firstComment.locator('.comment-body')).toContainText('test comment');
    });

    test('Comments toggle arrow changes on expand/collapse', async ({ page }) => {
      const issueLine = page.locator('.project .line.expandable').first();
      await expect(issueLine).toBeVisible();

      await issueLine.click();

      const issueId = await issueLine.getAttribute('data-id');
      const details = page.locator(`.project .details[data-details-for="${issueId}"]`).first();

      // LIN-158: Comments is now nested inside Details, so expand Details first
      const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
      await detailsToggle.click();

      const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');

      // Initial state: collapsed (▶)
      await expect(commentsToggle).toContainText('▶');

      // Click to expand
      await commentsToggle.click();
      await expect(commentsToggle).toContainText('▼');

      // Click to collapse
      await commentsToggle.click();
      await expect(commentsToggle).toContainText('▶');
    });

    test('Comments show count after loading', async ({ page }) => {
      const issueLine = page.locator('.project .line.expandable').first();
      await expect(issueLine).toBeVisible();
      await issueLine.click();

      const issueId = await issueLine.getAttribute('data-id');
      const details = page.locator(`.project .details[data-details-for="${issueId}"]`).first();

      // LIN-158: Comments is now nested inside Details, so expand Details first
      const detailsToggle = details.locator('.detail-toggle[data-toggle="details"]');
      await detailsToggle.click();

      const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');

      // Before click: just "Comments ▶"
      await expect(commentsToggle).toContainText('Comments ▶');

      // Click to expand and load comments
      await commentsToggle.click();

      // After loading: should show count "Comments (2) ▼"
      await expect(commentsToggle).toContainText('Comments (2)');
    });
  });

  test.describe('Landing Page', () => {
    test('Comments toggle does NOT appear on landing page', async ({ page }) => {
      // Go to landing page (not authenticated - fresh context, no session)
      await page.goto('/');

      // Find an expandable issue on landing page
      const issueLine = page.locator('.line.expandable').first();

      if (await issueLine.count() === 0) {
        test.skip();
        return;
      }

      // Expand the issue
      await issueLine.click();

      const issueId = await issueLine.getAttribute('data-id');
      const details = page.locator(`.details[data-details-for="${issueId}"]`);

      // Comments toggle should NOT exist on landing page
      const commentsToggle = details.locator('.detail-toggle[data-toggle="comments"]');
      await expect(commentsToggle).toHaveCount(0);
    });
  });
});
