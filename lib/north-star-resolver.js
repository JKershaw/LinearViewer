// north-star-resolver.js: resolves a proxy token creator's durable north-star
// intent for a workspace (LIN-1810). Mirrors getWorkspaceOpenRouterKey
// (lib/openrouter-key-resolver.js, LIN-1352) — same injected-store seam, same
// fail-closed-on-null-creator invariant — so a proxy token can never read
// another account's intent.
//
// northStarByWorkspace is account-owned as-built (lib/user-preferences.js:44-46),
// keyed by accountId then workspace urlKey; this reads that durable copy only,
// never workspace preferences and never a session, so it neither crosses the
// account/workspace ownership boundary nor answers the open product question of
// whether north star should become workspace-level.
//
// userPreferencesStore is an injected parameter, not a module-scope binding,
// so callers (and tests) can supply a real or fake store directly.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

// getWorkspaceNorthStar is intentionally generic: northStarByWorkspace is a
// free-typed, per-account, per-workspace preference (set via the Roadmap
// page's north-star input, PUT /workspace/:urlKey/api/roadmap/north-star) —
// most workspaces' stored value has no relationship at all to
// docs/north-star.md, which is Harbour's OWN normative product document
// (LIN-2254). This module must not conflate the two by resolving straight to
// the doc's content: that would silently overwrite every other workspace's
// own, unrelated north star.
export async function getWorkspaceNorthStar(userPreferencesStore, urlKey, creatorId) {
  // Without a creator user ID we can't safely resolve personal intent; a
  // creator-less/ownerless token reads no north star (fails closed).
  if (!creatorId || !urlKey) {
    return '';
  }

  try {
    const prefs = await userPreferencesStore.getUserPreferences(creatorId);
    const byWorkspace = prefs.northStarByWorkspace || {};
    return byWorkspace[urlKey] || '';
  } catch (err) {
    console.error('Error looking up workspace north star:', err);
    return '';
  }
}

// getWorkspaceNorthStarDocVersion (LIN-2254): mirrors getWorkspaceNorthStar's
// exact fail-closed shape above, but reads the sibling
// northStarDocVersionByWorkspace map instead of northStarByWorkspace. That
// map holds a doc-hash stamp ONLY for a workspace whose pasted north-star
// text matched docs/north-star.md after normalising whitespace on both sides
// at paste time (routes/workspace-api-roadmap.js's PUT handler, via
// normalizeNorthStarText below; byte-exact matching could never stamp a
// genuine UI paste, LIN-2838) — null for every other workspace,
// which is most of them. This resolver does not itself compare anything; it
// just returns whatever was stamped (or null), same as getWorkspaceNorthStar
// returns whatever was pasted.
export async function getWorkspaceNorthStarDocVersion(userPreferencesStore, urlKey, creatorId) {
  if (!creatorId || !urlKey) {
    return null;
  }

  try {
    const prefs = await userPreferencesStore.getUserPreferences(creatorId);
    const byWorkspace = prefs.northStarDocVersionByWorkspace || {};
    return byWorkspace[urlKey] || null;
  } catch (err) {
    console.error('Error looking up workspace north star doc version:', err);
    return null;
  }
}

// normalizeNorthStarText (LIN-2838): the canonical whitespace-normalised form
// two north-star readings are compared in. docs/north-star.md is pasted into
// the Roadmap textarea by hand, and the browser/paste path drops the doc's
// trailing newline (LIN-2838) — so a byte-exact comparison could never stamp a
// genuine paste. This folds CRLF (and a lone CR) to LF, strips trailing
// whitespace on every line, and strips the trailing run of whitespace/blank
// lines at the very end. It deliberately does NOT touch interior content, and
// is neither case- nor whitespace-insensitive — the stamp still asserts the
// operator pasted *this* edition, and a one-character edit still fails to
// match. Exported so the read path (getNorthStarDocVersion) and the write path
// (routes/workspace-api-roadmap.js's PUT handler) normalise through the SAME
// function and cannot drift apart.
export function normalizeNorthStarText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
}

// getNorthStarDocVersion (LIN-2254): a divergence-detection primitive, not a
// resolver of live workspace state. docs/north-star.md is "a waypoint:
// revised by the human only, versioned, and never edited by any agent" — but
// nothing tied a served northStarByWorkspace value back to a version of it,
// so a workspace's live preference could go stale (as happened 2026-07-31 →
// 2026-08-23, six-clause v1 content served after v2 landed) with no signal.
//
// This hashes the doc's current bytes so a caller can compare against a hash
// captured at the time a value was pasted into a workspace's preference, and
// flag drift instead of asserting freshness it cannot back up. It says
// nothing about which workspace's stored value, if any, is supposed to track
// this doc — that mapping (today: none is tracked, so no drift is
// detectable) belongs to the write path and response layer, not here.
//
// Doc-read pattern mirrors lib/prompts/passage-planner-kickoff.js:
// readFileSync once, cache the result for the process; a failed read returns
// version: null without caching, so a later call can retry.
const NORTH_STAR_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'docs', 'north-star.md'
);

