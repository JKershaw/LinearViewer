/**
 * The model-routing table, as pure functions (LIN-3853, step 2 of LIN-3820).
 *
 * One per-workspace table says, for every job in the registry (lib/llm-jobs.js), which
 * harness, model and effort it runs on (agent sessions) or which model (Harbour calls).
 * `lib/model-routing-store.js` persists it; this file is the part with no I/O: the
 * shape, the migration from the old preference fields, resolution, the diff and the
 * projection back onto the shape the old Settings forms read.
 *
 *   { version, jobs: { [jobId]: { harness?, model?, effort? } },
 *     groups: { 'agent-session': { [group]: row }, 'harbour-call': { [group]: { model? } } },
 *     defaults: { 'agent-session': row, 'harbour-call': { model? } } }
 *
 * A field that is absent is blank, and blank stays blank so SD's workspaces.json
 * fallback is unchanged. Resolution for a job is the job's own row, then its group's row,
 * field by field (explicit fields and the preset tiers sit above this, in the dispatch
 * factory). `defaults` is the workspace-wide value the old forms and the callers that
 * have no job still read; it is not a resolution tier for a job.
 *
 * The migration copies values verbatim (empty strings included) so the witness test
 * (tests/unit/model-routing-witness.test.js) can prove the table answers exactly as the
 * resolvers did at 6ea1371e, whatever state hand-edited preferences were in.
 */
import { GROUPS, JOBS, SURFACES, getJob } from './llm-jobs.js';
import { DISPATCH_DEFAULT_KINDS } from './prompt-templates.js';

const { AGENT_SESSION, HARBOUR_CALL } = SURFACES;

/**
 * The set of in-workspace AI operations that can carry per-operation model
 * overrides (LIN-2197 Phase 5 added `scan`, closing Phase 4 close-out ledger
 * item L1 — the scan route already reads `byKind.scan` via
 * `resolveAiOperationModel({ opKind: 'scan' })`, but the override was
 * unreachable through the product since `scan` was absent from this list;
 * LIN-2623 added `flight-companion` and, closing the LIN-1184 gap in the same
 * pass, `ship-biscuit`); experimental operations and the trivial
 * `feedback-title` call are deliberately excluded.
 *
 * Moved here from lib/workspace-preferences.js (which re-exports it) so the migration
 * can name it without an import cycle (LIN-3853).
 */
export const AI_OPERATION_KINDS = ['recommend', 'recap', 'brief', 'scan', 'run-summary', 'session-summary', 'flight-companion', 'ship-biscuit', 'task-chat'];

/** Fields a setting can carry, per surface. Harbour calls pick a model and nothing else. */
export const FIELDS = Object.freeze({
  [AGENT_SESSION]: Object.freeze(['harness', 'model', 'effort']),
  [HARBOUR_CALL]: Object.freeze(['model'])
});

/**
 * Jobs that do not resolve from the table at all, so a stored setting for them would be
 * read by nothing. The effective-setting read says so rather than showing a model that
 * does not run. Empty since LIN-3856 (D2): `run-paragraph` and the session-summary
 * precompute now resolve through `jobModelResolver`. The shape stays for LIN-3855.
 */
export const UNROUTED_JOBS = Object.freeze([]);

/**
 * A Harbour-call model id: provider/model with an optional :variant, dots allowed for
 * versions (claude-3.5-sonnet). The proxy write route uses this (LIN-3854); the two
 * legacy form copies in routes/settings-model.js are left alone, as LIN-3855 retires them.
 */
export const MODEL_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

/** The jobs that sit on a surface, as ids. */
const idsOn = (surface) => JOBS.filter((j) => j.surface === surface).map((j) => j.id);
export const AGENT_JOB_IDS = Object.freeze(idsOn(AGENT_SESSION));
export const HARBOUR_JOB_IDS = Object.freeze(idsOn(HARBOUR_CALL));
export const GROUP_IDS = Object.freeze(Object.keys(GROUPS));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Copy a row verbatim, keeping only the surface's fields and skipping absent ones. */
function pickRow(source, surface) {
  const row = {};
  if (!isObject(source)) return row;
  for (const field of FIELDS[surface]) {
    if (source[field] !== undefined) row[field] = source[field];
  }
  return row;
}

