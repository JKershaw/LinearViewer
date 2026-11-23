/**
 * LIN-4531 (LIN-4529 plan D1-D3): an agent's question is answered or dismissed through one route each, and the asking run is
 * resumed with the question, the option and the words together, or told the question was dismissed.
 *
 * The behaviour table (one test per row, tests/unit/lin-4531-question-answers.test.js), by the asking run's state:
 *   - resumable (the lineage tail is parked `[blocked]`, or ended inside the 7-day record window): answer -> the decision stands
 *     and one follow-up goes to the tail, its prompt the question, the option and the words, verbatim, in that order; dismiss ->
 *     the question ends `withdrawn`, and one follow-up says it was dismissed and quotes `if-unanswered`. A resumable run whose
 *     owner gate refuses the resume is refused whole before any write (422 from the gate; the question stays open).
 *   - stopped (`isRunStopped`): the decision stands (or the question is withdrawn); no follow-up. The answer says it was not
 *     resumed. A stopped run stays stopped: the follow-up this route would make is server-originated, so the factory's
 *     stopped-run guard refuses it anyway (lib/dispatch-factory.js guardRunStopped), and it is never made.
 *   - gone (past the record window, or the question has no run at all): the decision stands (or the question is withdrawn);
 *     no follow-up; the answer says no session is left and offers the usual "dispatch the next stage".
 *   - mid-turn / indeterminate: not answerable or dismissable yet (refused 409, nothing written), as today.
 *
 * Liveness and the follow-up target are read from the run's lineage tail (`runTailOf`, LIN-1486), so a run resumed before is
 * judged by the row it is in now. Order of writes, chosen so a retry after any partial failure completes what is missing and never doubles:
 *   1. the decision, under `fixedIdOf('decision', question, 'answer')` (a retry finds the record it made);
 *   2. the resume, if the run is resumable and no follow-up already carries this question's marker (lib/prompts/question-resume.js);
 *   3. the question's end (`answered` or `withdrawn`), last: a question still open after a failed step is retried whole.
 * Within this process the answer and the dismiss for one question are serialised, so two answers, or an answer racing a
 * dismissal, give one of them the 409 (`ruling-settled`) and one resume at most.
 *
 * Injected, never imported from a route: the records pipeline (`writes`, lib/records/writes.js), the records store, the
 * dispatch store, the resume enqueue (lib/follow-up-dispatch.js enqueueFollowUp, bound by the route to its owner gate and
 * credential finalize), and the clock. Returns HTTP-shaped `{status, body}` results, as the follow-up composition does.
 */
import { fixedIdOf } from './records/refs.js';
import { followUpTarget } from './dispatch-targets.js';
import { resolveDisposition, runLoopFactsOf } from './run-liveness.js';
import { questionAnsweredPrompt, questionDismissedPrompt, resumesQuestion, RESUME_ACTION } from './prompts/question-resume.js';
import { RULING_SETTLED_REFUSAL } from './ruling-settled.js';
import { createSerialLine } from './records/serial-line.js';
import { followUpForLoop } from './follow-up-dispatch.js';

/** The 409 a question already ended answers with (lib/ruling-settled.js: one shape for every route, keyed on `code`). */
export const QUESTION_SETTLED = Object.freeze({ status: 409, code: RULING_SETTLED_REFUSAL[2].code, message: RULING_SETTLED_REFUSAL[1] });

/** The refusal body for a question already settled, one shape everywhere it is returned. */
const settledResult = () => ({ status: QUESTION_SETTLED.status, body: { error: QUESTION_SETTLED.message, code: QUESTION_SETTLED.code } });

const NOT_ANSWERABLE = 'not-answerable';

/** One in-process line per question (lib/records/serial-line.js): answer and dismiss for one question never interleave here. */
const serialisedOn = createSerialLine();

/** The run a question was asked under: its first version's `run` (every version keeps it; only v1 is the asker). */
async function askingRunOf(recordsStore, urlKey, questionId) {
  const versions = await recordsStore.versionsOf(urlKey, [questionId]);
  const first = versions.find((snap) => snap.id === questionId && snap.v === 1);
  return first?.run || null;
}

