/**
 * Settings Page Renderer
 *
 * Generates HTML for /settings, one page per area (LIN-3846). The sidebar,
 * the row pieces are lib/components/settings-row.js and the page frame is lib/components/settings-frame.js; the
 * area table is lib/settings-areas.js; Account and Features are
 * lib/render-settings-you.js; Running, Agent access and Change log are
 * lib/render-settings-workspace.js; Models is lib/render-settings-models.js
 * (LIN-3855). This file keeps the areas built from the older tree/node markup:
 * Sources (providers), the Dispatch presets section (kept beside Models) and
 * Health (AI usage).
 *
 * Shape: `renderSettingsPage` reads its options once and renders the one area
 * asked for (`area`), or the index. The rows that repeat are built once:
 * `dispatchRow` (workspace default, per-kind and preset rows),
 * `kvNode`/`errorNode` (label + value lines, Models' error line).
 *
 * Whitespace between block tags is not significant; whitespace between
 * inline elements is, and is kept.
 */

import { escapeHtml } from './utils/html.js';
import { buildModelOptions, isFreeModel } from './openrouter-catalog.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { FEATURE_DEFAULTS, WORKSPACE_FEATURE_DEFAULTS } from './feature-defaults.js';
import { getArea, DEFAULT_AREA_ID } from './settings-areas.js';
import { renderSettingsShell } from './components/settings-frame.js';
import { group, groupNote, statusLine } from './components/settings-group.js';
import { askInPlace } from './components/settings-ask.js';
import { drillRow, staticRow, hiddenInputs } from './components/settings-row.js';
import { formatRelativeTime } from './render.js';
import { accountBody, featuresBody, OPENROUTER_CONSENT_BLAST_RADIUS_COPY } from './render-settings-you.js';
import { modelsBody } from './render-settings-models.js';
import { emptyTable, effectiveTable, effortNotAppliedForRow } from './model-routing.js';
import { DEFAULT_MODEL } from './openrouter.js';
import { runningBody, agentAccessBody, changeLogBody } from './render-settings-workspace.js';
import { DISPATCH_DEFAULT_KINDS } from './prompt-templates.js';
import { getAllProviders } from './providers/index.js';
import {
  DISPATCH_HARNESS_SUGGESTIONS, DEFAULT_HARNESS, DISPATCH_CLAUDE_MODEL_SUGGESTIONS, DISPATCH_MODEL_SUGGESTIONS, DISPATCH_MODEL_OTHER_VALUE
} from './model-routing-harnesses.js';

// LIN-3125 Phase 3 (F1): the opt-in held-entry marker for the explicit
// "as a new workspace" verb only — never for the bare "bind" affordances.
import { withHeldMarker } from './held-connection-entry.js';

// The consent blast-radius copy lives in render-settings-you.js (LIN-3846); re-exported so
// the GET /auth/openrouter consent interstitial (lib/render-pages.js) and its pins keep their import.
export { OPENROUTER_CONSENT_BLAST_RADIUS_COPY };

/**
 * Honest default for a provider's "add a source" row when it declares no
 * `addHint` of its own (LIN-2803). Applied at THIS read site, not as a
 * base-getter default on `interface.js` — every provider's `addProvider`
 * getter returns a fresh object literal, so a base-class default would
 * silently not be inherited. Linear keeps its own override text (its add
 * creates a separate workspace, not the default bind).
 */
