/**
 * Settings Page Renderer
 *
 * Generates HTML for the standalone /settings page.
 * Uses the same tree/node visual language as the dashboard.
 */

import { escapeHtml } from './utils/html.js';
import { formatModelPricing } from './openrouter.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { FEATURE_DEFAULTS, FEATURE_LABELS, FEATURE_DESCRIPTIONS, FEATURE_NOTES, WORKSPACE_FEATURE_KEYS, WORKSPACE_FEATURE_DEFAULTS, WORKSPACE_FEATURE_LABELS, WORKSPACE_FEATURE_DESCRIPTIONS } from './feature-defaults.js';
import { PROMPT_TEMPLATES } from './prompt-template-defs.js';

/** UI-only suggestion list for the dispatch-defaults harness select-or-custom control (LIN-1095). Not a registry — harness stays an opaque string everywhere (LIN-1084/LIN-438). */
const DISPATCH_HARNESS_SUGGESTIONS = ['claude-code', 'opencode'];

/**
 * UI-only default (LIN-1111) for the *workspace-wide* dispatch-defaults
 * harness select — pre-selects this when no harness is configured yet, since
 * "no harness configured" reads most naturally as "default to Claude" for a
 * fresh workspace. Deliberately NOT applied to the per-kind override rows
 * (`renderDispatchDefaultsSection`'s `kindRowsHtml`): blank there is the
 * meaningful, common "inherit the workspace default" state, and this form
 * re-derives the entire `dispatchDefaults` tree from whatever every row shows
 * on submit (`server.js` `/settings/dispatch-defaults`) — pre-selecting here
 * too would silently convert all 15 inherited rows into explicit `claude-code`
 * overrides the next time anyone saves the form, for any reason.
 */
const DEFAULT_HARNESS = 'claude-code';

/**
 * Small, distinctly-named recommended-models list for the dispatch-EXECUTION
 * model inputs (LIN-1111) — deliberately a separate constant from
 * `AVAILABLE_MODELS` (openrouter.js), which recommends models for the
 * unrelated "Workspace AI Model" selector below (the model that WRITES
 * prompts, not the one a dispatched agent executes with). Rendered as
 * `<datalist>` suggestions, not hard options, so free text is still accepted
 * and a blank field still means "inherit"/null.
 */
const DISPATCH_MODEL_SUGGESTIONS = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro'
];
const DISPATCH_MODEL_SUGGESTIONS_ID = 'dispatch-model-suggestions';

/** Features shown in the AI section */
const AI_FEATURES = ['aiRecommendations', 'promptButtons', 'roadmap'];

/** Features shown in the Workflow section */
const WORKFLOW_FEATURES = ['linearMcp', 'featureBranches', 'codeReview', 'dispatch', 'proxy', 'feedbackWidget'];

/** Experimental features — surfaced only here, behind a toggle (LIN-450). */
const EXPERIMENTAL_FEATURES = ['collective', 'taskChat', 'ship', 'nextRun', 'flightCompanion'];

/** Sub-features shown nested under codeReview when it is enabled */
const CODE_REVIEW_SUB_FEATURES = ['codeReviewSelf', 'codeReviewCicd', 'codeReviewPr'];

/** Sub-features shown nested under feedbackWidget when it is enabled (LIN-733) */
const FEEDBACK_SUB_FEATURES = ['feedbackTriage'];

/**
 * Static known-provider list for the "add provider" affordance (LIN-634).
 *
 * A static known set (not `getAllProviders()`) so the addable choices are
 * stable regardless of registry walk order. `blockedBy` names a dependency
 * ticket that gates a provider's live add; a null `blockedBy` means the add
 * flow can begin a real connection today. GitHub's add is now live — its OAuth
 * flow landed in LIN-541 (POST .../providers/add routes into /auth/github).
 */
const KNOWN_ADD_PROVIDERS = [
  // Linear has NO per-workspace add-source binding path yet: its OAuth begin is
  // always mode:'new', so the callback creates a SEPARATE workspace and switches
  // active to it — i.e. "+ Linear add" did not add a source to THIS workspace, it
  // silently swapped you onto a new one (LIN-735 Symptom 1). Until the real
  // binding lands (LIN-544) the affordance is honestly disabled rather than left
  // misrepresenting what it does. (Connecting a brand-new Linear workspace still
  // works from the login page — that flow is not misleading.)
  { name: 'linear', displayName: 'Linear', blockedBy: 'LIN-544' },
  { name: 'github', displayName: 'GitHub Issues', blockedBy: null },
  // GitHub Projects' add is live as of LIN-560 Session 2 — its board-picker flow
  // (POST .../providers/add routes into /auth/github-projects) on the shared App.
  { name: 'github-projects', displayName: 'GitHub Projects', blockedBy: null },
];

