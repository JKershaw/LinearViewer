/**
 * LIN-4036 — a dispatch row that names a Jira or GitHub issue carries that issue's tracker title.
 *
 * LIN-4034 stamps the title from the dangling-referent guard's own read, and that guard runs only
 * for GUARDED_PROVIDERS (linear, local). On the session and proxy lanes a Jira or GitHub dispatch
 * therefore stored no title. Now, for a title-less dispatch that names an issue, the entrance makes
 * one bounded, fail-open read of the provider's `issueWriteGuard`. It never refuses: a null, a
 * throw, no credential or a read past its cap all dispatch without a title. A caller's title wins,
 * and a dispatch with no issue, an abort or a cascade makes no read.
 *
 * Run with: node --test tests/unit/lin-4036-tracker-row-title.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { MAX_NAME_LENGTH } from '../../lib/dispatch-validation.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { readUnguardedIssue } from '../../lib/dispatch-referent-guard.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const ABORT_TO = '6f1c2a3e-1111-4222-8333-444455556666';

// A tracker provider whose `issueWriteGuard` answers as Jira's and GitHub's do: the issue (with its
// title) or null. `answer` is a value or a function of the identifier; `calls` counts the reads.
function trackerProvider(name, answer, calls = { n: 0 }) {
  return {
    name,
    supports: () => true,
    calls,
    issueWriteGuard: async (_token, id) => {
      calls.n += 1;
      return typeof answer === 'function' ? answer(id) : answer;
    }
  };
}

const issue = (title) => ({ id: 'x', trashed: false, team: { id: 't' }, title });

function proxyApp(captured, provider, store = {}) {
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
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      ...store,
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

function sessionApp(captured, { provider = null, workspace = { urlKey: 'acme', id: 'ws-1', accessToken: 'test-token' } } = {}) {
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
      req.workspace = workspace;
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

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PROXY = '/api/proxy/dispatch';
const SESSION = '/workspace/acme/api/dispatch';

// ── The title is read from the provider the lane names ──────────────────────

describe('LIN-4036 — a Jira or GitHub dispatch naming an issue is stamped with its tracker title', () => {
  for (const name of ['jira', 'github']) {
    test(`proxy lane, ${name}: the row carries the issue's title`, async () => {
      const captured = {};
      const calls = { n: 0 };
      const provider = trackerProvider(name, issue(`${name} title`), calls);
      const res = await call(proxyApp(captured, provider), 'post', PROXY, { prompt: 'real work', issueIdentifier: 'ENG-1' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(calls.n, 1, 'one tracker read, made for the title');
      assert.equal(captured.item.issueTitle, `${name} title`);
    });

    test(`session lane, ${name}: the row carries the issue's title`, async () => {
      const captured = {};
      const calls = { n: 0 };
      const provider = trackerProvider(name, issue(`${name} title`), calls);
      const res = await call(sessionApp(captured, { provider }), 'post', SESSION, { prompt: 'real work', issueIdentifier: 'ENG-1' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(calls.n, 1, 'one tracker read, made for the title');
      assert.equal(captured.item.issueTitle, `${name} title`);
    });
  }

  test('a Linear dispatch is not read twice: the guard\'s own read already carries the title', async () => {
    const captured = {};
    const calls = { n: 0 };
    const provider = trackerProvider('linear', issue('Linear title'), calls);
    const res = await call(proxyApp(captured, provider), 'post', PROXY, { prompt: 'real work', issueIdentifier: 'LIN-4036' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 1, 'the referent probe is the only read');
    assert.equal(captured.item.issueTitle, 'Linear title');
  });

  test('a Linear guard that answers malformed (undefined) is not read again for a title', async () => {
    // The probe allows on undefined without an issue, so the title read would be the second call.
    const captured = {};
    const calls = { n: 0 };
    const res = await call(proxyApp(captured, trackerProvider('linear', undefined, calls)),
      'post', PROXY, { prompt: 'x', issueIdentifier: 'LIN-4036' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 1, 'guarded providers are never read for a title outside the probe');
    assert.equal(captured.item.issueTitle, null);
  });
});

// ── Precedence and the reads that must not happen ───────────────────────────

describe('LIN-4036 — a caller\'s title wins, and a dispatch that needs no title makes no read', () => {
  test('proxy lane: a caller title is stored and the tracker is not read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(proxyApp(captured, trackerProvider('jira', issue('Tracker'), calls)),
      'post', PROXY, { prompt: 'real work', issueIdentifier: 'ENG-1', issueTitle: 'Mine' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Mine');
    assert.equal(calls.n, 0);
  });

  test('session lane: a caller title is stored and the tracker is not read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(sessionApp(captured, { provider: trackerProvider('github', issue('Tracker'), calls) }),
      'post', SESSION, { prompt: 'real work', issueIdentifier: '4036', issueTitle: 'Mine' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, 'Mine');
    assert.equal(calls.n, 0);
  });

  test('proxy lane: an abort names no title to read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(proxyApp(captured, trackerProvider('jira', issue('Tracker'), calls)),
      'post', PROXY, { abort: true, abortTo: ABORT_TO, issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 0);
    assert.equal(captured.item.issueTitle, null);
  });

  test('session lane: an abort names no title to read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(sessionApp(captured, { provider: trackerProvider('jira', issue('Tracker'), calls) }),
      'post', SESSION, { abort: true, abortTo: ABORT_TO, issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 0);
    assert.equal(captured.item.issueTitle, null);
  });

  test('proxy lane: a cascade expands in the store and names no title to read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const store = { expandCascadeAborts: async () => ({ aborts: [] }) };
    const res = await call(proxyApp(captured, trackerProvider('jira', issue('Tracker'), calls), store),
      'post', PROXY, { abort: true, cascade: true, abortTo: ABORT_TO, issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 0);
  });

  test('a dispatch with no issue named makes no read', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(proxyApp(captured, trackerProvider('jira', issue('Tracker'), calls)),
      'post', PROXY, { prompt: 'a wake, no ticket' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 0);
    assert.equal(captured.item.issueTitle, null);
  });

  test('session lane: no credential means no read, and the dispatch still lands', async () => {
    const captured = {};
    const calls = { n: 0 };
    const workspace = { urlKey: 'acme', id: 'ws-1', accessToken: null };
    const res = await call(sessionApp(captured, { provider: trackerProvider('jira', issue('Tracker'), calls), workspace }),
      'post', SESSION, { prompt: 'x', issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.n, 0);
    assert.equal(captured.item.issueTitle, null);
  });

  test('a provider without issueWriteGuard (github-projects) stamps nothing and dispatches', async () => {
    const captured = {};
    const provider = { name: 'github-projects', supports: () => true };
    const res = await call(proxyApp(captured, provider), 'post', PROXY, { prompt: 'x', issueIdentifier: 'PVT-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, null);
  });
});

// ── A failed or slow tracker read never refuses or stalls the dispatch ──────

describe('LIN-4036 — a failed tracker read never refuses the dispatch', () => {
  test('the guard answers null (GitHub: "not a number"): 201 with no title, not a 422', async () => {
    const captured = {};
    const calls = { n: 0 };
    const res = await call(proxyApp(captured, trackerProvider('github', null, calls)),
      'post', PROXY, { prompt: 'x', issueIdentifier: 'LIN-4036' });
    assert.equal(res.status, 201, `a null tracker read must not refuse: ${JSON.stringify(res.body)}`);
    assert.equal(calls.n, 1);
    assert.equal(captured.item.issueTitle, null);
  });

  test('the guard throws (outage): 201 with no title', async () => {
    const captured = {};
    const provider = trackerProvider('jira', () => { throw new Error('tracker outage'); });
    const res = await call(sessionApp(captured, { provider }), 'post', SESSION, { prompt: 'x', issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.calls, 1);
    assert.equal(captured.item.issueTitle, null);
  });

  test('the guard never answers: the read is capped, and the dispatch lands with no title', async () => {
    const captured = {};
    const provider = trackerProvider('jira', () => new Promise(() => {}));
    const started = Date.now();
    const res = await call(proxyApp(captured, provider), 'post', PROXY, { prompt: 'x', issueIdentifier: 'ENG-1' });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.issueTitle, null);
    assert.ok(elapsed < 10_000, `a hung tracker must not stall the dispatch (took ${elapsed}ms)`);
  });

  test('an untrusted tracker title is cleaned and clipped, and the dispatch still lands', async () => {
    const hostile = `<img src=x onerror="alert(1)">\u0000\u0007 ${'z'.repeat(10_000)}`;
    const captured = {};
    const res = await call(sessionApp(captured, { provider: trackerProvider('jira', issue(hostile)) }),
      'post', SESSION, { prompt: 'x', issueIdentifier: 'ENG-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item.issueTitle.startsWith('<img src=x onerror="alert(1)">'), 'the text is kept, to be escaped on render');
    assert.ok(!/[\x00-\x1F\x7F]/.test(captured.item.issueTitle), 'control characters are stripped');
    assert.equal(captured.item.issueTitle.length, MAX_NAME_LENGTH, 'the title is clipped to the caller-title limit');
  });
});

// ── A mixed-kind workspace reads the named kind's provider ──────────────────

describe('LIN-4036 — a mixed-kind workspace reads the named kind\'s provider', () => {
  test('a session dispatch with issueSource: jira reads jira, and never the active linear provider', async () => {
    const linearCalls = { n: 0 };
    const jiraCalls = { n: 0 };
    registerProvider(trackerProvider('linear', issue('Linear title'), linearCalls));
    registerProvider(trackerProvider('jira', issue('Jira title'), jiraCalls));
    const workspace = {
      urlKey: 'acme',
      id: 'ws-1',
      provider: 'linear',
      bindings: [
        { provider: 'linear', scope: 'ws-1', credentials: { token: 'lin-tok' } },
        { provider: 'jira', scope: 'jira-site', credentials: { token: 'jira-tok' } }
      ]
    };
    const captured = {};
    const res = await call(sessionApp(captured, { workspace }), 'post', SESSION,
      { prompt: 'real work', issueIdentifier: 'ENG-1', issueSource: 'jira' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(jiraCalls.n, 1);
    assert.equal(linearCalls.n, 0);
    assert.equal(captured.item.issueTitle, 'Jira title');
  });
});

describe('LIN-4036 — the title read logs a swallowed auth failure (digest only) and fails open', () => {
  const authError = () => { const e = new Error('bad credential'); e.response = { status: 401 }; return e; };

  async function warnsDuring(fn) {
    const warns = [];
    const realWarn = console.warn;
    console.warn = (...args) => warns.push(args);
    try { await fn(); } finally { console.warn = realWarn; }
    return warns;
  }

  test('an auth error returns null and logs one [dispatch-referent-auth-swallowed] line with no token bytes', async () => {
    let result;
    const warns = await warnsDuring(async () => {
      result = await readUnguardedIssue({
        provider: { name: 'jira', issueWriteGuard: async () => { throw authError(); } },
        token: 'dead-jira-token',
        issueIdentifier: 'ENG-1'
      });
    });
    assert.equal(result, null, 'fail-open: an auth failure is never a refusal');
    const lines = warns.filter((args) => args[0] === '[dispatch-referent-auth-swallowed]');
    assert.equal(lines.length, 1);
    assert.equal(lines[0][1].provider, 'jira');
    assert.equal(lines[0][1].issueIdentifier, 'ENG-1');
    assert.equal(lines[0][1].credentialFingerprint, fingerprintCredential('dead-jira-token'));
    assert.ok(!JSON.stringify(lines[0][1]).includes('dead-jira-token'), 'digest only, never token bytes');
  });

  test('a non-auth error returns null with no auth line', async () => {
    let result;
    const warns = await warnsDuring(async () => {
      result = await readUnguardedIssue({
        provider: { name: 'github', issueWriteGuard: async () => { const e = new Error('boom'); e.response = { status: 500 }; throw e; } },
        token: 'tok',
        issueIdentifier: '7'
      });
    });
    assert.equal(result, null);
    assert.equal(warns.filter((args) => args[0] === '[dispatch-referent-auth-swallowed]').length, 0);
  });
});
