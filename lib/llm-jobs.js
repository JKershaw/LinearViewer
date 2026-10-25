/**
 * The registry of every LLM use in Harbour (LIN-3852, step 1 of LIN-3820).
 *
 * A job is one thing a model is asked to do. Each has an id, a surface (an agent
 * session a runner takes, or a call Harbour makes itself), one of six groups and a
 * one-line description (written for the Settings > Models row, LIN-3855). The
 * placements are the design note's (docs/plans/llm-routing-design.md, "The model");
 * they are data, so they can move without a test failing. What the census
 * (tests/unit/llm-jobs-census.test.js) pins is that a use is on the list at all.
 *
 * Pure data and no imports, on purpose: the agent list is written out here rather
 * than derived from DISPATCH_KINDS, or the census that compares the two would be
 * vacuous, and a leaf adds no edge to the code-shape area map. The prompt file is
 * size-frozen (LIN-3633), so descriptions live here, not there.
 *
 * `defer` (never reaches the queue) and `wake` (a row kind, not a model use) are
 * not jobs. A precompute (session summary, run paragraph) runs as its on-demand
 * job; it has no id of its own.
 */

/** The six groups a job can sit in. */
export const GROUPS = Object.freeze({
  judge: 'checks work against a standard',
  plan: 'works out what to do before anything is made',
  make: 'produces the change',
  steer: 'decides what happens next, supervises',
  sort: 'classifies or picks something small',
  tell: 'summarises for a person',
});

/** Where a job runs. */
export const SURFACES = Object.freeze({
  AGENT_SESSION: 'agent-session',
  HARBOUR_CALL: 'harbour-call',
});

const agent = (id, group, description) => ({ id, surface: SURFACES.AGENT_SESSION, group, description });
const call = (id, group, description) => ({ id, surface: SURFACES.HARBOUR_CALL, group, description });

export const JOBS = Object.freeze([
  // Agent sessions (20: DISPATCH_KINDS without `defer`).
  agent('review', 'judge', 'Reviews a pull request against the task and its plan.'),
  agent('plan-review', 'judge', 'Checks an implementation plan before any code is written.'),
  agent('retrospective-audit', 'judge', 'Audits a finished piece of work against what was asked.'),
  agent('retro', 'judge', 'Looks back over a run and writes down what to change.'),
  agent('plan', 'plan', 'Writes the implementation plan for a task.'),
  agent('research', 'plan', 'Investigates a question and reports what it found.'),
  agent('design', 'plan', 'Designs the shape of a change before it is planned.'),
  agent('scoping', 'plan', 'Sets the boundary of a task: what is in and what is out.'),
  agent('breakdown', 'plan', 'Splits a large task into smaller ones.'),
  agent('spike', 'plan', 'Tries an idea cheaply to learn whether it works.'),
  agent('look-into', 'plan', 'Looks into a task and reports back without changing anything.'),
  agent('context', 'plan', 'Gathers the background a later session will need.'),
  agent('implementation', 'make', 'Implements a task and opens a pull request.'),
  agent('bug', 'make', 'Finds the cause of a bug and fixes it.'),
  agent('close-out', 'make', 'Finishes a task: confirms checks and merges when approved.'),
  agent('autopilot', 'steer', 'Runs a goal end to end by dispatching the other sessions.'),
  agent('blocked', 'steer', 'Works out what is blocking a task and what would clear it.'),
  agent('periodical', 'steer', 'Runs a recurring job on a schedule.'),
  agent('custom', 'steer', 'Runs a prompt the workspace wrote itself.'),
  agent('triage', 'sort', 'Sorts an incoming task: what it is and where it goes.'),

  // Harbour calls (16: the 9 in AI_OPERATION_KINDS plus 7 more).
  call('recommend', 'steer', 'Recommends the next step for a task.'),
  call('task-chat', 'steer', 'Answers questions about a task in the task chat.'),
  call('flight-companion', 'steer', 'Guides a person through a run in the flight companion.'),
  call('scan', 'sort', 'Scans a task for decisions that need an answer.'),
  call('scan-retire', 'sort', 'Decides which earlier scan decisions no longer apply.'),
  call('brief', 'tell', 'Writes the present-state brief of a task.'),
  call('recap', 'tell', 'Recaps what has happened on a task.'),
  call('run-summary', 'tell', 'Summarises one finished run in a few lines.'),
  call('session-summary', 'tell', 'Summarises a whole session, including its precompute.'),
  call('run-paragraph', 'tell', 'Writes the one paragraph that says how a run is going.'),
  call('ship-biscuit', 'tell', 'Writes the note that goes with a shipped change.'),
  call('roadmap', 'tell', 'Writes the roadmap view of a project.'),
  call('roadmap-orientation', 'tell', 'Orients a reader at the top of the roadmap.'),
  call('roadmap-chat', 'tell', 'Answers questions about the roadmap in chat.'),
  call('feedback-title', 'tell', 'Titles a feedback message as a ticket.'),
  call('observer-pass', 'tell', 'Reports what the observer noticed across running sessions.'),
]);

/** Every job id. */
export const JOB_IDS = Object.freeze(JOBS.map((j) => j.id));

const BY_ID = new Map(JOBS.map((j) => [j.id, j]));

/** @returns {{id:string, surface:string, group:string, description:string}|undefined} */
export function getJob(id) {
  return BY_ID.get(id);
}

/** @returns {Array} the jobs on one surface, in registry order */
export function jobsOnSurface(surface) {
  return JOBS.filter((j) => j.surface === surface);
}
