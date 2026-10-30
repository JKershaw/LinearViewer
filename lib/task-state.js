/**
 * lib/task-state.js — one state per task, decided here once (LIN-4024, LIN-4016).
 *
 * Home's rows, its count line, its opened task and `/state` all read a task's state from here, so no two of
 * them can say different things. This module decides, and holds the words. The facts it decides on come from
 * three readers in this file: `sessionFactsOf` (what is running, queued or busy), `taskFactsOf` (a task's own
 * facts from its page model and the workspace's ruling standing) and `rollUpRow` (a container's facts from its
 * children's states). It imports only leaf helpers, never the loader, so `/state` can share it.
 *
 * Precedence, first match wins: needs you (an open ruling, an open task-scan decision, or a subtask that
 * needs you) > failed (its own stage, or a subtask's when nothing needs you) > running > queued > parked >
 * the tracker's word (backlog, done) > next. `running` never includes a queued session, and a queued session
 * behind an open ruling is not queued at all (`sessionFactsOf` leaves it out).
 *
 * `/state` has no tracker read, so its `taskState` passes no tracker word: a task's own facts only.
 */

import { stageLabel } from './run-view.js';
import { fmtDuration } from './render-run-steps.js';
import { isTerminalState } from './providers/state-map.js';

/** A session that is still the task's current attention: the stage reads `open`. */
const OPEN_STATES = new Set(['running', 'waiting']);
/** A session with no end yet: its stage has no `endedAt`. */
const UNENDED_STATES = new Set(['running', 'queued', 'waiting']);

/** Is a session still unended (running, queued or waiting on an answer)? */
export const isUnendedState = (state) => UNENDED_STATES.has(state);
/** Is a stage's session still the task's current attention (running or waiting)? */
export const isOpenState = (state) => OPEN_STATES.has(state);

/** A session's start: its attempt's `takenAt`, else `dispatchedAt`. */
export const attemptStartedAt = (session) => session.loop.takenAt || session.loop.dispatchedAt || null;

/** Whole milliseconds since `startedAt`, or null when there is no start or it is in the future. */
function msSince(startedAt, now) {
  const ms = startedAt ? now.getTime() - Date.parse(startedAt) : NaN;
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * What the task's sessions are doing right now. A queued session behind an open ruling is not queued (the task
 * waits on the ruling), so it counts as neither running nor live (LIN-4024).
 *
 * @param {Array<{state: string}>} sessions - the model's sessions, oldest-first
 * @param {{waitingOnRuling?: boolean}} [opts]
 * @returns {{held: Object|null, running: Object|null, queued: Object|null, busy: boolean, live: boolean}}
 *   `held` is the session the task is working on: the newest running one, else the newest queued one (not behind a
 *   ruling). A running stage is what a worker holds, so a newer queued one does not displace it (LIN-4016). Stop
 *   targets `held`.
 */
export function sessionFactsOf(sessions, { waitingOnRuling = false } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const running = list.filter((s) => s.state === 'running').at(-1) || null;
  const queued = running || waitingOnRuling ? null : list.filter((s) => s.state === 'queued').at(-1) || null;
  const held = running || queued;
  return {
    held,
    running,
    queued,
    busy: list.some((s) => UNENDED_STATES.has(s.state)),
    live: !!held,
  };
}

/**
 * A task's own facts (the words come from the same session facts the rows and the summary read).
 *
 * @param {Object} input
 * @param {Object} input.model - a `buildTaskPageModel` result (sessions, waitingFor, nextStep, guesses)
 * @param {Object|null} [input.ruling] - the workspace's `rulingStandingOf` (taskScanByIdentifier, shelvedTaskIdentifiers)
 * @param {string} input.identifier - the task's identifier
 * @param {string|null} [input.trackerType] - the tracker's state type; null when no tracker read (`/state`)
 * @param {Date} [input.now]
 * @returns {TaskFacts}
 */
export function taskFactsOf({ model, ruling = null, identifier, trackerType = null, now = new Date() }) {
  const ownRuling = model.waitingFor === 'ruling';
  const taskScan = !!ruling?.taskScanByIdentifier?.has(identifier);
  // A shelved task-scan decision reads parked, the same as a shelved ruling (LIN-4024).
  const parked = model.waitingFor === 'parked' || (!taskScan && !!ruling?.shelvedTaskIdentifiers?.has(identifier));
  const { held } = sessionFactsOf(model.sessions, { waitingOnRuling: ownRuling });
  const elapsed = held ? fmtDuration(msSince(attemptStartedAt(held), now)) : null;
  const words = held ? `${stageLabel(held.kind)}${held.state === 'running' ? ` running${elapsed ? ` · ${elapsed}` : ''}` : ' queued'}` : null;
  // A failed stage needs a person, or the same stage again (LIN-3968); the header status reads failed (LIN-3991).
  const failed = model.nextStep && model.nextStep.failed ? model.nextStep : null;
  return {
    trackerWord: trackerWordOf(trackerType),
    ownRuling,
    taskScan,
    childNeedsYou: [],
    childFailed: null,
    failed: failed ? { words: `${failed.label} failed` } : null,
    parked,
    running: held && held.state === 'running' ? { words } : null,
    queued: held && held.state === 'queued' ? { words } : null,
    next: model.guesses.length ? stageLabel(model.guesses[0]) : null,
  };
}

