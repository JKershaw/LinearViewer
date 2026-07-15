// openrouter-key-resolver.js: resolves a proxy token creator's OpenRouter API key
// (LIN-1352). The key is read directly from the durable per-user preferences store
// (LIN-498), keyed by the token creator's linearUserId — the single source of truth.
// This replaced a DB-wide scan of all sessions plus a 30s cache, which became stale
// after session.regenerate() (the proxy would find the new, keyless session and
// report "AI not configured"). Only the creator's own key is returned, so one
// user's proxy token can't consume another user's OpenRouter quota.
//
// userPreferencesStore is an injected parameter rather than a module-scope binding
// so callers — notably D1b's quota-isolation test — can supply a real or fake store
// directly instead of stubbing/reimplementing this resolver.
export async function getWorkspaceOpenRouterKey(userPreferencesStore, creatorId) {
  // Without a creator user ID, we can't safely resolve a personal OAuth key
  if (!creatorId) {
    return null;
  }

  try {
    return await userPreferencesStore.getOpenRouterApiKey(creatorId);
  } catch (err) {
    console.error('Error looking up workspace OpenRouter key:', err);
    return null;
  }
}
