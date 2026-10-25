/**
 * The Settings › Models body (LIN-3855). Every job, its spend and its model, read from the effective
 * table, so the page shows what runs, not what the old forms wrote.
 *
 * The rows are one staged form: every field it shows is posted with one reason and one save, which
 * `lib/model-routing-edit.js` turns into one logged change. The routing presets and the change log sit
 * beside it as their own small forms, because their actions are not "save these fields".
 *
 * Rows say what they are set to and where that comes from ("set here", "from Make", "default"), and the
 * spend beside each job. Jobs are ordered by priced spend; a job with no runs is listed as such.
 */

import { escapeHtml } from './utils/html.js';
import { group, groupNote, statusLine } from './components/settings-group.js';
import { drillRow, staticRow } from './components/settings-row.js';
import { askInPlace } from './components/settings-ask.js';
import { changePanel, fieldName } from './components/settings-change-panel.js';
import { spendBar } from './components/settings-spend-bar.js';
import { settingsAreaUrl } from './settings-areas.js';
import { AGENT_JOB_IDS, HARBOUR_JOB_IDS } from './model-routing.js';
import { JOBS, GROUPS, SURFACES, getJob } from './llm-jobs.js';
import { DISPATCH_HARNESS_SUGGESTIONS, DISPATCH_MODEL_SUGGESTIONS, DISPATCH_CLAUDE_MODEL_SUGGESTIONS } from './model-routing-harnesses.js';
import { buildModelOptions } from './openrouter-catalog.js';
import { formatRelativeTime } from './render.js';
import { byJobSpend } from './model-routing-spend.js';

const { AGENT_SESSION, HARBOUR_CALL } = SURFACES;
const GROUP_IDS = Object.keys(GROUPS);
const MAX_LIST = 25;

/** A job id as words: `plan-review` reads "Plan review". */
export function jobLabel(id) {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const groupLabel = (id) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * The model's display name: the live catalog's, then the curated list's, then the slug. The catalog
 * wins because it is what OpenRouter calls the model today.
 */
export function modelNamer({ catalog = [], availableModels = [] }) {
  const names = new Map();
  for (const m of availableModels) if (m && m.id && m.name) names.set(m.id, m.name);
  for (const m of catalog) if (m && m.id && typeof m.name === 'string' && m.name) names.set(m.id, m.name);
  return (id) => (id ? (names.get(id) || id.split('/').pop()) : 'Default');
}

/**
 * The model option set for an agent row, by the harness the ROW names. Claude Code offers only its Claude
 * presets; OpenCode the OpenRouter list and the live catalog (the same merge the Dispatch page uses, LIN-2719).
 * A row that names no harness offers both, so an OpenRouter-only pick is possible and switches the harness
 * to OpenCode (public/settings-models.js). The server's runnable check is what judges the save.
 */
export function agentOptions(harness, catalog) {
  if (harness === 'claude-code') return buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] });
  if (harness === 'opencode') return buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog });
  const claude = buildModelOptions({ curatedIds: DISPATCH_CLAUDE_MODEL_SUGGESTIONS, catalog: [] });
  return [...claude, ...buildModelOptions({ curatedIds: DISPATCH_MODEL_SUGGESTIONS, catalog }).filter((o) => !claude.some((c) => c.id === o.id))];
}

/** A Harbour-call model option set: the curated OpenRouter ids the call sites offer, plus the live catalog. */
export function harbourOptions(curatedIds, catalog) {
  return buildModelOptions({ curatedIds, catalog });
}

/** Where a field's value comes from, as the row words it. */
function sourceWords(source, groupId) {
  if (source === 'job') return 'set here';
  if (source === 'group') return `from ${groupLabel(groupId)}`;
  return 'not set';
}

/** `Make · Claude Sonnet 5 · set here`. The harness shows only when it is set. */
function valueWords({ harness, model, source, groupId, name }) {
  const parts = [];
  if (harness) parts.push(harness);
  parts.push(model ? name(model) : 'no model');
  parts.push(sourceWords(source.model, groupId));
  return parts.join(' · ');
}

