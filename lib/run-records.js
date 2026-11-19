/**
 * LIN-4493 (piece 2): the run lifecycle seam. A run record opens when its dispatch row is taken and ends on the
 * row's terminal marker, and the one place that does both is here, called from the dispatch store's take and
 * feedback paths (lib/dispatch-store.js `takeItem`, `addFeedback`). Every take route and feedback route reaches
 * those two methods, so the seam does not depend on which route a row came by (proxy runner, dispatch API,
 * Harbour's own take).
 *
 * Which row starts or resumes a run is lib/run-identity.js's rule (`startsRun`, `runRecordIdFor`):
 * - a stage row, a leftover and a Periodical row open their own run, whose id is their own row id;
 * - a kind-less `custom` resume reopens the run it resumes (decision 2c: an ended run goes back to `open` as a
 *   new version, and its own terminal ends it again);
 * - a wake row opens nothing: whether a wake reopens its parent's run is open in the plan (2c), so it is not
 *   decided here.
 *
 * The end is read from the terminal marker through lib/dispatch-terminal.js (`deriveTerminalStatus`): `[done]` and
 * `[complete]` end a run as `done`, `[failed]` as `failed`, `[aborted]` as `aborted`. `[skipped]` ends nothing.
 * The account is the run's final assistant text (lib/digest-feedback.js `correlateDecisionCase`, the one reader).
 *
 * Best-effort, like the store's other side hooks: a records fault is logged by the caller and never changes the
 * take or the feedback. Imports Platform-level leaves and the records store only.
 */
import { startsRun, runRecordIdFor } from './run-identity.js';
import { deriveTerminalStatus } from './dispatch-terminal.js';
import { correlateDecisionCase } from './digest-feedback.js';

/** Rows that never open or end a run: a wake continues its parent's run, which is decided elsewhere (2c). */
const RUNLESS_KINDS = ['wake'];

/**
 * @param {Object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {() => Date} [deps.now]
 */
export function createRunRecords({ recordsStore, now = () => new Date() }) {
  /** The run a row belongs to: its own id for a row that starts one, the run it resumes otherwise. */
  function runOfRow(row) {
    if (!row || RUNLESS_KINDS.includes(row.kind)) return null;
    return runRecordIdFor({ kind: row.kind ?? null, id: String(row._id), resumedRunRecordId: row.runRecordId ?? null });
  }

  return {
    /** A row was taken: open its run (or reopen the run a custom resume carries). */
    async onTaken(row) {
      const runId = runOfRow(row);
      if (!runId) return null;
      const stage = startsRun(row.kind) ? row.kind : null;
      if (!stage && !row.runRecordId) return null;
      return recordsStore.openRun(row.urlKey, {
        id: runId,
        stage,
        lineage: String(row.rootItemId || runId),
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
      const runId = runOfRow(row);
      if (!runId) return null;
      const account = correlateDecisionCase(feedback, feedback.length - 1).join('\n');
      return recordsStore.endRun(row.urlKey, runId, { state: status, account: account || null, at: now().toISOString() });
    }
  };
}
