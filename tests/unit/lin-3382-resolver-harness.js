/**
 * LIN-3382 shared test harness: a REAL `createWorkspaceUrlKeyResolver` (and the
 * real `createUrlKeyHolderFinder` under it) over in-memory fake stores.
 *
 * Every test that mounts a bind-arm factory passes `world.resolve` explicitly,
 * because the factories have no default resolver (a default built from the
 * stores a factory already receives could not refuse).
 *
 * The world's arrays are mutable on purpose: a test seeds history by pushing
 * rows, and `world.recordBind(...)` mirrors what a successful bind leaves in the
 * three holder stores so a later bind in the same test sees it.
 */
import { createWorkspaceUrlKeyResolver } from '../../lib/workspace-urlkey.js';
import { createUrlKeyHolderFinder } from '../../lib/urlkey-holders.js';
import { createReferentHolderReader } from '../../lib/connection-credential.js';

const touches = (value, wanted) => (Array.isArray(wanted) ? wanted.includes(value) : value === wanted);

/**
 * @param {Object} [seed]
 * @param {Object[]} [seed.referents]   `{_id, accountId, referents:[{urlKey, provider, scope}]}` connection rows
 * @param {Object[]} [seed.ownerCredentials] `{accountId, urlKey, provider?, scope?}`
 * @param {Object[]} [seed.proxyTokens] `{urlKey, createdBy, workspaceId?}`
 * @param {Object[]} [seed.dispatchTokens] `{urlKey, createdBy}`
 * @param {Object[]} [seed.edges] `{accountId, workspaceId}`
 * @param {Object[]} [seed.identities] `{provider, scope, accountId}`
 * @param {Object} [seed.mergedInto] accountId -> canonical accountId
 */
export function createResolverWorld(seed = {}) {
  const world = {
    referents: [...(seed.referents || [])],
    ownerCredentials: [...(seed.ownerCredentials || [])],
    proxyTokens: [...(seed.proxyTokens || [])],
    dispatchTokens: [...(seed.dispatchTokens || [])],
    edges: [...(seed.edges || [])],
    identities: [...(seed.identities || [])],
    mergedInto: { ...(seed.mergedInto || {}) },
    failStores: false,
    evidenceReads: [],
    strictFlags: []
  };
  const fail = strict => {
    world.strictFlags.push(!!strict);
    if (world.failStores) {
      if (strict) throw new Error('store down');
      return true;
    }
    return false;
  };

  const ownerCredentialStore = {
    async listUrlKeyRecords({ urlKey, strict } = {}) {
      if (fail(strict)) return [];
      return world.ownerCredentials.filter(r => touches(r.urlKey, urlKey));
    }
  };
  const proxyTokenStore = {
    async listHolderRows(urlKey, { strict } = {}) {
      if (fail(strict)) return [];
      return world.proxyTokens.filter(r => touches(r.urlKey, urlKey));
    }
  };
  const dispatchTokenStore = {
    async listHolderRows(urlKey, { strict } = {}) {
      if (fail(strict)) return [];
      return world.dispatchTokens.filter(r => touches(r.urlKey, urlKey));
    }
  };
  const readReferents = async urlKey => {
    if (fail(true)) return [];
    return world.referents.filter(c => (c.referents || []).some(r => touches(r.urlKey, urlKey)));
  };
  const canonical = async id => {
    let current = id;
    for (let hop = 0; hop < 8 && world.mergedInto[current]; hop++) current = world.mergedInto[current];
    return current;
  };
  const finder = createUrlKeyHolderFinder({
    readReferents, ownerCredentialStore, proxyTokenStore, dispatchTokenStore,
    resolveCanonicalAccountId: canonical, strict: true
  });
  const accountWorkspaceStore = {
    async listAccountsForWorkspace(workspaceId) {
      return world.edges.filter(e => e.workspaceId === workspaceId).map(e => e.accountId);
    }
  };
  const accountStore = {
    async findAccountByIdentity(provider, scope) {
      const hit = world.identities.find(i => i.provider === provider && i.scope === scope);
      return hit ? { _id: hit.accountId } : null;
    }
  };

  world.ownerCredentialStore = ownerCredentialStore;
  world.proxyTokenStore = proxyTokenStore;
  world.dispatchTokenStore = dispatchTokenStore;
  world.accountWorkspaceStore = accountWorkspaceStore;
  world.accountStore = accountStore;
  world.resolve = createWorkspaceUrlKeyResolver({
    findUrlKeyHolders: async key => { world.evidenceReads.push([key]); return finder.findUrlKeyHolders(key); },
    listAccountsForWorkspace: id => accountWorkspaceStore.listAccountsForWorkspace(id),
    resolveCanonicalAccountId: canonical,
    findAccountByIdentity: (provider, scope) => accountStore.findAccountByIdentity(provider, scope)
  });

  /** What a successful bind leaves behind in the holder stores (for a later bind in one test). */
  world.recordBind = ({ accountId, urlKey, provider, scope, workspaceId, connectionId = `${accountId}::${provider}::${scope}` }) => {
    world.referents.push({ _id: connectionId, accountId, referents: [{ urlKey, provider, scope }] });
    if (workspaceId) world.edges.push({ accountId, workspaceId });
  };
  /** A signed-in session object as the arms see it. */
  world.session = (accountId, workspaces = []) => ({ accountId, workspaces });
  return world;
}

/** A session workspace as the bind arms leave it. */
export function sessionWorkspace({ id, urlKey, bindings = [] }) {
  return { id, urlKey, bindings };
}

/**
 * The explicit-injection shorthand for a bind-arm mount:
 * `createAuthRoutes({ provider, ...withResolver(), ...stores })`.
 * Each call builds its own empty world unless one is passed, so a test that
 * needs seeded history passes `withResolver(world)`.
 */
export function withResolver(world = createResolverWorld()) {
  return { resolveWorkspaceUrlKey: world.resolve };
}

/**
 * The resolver exactly as server.js builds it, over REAL stores (MangoDB-backed
 * in the tests that use it): the strict holder finder plus the account stores.
 * Use this when a test must prove "no new rows in the holder stores" on a real
 * bind, instead of the in-memory world above.
 *
 * @param {Object} stores
 * @param {Object} stores.connectionStore
 * @param {Object} stores.ownerCredentialStore
 * @param {Object} stores.accountStore
 * @param {Object} stores.accountWorkspaceStore
 * @param {Object} stores.proxyTokenStore
 * @param {Object} stores.dispatchTokenStore
 * @returns {function(Object): Promise<Object>} `resolveWorkspaceUrlKey`
 */
export function createStoreBackedResolver({
  connectionStore, ownerCredentialStore, accountStore, accountWorkspaceStore, proxyTokenStore, dispatchTokenStore
}) {
  const finder = createUrlKeyHolderFinder({
    readReferents: createReferentHolderReader({ connectionStore, strict: true }),
    ownerCredentialStore,
    proxyTokenStore,
    dispatchTokenStore,
    resolveCanonicalAccountId: (id) => accountStore.resolveCanonicalAccountId(id),
    strict: true
  });
  return createWorkspaceUrlKeyResolver({
    findUrlKeyHolders: (urlKey) => finder.findUrlKeyHolders(urlKey),
    listAccountsForWorkspace: (workspaceId) => accountWorkspaceStore.listAccountsForWorkspace(workspaceId),
    resolveCanonicalAccountId: (id) => accountStore.resolveCanonicalAccountId(id),
    findAccountByIdentity: (provider, scope) => accountStore.findAccountByIdentity(provider, scope)
  });
}
