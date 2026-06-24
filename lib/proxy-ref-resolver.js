// LIN-556: LLM-friendly + provider-namespaced reference resolution for the proxy
// write paths. This is an *additive, input-only* contract layer: it accepts new
// reference forms at the API boundary and resolves them to native provider IDs
// before mutation. Stored data, the read/output wire, and existing UUID /
// identifier payloads are all unchanged — a bare UUID resolves to itself without
// even touching the provider, so today's callers are byte-identical.
//
// Two ordered layers of ONE resolver seam (see the LIN-556 design record):
//   1. Parse an optional `<source>:` namespace prefix, built on the canonical
//      LIN-561 `source` vocabulary, and reject any namespace not active in the
//      workspace. The proxy is hardwired to Linear today, so only `linear:`
//      (or a bare ref) is accepted; LIN-544 relaxes this when providers coexist
//      and inherits the collision-safe parser for free.
//   2. Resolve the local-part WITHIN that provider: UUID → native identifier →
//      symbolic name/type, failing loud (422) on an ambiguous match rather than
//      guessing. UUID always wins, so it is the unambiguous escape hatch.
//
// The resolve* functions are PURE: callers pass the already-fetched candidate
// list (states/labels/projects/teams), so resolution is trivially unit-testable
// and the network read stays in the route. They are scoped by the caller to the
// relevant team/provider so symbolic matches do not bleed across scopes.

import { UUID_REGEX } from './workspace.js';
import { SOURCE_LINEAR, SOURCE_GITHUB, SOURCE_LOCAL } from './providers/models.js';

// The full source vocabulary (LIN-561). A parsed prefix must be one of these to
// be a *namespace* at all; anything else is treated as part of a bare local ref.
const KNOWN_SOURCES = [SOURCE_LINEAR, SOURCE_GITHUB, SOURCE_LOCAL];

// The providers actually active in a workspace today. The proxy is hardwired to
// Linear (per LIN-306/LIN-544 sequencing), so only `linear:` is live; the rest
// are reserved and rejected with a clean 422 until multi-provider routing lands.
export const ACTIVE_SOURCES = [SOURCE_LINEAR];

const SOURCE_PREFIX_RE = new RegExp(`^(${KNOWN_SOURCES.join('|')}):(.+)$`, 'i');

/**
 * Symbolic state aliases → canonical LIN-561 state TYPE. A reference matches a
 * state when its alias resolves to that state's `type` (or the literal name
 * matches case-insensitively — handled in resolveStateRef). The right-hand side
 * is the `type` field providers stamp, NOT a state name, so this composes with
 * any team's custom state names.
 */
export const STATE_TYPE_ALIASES = {
  done: 'completed',
  completed: 'completed',
  'in-progress': 'started',
  inprogress: 'started',
  started: 'started',
  todo: 'unstarted',
  'to-do': 'unstarted',
  unstarted: 'unstarted',
  backlog: 'backlog',
  canceled: 'canceled',
  cancelled: 'canceled',
  duplicate: 'duplicate',
};

/**
 * A loud, contract-level resolution failure. Carries the HTTP status the route
 * should surface (422 for ambiguous / unresolved / inactive-namespace) and,
 * for ambiguity, the candidate `{ id, name }` pairs so the caller can pass the
 * UUID escape hatch.
 */
export class RefResolutionError extends Error {
  constructor(message, { status = 422, candidates } = {}) {
    super(message);
    this.name = 'RefResolutionError';
    this.status = status;
    if (candidates) this.candidates = candidates;
  }
}

/**
 * Layer 1 — strip and validate an optional `<source>:` namespace prefix.
 *
 * Returns `{ source, localRef }`. A bare reference (no recognised prefix) yields
 * `source: null` and the original string, which resolves against the workspace's
 * active provider (Linear today) → byte-identical back-compat. A recognised
 * prefix whose source is not active is rejected with a 422.
 *
 * The parse is unambiguous against every existing input form: Linear identifiers
 * (`LIN-123`) and UUIDs contain no colon, and the only recognised prefixes are
 * the fixed `{linear,github,local}` vocabulary, so a label/state literally
 * containing a colon is never mistaken for a namespace.
 *
 * @param {string} rawRef
 * @param {string[]} [activeSources] - providers live in this workspace
 * @returns {{ source: string|null, localRef: string }}
 */
