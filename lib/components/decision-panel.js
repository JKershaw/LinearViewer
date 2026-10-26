/**
 * The one decision panel (LIN-3962): the harness, model and effort for one job, group or run, with the job's
 * numbers first. It replaces Settings › Models' `changePanel` and Home's client-built run panel, so there is one
 * copy of the markup and one set of rules.
 *
 * Server-rendered and pure: no I/O, no page assumptions. The caller supplies what the page names (field names and
 * the attributes its own script or tests read) and what the values mean. Models posts `c__<scope>__<surface>__<key>__<field>`
 * (lib/model-routing-edit.js's `stagedChanges` parses it back); Home has no names and keeps its own draft. The client
 * (public/decision-panel.js) only toggles this markup as a row changes; it never builds it.
 *
 * Order, always: numbers, harness, model (suggestions, then the search list), effort. Effort is a fixed set
 * (DISPATCH_EFFORT_LEVELS); a stored value outside it is shown as itself and kept. The server judges every value.
 *
 * Words (LIN-3987): every value the panel and its pages print goes through `routingWords`, so no page shows a raw
 * harness id, a bare alias or "none". The panel is 32rem wide at most (public/style.css, `.decision-panel`).
 */

import { escapeHtml } from '../utils/html.js';
import { spendBar } from './settings-spend-bar.js';
import { effortAppliesTo, HARNESSES_WITHOUT_EFFORT } from '../model-routing.js';
import { DISPATCH_HARNESS_SUGGESTIONS, DISPATCH_HARNESS_LABELS, DISPATCH_SUGGESTED_MODELS, DISPATCH_MODEL_REASONS, DISPATCH_CLAUDE_MODEL_SUGGESTIONS, DISPATCH_MODEL_SUGGESTIONS, claudeAliasModel, harnessInForce } from '../model-routing-harnesses.js';
import { DISPATCH_EFFORT_LEVELS } from '../dispatch-validation.js';
import { buildModelOptions } from '../openrouter-catalog.js';
import { getModelDisplayName, getModelPricingHint, workerModelPricingHint } from '../openrouter.js';
import { reportedModelForFamily } from '../model-routing-spend.js';

const esc = (value) => escapeHtml(value == null ? '' : String(value));

/** The name a staged field posts under. Job, group and default rows all use this shape. */
export const fieldName = ({ scope, surface, key, field }) => `c__${scope}__${surface}__${key}__${field}`;

/** Dollars, to the cent like every other money figure. A real cost under half a cent never reads as $0.00 (LIN-1086). */
export const usdWords = (usd) => (usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** A job's typical run, in the words the panel uses. Null when no run was priced. */
const typicalWords = (usd) => (usd === null || usd === undefined ? null : `${usdWords(usd)} a run`);

/** A display name for each curated option, so no search list shows a raw id (LIN-3987). */
const named = (options) => options.map((o) => (o.label === o.id ? { ...o, label: getModelDisplayName(o.id) } : o));

/**
 * The option set a harness offers: Claude Code its own presets; OpenCode the OpenRouter list merged with the live
 * catalog (the same merge the Dispatch page uses, LIN-2719); no harness, both, so an OpenRouter-only pick is possible.
 * The panel's search list is one of these per harness; the server's runnable check is what judges a save.
 */
export function agentOptions(harness, catalog) {
  if (harness === 'claude-code') return named(buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] }));
  if (harness === 'opencode') return named(buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog }));
  const claude = agentOptions('claude-code', catalog);
  return [...claude, ...agentOptions('opencode', catalog).filter((o) => !claude.some((c) => c.id === o.id))];
}

/** The search lists for an agent row: one per harness, and one that searches everything (a blank harness). */
export function agentLists(catalog) {
  return { 'claude-code': agentOptions('claude-code', catalog), opencode: agentOptions('opencode', catalog), any: agentOptions(null, catalog) };
}

/** A model's own typical cost, where this job ran on it. Null when it did not. */
const typicalOf = (typicals, id) => {
  const ran = typicals.find((t) => t.id === id);
  return ran ? typicalWords(ran.typicalUsd) : null;
};

/**
 * Where a Claude Code alias's rate comes from, in words (LIN-3987). Only a rate the job's own runs decided is marked on its
 * row; a mapped rate is said once, in the note above the suggestions, so four identical lines do not take a phone's height.
 */
const SOURCE_WORDS = Object.freeze({ ran: 'Ran as this model' });

