/**
 * LIN-4496 (piece 5 of LIN-4491): the records route harness, extracted from tests/unit/lin-4493-records-routes.test.js so
 * the piece-2 route tests and the walk-8 replay share one real-store harness instead of two copies.
 *
 * What is real: the store (RecordsStore on a MangoDB engine), the routes (routes/proxy-records.js), the stage write gate
 * (lib/stage-write-gate.js), the checked pipeline behind the routes, and the token store (ProxyTokenStore), which mints
 * and validates the credentials the replay sends.
 *
 * What is stood in: the credential middleware. routes/proxy.js builds authenticateProxyToken inside a factory that
 * needs the whole proxy wiring, so this harness uses `authenticateProxyToken` below: it asks the real token store to
 * validate the bearer token and copies the same request fields routes/proxy.js copies (proxyUrlKey, proxyOrigin,
 * proxyRunRecordId, proxyCreatedBy, proxyWrites, proxyWritesTarget, proxyTokenScope). A caller that needs a different
 * credential (the piece-2 test's stand-in) passes its own `authenticate`.
 *
 * The tracker is stood in by `tickets` (a Map of ticket id to the ticket's read shape), read through `readTicket`, and
 * the outward port (LIN-4503) by `tracker` when a test passes one (tests/helpers/fake-records-tracker.js); with none,
 * the routes make no child ticket and post no summary.
 */
import express from 'express';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createProxyRecordsRoutes } from '../../routes/proxy-records.js';
import { requireWriteScope } from '../../lib/stage-write-gate.js';
import { READ_WRITE } from '../../lib/proxy-scopes.js';
import { TOKEN_ORIGIN, WRITES, personMint } from '../../lib/stage-writes.js';
import { askedOf } from '../../lib/asked-of.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

/**
 * The credential middleware the real routes/proxy.js builds: validate the bearer token with the real store, then copy
 * the same fields onto the request. Returns 401 for a token the store does not accept.
 */
export function tokenAuthenticator(tokenStore) {
  return async function authenticateProxyToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const result = token ? await tokenStore.validateToken(token) : null;
    if (!result) return res.status(401).json({ error: 'Invalid, expired, or consumed token' });
    req.proxyTokenId = result.tokenId;
    req.proxyUrlKey = result.urlKey;
    req.proxyTokenScope = result.scope;
    req.proxyCreatedBy = result.createdBy;
    req.proxyWrites = result.writes ?? null;
    req.proxyWritesTarget = result.writesTarget ?? null;
    req.proxyOrigin = result.origin ?? null;
    req.proxyRunRecordId = result.runRecordId ?? null;
    next();
  };
}

/**
 * Open a records store and an Express app with the records routes mounted, on 127.0.0.1 (the unit-test bind rule).
 *
 * @param {Object} opts
 * @param {ReturnType<import('../fixtures/mango-tmpdir.js').createMangoTmpdir>} opts.harness - a connected Mango harness
 * @param {string} opts.urlKey - the workspace the routes serve
 * @param {Map<string, object>} opts.tickets - ticket id to its read shape (identifier, title, description, state, parent)
 * @param {Array<{accountId: string, name: string}>} opts.people - the workspace people `to` may name
 * @param {Function} [opts.authenticate] - the credential middleware; default: tokenAuthenticator over a real ProxyTokenStore
 * @param {Function} [opts.readTicket] - the tracker read; default: reads `tickets`
 * @param {Function} [opts.tracker] - LIN-4503: the outward port for a request (`(req) => TrackerPort|null`); default: none
 */
export async function createRecordsRouteHarness({ harness, urlKey, tickets, people, authenticate = null, readTicket = null, tracker = null }) {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  const store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const tokenStore = new ProxyTokenStore({ collection: db.collection('proxy-tokens') });
  const authenticateProxyToken = authenticate ?? tokenAuthenticator(tokenStore);
  const routes = createProxyRecordsRoutes({
    recordsStore: store,
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken,
    requireWriteScope,
    logEvent: () => {},
    readTicket: readTicket ?? (async (_req, ref) => tickets.get(ref) ?? null),
    // Production's injection (routes/proxy.js): the one writer rule, lib/asked-of.js askedOf.
    askedText: askedOf,
    stageKinds: Object.keys(STAGE_KINDS),
    listPeople: async () => people,
    tracker
  });
  const app = express();
  app.use(express.json());
  app.use(routes);
  let server = null;
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** Mint a dispatch credential for one run (its writes are the run's stage, filed under that run). */
  async function mintRunToken(runId, label = `run ${runId}`) {
    const { token } = await tokenStore.createToken(urlKey, { label, scope: READ_WRITE, writes: WRITES.NONE, origin: TOKEN_ORIGIN.DISPATCH, runRecordId: runId });
    return token;
  }

  /** Mint a person's credential, stamped to the account it writes as. */
  async function mintPersonToken(accountId, label = `person ${accountId}`) {
    const { token } = await tokenStore.createToken(urlKey, personMint({ label, scope: READ_WRITE, createdBy: accountId }));
    return token;
  }

  async function call(method, path, token, body) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }

  return {
    store,
    db,
    tokenStore,
    base,
    call,
    post: (path, token, body) => call('POST', path, token, body),
    get: (path, token) => call('GET', path, token),
    mintRunToken,
    mintPersonToken,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