export function emptyTable() {
  const table = { version: 0, jobs: {}, groups: { [AGENT_SESSION]: {}, [HARBOUR_CALL]: {} }, defaults: { [AGENT_SESSION]: {}, [HARBOUR_CALL]: {} } };
  for (const g of GROUP_IDS) {
    table.groups[AGENT_SESSION][g] = {};
    table.groups[HARBOUR_CALL][g] = {};
  }
  return table;
}

/**
 * Migration: the old preference fields as a table. Pure, so the resolvers can also use
 * it where no routing store is wired (tests that hand them a bare preferences fake).
 *
 * - `dispatchDefaults.byKind[k]`, for `k` in DISPATCH_DEFAULT_KINDS, is job `k`'s own row,
 *   partial rows kept partial. A stray `byKind.custom` or `periodical` is ignored, as the
 *   old resolver ignores it.
 * - `aiModelOverrides.byKind[op].model`, for `op` in AI_OPERATION_KINDS, is job `op`'s own
 *   model; `scan` also seeds `scan-retire` (the scan route reads one override for both).
 * - Every agent group and the agent default take the top-level `dispatchDefaults`; every
 *   Harbour group and the Harbour default take `prefs.modelId`.
 */
export function tableFromPreferences(prefs) {
  const p = isObject(prefs) ? prefs : {};
  const table = emptyTable();
  const top = pickRow(p.dispatchDefaults, AGENT_SESSION);
  const byKind = isObject(p.dispatchDefaults?.byKind) ? p.dispatchDefaults.byKind : {};
  const overrides = isObject(p.aiModelOverrides?.byKind) ? p.aiModelOverrides.byKind : {};

  table.defaults[AGENT_SESSION] = { ...top };
  const harbourDefault = p.modelId !== undefined ? { model: p.modelId } : {};
  table.defaults[HARBOUR_CALL] = { ...harbourDefault };
  for (const g of GROUP_IDS) {
    table.groups[AGENT_SESSION][g] = { ...top };
    table.groups[HARBOUR_CALL][g] = { ...harbourDefault };
  }
  for (const kind of DISPATCH_DEFAULT_KINDS) {
    if (!getJob(kind) || getJob(kind).surface !== AGENT_SESSION) continue;
    const row = pickRow(byKind[kind], AGENT_SESSION);
    if (Object.keys(row).length) table.jobs[kind] = row;
  }
  for (const op of AI_OPERATION_KINDS) {
    const model = isObject(overrides[op]) ? overrides[op].model : undefined;
    if (model === undefined) continue;
    table.jobs[op] = { model };
    if (op === 'scan') table.jobs['scan-retire'] = { model };
  }
  return table;
}

/**
 * Row-atomic resolution (LIN-1694, LIN-2615), shared by the legacy resolver
 * (`resolveRoutingFromConfig`, rows `[byKind, cfg]`) and the table (rows `[job, group]`),
 * so there is one copy of the eligibility logic.
 *
 * Harness is the first row that states one (`??`, so an empty string states one). Model
 * and effort are resolved row by row: a row SCOPED to a harness other than
 * `harnessInForce` may not donate, and is skipped rather than terminal, so the next row
 * down still answers. A blank harness on a row means "inherit" (LIN-1111) and so
 * donates. `harnessInForce` omitted/null disables the check.
 *
 * Returns the winning value and the index of the row that gave it (-1 for none), so the
 * table can say where a field came from.
 */
