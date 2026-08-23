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
 *   sha256 hex of the full doc content, plus its first line (the human-
 *   readable version label, e.g. "North star — v2, the self-funding loop"),
 *   for a consumer to log/display alongside the hash. `{ hash: null, title:
 *   null }` when the doc can't be read (never thrown — the doc's absence
 *   must not take down the endpoint that would report the divergence) — this
 *   branch is exercised in tests only via the `docPath` override, since the
 *   real doc is expected to always exist at HEAD.
 */
export function getNorthStarDocVersion(docPath = NORTH_STAR_DOC_PATH) {
  const isDefaultPath = docPath === NORTH_STAR_DOC_PATH;
  if (isDefaultPath && cachedDocVersion !== null) return cachedDocVersion;
  try {
    const raw = readFileSync(docPath, 'utf-8');
    const title = (raw.split('\n')[0] || '').replace(/^#\s*/, '').trim();
    const hash = createHash('sha256').update(raw).digest('hex');
    const result = { hash, title };
    if (isDefaultPath) cachedDocVersion = result;
    return result;
  } catch (err) {
    console.error(`Failed to read north star doc: ${docPath}`, err.message);
    return { hash: null, title: null };
  }
}
