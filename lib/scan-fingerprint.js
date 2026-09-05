/**
 * Scan-basis fingerprint (LIN-2241 tier 1).
 *
 * "Has the content this ruling was raised FROM moved since it was raised?" —
 * answered by comparing two digests. No model call.
 *
 * ## Why this is not `hashContext`, and not the scan's rendered input
 *
 * LIN-2241's Half A prescribes "a fingerprint of the scan's own input
 * (description + comments + subtask state — what `formatIssueContext`
 * composes)" while its acceptance criterion 1 requires that a change to
 * priority/labels/assignee alone must NOT mark a task due. At HEAD those two
 * sentences are unsatisfiable together, so this module implements the
 * criterion rather than the parenthetical:
 *
 *   - `formatIssueContext` (lib/openrouter.js) composes `**Updated:**
 *     ${issue.updatedAt}` (:651, added by LIN-1067) and `**Labels:**` (:660).
 *     A digest of what it actually composes moves on every `updatedAt` bump —
 *     i.e. on exactly the priority/label/assignee/cycle edits criterion 1
 *     names as changes that must not count.
 *   - `hashContext` (lib/recap-cache.js:94) — already stored on every scan row
 *     as `inputHash` — excludes `updatedAt`, priority and assignee, but
 *     INCLUDES labels, on the issue and on every child (:54, :64). A
 *     label-only edit flips it, so it fails criterion 1 too.
 *
 * `inputHash` is also not free to narrow in place: `TaskDecisionsStore.buildId`
 * derives a durable row `_id` from it, and `lib/scan.js` reuses that same
 * formula for a decision's own `decision_id`. It is the row's IDENTITY.
 * The basis hash here is a second, additive digest with a different job —
 * two hashes, two jobs.
 *
 * ## The slice
 *
 * Included: title, description, the task's own state TYPE, comments, and
 * parent/subtask state — the content a scan's judgement actually rests on, and
 * whose movement means "the question may no longer be the right question".
 *
 * Excluded: `updatedAt`, labels, priority, assignee, cycle, project. A
 * nuisance signal destroys trust in the panel faster than anything else
 * (docs/escalation-philosophy.md §4), and none of these can change the answer
 * to "does this task carry a decision that needs the operator".
 *
 * ## Determinism is load-bearing, because a false flag is the expensive failure
 *
 * Comments and children are ORDER-CANONICALIZED here rather than hashed in
 * provider order. `lib/providers/linear/index.js:910-916` sorts comments by
 * `createdAt`, but same-timestamp ties fall through to the GraphQL connection
 * order, which that same file notes at :942-945 Linear does not guarantee. Two
 * fetches of an unchanged task could then hash differently and manufacture a
 * "the task changed" flag out of nothing. `hashContext` carries the same
 * exposure, but a spurious `inputHash` move is a benign cache miss — a
 * spurious basis flag is exactly the nuisance this module exists to avoid.
 *
 * Comments are keyed on `(createdAt, body, id)` rather than `id` alone
 * deliberately: Linear's `fetchIssueContext` emits `{body, createdAt, user}`
 * with NO `id` (:910-915), so an id-keyed digest would be blind to comment
 * changes on the primary provider. GitHub/Jira/local do carry ids, and those
 * are folded in where present.
 *
 * ## Versioning
 *
 * A basis hash is frozen on the scan row at raise time and re-derived from
 * live content at read time, so the two are computed by whatever this file
 * says at their respective moments. Any future edit to the projection would
 * silently mass-flag every pending ruling as "changed". `BASIS_VERSION` is
 * folded into the digest AND stored beside the hash, so a comparison across a
 * version boundary resolves to UNKNOWN rather than to a fleet-wide false
 * positive. Bump it whenever the projection below changes.
 *
 * Deliberately NOT routed through `lib/task-snapshot-store.js`'s
 * `snapshotFromContext`: that projection clamps to 500 comments / 500 children
 * / 500-char fields, which would make a 501st comment — "an agent answered the
 * question in a comment", the motivating case — invisible to the basis.
 */

import crypto from 'crypto';
import { stableStringify } from './recap-cache.js';

/**
 * Bump on ANY change to `scanBasisFromContext`'s projection below. A stored
 * hash carrying a different version is not comparable and reads as unknown.
 */
export const BASIS_VERSION = 2;

function text(value) {
  return typeof value === 'string' ? value : '';
}

function stateType(state) {
  return state && typeof state === 'object' ? text(state.type) : '';
}

/**
 * Deterministic ordering key — stable across two fetches of the same content.
 * `\x00` separates the key's parts because it cannot occur in provider text;
 * writing it as an ESCAPE rather than a literal byte keeps this file plain
 * text, which matters more than it sounds: a literal NUL makes git classify
 * the source as binary, and the one file whose whole premise is that you can
 * reason about the projection then has no diff, no blame and no review.
 *
 * `i` is a structural tie-break so the sort is total even if two keys somehow
 * collide — V8's sort is stable, but relying on input order here would be
 * relying on exactly the provider ordering this function exists to neutralise.
 */