export function resolveFields(rows, { harnessInForce = null } = {}) {
  const donates = (row) => {
    const scopedTo = row.harness ?? null;
    return !harnessInForce || !scopedTo || scopedTo === harnessInForce;
  };
  const out = { harness: null, model: null, effort: null, from: { harness: -1, model: -1, effort: -1 } };
  rows.some((row, i) => {
    if ((row.harness ?? null) === null) return false;
    out.harness = row.harness;
    out.from.harness = i;
    return true;
  });
  for (const field of ['model', 'effort']) {
    rows.some((row, i) => {
      if ((row[field] ?? null) === null) return false;
      if (!donates(row)) return false;
      out[field] = row[field];
      out.from[field] = i;
      return true;
    });
  }
  return out;
}

/** The values-only form of `resolveFields`. */
export function resolveFromRows(rows, options) {
  const { harness, model, effort } = resolveFields(rows, options);
  return { harness, model, effort };
}

/**
 * LIN-3857 (D3): harnesses with no effort control. Where the harness in force is one of these the
 * effort that RUNS is null (SD's resolveEffort says the same on its side, LIN-3857 PR 1) and any
 * effort that was asked for or stored is REPORTED as not applied. The gate is applied where a value
 * is USED (the dispatch stamp, `effectiveTable`, the prefill), never inside `resolveFields` and the
 * resolvers built on it: those stay value-faithful so a preset/anchor effort is still there to
 * report. A null or blank harness applies (the default-harness interpose may still land on
 * claude-code, which keeps effort).
 */
export const HARNESSES_WITHOUT_EFFORT = Object.freeze(['opencode']);

export function effortAppliesTo(harness) {
  return !(typeof harness === 'string' && HARNESSES_WITHOUT_EFFORT.includes(harness));
}

/** `{ stored, harness }` when a resolved `{ harness, effort }` row has an effort its harness ignores, else null. */
export function effortNotAppliedForRow(row) {
  if (!row || !row.effort || effortAppliesTo(row.harness)) return null;
  return { stored: row.effort, harness: row.harness };
}

/**
 * LIN-3857 (D3): the dispatch page's prefill. `resolveDispatchDefaults` stays ungated; the page
 * must not promise an effort that will not run, so it drops the effort where the default harness
 * ignores it.
 */
export function prefillDefaults(defaults) {
  const d = defaults || {};
  return effortAppliesTo(d.harness) ? d : { ...d, effort: null };
}

const SOURCES = ['job', 'group'];

/**
 * LIN-3857 (D3): for the changes a write made, the agent-session jobs that now carry an effort
 * their harness ignores, as `[{ job, stored, harness }]` (empty when none). `table` is the
 * POST-write table and the check uses its ungated resolution, so what is reported is the stored
 * value and the harness it will run on. Only `harness` and `effort` changes can create the
 * mismatch. A job change names that job; a group change, that group's agent-session jobs; a
 * default change reports the default row itself (`job: null, scope: 'default'`), never the registry
 * jobs, because the default is not a resolution tier for a job.
 */
export function effortNotAppliedForChanges(table, changes) {
  const out = [];
  const seen = new Set();
  const report = (job, row) => {
    const notApplied = effortNotAppliedForRow(row);
    if (!notApplied || seen.has(job)) return;
    seen.add(job);
    out.push(job === null ? { job: null, scope: 'default', ...notApplied } : { job, ...notApplied });
  };
  for (const change of changes || []) {
    if (change.surface !== AGENT_SESSION || (change.field !== 'harness' && change.field !== 'effort')) continue;
    if (change.scope === 'default') {
      report(null, table.defaults[AGENT_SESSION] || {});
      continue;
    }
    const jobs = change.scope === 'job'
      ? [getJob(change.key)].filter((j) => j && j.surface === AGENT_SESSION)
      : JOBS.filter((j) => j.surface === AGENT_SESSION && j.group === change.key);
    for (const job of jobs) report(job.id, resolveAgentFromTable(table, job.id));
  }
  return out;
}

/**
 * Agent session defaults for a prompt `kind` from the table: the job's own row, then its
 * group's. A kind that is not a registry job (`defer`, null, an unknown string) gets the
 * workspace-wide row, as the old resolver gave it the top-level one.
 */
