// =============================================================================
// Canonical State Model
// =============================================================================
//
// The canonical issue-state vocabulary, using Linear's real `state.type` enum
// values. This is the contract that every provider maps INTO — Phase 1 of
// LIN-174 (Backend Provider Abstraction). LIN-176 (Provider Interface),
// LIN-178 (GitHub), and LIN-275 (Jira) will normalize their native states into
// these constants.
//
// Named after the actual `state.type` values that already flow through the
// codebase (started/unstarted/backlog/completed/canceled/duplicate), NOT a new
// in_progress/todo/done/cancelled dialect — manufacturing a second vocabulary
// is the exact gap LIN-174 exists to close.
//
// No imports, no side effects.

export const STARTED = 'started'
export const UNSTARTED = 'unstarted'
export const BACKLOG = 'backlog'
export const COMPLETED = 'completed'
export const CANCELED = 'canceled'
export const DUPLICATE = 'duplicate'

/**
 * Terminal state types: issues in these states are non-actionable and should be
 * filtered/grouped together across all views. Duplicates are treated
 * identically to canceled across all surfaces (LIN-276).
 */
export const TERMINAL_TYPES = [COMPLETED, CANCELED, DUPLICATE]

/**
 * Canonical sort order for state types. Matches the order maps that previously
 * lived (in agreement) in linear.js and render-swipe.js;
 * duplicate ranks together with canceled.
 *
 * Note: swim-lanes.js intentionally collapses all terminal states to a single
 * rank — that deliberate variant is derived from these same constants there,
 * not from this map.
 */
export const STATE_ORDER = {
  [STARTED]: 0,
  [UNSTARTED]: 1,
  [BACKLOG]: 2,
  [COMPLETED]: 3,
  [CANCELED]: 4,
  [DUPLICATE]: 4,
}

// =============================================================================
// Canonical issue provenance (LIN-561)
// =============================================================================
//
// Every canonical issue records WHERE it came from in a `source` field, so the
// internal model stops implicitly assuming "everything is Linear". The value is
// the originating provider's registry `.name`: the Linear dashboard reads stamp
// `linear`, LocalProvider stamps `local`, GitHubProvider stamps `github`. With a
// single provider every issue reads `linear` and nothing visibly changes; the
// field exists so downstream namespacing (LIN-556) and the cross-provider merge
// + source badge (LIN-544) have one provenance seam to read.
//
// The constants below are the source vocabulary; provider mappers import the one
// matching their identity and set `source` on each canonical issue they emit.

export const SOURCE_LINEAR = 'linear'
export const SOURCE_GITHUB = 'github'
// GitHub Projects v2 boards are a SEPARATE backend shape from GitHub Issues
// (LIN-560), so they carry their own provenance. A board item and a repo issue
// can be the SAME underlying GitHub issue surfaced from two bindings; keeping
// distinct sources keeps `<source>:<id>` merge keys (buildForest) from colliding
// so both render with their own source badge.
export const SOURCE_GITHUB_PROJECTS = 'github-projects'
export const SOURCE_LOCAL = 'local'
// Jira Cloud provider (LIN-275/LIN-1885) — read-only Phase 1 MVP.
export const SOURCE_JIRA = 'jira'

/**
 * The back-compat default provenance: Linear, the historical single provider.
 *
 * Used for any issue that predates the stamp — legacy session data, and the
 * route-internal raw-node proxy reads (`issues`/`issueDetail`) that are
 * deliberately left UN-stamped so the source-neutral consumer wire stays
 * byte-identical (the `source` field is not part of that contract yet; exposing
 * it is LIN-544's source-badge work). Mirrors the registry's
 * `getProviderForWorkspace` Linear fallback: absent provenance resolves to
 * Linear.
 */
export const DEFAULT_SOURCE = SOURCE_LINEAR

/**
 * Read a canonical issue's provenance, defaulting to Linear for an un-stamped
 * (legacy / single-provider) issue. The single seam downstream code should use
 * rather than reading `issue.source` directly, so the back-compat default lives
 * in exactly one place.
 * @param {{source?: string}} [issue]
 * @returns {string} The provider name the issue originated from.
 */
export function issueSource(issue) {
  return issue?.source || DEFAULT_SOURCE
}

// =============================================================================
// Canonical priority scale (LIN-2239)
// =============================================================================
//
// Ascending: 0 = unknown, 1 = lowest, increasing toward most urgent. Carried
// on a NEW field, `priorityLevel` — deliberately NOT a redefinition of the
// existing `priority` field. `priority` is Linear's native scale (0 = none,
// 1 = Urgent ... 4 = Low, i.e. DESCENDING urgency) and every existing reader/
// writer already treats it that way; redefining it in place would be a
// same-name/same-type/same-range SILENT INVERSION — every existing integration
// sending `priority: 1` meaning Urgent would silently start meaning Low, with
// no error and a 200 every time. That is precisely the defect this ticket was
// filed to fix, shipped a second time. `priority`/`priorityLabel` are
// UNCHANGED by this ticket and stay Linear-native and authoritative on the
// wire; `priorityLevel` is purely additive — nothing stored or previously
// dispatched under the old meaning needs reinterpreting, because no existing
// field's meaning changes.
//
// Linear's native 0 ("a human chose not to set one") and a non-priority
// provider's absence of any priority concept both surface as canonical
// `0 = unknown` — collapsed deliberately, not left undecided: every provider
// without Linear's priority scale (github, github-projects, jira) already
// encodes "no signal" as native `priority: 0` in the SAME field this maps
// from, so a second field to keep the two "no signal" cases apart would have
// zero consumers today — the same unvalidated-interface-widening trap named
// for `listScopes`'s return shape in LIN-2010 Phase 2.

export const PRIORITY_UNKNOWN = 0

/**
 * Linear's native 0-4 priority scale, inverted around its midpoint: 0 stays 0
 * (unknown/none); 1-4 reverse (native 1/Urgent <-> canonical 4/highest, native
 * 4/Low <-> canonical 1/lowest). The SAME formula maps native->canonical and
 * canonical->native (it is self-inverse over this range) — kept as two named
 * exports below for read-site clarity, not two implementations. Out-of-range
 * or non-integer input maps to {@link PRIORITY_UNKNOWN}, fail-safe (mirrors
 * `isValidPriority`'s existing silent-drop convention in
 * lib/issue-write-validation.js).
 * @param {number} value
 * @returns {number}
 */
function invertLinearPriorityScale(value) {
  if (!Number.isInteger(value) || value < 0 || value > 4) return PRIORITY_UNKNOWN
  return value === 0 ? 0 : 5 - value
}

/**
 * Linear-native priority (0=none, 1=Urgent … 4=Low) -> canonical ascending
 * `priorityLevel` (0=unknown, 1=lowest … 4=highest).
 * @param {number} nativePriority
 * @returns {number}
 */
export function linearPriorityToCanonical(nativePriority) {
  return invertLinearPriorityScale(nativePriority)
}

/**
 * Canonical ascending `priorityLevel` (0=unknown, 1=lowest … 4=highest) ->
 * Linear-native priority (0=none, 1=Urgent … 4=Low).
 * @param {number} priorityLevel
 * @returns {number}
 */
export function canonicalPriorityToLinear(priorityLevel) {
  return invertLinearPriorityScale(priorityLevel)
}
