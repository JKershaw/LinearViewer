import { rulingStandingFromQuestions } from '../../../lib/ruling-standing.js';
/**
 * LIN-4538 (P7a): an in-memory records reader for the three reads question facts make (lib/records/question-facts.js): `find`,
 * `versionsOf` and the ticket <-> task lookups. Unit tests of the standing, Home, the task page and the selector use it in place
 * of the three ruling stores. Each question is one record: `ticket` (its task's identifier), `run` (the asking run, the lineage's
 * root id), `to` (default: the owner), and optionally `ended: {state, reason, by, at}` once it has settled.
 */
const taskOf = (ticket) => `task-${ticket}`;

export function questionRecordsOf(questions = []) {
  const v1 = (q) => ({
    id: q.id, v: 1, kind: 'question', state: 'open', to: q.to ?? 'person:acct-owner', in: taskOf(q.ticket),
    run: q.run ?? null, at: q.at ?? '2026-10-30T10:05:00.000Z', by: 'implementation', fields: { asks: q.asks ?? 'Which way?' },
  });
  const current = (q) => {
    if (!q.ended) return v1(q);
    return { ...v1(q), state: q.ended.state, by: q.ended.by ?? 'harbour', at: q.ended.at ?? '2026-10-30T11:00:00.000Z', ended: { reason: q.ended.reason ?? null }, v: 2 };
  };
  return {
    async find(_urlKey, { kind, state, inRef } = {}) {
      return questions.map(current).filter((s) => (!kind || s.kind === kind) && (!state || s.state === state)
        && (inRef === undefined || s.in === inRef));
    },
    async versionsOf(_urlKey, ids) {
      return questions.filter((q) => ids.includes(q.id)).map(v1);
    },
    async ticketOfTask(_urlKey, taskId) { return taskId.startsWith('task-') ? taskId.slice('task-'.length) : null; },
    async taskForTicket(_urlKey, ticket) { return ticket ? taskOf(ticket) : null; },
  };
}

/**
 * One open question per loop that carries a decision and is not already answered: the question a worker asked from its run
 * (`run` is the loop's lineage id, the root row a question's run names).
 */
export function questionsFromLoops(loops = []) {
  return loops.filter((l) => l?.decision?.decision_id && l.issueIdentifier).map((l) => ({
    id: `q-${l.loopId}`, ticket: l.issueIdentifier, run: l.lineageId ?? l.loopId, asks: l.decision.question ?? 'Which way?',
  }));
}

/**
 * The question standing (lib/ruling-standing.js) over `loops` as their decisions make it: the open question facts those loops'
 * questions would read as, through the same pure reduction the surfaces call. Synchronous, for the row builders and the
 * task-page model, which take the standing as an input.
 */
export function standingOfLoops(loops = [], { urlKey = 'acme' } = {}) {
  const facts = questionsFromLoops(loops).map((q) => ({
    questionId: q.id, state: 'open', to: 'person:acct-owner', ticket: q.ticket, runId: q.run, raisedAt: '2026-10-30T10:05:00.000Z',
    taskId: `task-${q.ticket}`, resolvedAt: null, endedBy: null, reason: null, outcome: null,
  }));
  return rulingStandingFromQuestions({ urlKey, loops, facts });
}

/**
 * The open question rows a task page's question section draws (lib/open-questions.js openQuestionsForTask's shape) for the
 * loops' decisions: one per loop that carries an open decision, addressed to the owner, asked by the loop's run.
 */
export function openQuestionRowsOf(loops = []) {
  return questionsFromLoops(loops).map((q) => ({
    questionId: q.id, asks: q.asks, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
    taskId: `task-${q.ticket}`, ticket: q.ticket, runId: q.run, askedAt: '2026-10-30T10:05:00.000Z',
    state: 'gone', reason: 'no-session', interactive: true,
  }));
}
