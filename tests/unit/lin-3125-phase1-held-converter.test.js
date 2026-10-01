/**
 * LIN-3125 Phase 1 (C1/C3) — the referent-only store write and the held mode of
 * `convertToConnectionBacked`.
 *
 * Against a REAL MangoDB tmpdir instance (precedent:
 * `lin-3124-pr2-connection-store.test.js`): the store claims under test are the
 * `$addToSet`/no-upsert semantics and that credentials are untouched, so a mock
 * would encode the assumption instead of testing it. The held converter is
 * driven over that store with a write-spy wrapper so "zero writes" and "never
 * `link()`" are observed, not assumed.
 *
 * Run with: node --test tests/unit/lin-3125-phase1-held-converter.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { convertToConnectionBacked } from '../../lib/connection-credential.js';
import { readBindingCredential } from '../../lib/connection-binding.js';

const ACCT = 'acct-1';
const PROVIDER = 'github';
const SCOPE = 'octocat/hello';
const CREDS = { token: 'ghs_held', installationId: '77', tokenExpiresAt: Date.now() + 3_600_000 };
const REFERENT = { urlKey: 'acme', provider: PROVIDER, scope: SCOPE };
// A held connection is connection-managed: it already carries a referent from
// the workspace it was first attached to. A put-born row (no `referents`) is
// NOT a held connection (L1).
const PRIOR_REFERENT = { urlKey: 'prior', provider: PROVIDER, scope: 'octocat/prior' };

describe('LIN-3125 Phase 1 — referent-only store write + held converter (C1/C3)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3125-held-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`lin3125held_${counter++}`);
    return new ConnectionStore({ collection: db.collection('connections') });
  }

  const WRITE_METHODS = ['addReferent', 'link', 'updateCredentials', 'put', 'removeReferent'];

  /** Wrap the store's write methods so every write is logged (reads pass through). */
  function spyWrites(store) {
    const log = [];
    const wrapper = Object.create(store);
    for (const name of WRITE_METHODS) {
      if (typeof store[name] !== 'function') continue;
      const real = store[name].bind(store);
      wrapper[name] = async (...args) => { log.push(name); return real(...args); };
    }
    return { store: wrapper, log };
  }

  /** Seed one held (connection-managed) connection and a session workspace. */
  async function seed(store, { accountId = ACCT, hasWorkspace = true, accountIdInSession = ACCT } = {}) {
    const connectionId = store._id(accountId, PROVIDER, '77');
    await store.link(accountId, PROVIDER, '77', CREDS, PRIOR_REFERENT);
    const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
    const session = { accountId: accountIdInSession, workspaces: hasWorkspace ? [workspace] : [] };
    return { connectionId, workspace, session };
  }

  function convert(store, seedResult, over = {}) {
    return convertToConnectionBacked({
      connectionStore: store,
      session: seedResult.session,
      accountId: ACCT,
      workspaceId: 'ws-1',
      provider: PROVIDER,
      scope: SCOPE,
      heldConnectionId: seedResult.connectionId,
      writesEnabled: true,
      ...over,
    });
  }

  // -------------------------------------------------------------------------
  // addReferent
  // -------------------------------------------------------------------------

  describe('ConnectionStore.addReferent', () => {
    test('adds a referent to an existing connection-managed row, is idempotent, and never touches credentials', async () => {
      const store = freshStore();
      const acct = 'acct-add';
      const id = store._id(acct, PROVIDER, '77');
      await store.link(acct, PROVIDER, '77', CREDS, PRIOR_REFERENT);
      assert.deepEqual((await store.readConnectionById(id)).referents, [PRIOR_REFERENT], 'link with a referent makes the row connection-managed');

      assert.equal(await store.addReferent(id, REFERENT), true);
      assert.equal(await store.addReferent(id, REFERENT), true, 'idempotent on the same referent');

      const row = await store.readConnectionById(id);
      assert.deepEqual(row.referents, [PRIOR_REFERENT, REFERENT], 'the same referent is not duplicated ($addToSet)');
      assert.deepEqual(row.credentials, { token: 'ghs_held', installationId: '77', tokenExpiresAt: row.credentials.tokenExpiresAt }, 'credentials are untouched');
    });

    test('a put-born row (no referents) is refused: false, the field is still absent (L1)', async () => {
      const store = freshStore();
      const acct = 'acct-put';
      const id = store._id(acct, PROVIDER, '77');
      await store.put(acct, PROVIDER, '77', CREDS);
      assert.equal((await store.readConnectionById(id)).referents, undefined, 'put leaves the field absent');

      assert.equal(await store.addReferent(id, REFERENT), false, 'a dual-write row is never turned connection-managed');
      const row = await store.readConnectionById(id);
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'referents'), false, 'no referents field is created');
    });

    test('a missing row is false and never upserts a new row', async () => {
      const store = freshStore();
      const id = store._id('acct-missing', PROVIDER, '77');
      assert.equal(await store.addReferent(id, REFERENT), false);
      assert.equal(await store.readConnectionById(id), null, 'no upsert');
    });

    test('a missing connectionId or referent is false', async () => {
      const store = freshStore();
      assert.equal(await store.addReferent(null, REFERENT), false);
      assert.equal(await store.addReferent('x', null), false);
    });
  });

  // -------------------------------------------------------------------------
  // Held mode (C3)
  // -------------------------------------------------------------------------

  describe('convertToConnectionBacked held mode (C3)', () => {
    test('success: addReferent (never link), binds {provider, scope, connectionId}, no credential copy, no freshness stamp', async () => {
      const real = freshStore();
      const seedResult = await seed(real);
      const { store, log } = spyWrites(real);

      const out = await convert(store, seedResult);

      assert.equal(out.connectionBacked, true);
      assert.equal(out.connectionId, seedResult.connectionId);
      assert.equal(out.error, null);
      assert.deepEqual(log, ['addReferent'], 'the held write is addReferent, never link');

      const binding = seedResult.workspace.bindings.find(b => b.provider === PROVIDER && b.scope === SCOPE);
      assert.deepEqual(binding, { provider: PROVIDER, scope: SCOPE, connectionId: seedResult.connectionId });
      assert.equal('credentials' in binding, false, 'no credential is copied onto the binding');
      assert.equal(readBindingCredential(binding).token, 'ghs_held', 'the side-table serves the held credential for this request');

      const row = await real.readConnectionById(seedResult.connectionId);
      assert.deepEqual(row.referents, [PRIOR_REFERENT, REFERENT]);
      assert.deepEqual(row.credentials, { token: 'ghs_held', installationId: '77', tokenExpiresAt: row.credentials.tokenExpiresAt }, 'the held credential is never rewritten');
      assert.equal(seedResult.session.identityAuthenticatedAt, undefined, 'no freshness stamp');
    });

    test('D11 off: retryable, zero writes', async () => {
      const real = freshStore();
      const seedResult = await seed(real);
      const before = await real.readConnectionById(seedResult.connectionId);
      const { store, log } = spyWrites(real);

      const out = await convert(store, seedResult, { writesEnabled: false });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable');
      assert.deepEqual(log, [], 'no store write when writes are off');
      assert.deepEqual(seedResult.workspace.bindings, [], 'no binding written');
      assert.deepEqual(await real.readConnectionById(seedResult.connectionId), before, 'the full row is unmutated');
    });

    test('missing workspace: retryable, never a legacy result, zero writes', async () => {
      const real = freshStore();
      const seedResult = await seed(real, { hasWorkspace: false });
      const { store, log } = spyWrites(real);

      const out = await convert(store, seedResult);

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable', 'never the legacy {error:null} result');
      assert.deepEqual(log, []);
    });

    test('missing accountId: retryable, never a legacy result, zero writes', async () => {
      const real = freshStore();
      const seedResult = await seed(real);
      const { store, log } = spyWrites(real);

      const out = await convert(store, seedResult, { accountId: null });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable');
      assert.deepEqual(log, []);
    });

    test('missing connection row: retryable, zero writes', async () => {
      const real = freshStore();
      const seedResult = await seed(real);
      const { store, log } = spyWrites(real);

      const out = await convert(store, { ...seedResult, connectionId: 'acct-1::github::does-not-exist' });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable');
      assert.deepEqual(log, []);
    });

    test('a foreign account\u2019s connection is refused: retryable, zero writes, no referent', async () => {
      const real = freshStore();
      // The row exists, is connection-managed, but is owned by another account.
      const foreignId = real._id('acct-other', PROVIDER, '77');
      await real.link('acct-other', PROVIDER, '77', CREDS, PRIOR_REFERENT);
      const before = await real.readConnectionById(foreignId);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { store, log } = spyWrites(real);

      const out = await convert(store, { connectionId: foreignId, workspace, session });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable');
      assert.deepEqual(log, [], 'an unauthorized connection is never written');
      assert.deepEqual(await real.readConnectionById(foreignId), before, 'the full foreign row is untouched');
    });

    test('L1: a put-born connection (no referents) is retryable with zero writes and stays unmutated', async () => {
      const real = freshStore();
      const id = real._id(ACCT, PROVIDER, '77');
      await real.put(ACCT, PROVIDER, '77', CREDS);
      const before = await real.readConnectionById(id);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { store, log } = spyWrites(real);

      const out = await convert(store, { connectionId: id, workspace, session });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable', 'never the legacy {error:null} result');
      assert.deepEqual(log, [], 'a put-born row is refused before any write');
      assert.deepEqual(workspace.bindings, [], 'no binding written');
      const after = await real.readConnectionById(id);
      assert.deepEqual(after, before, 'the full put-born row is unmutated');
      assert.equal(Object.prototype.hasOwnProperty.call(after, 'referents'), false, 'no referents field was created');
    });

    test('L2: a provider mismatch is retryable, makes zero writes and leaves the binding unchanged', async () => {
      const real = freshStore();
      // A github-projects row, connection-managed, offered for a github add.
      const id = real._id(ACCT, 'github-projects', '77');
      const prior = { urlKey: 'prior', provider: 'github-projects', scope: 'acme/board' };
      await real.link(ACCT, 'github-projects', '77', CREDS, prior);
      const before = await real.readConnectionById(id);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { store, log } = spyWrites(real);

      const out = await convert(store, { connectionId: id, workspace, session });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable', 'a cross-provider held add is refused');
      assert.deepEqual(log, [], 'zero writes on a provider mismatch');
      assert.deepEqual(workspace.bindings, [], 'no binding written');
      assert.deepEqual(await real.readConnectionById(id), before, 'the full row is untouched');
    });
  });

  // -------------------------------------------------------------------------
  // Credentials-mode regression pins
  // -------------------------------------------------------------------------

  describe('credentials mode is unchanged (no heldConnectionId)', () => {
    test('creation still converts through link()', async () => {
      const real = freshStore();
      const { store, log } = spyWrites(real);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };

      const out = await convertToConnectionBacked({
        connectionStore: store,
        session,
        accountId: ACCT,
        workspaceId: 'ws-1',
        provider: PROVIDER,
        scope: SCOPE,
        credentials: { installationId: '77', token: 'ghs', tokenExpiresAt: Date.now() + 3_600_000 },
        prior: 'none',
        writesEnabled: true,
      });

      assert.equal(out.connectionBacked, true);
      assert.equal(out.connectionId, 'acct-1::github::77');
      assert.ok(log.includes('link'), 'the credentials mode still writes through link()');
    });

    test('with writes off, an eligible creation returns the legacy result (not retryable)', async () => {
      const real = freshStore();
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };

      const out = await convertToConnectionBacked({
        connectionStore: real,
        session,
        accountId: ACCT,
        workspaceId: 'ws-1',
        provider: PROVIDER,
        scope: SCOPE,
        credentials: { installationId: '77', token: 'ghs', tokenExpiresAt: Date.now() + 3_600_000 },
        prior: 'none',
        writesEnabled: false,
      });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, null, 'legacy, not retryable');
      assert.deepEqual(workspace.bindings, []);
    });
  });
});
