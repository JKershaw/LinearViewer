/**
 * Task Chat Page Renderer (experimental).
 *
 * Renders the experimental "talk to a task" shell: enter a task identifier, then
 * have a grounded, multi-turn conversation with that task. The task answers in
 * the first person from its own Linear context (description, comments, subtasks,
 * status).
 *
 * Reuses the shared page shell + navbar + footer + section components. Zero
 * business logic here — the SSE chat and transcript rendering live in
 * public/task-chat.{css,js}. The page is provider-free (it fetches no Linear data
 * itself); the chat endpoint resolves the task on each turn.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';

/**
 * LIN-3975: the task page's fold. The owner asks the task from the task page; the turn is propose-only, so a proposal
 * is staged for the run control and never starts work on its own. A closed `details` fold below the answer and the run
 * control: it opens in place, on a desktop and a phone. Its task is fixed (the page's own), so the identifier is a
 * hidden hook, not a field. `TaskChat.init` (public/task-chat.js) mounts it from public/task-page.js.
 *
 * @param {{urlKey: string, identifier: string, source?: string|null}} fold
 * @returns {string}
 */
export function renderTaskChatFold({ urlKey, identifier, source = null }) {
  const opts = {
    urlKey: urlKey || '',
    savedChatsAvailable: false,
    defaultTask: identifier || '',
    defaultSource: source || '',
    propose: true,
  };
  return `<details class="task-chat-fold" data-testid="task-page-chat-fold" data-task-chat-root data-task-chat-opts="${escapeHtml(JSON.stringify(opts))}">`
    + `<summary class="task-chat-fold-head">Ask about this task</summary>`
    + `<div class="task-chat-fold-body">`
    + `<input type="hidden" data-task-chat="id" value="${escapeHtml(identifier || '')}">`
    + `<ul class="task-chat-transcript chat-thread" data-task-chat="transcript" data-testid="task-page-chat-transcript"></ul>`
    + `<p class="task-chat-empty" data-task-chat="empty">○ ask a question. A change the answer proposes is staged in the run control for you to apply; nothing starts on its own.</p>`
    + `<div class="task-chat-ask chat-composer chat-composer--inline">`
    + `<input type="text" class="task-chat-input task-chat-input-wide" data-task-chat="question" data-testid="task-page-chat-question" placeholder="ask about this task…" maxlength="2000" autocomplete="off" aria-label="ask about this task">`
    + `<button type="button" class="action-btn save" data-task-chat="send" data-testid="task-page-chat-send">ask</button>`
    + `</div></div></details>`;
}

