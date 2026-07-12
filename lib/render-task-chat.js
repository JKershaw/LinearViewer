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
 * @param {Object} data
 * @param {string} [data.defaultTask] - Task identifier to prefill (from ?task=).
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
  const { defaultTask = '', aiConfigured = true, savedChatsAvailable = false } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'task-chat', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/task-chat', urlKey, openRouterSource, featureFlags });

  const taskChatData = { urlKey: urlKey || '', savedChatsAvailable: !!savedChatsAvailable };
  const encodedUrlKey = escapeHtml(urlKey || '');

  const aiWarning = aiConfigured
    ? ''
    : `<p class="task-chat-warning" data-ai-unconfigured>⚠ AI is not configured on the server (connect OpenRouter in settings or set <code>OPENROUTER_API_KEY</code>). The conversation needs it.</p>`;

  const setupBody = `<div class="tree">
        <p class="task-chat-experimental">⚗ Experimental — open a task and ask it questions. It answers in the first person, grounded only in its own description, comments, and subtasks.</p>
        ${aiWarning}
        <div class="task-chat-field">
          <label class="task-chat-label" for="task-chat-id">task:</label>
          <input type="text" id="task-chat-id" class="task-chat-input" value="${escapeHtml(defaultTask)}" placeholder="e.g. LIN-123" maxlength="64" autocomplete="off">
        </div>
      </div>`;

  // The save affordance only exists when saved chats are available (a user
  // identity is present). Hidden until a conversation is under way (client-driven).
  const saveButtonHtml = savedChatsAvailable
    ? `<button type="button" id="task-chat-save" class="action-btn save hidden" data-testid="task-chat-save">save chat</button>`
    : '';

  const conversationBody = `<div class="task-chat-convo-head">
        <span class="task-chat-active-label" id="task-chat-active-label"></span>
        ${saveButtonHtml}
        <button type="button" id="task-chat-reset" class="task-chat-reset-btn hidden">reset</button>
      </div>
      <ul class="task-chat-transcript chat-thread" id="task-chat-transcript"></ul>
      ${renderEmptyState({ tag: 'p', className: 'task-chat-empty', id: 'task-chat-empty', text: '○ enter a task above, then ask it anything — "where do you stand?", "what is blocking you?", "where would I start?"' })}
      <div class="task-chat-ask chat-composer chat-composer--inline">
        <input type="text" id="task-chat-question" class="task-chat-input task-chat-input-wide" placeholder="ask the task…" maxlength="2000" autocomplete="off">
        <button type="button" id="task-chat-send" class="action-btn save">ask</button>
      </div>`;

  // Saved chats (LIN-1008). Available → a client-populated list plus its own empty
  // state; unavailable (no user identity) → an explicit unavailable notice, no list.
  const savedBody = savedChatsAvailable
    ? `<ul class="task-chat-saved-list" id="task-chat-saved-list" data-testid="task-chat-saved-list"></ul>
      ${renderEmptyState({ tag: 'p', className: 'task-chat-saved-empty', id: 'task-chat-saved-empty', text: '○ no saved chats yet — save a conversation to view or resume it later, even on another device.' })}`
    : renderEmptyState({ tag: 'p', className: 'task-chat-saved-unavailable', id: 'task-chat-saved-unavailable', attrs: 'data-testid="task-chat-saved-unavailable"', text: '○ saved chats need a Linear-authenticated session — they are unavailable for this workspace.' });

  return renderPage({
    title: 'Task Chat - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/chat.css', '/task-chat.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__TASK_CHAT_DATA__', value: taskChatData },
    scripts: ['/common.js', '/chat.js', '/task-chat.js'],
    content: `<main class="task-chat-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Task Chat', subtitle: 'Ask a task about itself, and follow up.' })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-setup', titleClass: 'section-header', title: 'Task', body: setupBody })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-live', titleClass: 'section-header', title: 'Conversation', body: conversationBody })}

    ${renderSection({ boxed: true, className: 'task-chat-section task-chat-saved', titleClass: 'section-header', title: 'Saved chats', body: savedBody, attrs: 'data-testid="task-chat-saved-section"' })}
  </main>
  ${footerHtml}`,
  });
}
