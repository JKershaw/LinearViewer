/**
 * The leftover step's decision and prompt (LIN-4373, piece 2 of LIN-4347). PURE: no I/O.
 *
 * When an eligible build posts its terminal `[done]`, Harbour resumes the build's own
 * session through a separately costed `leftover` follow-up and asks one question: what did
 * your change leave behind at its edges? The build's parent wake is held until that row
 * ends, so an autopilot cannot route `review` before the builder has answered and tidied.
 * The I/O half (reads, the enqueue, the outcome wake, logging, and what a release says) is
 * `lib/dispatch-leftover-hook.js`; the store holds and releases by `heldWakeFor` only
 * (`_applyWakeHook`, `releaseHeldWake`, lib/dispatch-store.js) and takes the release
 * wording from the hook (LIN-4455). The constants come from their owners: `HALT_MODES`,
 * `followUpTarget` and `NEVER_RAN`.
 *
 * `decideLeftover` returns exactly one of three outcomes:
 *   - `queue`: the build is eligible and its ticket has no `leftover` row yet;
 *   - `hold`: a `leftover` row already exists FOR THIS producing row (a re-reported
 *     `[done]`, LIN-3805). The wake stays withheld; if that row never ran (`NEVER_RAN`,
 *     lib/dispatch-terminal.js), `release` names it so the store re-runs the idempotent release;
 *   - `not-eligible`: today's wake, unchanged, with the reason for the skip log.
 */
import { deriveTerminalStatus, NEVER_RAN } from './dispatch-terminal.js';
import { LEFTOVER_KIND } from './dispatch-fields.js';
import { HALT_MODES } from './workspace-halt.js';
import { followUpTarget } from './dispatch-targets.js';
import { CONSEQUENCE_TEST, LEFTOVER_RULE } from './prompts/leftover-words.js';
import { prUrlOfFeedback } from './dispatch-wake.js';
import { deriveDispatchKind } from './prompt-templates.js';

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
  // The one follow-up target rule (LIN-3672): `dash`, `local` and unknown targets cannot be resumed.
  if (followUpTarget(doc.target) == null) return 'target-not-resumable';
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
  // Ask once per ticket: fix rounds are not asked; a change's one blind read is due once (LIN-4438, LIN-4544).
  if (leftoverRows.length) return { outcome: 'not-eligible', reason: 'ticket-already-asked' };
  if (alreadyWoken) return { outcome: 'not-eligible', reason: 'parent-already-woken' };

  const root = Array.isArray(chain) && chain.length ? chain[chain.length - 1] : null;
  if (!isStageBuild(root)) return { outcome: 'not-eligible', reason: 'root-not-a-stage-build' };
  if (HALT_MODES.includes(halt?.mode)) return { outcome: 'not-eligible', reason: `workspace-halted:${halt.mode}` };
  if (parentStopped) return { outcome: 'not-eligible', reason: 'parent-run-stopped' };
  const prUrl = lineagePrUrl(chain);
  if (!prUrl) return { outcome: 'not-eligible', reason: 'no-pr-url' };
  return { outcome: 'queue', root, prUrl };
}

/**
 * The prompt the resumed builder receives (its own prompt-budget surface,
 * `LEFTOVER_PROMPT_RENDERED_CEILING` in tests/unit/prompt-size-budget.test.js).
 *
 * LIN-4495: the step no longer settles a waiting entry, and it no longer answers with a retirement line. What it
 * leaves behind is written as findings (the hand-off protocol): a fix on the branch, or a finding to close-out or
 * the project. The step's final message is its record.
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
    CONSEQUENCE_TEST,
    '',
    'Make the fixes that are fix-sized on that branch, and add under `## Lessons` in `docs/areas/<slug>.md` what the next builder in the area should know (`docs/areas/README.md` says how). Commit before you push. File nothing yourself: every leftover you do not fix is a finding, written as the hand-off protocol says.',
    '',
    'A leftover is code shape, not a defect: a defect goes the usual way. "Nothing" is a valid answer.',
    '',
    `Push, and let CI settle. Then end the session with a final message: the fixes you made (each with its commit), the findings you recorded (each with its \`to\`), or \`nothing\`. Restate the PR URL and its head SHA there. No comment is posted for this step; the findings are its record.`,
  ].join('\n');
}