/**
 * The suggested models for one harness (LIN-3962), each with its one-line reason, its rate and, where this job ran on
 * it, its typical cost. A rate is per 1M tokens, the same form for every harness; `price` is null when the suggestion
 * has no known rate, and the panel says so once instead of on each row.
 *
 * A Claude Code alias (LIN-3987) runs the model the job's own runs reported for its family, when that model has a rate;
 * else the model `DISPATCH_CLAUDE_ALIAS_MODELS` maps it to. `source` says which ('ran' or 'mapped'), so the row never
 * presents a mapping as something the job did.
 *
 * @param {'claude-code'|'opencode'} harness
 * @param {Array<{id: string, typicalUsd: number|null}>} typicals - typicalByModel(...) for the job
 * @returns {Array<{id: string, name: string, reason: string, price: string|null, typical: string|null, source: 'ran'|'mapped'|null}>}
 */
export function decisionSuggestions({ harness, typicals = [] }) {
  return (DISPATCH_SUGGESTED_MODELS[harness] || []).map((id) => {
    if (!claudeAliasModel(id)) {
      return {
        id,
        name: getModelDisplayName(id),
        reason: DISPATCH_MODEL_REASONS[id],
        price: getModelPricingHint(id),
        typical: typicalOf(typicals, id),
        source: null
      };
    }
    const reported = reportedModelForFamily(typicals, id);
    const ranAs = reported && workerModelPricingHint(reported) ? reported : null;
    const modelId = ranAs || claudeAliasModel(id);
    return {
      id,
      name: getModelDisplayName(modelId),
      reason: DISPATCH_MODEL_REASONS[id],
      price: workerModelPricingHint(modelId),
      typical: typicalOf(typicals, modelId),
      source: ranAs ? 'ran' : 'mapped'
    };
  });
}

/** The suggestions for every harness, keyed as the panel's `model.suggestions`. */
export function suggestionsByHarness(typicals) {
  return Object.fromEntries(DISPATCH_HARNESS_SUGGESTIONS.map((h) => [h, decisionSuggestions({ harness: h, typicals })]));
}

/**
 * What the harness, model and effort in force are called, in words (LIN-3987). A blank value says whose default
 * applies, so no page prints a raw id, a bare alias or "none". Every page that names a routing value reads it here,
 * so the words cannot drift between Home, Models, the styleguide and the routes.
 *
 * Effort is judged by the harness in force: opencode takes none, so its effort is "not used" whatever is stored.
 *
 * @param {{harness?: string|null, model?: string|null, effort?: string|null}} values - null is blank
 * @returns {{harness: string, model: string, effort: string}}
 */
export function routingWords({ harness = null, model = null, effort = null } = {}) {
  const inForce = harnessInForce(harness);
  return {
    harness: DISPATCH_HARNESS_LABELS[inForce] || inForce,
    model: model ? getModelDisplayName(model) : (inForce === 'opencode' ? "opencode's default model" : "Claude Code's own model"),
    effort: !effortAppliesTo(inForce) ? 'not used' : (effort || "Claude Code's own effort")
  };
}

/** The job's numbers: the figures, the coverage and the share of priced spend. Unpriced is never $0. */
function numbersHtml(n) {
  if (!n) return '';
  const { testid, shareTestid, heading, runs, priced, unpriced, noTelemetry, spendUsd, typicalUsd, share, unavailable } = n;
  if (unavailable) {
    return `
    <div class="decision-panel-numbers" data-testid="${esc(testid)}">
      <p class="decision-panel-heading">${esc(heading)}</p>
      <p class="decision-panel-figures">the spend could not be read just now</p>
    </div>`;
  }
  const figures = !runs
    ? 'no runs in 30 days'
    : `${priced ? usdWords(spendUsd) : 'unknown'}${typicalUsd === null ? '' : ` · typical ${typicalWords(typicalUsd)}`}`;
  const coverage = runs
    ? `${priced} of ${runs} run${runs === 1 ? '' : 's'} priced`
      + (unpriced ? `, ${unpriced} unpriced` : '')
      + (noTelemetry ? `, ${noTelemetry} with no usage reported` : '')
    : '';
  // No share when the page has no whole to share of (Home's run panel): a bar at zero would say something untrue.
  // The caption says what the bar measures, so it never reads as priced coverage (3 of 4).
  const caption = `${Math.round((share || 0) * 100)}% of all priced spend in 30 days`;
  const bar = runs && priced && share !== null && share !== undefined
    ? `
      <div class="decision-panel-share">
        ${spendBar({ share, label: caption, testid: shareTestid })}
        <p class="decision-panel-heading">${esc(caption)}</p>
      </div>`
    : '';
  return `
    <div class="decision-panel-numbers" data-testid="${esc(testid)}">
      <p class="decision-panel-heading">${esc(heading)}${coverage ? ` · ${esc(coverage)}` : ''}</p>
      <p class="decision-panel-figures">${esc(figures)}</p>${bar}
    </div>`;
}

