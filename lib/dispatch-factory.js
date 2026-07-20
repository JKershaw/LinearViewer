/**
 * Shared dispatch-item creation factory (LIN-1139).
 *
 * Every external dispatch entry point — the two main handlers, the four proxy
 * server-generated paths, the two feedback follow-ups, the collective fan-out,
 * and the chat-tools follow-up — used to hand-roll the SAME sequence: resolve
 * the prompt kind, fill blank model/harness from the workspace's dispatch
 * defaults, interpose the default harness, build the item field set, and call
 * `dispatchQueueStore.addItem`. Nine copies drifted (LIN-1159's claude-code
 * interpose reached only four of them; feedback/session/collective did not). This
 * factory is the ONE seam that owns that resolution, so adding a new dispatch
 * path is a single call and no path can silently diverge on inheritance again.
 *
 * It deliberately owns only RESOLUTION + construction, never prompt authoring or
 * auth plumbing. The ordering invariant the proxy-context paths depend on —
 * harness resolved BEFORE the prompt is finalized (because `attachProxyContext`
 * gates its MCP-token-vs-prose branch on the resolved harness), and the prompt
 * finalized BEFORE `addItem` — is preserved through the `finalizePrompt(harness)`
 * callback: the factory resolves the harness, hands it to the caller's
 * `finalizePrompt`, and stores back the returned `{ prompt, bootstrapToken }`.
 * Prompt construction + bootstrap minting therefore stay OUTSIDE the factory
 * (per the parent LIN-1135 constraint) while resolution stays INSIDE it.
 *
 * NOT for the store-internal `addItem` uses (cascade abort expansion, wake
 * follow-ups): those are below this layer and emit minimal, model/harness-free
 * items by design — routing them through a factory that itself calls the store
 * would invert the dependency.
 */

import { deriveDispatchKind } from './prompt-templates.js';
import { resolveDispatchDefaults, resolveRoutingFromConfig } from './workspace-preferences.js';
import { applyDefaultDispatchHarness } from './proxy-preamble.js';

/**
 * Resolve + build a dispatch item and enqueue it via the store.
 *
 * @param {Object} params
 * @param {Object} params.store - The dispatch queue store (must expose `addItem`).
 * @param {string} params.urlKey - Workspace url key the item is scoped to.
 * @param {Object} [params.workspacePreferencesStore] - Workspace preferences store;
 *   when present, blank `model`/`harness` are filled from `dispatchDefaults`
 *   (per-kind override → workspace-wide → null). Absent → no inheritance (the
 *   pre-LIN-1094 null passthrough).
 * @param {Object} [params.dispatchPresetsStore] - Dispatch presets store (LIN-1390);
 *   when present with `presetId`, the selected preset's `config` is resolved
 *   (byKind → top-level → null, via `resolveRoutingFromConfig`) and takes
 *   precedence over both inherited-anchor and workspace-default routing.
 * @param {string} [params.presetId] - Selected preset id. Unknown/invalid ids
 *   (the route layer validates and rejects these before calling in) resolve to
 *   "no preset" here rather than throwing.
 * @param {string} [params.kind] - Explicit prompt kind; when omitted it is
 *   derived from `fields.promptName` (falling back to the store's 'custom').
 * @param {string} [params.model] - Incoming execution model (may be blank/absent).
 * @param {string} [params.harness] - Incoming execution harness (may be blank/absent).
 * @param {boolean} [params.applyDefaultHarness=true] - Interpose `claude-code`
 *   (LIN-1159) when the resolved harness is still blank. The opt-out exists so a
 *   caller can be exempted from the default without forking the field-build path,
 *   but the parent's convergence goal (LIN-1135) is uniform application.
 * @param {string} [params.prompt] - Base prompt for paths that don't finalize
 *   (collective, chat-tools). Ignored when `finalizePrompt` is supplied.
 * @param {(harness: string|null) => (Promise<{prompt: string, bootstrapToken?: string|null}>|{prompt: string, bootstrapToken?: string|null})} [params.finalizePrompt]
 *   Called with the RESOLVED harness to produce the final prompt (and, for the
 *   claude-code MCP branch, a `bootstrapToken` to carry as a structured field).
 *   This is where `attachProxyContext` runs, preserving the harness→append→addItem
 *   ordering centrally.
 * @param {Object} [params.fields] - The remaining item fields (issue*, target,
 *   dispatchedBy, repo, force, abort*, cascade, sessionId, waitForFollowUps,
 *   queueIfBusy, subscription, followUpTo, promptName). The store null-coerces
 *   every optional field, so passing the union of what any caller needs is safe.
 * @returns {Promise<Object>} The created dispatch item (from `store.addItem`).
 */
