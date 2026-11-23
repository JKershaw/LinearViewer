/**
 * LIN-4493 (piece 2): the run lifecycle seam. A run record opens when its dispatch row is taken and ends when that
 * row stops being live, and the one place that does both is here. It is called from the dispatch store's take,
 * feedback and closure paths (lib/dispatch-store.js `takeItem`, `addFeedback`, `_closeRows`, `stampBookkeeping`), so
 * the seam does not depend on which route a row came by (proxy runner, dispatch API, Harbour's own take).
 *
 * Which run a row belongs to is lib/run-identity.js's rule (`runRecordIdFor`):
 * - a stage row, a leftover and a Periodical row start their own run, whose id is their own row id;
 * - a follow-up or wake row belongs to the run it resumes (its `runRecordId`, stamped from the parent at mint):
 *   a kind-less `custom` resume and a wake both reopen that run when taken (decision 2c: an ended run goes back to
 *   `open` as a new version, and the row's own terminal ends it again). A stage-kind follow-up starts its own run.
 *   Engineering decision (LIN-4493 review, gap 3): a wake reopens its parent's run, like a custom resume, because a
 *   wake is a message delivered into the same session; the alternative left a woken session's writes refused under
 *   a run that its own later terminal could never reopen.
 * - a row with no `runRecordId` (a kickoff's follow-up, a chat, a legacy parent) belongs to no run of its own: a follow-up inherits the
 *   run it resumes. A FRESH autopilot kickoff starts one since LIN-4531 (`startsRunRow`, lib/run-identity.js).
 *
 * How a run ends:
 * - a terminal marker on its row (`[done]`/`[complete]`, `[failed]`, `[aborted]`), read through
 *   lib/dispatch-terminal.js `deriveTerminalStatus`; `[skipped]` ends nothing;
 * - an abort row's `[aborted]` (a Stop, a cascade, a halt sweep) ends the run of the row it targets (`abortTo`), not
 *   the abort row's own run: the target never receives that marker as its own feedback;
 * - the row's closure by the lineage closers and the ticket closer (`onClosed`): the row stops being live without a
 *   marker of its own. Its run ends as the lineage's terminal status, or `aborted` when no status came with the
 *   closure. A `handed-on` closure ends nothing: the successor that replaced the row carries the run on.
 *
 * The account is the run's final assistant text (lib/digest-feedback.js `correlateDecisionCase`, the one reader).
 *
 * Best-effort, like the store's other side hooks: a records fault is logged by the caller and never changes the
 * take, the feedback or the closure. It imports three Platform-level leaves (run-identity, dispatch-terminal,
 * digest-feedback); the records store, the row reader and the task seam (`taskOfTicket`, LIN-4501) are injected, not
 * imported. A run that starts on a take opens in its ticket's task: the held one, else one the seam makes, else none,
 * with a `task-missing-at-take` line naming why.
 */
import { startsRunRow, runRecordIdFor } from './run-identity.js';
import { deriveTerminalStatus } from './dispatch-terminal.js';
import { correlateDecisionCase } from './digest-feedback.js';

/** The closure reasons a run continues through rather than ends with (a successor row carries it on). */
const CARRIED_ON = ['handed-on'];

/**
 * LIN-4515: the stages whose done run that reported a PR gets a change record from Harbour, when the stage wrote none
 * (lib/change-records.js backstopChangeFor). The stage kind of an audit is `retrospective-audit` (lib/prompts/stage-kinds.js).
 */
const CHANGE_STAGES = ['implementation', 'retrospective-audit'];

/**
 * @param {Object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {(urlKey: string, id: string) => Promise<object|null>} [deps.readRow] - the dispatch history row `id`, for an
 *   abort row's target (its run and its final text)
 * @param {(urlKey: string, ticket: string) => Promise<{id: string}|{problem: string}>} [deps.taskOfTicket] - the task
 *   for a ticket, made if it has none (server.js `taskForTicketAt` over lib/records/writes.js `taskOfTicket`, whose
 *   writer `by` is the seam's). A take with no claimed task makes it here, before the run opens (LIN-4501).
 * @param {() => Date} [deps.now]
 */
