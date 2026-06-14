import { test, expect } from '../fixtures/test-base.js';

// Experimental "talk to a task" page. Seeds via /test/set-session (the default
// session is the `test-workspace` / `test-token` workspace, so the AI mock fires
// and the chat streams a deterministic answer without an OpenRouter key). The
// page itself fetches no provider data; the chat endpoint resolves the task from
// the data fixtures (TEST-1 etc.) in test mode.

const URL_KEY = 'test-workspace';
const PAGE_URL = `/workspace/${URL_KEY}/task-chat`;
const SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
const CHAT_API = `/workspace/${URL_KEY}/api/task-chat`;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.describe('Task Chat Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.task-chat-header h1')).toHaveText('Task Chat');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="taskChat"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the task chat page")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the task chat page")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('has a task input, question input, send button, and transcript', async ({ page }) => {
      await expect(page.locator('#task-chat-id')).toBeVisible();
      await expect(page.locator('#task-chat-question')).toBeVisible();
      await expect(page.locator('#task-chat-send')).toBeVisible();
      await expect(page.locator('#task-chat-transcript')).toHaveCount(1);
      await expect(page.locator('#task-chat-empty')).toBeVisible();
    });

    test('prefills the task input from ?task=', async ({ page }) => {
      await page.goto(`${PAGE_URL}?task=TEST-1`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#task-chat-id')).toHaveValue('TEST-1');
    });

    test('includes the task-chat stylesheet and script', async ({ page }) => {
      await expect(page.locator('link[href="/task-chat.css"]')).toHaveCount(1);
      await expect(page.locator('script[src="/task-chat.js"]')).toHaveCount(1);
    });
  });

  test.describe('Conversation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('streams a grounded, first-person answer for a real task', async ({ page }) => {
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('Where do you stand?');
      await page.locator('#task-chat-send').click();

      // The user's turn is echoed, and the task answers, referencing itself.
      await expect(page.locator('.task-chat-msg-user')).toContainText('Where do you stand?');
      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toContainText('TEST-1', { timeout: 5000 });
      await expect(answer).toContainText('Where do you stand?');

      // Conversation header names the active task; empty state is gone.
      await expect(page.locator('#task-chat-active-label')).toContainText('TEST-1');
      await expect(page.locator('#task-chat-empty')).toBeHidden();
    });

    test('reset clears the conversation', async ({ page }) => {
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('hello?');
      await page.locator('#task-chat-send').click();
      await expect(page.locator('.task-chat-msg-assistant')).toHaveCount(1, { timeout: 5000 });

      await page.locator('#task-chat-reset').click();
      await expect(page.locator('.task-chat-msg')).toHaveCount(0);
      await expect(page.locator('#task-chat-empty')).toBeVisible();
    });

    test('shows an error bubble for an unknown task', async ({ page }) => {
      await page.locator('#task-chat-id').fill('TEST-9999');
      await page.locator('#task-chat-question').fill('hi');
      await page.locator('#task-chat-send').click();
      await expect(page.locator('.task-chat-msg-assistant .task-chat-msg-body'))
        .toContainText('error', { timeout: 5000 });
    });
  });

  test.describe('Chat endpoint', () => {
    test('returns 403 when the feature flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
      const res = await page.request.post(`${CHAT_API}/TEST-1`, {
        data: { question: 'hi', history: [] },
      });
      expect(res.status()).toBe(403);
    });

    test('returns 400 for an empty question when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      const res = await page.request.post(`${CHAT_API}/TEST-1`, {
        data: { question: '   ', history: [] },
      });
      expect(res.status()).toBe(400);
    });

    test('returns 404 for an unknown task when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}`);
      const res = await page.request.post(`${CHAT_API}/TEST-9999`, {
        data: { question: 'hi', history: [] },
      });
      expect(res.status()).toBe(404);
    });
  });
});
