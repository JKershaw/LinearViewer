/**
 * The leftover step's decision and prompt (LIN-4373, piece 2 of LIN-4347). PURE: no I/O.
 *
 * When an eligible build posts its terminal `[done]`, Harbour resumes the build's own
 * session through a separately costed `leftover` follow-up and asks one question: what did
 * your change leave behind at its edges? The build's parent wake is held until that row
 * ends, so an autopilot cannot route `review` before the builder has answered and tidied.
 * The I/O half (reads, the enqueue, logging) is `lib/dispatch-leftover-hook.js`; the hold
 * and release live in `lib/dispatch-store.js` (`_applyLeftoverStep`, `releaseHeldWake`).
 *
 * `decideLeftover` returns exactly one of three outcomes:
 *   - `queue`: the build is eligible and its ticket has no `leftover` row yet;
 *   - `hold`: a `leftover` row already exists FOR THIS producing row (a re-reported
 *     `[done]`, LIN-3805). The wake stays withheld; if that row was archived `cancelled`
 *     or `expired`, `release` names it so the store re-runs the idempotent release;
 *   - `not-eligible`: today's wake, unchanged, with the reason for the skip log.
 */
import { deriveTerminalStatus } from './dispatch-terminal.js';
import { LEFTOVER_KIND } from './dispatch-fields.js';
import { LEFTOVERS_HEADING, LEFTOVER_RULE } from './prompts/leftover-words.js';
import { prUrlOfFeedback } from './dispatch-wake.js';
import { deriveDispatchKind } from './prompt-templates.js';

/** The targets a follow-up can resume (`dash` and `local` sessions cannot be followed up). */
const RESUMABLE_TARGETS = new Set(['cli', 'web']);

/** Archived statuses that mean the leftover row never ran. */
const NEVER_RAN = new Set(['cancelled', 'expired']);

/**
 * The cheap checks on the producing row alone, before any read. The hook runs these
 * first so an ordinary `[failed]` or a non-build row costs no lookup; `decideLeftover`
 * runs them again, so the rule has one home.
 *
 * @param {Object} doc - the producing row (post-append)
 * @param {Object} entry - the appended feedback entry
 * @returns {string|null} the not-eligible reason, or null when the row may be eligible
 */
export function producingRowIneligibility(doc, entry) {
  if (!doc) return 'no-row';
  if (deriveTerminalStatus([entry]) !== 'done') return 'not-a-done-terminal';
  if (doc.kind === LEFTOVER_KIND) return 'leftover-row';
  // LIN-4166: a question-only follow-up wakes nobody, so it must not start a step that would.
  if (doc.followUpTo != null && doc.subscription === 'none') return 'question-only-follow-up';
  if (!RESUMABLE_TARGETS.has(doc.target || 'cli')) return 'target-not-resumable';
  if (!doc.issueIdentifier) return 'no-ticket';
  return null;
}

/**
 * Is `root` a stage-template `implementation` dispatch? Not a worker lane (its kickoff
 * is a custom prompt, never a stage row), not a periodical Stage-2 row, and not an
 * `implementation`-kind row whose prompt is not the stage's own.
 *
 * @param {Object|null} root - the lineage root (raw history doc)
 * @returns {boolean}
 */
export function isStageBuild(root) {
  return !!root
    && root.kind === 'implementation'
    && !root.periodicalId
    && !root.followUpTo
    && deriveDispatchKind(root.promptName) === 'implementation';
}

/**
 * The PR URL the build's lineage names, newest row first.
 *
 * @param {Array<{feedback?: Array}>} chain - producing row first, root last
 * @returns {string|null}
 */
export function lineagePrUrl(chain) {
  for (const row of Array.isArray(chain) ? chain : []) {
    const url = prUrlOfFeedback(row?.feedback);
    if (url) return url;
  }
  return null;
}

