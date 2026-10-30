/**
 * lib/task-state.js — one state per task, said once (LIN-4024).
 *
 * Home's rows, its count line, its opened task and `/state` all read a task's state from here, so no
 * two of them can say different things. This module holds only the precedence and the words; the
 * facts it decides on (is a ruling open, what runs, what failed) are read by the caller from the task
 * page model and the badge's own reduction (`rulingStandingOf`).
 *
 * Precedence, first match wins: needs you (an open ruling, an open task-scan decision, or a subtask
 * that needs you) > failed > running > queued > parked > the tracker's word (backlog, done) > next.
 * `running` never includes a queued session, and a queued session behind an open ruling is not
 * queued at all (the caller leaves it out of `queued`).
 */

/**
 * @typedef {Object} TaskFacts
 * @property {string|null} trackerWord - 'backlog' | 'done' | null: the tracker's own word for the row
 * @property {boolean} ownRuling - the task's own waiting session is on an open ruling
 * @property {boolean} taskScan - an open task-scan decision is on this task
 * @property {Array<{identifier: string, title: string|null}>} childNeedsYou - subtasks that need you
 * @property {{words: string}|null} failed - the failed stage's words ("Build failed"), when the task or a
 *   subtask has failed
 * @property {boolean} parked - the task's own waiting session is parked, not a ruling
 * @property {{words: string}|null} running - the own running session (not queued), when there is one
 * @property {{words: string}|null} queued - the own queued session, when it is not behind a ruling
 * @property {string|null} next - the stage label the task's next step names, or null
 */

/**
 * @param {TaskFacts} facts
 * @returns {{state: string, words: string|null, tone: string, needsYou: boolean, running: boolean, queued: boolean, next: string|null, rank: number}}
 */
export function taskStateOf(facts) {
  const {
    trackerWord = null, ownRuling = false, taskScan = false, childNeedsYou = [], failed = null,
    parked = false, running = null, queued = null, next = null,
  } = facts;
  const needsYouNow = ownRuling || taskScan || childNeedsYou.length > 0;

  let state;
  let words = null;
  if (needsYouNow) {
    state = 'needs-you';
    words = 'needs you';
  } else if (failed) {
    state = 'failed';
    words = failed.words;
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
    words = `${next} next`;
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
  const rank = needsYouNow || failed ? 0 : (state === 'next' ? 1 : (isRunning || isQueued ? 2 : 3));
  return {
    state,
    words,
    tone,
    // A failed task needs a person too (LIN-3968), so the first rank puts it up top; the count line
    // counts it under failed, not waiting on you.
    needsYou: needsYouNow || !!failed,
    running: isRunning,
    queued: isQueued,
    next,
    rank,
  };
}
