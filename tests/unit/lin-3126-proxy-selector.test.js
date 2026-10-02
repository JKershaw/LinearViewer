/**
 * LIN-3241 (LIN-3126 slice 2) — connection-first arm characterization.
 *
 * Surface (A): `createConnectionAccess.resolveConnectionBackedAccess` /
 * `connectionResolveResult`. On a GitHub connection-backed workspace the arm
 * used to project `connection.unitId` (the App INSTALLATION id) as the repo, so
 * the provider call scope was `{token, repo: '<installationId>'}` — the wrong
 * repo for every binding on that Connection. The arm must read the owner's
 * session-row workspace binding and project that binding's `scope` (the real
 * `owner/name` repo); `unitId` stays Connection identity only.
 *
 * This is the slice-2 "arm characterization" seed: the rest of the slice-2 rows
 * (selector/ISSUE/WORKSPACE matrix, cache bypass, refusal mapping, census pin)
 * are added by the later beats to this same file.
 *
 * Fails-before (recorded at LIN-3240 merge, 0924b595, before the arm fix):
 *     result.scope -> { token: 'tok-a', repo: '99' }
 *     AssertionError [ERR_ASSERTION]: expected { token: 'tok-a', repo: 'octo/repoA' },
 *     got { token: 'tok-a', repo: '99' }
 *
 * Run with: node --test tests/unit/lin-3126-proxy-selector.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const REPO_A = 'octo/repoA';
const REPO_B = 'octo/repoB';
const INSTALLATION_ID = '99';
const CONNECTION_ID = 'acct::github::99';
const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;

/** A live GitHub Connection whose `unitId` is the App installation id, not a repo. */
function githubConnection() {
  return {
    _id: CONNECTION_ID,
    accountId: 'acct',
    provider: 'github',
    unitId: INSTALLATION_ID,
    credentials: { token: 'tok-a', installationId: INSTALLATION_ID, tokenExpiresAt: future() },
    referents: [],
  };
}

/** The owner's session-row workspace: repoA active, repoB beside it, one Connection. */
function twoRepoOwnerRow() {
  return {
    session: {
      workspaces: [{
        urlKey: 'acme',
        provider: 'github',
        bindings: [
          { provider: 'github', scope: REPO_A, connectionId: CONNECTION_ID },
          { provider: 'github', scope: REPO_B, connectionId: CONNECTION_ID },
        ],
        activeBinding: { provider: 'github', scope: REPO_A },
      }],
    },
    workspaceIndex: 0,
  };
}

function accessWith({ connections, ownerRow }) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => connections },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

describe('LIN-3241 arm characterization — the connection-first arm projects the binding scope, never the installation id', () => {
  test('GitHub connection-backed workspace: call scope repo is the active binding repo, not unitId', async () => {
    const access = accessWith({ connections: [githubConnection()], ownerRow: twoRepoOwnerRow() });

    const out = await access.resolveConnectionBackedAccess({ urlKey: 'acme', ownerAccountId: 'acct', sessions: [] });

    assert.ok(out?.result, 'the live owner Connection is served');
    assert.deepEqual(
      out.result.scope,
      { token: 'tok-a', repo: REPO_A },
      'the call scope carries the real default repo, not the installation id'
    );
    assert.notEqual(out.result.scope.repo, INSTALLATION_ID, 'unitId must stay Connection identity only');
  });
});
