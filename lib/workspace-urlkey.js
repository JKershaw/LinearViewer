/**
 * The one place a bind arm gets a workspace `urlKey` (LIN-3382, slice S1.2 of
 * LIN-2954).
 *
 * THE DEFECT THIS REMOVES. A session-local derivation used to be the tenant key:
 * five per-arm derivations each read only the LIVE session, so a second account
 * could land on a key another account already held, and with it that account's
 * queue and credentials. Now every creation path asks `resolveWorkspaceUrlKey`,
 * which reads the durable holder evidence (lib/urlkey-holders.js) as well as the
 * session, and which can REFUSE.
 *
 * THE ONE RULE (John's ruling, 9 Oct). A workspace's key is a pure function of
 * its provider's stable id, re-derived identically on every bind. There is no
 * support for pre-S1.2 keys, and no recovery of a key from evidence: nothing to
 * look up, so nothing to arbitrate. Per arm (`deriveUrlKey`):
 *
 *   linear            org.urlKey || org.name   (the org's own key; a rename gives a new key)
 *   github-container  gh-<userId>
 *   github-fresh      gh-<name>-<sha6(provider:scope)>   (also held-new)
 *   jira              jira-<cloudId>-<sha6(W)>
 *   local             <slug>-<8 hex>           (random by design)
 *
 * Linear keeps its org key because `linearviewer` and the other Linear keys hold
 * all the production data and live refresh tokens under composite `_id`s, so
 * moving them is expensive. (It is not the deep-link path: lib/render.js
 * takes the inline create link for Linear.)
 *
 * READ-ONLY. The resolver writes nothing. It returns one of
 *
 *   { urlKey, source, landOnWorkspaceId? }       - use this key
 *   { refused: { reason }, source: 'refused' }   - bind nothing
 *
 * where `source` is 'session' (the workspace is already live under exactly this
 * key) or 'derived', and `reason` is 'own-conflict' (the key is live in this
 * session under another workspace id) or 'foreign-holder' (another account
 * holds the key and has no edge to this workspace). A refusal carries no
 * `urlKey`, and there is no suffix or hash fallback: a taken key is refused.
 *
 * ORDER
 *   1. session: the workspace is already live under the derived key (stable-id
 *      arms: id W; random-id arms: the same `{provider, scope}` is open ->
 *      land on that workspace). A live key that is NOT the derived key is not
 *      kept: it is only a name, and the rule re-derives it.
 *   2. derive.
 *   3. live collision: the key is live under another workspace id -> refuse
 *      `own-conflict` (local re-rolls).
 *   4. holder test: one strict `findUrlKeyHolders(key)` read. Every holder must
 *      be in the binder set or have an edge to W (a teammate who really shares
 *      the workspace); anything else is a foreign holder -> refuse (local
 *      re-rolls on any holder).
 *
 * INVARIANTS
 *   1. The returned key is never live in the session under another workspace id
 *      (except by landing on that workspace, which returns its id).
 *   2. Fail closed: a store error propagates. The caller answers the retry page
 *      (503) and writes nothing; the resolver never returns a guessed key.
 *
 * This module imports no connection store and reads no credential payload
 * (D6/D15): everything arrives through the injected readers.
 *
 * NAMED RESIDUALS (each stated, none hidden)
 *   - Same-resource CONCURRENT binds by two accounts are a read-then-write race.
 *     The global uniqueness backstop (a `workspaces` registry plus a unique
 *     index) is LIN-3394, deliberately not built here.
 *   - A renamed GitHub repo/login or Linear org gets a new key at its next bind.
 *   - Linear can land on a key the same account holds for another connection
 *     (one un-namespaced key space shared by every provider); the live-session
 *     version is refused `own-conflict`. The global fix is LIN-3394.
 *   - Ownerless token rows (no `createdBy`) carry no account, so the holder test
 *     cannot see them and a key held only by them reads as free. Every
 *     first-time key except Linear's is id-bearing and provider-prefixed, which
 *     pre-S1.2 rows cannot hold.
 *   - A user with repo access who binds first wins; the second binder is refused.
 *   - Workspaces bound before this change (`immersify`, `tangle`) get the
 *     new-shape key on their next bind after the session expires; their old rows
 *     are not moved.
 */