export function resolveAgentFromTable(table, kind, options = {}) {
  const job = kind ? getJob(kind) : undefined;
  if (!job || job.surface !== AGENT_SESSION) {
    const r = resolveFields([table.defaults[AGENT_SESSION] || {}], options);
    return { ...r, sources: sourcesOf(r.from, ['default']) };
  }
  const rows = [table.jobs[job.id] || {}, table.groups[AGENT_SESSION][job.group] || {}];
  const r = resolveFields(rows, options);
  return { ...r, sources: sourcesOf(r.from, SOURCES) };
}

function sourcesOf(from, names) {
  const out = {};
  for (const f of Object.keys(from)) out[f] = from[f] < 0 ? 'none' : names[from[f]];
  return out;
}

/**
 * A Harbour call's stored model from the table, `job.model || group.model` (`||`, as the
 * old resolver: an empty string falls through). Null when nothing is stored, so the
 * caller applies DEFAULT_MODEL. A caller with no job (or a job that is not a Harbour
 * call) reads the workspace-wide Harbour value.
 */
export function resolveHarbourFromTable(table, jobId) {
  const job = jobId ? getJob(jobId) : undefined;
  if (!job || job.surface !== HARBOUR_CALL) {
    return { model: table.defaults[HARBOUR_CALL]?.model || null, source: table.defaults[HARBOUR_CALL]?.model ? 'default' : 'none' };
  }
  const own = table.jobs[job.id]?.model;
  if (own) return { model: own, source: 'job' };
  const group = table.groups[HARBOUR_CALL][job.group]?.model;
  if (group) return { model: group, source: 'group' };
  return { model: null, source: 'none' };
}

/**
 * Every job's effective setting and, per field, where it came from: `job`, `group` or
 * `none` (explicit fields exist only per dispatch). The `claude-code` interpose is a
 * dispatch step, not a stored value, so it is not shown. Unrouted jobs are reported as
 * what actually runs, with `routed: false`.
 */
export function effectiveTable(table, { defaultModel }) {
  const jobs = JOBS.map((job) => {
    if (job.surface === AGENT_SESSION) {
      const r = resolveAgentFromTable(table, job.id);
      // LIN-3857 (D3): `effort` is what RUNS (null on a harness with no effort control); `source.effort`
      // still says where the stored value lives, and `effortNotApplied` carries it and says it is inert.
      const notApplied = effortNotAppliedForRow(r);
      return {
        id: job.id, surface: job.surface, group: job.group, harness: r.harness, model: r.model,
        effort: notApplied ? null : r.effort, source: r.sources,
        ...(notApplied ? { effortNotApplied: notApplied } : {})
      };
    }
    if (UNROUTED_JOBS.includes(job.id)) {
      return { id: job.id, surface: job.surface, group: job.group, model: defaultModel, source: { model: 'none' }, routed: false };
    }
    const r = resolveHarbourFromTable(table, job.id);
    return { id: job.id, surface: job.surface, group: job.group, model: r.model || defaultModel, source: { model: r.model ? r.source : 'none' }, routed: true };
  });
  return { version: table.version, jobs, groups: table.groups, defaults: table.defaults, unrouted: [...UNROUTED_JOBS] };
}

/**
 * The reverse of the migration: the old preference shape a table projects to, for the
 * Settings sections that still render it (they take plain data and are unchanged).
 * `modelId` is the Harbour default, `aiModelOverrides.byKind` the AI operations' own
 * models, and `dispatchDefaults` the agent default row plus every non-empty job row.
 */
export function projectLegacy(table) {
  const out = {};
  if (table.defaults[HARBOUR_CALL]?.model !== undefined) out.modelId = table.defaults[HARBOUR_CALL].model;
  const overrides = {};
  for (const op of AI_OPERATION_KINDS) {
    const model = table.jobs[op]?.model;
    if (model !== undefined && model !== null && model !== '') overrides[op] = { model };
  }
  out.aiModelOverrides = Object.keys(overrides).length ? { byKind: overrides } : {};
  const dd = { ...table.defaults[AGENT_SESSION] };
  const byKind = {};
  for (const kind of DISPATCH_DEFAULT_KINDS) {
    const row = table.jobs[kind];
    if (row && Object.keys(row).length) byKind[kind] = { ...row };
  }
  if (Object.keys(byKind).length) dd.byKind = byKind;
  out.dispatchDefaults = dd;
  return out;
}

