/**
 * Settings Page Renderer
 *
 * Generates HTML for /settings, one page per area (LIN-3846). The sidebar,
 * the row pieces are lib/components/settings-row.js and the page frame is lib/components/settings-frame.js; the
 * area table is lib/settings-areas.js; Account and Features are
 * lib/render-settings-you.js; Running, Agent access and Change log are
 * lib/render-settings-workspace.js. This file keeps the areas built from the
 * older tree/node markup: Sources (providers), Models (the four legacy model
 * forms, unchanged until LIN-3855) and Health (AI usage).
 *
 * Shape: `renderSettingsPage` reads its options once and renders the one area
 * asked for (`area`), or the index. The rows that repeat are built once:
 * `dispatchRow` (workspace default, per-kind and preset rows),
 * `kvNode`/`errorNode` (label + value lines), `providerForm` (the
 * POST→redirect provider actions).
 *
 * Whitespace between block tags is not significant; whitespace between
 * inline elements is, and is kept.
 */

import { escapeHtml } from './utils/html.js';
import { formatModelPricing } from './openrouter.js';
import { buildModelOptions, isFreeModel } from './openrouter-catalog.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { FEATURE_DEFAULTS, WORKSPACE_FEATURE_DEFAULTS } from './feature-defaults.js';
import { getArea, DEFAULT_AREA_ID } from './settings-areas.js';
import { renderSettingsShell } from './components/settings-frame.js';
import { group } from './components/settings-group.js';
import { askInPlace } from './components/settings-ask.js';
import { drillRow } from './components/settings-row.js';
import { accountBody, featuresBody, OPENROUTER_CONSENT_BLAST_RADIUS_COPY } from './render-settings-you.js';
import { runningBody, agentAccessBody, changeLogBody } from './render-settings-workspace.js';
import { DISPATCH_DEFAULT_KINDS } from './prompt-templates.js';
import { AI_OPERATION_KINDS } from './workspace-preferences.js';
import { getAllProviders } from './providers/index.js';

/**
 * The model-pricing listener's inline script body. Exported so the app CSP can
 * pin its hash (LIN-3420); the markup interpolates this constant so the hashed
 * bytes and the rendered bytes cannot drift.
 */
export const MODEL_PRICING_SCRIPT_BODY = `(function(){
            var sel = document.querySelector('.model-select');
            var out = document.querySelector('[data-model-price]');
            if (!sel || !out) return;
            sel.addEventListener('change', function(){
              var opt = sel.options[sel.selectedIndex];
              out.textContent = (opt && opt.getAttribute('data-pricing')) || '— (unknown / custom model)';
            });
          })();`;
// LIN-3125 Phase 3 (F1): the opt-in held-entry marker for the explicit
// "as a new workspace" verb only — never for the bare "bind" affordances.
import { withHeldMarker } from './held-connection-entry.js';

// The consent blast-radius copy lives in render-settings-you.js (LIN-3846); re-exported so
// the GET /auth/openrouter consent interstitial (lib/render-pages.js) and its pins keep their import.
export { OPENROUTER_CONSENT_BLAST_RADIUS_COPY };

/** Friendly labels for the AI_OPERATION_KINDS rendered in the per-operation override rows — one entry per kind, pinned by the AI_OPERATION_KINDS.every(k => k in AI_OPERATION_LABELS) test. */
export const AI_OPERATION_LABELS = {
  'recommend': 'Recommend',
  'recap': 'Recap',
  'brief': 'Brief',
  'scan': 'Scan',
  'run-summary': 'Run summary',
  'session-summary': 'Session summary',
  'flight-companion': 'Flight Companion',
  'ship-biscuit': 'Ship Biscuit',
  'task-chat': 'Task Chat'
};

/**
 * Honest default for a provider's "add a source" row when it declares no
 * `addHint` of its own (LIN-2803). Applied at THIS read site, not as a
 * base-getter default on `interface.js` — every provider's `addProvider`
 * getter returns a fresh object literal, so a base-class default would
 * silently not be inherited. Linear keeps its own override text (its add
 * creates a separate workspace, not the default bind).
 */
const DEFAULT_ADD_HINT = 'adds a source onto this workspace';

/** UI-only suggestion list for the dispatch-defaults harness select (LIN-1095). Not a registry — harness stays an opaque string everywhere (LIN-1084/LIN-438). */
const DISPATCH_HARNESS_SUGGESTIONS = ['claude-code', 'opencode'];

/**
 * UI-only default (LIN-1111) for the *workspace-wide* dispatch-defaults
 * harness select — pre-selects this when no harness is configured yet.
 * Deliberately NOT applied to the per-kind or preset rows: blank there is the
 * meaningful "inherit" / "not set by this preset" state, and the forms
 * re-derive their trees from whatever every row shows on submit
 * (`server.js` `/settings/dispatch-defaults`) — pre-selecting would silently
 * turn every inherited row into an explicit `claude-code` override the next
 * time anyone saves.
 */
const DEFAULT_HARNESS = 'claude-code';

/**
 * Recommended-models list for the dispatch-EXECUTION model selects (LIN-1111) —
 * deliberately separate from `AVAILABLE_MODELS` (openrouter.js), which feeds
 * the unrelated "Workspace AI Model" selector (the model that WRITES prompts,
 * not the one a dispatched agent executes with). Merged with the live/mock
 * catalog through `buildModelOptions` (LIN-2719).
 */
const DISPATCH_MODEL_SUGGESTIONS = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol'
];

/**
 * Claude Code's model presets (LIN-1282, `fable` added LIN-1763). Claude Code
 * only offers these `--model` aliases, so they stay stable across model
 * generations. The per-row option set swaps between this list and the OpenCode
 * one when the harness changes, client-side (`syncHarnessModelList`,
 * public/common.js).
 *
 * CROSS-REPO (LIN-1694 review, N1): adding a preset here is only half the change.
 * Simple Dispatcher refuses at launch any model its own `CLAUDE_MAPPABLE_MODEL_FAMILIES`
 * (`executors.js`) does not recognise, so a preset offered here and not mirrored there
 * becomes a terminal `[failed]` for anyone who picks it — which is exactly how `fable`
 * shipped broken. Nothing automated catches this; the two lists are hand-mirrored across
 * repositories. Update both, or the select is offering a model that cannot run. (The
 * `other…` escape hatch, LIN-2719, covers models outside this curated four.)
 */