/**
 * The run's state, read once per call. `stopped` is the store's predicate (never edited here). The liveness is read from the run's
 * lineage TAIL, the row a follow-up goes to (`runTailOf`), not from the run's first row: a run resumed once has later rows, and
 * the answer must see the state the run is in now (LIN-4531 review finding 76818702). `disposition` is the press-time mapping
 * from lib/run-liveness.js; `followUpTo` is the tail's id, the row the resume follows up on.
 */
async function runStateOf({ dispatchStore, urlKey, runId, now }) {
  if (!runId) return { kind: 'gone', reason: 'no-run', runId: null, row: null, target: null, followUpTo: null, force: false };
  if (await dispatchStore.isRunStopped(urlKey, runId)) {
    return { kind: 'stopped', reason: 'stopped', runId, row: null, target: null, followUpTo: null, force: false };
  }
  const row = await dispatchStore.runTailOf(urlKey, runId);
  if (!row) return { kind: 'gone', reason: 'no-session', runId, row: null, target: null, followUpTo: null, force: false };
  const facts = runLoopFactsOf(row);
  const disposition = resolveDisposition(facts, { now: now() });
  if (disposition === 'mid-turn' || disposition === 'indeterminate') {
    return { kind: NOT_ANSWERABLE, reason: disposition, runId, row, target: null, followUpTo: null, force: false };
  }
  if (disposition === 'gone') return { kind: 'gone', reason: 'no-session', runId, row, target: null, followUpTo: null, force: false };
  const target = followUpTarget(row.target);
  if (!target) return { kind: 'gone', reason: 'not-followable', runId, row, target: null, followUpTo: null, force: false };
  // The follow-up goes to the tail, and a terminal tail within the window is resumed as a forced follow-up: followUpForLoop's rule.
  const { followUpTo, force } = followUpForLoop({ loopId: row._id, ...facts });
  return { kind: 'resumable', reason: null, runId, row, target, followUpTo, force };
}

/**
 * @param {Object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {Object} deps.writes - the checked records pipeline (createRecordWrites, lib/records/writes.js)
 * @param {Object} deps.dispatchStore - needs `isRunStopped`, `runTailOf`, `followUpPromptsOf`
 * @param {(args: {urlKey: string, runId: string, followUpTo: string, prompt: string, target: string, force: boolean, dispatchedBy: string}) => Promise<{status: number, body: object}>} deps.enqueueResume
 * @param {(args: {target: string, dispatchedBy: string}) => Promise<{status: number, body: object}|null>} deps.refuseResume - the
 *   owner refusal a resume would get, checked BEFORE any write (null when the resume may go). A refused resume writes nothing.
 * @param {() => Date} [deps.now]
 */
