/**
 * LIN-3464 — refresh-then-read: a legacy workspace has ONE current token
 * (`accessToken`), so after a headless refresh every reader sees it.
 *
 * Drives the REAL `mirrorRefreshedCredentialIntoOwnerRows`, and, for the
 * durable-adopt arm, the real `attemptSuspectCredentialRefresh`.
 *
 * Run with: node --test tests/unit/lin-3464-refresh-then-read.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import '../../lib/providers/index.js';
import {
  linkProvider,
  getWorkspaceToken,
  getWorkspaceCallScope,
  getBindingsForWorkspace,
  isActiveBinding,
} from '../../lib/workspace.js';
import { mirrorRefreshedCredentialIntoOwnerRows } from '../../lib/workspace-token-refresh.js';
import { selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';
import { attemptSuspectCredentialRefresh } from '../../lib/suspect-credential-refresh.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const URL_KEY = 'acme-3464';
const ACCOUNT = 'acct-3464';
const OLD = 'OLD-token';
const NEW = 'NEW-token';
const SOON = () => Date.now() + 3_600_000;

function linearRow() {
  const ws = { id: 'org-1', urlKey: URL_KEY, name: 'Acme' };
  linkProvider(ws, 'linear', 'org-1', { token: OLD, tokenExpiresAt: SOON() });
  return ws;
}

function jiraRow() {
  const ws = { id: 'cloud-1', urlKey: URL_KEY, name: 'Acme' };
  linkProvider(ws, 'jira', 'https://acme.atlassian.net', {
    token: OLD, authType: 'oauth', cloudId: 'cloud-1', tokenExpiresAt: SOON(),
  });
  return ws;
}

const sessionsOf = (ws) => [{ _id: 'sid-1', session: { accountId: ACCOUNT, workspaces: [ws] } }];

function mirror(ws, persisted = []) {
  return mirrorRefreshedCredentialIntoOwnerRows({
    sessions: sessionsOf(ws),
    urlKey: URL_KEY,
    ownerAccountId: ACCOUNT,
    token: NEW,
    expiresAt: SOON() + 1000,
    persistSession: async (sid) => { persisted.push(sid); },
  });
}

describe('LIN-3464 refresh-then-read', () => {
  test('legacy Linear: after the real mirror every reader sees NEW', async () => {
    const ws = linearRow();
    const shape = { provider: ws.provider, credentialKeys: Object.keys(ws.credentials).sort() };
    assert.equal(getWorkspaceToken(ws), OLD);

    const persisted = [];
    await mirror(ws, persisted);
    assert.deepEqual(persisted, ['sid-1']);

    assert.equal(getWorkspaceToken(ws), NEW);
    assert.equal(getWorkspaceToken(ws, 'linear'), NEW, '3-arg binding read rotates too');
    assert.equal(getWorkspaceCallScope(ws), NEW);
    assert.equal(isActiveBinding(ws, getBindingsForWorkspace(ws)[0]), true);
    assert.deepEqual(selectOwnerWorkspaceToken(sessionsOf(ws), URL_KEY, ACCOUNT).token, NEW);
    assert.equal(selectOwnerWorkspaceToken(sessionsOf(ws), URL_KEY, ACCOUNT).scope, NEW);
    assert.deepEqual({ provider: ws.provider, credentialKeys: Object.keys(ws.credentials).sort() }, shape,
      'provider and credentials shape are unchanged by the writer swap');
  });

  test('legacy Jira OAuth: scope carries NEW as accessToken', async () => {
    const ws = jiraRow();
    await mirror(ws);
    assert.equal(getWorkspaceToken(ws), NEW);
    assert.equal(getWorkspaceToken(ws, 'jira'), NEW);
    const scope = getWorkspaceCallScope(ws);
    assert.equal(scope.accessToken, NEW);
    assert.equal(scope.cloudId, 'cloud-1');
    assert.equal(selectOwnerWorkspaceToken(sessionsOf(ws), URL_KEY, ACCOUNT).token, NEW);
    assert.equal(selectOwnerWorkspaceToken(sessionsOf(ws), URL_KEY, ACCOUNT).scope.accessToken, NEW);
  });

  test('pre-diverged row, BEFORE any refresh: scalar readers already return NEW', () => {
    const ws = linearRow();
    ws.accessToken = NEW; // what the old mirror left: credentials.token + binding stay OLD
    ws.tokenExpiresAt = SOON() + 1000;
    assert.equal(ws.credentials.token, OLD);
    assert.equal(getWorkspaceToken(ws), NEW);
    assert.equal(getWorkspaceCallScope(ws), NEW);
    const picked = selectOwnerWorkspaceToken(sessionsOf(ws), URL_KEY, ACCOUNT);
    assert.equal(picked.token, NEW);
    assert.equal(picked.scope, NEW);
    // Binding-aware reads only heal on the next refresh (no sweep, per the ticket).
    assert.equal(getWorkspaceToken(ws, 'linear'), OLD);
    assert.equal(isActiveBinding(ws, getBindingsForWorkspace(ws)[0]), false);
  });

  test('pre-diverged row, AFTER a refresh: binding-aware reads heal too', async () => {
    const ws = linearRow();
    ws.accessToken = 'STALE-mirror';
    await mirror(ws);
    assert.equal(getWorkspaceToken(ws, 'linear'), NEW);
    assert.equal(ws.credentials.token, NEW);
    assert.equal(isActiveBinding(ws, getBindingsForWorkspace(ws)[0]), true);
  });

  test('connection-backed row is skipped by the mirror', async () => {
    const ws = { id: 'org-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [{ provider: 'linear', scope: 'org-1', connectionId: `${ACCOUNT}::linear::org-1` }],
      activeBinding: { provider: 'linear', scope: 'org-1' } };
    const before = JSON.stringify(ws);
    const persisted = [];
    await mirror(ws, persisted);
    assert.equal(JSON.stringify(ws), before, 'no scalar mirror is written');
    assert.deepEqual(persisted, []);
    assert.equal(getWorkspaceToken(ws), undefined, 'fails closed, never a stray scalar');
  });

  test('durable-adopt arm of attemptSuspectCredentialRefresh writes through the one place', async () => {
    const ws = linearRow();
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    const fp = fingerprintCredential(OLD);
    registry.markSuspect(fp);
    const persisted = [];
    const adopted = await attemptSuspectCredentialRefresh({
      fingerprint: fp, urlKey: URL_KEY, ownerAccountId: ACCOUNT, provider: 'linear',
      loadSessions: async () => sessionsOf(ws),
      registry,
      store: { get: async () => ({ provider: 'linear', token: NEW, tokenExpiresAt: SOON() + 1000 }) },
      lifecycleEventStore: { async recordEvent() {} },
      refreshAccessToken: async () => { throw new Error('the exchange must not run'); },
      persistSession: async (sid) => { persisted.push(sid); },
      resolveProvider: () => ({}),
    });
    assert.equal(adopted?.token, NEW);
    assert.deepEqual(persisted, ['sid-1']);
    assert.equal(ws.accessToken, NEW);
    assert.equal(ws.credentials.token, NEW);
    assert.equal(getBindingsForWorkspace(ws)[0].credentials.token, NEW);
    assert.equal(getWorkspaceToken(ws), NEW);
    assert.equal(getWorkspaceCallScope(ws), NEW);
  });
});