/**
 * Mask a binding's credential token for display (LIN-634).
 *
 * For `local`, the "token" IS the urlKey store-partition key — not a secret — so
 * it is labelled rather than masked. Otherwise show only the last 4 chars.
 *
 * @param {string|undefined} token
 * @param {string} provider
 * @returns {string}
 */
function maskToken(token, provider) {
  if (provider === 'local') return '(partition key)';
  if (!token) return '(none)';
  const last4 = String(token).slice(-4);
  return `••••${last4}`;
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
 * Translates dispatch-defaults validation error codes to user-friendly messages (LIN-1095).
 * @param {string} errorCode - The error code from query param
 * @returns {string} Human-readable error message
 */
function getDispatchDefaultsErrorMessage(errorCode) {
  const messages = {
    'invalid-field': 'One or more model/harness values are invalid (must be plain text, 1000 characters or less, no control characters).'
  };
  return messages[errorCode] || 'Invalid dispatch defaults';
}

/**
 * Renders the shared harness select-or-custom control (LIN-1095): a small
 * suggestion-list select plus a free-text fallback, mirroring the workspace
 * model selector's select+"or"+custom-input shape (lines ~476-514 below).
 * Factored once so the workspace-wide row and every per-kind row reuse the
 * same markup instead of duplicating it 16 times.
 *
 * @param {string} namePrefix - Form field name prefix; emits `${namePrefix}HarnessSelect`/`${namePrefix}HarnessCustom`
 * @param {string} [currentValue] - Current harness value (may be a suggestion or a custom string)
 * @param {Object} [opts]
 * @param {boolean} [opts.preselectDefault] - Pre-select `DEFAULT_HARNESS` when `currentValue` is blank (LIN-1111; workspace-wide row only, see `DEFAULT_HARNESS`'s doc comment)
 * @returns {string} HTML for the select+custom pair
 */
function renderHarnessSelectOrCustom(namePrefix, currentValue = '', { preselectDefault = false } = {}) {
  const isKnown = DISPATCH_HARNESS_SUGGESTIONS.includes(currentValue);
  const defaultForBlank = !currentValue && preselectDefault ? DEFAULT_HARNESS : '';
  const blankSelected = !currentValue && !defaultForBlank ? ' selected' : '';
  const optionsHtml = DISPATCH_HARNESS_SUGGESTIONS.map(h => {
    const selected = h === currentValue || h === defaultForBlank ? ' selected' : '';
    return `<option value="${escapeHtml(h)}"${selected}>${escapeHtml(h)}</option>`;
  }).join('\n                  ');
  return `<select name="${escapeHtml(namePrefix)}HarnessSelect" class="harness-select">
                  <option value=""${blankSelected}>&mdash;</option>
                  ${optionsHtml}
                </select>
                <span class="model-or">or</span>
                <input type="text" name="${escapeHtml(namePrefix)}HarnessCustom" class="harness-input" maxlength="200" placeholder="custom harness" value="${!isKnown ? escapeHtml(currentValue) : ''}">`;
}

/**
 * Renders one dispatch-defaults row: a label, the shared harness control, and
 * a free-text model input. Used for both the workspace-wide default row and
 * every per-prompt-type override row (LIN-1095).
 *
 * @param {Object} opts
 * @param {string} opts.label - Row label
 * @param {string} opts.namePrefix - Form field name prefix for this row (also feeds the harness control)
 * @param {string} opts.testid - data-testid for the row
 * @param {string} [opts.model] - Current model value
 * @param {string} [opts.harness] - Current harness value
 * @param {boolean} [opts.preselectDefault] - Forwarded to `renderHarnessSelectOrCustom` (LIN-1111; workspace-wide row only)
 * @returns {string} HTML for the row
 */
function renderDispatchDefaultRow({ label, namePrefix, testid, model = '', harness = '', preselectDefault = false }) {
  return `
          <div class="node">
            <div class="line dispatch-default-row" data-testid="${escapeHtml(testid)}">
              <span class="field-label">${escapeHtml(label)}:</span>
              ${renderHarnessSelectOrCustom(namePrefix, harness, { preselectDefault })}
              <input type="text" name="${escapeHtml(namePrefix)}Model" class="dispatch-model-input" maxlength="200" list="${DISPATCH_MODEL_SUGGESTIONS_ID}" placeholder="provider/model (blank = inherit)" value="${escapeHtml(model)}">
            </div>
          </div>`;
}

/**
 * Renders the "Dispatch defaults" section body (LIN-1095): a workspace-wide
 * default model/harness row plus one override row per live PROMPT_TEMPLATES
 * key, all submitted through a single form to
 * `/workspace/:urlKey/settings/dispatch-defaults`. This configures the
 * model/harness dispatched agents EXECUTE with — distinct from the
 * "Workspace AI Model" above, which is the model that WRITES prompts.
 *
 * @param {Object} [dispatchDefaults] - `{ model, harness, byKind }` (LIN-1094 shape)
 * @param {string} urlKey - Workspace urlKey
 * @param {string} [errorCode] - Validation error code from redirect, if any
 * @param {Array<{id: string, name: string}>} [modelCatalog] - Live OpenRouter
 *   catalog (LIN-1111 Session 2) merged into the model datalist alongside
 *   DISPATCH_MODEL_SUGGESTIONS. Empty/omitted renders the static list unchanged.
 * @returns {string} HTML for the section body
 */
function renderDispatchDefaultsSection(dispatchDefaults = {}, urlKey, errorCode = null, modelCatalog = []) {
  const formAction = `/workspace/${encodeURIComponent(urlKey)}/settings/dispatch-defaults`;
  const byKind = dispatchDefaults.byKind || {};

  const errorHtml = errorCode ? `
        <div class="node">
          <div class="line">
            <span class="field-label">error:</span>
            <span class="settings-value error">${escapeHtml(getDispatchDefaultsErrorMessage(errorCode))}</span>
          </div>
        </div>` : '';

  const defaultRowHtml = renderDispatchDefaultRow({
    label: 'Workspace default',
    namePrefix: 'default',
    testid: 'dispatch-default-row-default',
    model: dispatchDefaults.model || '',
    harness: dispatchDefaults.harness || '',
    preselectDefault: true
  });

  const kindKeys = Object.keys(PROMPT_TEMPLATES);
  const kindRowsHtml = kindKeys.map(kind => renderDispatchDefaultRow({
    label: kind,
    namePrefix: `kind__${kind}__`,
    testid: `dispatch-default-row-${kind}`,
    model: byKind[kind]?.model || '',
    harness: byKind[kind]?.harness || ''
  })).join('');

  // Progressive disclosure (LIN-1111): a native <details> keeps the 15
  // per-kind override rows out of the way by default, expanding
  // automatically when at least one is already configured so an existing
  // override is never hidden from the user who set it. Purely rendering —
  // every row still posts through the one shared form untouched.
  const hasKindOverride = kindKeys.some(kind => byKind[kind]?.model || byKind[kind]?.harness);
  // Merge the live catalog (LIN-1111 Session 2) in after the curated
  // suggestions, de-duped so a catalog entry that happens to match a
  // recommended id isn't listed twice.
  const knownModelIds = new Set(DISPATCH_MODEL_SUGGESTIONS);
  const catalogModelIds = modelCatalog
    .map(m => m?.id)
    .filter(id => typeof id === 'string' && id && !knownModelIds.has(id));
  const modelSuggestionsHtml = [...DISPATCH_MODEL_SUGGESTIONS, ...catalogModelIds]
    .map(m => `<option value="${escapeHtml(m)}"></option>`)
    .join('');

  return `<p class="settings-subtitle">The model/harness dispatched agents execute <em>with</em> &mdash; distinct from the Workspace AI Model above, which is used to <em>write</em> prompts. Per-type rows override the workspace default; leave a row blank to inherit it.</p>
      <form action="${formAction}" method="POST" class="settings-form dispatch-defaults-form">
      <datalist id="${DISPATCH_MODEL_SUGGESTIONS_ID}">${modelSuggestionsHtml}</datalist>
      <div class="tree">${errorHtml}
        ${defaultRowHtml}
        <div class="node">
          <details class="dispatch-kind-overrides"${hasKindOverride ? ' open' : ''}>
            <summary class="dispatch-kind-overrides-summary" data-testid="dispatch-kind-overrides-toggle">Per-type overrides (${kindKeys.length})</summary>
            <div class="children">${kindRowsHtml}
            </div>
          </details>
        </div>
      </div>
      <div class="dispatch-defaults-submit">
        <button type="submit" class="action-btn save">save dispatch defaults</button>
      </div>
      </form>`;
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
            <div class="line feature-toggle" data-feature="${escapeHtml(key)}" data-testid="settings-toggle-${escapeHtml(key)}">
              <span class="field-label feature-toggle-label">${escapeHtml(label)}:</span>
              <form action="${formAction}" method="POST" class="settings-form feature-form">
                <input type="hidden" name="feature" value="${escapeHtml(key)}">
                <input type="hidden" name="enabled" value="${nextState}">
                <button type="submit" class="toggle-btn ${stateClass}"><span class="toggle-state">${stateText}</span></button>
              </form>${noteHtml}${descHtml}
            </div>${childrenHtml}
          </div>`;
}

/**
 * Render a single workspace-scoped feature toggle as a tree node.
 *
 * Visually identical to renderFeatureToggle (so the settings-page toggle client
 * picks it up), but reads from the workspace feature defaults/labels/descriptions
 * and posts to the workspace-features handler. This section is explicit, not part
 * of the per-user auto-render loop — workspace feature state comes from
 * WorkspacePreferencesStore, not session.features.
 *
 * @param {string} key - Workspace feature key
 * @param {Object} workspaceFeatures - Current workspace feature flag states
 * @param {string} formAction - Form action URL (the workspace-features handler)
 * @returns {string} HTML for the toggle node
 */
function renderWorkspaceFeatureToggle(key, workspaceFeatures, formAction) {
  const isOn = workspaceFeatures[key] ?? WORKSPACE_FEATURE_DEFAULTS[key];
  const label = WORKSPACE_FEATURE_LABELS[key] || key;
  const description = WORKSPACE_FEATURE_DESCRIPTIONS[key] || '';
  const stateText = isOn ? '● on' : '○ off';
  const nextState = isOn ? 'false' : 'true';
  const stateClass = isOn ? 'toggle-on' : 'toggle-off';
  const descHtml = description ? ` <span class="feature-desc">${escapeHtml(description)}</span>` : '';

  return `
          <div class="node">
            <div class="line feature-toggle" data-feature="${escapeHtml(key)}" data-testid="settings-toggle-${escapeHtml(key)}">
              <span class="field-label feature-toggle-label">${escapeHtml(label)}:</span>
              <form action="${formAction}" method="POST" class="settings-form feature-form">
                <input type="hidden" name="feature" value="${escapeHtml(key)}">
                <input type="hidden" name="enabled" value="${nextState}">
                <button type="submit" class="toggle-btn ${stateClass}"><span class="toggle-state">${stateText}</span></button>
              </form>${descHtml}
            </div>
          </div>`;
}

/**
 * Format a USD cost for display. Small amounts keep 4 decimals (per-call costs
 * are fractions of a cent); larger totals round to 2.
 * @param {number} cost
 * @returns {string}
 */
function formatCost(cost) {
  const n = typeof cost === 'number' && Number.isFinite(cost) ? cost : 0;
  return `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;
}

/**
 * Render the AI usage KPI tree (LIN-418): totals plus a per-feature breakdown,
 * sourced from the per-call LLM metadata log. Returns an empty-state node when
 * there are no recorded calls yet.
 *
 * @param {Object} stats - Output of LlmCallLogStore.summarize()
 * @returns {string} HTML for the tree body
 */
function renderLlmStats(stats = {}) {
  const totalCalls = stats.totalCalls || 0;
  if (!totalCalls) {
    return `<div class="tree">
        <div class="node">
          <div class="line">
            <span class="field-label">calls:</span>
            <span class="field-value">none recorded yet</span>
          </div>
        </div>
      </div>`;
  }

  const totalTokens = (stats.totalTokens || 0).toLocaleString('en-US');
  const featureRows = (stats.byFeature || []).map(f => `
          <div class="node">
            <div class="line">
              <span class="field-label">${escapeHtml(f.feature)}:</span>
              <span class="field-value">${f.calls} ${f.calls === 1 ? 'call' : 'calls'} · ${escapeHtml(formatCost(f.cost))}</span>
            </div>
          </div>`).join('');

  const lastCallHtml = stats.lastCallAt ? `
        <div class="node">
          <div class="line">
            <span class="field-label">last call:</span>
            <span class="field-value">${escapeHtml(stats.lastCallAt)}</span>
          </div>
        </div>` : '';

  return `<div class="tree">
        <div class="node">
          <div class="line">
            <span class="field-label">calls:</span>
            <span class="field-value">${totalCalls}</span>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="field-label">cost:</span>
            <span class="field-value">${escapeHtml(formatCost(stats.totalCost))}</span>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="field-label">tokens:</span>
            <span class="field-value">${escapeHtml(totalTokens)}</span>
          </div>
        </div>${lastCallHtml}
        <div class="node">
          <div class="line">
            <span class="field-label">by feature:</span>
          </div>
          <div class="children">${featureRows}
          </div>
        </div>
      </div>`;
}

/**
 * Render the Providers management section (LIN-634).
 *
 * Lists each provider binding (provider, scope, masked token, active marker) with
 * a remove form and a refresh/test form, plus an "add provider" affordance drawn
 * from {@link KNOWN_ADD_PROVIDERS}. The GitHub Issues + Projects add rows are gated
 * on `githubEnabled` (the shared GitHub-config predicate, LIN-761): shown as a live
 * "add" button when configured, honestly disabled otherwise. Provider actions are
 * full POST→redirect forms — NOT the XHR feature-toggle flow — so they deliberately
 * carry no `feature-toggle`/`feature-form` classes the settings toggle client
 * (`public/app.js`) listens for.
 *
 * @param {Array<{provider: string, scope: string, displayName?: string, token?: string, active?: boolean}>} bindings
 * @param {string} urlKey
 * @param {{type: 'ok'|'fail'|'blocked', text: string}|null} notice
 * @param {boolean} [githubEnabled=true] - Whether GitHub is fully configured on this
 *   server; when false the GitHub add rows render disabled with an honest reason.
 * @returns {string} HTML for the section body
 */
function renderProvidersSection(bindings, urlKey, notice, githubEnabled = true) {
  const removeAction = `/workspace/${encodeURIComponent(urlKey)}/settings/providers/remove`;
  const refreshAction = `/workspace/${encodeURIComponent(urlKey)}/settings/providers/refresh`;
  const switchAction = `/workspace/${encodeURIComponent(urlKey)}/settings/providers/switch`;
  const addAction = `/workspace/${encodeURIComponent(urlKey)}/settings/providers/add`;

  const noticeHtml = notice ? `
        <div class="node">
          <div class="line provider-notice provider-notice-${escapeHtml(notice.type)}" data-testid="settings-provider-notice">
            <span class="field-value">${escapeHtml(notice.text)}</span>
          </div>
        </div>` : '';

  const bindingRows = (bindings || []).map(b => {
    const displayName = b.displayName || b.provider;
    const activeHtml = b.active
      ? ' <span class="provider-active" title="active provider">●</span>'
      : '';
    // Inactive bindings get a "make active" switch (LIN-717); the active row keeps
    // only the ● marker. This is the affordance that makes a coexisting binding
    // (e.g. GitHub added onto a Linear workspace) reachable in every view.
    const activateHtml = b.active ? '' : `
            <form action="${switchAction}" method="POST" class="settings-form provider-form">
              <input type="hidden" name="provider" value="${escapeHtml(b.provider)}">
              <input type="hidden" name="scope" value="${escapeHtml(b.scope)}">
              <button type="submit" class="action-btn" data-testid="settings-provider-activate">make active</button>
            </form>`;
    return `
        <div class="node">
          <div class="line provider-binding" data-testid="settings-provider-binding" data-provider="${escapeHtml(b.provider)}" data-scope="${escapeHtml(b.scope)}">
            <span class="field-label">${escapeHtml(displayName)}:</span>
            <span class="field-value provider-scope">${escapeHtml(b.scope)}</span>
            <span class="provider-token">${escapeHtml(maskToken(b.token, b.provider))}</span>${activeHtml}${activateHtml}
            <form action="${refreshAction}" method="POST" class="settings-form provider-form">
              <input type="hidden" name="provider" value="${escapeHtml(b.provider)}">
              <input type="hidden" name="scope" value="${escapeHtml(b.scope)}">
              <button type="submit" class="action-btn" data-testid="settings-provider-refresh">refresh / test</button>
            </form>
            <form action="${removeAction}" method="POST" class="settings-form provider-form">
              <input type="hidden" name="provider" value="${escapeHtml(b.provider)}">
              <input type="hidden" name="scope" value="${escapeHtml(b.scope)}">
              <button type="submit" class="action-btn provider-remove-btn" data-testid="settings-provider-remove">remove</button>
            </form>
          </div>
        </div>`;
  }).join('');

  const emptyHtml = (bindings || []).length ? '' : `
        <div class="node">
          <div class="line">
            <span class="field-value">no provider bindings</span>
          </div>
        </div>`;

  const addRows = KNOWN_ADD_PROVIDERS.map(p => {
    // GitHub Issues + Projects share one App and one OAuth client id, so a SINGLE
    // `githubEnabled` flag gates BOTH rows (LIN-761 root cause C). When the server
    // isn't fully configured, render the add as honestly disabled — mirroring the
    // landing-hero gate — so the affordance never promises an add /auth/github
    // can't fulfil. A ticket-`blockedBy` block (e.g. Linear/LIN-544) still takes
    // precedence and keeps its own reason.
    const isGitHub = p.name === 'github' || p.name === 'github-projects';
    const configBlocked = isGitHub && !githubEnabled;
    if (p.blockedBy || configBlocked) {
      const reason = p.blockedBy
        ? `not available yet — blocked on ${escapeHtml(p.blockedBy)}`
        : 'not available — GitHub is not configured on this server';
      return `
        <div class="node">
          <div class="line provider-add-blocked" data-testid="settings-provider-add-${escapeHtml(p.name)}" data-provider="${escapeHtml(p.name)}">
            <span class="field-label">+ ${escapeHtml(p.displayName)}:</span>
            <span class="field-value provider-blocked">${reason}</span>
          </div>
        </div>`;
    }
    return `
        <div class="node">
          <div class="line provider-add" data-testid="settings-provider-add-${escapeHtml(p.name)}" data-provider="${escapeHtml(p.name)}">
            <span class="field-label">+ ${escapeHtml(p.displayName)}:</span>
            <form action="${addAction}" method="POST" class="settings-form provider-form">
              <input type="hidden" name="provider" value="${escapeHtml(p.name)}">
              <button type="submit" class="action-btn provider-add-btn" data-testid="settings-provider-add-btn">add</button>
            </form>
          </div>
        </div>`;
  }).join('');

  return `<p class="settings-subtitle">Connected sources for this workspace</p>
      <div class="tree">${noticeHtml}${bindingRows}${emptyHtml}
        <div class="node">
          <div class="line">
            <span class="field-label">add source:</span>
          </div>
          <div class="children">${addRows}
          </div>
        </div>
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
 * @property {boolean} [githubEnabled] - Whether GitHub is fully configured on this
 *   server (LIN-761); gates the GitHub add affordance. Defaults to true.
 * @property {Array<{id: string, name: string}>} [dispatchModelCatalog] - Live
 *   OpenRouter model catalog (LIN-1111 Session 2, lib/openrouter-catalog.js),
 *   resolved by the caller and merged into the dispatch-defaults model
 *   datalist alongside DISPATCH_MODEL_SUGGESTIONS. Defaults to `[]` so a
 *   caller that hasn't fetched it yet (or a degraded/empty catalog) renders
 *   the static suggestion list unchanged.
 */

/**
 * Renders the settings page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {SettingsPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderSettingsPage(workspaceName = 'Workspace', options = {}) {
  const { openRouterSource = null, deployInfo = {}, currentModel = '', availableModels = [], modelError = null, urlKey = null, workspaces = [], featureFlags = FEATURE_DEFAULTS, workspaceFeatures = WORKSPACE_FEATURE_DEFAULTS, llmStats = null, providerBindings = [], providerNotice = null, githubEnabled = true, dispatchDefaults = {}, dispatchDefaultsError = null, dispatchModelCatalog = [] } = options

  // Generate workspace-aware URLs
  const modelFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/model`
  const featureFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/features`
  const workspaceFeatureFormAction = `/workspace/${encodeURIComponent(urlKey)}/settings/workspace-features`

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
              <span class="field-label">connection:</span>
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
              <span class="field-label">connection:</span>
              <span class="settings-value env">● env key</span>
            </div>
          </div>`;
  } else if (openRouterSource === 'free') {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="field-label">connection:</span>
              <span class="settings-value free-tier" data-free-tier-status>● free tier</span>
              <a href="/auth/openrouter" class="action-btn connect">connect for unlimited</a>
            </div>
            <div class="children">
              <div class="node">
                <div class="line">
                  <span class="field-label">usage:</span>
                  <span class="field-value" data-free-tier-usage>Loading...</span>
                </div>
              </div>
            </div>
          </div>`;
  } else {
    connectionNodeHtml = `
          <div class="node">
            <div class="line">
              <span class="field-label">connection:</span>
              <span class="settings-value disconnected">○ not connected</span>
              <a href="/auth/openrouter" class="action-btn connect">connect</a>
            </div>
          </div>`;
  }

  // --- Model selector node (unified form) ---
  const isCustomModel = currentModel && !availableModels.some(m => m.id === currentModel);
  // Pricing (LIN-993) rides as a data-attribute, NOT option text — native <option>
  // is unstyleable and the hint line is the intended host. The inline updater below
  // copies the selected option's data-pricing into the hint.
  const modelOptionsHtml = availableModels.map(m => {
    const selected = m.id === currentModel ? ' selected' : '';
    const pricing = formatModelPricing(m);
    const priceAttr = pricing ? ` data-pricing="${escapeHtml(pricing)}"` : '';
    return `<option value="${escapeHtml(m.id)}"${selected}${priceAttr}>${escapeHtml(m.name)}</option>`;
  }).join('\n                  ');
  const currentPricing = formatModelPricing(availableModels.find(m => m.id === currentModel));

  const modelErrorHtml = modelError ? `
              <div class="node">
                <div class="line">
                  <span class="field-label">error:</span>
                  <span class="settings-value error">${escapeHtml(getModelErrorMessage(modelError))}</span>
                </div>
              </div>` : '';

  const modelNodeHtml = `
          <div class="node">
            <div class="line model-selector">
              <span class="field-label">Workspace AI Model:</span>
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
            <div class="model-workspace-note">This model is used for all LLM calls in this workspace, including agent/proxy traffic.</div>
            <div class="children">
              <div class="node">
                <div class="line model-current">
                  <span class="field-label">current:</span>
                  <span class="field-value model-id">${escapeHtml(currentModel)}</span>
                </div>
              </div>
              <div class="node">
                <div class="line model-pricing">
                  <span class="field-label">pricing:</span>
                  <span class="field-value model-price" data-model-price>${escapeHtml(currentPricing || '— (unknown / custom model)')}</span>
                </div>
              </div>${modelErrorHtml}
            </div>
          </div>
          <script>(function(){
            var sel = document.querySelector('.model-select');
            var out = document.querySelector('[data-model-price]');
            if (!sel || !out) return;
            sel.addEventListener('change', function(){
              var opt = sel.options[sel.selectedIndex];
              out.textContent = (opt && opt.getAttribute('data-pricing')) || '— (unknown / custom model)';
            });
          })();</script>`;

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
    if (key === 'feedbackWidget') {
      // Triage dispatch is an opt-in adjunct to the widget — nest it (LIN-733).
      const isOn = featureFlags.feedbackWidget ?? false;
      const subTogglesHtml = FEEDBACK_SUB_FEATURES.map(subKey =>
        renderFeatureToggle(subKey, featureFlags, featureFormAction)
      ).join('');
      const childrenHtml = `
            <div class="children feedback-widget-options"${!isOn ? ' hidden' : ''}>
              ${subTogglesHtml}
            </div>`;
      return renderFeatureToggle(key, featureFlags, featureFormAction, { childrenHtml });
    }
    return renderFeatureToggle(key, featureFlags, featureFormAction);
  }).join('');

  // --- Workspace feature toggles (workspace-scoped, separate from per-user) ---
  const workspaceTogglesHtml = WORKSPACE_FEATURE_KEYS.map(key =>
    renderWorkspaceFeatureToggle(key, workspaceFeatures, workspaceFeatureFormAction)
  ).join('');

  // --- Experimental feature toggles (per-user; this is the only surface) ---
  // When Collective is on, expose its page link here — the feature is found
  // "only via a link in Settings" (LIN-450).
  const collectiveOn = featureFlags.collective ?? FEATURE_DEFAULTS.collective;
  const collectiveLinkHtml = collectiveOn
    ? `
            <div class="node">
              <div class="line">
                <span class="field-label">collective:</span>
                <a href="/workspace/${encodeURIComponent(urlKey)}/collective" class="settings-action">open the discussion page</a>
              </div>
            </div>`
    : '';
  // When Task chat is on, expose its page link here too (same Settings-only
  // discovery pattern as Collective).
  const taskChatOn = featureFlags.taskChat ?? FEATURE_DEFAULTS.taskChat;
  const taskChatLinkHtml = taskChatOn
    ? `
            <div class="node">
              <div class="line">
                <span class="field-label">taskChat:</span>
                <a href="/workspace/${encodeURIComponent(urlKey)}/task-chat" class="settings-action">open the task chat page</a>
              </div>
            </div>`
    : '';
  // When Ship is on, expose its page link here too. Ship is a key experimental
  // view (radial dependency layout) still in active development, surfaced via the
  // same Settings-only discovery pattern as Collective/Task chat (LIN-496).
  const shipOn = featureFlags.ship ?? FEATURE_DEFAULTS.ship;
  const shipLinkHtml = shipOn
    ? `
            <div class="node">
              <div class="line">
                <span class="field-label">ship:</span>
                <a href="/workspace/${encodeURIComponent(urlKey)}/ship" class="settings-action">open the radial view</a>
              </div>
            </div>`
    : '';
  // When Suggested next run is on, expose its page link here too (same
  // Settings-only discovery pattern as Collective/Task chat/Ship; LIN-603).
  const nextRunOn = featureFlags.nextRun ?? FEATURE_DEFAULTS.nextRun;
  const nextRunLinkHtml = nextRunOn
    ? `
            <div class="node">
              <div class="line">
                <span class="field-label">nextRun:</span>
                <a href="/workspace/${encodeURIComponent(urlKey)}/next-run" class="settings-action">open the next-run suggester</a>
              </div>
            </div>`
    : '';
  // When Flight companion is on, expose its page link here too (same Settings-only
  // discovery pattern as Collective/Task chat/Ship/Next run; LIN-922).
  const flightCompanionOn = featureFlags.flightCompanion ?? FEATURE_DEFAULTS.flightCompanion;
  const flightCompanionLinkHtml = flightCompanionOn
    ? `
            <div class="node">
              <div class="line">
                <span class="field-label">flightCompanion:</span>
                <a href="/workspace/${encodeURIComponent(urlKey)}/flight-companion" class="settings-action">open the flight companion</a>
              </div>
            </div>`
    : '';
  // NOTE: the experimental autopilot dashboard was promoted to the first-class
  // Observation page (LIN-595) — it no longer has a flag or a Settings-only
  // discovery link; it is a footer link for everyone.
  const experimentalTogglesHtml = EXPERIMENTAL_FEATURES.map(key =>
    renderFeatureToggle(key, featureFlags, featureFormAction)
  ).join('') + collectiveLinkHtml + taskChatLinkHtml + shipLinkHtml + nextRunLinkHtml + flightCompanionLinkHtml;

  // --- AI usage KPI section (LIN-418) ---
  const llmStatsSectionHtml = renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-ai-usage"', titleClass: 'section-header settings-header', title: 'AI usage', body: `<p class="settings-subtitle">Recorded LLM calls for this workspace (last 30 days)</p>
      ${renderLlmStats(llmStats || {})}` });

  // --- Dispatch defaults section (LIN-1095): sibling of, never nested inside,
  // the AI section above — separately labeled since it configures the
  // dispatch execution model/harness, not the prompt-generation model.
  const dispatchDefaultsSectionHtml = renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-dispatch-defaults"', titleClass: 'section-header settings-header', title: 'Dispatch defaults', body: renderDispatchDefaultsSection(dispatchDefaults, urlKey, dispatchDefaultsError, dispatchModelCatalog) });

  // --- Account section ---
  const auditUrl = `/workspace/${encodeURIComponent(urlKey)}/audit`;
  const promptsUrl = `/workspace/${encodeURIComponent(urlKey)}/prompts`;
  const customPromptsUrl = `/workspace/${encodeURIComponent(urlKey)}/prompts/custom`;
  // --- Providers management section (LIN-634) ---
  const providersSectionHtml = renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-providers"', titleClass: 'section-header settings-header', title: 'Providers', body: renderProvidersSection(providerBindings, urlKey, providerNotice, githubEnabled) });

  const accountSectionHtml = renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-account"', titleClass: 'section-header settings-header', title: 'Account', body: `<div class="tree">
        <div class="node">
          <div class="line">
            <span class="field-label">prompts:</span>
            <a href="${promptsUrl}" class="settings-action">catalog</a>
            · <a href="${customPromptsUrl}" class="settings-action">custom prompts</a>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="field-label">audit:</span>
            <a href="${auditUrl}" class="settings-action">operator dashboard</a>
          </div>
        </div>
        <div class="node">
          <div class="line">
            <span class="field-label">session:</span>
            ${workspaces?.some(w => w.isPAT)
              ? '<a href="/logout" class="action-btn logout" data-testid="settings-logout">refresh session</a> <span class="feature-desc">PAT mode \u2014 session restores automatically</span>'
              : '<a href="/logout" class="action-btn logout" data-testid="settings-logout">logout</a>'}
          </div>
        </div>
      </div>` });

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Settings`,
    stylesheets: ['/style.css', '/common-actions.css', '/settings.css'],
    nav: navBarHtml,
    scripts: ['/common.js', '/app.js'],
    content: `${renderPageHeader({ title: 'Settings', subtitle: 'Configure AI, features, and connections' })}

  <main>
    ${renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-ai"', titleClass: 'section-header settings-header', title: 'AI', body: `<div class="tree">
        ${connectionNodeHtml}
        ${modelNodeHtml}
        ${aiTogglesHtml}
      </div>` })}

    ${dispatchDefaultsSectionHtml}

    ${llmStatsSectionHtml}

    ${renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-workflow"', titleClass: 'section-header settings-header', title: 'Workflow', body: `<div class="tree">
        ${workflowTogglesHtml}
      </div>` })}

    ${renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-workspace-features"', titleClass: 'section-header settings-header', title: 'Workspace features', body: `<p class="settings-subtitle">Workspace-scoped — applies to every user of this workspace</p>
      <div class="tree">
        ${workspaceTogglesHtml}
      </div>` })}

    ${renderSection({ boxed: true, className: 'settings-section', attrs: 'data-testid="settings-section-experimental"', titleClass: 'section-header settings-header', title: 'Experimental', body: `<p class="settings-subtitle">Rough-draft features — may change or disappear</p>
      <div class="tree">
        ${experimentalTogglesHtml}
      </div>` })}
    ${providersSectionHtml}
    ${accountSectionHtml}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->`
  });
}
