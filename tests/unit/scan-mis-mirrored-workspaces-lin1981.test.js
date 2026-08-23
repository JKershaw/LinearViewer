/**
 * LIN-1981 — read-only stored-data scan for the linkProvider mis-mirror.
 *
 * Drives `scanForDivergentWorkspaceProviders` against a real MangoDB
 * `sessions` collection (same harness style as
 * tests/unit/repair-account-merge-lin2233.test.js), using synthetic
 * credential values only (never real secrets).
 *
 * Run with: node --test tests/unit/scan-mis-mirrored-workspaces-lin1981.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { scanForDivergentWorkspaceProviders } from '../../scripts/scan-mis-mirrored-workspaces-lin1981.js';

describe('scripts/scan-mis-mirrored-workspaces-lin1981.js', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'scan-lin1981-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return dbClient.db(`scan_${counter++}`);
  }

  test('flags a workspace with an unset-provider row alongside a foreign-provider row — the direct mis-mirror signature', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    // Row A: a device that never performed the Jira link — still reads the
    // legacy, unset-provider (≡ Linear) copy of this workspace.
    await sessions.insertOne({
      _id: 'sess-device-a',
      session: {
        accountId: 'acct-1',
        workspaces: [
          { urlKey: 'acme', provider: undefined, accessToken: 'lin_live_abc123', tokenExpiresAt: Date.now() + 3600_000 },
        ],
      },
    });

    // Row B: the device that DID perform the Jira link — linkProvider's
    // isActive guard mirrored the Jira credential onto the same logical
    // workspace's scalar fields on this row. The scalar mirror is a bare
    // token (routes/jira-auth.js's linkProvider call passes the apiToken as
    // `token`; `email`/`site` live only on the binding), which is what a
    // real mis-mirrored record looks like.
    await sessions.insertOne({
      _id: 'sess-device-b',
      session: JSON.stringify({
        accountId: 'acct-1',
        workspaces: [
          {
            urlKey: 'acme',
            provider: 'jira',
            accessToken: 'jira-secret',
            tokenExpiresAt: Number.MAX_SAFE_INTEGER,
            bindings: [{ provider: 'jira', scope: 'acme.atlassian.net', credentials: { token: 'jira-secret', email: 'a@b.com' } }],
          },
        ],
      }),
    });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.scannedSessionRows, 2);
    assert.strictEqual(result.distinctAccountWorkspacePairs, 1);
    assert.strictEqual(result.flagged.length, 1);
    assert.strictEqual(result.flagged[0].urlKey, 'acme');
    assert.deepStrictEqual(new Set(result.flagged[0].distinctProviders), new Set(['linear', 'jira']));
    assert.ok(result.flagged[0].entries.some(e => e.unsetWithCredential === true));
    assert.ok(result.flagged[0].entries.some(e => e.expiryKind === 'sentinel'));

    // Never a token, never an account id, in the report.
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('lin_live_abc123'));
    assert.ok(!serialized.includes('jira-secret'));
    assert.ok(!serialized.includes('acct-1'));
  });

  test('does not flag a genuine single-provider workspace, including a real sentinel-expiry Jira-only one', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    const jiraWorkspace = {
      urlKey: 'wardrox',
      provider: 'jira',
      accessToken: 'jira-secret-2',
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
      bindings: [{ provider: 'jira', scope: 'wardrox.atlassian.net', credentials: { token: 'jira-secret-2', email: 'w@x.com' } }],
    };
    await sessions.insertOne({ _id: 'sess-jira-only', session: { accountId: 'acct-2', workspaces: [jiraWorkspace] } });
    await sessions.insertOne({ _id: 'sess-jira-only-2', session: { accountId: 'acct-2', workspaces: [jiraWorkspace] } });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.distinctAccountWorkspacePairs, 1);
    assert.strictEqual(result.flagged.length, 0, 'a consistently-Jira workspace across every row is not a mis-mirror');
  });

  test('does not flag a legitimate setActiveProvider re-point mid-propagation (no row was ever unset)', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    // A workspace explicitly created as Linear (provider stamped on first
    // link, the modern behaviour), later re-pointed to GitHub as primary via
    // `setActiveProvider`. One device's session row hasn't re-synced yet —
    // a real, unrelated, already-documented "stale mirror" shape. Neither
    // row was ever unset, which is exactly what should tell this apart from
    // the LIN-1981 signature above.
    await sessions.insertOne({ _id: 'sess-stale-device', session: { accountId: 'acct-4', workspaces: [{ urlKey: 'multi-source', provider: 'linear', accessToken: 'lin_live_old', tokenExpiresAt: Date.now() + 1000 }] } });
    await sessions.insertOne({ _id: 'sess-updated-device', session: { accountId: 'acct-4', workspaces: [{ urlKey: 'multi-source', provider: 'github', accessToken: 'gh_live_new', tokenExpiresAt: Number.MAX_SAFE_INTEGER }] } });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.distinctAccountWorkspacePairs, 1);
    assert.strictEqual(result.flagged.length, 0, 'both providers are explicit — this is re-point propagation lag, not a mis-mirror');
  });

  test('does not flag a legitimate unlinkProvider last-binding removal (unset row has NO surviving credential)', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    // A workspace whose only source (github) was removed via Settings on one
    // device: `unlinkProvider` (lib/workspace.js) deletes `provider` AND every
    // scalar credential field together when the removed binding was the last
    // one — a legitimate transition through "unset" with nothing left behind.
    await sessions.insertOne({ _id: 'sess-post-removal', session: { accountId: 'acct-6', workspaces: [{ urlKey: 'now-empty', provider: undefined, accessToken: undefined, tokenExpiresAt: undefined, bindings: [] }] } });
    // A stale device that hasn't re-synced yet, still showing the old value.
    await sessions.insertOne({ _id: 'sess-stale-pre-removal', session: { accountId: 'acct-6', workspaces: [{ urlKey: 'now-empty', provider: 'github', accessToken: 'gh_live_stale', tokenExpiresAt: Date.now() + 1000 }] } });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.distinctAccountWorkspacePairs, 1);
    assert.strictEqual(result.flagged.length, 0, 'an unset row with no credential is a cleared-out workspace, not a legacy-Linear mis-mirror candidate');
  });

  test('does not flag distinct accounts holding the same urlKey with different providers', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    await sessions.insertOne({ _id: 's1', session: { accountId: 'acct-a', workspaces: [{ urlKey: 'shared-key', provider: 'linear', accessToken: 'lin_live_x', tokenExpiresAt: Date.now() + 1000 }] } });
    await sessions.insertOne({ _id: 's2', session: { accountId: 'acct-b', workspaces: [{ urlKey: 'shared-key', provider: undefined, accessToken: 'gh_live_y', tokenExpiresAt: Date.now() + 1000 }] } });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.distinctAccountWorkspacePairs, 2, '(accountId, urlKey) is the grouping key, not urlKey alone');
    assert.strictEqual(result.flagged.length, 0);
  });

  test('handles multiple workspaces on one session row independently', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');

    await sessions.insertOne({
      _id: 'multi-ws-row',
      session: {
        accountId: 'acct-5',
        workspaces: [
          { urlKey: 'ws-one', provider: undefined, accessToken: 'lin_live_1', tokenExpiresAt: Date.now() + 1000 },
          { urlKey: 'ws-two', provider: 'github', accessToken: 'gh_live_2', tokenExpiresAt: Date.now() + 1000 },
        ],
      },
    });
    // A second row divergent only on ws-one, so only ws-one carries the signature.
    await sessions.insertOne({
      _id: 'other-row',
      session: { accountId: 'acct-5', workspaces: [{ urlKey: 'ws-one', provider: 'github', accessToken: 'gh_live_3', tokenExpiresAt: Number.MAX_SAFE_INTEGER }] },
    });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.scannedWorkspaceEntries, 3);
    assert.strictEqual(result.distinctAccountWorkspacePairs, 2);
    assert.strictEqual(result.flagged.length, 1);
    assert.strictEqual(result.flagged[0].urlKey, 'ws-one');
  });

  test('empty store: reports zero scanned, zero flagged, never throws', async () => {
    const db = freshDb();
    const result = scanForDivergentWorkspaceProviders(await db.collection('sessions').find({}).toArray());
    assert.strictEqual(result.scannedSessionRows, 0);
    assert.strictEqual(result.flagged.length, 0);
  });

  test('skips a malformed session row and a row with no accountId, without crashing the whole scan', async () => {
    const db = freshDb();
    const sessions = db.collection('sessions');
    await sessions.insertOne({ _id: 'bad', session: '{not-json' });
    await sessions.insertOne({ _id: 'no-account', session: { workspaces: [{ urlKey: 'orphan-key', provider: 'linear', accessToken: 'lin_live_orphan', tokenExpiresAt: Date.now() + 1000 }] } });
    await sessions.insertOne({ _id: 'good', session: { accountId: 'acct-3', workspaces: [{ urlKey: 'ok-key', provider: 'linear', accessToken: 'lin_live_z', tokenExpiresAt: Date.now() + 1000 }] } });

    const result = scanForDivergentWorkspaceProviders(await sessions.find({}).toArray());

    assert.strictEqual(result.scannedSessionRows, 3);
    assert.strictEqual(result.scannedWorkspaceEntries, 1, 'only the row with a real accountId contributes; the malformed and orphan rows do not abort the good row');
  });
});