import crypto from 'node:crypto';
import { validateWorkspaceUrlKey } from './workspace.js';

/**
 * The retry copy for the fail-closed 503. Same text as `CONNECTION_RETRY_*`
 * (lib/connection-credential.js); a unit test pins the two equal. Not imported
 * from there: that module is a D6-guarded importer list.
 */
export const URLKEY_RETRY_TITLE = 'Connection Not Saved';
export const URLKEY_RETRY_MESSAGE = 'We could not finish saving this connection. Anything already connected is unchanged. Please try again in a moment.';

/** Refusal copy. Neither page names the holder or the key. */
export const URLKEY_REFUSAL_COPY = Object.freeze({
  'foreign-holder': Object.freeze({
    title: "This workspace can't be connected",
    message: 'This workspace is already connected to Harbour. Please contact support.'
  }),
  // The holder here is the binder's own session, so "contact support" alone
  // would be wrong: the way out is on their dashboard.
  'own-conflict': Object.freeze({
    title: "This workspace can't be connected",
    message: "Another connection on your account already uses this workspace's address. If it is listed on your dashboard, remove it and try again; otherwise please contact support."
  })
});

const MAX_KEY = 50;

const sha6 = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 6);

/**
 * Lowercase, every non-alphanumeric run -> one hyphen, trimmed, then cut to
 * `max`.
 * @param {string} value
 * @param {number} [max=40]
 * @returns {string}
 */
export function slugify(value, max = 40) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/** `gh-<name>-<sha6(provider:scope)>`, the name cut so the whole key is at most 50 characters. */
function githubFreshKey({ repoName, provider, scope }) {
  const slug = slugify(repoName);
  const name = validateWorkspaceUrlKey(slug) ? slug : 'github';
  const suffix = `-${sha6(`${provider}:${scope}`)}`;
  const room = MAX_KEY - 'gh-'.length - suffix.length;
  return `gh-${name.slice(0, room).replace(/-+$/g, '') || 'github'}${suffix}`;
}

/** `jira-<cloudId>-<6 hex of sha256(W)>`: unique per workspace id, at most 50 characters. */
function jiraKey(cloudId, workspaceId) {
  const cloud = slugify(cloudId, MAX_KEY - 5 - 7);
  return cloud ? `jira-${cloud}-${sha6(workspaceId)}` : `jira-${sha6(workspaceId)}`;
}

/**
 * Pure: the key an arm derives. The only naming rule in the codebase.
 *
 *   github-fresh      { repoName, provider, scope }  -> gh-<name>-<sha6(provider:scope)>
 *   github-container  { userId }                     -> gh-<userId>
 *   jira              { cloudId, workspaceId }       -> jira-<cloudId>-<sha6(W)>
 *   linear            { orgKey }                     -> org.urlKey || org.name, unchanged
 *   local             { name, randomHex }            -> <slug>-<8 hex>
 *
 * @param {string} arm
 * @param {Object} ids
 * @returns {string}
 */
export function deriveUrlKey(arm, ids = {}) {
  switch (arm) {
    case 'github-fresh': return githubFreshKey(ids);
    case 'github-container': return `gh-${slugify(ids.userId, 40)}`;
    case 'jira': return jiraKey(ids.cloudId, ids.workspaceId);
    case 'linear': return ids.orgKey;
    case 'local': {
      const hex = typeof ids.randomHex === 'function' ? ids.randomHex() : crypto.randomBytes(4).toString('hex');
      return `${slugify(ids.name) || 'local'}-${hex}`;
    }
    default: throw new Error(`deriveUrlKey: unknown arm ${JSON.stringify(arm)}`);
  }
}