export function parseSourceNamespace(rawRef, activeSources = ACTIVE_SOURCES) {
  const ref = String(rawRef).trim();
  const m = SOURCE_PREFIX_RE.exec(ref);
  if (!m) return { source: null, localRef: ref };

  const source = m[1].toLowerCase();
  const localRef = m[2].trim();
  if (!activeSources.includes(source)) {
    throw new RefResolutionError(
      `Provider namespace '${source}:' is not active in this workspace`,
      { status: 422 },
    );
  }
  return { source, localRef };
}

/**
 * Collapse symbolic matches to a single id, applying the shared fail-loud rule:
 * 0 matches → 422 not-found, >1 distinct ids → 422 ambiguous (with candidates),
 * exactly 1 → that id.
 */
function uniqueOrThrow(matches, kind, ref) {
  const uniq = [...new Map(matches.map(m => [m.id, m])).values()];
  if (uniq.length === 1) return uniq[0].id;
  if (uniq.length === 0) {
    throw new RefResolutionError(`No ${kind} matches reference '${ref}'`, { status: 422 });
  }
  throw new RefResolutionError(
    `Ambiguous ${kind} reference '${ref}' — pass the id to disambiguate`,
    { status: 422, candidates: uniq.map(m => ({ id: m.id, name: m.name })) },
  );
}

/**
 * Resolve a workflow-state reference against a team's states. Order: UUID
 * (escape hatch, passed through untouched) → symbolic type alias / literal name.
 * @param {Array<{id,name,type}>} states - the team's states (already scoped)
 * @param {string} rawRef
 * @returns {string} a state id
 */
export function resolveStateRef(states, rawRef) {
  const ref = String(rawRef).trim();
  if (UUID_REGEX.test(ref)) return ref;

  const lower = ref.toLowerCase();
  const wantType = STATE_TYPE_ALIASES[lower];
  const matches = (states || []).filter(
    s => (wantType && s.type === wantType) || String(s.name).toLowerCase() === lower,
  );
  return uniqueOrThrow(matches, 'state', ref);
}

/**
 * Resolve a label reference. Order: UUID → case-insensitive name. Mirrors the
 * CLI's findLabelByNameOrId, generalized to the fail-loud ambiguity rule.
 * @param {Array<{id,name}>} labels
 * @param {string} rawRef
 * @returns {string} a label id
 */
export function resolveLabelRef(labels, rawRef) {
  const ref = String(rawRef).trim();
  if (UUID_REGEX.test(ref)) return ref;

  const lower = ref.toLowerCase();
  const matches = (labels || []).filter(l => String(l.name).toLowerCase() === lower);
  return uniqueOrThrow(matches, 'label', ref);
}

/**
 * Resolve a project reference. Order: UUID → case-insensitive name.
 * @param {Array<{id,name}>} projects
 * @param {string} rawRef
 * @returns {string} a project id
 */
export function resolveProjectRef(projects, rawRef) {
  const ref = String(rawRef).trim();
  if (UUID_REGEX.test(ref)) return ref;

  const lower = ref.toLowerCase();
  const matches = (projects || []).filter(p => String(p.name).toLowerCase() === lower);
  return uniqueOrThrow(matches, 'project', ref);
}

/**
 * Resolve a team reference. Order: UUID → team key (e.g. `LIN`) →
 * case-insensitive name. Key match is case-insensitive too, matching how Linear
 * identifiers are case-folded elsewhere.
 * @param {Array<{id,name,key}>} teams
 * @param {string} rawRef
 * @returns {string} a team id
 */
export function resolveTeamRef(teams, rawRef) {
  const ref = String(rawRef).trim();
  if (UUID_REGEX.test(ref)) return ref;

  const lower = ref.toLowerCase();
  const matches = (teams || []).filter(
    t => String(t.key).toLowerCase() === lower || String(t.name).toLowerCase() === lower,
  );
  return uniqueOrThrow(matches, 'team', ref);
}