/** The attributes that tie a control to its page: a name when the page posts it, and the page's own attributes. */
function controlAttrs({ nameOf, fieldAttrs, field }) {
  const name = nameOf ? nameOf(field) : undefined;
  return `${name ? ` name="${esc(name)}"` : ''} data-decision-field="${field}"${fieldAttrs ? ` ${fieldAttrs(field)}` : ''}`;
}

/**
 * The line under a blank field that says what the blank resolves to (Home's "From Models": the option
 * stays short so a phone does not clip it, and the value it resolves to reads here). Shown only while the field is blank;
 * the client hides it once a value is chosen. Nothing when the page gave no hint.
 */
const hintHtml = (field, hint, value) => (hint
  ? `
          <span class="decision-panel-hint" data-decision-hint="${field}"${value ? ' hidden' : ''}>${esc(hint)}</span>`
  : '');

function harnessHtml({ harness, attrs }) {
  const value = harness.value || '';
  const choices = DISPATCH_HARNESS_SUGGESTIONS.map((id) => `
            <option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(DISPATCH_HARNESS_LABELS[id])}</option>`).join('');
  const stored = value && !DISPATCH_HARNESS_SUGGESTIONS.includes(value) ? `
            <option value="${esc(value)}" selected>${esc(value)}</option>` : '';
  return `
        <label class="decision-panel-field" data-decision-row="harness">
          <span class="decision-panel-label">Harness</span>
          <select class="decision-panel-control"${attrs} aria-label="Harness">
            <option value=""${value ? '' : ' selected'}>${esc(harness.follow)}</option>${choices}${stored}
          </select>${hintHtml('harness', harness.hint, value)}
        </label>`;
}

/**
 * A harness's suggestions and the notes that go with them. Each suggestion is a button that shows whether it is the
 * model in the field (`aria-pressed`, kept in step by public/decision-panel.js). Notes are per harness, like the rows.
 */
function suggestionsHtml({ key, rows, value, inForce }) {
  const hidden = key === inForce ? '' : ' hidden';
  const items = rows.map((s) => `
        <li class="decision-panel-suggestion" data-decision-harness="${esc(key)}"${hidden}>
          <span class="decision-panel-suggestion-head">
            <button type="button" class="btn decision-panel-pick" data-decision-pick="${esc(s.id)}" aria-pressed="${value === s.id ? 'true' : 'false'}">${esc(s.name)}</button>
            <span class="decision-panel-costs">${s.price ? `
              <span class="decision-panel-price">${esc(s.price)}</span>` : ''}${s.typical ? `
              <span class="decision-panel-typical">${esc(s.typical)}</span>` : ''}${s.source === 'ran' ? `
              <span class="decision-panel-source">${esc(SOURCE_WORDS.ran)}</span>` : ''}
            </span>
          </span>
          <span class="decision-panel-reason">${esc(s.reason)}</span>
        </li>`).join('');
  // The price notes: one says what the rates are, that each is priced for the model it runs, and that a Claude Code subscription
  // may cover the cost (LIN-3992: plain words, no internal terms); one names the suggestions with no known rate. Each is written
  // once, not per row.
  const unrated = rows.filter((s) => !s.price).map((s) => s.name);
  const notes = [
    ...(key === 'claude-code' ? ['Rates per 1M tokens, to compare. Each is priced for the model it runs. A Claude Code subscription may cover the cost.'] : []),
    ...(unrated.length ? [`No known rate for ${unrated.join(', ')}.`] : [])
  ];
  return { items, notes: notes.map((text) => `
          <p class="decision-panel-note" data-decision-harness="${esc(key)}"${hidden}>${esc(text)}</p>`).join('') };
}

function modelHtml({ model, harness, withHarness, attrs, testid }) {
  const value = model.value || '';
  const lists = model.lists || { any: [] };
  const chosen = withHarness && harness ? (harness.value || '') : '';
  const listKey = chosen && lists[chosen] ? chosen : 'any';
  const listId = (key) => `${testid}-list-${key}`;
  const datalists = Object.keys(lists).map((key) => `
      <datalist id="${esc(listId(key))}" data-decision-list="${esc(key)}">${lists[key].map((o) => `
        <option value="${esc(o.id)}"${o.free ? ' data-free="true"' : ''}>${esc(o.label)}</option>`).join('')}
      </datalist>`).join('');
  // Suggestions follow the harness in force: the one the row names, else the one the page resolves a blank to.
  const inForce = withHarness && harness ? (harness.value || harness.inForce || '') : '';
  const sections = Object.keys(model.suggestions || {}).map((key) => suggestionsHtml({
    key, rows: model.suggestions[key] || [], value, inForce
  }));
  const suggestions = sections.map((s) => s.items).join('');
  const notes = sections.map((s) => s.notes).join('');
  return `
        <div class="decision-panel-field" data-decision-row="model">
          <span class="decision-panel-label">Model</span>
          <input type="text" class="decision-panel-control" list="${esc(listId(listKey))}" value="${esc(value)}" maxlength="200" placeholder="${esc(model.follow)}" aria-label="Model"${attrs}>${hintHtml('model', model.hint, value)}
          ${datalists}
          ${suggestions ? `<ul class="decision-panel-suggestions" data-decision-suggestions>${suggestions}
          </ul>${notes}` : ''}
        </div>`;
}

