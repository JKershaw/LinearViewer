/**
 * The model resolvers FROZEN as they were at 6ea1371e (LIN-3853): the "old side" of the
 * witness (tests/unit/model-routing-witness.test.js). Verbatim copies, taken with
 * `git show 6ea1371e:<file>`, of resolveWorkspaceModel, resolveAiOperationModel,
 * resolveRoutingFromConfig and resolveDispatchDefaults (lib/workspace-preferences.js) and the
 * unexported resolveRouting (lib/dispatch-factory.js). Do not edit them to follow the live
 * code: the point is that they do not move. Only constants are imported live.
 */
import { DEFAULT_MODEL, resolveFreeTierModel } from '../../../lib/openrouter.js';
import { DISPATCH_DEFAULT_KINDS } from '../../../lib/prompt-templates.js';
import { applyDefaultDispatchHarness } from '../../../lib/proxy-preamble.js';

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

/**
 * Pure routing resolver (LIN-1390 S2): resolves the effective model/harness
 * for a `config` object (any `{ model, harness, byKind }`-shaped routing
 * config — workspace dispatchDefaults today, a dispatch preset's config
 * later) and a prompt `kind`, applying precedence: per-kind override, then
 * top-level default, then `null`. `byKind[kind]` is honored ONLY when `kind`
 * is one of DISPATCH_DEFAULT_KINDS — an unconfigurable pass-through kind
 * (e.g. `custom`) always falls through to the top-level default, even if a
 * stray `byKind` entry exists for it.
 *
 * Pure and network-free — no store access, so it is reusable for any future
 * routing-config source (e.g. dispatch presets) without threading a store
 * through it.
 *
 * @param {Object} config - `{ model?, harness?, effort?, byKind?: { [kind]: { model?, harness?, effort? } } }`
 * @param {string} [kind] - The dispatch item's prompt kind
 * @returns {{model: string|null, harness: string|null, effort: string|null}}
 */
export function resolveRoutingFromConfig(config, kind, options = {}) {
  const cfg = config || {};
  const byKind = (kind && DISPATCH_DEFAULT_KINDS.includes(kind) && cfg.byKind?.[kind]) || {};

  // Harness resolves first and unchanged — per-kind row, then workspace-wide, then null. It is the
  // key every model-eligibility decision below is made against, which is why it cannot itself depend
  // on the model.
  const harness = byKind.harness ?? cfg.harness ?? null;

  // LIN-1694: model is resolved ROW-ATOMICALLY, not as an independent chain. Each level here is a
  // row (`{model, harness}`); a row SCOPED to a harness other than the one in force may not donate
  // its model. Without this, an explicit `harness: 'claude-code'` on the dispatch still imported the
  // `model` from the workspace's `opencode` row — the live crossed pair that shipped
  // `claude --model deepseek-v4-pro`.
  //
  // `harnessInForce` is supplied by the caller because the winning harness is usually decided ABOVE
  // this config (an explicit dispatch field, a preset, an inherited anchor). Omitted/null disables
  // the eligibility check entirely (`donates()` below always returns true), so a standalone call
  // stays byte-identical to pre-LIN-1694 behavior. That does NOT guarantee the returned pair is
  // self-consistent: `harness` and `model` still blend `byKind`/`cfg` independently per field, so a
  // `byKind` row with a blank harness and a scoped model still donates its model while `harness`
  // comes from the top-level `cfg` row — a pair crossed from two rows of the SAME config (LIN-1694
  // review F2). This function does not close that case; it is closed only by Simple Dispatcher's
  // launch-time refusal, not by anything here.
  //
  // A blank harness on a row means "inherit" (LIN-1111's escape hatch), so such a row is unscoped
  // and always donates. An ineligible row is SKIPPED rather than terminal: the next row down still
  // answers, so a workspace-wide model keeps serving a harness its per-kind row was never scoped to.
  const harnessInForce = options.harnessInForce ?? null;
  const donates = (row) => {
    const scopedTo = row.harness ?? null;
    return !harnessInForce || !scopedTo || scopedTo === harnessInForce;
  };

  let model = null;
  for (const row of [byKind, cfg]) {
    if ((row.model ?? null) === null) continue;
    if (!donates(row)) continue;
    model = row.model;
    break;
  }

  // Effort (LIN-2615): mirrors model's row-atomic resolution exactly — same
  // `donates()` eligibility, same byKind-then-top-level source order. No
  // additional anchor tier here (that stays a dispatch-factory.js-only
  // concept); this function only ever sees the workspace config.
  let effort = null;
  for (const row of [byKind, cfg]) {
    if ((row.effort ?? null) === null) continue;
    if (!donates(row)) continue;
    effort = row.effort;
    break;
  }

  return { model, harness, effort };
}

