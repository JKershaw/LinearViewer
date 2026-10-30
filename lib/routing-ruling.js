/**
 * The routing a recorded ruling sets on a task (LIN-4028).
 *
 * When a person rules which model a task's work runs on, the ruling is a dispatch-loop DECISION whose
 * chosen option carries `routing: {harness?, model?, effort?}` (lib/session-telemetry.js parses it), and
 * the answer is a `decision-answer` stamp that names that option. This reads those two facts back, so
 * `recommend-and-dispatch` can honour the ruling without any model writing it. Nothing here parses an
 * option's label or a comment: only a structured option counts.
 *
 * The newest answered routing decision on the task decides. Its chosen option's `routing` is the pin, and
 * a chosen option with none clears an older pin. A free-text answer, an option the decision does not
 * offer, or a dismissal does not change the pin, so an older ruling holds until a newer one names an option.
 */
import { parseDecisions } from './session-telemetry.js';
import { toEpochMs } from './utils/time.js';

// The reader needs only the feedback, and never the prompt (a long-lived task's rows are large).
const ROUTING_RULING_PROJECTION = { _id: 1, issueIdentifier: 1, dispatchedAt: 1, feedback: 1 };

/**
 * Each decision's newest answer stamp, by decision_id: the option the person chose (or null for a free
 * text answer), and whether it dismissed the decision. A stamp whose message does not parse is skipped.
 * @param {Array<{kind?: string, message?: string, timestamp?: *}>} feedback
 * @returns {Map<string, {at: number, optionId: string|null, dismissed: boolean}>}
 */
function answersOf(feedback) {
  const byDecision = new Map();
  for (const entry of feedback) {
    if (entry?.kind !== 'decision-answer' || typeof entry.message !== 'string') continue;
    let payload;
    try {
      payload = JSON.parse(entry.message);
    } catch {
      continue;
    }
    if (typeof payload?.decision_id !== 'string') continue;
    const at = toEpochMs(entry.timestamp) ?? 0;
    const prior = byDecision.get(payload.decision_id);
    if (prior && prior.at > at) continue;
    byDecision.set(payload.decision_id, {
      at,
      optionId: typeof payload.option_id === 'string' && payload.option_id ? payload.option_id : null,
      dismissed: payload.outcome === 'dismissed'
    });
  }
  return byDecision;
}

/**
 * The pin a task's rows carry, or null. Pure: the rows are whatever the store read returned.
 *
 * A decision counts when at least one of its options carries `routing`, it is answered (not dismissed),
 * it names an option the decision offers, and it targets this issue (`on_answer.record_on`, when set,
 * must be this issue). The newest such answer decides. A chosen option with no `routing` yields null, so
 * a newer ruling can clear an older pin.
 *
 * @param {Array<{feedback?: Array<Object>}>} rows - queue and history rows read for this issue
 * @param {string} issueIdentifier - the task the dispatch targets
 * @returns {{decisionId: string, optionId: string, routing: {harness?: string, model?: string, effort?: string}}|null}
 */
export function routingRulingFrom(rows, issueIdentifier) {
  const feedback = (rows || []).flatMap(row => (Array.isArray(row?.feedback) ? row.feedback : []));
  const answers = answersOf(feedback);
  let newest = null;
  for (const decision of parseDecisions(feedback)) {
    if (!decision.options?.some(opt => opt.routing)) continue;
    if (decision.on_answer?.record_on && decision.on_answer.record_on !== issueIdentifier) continue;
    const answer = answers.get(decision.decision_id);
    if (!answer || answer.dismissed || !answer.optionId) continue;
    const chosen = decision.options.find(opt => opt.id === answer.optionId);
    if (!chosen) continue;
    if (newest && answer.at <= newest.at) continue;
    newest = { at: answer.at, decisionId: decision.decision_id, optionId: chosen.id, routing: chosen.routing || null };
  }
  if (!newest?.routing) return null;
  return { decisionId: newest.decisionId, optionId: newest.optionId, routing: newest.routing };
}

/**
 * Read a task's routing ruling from the dispatch store: live rows and finished ones, by issue. Never
 * throws; a missing store or a failed read is no ruling.
 * @param {Object} store - the dispatch queue store (listItems, listHistory)
 * @param {string} urlKey
 * @param {string} issueIdentifier
 * @returns {Promise<ReturnType<typeof routingRulingFrom>>}
 */
export async function loadRoutingRuling(store, urlKey, issueIdentifier) {
  if (!store || !urlKey || !issueIdentifier) return null;
  try {
    // An identity key bounds the history read, so no limit is set: a ruling can predate the newest rows.
    const read = (fn) => Promise.resolve().then(fn);
    const [live, history] = await Promise.all([
      read(() => store.listItems(urlKey, { issueIdentifier, projection: ROUTING_RULING_PROJECTION })),
      read(() => store.listHistory(urlKey, { issueIdentifier, projection: ROUTING_RULING_PROJECTION }))
    ]);
    return routingRulingFrom([...(live || []), ...(history?.items || [])], issueIdentifier);
  } catch {
    return null;
  }
}
