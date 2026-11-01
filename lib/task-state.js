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
 * the tracker's word (backlog, done) > todo. `running` never includes a queued session, and a queued session
 * behind an open ruling is not queued at all (`sessionFactsOf` leaves it out).
 *
 * LIN-4103: no state, word or rank is drawn from a guess. A task nothing has run on says nothing (`todo`, no
 * words). The only estimate-free facts are the sessions' own (running, queued, waiting, failed) and the tracker's.
 *
 * `/state` has no tracker read, so its `taskState` passes no tracker word: a task's own facts only.
 */

import { stageLabel, isRunKind } from './run-view.js';
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
 * @param {Object} input.model - a `buildTaskPageModel` result (sessions, waitingFor, failedStep)
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
  // LIN-4103 beat 4: the row's running or queued words are a run's; a queue record (custom, autopilot, wake, periodical) is not.
  const { held } = sessionFactsOf(model.sessions.filter((s) => isRunKind(s.kind)), { waitingOnRuling: ownRuling });
  const elapsed = held ? fmtDuration(msSince(attemptStartedAt(held), now)) : null;
  const words = held ? `${stageLabel(held.kind)}${held.state === 'running' ? ` running${elapsed ? ` · ${elapsed}` : ''}` : ' queued'}` : null;
  // A failed stage needs a person, or the same stage again (LIN-3968); the header status reads failed (LIN-3991).
  // The failure is a fact from the sessions (`failedStageOf`), read here, never from the offered step.
  const failed = model.failedStep || null;
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
 * LIN-4103: a container's row says what its children do, never a guessed next step, so there is no `next` to roll up.
 *
 * @returns {Object} `taskStateOf`'s output
 */
