import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-427: the swipe surface is fully modeled by the local provider (the page
// reads projects/issues through fetchAndPrepareProjects, and the recap/brief AI
// mock re-gates onto local sessions per #399), so all four describe blocks ride a
// GENUINE `provider: 'local'` session seeded from `workspaceApiLocalSeed` (the
// shared pipeline/workspace-api fixture, derived from testMockData) instead of the
// `test-token` + `testMockData` mock short-circuit. The seed preserves the exact
// identifiers/labels/relations the selectors assert on (TEST-1..TEST-15, Project
// Alpha, bug/urgent/feature labels, TEST-15→TEST-14 blocks, TEST-1→TEST-2 parent),
// so assertions stay byte-identical. The shared workspace URL constant couples all
// four blocks, so they migrate together.

test.describe('Swipe Page', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('renders swipe page with card', async ({ page }) => {
    // Swipe now carries a page title via the shared renderPageHeader primitive
    // (LIN-975); previously it had none.
    await expect(page.locator('.page-header h1')).toHaveText('Swipe');

    // Should have a filter dropdown
    await expect(page.locator('.swipe-filter-select')).toBeVisible();

    // Should have a card with content
    await expect(page.locator('.swipe-card')).toBeVisible();

    // Should show card position counter (dots or text)
    await expect(page.locator('.swipe-counter')).toBeVisible();
  });

  test('displays task card with correct elements', async ({ page }) => {
    // Card should have status indicator
    await expect(page.locator('.swipe-card-status .status-pill')).toBeVisible();

    // Card should have a title
    await expect(page.locator('.swipe-card-title')).toBeVisible();

    // Card should have a position indicator
    await expect(page.locator('.swipe-card-position')).toBeVisible();
  });

  test('arrow buttons navigate between cards', async ({ page }) => {
    // Get initial card position text
    const positionText = await page.locator('.swipe-card-position').textContent();

    // If there are multiple tasks, right arrow should advance
    if (!positionText.includes('1 / 1')) {
      const rightArrow = page.locator('.swipe-arrow-right');
      await expect(rightArrow).not.toBeDisabled();

      // Click right arrow
      await rightArrow.click();

      // Card position should update to show card 2
      await expect(page.locator('.swipe-card-position')).toContainText('2 /');

      // Left arrow should now be enabled
      await expect(page.locator('.swipe-arrow-left')).not.toBeDisabled();

      // Click left arrow to go back
      await page.locator('.swipe-arrow-left').click();
      await expect(page.locator('.swipe-card-position')).toContainText('1 /');
    }
  });

  test('left arrow is disabled on first card', async ({ page }) => {
    await expect(page.locator('.swipe-arrow-left')).toBeDisabled();
  });

  test('filter dropdown changes card set', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');
    const options = await select.locator('option').allTextContents();

    // Should have at least one filter option
    expect(options.length).toBeGreaterThan(0);

    // If there are multiple options, changing filter should reset to card 1
    if (options.length > 1) {
      // First navigate to card 2 if possible
      const rightArrow = page.locator('.swipe-arrow-right');
      if (!await rightArrow.isDisabled()) {
        await rightArrow.click();
      }

      // Select a different filter
      const secondOption = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(secondOption);

      // Card position should reset to 1
      const position = await page.locator('.swipe-card-position').textContent();
      expect(position).toMatch(/^1 \//);
    }
  });

  test('description accordion expands and collapses', async ({ page }) => {
    const descHeader = page.locator('.swipe-accordion-header[data-accordion="description"]');

    // Only test if current card has a description
    if (await descHeader.count() > 0) {
      const descBody = page.locator('.swipe-accordion-body[data-accordion-body="description"]');

      // Should start closed
      await expect(descBody).not.toHaveClass(/open/);

      // Click to open
      await descHeader.click();
      await expect(descBody).toHaveClass(/open/);
      await expect(descHeader).toHaveClass(/open/);

      // Click to close
      await descHeader.click();
      await expect(descBody).not.toHaveClass(/open/);
    }
  });

  test('prompt buttons are displayed after opening Prompts accordion', async ({ page }) => {
    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await expect(promptsHeader).toBeVisible();
    await promptsHeader.click();

    const promptBtns = page.locator('.swipe-prompt-btn');
    await expect(promptBtns.first()).toBeVisible();
  });

  test('keyboard navigation works', async ({ page }) => {
    const positionText = await page.locator('.swipe-card-position').textContent();

    if (!positionText.includes('1 / 1')) {
      // Press right arrow key
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.swipe-card-position')).toContainText('2 /');

      // Press left arrow key
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.swipe-card-position')).toContainText('1 /');
    }
  });

  test('swipe shows as current in the header switcher', async ({ page }) => {
    // The current page shows "swipe" as bold in the header nav (LIN-978).
    await expect(page.locator('.nav-views [data-testid="nav-view-swipe"].nav-view-current')).toBeVisible();
  });

  test('swipe link appears in the header switcher on the dashboard', async ({ page, localWorkerUrlKey }) => {
    // Navigate to main dashboard
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Header switcher (LIN-978) carries the swipe link.
    await expect(page.locator('.nav-views a[data-testid="nav-view-swipe"]')).toBeVisible();
  });

  test('shows blocking relationship rows on cards', async ({ page }) => {
    // Navigate through cards to find one with blocking info
    // TEST-15 (Refactor auth) blocks TEST-14 (Add pagination)
    let foundBlocks = false;
    let foundBlocked = false;
    const maxCards = 15;

    for (let i = 0; i < maxCards; i++) {
      const blocksRow = page.locator('.swipe-meta-blocks');
      const blockedRow = page.locator('.swipe-meta-blocked');

      if (await blocksRow.isVisible()) {
        foundBlocks = true;
        await expect(blocksRow.locator('.swipe-card-meta-label')).toHaveText('Blocks');
        await expect(blocksRow.locator('.swipe-blocking-issue')).toBeVisible();
      }

      if (await blockedRow.isVisible()) {
        foundBlocked = true;
        await expect(blockedRow.locator('.swipe-card-meta-label')).toHaveText('Blocked by');
        await expect(blockedRow.locator('.swipe-blocking-issue')).toBeVisible();
      }

      if (foundBlocks && foundBlocked) break;

      const rightArrow = page.locator('.swipe-arrow-right');
      if (await rightArrow.isDisabled()) break;
      await rightArrow.click();
    }

    // Mock data has TEST-15 blocks TEST-14, so both should appear
    expect(foundBlocks).toBe(true);
    expect(foundBlocked).toBe(true);
  });

  test('shows parent/subtask relationship rows on cards', async ({ page, localWorkerUrlKey }) => {
    // TEST-2 is a child of TEST-1 (parent/child relationship)
    // Navigate to TEST-2 which should show a "Parent" row
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe/TEST-2`);
    await page.waitForLoadState('networkidle');

    const parentRow = page.locator('.swipe-meta-parent');
    await expect(parentRow).toBeVisible();
    await expect(parentRow.locator('.swipe-card-meta-label')).toHaveText('Parent');
    const parentLink = parentRow.locator('a.swipe-relation-issue');
    await expect(parentLink).toHaveText('TEST-1');
    // Parent is in-progress, so link should have the in-progress colour class
    await expect(parentLink).toHaveClass(/swipe-relation-in-progress/);

    // Navigate to TEST-1 which should show a "Subtasks" row
    await parentLink.click();
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-1');

    const subtasksRow = page.locator('.swipe-meta-subtasks');
    await expect(subtasksRow).toBeVisible();
    await expect(subtasksRow.locator('.swipe-card-meta-label')).toHaveText('Subtasks');
    const subtaskLink = subtasksRow.locator('a.swipe-relation-issue');
    await expect(subtaskLink).toHaveText('TEST-2');
    // Subtask is todo, so link should have the todo colour class
    await expect(subtaskLink).toHaveClass(/swipe-relation-todo/);
  });

  test('project filter includes in-progress issues and starts on first todo', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');

    // Select "Project Alpha" filter
    const options = await select.locator('option').allTextContents();
    const alphaOption = options.find(o => o.includes('Project Alpha'));
    expect(alphaOption).toBeTruthy();

    // Count should include in-progress issues (3 started + 5 incomplete = 8).
    // The 5th incomplete is TEST-30, the LIN-1210 cross-project descent fixture's
    // Backlog parent container in Project Alpha (its child TEST-31 lives in gamma).
    const match = alphaOption.match(/\((\d+)\)/);
    expect(match).toBeTruthy();
    expect(parseInt(match[1], 10)).toBe(8);

    await select.selectOption({ label: alphaOption });

    // Should NOT start on an in-progress card
    const stateClass = await page.locator('.swipe-card-status .status-pill').getAttribute('class');
    expect(stateClass).not.toContain('in-progress');

    // Left arrow should be enabled (in-progress cards are before this one)
    await expect(page.locator('.swipe-arrow-left')).not.toBeDisabled();

    // Navigate backward to reach an in-progress card
    await page.locator('.swipe-arrow-left').click();
    const prevStateClass = await page.locator('.swipe-card-status .status-pill').getAttribute('class');
    expect(prevStateClass).toContain('in-progress');
  });

  test('clicking subtask link navigates to that card', async ({ page, localWorkerUrlKey }) => {
    // Load TEST-1 which has TEST-2 as a subtask
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe/TEST-1`);
    await page.waitForLoadState('networkidle');

    const subtaskLink = page.locator('.swipe-meta-subtasks a.swipe-relation-issue');
    await expect(subtaskLink).toHaveText('TEST-2');
    await subtaskLink.click();

    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-2');
    expect(page.url()).toContain('/swipe/TEST-2');
  });

  test('URL updates with task identifier when navigating', async ({ page, localWorkerUrlKey }) => {
    // Start on a card with a known identifier
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe/TEST-15`);
    await page.waitForLoadState('networkidle');

    // URL should contain the identifier
    expect(page.url()).toContain('/swipe/TEST-15');

    // Navigate away and back — URL should update each time
    const rightArrow = page.locator('.swipe-arrow-right');
    if (!await rightArrow.isDisabled()) {
      await rightArrow.click();
      // URL should no longer point to TEST-15
      expect(page.url()).not.toContain('/swipe/TEST-15');
    }

    await page.locator('.swipe-arrow-left').click();
    expect(page.url()).toContain('/swipe/TEST-15');
  });

  test('deep-link URL loads specific card', async ({ page, localWorkerUrlKey }) => {
    // Navigate directly to TEST-15 (session already set by beforeEach)
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe/TEST-15`);
    await page.waitForLoadState('networkidle');

    // Should display the TEST-15 card
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-15');
  });

  test('label filter dropdown lists labels in use', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');
    const optionValues = await select.locator('option').evaluateAll(opts => opts.map(o => o.value));

    // Mock data has issues labelled bug, urgent, preparing, feature, blocked
    expect(optionValues).toContain('label:bug');
    expect(optionValues).toContain('label:urgent');
    expect(optionValues).toContain('label:feature');
  });

  test('selecting a label filter shows only issues with that label', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');
    await select.selectOption('label:bug');

    // First card should be a bug
    const labels = await page.locator('.swipe-card-labels .swipe-label-tag').allTextContents();
    expect(labels).toContain('bug');

    // Step through every card in the filter and verify each has the bug label
    const counterText = await page.locator('.swipe-card-position').textContent();
    const total = parseInt(counterText.match(/\/\s*(\d+)/)[1], 10);
    expect(total).toBeGreaterThan(0);

    for (let i = 1; i < total; i++) {
      await page.locator('.swipe-arrow-right').click();
      const cardLabels = await page.locator('.swipe-card-labels .swipe-label-tag').allTextContents();
      expect(cardLabels).toContain('bug');
    }
  });

  test('label filter preserves swipe sort order (bugs/non-completed first)', async ({ page }) => {
    const select = page.locator('.swipe-filter-select');
    await select.selectOption('label:bug');

    // Sort puts completed/canceled last, so first card under "bug" must not be done
    const stateClass = await page.locator('.swipe-card-status .status-pill').getAttribute('class');
    expect(stateClass).not.toContain('done');
  });

  test('clicking blocking issue link navigates to that card', async ({ page, localWorkerUrlKey }) => {
    // Load TEST-15 which blocks TEST-14 (session already set by beforeEach)
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe/TEST-15`);
    await page.waitForLoadState('networkidle');

    // Should see "Blocks" row with a clickable link
    const blocksRow = page.locator('.swipe-meta-blocks');
    await expect(blocksRow).toBeVisible();
    const link = blocksRow.locator('a.swipe-blocking-issue');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('TEST-14');

    // Click the link
    await link.click();

    // Should navigate to TEST-14 in-place
    await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-14');
    expect(page.url()).toContain('/swipe/TEST-14');
  });
});

// ============================================================================
// Dispatched Sessions accordion
// ============================================================================

test.describe('Swipe Dispatched Sessions', () => {
  // Acts as a dispatch consumer to seed real sessions, mirroring
  // pipeline-scenarios.spec.js. Sessions come from the local dispatch/agent-status
  // stores, so the session is a GENUINE local-provider session (the dispatch
  // feature flag is set via seedLocal); clears are scoped to the local
  // workspace via `?urlKey=`.
  async function clearSessions(page, urlKey) {
    await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${urlKey}`);
  }

  async function createConsumerToken(page, urlKey) {
    const resp = await page.goto(`/test/create-dispatch-token?urlKey=${urlKey}`);
    return JSON.parse(await resp.text()).token;
  }

  async function dispatchForIssue(page, urlKey, issueIdentifier, promptName = 'implementation') {
    const resp = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
      data: { prompt: `Work on ${issueIdentifier}`, promptName, issueIdentifier, target: 'cli' }
    });
    expect(resp.status(), `dispatch failed: ${await resp.text()}`).toBe(201);
    return (await resp.json()).item;
  }

  async function takeItem(page, itemId, token) {
    await page.request.post(`/api/dispatch/take/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  async function postFeedback(page, itemId, token, message) {
    const resp = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message }
    });
    expect(resp.ok(), `feedback failed: ${await resp.text()}`).toBeTruthy();
  }

  async function openSwipeAt(page, urlKey, identifier) {
    await page.goto(`/workspace/${urlKey}/swipe/${identifier}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.swipe-card-identifier')).toHaveText(identifier);
  }

  function sessionsAccordion(page) {
    return page.locator('.swipe-accordion-header[data-accordion="sessions"]');
  }

  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await clearSessions(page, localWorkerUrlKey);
    await seedLocal(workspaceApiLocalSeed, { features: { dispatch: true } });
  });

  test('accordion header shows the baked-in session count', async ({ page, localWorkerUrlKey }) => {
    // Two DIFFERENT kinds, matching the sibling test below. Two *identical*
    // fresh dispatches seconds apart is exactly what the duplicate-dispatch
    // guard now refuses (LIN-1656) — and correctly so: in production that is
    // two orchestrators doing the same step, not two sessions. Same-issue
    // different-kind is the normal pipeline and still produces two sessions,
    // which is all this test is counting.
    await dispatchForIssue(page, localWorkerUrlKey, 'TEST-14', 'research');
    await dispatchForIssue(page, localWorkerUrlKey, 'TEST-14', 'implementation');

    await openSwipeAt(page, localWorkerUrlKey, 'TEST-14');

    const header = sessionsAccordion(page);
    await expect(header).toBeVisible();
    await expect(header.locator('.swipe-sessions-count')).toHaveText('[2]');
  });

  test('opening the accordion lists the sessions', async ({ page, localWorkerUrlKey }) => {
    await dispatchForIssue(page, localWorkerUrlKey, 'TEST-14', 'research');
    await dispatchForIssue(page, localWorkerUrlKey, 'TEST-14', 'implementation');

    await openSwipeAt(page, localWorkerUrlKey, 'TEST-14');
    await sessionsAccordion(page).click();

    const entries = page.locator('[data-accordion-body="sessions"] .session-entry');
    await expect(entries).toHaveCount(2);
  });

  test('shows the empty state for an issue with no sessions', async ({ page, localWorkerUrlKey }) => {
    await openSwipeAt(page, localWorkerUrlKey, 'TEST-13');

    const header = sessionsAccordion(page);
    await expect(header.locator('.swipe-sessions-count')).toHaveText('[0]');

    await header.click();
    await expect(page.locator('[data-accordion-body="sessions"] .sessions-empty')).toContainText('No sessions yet');
  });

  test('renders feedback on a session', async ({ page, localWorkerUrlKey }) => {
    const token = await createConsumerToken(page, localWorkerUrlKey);
    const item = await dispatchForIssue(page, localWorkerUrlKey, 'TEST-15');
    await takeItem(page, item.id, token);
    await postFeedback(page, item.id, token, 'agent finished the work');

    await openSwipeAt(page, localWorkerUrlKey, 'TEST-15');
    await sessionsAccordion(page).click();

    await expect(page.locator('[data-accordion-body="sessions"] .session-feedback-entry'))
      .toContainText('agent finished the work');
  });

  test('accordion is absent when dispatch feature is disabled', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { features: { dispatch: false } });
    await openSwipeAt(page, localWorkerUrlKey, 'TEST-14');

    await expect(sessionsAccordion(page)).toHaveCount(0);
  });
});