let cachedDocVersion = null;

/**
 * @param {string} [docPath] - override for tests only; real callers always
 *   use the default and get the module-lifetime cache below.
 * @returns {{ hash: string, title: string } | { hash: null, title: null }}
 *   sha256 hex of the normalised doc content (normalizeNorthStarText, LIN-2838
 *   — see that function for why the comparison is not byte-exact), plus its
 *   first line (the human-readable version label, e.g. "North star — v2, the
 *   self-funding loop"), for a consumer to log/display alongside the hash.
 *   `{ hash: null, title: null }` when the doc can't be read (never thrown —
 *   the doc's absence must not take down the endpoint that would report the
 *   divergence) — this
 *   branch is exercised in tests only via the `docPath` override, since the
 *   real doc is expected to always exist at HEAD.
 */
export function getNorthStarDocVersion(docPath = NORTH_STAR_DOC_PATH) {
  const isDefaultPath = docPath === NORTH_STAR_DOC_PATH;
  if (isDefaultPath && cachedDocVersion !== null) return cachedDocVersion;
  try {
    const raw = readFileSync(docPath, 'utf-8');
    const title = (raw.split('\n')[0] || '').replace(/^#\s*/, '').trim();
    const hash = createHash('sha256').update(normalizeNorthStarText(raw)).digest('hex');
    const result = { hash, title };
    if (isDefaultPath) cachedDocVersion = result;
    return result;
  } catch (err) {
    console.error(`Failed to read north star doc: ${docPath}`, err.message);
    return { hash: null, title: null };
  }
}

/**
 * Default freshness window (days) for folding a stored roadmap report into the
 * next-run context. The report store deliberately has NO TTL (a report is a
 * durable user artifact, not a cache — see lib/report-history-store.js), so this
 * is the gate that keeps a stale narrative out of fresh suggestions (LIN-742).
 */
export const ROADMAP_REPORT_MAX_AGE_DAYS = 14;

/** Cap on injected narrative length — narrative layers can run ~20k chars; keep the prompt lean. */
const MAX_ROADMAP_NARRATIVE_CHARS = 4000;

/**
 * Shared age computation for a report's `generatedAt`, used by
 * resolveRoadmapNarrative, resolveNorthStarSignal, and classifyReportFreshness
 * so the three can never interpret "how old is this report" differently.
 *
 * Returns null when there is no usable age: missing/invalid `generatedAt`, or
 * future-dated (clock skew) — both treated as unusable rather than "0 days",
 * matching the original resolvers' behavior.
 *
 * @param {string|undefined} generatedAt - A report's ISO generatedAt.
 * @param {number} now - Injectable clock (ms since epoch).
 * @returns {number|null} Whole days old, or null when unusable.
 */
function computeAgeDays(generatedAt, now) {
  if (!generatedAt) return null;
  const generatedMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(generatedMs)) return null;
  const ageMs = now - generatedMs;
  if (ageMs < 0) return null; // future-dated → treat as unusable rather than "0 days"
  return Math.floor(ageMs / 86400000);
}

/**
 * Deterministic freshness gate + field selection over a durable roadmap report,
 * for injection into the next-run context (LIN-742). Returns a compact, dated
 * narrative payload, or null when there is nothing usable to inject — so the
 * caller degrades to silent omission.
 *
 * Returns null when: no report, no/invalid `generatedAt`, future-dated, older
 * than `maxAgeDays`, or no usable narrative prose. Prefers the `digest` (the
 * at-a-glance synthesis); falls back to `trajectory` when no digest exists. Only
 * narrative-only fields are used — velocity / cycle-time / delivery-health are
 * already in the deterministic context, so we don't restate them.
 *
 * @param {Object|null} report - A ReportRecord from reportHistoryStore.getLatest().
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=ROADMAP_REPORT_MAX_AGE_DAYS]
 * @param {number} [opts.now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {{ text: string, ageDays: number }|null}
 */
