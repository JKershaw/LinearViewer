/**
 * Unit tests for the workspace title-resolution glue (LIN-962, owner-scoped
 * selection since LIN-1986).
 *
 * This exercises the REAL `server.js` resolver wiring — extracted verbatim into
 * `createWorkspaceTitleResolver` so it can be driven with a FAKE Linear client
 * (fake `fetchWorkspaceIssues`) and a fake sessions collection, rather than a
 * reimplementation. It closes close-out ledger item 1 for the parts CI can reach:
 * session scan → owner-scoped workspace-row pick (delegated to
 * `selectOwnerWorkspaceRow`, lib/workspace-token-resolver.js) → issue fetch → map
 * build, plus the best-effort degradation paths. The one residue CI still cannot
 * prove is the real EXTERNAL Linear fetch inside the production
 * `fetchWorkspaceIssues`; that remains a post-merge observation, as the reviewer
 * framed it.
 *
 * LIN-1986: selection is now delegated to `selectOwnerWorkspaceRow`, which bakes
 * in real `Date.now()` (sibling-shaped with `selectExpiredOwnerRow`/
 * `selectOwnerSessionRow` — no injected clock), so fixtures below use
 * `Date.now()`-relative expiry offsets (mirroring
 * tests/unit/workspace-token-refresh.test.js's Block A/C convention) instead of
 * the old fixed `now: () => NOW` clock. Every fixture that reaches the selector
 * also needs `data.accountId` plus a matching `ownerAccountId` at the call site.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';

const BUFFER_MS = 5 * 60 * 1000; // mirrors TOKEN_REFRESH_BUFFER_MS
const FAR_FUTURE_MS = 10_000_000; // ~2.8h — comfortably past the 5-minute refresh buffer
const PAST_MS = -10_000; // already expired

const OWNER = 'account-A';

// A fake Mongo/Mango sessions collection: `find({}).toArray()` yields the docs.
function fakeSessions(docs) {
  return { find: () => ({ toArray: async () => docs }) };
}

// A fake "Linear client": records the workspace it was asked about and returns a
// canned issue set.
function fakeIssuesFetcher(issues) {
  const calls = [];
  const fn = async (workspace) => { calls.push(workspace); return issues; };
  fn.calls = calls;
  return fn;
}

function make({ sessions = [], issues = [], fetchWorkspaceIssues } = {}) {
  const fetcher = fetchWorkspaceIssues || fakeIssuesFetcher(issues);
  const resolver = createWorkspaceTitleResolver({
    sessionsCollection: fakeSessions(sessions),
    fetchWorkspaceIssues: fetcher
  });
  return { resolver, fetcher };
}

test('LIN-962/1986 glue: session scan → owner-scoped workspace pick → issue fetch → {identifier→title} map', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok-acme', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }
    ],
    issues: [
      { identifier: 'LIN-701', title: 'Fix the login bug' },
      { identifier: 'LIN-702', title: 'Ship the dashboard' }
    ]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', OWNER);

  assert.deepEqual(titles, { 'LIN-701': 'Fix the login bug', 'LIN-702': 'Ship the dashboard' });
  assert.equal(fetcher.calls.length, 1, 'Linear issue set fetched exactly once');
  assert.equal(fetcher.calls[0].accessToken, 'tok-acme', 'fetched with the resolved workspace (its token)');
});

test('LIN-962/1986 glue: among the OWNER\'S OWN rows, picks the LATEST-expiring live token', async () => {
  const laterExpiry = Date.now() + FAR_FUTURE_MS + 10 * 60 * 1000;
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'stale-but-live', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } },
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'freshest', tokenExpiresAt: laterExpiry }] } },
      { session: { accountId: 'account-B', workspaces: [{ urlKey: 'acme', accessToken: 'other-owner', tokenExpiresAt: laterExpiry }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  await resolver.resolveWorkspaceTitles('acme', OWNER);

  assert.equal(fetcher.calls[0].accessToken, 'freshest', 'latest-expiring token among the OWNER\'s own rows wins the pick');
});

test('LIN-962/1986 glue: cross-account isolation — owner A never resolves via owner B\'s live-only row for the same urlKey', async () => {
  // The LIN-1986 regression test: pre-change (owner-blind) code would have
  // resolved this via account-B's live row despite account-A having none.
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: 'account-B', workspaces: [{ urlKey: 'acme', accessToken: 'owner-b-live', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', OWNER);

  assert.deepEqual(titles, {}, 'owner A has no live row of their own → {} even though owner B does');
  assert.equal(fetcher.calls.length, 0, 'never fetches under another account\'s credential');
});

test('LIN-962/1986 glue: no ownerAccountId supplied → {} (fails closed, never falls back owner-blind)', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', null);

  assert.deepEqual(titles, {});
  assert.equal(fetcher.calls.length, 0);
});

test('LIN-962/1986 glue: a token expiring within the refresh buffer is not usable → {} (no fetch)', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'about-to-expire', tokenExpiresAt: Date.now() + BUFFER_MS - 1000 }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', OWNER);

  assert.deepEqual(titles, {}, 'no live token → empty map');
  assert.equal(fetcher.calls.length, 0, 'no workspace resolved ⇒ Linear is never hit');
});

test('LIN-962/1986 glue: a session stored as a JSON string is parsed', async () => {
  const { resolver } = make({
    sessions: [
      { session: JSON.stringify({ accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] }) }
    ],
    issues: [{ identifier: 'LIN-9', title: 'From a stringified session' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', OWNER);

  assert.deepEqual(titles, { 'LIN-9': 'From a stringified session' });
});

test('LIN-962/1986 glue: a workspace missing an accessToken is skipped', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } } // no accessToken
    ]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme', OWNER);
  assert.deepEqual(titles, {});
  assert.equal(fetcher.calls.length, 0);
});

test('LIN-962/1986 glue: no session references the workspace → {}', async () => {
  const { resolver } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'someone-else', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }
    ]
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme', OWNER), {});
});

test('LIN-962/1986 glue: only issues carrying BOTH identifier and title enter the map', async () => {
  const { resolver } = make({
    sessions: [{ session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }],
    issues: [
      { identifier: 'LIN-1', title: 'Kept' },
      { identifier: 'LIN-2' },                 // no title → dropped
      { title: 'No identifier' },              // no identifier → dropped
      null                                     // defensive
    ]
  });

  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme', OWNER), { 'LIN-1': 'Kept' });
});

test('LIN-962/1986 glue: fetchWorkspaceIssues throwing degrades to {} (never worse)', async () => {
  const { resolver } = make({
    sessions: [{ session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }],
    fetchWorkspaceIssues: async () => { throw new Error('Linear 500'); }
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme', OWNER), {});
});

test('LIN-962/1986 glue: a sessions-store read failure degrades to {} (never throws)', async () => {
  const resolver = createWorkspaceTitleResolver({
    sessionsCollection: { find: () => ({ toArray: async () => { throw new Error('mongo down'); } }) },
    fetchWorkspaceIssues: fakeIssuesFetcher([{ identifier: 'LIN-1', title: 'A' }])
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme', OWNER), {});
});

test('LIN-962/1986 glue: resolveWorkspaceForTitles returns the raw workspace row with the owner\'s live token', async () => {
  // Direct assertion on the first half of the glue (the workspace pick), independent
  // of the issue fetch.
  const { resolver } = make({
    sessions: [
      { session: { accountId: OWNER, workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: Date.now() + FAR_FUTURE_MS }] } }
    ]
  });
  const ws = await resolver.resolveWorkspaceForTitles('acme', OWNER);
  assert.equal(ws.accessToken, 'tok');
  assert.equal(ws.urlKey, 'acme');
});

test('LIN-962 glue: the NODE_ENV=test / urlKey=\'test-workspace\' short-circuit bypasses selection entirely', async () => {
  process.env.NODE_ENV = 'test';
  const { resolver } = make({ sessions: [] });
  const ws = await resolver.resolveWorkspaceForTitles('test-workspace', OWNER);
  assert.deepEqual(ws, { urlKey: 'test-workspace', accessToken: 'test-token' });
});