/**
 * LIN-4039: the one meaning of "container": the task has an open (non-terminal) subtask. Every producer (Home's rows,
 * the task page, Swipe) reads it through here, over the task's full list of subtasks, never a trimmed view of it.
 *
 * @param {Array<{state?: {type?: string}, stateType?: string}>|null|undefined} subtasks - the task's subtasks; a Swipe
 *   summary carries `stateType`, a tracker issue carries `state.type`
 * @returns {boolean}
 */
export function hasOpenSubtask(subtasks) {
  return (subtasks || []).some((c) => !isTerminalState(c?.state?.type ?? c?.stateType));
}

/** The tracker's own word for a row, or null: a backlog task, or a finished one. */
export function trackerWordOf(trackerType) {
  if (trackerType === 'backlog') return 'backlog';
  return isTerminalState(trackerType) ? 'done' : null;
}

/**
 * A child row as a container's roll-up reads it: its identifier and title, and its own state.
 *
 * @param {{identifier: string, title: string|null, state: string, words: string|null}} child
 */
const childRef = ({ identifier, title, state, words }) => ({ identifier, title: title || null, state, words });

/**
 * A container's row: its own facts rolled up with its children's row states (LIN-4010, LIN-4024). A child that
 * needs you wins over everything; a failed child counts only when neither the task's own stage nor a child needs
 * you; a child already in motion is what the container says runs when the container runs nothing of its own.
 *
 * @param {TaskFacts} own - `taskFactsOf` for the container
 * @param {Array<{identifier: string, title: string|null, state: string, words: string|null}>} children - each
 *   child's row state (`taskStateOf` output plus identifier and title), in tree order
 * @param {{next?: string|null, nextOn?: string|null}} [opts] - the container's `next` and the subtask it is on, when
 *   they differ from its own (LIN-4039's pick)
 * @returns {Object} `taskStateOf`'s output
 */
export function rollUpRow(own, children, { next = own.next, nextOn = null } = {}) {
  const active = !own.running && !own.queued ? children.find((c) => c.state === 'running' || c.state === 'queued') || null : null;
  return taskStateOf({
    ...own,
    next,
    nextOn,
    childNeedsYou: children.filter((c) => c.state === 'needs-you').map(childRef),
    childFailed: children.find((c) => c.state === 'failed') ? childRef(children.find((c) => c.state === 'failed')) : null,
    running: own.running || (active?.state === 'running' ? { words: active.words } : null),
    queued: own.queued || (active?.state === 'queued' ? { words: active.words } : null),
  });
}

/**
 * LIN-4039: the words a "next" row says, in one place (a one-line edit to change them). A subtask's step names the
 * subtask it is on, so the parent row and that subtask's own row agree: `Next: Research on LIN-71`. A task's own
 * step keeps `Research next`. Wording may change after LIN-4040's feedback; this is the only function that writes it.
 *
 * @param {{next: string, nextOn?: string|null}} input - `next` is the step's stage label; `nextOn` the subtask it is on
 * @returns {string}
 */
export function nextWordsOf({ next, nextOn = null }) {
  return nextOn ? `Next: ${next} on ${nextOn}` : `${next} next`;
}

/**
 * Does this state need a person? A failed task needs one too (LIN-3968), so ranking and "belongs In Progress"
 * read this, not a flag (LIN-4016: the `needsYou` boolean is gone).
 *
 * @param {string|null|undefined} state
 * @returns {boolean}
 */
export function needsAPerson(state) {
  return state === 'needs-you' || state === 'failed';
}

/**
 * The attention line a parent's opened task names: the subtask that needs you, else (when nothing needs you) the
 * failed subtask. Null when none. Words come from here, so the browser paints them and does not pick text.
 */
function attentionOf({ childNeedsYou, childFailed }) {
  const needing = childNeedsYou[0];
  if (needing) return attentionLine({ identifier: needing.identifier, title: needing.title, state: 'needs-you', lead: 'A subtask needs you', detail: '' });
  if (childFailed) return attentionLine({ identifier: childFailed.identifier, title: childFailed.title, state: 'failed', lead: 'A subtask failed', detail: ` · ${childFailed.words}` });
  return null;
}

