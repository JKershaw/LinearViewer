/**
 * LIN-4493 (layer design §3.3): what a records write checks. Shape only, so a malformed record cannot
 * enter: the kind is declared; every field belongs to it and has its type; a verdict's outcome is in its
 * set; a task's `asked` does not change once written; a hand-off (finding, question) has a `to` that is a
 * reader Harbour can brief; every link resolves; a verdict has an `on`; an end is one of the kind's ends,
 * with a reason.
 *
 * Pure. It touches no store and no tracker: the caller supplies `ctx`, which answers the lookups.
 *
 * `ctx` (all optional where noted; a missing answer is a refusal, never a pass):
 *   resolve(ref)       -> {id, kind} for a record or task reference (a task id, or a ticket id the caller
 *                         has already matched or will create), or null when nothing answers to `ref`.
 *                         Ticket refusals (closed) come back as {problem}.
 *   currentVersion(id) -> the current version number of record `id`, or null.
 *   versionExists(id, v) -> whether `id` has a version `v`.
 *   addressees         -> {stages: string[], people: [{accountId, name}]}: what `to` may name. `stages`
 *                         is STAGE_KINDS' keys (read by the caller, never copied here).
 *
 * Problems are {field, message, works?}: `works` lists the names that would be accepted, when the field
 * named a reader. A refusal carries every problem at once (api-review, integration §2).
 */
import { readFileSync } from 'node:fs';

export const KINDS = JSON.parse(readFileSync(new URL('./kinds.json', import.meta.url), 'utf8'));

/** The kinds a caller may write. `run` is Harbour's: a run opens when its dispatch row is taken. */
export function writableKinds() {
  return Object.keys(KINDS.kinds).filter((k) => !KINDS.kinds[k].harbourOnly);
}

const TYPE_WORDS = { string: 'a string', number: 'a number', list: 'a list of strings', scope: "a task id or 'project'" };
const LINK_TYPES = Object.keys(KINDS.links);
const pinnedRef = (id, v) => `${id}@${v}`;

/** Split `id` or `id@v`. */
export function splitRef(ref) {
  const at = String(ref).indexOf('@');
  if (at < 0) return { id: String(ref), v: undefined };
  const v = Number(String(ref).slice(at + 1));
  return { id: String(ref).slice(0, at), v: Number.isInteger(v) ? v : NaN };
}

function typeOk(type, value, ctx) {
  if (type === 'string') return typeof value === 'string' && value.length > 0;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'list') return Array.isArray(value) && value.every((x) => typeof x === 'string');
  if (type === 'scope') return value === KINDS.addressees.project ? true : typeof value === 'string' && ctx.resolve(value)?.kind === 'task';
  return false;
}

function misplacedField(key, kind) {
  const owners = Object.keys(KINDS.kinds).filter((k) => KINDS.kinds[k].fields[key]);
  if (LINK_TYPES.includes(key)) return `'${key}' is a link: put it beside the fields or under links`;
  if (['in', 'to'].includes(key)) return `'${key}' is not a field of ${kind}`;
  if (owners.length) return `'${key}' does not belong to ${kind}; it belongs to ${owners.join(', ')}`;
  return `'${key}' is not a field of ${kind}; its fields are: ${Object.keys(KINDS.kinds[kind].fields).join(', ')}`;
}

/**
 * `to` names what Harbour can brief: the project, the leftover step, a stage kind, a person (`person:<accountId>`,
 * or the name the workspace shows them), or a task (its id or ticket id). Anything else is refused, naming them.
 * @returns {{value: string} | {problem: object}}
 */
export function resolveTo(raw, ctx) {
  const names = [KINDS.addressees.project, KINDS.addressees.leftover, ...(ctx.addressees?.stages || [])];
  const people = ctx.addressees?.people || [];
  const works = [...names, ...people.map((p) => p.name), 'a task (LIN-n or its task id)'];
  if (typeof raw !== 'string' || !raw.trim()) return { problem: { field: 'to', message: "'to' must name a reader", works } };
  const text = raw.trim();
  if (text === KINDS.addressees.project || text === KINDS.addressees.leftover || (ctx.addressees?.stages || []).includes(text)) return { value: text };
  if (text.startsWith('person:')) {
    const accountId = text.slice('person:'.length);
    return people.some((p) => p.accountId === accountId)
      ? { value: text }
      : { problem: { field: 'to', message: `'${text}' is not a person in this workspace`, works } };
  }
  const named = people.filter((p) => p.name.toLowerCase() === text.toLowerCase());
  if (named.length === 1) return { value: `person:${named[0].accountId}` };
  if (named.length > 1) return { problem: { field: 'to', message: `'${text}' names more than one person; send person:<accountId>`, works } };
  const hit = ctx.resolve(text);
  if (hit?.problem) return { problem: { field: 'to', message: hit.problem, works } };
  if (hit?.kind === 'task') return { value: hit.id };
  return { problem: { field: 'to', message: `'${text}' is not a reader Harbour can brief`, works } };
}

