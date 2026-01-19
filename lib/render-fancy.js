/**
 * Operator Dashboard Renderer
 *
 * Generates HTML for the /fancy operator dashboard page.
 * Maintains the CLI aesthetic while adding dashboard functionality.
 */

// Base64-encoded SVG favicon - same as main site
const FAVICON_BASE64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjI2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHBhdGggZD0iTTMgMTB2MTJoNiIgc3Ryb2tlPSIjMjIyIiBzdHJva2Utd2lkdGg9IjQiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjEzIiBjeT0iMjIiIHI9IjMuNSIgZmlsbD0iIzIyMiIvPjxyZWN0IHg9IjE4IiB5PSIxMiIgd2lkdGg9IjExIiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHJlY3QgeD0iMTgiIHk9IjIwIiB3aWR0aD0iOSIgaGVpZ2h0PSI0IiByeD0iMSIgZmlsbD0iIzIyMiIvPjwvc3ZnPg==';

/**
 * Escapes HTML entities to prevent XSS.
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Translates model validation error codes to user-friendly messages.
 * @param {string} errorCode - The error code from query param
 * @returns {string} Human-readable error message
 */
function getModelErrorMessage(errorCode) {
  const messages = {
    'empty': 'Please enter a model ID',
    'too-long': 'Model ID must be 100 characters or less',
    'invalid-format': 'Invalid format. Use provider/model (e.g., anthropic/claude-sonnet-4)'
  };
  return messages[errorCode] || 'Invalid model ID';
}

/**
 * Model option for the dropdown
 * @typedef {Object} ModelOption
 * @property {string} id - Model ID (e.g., 'anthropic/claude-sonnet-4')
 * @property {string} name - Display name (e.g., 'Claude Sonnet 4')
 * @property {string} description - Brief description (e.g., 'Default - balanced quality/cost')
 */

/**
 * Options for renderFancyPage
 * @typedef {Object} FancyPageOptions
 * @property {boolean} [openRouterConnected] - Whether OpenRouter is connected via OAuth
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 * @property {string} [currentModel] - Currently selected model ID
 * @property {ModelOption[]} [availableModels] - Available models for dropdown
 */

/**
 * Render the dashboard footer with deploy info only
 * (No reset/audit links since this IS the audit page)
 * @param {Object} deployInfo - Heroku deploy information
 * @returns {string} HTML for footer
 */
function renderFooter(deployInfo = {}) {
  let deployHtml = ''
  if (deployInfo.version) {
    const parts = []

    // Version (e.g., "v42")
    parts.push(deployInfo.version)

    // Deploy date/time - render with data attribute for client-side local timezone formatting
    // Initial text is server-rendered fallback, JS will update to include local time
    if (deployInfo.createdAt) {
      const date = new Date(deployInfo.createdAt)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const fallbackText = `deployed ${months[date.getMonth()]} ${date.getDate()}`
      // Escape timestamp for safe HTML attribute insertion
      parts.push(`<span class="deploy-time" data-timestamp="${escapeHtml(deployInfo.createdAt)}">${fallbackText}</span>`)
    }

    // Commit hash linked to GitHub (e.g., "abc123")
    if (deployInfo.commit) {
      const shortCommit = deployInfo.commit.slice(0, 7)
      parts.push(`<a href="https://github.com/JKershaw/LinearViewer/commit/${deployInfo.commit}" target="_blank" class="footer-link">${shortCommit}</a>`)
    }

    deployHtml = parts.join(' · ')
  } else {
    // Fallback: link to GitHub repo
    deployHtml = '<a href="https://github.com/JKershaw/LinearViewer" target="_blank" class="footer-link">github.com/JKershaw/LinearViewer</a>'
  }

  return `
  <footer class="page-footer">
    <div class="footer-deploy">${deployHtml}</div>
  </footer>`
}