// ---------------------------------------------------------------------------
// Writing: changes, diff and the builders the old forms use
// ---------------------------------------------------------------------------

export class RoutingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    if (details) this.details = details;
  }
}

const MAX_VALUE_LENGTH = 1000;
export const MAX_REASON_LENGTH = 500;

const clone = (t) => JSON.parse(JSON.stringify(t));

/** The row a change addresses, or throws. `create` makes a missing job row. */
function rowFor(table, { scope, surface, key }, create) {
  if (surface !== AGENT_SESSION && surface !== HARBOUR_CALL) throw new RoutingError('INVALID', `unknown surface "${surface}"`);
  if (scope === 'job') {
    const job = getJob(key);
    if (!job || job.surface !== surface) throw new RoutingError('INVALID', `no ${surface} job "${key}"`);
    if (!table.jobs[key] && create) table.jobs[key] = {};
    return table.jobs[key];
  }
  if (scope === 'group') {
    if (!GROUPS[key]) throw new RoutingError('INVALID', `no group "${key}"`);
    return table.groups[surface][key];
  }
  if (scope === 'default') return table.defaults[surface];
  throw new RoutingError('INVALID', `unknown scope "${scope}"`);
}

export function validateValue(value) {
  if (value === null) return;
  if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RoutingError('INVALID', 'a setting is a string of at most 1,000 characters with no control characters, or null to clear it');
  }
}

export function currentValue(table, change) {
  const row = rowFor(table, change, false);
  return row && row[change.field] !== undefined ? row[change.field] : null;
}

/** A new table with the changes applied. `null` clears a field. Shape is validated, nothing else. */
export function applyChangesToTable(table, changes) {
  const next = clone(table);
  for (const change of changes) {
    if (!FIELDS[change.surface]?.includes(change.field)) {
      throw new RoutingError('INVALID', `${change.surface} settings have no "${change.field}" field`);
    }
    validateValue(change.to);
    const row = rowFor(next, change, true);
    if (change.to === null) delete row[change.field];
    else row[change.field] = change.to;
    if (change.scope === 'job' && Object.keys(row).length === 0) delete next.jobs[change.key];
  }
  return next;
}

/** Every setting in a table as `scope|surface|key|field -> value`. */
function flatten(table) {
  const out = new Map();
  const put = (scope, surface, key, row) => {
    for (const field of FIELDS[surface]) {
      if (row && row[field] !== undefined) out.set(`${scope}|${surface}|${key}|${field}`, row[field]);
    }
  };
  for (const job of JOBS) put('job', job.surface, job.id, table.jobs[job.id]);
  for (const surface of [AGENT_SESSION, HARBOUR_CALL]) {
    for (const g of GROUP_IDS) put('group', surface, g, table.groups[surface][g]);
    put('default', surface, 'default', table.defaults[surface]);
  }
  return out;
}

/** The changes that turn `before` into `after`, in a stable order. */
export function diffTables(before, after) {
  const a = flatten(before);
  const b = flatten(after);
  const changes = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const from = a.has(k) ? a.get(k) : null;
    const to = b.has(k) ? b.get(k) : null;
    if (from === to) continue;
    const [scope, surface, key, field] = k.split('|');
    changes.push({ scope, surface, key, field, from, to });
  }
  return changes;
}

/** The part of a table a preset snapshots. */
export function snapshotOf(table) {
  const { jobs, groups, defaults } = clone(table);
  return { jobs, groups, defaults };
}

