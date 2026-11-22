/**
 * LIN-4531 (LIN-4529 plan D1-D3): an agent's question is answered or dismissed through one route each, and the asking run is
 * resumed with the question, the option and the words together, or told the question was dismissed.
 *
 * The behaviour table (one test per row, tests/unit/lin-4531-question-answers.test.js), by the asking run's state:
 *   - resumable (parked `[blocked]`, or ended inside the 7-day record window): answer -> the decision stands and one follow-up
 *     goes to the run, its prompt the question, the option and the words, verbatim, in that order; dismiss -> the question
 *     ends `withdrawn`, and one follow-up says it was dismissed and quotes `if-unanswered`.
 *   - stopped (`isRunStopped`): the decision stands (or the question is withdrawn); no follow-up. The answer says it was not
 *     resumed. A stopped run stays stopped: the follow-up this route would make is server-originated, so the factory's
 *     stopped-run guard refuses it anyway (lib/dispatch-factory.js guardRunStopped), and it is never made.
 *   - gone (past the record window, or the question has no run at all): the decision stands (or the question is withdrawn);
 *     no follow-up; the answer says no session is left and offers the usual "dispatch the next stage".
 *   - mid-turn / indeterminate: not answerable or dismissable yet (refused 409, nothing written), as today.
 *
 * Order of writes, chosen so a retry after any partial failure completes what is missing and never doubles:
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
import { questionAnsweredPrompt, questionDismissedPrompt, resumesQuestion } from './prompts/question-resume.js';
import { RULING_SETTLED_REFUSAL } from './ruling-settled.js';
import { createSerialLine } from './records/serial-line.js';
import { followUpForLoop } from './follow-up-dispatch.js';

/** The 409 a question already ended answers with (lib/ruling-settled.js: one shape for every route, keyed on `code`). */
export const QUESTION_SETTLED = Object.freeze({ status: 409, code: RULING_SETTLED_REFUSAL[2].code, message: RULING_SETTLED_REFUSAL[1] });

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
 * The run's state, read once per call. `stopped` is the store's predicate (never edited here); `disposition` is the press-time
 * mapping from lib/run-liveness.js; `followable` is the target a follow-up can be made to, or null.
 */
async function runStateOf({ dispatchStore, urlKey, runId, now }) {
  if (!runId) return { kind: 'gone', reason: 'no-run', runId: null, row: null, target: null, force: false };
  if (await dispatchStore.isRunStopped(urlKey, runId)) {
    return { kind: 'stopped', reason: 'stopped', runId, row: null, target: null, force: false };
  }
  const row = await dispatchStore.rowForRunRecords(urlKey, runId);
  if (!row) return { kind: 'gone', reason: 'no-session', runId, row: null, target: null, force: false };
  const facts = runLoopFactsOf(row);
  const disposition = resolveDisposition(facts, { now: now() });
  if (disposition === 'mid-turn' || disposition === 'indeterminate') {
    return { kind: NOT_ANSWERABLE, reason: disposition, runId, row, target: null, force: false };
  }
  if (disposition === 'gone') return { kind: 'gone', reason: 'no-session', runId, row, target: null, force: false };
  const target = followUpTarget(row.target);
  if (!target) return { kind: 'gone', reason: 'not-followable', runId, row, target: null, force: false };
  // A terminal run within the window is resumed as a forced follow-up: the one rule, followUpForLoop's.
  const { force } = followUpForLoop({ loopId: runId, ...facts });
  return { kind: 'resumable', reason: null, runId, row, target, force };
}

/**
 * @param {Object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {Object} deps.writes - the checked records pipeline (createRecordWrites, lib/records/writes.js)
 * @param {Object} deps.dispatchStore - needs `isRunStopped`, `rowForRunRecords`, `followUpPromptsOf`
 * @param {(args: {urlKey: string, runId: string, prompt: string, target: string, force: boolean, dispatchedBy: string}) => Promise<{status: number, body: object}>} deps.enqueueResume
 * @param {() => Date} [deps.now]
 */