const DISPATCH_CLAUDE_MODEL_SUGGESTIONS = ['haiku', 'sonnet', 'opus', 'fable'];

/**
 * Sentinel `<option>` value for the model select's free-text escape hatch
 * (LIN-2719, HARD RULE 3): Simple Dispatcher's `CLAUDE_MAPPABLE_MODEL_FAMILIES`
 * accepts strictly more than the curated presets, so an "other…" option is a
 * correctness requirement. Mirrored in public/common.js
 * (`DISPATCH_MODEL_OTHER_VALUE`) — the two runtimes can't share a module, so
 * the literal string is the contract.
 */
const DISPATCH_MODEL_OTHER_VALUE = '__other__';

const MODEL_ERRORS = {
  'empty': 'Please enter a model ID',
  'too-long': 'Model ID must be 100 characters or less',
  'invalid-format': 'Invalid format. Use provider/model (e.g., anthropic/claude-sonnet-4)'
};

const AI_OVERRIDE_ERRORS = {
  'invalid-format': 'Invalid model format. Use provider/model (e.g. anthropic/claude-sonnet-4).',
  'too-long': 'Model ID is too long (max 100 characters).'
};

const DISPATCH_DEFAULTS_ERRORS = {
  'invalid-field': 'One or more model/harness values are invalid (must be plain text, 1000 characters or less, no control characters).'
};

