/**
 * LIN-4034 — every dispatch row names its issue. The title is stamped where the row is built,
 * from a read the entrance already makes (no new tracker read, no new refusal):
 *
 *   - session and proxy lanes: the dangling-referent guard's own issue read (`probeDanglingReferent`);
 *   - verb override: the issue `contextFor` already holds;
 *   - recommend descent: the TERMINAL hop's title (`rec.title`), never the parent the caller named;
 *   - kickoff: the named issue the kickoff's context read already holds.
 *
 * A title the caller sends wins. A tracker title is untrusted text: it is cleaned and clipped, and
 * never refuses the dispatch. A guard that throws, has no credential, or has no guard stamps no title
 * and still dispatches.
 *
 * Run with: node --test tests/unit/lin-4034-dispatch-row-title.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { probeDanglingReferent, isDanglingReferent } from '../../lib/dispatch-referent-guard.js';
import { stampableIssueTitle, MAX_NAME_LENGTH } from '../../lib/dispatch-validation.js';
import { testMockData } from '../../lib/sample-data/mock-data.js';
import { setLinearFetchImpl } from '../../lib/linear-fetch.js';
import { issueWriteGuard as linearIssueWriteGuard } from '../../lib/providers/linear/index.js';

const mockTitle = (identifier) => testMockData.issues.find(i => i.identifier === identifier).title;

// A provider whose issueWriteGuard answers the way Linear's does: the issue (with its title) or null.
function fakeProvider({ issue = null, resolves = true, throws = false, omitGuard = false, name = 'linear' } = {}) {
  const p = { name, supports: () => true };
  if (!omitGuard) {
    p.issueWriteGuard = async (_token, id) => {
      if (throws) throw new Error('provider outage');
      return resolves ? { id, trashed: false, team: { id: 't' }, title: issue ?? `Title of ${id}` } : null;
    };
  }
  return p;
}

// ── Pure: the stamp cleans and clips, and never refuses ─────────────────────

describe('LIN-4034 — stampableIssueTitle cleans a tracker title and never refuses it', () => {
  test('drops control characters, including NUL and newlines, and trims the result', () => {
    assert.equal(stampableIssueTitle('  Fix\u0000 the\nthing\u0007  '), 'Fix the thing');
  });

  test('clips to the caller-title limit, counted in characters', () => {
    const stamped = stampableIssueTitle('a'.repeat(10_000));
    assert.equal(stamped.length, MAX_NAME_LENGTH);
  });

  test('a title that cleans to nothing stamps no title; a non-string stamps no title', () => {
    assert.equal(stampableIssueTitle('\u0000\u0001'), null);
    assert.equal(stampableIssueTitle('   '), null);
    assert.equal(stampableIssueTitle(undefined), null);
    assert.equal(stampableIssueTitle(42), null);
  });
});

// ── Pure: the probe answers the issue as well as the verdict ────────────────

describe('LIN-4034 — probeDanglingReferent answers the issue; the boolean wraps it unchanged', () => {
  const cases = [
    ['a resolved referent', fakeProvider({ issue: 'Ship it' }), { dangling: false, title: 'Ship it' }],
    ['a definitive absence', fakeProvider({ resolves: false }), { dangling: true, title: null }],
    ['a throwing probe (fails open, no title)', fakeProvider({ throws: true }), { dangling: false, title: null }],
    ['a provider without the guard (skipped)', fakeProvider({ omitGuard: true, name: 'github-projects' }), { dangling: false, title: null }],
  ];
  for (const [label, provider, want] of cases) {
    test(`${label}`, async () => {
      const got = await probeDanglingReferent({ provider, token: 'T', issueIdentifier: 'LIN-1' });
      assert.equal(got.dangling, want.dangling);
      assert.equal(got.issue ? got.issue.title : null, want.title);
      assert.equal(await isDanglingReferent({ provider, token: 'T', issueIdentifier: 'LIN-1' }), want.dangling,
        'the boolean must be the probe\'s verdict');
    });
  }

  test('an undefined guard response is a malformed answer: allowed, no title', async () => {
    const provider = { name: 'linear', issueWriteGuard: async () => undefined };
    assert.deepEqual(await probeDanglingReferent({ provider, token: 'T', issueIdentifier: 'LIN-1' }), { dangling: false, issue: null });
  });
});

// ── Route: the session and proxy lanes stamp the referent's title ───────────

function buildProxyApp(captured, { provider, token = 'test-token' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    provider,
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        // fixture:LIN-3136
        grants: ['dispatch'], workspaceId: 'ws-acme',
        // /fixture:LIN-3136
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason: token ? 'ok' : 'no_credential' }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.calls = (captured.calls || 0) + 1;
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-10-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

function buildSessionApp(captured, { provider, accessToken = 'test-token' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { accountId: 'acct-1' }; next(); });
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    provider,
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.calls = (captured.calls || 0) + 1;
        captured.item = item;
        return { _id: 'disp-2', dispatchedAt: '2026-10-30T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: req.params.urlKey, id: 'ws-1', accessToken };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchPresetsStore: {},
    proxyTokenStore: {}
  }));
  return app;
}

async function call(app, method, path, body, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything', ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-4034 — POST /api/proxy/dispatch (proxy lane) stamps the referent\'s title', () => {
  test('a resolved referent stamps its tracker title on the row', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured, { provider: fakeProvider({ issue: 'Ship the thing' }) }),
      'post', '/api/proxy/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-4034' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Ship the thing');
  });

  test('a title the caller sends wins over the tracker\'s', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured, { provider: fakeProvider({ issue: 'Tracker says' }) }),
      'post', '/api/proxy/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-4034', issueTitle: 'Caller says' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Caller says');
  });

  test('an untrusted tracker title is cleaned and clipped, and the dispatch still lands (201)', async () => {
    const hostile = `<img src=x onerror="alert(1)">\u0000\u0007 ${'z'.repeat(10_000)}`;
    const captured = {};
    const res = await call(buildProxyApp(captured, { provider: fakeProvider({ issue: hostile }) }),
      'post', '/api/proxy/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-4034' });
    assert.equal(res.status, 201, `an untrusted title must never refuse: ${JSON.stringify(res.body)}`);
    assert.equal(captured.calls, 1);
    assert.ok(captured.item.issueTitle.startsWith('<img src=x onerror="alert(1)">'), 'the text is kept, to be escaped on render');
    assert.ok(!/[\x00-\x1F\x7F]/.test(captured.item.issueTitle), 'control characters are stripped');
    assert.equal(captured.item.issueTitle.length, MAX_NAME_LENGTH, 'the title is clipped to the caller-title limit');
  });

  test('a guard that throws still dispatches, with no title', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured, { provider: fakeProvider({ throws: true }) }),
      'post', '/api/proxy/dispatch', { prompt: 'x', issueIdentifier: 'LIN-4034' });
    assert.equal(res.status, 201);
    assert.equal(captured.calls, 1);
    assert.equal(captured.item.issueTitle, null);
  });

  test('an identifier-less dispatch never probes the tracker and stamps no title', async () => {
    const captured = {};
    let probed = false;
    const provider = fakeProvider({ issue: 'Should not be read' });
    const guard = provider.issueWriteGuard;
    provider.issueWriteGuard = async (...a) => { probed = true; return guard(...a); };
    const res = await call(buildProxyApp(captured, { provider }), 'post', '/api/proxy/dispatch', { prompt: 'a wake, no ticket' });
    assert.equal(res.status, 201);
    assert.equal(probed, false);
    assert.equal(captured.item.issueTitle, null);
  });
});

describe('LIN-4034 — POST /workspace/:urlKey/api/dispatch (session lane) stamps the referent\'s title', () => {
  test('a resolved referent stamps its tracker title on the row', async () => {
    const captured = {};
    const res = await call(buildSessionApp(captured, { provider: fakeProvider({ issue: 'Session title' }) }),
      'post', '/workspace/acme/api/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-4034' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Session title');
  });

  test('a title the caller sends wins', async () => {
    const captured = {};
    const res = await call(buildSessionApp(captured, { provider: fakeProvider({ issue: 'Tracker' }) }),
      'post', '/workspace/acme/api/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-4034', issueTitle: 'Mine' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Mine');
  });

  test('no credential: dispatches with no title (fail open)', async () => {
    const captured = {};
    const res = await call(buildSessionApp(captured, { provider: fakeProvider({ issue: 'Unread' }), accessToken: null }),
      'post', '/workspace/acme/api/dispatch', { prompt: 'x', issueIdentifier: 'LIN-4034' });
    assert.equal(res.status, 201);
    assert.equal(captured.item.issueTitle, null);
  });
});

// ── Route: the test-mode arms (override, descent, kickoff) ──────────────────
// The test-mode short-circuit (token === 'test-token') answers from testMockData, so the expected
// titles below are read from the same mock issues the arms are answering for.

function buildRecommendApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        // fixture:LIN-3136
        grants: ['dispatch'], workspaceId: 'ws-acme',
        // /fixture:LIN-3136
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000
    }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-10-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

const RECOMMEND = '/api/proxy/recommend-and-dispatch';

describe('LIN-4034 — recommend-and-dispatch stamps the title on both arms', () => {
  test('verb override: the named issue\'s own title', async () => {
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, mockTitle('TEST-1'));
  });

  test('verb override: a caller title wins', async () => {
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', issueTitle: 'Mine' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Mine');
  });

  test('descent into a container: the TERMINAL hop\'s title, not the parent the caller named', async () => {
    // TEST-1 is a started container with an open child, TEST-2. The descent lands on TEST-2, so the
    // row names TEST-2 and carries TEST-2's title. Stamping the parent's would leave the row mislabelled.
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', RECOMMEND, { issueIdentifier: 'TEST-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueIdentifier, 'TEST-2', 'the descent must have landed on the child for this witness to mean anything');
    assert.equal(captured.item.issueTitle, mockTitle('TEST-2'));
    assert.notEqual(captured.item.issueTitle, mockTitle('TEST-1'));
  });

  test('descent into a container: a caller title for the parent does not leak onto the child row', async () => {
    // The caller's title describes the issue it named (TEST-1). The descent moved to TEST-2, so the
    // row must carry TEST-2's title, not the parent's.
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', RECOMMEND, { issueIdentifier: 'TEST-1', issueTitle: 'Parent title' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueIdentifier, 'TEST-2', 'the descent must have landed on the child for this witness to mean anything');
    assert.equal(captured.item.issueTitle, mockTitle('TEST-2'));
  });
});

describe('LIN-4034 — autopilot kickoff stamps the named issue\'s title', () => {
  test('a scoped kickoff stamps the issue the kickoff context already read', async () => {
    // appendProxyContext:false keeps this about the row, not the proxy-token mint the kickoff
    // would otherwise make (this fixture's token store is not the real one).
    const captured = {};
    const res = await call(buildRecommendApp(captured), 'post', '/api/proxy/autopilot/kickoff',
      { issueIdentifier: 'TEST-1', goal: 'walk it', appendProxyContext: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, mockTitle('TEST-1'));
  });
});

// ── The Linear guard reads the title in the query it already sends ──────────

describe('LIN-4034 — the Linear write guard returns the title in its own query', () => {
  test('the guard query asks for `title` on the issue, and the guard passes it through', async () => {
    let sent = null;
    setLinearFetchImpl(async (_url, init) => {
      sent = JSON.parse(init.body);
      const data = { issue: { id: 'i1', trashed: false, title: 'Ship the thing', description: '', team: { id: 't' }, comments: { nodes: [] } } };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const issue = await linearIssueWriteGuard('lin_api_fixture', 'LIN-4034');
      assert.ok(/issue\(id: \$id\) \{[^}]*\btitle\b/.test(sent.query), `the guard must request title in the same query:\n${sent.query}`);
      assert.equal(issue.title, 'Ship the thing');
    } finally {
      setLinearFetchImpl(null);
    }
  });
});
