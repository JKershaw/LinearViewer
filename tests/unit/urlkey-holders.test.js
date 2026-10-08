/**
 * Unit tests for lib/urlkey-holders.js and its store projections (LIN-3381 S1.1).
 *
 * Run with: node --test tests/unit/urlkey-holders.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { holdersFromRows, createUrlKeyHolderFinder } from '../../lib/urlkey-holders.js';
import { createReferentHolderReader } from '../../lib/connection-credential.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { URLKEY_SOURCES, ACTOR_SOURCES } from '../../scripts/dry-run-urlkey-duplicates.mjs';

const T1 = new Date('2026-08-01T00:00:00.000Z');
const T2 = new Date('2026-09-01T00:00:00.000Z');
const ROOT = new URL('../../', import.meta.url).pathname;
const identity = id => id;

describe('holdersFromRows (pure)', () => {
  test('one definition: four stores, canonical ids, ownerless tokens counted not held', () => {
    const merged = { 'acct-old': 'acct-new' };
    const { holdersByKey, ownerlessTokens, unresolvableHolders } = holdersFromRows({
      ownerCredentials: [
        { accountId: 'acct-a', urlKey: 'k', provider: 'linear' },
        { accountId: 'acct-k1', connectionId: 'c1', provider: 'jira' }
      ],
      connectionReferents: [{ _id: 'c1', accountId: 'acct-k1', referents: [{ urlKey: 'k', provider: 'linear', scope: 'org-1' }] }],
      proxyTokens: [{ urlKey: 'k', createdBy: 'acct-old', createdAt: T2, workspaceId: 'W1' }, { urlKey: 'k', createdBy: null }],
      dispatchTokens: [{ urlKey: 'k', createdBy: 'acct-new', createdAt: T1 }, { urlKey: 'k', createdBy: 'acct-bad' }]
    }, id => (id === 'acct-bad' ? null : merged[id] || id));
    const holders = holdersByKey.get('k');
    assert.deepStrictEqual(holders.map(h => h.accountId), ['acct-a', 'acct-k1', 'acct-new']);
    const merged1 = holders.find(h => h.accountId === 'acct-new');
    assert.deepStrictEqual(merged1.sources.sort(), ['dispatch-tokens', 'proxy-tokens']);
    assert.strictEqual(merged1.earliestTokenAt.dispatch, T1.toISOString());
    assert.strictEqual(merged1.earliestTokenAt.proxy, T2.toISOString());
    assert.deepStrictEqual(merged1.linkedWorkspaceIds, ['W1']);
    const viaConnection = holders.find(h => h.accountId === 'acct-k1');
    assert.strictEqual(viaConnection.ownerCredential, true, 'connection-keyed record is evidence through the referent');
    assert.deepStrictEqual(viaConnection.linkedWorkspaceIds, ['org-1'], 'a Linear referent scope is a workspace link');
    assert.strictEqual(ownerlessTokens, 1);
    assert.strictEqual(unresolvableHolders, 1);
  });

  test('a connection-keyed record with no matching connection is no holder', () => {
    const { holdersByKey } = holdersFromRows({ ownerCredentials: [{ accountId: 'a', connectionId: 'gone' }] }, identity);
    assert.strictEqual(holdersByKey.size, 0);
  });
});

describe('createUrlKeyHolderFinder over a seeded store', () => {
  let dir; let client; let finder; let stores;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'urlkey-holders-'));
    client = new MangoClient(dir);
    await client.connect();
    const db = client.db('t');
    stores = {
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      proxyTokenStore: new ProxyTokenStore({ collection: db.collection('proxy-tokens') }),
      dispatchTokenStore: new DispatchTokenStore({ collection: db.collection('dispatch-tokens') })
    };
    finder = createUrlKeyHolderFinder({
      readReferents: createReferentHolderReader({ connectionStore: stores.connectionStore }),
      ownerCredentialStore: stores.ownerCredentialStore,
      proxyTokenStore: stores.proxyTokenStore,
      dispatchTokenStore: stores.dispatchTokenStore,
      resolveCanonicalAccountId: async id => (id === 'acct-old' ? 'acct-new' : id)
    });
    await db.collection('proxy-tokens').insertOne({ _id: 'p1', urlKey: 'k1', createdBy: 'acct-a', createdAt: T1, tokenHash: 'SECRET-HASH' });
    await db.collection('dispatch-tokens').insertMany([
      { _id: 'd1', urlKey: 'k1', createdBy: 'acct-old', createdAt: T1, tokenHash: 'SECRET-HASH' },
      { _id: 'd2', urlKey: 'k2', createdBy: 'acct-z', createdAt: T1, tokenHash: 'SECRET-HASH' }
    ]);
    await db.collection('owner-credentials').insertMany([
      { _id: 'acct-b::k1::linear', accountId: 'acct-b', urlKey: 'k1', provider: 'linear', token: 'SECRET-TOKEN', refreshToken: 'SECRET-RT' },
      { _id: 'c1', connectionId: 'c1', accountId: 'acct-c', provider: 'jira', token: 'SECRET-TOKEN' },
      { _id: 'c2', connectionId: 'c2', accountId: 'acct-q', provider: 'jira', token: 'SECRET-TOKEN' }
    ]);
    await db.collection('connections').insertMany([
      { _id: 'c1', accountId: 'acct-c', provider: 'jira', credentials: { accessToken: 'SECRET-CRED' }, referents: [{ urlKey: 'k1', provider: 'jira' }], createdAt: T1 },
      { _id: 'c2', accountId: 'acct-q', provider: 'jira', credentials: { accessToken: 'SECRET-CRED' }, referents: [{ urlKey: 'k2', provider: 'jira' }], createdAt: T1 },
      { _id: 'c3', accountId: 'acct-n', provider: 'jira', credentials: { accessToken: 'SECRET-CRED' } }
    ]);
  });
  after(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });

  test('findUrlKeyHolders covers all four stores for one key, per-key', async () => {
    const holders = await finder.findUrlKeyHolders('k1');
    assert.deepStrictEqual(holders.map(h => h.accountId), ['acct-a', 'acct-b', 'acct-c', 'acct-new']);
    assert.ok(holders.find(h => h.accountId === 'acct-c').ownerCredential);
    assert.deepStrictEqual((await finder.findUrlKeyHolders('k2')).map(h => h.accountId), ['acct-q', 'acct-z']);
    assert.deepStrictEqual(await finder.findUrlKeyHolders('nope'), []);
  });

  test('loadAllHolders agrees with the per-key lookup', async () => {
    const { holdersByKey } = await finder.loadAllHolders();
    assert.deepStrictEqual([...holdersByKey.keys()].sort(), ['k1', 'k2']);
    for (const [key, holders] of holdersByKey) assert.deepStrictEqual(holders, await finder.findUrlKeyHolders(key));
  });

  test('projections never return a hash, credential or token', async () => {
    const all = JSON.stringify([
      await stores.proxyTokenStore.listHolderRows(),
      await stores.dispatchTokenStore.listHolderRows(),
      await stores.ownerCredentialStore.listUrlKeyRecords({ includeConnectionKeyed: true }),
      await stores.connectionStore.readConnectionReferents()
    ]);
    assert.ok(!/SECRET/.test(all), all);
    assert.ok(!('workspaceId' in (await stores.dispatchTokenStore.listHolderRows('k1'))[0]), 'dispatch-tokens has no workspaceId');
    const rows = await stores.connectionStore.readConnectionReferents();
    assert.deepStrictEqual(rows.map(r => r._id).sort(), ['c1', 'c2'], 'rows with no referents field are skipped');
    assert.deepStrictEqual((await stores.connectionStore.readConnectionReferents('k2')).map(r => r._id), ['c2']);
  });

  test('without includeConnectionKeyed only the two key-bearing shapes come back', async () => {
    const rows = await stores.ownerCredentialStore.listUrlKeyRecords();
    assert.deepStrictEqual(rows.map(r => r.accountId), ['acct-b']);
  });
});

describe('source constraints (D6 and the source-scanning censuses)', () => {
  const read = p => readFileSync(join(ROOT, p), 'utf8');
  test('the module opens no collection and imports no connection store', () => {
    const src = read('lib/urlkey-holders.js');
    assert.ok(!/connection-store|connection-credential/.test(src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')), 'no import of the seam or store');
    assert.ok(!/readConnection[A-Z]\w*\s*\(/.test(src));
    assert.ok(!/\bcollection\s*\(/.test(src));
  });
  test('no grantDeclaration/grantRefusal token in the three census-scanned files', () => {
    for (const f of ['lib/urlkey-holders.js', 'lib/dispatch-tokens.js', 'lib/owner-credential-store.js']) {
      assert.ok(!/grantDeclaration|grantRefusal/.test(read(f)), f);
    }
  });
  test('no .credentials text in the new module (the D15 census counts any such line)', () => {
    assert.ok(!/\.credentials([^a-zA-Z_]|$)/m.test(read('lib/urlkey-holders.js')));
  });
});

// ---------------------------------------------------------------------------
// Class guard: every collection the app opens is classified.
// ---------------------------------------------------------------------------
// H holder store; B actor store; C urlKey-bearing (read by the dry-run's no-holder
// count); N carries no urlKey (reason given).
const COLLECTION_CLASSES = {
  'owner-credentials': 'H', 'connections': 'H', 'proxy-tokens': 'H', 'dispatch-tokens': 'H',
  'dispatch-queue': 'B', 'dispatch-history': 'B', 'saved-chats': 'B', 'task-mode-events': 'B',
  'funnel-events': 'B', 'credential-lifecycle-events': 'B', 'task_share_links': 'B', 'user-preferences': 'B-unread',
  'sessions': 'B',
  'close-out-events': 'C', 'foreman-status': 'C', 'llm-call-log': 'C', 'prompt-traces': 'C', 'proxy-events': 'C',
  'observation-sessions': 'C', 'observer-shadow-log': 'C', 'wake_shadow': 'C', 'liveness-alarms': 'C',
  'custom-prompts': 'C', 'report-history': 'C', 'task-snapshots': 'C', 'task-decisions': 'C', 'run-paragraph': 'C',
  'workspaces': 'C', 'workspace-halt': 'C',
  // Composite-_id or workspaceId-keyed caches and per-key documents whose key sits inside a joined string;
  // not enumerated by the dry-run's no-holder count.
  'brief-cache': 'C-composite', 'recap-cache': 'C-composite', 'run-summary-cache': 'C-composite',
  'session-summary-cache': 'C-composite', 'workspace-preferences': 'C-composite', 'harbour-comments': 'C-composite',
  'observer-state': 'C-unread', 'dismissal-suggestions': 'C-unread', 'dispatch-presets': 'C-unread', 'run-proposals': 'C-unread',
  'shelved-rulings': 'C-unread', 'ship-biscuit-editions': 'C-unread', 'local-issues': 'C-unread',
  'collective-characters': 'C-unread', 'collective-presets': 'C-unread',
  // No urlKey at all.
  'account-merge-events': 'N', 'account-workspaces': 'N', 'accounts': 'N', 'free-tier-usage': 'N',
  'harbour-feedback-tokens': 'N', 'scheduler-locks': 'N', 'email-magic-links': 'N', 'shares': 'N'
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

describe('class guard: every collection is classified', () => {
  const files = [join(ROOT, 'server.js'), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'routes'))];
  const literal = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/collection\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)/g)) literal.add(m[1]);
  }
  // Constant-named collections a literal regex cannot see.
  const constants = [
    ['lib/email-auth.js', /MAGIC_LINK_COLLECTION\s*=\s*['"]([^'"]+)['"]/],
    ['lib/drop-shares-collection.js', /SHARES_COLLECTION\s*=\s*['"]([^'"]+)['"]/]
  ].map(([f, re]) => readFileSync(join(ROOT, f), 'utf8').match(re)[1]);

  test('no collection the app opens is missing from the table', () => {
    const missing = [...literal, ...constants].filter(c => !(c in COLLECTION_CLASSES));
    assert.deepStrictEqual(missing, [], `unclassified collection(s): ${missing}. Classify each as holder (H), actor (B), urlKey-bearing (C) or key-less (N), and wire H/B/C into the dry-run.`);
  });

  test('the planted unclassified collection is caught', () => {
    assert.ok(['mystery-store'].filter(c => !(c in COLLECTION_CLASSES)).length > 0);
  });

  test('the dry-run sources agree with the table', () => {
    for (const s of URLKEY_SOURCES) assert.ok(COLLECTION_CLASSES[s.collection] && COLLECTION_CLASSES[s.collection] !== 'N', s.collection);
    for (const s of ACTOR_SOURCES) assert.ok(/^[BH]/.test(COLLECTION_CLASSES[s.collection]), s.collection);
  });
});
