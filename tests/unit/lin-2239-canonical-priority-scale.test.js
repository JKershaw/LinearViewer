/**
 * LIN-2239 — canonical ascending priority scale (0=unknown, 1=lowest …
 * ascending), abstracted at the provider boundary.
 *
 * `priority`/`priorityLabel` stay Linear-native (0=none, 1=Urgent … 4=Low,
 * DESCENDING) and UNCHANGED by this ticket — every existing caller keeps its
 * existing meaning, byte-identical. `priorityLevel` is a NEW, purely additive
 * field carrying the canonical ascending scale, deliberately not a
 * redefinition of `priority` in place (a same-name/same-type/same-range flip
 * would be a silent inversion — see John's ruling comment on the ticket).
 *
 * Three layers pinned here:
 *   1. lib/providers/models.js — the mapping functions, both directions, for
 *      every value in range, plus the out-of-range fail-safe.
 *   2. lib/proxy-wire.js's flattenIssue — the derived `priorityLevel` on the
 *      read/write-echo wire shape.
 *   3. routes/proxy.js's POST/PATCH /api/proxy/issues — the write-path
 *      conversion, the both-fields-refused-400 guard, and capability parity
 *      with `priority`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  PRIORITY_UNKNOWN,
  linearPriorityToCanonical,
  canonicalPriorityToLinear,
} from '../../lib/providers/models.js';
import { flattenIssue } from '../../lib/proxy-wire.js';
import { createProxyRoutes } from '../../routes/proxy.js';

// ---------------------------------------------------------------------------
// 1. lib/providers/models.js — the mapping, both directions
// ---------------------------------------------------------------------------

describe('LIN-2239 — canonical priority mapping (lib/providers/models.js)', () => {
  test('PRIORITY_UNKNOWN is 0', () => {
    assert.equal(PRIORITY_UNKNOWN, 0);
  });

  // Linear-native -> canonical: 0=none->0=unknown, 1=Urgent->4=highest,
  // 2=High->3, 3=Medium->2, 4=Low->1=lowest.
  const NATIVE_TO_CANONICAL = [
    [0, 0], [1, 4], [2, 3], [3, 2], [4, 1],
  ];
  for (const [native, canonical] of NATIVE_TO_CANONICAL) {
    test(`linearPriorityToCanonical(${native}) === ${canonical}`, () => {
      assert.equal(linearPriorityToCanonical(native), canonical);
    });
    test(`canonicalPriorityToLinear(${canonical}) === ${native} (round-trips)`, () => {
      assert.equal(canonicalPriorityToLinear(canonical), native);
    });
  }

  test('self-inverse: mapping twice returns the original value for every in-range integer', () => {
    for (let v = 0; v <= 4; v++) {
      assert.equal(linearPriorityToCanonical(linearPriorityToCanonical(v)), v);
      assert.equal(canonicalPriorityToLinear(canonicalPriorityToLinear(v)), v);
    }
  });

  test('out-of-range or non-integer input maps to unknown (0), fail-safe', () => {
    for (const bad of [-1, 5, 99, 1.5, NaN, undefined, null, 'x']) {
      assert.equal(linearPriorityToCanonical(bad), 0);
      assert.equal(canonicalPriorityToLinear(bad), 0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. lib/proxy-wire.js flattenIssue — derived priorityLevel on the wire
// ---------------------------------------------------------------------------

describe('LIN-2239 — flattenIssue derives priorityLevel additively', () => {
  test('adds priorityLevel alongside the untouched priority/priorityLabel', () => {
    const issue = { id: 'x', priority: 1, priorityLabel: 'Urgent' };
    flattenIssue(issue);
    assert.equal(issue.priority, 1, 'priority is untouched');
    assert.equal(issue.priorityLabel, 'Urgent', 'priorityLabel is untouched');
    assert.equal(issue.priorityLevel, 4, 'priorityLevel is the canonical inverse');
  });

  test('a provider with no priority signal (native 0) reads canonical unknown, with no source branch needed', () => {
    // Mirrors github/github-projects/jira's _toCanonicalIssue: priority: 0, no priorityLabel.
    const issue = { id: 'gh-1', priority: 0 };
    flattenIssue(issue);
    assert.equal(issue.priorityLevel, 0);
  });

  test('every native value maps correctly through the shared wire pass', () => {
    const expected = { 0: 0, 1: 4, 2: 3, 3: 2, 4: 1 };
    for (const [native, level] of Object.entries(expected)) {
      const issue = { priority: Number(native) };
      flattenIssue(issue);
      assert.equal(issue.priorityLevel, level);
    }
  });

  test('an object with no priority field is left without priorityLevel (no field invented)', () => {
    const issue = { id: 'x', title: 'no priority selected' };
    flattenIssue(issue);
    assert.equal('priorityLevel' in issue, false);
  });

  test('recurses into children, each carrying its own priorityLevel when children select priority', () => {
    const issue = { id: 'parent', priority: 2, children: { nodes: [{ id: 'c1', priority: 4 }] } };
    flattenIssue(issue);
    assert.equal(issue.priorityLevel, 3);
    assert.equal(issue.children[0].priorityLevel, 1);
  });
});

// ---------------------------------------------------------------------------
// 3. routes/proxy.js — the write path
// ---------------------------------------------------------------------------

const TEAM_UUID = '11111111-1111-1111-1111-111111111111';
const ISSUE_UUID = '66666666-6666-6666-6666-666666666666';

function makeProvider(overrides = {}) {
  const calls = { createIssue: [], updateIssue: [] };
  const provider = {
    name: 'fake',
    supports: () => true,
    apiWriteFields: overrides.apiWriteFields || (() => ['title', 'description', 'teamId', 'priority']),
    fetchTeams: async () => [{ id: TEAM_UUID, name: 'Team' }],
    issueWriteGuard: async () => ({ id: ISSUE_UUID, trashed: false, team: { id: TEAM_UUID } }),
    async createIssue(_token, input) {
      calls.createIssue.push(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'ACME-1', ...input } };
    },
    async updateIssue(_token, issueId, input) {
      calls.updateIssue.push({ issueId, input });
      return { success: true, issue: { id: 'iss-1', identifier: issueId, ...input } };
    },
  };
  return { provider, calls };
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('POST /api/proxy/issues — priorityLevel (LIN-2239)', () => {
  test('converts canonical priorityLevel to Linear-native priority before it reaches the provider', async () => {
    const { provider, calls } = makeProvider();
    const { status } = await request(buildApp(provider), '/api/proxy/issues', {
      method: 'POST',
      body: { teamId: TEAM_UUID, title: 'x', priorityLevel: 4 }, // canonical highest
    });
    assert.equal(status, 201);
    assert.equal(calls.createIssue[0].priority, 1); // Linear-native Urgent
  });

  test('bare priority still works unchanged (byte-identical to before this ticket)', async () => {
    const { provider, calls } = makeProvider();
    const { status } = await request(buildApp(provider), '/api/proxy/issues', {
      method: 'POST',
      body: { teamId: TEAM_UUID, title: 'x', priority: 1 },
    });
    assert.equal(status, 201);
    assert.equal(calls.createIssue[0].priority, 1);
  });

  test('sending both priority and priorityLevel is refused 400, no provider call — never silently picks one', async () => {
    const { provider, calls } = makeProvider();
    const { status, body } = await request(buildApp(provider), '/api/proxy/issues', {
      method: 'POST',
      body: { teamId: TEAM_UUID, title: 'x', priority: 1, priorityLevel: 4 },
    });
    assert.equal(status, 400);
    assert.match(body.error, /only one of priority.*priorityLevel/i);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses priorityLevel (400) for a provider whose apiWriteFields() excludes priority — same capability gate as priority', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: () => ['title', 'description', 'teamId'] });
    const { status, body } = await request(buildApp(provider), '/api/proxy/issues', {
      method: 'POST',
      body: { teamId: TEAM_UUID, title: 'x', priorityLevel: 4 },
    });
    assert.equal(status, 400);
    assert.match(body.error, /priorityLevel is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('an out-of-range priorityLevel is silently ignored, same convention as priority', async () => {
    const { provider, calls } = makeProvider();
    const { status } = await request(buildApp(provider), '/api/proxy/issues', {
      method: 'POST',
      body: { teamId: TEAM_UUID, title: 'x', priorityLevel: 99 },
    });
    assert.equal(status, 201);
    assert.equal('priority' in calls.createIssue[0], false);
  });
});

describe('PATCH /api/proxy/issues/:issueId — priorityLevel (LIN-2239)', () => {
  test('converts canonical priorityLevel to Linear-native priority before it reaches the provider', async () => {
    const { provider, calls } = makeProvider();
    const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
      method: 'PATCH',
      body: { priorityLevel: 1 }, // canonical lowest
    });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue[0].input.priority, 4); // Linear-native Low
  });

  test('bare priority still works unchanged', async () => {
    const { provider, calls } = makeProvider();
    const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
      method: 'PATCH',
      body: { priority: 3 },
    });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue[0].input.priority, 3);
  });

  test('sending both priority and priorityLevel is refused 400, no provider call', async () => {
    const { provider, calls } = makeProvider();
    const { status, body } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
      method: 'PATCH',
      body: { priority: 3, priorityLevel: 2 },
    });
    assert.equal(status, 400);
    assert.match(body.error, /only one of priority.*priorityLevel/i);
    assert.equal(calls.updateIssue.length, 0);
  });

  test('a priorityLevel-only body is a valid updatable field (not rejected as an empty body)', async () => {
    const { provider } = makeProvider();
    const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
      method: 'PATCH',
      body: { priorityLevel: 0 },
    });
    assert.equal(status, 200);
  });
});
