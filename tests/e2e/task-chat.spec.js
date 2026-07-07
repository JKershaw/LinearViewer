import { test, expect } from '../fixtures/test-base.js';

// Experimental "talk to a task" page. Seeds via /test/set-session (the test-token
// workspace, so the AI mock fires and the chat streams a deterministic answer
// without an OpenRouter key). The page itself fetches no provider data; the chat
// endpoint resolves the task from the data fixtures (TEST-1 etc.) in test mode.

// Bound per-test from the per-worker key (LIN-628) so session + nav + chat API
// all address this worker's partition.
let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;
let CHAT_API;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/task-chat`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  CHAT_API = `/workspace/${URL_KEY}/api/task-chat`;
});

test.describe('Task Chat Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      // Title routes through the shared renderPageHeader primitive (LIN-975).
      await expect(page.locator('.page-header h1')).toHaveText('Task Chat');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="taskChat"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the task chat page")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the task chat page")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
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
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
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

    test('renders a tool breadcrumb and references the looked-up task (LIN-990)', async ({ page }) => {
      // Behind the taskChat flag, a turn that needs another task's data drives a
      // (mock) tool hop: a breadcrumb renders and the answer references the other
      // fixture task, proving tool use end-to-end without a live LLM.
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('What related work do you depend on?');
      await page.locator('#task-chat-send').click();

      // Breadcrumb is a dim ↳ log line referencing the fetched task (TEST-2, the
      // first other fixture task in TEST-1's project).
      const breadcrumb = page.locator('.task-chat-tool');
      await expect(breadcrumb).toContainText('looked up TEST-2', { timeout: 5000 });

      // The answer references the looked-up task — tool-derived data surfaced.
      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toContainText('TEST-2', { timeout: 5000 });

      // The breadcrumb is NOT a chat bubble — it sits outside the message list.
      await expect(page.locator('.task-chat-tool.task-chat-msg')).toHaveCount(0);
    });

    test('renders a session-specific breadcrumb for the send_follow_up write tool (LIN-1073)', async ({ page }) => {
      // Review gap: the write tool's ONLY visible safety property is the
      // breadcrumb naming which session it sent a follow-up to — a generic
      // "↳ send_follow_up" would hide the side effect from the reader.
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('Please send a follow-up to unwedge this.');
      await page.locator('#task-chat-send').click();

      const breadcrumb = page.locator('.task-chat-tool');
      await expect(breadcrumb).toContainText('sent a follow-up to session mock-session-1', { timeout: 5000 });
      await expect(breadcrumb).toContainText('Please post a status update');
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

  test.describe('Saved chats (LIN-1008)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/clear-saved-chats?urlKey=${URL_KEY}`);
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    async function haveOneTurn(page) {
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('Where do you stand?');
      await page.locator('#task-chat-send').click();
      await expect(page.locator('.task-chat-msg-assistant .task-chat-msg-body'))
        .toContainText('TEST-1', { timeout: 5000 });
    }

    test('save → list → open (resume) → delete round-trip', async ({ page }) => {
      // The Saved chats section is present, and empty to start.
      await expect(page.locator('[data-testid="task-chat-saved-section"]')).toBeVisible();
      await expect(page.locator('#task-chat-saved-empty')).toBeVisible();
      await expect(page.locator('.task-chat-saved-item')).toHaveCount(0);

      // Have a turn, then the save affordance appears; save it.
      await haveOneTurn(page);
      const saveBtn = page.locator('[data-testid="task-chat-save"]');
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // It lands in the list with its task id and an auto-derived title.
      const item = page.locator('.task-chat-saved-item');
      await expect(item).toHaveCount(1, { timeout: 5000 });
      await expect(item).toContainText('TEST-1');
      await expect(item.locator('.task-chat-saved-title')).toContainText('Where do you stand?');

      // Reset the live conversation, then OPEN the saved chat → transcript rehydrates.
      await page.locator('#task-chat-reset').click();
      await expect(page.locator('.task-chat-msg')).toHaveCount(0);
      await item.locator('[data-testid="task-chat-saved-open"]').click();
      await expect(page.locator('.task-chat-msg-user')).toContainText('Where do you stand?', { timeout: 5000 });
      await expect(page.locator('#task-chat-active-label')).toContainText('TEST-1');

      // RESUME: continue the rehydrated conversation via the unchanged turn path.
      await page.locator('#task-chat-question').fill('And what is next?');
      await page.locator('#task-chat-send').click();
      await expect(page.locator('.task-chat-msg-user')).toHaveCount(2, { timeout: 5000 });
      await expect(page.locator('.task-chat-msg-assistant')).toHaveCount(2, { timeout: 5000 });

      // DELETE removes it from the list.
      await item.locator('[data-testid="task-chat-saved-delete"]').click();
      await expect(page.locator('.task-chat-saved-item')).toHaveCount(0, { timeout: 5000 });
      await expect(page.locator('#task-chat-saved-empty')).toBeVisible();
    });

    test('saved chats persist across a reload (durable, not localStorage)', async ({ page }) => {
      await haveOneTurn(page);
      await page.locator('[data-testid="task-chat-save"]').click();
      await expect(page.locator('.task-chat-saved-item')).toHaveCount(1, { timeout: 5000 });

      // A fresh page load re-fetches the list from the server-side store.
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.task-chat-saved-item')).toHaveCount(1, { timeout: 5000 });
      await expect(page.locator('.task-chat-saved-item')).toContainText('TEST-1');
    });

    test('unavailable without a user identity: no save button, explicit notice, 401 endpoint', async ({ page }) => {
      // A session with the flag on but no linearUserId (local/GitHub-linked path).
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&noLinearUser=1&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      // The unavailable notice renders; the list and save button do not exist.
      await expect(page.locator('[data-testid="task-chat-saved-unavailable"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-chat-saved-list"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="task-chat-save"]')).toHaveCount(0);

      // The endpoints 401 rather than fabricating an identity.
      const res = await page.request.get(`${CHAT_API}/saved`);
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Chat endpoint', () => {
    test('returns 403 when the feature flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      const res = await page.request.post(`${CHAT_API}/TEST-1`, {
        data: { question: 'hi', history: [] },
      });
      expect(res.status()).toBe(403);
    });

    test('returns 400 for an empty question when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(`${CHAT_API}/TEST-1`, {
        data: { question: '   ', history: [] },
      });
      expect(res.status()).toBe(400);
    });

    test('returns 404 for an unknown task when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ taskChat: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(`${CHAT_API}/TEST-9999`, {
        data: { question: 'hi', history: [] },
      });
      expect(res.status()).toBe(404);
    });
  });
});
