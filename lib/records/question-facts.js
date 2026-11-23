/**
 * LIN-4538 (LIN-4529 plan P7a): the question facts every reader outside the ruling machinery shares.
 *
 * A question record is the only ask now (LIN-4531 writes it; LIN-4532 shows it). Its end says how it was settled, and the
 * readers that used to read the three ruling stores (the escalation KPIs, the observer sweep, the ticket closer, Home and
 * session rows, the selector's rulings fact and look-first, the chat tools, the stability scripts) read these facts instead,
 * so they agree on one meaning for each end:
 *
 *   - `answered`: an answer stood (`state` answered).
 *   - `dismissed`: the question ended `withdrawn` by a PERSON with reason "dismissed" (LIN-4531's dismiss route). Only this
 *     counts as a false escalation.
 *   - `self-resolved`: the question ended `withdrawn` with reason "ticket closed" (the ticket closer, below). It is not a
 *     dismissal: the person never saw it dismissed, the ticket was just finished.
 *   - `null`: any other end (a question withdrawn by an agent or handed on). No reader counts it as a decision outcome.
 *
 * "Raised" is the question's first version (v1): its `at` is when it was asked, and its `run` is the asking run.
 */

import { HARBOUR_WRITER } from './writes.js';

/** The reason the dismiss route writes on a question it withdraws (lib/question-answers.js dismiss). */
export const DISMISSED_REASON = 'dismissed';
/** The reason the ticket closer writes when a closed ticket's open questions end (this module's endOpenQuestionsOfTicket). */
export const TICKET_CLOSED_QUESTION_REASON = 'ticket closed';
/** The actor a Harbour-made end is filed under: the checked writes' own (lib/records/writes.js). */
const HARBOUR_ACTOR = HARBOUR_WRITER;

/**
 * The outcome one question's current version settles to (see the header). Pure.
 * @param {{state: string, reason?: string|null, by?: string|null}} question
 * @returns {'answered'|'dismissed'|'self-resolved'|null}
 */
export function questionOutcomeOf({ state, reason = null, by = null } = {}) {
  if (state === 'answered') return 'answered';
  if (state !== 'withdrawn') return null;
  if (reason === DISMISSED_REASON && typeof by === 'string' && by.startsWith('person:')) return 'dismissed';
  if (reason === TICKET_CLOSED_QUESTION_REASON) return 'self-resolved';
  return null;
}

/**
 * Every question in one workspace, with the facts the readers need. One read of the current versions and one of the
 * question's first versions (for raisedAt and the asking run). A task's ticket is looked up once per task.
 *
 * @param {import('../records-store.js').RecordsStore} recordsStore
 * @param {string} urlKey
 * @returns {Promise<Array<{questionId: string, state: string, to: string|null, taskId: string|null, ticket: string|null,
 *   runId: string|null, raisedAt: string|null, resolvedAt: string|null, endedBy: string|null, reason: string|null,
 *   outcome: 'answered'|'dismissed'|'self-resolved'|null}>>}
 */
export async function questionFacts(recordsStore, urlKey) {
  const current = await recordsStore.find(urlKey, { kind: 'question' });
  if (!current.length) return [];
  const firstVersions = new Map();
  for (const snap of await recordsStore.versionsOf(urlKey, current.map((q) => q.id))) {
    if (snap.v === 1) firstVersions.set(snap.id, snap);
  }
  const ticketOf = new Map();
  const rows = [];
  for (const q of current) {
    const first = firstVersions.get(q.id);
    const taskId = q.in ?? null;
    if (taskId && !ticketOf.has(taskId)) ticketOf.set(taskId, await recordsStore.ticketOfTask(urlKey, taskId));
    const ended = q.state !== 'open';
    const reason = ended ? (q.ended?.reason ?? null) : null;
    const endedBy = ended ? (q.by ?? null) : null;
    rows.push({
      questionId: q.id,
      state: q.state,
      to: q.to ?? null,
      taskId,
      ticket: taskId ? ticketOf.get(taskId) : null,
      runId: first?.run || null,
      raisedAt: first?.at ?? null,
      resolvedAt: ended ? (q.at ?? null) : null,
      endedBy,
      reason,
      outcome: ended ? questionOutcomeOf({ state: q.state, reason, by: endedBy }) : null,
    });
  }
  return rows;
}

/**
 * The open questions among `questionFacts`' rows (state `open`), in the order the facts give them.
 * @param {Array<object>} facts
 */
export const openQuestionFacts = (facts) => facts.filter((f) => f.state === 'open');

/**
 * The ticket closer's write: every open question on the task a closed ticket claims ends `withdrawn`, reason "ticket closed",
 * filed under Harbour. Nothing is asked of anyone and nothing counts as a dismissal (questionOutcomeOf). A ticket with no task
 * has no questions. Ending a question that another write already ended is a no-op (writes.end returns it unchanged).
 * The end goes through the checked write (lib/records/writes.js `end`), never the store's own `end`: the store is written
 * only there (LIN-4494).
 *
 * @param {object} p
 * @param {import('../records-store.js').RecordsStore} p.recordsStore - read only: the ticket's task and its open questions
 * @param {ReturnType<import('./writes.js').createRecordWrites>} p.writes - the checked writes the ends go through
 * @param {string} p.urlKey
 * @param {string} p.ticket - the closed ticket's identifier (LIN-n)
 * @returns {Promise<{ended: number}>} how many open questions this call ended
 */
export async function endOpenQuestionsOfTicket({ recordsStore, writes, urlKey, ticket }) {
  if (!writes) throw new Error('endOpenQuestionsOfTicket: the checked writes (createRecordWrites) are required; the store is written only through them');
  if (!ticket) return { ended: 0 };
  const taskId = await recordsStore.taskForTicket(urlKey, ticket);
  if (!taskId) return { ended: 0 };
  const open = await recordsStore.find(urlKey, { kind: 'question', state: 'open', inRef: taskId });
  let ended = 0;
  for (const q of open) {
    const out = await writes.end({ urlKey, id: q.id, input: { state: 'withdrawn', reason: TICKET_CLOSED_QUESTION_REASON }, by: HARBOUR_ACTOR });
    if (out.problems) throw new Error(`question ${q.id} could not be ended: ${out.problems.map((x) => x.message).join('; ')}`);
    if (out.changed) ended += 1;
  }
  return { ended };
}
