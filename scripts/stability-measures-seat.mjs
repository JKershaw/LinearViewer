// Measure 4, the person's seat (LIN-4422). Pure, like the core: the rulings read, each finished task's /cost body and
// its dispatch reads come in as data (scripts/stability-measures-tracker.mjs readSeat does the reads), rows come out.
// The finished tasks are the tracker read's own selection (LIN-4421): one finished set, read by speed, cost and seat.
//
// Three rows, settled by LIN-4399's plan review (notes 1 and 2):
//   rulings        rulings raised per finished task, and the share answered rather than dismissed. LOOP RULINGS ONLY:
//                  GET /rulings?includeResolved=true never returns an answered task-bound ruling (anchor.taskDecisionId),
//                  and no proxy read does. "Raised" counts distinct decisions: a re-ask collapses into one ruling row.
//                  Outcome buckets as lib/escalation-kpis.js: answered share = answered / (answered + dismissed);
//                  self-resolved and withdrawn are neither (LIN-2650); a null outcome (a legacy digest that recorded
//                  "resolved" but not which) is unreadable, never answered. A ruling anchored on a finished task's parent
//                  or on any other unfinished ticket is not counted against the task; whether a parent's questions
//                  belong to its pieces is LIN-4399's call, so the row names the gap and counts the parent-anchored ones.
//   origin         not measured: GET /dispatch/{id} dispatchedBy is the workspace account for autopilot and person
//                  alike. Origin is never inferred from it. Exposing the server's person-origin signal is follow-up work.
//   operator-free  the share of finished tasks with no loop ruling, no [blocked] marker in any lineage member's feedback
//                  and no dispatch row closed with closedReason 'operator': an UPPER BOUND over the three readable
//                  conditions, with the fourth (no person-started dispatch) named as missing. Blocking is read from the
//                  feedback markers (WAKE_FEEDBACK_REGEX, any entry, not the last one), never from `status`, which reports
//                  blocked only while no terminal exists in the lineage. Every member of every lineage /cost lists is
//                  read, not only roots.

import { WAKE_FEEDBACK_REGEX, isWaitingWakeMarker } from '../lib/dispatch-terminal.js';
import { notMeasured, row } from './stability-measures-core.mjs';

export const LOOP_ONLY = 'loop rulings only';
export const ORIGIN_UNREADABLE = 'dispatchedBy is the workspace account for autopilot and person alike';
export const UPPER_BOUND = 'upper bound';
export const MISSING_CONDITION = `no person-started dispatch (not measured: ${ORIGIN_UNREADABLE})`;
export const SEAT_KEYS = Object.freeze(['rulings', 'origin', 'operator-free']);

const OUTCOMES = ['answered', 'dismissed', 'withdrawn', 'self-resolved'];
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Whether any feedback entry is a `[blocked]` wake marker: the waiting marker of lib/dispatch-terminal.js, matched on
 * every entry. A lineage that blocked and then finished still blocked (deriveBlockedStatus reads only the last marker,
 * so it would say no). `[pending]` is an agent-to-agent handoff, not a wait on a person.
 */
export function hasBlockedMarker(feedback) {
  if (!Array.isArray(feedback)) return false;
  return feedback.some((f) => {
    const m = WAKE_FEEDBACK_REGEX.exec(f?.message || '');
    return !!m && isWaitingWakeMarker(m[1].toLowerCase());
  });
}

/**
 * The dispatches to read for one finished task, from its /cost body (membership is /cost's: lib/lineage-membership.js
 * server side; the proxy's rows carry no rootItemId to group by here). Each lineage's `dispatches[].itemId`, or its
 * root alone when /cost could not split it (`dispatches` null: no request records), counted as `rootOnly`.
 * → { memberIds, rootOnly } or { reason }.
 */
export function membersOf(cost) {
  if (!cost || cost.reason) return { reason: `cost read failed: ${cost?.reason ?? 'not read'}` };
  const body = cost.body;
  if (body?.noLineage || !Array.isArray(body?.workerSessions)) return { reason: 'no lineage: no dispatch ran for this issue' };
  const ids = [];
  let rootOnly = 0;
  for (const s of body.workerSessions) {
    if (Array.isArray(s.dispatches) && s.dispatches.length) { ids.push(...s.dispatches.map((d) => d.itemId)); continue; }
    if (!s.rootItemId) return { reason: 'a lineage has neither dispatches nor a root id' };
    ids.push(s.rootItemId);
    rootOnly++;
  }
  if (ids.some((id) => !id)) return { reason: 'a dispatch has no item id' };
  return { memberIds: [...new Set(ids)], rootOnly };
}

