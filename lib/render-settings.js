/**
 * Settings Page Renderer
 *
 * Generates HTML for the standalone /settings page.
 * Uses the same tree/node visual language as the dashboard.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { FEATURE_DEFAULTS, FEATURE_LABELS, FEATURE_DESCRIPTIONS, FEATURE_NOTES } from './feature-defaults.js';

/** Features shown in the AI section */
const AI_FEATURES = ['aiRecommendations', 'promptButtons', 'roadmap'];

/** Features shown in the Workflow section */
const WORKFLOW_FEATURES = ['linearMcp', 'featureBranches', 'codeReview', 'dispatch', 'proxy'];

/** Sub-features shown nested under codeReview when it is enabled */
const CODE_REVIEW_SUB_FEATURES = ['codeReviewSelf', 'codeReviewCicd', 'codeReviewPr'];

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
 * Render a single feature toggle as a tree node.
 * @param {string} key - Feature key
 * @param {Object} featureFlags - Current feature flag states
 * @param {string} formAction - Form action URL
 * @param {Object} [options] - Optional rendering options
 * @param {string} [options.childrenHtml] - HTML for nested sub-toggles
 * @returns {string} HTML for the toggle node
 */
function renderFeatureToggle(key, featureFlags, formAction, { childrenHtml = '' } = {}) {
  const isOn = featureFlags[key] ?? FEATURE_DEFAULTS[key];
  const label = FEATURE_LABELS[key] || key;
  const description = FEATURE_DESCRIPTIONS[key] || '';
  const note = FEATURE_NOTES[key];
  const stateText = isOn ? '● on' : '○ off';
  const nextState = isOn ? 'false' : 'true';
  const stateClass = isOn ? 'toggle-on' : 'toggle-off';
  const noteHtml = note ? ` <span class="feature-note">${escapeHtml(note)}</span>` : '';
  const descHtml = description ? ` <span class="feature-desc">${escapeHtml(description)}</span>` : '';

  return `
          <div class="node">
            <div class="line feature-toggle" data-feature="${escapeHtml(key)}">
              <span class="settings-label feature-toggle-label">${escapeHtml(label)}:</span>
              <form action="${formAction}" method="POST" class="settings-form feature-form">
                <input type="hidden" name="feature" value="${escapeHtml(key)}">
                <input type="hidden" name="enabled" value="${nextState}">
                <button type="submit" class="toggle-btn ${stateClass}"><span class="toggle-state">${stateText}</span></button>
              </form>${noteHtml}${descHtml}
            </div>${childrenHtml}
          </div>`;
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
  const featureFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/features`

  // Unified navigation bar
  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'settings', featureFlags })

  // Footer with deploy info and navigation links
  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/settings',
    urlKey,
    openRouterSource,
    featureFlags
  })

  // --- OpenRouter connection node ---
  let connectionNodeHtml;
  if (openRouterSource === 'oauth') {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="settings-label">connection:</span>
              <span class="settings-value connected">● connected</span>
              <form action="/auth/openrouter/disconnect" method="POST" class="settings-form">
                <button type="submit" class="action-btn disconnect">disconnect</button>
              </form>
            </div>
          </div>`;
  } else if (openRouterSource === 'env') {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="settings-label">connection:</span>
              <span class="settings-value env">● env key</span>
            </div>
          </div>`;
  } else if (openRouterSource === 'free') {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="settings-label">connection:</span>
              <span class="settings-value free-tier" data-free-tier-status>● free tier</span>
              <a href="/auth/openrouter" class="action-btn connect">connect for unlimited</a>
            </div>
            <div class="children">
              <div class="node">
                <div class="line">
                  <span class="settings-label">usage:</span>
                  <span class="settings-value" data-free-tier-usage>Loading...</span>
                </div>
              </div>
            </div>
          </div>`;
  } else {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="settings-label">connection:</span>
              <span class="settings-value disconnected">○ not connected</span>
              <a href="/auth/openrouter" class="action-btn connect">connect</a>
            </div>
          </div>`;
  }

  // --- Model selector node (unified form) ---
  const isCustomModel = currentModel && !availableModels.some(m => m.id === currentModel);
  const modelOptionsHtml = availableModels.map(m => {
    const selected = m.id === currentModel ? ' selected' : '';
    return `<option value="${escapeHtml(m.id)}"${selected}>${escapeHtml(m.name)}</option>`;
  }).join('\n                  ');

  const modelErrorHtml = modelError ? `
              <div class="node">
                <div class="line">
                  <span class="settings-label">error:</span>
                  <span class="settings-value error">${escapeHtml(getModelErrorMessage(modelError))}</span>
                </div>
              </div>` : '';

  const modelNodeHtml = `
          <div class="node">
            <div class="line model-selector">
              <span class="settings-label">model:</span>
              <form action="${modelFormAction}" method="POST" class="settings-form model-form">
                <select name="modelId" class="model-select">
                  ${modelOptionsHtml}
                </select>
                <span class="model-or">or</span>
                <input type="text" name="customModelId" class="model-input" maxlength="100" placeholder="custom model id" value="${isCustomModel ? escapeHtml(currentModel) : ''}">
                <button type="submit" class="action-btn save">save</button>
              </form>
              <a href="https://openrouter.ai/models" target="_blank" class="settings-link">browse models →</a>
            </div>
            <div class="children">
              <div class="node">
                <div class="line model-current">
                  <span class="settings-label">current:</span>
                  <span class="settings-value model-id">${escapeHtml(currentModel)}</span>
                </div>
              </div>${modelErrorHtml}
            </div>
          </div>`;

  // --- AI feature toggles ---
  const aiTogglesHtml = AI_FEATURES.map(key =>
    renderFeatureToggle(key, featureFlags, featureFormAction)
  ).join('');

  // --- Workflow feature toggles ---
  const workflowTogglesHtml = WORKFLOW_FEATURES.map(key => {
    if (key === 'codeReview') {
      // Render code review sub-toggles as nested children
      const isOn = featureFlags.codeReview ?? false;
      const subTogglesHtml = CODE_REVIEW_SUB_FEATURES.map(subKey =>
        renderFeatureToggle(subKey, featureFlags, featureFormAction)
      ).join('');
      const childrenHtml = `
            <div class="children code-review-options"${!isOn ? ' hidden' : ''}>
              ${subTogglesHtml}
            </div>`;
      return renderFeatureToggle(key, featureFlags, featureFormAction, { childrenHtml });
    }
    return renderFeatureToggle(key, featureFlags, featureFormAction);
  }).join('');

  // --- Account section ---
  const auditUrl = `/workspace/${encodeURIComponent(urlKey)}/audit`;
  const promptsUrl = `/workspace/${encodeURIComponent(urlKey)}/prompts`;
  const customPromptsUrl = `/workspace/${encodeURIComponent(urlKey)}/prompts/custom`;
  const accountSectionHtml = `
    <section class="settings-section">
      <h2 class="settings-header">Account</h2>
      <div class="tree">
        <div class="node">
          <div class="line">
            <span class="settings-label">prompts:</span>
            <a href="${promptsUrl}" class="settings-action">catalog</a>
            · <a href="${customPromptsUrl}" class="settings-action">custom prompts</a>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="settings-label">audit:</span>
            <a href="${auditUrl}" class="settings-action">operator dashboard</a>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="settings-label">session:</span>
            <a href="/logout" class="action-btn logout">logout</a>
          </div>
        </div>
      </div>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Settings</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/common-actions.css">
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
      <h2 class="settings-header">AI</h2>
      <div class="tree">
        ${connectionNodeHtml}
        ${modelNodeHtml}
        ${aiTogglesHtml}
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-header">Workflow</h2>
      <div class="tree">
        ${workflowTogglesHtml}
      </div>
    </section>
    ${accountSectionHtml}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->
  <script src="/common.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}