/** What the window shows the job ran on, beyond what it is set to: `also ran on X (N of M)`. */
function alsoRan(spend, configuredModel, name) {
  if (!spend || !spend.models.length) return '';
  const others = spend.models.filter((m) => m !== configuredModel);
  if (!others.length) return '';
  return `also ran on ${others.map(name).join(', ')} (${others.length} of ${spend.models.length} models in the window)`;
}

/** The spend block for one job: the priced figure, the coverage and the bar. */
function spendBlock({ spend, totalPriced, label }) {
  if (!spend || spend.runs === 0) {
    return staticRow({ label: 'Last 30 days', valueHtml: 'no runs in 30 days', testid: `models-spend-${label}` });
  }
  const priced = spend.priced;
  const coverage = `${priced} of ${spend.runs} run${spend.runs === 1 ? '' : 's'} priced`
    + (spend.unpriced ? `, ${spend.unpriced} unpriced` : '')
    + (spend.noTelemetry ? `, ${spend.noTelemetry} with no usage reported` : '');
  const spendText = priced ? `$${spend.spendUsd.toFixed(2)}` : 'unknown';
  const typical = spend.typicalUsd === null ? '' : `typical $${spend.typicalUsd.toFixed(3)} a run`;
  const share = priced && totalPriced > 0 ? spend.spendUsd / totalPriced : null;
  return staticRow({
    label: 'Last 30 days',
    valueHtml: `${escapeHtml(spendText)}${typical ? ` · ${escapeHtml(typical)}` : ''}`,
    note: coverage,
    extraHtml: spendBar({ share, label: `${Math.round((share || 0) * 100)}% of priced spend`, testid: `models-share-${label}` }),
    testid: `models-spend-${label}`
  });
}

/**
 * The staged rows: agent jobs and agent groups, the agent default, Harbour jobs and groups.
 * `values` (from a refused save) overrides what a field shows, so a refusal keeps the staged edits.
 */
