/**
 * LIN-4492: run identity, the one leaf the dispatch factory reads for it.
 *
 * Before LIN-4492 a run's id was minted inside `addItem`, after its prompt was finalized, so an
 * autopilot kickoff had no way to learn its own id until the store appended a block naming it
 * (the store appended a self-reference block; that function is deleted). The factory now allocates every row's id before the
 * prompt is finalized, so the id is known in the prompt itself. Two things follow, and both live here:
 *
 * - `startsRun(kind)` and `runRecordIdFor`: which rows start a run. A run's id is its row's own id, so
 *   the preamble can name it ("your run: <id>") and a credential minted for the row can carry it.
 * - `withAutopilotSessionHeading`: the `## Your autopilot session id` block a body-supplied autopilot
 *   kickoff needs (its prose checks for this exact heading, lib/prompts/autopilot-kickoff.js). The bytes
 *   are the ones the store appended before LIN-4492; the factory now appends them after the file-pointer
 *   pilot, where the store used to.
 *
 * Kickoffs start no run: they dispatch and file nothing. Their id still comes before their prompt.
 */
import { STAGE_KINDS } from './prompts/stage-kinds.js';

/** The kind of the row a builder's held session runs its leftover step on (lib/dispatch-leftover-hook.js). */
export const LEFTOVER_RUN_KIND = 'leftover';
/** The kind of a Periodical row (lib/periodicals.js): its own run; its audit writes findings. */
export const PERIODICAL_RUN_KIND = 'periodical';

/**
 * Does a row of this kind start a run? Every stage kind (STAGE_KINDS), the leftover and the Periodical
 * row do. Everything else starts none: autopilot kickoffs, kind-less `custom`/`work` rows, collective and
 * chat. A follow-up of a `custom` kind belongs to the run it resumes instead (see `runRecordIdFor`).
 * @param {string|null|undefined} kind
 * @returns {boolean}
 */
export function startsRun(kind) {
  if (typeof kind !== 'string' || !kind) return false;
  return Object.prototype.hasOwnProperty.call(STAGE_KINDS, kind)
    || kind === LEFTOVER_RUN_KIND
    || kind === PERIODICAL_RUN_KIND;
}

/**
 * The run a dispatch row belongs to. A row that starts a run is its own run. Any other row belongs to the
 * run it resumes (`resumedRunRecordId`, the follow-up parent's run; null for a fresh row or a parent with
 * no run). Everything else belongs to none.
 * @param {{kind: string|null, id: string, resumedRunRecordId?: string|null}} row
 * @returns {string|null}
 */
export function runRecordIdFor({ kind, id, resumedRunRecordId = null }) {
  if (startsRun(kind)) return id;
  return resumedRunRecordId || null;
}

/**
 * The autopilot kickoff's own id block (LIN-599, LIN-4025, LIN-1737 B1), applied to a fresh kickoff only
 * (`kind: 'autopilot'` with no `followUpTo`): a follow-up is a message delivered into a session that
 * already holds its id.
 * @param {string} prompt - the finalized prompt (after the file-pointer pilot)
 * @param {string} kind - the row's effective kind
 * @param {string|null} followUpTo - the row's follow-up parent, if any
 * @param {string} id - the row's own id, allocated before the prompt
 * @returns {string}
 */
export function kickoffHeadingFor(prompt, kind, followUpTo, id) {
  return kind === 'autopilot' && !followUpTo ? withAutopilotSessionHeading(prompt, id) : prompt;
}

/**
 * The prompt block naming the autopilot's own id. Byte-identical to the block the store appended before
 * LIN-4492, so an existing kickoff prompt reads the same.
 */
export function withAutopilotSessionHeading(prompt, sessionId) {
  return `${prompt}

---

## Your autopilot session id

This run's own dispatch id — your **session id** — is \`${sessionId}\`. This is the
id to use: it **overrides any other session id mentioned earlier in this prompt**
(e.g. a standalone kickoff's placeholder, minted before this dispatch existed). Pass
\`${sessionId}\` as \`sessionId\` on **every** worker dispatch you issue this run: every
\`POST /recommend-and-dispatch\`, every plain \`POST /dispatch\`, and any \`followUpTo\`
liveness nudge. That explicit link is what groups all the work you spawn into this
one autopilot session.`;
}
