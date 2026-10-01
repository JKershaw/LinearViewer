/**
 * LIN-3125 Phase 2 — the shared `persistBinding` seam.
 *
 * Against the REAL `convertToConnectionBacked` and a REAL MangoDB tmpdir
 * `ConnectionStore` (precedent: `lin-3125-phase1-held-converter.test.js`), so the
 * outcome branches are observed on real rows, not encoded in mocks. The only
 * injection is the `writeConnection` fallback, wrapped so a call is logged and
 * then delegated to the real writer.
 *
 * Run with: node --test tests/unit/lin-3125-phase2-persist-binding.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore, writeConnection } from '../../lib/connection-store.js';
import { convertToConnectionBacked } from '../../lib/connection-credential.js';
import { readBindingCredential } from '../../lib/connection-binding.js';
import { persistBinding } from '../../lib/persist-binding.js';

const ACCT = 'acct-1';
const PROVIDER = 'github';
const SCOPE = 'octocat/hello';
const CREDS = { installationId: '77', token: 'ghs', tokenExpiresAt: Date.now() + 3_600_000 };
const PRIOR_REFERENT = { urlKey: 'prior', provider: PROVIDER, scope: 'octocat/prior' };

function spyWriteConnection() {
  const log = [];
  const fn = async (...args) => { log.push(args); return writeConnection(...args); };
  return { fn, log };
}

describe('LIN-3125 Phase 2 — persistBinding', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3125-persist-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`lin3125persist_${counter++}`);
    return new ConnectionStore({ collection: db.collection('connections') });
  }

  // -------------------------------------------------------------------------
  // Credentials mode — the exact inline convert + fallback semantics.
  // -------------------------------------------------------------------------

  describe('credentials mode', () => {
    test('creation succeeds connection-backed: no legacy fallback write', async () => {
      const store = freshStore();
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding({
        connectionStore: store,
        session,
        accountId: ACCT,
        workspace,
        provider: PROVIDER,
        scope: SCOPE,
        credentials: CREDS,
        prior: 'none',
        writesEnabled: true,
        convertToConnectionBacked,
        writeConnection: fn,
      });

      assert.deepEqual(out, { connectionBacked: true, connectionId: 'acct-1::github::77', error: null });
      assert.equal(log.length, 0, 'a connectionBacked:true result never falls back');
      assert.equal(readBindingCredential(workspace.bindings[0]).token, 'ghs', 'the binding is credential-backed for the request');
    });

    test('connection backed but retryable (failed existing update): no fallback, error surfaces', async () => {
      const store = freshStore();
      // An existing connection-backed binding whose connectionId is unparseable:
      // the converter reports {connectionBacked:true, error:'retryable'} — a
      // downgrade would be wrong, so the legacy write must NOT run.
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [{ provider: PROVIDER, scope: SCOPE, connectionId: 'garbage' }] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding({
        connectionStore: store,
        session,
        accountId: ACCT,
        workspace,
        provider: PROVIDER,
        scope: SCOPE,
        credentials: CREDS,
        prior: 'connection',
        writesEnabled: true,
        convertToConnectionBacked,
        writeConnection: fn,
      });

      assert.equal(out.connectionBacked, true);
      assert.equal(out.error, 'retryable');
      assert.equal(log.length, 0, 'no fallback on connectionBacked:true');
    });

    test('legacy result takes the fallback write (row is written)', async () => {
      const store = freshStore();
      // `linkProvider` already wrote the binding in memory (phase A); prior is
      // 'none' because the site was empty before that. writesEnabled:false keeps
      // the converter on the legacy result.
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [{ provider: PROVIDER, scope: SCOPE, credentials: CREDS }] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding({
        connectionStore: store,
        session,
        accountId: ACCT,
        workspace,
        provider: PROVIDER,
        scope: SCOPE,
        credentials: CREDS,
        prior: 'none',
        writesEnabled: false,
        convertToConnectionBacked,
        writeConnection: fn,
      });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, null, 'legacy, not retryable');
      assert.equal(log.length, 1, 'the legacy writeConnection fallback ran once');
      const row = await store.readConnectionById(store._id(ACCT, PROVIDER, '77'));
      assert.ok(row, 'the fallback actually wrote the connection row');
      assert.equal(row.credentials.token, 'ghs');
    });

    test('legacy result with no store: no fallback and no throw', async () => {
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [{ provider: PROVIDER, scope: SCOPE, credentials: CREDS }] };
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding({
        connectionStore: null,
        session,
        accountId: ACCT,
        workspace,
        provider: PROVIDER,
        scope: SCOPE,
        credentials: CREDS,
        prior: 'none',
        writesEnabled: false,
        convertToConnectionBacked,
        writeConnection: fn,
      });

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, null);
      assert.equal(log.length, 0, 'no store => no fallback');
    });

    test('a throw propagates unchanged so the caller catch fires', async () => {
      const boom = new Error('converter exploded');
      const { fn, log } = spyWriteConnection();
      await assert.rejects(
        persistBinding({
          connectionStore: {},
          session: {},
          accountId: ACCT,
          workspace: { id: 'ws-1' },
          provider: PROVIDER,
          scope: SCOPE,
          credentials: CREDS,
          writesEnabled: true,
          convertToConnectionBacked: async () => { throw boom; },
          writeConnection: fn,
        }),
        (err) => err === boom,
      );
      assert.equal(log.length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Held mode (C3 convert-only + F3 snapshot/restore)
  // -------------------------------------------------------------------------

  describe('held mode', () => {
    async function seedHeld(store, { accountId = ACCT, provider = PROVIDER, putBorn = false } = {}) {
      const connectionId = store._id(accountId, provider, '77');
      if (putBorn) await store.put(accountId, provider, '77', CREDS);
      else await store.link(accountId, provider, '77', CREDS, PRIOR_REFERENT);
      return { connectionId };
    }

    function heldArgs(store, workspace, session, connectionId, { snapshot, fn, ...over } = {}) {
      return {
        connectionStore: store,
        session,
        accountId: ACCT,
        workspace,
        provider: PROVIDER,
        scope: SCOPE,
        heldConnectionId: connectionId,
        workspacesSnapshot: snapshot,
        writesEnabled: true,
        convertToConnectionBacked,
        writeConnection: fn,
        ...over,
      };
    }

    test('success: referent added, binding connection-backed, no fallback, session untouched', async () => {
      const store = freshStore();
      const { connectionId } = await seedHeld(store);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const snapshot = [workspace];
      const originalWorkspaces = [workspace];
      const session = { accountId: ACCT, workspaces: originalWorkspaces };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding(heldArgs(store, workspace, session, connectionId, { snapshot, fn }));

      assert.deepEqual(out, { connectionBacked: true, connectionId, error: null });
      assert.equal(log.length, 0, 'held mode never falls back');
      assert.deepEqual(workspace.bindings, [{ provider: PROVIDER, scope: SCOPE, connectionId }]);
      assert.equal('credentials' in workspace.bindings[0], false);
      const row = await store.readConnectionById(connectionId);
      assert.deepEqual(row.referents, [PRIOR_REFERENT, { urlKey: 'acme', provider: PROVIDER, scope: SCOPE }]);
      assert.equal(session.workspaces, originalWorkspaces, 'success leaves the session workspaces array alone');
      assert.equal(session.identityAuthenticatedAt, undefined, 'no freshness stamp');
    });

    test('F3: a held failure restores the workspaces snapshot (no half-created workspace survives), retryable, no fallback', async () => {
      const store = freshStore();
      const { connectionId } = await seedHeld(store);
      const kept = { id: 'ws-0', urlKey: 'kept', bindings: [] };
      const halfCreated = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const snapshot = [kept];
      const session = { accountId: ACCT, workspaces: [kept, halfCreated] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding(heldArgs(store, halfCreated, session, connectionId, { snapshot, fn, writesEnabled: false }));

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable');
      assert.equal(log.length, 0, 'held failure never falls back');
      assert.equal(session.workspaces, snapshot, 'restored to the exact snapshot array');
      assert.deepEqual(session.workspaces.map(w => w.id), ['ws-0'], 'the half-created workspace is gone');
    });

    const FAILURES = [
      ['D11 off', { writesEnabled: false }, {}],
      ['missing workspace', {}, { sessionWorkspaces: [] }],
      ['missing accountId', { accountId: null }, {}],
      ['missing row', {}, { connectionId: 'acct-1::github::does-not-exist' }],
      ['foreign row', {}, { foreign: true }],
      ['put-born row', {}, { putBorn: true }],
      ['provider mismatch', {}, { seedProvider: 'github-projects' }],
    ];

    for (const [label, over, shape] of FAILURES) {
      test(`${label}: retryable, zero fallback, session restored`, async () => {
        const store = freshStore();
        const seedProvider = shape.seedProvider || PROVIDER;
        const { connectionId } = await seedHeld(store, {
          accountId: shape.foreign ? 'acct-other' : ACCT,
          provider: seedProvider,
          putBorn: shape.putBorn,
        });
        const kept = { id: 'ws-0', urlKey: 'kept', bindings: [] };
        const halfCreated = { id: 'ws-1', urlKey: 'acme', bindings: [] };
        const snapshot = [kept];
        const session = { accountId: ACCT, workspaces: shape.sessionWorkspaces ?? [kept, halfCreated] };
        const { fn, log } = spyWriteConnection();

        const out = await persistBinding(heldArgs(store, halfCreated, session, shape.connectionId || connectionId, { snapshot, fn, ...over }));

        assert.equal(out.connectionBacked, false, `${label}: never connection-backed`);
        assert.equal(out.error, 'retryable', `${label}: C3 retryable`);
        assert.equal(log.length, 0, `${label}: zero fallback writes`);
        if (shape.sessionWorkspaces === undefined) {
          assert.equal(session.workspaces, snapshot, `${label}: snapshot restored`);
        }
      });
    }

    test('held mode ignores an injected writeConnection even on a legacy-shaped result', async () => {
      const store = freshStore();
      const { connectionId } = await seedHeld(store);
      const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const snapshot = [workspace];
      const session = { accountId: ACCT, workspaces: [workspace] };
      const { fn, log } = spyWriteConnection();

      await persistBinding(heldArgs(store, workspace, session, connectionId, { snapshot, fn }));
      assert.equal(log.length, 0);
    });

    test('held mode: a thrown converter is retryable, restores the snapshot and never falls back', async () => {
      const store = freshStore();
      const kept = { id: 'ws-0', urlKey: 'kept', bindings: [] };
      const halfCreated = { id: 'ws-1', urlKey: 'acme', bindings: [] };
      const snapshot = [kept];
      const session = { accountId: ACCT, workspaces: [kept, halfCreated] };
      const { fn, log } = spyWriteConnection();

      const out = await persistBinding(heldArgs(store, halfCreated, session, 'acct-1::github::77', {
        snapshot,
        fn,
        convertToConnectionBacked: async () => { throw new Error('held boom'); },
      }));

      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, 'retryable', 'a held throw never surfaces as legacy or 500');
      assert.equal(log.length, 0);
      assert.equal(session.workspaces, snapshot, 'snapshot restored');
    });
  });

  // -------------------------------------------------------------------------
  // C1: the module stays import-free
  // -------------------------------------------------------------------------

  describe('C1 placement', () => {
    test('lib/persist-binding.js imports no connection-store / credential / provider / route module', () => {
      const src = readFileSync(fileURLToPath(new URL('../../lib/persist-binding.js', import.meta.url)), 'utf8');
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
      const importLines = code.filter(l => /^\s*(import\b|export\b.*\bfrom\b)/.test(l));
      assert.deepEqual(importLines, [], 'the seam takes everything by injection');
      const dynamicImports = code.filter(l => /\bimport\s*\(/.test(l));
      assert.deepEqual(dynamicImports, [], 'no dynamic imports either');
    });
  });
});
