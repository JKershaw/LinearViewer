/**
 * LIN-4493 (layer design §3.4): the views, computed when read. Pure.
 *
 * Every record is kept as versions (one snapshot per write). A reader asks for the CURRENT version of each
 * record, or the version that was current at a time (`asOf`). `index(versions)` answers those questions over
 * a set of version snapshots; the store supplies the snapshots, so nothing here knows the database.
 *
 * Views (§3.4):
 * - open for a reader: open records whose `to` is that actor, that task, or `project` (see brief.js, part 3);
 * - answered: a question with a standing decision that `answers` it shows that decision beside it;
 * - stale: a verdict or decision, not ended, one of whose `on` links points to a version the target has since
 *   left (its fields were revised), or to a target ended superseded, withdrawn, abandoned or disproved;
 * - under an ended task: an open record `in` or `to` a task that has ended.
 */
import { KINDS, splitRef } from './check.js';

/** The fields a stale check compares: a revise of these makes a verdict stale. */
const compareKey = (fields) => JSON.stringify(Object.keys(fields || {}).sort().map((k) => [k, fields[k]]));

/**
 * An index over version snapshots. A snapshot: {id, v, at, kind, state, in?, to?, links, fields, ended?, by,
 * via?, reason?, lineage?}; `ended` is {reason, into?} on an end.
 * @param {object[]} versions - every version of every record in one workspace
 */
export function index(versions) {
  const byId = new Map();
  for (const snap of versions) {
    if (!byId.has(snap.id)) byId.set(snap.id, []);
    byId.get(snap.id).push(snap);
  }
  for (const list of byId.values()) list.sort((a, b) => a.v - b.v);
  const at = (id, asOf) => {
    const list = byId.get(id) || [];
    const kept = asOf ? list.filter((s) => s.at <= asOf) : list;
    return kept.length ? kept[kept.length - 1] : null;
  };
  const versionOf = (id, v) => (byId.get(id) || []).find((s) => s.v === v) || null;
  const currentVersion = (id, asOf) => {
    const s = at(id, asOf);
    return s ? s.v : null;
  };
  const all = (asOf) => [...byId.keys()].map((id) => at(id, asOf)).filter(Boolean);
  const versionsOf = (id) => byId.get(id) || [];
  return { at, versionOf, currentVersion, all, versionsOf, has: (id) => byId.has(id) };
}

/** The kind (and so the state machine) of record `id`, or null. */
export function kindOf(idx, id, asOf) {
  return idx.at(id, asOf)?.kind ?? null;
}

/**
 * The `on` links of a verdict or decision that point at a version its target has since left: the stale check, as a list
 * of `{ ref, id, target, reason }` (the target's current snapshot). Empty when nothing is stale, or the record is ended.
 * A target ended superseded, withdrawn, abandoned or disproved is stale too (KINDS.staleEnds). A merge is not (not in
 * staleEnds), so a merged PR's approval stays on record.
 * @param {object} snap - a current version of a verdict or decision
 * @param {ReturnType<typeof index>} idx
 * @param {string} [asOf]
 * @returns {{ref: string, id: string, target: object, reason: string}[]}
 */
export function staleRefsOf(snap, idx, asOf) {
  if (!((snap.kind === 'verdict' || snap.kind === 'decision') && !snap.ended)) return [];
  return (snap.links?.on || []).flatMap((ref) => {
    const { id, v } = splitRef(ref);
    const target = idx.at(id, asOf);
    const base = idx.versionOf(id, v);
    if (!target || !base) return [];
    if (target.ended && KINDS.staleEnds.includes(target.state)) {
      return [{ ref, id, target, reason: `on ${ref}: target ${target.state}${target.ended.into ? ' into ' + target.ended.into : ''}` }];
    }
    return compareKey(base.fields) !== compareKey(target.fields)
      ? [{ ref, id, target, reason: `on ${ref}, now @${target.v}` }]
      : [];
  });
}

/**
 * The view of one current record: the record itself, with `flags` when a view applies.
 * @param {object} snap - a current version
 * @param {ReturnType<typeof index>} idx
 * @param {string} [asOf]
 */
export function viewOf(snap, idx, asOf) {
  const flags = {};
  if (snap.kind === 'question') {
    const decision = idx.all(asOf)
      .filter((s) => s.kind === 'decision' && s.state === 'stands' && s.links?.answers === snap.id)
      .pop();
    if (decision) flags.answered = { by: decision.id, answer: decision.fields?.answer };
  }
  const stale = staleRefsOf(snap, idx, asOf).map((x) => x.reason);
  if (stale.length) flags.stale = stale;
  if (snap.state === 'open') {
    const endedTask = [snap.in, snap.to].find((x) => x && idx.at(x, asOf)?.kind === 'task' && idx.at(x, asOf)?.ended);
    if (endedTask) flags['under-ended-task'] = endedTask;
  }
  return Object.keys(flags).length ? { ...snap, flags } : snap;
}

/** A current record is open when its state is `open` (task, finding, question, change, run). */
export const isOpen = (snap) => snap.state === 'open';
