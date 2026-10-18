// LIN-3506 witness: the five direct readers of the `sessions` collection must
// not treat a row past its `expires` as live. All fakes; no live calls.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceIdMapFromSessions } from '../../lib/credential-invariant-sweep.js';
import { resolveRosterFromSessions, createObserverSweepRun } from '../../lib/observer-sweep.js';
import { createObserverPassRun } from '../../lib/observer-pass.js';
import { getUnattendedOpenRouterKey } from '../../lib/openrouter-key-resolver.js';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function row(expires, urlKey = 'only-in-expired') {
  const r = {
    _id: `sid-${urlKey}`,
    session: {
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey, provider: 'linear', accessToken: 'tok-from-row', tokenExpiresAt: NOW + 30 * DAY }]
    }
  };
  if (expires !== undefined) r.expires = expires;
  return r;
}
const expiredRow = () => row(new Date(NOW - 40 * DAY));
const liveRow = () => row(new Date(NOW + DAY));
const noExpiresRow = () => row(undefined);
const coll = rows => ({ find: () => ({ toArray: async () => rows }) });

const CASES = [
  ['expired', expiredRow, false],
  ['live', liveRow, true],
  ['no expires', noExpiresRow, true]
];

describe('LIN-3506: expired session rows are not live for direct readers', () => {
  for (const [label, make, shouldResolve] of CASES) {
    describe(`row: ${label}`, () => {
      it('resolveWorkspaceIdMapFromSessions', () => {
        const map = resolveWorkspaceIdMapFromSessions([make()], NOW);
        assert.equal(map.size, shouldResolve ? 1 : 0);
      });

      it('resolveRosterFromSessions', () => {
        const roster = resolveRosterFromSessions([make()], NOW);
        assert.deepEqual(roster, shouldResolve ? ['only-in-expired'] : []);
      });

      it('createObserverSweepRun picks urlKey', async () => {
        const picked = [];
        const run = createObserverSweepRun({
          sessionsCollection: coll([make()]),
          dispatchStore: { listObservedWorkspaceKeys: async () => [] },
          intervalMs: 1000,
          sweep: async urlKey => { picked.push(urlKey); },
          now: () => NOW
        });
        await run();
        assert.deepEqual(picked, shouldResolve ? ['only-in-expired'] : []);
      });

      it('createObserverPassRun picks urlKey', async () => {
        const picked = [];
        const run = createObserverPassRun({
          sessionsCollection: coll([make()]),
          dispatchStore: { listObservedWorkspaceKeys: async () => [] },
          intervalMs: 1000,
          pass: async urlKey => { picked.push(urlKey); },
          now: () => NOW
        });
        await run();
        assert.deepEqual(picked, shouldResolve ? ['only-in-expired'] : []);
      });

      it('getUnattendedOpenRouterKey reaches the owner lookup only for a live row', async () => {
        const calls = [];
        const deps = {
          userPreferencesStore: {},
          sessionsCollection: coll([make()]),
          accountWorkspaceStore: { listAccountsForWorkspace: async id => { calls.push(id); return []; } },
          accountStore: {},
          now: () => NOW
        };
        const key = await getUnattendedOpenRouterKey(deps, { urlKey: 'only-in-expired' });
        assert.equal(key, null);
        assert.deepEqual(calls, shouldResolve ? ['ws-1'] : []);
      });

      it('workspace title resolver fetches with the row token only for a live row', async () => {
        const tokens = [];
        const resolver = createWorkspaceTitleResolver({
          sessionsCollection: coll([make()]),
          fetchWorkspaceIssues: async ws => { tokens.push(ws.accessToken); return [{ identifier: 'X-1', title: 'fetched' }]; },
          now: () => NOW
        });
        const titles = await resolver.resolveWorkspaceTitles('only-in-expired', 'acct-1');
        assert.deepEqual(tokens, shouldResolve ? ['tok-from-row'] : []);
        assert.deepEqual(titles, shouldResolve ? { 'X-1': 'fetched' } : {});
      });
    });
  }

  it('title resolver filters before the connection-backed arm too', async () => {
    let armSessions = null;
    const resolver = createWorkspaceTitleResolver({
      sessionsCollection: coll([expiredRow(), liveRow()]),
      fetchWorkspaceIssues: async () => [],
      resolveConnectionBackedWorkspace: async ({ sessions }) => { armSessions = sessions; return null; },
      now: () => NOW
    });
    await resolver.resolveWorkspaceForTitles('only-in-expired', 'acct-1');
    assert.equal(armSessions.length, 1);
    assert.ok(armSessions[0].expires.getTime() > NOW);
  });
});