/**
 * Renders the operator dashboard page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {FancyPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderFancyPage(workspaceName = 'Workspace', options = {}) {
  const { openRouterConnected = false, openRouterSource = null, deployInfo = {}, currentModel = '', availableModels = [], modelError = null } = options

  // Footer with deploy info
  const footerHtml = renderFooter(deployInfo)

  // Model selection UI
  const isCustomModel = currentModel && !availableModels.some(m => m.id === currentModel)
  const modelOptionsHtml = availableModels.map(m => {
    const selected = m.id === currentModel ? ' selected' : ''
    return `<option value="${escapeHtml(m.id)}"${selected}>${escapeHtml(m.name)}</option>`
  }).join('\n              ')

  const modelSelectorHtml = `
      <div class="settings-item model-selector">
        <span class="settings-label">AI Model:</span>
        <form action="/settings/model" method="POST" class="settings-form model-form">
          <select name="modelId" class="model-select">
            ${modelOptionsHtml}
          </select>
          <button type="submit" class="settings-action save">save</button>
        </form>
      </div>
      <div class="settings-item model-custom">
        <span class="settings-label">Custom:</span>
        <form action="/settings/model" method="POST" class="settings-form model-form">
          <input type="text" name="customModelId" class="model-input" maxlength="100" placeholder="e.g., google/gemini-2.5-pro" value="${isCustomModel ? escapeHtml(currentModel) : ''}">
          <button type="submit" class="settings-action save">save</button>
        </form>
        <a href="https://openrouter.ai/models" target="_blank" class="settings-link">browse models →</a>
      </div>
      <div class="settings-item model-current">
        <span class="settings-label">Current:</span>
        <span class="settings-value model-id">${escapeHtml(currentModel)}</span>
      </div>${modelError ? `
      <div class="settings-item model-error">
        <span class="settings-label">Error:</span>
        <span class="settings-value error">${escapeHtml(getModelErrorMessage(modelError))}</span>
      </div>` : ''}`

  // OpenRouter connection UI
  let openRouterStatusHtml
  if (openRouterSource === 'oauth') {
    openRouterStatusHtml = `
      <div class="settings-item">
        <span class="settings-label">OpenRouter:</span>
        <span class="settings-value connected">● connected</span>
        <form action="/auth/openrouter/disconnect" method="POST" class="settings-form">
          <button type="submit" class="settings-action disconnect">disconnect</button>
        </form>
      </div>`
  } else if (openRouterSource === 'env') {
    openRouterStatusHtml = `
      <div class="settings-item">
        <span class="settings-label">OpenRouter:</span>
        <span class="settings-value env">● env key</span>
      </div>`
  } else {
    openRouterStatusHtml = `
      <div class="settings-item">
        <span class="settings-label">OpenRouter:</span>
        <span class="settings-value disconnected">○ not connected</span>
        <a href="/auth/openrouter" class="settings-action connect">connect</a>
      </div>`
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Operator Dashboard</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/fancy.css">
</head>
<body>
  <nav class="nav-bar" aria-label="Dashboard navigation">
    <div class="nav-filters">
      <div class="nav-item">
        <span class="nav-label">workspace:</span>
        <span class="nav-value-static">${escapeHtml(workspaceName)}</span>
      </div>
    </div>
    <div class="nav-actions">
      <a href="/" class="nav-action">← projects</a>
      <a href="/logout" class="nav-action">logout</a>
    </div>
  </nav>

  <header>
    <h1>Operator Dashboard</h1>
    <p class="dashboard-subtitle">Workspace audit and health check</p>
  </header>

  <main>
    <section class="settings-section">
      <h2 class="settings-header">Settings</h2>
      ${openRouterStatusHtml}
      ${modelSelectorHtml}
    </section>

    <section class="audit-controls">
      <button id="run-audit" class="audit-button">Run Audit</button>
      <span id="audit-status" class="audit-status"></span>
    </section>

    <section id="audit-report" class="audit-report hidden">
      <!-- Report will be rendered here by JavaScript -->
    </section>

    <section id="audit-error" class="audit-error hidden">
      <!-- Error message will be rendered here -->
    </section>
  </main>
  ${footerHtml}
  <script src="/fancy.js"></script>
</body>
</html>`;
}