/** The message for a validation error code from a redirect, or `fallback` for an unknown one. */
function errorText(table, code, fallback) {
  return table[code] || fallback;
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** `/workspace/<urlKey><suffix>`; `urlKey` goes through encodeURIComponent only (a null urlKey renders "null", as it always has). */
function workspaceUrl(urlKey, suffix) {
  return `/workspace/${encodeURIComponent(urlKey)}${suffix}`;
}

/** A value `<span>`; `html` is already escaped. */
function field(html, className = 'field-value', attrs = '') {
  return `<span class="${className}"${attrs}>${html}</span>`;
}

/** `label: value` line as a tree node. `labelHtml` is escaped by the caller; `valueHtml` is a complete element. */
function kvNode(labelHtml, valueHtml) {
  return `
        <div class="node">
          <div class="line field">
            <span class="field-label">${labelHtml}</span>
            ${valueHtml}
          </div>
        </div>`;
}

function errorNode(message) {
  return kvNode('error:', field(escapeHtml(message), 'settings-value error'));
}

/** A hidden-input POST form used by every provider action (full POST→redirect, not the XHR toggle flow, so no `feature-form` class). */
function providerForm(action, fields, buttonHtml) {
  const inputs = fields
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('\n              ');
  return `
            <form action="${action}" method="POST" class="settings-form provider-form">
              ${inputs}
              ${buttonHtml}
            </form>`;
}

/**
 * Mask a binding's credential token for display (LIN-634). For `local` the
 * "token" IS the urlKey store-partition key — not a secret — so it is
 * labelled rather than masked. Otherwise show only the last 4 chars.
 */
function maskToken(token, provider) {
  if (provider === 'local') return '(partition key)';
  if (!token) return '(none)';
  return `••••${String(token).slice(-4)}`;
}

/** Format a USD cost: per-call amounts keep 4 decimals, larger totals 2. */
function formatCost(cost) {
  const n = typeof cost === 'number' && Number.isFinite(cost) ? cost : 0;
  return `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;
}

/** The Workspace AI Model selector, with its pricing hint and the inline updater that copies the selected option's pricing into it. */
function workspaceModelNode({ currentModel, availableModels, modelError, urlKey }) {
  const isCustomModel = currentModel && !availableModels.some(m => m.id === currentModel);
  // Pricing (LIN-993) rides as a data-attribute, NOT option text — native <option>
  // is unstyleable and the hint line is the intended host.
  const optionsHtml = availableModels.map(m => {
    const pricing = formatModelPricing(m);
    const priceAttr = pricing ? ` data-pricing="${escapeHtml(pricing)}"` : '';
    return `<option value="${escapeHtml(m.id)}"${m.id === currentModel ? ' selected' : ''}${priceAttr}>${escapeHtml(m.name)}</option>`;
  }).join('\n                  ');
  const currentPricing = formatModelPricing(availableModels.find(m => m.id === currentModel));
  const errorHtml = modelError ? errorNode(errorText(MODEL_ERRORS, modelError, 'Invalid model ID')) : '';

  return `
          <div class="node">
            <div class="line field model-selector">
              <span class="field-label">Workspace AI Model:</span>
              <form action="${workspaceUrl(urlKey, '/settings/model')}" method="POST" class="settings-form model-form">
                <select name="modelId" class="model-select">
                  ${optionsHtml}
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
                <div class="line field model-current">
                  <span class="field-label">current:</span>
                  <span class="field-value model-id">${escapeHtml(currentModel)}</span>
                </div>
              </div>
              <div class="node">
                <div class="line field model-pricing">
                  <span class="field-label">pricing:</span>
                  <span class="field-value model-price" data-model-price>${escapeHtml(currentPricing || '— (unknown / custom model)')}</span>
                </div>
              </div>${errorHtml}
            </div>
          </div>
          <script>${MODEL_PRICING_SCRIPT_BODY}</script>`;
}

/**
 * A collapsible per-kind override block (a `<details>` inside a node).
 * Raw `detailsTestid`/`summaryTestid` are interpolated unescaped: they are
 * built from constants, or from a preset id the server minted.
 */
function overridesNode({ detailsClass, summaryClass, detailsTestid, summaryTestid, count, open, rowsHtml }) {
  const detailsTestidAttr = detailsTestid ? ` data-testid="${detailsTestid}"` : '';
  return `
          <div class="node">
            <details class="${detailsClass}"${open ? ' open' : ''}${detailsTestidAttr}>
              <summary class="${summaryClass}" data-testid="${summaryTestid}">Per-${count.noun} overrides (${count.n})</summary>
              <div class="children">${rowsHtml}
              </div>
            </details>
          </div>`;
}

function aiOverrideRow({ kind, model, availableModels }) {
  const name = `byKind__${kind}__model`;
  const isCustomModel = model && !availableModels.some(m => m.id === model);
  const optionsHtml = availableModels.map(m =>
    `<option value="${escapeHtml(m.id)}"${m.id === model ? ' selected' : ''}>${escapeHtml(m.name)}</option>`
  ).join('\n                      ');
  return `
          <div class="node">
            <div class="line field ai-override-row" data-testid="ai-override-row-${escapeHtml(kind)}">
              <span class="field-label">${escapeHtml(AI_OPERATION_LABELS[kind] || kind)}:</span>
              <select name="${escapeHtml(name)}" class="ai-override-select">
                <option value="">— inherit</option>
                ${optionsHtml}
              </select>
              <span class="model-or">or</span>
              <input type="text" name="${escapeHtml(name)}Custom" class="ai-override-input" maxlength="100" placeholder="custom model id" value="${isCustomModel ? escapeHtml(model) : ''}">
            </div>
          </div>`;
}

/**
 * Per-operation AI model overrides (LIN-1145): one row per AI_OPERATION_KIND
 * beneath the workspace model, submitted through a single form.
 */
function aiOverridesBody({ aiModelOverrides, urlKey, errorCode, availableModels }) {
  const byKind = aiModelOverrides.byKind || {};
  const modelOf = kind => byKind[kind]?.model || '';
  const errorHtml = errorCode ? errorNode(errorText(AI_OVERRIDE_ERRORS, errorCode, 'Invalid input.')) : '';
  const rowsHtml = AI_OPERATION_KINDS
    .map(kind => aiOverrideRow({ kind, model: modelOf(kind), availableModels }))
    .join('');

  return `<p class="page-header__subtitle">Per-operation model overrides — leave blank to inherit the workspace default above.</p>
      <form action="${workspaceUrl(urlKey, '/settings/ai-model-overrides')}" method="POST" class="settings-form ai-overrides-form">
      <div class="tree">${errorHtml}${overridesNode({
        detailsClass: 'ai-kind-overrides',
        summaryClass: 'ai-kind-overrides-summary',
        detailsTestid: 'ai-kind-overrides',
        summaryTestid: 'ai-kind-overrides-toggle',
        count: { noun: 'operation', n: AI_OPERATION_KINDS.length },
        open: AI_OPERATION_KINDS.some(modelOf),
        rowsHtml
      })}
      </div>
      <div class="ai-overrides-submit">
        <button type="submit" class="action-btn save">save model overrides</button>
      </div>
      </form>`;
}

// ---------------------------------------------------------------------------
// Dispatch defaults and presets
// ---------------------------------------------------------------------------

/** `{ model, harness, effort }` of a stored config, blank when unset (blank = inherit). */
function rowValues(config) {
  return { model: config.model || '', harness: config.harness || '', effort: config.effort || '' };
}

/**
 * The model `<select>`'s option set for a harness: curated ids for that
 * harness plus — OpenCode only, never Claude Code — the live/mock catalog,
 * merged and free-marked via the one shared builder (LIN-2719 S0).
 */
function modelOptionSet(effectiveHarness, modelCatalog) {
  return effectiveHarness === 'claude-code'
    ? buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] })
    : buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog: modelCatalog });
}

/**
 * The harness select, shared by every dispatch row. A stored value outside the
 * two suggestions (a legacy custom harness) can't be represented, so it renders
 * as the blank "—" (inherit) option; it is only reset if the user re-saves.
 */
function harnessSelect(namePrefix, harness, preselectDefault) {
  const selectedValue = harness || (preselectDefault ? DEFAULT_HARNESS : '');
  const optionsHtml = DISPATCH_HARNESS_SUGGESTIONS.map(h =>
    `<option value="${escapeHtml(h)}"${h === selectedValue ? ' selected' : ''}>${escapeHtml(h)}</option>`
  ).join('\n                  ');
  return `<select name="${escapeHtml(namePrefix)}HarnessSelect" class="harness-select">
                  <option value=""${selectedValue ? '' : ' selected'}>&mdash;</option>
                  ${optionsHtml}
                </select>`;
}

/**
 * One dispatch row: label, harness select, model `<select>` with an `other…`
 * free-text escape hatch (LIN-2719), and a free-text effort input (LIN-2616).
 * Serves the workspace default, every per-kind override and every preset row.
 *
 * HARD RULE 1 (LIN-2719): the model select's blank first option is ALWAYS the
 * selected one when `model` is unset — never pre-selected to a real value,
 * since blank means "inherit" and the forms re-derive their whole tree on
 * save. Its label re-expresses that: "— none —" on the one row with nothing to
 * inherit from (the workspace default, `preselectDefault`), else "— inherit —".
 * A stored model outside the harness's option set degrades onto `other…`
 * (HARD RULES 2/3) with the stored id in the paired text input, so a
 * round-trip save still posts the original id. Effort is never pre-selected.
 */
function dispatchRow({ label, namePrefix, testid, values = rowValues({}), preselectDefault = false, modelCatalog }) {
  const { model, harness, effort } = values;
  // Harness-aware (LIN-1282); the client rebuilds the option set when the harness changes.
  const optionSet = modelOptionSet(harness || (preselectDefault ? DEFAULT_HARNESS : ''), modelCatalog);
  const isKnownModel = model && optionSet.some(opt => opt.id === model);
  const selectValue = !model ? '' : (isKnownModel ? model : DISPATCH_MODEL_OTHER_VALUE);
  const isOther = selectValue === DISPATCH_MODEL_OTHER_VALUE;
  const optionsHtml = optionSet.map(opt =>
    `<option value="${escapeHtml(opt.id)}"${opt.id === selectValue ? ' selected' : ''}${opt.free ? ' data-free="true"' : ''}>${escapeHtml(opt.label)}</option>`
  ).join('\n                  ');
  return `
          <div class="node">
            <div class="line field dispatch-default-row" data-testid="${escapeHtml(testid)}">
              <span class="field-label">${escapeHtml(label)}:</span>
              ${harnessSelect(namePrefix, harness, preselectDefault)}
              <select name="${escapeHtml(namePrefix)}Model" class="dispatch-model-input" aria-label="Model">
                <option value=""${selectValue === '' ? ' selected' : ''}>${preselectDefault ? '— none —' : '— inherit —'}</option>
                ${optionsHtml}
                <option value="${DISPATCH_MODEL_OTHER_VALUE}"${isOther ? ' selected' : ''}>other&hellip;</option>
              </select>
              <input type="text" class="dispatch-model-input-other${isOther ? '' : ' hidden'}" maxlength="200" placeholder="custom model id" aria-label="Custom model id" value="${escapeHtml(model && !isKnownModel ? model : '')}">
              <span class="dispatch-model-hint" data-model-hint></span>
              <input type="text" name="${escapeHtml(namePrefix)}Effort" class="dispatch-effort-input" maxlength="200" placeholder="effort (blank = inherit)" value="${escapeHtml(effort)}">
            </div>
          </div>`;
}

/**
 * One row per DISPATCH_DEFAULT_KINDS key (the step-kinds plus `autopilot`,
 * LIN-1278), shared by the Dispatch-defaults section and by every preset.
 * `namePrefixOf`/`testidOf` namespace the fields; `open` reports whether any
 * kind already has an override, so an existing override is never hidden.
 */
function kindRows({ byKind, namePrefixOf, testidOf, modelCatalog }) {
  const valuesOf = kind => rowValues(byKind[kind] || {});
  const rowsHtml = DISPATCH_DEFAULT_KINDS.map(kind => dispatchRow({
    label: kind,
    namePrefix: namePrefixOf(kind),
    testid: testidOf(kind),
    values: valuesOf(kind),
    modelCatalog
  })).join('');
  const open = DISPATCH_DEFAULT_KINDS.some(kind => {
    const { model, harness, effort } = valuesOf(kind);
    return model || harness || effort;
  });
  return { rowsHtml, open };
}

/**
 * The "Dispatch defaults" body (LIN-1095): a workspace-wide row plus the
 * per-kind override rows, one form to `.../settings/dispatch-defaults`. This
 * configures the model/harness dispatched agents EXECUTE with — distinct from
 * the "Workspace AI Model", which WRITES prompts.
 */
function dispatchDefaultsBody({ dispatchDefaults, urlKey, errorCode, modelCatalog }) {
  const errorHtml = errorCode ? errorNode(errorText(DISPATCH_DEFAULTS_ERRORS, errorCode, 'Invalid dispatch defaults')) : '';
  const defaultRowHtml = dispatchRow({
    label: 'Workspace default',
    namePrefix: 'default',
    testid: 'dispatch-default-row-default',
    values: rowValues(dispatchDefaults),
    preselectDefault: true,
    modelCatalog
  });
  // Progressive disclosure (LIN-1111): kept collapsed unless a kind is configured.
  const { rowsHtml, open } = kindRows({
    byKind: dispatchDefaults.byKind || {},
    namePrefixOf: kind => `kind__${kind}__`,
    testidOf: kind => `dispatch-default-row-${kind}`,
    modelCatalog
  });
  // Carried to the client (LIN-2719) as the SAME {id, name, free} wire shape
  // GET .../api/openrouter/models returns, so public/common.js's harness-switch
  // rebuild reuses one merge/de-dupe path. Without it, switching a row's
  // harness client-side would rebuild the OpenCode option set from an empty
  // catalog and silently drop every catalog entry rendered here.
  const catalogWire = escapeHtml(JSON.stringify(
    modelCatalog.map(m => ({ id: m.id, name: (typeof m.name === 'string' && m.name) || m.id, free: isFreeModel(m) }))
  ));

  return `<p class="page-header__subtitle">The model/harness dispatched agents execute <em>with</em> &mdash; distinct from the Workspace AI Model above, which is used to <em>write</em> prompts. Per-type rows override the workspace default; leave a row blank to inherit it.</p>
      <form action="${workspaceUrl(urlKey, '/settings/dispatch-defaults')}" method="POST" class="settings-form dispatch-defaults-form" data-model-catalog="${catalogWire}">
      <div class="tree">${errorHtml}
        ${defaultRowHtml}${overridesNode({
          // No details testid: Dispatch defaults' <details> is located by class.
          detailsClass: 'dispatch-kind-overrides',
          summaryClass: 'dispatch-kind-overrides-summary',
          summaryTestid: 'dispatch-kind-overrides-toggle',
          count: { noun: 'type', n: DISPATCH_DEFAULT_KINDS.length },
          open,
          rowsHtml
        })}
      </div>
      <div class="dispatch-defaults-submit">
        <button type="submit" class="action-btn save">save dispatch defaults</button>
      </div>
      </form>`;
}

/**
 * A preset's per-kind block. Its `<details>` takes a class distinct from the
 * Dispatch-defaults one — a page-wide `details.dispatch-kind-overrides`
 * locator in dispatch-defaults.spec.js must resolve to exactly one element.
 * `namePrefixBase` is namespaced with `__kind__` so the client can tell a
 * per-kind field from the row's top-level field by name alone
 * (`readDispatchPresetRow`, public/settings.js).
 */
function presetKindOverrides({ namePrefixBase, testidBase, byKind = {}, modelCatalog }) {
  const { rowsHtml, open } = kindRows({
    byKind,
    namePrefixOf: kind => `${namePrefixBase}__kind__${kind}__`,
    testidOf: kind => `${testidBase}-kind-${kind}`,
    modelCatalog
  });
  return overridesNode({
    detailsClass: 'dispatch-preset-kind-overrides',
    summaryClass: 'dispatch-kind-overrides-summary',
    detailsTestid: `${testidBase}-kind-overrides`,
    summaryTestid: `${testidBase}-kind-overrides-toggle`,
    count: { noun: 'type', n: DISPATCH_DEFAULT_KINDS.length },
    open,
    rowsHtml
  });
}

/**
 * The top-level config row (wrapped in `.dispatch-preset-toplevel-config`,
 * which scopes the client's top-level read so it never picks up the first
 * per-kind row, LIN-1400) plus the per-kind block. `preselectDefault` stays
 * off: a preset's blank harness/model means "not set by this preset" (LIN-1111).
 */
function presetConfigBlock({ rowPrefix, kindPrefixBase, testidBase, config, modelCatalog }) {
  const configRowHtml = dispatchRow({
    label: 'config',
    namePrefix: rowPrefix,
    testid: testidBase,
    values: rowValues(config),
    modelCatalog
  });
  const kindsHtml = presetKindOverrides({
    namePrefixBase: kindPrefixBase,
    testidBase,
    byKind: config.byKind || {},
    modelCatalog
  });
  return `<div class="dispatch-preset-toplevel-config">${configRowHtml}</div>
              ${kindsHtml}`;
}

/**
 * One saved preset: editable name, config block, save/delete buttons. Mutation
 * is JSON (public/settings.js → PATCH/DELETE .../api/dispatch/presets/:id), so
 * the buttons are `type="button"`. The "use on Dispatch" link (LIN-2719 S3)
 * rides `?preset=<id>`, which the Dispatch picker reads on load.
 */
function presetRow(preset, modelCatalog, urlKey) {
  const { id, name, config = {} } = preset;
  const useLinkHtml = urlKey
    ? `<a href="${workspaceUrl(urlKey, `/dispatch?preset=${encodeURIComponent(id)}`)}" class="settings-action dispatch-preset-use-link" data-testid="dispatch-preset-use-${escapeHtml(id)}">use on Dispatch &rarr;</a>`
    : '';
  return `
          <div class="node dispatch-preset-item" data-testid="dispatch-preset-item-${escapeHtml(id)}" data-preset-id="${escapeHtml(id)}">
            <div class="line field dispatch-preset-name-line">
              <span class="field-label">name:</span>
              <input type="text" class="dispatch-preset-name-input" maxlength="50" value="${escapeHtml(name)}">
              <button type="button" class="action-btn save dispatch-preset-save-btn" data-preset-id="${escapeHtml(id)}">save</button>
              <button type="button" class="action-btn dispatch-preset-delete-btn" data-preset-id="${escapeHtml(id)}">delete</button>
              ${useLinkHtml}
            </div>
            <div class="children">
              ${presetConfigBlock({ rowPrefix: `preset__${id}__`, kindPrefixBase: `preset__${id}`, testidBase: `dispatch-preset-row-${id}`, config, modelCatalog })}
            </div>
          </div>`;
}

/**
 * The "Dispatch presets" body (LIN-1391 S7): named, workspace-scoped dispatch
 * configs listed beside "Dispatch defaults" — a preset is a SAVED, SELECTABLE
 * alternate config chosen at dispatch time (`presetId`), not another default
 * tier. CRUD is JSON via public/settings.js (the routes/collective.js preset
 * convention), not a fixed-shape form, since the list grows.
 */
function dispatchPresetsBody({ dispatchPresets, urlKey, modelCatalog }) {
  const listHtml = dispatchPresets.length
    ? dispatchPresets.map(preset => presetRow(preset, modelCatalog, urlKey)).join('')
    : `
          <div class="node">
            <div class="line field">
              <span class="settings-value dispatch-preset-empty" data-testid="dispatch-presets-empty">No saved presets yet</span>
            </div>
          </div>`;
  const newConfigHtml = presetConfigBlock({
    rowPrefix: 'newDispatchPreset',
    kindPrefixBase: 'newDispatchPreset',
    testidBase: 'dispatch-preset-new-row',
    config: {},
    modelCatalog
  });

  return `<p class="page-header__subtitle">Save a named model/harness combination to select at dispatch time. Presets are workspace-wide; editing or deleting one never changes an already-dispatched item.</p>
      <div class="tree" data-testid="dispatch-preset-list" data-url-key="${escapeHtml(urlKey)}">${listHtml}
      </div>
      <div class="tree dispatch-preset-create" data-testid="dispatch-preset-create-form" data-url-key="${escapeHtml(urlKey)}">
        <div class="node">
          <div class="line field dispatch-preset-name-line">
            <span class="field-label">new preset:</span>
            <input type="text" class="dispatch-preset-name-input" maxlength="50" placeholder="Preset name">
          </div>
          <div class="children">
            ${newConfigHtml}
          </div>
        </div>
      </div>
      <div class="dispatch-preset-create-submit">
        <button type="button" class="action-btn save dispatch-preset-create-btn">save preset</button>
      </div>`;
}

// ---------------------------------------------------------------------------
// AI usage
// ---------------------------------------------------------------------------

function callsText(n) {
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/**
 * The AI usage KPI tree (LIN-418): totals plus a per-feature breakdown from
 * the per-call LLM metadata log, or an empty-state node when nothing is
 * recorded. A non-empty `latencyByFeatureModel` (LIN-1988) adds a rollup plus
 * a caveat naming the metric honestly (end-to-end wall-clock, not
 * time-to-first-token, a weaker proxy on SSE lanes); absent or empty, the
 * block is omitted entirely.
 */
function llmStatsTree(stats) {
  if (!stats.totalCalls) {
    return `<div class="tree">${kvNode('calls:', field('none recorded yet'))}
      </div>`;
  }

  const featureRows = (stats.byFeature || []).map(f =>
    kvNode(`${escapeHtml(f.feature)}:`, field(`${callsText(f.calls)} · ${escapeHtml(formatCost(f.cost))}`))
  ).join('');
  const lastCallHtml = stats.lastCallAt ? kvNode('last call:', field(escapeHtml(stats.lastCallAt))) : '';

  const latencyRows = Array.isArray(stats.latencyByFeatureModel) ? stats.latencyByFeatureModel : [];
  const latencyHtml = latencyRows.length ? `
        <div class="node">
          <div class="line field">
            <span class="field-label">latency (feature × model):</span>
          </div>
          <div class="children">${latencyRows.map(row => kvNode(
            `${escapeHtml(row.feature)} · ${escapeHtml(row.model)}:`,
            field(`${callsText(row.count)} · p50 ${row.p50Ms}ms · p90 ${row.p90Ms}ms · max ${row.maxMs}ms`)
          )).join('')}
          </div>
        </div>
        <div class="node">
          <div class="line field">
            <span class="field-value">durationMs is whole-call wall-clock (end-to-end response time), not time-to-first-token — a weaker proxy on SSE lanes than on JSON+keepalive lanes.</span>
          </div>
        </div>` : '';

  return `<div class="tree">${kvNode('calls:', field(stats.totalCalls))}${kvNode('cost:', field(escapeHtml(formatCost(stats.totalCost))))}${kvNode('tokens:', field(escapeHtml((stats.totalTokens || 0).toLocaleString('en-US'))))}${lastCallHtml}
        <div class="node">
          <div class="line field">
            <span class="field-label">by feature:</span>
          </div>
          <div class="children">${featureRows}
          </div>
        </div>${latencyHtml}
      </div>`;
}

/**
 * Provider-context disclosure (LIN-2357): makes a null `providerUi` on a
 * recorded prompt trace visible as counts + a coverage basis, never as raw
 * trace content. Same idiom and empty-state convention as `llmStatsTree`.
 */
function providerContextTree(summary) {
  const basisHtml = summary.basis ? kvNode('basis:', field(escapeHtml(summary.basis), 'field-value field-muted')) : '';

  if (!summary.traces) {
    return `<div class="tree">${kvNode('provider context:', field('no prompt traces recorded yet'))}${basisHtml}
      </div>`;
  }

  const untraced = summary.untracedContext || 0;
  const countText = untraced
    ? `${untraced} of ${summary.traces} traces missing (${summary.divergent || 0} divergent, ${summary.benign || 0} benign)`
    : `0 of ${summary.traces} traces missing`;
  const recencyHtml = untraced && summary.newestUntracedContextAt
    ? kvNode('most recent:', field(escapeHtml(summary.newestUntracedContextAt)))
    : '';

  return `<div class="tree">${kvNode('provider context:', field(escapeHtml(countText)))}${recencyHtml}${basisHtml}
      </div>`;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Remove a source, asked in place (LIN-3846): the form exists only inside the
 * opened panel, and the panel says what will happen. Removing the LAST source
 * also revokes the remover's keys, queue tokens and share links, and the runner
 * key when they are the owner (server.js providers/remove,
 * lib/workspace-removal-revocation.js). The POST is unchanged.
 */
function removeSourcePanel(b, action, fields, isLast) {
  const name = b.displayName || b.provider;
  const text = isLast
    ? `Removing ${name} stops Harbour reading it for you. It is your last source, so this also revokes the keys, queue tokens and share links you made in this workspace, and the runner key if you are the workspace owner.`
    : `Removing ${name} stops Harbour reading it for you. Your other sources are not affected.`;
  return askInPlace({ summary: 'remove', willHappen: text, action, fields, confirmLabel: 'Remove source', tone: 'red', testid: 'settings-provider-remove' });
}

/** One connected binding: marker, make-active switch (LIN-717, inactive only), refresh, remove. */
function bindingRow(b, actions, { isLast = false } = {}) {
  const fields = [['provider', b.provider], ['scope', b.scope]];
  const activeHtml = b.active ? ' <span class="provider-active" data-testid="settings-provider-active" title="active provider">●</span>' : '';
  const activateHtml = b.active ? '' : providerForm(actions.switch, fields, '<button type="submit" class="action-btn" data-testid="settings-provider-activate">make active</button>');
  return `
        <div class="node">
          <div class="line field provider-binding" data-testid="settings-provider-binding" data-provider="${escapeHtml(b.provider)}" data-scope="${escapeHtml(b.scope)}">
            <span class="field-label">${escapeHtml(b.displayName || b.provider)}:</span>
            <span class="field-value provider-scope">${escapeHtml(b.scope)}</span>
            <span class="provider-token">${escapeHtml(maskToken(b.token, b.provider))}</span>${activeHtml}${activateHtml}${providerForm(actions.refresh, fields, '<button type="submit" class="action-btn" data-testid="settings-provider-refresh">refresh / test</button>')}${removeSourcePanel(b, actions.remove, fields, isLast)}
          </div>
        </div>`;
}

/** One "+ add source" row for a registry provider that declares `addProvider`. */
function addSourceRow(p, { addAction, githubEnabled, jiraOAuthEnabled }) {
  const name = escapeHtml(p.name);
  const labelHtml = `<span class="field-label">+ ${escapeHtml(p.ui.displayName)}:</span>`;
  // Row-level gate (LIN-2010 F1): a DECLARED configPredicate marks which rows
  // are gated at all (github and github-projects share one predicate), but the
  // configured-ness VALUE is the threaded `githubEnabled`, resolved once at the
  // composition root in server.js (`getProvider('github').entryCta.isConfigured()`)
  // — mirroring landing-hero.js/renderLoginPage and keeping the LIN-761
  // backward-compatibility guarantee (omitted/true ⇒ live buttons). Calling the
  // predicate here would break both. A provider with none (Linear, Jira)
  // renders unconditionally. Known limit: any future third predicate-declaring
  // provider would be gated by GitHub's flag; a per-provider flags map is the
  // proper fix, out of scope here.
  const configBlocked = p.addProvider.configPredicate ? !githubEnabled : false;
  if (p.addProvider.blockedBy || configBlocked) {
    const reason = p.addProvider.blockedBy
      ? `not available yet — blocked on ${escapeHtml(p.addProvider.blockedBy)}`
      : 'not available — GitHub is not configured on this server';
    return `
        <div class="node">
          <div class="line field provider-add-blocked" data-testid="settings-provider-add-${name}" data-provider="${name}">
            ${labelHtml}
            <span class="field-value provider-blocked">${reason}</span>
          </div>
        </div>`;
  }

  // Honest note on what an add does (LIN-2803): the provider's own `addHint`
  // (Linear's add connects a whole separate organization as its own workspace,
  // LIN-1351), else the shared default bind-onto-this-workspace behavior.
  const hintHtml = `
            <span class="field-value provider-add-hint" data-testid="settings-provider-add-hint-${name}">${escapeHtml(p.addProvider.addHint || DEFAULT_ADD_HINT)}</span>`;

  // LIN-1887 Step 9: one button per auth shape, each carrying an explicit
  // `authType`. A shape whose server config is missing renders disabled — the
  // gate is on the OPTION, never the row, so Jira's Basic add keeps working
  // on a server with no Atlassian app.
  const configured = { jiraOAuth: jiraOAuthEnabled };
  const formsHtml = (p.addProvider.authShapes || [{ value: null, label: 'add' }]).map(shape => {
    const testId = shape.value
      ? `settings-provider-add-btn-${name}-${escapeHtml(shape.value)}`
      : 'settings-provider-add-btn';
    if (shape.requiresConfig && !configured[shape.requiresConfig]) {
      return `
            <span class="field-value provider-blocked" data-testid="${testId}-blocked">${escapeHtml(shape.label)} (not configured)</span>`;
    }
    const fields = [['provider', p.name], ...(shape.value ? [['authType', shape.value]] : [])];
    return providerForm(addAction, fields, `<button type="submit" class="action-btn provider-add-btn" data-testid="${testId}">${escapeHtml(shape.label)}</button>`);
  }).join('');

  // "As a new workspace" verb (LIN-2803): a second, honest door to a new
  // workspace from the SAME row the bind verb lives on, mirroring the navbar's
  // own `entryCta.href` anchor. Gated on two provider-declared facts, never on
  // `entryCta` alone (Linear's add already creates a workspace, so its "bind"
  // and "create" verbs would be the same lie), and never a `<button>`/`<form>`
  // (that would move the pinned Linear/Jira button counts). Its testid uses
  // `new-workspace-`, outside the `settings-provider-add-` scrape prefix
  // `lin-2010-provider-identity-registry.test.js` pins the row sequence with.
  const newWorkspaceHtml = (p.entryCta && p.addProvider.createsWorkspace !== true && p.addProvider.newWorkspaceVerb === true)
    ? `
            <a href="${withHeldMarker(p.entryCta.href, p)}" class="action-btn provider-add-new-workspace" data-testid="settings-provider-new-workspace-${name}">as a new workspace</a>`
    : '';

  return `
        <div class="node">
          <div class="line field provider-add" data-testid="settings-provider-add-${name}" data-provider="${name}">
            ${labelHtml}${hintHtml}${formsHtml}${newWorkspaceHtml}
          </div>
        </div>`;
}

/**
 * The Providers management section (LIN-634): each binding with its remove
 * and refresh/test forms, plus an "add source" affordance drawn from the
 * registry (`getAllProviders()` order is the row order — LIN-2010; never sort).
 * `notice.activate` (LIN-2803) is present only for a just-added binding whose
 * add genuinely BINDS onto this workspace; it reuses the per-binding switch
 * form under its own testid so both can coexist.
 */
function providersBody({ bindings, urlKey, notice, githubEnabled, jiraOAuthEnabled }) {
  const actions = {
    remove: workspaceUrl(urlKey, '/settings/providers/remove'),
    refresh: workspaceUrl(urlKey, '/settings/providers/refresh'),
    switch: workspaceUrl(urlKey, '/settings/providers/switch')
  };
  const addAction = workspaceUrl(urlKey, '/settings/providers/add');

  const noticeActivateHtml = notice && notice.activate
    ? providerForm(actions.switch, [['provider', notice.activate.provider], ['scope', notice.activate.scope]], '<button type="submit" class="action-btn" data-testid="settings-provider-notice-activate">make active</button>')
    : '';
  const noticeHtml = notice ? `
        <div class="node">
          <div class="line field provider-notice provider-notice-${escapeHtml(notice.type)}" data-testid="settings-provider-notice">
            <span class="field-value">${escapeHtml(notice.text)}</span>${noticeActivateHtml}
          </div>
        </div>` : '';

  const list = bindings || [];
  const emptyHtml = list.length ? '' : `
        <div class="node">
          <div class="line field">
            <span class="field-value">no provider bindings</span>
          </div>
        </div>`;
  const addRowsHtml = getAllProviders()
    .filter(p => p.addProvider)
    .map(p => addSourceRow(p, { addAction, githubEnabled, jiraOAuthEnabled }))
    .join('');

  return `<p class="page-header__subtitle">Sources are yours: they follow your account, not everyone in the workspace.</p>
      <div class="tree">${noticeHtml}${list.map(b => bindingRow(b, actions, { isLast: list.length === 1 })).join('')}${emptyHtml}
        <div class="node">
          <div class="line field">
            <span class="field-label">add source:</span>
          </div>
          <div class="children">${addRowsHtml}
          </div>
        </div>
      </div>`;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Key problems, the runner's last poll, prompt-trace coverage and Harbour's AI calls (last 30 days), read-only. */
function healthBody({ urlKey, health = {}, llmStats, providerContextSummary }) {
  const problems = health.problems || [];
  const problemRows = problems.length
    ? problems.map(p => kvNode(`${escapeHtml(p.tokenLabel || p.tokenId || 'key')}:`, field('failing: every workspace call is refused (no owner). Re-issue it.', 'settings-value error', ' data-testid="settings-health-problem"'))).join('')
    : kvNode('keys:', field('no key problems in the last 15 minutes', 'field-value', ' data-testid="settings-health-keys-ok"'));
  const pollRow = health.lastPoll
    ? kvNode('runner last poll:', field(`${escapeHtml(health.lastPoll.at)} (${escapeHtml(health.lastPoll.kind)})`))
    : kvNode('runner last poll:', field('not seen yet'));
  return group({
    title: 'Key problems and the runner', testid: 'settings-section-health',
    rowsHtml: `<div class="tree">${problemRows}${pollRow}</div>`,
    note: 'From Credential Health over the last 15 minutes. Harbour gets no heartbeat from the runner; the last poll is the key’s last use.'
  }) + group({
    title: 'Harbour’s AI calls', testid: 'settings-section-ai-usage',
    rowsHtml: `<p class="page-header__subtitle">Recorded LLM calls for this workspace (last 30 days)</p>
      ${llmStatsTree(llmStats || {})}
      ${providerContextTree(providerContextSummary || {})}`
  }) + group({
    title: 'More', rowsHtml: drillRow({ label: 'Operator dashboard', value: 'Audit', href: workspaceUrl(urlKey, '/audit'), testid: 'settings-link-audit' })
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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
 * @property {'oauth'|'env'|'free'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {string|null} [openRouterConsentedAt] - (LIN-2412) Durable unattended-use
 *   consent timestamp for the current account, read FRESH from the store by the
 *   caller on every render (never from `req.session`). Only meaningful when
 *   `openRouterSource === 'oauth'`; gates the consent affordance shown there.
 * @property {Object} [deployInfo] - Deploy information (see lib/deploy-info.js)
 * @property {string} [currentModel] - Currently selected model ID
 * @property {ModelOption[]} [availableModels] - Available models for dropdown
 * @property {string} [modelError] - Model validation error code
 * @property {string} [urlKey] - Current workspace URL key for generating links
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 * @property {Object} [featureFlags] - Current per-user feature toggle states
 * @property {Object} [workspaceFeatures] - Current workspace feature toggle states
 * @property {Object} [llmStats] - LlmCallLogStore.summarize() output
 * @property {Object} [providerContextSummary] - PromptTraceStore.summarizeProviderContext() output
 * @property {Array} [providerBindings] - Provider bindings of this workspace
 * @property {Object|null} [providerNotice] - `{type, text, activate?}` flash after a provider action
 * @property {boolean} [jiraOAuthEnabled] - LIN-1887: whether Jira OAuth is fully configured on this server. Gates the Jira OAuth add OPTION only — never the row, which Basic auth keeps usable without it.
 * @property {boolean} [githubEnabled] - Whether GitHub is fully configured on this
 *   server (LIN-761); gates the GitHub add affordance. Defaults to true.
 * @property {Object} [dispatchDefaults] - `{ model, harness, effort, byKind }`
 * @property {string|null} [dispatchDefaultsError] - Validation error code
 * @property {Array<{id: string, name: string, pricing?: Object|null}>} [dispatchModelCatalog] - Live
 *   OpenRouter model catalog (LIN-1111 Session 2, lib/openrouter-catalog.js),
 *   merged into every dispatch-defaults/preset row's model select alongside
 *   DISPATCH_MODEL_SUGGESTIONS (LIN-2719). Defaults to `[]`.
 * @property {Object} [aiModelOverrides] - `{ byKind: { recommend: { model }, ... } }`
 * @property {string|null} [aiOverridesError] - Validation error code
 * @property {Array<{id: string, name: string, config: Object}>} [dispatchPresets]
 * @property {string[]} [accountEmails] - Emails on the signed-in account
 * @property {string|null} [area] - (LIN-3846) the area id to render (lib/settings-areas.js); omitted renders the index
 * @property {Object} [states] - area id → `{ text, tone }` sidebar state
 * @property {'light'|'dark'} [theme] - the current theme, for the Account choice
 * @property {boolean} [proxyDefault] - the +proxy default (unset means on)
 * @property {Object} [flash] - one-line notices from the redirect (`error`, `changed`, `undone`, `consentOff`)
 * @property {boolean} [isOwner] - whether the viewer owns the workspace (halt controls, key revoke)
 * @property {Object} [running] - Running area facts (`runSetup`, `hasRunner`, `lastPoll`, `haltMode`)
 * @property {Array} [keys] - the key list (lib/settings-keys.js `buildKeyList`)
 * @property {Object} [health] - Health facts (`problems`: credential-dead keys `{tokenLabel, tokenId}`, `lastPoll`)
 * @property {Array} [changeLogRows] - the merged change log (`mergeChangeLog`)
 */

/**
 * Renders the settings page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {SettingsPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderSettingsPage(workspaceName = 'Workspace', options = {}) {
  const {
    area: areaId = null, states = {},
    openRouterSource = null, openRouterConsentedAt = null, deployInfo = {},
    currentModel = '', availableModels = [], modelError = null,
    urlKey = null, workspaces = [],
    featureFlags = FEATURE_DEFAULTS, workspaceFeatures = WORKSPACE_FEATURE_DEFAULTS,
    llmStats = null, providerContextSummary = null,
    providerBindings = [], providerNotice = null, githubEnabled = true, jiraOAuthEnabled = true,
    dispatchDefaults = {}, dispatchDefaultsError = null, dispatchModelCatalog = [],
    aiModelOverrides = {}, aiOverridesError = null, dispatchPresets = [],
    accountEmails = [], theme = 'light', proxyDefault = true, flash = {},
    isOwner = false, running = {}, keys = [], health = {}, changeLogRows = [], viewerAccountId = null,
    now = Date.now()
  } = options;

  // The index (no area) shows the list; on desktop the first area sits beside it.
  const view = areaId ? 'area' : 'index';
  const area = getArea(areaId) || getArea(DEFAULT_AREA_ID);

  const bodies = {
    sources: () => group({
      title: 'Yours',
      testid: 'settings-section-providers',
      id: 'providers',
      rowsHtml: providersBody({ bindings: providerBindings, urlKey, notice: providerNotice, githubEnabled, jiraOAuthEnabled })
    }),
    // The four legacy model forms, unchanged until LIN-3855 replaces them. The
    // `dispatch-presets` anchor lives here (the Dispatch picker links to it).
    models: () => `${group({
      title: 'For everyone', testid: 'settings-section-ai-model',
      rowsHtml: `<div class="tree">
        ${workspaceModelNode({ currentModel, availableModels, modelError, urlKey })}
        ${aiOverridesBody({ aiModelOverrides, urlKey, errorCode: aiOverridesError, availableModels })}
      </div>`
    })}${group({
      title: 'Dispatch defaults', testid: 'settings-section-dispatch-defaults',
      rowsHtml: dispatchDefaultsBody({ dispatchDefaults, urlKey, errorCode: dispatchDefaultsError, modelCatalog: dispatchModelCatalog })
    })}${group({
      title: 'Dispatch presets', testid: 'settings-section-dispatch-presets', id: 'dispatch-presets',
      rowsHtml: dispatchPresetsBody({ dispatchPresets, urlKey, modelCatalog: dispatchModelCatalog })
    })}`,
    running: () => runningBody({
      urlKey, workspaceName, isOwner, periodicals: !!(workspaceFeatures.periodicals ?? WORKSPACE_FEATURE_DEFAULTS.periodicals),
      error: flash.error || null, changed: flash.changed || null, now, ...running
    }),
    'agent-access': () => agentAccessBody({
      urlKey, keys, workspaceName, modelWrites: !!workspaceFeatures.modelRoutingProxyWrites,
      error: flash.error || null, changed: flash.changed || null, now
    }),
    health: () => healthBody({ urlKey, health, llmStats, providerContextSummary }),
    'change-log': () => changeLogBody({ urlKey, rows: changeLogRows, isOwner, viewerAccountId, error: flash.error || null, undone: flash.undone || null, now }),
    features: () => featuresBody({ urlKey, featureFlags, proxyDefault }),
    account: () => `${flash.consentOff ? `<div class="settings-note settings-flash" data-testid="settings-flash">Turned off · <form action="/auth/openrouter/consent" method="POST" class="settings-form settings-inline-form"><button type="submit" class="action-btn" data-testid="settings-consent-undo">Undo</button></form></div>` : ''}${accountBody({ accountEmails, urlKey, workspaces, openRouterSource, openRouterConsentedAt, theme })}`
  };

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Settings`,
    stylesheets: ['/style.css', '/common-actions.css', '/settings.css'],
    nav: renderNavBar({ workspaces, urlKey, currentPage: 'settings', featureFlags }),
    scripts: ['/common.js', '/app.js', '/settings.js'],
    content: `${renderPageHeader({ title: 'Settings', subtitle: 'Configure AI, features, and connections' })}

  <main class="settings-main">
    ${renderSettingsShell({ urlKey, states, area, view, workspaceName, bodyHtml: bodies[area.id]() })}
  </main>
  ${renderPageFooter({
    deployInfo,
    currentPage: '/settings',
    urlKey,
    openRouterSource,
    featureFlags,
    // Thread the workspace dispatch defaults onto the feedback widget mount so
    // its model/harness controls can hint the current default (LIN-1132).
    dispatchDefaults
  })}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->`
  });
}
