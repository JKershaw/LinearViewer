/**
 * The look-first sequence (LIN-4346 piece 4, LIN-4370): a route code settles, after the
 * live-stage wait and the review loop bound. A fresh ticket with no size of the move yet goes
 * survey-task, then survey-place, then scoping, each attempted once, without asking a
 * model. A gate-marked Periodical review lands docs only, so its sequence is scoping alone
 * (LIN-4398, lookFirstSteps). Both recommendation seams call it through one helper (lib/openrouter.js
 * codeRoutedRecommendation), so the streamed step on the task page and the step
 * recommend-and-dispatch sends never differ.
 *
 * What it protects, and what it never overrides. It never overrides a person's word on
 * work already under way, never runs on blocked work, and never sends the same step twice.
 * It reads only whether a step happened, never what a step said: the Surveys stay advice,
 * not a gate, with no review loop of their own (docs/plans/survey.md), and their `route`
 * stays null, so the stage selector still never offers them.
 *
 * When it applies (all must hold):
 *   - the description has an `## As asked` block; the ticket is a leaf; it is not
 *     completed or canceled (a Periodical review's sequence is scoping alone, lookFirstSteps);
 *   - no size record (lib/size-of-move.js readSizeRecord), no plan (description or a plan
 *     comment; a breakdown child whose plan is its parent's still gets the sequence) and no
 *     PR linked on the trail;
 *   - no open blocker (`issue.blockedBy` with a non-terminal state);
 *   - the newest run is not waiting on a person;
 *   - no person's comment holds it (see holdingComment).
 *   - the runs are known: `allRuns` is an array. A failed run read is "attempts unknown",
 *     and the route stands aside rather than re-send a step it cannot see.
 *
 * An open `DECISION:` from a run that ended `done` does not hold the route (LIN-4346
 * verdict note 1, an engineering choice). Such a run does not read as waiting on a
 * person, and the one reader of open questions, openDecisionLoopIds
 * (lib/unanswered-decisions.js), needs whole loops: lineage, supersede and the autopilot
 * join, whose answering side is not on this ticket's 20-row run read. Reading it here
 * would be a new store read, which the verdict ruled out. So the remaining look-first
 * steps proceed, at most once each, and read that ruling on the trail; the Surveys write
 * only a comment, and scoping records a pending size rather than settle a ruling it cannot.
 *
 * Waiting on a live run (LIN-4370, LIN-4392). The general live-stage wait
 * (lib/recommendation-live-wait.js) runs first in lib/openrouter.js codeRouteOf: while any stage
 * run is queued or running, nothing reaches this route, so scoping never starts before
 * survey-place's note exists. This route only picks a step or stands aside. It meets a live run
 * only when recommend-and-dispatch skips the wait (`force: true` or a set `followUpTo`); a live
 * step is attempted, so the step after it is sent.
 *
 * Which step (pickStep). A Survey is attempted when its headed comment exists or any run
 * of its kind is on record, whatever its outcome (queued, running, waiting, ended, failed);
 * scoping when a size record exists (then the route is already off) or any scoping run is
 * on record. Once every step of the ticket's list is attempted, the route stands aside and the
 * selector decides, so a scoping run that failed to write a record falls through once and is
 * never re-sent.
 * Attempts come from the unsliced run list of the same single store read the selector's
 * 5-run slice comes from (lib/recent-runs.js loadRecentRuns): up to 20 history rows,
 * counted before non-stage rows are dropped, plus live rows. Residual risk: a ticket with
 * more than 20 rows before sizing, and a Survey that ran without posting, could see that
 * Survey run again.
 *
 * Handoff (LIN-4369 ledger item 1): the route and every stage after it read the ticket, its
 * comments and the size record in the description. No run's messages reach a prompt: the
 * run facts carry stage, times and outcome only, so scoping's final report, which carries
 * how, never reaches the builder.
 */
import { isTerminalState } from './providers/state-map.js';
import { splitAsAsked } from './as-asked.js';
import { readSizeRecord } from './size-of-move.js';
import { assembleTrailFacts, isPersonComment } from './recommendation-facts.js';
import { SURVEY_HEADINGS } from './prompt-template-defs.js';
import { toEpochMs } from './utils/time.js';
import { WAITING_ON_A_PERSON } from './recent-runs.js';
import { isPeriodicalReview } from './periodicals.js';

/** The sequence, in order. Each name is a stage template's key and name. */
export const LOOK_FIRST_STEPS = Object.freeze(['survey-task', 'survey-place', 'scoping']);

/**
 * A gate-marked Periodical review (LIN-4398): its docs-only PR gets no Surveys, so scoping alone.
 * Retires the two automatic Survey runs on those tickets, and with them survey-place's reading of
 * the area-note edits they land. Every other ticket keeps LOOK_FIRST_STEPS.
 */
const PERIODICAL_REVIEW_STEPS = Object.freeze(['scoping']);

/**
 * The look-first steps for one ticket, in order: scoping alone for a gate-marked Periodical
 * review, LOOK_FIRST_STEPS otherwise. The marker test is isPeriodicalReview (the marker parser,
 * not a second one). Pure.
 * @param {string|null|undefined} description
 * @returns {readonly string[]}
 */
