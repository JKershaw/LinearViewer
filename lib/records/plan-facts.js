/**
 * LIN-4504 (slice 2, P4): a ticket's plan facts, folded from records. Pure: it touches no store. The store reads the
 * records in a fixed number of calls for any number of tickets (lib/records-store.js planFactsForTickets) and folds
 * each ticket here; a script that reads records through the proxy (`GET /records`) can fold them the same way.
 *
 * Plans are records (layer design §3; integration design §3): a plan record is `in` a task and addressed `to` the stage
 * that works from it — `implementation` for one session's work, `breakdown` for several (lib/records/check.js
 * PLAN_ADDRESSEES). A breakdown writes each piece `to: implementation` in the parent task and each child task with its
 * `piece` link. A plan review is owed while a finding `to: plan-review` about the plan is open.
 *
 * The facts, for one ticket's task:
 *   - own plans: the kept plans `in` the task that no child task names as its `piece` (a piece belongs to its child);
 *   - piece: the plan the task's `piece` link names (following a supersede to the plan that took over);
 *   - has a plan: an own plan or a piece; part of the parent's plan: a piece;
 *   - session fit: several sessions when any own plan is `to: breakdown`; one session when the own plans are all
 *     `to: implementation`, or the task has only a piece; none with no plan;
 *   - review owed: an open finding `to: plan-review` about an own plan, or an own plan `to: breakdown` with no
 *     `plan-review` finding about it, open or ended. Approve ends the finding; request-changes leaves it open;
 *   - revision: each own plan's current `v` and when it last changed;
 *   - child tasks with no ticket: open child tasks with no `ref`, counted;
 *   - ever planned: the task holds any plan record, in any state, or has a piece (the metrics' "has or had a plan");
 *   - review asked: a finding `to: plan-review` about any plan in the task existed, open or ended (the round-trip
 *     measure's gate).
 *
 * A missing store or a failed read is NOT "no plan": it is `planFactsNotMeasured(reason)`, and every reader says
 * "not measured" (records Lesson, docs/areas/records.md; LIN-4495).
 */
import { splitRef } from './check.js';

/** The stage a plan review is addressed to. */
export const PLAN_REVIEW = 'plan-review';

/**
 * The instant plan records began to cover the workspace's plans: the slice-2 cutover (LIN-4504), set in the cutover
 * commit to the moment the import applied. Before it, a plan lived in ticket text, which nothing reads any more, so a
 * metric over earlier work reads "not measured", never 0 and never a value derived from a description (reports Lesson,
 * docs/areas/reports-and-operator-tools.md, LIN-4420). `null` means the cutover has not applied: nothing is covered.
 * Set to 19:51:15.146Z, the first import write (LIN-4504 production apply; 22 plans, 23 finding versions, 1432 tasks unchanged).
 */
export const PLAN_RECORDS_SINCE = '2026-11-20T19:51:15.146Z';

/**
 * Whether work at `at` (an ISO instant) is covered by plan records.
 * @param {string|null|undefined} at
 * @param {string|null} [since]
 * @returns {{covered: boolean, reason: string|null}}
 */
export function planCoverageAt(at, since = PLAN_RECORDS_SINCE) {
  if (!since) return { covered: false, reason: 'no plan records yet (the slice-2 cutover has not applied)' };
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return { covered: false, reason: 'no date to place it against the plan records' };
  return t >= Date.parse(since) ? { covered: true, reason: null } : { covered: false, reason: `no plan records before ${since.slice(0, 10)}` };
}

/** Plan facts that could not be read: never "no plan". */
export function planFactsNotMeasured(reason) {
  return Object.freeze({ measured: false, reason: String(reason || 'not read') });
}

const idOf = (ref) => (typeof ref === 'string' && ref ? splitRef(ref).id : null);
const aboutIds = (rec) => [].concat(rec?.links?.about || []).map(idOf).filter(Boolean);
const planView = (p) => ({ id: p.id, v: p.v, to: p.to || null, at: p.at || null, in: p.in || null });

/**
 * Follow a superseded plan to the plan that took over (`ended.into`), as the brief does (lib/records/brief.js part 2).
 * @param {object|null} plan
 * @param {(id: string) => object|null} get
 */
export function currentPieceOf(plan, get) {
  let p = plan;
  for (const seen = new Set(); p && p.state === 'superseded' && p.ended?.into && !seen.has(p.id); seen.add(p.id)) p = get(p.ended.into);
  return p && !p.ended ? p : null;
}