function byKey(a, b) {
  if (a.k < b.k) return -1;
  if (a.k > b.k) return 1;
  return a.i - b.i;
}

/** Normalize a timestamp to a stable, timezone-independent string. */
function stamp(value) {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

/**
 * Resolve a comment's identity the SAME way the basis extraction below does:
 * prefer `id` (GitHub/Jira/Local), fall back to `commentId` (Linear only).
 * Exported and reused by `lib/harbour-comments-store.js`'s
 * `wereRecordedByHarbour` (LIN-2648) so "is this comment in the ledger" and
 * "does this comment feed the basis hash" read the same field precedence by
 * construction, never merely by convention.
 *
 * @param {Object|null|undefined} c - a comment-like object
 * @returns {string}
 */
export function resolveCommentId(c) {
  return text(c?.id || c?.commentId);
}

/**
 * Project a live recommendation context down to the basis slice. Pure; no I/O.
 *
 * @param {Object|null} context - Output of fetchRecommendationContext().
 * @returns {Object} the normalized, order-canonical basis slice
 */
export function scanBasisFromContext(context) {
  const ctx = context && typeof context === 'object' ? context : {};
  const issue = ctx.issue && typeof ctx.issue === 'object' ? ctx.issue : {};

  const comments = (Array.isArray(ctx.comments) ? ctx.comments : [])
    .map(c => ({
      id: resolveCommentId(c),
      createdAt: stamp(c?.createdAt),
      body: text(c?.body)
    }))
    .map((c, i) => ({ k: `${c.createdAt}\x00${c.body}\x00${c.id}`, i, c }))
    .sort(byKey)
    .map(e => e.c);

  const children = (Array.isArray(ctx.children) ? ctx.children : [])
    .map(c => ({ identifier: text(c?.identifier), state: stateType(c?.state) }))
    .map((c, i) => ({ k: `${c.identifier}\x00${c.state}`, i, c }))
    .sort(byKey)
    .map(e => e.c);

  return {
    v: BASIS_VERSION,
    title: text(issue.title),
    description: text(issue.description),
    // The state TYPE only. A workflow rename ("In Review" → "Reviewing") is a
    // cosmetic provider-side edit that cannot change whether the task carries
    // an operator-worthy decision; `type` is the canonical axis
    // (lib/providers/state-map.js).
    state: stateType(issue.state),
    comments,
    parent: ctx.parent
      ? { identifier: text(ctx.parent.identifier), state: stateType(ctx.parent.state) }
      : null,
    children
  };
}

/**
 * The basis fingerprint of a live recommendation context.
 *
 * @param {Object|null} context
 * @returns {string} SHA-256 hex digest
 */
export function scanBasisHashFromContext(context) {
  return crypto.createHash('sha256').update(stableStringify(scanBasisFromContext(context))).digest('hex');
}

/**
 * Has a pending ruling's basis moved? A deliberately TRI-state answer:
 *
 *   - `true`  — both hashes are known, same version, and they differ.
 *   - `false` — both hashes are known, same version, and they agree.
 *   - `null`  — UNKNOWN. Reached when the row predates this feature (no
 *               `basisHash` recorded), when no current hash could be derived,
 *               or when the stored hash was not produced by the CURRENT
 *               `BASIS_VERSION` and is therefore not comparable.
 *
 * A missing version is treated as not-comparable, not as "compare anyway".
 * The only writer stores hash and version together (`routes/workspace-api.js`
 * → `recordScan`), so no legitimate row can carry one without the other — the
 * only rows that could take a lenient branch are ones written by some earlier,
 * different projection, and every one of those would compare as a guaranteed
 * mismatch. That is exactly the fleet-wide false positive this gate exists to
 * prevent, so there is no real answer being thrown away by refusing it.
 *
 * The null case is load-bearing. LIN-2241 is explicit that clearing is more
 * dangerous than raising, and the same asymmetry applies to flagging: a flag
 * the operator cannot trust is worse than no flag, so absence of evidence is
 * reported as absence of evidence and never as "unchanged".
 *
 * NOTE for callers: `false` and `null` are distinct facts but both mean "show
 * no flag" at the UI, because the flag is an additive nudge rather than a
 * verification badge — there is no "we checked and it's current" claim on the
 * card to get wrong. Callers that want to SAY something about the difference
 * must branch on the tri-state themselves; they must not infer "unchanged"
 * from the absence of a flag.
 *
 * @param {Object} args
 * @param {string|null|undefined} args.raisedBasisHash - `basisHash` stored on the scan row
 * @param {number|null|undefined} [args.raisedBasisVersion] - `basisVersion` stored beside it
 * @param {string|null|undefined} args.currentBasisHash - hash of the current content
 * @returns {boolean|null}
 */
export function basisChanged({ raisedBasisHash, raisedBasisVersion, currentBasisHash } = {}) {
  if (!raisedBasisHash || !currentBasisHash) return null;
  // A hash from another projection version is not a smaller or larger number —
  // it is a different question's answer. Comparing across the boundary would
  // flag every pending ruling at once, which is the single worst outcome this
  // signal can produce. An ABSENT version is treated the same way, deliberately:
  // see the docstring above for why there is no legitimate version-less row.
  if (raisedBasisVersion !== BASIS_VERSION) return null;
  return raisedBasisHash !== currentBasisHash;
}

/**
 * Project a live recommendation context down to the DUE-basis slice (LIN-2649
 * WS2) — the identical projection to `scanBasisFromContext`, with exactly one
 * addition: any comment already recorded in the WS1 Harbour-comment ledger
 * (`recordedCommentIds`) is dropped before the digest is built. For "is this
 * scanned task worth spending another scan on?", a Harbour-authored close-out
 * comment is exactly the noise `dueBasisHash` exists to exclude, whereas
 * `basisHash` (tier-1, unchanged) folds in every comment because authorship is
 * irrelevant to a pending ruling. Pure — takes the recorded-id set as a
 * parameter and never reads the ledger store itself, so it stays network-free
 * and independently unit-testable exactly like its sibling.
 *
 * @param {Object|null} context - Output of fetchRecommendationContext().
 * @param {Object} [options]
 * @param {Set<string>} [options.recordedCommentIds] - comment ids the WS1
 *   ledger already attributes to Harbour; these are excluded from the digest.
 * @returns {Object} the normalized, order-canonical due-basis slice
 */
export function dueBasisFromContext(context, { recordedCommentIds } = {}) {
  const ctx = context && typeof context === 'object' ? context : {};
  const issue = ctx.issue && typeof ctx.issue === 'object' ? ctx.issue : {};
  const recorded = recordedCommentIds instanceof Set ? recordedCommentIds : new Set();

  const comments = (Array.isArray(ctx.comments) ? ctx.comments : [])
    .filter(c => !recorded.has(resolveCommentId(c)))
    .map(c => ({
      id: resolveCommentId(c),
      createdAt: stamp(c?.createdAt),
      body: text(c?.body)
    }))
    .map((c, i) => ({ k: `${c.createdAt}\x00${c.body}\x00${c.id}`, i, c }))
    .sort(byKey)
    .map(e => e.c);

  const children = (Array.isArray(ctx.children) ? ctx.children : [])
    .map(c => ({ identifier: text(c?.identifier), state: stateType(c?.state) }))
    .map((c, i) => ({ k: `${c.identifier}\x00${c.state}`, i, c }))
    .sort(byKey)
    .map(e => e.c);

  return {
    v: BASIS_VERSION,
    title: text(issue.title),
    description: text(issue.description),
    state: stateType(issue.state),
    comments,
    parent: ctx.parent
      ? { identifier: text(ctx.parent.identifier), state: stateType(ctx.parent.state) }
      : null,
    children
  };
}

/**
 * The due-basis fingerprint of a live recommendation context.
 *
 * @param {Object|null} context
 * @param {Object} [options]
 * @param {Set<string>} [options.recordedCommentIds]
 * @returns {string} SHA-256 hex digest
 */
export function dueBasisHashFromContext(context, { recordedCommentIds } = {}) {
  return crypto.createHash('sha256').update(stableStringify(dueBasisFromContext(context, { recordedCommentIds }))).digest('hex');
}

/**
 * Has a scanned task's DUE-basis moved since it was raised? Byte-parallel to
 * `basisChanged` — the same enforcement mechanism, reused rather than
 * re-derived: a missing hash or a version mismatch returns `null` before any
 * `!==` runs, so no code path can produce `true` from absent data. Tri-state
 * is exactly `true` / `false` / `null` (LIN-2649 WS2).
 *
 * @param {Object} args
 * @param {string|null|undefined} args.raisedDueBasisHash - `dueBasisHash` stored on the scan row
 * @param {number|null|undefined} [args.raisedDueBasisVersion] - `dueBasisVersion` stored beside it
 *   (LIN-2665 L1: its OWN version field — never `basisVersion`, which versions the unrelated
 *   tier-1 `basisHash` and must not be conflated with due-basis comparability)
 * @param {string|null|undefined} args.currentDueBasisHash - hash of the current content
 * @returns {boolean|null}
 */
export function dueChanged({ raisedDueBasisHash, raisedDueBasisVersion, currentDueBasisHash } = {}) {
  if (!raisedDueBasisHash || !currentDueBasisHash) return null;
  if (raisedDueBasisVersion !== BASIS_VERSION) return null;
  return raisedDueBasisHash !== currentDueBasisHash;
}