export function createRunRecords({ recordsStore, readRow = null, taskOfTicket = null, changeBackstop = null, now = () => new Date() }) {
  /**
   * The task a run-starting row opens its run in (LIN-4501). A held task is read with no tracker read. Otherwise the
   * task is made through the checked path; when that fails too, the run opens task-less and the miss is logged with its
   * reason, so the held-run readings can count it. A row with no ticket belongs to no task. Never throws.
   */
  async function taskForTake(row) {
    const ticket = row.issueIdentifier;
    if (!ticket) return null;
    const missing = (reason) => {
      console.log(`[task-missing-at-take] (${row.urlKey} ${ticket}) ${reason}; the run opens without a task`);
      return null;
    };
    try {
      const held = await recordsStore.taskForTicket(row.urlKey, ticket);
      if (held) return held;
      if (!taskOfTicket) return missing('no task seam');
      const made = await taskOfTicket(row.urlKey, ticket);
      if (made?.id) {
        console.log(`[task-made-at-take] (${row.urlKey} ${ticket}) no claimed task; made ${made.id}`);
        return made.id;
      }
      return missing(made?.problem || 'no task made');
    } catch (err) {
      return missing(`the task fallback failed (${err?.message || err})`);
    }
  }

  /** The run a row belongs to: its own id for a row that starts one, the run it resumes or wakes otherwise. */
  function runOfRow(row) {
    if (!row) return null;
    return runRecordIdFor({ kind: row.kind ?? null, id: String(row._id), resumedRunRecordId: row.runRecordId ?? null, followUpTo: row.followUpTo ?? null });
  }

  /**
   * The run's final text: the assistant text that runs up to `index` in the row's feedback. A terminal marker is at
   * `length - 1`, so its text is the run just before it; a run that ends with no marker of its own (a closure, an
   * abort target) has its text at the end, `length`.
   */
  const accountOf = (feedback, index) => correlateDecisionCase(feedback || [], index).join('\n') || null;

  async function endRunOf(urlKey, row, state, feedback, index) {
    const runId = runOfRow(row);
    if (!runId) return null;
    return recordsStore.endRun(urlKey, runId, { state, account: accountOf(feedback, index), at: now().toISOString() });
  }

  return {
    /** A row was taken: open its run (or reopen the run a custom resume or a wake carries). */
    async onTaken(row) {
      const runId = runOfRow(row);
      if (!runId) return null;
      const starts = startsRunRow({ kind: row.kind, followUpTo: row.followUpTo ?? null });
      // LIN-4501: a run that starts here opens in its ticket's task (taskForTake). A resume or wake keeps the task its
      // run already has, so it names none.
      const taskId = starts ? await taskForTake(row) : null;
      return recordsStore.openRun(row.urlKey, {
        id: runId,
        stage: starts ? row.kind : null,
        taskId,
        // Only a run-starting row names its lineage; a resume or wake keeps the lineage its run already has.
        lineage: starts ? String(row.rootItemId || runId) : null,
        at: now().toISOString()
      });
    },

    /**
     * Feedback landed on a row. `entry` is the entry just written; `feedback` is the row's whole feedback, in order.
     * A terminal marker ends the run; any other entry changes nothing.
     */
    async onFeedback(row, entry, feedback) {
      const status = deriveTerminalStatus([entry]);
      if (!status || status === 'skipped') return null;
      if (row.abort === true) {
        // An abort row's [aborted] stops the run of the row it targets; the target's own feedback carries the text.
        if (!readRow || !row.abortTo) return null;
        const target = await readRow(row.urlKey, row.abortTo);
        return target ? endRunOf(row.urlKey, target, status, target.feedback, (target.feedback || []).length) : null;
      }
      const ended = await endRunOf(row.urlKey, row, status, feedback, (feedback || []).length - 1);
      // LIN-4515: a done implementation or audit run gets the change for the PR it reported, if its stage wrote none.
      // Fire-and-forget (finding-a8b61efc): the backstop reads the PR over the network, and the run has already ended
      // above, so the runner's terminal feedback write never waits on GitHub. The other merge recorders do the same.
      if (status === 'done' && changeBackstop && CHANGE_STAGES.includes(row.kind)) {
        const started = Promise.resolve().then(() => changeBackstop({ urlKey: row.urlKey, runId: runOfRow(row), feedback }));
        started.catch((err) => console.log(`[change-backstop] ${row.urlKey} ${runOfRow(row)}: ${err?.message || err}`));
      }
      return ended;
    },

    /**
     * Rows were closed by a bookkeeping stamp (lib/dispatch-store.js `_closeRows`, `stampBookkeeping`).
     * @param {object[]} rows - the closed rows as written (with their feedback)
     * @param {{reason: string, terminal?: 'done'|'failed'|'aborted'|null}} closure
     */
    async onClosed(rows, { reason, terminal = null }) {
      if (CARRIED_ON.includes(reason)) return 0;
      let ended = 0;
      for (const row of rows) {
        if (await endRunOf(row.urlKey, row, terminal ?? 'aborted', row.feedback, (row.feedback || []).length)) ended += 1;
      }
      return ended;
    }
  };
}