function rowsBody({ table, effective, agentSpend, harbourSpend, name, catalog, values, filter, harbourCurated }) {
  const byId = new Map(effective.jobs.map((j) => [j.id, j]));
  const shown = (field, actual) => (values && Object.hasOwn(values, field) ? values[field] : actual);
  const isSet = (job) => job.source.model === 'job' || job.source.harness === 'job' || job.source.effort === 'job';
  const include = (job) => filter !== 'set' || isSet(job);
  const registry = new Map(JOBS.map((j, i) => [j.id, i]));
  const totalPriced = agentSpend.reduce((n, s) => n + s.spendUsd, 0);
  const harbourTotal = harbourSpend.reduce((n, s) => n + s.spendUsd, 0);

  const agentSpendById = new Map(agentSpend.map((s) => [s.id, s]));
  const harbourSpendById = new Map(harbourSpend.map((s) => [s.id, s]));
  const agentOrder = [...AGENT_JOB_IDS].map((id) => agentSpendById.get(id) || { id, runs: 0, spendUsd: 0, models: [], priced: 0 })
    .sort(byJobSpend(registry));
  const harbourOrder = [...HARBOUR_JOB_IDS].map((id) => harbourSpendById.get(id) || { id, runs: 0, spendUsd: 0, models: [], priced: 0 })
    .sort(byJobSpend(registry));

  const jobRow = (spend, surface, totalForShare) => {
    const job = getJob(spend.id);
    const row = byId.get(spend.id);
    const isAgent = surface === AGENT_SESSION;
    const groupId = job.group;
    const target = { scope: 'job', surface, key: job.id };
    // The panel shows the job's OWN stored values (blank = follow the group); the row's value is what runs.
    const own = table.jobs[job.id] || {};
    const harness = isAgent ? shown(fieldName({ ...target, field: 'harness' }), own.harness ?? null) : null;
    const model = shown(fieldName({ ...target, field: 'model' }), own.model ?? null);
    const effort = isAgent ? shown(fieldName({ ...target, field: 'effort' }), own.effort ?? null) : null;
    const options = isAgent ? agentOptions(harness, catalog) : harbourOptions(harbourCurated, catalog);
    const panel = changePanel({
      target, harness, model, effort, modelOptions: withCurrent(options, model, name), harnesses: DISPATCH_HARNESS_SUGGESTIONS,
      inheritLabel: `Follow ${groupLabel(groupId)}`, withHarness: isAgent, withEffort: isAgent
    });
    const label = `models-job-${job.id}`;
    const ran = alsoRan(spend, row.model, name);
    const note = row.effortNotApplied ? `Effort ${row.effortNotApplied.stored} is not applied on ${row.effortNotApplied.harness}.` : '';
    const bodyHtml = `
      <p class="settings-note">${escapeHtml(job.description)}</p>${panel}
      ${spendBlock({ spend, totalPriced: totalForShare, label: job.id })}${ran ? `\n      ${groupNote(ran)}` : ''}${note ? `\n      ${groupNote(note)}` : ''}`;
    return drillRow({
      label: jobLabel(job.id),
      value: valueWords({ harness: isAgent ? harness : null, model: model || row.model, source: row.source, groupId, name }),
      bodyHtml,
      testid: label,
      id: label,
      flagHtml: spend.runs === 0 ? 'no runs' : ''
    });
  };

  const groupRow = (groupId, surface) => {
    const target = { scope: 'group', surface, key: groupId };
    const isAgent = surface === AGENT_SESSION;
    const g = table.groups[surface][groupId] || {};
    const harness = isAgent ? shown(fieldName({ ...target, field: 'harness' }), g.harness ?? null) : null;
    const model = shown(fieldName({ ...target, field: 'model' }), g.model ?? null);
    const effort = isAgent ? shown(fieldName({ ...target, field: 'effort' }), g.effort ?? null) : null;
    const reached = JOBS.filter((j) => j.surface === surface && j.group === groupId);
    const setHere = reached.filter((j) => {
      const r = byId.get(j.id);
      return r && (r.source.model === 'job' || r.source.harness === 'job' || r.source.effort === 'job');
    }).length;
    const options = isAgent ? agentOptions(harness, catalog) : harbourOptions(harbourCurated, catalog);
    const panel = changePanel({
      target, harness, model, effort, modelOptions: withCurrent(options, model, name), harnesses: DISPATCH_HARNESS_SUGGESTIONS,
      inheritLabel: 'Not set', withHarness: isAgent, withEffort: isAgent
    });
    return drillRow({
      label: groupLabel(groupId),
      value: `${model ? name(model) : 'no model'}${isAgent && harness ? ` · ${harness}` : ''} · ${reached.length} job${reached.length === 1 ? '' : 's'}, ${setHere} set here`,
      bodyHtml: `<p class="settings-note">${escapeHtml(GROUPS[groupId])}</p>${panel}`,
      testid: `models-group-${surface}-${groupId}`,
      id: `models-group-${surface}-${groupId}`
    });
  };

  const agentDefault = (() => {
    const target = { scope: 'default', surface: AGENT_SESSION, key: 'default' };
    const d = table.defaults[AGENT_SESSION] || {};
    const harness = shown(fieldName({ ...target, field: 'harness' }), d.harness ?? null);
    const model = shown(fieldName({ ...target, field: 'model' }), d.model ?? null);
    const effort = shown(fieldName({ ...target, field: 'effort' }), d.effort ?? null);
    const panel = changePanel({
      target, harness, model, effort, modelOptions: withCurrent(agentOptions(harness, catalog), model, name),
      harnesses: DISPATCH_HARNESS_SUGGESTIONS, inheritLabel: 'Not set', withHarness: true, withEffort: true
    });
    return drillRow({
      label: 'No job (Dispatch suggestion)',
      value: `${model ? name(model) : 'not set'}${harness ? ` · ${harness}` : ''}`,
      bodyHtml: `<p class="settings-note">What the Dispatch page suggests when no job is chosen. It is not a job, and no run reads it.</p>${panel}`,
      testid: 'models-default-agent',
      id: 'models-default-agent'
    });
  })();

  const agentJobs = agentOrder.filter((s) => include(byId.get(s.id))).map((s) => jobRow(s, AGENT_SESSION, totalPriced));
  const harbourJobs = harbourOrder.filter((s) => include(byId.get(s.id))).map((s) => jobRow(s, HARBOUR_CALL, harbourTotal));
  const agentGroupRows = GROUP_IDS.map((g) => groupRow(g, AGENT_SESSION));
  const harbourGroupRows = GROUP_IDS.map((g) => groupRow(g, HARBOUR_CALL));
  return { agentJobs, harbourJobs, agentGroupRows, harbourGroupRows, agentDefault };
}

