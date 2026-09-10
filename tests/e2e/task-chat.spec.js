import { test, expect } from '../fixtures/test-base.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';

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
      const body = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(body).toContainText('error', { timeout: 5000 });
      // LIN-2670 close-out, ledger L1: the non-ok JSON arm (task-chat.js:351)
      // is one of Task Chat's five plain-text paths. See the L1 note on the
      // no-reply test below for why these assertions live on the existing
      // per-path tests rather than in a new block of their own.
      await expect(body).not.toHaveClass(/chat-md/);
    });

    // === LIN-2445 (LIN-2443's sibling class) ===
    // Every assistant bubble opened with an in-progress pill and NOTHING in
    // public/task-chat.js ever removed `status-pill--in-progress`, so a
    // completed answer kept the amber pill forever — the same thing a human
    // reported on the Flight Companion page from a phone.
    //
    // Every pill locator below is scoped by `.task-chat-msg-assistant` on
    // purpose. `.task-chat-msg-who` alone would NOT be unambiguous: appendBubble
    // passes the same whoClass for both roles, so the user's pill carries it
    // too — only the `status-pill--*` state differs. That is where this diverges
    // from flight-companion.spec.js's `.fc-msg-who`, which really is
    // assistant-only (appendAssistantBubble passes it, appendUserBubble does
    // not). Do not "simplify" these locators by dropping the role scope.

    test('a completed answer settles its speaker pill to done (LIN-2445)', async ({ page }) => {
      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('Where do you stand?');
      await page.locator('#task-chat-send').click();

      await expect(page.locator('.task-chat-msg-assistant .task-chat-msg-body'))
        .toContainText('TEST-1', { timeout: 5000 });

      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveCount(1);
      await expect(pill).toHaveClass(/status-pill--done/);
      // False-positive guard: not still showing the state it was created with.
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
      // The glyph moves with the class — a swapped class over a stale ◐ would
      // read as done in CSS while still showing the in-progress character.
      await expect(pill.locator('.status-pill__char')).toHaveText('✓');
    });

    test('a failed turn settles its speaker pill to failed, never in-progress (LIN-2445)', async ({ page }) => {
      await page.locator('#task-chat-id').fill('TEST-9999');
      await page.locator('#task-chat-question').fill('hi');
      await page.locator('#task-chat-send').click();

      await expect(page.locator('.task-chat-msg-assistant .task-chat-msg-body'))
        .toContainText('error', { timeout: 5000 });

      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveClass(/status-pill--failed/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
      await expect(pill.locator('.status-pill__char')).toHaveText('✕');
    });

    test('an empty answer keeps its row and reads as prose, not a bracket code (LIN-2445)', async ({ page }) => {
      // The AI mock always answers, so the empty-`done` branch is unreachable
      // through the real endpoint — intercept the SSE turn and serve a stream
      // carrying nothing but `done`. Task Chat is user-initiated, so the row
      // STAYS (LIN-2443's own AC2 reasoning: a human asked and deserves a
      // visible answer); only the '[no response]' wording carries over, which
      // AC2 rejected as reading like an error rather than an answer.
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: done\ndata: {}\n\n',
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('anything to add?');
      await page.locator('#task-chat-send').click();

      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toHaveCount(1, { timeout: 5000 });
      await expect(answer).toContainText('no reply', { timeout: 5000 });
      await expect(answer).not.toContainText('[no response]');

      // LIN-2670 close-out, ledger L1: the no-reply path (task-chat.js:392).
      // The plan's cross-cutting claim "None of the plain-text paths acquires
      // chat-md" was guarded only by the Flight Companion unit test T3
      // (tests/unit/flight-companion-client.test.js) — Task Chat's own five
      // plain-text paths had no equivalent assertion at any level. Task Chat
      // has no vm-sandboxed client harness to mirror T3 into, so the witness
      // goes where each path is ALREADY driven: one assertion per existing
      // per-path test, no new page loads. The exact-text assertion is what
      // makes it a real mirror of T3 rather than a class check — a swap here
      // would rewrite the body, not just add a class.
      await expect(answer).toHaveText('no reply — nothing to add');
      await expect(answer).not.toHaveClass(/chat-md/);

      // An empty answer is still an answer — the turn ended cleanly.
      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveClass(/status-pill--done/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
    });

    // LIN-2670: the ticket's own headline acceptance criterion. The AI mock's
    // real answers are plain prose with no Markdown syntax (buildMockAnswer,
    // routes/task-chat.js), so — like the empty-answer test above — this
    // intercepts the SSE turn to drive a deterministic Markdown-bearing body.
    test('LIN-2670: a completed answer containing **bold** and a "- " list renders <strong> and <li>, not raw markdown syntax', async ({ page }) => {
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: renderSSEFrames([['token', { token: 'Summary:\n\n**bold point**\n\n- one\n- two' }], ['done', {}]]),
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('what changed?');
      await page.locator('#task-chat-send').click();

      const body = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(body).toHaveClass(/chat-md/, { timeout: 5000 });
      await expect(body.locator('strong')).toHaveCount(1);
      await expect(body.locator('li')).toHaveCount(2);
      await expect(body).not.toContainText('**bold point**');
    });

    // LIN-2670: the sanitisation spec. Assert the REAL security property
    // (handler stripped, script dropped, nothing executes) — not the
    // ticket's original "no img element" wording, which is wrong: it has
    // now been demonstrated twice in real Chromium against the vendored
    // DOMPurify 3.2.4 that a handler-less <img> is kept by default.
    test('LIN-2670: a completed answer carrying a handler-less <img> and a <script> renders neither the handler nor the script, and executes nothing', async ({ page }) => {
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: renderSSEFrames([
          ['token', { token: '<img src=x onerror="window.__pwned = true"><script>window.__pwned2 = true;</script><p>after</p>' }],
          ['done', {}],
        ]),
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('render this');
      await page.locator('#task-chat-send').click();

      const body = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(body).toContainText('after', { timeout: 5000 });
      await expect(body.locator('script')).toHaveCount(0);
      const img = body.locator('img');
      await expect(img).toHaveCount(1);
      expect(await img.getAttribute('onerror')).toBeNull();
      expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
      expect(await page.evaluate(() => window.__pwned2)).toBeUndefined();
    });

    // LIN-2670 finding 1: the whole-answer-fence ruling. Without this test
    // the regression the keepWholeFence opt-out exists to prevent can
    // silently return.
    test('LIN-2670 finding 1: an answer that is entirely one fenced code block renders as <pre><code>, its contents NOT Markdown-interpreted', async ({ page }) => {
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: renderSSEFrames([
          ['token', { token: '```js\nconst a = 1; // # not a heading\n**not bold**\n```' }],
          ['done', {}],
        ]),
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('show me the fix');
      await page.locator('#task-chat-send').click();

      const body = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(body.locator('pre code')).toHaveCount(1, { timeout: 5000 });
      await expect(body.locator('strong')).toHaveCount(0);
      await expect(body.locator('h1')).toHaveCount(0);
      await expect(body.locator('pre code')).toContainText('**not bold**');
    });

    // The remaining three terminal paths. The unknown-task test above covers the
    // non-ok response's JSON arm through the real endpoint; these three are not
    // reachable that way, so each is driven by intercepting the SSE turn. Added
    // because "every terminal path is settled" was true of the code but not of
    // the tests — three of the five had no witness at any level.

    test('an SSE error event settles the pill to failed (LIN-2445)', async ({ page }) => {
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: error\ndata: {"message":"upstream exploded"}\n\n',
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('hi');
      await page.locator('#task-chat-send').click();

      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toContainText('upstream exploded', { timeout: 5000 });
      // LIN-2670 close-out, ledger L1: the mid-stream SSE error path
      // (task-chat.js:401) — T3's own first case, mirrored. Exact text, so a
      // done-frame swap leaking onto this path would be caught by content and
      // not only by class.
      await expect(answer).toHaveText('[error: upstream exploded]');
      await expect(answer).not.toHaveClass(/chat-md/);
      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveClass(/status-pill--failed/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
    });

    test('a non-ok response whose body is not JSON still settles the pill (LIN-2445)', async ({ page }) => {
      // The parse-failure arm: response.json() rejects, so the .catch() branch
      // renders the status-only message. It settles the pill too.
      await page.route(`**${CHAT_API}/**`, (route) => route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'text/html' },
        body: '<html>not json at all</html>',
      }));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('hi');
      await page.locator('#task-chat-send').click();

      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toContainText('request failed (500)', { timeout: 5000 });
      // LIN-2670 close-out, ledger L1: the non-ok parse-failure arm
      // (task-chat.js:357).
      await expect(answer).not.toHaveClass(/chat-md/);
      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveClass(/status-pill--failed/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
    });

    test('a network failure settles the pill to failed (LIN-2445)', async ({ page }) => {
      await page.route(`**${CHAT_API}/**`, (route) => route.abort('failed'));

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('hi');
      await page.locator('#task-chat-send').click();

      const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(answer).toContainText('network failure', { timeout: 5000 });
      // LIN-2670 close-out, ledger L1: the network-failure path
      // (task-chat.js:409) — the fifth and last of Task Chat's plain-text
      // paths, completing the set the review recorded as untested.
      await expect(answer).toHaveText('[error: network failure]');
      await expect(answer).not.toHaveClass(/chat-md/);
      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveClass(/status-pill--failed/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
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
      // LIN-2670: the replayed assistant bubble goes through the SAME
      // rendering helper the live path uses.
      await expect(page.locator('.task-chat-msg-assistant .task-chat-msg-body')).toHaveClass(/chat-md/);

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

    // LIN-2445, second in-file instance — NOT enumerated by the ticket, found
    // by walking every appendBubble caller. The resume replay renders one
    // bubble per STORED turn, each of which finished long before it was
    // persisted, so before this fix every replayed answer came back wearing a
    // fresh amber in-progress pill that nothing would ever settle. Unlike the
    // live case there is no completion moment to hook, so the replay opens the
    // bubble settled instead of swapping it afterwards.
    // LIN-2670 finding 4: the saved-chat replay path. buildMockAnswer
    // (routes/task-chat.js) returns plain prose with no Markdown syntax, so
    // an assertion bolted onto the plain round-trip test above could only
    // prove the helper ran, never that Markdown actually rendered — this
    // reuses the page.route interception so the SAVED turn genuinely carries
    // Markdown, then saves → resets → opens and asserts on the REHYDRATED
    // bubble. Also confirms the stored transcript itself still holds raw
    // Markdown, not rendered HTML — rendering happens at display time only.
    test('LIN-2670: a reopened saved chat replays its assistant turn as rendered Markdown; the stored transcript stays raw', async ({ page }) => {
      // Scoped to the turn endpoint only — `**${CHAT_API}/**` would also
      // match the saved-chat CRUD endpoints (`${CHAT_API}/saved`, same path
      // prefix) and swallow the real save/read calls this test makes below.
      await page.route(`**${CHAT_API}/**`, (route) => {
        if (route.request().url().includes('/saved')) return route.continue();
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: renderSSEFrames([['token', { token: '**bold point**\n\n- one\n- two' }], ['done', {}]]),
        });
      });

      await page.locator('#task-chat-id').fill('TEST-1');
      await page.locator('#task-chat-question').fill('Where do you stand?');
      await page.locator('#task-chat-send').click();
      const liveBody = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(liveBody).toHaveClass(/chat-md/, { timeout: 5000 });

      await page.locator('[data-testid="task-chat-save"]').click();
      const item = page.locator('.task-chat-saved-item');
      await expect(item).toHaveCount(1, { timeout: 5000 });
      const savedId = await item.getAttribute('data-saved-id');

      // The stored transcript is raw Markdown, not HTML — rendering is
      // display-only and never touches what gets persisted.
      const stored = await page.request.get(`${CHAT_API}/saved/${savedId}`);
      const storedBody = await stored.json();
      const storedAssistantTurn = storedBody.chat.transcript.find((t) => t.role === 'assistant');
      expect(storedAssistantTurn.content).toBe('**bold point**\n\n- one\n- two');
      expect(storedAssistantTurn.content).not.toContain('<strong>');

      await page.locator('#task-chat-reset').click();
      await expect(page.locator('.task-chat-msg')).toHaveCount(0);
      await item.locator('[data-testid="task-chat-saved-open"]').click();

      const replayedBody = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
      await expect(replayedBody).toHaveClass(/chat-md/, { timeout: 5000 });
      await expect(replayedBody.locator('strong')).toHaveCount(1);
      await expect(replayedBody.locator('li')).toHaveCount(2);
      await expect(replayedBody).not.toContainText('**bold point**');

      // The replayed USER turn stays plain — same split as the live path.
      const replayedUser = page.locator('.task-chat-msg-user .task-chat-msg-body');
      await expect(replayedUser).not.toHaveClass(/chat-md/);
      await expect(replayedUser).toContainText('Where do you stand?');
    });

    test('a resumed transcript replays its answers already settled, never in-progress (LIN-2445)', async ({ page }) => {
      await haveOneTurn(page);
      await page.locator('[data-testid="task-chat-save"]').click();
      const item = page.locator('.task-chat-saved-item');
      await expect(item).toHaveCount(1, { timeout: 5000 });

      await page.locator('#task-chat-reset').click();
      await expect(page.locator('.task-chat-msg')).toHaveCount(0);
      await item.locator('[data-testid="task-chat-saved-open"]').click();

      const pill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(pill).toHaveCount(1, { timeout: 5000 });
      await expect(pill).toHaveClass(/status-pill--done/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
      await expect(pill.locator('.status-pill__char')).toHaveText('✓');
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

    test('a saved Flight Companion chat (sentinel taskIdentifier) renders a readable label, never the raw sentinel (LIN-2437)', async ({ page }) => {
      // Flight Companion sessions save through this SAME saved-chat endpoint
      // (not through the live send() flow), under the 'flight-companion'
      // sentinel task identifier — and an assistant-only transcript (no user
      // turn) hits the auto-derived title's "Chat about …" fallback, the
      // exact leak this beat masks.
      const saveRes = await page.request.post(`${CHAT_API}/saved`, {
        data: {
          taskIdentifier: 'flight-companion',
          transcript: [{ role: 'assistant', content: 'Standing by — nothing needs your attention yet.' }]
        }
      });
      expect(saveRes.ok()).toBeTruthy();

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      // Surface 1 + 2: the saved-row meta chip and title never show the raw
      // sentinel, and both read the masked "Flight Companion" label.
      const item = page.locator('.task-chat-saved-item');
      await expect(item).toHaveCount(1, { timeout: 5000 });
      await expect(item).not.toContainText('flight-companion');
      await expect(item.locator('.task-chat-saved-meta')).toContainText('Flight Companion');
      await expect(item.locator('.task-chat-saved-title')).toContainText('Flight Companion');

      // Surface 3: resuming it sets the active label to the same masked text.
      await item.locator('[data-testid="task-chat-saved-open"]').click();
      await expect(page.locator('.task-chat-msg-assistant')).toHaveCount(1, { timeout: 5000 });
      const activeLabel = page.locator('#task-chat-active-label');
      await expect(activeLabel).toContainText('Flight Companion');
      await expect(activeLabel).not.toContainText('talking to flight-companion');

      // Surface 4: the replayed bubbles themselves. appendBubble reads the same
      // activeTask, so an assistant-only companion transcript would otherwise
      // repeat the raw sentinel on the speaker pill of every bubble — the
      // loudest surface of the four, underneath the one-line label above.
      const speakerPill = page.locator('.task-chat-msg-assistant .task-chat-msg-who');
      await expect(speakerPill).toContainText('Flight Companion');
      await expect(speakerPill).not.toContainText('flight-companion');
      // …and nothing anywhere in the rendered transcript leaks it either.
      await expect(page.locator('#task-chat-transcript')).not.toContainText('flight-companion');
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
