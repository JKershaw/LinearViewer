/**
 * Workspace preferences storage module.
 * Stores workspace-level preferences in MongoDB, keyed by Linear workspace urlKey.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Unlike user preferences (per-user, cross-device), workspace preferences are
 * shared across every user connected to the same Linear organization, so
 * settings like the chosen AI model apply uniformly to UI and proxy traffic.
 *
 * Schema:
 * {
 *   _id: string,           // Linear workspace urlKey (primary key)
 *   preferences: Object,   // Workspace preferences object (e.g. { modelId })
 *   createdAt: Date,       // First created timestamp
 *   updatedAt: Date        // Last updated timestamp
 * }
 *
 * ## Ownership (LIN-1331, Phase E)
 *
 * Rule: a setting shared by everyone in the workspace is **workspace-owned**
 * (belongs here); a setting that follows the person wherever they go is
 * **account-owned** (belongs in user-preferences.js instead, see the ownership
 * block there).
 *
 * Per-setting classification:
 * - `modelId` — workspace-owned; the shared AI model, applied uniformly to UI
 *   and proxy traffic (LIN-283).
 * - `aiModelOverrides.byKind` — workspace-owned; shared per-operation model
 *   overrides.
 * - `features` (this store's set) — workspace-owned, **per-workspace** flags,
 *   read exclusively through `getWorkspaceFeatures`/`isWorkspaceFeatureEnabled`
 *   and never from session state. This is a deliberate, documented duality
 *   with the separate per-user `features` set in user-preferences.js (see
 *   `lib/feature-defaults.js:7-16`) — do **not** merge them; collapsing the
 *   two sets is LIN-282's job, not this store's.
 * - `dispatchDefaults` — workspace-owned; shared default dispatch model/harness.
 *
 * NO-PROVIDER-KEY INVARIANT: this store never persists a personal provider
 * connection, by design — such a connection follows the account unless
 * explicitly workspace-scoped, and none of the settings above are. The
 * account owns that connection (see the ownership block in
 * user-preferences.js); this store only *consumes* it, via the account-keyed
 * resolver `getWorkspaceOpenRouterKey` (`lib/openrouter-key-resolver.js`) —
 * never by storing a copy here. The `openrouter` references in this file
 * (`resolveFreeTierModel`, `OPENROUTER_FREE_TIER_MODEL`) are a free-tier
 * **model id**, not a personal connection, and do not weaken this invariant.
 * Structurally pinned by a field-name guard test under `tests/unit/`
 * (zero matches expected).
 */

import { DEFAULT_MODEL, resolveFreeTierModel } from './openrouter.js';
import { WORKSPACE_FEATURE_DEFAULTS, isValidWorkspaceFeatureKey } from './feature-defaults.js';
import { DISPATCH_DEFAULT_KINDS } from './prompt-templates.js';