/** Keep a stored model that is not in the option set selectable (it shows as itself, never dropped). */
function withCurrent(options, model, name) {
  if (!model || options.some((o) => o.id === model)) return options;
  return [...options, { id: model, label: name(model), free: false }];
}

function filterLinks({ urlKey, filter }) {
  const link = (label, value, testid) => `<a class="settings-filter-link${filter === value ? ' is-current' : ''}" href="${escapeHtml(settingsAreaUrl(urlKey, 'models', value === 'all' ? null : { filter: value }))}" data-testid="${testid}"${filter === value ? ' aria-current="true"' : ''}>${label}</a>`;
  return `<nav class="settings-filter" aria-label="Which jobs" data-testid="models-filter">${link('All jobs', 'all', 'models-filter-all')} · ${link('Set individually', 'set', 'models-filter-set')}</nav>`;
}

function presetsBody({ urlKey, presets, version }) {
  const listHtml = presets.length
    ? presets.slice(0, MAX_LIST).map((p) => askInPlace({
      summary: p.name,
      value: formatRelativeTime(p.createdAt),
      willHappen: `Make every job and group match "${p.name}". One logged change; undo it from the change log.`,
      askWhy: true,
      action: `/workspace/${encodeURIComponent(urlKey)}/settings/models/presets/${encodeURIComponent(p._id)}/apply`,
      confirmLabel: 'Apply preset',
      tone: 'teal',
      cancelHref: settingsAreaUrl(urlKey, 'models'),
      testid: `models-preset-${p._id}`
    })).join('')
    : staticRow({ label: 'No presets yet', valueHtml: '', testid: 'models-presets-empty' });
  const saveForm = `
      <form action="/workspace/${encodeURIComponent(urlKey)}/settings/models/presets" method="POST" class="settings-form models-preset-save" data-testid="models-preset-save-form">
        <label class="settings-field"><span class="settings-field-label">Save the current table as</span>
          <input type="text" name="name" class="settings-field-control" maxlength="80" required placeholder="A name">
        </label>
        <label class="settings-ask-label">Why?
          <textarea name="reason" required maxlength="500" rows="2" class="settings-ask-reason" data-testid="models-preset-reason"></textarea>
        </label>
        <button type="submit" class="btn btn--primary" data-testid="models-preset-save">Save preset</button>
      </form>`;
  return group({
    title: 'Routing presets', testid: 'models-presets',
    rowsHtml: listHtml,
    note: 'A preset is a saved copy of every job and group setting. Applying one replaces them all.'
  }) + saveForm;
}

function logBody({ urlKey, entries }) {
  if (!entries.length) return staticRow({ label: 'No model changes yet', valueHtml: '', testid: 'models-log-empty' });
  // An undo entry names the entry it reverses, so an undone change is shown as such and cannot be undone twice.
  const undone = new Set(entries.filter((e) => e.undoes).map((e) => e.undoes));
  return entries.slice(0, MAX_LIST).map((e) => {
    const what = e.changes?.length
      ? e.changes.map((c) => `${c.key}${c.field ? ` ${c.field}` : ''} → ${c.to ?? 'follow the group'}`).join('; ')
      : (e.kind === 'preset-save' ? 'saved a preset' : 'no change');
    const isUndone = undone.has(e._id);
    const undoable = !['undo', 'preset-save'].includes(e.kind) && (e.changes?.length || 0) > 0 && !isUndone;
    const when = formatRelativeTime(e.at);
    const who = e.actor?.name || (e.actor?.via === 'proxy' ? 'an agent' : 'someone');
    return staticRow({
      label: `${who} · ${when}${isUndone ? ' · undone' : ''}`,
      valueHtml: escapeHtml(what),
      note: e.reason || '',
      extraHtml: undoable
        ? askInPlace({
          summary: 'Undo', value: '', willHappen: 'Put back the values this change replaced. Refused if a later change touched them.',
          askWhy: true, action: `/workspace/${encodeURIComponent(urlKey)}/settings/change-log/model/${encodeURIComponent(e._id)}/undo`,
          fields: [['back', 'models']], confirmLabel: 'Undo this change', tone: 'red', cancelHref: settingsAreaUrl(urlKey, 'models'),
          testid: `models-undo-${e._id}`
        })
        : '',
      testid: `models-log-${e._id}`
    });
  }).join('');
}