// ============================================================================
// Recap accordion on the swipe card.
// Originally relocated from recap.spec.js (LIN-403). Migrated onto the local
// provider with the rest of the swipe surface in LIN-427: the recap AI mock
// (buildMockRecap) re-gates onto local sessions (#399), so the refresh flow
// resolves to fresh content without the test-token path.
// ============================================================================

test.describe('Recap UI — Swipe', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders recap accordion', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await expect(recapAccordion).toBeVisible();
    await expect(recapAccordion).toContainText(/Recap/i);
  });

  test('opening recap accordion initialises the section', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await recapAccordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="recap"]').first();
    await expect(body).toHaveClass(/open/);

    // The shared renderer attaches data-state attribute
    const section = body.locator('.recap-section').first();
    await expect(section).toHaveAttribute('data-state', /missing|fresh|stale|generating|loading/);
  });

  test('refresh button triggers POST and shows fresh content', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await recapAccordion.click();

    const section = page.locator('.swipe-accordion-body[data-accordion-body="recap"] .recap-section').first();
    // Wait for the initial GET to resolve
    await expect(section).not.toHaveAttribute('data-state', 'loading', { timeout: 5000 });

    const refreshBtn = section.locator('[data-recap-refresh]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should land on fresh with recap content
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    // Fresh content renders at least one item or an empty placeholder
    const hasList = await section.locator('.recap-list').count();
    const hasEmpty = await section.locator('.recap-empty').count();
    expect(hasList + hasEmpty).toBeGreaterThan(0);
  });
});