/**
 * Workspace preferences store for persisting workspace-scoped settings.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class WorkspacePreferencesStore {
  /**
   * Creates a new workspace preferences store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing preferences
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Retrieves workspace preferences by urlKey.
   * Returns an empty object if no preferences exist for the workspace.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @returns {Promise<Object>} Workspace preferences object (empty if not found)
   */
  async getWorkspacePreferences(urlKey) {
    if (!urlKey) {
      console.warn('getWorkspacePreferences called without urlKey');
      return {};
    }

    try {
      const doc = await this.collection.findOne({ _id: urlKey });
      return doc?.preferences || {};
    } catch (err) {
      console.error('Error fetching workspace preferences:', err);
      return {};
    }
  }

  /**
   * Saves workspace preferences for a urlKey.
   * Uses upsert to create new document or update existing one.
   * Automatically manages createdAt and updatedAt timestamps.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @param {Object} preferences - Preferences object to save
   * @returns {Promise<boolean>} True if save succeeded, false otherwise
   */
  async saveWorkspacePreferences(urlKey, preferences) {
    if (!urlKey) {
      console.warn('saveWorkspacePreferences called without urlKey');
      return false;
    }

    try {
      const now = new Date();
      await this.collection.updateOne(
        { _id: urlKey },
        {
          $set: {
            preferences,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error saving workspace preferences:', err);
      return false;
    }
  }

  /**
   * Deletes workspace preferences for a urlKey.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @returns {Promise<boolean>} True if delete succeeded, false otherwise
   */
  async deleteWorkspacePreferences(urlKey) {
    if (!urlKey) {
      console.warn('deleteWorkspacePreferences called without urlKey');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting workspace preferences:', err);
      return false;
    }
  }
}

/**
 * Resolves the AI model for a workspace. This is the single source of truth
 * for model selection — every LLM call site (UI and proxy) should use it.
 *
 * Free-tier requests must never bill an arbitrary workspace-preferred model
 * against the operator's shared free-tier key (LIN-513). When `forceDefault`
 * is truthy, this returns the free-tier model immediately, before any prefs
 * lookup — so the clamp lives here, in one place, and every billed call site
 * just threads its already-computed `isFreeTier` flag through. Non-free-tier
 * callers omit the flag and keep honoring the workspace preference.
 *
 * The clamped-to value is resolveFreeTierModel() (LIN-1333): DEFAULT_MODEL
 * unless the operator set a curated OPENROUTER_FREE_TIER_MODEL. Only that value
 * is configurable — the precedence above is unchanged, so free tier still
 * ignores both the workspace preference and any per-request override.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {WorkspacePreferencesStore} options.workspacePreferencesStore - The store
 * @param {boolean} [options.forceDefault] - When true, clamp to the free-tier model
 *   regardless of stored workspace preference (free-tier billing guard)
 * @returns {Promise<string>} The chosen model ID, or DEFAULT_MODEL if unset
 */
export async function resolveWorkspaceModel({ urlKey, workspacePreferencesStore, forceDefault = false }) {
  // Free tier clamps to its own configured model; a missing urlKey/store is NOT
  // free tier — it just can't resolve a preference, so it keeps DEFAULT_MODEL.
  if (forceDefault) {
    return resolveFreeTierModel();
  }
  if (!urlKey || !workspacePreferencesStore) {
    return DEFAULT_MODEL;
  }
  const prefs = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
  return prefs.modelId || DEFAULT_MODEL;
}

// =============================================================================
// Per-operation AI model overrides (LIN-1145)
//
// Workspace-scoped per-operation model overrides live under
// preferences.aiModelOverrides on this same store, shaped as:
//   { byKind: { recommend: { model }, recap: { model }, ... } }
// Each of the 6 defined AI operations resolves its model via
// byKind[op].model ?? modelId ?? DEFAULT_MODEL. The free-tier clamp still
// forces DEFAULT_MODEL for all operations when applicable. Workspaces
// without aiModelOverrides continue working identically.
// =============================================================================

/**
 * The set of in-workspace AI operations that can carry per-operation model
 * overrides. Scoped to the 6 v1 kinds; experimental operations and the
 * trivial `feedback-title` call are deliberately excluded.
 */
export const AI_OPERATION_KINDS = ['recommend', 'recap', 'brief', 'run-summary', 'session-summary', 'next-run'];

/**
 * Resolves the effective AI model for a specific workspace operation.
 * Per-operation override takes precedence over the workspace global default
 * (prefs.modelId), which in turn falls back to DEFAULT_MODEL.
 *
 * Precedence: byKind[opKind].model ?? modelId ?? DEFAULT_MODEL.
 * forceDefault clamps every operation to the free-tier model (billing guard) —
 * resolveFreeTierModel(), i.e. DEFAULT_MODEL unless the operator set a curated
 * OPENROUTER_FREE_TIER_MODEL (LIN-1333).
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {WorkspacePreferencesStore} options.workspacePreferencesStore - The store
 * @param {string} options.opKind - The operation kind (one of AI_OPERATION_KINDS)
 * @param {boolean} [options.forceDefault] - When true, clamp to the free-tier model
 *   regardless of stored workspace preference (free-tier billing guard)
 * @returns {Promise<string>} The chosen model ID, or DEFAULT_MODEL if unset
 */
export async function resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind, forceDefault = false }) {
  // Free tier clamps to its own configured model; a missing urlKey/store is NOT
  // free tier — it just can't resolve a preference, so it keeps DEFAULT_MODEL.
  if (forceDefault) {
    return resolveFreeTierModel();
  }
  if (!urlKey || !workspacePreferencesStore) {
    return DEFAULT_MODEL;
  }
  const prefs = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
  const overrides = prefs.aiModelOverrides?.byKind || {};
  return overrides[opKind]?.model || prefs.modelId || DEFAULT_MODEL;
}

// =============================================================================
// Workspace feature toggles
//
// Workspace-scoped feature flags live under preferences.features on this same
// store. They are read exclusively through the helpers below and must never be
// resolved from session state or the per-user FEATURES set — that isolation is
// the whole point of the workspace-features path. Defaults come from
// WORKSPACE_FEATURE_DEFAULTS in lib/feature-defaults.js.
// =============================================================================