const DEFAULT_ADD_HINT = 'adds a source onto this workspace';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** `/workspace/<urlKey><suffix>`; `urlKey` goes through encodeURIComponent only (a null urlKey renders "null", as it always has). */
function workspaceUrl(urlKey, suffix) {
  return `/workspace/${encodeURIComponent(urlKey)}${suffix}`;
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
 * The live catalog as the page carries it to the client (LIN-2719): the SAME `{id, name, free}` wire
 * shape GET .../api/openrouter/models returns, escaped for an attribute. public/common.js reads it back
 * (`getSettingsModelCatalog`) so a harness switch on a Settings row keeps every catalog entry.
 */
function catalogWireOf(modelCatalog) {
  return escapeHtml(JSON.stringify(
    modelCatalog.map(m => ({ id: m.id, name: (typeof m.name === 'string' && m.name) || m.id, free: isFreeModel(m) }))
  ));
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
  // LIN-3855: the delete asks in place (askInPlace, script transport) rather than a native confirm(); the
  // existing DELETE route stays the one write. A saved effort the preset's harness ignores says so.
  const deleteHtml = urlKey
    ? askInPlace({
      summary: 'delete',
      willHappen: 'Delete this preset. Dispatches already made from it are unaffected.',
      transport: 'script', method: 'DELETE',
      action: workspaceUrl(urlKey, `/api/dispatch/presets/${encodeURIComponent(id)}`),
      confirmLabel: 'Delete preset', tone: 'red', cancelHref: workspaceUrl(urlKey, '/settings/models'),
      testid: `dispatch-preset-delete-${id}`
    })
    : '';
  const notApplied = effortNotAppliedForRow({ harness: config.harness ?? null, effort: config.effort ?? null });
  const notAppliedHtml = notApplied
    ? `<p class="settings-note" data-testid="dispatch-preset-effort-not-applied-${escapeHtml(id)}">Effort ${escapeHtml(notApplied.stored)} is saved but not applied on ${escapeHtml(notApplied.harness)}.</p>`
    : '';
  return `
          <div class="node dispatch-preset-item" data-testid="dispatch-preset-item-${escapeHtml(id)}" data-preset-id="${escapeHtml(id)}">
            <div class="line field dispatch-preset-name-line">
              <span class="field-label">name:</span>
              <input type="text" class="dispatch-preset-name-input" maxlength="50" value="${escapeHtml(name)}">
              <button type="button" class="btn btn--primary dispatch-preset-save-btn" data-preset-id="${escapeHtml(id)}">save</button>
              ${useLinkHtml}
            </div>${deleteHtml}${notAppliedHtml}
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
  // LIN-3855: the catalog snapshot lives here, on a wrapper this section always emits, so the preset rows
  // keep their option list once the defaults form (its old carrier) is retired.
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
      <div class="dispatch-presets-catalog" data-model-catalog="${catalogWireOf(modelCatalog)}">
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
        <button type="button" class="btn btn--primary dispatch-preset-create-btn">save preset</button>
      </div>
      </div>`;
}

// ---------------------------------------------------------------------------
// AI usage
// ---------------------------------------------------------------------------

function callsText(n) {
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/**
 * Harbour's AI calls (LIN-418, LIN-1988, LIN-3890 outcome 1): one row per figure, from the
 * per-call LLM metadata log, or one "none recorded yet" row. A non-empty `latencyByFeatureModel`
 * adds a row per feature and model and a note naming the metric honestly (end-to-end wall-clock,
 * not time-to-first-token, a weaker proxy on SSE lanes); absent or empty, no latency rows.
 */
function llmStatsRows(stats, now) {
  if (!stats.totalCalls) {
    return staticRow({ label: 'Calls', valueHtml: 'none recorded yet', testid: 'settings-health-calls' });
  }
  const featureRows = (stats.byFeature || []).map(f => staticRow({
    label: `By feature · ${f.feature}`, valueHtml: `${escapeHtml(callsText(f.calls))} · ${escapeHtml(formatCost(f.cost))}`
  })).join('');
  const lastCallRow = stats.lastCallAt
    ? staticRow({ label: 'Last call', valueHtml: escapeHtml(formatRelativeTime(stats.lastCallAt, now)) })
    : '';
  const latencyRows = Array.isArray(stats.latencyByFeatureModel) ? stats.latencyByFeatureModel : [];
  const latencyHtml = latencyRows.length
    ? latencyRows.map(row => staticRow({
      label: `${row.feature} · ${row.model}`,
      valueHtml: escapeHtml(`${callsText(row.count)} · p50 ${row.p50Ms}ms · p90 ${row.p90Ms}ms · max ${row.maxMs}ms`)
    })).join('')
    : '';
  return `${staticRow({ label: 'Calls', valueHtml: escapeHtml(String(stats.totalCalls)) })}${staticRow({ label: 'Cost', valueHtml: escapeHtml(formatCost(stats.totalCost)) })}${staticRow({ label: 'Tokens', valueHtml: escapeHtml((stats.totalTokens || 0).toLocaleString('en-US')) })}${lastCallRow}${featureRows}${latencyHtml}${latencyRows.length ? groupNote('Latency is whole-call wall-clock (end-to-end response time), not time-to-first-token: a weaker proxy on SSE lanes than on JSON with keepalive.') : ''}`;
}

/**
 * Provider-context disclosure (LIN-2357): makes a null `providerUi` on a recorded prompt trace
 * visible as counts and a coverage basis, never as raw trace content. One row per figure.
 */
function providerContextRows(summary, now) {
  const basisRow = summary.basis ? staticRow({ label: 'Basis', valueHtml: escapeHtml(summary.basis), className: 'settings-row-muted' }) : '';
  if (!summary.traces) {
    return `${staticRow({ label: 'Provider context', valueHtml: 'no prompt traces recorded yet', testid: 'settings-health-context' })}${basisRow}`;
  }
  const untraced = summary.untracedContext || 0;
  const countText = untraced
    ? `${untraced} of ${summary.traces} traces missing (${summary.divergent || 0} divergent, ${summary.benign || 0} benign)`
    : `0 of ${summary.traces} traces missing`;
  const recencyRow = untraced && summary.newestUntracedContextAt
    ? staticRow({ label: 'Most recent untraced', valueHtml: escapeHtml(formatRelativeTime(summary.newestUntracedContextAt, now)) })
    : '';
  return `${staticRow({ label: 'Provider context', valueHtml: escapeHtml(countText), testid: 'settings-health-context' })}${recencyRow}${basisRow}`;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Remove a source, asked in place (LIN-3846, LIN-3890): the panel says what will
 * happen, and Confirm and Cancel sit in it. Removing the LAST source also revokes
 * the remover's keys, queue tokens and share links, and the runner key when they
 * are the owner (server.js providers/remove, lib/workspace-removal-revocation.js).
 * The POST is unchanged.
 */
function removeSourceAsk(b, action, fields, isLast, cancelHref) {
  const name = b.displayName || b.provider;
  const text = isLast
    ? `Removing ${name} stops Harbour reading it for you. It is your last source, so this also revokes the keys, queue tokens and share links you made in this workspace, and the runner key if you are the workspace owner.`
    : `Removing ${name} stops Harbour reading it for you. Your other sources are not affected.`;
  return askInPlace({ summary: 'Remove this source', willHappen: text, action, fields, confirmLabel: 'Remove source', tone: 'red', cancelHref, testid: 'settings-provider-remove' });
}

/** A small POST form for one provider action (make active, test connection, add). */
function postForm(action, fields, buttonHtml) {
  return `<form action="${escapeHtml(action)}" method="POST" class="settings-form settings-row-form">${hiddenInputs(fields)}${buttonHtml}</form>`;
}

/**
 * One connected source (LIN-3890 outcome 1): a row that shows its state (active or
 * connected, and its scope), opens in place to its token, the two actions and the
 * remove ask. The LIN-717 make-active form appears only on an inactive binding.
 */
function bindingRow(b, actions, { isLast = false, cancelHref = '' } = {}) {
  const fields = [['provider', b.provider], ['scope', b.scope]];
  const name = b.displayName || b.provider;
  const activeMark = b.active ? '<span class="provider-active" data-testid="settings-provider-active" title="active provider">●</span>' : '';
  const activate = b.active ? '' : postForm(actions.switch, fields, '<button type="submit" class="btn btn--primary" data-testid="settings-provider-activate">Make active</button>');
  const body = `
          <p class="settings-ask-text"><span class="provider-token">${escapeHtml(maskToken(b.token, b.provider))}</span></p>
          <div class="settings-ask-actions">${activate}${postForm(actions.refresh, fields, '<button type="submit" class="btn--quiet" data-testid="settings-provider-refresh">Test connection</button>')}</div>
          ${removeSourceAsk(b, actions.remove, fields, isLast, cancelHref)}`;
  return drillRow({
    label: name,
    value: `${b.scope}${b.active ? ' · active' : ''}`,
    flagHtml: activeMark,
    bodyHtml: body,
    testid: 'settings-provider-binding',
    attrs: ` data-provider="${escapeHtml(b.provider)}" data-scope="${escapeHtml(b.scope)}"`
  });
}

/**
 * One row per source this server can add (LIN-3890 outcome 1): a source the
 * server cannot add (GitHub unconfigured, Jira OAuth unconfigured, a blocked
 * provider) is not listed at all. `addProvider` is the provider's own declaration.
 */
function addSourceRow(p, { addAction, githubEnabled, jiraOAuthEnabled }) {
  const name = escapeHtml(p.name);
  // Row-level gate (LIN-2010 F1): a DECLARED configPredicate marks which rows are gated at all
  // (github and github-projects share one predicate), but the configured-ness VALUE is the threaded
  // `githubEnabled`, resolved once at the composition root in server.js (`getProvider('github').entryCta.isConfigured()`).
  // Calling the predicate here would break the LIN-761 backward-compatibility guarantee (omitted/true ⇒ live buttons). A provider
  // with none (Linear, Jira) renders unconditionally. Known limit: any future third predicate-declaring
  // provider would be gated by GitHub's flag; a per-provider flags map is the proper fix, out of scope here.
  const configBlocked = p.addProvider.configPredicate ? !githubEnabled : false;
  if (p.addProvider.blockedBy || configBlocked) return '';

  // Honest note on what an add does (LIN-2803): the provider's own `addHint`
  // (Linear's add connects a whole separate organization as its own workspace,
  // LIN-1351), else the shared default bind-onto-this-workspace behavior.
  const hintHtml = `<span class="settings-row-note" data-testid="settings-provider-add-hint-${name}">${escapeHtml(p.addProvider.addHint || DEFAULT_ADD_HINT)}</span>`;

  // LIN-1887 Step 9: one button per auth shape, each carrying an explicit `authType`. A shape
  // whose server config is missing is not offered (LIN-3890: the OAuth option is simply absent):
  // the gate is on the OPTION, never the row, so Jira's Basic add keeps working on a server with
  // no Atlassian app.
  const configured = { jiraOAuth: jiraOAuthEnabled };
  const shapes = (p.addProvider.authShapes || [{ value: null, label: 'add' }])
    .filter(shape => !shape.requiresConfig || configured[shape.requiresConfig]);
  if (!shapes.length) return '';
  const formsHtml = shapes.map(shape => {
    const testId = shape.value
      ? `settings-provider-add-btn-${name}-${escapeHtml(shape.value)}`
      : 'settings-provider-add-btn';
    const fields = [['provider', p.name], ...(shape.value ? [['authType', shape.value]] : [])];
    return postForm(addAction, fields, `<button type="submit" class="btn--quiet btn--blue" data-testid="${testId}">${escapeHtml(shape.label)}</button>`);
  }).join('');

  // "As a new workspace" verb (LIN-2803): a second, honest door to a new workspace from the SAME row,
  // mirroring the navbar's own `entryCta.href` anchor.
  // Gated on two provider-declared facts, never on `entryCta` alone (Linear's add already creates a
  // workspace, so its "bind" and "create" verbs would be the same lie), and never a `<button>`/`<form>`
  // (that would move the pinned Linear/Jira button counts). Its testid uses `new-workspace-`, outside
  // the `settings-provider-add-` scrape prefix `lin-2010-provider-identity-registry.test.js` pins the
  // row sequence with.
  const newWorkspaceHtml = (p.entryCta && p.addProvider.createsWorkspace !== true && p.addProvider.newWorkspaceVerb === true)
    ? `<a href="${withHeldMarker(p.entryCta.href, p)}" class="settings-link" data-testid="settings-provider-new-workspace-${name}">as a new workspace</a>`
    : '';

  return staticRow({
    label: p.ui.displayName,
    valueHtml: hintHtml,
    extraHtml: `<span class="settings-ask-actions">${formsHtml}${newWorkspaceHtml}</span>`,
    testid: `settings-provider-add-${name}`,
    attrs: ` data-provider="${name}"`,
    className: 'settings-row-add'
  });
}

/**
 * Sources (LIN-634, LIN-3890): "Yours" lists each connected source as one row with its state;
 * "Add a source" lists only the sources this server can add. `registry` order is the row order
 * (LIN-2010; never sort). `notice.activate` (LIN-2803) is present only for a just-added binding
 * whose add genuinely BINDS onto this workspace; it sits in the status line with the make-active action.
 */
function providersBody({ bindings, urlKey, notice, githubEnabled, jiraOAuthEnabled }) {
  const cancelHref = workspaceUrl(urlKey, '/settings/sources');
  const actions = {
    remove: workspaceUrl(urlKey, '/settings/providers/remove'),
    refresh: workspaceUrl(urlKey, '/settings/providers/refresh'),
    switch: workspaceUrl(urlKey, '/settings/providers/switch')
  };
  const addAction = workspaceUrl(urlKey, '/settings/providers/add');

  const noticeActivate = notice && notice.activate
    ? postForm(actions.switch, [['provider', notice.activate.provider], ['scope', notice.activate.scope]], '<button type="submit" class="btn btn--primary" data-testid="settings-provider-notice-activate">Make active</button>')
    : '';
  const noticeHtml = notice
    ? statusLine({
      tone: notice.type === 'ok' ? 'ok' : 'bad', text: notice.text, actionHtml: noticeActivate,
      testid: 'settings-provider-notice', className: `provider-notice provider-notice-${notice.type}`
    })
    : '';

  const list = bindings || [];
  const rowsHtml = list.length
    ? list.map(b => bindingRow(b, actions, { isLast: list.length === 1, cancelHref })).join('')
    : staticRow({ label: 'Sources', valueHtml: 'none yet', testid: 'settings-provider-empty' });
  const addRowsHtml = getAllProviders()
    .filter(p => p.addProvider)
    .map(p => addSourceRow(p, { addAction, githubEnabled, jiraOAuthEnabled }))
    .join('');

  return `${noticeHtml}${group({
    title: 'Yours', testid: 'settings-section-providers', id: 'providers',
    rowsHtml,
    note: 'They follow your account. Removing the last one revokes your keys here.'
  })}${group({
    title: 'Add a source', testid: 'settings-section-providers-add',
    rowsHtml: addRowsHtml || staticRow({ label: 'Nothing to add', valueHtml: 'no sources this server can add', testid: 'settings-provider-add-none' }),
    note: 'Only sources this server can add are listed.'
  })}`;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Health (LIN-3890 outcome 1): one row per check. Key problems and the runner's last poll; Harbour's
 * AI calls over the last 30 days; prompt-trace coverage; and a link to the operator's audit.
 */
function healthBody({ urlKey, health = {}, llmStats, providerContextSummary, now = Date.now() }) {
  const problems = health.problems || [];
  const problemRows = problems.length
    ? problems.map(p => staticRow({
      label: p.tokenLabel || p.tokenId || 'key',
      valueHtml: 'failing: every workspace call is refused (no owner). Re-issue it.',
      testid: 'settings-health-problem', className: 'settings-row-flagged'
    })).join('')
    : staticRow({ label: 'Keys', valueHtml: 'no key problems in the last 15 minutes', testid: 'settings-health-keys-ok' });
  const pollRow = staticRow({
    label: 'Runner last poll',
    valueHtml: health.lastPoll ? `${escapeHtml(formatRelativeTime(health.lastPoll.at, now))} · ${escapeHtml(health.lastPoll.kind)}` : 'not seen yet',
    testid: 'settings-health-last-poll'
  });
  return group({
    title: 'Key problems and the runner', testid: 'settings-section-health',
    rowsHtml: `${problemRows}${pollRow}`,
    note: 'Credential Health, last 15 min. Last poll is the key’s last use, not a heartbeat.'
  }) + group({
    title: 'Harbour’s AI calls', testid: 'settings-section-ai-usage',
    rowsHtml: `${llmStatsRows(llmStats || {}, now)}${providerContextRows(providerContextSummary || {}, now)}`,
    note: 'Recorded LLM calls for this workspace, last 30 days.'
  }) + group({
    title: 'More', testid: 'settings-section-health-more',
    rowsHtml: drillRow({ label: 'Operator dashboard', value: 'Audit', href: workspaceUrl(urlKey, '/audit'), testid: 'settings-link-audit' })
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
/**
 * The Models body's data when the route did not gather it (a caller that renders the area with no table):
 * an empty table, so the page shows every job on the default and no spend. The route always passes real data.
 */
function emptyModelsData({ urlKey, availableModels, catalog }) {
  const table = emptyTable();
  return {
    urlKey, table, effective: effectiveTable(table, { defaultModel: DEFAULT_MODEL }),
    agentSpend: [], harbourSpend: [], presets: [], log: [], catalog, availableModels
  };
}

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
    availableModels = [],
    urlKey = null, workspaces = [],
    featureFlags = FEATURE_DEFAULTS, workspaceFeatures = WORKSPACE_FEATURE_DEFAULTS,
    llmStats = null, providerContextSummary = null,
    providerBindings = [], providerNotice = null, githubEnabled = true, jiraOAuthEnabled = true,
    dispatchDefaults = {}, modelsData = null, dispatchModelCatalog = [],
    dispatchPresets = [],
    accountEmails = [], theme = 'light', proxyDefault = true, flash = {},
    isOwner = false, running = {}, keys = [], health = {}, changeLogRows = [], viewerAccountId = null,
    now = Date.now()
  } = options;

  // The index (no area) shows the list; on desktop the first area sits beside it.
  const view = areaId ? 'area' : 'index';
  const area = getArea(areaId) || getArea(DEFAULT_AREA_ID);

  const bodies = {
    sources: () => providersBody({ bindings: providerBindings, urlKey, notice: providerNotice, githubEnabled, jiraOAuthEnabled }),
    // LIN-3855: the Models body is the page the design note describes (lib/render-settings-models.js). The
    // Dispatch presets section stays beside it, unchanged in behaviour, with its `#dispatch-presets` anchor
    // (the Dispatch picker links to it).
    models: () => `${modelsBody(modelsData || emptyModelsData({ urlKey, availableModels, catalog: dispatchModelCatalog }))}${group({
      title: 'Dispatch presets', testid: 'settings-section-dispatch-presets', id: 'dispatch-presets',
      rowsHtml: dispatchPresetsBody({ dispatchPresets, urlKey, modelCatalog: dispatchModelCatalog })
    })}`,
    running: () => runningBody({
      urlKey, workspaceName, isOwner, periodicals: !!(workspaceFeatures.periodicals ?? WORKSPACE_FEATURE_DEFAULTS.periodicals),
      error: flash.error || null, now, changeRows: changeLogRows, ...running
    }),
    'agent-access': () => agentAccessBody({
      urlKey, keys, workspaceName, modelWrites: !!workspaceFeatures.modelRoutingProxyWrites,
      error: flash.error || null, now, changeRows: changeLogRows
    }),
    health: () => healthBody({ urlKey, health, llmStats, providerContextSummary, now }),
    'change-log': () => changeLogBody({ urlKey, rows: changeLogRows, isOwner, viewerAccountId, error: flash.error || null, now }),
    features: () => featuresBody({ urlKey, featureFlags, proxyDefault }),
    account: () => accountBody({ accountEmails, urlKey, workspaces, openRouterSource, openRouterConsentedAt, theme, consentOff: flash.consentOff }),
  };

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Settings`,
    stylesheets: ['/style.css', '/common-actions.css', '/settings.css'],
    nav: renderNavBar({ workspaces, urlKey, currentPage: 'settings', featureFlags }),
    scripts: ['/common.js', '/app.js', '/settings.js', '/settings-models.js'],
    content: `
  <main class="settings-main">
    ${renderSettingsShell({
      urlKey, states, area, view, workspaceName, bodyHtml: bodies[area.id](),
      headerHtml: renderPageHeader({ title: 'Settings', subtitle: 'Configure AI, features, and connections' })
    })}
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
