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
import { decisionPanel, fieldName, agentOptions, agentLists, suggestionsByHarness, routingWords, usdWords } from './components/decision-panel.js';
import { spendBar } from './components/settings-spend-bar.js';
import { settingsAreaUrl } from './settings-areas.js';
import { AGENT_JOB_IDS, HARBOUR_JOB_IDS, effectiveTable } from './model-routing.js';
import { JOBS, GROUPS, SURFACES, getJob } from './llm-jobs.js';
import { harnessInForce } from './model-routing-harnesses.js';
import { buildModelOptions } from './openrouter-catalog.js';
import { formatRelativeTime } from './render.js';
import { byJobSpend, totalSpend, shareOf } from './model-routing-spend.js';
import { DEFAULT_MODEL, getModelDisplayName } from './openrouter.js';
import { actorLabel } from './render-settings-workspace.js';
import { FORMER_MEMBER } from './workspace-change-log.js';
import { modelChangeLines, jobWords, groupWords } from './components/model-change-lines.js';

export { agentOptions };

const { AGENT_SESSION, HARBOUR_CALL } = SURFACES;
const GROUP_IDS = Object.keys(GROUPS);

/** The groups on a surface that have at least one job on it, in the registry's order. */
const groupsWithJobs = (surface) => GROUP_IDS.filter((g) => JOBS.some((j) => j.surface === surface && j.group === g));

/**
 * Whether anything in the table sets an agent value: the agent default, an agent group, or an agent job. With the
 * runner and the runs, this decides whether the agent rows apply to this workspace (LIN-3952 item 6).
 */
export function agentHasSetting(table) {
  const set = (values) => Object.values(values || {}).some((v) => v !== null && v !== undefined && v !== '');
  if (set(table.defaults?.[AGENT_SESSION])) return true;
  if (Object.values(table.groups?.[AGENT_SESSION] || {}).some(set)) return true;
  return AGENT_JOB_IDS.some((id) => set(table.jobs?.[id]));
}
const MAX_LIST = 25;
/** How many jobs with runs stay at rest in each section; the rest, and the jobs with no runs, fold behind "Show N more" (LIN-3952). */
export const FOLD_KEEP = 6;

/** A job id as words for a Harbour call: `plan-review` reads "Plan review". Agent jobs use their stage word (jobWords). */
export const jobLabel = (id) => jobWords(id, HARBOUR_CALL);

const groupLabel = groupWords;

/** A Harbour-call model option set: the curated OpenRouter ids the call sites offer, plus the live catalog. */
export function harbourOptions(curatedIds, catalog) {
  return buildModelOptions({ curatedIds, catalog });
}

/**
 * Where a field's value comes from, as the row words it. A Harbour call with nothing stored runs on the server's default
 * (DEFAULT_MODEL, or the free-tier model), so it says so rather than "not set" (LIN-3952 item 6). Named once, here.
 */
function sourceWords(source, groupId, { harbour = false } = {}) {
  if (source === 'job') return 'set here';
  if (source === 'group') return `from ${groupLabel(groupId)}`;
  return harbour ? 'server default' : 'not set';
}

/** `Make · Claude Sonnet 5 · set here`. The harness shows only when it is set. */
function valueWords({ harness, model, source, groupId, harbour = false }) {
  const parts = [];
  if (harness) parts.push(harness);
  parts.push(model ? getModelDisplayName(model) : 'no model');
  parts.push(sourceWords(source.model, groupId, { harbour }));
  return parts.join(' · ');
}

/** What the window shows the job ran on, beyond what it is set to: `also ran on X (N of M)`. Names are display names (LIN-3987). */
function alsoRan(spend, configuredModel) {
  if (!spend || !spend.models.length) return '';
  const others = spend.models.filter((m) => m !== configuredModel);
  if (!others.length) return '';
  return `also ran on ${others.map((m) => getModelDisplayName(m)).join(', ')} (${others.length} of ${spend.models.length} models in the window)`;
}

