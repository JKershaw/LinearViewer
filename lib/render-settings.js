/**
 * Settings Page Renderer
 *
 * Generates HTML for the standalone /settings page.
 * Maintains the CLI aesthetic while providing settings functionality.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { FEATURE_DEFAULTS, FEATURE_LABELS, FEATURE_NOTES, FEATURE_KEYS } from './feature-defaults.js';

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
 * Options for renderSettingsPage
 * @typedef {Object} SettingsPageOptions
 * @property {boolean} [openRouterConnected] - Whether OpenRouter is connected via OAuth
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 * @property {string} [currentModel] - Currently selected model ID
 * @property {ModelOption[]} [availableModels] - Available models for dropdown
 * @property {string} [modelError] - Model validation error code
 * @property {string} [urlKey] - Current workspace URL key for generating links
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 * @property {Object} [featureFlags] - Current feature toggle states
 */

/**
 * Renders the settings page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {SettingsPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderSettingsPage(workspaceName = 'Workspace', options = {}) {
  const { openRouterSource = null, deployInfo = {}, currentModel = '', availableModels = [], modelError = null, urlKey = null, workspaces = [], featureFlags = FEATURE_DEFAULTS } = options

  // Generate workspace-aware URLs
  const modelFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/model`

  // Unified navigation bar
  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'settings', featureFlags })

  // Footer with deploy info and navigation links
  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/settings',
    urlKey,
    openRouterSource
  })

  // Model selection UI
  const isCustomModel = currentModel && !availableModels.some(m => m.id === currentModel)
  const modelOptionsHtml = availableModels.map(m => {
    const selected = m.id === currentModel ? ' selected' : ''
    return `<option value="${escapeHtml(m.id)}"${selected}>${escapeHtml(m.name)}</option>`
  }).join('\n              ')

  const modelSelectorHtml = `
      <div class="settings-item model-selector">
        <span class="settings-label">AI Model:</span>
        <form action="${modelFormAction}" method="POST" class="settings-form model-form">
          <select name="modelId" class="model-select">
            ${modelOptionsHtml}
          </select>
          <button type="submit" class="settings-action save">save</button>
        </form>
      </div>
      <div class="settings-item model-custom">
        <span class="settings-label">Custom:</span>
        <form action="${modelFormAction}" method="POST" class="settings-form model-form">
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
  } else if (openRouterSource === 'free') {
    openRouterStatusHtml = `
      <div class="settings-item">
        <span class="settings-label">OpenRouter:</span>
        <span class="settings-value free-tier" data-free-tier-status>● free tier</span>
        <a href="/auth/openrouter" class="settings-action connect">connect for unlimited</a>
      </div>
      <div class="settings-item">
        <span class="settings-label">Usage:</span>
        <span class="settings-value" data-free-tier-usage>Loading...</span>
      </div>`
  } else {
    openRouterStatusHtml = `
      <div class="settings-item">
        <span class="settings-label">OpenRouter:</span>
        <span class="settings-value disconnected">○ not connected</span>
        <a href="/auth/openrouter" class="settings-action connect">connect</a>
      </div>`
  }

  // Feature toggles section
  const featureFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/features`
  const featureTogglesHtml = FEATURE_KEYS.map(key => {
    const isOn = featureFlags[key] ?? FEATURE_DEFAULTS[key]
    const label = FEATURE_LABELS[key] || key
    const note = FEATURE_NOTES[key]
    const stateText = isOn ? 'on' : 'off'
    const nextState = isOn ? 'false' : 'true'
    const stateClass = isOn ? 'toggle-on' : 'toggle-off'
    const noteHtml = note ? ` <span class="feature-note">${escapeHtml(note)}</span>` : ''

    return `
      <div class="settings-item feature-toggle" data-feature="${escapeHtml(key)}">
        <span class="settings-label feature-toggle-label">${escapeHtml(label)}:</span>
        <form action="${featureFormAction}" method="POST" class="settings-form feature-form">
          <input type="hidden" name="feature" value="${escapeHtml(key)}">
          <input type="hidden" name="enabled" value="${nextState}">
          <button type="submit" class="toggle-btn ${stateClass}"><span class="toggle-state">${stateText}</span></button>
        </form>${noteHtml}
      </div>`
  }).join('')

  const featuresSectionHtml = `
    <section class="settings-section">
      <h2 class="settings-header">Features</h2>
      ${featureTogglesHtml}
    </section>`

  // Token management section (only shown when urlKey is available AND dispatch is enabled)
  const tokenSectionHtml = (urlKey && featureFlags.dispatch === true) ? `
    <section class="settings-section">
      <h2 class="settings-header">Dispatch Tokens</h2>
      <p class="settings-description">API tokens for external consumers to poll and take dispatched prompts.</p>
      <div class="settings-item token-create">
        <span class="settings-label">Create:</span>
        <form class="settings-form token-form" id="create-token-form" data-url-key="${escapeHtml(urlKey)}">
          <input type="text" name="label" class="token-label-input" maxlength="50" placeholder="Token label (optional)">
          <button type="submit" class="settings-action save">generate</button>
        </form>
      </div>
      <div class="token-list" data-url-key="${escapeHtml(urlKey)}">
        <div class="token-list-loading">Loading tokens...</div>
      </div>
    </section>` : ''

  // Account section with logout
  const accountSectionHtml = `
    <section class="settings-section">
      <h2 class="settings-header">Account</h2>
      <div class="settings-item">
        <span class="settings-label">Session:</span>
        <a href="/logout" class="settings-action logout">logout</a>
      </div>
    </section>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Settings</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/settings.css">
</head>
<body>
  ${navBarHtml}
  <header>
    <h1>Settings</h1>
    <p class="settings-subtitle">Configure AI, features, and connections</p>
  </header>

  <main>
    <section class="settings-section">
      <h2 class="settings-header">AI Configuration</h2>
      ${openRouterStatusHtml}
      ${modelSelectorHtml}
    </section>
    ${featuresSectionHtml}
    ${tokenSectionHtml}
    ${accountSectionHtml}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->
  <script src="/common.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}