// ============================================================================
// Brief accordion on the swipe card.
// Originally relocated from brief.spec.js (LIN-404). Migrated onto the local
// provider with the rest of the swipe surface in LIN-427: the brief AI mock
// (buildMockBrief) re-gates onto local sessions (#399), so the refresh flow
// resolves to fresh Markdown content without the test-token path.
// ============================================================================

test.describe('Brief UI — Swipe', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders brief accordion', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await expect(briefAccordion).toBeVisible();
    await expect(briefAccordion).toContainText(/Brief/i);
  });

  test('opening brief accordion initialises the section', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await briefAccordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="brief"]').first();
    await expect(body).toHaveClass(/open/);

    const section = body.locator('.brief-section').first();
    await expect(section).toHaveAttribute('data-state', /missing|fresh|stale|generating|loading/);
  });

  test('refresh button triggers POST and shows fresh content', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await briefAccordion.click();

    const section = page.locator('.swipe-accordion-body[data-accordion-body="brief"] .brief-section').first();
    // Wait for the initial GET to resolve
    await expect(section).not.toHaveAttribute('data-state', 'loading', { timeout: 5000 });

    const refreshBtn = section.locator('[data-brief-refresh]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should land on fresh with rendered Markdown content
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    await expect(section.locator('.brief-content')).toBeVisible();
  });
});

