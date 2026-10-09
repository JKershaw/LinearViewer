/**
 * The one place a bind arm gets a workspace `urlKey` (LIN-3382, slice S1.2 of
 * LIN-2954).
 *
 * THE DEFECT THIS REMOVES. A session-local derivation used to be the tenant key:
 * five per-arm derivations each read only the LIVE session, so a second account
 * could land on a key another account already held, and with it that account's
 * queue and credentials. Now every bind arm asks `resolveWorkspaceUrlKey`, which
 * reads the durable holder evidence (lib/urlkey-holders.js) as well as the
 * session, and which can REFUSE.
 *
 * READ-ONLY. The resolver writes nothing. It returns one of
 *
 *   { urlKey, source, landOnWorkspaceId? }       - use this key
 *   { refused: { reason }, source: 'refused' }   - bind nothing
 *
 * where `source` is 'session' | 'resource' | 'workspace' | 'legacy' | 'derived'
 * and `reason` is 'foreign-holder' (another account holds the key and has no
 * edge to this workspace), 'own-conflict' (Linear only: the binder's own
 * different connection holds / has live the key Linear cannot leave) or
 * 'ambiguous' (Jira only: the binder holds more than one candidate for the same
 * site and nothing names this workspace). A refusal carries no `urlKey`.
 *
 * ORDER (stops at the first hit; every branch obeys INVARIANT 1):
 *   a. the same workspace id is live in the session (random-id arms: the same
 *      `{provider, scope}` is live -> land on that workspace);
 *   b. the binder's own durable record of THIS workspace: a referent / owner
 *      credential with the same `{provider, scope}` (Jira: W's own scoped key
 *      first, then a runner token naming W);
 *   c. stable-id arms with an edge to W only: a holder-tested legacy key;
 *   d. `deriveUrlKey` (first-time binds), holder-tested.
 *
 * INVARIANTS
 *   1. The returned key is never live in the session under another workspace id
 *      (except by landing on that workspace, which returns its id).
 *   2. A workspace that already has a key keeps it: b is never holder-tested
 *      and never refused (ruling 1800e1d9). Existing workspaces are never
 *      re-keyed by this module.
 *   3. Fail closed: a store error propagates. The caller answers the retry page
 *      (503) and writes nothing; the resolver never returns a guessed key.
 *
 * HOLDER TEST. Over the key's evidence rows (one read for the whole candidate
 * set, never one per candidate): every holder is in the binder set, or each
 * other holder has an edge to W (a teammate who really shares the workspace).
 * Anything else is a foreign holder -> refuse.
 *
 * This module imports no connection store and reads no credential payload
 * (D6/D15): everything arrives through the injected readers.
 *
 * NAMED RESIDUALS (each stated, none hidden)
 *   - Same-resource CONCURRENT binds by two accounts are a read-then-write race.
 *     The global uniqueness backstop (a `workspaces` registry plus a unique
 *     index) is LIN-3394, deliberately not built here.
 *   - A random-id workspace with NO durable record at all (only a C1 data row, or
 *     only tokens, e.g. GitHub workspaces bound 12-29 Sep that have tokens but no
 *     referent) cannot be matched to its key after its session expires, so a
 *     re-bind derives the id-bearing key and the old key's data is not reached.
 *     Existing workspaces are never re-keyed by THIS code; their number is the
 *     dry-run's `referentlessHeld` bucket (scripts/dry-run-urlkey-duplicates.mjs).
 *   - A renamed GitHub login or Linear org key with an expired session and no
 *     runner token (the same as before this module).
 *   - Linear refuses `own-conflict` when its org key is live under another
 *     workspace id of the same session (a legacy Jira/GitHub `acme` open, then
 *     Linear org `acme`): Linear's key is the deep-link path, so there is nothing
 *     to fall to. Cause: one un-namespaced key space shared by every provider; no
 *     ticket tracks it. A named exception to "a returning workspace is never
 *     refused" (AC 18); sized by the dry-run's `linear.keysOnMultipleWorkspaceIds`.
 *   - Jira refuses `ambiguous` for a returning workspace whose binder holds
 *     several keys on one site and no record names the workspace (two identities
 *     on one site, session expired): it never swaps or shares a key. Sized by the
 *     dry-run's `jira.sameSiteMultiKey`.
 *   - A user with repo access who binds first wins; the second binder is refused.
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

const FOREIGN_HOLDER_COPY = Object.freeze({
  title: "This workspace can't be connected",
  message: 'This workspace is already connected to Harbour. Please contact support.'
});

/** Refusal copy. Neither page names the holder or the key. */
export const URLKEY_REFUSAL_COPY = Object.freeze({
  'foreign-holder': FOREIGN_HOLDER_COPY,
  // The holder here is the binder's own connection, so "contact support" alone
  // would be wrong: the way out is on their dashboard.
  'own-conflict': Object.freeze({
    title: "This workspace can't be connected",
    message: "Another connection on your account already uses this workspace's address. If it is listed on your dashboard, remove it and try again; otherwise please contact support."
  }),
  // Jira: the binder holds several keys on one site and nothing names this workspace.
  ambiguous: FOREIGN_HOLDER_COPY
});