/**
 * @param {Object} deps
 * @param {function(string): Promise<Object[]>} deps.findUrlKeyHolders - `createUrlKeyHolderFinder(...).findUrlKeyHolders`, built strict
 * @param {function(string): Promise<string[]>} deps.listAccountsForWorkspace - `accountWorkspaceStore`
 * @param {function(string): Promise<(string|null)>} deps.resolveCanonicalAccountId
 * @param {function(string, string): Promise<(Object|null)>} [deps.findAccountByIdentity] - `accountStore`
 * @returns {function(Object): Promise<Object>} `resolveWorkspaceUrlKey`
 */
export function createWorkspaceUrlKeyResolver({
  findUrlKeyHolders, listAccountsForWorkspace, resolveCanonicalAccountId, findAccountByIdentity
} = {}) {
  if (typeof findUrlKeyHolders !== 'function' || typeof listAccountsForWorkspace !== 'function' || typeof resolveCanonicalAccountId !== 'function') {
    throw new Error('createWorkspaceUrlKeyResolver: findUrlKeyHolders, listAccountsForWorkspace and resolveCanonicalAccountId are required');
  }

  /**
   * @param {Object} request
   * @param {'github-fresh'|'github-container'|'jira'|'linear'|'local'} request.arm
   * @param {string} [request.provider] - the provider name the binding is for (random-id arms)
   * @param {string} [request.scope] - the binding's full scope: repo slug (random-id arms)
   * @param {string} [request.workspaceId] - W, for the stable-id arms
   * @param {Object} request.ids - arm-specific, see `deriveUrlKey`
   * @param {Object} [request.session] - read for `workspaces` and `accountId`; never mutated
   * @param {{provider: string, scope: string}} [request.identity] - the signing-in identity, joined to the binder set
   * @param {string[]} [request.binderAccountIds] - replaces the session account in the binder set
   */
  return async function resolveWorkspaceUrlKey({
    arm, provider, scope, workspaceId, ids = {}, session, identity, binderAccountIds
  } = {}) {
    const live = Array.isArray(session?.workspaces) ? session.workspaces : [];
    const W = workspaceId;
    const liveOther = key => live.find(w => w?.urlKey === key && w?.id !== W) || null;

    const canon = async id => (id ? resolveCanonicalAccountId(id) : null);

    const result = (urlKey, source, extra = {}) => {
      // INVARIANT 1, enforced on every branch rather than trusted per branch.
      const other = liveOther(urlKey);
      if (other && extra.landOnWorkspaceId !== other.id) {
        throw new Error('resolveWorkspaceUrlKey: refusing to return a key that is live under another workspace id');
      }
      return { urlKey, source, ...extra };
    };
    const refuse = reason => ({ refused: { reason }, source: 'refused' });

    // The accounts holding `key` that are neither the binder nor linked to W.
    const hasForeignHolder = async key => {
      const holders = await findUrlKeyHolders(key);
      if (holders.length === 0) return false;
      const binder = new Set();
      for (const id of (binderAccountIds || [session?.accountId])) {
        const c = await canon(id);
        if (c) binder.add(c);
      }
      if (identity && typeof findAccountByIdentity === 'function') {
        const account = await findAccountByIdentity(identity.provider, identity.scope);
        const c = await canon(account?._id);
        if (c) binder.add(c);
      }
      const foreign = holders.filter(h => !binder.has(h.accountId));
      if (foreign.length === 0) return false;
      const edges = new Set();
      if (W) {
        for (const id of await listAccountsForWorkspace(W)) {
          const c = await canon(id);
          if (c) edges.add(c);
        }
      }
      return foreign.some(h => !edges.has(h.accountId));
    };

    // ---------------------------------------------------------------- local
    if (arm === 'local') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const key = deriveUrlKey('local', ids);
        if (!validateWorkspaceUrlKey(key) || live.some(w => w?.urlKey === key)) continue;
        if ((await findUrlKeyHolders(key)).length === 0) return result(key, 'derived');
      }
      throw new Error('resolveWorkspaceUrlKey: could not mint an unused local urlKey');
    }

    const key = arm === 'jira' ? deriveUrlKey('jira', { ...ids, workspaceId: W })
      : arm === 'github-fresh' ? deriveUrlKey('github-fresh', { ...ids, provider, scope })
        : deriveUrlKey(arm, ids);
    if (!key) throw new Error(`resolveWorkspaceUrlKey: the ${arm} arm derived no key`);
    if (arm !== 'github-fresh' && !W) throw new Error(`resolveWorkspaceUrlKey: the ${arm} arm needs a workspaceId`);

    // 1. session. A live key is kept only when it IS the derived key.
    if (arm === 'github-fresh') {
      // The same {provider, scope} already open in this session: land on that
      // workspace (the idempotent rule held add-source uses).
      const open = live.find(w => w?.urlKey === key && (w?.bindings || []).some(b => b?.provider === provider && b?.scope === scope));
      if (open) return result(key, 'session', { landOnWorkspaceId: open.id });
    } else if (live.some(w => w?.id === W && w?.urlKey === key)) {
      return result(key, 'session');
    }

    // 3. live collision (a refusal, never a fallback key)
    if (liveOther(key)) return refuse('own-conflict');

    // 4. holder test
    if (await hasForeignHolder(key)) return refuse('foreign-holder');
    return result(key, 'derived');
  };
}

