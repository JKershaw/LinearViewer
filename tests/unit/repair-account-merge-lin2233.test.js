/**
 * LIN-2233, L2.3 — the one-time operator repair script. Not route-reachable
 * and not auto-executed (see scripts/repair-account-merge-lin2233.js's own
 * header); this drives its exported `runRepair`/`checkOrphanRowSafeToDelete`
 * directly against a real MangoDB instance, the way the script itself would
 * be invoked by an operator, but never against production.
 *
 * Run with: node --test tests/unit/repair-account-merge-lin2233.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import {
  runRepair,
  checkOrphanRowSafeToDelete,
  CANONICAL_ACCOUNT_ID,
  STALE_ACCOUNT_ID,
  ORPHAN_ROW_ID,
} from '../../scripts/repair-account-merge-lin2233.js';

describe('scripts/repair-account-merge-lin2233.js — one-time operator repair', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'repair-lin2233-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return dbClient.db(`repair_${counter++}`);
  }

  async function seedAccounts(db) {
    const accounts = db.collection('accounts');
    await accounts.insertOne({ _id: CANONICAL_ACCOUNT_ID, identities: [{ provider: 'linear', scope: 'canonical-viewer', credentials: {} }], createdAt: new Date(), updatedAt: new Date() });
    await accounts.insertOne({ _id: STALE_ACCOUNT_ID, identities: [{ provider: 'linear', scope: 'stale-viewer', credentials: {} }], createdAt: new Date(), updatedAt: new Date() });
  }

  test('dry run (default): reports what it would do and writes NOTHING', async () => {
    const db = freshDb();
    await seedAccounts(db);
    await db.collection('account-workspaces').insertOne({ _id: ORPHAN_ROW_ID, accountId: '067e394c-does-not-exist', workspaceId: CANONICAL_ACCOUNT_ID, createdAt: new Date() });

    const logs = [];
    const result = await runRepair({ db, execute: false, log: (m) => logs.push(m) });

    assert.strictEqual(result.merge.dryRun, true);
    assert.strictEqual(result.deleted, false);
    assert.ok(logs.some(l => l.includes('DRY RUN')));

    // Nothing written: the stale account is untouched, the orphan row still exists.
    const stale = await db.collection('accounts').findOne({ _id: STALE_ACCOUNT_ID });
    assert.strictEqual(stale.mergedInto, undefined);
    assert.ok(await db.collection('account-workspaces').findOne({ _id: ORPHAN_ROW_ID }));
  });

  test('--execute: merges the stale account into canonical and deletes the orphan row when the read-only check passes', async () => {
    const db = freshDb();
    await seedAccounts(db);
    await db.collection('account-workspaces').insertOne({ _id: ORPHAN_ROW_ID, accountId: '067e394c-does-not-exist', workspaceId: CANONICAL_ACCOUNT_ID, createdAt: new Date() });
    // A real, unrelated workspace edge the stale account held — proves the rebind.
    await db.collection('account-workspaces').insertOne({ _id: 'real-edge-1', accountId: STALE_ACCOUNT_ID, workspaceId: 'linearviewer-org', createdAt: new Date() });

    const result = await runRepair({ db, execute: true, log: () => {} });

    assert.strictEqual(result.merge.ok, true);
    assert.strictEqual(result.deleted, true);

    const stale = await db.collection('accounts').findOne({ _id: STALE_ACCOUNT_ID });
    assert.strictEqual(stale.mergedInto, CANONICAL_ACCOUNT_ID);
    // Merge is alias-only: identities[] untouched.
    assert.strictEqual(stale.identities.length, 1);
    assert.strictEqual(stale.identities[0].scope, 'stale-viewer');

    const canonicalEdges = await db.collection('account-workspaces').find({ accountId: CANONICAL_ACCOUNT_ID }).toArray();
    assert.ok(canonicalEdges.some(e => e.workspaceId === 'linearviewer-org'), 'the stale account\'s real workspace edge is rebound onto canonical');

    assert.strictEqual(await db.collection('account-workspaces').findOne({ _id: ORPHAN_ROW_ID }), null, 'orphan row deleted');

    const events = await db.collection('account-merge-events').find({}).toArray();
    assert.strictEqual(events.length, 1, 'the merge is durably logged');
  });

  test('--execute: refuses to delete the orphan row when another row shares its workspaceId (unsafe), but still merges the accounts', async () => {
    const db = freshDb();
    await seedAccounts(db);
    await db.collection('account-workspaces').insertOne({ _id: ORPHAN_ROW_ID, accountId: '067e394c-does-not-exist', workspaceId: CANONICAL_ACCOUNT_ID, createdAt: new Date() });
    // A SIBLING row sharing the orphan's workspaceId — a real reference exists,
    // so the read-only check must refuse the delete.
    await db.collection('account-workspaces').insertOne({ _id: 'sibling-row', accountId: 'some-other-account', workspaceId: CANONICAL_ACCOUNT_ID, createdAt: new Date() });

    const result = await runRepair({ db, execute: true, log: () => {} });

    assert.strictEqual(result.merge.ok, true, 'the merge itself is independent of the orphan-row cleanup');
    assert.strictEqual(result.orphanRow.safe, false);
    assert.strictEqual(result.deleted, false);
    assert.ok(await db.collection('account-workspaces').findOne({ _id: ORPHAN_ROW_ID }), 'orphan row NOT deleted — refused, not guessed at');
  });

  test('checkOrphanRowSafeToDelete: missing row is reported, not treated as "safe"', async () => {
    const db = freshDb();
    const result = await checkOrphanRowSafeToDelete(db.collection('account-workspaces'));
    assert.strictEqual(result.row, null);
    assert.strictEqual(result.safe, false);
  });
});