export function rollUpRow(own, children) {
  const active = !own.running && !own.queued ? children.find((c) => c.state === 'running' || c.state === 'queued') || null : null;
  const failed = children.filter((c) => c.state === 'failed');
  const runningCount = children.filter((c) => c.state === 'running').length;
  // LIN-4103 beat 2: running subtasks roll up as a count of the subtasks ("1 of 3 running"); a lone subtask keeps its own
  // words. A Done child whose last stage failed is `done`, not `failed`, so it never reaches `failed` here.
  const runningWords = children.length === 1 ? active?.words : `${runningCount} of ${children.length} running`;
  return taskStateOf({
    ...own,
    childNeedsYou: children.filter((c) => c.state === 'needs-you').map(childRef),
    childFailed: failed[0] ? childRef(failed[0]) : null,
    childFailedCount: failed.length,
    childFailedAll: failed.map(childRef),
    running: own.running || (active?.state === 'running' ? { words: runningWords } : null),
    queued: own.queued || (active?.state === 'queued' ? { words: active.words } : null),
  });
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
function attentionOf({ childNeedsYou, childFailed, childFailedAll = [] }) {
  // LIN-4103 beat 2: the box names every subtask that needs you (or failed), so a row and its box count the same ones.
  if (childNeedsYou.length > 1) return attentionListOf({ subtasks: childNeedsYou, state: 'needs-you', many: 'subtasks need you' });
  if (childNeedsYou.length) {
    const needing = childNeedsYou[0];
    return attentionLine({ identifier: needing.identifier, title: needing.title, state: 'needs-you', lead: 'A subtask needs you', detail: '' });
  }
  if (childFailed) {
    if (childFailedAll.length > 1) return attentionListOf({ subtasks: childFailedAll, state: 'failed', many: 'subtasks failed' });
    return attentionLine({ identifier: childFailed.identifier, title: childFailed.title, state: 'failed', lead: 'A subtask failed', detail: ` · ${childFailed.words}` });
  }
  return null;
}

/** The subtask line when more than one subtask needs you (or failed): the count, then every identifier. */
function attentionListOf({ subtasks, state, many }) {
  const [first] = subtasks;
  const ids = subtasks.map((s) => s.identifier).join(', ');
  const lead = `${subtasks.length} ${many}`;
  // `subtasks` is every subtask named, so the browser can give each its own name and Open link (LIN-4103 beat 4).
  const named = subtasks.map((s) => ({ identifier: s.identifier, title: s.title || null }));
  return { identifier: first.identifier, title: first.title, state, lead, detail: '', words: `${lead}: ${ids}`, subtasks: named };
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
 * @returns {{state: string, words: string|null, tone: string, attention: Object|null, running: boolean, queued: boolean, rank: number}}
 */
export function taskStateOf(facts) {
  const {
    trackerWord = null, ownRuling = false, taskScan = false, childNeedsYou = [], childFailed = null, childFailedCount = null,
    childFailedAll = [], failed = null, parked = false, running = null, queued = null,
  } = facts;
  const needsYouNow = ownRuling || taskScan || childNeedsYou.length > 0;
  // A failed subtask counts only when neither the task's own stage nor a subtask that needs you does (LIN-4016).
  const failedNow = failed || (!childNeedsYou.length ? childFailed : null);
  // A subtask's failure rolls up as a count (LIN-4103 beat 2): "a subtask failed", or "2 subtasks failed".
  const failedCount = childFailedCount ?? (childFailed ? 1 : 0);
  const failedWords = failed ? failed.words : (failedNow ? (failedCount > 1 ? `${failedCount} subtasks failed` : 'a subtask failed') : null);
  // A subtask that needs you wins over everything, even the task's own failed stage; a failed subtask is named only
  // when the task's own stage did not fail (its own failure is the line then).
  const attention = attentionOf({ childNeedsYou, childFailed: failed ? null : childFailed, childFailedAll: failed ? [] : childFailedAll });

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
  } else {
    // LIN-4103: nothing has run and the tracker says nothing: no words at all, never a guessed step.
    state = 'todo';
  }

  const tone = {
    'needs-you': 'needs-you', failed: 'failed', running: 'running', queued: 'queued',
    parked: 'parked', backlog: 'quiet', done: 'quiet', todo: 'quiet',
  }[state];
  const isRunning = state === 'running';
  const isQueued = state === 'queued';
  // Rank: needs you, then running or queued, then the rest (see orderInProgress).
  const rank = needsAPerson(state) ? 0 : (isRunning || isQueued ? 2 : 3);
  return {
    state,
    words,
    tone,
    // The subtask line the parent's opened task names (LIN-4016: the server words it; the browser paints it).
    attention: state === 'needs-you' || state === 'failed' ? attention : null,
    running: isRunning,
    queued: isQueued,
    rank,
  };
}

/**
 * The run offer a finished task takes (LIN-4071): no run at all, not even Run to PR. It is a decision, not a missing
 * one: the browser tells it apart from a busy task (`null`, which holds the box's step line back) by its kind, so no
 * surface reads the tracker's word to find out.
 */
export const NO_RUN_ACTION = Object.freeze({ kind: 'none', why: 'finished: no stage is offered and no run goes to PR' });

/**
 * The run offer a task's row, opened box and `/state` carry: one decision per task (LIN-4104 D1, replacing the one
 * main action). Kinds, first match wins:
 *   `none`         finished: no run at all, not even Run to PR (LIN-4042, LIN-4071).
 *   `answer-first` the task or a subtask needs you; `identifiers` names them so the box leads with the question(s).
 *   `busy`         something in the subtree runs or is queued; `identifier` and `words` say what runs.
 *   `offer`        the run control: the three rungs, for a leaf and a container alike. A leaf whose stage failed also
 *                  names that stage in `step` (a fact from the sessions, LIN-3968: a failed stage is offered again). That
 *                  one button goes when Next step lands (D3). A container never carries a step.
 * `container` on `offer` tells the browser a run here goes to PR through the subtasks, never a step on this task.
 *
 * An incomplete held set carries no offer; the route sends no `action` for that case, so this is never called for it.
 *
 * @param {Object} input
 * @param {boolean} [input.finished] - the tracker's word is done or cancelled
 * @param {Array<{identifier: string}>} [input.needsYou] - the task and the subtasks that need a person, in tree order
 * @param {{identifier: string, words: string|null}|null} [input.busyOn] - the run in flight in the subtree, or null
 * @param {boolean} [input.container] - the task has open subtasks
 * @param {Object|null} [input.step] - the failed stage a leaf offers again (`nextStepOf`'s failure branch), or null
 * @returns {{kind: 'none', why: string}|{kind: 'answer-first', identifiers: string[], why: string}|{kind: 'busy', identifier: string, words: string|null, why: string}|{kind: 'offer', container: boolean, step: Object|null, why: string}}
 */
export function runOfferOf({ finished = false, needsYou = [], busyOn = null, container = false, step = null } = {}) {
  if (finished) return NO_RUN_ACTION;
  if (needsYou.length) {
    return { kind: 'answer-first', identifiers: needsYou.map((task) => task.identifier), why: 'a question needs you before a run is offered' };
  }
  if (busyOn) return { kind: 'busy', identifier: busyOn.identifier, words: busyOn.words ?? null, why: 'a run is in flight on this task or a subtask, so none is offered' };
  // A container offers no stage (its run goes to PR through the subtasks, LIN-4024); a leaf's failed stage is the one step.
  const offeredStep = container ? null : step;
  return {
    kind: 'offer',
    container,
    step: offeredStep,
    why: container ? 'a container runs to PR, the autopilot works through its subtasks' : (offeredStep?.reason ?? 'the run control offers the three rungs'),
  };
}

/**
 * The page's status word (LIN-4071): the one projection of a gathered task state that the page, the poll and the
 * client read. It is the client's own vocabulary (`waiting`, `running`, `failed`, `done`, `idle`), so the page's poll
 * knows when to stop: only a complete gathered `done` stops it. A provisional first render of a task with open subtasks
 * (`unsettled`) is a guess, so it never reads done and never stops the poll. A parked wait keeps `waiting` (LIN-4038). Null
 * is no state read yet, which reads idle.
 *
 * @param {{state: string, unsettled?: boolean}|null} taskState - the gather's state (or the provisional one)
 * @returns {'waiting'|'running'|'failed'|'done'|'idle'}
 */
export function pageStatusOf(taskState) {
  if (!taskState) return 'idle';
  switch (taskState.state) {
    case 'needs-you':
    case 'parked':
      return 'waiting';
    case 'running':
    case 'queued':
      return 'running';
    case 'failed':
      return 'failed';
    case 'done':
      return taskState.unsettled ? 'idle' : 'done';
    default:
      return 'idle';
  }
}
