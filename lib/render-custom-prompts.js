/**
 * Custom Prompts Page Renderer
 *
 * Generates HTML for the /prompts/custom page.
 * Allows users to create, edit, and delete their own prompt templates.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Render a single custom prompt card
 * @param {Object} prompt - Custom prompt object
 * @returns {string} HTML for prompt card
 */
function renderPromptCard(prompt) {
  const charCount = prompt.template.length;
  return `
    <div class="custom-prompt-card" data-prompt-id="${escapeHtml(prompt.id)}">
      <div class="custom-prompt-header">
        <span class="custom-prompt-name">${escapeHtml(prompt.name)}</span>
        <span class="prompt-chars">${charCount.toLocaleString()} chars</span>
      </div>
      <pre class="custom-prompt-preview">${escapeHtml(prompt.template)}</pre>
      <div class="custom-prompt-actions">
        <button class="action-btn save custom-prompt-edit-btn" data-prompt-id="${escapeHtml(prompt.id)}">edit</button>
        <button class="action-btn disconnect custom-prompt-delete-btn" data-prompt-id="${escapeHtml(prompt.id)}">delete</button>
      </div>
    </div>`;
}

/**
 * Render the editor form (used for both create and edit)
 * @returns {string} HTML for editor section
 */
function renderEditor() {
  return `
    <div class="custom-prompt-editor" hidden>
      <div class="editor-field">
        <label class="editor-label" for="prompt-name">Name:</label>
        <input type="text" id="prompt-name" class="custom-prompt-name-input" maxlength="50" placeholder="e.g. Quick Analysis">
      </div>
      <div class="editor-field">
        <label class="editor-label" for="prompt-template">Template:</label>
        <textarea id="prompt-template" class="custom-prompt-template-input" rows="8" placeholder="Write your prompt template here. Use {{title}}, {{identifier}}, etc."></textarea>
        <span class="editor-char-count">0 chars</span>
      </div>
      <details class="variable-reference">
        <summary>Available variables</summary>
        <div class="variable-list">
          <div class="variable-item"><code>{{title}}</code> <span class="variable-desc">Issue title</span></div>
          <div class="variable-item"><code>{{identifier}}</code> <span class="variable-desc">Issue ID (e.g. LIN-99)</span></div>
          <div class="variable-item"><code>{{description}}</code> <span class="variable-desc">Issue description</span></div>
          <div class="variable-item"><code>{{status}}</code> <span class="variable-desc">Current workflow state</span></div>
          <div class="variable-item"><code>{{labels}}</code> <span class="variable-desc">Comma-separated labels</span></div>
          <div class="variable-item"><code>{{project}}</code> <span class="variable-desc">Project name</span></div>
          <div class="variable-item"><code>{{children}}</code> <span class="variable-desc">Formatted subtask list</span></div>
          <div class="variable-item"><code>{{comments}}</code> <span class="variable-desc">Formatted comment history</span></div>
        </div>
      </details>
      <div class="editor-actions">
        <button class="action-btn save custom-prompt-save-btn" disabled>save</button>
        <button class="action-btn custom-prompt-cancel-btn">cancel</button>
      </div>
    </div>`;
}

/**
 * Renders the custom prompts page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {Object} options - Page options
 * @param {Array} options.customPrompts - User's custom prompts
 * @param {Object} options.deployInfo - Deploy info
 * @param {string} options.urlKey - Current workspace URL key
 * @param {string} options.openRouterSource - OpenRouter source
 * @param {Array} options.workspaces - Connected workspaces
 * @param {Object} options.featureFlags - Feature flags
 * @returns {string} Complete HTML document
 */
export function renderCustomPromptsPage(workspaceName = 'Workspace', options = {}) {
  const { customPrompts = [], deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'prompts/custom', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/prompts/custom',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const promptCardsHtml = customPrompts.length > 0
    ? customPrompts.map(renderPromptCard).join('')
    : '<div class="custom-prompts-empty">No custom prompts yet. Create one to get started.</div>';

  const editorHtml = renderEditor();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Custom Prompts</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/common-actions.css">
  <link rel="stylesheet" href="/custom-prompts.css">
</head>
<body>
  ${navBarHtml}
  <header>
    <h1>Custom Prompts</h1>
    <p class="custom-prompts-subtitle">Create your own prompt templates with variable substitution</p>
  </header>

  <main>
    <section class="custom-prompts-section">
      <div class="custom-prompts-toolbar">
        <button class="action-btn save custom-prompt-new-btn">+ new prompt</button>
        <span class="custom-prompts-count">${customPrompts.length} / 20</span>
      </div>

      ${editorHtml}

      <div class="custom-prompts-list" data-url-key="${escapeHtml(urlKey)}">
        ${promptCardsHtml}
      </div>
    </section>
  </main>
  ${footerHtml}
  <script src="/common.js"></script>
  <script src="/app.js"></script>
  <script src="/custom-prompts.js"></script>
</body>
</html>`;
}
