import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';

// Migrated onto a GENUINE `provider: 'local'` session (LIN-425, parent S3). The
// dispatch queue/tokens/history stores stay store-backed (urlKey-scoped), NOT
// provider-backed — so every `/test/*` cleanup/create route must carry
// `?urlKey=local-workspace` (they default to the test-token workspace). The repo selector
// reads the provider's projects, so we seed exactly ONE project carrying
// `repo=test-repo` (→ "none" + one repo option, matching the old testMockData set).
// Per-worker key + nav/API URLs are bound before every test by the top-level
// beforeEach (LIN-627); the request-shim helper and test bodies read these
// module-scoped lets. Playwright workers are separate processes, so this is
// per-worker state, never shared across parallel workers.
let WS, DISPATCH_URL, SETTINGS_URL, API_PREFIX;

// Minimal provider seed for the repo selector: a single project whose content
// carries `repo=test-repo`, so the selector renders exactly two options
// (the "none" default + "Project Alpha (test-repo)"). No issues are needed —
// the dispatch page does not render the issue tree.
const REPO_SEED = {
  projects: [
    { id: 'local-proj-1', name: 'Project Alpha', content: 'repo=test-repo', sortOrder: 1 },
  ],
  issues: [],
};

// Seed the `request` fixture's OWN session (a separate cookie jar from `page`)
// so its session-scoped dispatch POSTs resolve the local workspace. seedLocalWorkspace
// only needs a `.request` API context, so a `{ request }` shim suffices.
function seedRequestSession(request) {
  return seedLocalWorkspace({ request }, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
}

test.describe('Dispatch Page', () => {
  // Bind the per-worker key + URLs before every test (and the nested beforeEach
  // hooks that seed / clear via these). LIN-627.
  test.beforeEach(({ localWorkerUrlKey }) => {
    WS = localWorkerUrlKey;
    DISPATCH_URL = `/workspace/${WS}/dispatch`;
    SETTINGS_URL = `/workspace/${WS}/settings`;
    API_PREFIX = `/workspace/${WS}`;
  });

  test.describe('Page Access', () => {
    test('dispatch page loads when feature flag is enabled', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('h1')).toHaveText('Dispatch');
      await expect(page.locator('.dispatch-subtitle')).toContainText('Queue prompts');
    });

    test('dispatch page redirects to settings when feature flag is disabled', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Should redirect to settings page
      expect(page.url()).toContain('/settings');
    });

    test('dispatch page shows all four sections', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.dispatch-section-header:has-text("Send Prompt")')).toBeVisible();
      await expect(page.locator('.dispatch-section-header:has-text("Queue")')).toBeVisible();
      await expect(page.locator('.dispatch-section-header:has-text("Tokens")')).toBeVisible();
      await expect(page.locator('.dispatch-section-header:has-text("History")')).toBeVisible();
    });
  });

  test.describe('Custom Prompt Dispatcher', () => {
    test.beforeEach(async ({ page }) => {
      // Seed FIRST so the local session (user `test-local-user-id`) exists before
      // clearing recents — `/test/clear-recent-prompts` clears the session's user.
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await page.goto('/test/clear-recent-prompts');
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');
      // Dispatch options now live behind a disclosure trigger; expand it so the
      // option buttons are interactable for the tests in this block.
      await page.locator('.dispatch-toggle').click();
      await expect(page.locator('#dispatch-options')).not.toHaveClass(/\bhidden\b/);
    });

    test('custom prompt input is visible', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await expect(textarea).toBeVisible();
      await expect(textarea).toHaveAttribute('placeholder', 'Type a custom prompt or /command...');

      // Buttons live in the (now-open) options panel
      const buttons = page.locator('.dispatch-prompt-send');
      await expect(buttons).toHaveCount(4); // cli, web, dash, local (on localhost)
    });

    test('can dispatch custom freeform text', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Review the auth module for security issues');

      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();

      await expect(dispatchBtn).toHaveText('dispatched!');
      await expect(textarea).toHaveValue('');

      // Verify item appears in queue via API
      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const customItem = items.find(i => i.promptName === 'Custom');
      expect(customItem).toBeDefined();
      expect(customItem.prompt).toBe('Review the auth module for security issues');
    });

    test('can dispatch with web target', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Check deployment status');

      const webBtn = page.locator('.dispatch-prompt-send[data-target="web"]');
      await webBtn.click();

      await expect(webBtn).toContainText('dispatched!');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const customItem = items.find(i => i.prompt === 'Check deployment status');
      expect(customItem).toBeDefined();
      expect(customItem.target).toBe('web');
    });

    test('can dispatch with dash target', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Run quick lint check');

      const dashBtn = page.locator('.dispatch-prompt-send[data-target="dash"]');
      await dashBtn.click();

      await expect(dashBtn).toContainText('dispatched!');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const customItem = items.find(i => i.prompt === 'Run quick lint check');
      expect(customItem).toBeDefined();
      expect(customItem.target).toBe('dash');
    });

    test('empty input shows validation feedback', async ({ page }) => {
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();

      const feedback = page.locator('.dispatch-prompt-feedback');
      await expect(feedback).toHaveText('prompt is empty');
    });

    test('recent prompts appear after dispatch', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('First custom prompt');
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItem.first()).toBeVisible({ timeout: 5000 });
      await expect(recentItem.first()).toContainText('First custom prompt');
    });

    test('repo selector shows projects with repo= in description', async ({ page }) => {
      const select = page.locator('.dispatch-repo-select');
      await expect(select).toBeVisible();

      // Should have "none" default plus Project Alpha (which has repo=test-repo)
      const options = select.locator('option');
      await expect(options).toHaveCount(2);
      await expect(options.first()).toHaveText('none');
      await expect(options.nth(1)).toContainText('test-repo');
    });

    test('repo selector defaults to none', async ({ page }) => {
      const select = page.locator('.dispatch-repo-select');
      await expect(select).toHaveValue('');
    });

    test('custom prompt dispatch includes selected repo', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Prompt with repo');

      // Select a repo
      const select = page.locator('.dispatch-repo-select');
      await select.selectOption('test-repo');

      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      // Verify item has repo field via API
      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      expect(items[0].repo).toBe('test-repo');
    });

    test('custom prompt dispatch without repo sends null', async ({ page }) => {
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Prompt without repo');

      // Leave repo as "none" (default)
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      // Verify item has null repo
      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      expect(items[0].repo).toBeNull();
    });

    test('recent prompts show full text without truncation', async ({ page }) => {
      const longPrompt = 'This is a very long custom prompt that exceeds sixty characters and should not be truncated in the recent prompts list';
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: longPrompt }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItem.first()).toBeVisible({ timeout: 5000 });
      await expect(recentItem.first()).toContainText(longPrompt);
    });

    test('slash commands are highlighted in recent prompts', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: '/blocked fix the auth module' }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItem.first()).toBeVisible({ timeout: 5000 });

      const slashCmd = recentItem.first().locator('.slash-command');
      await expect(slashCmd).toBeVisible();
      await expect(slashCmd).toHaveText('/blocked');
    });

    test('recent prompts display vertically with most recent first', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: 'Older prompt' }
      });
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: 'Newer prompt' }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const recentItems = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItems).toHaveCount(2, { timeout: 5000 });
      await expect(recentItems.first()).toContainText('Newer prompt');
      await expect(recentItems.nth(1)).toContainText('Older prompt');

      // Verify vertical layout (column direction)
      const list = page.locator('.dispatch-recents-container .queue-recents-list');
      await expect(list).toHaveCSS('flex-direction', 'column');
    });

    test('clicking recent prompt fills textarea', async ({ page }) => {
      // Populate recents via API
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: 'Reusable prompt text' }
      });

      // Reload to load recents
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const recentItem = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItem.first()).toBeVisible({ timeout: 5000 });

      await recentItem.first().click();

      const textarea = page.locator('.dispatch-prompt-input');
      await expect(textarea).toHaveValue('Reusable prompt text');
    });
  });

  test.describe('Favourite Prompts (LIN-1011)', () => {
    test.beforeEach(async ({ page }) => {
      // Seed FIRST so the local session's user exists before clearing, then
      // clear BOTH lists (favourites survive the recents cap, so both matter).
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto('/test/clear-recent-prompts');
      await page.goto('/test/clear-favorite-prompts');
    });

    test('starring a recent prompt promotes it into Favourites', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: 'Star me' }
      });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const star = page.locator('.dispatch-recents-container .queue-recent-star');
      await expect(star.first()).toBeVisible({ timeout: 5000 });
      // Not favourited yet: outline star.
      await expect(star.first()).toHaveText('☆');

      await star.first().click();

      // It now appears in the Favourites list...
      const favItem = page.locator('.dispatch-favorites-container .queue-favorite-item');
      await expect(favItem.first()).toBeVisible({ timeout: 5000 });
      await expect(favItem.first()).toContainText('Star me');
      // ...and the recent item's star flips to filled.
      await expect(star.first()).toHaveText('★');
      await expect(star.first()).toHaveClass(/\bis-favorite\b/);
    });

    test('a favourite survives the recents roll-off (the core requirement)', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
        data: { prompt: 'Keep me forever' }
      });
      // Favourite it directly via the API (the star click is covered above).
      await page.request.post(`${API_PREFIX}/api/dispatch/favorite-prompts`, {
        data: { prompt: 'Keep me forever' }
      });
      // Push 12 newer recents so the original rolls off the capped-at-10 Recent window.
      for (let i = 1; i <= 12; i++) {
        await page.request.post(`${API_PREFIX}/api/dispatch/recent-prompts`, {
          data: { prompt: `Filler ${i}` }
        });
      }

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Gone from Recent (10 fillers), but still present in Favourites.
      const recentItems = page.locator('.dispatch-recents-container .queue-recent-item');
      await expect(recentItems).toHaveCount(10, { timeout: 5000 });
      await expect(page.locator('.dispatch-recents-container')).not.toContainText('Keep me forever');

      const favItem = page.locator('.dispatch-favorites-container .queue-favorite-item');
      await expect(favItem.first()).toBeVisible();
      await expect(favItem.first()).toContainText('Keep me forever');
    });

    test('clicking a favourite fills the textarea', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/favorite-prompts`, {
        data: { prompt: 'Favourite prompt text' }
      });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const favItem = page.locator('.dispatch-favorites-container .queue-favorite-item');
      await expect(favItem.first()).toBeVisible({ timeout: 5000 });
      await favItem.first().click();

      const textarea = page.locator('.dispatch-prompt-input');
      await expect(textarea).toHaveValue('Favourite prompt text');
    });

    test('un-starring (✕) removes a favourite', async ({ page }) => {
      await page.request.post(`${API_PREFIX}/api/dispatch/favorite-prompts`, {
        data: { prompt: 'Remove me' }
      });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const favItem = page.locator('.dispatch-favorites-container .queue-favorite-item');
      await expect(favItem.first()).toBeVisible({ timeout: 5000 });

      await page.locator('.dispatch-favorites-container .queue-favorite-remove').first().click();

      // The favourites list empties out.
      await expect(favItem).toHaveCount(0, { timeout: 5000 });
      // And it did NOT get refilled into the textarea by the same click.
      await expect(page.locator('.dispatch-prompt-input')).toHaveValue('');
    });
  });

  test.describe('Dispatch Options Disclosure', () => {
    test.beforeEach(async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');
    });

    test('options are hidden until the trigger is clicked', async ({ page }) => {
      const toggle = page.locator('.dispatch-toggle');
      const panel = page.locator('#dispatch-options');

      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveAttribute('aria-controls', 'dispatch-options');
      await expect(panel).toHaveClass(/\bhidden\b/);
      await expect(page.locator('.dispatch-prompt-send[data-target="cli"]')).not.toBeVisible();
    });

    test('clicking the trigger expands the panel', async ({ page }) => {
      const toggle = page.locator('.dispatch-toggle');
      const panel = page.locator('#dispatch-options');

      await toggle.click();

      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).not.toHaveClass(/\bhidden\b/);
      await expect(page.locator('.dispatch-prompt-send[data-target="cli"]')).toBeVisible();
    });

    test('clicking the trigger again collapses the panel', async ({ page }) => {
      const toggle = page.locator('.dispatch-toggle');
      const panel = page.locator('#dispatch-options');

      await toggle.click();
      await expect(panel).not.toHaveClass(/\bhidden\b/);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveClass(/\bhidden\b/);
    });

    test('panel closes on outside click', async ({ page }) => {
      const toggle = page.locator('.dispatch-toggle');
      const panel = page.locator('#dispatch-options');

      await toggle.click();
      await expect(panel).not.toHaveClass(/\bhidden\b/);

      // Click somewhere outside the trigger and panel
      await page.locator('h1').click();

      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveClass(/\bhidden\b/);
    });

    test('panel closes on Esc keydown', async ({ page }) => {
      const toggle = page.locator('.dispatch-toggle');
      const panel = page.locator('#dispatch-options');

      await toggle.click();
      await expect(panel).not.toHaveClass(/\bhidden\b/);

      await page.keyboard.press('Escape');

      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveClass(/\bhidden\b/);
    });

    test('clicking an option inside the panel still dispatches (send handler fires)', async ({ page }) => {
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Dispatch from inside the panel');

      await page.locator('.dispatch-toggle').click();

      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();

      // The delegated send handler must still fire despite the disclosure handler
      await expect(dispatchBtn).toHaveText('dispatched!');
      await expect(textarea).toHaveValue('');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const customItem = items.find(i => i.prompt === 'Dispatch from inside the panel');
      expect(customItem).toBeDefined();
      expect(customItem.target).toBe('cli');
    });
  });

  test.describe('Model/Harness Exec Controls (LIN-1096)', () => {
    test.beforeEach(async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('.dispatch-toggle').click();
    });

    test('exec controls render in the Send Prompt section', async ({ page }) => {
      const controls = page.locator('.dispatch-exec-controls');
      await expect(controls).toBeVisible();
      await expect(controls.locator('.dispatch-exec-harness-select')).toBeVisible();
      await expect(controls.locator('.dispatch-exec-harness-custom')).toBeVisible();
      await expect(controls.locator('.dispatch-exec-model')).toBeVisible();
    });

    test('dispatching with a selected harness and typed model sends both fields', async ({ page }) => {
      await page.locator('.dispatch-prompt-input').fill('Exec controls test');
      await page.locator('.dispatch-exec-harness-select').selectOption('opencode');
      await page.locator('.dispatch-exec-model').fill('openrouter/anthropic/claude-opus-4.8');

      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const item = items.find(i => i.prompt === 'Exec controls test');
      expect(item.harness).toBe('opencode');
      expect(item.model).toBe('openrouter/anthropic/claude-opus-4.8');
    });

    test('leaving both fields blank sends null for model and harness', async ({ page }) => {
      await page.locator('.dispatch-prompt-input').fill('Blank exec controls test');
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const item = items.find(i => i.prompt === 'Blank exec controls test');
      expect(item.harness).toBeNull();
      expect(item.model).toBeNull();
    });

    test('a custom harness value wins over the select', async ({ page }) => {
      await page.locator('.dispatch-prompt-input').fill('Custom harness wins');
      await page.locator('.dispatch-exec-harness-select').selectOption('claude-code');
      await page.locator('.dispatch-exec-harness-custom').fill('my-custom-harness');

      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const item = items.find(i => i.prompt === 'Custom harness wins');
      expect(item.harness).toBe('my-custom-harness');
    });
  });

  test.describe('Queue List', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    });

    test('queue list shows empty state', async ({ page }) => {
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const empty = page.locator('.queue-list-empty');
      await expect(empty).toContainText('Queue is empty');
    });

    test('queue list shows dispatched items', async ({ page, request }) => {
      // Dispatch items via API
      await seedRequestSession(request);
      await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Test prompt 1', promptName: 'Test One' }
      });
      await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Test prompt 2', promptName: 'Test Two' }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const items = page.locator('.queue-list .queue-item');
      await expect(items).toHaveCount(2, { timeout: 5000 });
    });

    test('can remove item from queue list', async ({ page, request }) => {
      // Dispatch an item
      await seedRequestSession(request);
      await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'To remove', promptName: 'Remove Me' }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Verify item is present
      const items = page.locator('.queue-list .queue-item');
      await expect(items).toHaveCount(1, { timeout: 5000 });

      // Click remove
      const removeBtn = page.locator('.queue-list .queue-item-remove');
      await removeBtn.click();

      // Item should be removed
      await expect(items).toHaveCount(0);
      await expect(page.locator('.queue-list-empty')).toContainText('Queue is empty');
    });

    test('dispatched item appears in queue list', async ({ page }) => {
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Dispatch from the page (expand the options panel first)
      const textarea = page.locator('.dispatch-prompt-input');
      await textarea.fill('Live dispatch test');
      await page.locator('.dispatch-toggle').click();
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();
      await expect(dispatchBtn).toHaveText('dispatched!');

      // Queue list should update
      const items = page.locator('.queue-list .queue-item');
      await expect(items).toHaveCount(1, { timeout: 5000 });
    });
  });

  test.describe('Token Management', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/clear-dispatch-tokens?urlKey=${WS}`);
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');
    });

    test('token section shows empty state', async ({ page }) => {
      const empty = page.locator('.token-list-empty');
      await expect(empty).toContainText('No tokens yet');
    });

    test('can create token and see modal', async ({ page }) => {
      const labelInput = page.locator('.token-label-input');
      await labelInput.fill('My Test Token');

      const generateBtn = page.locator('#create-token-form button[type="submit"]');
      await generateBtn.click();

      // Token modal should appear
      const modal = page.locator('.token-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });
      await expect(modal.locator('.token-modal-header')).toContainText('Token Created');

      // Token value should be displayed
      const tokenValue = modal.locator('.token-value');
      await expect(tokenValue).not.toBeEmpty();
    });

    test('can close token modal', async ({ page }) => {
      const generateBtn = page.locator('#create-token-form button[type="submit"]');
      await generateBtn.click();

      const modal = page.locator('.token-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close modal
      await modal.locator('.token-modal-close').click();
      await expect(modal).not.toBeVisible();
    });

    test('created token appears in token list', async ({ page }) => {
      const labelInput = page.locator('.token-label-input');
      await labelInput.fill('List Token');

      const generateBtn = page.locator('#create-token-form button[type="submit"]');
      await generateBtn.click();

      // Close modal
      const modal = page.locator('.token-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });
      await modal.locator('.token-modal-close').click();

      // Token should appear in list
      const tokenItem = page.locator('.token-item');
      await expect(tokenItem).toBeVisible();
      await expect(tokenItem.locator('.token-label-text')).toContainText('List Token');
    });

    test('can revoke token', async ({ page }) => {
      // Create a token first
      const generateBtn = page.locator('#create-token-form button[type="submit"]');
      await generateBtn.click();

      const modal = page.locator('.token-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });
      await modal.locator('.token-modal-close').click();

      // Revoke the token
      page.on('dialog', dialog => dialog.accept());
      const revokeBtn = page.locator('.token-revoke');
      await revokeBtn.click();

      // Token should be removed
      await expect(page.locator('.token-list-empty')).toContainText('No tokens yet');
    });
  });

  test.describe('Dispatch History', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await page.goto(`/test/clear-dispatch-tokens?urlKey=${WS}`);
      await page.goto(`/test/clear-dispatch-history?urlKey=${WS}`);
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    });

    test('history shows empty state', async ({ page }) => {
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const empty = page.locator('.history-list-empty');
      await expect(empty).toContainText('No dispatch history yet');
    });

    test('taken item shows in history with correct status', async ({ page, request }) => {
      const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${WS}`);
      const { token } = await tokenResponse.json();

      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Taken prompt', promptName: 'Taken Test' }
      });
      const { item } = await createResponse.json();

      await request.post(`/api/dispatch/take/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const historyItem = page.locator('.history-item[data-status="taken"]');
      await expect(historyItem).toBeVisible();
      await expect(historyItem.locator('.history-status')).toHaveClass(/status-taken/);
      await expect(historyItem.locator('.history-name')).toContainText('Taken Test');
    });

    test('cancelled item shows in history with correct status', async ({ page, request }) => {
      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Cancelled prompt', promptName: 'Cancel Test' }
      });
      const { item } = await createResponse.json();

      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const historyItem = page.locator('.history-item[data-status="cancelled"]');
      await expect(historyItem).toBeVisible();
      await expect(historyItem.locator('.history-status')).toHaveClass(/status-cancelled/);
    });

    test('all history items load without pagination', async ({ page, request }) => {
      await seedRequestSession(request);

      // Create 25 history items
      for (let i = 1; i <= 25; i++) {
        const resp = await request.post(`${API_PREFIX}/api/dispatch`, {
          data: { prompt: `Prompt ${i}`, promptName: `Item ${i}` }
        });
        const { item } = await resp.json();
        await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);
      }

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Should show all 25 items at once (no pagination limit)
      const items = page.locator('.history-item');
      await expect(items).toHaveCount(25);

      // No show more button needed
      await expect(page.locator('.history-show-more')).toHaveCount(0);
    });

    test('history item is expandable and shows full prompt', async ({ page, request }) => {
      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Full prompt text for expansion test', promptName: 'Expand Test' }
      });
      const { item } = await createResponse.json();
      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const historyItem = page.locator('.history-item.expandable');
      await expect(historyItem).toBeVisible();

      // Prompt should be hidden initially
      const promptDiv = historyItem.locator('.history-prompt');
      await expect(promptDiv).not.toBeVisible();

      // Click to expand
      await historyItem.click();
      await expect(historyItem).toHaveClass(/expanded/);
      await expect(promptDiv).toBeVisible();
      await expect(promptDiv).toContainText('Full prompt text for expansion test');

      // Click again to collapse
      await historyItem.click();
      await expect(historyItem).not.toHaveClass(/expanded/);
      await expect(promptDiv).not.toBeVisible();
    });

    test('history item shows slash command highlighting in expanded prompt', async ({ page, request }) => {
      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: '/plan implement the new feature', promptName: 'Slash Test' }
      });
      const { item } = await createResponse.json();
      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const historyItem = page.locator('.history-item.expandable');
      await expect(historyItem).toBeVisible();

      // Expand the item
      await historyItem.click();
      const slashCmd = historyItem.locator('.history-prompt .slash-command');
      await expect(slashCmd).toBeVisible();
      await expect(slashCmd).toHaveText('/plan');
    });
  });

  test.describe('Feedback in History', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
      await page.goto(`/test/clear-dispatch-tokens?urlKey=${WS}`);
      await page.goto(`/test/clear-dispatch-history?urlKey=${WS}`);
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    });

    test('history item with feedback shows feedback entries', async ({ page, request }) => {
      // Set up: create token, dispatch, take, add feedback
      const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${WS}`);
      const { token } = await tokenResponse.json();

      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Test prompt', promptName: 'Feedback Test', issueIdentifier: 'LIN-42' }
      });
      const { item } = await createResponse.json();

      await request.post(`/api/dispatch/take/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      await request.post(`/api/dispatch/feedback/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: 'Analyzing issue...' }
      });

      await request.post(`/api/dispatch/feedback/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: 'Created PR', url: 'https://example.com/pr/1', urlLabel: 'PR #1' }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // History item should show feedback entries
      const historyItem = page.locator('.history-item[data-status="taken"]');
      await expect(historyItem).toBeVisible();

      const feedbackList = historyItem.locator('.feedback-list');
      await expect(feedbackList).toBeVisible();

      const feedbackEntries = historyItem.locator('.feedback-entry');
      await expect(feedbackEntries).toHaveCount(2);

      // First entry: message only
      await expect(feedbackEntries.first()).toContainText('Analyzing issue...');

      // Second entry: message with link
      await expect(feedbackEntries.nth(1)).toContainText('Created PR');
      const link = feedbackEntries.nth(1).locator('.feedback-link');
      await expect(link).toBeVisible();
      await expect(link).toHaveText('PR #1');
      await expect(link).toHaveAttribute('href', 'https://example.com/pr/1');
    });

    test('history item without feedback shows no feedback section', async ({ page, request }) => {
      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'No feedback item', promptName: 'Plain Test' }
      });
      const { item } = await createResponse.json();
      await request.delete(`${API_PREFIX}/api/dispatch/${item.id}`);

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const historyItem = page.locator('.history-item');
      await expect(historyItem).toBeVisible();

      const feedbackList = historyItem.locator('.feedback-list');
      await expect(feedbackList).toHaveCount(0);
    });

    test('refresh button reloads history', async ({ page, request }) => {
      const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${WS}`);
      const { token } = await tokenResponse.json();

      await seedRequestSession(request);

      const createResponse = await request.post(`${API_PREFIX}/api/dispatch`, {
        data: { prompt: 'Refresh test', promptName: 'Refresh Test' }
      });
      const { item } = await createResponse.json();

      await request.post(`/api/dispatch/take/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Verify history shows item without feedback
      const historyItem = page.locator('.history-item[data-status="taken"]');
      await expect(historyItem).toBeVisible();
      await expect(historyItem.locator('.feedback-list')).toHaveCount(0);

      // Add feedback via API while page is open
      await request.post(`/api/dispatch/feedback/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: 'Added after page load' }
      });

      // Click refresh button
      const refreshBtn = page.locator('.history-refresh');
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();

      // Wait for feedback to appear
      const feedbackList = page.locator('.history-item .feedback-list');
      await expect(feedbackList).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.feedback-entry')).toContainText('Added after page load');
    });
  });

  test.describe('Navigation', () => {
    test('header switcher shows dispatch as current when feature enabled', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      // Header switcher (LIN-978) shows dispatch as the current page (bold).
      const dispatchCurrent = page.locator('.nav-views [data-testid="nav-view-dispatch"].nav-view-current');
      await expect(dispatchCurrent).toBeVisible();
    });

    test('header dispatch link works from other pages', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      // Header switcher carries the flagged dispatch link (LIN-978).
      const dispatchLink = page.locator('.nav-views a[data-testid="nav-view-dispatch"]');
      await expect(dispatchLink).toBeVisible();

      await dispatchLink.click();
      await page.waitForLoadState('networkidle');

      // Should be on dispatch page
      await expect(page.locator('h1')).toHaveText('Dispatch');
    });

    test('header does not show dispatch link when feature disabled', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { urlKey: WS });
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const dispatchLink = page.locator('.nav-views [data-testid="nav-view-dispatch"]');
      await expect(dispatchLink).toHaveCount(0);
    });

    test('navbar shows projects link on dispatch page', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');

      const projectsLink = page.locator('.nav-action:has-text("projects")');
      await expect(projectsLink).toBeVisible();
    });
  });

  test.describe('Settings Page Cleanup', () => {
    test('settings page no longer shows dispatch section when dispatch enabled', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      // Dispatch prompt should not be on settings page
      await expect(page.locator('.dispatch-prompt-input')).toHaveCount(0);
      // Token management should not be on settings page
      await expect(page.locator('#create-token-form')).toHaveCount(0);
      // History should not be on settings page
      await expect(page.locator('.history-list')).toHaveCount(0);
    });

    test('settings page still shows dispatch feature toggle', async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { urlKey: WS });
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      // Dispatch toggle should still be present
      await expect(page.locator('[data-feature="dispatch"]')).toBeVisible();
    });
  });

  // LIN-564: a free-text goal typed before "load Autopilot" must reach the
  // general kickoff (?goal=) so the loaded prompt is scoped to it and named
  // after it. The goal control + load button are proxy-gated, so seed proxy on.
  test.describe('Autopilot Goal', () => {
    test.beforeEach(async ({ page }) => {
      await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true, proxy: true }, urlKey: WS });
      await page.goto(DISPATCH_URL);
      await page.waitForLoadState('networkidle');
    });

    test('goal input and load button are present when proxy is enabled', async ({ page }) => {
      await expect(page.locator('.dispatch-autopilot-goal')).toBeVisible();
      // LIN-836: the classic load button (variant-less) and its stepper sibling.
      await expect(page.locator('.dispatch-load-autopilot:not([data-variant])')).toBeVisible();
      await expect(page.locator('.dispatch-load-autopilot[data-variant="stepper"]')).toBeVisible();
    });

    // LIN-603: the goal control is a <textarea> (not a single-line <input>) so
    // multi-line paragraph goals can be entered — the kickoff/transport already
    // carry newlines end-to-end.
    test('goal control is a textarea that accepts multi-line paragraph goals', async ({ page }) => {
      const goal = page.locator('.dispatch-autopilot-goal');
      await expect(goal).toHaveJSProperty('tagName', 'TEXTAREA');

      const multiline = 'First, finish the migration.\n\nThen tackle the cleanup tasks.';
      await goal.fill(multiline);
      await expect(goal).toHaveValue(multiline);
    });

    // LIN-603: the explicit "continue until stopped" affordance clears any typed
    // goal and loads the open-ended stack-walk kickoff (empty goal).
    test('"continue until stopped" clears the goal and loads the stack-walk kickoff', async ({ page }) => {
      await page.locator('.dispatch-autopilot-goal').fill('some goal I will abandon');
      await page.locator('.dispatch-continue-until-stopped').click();

      const continueBtn = page.locator('.dispatch-continue-until-stopped');
      await expect(continueBtn).toHaveText('loaded ✓');

      // The goal field is cleared and the kickoff is the open-ended stack walk.
      await expect(page.locator('.dispatch-autopilot-goal')).toHaveValue('');
      const textarea = page.locator('.dispatch-prompt-input');
      await expect(textarea).toHaveValue(/Goal from the human:\*\* none this run/);
      await expect(textarea).toHaveAttribute('data-prompt-name', 'Autopilot (stack walk)');
    });

    // LIN-603: the next-run suggester hands off a chosen goal via ?goal=; the
    // dispatch page prefills the goal textarea from it.
    test('prefills the goal textarea from ?goal=', async ({ page }) => {
      const goal = 'Push the roadmap milestone to done';
      await page.goto(`${DISPATCH_URL}?goal=${encodeURIComponent(goal)}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.dispatch-autopilot-goal')).toHaveValue(goal);
    });

    test('typed goal reaches the loaded kickoff text and prompt name', async ({ page }) => {
      const goal = 'Ship the billing migration';
      await page.locator('.dispatch-autopilot-goal').fill(goal);
      await page.locator('.dispatch-load-autopilot:not([data-variant])').click();

      const loadBtn = page.locator('.dispatch-load-autopilot:not([data-variant])');
      await expect(loadBtn).toHaveText('loaded ✓');

      const textarea = page.locator('.dispatch-prompt-input');
      // The goal is embedded in the kickoff body by buildAutopilotKickoff...
      await expect(textarea).toHaveValue(new RegExp(`Goal from the human:\\*\\* ${goal}`));
      // ...and the dispatch is tagged so it carries kind=autopilot named after the goal.
      await expect(textarea).toHaveAttribute('data-kind', 'autopilot');
      await expect(textarea).toHaveAttribute('data-prompt-name', `Autopilot — ${goal}`);
    });

    test('loading with no goal yields the stack-walk kickoff (no goal line)', async ({ page }) => {
      await page.locator('.dispatch-load-autopilot:not([data-variant])').click();

      const loadBtn = page.locator('.dispatch-load-autopilot:not([data-variant])');
      await expect(loadBtn).toHaveText('loaded ✓');

      const textarea = page.locator('.dispatch-prompt-input');
      // With no goal the kickoff falls back to the stack-walk wording (not a
      // user-supplied goal) and is named accordingly.
      await expect(textarea).toHaveValue(/Goal from the human:\*\* none this run/);
      await expect(textarea).toHaveAttribute('data-prompt-name', 'Autopilot (stack walk)');
    });

    // LIN-836: the stepper sibling loads the same general kickoff with
    // ?variant=stepper, so the body carries the beat-stepping disposition and
    // the dispatch is named for the stepped variant (kind stays autopilot).
    test('the stepper load button loads the stepped stack-walk kickoff', async ({ page }) => {
      await page.locator('.dispatch-load-autopilot[data-variant="stepper"]').click();

      const stepBtn = page.locator('.dispatch-load-autopilot[data-variant="stepper"]');
      await expect(stepBtn).toHaveText('loaded ✓');

      const textarea = page.locator('.dispatch-prompt-input');
      await expect(textarea).toHaveValue(/STEPPER/);
      await expect(textarea).toHaveAttribute('data-kind', 'autopilot');
      await expect(textarea).toHaveAttribute('data-prompt-name', 'Autopilot (stepped, stack walk)');
    });

    // LIN-639: arriving via the ?goal= handoff with an empty prompt and clicking
    // dispatch must NOT report the misleading "prompt is empty" — the goal is a
    // valid input, so it is baked into an Autopilot kickoff and dispatched.
    test('dispatching with a goal but empty prompt bakes the kickoff and launches', async ({ page }) => {
      const goal = 'Finish the providers unification work';
      await page.locator('.dispatch-autopilot-goal').fill(goal);

      // The empty prompt textarea must NOT block the launch.
      await expect(page.locator('.dispatch-prompt-input')).toHaveValue('');

      await page.locator('.dispatch-toggle').click();
      const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
      await dispatchBtn.click();

      await expect(dispatchBtn).toContainText('dispatched!');
      // No misleading empty-prompt error appeared.
      await expect(page.locator('.dispatch-prompt-feedback')).not.toHaveText('prompt is empty');

      // The dispatched item is the goal-scoped Autopilot kickoff, not a blank prompt.
      const listResponse = await page.request.get(`${API_PREFIX}/api/dispatch`);
      const { items } = await listResponse.json();
      const item = items.find(i => i.kind === 'autopilot');
      expect(item).toBeDefined();
      expect(item.promptName).toBe(`Autopilot — ${goal}`);
      expect(item.prompt).toContain(`Goal from the human:** ${goal}`);
    });

    // LIN-639: with the goal field present (proxy on) but BOTH prompt and goal
    // empty, the validation message names both valid inputs rather than only the
    // prompt.
    test('empty prompt and empty goal shows the goal-aware validation message', async ({ page }) => {
      await page.locator('.dispatch-toggle').click();
      await page.locator('.dispatch-prompt-send[data-target="cli"]').click();

      const feedback = page.locator('.dispatch-prompt-feedback');
      await expect(feedback).toHaveText('enter a prompt or a goal');
      await expect(feedback).toHaveText('', { timeout: 3000 });
    });
  });
});