export function lookFirstSteps(description) {
  return isPeriodicalReview(description) ? PERIODICAL_REVIEW_STEPS : LOOK_FIRST_STEPS;
}

/** The comment's first non-blank line, trimmed. */
const firstLine = (body) => (String(body || '').split('\n').find(l => l.trim()) || '').trim();

/** Whether a comment is the Survey `kind`'s own report: it opens with that Survey's heading. */
export function isSurveyComment(body, kind) {
  const heading = SURVEY_HEADINGS[kind];
  if (!heading) return false;
  const line = firstLine(body);
  return line.startsWith(heading) && /^(?:$|[:\s])/.test(line.slice(heading.length));
}

const isAnySurveyComment = (body) => Object.keys(SURVEY_HEADINGS).some(kind => isSurveyComment(body, kind));
const timeOf = (at) => toEpochMs(at);
const sentAt = (run) => timeOf(run.dispatchedAt ?? run.at);

/**
 * When the sequence started: the earlier of the ticket's first run (by dispatch time) and its
 * first Survey comment. Null when neither exists, so every comment so far is filing context.
 * @returns {number|null} epoch ms
 */
export function sequenceStart(comments = [], runs = []) {
  const times = [
    ...runs.map(sentAt),
    ...comments.filter(c => c && isAnySurveyComment(c.body)).map(c => timeOf(c.createdAt))
  ].filter(t => t != null);
  return times.length ? Math.min(...times) : null;
}

/**
 * The person's comment holding the route, or null. A person's comment (isPersonComment)
 * posted after the sequence started holds it until a run DISPATCHED after that comment exists
 * (by `dispatchedAt`; a run that merely ends after it does not release it, so a comment posted
 * mid-run still holds once that run ends). Comments before the start are the filing ("Before
 * you start" notes): they never turn the route off, and the Surveys and scoping read them.
 * Headed comments, including a person's `## Size of the move (the person's call)` ruling, are
 * not person comments by isPersonComment's rule, so they never hold: scoping reads them as
 * rulings. A Survey's own headed comment never holds either.
 * @returns {Object|null} the holding comment
 */
export function holdingComment(comments = [], runs = []) {
  const start = sequenceStart(comments, runs);
  if (start == null) return null;
  const after = comments
    .filter(c => c && typeof c.body === 'string' && isPersonComment(c.body))
    .filter(c => (timeOf(c.createdAt) ?? -Infinity) > start)
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
  const latest = after.at(-1);
  if (!latest) return null;
  const at = timeOf(latest.createdAt);
  return runs.some(r => (sentAt(r) ?? -Infinity) > at) ? null : latest;
}

/** Whether a look-first step has been attempted (see the module note). */
function attempted(step, comments, runs) {
  if (runs.some(r => r.stage === step)) return true;
  return step !== 'scoping' && comments.some(c => c && isSurveyComment(c.body, step));
}

/** Why the route is off, or null when it applies. Each reason is a short phrase. */
export function lookFirstOff(issue = {}, context = {}) {
  const comments = Array.isArray(context.comments) ? context.comments : [];
  const runs = context.allRuns;
  const description = issue.description || '';
  if (!Array.isArray(runs)) return 'runs unknown';
  if (!splitAsAsked(description)) return 'no As-asked block';
  if ((context.children || []).length > 0) return 'not a leaf';
  if (isTerminalState(issue.state?.type)) return 'completed or canceled';
  if (readSizeRecord(description)) return 'size recorded';
  const facts = assembleTrailFacts(comments, description, { leaf: true });
  if (facts.plan?.where) return 'has a plan';
  if (facts.prUrls.length) return 'has a PR';
  if ((issue.blockedBy || []).some(b => !isTerminalState(b?.state?.type))) return 'open blocker';
  if (runs.at(-1)?.outcome === WAITING_ON_A_PERSON) return 'newest run waiting on a person';
  if (holdingComment(comments, runs)) return "a person's comment holds it";
  return null;
}

/**
 * The look-first step to send, or null when the route does not apply or every step has been
 * attempted (the selector decides).
 * @param {Object} issue - with description, state, blockedBy
 * @param {Object} context - the recommendation input: comments, children, allRuns
 * @returns {{step: string, why: string}|null}
 */
export function lookFirstStep(issue = {}, context = {}) {
  if (lookFirstOff(issue, context)) return null;
  const comments = Array.isArray(context.comments) ? context.comments : [];
  const steps = lookFirstSteps(issue.description);
  const step = steps.find(s => !attempted(s, comments, context.allRuns));
  if (!step) return null;
  // Steps this ticket's list leaves out are said to be skipped, never attempted: they did not run.
  const skipped = LOOK_FIRST_STEPS.filter(s => !steps.includes(s));
  const lead = skipped.length ? `a Periodical review lands no code, so ${skipped.join(' and ')} ${skipped.length > 1 ? 'are' : 'is'} skipped; ` : '';
  const done = steps.slice(0, steps.indexOf(step));
  return {
    step,
    why: `the look-first sequence: ${lead}no size of the move is recorded${done.length ? ` and ${done.join(' and ')} ${done.length > 1 ? 'have' : 'has'} been attempted` : ''}, so ${step} is next; code sends each step once, whatever an earlier step said.`
  };
}
