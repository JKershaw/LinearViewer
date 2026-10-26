/**
 * Run controls, derived from facts (LIN-3849, part of LIN-3846).
 *
 * Replaces the per-user `dispatch` and `proxy` switches. Nobody should have to
 * find a setting to make Harbour work, so the two bits the UI needs are read
 * from what the server already knows:
 *
 *   runControls = the viewer is the workspace owner AND the workspace has a way
 *                 to run (a live runner key or a live queue token)
 *   runSetup    = the viewer is the owner and there is NO way to run yet: the
 *                 owner-only "set up ›" rung that leads to the Runner page,
 *                 where the first key is minted. `runControls` alone is false
 *                 for a member and for a keyless owner alike, so it cannot tell
 *                 the two apart.
 *
 * Key tools (the Proxy page, making keys, +proxy, Autopilot) no longer have a
 * flag at all: they are always on, and the server's owner checks for
 * grant-carrying keys are unchanged.
 *
 * Both token stores' `listTokens` swallow errors and return `[]`, and neither
 * filters expiry (rows linger until the hourly cleanup). So an outage reads as
 * "no key" (closed) and the expiry check lives here, not in the stores.
 * Revoked means the row is deleted, so "row exists" is the revoked check.
 */

import { readOwnerSeamStatus } from './workspace-owner.js';
import { getFeatureFlags } from './feature-defaults.js';
import { isLiveKey } from './settings-keys.js';

const NONE = Object.freeze({ runControls: false, runSetup: false });

/**
 * A runner key: a ProxyTokenStore row whose grants include `take`, not yet
 * consumed, and unexpired. The `driver` / `agent` copies carry `['dispatch']`
 * only, so they never count. An unexchanged runner bootstrap (take, <=1h)
 * counts as live; once it is exchanged it is consumed and the working token it
 * minted (grants carried, singleUse false) is what counts.
 *
 * @param {Array} rows - ProxyTokenStore.listTokens(urlKey)
 * @param {number} [now]
 * @returns {boolean}
 */
export function hasLiveRunnerKey(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) =>
    row && Array.isArray(row.grants) && row.grants.includes('take') && isLiveKey(row, now));
}

/**
 * A queue token: any DispatchTokenStore row that has not expired. `expiresAt`
 * null is a legacy row with no expiry.
 *
 * @param {Array} rows - DispatchTokenStore.listTokens(urlKey)
 * @param {number} [now]
 * @returns {boolean}
 */
export function hasLiveQueueToken(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => isLiveKey(row, now));
}

/**
 * @param {Object} deps
 * @param {function({workspaceId: string, accountId: string}): *} deps.ownerCheck - the owner seam
 * @param {{listTokens: function(string): Promise<Array>}} deps.proxyTokenStore
 * @param {{listTokens: function(string): Promise<Array>}} deps.dispatchTokenStore
 * @param {function(): number} [deps.now]
 * @returns {function({workspace: {id: string, urlKey: string}, accountId: ?string}): Promise<{runControls: boolean, runSetup: boolean}>}
 */
export function createRunControlsResolver({ ownerCheck, proxyTokenStore, dispatchTokenStore, now = Date.now }) {
  return async function resolveRunControls({ workspace, accountId } = {}) {
    if (!workspace?.id || !workspace?.urlKey || !accountId) return NONE;
    const { status } = await readOwnerSeamStatus(() => ownerCheck({ workspaceId: workspace.id, accountId }));
    // Not the owner (or owner unknown / ownerless / check unavailable): fail
    // closed, and do not touch the token stores at all.
    if (status !== 'owner') return NONE;
    let live = false;
    try {
      const [proxyRows, queueRows] = await Promise.all([
        proxyTokenStore.listTokens(workspace.urlKey),
        dispatchTokenStore.listTokens(workspace.urlKey)
      ]);
      const t = now();
      live = hasLiveRunnerKey(proxyRows, t) || hasLiveQueueToken(queueRows, t);
    } catch {
      // Both stores catch and return [] today, so this is belt and braces and
      // not outage evidence; a throw still closes the controls.
      live = false;
    }
    return live ? { runControls: true, runSetup: false } : { runControls: false, runSetup: true };
  };
}

// Late-bound, like the proxy token store's owner-check seam: server.js builds the stores
// after the route modules are imported. Unset (a unit test that never wires it)
// fails closed.
let resolver = null;
const memo = new WeakMap();

export function setRunControlsResolver(fn) {
  resolver = typeof fn === 'function' ? fn : null;
}

/**
 * The resolver alone, for a path with no `req` (the post-401 re-render only has
 * `workspace` and `session`). No memo.
 */
export async function resolveRunControls({ workspace, accountId }) {
  if (!resolver) return NONE;
  try {
    return await resolver({ workspace, accountId: accountId || null });
  } catch {
    return NONE;
  }
}

/**
 * Feature flags for a rendered page: the stored per-user flags plus the two
 * derived bits. Memoised per request (never per workspace, or a member would
 * inherit an owner's `true`), with no cross-request cache so a revoked key
 * removes the controls on the next page load.
 *
 * @param {Object} req - needs `req.workspace` and `req.session`
 * @returns {Promise<Object>}
 */
export async function requestFeatureFlags(req) {
  const base = getFeatureFlags(req.session);
  let pending = memo.get(req);
  if (!pending) {
    pending = resolveRunControls({ workspace: req.workspace, accountId: req.session?.accountId });
    memo.set(req, pending);
  }
  const controls = await pending;
  return { ...base, ...controls, liveConsole: liveConsoleOn(req.session?.features?.liveConsole, controls.runControls) };
}

/**
 * LIN-3977: whether Live Console is on for this user. The stored flag is sparse
 * (only a toggled key is written), so "unset" and "off" are told apart here, from
 * the RAW stored value: a stored `false` opts out, a stored `true` opts in, and
 * with no stored flag an owner with a live runner gets it. Everyone else keeps
 * today's behaviour. One helper for the page, the events endpoint and the Home
 * re-render, so the three cannot disagree.
 *
 * @param {boolean|undefined} stored - `session.features.liveConsole`, raw
 * @param {boolean} runControls - the owner-with-runner bit
 * @returns {boolean}
 */
export function liveConsoleOn(stored, runControls) {
  if (stored === false) return false;
  return stored === true || runControls === true;
}