/** What a job's blank field resolves to: the effective row with the job's own value for that field cleared (LIN-3962). */
function resolvedWithout(table, jobId, field) {
  const own = { ...(table.jobs[jobId] || {}) };
  delete own[field];
  const cleared = { ...table, jobs: { ...table.jobs, [jobId]: own } };
  const row = effectiveTable(cleared, { defaultModel: DEFAULT_MODEL }).jobs.find((j) => j.id === jobId);
  return row?.[field] ?? null;
}

/** The numbers a panel shows for one job: its own spend, and its share of the page's priced spend. */
function spendNumbers(spend, totalForShare) {
  const share = shareOf(spend, totalForShare);
  return {
    runs: spend.runs, priced: spend.priced, unpriced: spend.unpriced, noTelemetry: spend.noTelemetry,
    spendUsd: spend.spendUsd, typicalUsd: spend.typicalUsd, share
  };
}

/**
 * A job's figures at rest, on its row (LIN-3952 item 1): its total, its typical run and a share bar. Nothing for a job
 * with no runs (its "no runs" flag says so), and "unpriced" for runs that carry no price, never $0.
 */
function rowFigures(spend, totalForShare) {
  if (!spend.runs) return '';
  const testid = `models-figures-${spend.id}`;
  if (!spend.priced) return `<span class="settings-row-figures" data-testid="${testid}"><span class="settings-row-total">unpriced</span></span>`;
  const share = shareOf(spend, totalForShare);
  const bar = share === null ? '' : spendBar({ share, label: `${Math.round(share * 100)}% of priced spend in 30 days`, testid: `models-row-share-${spend.id}` });
  const typical = spend.typicalUsd === null ? '' : `<span class="settings-row-typical">typical ${usdWords(spend.typicalUsd)} a run</span>`;
  return `<span class="settings-row-figures" data-testid="${testid}"><span class="settings-row-total">${usdWords(spend.spendUsd)}</span>${typical}${bar}</span>`;
}

/**
 * The slot a row's pending value fills while it is staged (LIN-3952 item 4). Hidden on the server; the client shows it
 * with the value the field will save, in the words the row uses. It sits in the summary, so a closed row shows it.
 */
const PENDING_SLOT = '<span class="models-row-pending" data-models-pending hidden></span>';

/** The row ids a saved entry touched, so the page can mark those rows (and open a fold that holds one). */
export function savedRowIds(entry) {
  if (!entry) return new Set();
  const ids = (entry.changes || []).map((c) => {
    if (c.scope === 'job') return `models-job-${c.key}`;
    if (c.scope === 'group') return `models-group-${c.surface}-${c.key}`;
    return null;
  });
  return new Set(ids.filter(Boolean));
}

/** A section's total, in words for its title: the priced spend of its jobs over the window (LIN-3952 item 1). */
function sectionTotal(spends) {
  const total = totalSpend(spends);
  return spends.some((s) => s.priced) ? `${usdWords(total)} priced in 30 days` : '';
}

/** A panel's own testid, the same shape every page's panel has always carried. */
const panelTestid = (target) => `models-panel-${target.scope}-${target.surface}-${target.key}`;

/**
 * The staged rows: agent jobs and agent groups, the agent default, Harbour jobs and groups.
 * `values` (from a refused save) overrides what a field shows, so a refusal keeps the staged edits.
 */