/**
 * Queue, hold, or not eligible.
 *
 * @param {Object} input
 * @param {Object} input.doc - the producing row (post-append)
 * @param {Object} input.entry - the appended feedback entry
 * @param {Array<Object>} input.chain - the follow-up chain, producing row first, root last
 * @param {Array<{_id: string, heldWakeFor?: string, status: string}>} input.leftoverRows - the
 *   ticket's `leftover` rows, queued and archived
 * @param {{mode?: string}|null} [input.halt] - the workspace halt document
 * @param {boolean} [input.parentStopped] - the run the build reports to is stopped
 * @param {boolean} [input.alreadyWoken] - the parent already had this row's terminal wake
 * @returns {{outcome: 'queue', root: Object, prUrl: string}
 *   | {outcome: 'hold', reason: string, release: Object|null}
 *   | {outcome: 'not-eligible', reason: string}}
 */
export function decideLeftover({ doc, entry, chain, leftoverRows = [], halt = null, parentStopped = false, alreadyWoken = false }) {
  const early = producingRowIneligibility(doc, entry);
  if (early) return { outcome: 'not-eligible', reason: early };

  // Hold before any other check: once a leftover row exists for this producing row, the
  // wake is that row's to give (its own terminal) or the release's (cancel, expiry).
  const own = leftoverRows.find((row) => row.heldWakeFor === doc._id);
  if (own) {
    return { outcome: 'hold', reason: `leftover-exists status=${own.status}`, release: NEVER_RAN.has(own.status) ? own : null };
  }
  // Ask once per ticket: fix rounds are not asked, review reads every round.
  if (leftoverRows.length) return { outcome: 'not-eligible', reason: 'ticket-already-asked' };
  if (alreadyWoken) return { outcome: 'not-eligible', reason: 'parent-already-woken' };

  const root = Array.isArray(chain) && chain.length ? chain[chain.length - 1] : null;
  if (!isStageBuild(root)) return { outcome: 'not-eligible', reason: 'root-not-a-stage-build' };
  if (halt?.mode === 'pause' || halt?.mode === 'stop') return { outcome: 'not-eligible', reason: `workspace-halted:${halt.mode}` };
  if (parentStopped) return { outcome: 'not-eligible', reason: 'parent-run-stopped' };
  const prUrl = lineagePrUrl(chain);
  if (!prUrl) return { outcome: 'not-eligible', reason: 'no-pr-url' };
  return { outcome: 'queue', root, prUrl };
}

/**
 * The prompt the resumed builder receives (its own prompt-budget surface,
 * `LEFTOVER_PROMPT_RENDERED_CEILING` in tests/unit/prompt-size-budget.test.js).
 *
 * @param {{issueIdentifier: string, prUrl: string}} args
 * @returns {string}
 */
export function leftoverPrompt({ issueIdentifier, prUrl }) {
  return [
    `# Leftovers: ${issueIdentifier}`,
    '',
    `Your build of ${issueIdentifier} is done (${prUrl}). One question before review reads it: what did your change leave behind at its edges?`,
    '',
    'Look for:',
    '- a copy left beside a new owner;',
    '- an old path nothing has moved off yet;',
    '- a name or comment your change made untrue;',
    '- a rule now spelled two ways.',
    '',
    LEFTOVER_RULE,
    '',
    "Make your fixes and notes on that branch (`docs/areas/README.md` says how), remove any waiting entry your change settled or made untrue, and add under `## Lessons` what the next builder in the area should know. List outside items for close-out. File nothing yourself.",
    '',
    'A leftover is code shape, not a defect: a defect goes the usual way. "Nothing" is a valid answer.',
    '',
    `Push, let CI settle, then post your answer as a comment on ${issueIdentifier} under \`${LEFTOVERS_HEADING}\`: one line per item saying where it went (tidied / noted / for close-out), or \`nothing\`. Restate the PR URL and its head SHA there. End the session with the same answer: your terminal message is what the parent reads next.`
  ].join('\n');
}