const MAX_KEY = 50;
const LEGACY_SUFFIX_MAX = 10; // MAX_WORKSPACES, the bound the old collision loops could reach
const PROVIDER_FAMILIES = Object.freeze({
  github: ['github', 'github-projects'],
  'github-projects': ['github', 'github-projects']
});

const sha6 = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 6);

/**
 * Lowercase, every non-alphanumeric run -> one hyphen, trimmed, then cut to
 * `max` (the cut is NOT re-trimmed: it is the exact transform `slugifyName`
 * (routes/workspace.js) and the old GitHub derivation both used, and the legacy
 * candidate keys for a returning workspace must reproduce it).
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

function validOr(candidate, fallback) {
  return validateWorkspaceUrlKey(candidate) ? candidate : fallback;
}

/** `gh-<name>-<installationId>`, with the name cut and a 6-hex scope hash added when over 50. */
function githubFreshKey({ repoName, installationId, scope }) {
  const name = validOr(slugify(repoName), 'github');
  const id = slugify(installationId, 24);
  if (!id) return `gh-${name}-${sha6(scope)}`.slice(0, MAX_KEY);
  const full = `gh-${name}-${id}`;
  if (full.length <= MAX_KEY) return full;
  const room = MAX_KEY - (`gh-`.length + `-${id}-${sha6(scope)}`.length);
  if (room < 1) return `gh-${id}-${sha6(scope)}`.slice(0, MAX_KEY);
  return `gh-${name.slice(0, room).replace(/-+$/g, '') || 'github'}-${id}-${sha6(scope)}`.slice(0, MAX_KEY);
}

function jiraPlainKey(cloudId) {
  return `jira-${slugify(cloudId, MAX_KEY - 5)}`.replace(/-+$/g, '');
}

/** `jira-<cloudId>-<6 hex of sha256(W)>`: unique per workspace id, at most 50 characters. */
function jiraScopedKey(cloudId, workspaceId) {
  const cloud = slugify(cloudId, MAX_KEY - 5 - 7);
  return cloud ? `jira-${cloud}-${sha6(workspaceId)}` : `jira-${sha6(workspaceId)}`;
}

/**
 * Pure: the key a FIRST-TIME bind of an arm gets (step d).
 *
 *   github-fresh      { repoName, installationId, scope }  -> gh-<name>-<installationId>
 *   github-container  { userId }                          -> gh-<userId>
 *   jira              { cloudId }                         -> jira-<cloudId>
 *   linear            { orgKey }                          -> org.urlKey || org.name, unchanged
 *   local             { name, randomHex }                 -> <slug>-<8 hex>
 *
 * Every output but Linear's passes `validateWorkspaceUrlKey` and is at most 50
 * characters. Linear keeps its org key as-is: it is the deep-link path
 * (lib/providers/linear/index.js getCreateTaskUrl).
 *
 * @param {string} arm
 * @param {Object} ids
 * @returns {string}
 */
