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