const issueOf = (r) => r?.anchor?.issueIdentifier ?? null;

/** Loop rulings per finished task and the answered share. `rulings` is { rulings: [...] } or { reason }. */
export function rulingsRow({ finished, rulings, reference = null }) {
  if (!finished.length) return notMeasured('rulings', 'no finished tasks in the window', { reference });
  if (rulings?.reason || !Array.isArray(rulings?.rulings)) return notMeasured('rulings', `rulings read failed: ${rulings?.reason ?? 'not read'}`, { reference });
  const ids = new Set(finished.map((t) => t.id));
  const parents = new Set(finished.map((t) => t.parent).filter((p) => p && !ids.has(p)));
  const onTasks = rulings.rulings.filter((r) => ids.has(issueOf(r)));
  const outcomes = { answered: 0, dismissed: 0, withdrawn: 0, 'self-resolved': 0, unknown: 0, open: 0 };
  const strange = [];
  for (const r of onTasks) {
    if (!('resolution' in r) || r.resolution == null) { outcomes.open++; continue; }
    const o = r.resolution.outcome;
    if (o == null) { outcomes.unknown++; continue; }
    if (OUTCOMES.includes(o)) outcomes[o]++;
    else strange.push(o);
  }
  const perTaskCounts = {};
  for (const r of onTasks) perTaskCounts[issueOf(r)] = (perTaskCounts[issueOf(r)] ?? 0) + 1;
  const onParents = rulings.rulings.filter((r) => parents.has(issueOf(r))).length;
  const judged = outcomes.answered + outcomes.dismissed;
  const value = {
    label: LOOP_ONLY,
    finished: finished.length,
    raised: onTasks.length,
    perFinishedTask: Math.round((onTasks.length / finished.length) * 100) / 100,
    tasksWithRuling: Object.keys(perTaskCounts).length,
    outcomes,
    answeredShare: pct(outcomes.answered, judged),
    rules: {
      raised: 'distinct decisions: a re-ask in one lineage collapses into one ruling row',
      answeredShare: 'answered / (answered + dismissed), as lib/escalation-kpis.js; withdrawn and self-resolved are neither; a null outcome is unreadable',
    },
    notRead: [
      'answered task-bound rulings (anchor.taskDecisionId): no proxy read returns them',
      `rulings anchored on a parent or another unfinished ticket are not counted against a finished task (${onParents} on a finished task's parent)`,
    ],
    onParents,
    perTaskCounts,
  };
  const unreadable = outcomes.unknown + strange.length;
  const why = [
    outcomes.unknown ? `${outcomes.unknown} resolved ruling(s) have outcome null (a legacy digest: answered or dismissed, not recorded)` : null,
    strange.length ? `${strange.length} ruling(s) have an unknown outcome (${[...new Set(strange)].join(', ')})` : null,
  ].filter(Boolean).join('; ');
  return row('rulings', value, { unreadable, reason: unreadable ? why : null, reference });
}

/** Person-started dispatches: not readable through the proxy, so never measured, and never read from dispatchedBy. */
export const originRow = ({ reference = null } = {}) => notMeasured('origin', ORIGIN_UNREADABLE, { reference });

/**
 * One finished task's three readable conditions. `d` is its dispatch read: { membership, list, details } where list is
 * { items, total } or { reason } and details are [{ itemId, body } | { itemId, reason }]. Each condition is true, false,
 * or null when a read it needs failed and nothing read shows it true.
 */
