/**
 * LIN-3790 — the read-only secondary-binding-shape scan.
 *
 * Drives the pure fold and `computeSecondaryShapeReport` against a real MangoDB
 * store (as scan-same-kind-sources-lin3332.test.js), with synthetic credential
 * values only.
 *
 * Run with: node --test tests/unit/scan-secondary-binding-shapes-lin3790.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { secondaryShapes, scanForSecondaryShapes, computeSecondaryShapeReport, formatSummary } from '../../scripts/scan-secondary-binding-shapes-lin3790.mjs';

const ws = (urlKey, provider, bindings) => ({ _id: `id-${urlKey}`, urlKey, ...(provider ? { provider } : {}), bindings });

describe('scripts/scan-secondary-binding-shapes-lin3790.mjs', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'scan-lin3790-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  test('secondaryShapes: the active binding and local are skipped; connection-backed vs legacy is by connectionId', () => {
    assert.deepEqual(secondaryShapes(ws('a', 'linear', [
      { provider: 'linear', scope: 'org-1', connectionId: 'c1' },
      { provider: 'github', scope: 'o/r', credentials: { token: 'x' } },
      { provider: 'jira', scope: 'https://x', connectionId: 'c2' },
      { provider: 'local', scope: 'l' },
    ])), [
      { shape: 'legacy:github', provider: 'github', scope: 'o/r' },
      { shape: 'connection:jira', provider: 'jira', scope: 'https://x' },
    ]);
  });

  test('secondaryShapes: an undefined workspace.provider counts as linear, so the legacy linear binding is not a secondary', () => {
    assert.deepEqual(secondaryShapes(ws('a', undefined, [{ provider: 'linear', scope: 'org-1' }])), []);
    assert.deepEqual(secondaryShapes(ws('a', undefined, [{ provider: 'linear', scope: 'org-1' }, { provider: 'jira', scope: 'https://x' }])).map(s => s.shape), ['legacy:jira']);
    assert.deepEqual(secondaryShapes({}), []);
    assert.deepEqual(secondaryShapes(null), []);
  });

  test('scanForSecondaryShapes counts per store and shape, flags only workspaces with a secondary, skips malformed session rows', () => {
    const report = scanForSecondaryShapes({
      workspaceDocs: [
        ws('multi', 'linear', [{ provider: 'linear', scope: 'o' }, { provider: 'github', scope: 'o/r' }]),
        ws('single', 'linear', [{ provider: 'linear', scope: 'o' }]),
      ],
      sessionDocs: [
        { session: JSON.stringify({ workspaces: [ws('multi', 'linear', [{ provider: 'linear', scope: 'o' }, { provider: 'github', scope: 'o/r', connectionId: 'c' }])] }) },
        { session: { workspaces: [ws('single', 'github', [{ provider: 'github', scope: 'o/r' }])] } },
        { session: '{not json' },
      ],
    });
    assert.equal(report.scannedWorkspaces, 2);
    assert.equal(report.scannedSessionEntries, 2);
    assert.deepEqual(report.shapeCounts, { 'workspaces:legacy:github': 1, 'sessions:connection:github': 1 });
    assert.deepEqual(report.flagged.map(f => [f.source, f.urlKey]), [['workspaces', 'multi'], ['sessions', 'multi']]);
  });

  test('the report keeps no credential, account or session id', () => {
    const report = scanForSecondaryShapes({
      workspaceDocs: [ws('multi', 'linear', [{ provider: 'linear', scope: 'o' }, { provider: 'github', scope: 'o/r', credentials: { token: 'SECRET-TOKEN' }, connectionId: 'acct-9::github::1' }])],
    });
    assert.doesNotMatch(JSON.stringify(report), /SECRET-TOKEN|acct-9/);
  });

  test('computeSecondaryShapeReport reads the workspaces and sessions collections', async () => {
    const db = dbClient.db(`scan3790_${counter++}`);
    await db.collection('workspaces').insertOne(ws('multi', 'linear', [{ provider: 'linear', scope: 'o' }, { provider: 'jira', scope: 'https://x' }]));
    await db.collection('sessions').insertOne({ session: JSON.stringify({ workspaces: [ws('multi', 'linear', [{ provider: 'linear', scope: 'o' }, { provider: 'jira', scope: 'https://x' }])] }) });
    const report = await computeSecondaryShapeReport({ db });
    assert.deepEqual(report.shapeCounts, { 'workspaces:legacy:jira': 1, 'sessions:legacy:jira': 1 });
    assert.match(formatSummary(report), /workspaces:legacy:jira: 1/);
  });

  test('formatSummary: an empty report says none', () => {
    assert.match(formatSummary(scanForSecondaryShapes()), /none: no stored workspace carries a secondary binding/);
  });
});