function effortHtml({ effort, applies, attrs }) {
  const value = effort.value || '';
  const stored = value && !DISPATCH_EFFORT_LEVELS.includes(value) ? `
            <option value="${esc(value)}" selected>${esc(value)}</option>` : '';
  const levels = DISPATCH_EFFORT_LEVELS.map((level) => `
            <option value="${esc(level)}"${level === value ? ' selected' : ''}>${esc(level)}</option>`).join('');
  return `
        <label class="decision-panel-field" data-decision-effort${applies ? '' : ' hidden'}>
          <span class="decision-panel-label">Effort</span>
          <select class="decision-panel-control"${attrs} aria-label="Effort">
            <option value=""${value ? '' : ' selected'}>${esc(effort.follow)}</option>${stored}${levels}
          </select>${hintHtml('effort', effort.hint, value)}
        </label>`;
}

/**
 * The line that says why there is no Effort row, one per harness that takes none (LIN-3987). It sits where the row was,
 * and the client shows it for the harness in force, the same loop that hides the row.
 */
const effortNotesHtml = (inForce) => HARNESSES_WITHOUT_EFFORT.map((h) => `
        <p class="decision-panel-note" data-decision-harness="${esc(h)}"${h === inForce ? '' : ' hidden'}>Effort does not apply: ${esc(DISPATCH_HARNESS_LABELS[h] || h)} takes none.</p>`).join('');

/**
 * @param {Object} opts
 * @param {string} opts.testid - the panel's own data-testid
 * @param {Object|null} [opts.numbers] - `{ testid, shareTestid, heading, runs, priced, unpriced, noTelemetry, spendUsd, typicalUsd, share }`; null for no numbers block
 * @param {{value: string|null, inForce: string|null, follow: string, hint?: string}} [opts.harness] - `hint`: what a blank resolves to, on its own line - omitted when the row names no harness
 * @param {{value: string|null, follow: string, hint?: string, lists: Object, suggestions: Object}} opts.model - `lists` keyed by harness (and `any`); `suggestions` keyed by harness
 * @param {{value: string|null, follow: string, hint?: string}} opts.effort
 * @param {(field: string) => string|undefined} [opts.nameOf] - the posted field name, if the page posts it
 * @param {(field: string) => string} [opts.fieldAttrs] - the page's own attributes on a field
 * @param {boolean} [opts.withEffort=true]
 * @param {boolean} [opts.autoSwitch=false] - Models only: an OpenRouter-only pick switches the harness to OpenCode
 * @param {boolean} [opts.clearEffort=false] - Models only: an effort the harness takes none of is cleared on the client
 */
export function decisionPanel({ testid, numbers = null, harness = null, model, effort, nameOf, fieldAttrs, withEffort = true, autoSwitch = false, clearEffort = false }) {
  const withHarness = harness !== null;
  const inForce = withHarness ? (harness.value || harness.inForce || null) : null;
  const applies = effortAppliesTo(inForce);
  const root = [
    `<div class="decision-panel" data-decision-panel data-testid="${esc(testid)}"`,
    inForce ? ` data-harness-in-force="${esc(inForce)}"` : '',
    ` data-without-effort="${esc(HARNESSES_WITHOUT_EFFORT.join(' '))}"`,
    autoSwitch ? ` data-decision-autoswitch data-claude-ids="${esc(DISPATCH_CLAUDE_MODEL_SUGGESTIONS.join(' '))}"` : '',
    clearEffort ? ' data-decision-clear-effort' : '',
    '>'
  ].join('');
  const harnessPart = withHarness
    ? harnessHtml({ harness, attrs: controlAttrs({ nameOf, fieldAttrs, field: 'harness' }) })
    : '';
  const modelPart = modelHtml({
    model, harness, withHarness, testid, attrs: controlAttrs({ nameOf, fieldAttrs, field: 'model' })
  });
  const effortPart = withEffort
    ? effortHtml({ effort, applies, attrs: controlAttrs({ nameOf, fieldAttrs, field: 'effort' }) })
      + effortNotesHtml(inForce)
    : '';
  return `${root}${numbersHtml(numbers)}${harnessPart}${modelPart}${effortPart}
    </div>`;
}