/**
 * The Models body. `data` is what the route gathered (see routes/settings.js); it reads nothing itself.
 *
 * @param {Object} data
 * @param {string} data.urlKey
 * @param {Object} data.table - the stored table (the panels show its own values)
 * @param {Object} data.effective - effectiveTable(...) output, the values the rows show
 * @param {Array} data.agentSpend - agentSpendByJob(...)
 * @param {Array} data.harbourSpend - harbourSpendByJob(...)
 * @param {Array} data.presets - listPresets(...)
 * @param {Array} data.log - the model-routing log, newest first
 * @param {Array} data.catalog - the live catalog ({id, name, free})
 * @param {Array} data.availableModels - AVAILABLE_MODELS
 * @param {string} [data.filter='all'] - 'all' or 'set'
 * @param {Object|null} [data.flash] - `{ message, values }` from a refused save
 * @param {Object} [data.coverage] - `{ windowRuns, capped }` for the history read
 */
export function modelsBody(data) {
  const { urlKey, table, effective, agentSpend, harbourSpend, presets, log, catalog = [], availableModels = [], filter = 'all', flash = null, coverage = null, notice = null } = data;
  const name = modelNamer({ catalog, availableModels });
  const values = flash?.values || null;
  const harbourCurated = availableModels.map((m) => m.id);
  const rows = rowsBody({ table, effective, agentSpend, harbourSpend, name, catalog, values, filter, harbourCurated });
  const error = flash?.message ? statusLine({ tone: 'bad', text: flash.message, testid: 'models-error' }) : '';
  const noticeHtml = notice && !error ? statusLine({ tone: 'ok', text: notice, testid: 'models-notice' }) : '';
  const coverageText = coverage?.capped
    ? groupNote(`Spend covers the newest ${coverage.windowRuns} runs in the last 30 days; older runs are not counted.`)
    : '';
  const coverageNote = groupNote('Spend is what the window priced. A run with no price, or with no usage reported, is shown as such, never as $0.');

  const form = `
    <form action="/workspace/${encodeURIComponent(urlKey)}/settings/models/changes" method="POST" class="settings-form models-form" data-testid="models-changes-form" data-models-form>
      <input type="hidden" name="version" value="${effective.version}">
      ${error}
      ${group({ title: 'Agent sessions, by spend', testid: 'models-agent-jobs', rowsHtml: rows.agentJobs.join('') || staticRow({ label: 'No jobs', valueHtml: '' }), note: 'Priced spend over the last 30 days, largest first.' })}
      ${group({ title: 'Agent groups', testid: 'models-agent-groups', rowsHtml: rows.agentGroupRows.join('') + rows.agentDefault, note: 'A job with no setting of its own follows its group. The group with no setting follows the default.' })}
      ${group({ title: 'Harbour calls, by spend', testid: 'models-harbour-jobs', rowsHtml: rows.harbourJobs.join('') || staticRow({ label: 'No jobs', valueHtml: '' }), note: 'Calls Harbour makes itself. Each one is priced where OpenRouter reported a cost.' })}
      ${group({ title: 'Harbour groups', testid: 'models-harbour-groups', rowsHtml: rows.harbourGroupRows.join('') })}
      <div class="models-save">
        <label class="settings-ask-label">Why are these changes being made?
          <textarea name="reason" required maxlength="500" rows="2" class="settings-ask-reason" data-testid="models-reason"></textarea>
        </label>
        <p class="settings-note" data-testid="models-staged" data-models-staged aria-live="polite">No changes yet.</p>
        <button type="submit" class="btn btn--primary" data-testid="models-save">Save changes</button>
      </div>
    </form>`;

  return `
    ${noticeHtml}${filterLinks({ urlKey, filter })}
    ${coverageNote}${coverageText}
    ${form}
    ${presetsBody({ urlKey, presets, version: effective.version })}
    ${group({ title: 'Recent model changes', testid: 'models-log', rowsHtml: logBody({ urlKey, entries: log }), note: 'Undo puts back what a change replaced. The whole change log is in Change log.' })}`;
}
