/**
 * The look-first sequence (LIN-4346 piece 4, LIN-4370): its CODE_ROUTES entry (lib/code-routes.js)
 * is the last route, so the blind read before close-out (LIN-4438) and the rest come before it.
 * The blind read never meets it in practice: it is an earlier route (`BLIND_READ_KIND`, lib/code-routes.js), and a
 * reviewed ticket normally has a plan, a size record or an implementation run, each of which turns this route off. A fresh ticket with no size of the move yet goes
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
 *   - its task has the person's words (`asked`, LIN-4501; the recommendation input reads it from the records
 *     store, never the description); the ticket is a leaf; it is not
 *     completed or canceled (a Periodical review's sequence is scoping alone, lookFirstSteps);
 *   - no size record (lib/size-of-move.js readSizeRecord), no plan (LIN-4504: a plan record of
 *     its own or a piece, from the recommendation input's planFacts; plan facts not measured turn
 *     the route off) and no PR of its own: a done implementation run on record reported one (LIN-4497);
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
 * The PR gate (LIN-4497). "No PR of its own" is read from this ticket's implementation runs
 * (recent-runs ownPrOf: a done implementation run's own report), never from comment URLs: no comment
 * says whose PR a URL is, so the old any-URL check turned the route off for a sibling's PR quoted in
 * a note. It retires PR #2370's choice 4 (any PR URL on the trail) and the risk accepted with it.
 * Residuals, in order: (1) a PR opened entirely by hand and only pasted into a comment does not
 * keep the route off (John's ruling, 19 Nov 15:39), so that ticket gets the Surveys and scoping,
 * advice and a size record, once each. (2) An implementation row that has dropped out of the
 * 20-row history window (HISTORY_ROWS) is not seen, so a pre-8 Nov ticket with no size record
 * or plan can get the Surveys despite its own PR. (3) A stage parked `[pending]` whose lineage
 * ended done reads its own stored feedback, which may hold only noise, with the same direction
 * as (2). (4) A done implementation run that opened no PR of its own, whose runner-selected `[done]`
 * url may name a sibling's PR, turns the route off. That is harmless: implementation already ran.
 * (5) LIN-4518 (beat 4): a Survey comment whose run is outside the window reads as not attempted, so that Survey is sent
 * again once. Before, the comment stopped the repeat; the run is the record now.
 *
 * Waiting on a live run (LIN-4370, LIN-4392). The general live-stage wait
 * (lib/run-live-wait.js, CODE_ROUTES[0]) runs first in lib/openrouter.js codeRouteOf: while any stage
 * run is queued or running, nothing reaches this route, so scoping never starts before
 * survey-place's note exists. This route only picks a step or stands aside. It meets a live run
 * only when recommend-and-dispatch skips the wait (`force: true` or a set `followUpTo`); a live
 * step is attempted, so the step after it is sent.
 *
 * Which step (pickStep). A Survey is attempted when any run of its kind is on record, whatever its outcome
 * (queued, running, waiting, ended, failed). LIN-4518 (beat 4): its headed comment no longer counts, so a Survey comment
 * whose run has dropped out of the history window is sent again (a residual, see below);
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
 * run facts carry stage, times, outcome and, on a done implementation run, its own PR URL
 * (LIN-4497), and the selector's slice keeps stage, time and outcome only, so scoping's final
 * report, which carries how, never reaches the builder.
 */
import { isTerminalState } from './providers/state-map.js';
import { readSizeRecord } from './size-of-move.js';
import { isPersonCommentOf } from './run-trail.js';
import { toEpochMs } from './utils/time.js';
import { WAITING_ON_A_PERSON, IMPLEMENTATION_KIND } from './recent-runs.js';
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

// LIN-4518 (beat 4): the sequence reads its own runs, never a Survey's comment. A Survey's report is still a comment, but
// whether a step happened is on record as a run (the run facts), so the comment is not read for it.
const timeOf = (at) => toEpochMs(at);
const sentAt = (run) => timeOf(run.dispatchedAt ?? run.at);

/**
 * When the sequence started: the ticket's first run (by dispatch time). Null when there is no run, so every comment so far
 * is filing context. LIN-4518 (beat 4): a hand-run Survey comment with no run on record no longer starts the sequence.
 * @returns {number|null} epoch ms
 */
export function sequenceStart(runs = []) {
  const times = runs.map(sentAt).filter(t => t != null);
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
export function holdingComment(comments = [], runs = [], harbourIds = null) {
  const start = sequenceStart(runs);
  if (start == null) return null;
  const after = comments
    .filter(c => c && typeof c.body === 'string' && isPersonCommentOf(c, harbourIds))
    .filter(c => (timeOf(c.createdAt) ?? -Infinity) > start)
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
  const latest = after.at(-1);
  if (!latest) return null;
  const at = timeOf(latest.createdAt);
  return runs.some(r => (sentAt(r) ?? -Infinity) > at) ? null : latest;
}

/**
 * Whether a look-first step has been attempted: a run of its stage is on record (see the module note). LIN-4518 (beat 4):
 * a Survey's comment alone no longer counts, so the comment is not read here.
 */
function attempted(step, runs) {
  return runs.some(r => r.stage === step);
}

/** Why the route is off, or null when it applies. Each reason is a short phrase. */
export function lookFirstOff(issue = {}, context = {}) {
  const comments = Array.isArray(context.comments) ? context.comments : [];
  const runs = context.allRuns;
  const description = issue.description || '';
  if (!Array.isArray(runs)) return 'runs unknown';
  // LIN-4501: the person's words are the task's `asked` (the recommendation input), never the description.
  if (!context.asked) return 'no asked words on its task';
  if ((context.children || []).length > 0) return 'not a leaf';
  if (isTerminalState(issue.state?.type)) return 'completed or canceled';
  if (readSizeRecord(description)) return 'size recorded';
  // LIN-4504: "has a plan" is the records' (the recommendation input's planFacts), never the description's or a comment's.
  // Unread plan facts turn the route off, as unknown runs do: a missed caller must not send a planned task to look first.
  const planFacts = context.planFacts;
  if (!planFacts || !planFacts.measured) return 'plan facts not measured';
  if (planFacts.hasPlan) return 'has a plan';
  // LIN-4497: a PR counts only when this ticket's own implementation run reported it (recent-runs ownPrOf).
  if (runs.some(r => r.stage === IMPLEMENTATION_KIND && r.pr)) return 'has its own PR';
  if ((issue.blockedBy || []).some(b => !isTerminalState(b?.state?.type))) return 'open blocker';
  if (runs.at(-1)?.outcome === WAITING_ON_A_PERSON) return 'newest run waiting on a person';
  if (holdingComment(comments, runs, context.harbourIds ?? null)) return "a person's comment holds it";
  return null;
}

/**
 * The look-first step to send, or null when the route does not apply or every step has been
 * attempted (the selector decides).
 * @param {Object} issue - with description, state, blockedBy
 * @param {Object} context - the recommendation input: comments, children, allRuns, asked, planFacts
 * @returns {{step: string, why: string}|null}
 */
export function lookFirstStep(issue = {}, context = {}) {
  if (lookFirstOff(issue, context)) return null;
  const steps = lookFirstSteps(issue.description);
  const step = steps.find(s => !attempted(s, context.allRuns));
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
