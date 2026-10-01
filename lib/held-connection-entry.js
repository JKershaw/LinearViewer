/**
 * LIN-3125 Phase 1 — the held-connection entry seam (dark: no consumer).
 *
 * A "held" entry is an EXPLICIT user click that may add a source from an
 * already-held Connection instead of re-running OAuth/install. This module is the
 * single decision point for that:
 *
 *   - `HELD_ENTRY_PARAM` / `withHeldMarker` — the opt-in marker the four explicit
 *     add-entry emitters append (only for `listConnectionScopes` providers);
 *   - `isFreshNewWorkspaceIntent` — the SHARED explicit-intent predicate, also
 *     consumed by `lib/github-install-flow.js` so the two cannot drift;
 *   - `resolveHeldEntry` — the resolver, which returns a target only when every
 *     condition holds and `null` (today's bare flow) otherwise.
 *
 * C1 (LIN-3125): this module imports NEITHER `lib/connection-store.js` NOR
 * `lib/connection-credential.js` — and imports no route/provider module. Every
 * store/credential-shaped capability arrives by injection
 * (`listAuthorizedAccountConnections`, `writesEnabled`, `getWorkspaceByUrlKey`,
 * `resolveCanonicalAccountId`, `getProvider`), so the D6 reader-module law and
 * `READ_ALLOWED_MODULES` stay intact and the module stays IO-free/unit-testable.
 *
 * Nothing here is user-visible in Phase 1: the four emitters, the `/auth/github`
 * GET hook and the picker route are wired in Phase 3.
 */

/** The opt-in query param the four explicit add-entry emitters append. */
export const HELD_ENTRY_PARAM = 'heldConnection';

/**
 * The SHARED `intent.fresh` predicate (extracted from
 * `lib/github-install-flow.js`). True ONLY for the explicit signed-in "as a new
 * workspace" click: mode `new`, a signed-in account, at least one existing
 * workspace, and a surface that supports a fresh container. Every other entry
 * (signed-out, email-only zero-workspace, github-projects) is false — byte-for-
 * byte the inline condition it replaced.
 *
 * @param {{mode?: string, accountId?: string, workspaces?: Array, supportsFreshContainer?: boolean}} [intent]
 * @returns {boolean}
 */
export function isFreshNewWorkspaceIntent({ mode, accountId, workspaces, supportsFreshContainer } = {}) {
  return mode === 'new' && !!accountId && workspaces?.length > 0 && !!supportsFreshContainer;
}

/**
 * Append `heldConnection=1` to `url` iff `provider` declares
 * `listConnectionScopes`. A provider without it (linear/jira/local) gets the
 * byte-identical `url` back, so its rows, redirects and pins do not move.
 *
 * @param {string} url - a relative path, e.g. `/auth/github?mode=add-source`
 * @param {{supports?: (method: string) => boolean}} [provider]
 * @returns {string}
 */
export function withHeldMarker(url, provider) {
  if (!provider || typeof provider.supports !== 'function' || !provider.supports('listConnectionScopes')) return url;
  const [base, query = ''] = String(url).split('?');
  const params = new URLSearchParams(query);
  params.set(HELD_ENTRY_PARAM, '1');
  return `${base}?${params.toString()}`;
}

/**
 * Resolve a held entry from a request, or `null` for today's bare flow. Returns
 * `{ provider, mode, workspaceUrlKey }` (plus `beginUrl` when a `beginUrlFor`
 * builder is injected) only when ALL hold:
 *
 *   1. the marker `heldConnection === '1'` (explicit opt-in only);
 *   2. D11 writes are enabled (otherwise inert: no reads);
 *   3. the provider supports `listConnectionScopes`;
 *   4. the session has a canonicalizable account id;
 *   5. the mode predicate holds — *add-source*: the named workspace is present in
 *      the session (`getWorkspaceByUrlKey`, never a new hand-rolled lookup);
 *      *new*: the SHARED {@link isFreshNewWorkspaceIntent};
 *   6. the account holds at least one AUTHORIZED Connection of that provider
 *      (`listAuthorizedAccountConnections`, the injected C1 reader).
 *
 * `provider` may be given directly (the per-provider flow), or resolved by name
 * from the injected `getProvider` (the Phase 3 route). It never imports a store,
 * the credential module, or a registry.
 *
 * @param {Object} deps
 * @param {Object} deps.req - `{ query, session, params? }`
 * @param {Object} [deps.provider] - the resolved provider descriptor
 * @param {(name: string) => Object|undefined} [deps.getProvider]
 * @param {(args: {accountId: string, provider: string}) => Promise<Object[]>} [deps.listAuthorizedAccountConnections]
 * @param {boolean} [deps.writesEnabled]
 * @param {(session: Object, urlKey: string) => Object|null} [deps.getWorkspaceByUrlKey]
 * @param {(id: string) => (string|Promise<string>)} [deps.resolveCanonicalAccountId]
 * @param {boolean} [deps.supportsFreshContainer]
 * @param {(target: {provider: string, mode: string, workspaceUrlKey: string|null}) => string} [deps.beginUrlFor]
 * @returns {Promise<{provider: string, mode: string, workspaceUrlKey: string|null, beginUrl?: string}|null>}
 */
export async function resolveHeldEntry({
  req,
  provider,
  getProvider,
  listAuthorizedAccountConnections,
  writesEnabled = true,
  getWorkspaceByUrlKey,
  resolveCanonicalAccountId = (id) => id,
  supportsFreshContainer = false,
  beginUrlFor = null,
} = {}) {
  const query = req?.query || {};
  const session = req?.session || {};

  if (query[HELD_ENTRY_PARAM] !== '1') return null; // explicit opt-in only
  if (!writesEnabled) return null; // D11 inert: zero reads
  if (typeof listAuthorizedAccountConnections !== 'function') return null;

  let resolvedProvider = provider;
  if (!resolvedProvider && typeof getProvider === 'function' && typeof req?.params?.provider === 'string') {
    resolvedProvider = getProvider(req.params.provider);
  }
  if (!resolvedProvider || typeof resolvedProvider.supports !== 'function' || !resolvedProvider.supports('listConnectionScopes')) return null;

  const rawAccountId = session.accountId;
  if (!rawAccountId) return null;
  let accountId;
  try {
    accountId = await resolveCanonicalAccountId(rawAccountId);
  } catch {
    return null;
  }
  if (!accountId) return null;

  const mode = query.mode === 'add-source' ? 'add-source' : 'new';
  let workspaceUrlKey = null;
  if (mode === 'add-source') {
    if (typeof query.workspace !== 'string' || !query.workspace) return null;
    const workspace = typeof getWorkspaceByUrlKey === 'function' ? getWorkspaceByUrlKey(session, query.workspace) : null;
    if (!workspace) return null;
    workspaceUrlKey = query.workspace;
  } else if (!isFreshNewWorkspaceIntent({ mode, accountId: rawAccountId, workspaces: session.workspaces, supportsFreshContainer })) {
    return null;
  }

  const connections = await listAuthorizedAccountConnections({ accountId, provider: resolvedProvider.name });
  if (!Array.isArray(connections) || connections.length === 0) return null;

  const target = { provider: resolvedProvider.name, mode, workspaceUrlKey };
  if (typeof beginUrlFor === 'function') target.beginUrl = beginUrlFor(target);
  return target;
}
