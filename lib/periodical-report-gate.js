/**
 * lib/periodical-report-gate.js
 *
 * The Done-transition gate for periodical Stage-2 review tasks (LIN-694).
 *
 * BACKGROUND. A periodical Stage-2 review task is expected to write a report
 * artifact (`docs/reviews/<name>-<date>.md`, LIN-1967) before self-concluding.
 * Three batches in a row (2026-06-25, 2026-07-11, 2026-08-23) produced tasks
 * that reached Linear's Done state while their report survived only as a
 * Linear comment — because a periodical's own prompt text is just a
 * convention, and a conflicting operator instruction ("do not create any
 * file") silently overrides a convention every time, with nothing at any
 * layer noticing. This module is the code-level backstop: it does not trust
 * the task's own prose about what it did.
 *
 * WHY THIS IS NOT A LIVE GIT/GITHUB CHECK. LIN-1967 deliberately keeps
 * `lib/periodicals.js` location-agnostic — the engine is never told which
 * path or which repo a given periodical's report lives in (that convention
 * is discovered by the executing agent at run time, per CLAUDE.md). Without
 * a reliable path, a literal "does this file exist on a branch with a PR"
 * check would need either a hard-coded single-repo assumption (breaking the
 * app's provider/workspace-agnostic design) or a new live external
 * dependency bolted onto the shared, multi-provider issue-write endpoint —
 * both rejected as disproportionate to this ticket. Instead, this gate
 * enforces a narrower, still-real, still-mechanical bar: a periodical
 * review task may not self-conclude to a completed state unless a comment
 * on the SAME issue cites a concrete, well-formed reference to a change
 * (a GitHub commit/PR/blob URL) — the structural minimum that distinguishes
 * "I wrote a file" (unverifiable prose, the exact shape of the three failed
 * batches) from "here is the change, checkable in principle" (a URL a human
 * or a later automated pass can actually open). It is not full verification,
 * but it is enforced in code rather than trusted from prompt text, so it
 * survives a conflicting operator instruction the way prose cannot.
 */

const MARKER_ATTR = 'harbour-periodical-gate';

const MARKER_RE = new RegExp(`<!--\\s*${MARKER_ATTR}\\s+id="([a-z0-9-]+)"\\s*-->`, 'i');

/**
 * Derive a stable, lowercase-kebab id from a periodical's display title, for
 * embedding in the gate marker. Not required to match `PERIODICALS[].id` in
 * lib/periodicals.js — the marker only needs to be a stable per-template
 * string for logging/diagnostics; the gate itself keys off marker PRESENCE,
 * not the id's exact value.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugifyPeriodicalTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

/**
 * Build the HTML-comment marker a periodical's minted Stage-2 task is
 * instructed to carry verbatim in its own description. Presence of this
 * marker is what routes/proxy.js's PATCH /api/proxy/issues/:id handler uses
 * to recognise "this issue is a periodical review task" before applying the
 * report-persistence gate below.
 *
 * @param {string} title - The periodical's display title (e.g. 'Documentation Review').
 * @returns {string}
 */
export function buildPeriodicalGateMarker(title) {
  return `<!-- ${MARKER_ATTR} id="${slugifyPeriodicalTitle(title)}" -->`;
}

/**
 * Extract the gate marker's id from an issue description, or null when the
 * marker is absent (an ordinary, non-periodical issue — the overwhelmingly
 * common case). Pure, no network.
 *
 * @param {string|null|undefined} description
 * @returns {string|null}
 */
export function extractPeriodicalGateId(description) {
  if (typeof description !== 'string' || !description) return null;
  const match = MARKER_RE.exec(description);
  return match ? match[1] : null;
}

// A concrete, checkable-in-principle reference: a commit, pull-request or
// blob URL on github.com. Deliberately NOT scoped to any one owner/repo —
// this module never hard-codes a repo, in keeping with LIN-1967's
// location-agnostic design.
const EVIDENCE_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|commit|blob)\/\S+/i;

/**
 * Does ANY comment on the issue cite a concrete GitHub commit/PR/blob URL?
 * This is the report-persistence evidence bar: a bare claim like
 * "Report: docs/reviews/x.md" (the exact shape of the reports that were
 * actually lost) does not satisfy it, because it names a path, not a
 * checkable change. Pure — no network, operates on already-fetched comments.
 *
 * @param {Array<{body?: string}>|null|undefined} comments
 * @returns {boolean}
 */
export function hasReportEvidenceComment(comments) {
  if (!Array.isArray(comments)) return false;
  return comments.some(c => typeof c?.body === 'string' && EVIDENCE_URL_RE.test(c.body));
}

