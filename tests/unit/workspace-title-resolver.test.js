/**
 * Unit tests for the workspace title-resolution glue (LIN-962).
 *
 * This exercises the REAL `server.js` resolver wiring — extracted verbatim into
 * `createWorkspaceTitleResolver` so it can be driven with a FAKE Linear client
 * (fake `fetchWorkspaceIssues`) and a fake sessions collection, rather than a
 * reimplementation. It closes close-out ledger item 1 for the parts CI can reach:
 * session scan → latest-expiring-token workspace pick → issue fetch → map build,
 * plus the best-effort degradation paths. The one residue CI still cannot prove is
 * the real EXTERNAL Linear fetch inside the production `fetchWorkspaceIssues`; that
 * remains a post-merge observation, as the reviewer framed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';

const BUFFER_MS = 5 * 60 * 1000; // mirrors TOKEN_REFRESH_BUFFER_MS
const NOW = 1_000_000_000_000; // fixed clock
const live = NOW + BUFFER_MS + 60_000; // comfortably past the refresh buffer
const expired = NOW + 60_000; // within the buffer → not usable

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
    fetchWorkspaceIssues: fetcher,
    tokenRefreshBufferMs: BUFFER_MS,
    now: () => NOW
  });
  return { resolver, fetcher };
}

test('LIN-962 glue: session scan → workspace pick → issue fetch → {identifier→title} map', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'acme', accessToken: 'tok-acme', tokenExpiresAt: live }] } }
    ],
    issues: [
      { identifier: 'LIN-701', title: 'Fix the login bug' },
      { identifier: 'LIN-702', title: 'Ship the dashboard' }
    ]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme');

  assert.deepEqual(titles, { 'LIN-701': 'Fix the login bug', 'LIN-702': 'Ship the dashboard' });
  assert.equal(fetcher.calls.length, 1, 'Linear issue set fetched exactly once');
  assert.equal(fetcher.calls[0].accessToken, 'tok-acme', 'fetched with the resolved workspace (its token)');
});

test('LIN-962 glue: picks the workspace with the LATEST-expiring live token', async () => {
  const laterLive = live + 10 * 60 * 1000;
  const { resolver, fetcher } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'acme', accessToken: 'stale-but-live', tokenExpiresAt: live }] } },
      { session: { workspaces: [{ urlKey: 'acme', accessToken: 'freshest', tokenExpiresAt: laterLive }] } },
      { session: { workspaces: [{ urlKey: 'other', accessToken: 'nope', tokenExpiresAt: laterLive }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  await resolver.resolveWorkspaceTitles('acme');

  assert.equal(fetcher.calls[0].accessToken, 'freshest', 'latest-expiring token wins the pick');
});

test('LIN-962 glue: a token expiring within the refresh buffer is not usable → {} (no fetch)', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'acme', accessToken: 'about-to-expire', tokenExpiresAt: expired }] } }
    ],
    issues: [{ identifier: 'LIN-1', title: 'A' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme');

  assert.deepEqual(titles, {}, 'no live token → empty map');
  assert.equal(fetcher.calls.length, 0, 'no workspace resolved ⇒ Linear is never hit');
});

test('LIN-962 glue: a session stored as a JSON string is parsed', async () => {
  const { resolver } = make({
    sessions: [
      { session: JSON.stringify({ workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: live }] }) }
    ],
    issues: [{ identifier: 'LIN-9', title: 'From a stringified session' }]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme');

  assert.deepEqual(titles, { 'LIN-9': 'From a stringified session' });
});

test('LIN-962 glue: a workspace missing an accessToken is skipped', async () => {
  const { resolver, fetcher } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'acme', tokenExpiresAt: live }] } } // no accessToken
    ]
  });

  const titles = await resolver.resolveWorkspaceTitles('acme');
  assert.deepEqual(titles, {});
  assert.equal(fetcher.calls.length, 0);
});

test('LIN-962 glue: no session references the workspace → {}', async () => {
  const { resolver } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'someone-else', accessToken: 'tok', tokenExpiresAt: live }] } }
    ]
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme'), {});
});

test('LIN-962 glue: only issues carrying BOTH identifier and title enter the map', async () => {
  const { resolver } = make({
    sessions: [{ session: { workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: live }] } }],
    issues: [
      { identifier: 'LIN-1', title: 'Kept' },
      { identifier: 'LIN-2' },                 // no title → dropped
      { title: 'No identifier' },              // no identifier → dropped
      null                                     // defensive
    ]
  });

  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme'), { 'LIN-1': 'Kept' });
});

test('LIN-962 glue: fetchWorkspaceIssues throwing degrades to {} (never worse)', async () => {
  const { resolver } = make({
    sessions: [{ session: { workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: live }] } }],
    fetchWorkspaceIssues: async () => { throw new Error('Linear 500'); }
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme'), {});
});

test('LIN-962 glue: a sessions-store read failure degrades to {} (never throws)', async () => {
  const resolver = createWorkspaceTitleResolver({
    sessionsCollection: { find: () => ({ toArray: async () => { throw new Error('mongo down'); } }) },
    fetchWorkspaceIssues: fakeIssuesFetcher([{ identifier: 'LIN-1', title: 'A' }]),
    tokenRefreshBufferMs: BUFFER_MS,
    now: () => NOW
  });
  assert.deepEqual(await resolver.resolveWorkspaceTitles('acme'), {});
});

test('LIN-962 glue: resolveWorkspaceForTitles returns the raw workspace with the live token', async () => {
  // Direct assertion on the first half of the glue (the workspace pick), independent
  // of the issue fetch.
  const { resolver } = make({
    sessions: [
      { session: { workspaces: [{ urlKey: 'acme', accessToken: 'tok', tokenExpiresAt: live }] } }
    ]
  });
  const ws = await resolver.resolveWorkspaceForTitles('acme');
  assert.equal(ws.accessToken, 'tok');
  assert.equal(ws.urlKey, 'acme');
});