export function tableFromSnapshot(version, snapshot) {
  const base = emptyTable();
  const s = clone(snapshot);
  return { ...base, version, jobs: s.jobs || {}, groups: { ...base.groups, ...(s.groups || {}) }, defaults: { ...base.defaults, ...(s.defaults || {}) } };
}

const setRow = (row, fields, patch) => {
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    if (patch[f] === null || patch[f] === '') delete row[f];
    else row[f] = patch[f];
  }
};

/**
 * The old `/settings/model` form, run through the table: sets the Harbour default and
 * every Harbour group, so every Harbour job follows it (what `prefs.modelId` meant).
 * Job rows are left alone, as the form never wrote them.
 */
export function harbourModelTable(table, modelId) {
  const next = clone(table);
  next.defaults[HARBOUR_CALL] = { model: modelId };
  for (const g of GROUP_IDS) next.groups[HARBOUR_CALL][g] = { model: modelId };
  return next;
}

/**
 * The old `/settings/dispatch-defaults` form. `top` is the form's workspace-wide row and
 * `byKind` its per-kind rows (both already trimmed, blank = absent). The top row replaces
 * the agent default and every agent group; each of the DISPATCH_DEFAULT_KINDS jobs' own
 * row is replaced by the posted partial row (a blank field clears that field, so the job
 * follows its group again). `periodical` and `custom` are not on the form and are
 * untouched.
 */
export function dispatchDefaultsTable(table, top, byKind) {
  const next = clone(table);
  const fields = FIELDS[AGENT_SESSION];
  const topRow = {};
  setRow(topRow, fields, top);
  next.defaults[AGENT_SESSION] = { ...topRow };
  for (const g of GROUP_IDS) next.groups[AGENT_SESSION][g] = { ...topRow };
  for (const kind of DISPATCH_DEFAULT_KINDS) {
    const row = {};
    setRow(row, fields, byKind[kind] || {});
    if (Object.keys(row).length) next.jobs[kind] = row;
    else delete next.jobs[kind];
  }
  return next;
}

/**
 * The old `/settings/ai-model-overrides` form: each AI operation's own model is set or
 * cleared, and `scan` also sets `scan-retire`, as the scan route reads the one override
 * for both.
 */
export function aiOverridesTable(table, byKind) {
  const next = clone(table);
  const put = (id, model) => {
    const row = { ...(next.jobs[id] || {}) };
    if (model) row.model = model;
    else delete row.model;
    if (Object.keys(row).length) next.jobs[id] = row;
    else delete next.jobs[id];
  };
  for (const op of AI_OPERATION_KINDS) {
    const model = byKind[op]?.model;
    put(op, model);
    if (op === 'scan') put('scan-retire', model);
  }
  return next;
}

/**
 * The first log entry: the 23 October move of autopilot from Opus 5.5 to Sonnet 5.5
 * (LIN-3820 comment, 18:58Z). It is entered only in the workspace where it happened, and
 * only when that workspace's migrated autopilot model is the one it moved to: a value
 * match alone would stamp a false dated record into every tenant that happens to run
 * Sonnet, and undo would offer to restore Opus there.
 *
 * `urlKey`, `from` and `to` are NOT in the repo (the LIN-3820 comment names no workspace
 * and the stored strings are not in any fixture or the dev data). They stay unset by
 * ruling (LIN-3853, `lin3853-seeded-entry`): the entry is dropped, so nothing is seeded
 * anywhere. The fail-closed gate stays; `ensureMigrated` takes this as an option so tests
 * inject fixture values.
 *
 * Label only, no person's name: erasure rewrites account ids and cannot reach a stored
 * name.
 */
export const SEEDED_ENTRY = Object.freeze({
  urlKey: null,
  from: null,
  to: null,
  at: '2026-10-23T18:40:00.000Z',
  label: 'Recorded in the LIN-3820 comment of 23 Oct',
  reason: 'Step 1 of cheaper-capacity.md: supervision (autopilot plus wakes) was about 25% of October\'s API-equivalent spend. Entered from the LIN-3820 comment, with its original time.'
});