/**
 * Resolves the merged workspace feature flags for a workspace: the defaults
 * overlaid with any saved per-workspace overrides. Unknown keys in the stored
 * override are ignored so the returned shape always matches the defaults.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {WorkspacePreferencesStore} options.store - The workspace preferences store
 * @returns {Promise<Object>} Feature flags with every workspace key present
 */
export async function getWorkspaceFeatures({ urlKey, store }) {
  if (!urlKey || !store) {
    return { ...WORKSPACE_FEATURE_DEFAULTS };
  }
  const prefs = await store.getWorkspacePreferences(urlKey);
  const overrides = prefs.features || {};
  return {
    ...WORKSPACE_FEATURE_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => isValidWorkspaceFeatureKey(key))
    )
  };
}

/**
 * Reader for a single workspace feature flag. Consults WorkspacePreferencesStore
 * via `store`, falling back to WORKSPACE_FEATURE_DEFAULTS when no override is set.
 * Never reads from session.features or any per-user state.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {string} options.featureKey - The workspace feature key (e.g. 'periodicals')
 * @param {WorkspacePreferencesStore} options.store - The workspace preferences store
 * @returns {Promise<boolean>} True if the feature is enabled for the workspace
 */
export async function isWorkspaceFeatureEnabled({ urlKey, featureKey, store }) {
  const features = await getWorkspaceFeatures({ urlKey, store });
  return features[featureKey] === true;
}

/**
 * Writer for a single workspace feature flag. Reads existing preferences,
 * merges the new flag into preferences.features (preserving every other
 * preference key and every other feature flag), and saves. Mirrors the
 * read-modify-write the model handler does for `modelId`.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {string} options.featureKey - The workspace feature key to set
 * @param {boolean} options.enabled - Desired state
 * @param {WorkspacePreferencesStore} options.store - The workspace preferences store
 * @returns {Promise<boolean>} True if the save succeeded
 */
export async function setWorkspaceFeature({ urlKey, featureKey, enabled, store }) {
  if (!urlKey || !store) {
    return false;
  }
  const existingPrefs = await store.getWorkspacePreferences(urlKey);
  const existingFeatures = existingPrefs.features || {};
  return store.saveWorkspacePreferences(urlKey, {
    ...existingPrefs,
    features: {
      ...existingFeatures,
      [featureKey]: enabled === true
    }
  });
}

// =============================================================================
// Dispatch model/harness defaults (LIN-1094)
//
// Workspace-scoped defaults for the dispatch `model`/`harness` fields live
// under preferences.dispatchDefaults on this same store, shaped as:
//   { model, harness, byKind: { <DISPATCH_DEFAULT_KINDS key>: { model, harness } } }
// Both fields stay opaque strings (no registry/validation), matching the
// dispatch item's own model/harness fields. `byKind` is scoped to
// DISPATCH_DEFAULT_KINDS — the PROMPT_TEMPLATES step-kinds plus `autopilot`
// (LIN-1278, a first-class dispatch kind users configure a default for);
// defer/periodical/custom pass-through kinds are not user-configurable "types"
// and never look up a per-kind override. Writing dispatchDefaults uses the plain read-merge-
// write already used for modelId/features above (no dedicated writer here —
// the settings UI that writes this key lands separately in LIN-1095).
// =============================================================================

/**
 * Resolves the effective dispatch model/harness defaults for a workspace and
 * prompt `kind`, applying precedence: per-kind override, then workspace-wide
 * default, then `null`. This is the single read seam the routes/dispatch.js
 * POST handler uses to fill in blank incoming model/harness values — no other
 * call site should re-implement this precedence.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {string} [options.kind] - The dispatch item's prompt kind
 * @param {WorkspacePreferencesStore} options.store - The workspace preferences store
 * @returns {Promise<{model: string|null, harness: string|null}>}
 */
export async function resolveDispatchDefaults({ urlKey, kind, store }) {
  if (!urlKey || !store) {
    return { model: null, harness: null };
  }
  const prefs = await store.getWorkspacePreferences(urlKey);
  const defaults = prefs.dispatchDefaults || {};
  const byKind = (kind && DISPATCH_DEFAULT_KINDS.includes(kind) && defaults.byKind?.[kind]) || {};
  return {
    model: byKind.model ?? defaults.model ?? null,
    harness: byKind.harness ?? defaults.harness ?? null
  };
}