/**
 * Resolves the effective dispatch model/harness defaults for a workspace and
 * prompt `kind`, applying precedence: per-kind override, then workspace-wide
 * default, then `null`. This is the single read seam the routes/dispatch.js
 * POST handler uses to fill in blank incoming model/harness values — no other
 * call site should re-implement this precedence.
 *
 * A thin read + delegate: fetches the workspace's stored `dispatchDefaults`
 * and hands it to the pure `resolveRoutingFromConfig` resolver above.
 * Behavior is byte-identical to before the S2 extraction.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {string} [options.kind] - The dispatch item's prompt kind
 * @param {WorkspacePreferencesStore} options.store - The workspace preferences store
 * @param {string|null} [options.harnessInForce] - LIN-1694: the harness already settled by a
 *   higher-precedence source, if any. A stored row scoped to a different harness will not donate
 *   its `model`. Null/omitted disables the check (this row is then the harness source itself).
 * @returns {Promise<{model: string|null, harness: string|null, effort: string|null}>}
 */
export async function resolveDispatchDefaults({ urlKey, kind, store, harnessInForce = null }) {
  if (!urlKey || !store) {
    return { model: null, harness: null, effort: null };
  }
  const prefs = await store.getWorkspacePreferences(urlKey);
  return resolveRoutingFromConfig(prefs.dispatchDefaults, kind, { harnessInForce });
}

/**
 * Step 3-5, model / harness / effort, one precedence list per field (LIN-1390):
 * explicit incoming > selected preset (byKind) > inherited anchor `presetConfig`
 * (byKind) > workspace dispatchDefaults (byKind, then workspace-wide) > null.
 * Sources combine field by field, so a preset with only `model` set still lets
 * harness fall through. Anchor inheritance needs an EXPLICIT preset marker
 * (`anchor.presetConfig` truthy); no marker is byte-identical to pre-LIN-1390.
 *
 * The fields are NOT independent chains (LIN-1694). Harness resolves first, then
 * model and effort, and a source row scoped to a harness other than the one now
 * in force is skipped rather than donating its model. The bug this closes: an
 * explicit `harness: 'claude-code'` short-circuited the harness chain while
 * `model` kept falling through to the workspace's `opencode` row, resolving the
 * crossed pair claude-code + `deepseek/deepseek-v4-pro`, which launched as
 * `claude --model deepseek-v4-pro`. Eligibility uses the PRE-interpose harness:
 * the default interpose is a post-resolution default, and letting it decide
 * eligibility would make a blank harness look like an explicit `claude-code`.
 *
 * Harness alone has one extra tier (LIN-1431 S3): the anchor's own resolved
 * harness, below explicit/preset/anchor-preset and above the workspace default.
 * A resume must run on the harness of the session it resumes; a workspace
 * default outranking it is exactly the bug (a resume landing on a different
 * runner). `anchor.harness` is `doc.harness || null`, so a blank-harness anchor
 * inherits nothing, which keeps the LIN-1111 blank-harness escape hatch intact
 * through the default interpose. Model and effort (LIN-2615) have no such tier.
 *
 * The workspace tier is one read for all three fields and is made only if one is
 * still blank. With no harness in force its row can donate fields from different
 * rows of one config (LIN-1694 review F2); with one in force the row must be
 * eligible. Last, the default harness is interposed (LIN-1159) unless the caller
 * opts out.
 */
export async function resolveRouting({
  urlKey, kind, model, harness, effort, preset, anchor, workspacePreferencesStore, applyDefaultHarness
}) {
  const configs = [];
  if (preset) configs.push(preset.config);
  if (anchor?.presetConfig) configs.push(anchor.presetConfig);

  const fromConfigs = (current, field, options) => {
    let value = current;
    for (const config of configs) {
      if (!value) value = resolveRoutingFromConfig(config, kind, options)[field];
    }
    return value;
  };

  let resolvedHarness = fromConfigs(harness || null, 'harness');
  if (!resolvedHarness && anchor?.harness) resolvedHarness = anchor.harness;
  const eligibility = { harnessInForce: resolvedHarness };
  let resolvedModel = fromConfigs(model || null, 'model', eligibility);
  let resolvedEffort = fromConfigs(effort || null, 'effort', eligibility);

  if ((!resolvedModel || !resolvedHarness || !resolvedEffort) && workspacePreferencesStore) {
    const defaults = await resolveDispatchDefaults({
      urlKey,
      kind,
      store: workspacePreferencesStore,
      harnessInForce: resolvedHarness
    });
    if (!resolvedModel) resolvedModel = defaults.model;
    if (!resolvedHarness) resolvedHarness = defaults.harness;
    if (!resolvedEffort) resolvedEffort = defaults.effort;
  }

  if (applyDefaultHarness) resolvedHarness = applyDefaultDispatchHarness(resolvedHarness);
  return { model: resolvedModel, harness: resolvedHarness, effort: resolvedEffort };
}