export function resolveRoadmapNarrative(report, { maxAgeDays = ROADMAP_REPORT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  if (!report || !report.generatedAt) return null;
  const ageDays = computeAgeDays(report.generatedAt, now);
  if (ageDays === null) return null;
  if (ageDays > maxAgeDays) return null; // stale → omit silently

  const narrative = report.narrative && typeof report.narrative === 'object' ? report.narrative : {};
  const digest = typeof narrative.digest === 'string' ? narrative.digest.trim() : '';
  const trajectory = typeof narrative.trajectory === 'string' ? narrative.trajectory.trim() : '';
  const text = (digest || trajectory).slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
  if (!text) return null; // a report with no narrative prose → nothing to inject

  return { text, ageDays };
}

/**
 * Deterministic north-star signal for the next-run context (LIN-779). The chooser
 * decides *what is important*, so it must see the importance signal — the workspace's
 * live north star — not just delivery state. Two sources, both already available to
 * the caller (nothing new is generated here):
 *
 *   1. The LIVE north-star text (the session preference set in workspace-api.js). It
 *      has NO age — it is always current — so it is returned unconditionally whenever
 *      non-empty. This is the intent signal the chooser is blind to today.
 *   2. The latest `northStarReading` (alignment classification) + `gap` from the
 *      already-fetched durable roadmap report. These ARE age-bearing (they were scored
 *      against the north star at report time), so they are folded in ONLY when the
 *      report is fresh, reusing the same `ROADMAP_REPORT_MAX_AGE_DAYS` gate as the
 *      roadmap narrative — a stale reading scored against possibly-changed intent must
 *      not be shown as current.
 *
 * Deliberately distinct from `resolveRoadmapNarrative`: that reads `digest`/`trajectory`
 * (delivery/trajectory colour) and EXCLUDES the north-star fields, which is exactly why
 * the LIN-742 digest echo cannot carry alignment. This resolver owns intent.
 *
 * @param {string} northStar - The live workspace north-star text ('' when none).
 * @param {Object|null} report - A ReportRecord from reportHistoryStore.getLatest().
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=ROADMAP_REPORT_MAX_AGE_DAYS]
 * @param {number} [opts.now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {{ northStar: string, reading: string, gap: string, ageDays: number|null }|null}
 *   null when there is no live north star (the no-north-star path stays unchanged).
 *   `reading`/`gap` are '' and `ageDays` is null when there is no fresh report to fold in.
 */
export function resolveNorthStarSignal(northStar, report, { maxAgeDays = ROADMAP_REPORT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const text = typeof northStar === 'string' ? northStar.trim() : '';
  if (!text) return null; // no live north star → nothing to add, path unchanged

  let reading = '';
  let gap = '';
  let ageDays = null;

  // Fold in the latest alignment reading/gap ONLY when the report is fresh — same
  // freshness contract as resolveRoadmapNarrative so a stale reading can't masquerade
  // as current intent alignment.
  if (report && report.generatedAt) {
    const age = computeAgeDays(report.generatedAt, now);
    if (age !== null && age <= maxAgeDays) {
      const narrative = report.narrative && typeof report.narrative === 'object' ? report.narrative : {};
      const r = typeof narrative.northStarReading === 'string' ? narrative.northStarReading.trim() : '';
      const g = typeof narrative.gap === 'string' ? narrative.gap.trim() : '';
      if (r || g) {
        reading = r.slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
        gap = g.slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
        ageDays = age;
      }
    }
  }

  return { northStar: text, reading, gap, ageDays };
}

/**
 * Freshness classification of a durable roadmap report, independent of any
 * narrative content (LIN-1810). `resolveNorthStarSignal`'s `ageDays` is `null`
 * for four distinct causes (no report / stale report / future-dated report /
 * fresh report whose narrative never scored alignment) that a consumer cannot
 * tell apart from the resolver's output alone. This gives a proxy route (or any
 * caller) the report-level discriminator directly, sharing `computeAgeDays` with
 * both resolvers above so it cannot apply a second interpretation of the gate.
 *
 * @param {Object|null} report - A ReportRecord from reportHistoryStore.getLatest().
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=ROADMAP_REPORT_MAX_AGE_DAYS]
 * @param {number} [opts.now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {'absent'|'stale'|'fresh'} 'absent' when there is no report, no
 *   `generatedAt`, or an unparseable `generatedAt` (no trustworthy timestamp to
 *   judge at all); 'stale' when the timestamp IS usable but fails the gate —
 *   older than `maxAgeDays`, or future-dated (clock skew); 'fresh' otherwise.
 *   Says nothing about whether the report's narrative is populated.
 */
export function classifyReportFreshness(report, { maxAgeDays = ROADMAP_REPORT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  if (!report || !report.generatedAt) return 'absent';
  if (!Number.isFinite(new Date(report.generatedAt).getTime())) return 'absent';
  const ageDays = computeAgeDays(report.generatedAt, now);
  if (ageDays === null) return 'stale'; // future-dated (clock skew) — a report exists but is unusable
  return ageDays <= maxAgeDays ? 'fresh' : 'stale';
}
