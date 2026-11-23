/**
 * lib/periodical-report-gate.js
 *
 * The Done-transition gate for periodical Stage-2 review tasks (LIN-694).
 *
 * BACKGROUND. A periodical Stage-2 review task is expected to write a report
 * artifact (`docs/reviews/<name>-<date>.md`, LIN-1967) before it is marked
 * Done. Close-out sets Done after merging the run's PR; the run itself hands
 * off and never sets Done (LIN-4390).
 * Three batches in a row (2026-06-25, 2026-07-11, 2026-08-23) produced tasks
 * that reached Linear's Done state while their report survived only as a
 * Linear comment — because a periodical's own prompt text is just a
 * convention, and a conflicting operator instruction ("do not create any
 * file") silently overrides a convention every time, with nothing at any
 * layer noticing. This module is the code-level backstop: it does not trust
 * the task's own prose about what it did.
 *
 * LIN-4533: the evidence is records, not comments. A run posts no tracker comment, so the report's change is its change
 * record (the task's landing), and its second read is a verdict record (judgement `adversarial-read`) on that change.
 * Both come from the ticket's standing (lib/task-standing.js standingForTicket); a standing that could not be read
 * is passed as `null`, and the gate refuses rather than reading it as absent.
 *
 * WHY THIS IS NOT A LIVE GIT/GITHUB CHECK. LIN-1967 deliberately keeps
 * `lib/periodicals.js` location-agnostic — the engine is never told which
 * path or which repo a given periodical's report lives in (that convention
 * is discovered by the executing agent at run time, per
 * docs/architecture/source-map.md). Without
 * a reliable path, a literal "does this file exist on a branch with a PR"
 * check would need either a hard-coded single-repo assumption (breaking the
 * app's provider/workspace-agnostic design) or a new live external
 * dependency bolted onto the shared, multi-provider issue-write endpoint —
 * both rejected as disproportionate to this ticket. Instead, this gate
 * enforces a narrower, still-real, still-mechanical bar: a periodical
 * review task may not move to a completed state unless its change record
 * (LIN-4533; a comment before it) cites a concrete, well-formed reference to a change
 * (a GitHub commit/PR/blob URL) — the structural minimum that distinguishes
 * "I wrote a file" (unverifiable prose, the exact shape of the three failed
 * batches) from "here is the change, checkable in principle" (a URL a human
 * or a later automated pass can actually open). It is not full verification,
 * but it is enforced in code rather than trusted from prompt text, so it
 * survives a conflicting operator instruction the way prose cannot.
 */

import { extractPeriodicalGateId } from './periodicals.js';

// A concrete, checkable-in-principle reference: a commit, pull-request or
// blob URL on github.com. Deliberately NOT scoped to any one owner/repo —
// this module never hard-codes a repo, in keeping with LIN-1967's
// location-agnostic design.
const EVIDENCE_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|commit|blob)\/\S+$/i;

/** LIN-2323 / LIN-4533: the three fields of a complete adversarial second read, as a verdict record carries them. */
export const ADVERSARIAL_OUTCOMES = Object.freeze(['agree', 'disagree']);
export const ADVERSARIAL_DIFFERED = Object.freeze(['yes', 'no']);
export const ADVERSARIAL_DISPOSITIONS = Object.freeze(['fixed in place', 'escalated', 'no change']);

/**
 * Does the task's landing (its change records' PR URLs) name a concrete GitHub commit/PR/blob URL? This is the
 * report-persistence evidence bar: a path to a file is not a checkable change, a PR URL is. Pure.
 *
 * @param {string[]|null|undefined} landing - the landing PR URLs (lib/records/standing.js); null is not read
 * @returns {boolean}
 */
export function hasReportEvidence(landing) {
  if (!Array.isArray(landing)) return false;
  return landing.some(url => typeof url === 'string' && EVIDENCE_URL_RE.test(url));
}

/**
 * Is there a complete adversarial second read on the report's change? The read must be a verdict record whose outcome is
 * AGREE or DISAGREE, whose differed flag is YES or NO, and whose disposition is one of the three words, and it must judge
 * a PR of the landing. The predicate checks presence and well-formedness, never whether the verdict is right (the module
 * is "not full verification, but enforced in code" — see the header). Pure.
 *
 * @param {{outcome?: string|null, differed?: string|null, disposition?: string|null, on?: string[]}|null|undefined} read
 * @param {string[]|null|undefined} landing - the landing PR URLs the read must judge one of
 * @returns {boolean}
 */