/**
 * @param {Object} data
 * @param {string} [data.defaultTask] - Task identifier to prefill (from ?task=).
 * @param {string} [data.defaultSource] - Resolved provider hint (LIN-1910, from
 *   ?source=), valid only while the input still holds `defaultTask` unchanged —
 *   see public/task-chat.js.
 * @param {string} [data.defaultRun] - LIN-3254: the run id a run-scoped chat is
 *   about (from ?run=). Emitted ONLY when present; prefills the question with
 *   "About run <id>: " so the first turn is clearly about that run.
 * @param {boolean} [data.aiConfigured] - Whether an OpenRouter key is available.
 * @param {boolean} [data.savedChatsAvailable] - Whether saved chats are usable
 *   (a user identity is present). When false, the save affordance is omitted and
 *   the Saved chats section renders an explicit unavailable empty-state (LIN-1008).
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces] - Session workspaces (for navbar).
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderTaskChatPage(data, options = {}) {
  const { defaultTask = '', defaultSource = '', defaultRun = '', aiConfigured = true, savedChatsAvailable = false } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'task-chat', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/task-chat', urlKey, openRouterSource, featureFlags });

  const taskChatData = {
    urlKey: urlKey || '',
    savedChatsAvailable: !!savedChatsAvailable,
    defaultTask: defaultTask || '',
    defaultSource: defaultSource || '',
  };
  // LIN-3254: emitted ONLY when a run id was carried, same byte-identical rule.
  if (defaultRun) taskChatData.defaultRun = defaultRun;
  // LIN-3975: the client reads its options from its own root, not a page-wide global, so the task page's fold and
  // this page share one client (`TaskChat.init`, public/task-chat.js).
  const encodedUrlKey = escapeHtml(urlKey || '');
  const encodedOpts = escapeHtml(JSON.stringify(taskChatData));

  const aiWarning = aiConfigured
    ? ''
    : `<p class="task-chat-warning" data-ai-unconfigured>⚠ AI is not configured on the server (connect OpenRouter in settings or set <code>OPENROUTER_API_KEY</code>). The conversation needs it.</p>`;

  // LIN-3254: a run-scoped chat opens prefilled "About run <id>: " so the first
  // turn is clearly about that run. Absent run → no value attribute, so the
  // unstamped page stays byte-identical.
  const questionPrefill = defaultRun ? ` value="${escapeHtml(`About run ${defaultRun}: `)}"` : '';

  const setupBody = `<div class="tree">
        <p class="task-chat-experimental">⚗ Experimental — open a task and ask it questions. It answers in the first person, grounded only in its own description, comments, and subtasks.</p>
        ${aiWarning}
        <div class="task-chat-field">
          <label class="task-chat-label" for="task-chat-id">task:</label>
          <input type="text" id="task-chat-id" class="task-chat-input" data-task-chat="id" value="${escapeHtml(defaultTask)}" placeholder="e.g. LIN-123" maxlength="64" autocomplete="off">
        </div>
      </div>`;

  // The save affordance only exists when saved chats are available (a user
  // identity is present). Hidden until a conversation is under way (client-driven).
  const saveButtonHtml = savedChatsAvailable
    ? `<button type="button" id="task-chat-save" class="action-btn save hidden" data-task-chat="save" data-testid="task-chat-save">save chat</button>`
    : '';

  const conversationBody = `<div class="task-chat-convo-head">
        <span class="task-chat-active-label" id="task-chat-active-label" data-task-chat="active-label"></span>
        ${saveButtonHtml}
        <button type="button" id="task-chat-reset" class="task-chat-reset-btn hidden" data-task-chat="reset">reset</button>
      </div>
      <ul class="task-chat-transcript chat-thread" id="task-chat-transcript" data-task-chat="transcript"></ul>
      ${renderEmptyState({ tag: 'p', className: 'task-chat-empty', id: 'task-chat-empty', attrs: 'data-task-chat="empty"', text: '○ enter a task above, then ask it anything — "where do you stand?", "what is blocking you?", "where would I start?"' })}
      <div class="task-chat-ask chat-composer chat-composer--inline">
        <input type="text" id="task-chat-question" class="task-chat-input task-chat-input-wide" data-task-chat="question" placeholder="ask the task…" maxlength="2000" autocomplete="off"${questionPrefill}>
        <button type="button" id="task-chat-send" class="action-btn save" data-task-chat="send">ask</button>
      </div>`;

  // Saved chats (LIN-1008). Available → a client-populated list plus its own empty
  // state; unavailable (no user identity) → an explicit unavailable notice, no list.
  const savedBody = savedChatsAvailable
    ? `<ul class="task-chat-saved-list" id="task-chat-saved-list" data-task-chat="saved-list" data-testid="task-chat-saved-list"></ul>
      ${renderEmptyState({ tag: 'p', className: 'task-chat-saved-empty', id: 'task-chat-saved-empty', attrs: 'data-task-chat="saved-empty"', text: '○ no saved chats yet — save a conversation to view or resume it later, even on another device.' })}`
    : renderEmptyState({ tag: 'p', className: 'task-chat-saved-unavailable', id: 'task-chat-saved-unavailable', attrs: 'data-testid="task-chat-saved-unavailable"', text: '○ saved chats need a Linear-authenticated session — they are unavailable for this workspace.' });

  return renderPage({
    title: 'Task Chat - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/chat.css', '/task-chat.css'],
    nav: navBarHtml,
    // purify.min.js before marked.min.js before task-chat.js (LIN-2670,
    // session page's order, lib/render-session.js): the done-frame Markdown
    // swap (and the saved-chat replay path) need both loaded before
    // task-chat.js's own script runs.
    scripts: ['/common.js', '/chat.js', '/purify.min.js', '/marked.min.js', '/task-chat.js'],
    content: `<main class="task-chat-page" data-url-key="${encodedUrlKey}" data-task-chat-root data-task-chat-auto data-task-chat-opts="${encodedOpts}">
    ${renderPageHeader({ title: 'Task Chat', subtitle: 'Ask a task about itself, and follow up.' })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-setup', titleClass: 'section-header', title: 'Task', body: setupBody })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-live', titleClass: 'section-header', title: 'Conversation', body: conversationBody })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-saved', titleClass: 'section-header', title: 'Saved chats', body: savedBody, attrs: 'data-testid="task-chat-saved-section"' })}
  </main>
  ${footerHtml}`,
  });
}
