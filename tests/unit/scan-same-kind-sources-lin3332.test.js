/**
 * LIN-3332 / LIN-3334 — the read-only same-kind-source scan.
 *
 * Drives `scanForSameKindSources` / `computeSameKindReport` against a real
 * MangoDB store (same harness style as
 * tests/unit/scan-mis-mirrored-workspaces-lin1981.test.js), using synthetic
 * credential values only (never real secrets).
 *
 * Run with: node --test tests/unit/scan-same-kind-sources-lin3332.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { scanForSameKindSources, computeSameKindReport, sameKindConflicts, formatSummary } from '../../scripts/scan-same-kind-sources-lin3332.mjs';

const ws = (urlKey, bindings) => ({ _id: `id-${urlKey}`, urlKey, bindings });

describe('scripts/scan-same-kind-sources-lin3332.mjs', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'scan-lin3332-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return dbClient.db(`scan3332_${counter++}`);
  }

  test('sameKindConflicts: one binding per provider is clean; two of one kind is a conflict', () => {
    assert.deepEqual(sameKindConflicts({ bindings: [
      { provider: 'linear', scope: 'org-1' },
      { provider: 'github', scope: 'octo/a' },
    ] }), []);
    assert.deepEqual(sameKindConflicts({ bindings: [
      { provider: 'github', scope: 'octo/a' },
      { provider: 'github', scope: 'octo/b' },
    ] }), [{ provider: 'github', count: 2, scopes: ['octo/a', 'octo/b'] }]);
    // same-scope duplicate is also flagged (defensive)
    assert.deepEqual(sameKindConflicts({ bindings: [
      { provider: 'jira', scope: 'https://a' },
      { provider: 'jira', scope: 'https://a' },
    ] }), [{ provider: 'jira', count: 2, scopes: ['https://a'] }]);
    assert.deepEqual(sameKindConflicts({}), []);
  });

  test('scanForSameKindSources flags a two-same-kind workspace in both stores, and only that one', () => {
    const report = scanForSameKindSources({
      workspaceDocs: [
        ws('dupe', [{ provider: 'github', scope: 'octo/a', credentials: { token: 'g' } }, { provider: 'github', scope: 'octo/b', credentials: { token: 'g' } }]),
        ws('clean', [{ provider: 'linear', scope: 'org-1', credentials: { token: 'l' } }, { provider: 'github', scope: 'octo/a', credentials: { token: 'g' } }]),
      ],
      sessionDocs: [
        { _id: 'row-A', session: { accountId: 'acct-1', workspaces: [{ urlKey: 'dupe', bindings: [{ provider: 'github', scope: 'octo/a' }, { provider: 'github', scope: 'octo/b' }] }] } },
        { _id: 'row-B', session: JSON.stringify({ accountId: 'acct-2', workspaces: [{ urlKey: 'clean2', bindings: [{ provider: 'jira', scope: 'https://a' }] }] }) },
      ],
    });

    assert.equal(report.scannedWorkspaces, 2);
    assert.equal(report.scannedSessionEntries, 2);
    assert.equal(report.flagged.length, 2);
    assert.deepEqual(report.flagged.map(f => [f.source, f.urlKey]), [['workspaces', 'dupe'], ['sessions', 'dupe']]);

    // Secret-safe: no token, no account id, no session row id in the report.
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('acct-1'));
    assert.ok(!serialized.includes('"token"'));
    assert.ok(!serialized.includes('row-A') && !serialized.includes('row-B'));
  });

  test('skips a malformed session row without aborting the good rows', () => {
    const report = scanForSameKindSources({
      sessionDocs: [
        { _id: 'bad', session: '{not-json' },
        { _id: 'good', session: { accountId: 'a', workspaces: [{ urlKey: 'ok', bindings: [{ provider: 'github', scope: 'x' }, { provider: 'github', scope: 'y' }] }] } },
      ],
    });
    assert.equal(report.scannedSessionEntries, 1);
    assert.equal(report.flagged.length, 1);
  });

  test('computeSameKindReport reads both collections from a real store', async () => {
    const db = freshDb();
    await db.collection('workspaces').insertOne(
      ws('durable-dupe', [{ provider: 'github', scope: 'a' }, { provider: 'github', scope: 'b' }])
    );
    await db.collection('workspaces').insertOne(
      ws('durable-clean', [{ provider: 'linear', scope: 'org' }])
    );
    await db.collection('sessions').insertOne({
      _id: 'row', session: { accountId: 'acct', workspaces: [{ urlKey: 'session-dupe', bindings: [{ provider: 'jira', scope: 'https://a' }, { provider: 'jira', scope: 'https://b' }] }] },
    });

    const report = await computeSameKindReport({ db });
    assert.equal(report.scannedWorkspaces, 2);
    assert.equal(report.scannedSessionEntries, 1);
    assert.deepEqual(report.flagged.map(f => f.urlKey).sort(), ['durable-dupe', 'session-dupe']);
    assert.match(formatSummary(report), /violate the one-source-per-kind rule/);
  });

  test('an empty store reports zero scanned and zero flagged', async () => {
    const report = await computeSameKindReport({ db: freshDb() });
    assert.equal(report.scannedWorkspaces, 0);
    assert.equal(report.scannedSessionEntries, 0);
    assert.equal(report.flagged.length, 0);
    assert.match(formatSummary(report), /none: no stored workspace holds two sources/);
  });
});