export function createQuestionAnswers({ recordsStore, writes, dispatchStore, enqueueResume, refuseResume = async () => null, now = () => new Date() }) {
  if (!recordsStore || !writes || !dispatchStore || typeof enqueueResume !== 'function' || typeof refuseResume !== 'function') {
    throw new Error('createQuestionAnswers requires recordsStore, writes, dispatchStore, enqueueResume and refuseResume');
  }

  /** The question, checked to be an open question on this workspace. Returns {question} or {status, body}. */
  async function openQuestion(urlKey, questionId) {
    const question = await recordsStore.current(urlKey, questionId);
    if (!question) return { status: 404, body: { error: 'That question is not in this workspace' } };
    if (question.kind !== 'question') return { status: 422, body: { error: 'That record is not a question', code: 'not-a-question' } };
    if (question.ended) return settledResult();
    return { question };
  }

  /** The one resume of a question, made once the caller has found (`resumeMadeFor`, inside the serial line) that none carries the marker yet. */
  async function resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy, action }) {
    const out = await enqueueResume({ urlKey, runId: state.runId, followUpTo: state.followUpTo, prompt, target: state.target, force: state.force, dispatchedBy });
    if (out.status === 200) return { resumed: true, itemId: out.body?.itemId ?? null };
    // The run stopped between the read and the enqueue: the factory's guard refused the follow-up. Nothing was resumed.
    if (out.status === 409) return { resumed: false, reason: 'stopped' };
    return { error: { status: out.status, body: out.body } };
  }

  /**
   * Whether a resume with this action was already made for this question (its marker is on a row of the run's lineage). A retry
   * finds it. Per action: an answer's resume is not a dismissal's, and the reverse (review finding af9e77b1).
   */
  async function resumeMadeFor(urlKey, runId, questionId, action) {
    if (!runId) return false;
    return (await dispatchStore.followUpPromptsOf(urlKey, runId)).some((p) => resumesQuestion(p, questionId, action));
  }

  return {
    /**
     * Answer an open question. `option` is one of the question's options (when it offered any); `words` are the person's own
     * words. At least one is required; both are stored exactly as given.
     * @returns {Promise<{status: number, body: object}>}
     */
    answer({ urlKey, questionId, option = null, words = null, by, dispatchedBy }) {
      return serialisedOn(`${urlKey}|${questionId}`, async () => {
        const opened = await openQuestion(urlKey, questionId);
        if (opened.status) return opened;
        const { question } = opened;
        const hasOption = typeof option === 'string' && option.length > 0;
        const hasWords = typeof words === 'string' && words.trim().length > 0;
        if (!hasOption && !hasWords) {
          return { status: 400, body: { error: 'An answer needs the option chosen, your own words, or both' } };
        }
        const offered = Array.isArray(question.fields?.options) ? question.fields.options : [];
        if (hasOption && offered.length && !offered.includes(option)) {
          return { status: 422, body: { error: `'${option}' is not one of the options offered`, works: offered } };
        }

        const runId = await askingRunOf(recordsStore, urlKey, questionId);
        // The person dismissed this question and its run was resumed to take the fallback; the end then failed, so the question is
        // still open. An answer now would be a second word to a run already told the question was dismissed: refused, nothing written.
        if (await resumeMadeFor(urlKey, runId, questionId, RESUME_ACTION.DISMISSAL)) return settledResult();
        const state = await runStateOf({ dispatchStore, urlKey, runId, now });
        // A retry of an answer whose resume was already made completes the end, whatever the run is doing now (its own follow-up
        // may be queued or running): the resume is the one that was made, and it is not made twice.
        const resumeMade = await resumeMadeFor(urlKey, runId, questionId, RESUME_ACTION.ANSWER);
        if (state.kind === NOT_ANSWERABLE && !resumeMade) {
          return { status: 409, body: { error: 'The run is still working; the question can be answered once it has stopped or parked', code: NOT_ANSWERABLE, reason: state.reason } };
        }

        // The owner gate, before any write: a resume the person may not make refuses the answer whole, so nothing is left half-written.
        if (state.kind === 'resumable' && !resumeMade) {
          const refused = await refuseResume({ target: state.target, dispatchedBy });
          if (refused) return refused;
        }

        // 1. The decision. Its id is derived from the question, so a retry finds it; a different answer than the one
        // already written is refused, never silently mixed with the first.
        const decisionId = fixedIdOf('decision', questionId, 'answer');
        const existing = await recordsStore.current(urlKey, decisionId);
        if (existing && ((existing.fields?.answer ?? null) !== (hasOption ? option : null) || (existing.fields?.words ?? null) !== (hasWords ? words : null))) {
          return { status: 409, body: { error: 'This question already has a different answer', code: 'decision-exists', decisionId } };
        }
        const input = { links: { answers: questionId }, ...(hasOption ? { answer: option } : {}), ...(hasWords ? { words } : {}) };
        const written = await writes.add({ urlKey, kind: 'decision', input, by, run: null, fixedId: decisionId });
        if (written.problems) return { status: 422, body: { error: written.problems[0]?.message || 'The answer was refused', problems: written.problems } };

        // 2. The resume, or the reason there is none.
        let resumed = false;
        let reason = null;
        if (resumeMade) {
          resumed = true;
        } else if (state.kind === 'resumable') {
          const prompt = questionAnsweredPrompt({ questionId, asks: question.fields?.asks ?? '', option: hasOption ? option : null, words: hasWords ? words : null });
          const out = await resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy, action: RESUME_ACTION.ANSWER });
          if (out.error) return out.error;
          resumed = out.resumed;
          if (!out.resumed) reason = out.reason;
        } else {
          reason = state.reason;
        }

        // 3. The question ends, last.
        const ended = await writes.end({ urlKey, id: questionId, input: { state: 'answered', reason: `answered by ${decisionId}` }, by, run: null });
        if (ended.problems) return { status: 422, body: { error: ended.problems[0]?.message || 'The question could not be ended', problems: ended.problems } };
        if (ended.changed === false) return settledResult();

        return {
          status: 200,
          body: {
            answered: true,
            questionId,
            decisionId,
            resumed,
            ...(reason ? { notResumedBecause: reason, note: noteFor(reason) } : {}),
          },
        };
      });
    },

    /**
     * Dismiss an open question: the question ends `withdrawn` by the person, reason "dismissed". A resumable run is told so and
     * takes its fallback; a stopped or gone run has nothing to tell.
     * @returns {Promise<{status: number, body: object}>}
     */
    dismiss({ urlKey, questionId, by, dispatchedBy }) {
      return serialisedOn(`${urlKey}|${questionId}`, async () => {
        const opened = await openQuestion(urlKey, questionId);
        if (opened.status) return opened;
        const { question } = opened;

        const runId = await askingRunOf(recordsStore, urlKey, questionId);
        // The question is settled by an answer when its resume was made, or its decision stands (an answer that failed before its
        // resume or its end). A dismissal then would contradict the decision on record, so it is refused and writes nothing.
        const decided = await recordsStore.current(urlKey, fixedIdOf('decision', questionId, 'answer'));
        if (decided || await resumeMadeFor(urlKey, runId, questionId, RESUME_ACTION.ANSWER)) return settledResult();
        const state = await runStateOf({ dispatchStore, urlKey, runId, now });
        const resumeMade = await resumeMadeFor(urlKey, runId, questionId, RESUME_ACTION.DISMISSAL);
        if (state.kind === NOT_ANSWERABLE && !resumeMade) {
          return { status: 409, body: { error: 'The run is still working; the question can be dismissed once it has stopped or parked', code: NOT_ANSWERABLE, reason: state.reason } };
        }

        if (state.kind === 'resumable' && !resumeMade) {
          const refused = await refuseResume({ target: state.target, dispatchedBy });
          if (refused) return refused;
        }

        let resumed = false;
        let reason = null;
        if (resumeMade) {
          resumed = true;
        } else if (state.kind === 'resumable') {
          const prompt = questionDismissedPrompt({ questionId, asks: question.fields?.asks ?? '', ifUnanswered: question.fields?.['if-unanswered'] ?? null });
          const out = await resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy, action: RESUME_ACTION.DISMISSAL });
          if (out.error) return out.error;
          resumed = out.resumed;
          if (!out.resumed) reason = out.reason;
        } else {
          reason = state.reason;
        }

        const ended = await writes.end({ urlKey, id: questionId, input: { state: 'withdrawn', reason: 'dismissed' }, by, run: null });
        if (ended.problems) return { status: 422, body: { error: ended.problems[0]?.message || 'The question could not be ended', problems: ended.problems } };
        if (ended.changed === false) return settledResult();

        return {
          status: 200,
          body: {
            dismissed: true,
            questionId,
            resumed,
            ...(reason ? { notResumedBecause: reason, note: noteFor(reason) } : {}),
          },
        };
      });
    },
  };
}

/** What the page says when the run was not resumed. */
function noteFor(reason) {
  if (reason === 'stopped') return 'The run was stopped, so it was not resumed. The decision stands for the next stage to read.';
  if (reason === 'not-followable') return 'The run cannot take a follow-up here, so it was not resumed. Dispatch the next stage to carry the decision on.';
  return 'No session is left to resume. The decision stands; dispatch the next stage to carry it on.';
}