function rowsBody({ table, effective, agentSpend, harbourSpend, catalog, values, filter, harbourCurated, agentTypicals, saved }) {
  const byId = new Map(effective.jobs.map((j) => [j.id, j]));
  const shown = (field, actual) => (values && Object.hasOwn(values, field) ? values[field] : actual);
  const isSet = (job) => job.source.model === 'job' || job.source.harness === 'job' || job.source.effort === 'job';
  const include = (job) => filter !== 'set' || isSet(job);
  const registry = new Map(JOBS.map((j, i) => [j.id, i]));
  const totalPriced = totalSpend(agentSpend);
  const harbourTotal = totalSpend(harbourSpend);

  const agentSpendById = new Map(agentSpend.map((s) => [s.id, s]));
  const harbourSpendById = new Map(harbourSpend.map((s) => [s.id, s]));
  const agentOrder = [...AGENT_JOB_IDS].map((id) => agentSpendById.get(id) || { id, runs: 0, spendUsd: 0, models: [], priced: 0 })
    .sort(byJobSpend(registry));
  const harbourOrder = [...HARBOUR_JOB_IDS].map((id) => harbourSpendById.get(id) || { id, runs: 0, spendUsd: 0, models: [], priced: 0 })
    .sort(byJobSpend(registry));

  const jobItem = (spend, surface, totalForShare) => ({
    id: spend.id, runs: spend.runs, surface,
    staged: saved.has(`models-job-${spend.id}`) || (!!values && Object.keys(values).some((k) => k.startsWith(`c__job__${surface}__${spend.id}__`))),
    html: jobRow(spend, surface, totalForShare)
  });

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
    // What the group resolves to today, in words: the harness the field would be judged by is the resolved one (LIN-3987).
    const resolved = routingWords({
      harness: resolvedWithout(table, job.id, 'harness'),
      model: resolvedWithout(table, job.id, 'model'),
      effort: resolvedWithout(table, job.id, 'effort')
    });
    const follow = (field) => `Follow ${groupLabel(groupId)} (${resolved[field]})`;
    const panel = decisionPanel({
      testid: panelTestid(target),
      numbers: { ...spendNumbers(spend, totalForShare), heading: 'Last 30 days', testid: `models-spend-${job.id}`, shareTestid: `models-share-${job.id}` },
      harness: isAgent ? { value: harness, inForce: harnessInForce(row.harness), follow: follow('harness') } : null,
      model: {
        value: model, follow: follow('model'),
        lists: isAgent ? agentLists(catalog) : { any: harbourOptions(harbourCurated, catalog) },
        suggestions: isAgent ? suggestionsByHarness(agentTypicals[job.id] || []) : {}
      },
      effort: { value: effort, follow: follow('effort') },
      nameOf: (field) => fieldName({ ...target, field }),
      fieldAttrs: (field) => `data-models-field="${field}"`,
      withEffort: isAgent, autoSwitch: isAgent, clearEffort: isAgent
    });
    const label = `models-job-${job.id}`;
    const ran = alsoRan(spend, row.model);
    const note = row.effortNotApplied ? `Effort ${row.effortNotApplied.stored} is not applied on ${row.effortNotApplied.harness}.` : '';
    const bodyHtml = `
      <p class="settings-note">${escapeHtml(job.description)}</p>${panel}${ran ? `\n      ${groupNote(ran)}` : ''}${note ? `\n      ${groupNote(note)}` : ''}`;
    return drillRow({
      label: jobWords(job.id, surface),
      value: valueWords({ harness: isAgent ? harness : null, model: model || row.model, source: row.source, groupId, harbour: !isAgent }),
      bodyHtml,
      testid: label,
      id: label,
      flagHtml: [spend.runs === 0 ? '<span class="settings-row-flag">no runs</span>' : '', saved.has(label) ? '<span class="settings-row-flag">saved</span>' : ''].join(''),
      figuresHtml: rowFigures(spend, totalForShare) + PENDING_SLOT,
      attrs: saved.has(label) ? ' data-saved="true" data-models-row' : ' data-models-row'
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
    const panel = decisionPanel({
      testid: panelTestid(target),
      harness: isAgent ? { value: harness, inForce: harnessInForce(harness), follow: 'Not set' } : null,
      model: {
        value: model, follow: 'Not set',
        lists: isAgent ? agentLists(catalog) : { any: harbourOptions(harbourCurated, catalog) },
        suggestions: isAgent ? suggestionsByHarness([]) : {}
      },
      effort: { value: effort, follow: 'Not set' },
      nameOf: (field) => fieldName({ ...target, field }),
      fieldAttrs: (field) => `data-models-field="${field}"`,
      withEffort: isAgent, autoSwitch: isAgent, clearEffort: isAgent
    });
    const id = `models-group-${surface}-${groupId}`;
    return drillRow({
      label: groupLabel(groupId),
      value: `${model ? getModelDisplayName(model) : 'no model'}${isAgent && harness ? ` · ${harness}` : ''} · ${reached.length} job${reached.length === 1 ? '' : 's'}, ${setHere} set here`,
      bodyHtml: `<p class="settings-note">${escapeHtml(GROUPS[groupId])}</p>${panel}`,
      testid: id,
      id,
      flagHtml: saved.has(id) ? '<span class="settings-row-flag">saved</span>' : '',
      figuresHtml: PENDING_SLOT,
      attrs: saved.has(id) ? ' data-saved="true" data-models-row' : ' data-models-row'
    });
  };

  const agentJobs = agentOrder.filter((s) => include(byId.get(s.id))).map((s) => jobItem(s, AGENT_SESSION, totalPriced));
  const harbourJobs = harbourOrder.filter((s) => include(byId.get(s.id))).map((s) => jobItem(s, HARBOUR_CALL, harbourTotal));
  // A group with no job on its surface has nothing to set, so it is not listed (LIN-3952 item 6): agent `tell`, and
  // Harbour `judge`, `plan` and `make`, all come from the registry.
  const agentGroupRows = groupsWithJobs(AGENT_SESSION).map((g) => groupRow(g, AGENT_SESSION));
  const harbourGroupRows = groupsWithJobs(HARBOUR_CALL).map((g) => groupRow(g, HARBOUR_CALL));
  return { agentJobs, harbourJobs, agentGroupRows, harbourGroupRows };
}

/**
 * A section's job rows: the first FOLD_KEEP jobs with runs at rest, and everything after them behind one native
 * "Show N more" row (LIN-3952). A controls inside a closed fold still post, so a staged value survives; the fold opens
 * on its own when it holds a refused value. `items` are in priced-spend order and keep it.
 */
function foldedRows(items, testid) {
  const shown = [];
  const rest = [];
  for (const item of items) {
    if (item.runs > 0 && shown.length < FOLD_KEEP) shown.push(item.html);
    else rest.push(item);
  }
  if (!rest.length) return shown.join('');
  const open = rest.some((item) => item.staged);
  return `${shown.join('')}
      <details class="models-fold" data-testid="${testid}" data-models-fold${open ? ' open' : ''}>
        <summary class="models-fold-summary">Show ${rest.length} more</summary>${rest.map((item) => item.html).join('')}
      </details>`;
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
        <label class="settings-field"><span class="settings-field-label">Name</span>
          <input type="text" name="name" class="settings-field-control" maxlength="80" required placeholder="A name">
        </label>
        <label class="settings-ask-label">Why?
          <textarea name="reason" required maxlength="500" rows="2" class="settings-ask-reason" data-testid="models-preset-reason"></textarea>
        </label>
        <button type="submit" class="btn btn--primary" data-testid="models-preset-save">Save routing preset</button>
      </form>`;
  return group({
    title: 'Routing presets', testid: 'models-presets',
    rowsHtml: listHtml,
    note: 'A routing preset is a saved copy of every job and group setting, for Models only. Applying one replaces them all, as one change in the log.'
  }) + saveForm;
}

function logBody({ urlKey, entries, viewerAccountId = null }) {
  if (!entries.length) return staticRow({ label: 'No model changes yet', valueHtml: '', testid: 'models-log-empty' });
  // An undo entry names the entry it reverses, so an undone change is shown as such and cannot be undone twice.
  const undone = new Set(entries.filter((e) => e.undoes).map((e) => e.undoes));
  return entries.slice(0, MAX_LIST).map((e) => {
    // One line per job, in display names and stage words (LIN-3952). A preset save or an empty entry has no lines.
    const lines = e.changes?.length ? modelChangeLines(e.changes) : [];
    const what = lines.length ? lines.map(escapeHtml).join('<br>') : (e.kind === 'preset-save' ? 'saved a preset' : 'no change');
    const isUndone = undone.has(e._id);
    const undoable = !['undo', 'preset-save'].includes(e.kind) && (e.changes?.length || 0) > 0 && !isUndone;
    const when = formatRelativeTime(e.at);
    // The same "You" rule the Change log uses, through its one adapter (LIN-3952): the viewer's own change reads "You".
    const who = actorLabel({ actorName: e.actor?.name || FORMER_MEMBER, actorId: e.actor?.id || null, actorVia: e.actor?.via || null }, viewerAccountId);
    return staticRow({
      label: `${who} · ${when}${isUndone ? ' · undone' : ''}`,
      valueHtml: what,
      note: e.reason || '',
      extraHtml: undoable
        ? askInPlace({
          summary: 'Undo', value: '', willHappen: 'Put back the values this change replaced. Refused if a later change touched them.',
          askWhy: true, action: `/workspace/${encodeURIComponent(urlKey)}/settings/change-log/model/${encodeURIComponent(e._id)}/undo`,
          fields: [['back', 'models']], confirmLabel: 'Undo this change', tone: 'teal', cancelHref: settingsAreaUrl(urlKey, 'models'),
          testid: `models-undo-${e._id}`
        })
        : '',
      testid: `models-log-${e._id}`
    });
  }).join('');
}

/**
 * The notice after a save (LIN-3952 item 9): how many rows it saved, and one Undo that reverts all of them at once.
 * The Undo is the change log's own undo for this entry, so it is refused the same way a later change is.
 */
function savedNotice({ urlKey, entry, rows }) {
  const plural = rows === 1 ? '' : 's';
  const undoable = !['undo', 'preset-save'].includes(entry.kind) && (entry.changes?.length || 0) > 0;
  const undo = undoable ? askInPlace({
    summary: `Undo this save (${rows} row${plural})`, value: '', askWhy: true,
    willHappen: `Put back what this save replaced, for all ${rows} row${plural} at once. Refused if a later change touched them.`,
    action: `/workspace/${encodeURIComponent(urlKey)}/settings/change-log/model/${encodeURIComponent(entry._id)}/undo`,
    fields: [['back', 'models']], confirmLabel: 'Undo this save', tone: 'teal', cancelHref: settingsAreaUrl(urlKey, 'models'),
    testid: `models-saved-undo-${entry._id}`
  }) : '';
  return `<div class="models-saved" data-testid="models-saved">${statusLine({ tone: 'ok', text: `Saved ${rows} row${plural}.`, testid: 'models-notice' })}${undo}</div>`;
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
 * @param {Object} [data.agentTypicals] - `{ [jobId]: typicalByModel(...) }`: each agent job's typical cost per model (LIN-3962)
 * @param {string|null} [data.viewerAccountId] - the viewer's account id: their own log entry reads "You" (LIN-3952)
 * @param {boolean} [data.hasRunner] - a live runner key or queue token exists (agent rows apply when it does)
 * @param {string|null} [data.freeTierModel] - the free-tier model, when the viewer is on the free tier (LIN-3952)
 */
export function modelsBody(data) {
  const { urlKey, table, effective, agentSpend, harbourSpend, presets, log, catalog = [], availableModels = [], filter = 'all', flash = null, coverage = null, notice = null, agentTypicals = {}, viewerAccountId = null, savedEntry = null, hasRunner = false, freeTierModel = null } = data;
  const values = flash?.values || null;
  const harbourCurated = availableModels.map((m) => m.id);
  const saved = savedRowIds(savedEntry);
  const rows = rowsBody({ table, effective, agentSpend, harbourSpend, catalog, values, filter, harbourCurated, agentTypicals, saved });
  // Agent rows apply when this workspace can run them, has run one, or stores an agent setting (LIN-3952 item 6). Until
  // then they are one line, so the twenty agent jobs of an empty workspace do not read as work to do.
  const agentShown = Boolean(hasRunner) || agentSpend.some((s) => s.runs > 0) || agentHasSetting(table);
  const agentSections = agentShown
    ? `${group({ title: 'Agent sessions, by spend', meta: sectionTotal(agentSpend), testid: 'models-agent-jobs', rowsHtml: foldedRows(rows.agentJobs, 'models-fold-agent') || staticRow({ label: 'No jobs', valueHtml: '' }), note: 'Priced spend over the last 30 days, largest first.' })}
      ${group({ title: 'Agent groups', testid: 'models-agent-groups', rowsHtml: rows.agentGroupRows.join(''), note: 'A job with no setting of its own follows its group. A group with no setting is not set.' })}`
    : group({ title: 'Agent sessions', testid: 'models-agent-jobs', rowsHtml: staticRow({ label: 'Agent sessions appear once steps run from Harbour', valueHtml: '' }) });
  // On the free tier every Harbour call runs the free model, whatever is set; the clamp is per call, so this says it once (LIN-3952).
  const freeNote = freeTierModel ? ` On the free tier, Harbour calls run ${getModelDisplayName(freeTierModel)} whatever is set here.` : '';
  const error = flash?.message ? statusLine({ tone: 'bad', text: flash.message, testid: 'models-error' }) : '';
  const noticeHtml = savedEntry && !error ? savedNotice({ urlKey, entry: savedEntry, rows: saved.size })
    : notice && !error ? statusLine({ tone: 'ok', text: notice, testid: 'models-notice' }) : '';
  const coverageText = coverage?.capped
    ? groupNote(`Spend covers the newest ${coverage.windowRuns} runs in the last 30 days; older runs are not counted.`)
    : '';
  const coverageNote = groupNote('Spend is what the last 30 days priced. A run with no price, or no usage reported, shows as unpriced, never as $0.');

  const form = `
    <form action="/workspace/${encodeURIComponent(urlKey)}/settings/models/changes" method="POST" class="settings-form models-form" data-testid="models-changes-form" data-models-form>
      <input type="hidden" name="version" value="${effective.version}">
      ${error}
      ${agentSections}
      ${group({ title: 'Harbour calls, by spend', meta: sectionTotal(harbourSpend), testid: 'models-harbour-jobs', rowsHtml: foldedRows(rows.harbourJobs, 'models-fold-harbour') || staticRow({ label: 'No jobs', valueHtml: '' }), note: `Calls Harbour makes itself. Each one is priced where OpenRouter reported a cost.${freeNote}` })}
      ${group({ title: 'Harbour groups', testid: 'models-harbour-groups', rowsHtml: rows.harbourGroupRows.join('') })}
      <div class="models-save" data-testid="models-bar" data-models-bar>
        <p class="settings-note models-save-count" data-testid="models-staged" data-models-staged aria-live="polite">No changes yet.</p>
        <label class="settings-ask-label models-save-reason">Why
          <input type="text" name="reason" required maxlength="500" class="settings-ask-reason" data-testid="models-reason" placeholder="Why these models are changing">
        </label>
        <div class="models-save-actions">
          <a class="btn--quiet" href="${escapeHtml(settingsAreaUrl(urlKey, 'models'))}" data-models-discard data-testid="models-discard">Discard</a>
          <button type="submit" class="btn btn--primary" data-testid="models-save">Save</button>
        </div>
      </div>
    </form>`;

  return `
    ${noticeHtml}${filterLinks({ urlKey, filter })}
    ${coverageNote}${coverageText}
    ${form}
    ${presetsBody({ urlKey, presets, version: effective.version })}
    ${group({ title: 'Recent model changes', testid: 'models-log', rowsHtml: logBody({ urlKey, entries: log, viewerAccountId }), note: 'Undo puts back what a change replaced. The whole change log is in Change log.' })}`;
}
