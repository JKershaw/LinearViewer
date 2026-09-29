/**
 * Unit tests for lib/connection-store.js (LIN-3127, Session 1 of LIN-2149).
 *
 * Run with: node --test tests/unit/connection-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent:
 * tests/unit/owner-credential-store.test.js) — this store's whole claim is the
 * idempotent composite-`_id` upsert, so a mock would encode the assumption
 * instead of testing it.
 *
 * Covers:
 * - ConnectionStore put/get/upsert-idempotent/partition-isolation
 * - provider normalization in the `_id` and the stored `provider`
 * - the explicit credential-field whitelist (never the object wholesale)
 * - never-throws / false-on-missing-key-parts
 * - unitIdForBinding per provider
 * - writeConnection reading the binding back and the Jira Basic token omission
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { linkProvider } from '../../lib/workspace.js';
import {
  ConnectionStore,
  unitIdForBinding,
  writeConnection
} from '../../lib/connection-store.js';

describe('connection-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'connection-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`cs_${counter++}`);
    return new ConnectionStore({ collection: db.collection('connections') });
  }

  // CS1
  test('null on a missing point read, never throws', async () => {
    const store = freshStore();
    const result = await store.readConnectionByParts('acct-1', 'github', 'install-1');
    assert.strictEqual(result, null);
  });

  // CS2
  test('put persists a record retrievable by get, keyed on accountId::provider::unitId', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const credentials = { installationId: 'install-1', token: 'gh-tok', tokenExpiresAt: 123 };

    const ok = await store.put(accountId, 'github', 'install-1', credentials);
    assert.strictEqual(ok, true);

    const fetched = await store.readConnectionByParts(accountId, 'github', 'install-1');
    assert.ok(fetched, 'record should be retrievable after put');
    assert.strictEqual(fetched._id, `${accountId}::github::install-1`);
    assert.strictEqual(fetched.accountId, accountId);
    assert.strictEqual(fetched.provider, 'github');
    assert.strictEqual(fetched.unitId, 'install-1');
    assert.strictEqual(fetched.credentials.token, 'gh-tok');
    assert.strictEqual(fetched.credentials.installationId, 'install-1');
    assert.strictEqual(fetched.credentials.tokenExpiresAt, 123);
    assert.ok(fetched.createdAt instanceof Date);
    assert.ok(fetched.updatedAt instanceof Date);
  });

  // CS3 — the load-bearing "repairs in place" guarantee
  test('a second put for the same (account, provider, unitId) repairs in place, never creating a second record', async () => {
    const store = freshStore();
    const accountId = randomUUID();

    await store.put(accountId, 'github', 'install-1', { installationId: 'install-1', token: 'tok-1' });
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.put(accountId, 'github', 'install-1', { installationId: 'install-1', token: 'tok-2' });

    const fetched = await store.readConnectionByParts(accountId, 'github', 'install-1');
    assert.strictEqual(fetched.credentials.token, 'tok-2', 'the most recent write must win');

    const all = await store.collection.find({ accountId, provider: 'github', unitId: 'install-1' }).toArray();
    assert.strictEqual(all.length, 1, 'exactly one document should exist for this connection');
  });

  // CS4 — partition isolation on every component of the key
  test('put for a different accountId/provider/unitId creates a separate record', async () => {
    const store = freshStore();
    const accountA = randomUUID();
    const accountB = randomUUID();

    await store.put(accountA, 'github', 'install-1', { installationId: 'install-1', token: 'a' });
    await store.put(accountB, 'github', 'install-1', { installationId: 'install-1', token: 'b' });
    await store.put(accountA, 'github', 'install-2', { installationId: 'install-2', token: 'c' });
    await store.put(accountA, 'linear', 'install-1', { token: 'd' });

    assert.strictEqual((await store.readConnectionByParts(accountA, 'github', 'install-1')).credentials.token, 'a');
    assert.strictEqual((await store.readConnectionByParts(accountB, 'github', 'install-1')).credentials.token, 'b');
    assert.strictEqual((await store.readConnectionByParts(accountA, 'github', 'install-2')).credentials.token, 'c');
    assert.strictEqual((await store.readConnectionByParts(accountA, 'linear', 'install-1')).credentials.token, 'd');
    assert.strictEqual(await store.readConnectionByParts(accountB, 'github', 'install-2'), null);
  });

  // CS5 — provider normalization (LIN-1887 convention, via normalizeProviderName)
  test('normalizes the provider in the _id and stores the normalized provider', async () => {
    const store = freshStore();

    // normalizeProviderName applies the legacy default in the key derivation.
    assert.strictEqual(store._id('acct-1', undefined, 'org-1'), 'acct-1::linear::org-1');
    assert.strictEqual(store._id('acct-1', 'linear', 'org-1'), 'acct-1::linear::org-1');

    // A real provider string (including github-projects) round-trips verbatim.
    const accountId = randomUUID();
    await store.put(accountId, 'github-projects', 'install-1', { installationId: 'install-1', token: 'x' });
    const fetched = await store.readConnectionByParts(accountId, 'github-projects', 'install-1');
    assert.strictEqual(fetched._id, `${accountId}::github-projects::install-1`);
    assert.strictEqual(fetched.provider, 'github-projects');
  });

  // CS6 — explicit credential-field whitelist
  test('stores only the whitelisted credential fields, never the object wholesale', async () => {
    const store = freshStore();
    const accountId = randomUUID();

    await store.put(accountId, 'jira', 'https://acme.atlassian.net', {
      token: 'tok',
      tokenExpiresAt: 42,
      installationId: 'install-x',
      email: 'me@acme.test',
      authType: 'oauth',
      cloudId: 'cloud-1',
      apiToken: 'SHOULD-NEVER-LAND',
      refreshToken: 'SHOULD-NEVER-LAND',
      secret: 'SHOULD-NEVER-LAND'
    });

    const fetched = await store.readConnectionByParts(accountId, 'jira', 'https://acme.atlassian.net');
    assert.deepStrictEqual(fetched.credentials, {
      token: 'tok',
      tokenExpiresAt: 42,
      installationId: 'install-x',
      email: 'me@acme.test',
      authType: 'oauth',
      cloudId: 'cloud-1'
    });
    assert.strictEqual(fetched.credentials.apiToken, undefined);
    assert.strictEqual(fetched.credentials.refreshToken, undefined);
    assert.strictEqual(fetched.credentials.secret, undefined);
  });

  // CS7 — guards: missing key parts fail safe (no throw, no write)
  test('put without accountId/provider/unitId returns false and writes nothing', async () => {
    const store = freshStore();
    const accountId = randomUUID();

    assert.strictEqual(await store.put(null, 'github', 'install-1', { token: 'x' }), false);
    assert.strictEqual(await store.put(accountId, 'github', '', { token: 'x' }), false);
    assert.strictEqual(await store.put(accountId, 'github', null, { token: 'x' }), false);
    assert.strictEqual(await store.put(accountId, null, 'install-1', { token: 'x' }), false);
    assert.strictEqual(await store.put('', 'github', 'install-1', { token: 'x' }), false);
  });

  // CS8 — never throws, even when the collection does
  test('put/never throws when the collection throws; returns false', async () => {
    const exploding = {
      async updateOne() { throw new Error('boom'); },
      async findOne() { throw new Error('boom'); }
    };
    const store = new ConnectionStore({ collection: exploding });

    assert.strictEqual(await store.put('acct-1', 'github', 'install-1', { token: 'x' }), false);
    assert.strictEqual(await store.readConnectionByParts('acct-1', 'github', 'install-1'), null);
  });

  // CS9 — the bare OwnerCredentialStore-style verbs are still absent; LIN-3124
  // PR2's deletion authority is the narrow referent-gated lifecycle (T7).
  test('the store exposes no bare delete/deleteAll (narrow lifecycle instead)', () => {
    const store = new ConnectionStore({ collection: {} });
    assert.strictEqual(typeof store.delete, 'undefined');
    assert.strictEqual(typeof store.deleteAll, 'undefined');
  });
});

describe('unitIdForBinding', () => {
  // UI1
  test('github uses the installation id', () => {
    assert.strictEqual(
      unitIdForBinding({ provider: 'github', credentials: { installationId: 'install-7' } }),
      'install-7'
    );
  });

  // UI2
  test('github-projects uses the installation id', () => {
    assert.strictEqual(
      unitIdForBinding({ provider: 'github-projects', credentials: { installationId: 'install-8' } }),
      'install-8'
    );
  });

  // UI3
  test('jira uses the binding scope (site URL), never cloudId', () => {
    assert.strictEqual(
      unitIdForBinding({ provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { cloudId: 'cloud-1' } }),
      'https://acme.atlassian.net'
    );
  });

  // UI4
  test('linear uses the binding scope (org id)', () => {
    assert.strictEqual(
      unitIdForBinding({ provider: 'linear', scope: 'org-42', credentials: { token: 'x' } }),
      'org-42'
    );
  });

  // UI5
  test('an unknown provider (e.g. local) declares no unit id', () => {
    assert.strictEqual(unitIdForBinding({ provider: 'local', scope: 'wksp', credentials: {} }), null);
  });
});

describe('writeConnection', () => {
  function sampleWorkspace(provider, scope, credentials) {
    const workspace = { bindings: [] };
    linkProvider(workspace, provider, scope, credentials);
    return workspace;
  }

  // WC1 — reads the post-linkProvider merged binding back, not the call literal
  test('writes the binding\'s merged credentials after linkProvider', async () => {
    // Seed an existing jira binding with `email`, then upgrade in place with an
    // OAuth credential that does not itself carry `email` — linkProvider merges.
    const workspace = sampleWorkspace('jira', 'https://acme.atlassian.net', {
      token: 'basic-tok',
      email: 'me@acme.test'
    });
    linkProvider(workspace, 'jira', 'https://acme.atlassian.net', {
      token: 'oauth-tok',
      authType: 'oauth',
      cloudId: 'cloud-1'
    });

    const store = new ConnectionStore({ collection: { async updateOne() {} } });
    let written;
    store.put = async (accountId, provider, unitId, credentials) => {
      written = { accountId, provider, unitId, credentials };
      return true;
    };

    await writeConnection(store, 'acct-1', workspace, 'jira', 'https://acme.atlassian.net');

    assert.deepStrictEqual(written, {
      accountId: 'acct-1',
      provider: 'jira',
      unitId: 'https://acme.atlassian.net',
      credentials: { token: 'oauth-tok', email: 'me@acme.test', authType: 'oauth', cloudId: 'cloud-1' }
    });
  });

  // WC2 — the Jira Basic token omission (lin3127-jira-basic-retention, John-confirmed)
  test('omits the Jira Basic token, keeping only non-secret fields', async () => {
    const workspace = sampleWorkspace('jira', 'https://acme.atlassian.net', {
      token: 'basic-secret-tok',
      email: 'me@acme.test'
    });

    const store = new ConnectionStore({ collection: { async updateOne() {} } });
    let written;
    store.put = async (accountId, provider, unitId, credentials) => {
      written = { provider, unitId, credentials };
      return true;
    };

    await writeConnection(store, 'acct-1', workspace, 'jira', 'https://acme.atlassian.net');

    assert.deepStrictEqual(written.credentials, { email: 'me@acme.test' });
    assert.strictEqual(written.credentials.token, undefined);
  });

  // WC3 — OAuth jira is NOT omitted
  test('stores the Jira OAuth token (authType: oauth)', async () => {
    const workspace = sampleWorkspace('jira', 'https://acme.atlassian.net', {
      token: 'oauth-tok',
      authType: 'oauth',
      cloudId: 'cloud-1'
    });

    const store = new ConnectionStore({ collection: { async updateOne() {} } });
    let written;
    store.put = async (accountId, provider, unitId, credentials) => {
      written = { credentials };
      return true;
    };

    await writeConnection(store, 'acct-1', workspace, 'jira', 'https://acme.atlassian.net');
    assert.strictEqual(written.credentials.token, 'oauth-tok');
  });

  // WC4 — github proceeds through the same helper
  test('writes a github record keyed by installation id', async () => {
    const workspace = sampleWorkspace('github', 'acme/repo-a', {
      installationId: 'install-9',
      token: 'gh-tok',
      tokenExpiresAt: 7
    });

    const store = new ConnectionStore({ collection: { async updateOne() {} } });
    let written;
    store.put = async (accountId, provider, unitId, credentials) => {
      written = { accountId, provider, unitId, credentials };
      return true;
    };

    await writeConnection(store, 'acct-1', workspace, 'github', 'acme/repo-a');

    assert.deepStrictEqual(written, {
      accountId: 'acct-1',
      provider: 'github',
      unitId: 'install-9',
      credentials: { installationId: 'install-9', token: 'gh-tok', tokenExpiresAt: 7 }
    });
  });

  // WC5 — optional dependency: absent store is a no-op
  test('no-ops when no connectionStore is provided', async () => {
    const workspace = sampleWorkspace('github', 'acme/repo-a', { installationId: 'install-9', token: 'x' });
    await assert.doesNotReject(writeConnection(undefined, 'acct-1', workspace, 'github', 'acme/repo-a'));
  });

  // WC6 — unknown provider / no unit id is a no-op
  test('no-ops for a provider with no derivable unit id', async () => {
    const workspace = sampleWorkspace('local', 'wksp', { token: 'wksp' });
    let called = false;
    const store = new ConnectionStore({ collection: {} });
    store.put = async () => { called = true; return true; };
    await writeConnection(store, 'acct-1', workspace, 'local', 'wksp');
    assert.strictEqual(called, false);
  });

  // WC7 — binding not found is a no-op
  test('no-ops when the binding is not present on the workspace', async () => {
    const workspace = { bindings: [] };
    let called = false;
    const store = new ConnectionStore({ collection: {} });
    store.put = async () => { called = true; return true; };
    await writeConnection(store, 'acct-1', workspace, 'github', 'acme/repo-a');
    assert.strictEqual(called, false);
  });

  // WC8 — best-effort at the HELPER level (N4): its own errors never escape
  test('swallows its own errors (binding lookup/derivation), never rethrowing', async () => {
    const brokenWorkspace = { bindings: null };
    const store = new ConnectionStore({ collection: {} });
    await assert.doesNotReject(
      writeConnection(store, 'acct-1', brokenWorkspace, 'github', 'acme/repo-a')
    );
  });

  // WC9 — best-effort when put itself throws
  test('swallows a throwing put, never rethrowing', async () => {
    const workspace = sampleWorkspace('github', 'acme/repo-a', { installationId: 'install-9', token: 'x' });
    const store = new ConnectionStore({ collection: {} });
    store.put = async () => { throw new Error('put boom'); };
    await assert.doesNotReject(writeConnection(store, 'acct-1', workspace, 'github', 'acme/repo-a'));
  });

  // WC10 — explicit omitToken override (the Jira Basic bypass hardening,
  // lin3127-jira-basic-retention). A Basic add-source onto a site that already
  // holds an OAuth binding keeps `authType: 'oauth'` from the old credentials
  // via linkProvider's merge, so the authType check alone would let the Basic
  // API token through. The seam passes { omitToken: true } unconditionally.
  test('omits the token when { omitToken: true } is passed, even when the binding looks OAuth', async () => {
    const workspace = sampleWorkspace('jira', 'https://acme.atlassian.net', {
      token: 'basic-api-token',
      email: 'me@acme.test',
      authType: 'oauth'
    });
    const store = new ConnectionStore({ collection: { async updateOne() {} } });
    let written;
    store.put = async (accountId, provider, unitId, credentials) => { written = credentials; return true; };

    await writeConnection(store, 'acct-1', workspace, 'jira', 'https://acme.atlassian.net', { omitToken: true });

    assert.deepStrictEqual(written, { email: 'me@acme.test', authType: 'oauth' });
    assert.strictEqual(written.token, undefined);
  });
});