/**
 * Field-level checks. `merged` is the record's fields after the write (for a revise, the current fields with
 * the given ones applied): a verdict's outcome is checked against its judgement's set as it will stand.
 */
function checkFields(kind, fields, ctx, problems, merged = fields) {
  const kd = KINDS.kinds[kind];
  for (const [key, value] of Object.entries(fields)) {
    if (!kd.fields[key]) { problems.push({ field: key, message: misplacedField(key, kind) }); continue; }
    if (value === null) continue;
    if (!typeOk(kd.fields[key], value, ctx)) {
      problems.push({ field: key, message: `'${key}' of ${kind} must be ${TYPE_WORDS[kd.fields[key]]}` });
    }
  }
  if (kind === 'verdict' && merged.judgement !== undefined && merged.outcome !== undefined && typeof merged.judgement === 'string') {
    const set = KINDS.outcomes[merged.judgement];
    if (!set) problems.push({ field: 'judgement', message: `judgement must be one of: ${Object.keys(KINDS.outcomes).join(', ')}`, works: Object.keys(KINDS.outcomes) });
    else if (!set.includes(merged.outcome)) problems.push({ field: 'outcome', message: `'${merged.outcome}' is not in ${merged.judgement}'s set: ${set.join(', ')}`, works: set });
  }
}

/**
 * Normalise and check the link object `links` (`{type: id | id[]}`) for a record of `kind`. A bare `on` id
 * is pinned to the target's current version (api-review: a bare id pins to the current version).
 */
function checkLinks(kind, links, ctx, problems) {
  const out = {};
  for (const [type, raw] of Object.entries(links || {})) {
    const ld = KINDS.links[type];
    if (!ld) { problems.push({ field: type, message: `'${type}' is not a link type; link types are: ${LINK_TYPES.join(', ')}` }); continue; }
    if (ld.from && kind !== ld.from) { problems.push({ field: type, message: `'${type}' joins a ${ld.from} to a ${ld.target}; a ${kind} cannot carry it` }); continue; }
    // A list type takes one id or a list (api-review 1); a single-id type takes one id.
    const listed = ld.list && typeof raw === 'string' ? [raw] : raw;
    if (ld.list ? !(Array.isArray(listed) && listed.every((x) => typeof x === 'string')) : typeof raw !== 'string') {
      problems.push({ field: type, message: ld.list ? `'${type}' holds an id or a list of ids` : `'${type}' holds one id` });
      continue;
    }
    const refs = ld.list ? listed : [raw];
    const pinned = [];
    for (const ref of refs) {
      const { id, v } = splitRef(ref);
      if (ld.versioned && v === undefined) {
        const cur = ctx.currentVersion(id);
        if (cur === null || cur === undefined) { problems.push({ field: type, message: `'${type}': '${id}' does not resolve` }); continue; }
        pinned.push(pinnedRef(id, cur));
        continue;
      }
      if (v !== undefined && (Number.isNaN(v) || !ctx.versionExists(id, v))) { problems.push({ field: type, message: `'${type}': '${ref}' has no such version` }); continue; }
      const hit = ctx.resolve(id);
      if (hit?.problem) { problems.push({ field: type, message: hit.problem }); continue; }
      if (!hit) { problems.push({ field: type, message: `'${type}': '${id}' does not resolve` }); continue; }
      if (ld.target && hit.kind !== ld.target) { problems.push({ field: type, message: `'${type}' must point to a ${ld.target}; '${id}' is a ${hit.kind}` }); continue; }
      pinned.push(hit.id === id ? ref : hit.id + (v !== undefined ? `@${v}` : ''));
    }
    if (pinned.length) out[type] = ld.list ? pinned : pinned[0];
  }
  return out;
}

/**
 * Check a new record. `input` is the flat body without `run`/`reason` (the route strips those):
 * fields flat at the top level, plus `in`, `to`, and links either flat or under `links`.
 * @returns {{problems: object[], record?: {kind, fields, in?, to?, links, state}}}
 */
