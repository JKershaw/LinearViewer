/**
 * LIN-3125 Phase 1 — the held-entry helper (dark).
 *
 * `lib/held-connection-entry.js` is the single decision point for a held entry:
 * the opt-in marker, the SHARED `intent.fresh` predicate, and `resolveHeldEntry`.
 * These tests prove the predicate truth table, the marker's provider gate, the
 * resolver's hold/decline matrix (including D11-off inertness and a foreign
 * connection excluded through the REAL C1 reader), and that the module imports
 * neither the store nor the credential module (C1).
 *
 * Run with: node --test tests/unit/lin-3125-phase1-held-entry.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import {
  HELD_ENTRY_PARAM,
  withHeldMarker,
  isFreshNewWorkspaceIntent,
  resolveHeldEntry,
} from '../../lib/held-connection-entry.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { listAuthorizedAccountConnections } from '../../lib/connection-credential.js';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';

const HELD_PROVIDER = { name: 'github', supports: (m) => m === 'listConnectionScopes' };
const DECLINING_PROVIDER = { name: 'jira', supports: () => false };

describe('LIN-3125 Phase 1 — held-entry helper', () => {
  // -------------------------------------------------------------------------
  // Shared explicit-intent predicate
  // -------------------------------------------------------------------------
  describe('isFreshNewWorkspaceIntent', () => {
    test('true ONLY for the explicit signed-in as-new-workspace intent', () => {
      assert.equal(isFreshNewWorkspaceIntent({ mode: 'new', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true }), true);
    });

    test('false for every other shape', () => {
      const cases = [
        ['add-source is never "new"', { mode: 'add-source', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['restart mode', { mode: 'restart', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['reauth mode', { mode: 'reauth', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['update-return mode', { mode: 'update', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['signed out', { mode: 'new', accountId: null, workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['empty accountId', { mode: 'new', accountId: '', workspaces: [{ id: 'w' }], supportsFreshContainer: true }],
        ['zero workspaces (email-only, LIN-1892 S2-1)', { mode: 'new', accountId: 'a', workspaces: [], supportsFreshContainer: true }],
        ['missing workspaces', { mode: 'new', accountId: 'a', supportsFreshContainer: true }],
        ['no fresh-container surface (github-projects)', { mode: 'new', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: false }],
        ['no descriptor flag', { mode: 'new', accountId: 'a', workspaces: [{ id: 'w' }] }],
        ['empty intent', {}],
      ];
      for (const [label, intent] of cases) {
        assert.equal(isFreshNewWorkspaceIntent(intent), false, label);
      }
    });

    test('the bare entries (restart / re-proof / reauth / fallback / update-return) never satisfy it', () => {
      // Each of those flows reaches the flow handler as a bare mode=new
      // (signed-out or zero-workspace) or an add-source restart — none is the
      // explicit switcher/"as a new workspace" click.
      const bare = [
        { mode: 'new', accountId: null, workspaces: [{ id: 'w' }], supportsFreshContainer: true },
        { mode: 'new', accountId: 'a', workspaces: [], supportsFreshContainer: true },
        { mode: 'add-source', accountId: 'a', workspaces: [{ id: 'w' }], supportsFreshContainer: true },
      ];
      for (const intent of bare) assert.equal(isFreshNewWorkspaceIntent(intent), false, JSON.stringify(intent));
    });
  });

  // -------------------------------------------------------------------------
  // Marker
  // -------------------------------------------------------------------------
  describe('withHeldMarker', () => {
    test('appends the marker only for a listConnectionScopes provider, byte-identical otherwise', () => {
      assert.equal(withHeldMarker('/auth/github', HELD_PROVIDER), '/auth/github?heldConnection=1');
      assert.equal(
        withHeldMarker('/auth/github?mode=add-source&workspace=acme', HELD_PROVIDER),
        '/auth/github?mode=add-source&workspace=acme&heldConnection=1'
      );
      assert.equal(withHeldMarker('/auth/jira/oauth?mode=new', DECLINING_PROVIDER), '/auth/jira/oauth?mode=new');
      assert.equal(withHeldMarker('/auth/github', null), '/auth/github');
    });

    test('is idempotent (set, not append)', () => {
      assert.equal(withHeldMarker('/auth/github?heldConnection=1', HELD_PROVIDER), '/auth/github?heldConnection=1');
      assert.equal(HELD_ENTRY_PARAM, 'heldConnection');
    });
  });

  // -------------------------------------------------------------------------
  // Resolver
  // -------------------------------------------------------------------------
  describe('resolveHeldEntry', () => {
    function harness(over = {}) {
      const calls = { connections: [], canonical: 0 };
      const base = {
        req: {
          query: { heldConnection: '1', mode: 'add-source', workspace: 'acme' },
          session: { accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] },
          params: {},
        },
        provider: HELD_PROVIDER,
        writesEnabled: true,
        getWorkspaceByUrlKey: (session, key) => (session.workspaces || []).find(w => w.urlKey === key) || null,
        resolveCanonicalAccountId: async (id) => { calls.canonical++; return id; },
        supportsFreshContainer: true,
        listAuthorizedAccountConnections: async (args) => { calls.connections.push(args); return [{ _id: 'acct-1::github::77' }]; },
      };
      return { args: { ...base, ...over }, calls };
    }

    test('held add-source: returns the target and consults the injected reader with the canonical account', async () => {
      const { args, calls } = harness();
      const out = await resolveHeldEntry(args);
      assert.deepEqual(out, { provider: 'github', mode: 'add-source', workspaceUrlKey: 'acme' });
      assert.deepEqual(calls.connections, [{ accountId: 'acct-1', provider: 'github' }]);
      assert.equal(calls.canonical, 1, 'the account id is canonicalized before the read');
    });

    test('held new: the shared fresh predicate gates it', async () => {
      const { args } = harness({
        req: { query: { heldConnection: '1', mode: 'new' }, session: { accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] }, params: {} },
      });
      assert.deepEqual(await resolveHeldEntry(args), { provider: 'github', mode: 'new', workspaceUrlKey: null });
    });

    test('no marker: bare, zero reads', async () => {
      const { args, calls } = harness({ req: { query: { mode: 'add-source', workspace: 'acme' }, session: { accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] }, params: {} } });
      assert.equal(await resolveHeldEntry(args), null);
      assert.equal(calls.connections.length, 0);
      assert.equal(calls.canonical, 0);
    });

    test('D11 off: inert, zero reads', async () => {
      const { args, calls } = harness({ writesEnabled: false });
      assert.equal(await resolveHeldEntry(args), null);
      assert.equal(calls.connections.length, 0, 'no connection read when writes are off');
    });

    test('a provider without listConnectionScopes declines, zero reads', async () => {
      const { args, calls } = harness({ provider: DECLINING_PROVIDER });
      assert.equal(await resolveHeldEntry(args), null);
      assert.equal(calls.connections.length, 0);
    });

    test('no signed-in account declines', async () => {
      const { args } = harness({ req: { query: { heldConnection: '1', mode: 'new' }, session: { workspaces: [{ id: 'ws-1', urlKey: 'acme' }] }, params: {} } });
      assert.equal(await resolveHeldEntry(args), null);
    });

    test('add-source with an unknown workspace declines', async () => {
      const { args, calls } = harness({ req: { query: { heldConnection: '1', mode: 'add-source', workspace: 'nope' }, session: { accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] }, params: {} } });
      assert.equal(await resolveHeldEntry(args), null);
      assert.equal(calls.connections.length, 0, 'no read without a valid target workspace');
    });

    test('mode=new without the fresh predicate declines', async () => {
      const { args } = harness({ req: { query: { heldConnection: '1', mode: 'new' }, session: { accountId: 'acct-1', workspaces: [] }, params: {} } });
      assert.equal(await resolveHeldEntry(args), null);
    });

    test('no authorized held connection declines', async () => {
      const { args } = harness({ listAuthorizedAccountConnections: async () => [] });
      assert.equal(await resolveHeldEntry(args), null);
    });

    test('resolves the provider by name through the injected getProvider (Phase 3 route shape)', async () => {
      const { args } = harness({ provider: undefined, getProvider: (name) => (name === 'github' ? HELD_PROVIDER : undefined), req: { query: { heldConnection: '1', mode: 'add-source', workspace: 'acme' }, session: { accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] }, params: { provider: 'github' } } });
      assert.deepEqual(await resolveHeldEntry(args), { provider: 'github', mode: 'add-source', workspaceUrlKey: 'acme' });
    });

    test('builds beginUrl from the injected builder', async () => {
      const { args } = harness({ beginUrlFor: ({ mode, workspaceUrlKey }) => `/auth/github?mode=${mode}&workspace=${workspaceUrlKey}` });
      const out = await resolveHeldEntry(args);
      assert.equal(out.beginUrl, '/auth/github?mode=add-source&workspace=acme');
    });

    test('a foreign account\u2019s connection is excluded through the REAL C1 reader', async () => {
      const dbDir = mkdtempSync(join(tmpdir(), 'lin3125-heldentry-'));
      const client = new MangoClient(dbDir);
      await client.connect();
      try {
        const store = new ConnectionStore({ collection: client.db('held_entry').collection('connections') });
        await store.link('acct-other', 'github', '77', { token: 'ghs', installationId: '77' }, { urlKey: 'acme', provider: 'github', scope: 'o/r' });
        const { args } = harness({
          listAuthorizedAccountConnections: (a) => listAuthorizedAccountConnections({ connectionStore: store, ...a }),
        });
        assert.equal(await resolveHeldEntry(args), null, 'the caller does not own the only held connection');
      } finally {
        if (client?.close) await client.close();
        rmSync(dbDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // C1 static check
  // -------------------------------------------------------------------------
  describe('C1: no store/credential import', () => {
    test('held-connection-entry.js imports neither connection-store.js nor connection-credential.js', () => {
      const src = loadStrippedSources().get('lib/held-connection-entry.js');
      assert.ok(src, 'the module is in the stripped source corpus');
      assert.doesNotMatch(src, /from\s+['"][^'"]*connection-store\.js['"]/, 'must not import the store');
      assert.doesNotMatch(src, /from\s+['"][^'"]*connection-credential\.js['"]/, 'must not import the credential module');
    });
  });
});
