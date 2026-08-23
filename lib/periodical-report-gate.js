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

/**
 * The full Done-transition gate check for one issue-update request.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.description - The issue's current description (pre-update).
 * @param {Array<{body?: string}>|null|undefined} params.comments - The issue's current comments.
 * @param {string|null|undefined} params.targetStateType - The RESOLVED target state's `type` (e.g. 'completed'), or null/undefined when not yet known / not a state-changing update.
 * @returns {{applies: boolean, ok: boolean, periodicalGateId: string|null, message?: string}}
 *   `applies: false` means this issue is not periodical-gated (no marker) or
 *   the update does not target a completed state — the caller should proceed
 *   exactly as before. `applies: true, ok: false` means refuse the write.
 */
export function checkPeriodicalReportGate({ description, comments, targetStateType } = {}) {
  const periodicalGateId = extractPeriodicalGateId(description);
  if (!periodicalGateId) return { applies: false, ok: true, periodicalGateId: null };
  if (targetStateType !== 'completed') return { applies: false, ok: true, periodicalGateId };

  if (hasReportEvidenceComment(comments)) {
    return { applies: true, ok: true, periodicalGateId };
  }
  return {
    applies: true,
    ok: false,
    periodicalGateId,
    message:
      'This periodical review task cannot be marked done yet: no comment on it cites a concrete ' +
      'GitHub commit, pull-request or blob URL for the report it is expected to have persisted ' +
      '(see CLAUDE.md\'s periodical report-location convention). Post the report, then a comment ' +
      'naming its actual commit/PR link, before retrying this transition.'
  };
}
