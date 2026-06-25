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
export const SOURCE_LOCAL = 'local'

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