/**
 * Fold one ticket's records into its plan facts.
 * @param {Object} input
 * @param {object|null} input.task - the ticket's task record (current version), or null when the ticket has none
 * @param {object[]} [input.inside] - the current records `in` that task (any kind, any state)
 * @param {object|null} [input.piece] - the current plan the task's `piece` names (after following a supersede), or null
 * @param {object[]} [input.findings] - findings `to: plan-review` (any state); those not about this task's plans are ignored
 * @returns {object} the facts (see the module note); `measured: true`
 */
export function planFactsOf({ task = null, inside = [], piece = null, findings = [] } = {}) {
  const childTasks = task ? inside.filter((r) => r.kind === 'task' && r.in === task.id) : [];
  const pieceOfChild = new Set(childTasks.map((t) => idOf(t.links?.piece)).filter(Boolean));
  const plansHere = task ? inside.filter((r) => r.kind === 'plan' && r.in === task.id) : [];
  const own = plansHere.filter((p) => p.state === 'kept' && !pieceOfChild.has(p.id))
    .sort((a, b) => (a.fields?.order ?? 0) - (b.fields?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const thePiece = task?.links?.piece && piece ? piece : null;

  const about = (planId) => findings.filter((f) => f.kind === 'finding' && f.to === PLAN_REVIEW && aboutIds(f).includes(planId));
  let reviewOwed = { owed: false, why: null, plan: null, finding: null };
  for (const p of own) {
    const open = about(p.id).find((f) => f.state === 'open');
    if (open) { reviewOwed = { owed: true, why: 'open-finding', plan: p.id, finding: open.id }; break; }
  }
  if (!reviewOwed.owed) {
    const unreviewed = own.find((p) => p.to === 'breakdown' && about(p.id).length === 0);
    if (unreviewed) reviewOwed = { owed: true, why: 'breakdown-unreviewed', plan: unreviewed.id, finding: null };
  }

  let sessionFit = null;
  if (own.some((p) => p.to === 'breakdown')) sessionFit = 'several';
  else if (own.length && own.every((p) => p.to === 'implementation')) sessionFit = 'one';
  else if (!own.length && thePiece) sessionFit = 'one';

  return {
    measured: true,
    taskId: task ? task.id : null,
    own: own.map(planView),
    piece: thePiece ? planView(thePiece) : null,
    hasPlan: own.length > 0 || !!thePiece,
    partOfParent: !!thePiece,
    sessionFit,
    reviewOwed,
    childTasksWithoutTicket: childTasks.filter((t) => t.state === 'open' && !t.fields?.ref).length,
    everPlanned: plansHere.length > 0 || !!task?.links?.piece,
    reviewAsked: plansHere.some((p) => about(p.id).length > 0),
  };
}

/**
 * The plan facts of many tickets from records read whole (a script reading `GET /api/proxy/records?kind=task`,
 * `?kind=plan` and `?kind=finding&to=plan-review` through the proxy): the same fold the store's batched reader uses. A
 * ticket's task is the task whose `ref` names it; a ticket with no task reads as measured with no plan.
 * @param {{tasks?: object[], plans?: object[], findings?: object[]}} records - current versions
 * @param {string[]} tickets
 * @returns {Map<string, object>}
 */
export function planFactsFromRecords({ tasks = [], plans = [], findings = [] } = {}, tickets = []) {
  const byId = new Map([...tasks, ...plans].map((r) => [r.id, r]));
  const taskOfTicket = new Map(tasks.filter((t) => t.kind === 'task' && typeof t.fields?.ref === 'string').map((t) => [t.fields.ref, t]));
  const inside = new Map();
  for (const r of [...tasks, ...plans]) {
    if (!r.in) continue;
    if (!inside.has(r.in)) inside.set(r.in, []);
    inside.get(r.in).push(r);
  }
  const out = new Map();
  for (const ticket of tickets) {
    const task = taskOfTicket.get(ticket) || null;
    const pieceId = task ? idOf(task.links?.piece) : null;
    const piece = pieceId ? currentPieceOf(byId.get(pieceId) || null, (id) => byId.get(id) || null) : null;
    out.set(ticket, planFactsOf({ task, inside: task ? inside.get(task.id) || [] : [], piece, findings }));
  }
  return out;
}