export function hasAdversarialReadEvidence(read, landing) {
  if (!read || !Array.isArray(landing)) return false;
  const low = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const judgesLanding = Array.isArray(read.on) && read.on.some(url => landing.includes(url));
  return judgesLanding
    && ADVERSARIAL_OUTCOMES.includes(low(read.outcome))
    && ADVERSARIAL_DIFFERED.includes(low(read.differed))
    && ADVERSARIAL_DISPOSITIONS.includes(low(read.disposition));
}

/**
 * The full Done-transition gate check for one issue-update request.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.description - The issue's current description (pre-update).
 * @param {string[]|null|undefined} params.landing - The task's landing PR URLs from records; null when the standing was not read.
 * @param {{outcome?: string|null, differed?: string|null, disposition?: string|null, on?: string[]}|null|undefined} params.adversarialRead - The latest adversarial-read verdict on the task (null: none, or not read).
 * @param {string|null|undefined} params.targetStateType - The RESOLVED target state's `type` (e.g. 'completed'), or null/undefined when not yet known / not a state-changing update.
 * @returns {{applies: boolean, ok: boolean, periodicalGateId: string|null, message?: string, code?: string}}
 *   `applies: false` means this issue is not periodical-gated (no marker) or
 *   the update does not target a completed state — the caller should proceed
 *   exactly as before. `applies: true, ok: false` means refuse the write;
 *   `code` then discriminates WHICH evidence is missing (report persistence
 *   vs. adversarial-read record) so callers/consumers can tell the two
 *   refusal reasons apart.
 */
export function checkPeriodicalReportGate({ description, landing, adversarialRead, targetStateType } = {}) {
  const periodicalGateId = extractPeriodicalGateId(description);
  if (!periodicalGateId) return { applies: false, ok: true, periodicalGateId: null };
  if (targetStateType !== 'completed') return { applies: false, ok: true, periodicalGateId };

  if (landing === null || landing === undefined) {
    // An unread standing is refused, not read as absent, but it is not the same fault as a missing change record: the
    // change record may already be there, so the message does not tell the caller to write one.
    return {
      applies: true,
      ok: false,
      periodicalGateId,
      code: 'PERIODICAL_REPORT_NOT_PERSISTED',
      message:
        'This periodical review task cannot be marked done yet: its records could not be read just now, so its change ' +
        'record could not be checked. Nothing is known to be missing. Retry this transition; if it keeps failing, ' +
        'the records store is unavailable, so say so rather than writing a second change record.'
    };
  }

  if (!hasReportEvidence(landing)) {
    return {
      applies: true,
      ok: false,
      periodicalGateId,
      code: 'PERIODICAL_REPORT_NOT_PERSISTED',
      message:
        'This periodical review task cannot be marked done yet: its change record names no concrete ' +
        'GitHub commit, pull-request or blob URL for the report it is expected to have persisted ' +
        '(see docs/architecture/source-map.md\'s periodical report-location convention). Record the report\'s ' +
        'change (POST /api/proxy/records, kind change, with its PR URL as ref and its head sha), then retry this transition.'
    };
  }

  if (!hasAdversarialReadEvidence(adversarialRead, landing)) {
    return {
      applies: true,
      ok: false,
      periodicalGateId,
      code: 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED',
      message:
        'This periodical review task cannot be marked done yet: report-persistence evidence is ' +
        'present, but no verdict record on its change records a complete adversarial second-read. A separate reader\'s ' +
        'verdict must carry, in one record: judgement adversarial-read; outcome agree or disagree (its verdict on whether ' +
        'the report is complete and correctly filed); differed yes or no (whether its own answer to the largest-missed-item ' +
        'question differed from the report\'s top-ranked finding); and disposition fixed in place, escalated, or no change. ' +
        'Record that verdict on the change (POST /api/proxy/records, kind verdict, on the change), then retry this transition.'
    };
  }

  return { applies: true, ok: true, periodicalGateId };
}