export function createQuestionAnswers({ recordsStore, writes, dispatchStore, enqueueResume, now = () => new Date() }) {
  if (!recordsStore || !writes || !dispatchStore || typeof enqueueResume !== 'function') {
    throw new Error('createQuestionAnswers requires recordsStore, writes, dispatchStore and enqueueResume');
  }

  /** The question, checked to be an open question on this workspace. Returns {question} or {status, body}. */
  async function openQuestion(urlKey, questionId) {
    const question = await recordsStore.current(urlKey, questionId);
    if (!question) return { status: 404, body: { error: 'That question is not in this workspace' } };
    if (question.kind !== 'question') return { status: 422, body: { error: 'That record is not a question', code: 'not-a-question' } };
    if (question.ended) return { status: QUESTION_SETTLED.status, body: { error: QUESTION_SETTLED.message, code: QUESTION_SETTLED.code } };
    return { question };
  }

  /** The one resume of a question: made when the run is resumable and none carries the marker yet. */
  async function resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy }) {
    const prompts = await dispatchStore.followUpPromptsOf(urlKey, state.runId);
    if (prompts.some((p) => resumesQuestion(p, questionId))) return { resumed: true, already: true };
    const out = await enqueueResume({ urlKey, runId: state.runId, prompt, target: state.target, force: state.force, dispatchedBy });
    if (out.status === 200) return { resumed: true, itemId: out.body?.itemId ?? null };
    // The run stopped between the read and the enqueue: the factory's guard refused the follow-up. Nothing was resumed.
    if (out.status === 409) return { resumed: false, reason: 'stopped' };
    return { error: { status: out.status, body: out.body } };
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

        const state = await runStateOf({ dispatchStore, urlKey, runId: await askingRunOf(recordsStore, urlKey, questionId), now });
        if (state.kind === NOT_ANSWERABLE) {
          return { status: 409, body: { error: 'The run is still working; the question can be answered once it has stopped or parked', code: NOT_ANSWERABLE, reason: state.reason } };
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
        if (state.kind === 'resumable') {
          const prompt = questionAnsweredPrompt({ questionId, asks: question.fields?.asks ?? '', option: hasOption ? option : null, words: hasWords ? words : null });
          const out = await resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy });
          if (out.error) return out.error;
          resumed = out.resumed;
          if (!out.resumed) reason = out.reason;
        } else {
          reason = state.reason;
        }

        // 3. The question ends, last.
        const ended = await writes.end({ urlKey, id: questionId, input: { state: 'answered', reason: `answered by ${decisionId}` }, by, run: null });
        if (ended.problems) return { status: 422, body: { error: ended.problems[0]?.message || 'The question could not be ended', problems: ended.problems } };
        if (ended.changed === false) return { status: QUESTION_SETTLED.status, body: { error: QUESTION_SETTLED.message, code: QUESTION_SETTLED.code } };

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

        const state = await runStateOf({ dispatchStore, urlKey, runId: await askingRunOf(recordsStore, urlKey, questionId), now });
        if (state.kind === NOT_ANSWERABLE) {
          return { status: 409, body: { error: 'The run is still working; the question can be dismissed once it has stopped or parked', code: NOT_ANSWERABLE, reason: state.reason } };
        }

        let resumed = false;
        let reason = null;
        if (state.kind === 'resumable') {
          const prompt = questionDismissedPrompt({ questionId, asks: question.fields?.asks ?? '', ifUnanswered: question.fields?.['if-unanswered'] ?? null });
          const out = await resumeOnce({ urlKey, questionId, state, prompt, dispatchedBy });
          if (out.error) return out.error;
          resumed = out.resumed;
          if (!out.resumed) reason = out.reason;
        } else {
          reason = state.reason;
        }

        const ended = await writes.end({ urlKey, id: questionId, input: { state: 'withdrawn', reason: 'dismissed' }, by, run: null });
        if (ended.problems) return { status: 422, body: { error: ended.problems[0]?.message || 'The question could not be ended', problems: ended.problems } };
        if (ended.changed === false) return { status: QUESTION_SETTLED.status, body: { error: QUESTION_SETTLED.message, code: QUESTION_SETTLED.code } };

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