/**
 * The refusal / fail-closed seam every bind arm shares, so the copy and the
 * ordering live in one place. Resolves the key; on a refusal answers the 409
 * page, on a missing or throwing resolver the 503 retry page, and in both cases
 * returns `null` having written nothing. The caller returns immediately.
 *
 * `beforeRespond` runs first on those exits (Jira drops its carried refresh
 * token there).
 *
 * @param {Object} options
 * @param {function(Object): Promise<Object>} [options.resolve] - the injected resolver; absent = fail closed
 * @param {Object} options.request - passed to the resolver
 * @param {import('express').Response} options.res
 * @param {function(Object, Object): string} options.renderPage - `(title, message, opts) => html`
 * @param {string} options.arm - for the log line
 * @param {{action: string, actionUrl: string}} options.retry - the retry page's link
 * @param {function(): void} [options.beforeRespond]
 * @returns {Promise<{urlKey: string, source: string, landOnWorkspaceId?: string}|null>}
 */
export async function resolveKeyOrRespond({ resolve, request, res, renderPage, arm, retry, beforeRespond }) {
  const fail = () => {
    if (beforeRespond) beforeRespond();
    res.status(503).send(renderPage(URLKEY_RETRY_TITLE, URLKEY_RETRY_MESSAGE, retry));
    return null;
  };
  if (typeof resolve !== 'function') {
    console.error(`[urlkey] ${arm}: no resolveWorkspaceUrlKey injected; failing closed`);
    return fail();
  }
  let resolved;
  try {
    resolved = await resolve(request);
  } catch (err) {
    console.error(`[urlkey] ${arm}: resolver failed; failing closed:`, err);
    return fail();
  }
  if (resolved?.refused) {
    const copy = URLKEY_REFUSAL_COPY[resolved.refused.reason] || URLKEY_REFUSAL_COPY['foreign-holder'];
    // Arm and reason only: never the key, never the holder.
    console.warn(`[urlkey] ${arm}: bind refused (${resolved.refused.reason})`);
    if (beforeRespond) beforeRespond();
    res.status(409).send(renderPage(copy.title, copy.message, { action: 'Go to homepage', actionUrl: '/' }));
    return null;
  }
  if (!resolved || typeof resolved.urlKey !== 'string' || !resolved.urlKey) return fail();
  return resolved;
}
