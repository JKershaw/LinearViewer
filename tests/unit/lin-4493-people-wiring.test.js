/**
 * LIN-4493 (decision 4, John's ruling "link-account"): a record is addressed to a person by the name the tracker shows,
 * through the REAL createProxyRoutes wiring (routes/proxy.js), with the production reader (lib/workspace-people.js) on
 * the real stores. Nothing in this file injects a fake people list.
 *
 * Witnesses: `to: "<shown name>"` lands as `person:<accountId>`; a name that no member carries is refused with the
 * names that would work, the people named among them; a member without a name is not among them.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
import { createListWorkspacePeople } from '../../lib/workspace-people.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { READ_WRITE } from '../../lib/proxy-scopes.js';

const harness = createMangoTmpdir('lin-4493-wiring-');
let db;
let server;
let base;
let johnId;
let tokens;

before(() => harness.connect());
after(() => harness.close());
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  server = null;
});

beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const accounts = new AccountStore({ collection: db.collection('accounts') });
  const memberships = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
  const workspaces = new WorkspaceStore({ collection: db.collection('workspaces') });
  assert.equal((await workspaces.registerWorkspace({ id: 'ws-acme', urlKey: 'acme', provider: 'linear' })).ok, true);

  // John signed in through Linear (the name is stored on that identity); Jane is a member with no name on her identity.
  const john = await accounts.createAccount();
  johnId = john._id;
  await accounts.linkIdentity(johnId, 'linear', 'viewer-john', {}, { name: 'John Kershaw' });
  await memberships.bindAccountToWorkspace(johnId, 'ws-acme');
  const jane = await accounts.createAccount();
  await accounts.linkIdentity(jane._id, 'linear', 'viewer-jane', {}, { name: null });
  await memberships.bindAccountToWorkspace(jane._id, 'ws-acme');

  tokens = {
    john: { origin: 'person', createdBy: johnId, urlKey: 'acme', scope: READ_WRITE, writes: null }
  };
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async (token) => tokens[token] ?? null },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'unused', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'unused',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore: { get: async () => null, put: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: null,
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    recordsStore,
    listRecordPeople: createListWorkspacePeople({ workspaceStore: workspaces, accountStore: accounts, accountWorkspaceStore: memberships })
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

async function post(path, token, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

describe('a person is named by the name the tracker shows, through the real proxy wiring', () => {
  test('to: "<the name the tracker shows>" lands as person:<accountId>, filed by the person', async () => {
    const r = await post('/api/proxy/records', 'john', { kind: 'finding', to: 'John Kershaw', says: 'Which branch?', how: 'ask the author' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.to, `person:${johnId}`);
    assert.equal(r.body.by, `person:${johnId}`);
  });

  test('a name no member carries is refused, and the refusal names the people who would work (not the one with no name)', async () => {
    const r = await post('/api/proxy/records', 'john', { kind: 'finding', to: 'Jane Doe', says: 'Are you there?', how: 'ask' });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    const problem = r.body.problems.find((p) => p.field === 'to');
    assert.ok(problem, JSON.stringify(r.body));
    assert.ok(problem.works.includes('John Kershaw'), `works: ${JSON.stringify(problem.works)}`);
    assert.equal(problem.works.some((w) => /viewer-jane|Jane/.test(w)), false, 'a member with no name is not among the people who would work');
  });
});
