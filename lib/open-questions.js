/**
 * LIN-4532 (LIN-4529 plan D2, P2b): the open question records one person is asked, read as every surface shows them.
 *
 * One reader for every surface: the rulings feed (routes/dashboard-rulings.js), Home's Waiting on you and its count
 * (lib/home-row-states.js), the run page's pinned cards (openQuestionsForRun), the task page's cards (openQuestionsForTask) and
 * the chat tool `list_pending_decisions` (lib/chat-tools.js), so the pages, the count and the badge cannot disagree. A question is open for the person when it is current, its state is
 * `open`, and its `to` is `person:<accountId>` (the canonical account, the same id the answer route files its decision under).
 *
 * Each row's `interactive` is read the way the answer route reads the asking run (lib/question-answers.js runStateOf): a run still
 * working (`mid-turn`, `indeterminate`) is read-only; anything else can be answered or dismissed, and the answer says what happened
 * (resumed, not resumed because the run was stopped, or no session left).
 */
import { askingRunOf, runStateOf, NOT_ANSWERABLE } from './question-answers.js';

/**
 * @param {object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {object} deps.dispatchStore - needs isRunStopped, runTailOf (lib/question-answers.js runStateOf)
 * @param {string} deps.urlKey - the workspace the questions are in
 * @param {string|null} deps.accountId - the canonical account of the person; null reads nothing
 * @param {() => Date} [deps.now]
 * @returns {Promise<Array<{questionId: string, asks: string, options: string[], recommended: string|null, ifUnanswered: string|null,
 *   taskId: string|null, ticket: string|null, runId: string|null, askedAt: string|null, state: string, reason: string|null, interactive: boolean}>>}
 */
export async function openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now = () => new Date() }) {
  if (!accountId) return [];
  const questions = await recordsStore.find(urlKey, { kind: 'question', state: 'open', to: `person:${accountId}` });
  const rows = [];
  for (const question of questions) {
    const runId = await askingRunOf(recordsStore, urlKey, question.id);
    const state = await runStateOf({ dispatchStore, urlKey, runId, now });
    const fields = question.fields || {};
    const first = (await recordsStore.versionsOf(urlKey, [question.id])).find((snap) => snap.v === 1);
    rows.push({
      questionId: question.id,
      asks: typeof fields.asks === 'string' ? fields.asks : '',
      options: Array.isArray(fields.options) ? fields.options.filter((o) => typeof o === 'string') : [],
      recommended: typeof fields.recommended === 'string' && fields.recommended ? fields.recommended : null,
      ifUnanswered: typeof fields['if-unanswered'] === 'string' && fields['if-unanswered'].trim() ? fields['if-unanswered'].trim() : null,
      // `in` names the task RECORD (lib/records/check.js resolves a ticket to its task id); `ticket` is its identifier, what a page is keyed by.
      taskId: question.in ?? null,
      ticket: question.in ? await recordsStore.ticketOfTask(urlKey, question.in) : null,
      runId,
      askedAt: first?.at ?? null,
      state: state.kind,
      reason: state.reason ?? null,
      interactive: state.kind !== NOT_ANSWERABLE,
    });
  }
  return rows.sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
}

/**
 * LIN-4532 (P2b): the open questions the person was asked by ONE run (its session id: the run id a question records as `run`),
 * for the run page's pinned cards. The same reader as the rulings feed, filtered to the run.
 * @returns {Promise<Array<Object>>} openQuestionsFor's rows whose asking run is `runId`
 */
export async function openQuestionsForRun({ recordsStore, dispatchStore, urlKey, accountId, runId, now = () => new Date() }) {
  if (!runId) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now });
  return rows.filter((row) => row.runId === runId);
}

/**
 * LIN-4532 (P2b): the open questions on one task, by its ticket identifier (`LIN-n`, what the task page is keyed by), for the task page.
 * @returns {Promise<Array<Object>>} openQuestionsFor's rows whose task's ticket is `ticket`
 */
export async function openQuestionsForTask({ recordsStore, dispatchStore, urlKey, accountId, ticket, now = () => new Date() }) {
  if (!ticket) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now });
  return rows.filter((row) => row.ticket === ticket);
}