// LIN-2323 — the adversarial-second-read evidence bar. A structural extension
// of the same backstop above (see the module header): a periodical's own
// prompt instruction to get a fresh-context adversarial re-read before
// concluding is, on its own, exactly the kind of convention this module
// exists to not trust. This predicate is what makes it binding rather than
// advice. All three fields are REQUIRED IN THE SAME comment body — a bare
// verdict (e.g. a lone "AGREE") does not satisfy it, because the two other
// fields are what the ~1-month sunset review needs to tell a genuine
// agreement apart from a rubber stamp (see lib/periodicals.js's
// periodicalBullet.adversarialRead() for the full record contract).
const ADVERSARIAL_VERDICT_RE = /Adversarial second-read verdict:\s*(AGREE|DISAGREE)\b/i;
const ADVERSARIAL_DIFFERED_RE = /Differed from top finding:\s*(YES|NO)\b/i;
const ADVERSARIAL_DISPOSITION_RE = /Disposition:\s*(fixed in place|escalated|no change)\b/i;

/**
 * Does ANY single comment on the issue carry a complete adversarial-read
 * record — verdict, differed-from-top-finding flag, and disposition, all
 * three in the SAME comment body? The predicate does not credit three
 * separate comments toward one complete record, and it does not care
 * whether the verdict is AGREE or DISAGREE — only presence of a complete,
 * well-formed record is checked, never its content's correctness (the
 * module is "not full verification, but enforced in code" — see header).
 * Pure — no network, operates on already-fetched comments.
 *
 * @param {Array<{body?: string}>|null|undefined} comments
 * @returns {boolean}
 */
export function hasAdversarialReadEvidenceComment(comments) {
  if (!Array.isArray(comments)) return false;
  return comments.some(c => {
    const body = c?.body;
    return typeof body === 'string'
      && ADVERSARIAL_VERDICT_RE.test(body)
      && ADVERSARIAL_DIFFERED_RE.test(body)
      && ADVERSARIAL_DISPOSITION_RE.test(body);
  });
}

/**
 * The full Done-transition gate check for one issue-update request.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.description - The issue's current description (pre-update).
 * @param {Array<{body?: string}>|null|undefined} params.comments - The issue's current comments.
 * @param {string|null|undefined} params.targetStateType - The RESOLVED target state's `type` (e.g. 'completed'), or null/undefined when not yet known / not a state-changing update.
 * @returns {{applies: boolean, ok: boolean, periodicalGateId: string|null, message?: string, code?: string}}
 *   `applies: false` means this issue is not periodical-gated (no marker) or
 *   the update does not target a completed state — the caller should proceed
 *   exactly as before. `applies: true, ok: false` means refuse the write;
 *   `code` then discriminates WHICH evidence is missing (report persistence
 *   vs. adversarial-read record) so callers/consumers can tell the two
 *   refusal reasons apart.
 */
export function checkPeriodicalReportGate({ description, comments, targetStateType } = {}) {
  const periodicalGateId = extractPeriodicalGateId(description);
  if (!periodicalGateId) return { applies: false, ok: true, periodicalGateId: null };
  if (targetStateType !== 'completed') return { applies: false, ok: true, periodicalGateId };

  if (!hasReportEvidenceComment(comments)) {
    return {
      applies: true,
      ok: false,
      periodicalGateId,
      code: 'PERIODICAL_REPORT_NOT_PERSISTED',
      message:
        'This periodical review task cannot be marked done yet: no comment on it cites a concrete ' +
        'GitHub commit, pull-request or blob URL for the report it is expected to have persisted ' +
        '(see CLAUDE.md\'s periodical report-location convention). Post the report, then a comment ' +
        'naming its actual commit/PR link, before retrying this transition.'
    };
  }

  if (!hasAdversarialReadEvidenceComment(comments)) {
    return {
      applies: true,
      ok: false,
      periodicalGateId,
      code: 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED',
      message:
        'This periodical review task cannot be marked done yet: report-persistence evidence is ' +
        'present, but no single comment on it records a complete adversarial second-read. A comment ' +
        'from the separate reader must state three things together: (1) its verdict on whether the ' +
        'report is complete and correctly filed — AGREE or DISAGREE; (2) whether the refuter\'s own ' +
        'answer to the largest-missed-item question differed from the report\'s own top-ranked ' +
        'finding — YES or NO; and (3) the disposition of any resulting change — fixed in place, ' +
        'escalated, or no change. Post that record (it may also be copied into the report\'s ' +
        '`## Adversarial Second-Read` appendix), then retry this transition.'
    };
  }

  return { applies: true, ok: true, periodicalGateId };
}
