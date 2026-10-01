/**
 * LIN-3136 (plan fixture class B2): a dispatch-capable writer token for tests
 * that run the enqueue mounts over a REAL ProxyTokenStore.
 *
 * Once `requireGrant('dispatch')` gates `POST /api/proxy/dispatch`,
 * `/recommend-and-dispatch` and `/autopilot/kickoff`, a `createToken(readWrite)`
 * writer is refused: `createToken` is grant-less by construction. The writer
 * here comes from the production path instead: the owner-checked
 * `mintGrantBootstrap` (`['dispatch']`, `worker` profile, as a driver copy
 * mints) and then `exchangeBootstrapToken`.
 *
 * The mint runs on a SECOND store instance over the same collection, with its
 * own owner check that answers `owner` for exactly this writer. So the test's
 * own store keeps its owner-check seam and any mint spies untouched (several
 * callers fault, transfer or count that seam), and `validateToken` on the
 * test's store still finds the working token, because both read one
 * collection. The writer's `createdBy` is the account passed in, so a test
 * that threads the poster's identity keeps it.
 */
import { ProxyTokenStore } from '../../../lib/proxy-tokens.js';

const DEFAULT_WORKSPACE_ID = 'ws-dispatch-writer';

/**
 * Mint and exchange a `readWrite` + `['dispatch']` working token.
 *
 * @param {ProxyTokenStore} store - the test's real store (its collection is shared)
 * @param {Object} options
 * @param {string} options.urlKey - workspace URL key the token belongs to
 * @param {string} options.ownerAccountId - the writer's account (`createdBy`)
 * @param {string} [options.workspaceId] - stamped on the token (M1 reads it)
 * @param {string} [options.label]
 * @returns {Promise<Object>} the exchanged working token (`token`, `grants`, …)
 */
export async function mintDispatchWriter(store, { urlKey, ownerAccountId, workspaceId = DEFAULT_WORKSPACE_ID, label = 'dispatch-writer' } = {}) {
  if (!store?.collection) throw new Error('mintDispatchWriter: a real ProxyTokenStore is required');
  if (!urlKey || !ownerAccountId) throw new Error('mintDispatchWriter: urlKey and ownerAccountId are required');

  const minter = new ProxyTokenStore({ collection: store.collection });
  minter.setOwnerCheck(async (query) => ({
    status: query.workspaceId === workspaceId && query.accountId === ownerAccountId ? 'owner' : 'not-owner'
  }));

  const bootstrap = await minter.mintGrantBootstrap({
    urlKey, workspaceId, ownerAccountId, grants: ['dispatch'], label, profile: 'worker'
  });
  const working = await minter.exchangeBootstrapToken(bootstrap.token);
  if (!working?.token) throw new Error('mintDispatchWriter: the bootstrap did not exchange');
  return working;
}

/**
 * For a test that destructures its writer straight out of a `createToken` call:
 * the store's NEXT `createToken` call returns a dispatch writer for the same
 * `urlKey` instead, and the original method is restored before it resolves, so
 * every later `createToken` (e.g. a route's own leaf-bootstrap mint) is the real
 * one.
 *
 * @param {ProxyTokenStore} store
 * @param {Object} options - as `mintDispatchWriter`, minus `urlKey`
 */
export function armDispatchWriterOnce(store, options = {}) {
  const hadOwn = Object.prototype.hasOwnProperty.call(store, 'createToken');
  const original = store.createToken;
  store.createToken = async (urlKey) => {
    if (hadOwn) store.createToken = original;
    else delete store.createToken;
    return mintDispatchWriter(store, { ...options, urlKey });
  };
}