export function deriveUrlKey(arm, ids = {}) {
  switch (arm) {
    case 'github-fresh': return githubFreshKey(ids);
    case 'github-container': return `gh-${slugify(ids.userId, 40)}`;
    case 'jira': return jiraPlainKey(ids.cloudId);
    case 'linear': return ids.orgKey;
    case 'local': {
      const hex = typeof ids.randomHex === 'function' ? ids.randomHex() : crypto.randomBytes(4).toString('hex');
      return `${slugify(ids.name) || 'local'}-${hex}`;
    }
    default: throw new Error(`deriveUrlKey: unknown arm ${JSON.stringify(arm)}`);
  }
}

/** `base`, `base-2` ... `base-10`: the shapes the old collision loops produced (K4). */
function suffixed(base) {
  const out = [base];
  for (let n = 2; n <= LEGACY_SUFFIX_MAX; n++) out.push(`${base}-${n}`.slice(0, MAX_KEY));
  return out;
}

/**
 * @param {Object} deps
 * @param {function(string[]): Promise<Object[]>} deps.findEvidence - `createUrlKeyHolderFinder(...).findEvidence`, built strict
 * @param {function(string): Promise<string[]>} deps.listAccountsForWorkspace - `accountWorkspaceStore`
 * @param {function(string): Promise<(string|null)>} deps.resolveCanonicalAccountId
 * @param {function(string, string): Promise<(Object|null)>} [deps.findAccountByIdentity] - `accountStore`
 * @param {function(string): Promise<Object[]>} [deps.listHolderRowsByWorkspaceId] - `proxyTokenStore`, built strict
 * @returns {function(Object): Promise<Object>} `resolveWorkspaceUrlKey`
 */