export function checkAdd(kind, input, ctx) {
  const problems = [];
  if (!KINDS.kinds[kind] || KINDS.kinds[kind].harbourOnly) {
    const names = writableKinds().join(', ');
    return { problems: [{ field: 'kind', message: `kind '${kind}' is not a kind a write may add; kinds: ${names}`, works: writableKinds() }] };
  }
  const { in: inRaw, to: toRaw, links: nestedLinks, ...rest } = input;
  const linkBody = { ...(nestedLinks || {}) };
  const fields = {};
  for (const [key, value] of Object.entries(rest)) {
    if (LINK_TYPES.includes(key)) linkBody[key] = value;
    else fields[key] = value;
  }
  for (const key of Object.keys(nestedLinks || {})) {
    if (rest[key] !== undefined) problems.push({ field: key, message: `'${key}' is given twice: beside the fields and under links` });
  }
  checkFields(kind, fields, ctx, problems);
  const record = { kind, fields: {}, links: {}, state: KINDS.kinds[kind].start };
  for (const [key, value] of Object.entries(fields)) if (value !== null) record.fields[key] = value;
  if (inRaw !== undefined) {
    const hit = typeof inRaw === 'string' ? ctx.resolve(inRaw) : null;
    if (hit?.problem) problems.push({ field: 'in', message: hit.problem });
    else if (!hit || hit.kind !== 'task') problems.push({ field: 'in', message: `'in' must name a task (its id or ticket id); got ${JSON.stringify(inRaw)}`, works: ['a task (LIN-n or its task id)'] });
    else record.in = hit.id;
  }
  if (toRaw !== undefined) {
    const t = resolveTo(toRaw, ctx);
    if (t.problem) problems.push(t.problem); else record.to = t.value;
  }
  if (KINDS.kinds[kind].needsTo && record.to === undefined) {
    problems.push({ field: 'to', message: `a ${kind} must have a to (who acts on it next)`, works: [KINDS.addressees.project, KINDS.addressees.leftover, ...(ctx.addressees?.stages || [])] });
  }
  record.links = checkLinks(kind, linkBody, ctx, problems);
  if (KINDS.kinds[kind].needsOn && !(record.links.on || []).length) {
    problems.push({ field: 'on', message: 'a verdict must have on: the exact version it rests on (id, or id@v)' });
  }
  return problems.length ? { problems } : { problems, record };
}

/**
 * Check a revise. `prev` is the current version. Fields given replace; `null` removes; `in`/`to` replace;
 * links add (a revise that names links adds them). A task's `asked` cannot change once written.
 * @returns {{problems: object[], changes?: object}}
 */
export function checkRevise(prev, input, ctx) {
  const problems = [];
  const kd = KINDS.kinds[prev.kind];
  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    problems.push({ field: 'reason', message: 'a revise needs a reason: "reason": "..."' });
  }
  const { in: inRaw, to: toRaw, links: nestedLinks, reason, ...rest } = input;
  void reason;
  const linkBody = { ...(nestedLinks || {}) };
  const fields = {};
  for (const [key, value] of Object.entries(rest)) {
    if (LINK_TYPES.includes(key)) linkBody[key] = value;
    else fields[key] = value;
  }
  if (prev.kind === 'task' && fields.asked !== undefined && fields.asked !== prev.fields.asked) {
    problems.push({ field: 'asked', message: "a task's asked is fixed once written" });
  }
  const merged = { ...prev.fields };
  for (const [k, v] of Object.entries(fields)) if (kd.fields[k]) { if (v === null) delete merged[k]; else merged[k] = v; }
  checkFields(prev.kind, fields, ctx, problems, merged);
  const changes = { fields: {}, links: {} };
  for (const [k, v] of Object.entries(fields)) if (kd.fields[k]) changes.fields[k] = v;
  if (inRaw !== undefined) {
    const hit = typeof inRaw === 'string' ? ctx.resolve(inRaw) : null;
    if (hit?.problem) problems.push({ field: 'in', message: hit.problem });
    else if (!hit || hit.kind !== 'task') problems.push({ field: 'in', message: "'in' must name a task", works: ['a task (LIN-n or its task id)'] });
    else changes.in = hit.id;
  }
  if (toRaw !== undefined) {
    if (toRaw === null) changes.to = null;
    else { const t = resolveTo(toRaw, ctx); if (t.problem) problems.push(t.problem); else changes.to = t.value; }
  }
  const links = checkLinks(prev.kind, linkBody, ctx, problems);
  changes.links = links;
  return problems.length ? { problems } : { problems, changes };
}

/**
 * Check an end. `prev` is the current version and must not already be ended (the caller returns that case
 * unchanged, before this check). `into` names the record that takes over: required on handed-on and superseded,
 * allowed on any end (integration §2, api-review 6).
 */
export function checkEnd(prev, input, ctx) {
  const problems = [];
  const kd = KINDS.kinds[prev.kind];
  const { state, reason, into } = input;
  if (!kd.ends.includes(state)) problems.push({ field: 'state', message: `'${state}' is not an end of ${prev.kind}; its ends: ${kd.ends.join(', ')}`, works: kd.ends });
  if (!reason || typeof reason !== 'string' || !reason.trim()) problems.push({ field: 'reason', message: 'an end needs a reason' });
  if (KINDS.takeover.includes(state) && !into) problems.push({ field: 'into', message: `${state} names the record that takes over: "into": "<id>"` });
  if (into !== undefined && into !== null && (typeof into !== 'string' || ctx.currentVersion(into) === null || ctx.currentVersion(into) === undefined)) {
    problems.push({ field: 'into', message: `'into' '${into}' does not resolve` });
  }
  return { problems };
}

/**
 * Check a link call: `links` as in a write. Only adds (a revise that names links adds them).
 */
export function checkLink(prev, links, ctx) {
  const problems = [];
  const normalized = checkLinks(prev.kind, links || {}, ctx, problems);
  return problems.length ? { problems } : { problems, links: normalized };
}

/** The 422 body: every problem at once, each with what would work. */
export function refusalOf(problems) {
  return { error: problems.length === 1 ? problems[0].message : `${problems.length} problems: ${problems.map((p) => p.message).join('; ')}`, problems };
}
