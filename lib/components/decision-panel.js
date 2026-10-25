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
 */

import { escapeHtml } from '../utils/html.js';
import { spendBar } from './settings-spend-bar.js';
import { effortAppliesTo, HARNESSES_WITHOUT_EFFORT } from '../model-routing.js';
import { DISPATCH_HARNESS_SUGGESTIONS, DISPATCH_HARNESS_LABELS, DISPATCH_SUGGESTED_MODELS, DISPATCH_MODEL_REASONS, DISPATCH_CLAUDE_MODEL_SUGGESTIONS, DISPATCH_MODEL_SUGGESTIONS } from '../model-routing-harnesses.js';
import { DISPATCH_EFFORT_LEVELS } from '../dispatch-validation.js';
import { buildModelOptions } from '../openrouter-catalog.js';
import { getModelDisplayName, getModelPricingHint } from '../openrouter.js';
import { reportedModelForFamily } from '../model-routing-spend.js';

const esc = (value) => escapeHtml(value == null ? '' : String(value));

/** The name a staged field posts under. Job, group and default rows all use this shape. */
export const fieldName = ({ scope, surface, key, field }) => `c__${scope}__${surface}__${key}__${field}`;

/** Dollars, to the cent like every other money figure. A real cost under half a cent never reads as $0.00 (LIN-1086). */
const usdWords = (usd) => (usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** A job's typical run, in the words the panel uses. Null when no run was priced. */
const typicalWords = (usd) => (usd === null || usd === undefined ? null : `${usdWords(usd)} a run`);

/**
 * The option set a harness offers: Claude Code its own presets; OpenCode the OpenRouter list merged with the live
 * catalog (the same merge the Dispatch page uses, LIN-2719); no harness, both, so an OpenRouter-only pick is possible.
 * The panel's search list is one of these per harness; the server's runnable check is what judges a save.
 */
export function agentOptions(harness, catalog) {
  if (harness === 'claude-code') return buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] });
  if (harness === 'opencode') return buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog });
  const claude = buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] });
  return [...claude, ...buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog }).filter((o) => !claude.some((c) => c.id === o.id))];
}

/** The search lists for an agent row: one per harness, and one that searches everything (a blank harness). */
export function agentLists(catalog) {
  return { 'claude-code': agentOptions('claude-code', catalog), opencode: agentOptions('opencode', catalog), any: agentOptions(null, catalog) };
}

/**
 * The suggested models for one harness (LIN-3962), each with its one-line reason, its price and, where this job ran
 * on it, its typical cost. An alias names what it ran as only when the job's own runs reported exactly one model of
 * its family; an alias the job never ran has "price unknown" and no cost, never a guessed model.
 *
 * @param {'claude-code'|'opencode'} harness
 * @param {Array<{id: string, typicalUsd: number|null}>} typicals - typicalByModel(...) for the job
 */
export function decisionSuggestions({ harness, typicals = [] }) {
  return (DISPATCH_SUGGESTED_MODELS[harness] || []).map((id) => {
    const isAlias = DISPATCH_CLAUDE_MODEL_SUGGESTIONS.includes(id);
    const ranOn = isAlias ? reportedModelForFamily(typicals, id) : id;
    const ran = ranOn ? typicals.find((t) => t.id === ranOn) : null;
    return {
      id,
      name: getModelDisplayName(id, { ranOn: isAlias ? ranOn : null }),
      reason: DISPATCH_MODEL_REASONS[id],
      price: getModelPricingHint(id) || 'price unknown',
      typical: ran ? typicalWords(ran.typicalUsd) : null
    };
  });
}

/** The suggestions for every harness, keyed as the panel's `model.suggestions`. */
export function suggestionsByHarness(typicals) {
  return Object.fromEntries(DISPATCH_HARNESS_SUGGESTIONS.map((h) => [h, decisionSuggestions({ harness: h, typicals })]));
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
          </select>
        </label>`;
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
  const suggestions = Object.keys(model.suggestions || {}).map((key) => (model.suggestions[key] || []).map((s) => `
        <li class="decision-panel-suggestion" data-decision-harness="${esc(key)}"${key === inForce ? '' : ' hidden'}>
          <button type="button" class="decision-panel-pick" data-decision-pick="${esc(s.id)}">${esc(s.name)}</button>
          <span class="decision-panel-reason">${esc(s.reason)}</span>
          <span class="decision-panel-costs">
            <span class="decision-panel-price">${esc(s.price)}</span>${s.typical ? `
            <span class="decision-panel-typical">${esc(s.typical)}</span>` : ''}
          </span>
        </li>`).join('')).join('');
  return `
        <div class="decision-panel-field" data-decision-row="model">
          <span class="decision-panel-label">Model</span>
          <input type="text" class="decision-panel-control" list="${esc(listId(listKey))}" value="${esc(value)}" maxlength="200" placeholder="${esc(model.follow)}" aria-label="Model"${attrs}>
          ${datalists}
          ${suggestions ? `<ul class="decision-panel-suggestions" data-decision-suggestions>${suggestions}
          </ul>` : ''}
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
          </select>
        </label>`;
}

/**
 * @param {Object} opts
 * @param {string} opts.testid - the panel's own data-testid
 * @param {Object|null} [opts.numbers] - `{ testid, shareTestid, heading, runs, priced, unpriced, noTelemetry, spendUsd, typicalUsd, share }`; null for no numbers block
 * @param {{value: string|null, inForce: string|null, follow: string}} [opts.harness] - omitted when the row names no harness
 * @param {{value: string|null, follow: string, lists: Object, suggestions: Object}} opts.model - `lists` keyed by harness (and `any`); `suggestions` keyed by harness
 * @param {{value: string|null, follow: string}} opts.effort
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
    : '';
  return `${root}${numbersHtml(numbers)}${harnessPart}${modelPart}${effortPart}
    </div>`;
}