export async function createDispatchItem({
  store,
  urlKey,
  workspacePreferencesStore = null,
  dispatchPresetsStore = null,
  presetId = null,
  kind = undefined,
  model,
  harness,
  applyDefaultHarness = true,
  prompt,
  finalizePrompt = null,
  fields = {}
} = {}) {
  if (!store || typeof store.addItem !== 'function') {
    throw new Error('createDispatchItem requires a dispatch store with addItem');
  }
  if (!urlKey) {
    throw new Error('createDispatchItem requires a urlKey');
  }

  // 1. Resolve the effective kind — used both to key dispatchDefaults/preset
  //    resolution and as the stored `kind`, so both agree (mirroring the two
  //    main handlers).
  const effectiveKind = kind || deriveDispatchKind(fields.promptName);

  // 2. Look up the anchor ONCE — used below for BOTH issue-identity inheritance
  //    (LIN-1292) and preset-config inheritance (LIN-1390). `getItemStatus`
  //    resolves across the active queue AND history (`_formatItem` /
  //    `_formatHistoryItem`), which matters here: by the time a descendant
  //    dispatches, the kickoff anchor has usually already been taken and
  //    archived, so a read that only checked the active queue would silently
  //    miss the anchor's `presetConfig` on every real run.
  const anchor = (fields.followUpTo && typeof store.getItemStatus === 'function')
    ? await Promise.resolve(store.getItemStatus(urlKey, fields.followUpTo)).catch(() => null)
    : null;

  // 3. Resolve the selected preset (LIN-1390 S1/S3). An unknown/invalid
  //    `presetId` (the route layer validates and rejects these before calling
  //    in) resolves to "no preset" here rather than throwing, so this seam
  //    degrades gracefully if it's ever reached with a stale id.
  const selectedPreset = (dispatchPresetsStore && presetId)
    ? await dispatchPresetsStore.get(urlKey, presetId).catch(() => null)
    : null;

  // 4. Resolve model/harness with the unified per-field precedence (LIN-1390):
  //    explicit incoming > selected preset (byKind) > inherited anchor
  //    presetConfig (byKind) > workspace dispatchDefaults (byKind → workspace-
  //    wide) > null. Each source's byKind/top-level blend is handled by
  //    `resolveRoutingFromConfig`; sources are combined field-by-field so e.g.
  //    a preset with only `model` set still lets harness fall through to the
  //    next source. Anchor inheritance is gated on an EXPLICIT preset marker
  //    (`anchor.presetConfig` truthy) — no marker means byte-identical to
  //    pre-LIN-1390 behavior.
  let resolvedModel = model || null;
  let resolvedHarness = harness || null;

  if ((!resolvedModel || !resolvedHarness) && selectedPreset) {
    const fromPreset = resolveRoutingFromConfig(selectedPreset.config, effectiveKind);
    if (!resolvedModel) resolvedModel = fromPreset.model;
    if (!resolvedHarness) resolvedHarness = fromPreset.harness;
  }

  if ((!resolvedModel || !resolvedHarness) && anchor?.presetConfig) {
    const fromAnchor = resolveRoutingFromConfig(anchor.presetConfig, effectiveKind);
    if (!resolvedModel) resolvedModel = fromAnchor.model;
    if (!resolvedHarness) resolvedHarness = fromAnchor.harness;
  }

  // 4.5. Inherit the anchor's own resolved harness (LIN-1431 S3) — a follow-up
  //   must run on the harness of the session it resumes, not re-resolve
  //   independently. Below explicit/preset/anchor.presetConfig (all of which
  //   still win); above workspace dispatchDefaults, since a workspace default
  //   outranking the anchor is exactly the bug (a resume silently landing on a
  //   different runner). `anchor.harness` is `doc.harness || null`, so a
  //   blank-harness anchor inherits `null` — indistinguishable from not
  //   inheriting at all, which keeps the LIN-1111 blank-harness escape hatch
  //   intact all the way through the `applyDefaultHarness` interpose below.
  if (!resolvedHarness && anchor?.harness) resolvedHarness = anchor.harness;

  if ((!resolvedModel || !resolvedHarness) && workspacePreferencesStore) {
    const defaults = await resolveDispatchDefaults({
      urlKey,
      kind: effectiveKind,
      store: workspacePreferencesStore
    });
    if (!resolvedModel) resolvedModel = defaults.model;
    if (!resolvedHarness) resolvedHarness = defaults.harness;
  }

  // 5. Interpose the default harness (LIN-1159) unless the caller opts out.
  if (applyDefaultHarness) {
    resolvedHarness = applyDefaultDispatchHarness(resolvedHarness);
  }

  // 5.5. Inherit the anchor's issue identity for a follow-up that didn't supply
  //    its own (LIN-1292). The human reply-box producer (public/session.js) posts
  //    only { prompt, followUpTo, target } — no issue* fields — and BOTH session
  //    reconstruction paths (`_buildLoops`'s malformed-row guard and the
  //    `_buildSessions` followUpTo stitch pass) need a real `issueIdentifier` to
  //    build a loop at all; an issue-less follow-up is dropped everywhere as
  //    malformed, not merely left unstitched. Inheriting here — the one seam every
  //    followUpTo dispatch path already resolves through — keeps the reply visible
  //    without a producer change (a ticket constraint: the render stitch must work
  //    with the existing public/session.js behavior).
  let inheritedIssueFields = null;
  if (fields.followUpTo && !fields.issueIdentifier && anchor?.issueIdentifier) {
    inheritedIssueFields = {
      issueId: fields.issueId || anchor.issueId || null,
      issueIdentifier: anchor.issueIdentifier,
      issueTitle: fields.issueTitle || anchor.issueTitle || null,
      issueUrl: fields.issueUrl || anchor.issueUrl || null
    };
  }

  // 5.6. Inherit the anchor's durable session-group id (LIN-1341), riding the
  //   SAME anchor lookup from step 2 — no second round-trip. Precedence mirrors
  //   the store's own root-minting rule: the anchor's own group (the common
  //   case, once the anchor itself is stamped) ?? the anchor's `sessionId` (an
  //   autopilot worker anchor predating this ticket, whose own sessionGroupId
  //   hasn't been backfilled) ?? the anchor's own dispatch id (a plain
  //   pre-field root — self-heals the chain from here on: every descendant
  //   from this point forward shares this group id, even though the root
  //   itself stays unstamped). Absent an anchor (aged out of the store's
  //   window), no group id is inherited and the store's own fallback mints a
  //   fresh root group for this dispatch — the un-stamped chain-walk is the
  //   reader's fallback for that case, not this ticket's.
  let inheritedSessionGroupId = null;
  if (anchor) {
    inheritedSessionGroupId = anchor.sessionGroupId || anchor.sessionId || fields.followUpTo;
  }

  // 5.7. Inherit the anchor's per-runner-session lineage anchor (LIN-1468),
  //   riding the SAME anchor lookup from step 2. Mirrors inheritedSessionGroupId
  //   immediately above, with one deliberate difference: NO `anchor.sessionId`
  //   tier. Every sibling worker an autopilot spawns carries the orchestrator's
  //   sessionId, so borrowing that tier here would give all siblings one
  //   identical rootItemId — the sibling-collapse bug LIN-1461 fixed, in a new
  //   field. Precedence: the anchor's own rootItemId (the common case, once the
  //   anchor itself is stamped) ?? the anchor's own dispatch id (a pre-LIN-1468
  //   anchor, self-healing the chain from here on). Absent an anchor, no anchor
  //   is inherited and the store's own two-tier fallback mints a fresh root.
  let inheritedRootItemId = null;
  if (anchor) {
    inheritedRootItemId = anchor.rootItemId || fields.followUpTo;
  }

  // 6. Stamp presetConfig/presetName ONLY on kind:'autopilot' rows (selected OR
  //    inherited — an autopilot's own selection wins over what it inherited),
  //    so a child-autopilot chain carries the config forward transitively
  //    without leaking it onto non-autopilot kinds. The carrier is a FROZEN
  //    snapshot: deep-copy it here so a later edit/delete of the preset (or
  //    mutation of the anchor's own row) can never reach an already-dispatched
  //    item (snapshot-at-dispatch, not live-reference).
  let presetConfig = null;
  let presetName = null;
  if (effectiveKind === 'autopilot') {
    if (selectedPreset) {
      presetConfig = selectedPreset.config;
      presetName = selectedPreset.name || null;
    } else if (anchor?.presetConfig) {
      presetConfig = anchor.presetConfig;
      presetName = anchor.presetName || null;
    }
  }
  if (presetConfig) {
    presetConfig = structuredClone(presetConfig);
  }

  // 7. Finalize the prompt with the RESOLVED harness (the ordering invariant),
  //    then carry back any structured bootstrap token for the claude-code branch.
  let finalPrompt = prompt;
  let bootstrapToken = null;
  if (typeof finalizePrompt === 'function') {
    const finalized = await finalizePrompt(resolvedHarness);
    finalPrompt = finalized?.prompt;
    bootstrapToken = finalized?.bootstrapToken ?? null;
  }

  // 8. Build the full field set and enqueue. The store owns the canonical shape.
  return store.addItem(urlKey, {
    ...fields,
    ...(inheritedIssueFields || {}),
    ...(inheritedSessionGroupId ? { sessionGroupId: inheritedSessionGroupId } : {}),
    ...(inheritedRootItemId ? { rootItemId: inheritedRootItemId } : {}),
    prompt: finalPrompt,
    kind: effectiveKind,
    model: resolvedModel,
    harness: resolvedHarness,
    presetConfig,
    presetName,
    bootstrapToken
  });
}