export function createWorkspaceUrlKeyResolver({
  findEvidence, listAccountsForWorkspace, resolveCanonicalAccountId, findAccountByIdentity, listHolderRowsByWorkspaceId
} = {}) {
  if (typeof findEvidence !== 'function' || typeof listAccountsForWorkspace !== 'function' || typeof resolveCanonicalAccountId !== 'function') {
    throw new Error('createWorkspaceUrlKeyResolver: findEvidence, listAccountsForWorkspace and resolveCanonicalAccountId are required');
  }

  /**
   * @param {Object} request
   * @param {'github-fresh'|'github-container'|'jira'|'linear'|'local'} request.arm
   * @param {string} [request.provider] - the provider name the binding is for
   * @param {string} [request.scope] - the binding's full scope (repo slug, site url, org id)
   * @param {string} [request.workspaceId] - W, for the stable-id arms
   * @param {Object} request.ids - arm-specific, see `deriveUrlKey`; Jira also `tenant`, container `login`
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

    // The accounts with an edge to W (stable-id arms). Loaded lazily, once.
    let edgeAccounts = null;
    const loadEdges = async () => {
      if (edgeAccounts) return edgeAccounts;
      edgeAccounts = new Set();
      if (!W) return edgeAccounts;
      for (const id of await listAccountsForWorkspace(W)) {
        const c = await canon(id);
        if (c) edgeAccounts.add(c);
      }
      return edgeAccounts;
    };
    const hasEdge = async () => {
      const edges = await loadEdges();
      for (const id of binder) if (edges.has(id)) return true;
      return false;
    };

    const family = PROVIDER_FAMILIES[provider] || [provider];
    // How a record ties a key to a `{provider, scope}`. A field the record does
    // not carry ties it to nothing ('neutral'). `scopeMatters:false` is the
    // GitHub container, whose key belongs to the user, not to the picked repo.
    const refOf = ({ providers, scopeMatters = true }) => row => {
      if (!row.provider) return 'neutral';
      if (!providers.includes(row.provider)) return 'different';
      if (!scopeMatters || !scope || !row.scope || row.scope === scope) return 'same';
      return 'different';
    };

    let rows = [];
    const load = async keys => { rows = await findEvidence([...new Set(keys.filter(Boolean))]); };

    const analyse = (key, tie) => {
      const forKey = rows.filter(r => r.urlKey === key);
      const binderRows = forKey.filter(r => binder.has(r.accountId));
      const foreign = [...new Set(forKey.filter(r => !binder.has(r.accountId)).map(r => r.accountId))];
      const ties = binderRows.map(tie);
      const same = ties.includes('same');
      const different = ties.includes('different');
      return {
        key, rows: forKey, binderRows, foreign,
        any: binderRows.length > 0,
        same, different,
        // The binder's record of THIS workspace: a same-ref record, or only
        // ref-less ones (tokens) and nothing tying the key elsewhere.
        own: same || (ties.includes('neutral') && !different)
      };
    };
    const blocked = async a => {
      if (a.foreign.length === 0) return false;
      const edges = await loadEdges();
      return a.foreign.some(id => !edges.has(id));
    };

    const result = (urlKey, source, extra = {}) => {
      // INVARIANT 1, enforced on every branch rather than trusted per branch.
      const other = liveOther(urlKey);
      if (other && extra.landOnWorkspaceId !== other.id) {
        throw new Error('resolveWorkspaceUrlKey: refusing to return a key that is live under another workspace id');
      }
      return { urlKey, source, ...extra };
    };
    const refuse = reason => ({ refused: { reason }, source: 'refused' });

    // ---------------------------------------------------------------- local
    if (arm === 'local') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const key = deriveUrlKey('local', ids);
        if (!validateWorkspaceUrlKey(key) || live.some(w => w?.urlKey === key)) continue;
        await load([key]);
        if (rows.length === 0) return result(key, 'derived');
      }
      throw new Error('resolveWorkspaceUrlKey: could not mint an unused local urlKey');
    }

    // ---------------------------------------------- GitHub fresh (random id)
    if (arm === 'github-fresh') {
      const tie = refOf({ providers: [provider] });
      // a. The same {provider, scope} already open in this session: land on that
      // workspace, the idempotent rule held add-source uses.
      const open = live.find(w => (w?.bindings || []).some(b => b?.provider === provider && b?.scope === scope));
      if (open) return result(open.urlKey, 'session', { landOnWorkspaceId: open.id });

      const base = validOr(slugify(ids.repoName), 'github');
      const legacy = suffixed(base);
      const derived = deriveUrlKey('github-fresh', { ...ids, scope });
      const derivedScoped = `${derived.slice(0, MAX_KEY - 7).replace(/-+$/g, '')}-${sha6(`${provider}:${scope}`)}`;
      await load([...legacy, derived, derivedScoped]);

      // b. The binder's own referent for exactly this {provider, scope}. A key
      // tied to a different scope (round 3's R1: alice/foo as `foo`, then
      // alice-org/foo) is never reused here.
      for (const key of [...legacy, derived, derivedScoped]) {
        const a = analyse(key, tie);
        if (a.same && !liveOther(key)) return result(key, 'resource');
      }
      // d.
      for (const key of [derived, derivedScoped]) {
        if (liveOther(key)) continue;
        const a = analyse(key, tie);
        if (await blocked(a)) return refuse('foreign-holder');
        return result(key, 'derived');
      }
      throw new Error('resolveWorkspaceUrlKey: no usable github key');
    }

    // ------------------------------------- GitHub account container (stable)
    if (arm === 'github-container') {
      const tie = refOf({ providers: family, scopeMatters: false });
      const own = live.find(w => w?.id === W);
      if (own) return result(own.urlKey, 'session');

      const gh = deriveUrlKey('github-container', ids);
      const loginKey = validateWorkspaceUrlKey(ids.login) ? ids.login : null;
      await load([gh, loginKey]);
      const edge = await hasEdge();

      // b. `gh-<userId>` is unique to W; the login key is shared ground (a repo
      // named like the login), so it counts as W's only with an edge.
      const aGh = analyse(gh, tie);
      if (aGh.own && !liveOther(gh)) return result(gh, 'resource');
      if (loginKey && edge) {
        const aLogin = analyse(loginKey, tie);
        if (aLogin.own && !liveOther(loginKey)) return result(loginKey, 'resource');
      }
      // c / d. Today's login key if nothing argues against it, else `gh-<userId>`.
      let sawForeign = false;
      for (const key of [loginKey, gh].filter(Boolean)) {
        if (liveOther(key)) continue;
        const a = analyse(key, tie);
        if (await blocked(a)) { sawForeign = true; continue; }
        if (a.different || (!edge && a.any)) continue;
        return result(key, edge ? 'legacy' : 'derived');
      }
      if (sawForeign) return refuse('foreign-holder');
      throw new Error('resolveWorkspaceUrlKey: no usable github container key');
    }

    // ------------------------------------------------------- Jira (stable)
    if (arm === 'jira') {
      if (!W) throw new Error('resolveWorkspaceUrlKey: the jira arm needs a workspaceId');
      const tie = refOf({ providers: ['jira'] });
      const own = live.find(w => w?.id === W);
      if (own) return result(own.urlKey, 'session');

      const tenantBase = validOr(String(ids.tenant || '').toLowerCase(), 'jira');
      const legacy = suffixed(tenantBase);
      if (tenantBase !== 'jira') legacy.push('jira');
      const plain = deriveUrlKey('jira', ids);
      const scoped = jiraScopedKey(ids.cloudId, W);
      const candidates = [...legacy, plain];
      await load([scoped, ...candidates]);
      const edge = await hasEdge();

      // b1. W's own scoped key is unique to W (another identity's scoped key is
      // never one of W's candidates).
      const aScoped = analyse(scoped, tie);
      if (aScoped.any && (aScoped.same || !aScoped.different) && !liveOther(scoped)) return result(scoped, 'resource');

      // b2. A durable record that NAMES W: a runner token with workspaceId === W.
      if (typeof listHolderRowsByWorkspaceId === 'function') {
        const named = [];
        for (const row of await listHolderRowsByWorkspaceId(W)) {
          const c = await canon(row?.createdBy);
          if (c && binder.has(c) && candidates.includes(row.urlKey)) named.push(row.urlKey);
        }
        const hit = candidates.find(k => named.includes(k) && !liveOther(k));
        if (hit) return result(hit, 'workspace');
      }

      // b3. The binder's records on the same {jira, site}. With an edge to W this
      // is a returning workspace: exactly one such key is W's; several cannot be
      // told apart (W and another identity on one site), so refuse rather than
      // take a key that may be the other workspace's. Without an edge W is new,
      // and those keys belong to the binder's other workspaces.
      const mine = candidates.filter(k => !liveOther(k) && analyse(k, tie).own);
      if (edge && mine.length === 1) return result(mine[0], 'resource');
      if (edge && mine.length > 1) return refuse('ambiguous');

      // c. A returning workspace with no record: today's base key, holder-tested.
      if (edge) {
        const a = analyse(tenantBase, tie);
        if (!liveOther(tenantBase) && !(await blocked(a)) && !a.different) return result(tenantBase, 'legacy');
      }

      // d. `jira-<cloudId>`, or W's own scoped variant when that key is already
      // in use by anything else. A foreign holder of the plain key is a refusal,
      // not a reason to take the variant.
      const aPlain = analyse(plain, tie);
      if (await blocked(aPlain)) return refuse('foreign-holder');
      if (!liveOther(plain) && aPlain.rows.length === 0) return result(plain, 'derived');
      if (liveOther(scoped)) throw new Error('resolveWorkspaceUrlKey: W\'s scoped jira key is live under another workspace id');
      if (await blocked(aScoped)) return refuse('foreign-holder');
      return result(scoped, 'derived');
    }

    // ----------------------------------------------------- Linear (stable)
    if (arm === 'linear') {
      const key = ids.orgKey;
      if (!key) throw new Error('resolveWorkspaceUrlKey: the linear arm needs ids.orgKey');
      const tie = refOf({ providers: ['linear'] });
      // Linear's key is the deep-link path, so there is nothing to fall to: it
      // either lands or refuses. It is never re-keyed (rename edge case as today).
      const mineLive = live.find(w => w?.id === W);
      if (mineLive && mineLive.urlKey === key) return result(key, 'session');
      if (liveOther(key)) return refuse('own-conflict');

      await load([key]);
      const edge = await hasEdge();
      const a = analyse(key, tie);
      // A returning org is never refused (its own-scope record wins over a
      // different-scope tie, e.g. a Jira credential on the same string).
      if (a.same || (edge && !a.different)) return result(key, 'resource');
      if (await blocked(a)) return refuse('foreign-holder');
      if (a.different) return refuse('own-conflict');
      return result(key, 'derived');
    }

    throw new Error(`resolveWorkspaceUrlKey: unknown arm ${JSON.stringify(arm)}`);
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