export function taskConditions(id, { rulingCount, d }) {
  const bodies = (d?.details ?? []).filter((x) => x.body).map((x) => x.body);
  const failedDetails = (d?.details ?? []).filter((x) => !x.body);
  const why = [];
  if (!d) why.push('dispatch not read');
  if (d?.membership?.reason) why.push(d.membership.reason);
  if (failedDetails.length) why.push(`${failedDetails.length} dispatch detail read(s) failed (${[...new Set(failedDetails.map((x) => x.reason))].join('; ')})`);
  const blockedSeen = bodies.some((b) => hasBlockedMarker(b.feedback));
  const blocked = blockedSeen ? true : (!d || d.membership?.reason || failedDetails.length ? null : false);
  const listItems = d?.list?.items ?? [];
  const listShort = !d || d.list?.reason || (typeof d.list?.total === 'number' && d.list.total > listItems.length);
  if (d?.list?.reason) why.push(`dispatch list failed (${d.list.reason})`);
  else if (d && listShort) why.push(`dispatch list truncated (${listItems.length} of ${d.list.total})`);
  const closedSeen = [...listItems, ...bodies].some((r) => r?.closedReason === 'operator');
  const operatorClosed = closedSeen ? true : (listShort || failedDetails.length ? null : false);
  const ruling = rulingCount > 0;
  const needs = ruling || blocked === true || operatorClosed === true;
  const free = needs ? false : (blocked === null || operatorClosed === null ? null : true);
  return { id, ruling, blocked, operatorClosed, free, reason: free === null ? why.join('; ') : null, rootOnly: d?.membership?.rootOnly ?? 0 };
}

/**
 * The operator-free share over the three readable conditions: an upper bound, the missing condition named. A task whose
 * reads failed counts as unreadable unless a read that did succeed already shows it needed the operator.
 */
export function operatorFreeRow({ finished, rulings, dispatch, reference = null }) {
  if (!finished.length) return notMeasured('operator-free', 'no finished tasks in the window', { reference });
  if (rulings?.reason || !Array.isArray(rulings?.rulings)) {
    return notMeasured('operator-free', `the no-ruling condition is unreadable: rulings read failed: ${rulings?.reason ?? 'not read'}`, { reference });
  }
  const counts = new Map();
  for (const r of rulings.rulings) counts.set(issueOf(r), (counts.get(issueOf(r)) ?? 0) + 1);
  const perTask = finished.map((t) => taskConditions(t.id, { rulingCount: counts.get(t.id) ?? 0, d: dispatch.get(t.id) }));
  const read = perTask.filter((t) => t.free !== null);
  const unread = perTask.filter((t) => t.free === null);
  if (!read.length) return notMeasured('operator-free', `no finished task could be read (${unread[0].reason})`, { reference });
  const free = read.filter((t) => t.free).length;
  const value = {
    label: UPPER_BOUND,
    conditions: ['no loop ruling', 'no [blocked] marker in any lineage member\'s feedback', "no dispatch row closed with closedReason 'operator'"],
    missingCondition: MISSING_CONDITION,
    caveats: [
      'rulings not read (answered task-bound, parent-anchored) can only lower the true share',
      "closedReason 'operator' is a catch-all for any close outside handed-on, lineage-terminal and ticket-closed (bulk fossil passes included), so it may count tasks no person touched and push the share down",
    ],
    tasks: finished.length, read: read.length, operatorFree: free, share: pct(free, read.length),
    failing: {
      ruling: perTask.filter((t) => t.ruling).length,
      blocked: perTask.filter((t) => t.blocked === true).length,
      operatorClosed: perTask.filter((t) => t.operatorClosed === true).length,
    },
    rootOnlyLineages: perTask.reduce((n, t) => n + t.rootOnly, 0),
    perTask: perTask.map(({ id, ruling, blocked, operatorClosed, free: f }) => ({ id, ruling, blocked, operatorClosed, free: f })),
  };
  const reasons = [...new Set(unread.map((t) => t.reason))];
  return row('operator-free', value, { unreadable: unread.length, reason: unread.length ? `${unread.length} task(s) unreadable: ${reasons.join(' | ')}` : null, reference });
}

/** The seat's three rows, in order. */
export function seatRows({ finished, rulings, dispatch = new Map(), references = {} }) {
  return [
    rulingsRow({ finished, rulings, reference: references.rulings }),
    originRow({ reference: references.origin }),
    operatorFreeRow({ finished, rulings, dispatch, reference: references['operator-free'] }),
  ];
}

/** Every seat row not measured for one reason (no proxy, a failed tracker read); origin keeps its own reason. */
export const seatNotMeasured = (why, references = {}) => [
  notMeasured('rulings', why, { reference: references.rulings }),
  originRow({ reference: references.origin }),
  notMeasured('operator-free', why, { reference: references['operator-free'] }),
];
