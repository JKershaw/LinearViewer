/**
 * LIN-3124 PR3 checkpoint F (T28): scripts/revert-connection-backed.js — the
 * named rollback (D11). Dry run by default, idempotent, never deletes, and a
 * reverted workspace is readable by the LEGACY code path (binding credential,
 * scalar mirror, legacy-keyed durable refresh record).
 *
 * The connection-backed state is produced by the REAL converter, then stored
 * the way the session store persists it (sanitized), so the script is tested
 * against exactly what production holds.
 *
 * Run with: node --test tests/unit/revert-connection-backed.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { runRevert } from '../../scripts/revert-connection-backed.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { convertToConnectionBacked, sanitizeSessionForPersist } from '../../lib/connection-credential.js';
import { linkProvider, getWorkspaceToken, getWorkspaceCallScope } from '../../lib/workspace.js';
import { refreshOwnerCredential } from '../../lib/workspace-token-refresh.js';

const ACCT = 'acct-revert';
const SECRETS = ['lin-tok', 'R-lin', 'jira-tok', 'R-jira', 'ghs-tok', 'legacy-tok', 'R-legacy', 'R-other'];

describe('LIN-3124 T28 — scripts/revert-connection-backed.js', () => {
  let dir;
  let client;
  let n = 0;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3124-revert-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Two connection-backed workspaces (Linear active; Jira OAuth + GitHub add-sources) and one legacy one. */
  async function seed() {
    const db = client.db(`revert_${n++}`);
    const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
    const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
    const session = { accountId: ACCT, workspaces: [
      { id: 'ws-lin', urlKey: 'acme', bindings: [] },
      { id: 'ws-legacy', urlKey: 'old', provider: 'linear', accessToken: 'legacy-tok', credentials: { token: 'legacy-tok' }, tokenExpiresAt: 5, bindings: [{ provider: 'linear', scope: 'org-old', credentials: { token: 'legacy-tok', tokenExpiresAt: 5 } }] },
    ] };
    const link = async (provider, scope, credentials, refreshToken) => {
      linkProvider(session.workspaces[0], provider, scope, credentials);
      const out = await convertToConnectionBacked({ connectionStore, ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-lin', provider, scope, credentials, refreshToken, prior: 'none', writesEnabled: true });
      assert.equal(out.connectionBacked, true);
    };
    await link('linear', 'org-1', { token: 'lin-tok', tokenExpiresAt: 1000 }, 'R-lin');
    await link('jira', 'https://j.atlassian.net', { token: 'jira-tok', authType: 'oauth', cloudId: 'cid', tokenExpiresAt: 2000 }, 'R-jira');
    await link('github', 'o/r', { installationId: '9', token: 'ghs-tok', tokenExpiresAt: 3000 });
    await ownerCredentialStore.put(ACCT, 'old', { provider: 'linear', scope: 'org-old', token: 'legacy-tok', refreshToken: 'R-legacy', tokenExpiresAt: 5 });
    sanitizeSessionForPersist(session);
    await db.collection('sessions').insertOne({ _id: 'sid-1', session, expires: new Date(Date.now() + 86400_000) });
    return { db, connectionStore, ownerCredentialStore };
  }

  async function dump(db) {
    const out = {};
    for (const c of ['sessions', 'connections', 'owner-credentials']) out[c] = await db.collection(c).find({}).toArray();
    return JSON.parse(JSON.stringify(out, (k, v) => (k === 'updatedAt' || k === 'createdAt' ? undefined : v)));
  }

  test('dry run by default: reports the plan, writes nothing', async () => {
    const { db } = await seed();
    const before = await dump(db);
    const report = await runRevert({ db, log: () => {} });
    assert.equal(report.execute, false);
    assert.equal(report.reverted.length, 3);
    assert.deepEqual(report.affected.map(a => a.provider).sort(), ['github', 'jira', 'linear']);
    assert.deepEqual(await dump(db), before, 'nothing written');
  });

  test('--execute: bindings, mirror and legacy durable records restored; the legacy code path reads them', async () => {
    const { db, ownerCredentialStore } = await seed();
    const report = await runRevert({ db, execute: true, log: () => {} });
    assert.equal(report.legacyRecordsWritten, 2, 'linear + jira; github has none');
    const [{ session }] = await db.collection('sessions').find({}).toArray();
    const ws = session.workspaces[0];
    assert.deepEqual(ws.bindings, [
      { provider: 'linear', scope: 'org-1', credentials: { token: 'lin-tok', tokenExpiresAt: 1000 } },
      { provider: 'jira', scope: 'https://j.atlassian.net', credentials: { token: 'jira-tok', authType: 'oauth', cloudId: 'cid', tokenExpiresAt: 2000 } },
      { provider: 'github', scope: 'o/r', credentials: { installationId: '9', token: 'ghs-tok', tokenExpiresAt: 3000 } },
    ]);
    assert.equal(ws.activeBinding, undefined, 'the D2 marker is gone');
    assert.equal(ws.accessToken, 'lin-tok', 'scalar mirror restored for the active binding');
    assert.equal(getWorkspaceToken(ws), 'lin-tok', 'the legacy accessor reads it with no side-table');
    assert.equal(getWorkspaceCallScope({ ...ws, provider: 'jira', activeBinding: undefined, bindings: [ws.bindings[1]], credentials: ws.bindings[1].credentials, accessToken: 'jira-tok' }).accessToken, 'jira-tok');
    // Legacy durable records, readable by the legacy refresh core.
    assert.equal((await ownerCredentialStore.get(ACCT, 'acme', 'linear')).refreshToken, 'R-lin');
    assert.equal((await ownerCredentialStore.get(ACCT, 'acme', 'jira')).refreshToken, 'R-jira');
    const out = await refreshOwnerCredential({ ownerAccountId: ACCT, urlKey: 'acme', provider: 'linear', refreshAccessToken: async () => ({ access_token: 'n', refresh_token: 'R-lin2', expires_in: 3600 }), store: ownerCredentialStore });
    assert.equal(out.refreshToken, 'R-lin2');
    // Review blocker 6: every reverted binding's referent is gone, so the
    // (now unreferenced) Connections and their connection-keyed records are
    // released — the connection-first arm can no longer find them.
    assert.equal(report.connectionsReleased, 3);
    assert.equal(await db.collection('connections').countDocuments({}), 0);
    assert.equal(await ownerCredentialStore.getByConnection(`${ACCT}::linear::org-1`), null);
    assert.equal(await ownerCredentialStore.getByConnection(`${ACCT}::jira::https://j.atlassian.net`), null);
    // The legacy workspace is byte-identical.
    assert.deepEqual(session.workspaces[1], { id: 'ws-legacy', urlKey: 'old', provider: 'linear', accessToken: 'legacy-tok', credentials: { token: 'legacy-tok' }, tokenExpiresAt: 5, bindings: [{ provider: 'linear', scope: 'org-old', credentials: { token: 'legacy-tok', tokenExpiresAt: 5 } }] });
  });

  test('idempotent: a second --execute writes nothing', async () => {
    const { db } = await seed();
    await runRevert({ db, execute: true, log: () => {} });
    const once = await dump(db);
    const report = await runRevert({ db, execute: true, log: () => {} });
    assert.deepEqual([report.reverted.length, report.sessionsChanged, report.legacyRecordsWritten], [0, 0, 0]);
    assert.deepEqual(await dump(db), once);
  });

  test('skips (never overwrites) a legacy key holding another grant, and a missing Connection', async () => {
    const { db, ownerCredentialStore } = await seed();
    await ownerCredentialStore.put(ACCT, 'acme', { provider: 'jira', token: 'x', refreshToken: 'R-other', tokenExpiresAt: 1 });
    await db.collection('connections').deleteOne({ _id: `${ACCT}::github::9` });
    const report = await runRevert({ db, execute: true, log: () => {} });
    assert.deepEqual(report.skipped.map(s => [s.provider, s.reason]).sort(), [['github', 'connection-missing'], ['jira', 'legacy-key-occupied']]);
    assert.equal((await ownerCredentialStore.get(ACCT, 'acme', 'jira')).refreshToken, 'R-other', 'a co-resident grant is never clobbered');
    const [{ session }] = await db.collection('sessions').find({}).toArray();
    assert.equal(typeof session.workspaces[0].bindings[1].connectionId, 'string', 'the skipped binding is left for the user to re-link');
    assert.ok(await db.collection('connections').findOne({ _id: `${ACCT}::jira::https://j.atlassian.net` }), 'a skipped binding keeps its Connection');
    assert.ok(await ownerCredentialStore.getByConnection(`${ACCT}::jira::https://j.atlassian.net`), 'and its connection-keyed record');
  });

  test('the report is secret-safe: no token, refresh token, session id or account id', async () => {
    const { db } = await seed();
    const report = JSON.stringify(await runRevert({ db, execute: true, log: () => {} }));
    for (const secret of [...SECRETS, 'sid-1', ACCT]) assert.ok(!report.includes(secret), secret);
  });

  test('the CLI is a dry run unless --execute, and never runs on import', () => {
    const src = readFileSync(new URL('../../scripts/revert-connection-backed.js', import.meta.url), 'utf8');
    assert.match(src, /const execute = process\.argv\.includes\('--execute'\)/);
    assert.match(src, /export async function runRevert\(\{ db, execute = false,/);
    assert.match(src, /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
    // Deletion only via the last-referent lifecycle, and only AFTER the legacy
    // record and the session are written (review blocker 6).
    assert.doesNotMatch(src, /\.delete(One|Many|Connection)\(/, 'no unconditional delete');
    const sessionWrite = src.indexOf('await sessions.updateOne(');
    assert.ok(sessionWrite > src.indexOf('await ownerCredentialStore.put('));
    assert.ok(src.indexOf('await connectionStore.removeReferent(') > sessionWrite);
    assert.match(src, /if \(await connectionStore\.deleteIfUnreferenced\(connectionId\)\) \{\n\s*await ownerCredentialStore\.deleteByConnection\(connectionId\)/);
  });
});