test.describe('Context UI — Swipe (LIN-572)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders the context accordion', async ({ page }) => {
    const accordion = page.locator('.swipe-accordion-header[data-accordion="context"]').first();
    await expect(accordion).toBeVisible();
    await expect(accordion).toContainText(/Context/i);
  });

  test('opening the context accordion lazy-mounts the deterministic diagram', async ({ page }) => {
    const accordion = page.locator('.swipe-accordion-header[data-accordion="context"]').first();
    await accordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="context"]').first();
    await expect(body).toHaveClass(/open/);

    const section = body.locator('.context-section').first();
    // No AI, no cache: it settles directly to loaded with the root node rendered.
    await expect(section).toHaveAttribute('data-state', 'loaded', { timeout: 5000 });
    await expect(section.locator('.context-node--root')).toBeVisible();
  });
});

// =============================================================================
// AI Recommend stream — scroll-follow regression (LIN-2987)
// =============================================================================
//
// public/prompt-section.js's scheduleRender used to sample the near-bottom
// predicate AFTER `body.innerHTML = renderMarkdown(...)` — the mutation that
// grows the body. A render pass whose growth alone exceeds the shared
// `window.isPinnedToBottom` 60px threshold (real markdown re-rendering a
// growing document is exactly this shape) measured the already-grown gap and
// read a pinned reader as scrolled away, stranding them for the rest of the
// stream (LIN-2987's research measured 288px growing to a persistent 288-317px
// gap against unfixed HEAD). The fix samples `wasPinned` before the mutation
// and carries it across the render.
//
// Swipe's own local AI mock (routes/workspace-api.js, `shouldMockAi`) writes
// every SSE frame back to back with no delay, so it settles in a single paint
// and can never be caught mid-stream — precisely the reason task-chat.js's
// sibling LIN-2812 regression needed its own explicit-delay "stream slowly"
// mock trigger server-side. Here `window.fetch` is stubbed in-page instead,
// returning a real `ReadableStream` paced with real `setTimeout`s — genuine
// task-queue boundaries a `page.waitForFunction({polling:'raf'})` poll can
// land inside, with full control over each frame's size and timing.
test.describe('Swipe AI Recommend stream — scroll-follow behavior (LIN-2987)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  /**
   * Stub `window.fetch` so a request to the AI-recommend stream endpoint
   * resolves with a `text/event-stream` body assembled from `frameContents`,
   * one `data:` line per entry, each `content` field appended to the
   * `prompt` section. Frames are enqueued `pauseMs` apart after each index in
   * `pauseAfterIndex` (a number or an array of numbers; default: a short 30ms
   * elsewhere) so the caller can hold the stream open — still `.streaming`,
   * mid-render — for exactly as long as the test needs to observe it.
   */
  async function stubRecommendStream(page, frameContents, { pauseAfterIndex = -1, pauseMs = 400 } = {}) {
    const pauseAfter = [].concat(pauseAfterIndex);
    await page.evaluate(({ frameContents, pauseAfter, pauseMs }) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, opts) => {
        const href = typeof input === 'string' ? input : input.url;
        if (!href.includes('/api/recommend/') || !href.includes('/stream')) {
          return realFetch(input, opts);
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < frameContents.length; i++) {
              const payload = JSON.stringify({ section: 'prompt', content: frameContents[i] });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              await new Promise((resolve) => setTimeout(resolve, pauseAfter.includes(i) ? pauseMs : 30));
            }
            controller.close();
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }));
      };
    }, { frameContents, pauseAfter, pauseMs });
  }

  async function openAiRecommend(page) {
    await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().click();
    await page.locator('[data-prompt="__ai__"]').first().click();
  }

  // Each warm-up frame is one short paragraph — safely under the 60px
  // threshold on its own. BIG_FRAME is 20 separate paragraphs landing in ONE
  // render pass — the exact shape (real markdown re-rendering a growing
  // document) that stranded a pinned reader pre-fix.
  const WARMUP_FRAME = 'A short warm-up line that adds only a little height.\n\n';
  const BIG_FRAME = Array.from({ length: 20 }, (_, i) => `Big frame paragraph number ${i}.`).join('\n\n') + '\n\n';
  const BIG_FRAME_LAST_MARKER = 'Big frame paragraph number 19.';
  // `.swipe-prompt-text` caps at 400px (overflow-y: auto) — this needs to
  // already overflow that cap before the scrolled-up test's scroll-away
  // gesture, or there is nothing to scroll away FROM and the gesture is a
  // no-op (the box just keeps auto-following, since it was never anything
  // but pinned).
  const PRELOAD_FRAME = Array.from({ length: 40 }, (_, i) => `Preload paragraph number ${i}.`).join('\n\n') + '\n\n';
  const PRELOAD_FRAME_LAST_MARKER = 'Preload paragraph number 39.';

  test('a pinned reader keeps following across a render pass that grows the body by more than 60px', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // Pause right after BIG_FRAME lands, before the trailing warm-up frame or
    // the terminal settle-render can run.
    await stubRecommendStream(page, [WARMUP_FRAME, WARMUP_FRAME, BIG_FRAME, WARMUP_FRAME], { pauseAfterIndex: 2 });
    await openAiRecommend(page);

    const body = page.locator('[data-prompt-body]').first();
    const container = page.locator('.prompt-section').first();

    // Land inside the held-open pause via rAF polling, never a web-first
    // assertion — its backoff risks resolving only after the stream has
    // already finished, which would measure the post-settle DOM rebuild
    // instead of the live mid-stream state (the same vacuous-test shape
    // LIN-2812's review flagged).
    await page.waitForFunction((marker) => {
      const el = document.querySelector('[data-prompt-body]');
      return !!el && el.textContent.includes(marker);
    }, BIG_FRAME_LAST_MARKER, { polling: 'raf', timeout: 5000 });

    // The stream must still be genuinely live at the measurement point —
    // proof this isn't measuring the post-settle rebuild, which resets
    // scrollTop to 0 regardless of whether the mid-stream bug exists.
    await expect(container).toHaveClass(/streaming/);

    const grewPastThreshold = await body.evaluate((el) => el.scrollHeight > 200);
    expect(grewPastThreshold).toBe(true);

    const gap = await body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(gap).toBeLessThan(60);

    await expect(container).not.toHaveClass(/streaming/, { timeout: 5000 });
    expect(pageErrors).toEqual([]);
  });

  test('a reader scrolled away mid-stream is not pulled back down by a later render pass', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // PRELOAD_FRAME alone already overflows the 400px cap, so scrolling away
    // after it lands is a genuine gesture, not a no-op on an empty/short box.
    // Pause right after it lands, before BIG_FRAME arrives, and again right
    // after BIG_FRAME lands so the measurement below happens mid-stream
    // rather than racing the terminal settle-render (which resets scrollTop
    // to 0 and would let a deleted `if (wasPinned)` gate pass vacuously).
    await stubRecommendStream(page, [PRELOAD_FRAME, BIG_FRAME, WARMUP_FRAME], { pauseAfterIndex: [0, 1] });
    await openAiRecommend(page);

    const body = page.locator('[data-prompt-body]').first();
    const container = page.locator('.prompt-section').first();

    await page.waitForFunction((marker) => {
      const el = document.querySelector('[data-prompt-body]');
      return !!el && el.textContent.includes(marker);
    }, PRELOAD_FRAME_LAST_MARKER, { polling: 'raf', timeout: 5000 });
    await expect(container).toHaveClass(/streaming/);

    // Confirm there is real overflow to scroll away from before scrolling —
    // well past the 60px threshold itself, or scrollTop=0 would still read
    // as "pinned" (within 60px of the bottom) and this wouldn't be a genuine
    // scroll-away gesture at all.
    const overflowBeforeScroll = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflowBeforeScroll).toBeGreaterThan(200);

    await body.evaluate((el) => { el.scrollTop = 0; });
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0);

    // Let the remaining frames — including the >60px BIG_FRAME hop — land
    // while scrolled away, and confirm the stream is still genuinely live
    // (not settled) at the point of measurement.
    await page.waitForFunction((marker) => {
      const el = document.querySelector('[data-prompt-body]');
      return !!el && el.textContent.includes(marker);
    }, BIG_FRAME_LAST_MARKER, { polling: 'raf', timeout: 5000 });

    // Read scrollTop and the live-stream flag in ONE evaluate — a single JS
    // task, so no render or settle can land between them. A separate
    // `.streaming` check followed by a scrollTop read could straddle the
    // settle-render under load and read its reset scrollTop=0 instead of the
    // mid-stream value (LIN-2987 review F1).
    const midStream = await body.evaluate((el) => ({
      streaming: el.closest('.prompt-section').classList.contains('streaming'),
      scrollTop: el.scrollTop,
    }));
    expect(midStream).toEqual({ streaming: true, scrollTop: 0 });

    await expect(container).not.toHaveClass(/streaming/, { timeout: 5000 });
    expect(pageErrors).toEqual([]);
  });
});
