/**
 * The one key list (LIN-3846): every key that can get into a workspace, read
 * from both token stores, as rows the Agent access page renders.
 *
 * Pure. The route passes `ProxyTokenStore.listTokens` and
 * `DispatchTokenStore.listTokens` rows plus whether the viewer is the owner.
 *
 * Kinds describe what a key can DO. The one exception is the run-key split (LIN-3890,
 * ruling of 25 Oct): a grant-less row that a run or a prompt made (see isRunKey) is
 * shown as a run key, not as a key a person made. A `dispatch`-only grant is still
 * minted by agent prompts, driver copies and declared launches alike, and no field
 * on the row says which (the same note sits in public/proxy.js). Revoke is today's DELETE route for the row's store, with its owner rules:
 * a key carrying grants (LIN-3409) and every dispatch token (LIN-3398) are
 * owner-only; this module only says so, the routes still enforce it.
 *
 * `hasOwner:false` is the "no owner · re-issue" ownerless key Credential
 * Health also flags.
 */

import { PROMPT_PROXY_LABEL } from './proxy-tokens.js';

const has = (row, grant) => Array.isArray(row.grants) && row.grants.includes(grant);

/**
 * The one liveness predicate (LIN-3890): the count, the runner's last poll and
 * run-controls all read it. A key is live when it is not a consumed bootstrap
 * and its expiry is in the future. `expiresAt` null is a legacy row with no
 * expiry (live); an unparseable expiry is not trusted as live.
 */
export function isLiveKey(row, now = Date.now()) {
  if (!row || row.consumed) return false;
  if (row.expiresAt === null || row.expiresAt === undefined) return true;
  const t = new Date(row.expiresAt).getTime();
  return Number.isFinite(t) && t > now;
}

/**
 * A run key (LIN-3890, the operator's ruling of 25 Oct: "count only keys a person made, and show
 * per-run session keys as one 'Run keys · N' summary row"). A grant-less proxy row that a run or a
 * prompt made, and not a person in Settings: a bootstrap minted per run (`kind: 'bootstrap'`), a
 * working token exchanged from one (`parentTokenId`, lib/proxy-tokens.js), or the +proxy copy's
 * automatic `prompt-proxy` token. Grant-bearing rows are always person-made (the runner, the driver
 * copy, a dispatch key). Stated limit: a `prompt-proxy` label is client-supplied, so a New key named
 * exactly that counts as a run key; the route already gives that label its short TTL.
 */
export function isRunKey(row) {
  if (!row || (Array.isArray(row.grants) && row.grants.length > 0)) return false;
  return row.kind === 'bootstrap' || Boolean(row.parentTokenId) || row.label === PROMPT_PROXY_LABEL;
}

/** A spent grant-bearing bootstrap is hidden: its working token is the live row. */
function isHiddenSpentBootstrap(row) {
  return row.kind === 'bootstrap' && row.consumed && Array.isArray(row.grants) && row.grants.length > 0;
}

function proxyKind(row) {
  if (has(row, 'take')) return { kind: 'Runner key', can: 'Takes queued work and runs it' };
  if (has(row, 'dispatch')) return { kind: 'Can start runs', can: 'Reads, updates and starts runs' };
  if (row.scope === 'readWrite') return { kind: 'Read and update', can: 'Reads and updates tasks' };
  return { kind: 'Read', can: 'Reads tasks' };
}

/**
 * @param {Object} args
 * @param {Array} args.proxyRows - ProxyTokenStore.listTokens(urlKey)
 * @param {Array} args.dispatchRows - DispatchTokenStore.listTokens(urlKey)
 * @param {boolean} args.isOwner
 * @param {string} args.urlKey
 * Only live keys are listed (LIN-3890): an expired or spent row cannot get into
 * the workspace, so it is not counted or shown. `run` marks a per-run key.
 *
 * @returns {Array<{id: string, source: 'proxy'|'dispatch', label: string, kind: string, can: string, expiresAt: ?string, lastUsedAt: ?string, hasOwner: boolean, waiting: boolean, run: boolean, revoke: {route: string, allowed: boolean, ownerOnlyNote: string}}>}
 */
export function buildKeyList({ proxyRows = [], dispatchRows = [], isOwner = false, urlKey, now = Date.now() }) {
  const base = `/workspace/${encodeURIComponent(urlKey)}/api`;
  const out = [];
  for (const row of proxyRows || []) {
    if (!row || isHiddenSpentBootstrap(row) || !isLiveKey(row, now)) continue;
    const { kind, can } = proxyKind(row);
    const grantBearing = Array.isArray(row.grants) && row.grants.length > 0;
    out.push({
      id: row.tokenId, source: 'proxy', label: row.label || '', kind, can,
      expiresAt: row.expiresAt || null, lastUsedAt: row.lastUsedAt || null,
      hasOwner: row.hasOwner !== false, run: isRunKey(row),
      waiting: row.kind === 'bootstrap' && !row.consumed && grantBearing,
      revoke: {
        route: `${base}/proxy/tokens/${encodeURIComponent(row.tokenId)}`,
        allowed: isOwner || !grantBearing,
        ownerOnlyNote: 'Only the workspace owner can revoke a key that can run work.'
      }
    });
  }
  for (const row of dispatchRows || []) {
    if (!row || !isLiveKey(row, now)) continue;
    out.push({
      id: row.tokenId, source: 'dispatch', label: row.label || '', kind: 'Queue token (legacy)',
      can: 'Reads the queue and takes work',
      expiresAt: row.expiresAt || null, lastUsedAt: row.lastUsedAt || null,
      hasOwner: row.hasOwner !== false, waiting: false, run: false,
      revoke: {
        route: `${base}/dispatch/tokens/${encodeURIComponent(row.tokenId)}`,
        allowed: isOwner,
        ownerOnlyNote: 'Only the workspace owner can revoke a queue token.'
      }
    });
  }
  // Soonest expiry last-resort ordering: live keys by last use (newest first), unused after.
  return out.sort((a, b) => (Date.parse(b.lastUsedAt) || 0) - (Date.parse(a.lastUsedAt) || 0));
}

/** Latest `lastUsedAt` across live runner keys and live queue tokens, with which kind it was. */
export function latestRunnerPoll({ proxyRows = [], dispatchRows = [], now = Date.now() }) {
  let best = null;
  const consider = (row, kindLabel) => {
    if (!row?.lastUsedAt || !isLiveKey(row, now)) return;
    const t = Date.parse(row.lastUsedAt);
    if (Number.isFinite(t) && (!best || t > best.t)) best = { t, at: row.lastUsedAt, kind: kindLabel };
  };
  for (const row of proxyRows || []) {
    if (has(row, 'take') && !row.consumed) consider(row, 'runner key');
  }
  for (const row of dispatchRows || []) consider(row, 'queue token');
  return best ? { at: best.at, kind: best.kind } : null;
}
