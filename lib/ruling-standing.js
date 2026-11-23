/**
 * lib/ruling-standing.js — the workspace's "waiting on a person" standing, read from question records (LIN-4538, P7a).
 *
 * The task page's loader and Home's row states both read it: which of the loops are waiting on a question a person must
 * answer, and which tasks hold one. It used to read the three ruling stores (unanswered decisions, task-scan decisions,
 * shelves); those are retired by P7b, so this reader reads question records only. An open question is a person's
 * question when its `to` is a person; a question to a deciding stage is that stage's to answer, not the person's.
 *
 * A waiting loop is one in the lineage of the run that asked the question (a lineage's id is its root row's id,
 * `rootItemId ?? loopId`, lib/pipeline-loops.js; the asking run's lineage is questionFacts' `lineage`, which differs from the
 * run id for a leftover or a follow-up stage, lib/records/question-standing.js).
 * Task-scan decisions and shelves have no record now, so `shelvedTaskIdentifiers` and `taskScanByIdentifier` are always empty.
 */

import { questionFacts, openQuestionFacts } from './records/question-facts.js';

/** The lineage a loop belongs to: its root row's id (lib/pipeline-loops.js lineageId), or its own id for a root. */
export const lineageOfLoop = (loop) => loop?.lineageId ?? loop?.loopId ?? null;

/**
 * The standing over the given loops and open question facts (pure).
 *
 * @param {Object} input
 * @param {string|null} [input.urlKey] - the workspace the rows belong to (each row's anchor names it)
 * @param {Array<Object>} input.loops - the loops the standing reads (already windowed by the caller, if it windows)
 * @param {Array<Object>} input.facts - questionFacts' rows (lib/records/question-facts.js), open or ended
 * @param {string|null} [input.identifier] - when set, only the open questions on this ticket count
 * @param {string|null} [input.to] - when set (`person:<accountId>`), only the questions asked of that person count: Home reads the
 *   signed-in person's, so its count and placement are the cards it draws (lib/home-row-states.js)
 * @returns {{rows: Array<Object>, openLoopIds: Set<string>, shelvedTaskIdentifiers: Set<string>, taskScanByIdentifier: Map<string, Array<Object>>}}
 *   rows: one per open person question (anchor.issueIdentifier is its ticket, what Home's waiting set reads)
 */
export function rulingStandingFromQuestions({ urlKey = null, loops = [], facts = [], identifier = null, to = null }) {
  const open = openQuestionFacts(facts).filter((f) => typeof f.to === 'string' && f.to.startsWith('person:'))
    .filter((f) => !identifier || f.ticket === identifier)
    .filter((f) => !to || f.to === to);
  const rows = open.map((f) => ({
    questionId: f.questionId,
    raisedAt: f.raisedAt,
    disposition: 'open',
    decision: { decision_id: f.questionId },
    anchor: { issueIdentifier: f.ticket ?? null, issueId: null, loopId: f.runId ?? null, taskDecisionId: null, workspaceUrlKey: urlKey },
  }));
  const askingLineages = new Set(open.map((f) => f.lineage ?? f.runId).filter(Boolean));
  const openLoopIds = new Set();
  for (const loop of loops) {
    if (loop && askingLineages.has(lineageOfLoop(loop))) openLoopIds.add(loop.loopId);
  }
  return { rows, openLoopIds, shelvedTaskIdentifiers: new Set(), taskScanByIdentifier: new Map() };
}

/**
 * The workspace's standing, read the one way every surface reads it (LIN-4024, LIN-4538): one read of the question records,
 * then `rulingStandingFromQuestions`. The live-run guard that the old reduction applied to a row's effect has no meaning
 * for a question row (the answer route reads liveness itself, lib/question-answers.js), so it is not applied here.
 *
 * @param {Object} input
 * @param {string} input.urlKey
 * @param {Array<Object>} input.loops
 * @param {Date} [input.at] - the read's clock (accepted for the callers' shape; the facts are not time-sliced)
 * @param {string|null} [input.identifier]
 * @param {string|null} [input.to] - as rulingStandingFromQuestions
 * @param {import('./records-store.js').RecordsStore|null} input.recordsStore - null: no records read, so no question waits
 * @returns {Promise<ReturnType<typeof rulingStandingFromQuestions>>}
 */
export async function readRulingStanding({ urlKey, loops, identifier = null, recordsStore = null, to = null }) {
  const facts = recordsStore ? await questionFacts(recordsStore, urlKey) : [];
  return rulingStandingFromQuestions({ urlKey, loops, facts, identifier, to });
}