/** The subtask line in its parts: `lead` ("A subtask needs you"), the subtask's name, then `detail` (its failure). */
function attentionLine({ identifier, title, state, lead, detail }) {
  return { identifier, title, state, lead, detail, words: `${lead}: ${identifier}${detail}` };
}

/**
 * Decide a task's state from its facts (first match wins, see the header). Pure.
 *
 * @param {Object} facts
 * @param {string|null} [facts.trackerWord] - 'backlog' | 'done' | null
 * @param {boolean} [facts.ownRuling] - the task's own waiting session is on an open ruling
 * @param {boolean} [facts.taskScan] - an open task-scan decision is on this task
 * @param {Array<{identifier: string, title: string|null, words: string|null}>} [facts.childNeedsYou] - subtasks that need you
 * @param {{identifier: string, title: string|null, words: string|null}|null} [facts.childFailed] - the first failed subtask
 * @param {{words: string}|null} [facts.failed] - the task's own failed stage
 * @param {boolean} [facts.parked]
 * @param {{words: string}|null} [facts.running]
 * @param {{words: string}|null} [facts.queued]
 * @param {string|null} [facts.next] - the stage label the task's next step names, or null
 * @param {string|null} [facts.nextOn] - the subtask that step is on, when it is a subtask's (LIN-4039), or null
 * @returns {{state: string, words: string|null, tone: string, attention: Object|null, running: boolean, queued: boolean, next: string|null, rank: number}}
 */
export function taskStateOf(facts) {
  const {
    trackerWord = null, ownRuling = false, taskScan = false, childNeedsYou = [], childFailed = null,
    failed = null, parked = false, running = null, queued = null, next = null, nextOn = null,
  } = facts;
  const needsYouNow = ownRuling || taskScan || childNeedsYou.length > 0;
  // A failed subtask counts only when neither the task's own stage nor a subtask that needs you does (LIN-4016).
  const failedNow = failed || (!childNeedsYou.length ? childFailed : null);
  const failedWords = failed ? failed.words : (failedNow ? failedNow.words : null);
  // A subtask that needs you wins over everything, even the task's own failed stage; a failed subtask is named only
  // when the task's own stage did not fail (its own failure is the line then).
  const attention = attentionOf({ childNeedsYou, childFailed: failed ? null : childFailed });

  let state;
  let words = null;
  if (needsYouNow) {
    state = 'needs-you';
    words = 'needs you';
  } else if (failedNow) {
    state = 'failed';
    words = failedWords;
  } else if (running) {
    state = 'running';
    words = running.words;
  } else if (queued) {
    state = 'queued';
    words = queued.words;
  } else if (parked) {
    state = 'parked';
    words = 'parked';
  } else if (trackerWord === 'backlog') {
    state = 'backlog';
    words = 'backlog';
  } else if (trackerWord === 'done') {
    state = 'done';
    words = 'done';
  } else if (next) {
    state = 'next';
    words = nextWordsOf({ next, nextOn });
  } else {
    state = 'todo';
  }

  const tone = {
    'needs-you': 'needs-you', failed: 'failed', running: 'running', queued: 'queued',
    parked: 'parked', next: 'ready', backlog: 'quiet', done: 'quiet', todo: 'quiet',
  }[state];
  const isRunning = state === 'running';
  const isQueued = state === 'queued';
  // Rank: needs you, then ready for a next step, then running or queued, then the rest (see orderInProgress).
  const rank = needsAPerson(state) ? 0 : (state === 'next' ? 1 : (isRunning || isQueued ? 2 : 3));
  return {
    state,
    words,
    tone,
    // The subtask line the parent's opened task names (LIN-4016: the server words it; the browser paints it).
    attention: state === 'needs-you' || state === 'failed' ? attention : null,
    running: isRunning,
    queued: isQueued,
    next,
    rank,
  };
}

/**
 * The step the opened task offers, as one main action (LIN-4016: `/state` sends the decision, the browser paints
 * it). Busy offers nothing; a container offers Run to PR, never a stage; otherwise the offered step, else Run to PR.
 *
 * @param {Object} input
 * @param {Object|null} input.offered - `nextStepOf`'s step, or null
 * @param {boolean} input.busy - any session unended
 * @param {boolean} [input.container] - the task has subtasks
 * @returns {{kind: 'step', step: Object, why: string}|{kind: 'run-to-pr', why: string}|null}
 */
export function mainActionOf({ offered, busy, container = false }) {
  if (busy) return null;
  if (!container && offered) return { kind: 'step', step: offered, why: offered.reason };
  return { kind: 'run-to-pr', why: container ? 'a container runs to PR, the autopilot works through its subtasks' : 'no stage step is offered, so the run takes it to PR' };
}
