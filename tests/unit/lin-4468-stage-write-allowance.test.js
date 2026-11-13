/**
 * LIN-4468 (piece 4 of LIN-4448, behaviour D): the proxy refuses a stage's writes outside its
 * allowance. A reading stage cannot make a tracker write it is not allowed to make.
 *
 * Two enforcement points share one table (lib/stage-writes.js):
 *   1. the route-level gate (lib/stage-write-gate.js) names each mount's operation and refuses a
 *      stamped token whose allowance does not list it, before any provider read;
 *   2. the ticket match (routes/proxy-writes.js guardTarget), after the provider read, refuses a
 *      restricted stamp a write to any ticket but its one target.
 *
 * Covered here:
 *   - the table, as plain data (every writes value x every operation);
 *   - the stamp through the token store (mint, exchange, validate), with a REAL ProxyTokenStore;
 *   - the census of every proxy write route: classified, and carrying the gate it claims;
 *   - over HTTP, a `none` token is refused by every write mount, and one-comment / ticket-fields
 *     tokens are held to their operation and their ticket, in each identifier form.
 *
 * The broker refire witness (a `none` row's re-minted token refused a comment) lives beside the
 * broker tests, in tests/unit/lin-3135-broker-refire-declared.test.js; every mint origin stamping a
 * restricted stage is World S of tests/unit/dispatch-entrance-mint-sweep.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { provisionBootstrapToken } from '../../lib/proxy-preamble.js';
import {
  WRITES,
  STAGE_WRITE_OPS,
  TICKET_FIELDS_UPDATE,
  ISSUE_PATCH_FIELDS,
  stageWriteAllows,
  normalizeWritesStamp,
  isRestrictedStamp,
  sameTicketKey,
  stampMintOptions
} from '../../lib/stage-writes.js';
import { requireWriteScope, requireStageWrite } from '../../lib/stage-write-gate.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { BASE_DEPS, buildApp, call, makeFakeProvider, ACME } from './lib/proxy-fake-deps.js';
import { enumerateRoutes, PROXY_ALLOWED_LAYERS } from './lib/entrance-route-sweep.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SPEC_OPS = ['createIssue', 'updateIssue', 'appendDescription', 'replaceDescription', 'belowDescription',
  'createComment', 'deleteComment', 'updateComment', 'attachment', 'createRelation', 'deleteRelation', 'addLabel', 'removeLabel'];

// ─────────────────────────────────────────────────────────────────────────────
// 1. The table, as plain data
// ─────────────────────────────────────────────────────────────────────────────

describe('LIN-4468 — the allowance table (lib/stage-writes.js)', () => {
  test('every SPEC operation name is a known write operation, and the list has no duplicates', () => {
    for (const op of SPEC_OPS) assert.ok(STAGE_WRITE_OPS.includes(op), `${op} is classified`);
    assert.equal(new Set(STAGE_WRITE_OPS).size, STAGE_WRITE_OPS.length);
  });

  test('none refuses every operation', () => {
    for (const op of STAGE_WRITE_OPS) assert.equal(stageWriteAllows('none', op), false, `none refuses ${op}`);
  });

  for (const writes of ['one-comment', 'blind-comment']) {
    test(`${writes} allows one comment and nothing else`, () => {
      for (const op of STAGE_WRITE_OPS) {
        assert.equal(stageWriteAllows(writes, op), op === 'createComment', `${writes} ${op}`);
      }
    });
  }

  test('ticket-fields allows the triage operations, and no description, create or relation write', () => {
    const allowed = ['updateIssue', 'createComment', 'addLabel', 'removeLabel'];
    for (const op of STAGE_WRITE_OPS) {
      assert.equal(stageWriteAllows('ticket-fields', op), allowed.includes(op), `ticket-fields ${op}`);
    }
  });

  test('ticket-fields may set only state, project and priority on an issue update', () => {
    assert.deepEqual([...TICKET_FIELDS_UPDATE].sort(), ['priority', 'priorityLevel', 'projectId', 'stateId']);
    for (const field of TICKET_FIELDS_UPDATE) {
      assert.equal(stageWriteAllows('ticket-fields', 'updateIssue', { fields: [field] }), true, field);
    }
    for (const field of ['description', 'title', 'assigneeId', 'parentId', 'cycleId']) {
      assert.equal(stageWriteAllows('ticket-fields', 'updateIssue', { fields: [field] }), false, field);
    }
    assert.equal(stageWriteAllows('ticket-fields', 'updateIssue', { fields: ['stateId', 'description'] }), false, 'a mixed body is refused whole');
  });

  test('work and an unstamped token keep today\'s behaviour: every operation', () => {
    for (const op of STAGE_WRITE_OPS) {
      assert.equal(stageWriteAllows(WRITES.WORK, op), true, `work ${op}`);
      assert.equal(stageWriteAllows(null, op), true, `unstamped ${op}`);
      assert.equal(stageWriteAllows(undefined, op), true, `undefined ${op}`);
    }
  });

  test('a stamp outside WRITES_VALUES fails closed to none, including prototype names', () => {
    assert.equal(normalizeWritesStamp('bogus'), WRITES.NONE);
    assert.equal(normalizeWritesStamp('constructor'), WRITES.NONE);
    assert.equal(normalizeWritesStamp(42), WRITES.NONE);
    assert.equal(normalizeWritesStamp(null), null);
    assert.equal(normalizeWritesStamp(undefined), null);
    for (const op of STAGE_WRITE_OPS) assert.equal(stageWriteAllows('constructor', op), false, `unknown ${op}`);
  });

  test('only a stamp other than unstamped and work narrows anything', () => {
    assert.equal(isRestrictedStamp(null), false);
    assert.equal(isRestrictedStamp('work'), false);
    for (const writes of ['none', 'one-comment', 'blind-comment', 'ticket-fields', 'bogus']) {
      assert.equal(isRestrictedStamp(writes), true, writes);
    }
  });

  test('ticket identity compares case-insensitively and trims; a non-string or empty reference never matches', () => {
    assert.equal(sameTicketKey('LIN-9', 'lin-9'), true);
    assert.equal(sameTicketKey(' LIN-9 ', 'LIN-9'), true);
    assert.equal(sameTicketKey('LIN-9', 'LIN-10'), false);
    assert.equal(sameTicketKey('', ''), false);
    assert.equal(sameTicketKey(undefined, 'LIN-9'), false);
    assert.equal(sameTicketKey('LIN-9', null), false);
  });

  test('a mint stamp adds nothing for an unrestricted stamp, and both keys for a restricted one', () => {
    assert.deepEqual(stampMintOptions(null, 'LIN-9'), {});
    assert.deepEqual(stampMintOptions('work', 'LIN-9'), {});
    assert.deepEqual(stampMintOptions('none', 'LIN-9'), { writes: 'none', writesTarget: 'LIN-9' });
    assert.deepEqual(stampMintOptions('one-comment', undefined), { writes: 'one-comment', writesTarget: null });
  });

  test('the gates refuse an operation they do not know, at mount', () => {
    assert.throws(() => requireWriteScope('dsipatch'), /unknown write operation "dsipatch"/);
    assert.throws(() => requireStageWrite(undefined), /unknown write operation/);
    assert.equal(typeof requireWriteScope('createComment'), 'function');
    assert.equal(requireWriteScope('createComment').name, 'requireWriteScope:createComment');
    assert.equal(requireStageWrite('runnerTake').name, 'requireStageWrite:runnerTake');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The stamp through the token store (a REAL ProxyTokenStore)
// ─────────────────────────────────────────────────────────────────────────────

function createMockCollection() {
  const docs = [];
  const matches = (doc, query) => Object.keys(query).every(k => (typeof query[k] === 'object' && query[k] !== null) || doc[k] === query[k]);
  return {
    _docs: docs,
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { const doc = docs.find(d => matches(d, query)); return doc ? { ...doc } : null; },
    async updateOne(query, update) {
      const doc = docs.find(d => matches(d, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany() { return { deletedCount: 0 }; },
    find() { return { toArray: async () => [...docs] }; },
    async countDocuments() { return docs.length; }
  };
}

function newStore() {
  const collection = createMockCollection();
  const store = new ProxyTokenStore({ collection });
  return { store, collection };
}

describe('LIN-4468 — the stamp is minted, exchanged and validated (ProxyTokenStore)', () => {
  test('an unstamped mint validates with writes and writesTarget both null (unrestricted, as before)', async () => {
    const { store } = newStore();
    const { token } = await store.createToken(ACME, { label: 'plain', scope: 'readWrite' });
    const doc = await store.validateToken(token);
    assert.equal(doc.writes, null);
    assert.equal(doc.writesTarget, null);
  });

  test('a stamped mint carries its allowance and its one ticket onto the validated identity', async () => {
    const { store } = newStore();
    const { token } = await store.createToken(ACME, { label: 'stage', scope: 'readWrite', writes: 'one-comment', writesTarget: 'LIN-9' });
    const doc = await store.validateToken(token);
    assert.equal(doc.writes, 'one-comment');
    assert.equal(doc.writesTarget, 'LIN-9');
  });

  test('an unknown stamp is stored as none, never widened', async () => {
    const { store } = newStore();
    const { token } = await store.createToken(ACME, { label: 'stage', scope: 'readWrite', writes: 'everything' });
    assert.equal((await store.validateToken(token)).writes, 'none');
  });

  test('the exchange copies the bootstrap\'s stamp verbatim onto the working token', async () => {
    const { store } = newStore();
    const { token: bootstrap } = await store.createToken(ACME, {
      kind: 'bootstrap', scope: 'readWrite', label: 'handoff', createdBy: 'u1', writes: 'ticket-fields', writesTarget: 'LIN-9'
    });
    const working = await store.exchangeBootstrapToken(bootstrap);
    assert.ok(working?.token, 'the bootstrap exchanges');
    const doc = await store.validateToken(working.token);
    assert.equal(doc.writes, 'ticket-fields');
    assert.equal(doc.writesTarget, 'LIN-9');
  });

  test('a grant-bearing bootstrap carries its stamp through mintGrantBootstrap and the exchange', async () => {
    const { store } = newStore();
    store.setOwnerCheck(async () => ({ status: 'owner' }));
    const minted = await store.mintGrantBootstrap({
      urlKey: ACME, workspaceId: 'ws-acme', ownerAccountId: 'u1', grants: ['dispatch'], label: 'declared',
      writes: 'none', writesTarget: 'LIN-9'
    });
    const working = await store.exchangeBootstrapToken(minted.token);
    assert.ok(working?.token, 'the grant bootstrap exchanges');
    const doc = await store.validateToken(working.token);
    assert.equal(doc.writes, 'none');
    assert.equal(doc.writesTarget, 'LIN-9');
    assert.deepEqual(doc.grants, ['dispatch']);
  });

  test('the mint helper forwards a restricted stamp to createToken, and none for an unrestricted one', async () => {
    const seen = [];
    const proxyTokenStore = {
      createToken: async (urlKey, opts) => { seen.push(opts); return { token: 'tok', expiresAt: null }; }
    };
    await provisionBootstrapToken({ proxyTokenStore, urlKey: ACME, baseUrl: 'https://h', createdBy: 'u1', writes: 'one-comment', writesTarget: 'LIN-9' });
    await provisionBootstrapToken({ proxyTokenStore, urlKey: ACME, baseUrl: 'https://h', createdBy: 'u1', writes: 'work', writesTarget: 'LIN-9' });
    assert.equal(seen[0].writes, 'one-comment');
    assert.equal(seen[0].writesTarget, 'LIN-9');
    assert.equal('writes' in seen[1], false, 'a work stamp leaves the mint shape untouched');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The route census: every proxy write route is classified, and carries its claimed gate
// ─────────────────────────────────────────────────────────────────────────────

const WRITE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The census. Each write route is one of:
 *   scoped          the readWrite scope gate names its operation: requireWriteScope:<op>
 *   gated           a grant-gated write, the stage allowance named: requireStageWrite:<op>
 *   not-ticket      a write that is not a tracker write, with the reason (no stage gate)
 *   exempt          authenticated by something other than a proxy bearer, with the reason
 *   session         a session-authenticated route, never reached by a proxy bearer
 */
const CENSUS = [
  // Ticket writes (routes/proxy-writes.js; SPEC keys)
  { m: 'POST', p: '/api/proxy/issues', kind: 'scoped', op: 'createIssue' },
  { m: 'PATCH', p: '/api/proxy/issues/:issueId', kind: 'scoped', op: 'updateIssue' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/description/append', kind: 'scoped', op: 'appendDescription' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/description/replace', kind: 'scoped', op: 'replaceDescription' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/description/below', kind: 'scoped', op: 'belowDescription' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/comments', kind: 'scoped', op: 'createComment' },
  { m: 'POST', p: '/api/proxy/comments/:issueId', kind: 'scoped', op: 'createComment' },
  { m: 'DELETE', p: '/api/proxy/issues/:issueId/comments/:commentId', kind: 'scoped', op: 'deleteComment' },
  { m: 'PATCH', p: '/api/proxy/issues/:issueId/comments/:commentId', kind: 'scoped', op: 'updateComment' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/attachments', kind: 'scoped', op: 'attachment' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/relations', kind: 'scoped', op: 'createRelation' },
  { m: 'DELETE', p: '/api/proxy/issues/:issueId/relations/:relationId', kind: 'scoped', op: 'deleteRelation' },
  { m: 'POST', p: '/api/proxy/issues/:issueId/labels', kind: 'scoped', op: 'addLabel' },
  { m: 'DELETE', p: '/api/proxy/issues/:issueId/labels/:labelId', kind: 'scoped', op: 'removeLabel' },
  // Agent status, halt, model routing, rulings, kickoff, dispatch
  { m: 'POST', p: '/api/proxy/agent/status', kind: 'scoped', op: 'agentStatus' },
  { m: 'POST', p: '/api/proxy/foreman/status', kind: 'scoped', op: 'agentStatus' },
  { m: 'POST', p: '/api/proxy/dispatch/halt', kind: 'scoped', op: 'haltSet' },
  { m: 'DELETE', p: '/api/proxy/dispatch/halt', kind: 'scoped', op: 'haltClear' },
  { m: 'POST', p: '/api/proxy/model-routing/jobs/:jobId', kind: 'scoped', op: 'modelRouting' },
  { m: 'POST', p: '/api/proxy/model-routing/groups/:group', kind: 'scoped', op: 'modelRouting' },
  { m: 'POST', p: '/api/proxy/model-routing/presets/:presetId/apply', kind: 'scoped', op: 'modelRouting' },
  { m: 'POST', p: '/api/proxy/model-routing/log/:entryId/undo', kind: 'scoped', op: 'modelRouting' },
  { m: 'POST', p: '/api/proxy/rulings/:decisionId/suggest-dismissal', kind: 'scoped', op: 'rulingSuggestDismissal' },
  { m: 'POST', p: '/api/proxy/rulings/:decisionId/suggest-answer', kind: 'scoped', op: 'rulingSuggestAnswer' },
  { m: 'POST', p: '/api/proxy/autopilot/kickoff', kind: 'scoped', op: 'kickoff' },
  { m: 'POST', p: '/api/proxy/dispatch', kind: 'scoped', op: 'dispatch' },
  { m: 'POST', p: '/api/proxy/recommend-and-dispatch', kind: 'scoped', op: 'dispatch' },
  { m: 'POST', p: '/api/proxy/periodicals/:id/mint', kind: 'scoped', op: 'periodicalMint' },
  // Runner writes: grant-gated at the mount, the stage allowance named on each route
  { m: 'POST', p: '/api/proxy/runner/heartbeat', kind: 'gated', op: 'runnerHeartbeat' },
  { m: 'POST', p: '/api/proxy/runner/take/:id', kind: 'gated', op: 'runnerTake' },
  { m: 'POST', p: '/api/proxy/runner/feedback/:id', kind: 'gated', op: 'runnerFeedback' },
  { m: 'POST', p: '/api/proxy/runner/usage/:id', kind: 'gated', op: 'runnerUsage' },
  // Not tracker writes
  { m: 'POST', p: '/api/proxy/recap/:identifier', kind: 'not-ticket', reason: 'regenerates a recap cache for a read surface; writes no tracker state' },
  { m: 'POST', p: '/api/proxy/brief/:identifier', kind: 'not-ticket', reason: 'regenerates a brief cache for a read surface; writes no tracker state' },
  { m: 'POST', p: '/api/proxy/flight-companion/turn', kind: 'not-ticket', reason: 'a chat turn that returns a proposal; a proposal is not a write (routes/proxy-flight-companion.js)' },
  // Exempt and session-authenticated
  { m: 'POST', p: '/api/proxy/token', kind: 'exempt', reason: 'exchanges a bootstrap for a working token; authenticates by the bootstrap, not a proxy bearer' },
  { m: 'POST', p: '/workspace/:urlKey/api/proxy/tokens', kind: 'session', reason: 'Settings token mint, session-authenticated (workspaceFromUrl)' },
  { m: 'DELETE', p: '/workspace/:urlKey/api/proxy/tokens/:tokenId', kind: 'session', reason: 'Settings token revoke, session-authenticated (workspaceFromUrl)' }
];

/**
 * The census verdicts for a list of routes. Pure, so a planted route can be judged the same way.
 * @returns {string[]} violations; empty when the census holds
 */
function censusViolations(routes, census = CENSUS) {
  const violations = [];
  const writes = routes.filter(r => WRITE_VERBS.includes(r.method));
  const rowOf = (r) => census.find(c => c.m === r.method && c.p === r.path);
  for (const r of writes) {
    const row = rowOf(r);
    if (!row) { violations.push(`unclassified: ${r.method} ${r.path} (${r.chain.join(' > ')})`); continue; }
    if (row.kind === 'scoped' && !r.chain.includes(`requireWriteScope:${row.op}`)) {
      violations.push(`scoped without requireWriteScope:${row.op}: ${r.method} ${r.path}`);
    }
    if (row.kind === 'gated' && !r.chain.includes(`requireStageWrite:${row.op}`)) {
      violations.push(`gated without requireStageWrite:${row.op}: ${r.method} ${r.path}`);
    }
    if (row.kind === 'not-ticket' || row.kind === 'exempt' || row.kind === 'session') {
      const gated = r.chain.some(n => n.startsWith('requireWriteScope') || n.startsWith('requireStageWrite'));
      if (gated) violations.push(`${row.kind} route carries a stage gate: ${r.method} ${r.path}`);
    }
  }
  for (const c of census) {
    if (!writes.some(r => r.method === c.m && r.path === c.p)) violations.push(`stale census row: ${c.m} ${c.p}`);
  }
  return violations;
}

/** Every proxy route with its middleware names, from the shared walker (path-scoped layers audited once there). */
function proxyRoutes() {
  return enumerateRoutes(createProxyRoutes(BASE_DEPS()), { allowedLayers: PROXY_ALLOWED_LAYERS, withChain: true });
}

describe('LIN-4468 — route census: every proxy write route is classified and carries its gate', () => {
  test('the live router matches the census: no unclassified, no stale row, every gate present', () => {
    assert.deepEqual(censusViolations(proxyRoutes()), []);
  });

  test('every operation the census names is a known write operation, and each one is used', () => {
    const used = new Set(CENSUS.filter(c => c.op).map(c => c.op));
    for (const op of used) assert.ok(STAGE_WRITE_OPS.includes(op), `${op} is known`);
    for (const op of STAGE_WRITE_OPS) assert.ok(used.has(op), `${op} is mounted somewhere`);
  });

  test('mutation: a new ungated write route is unclassified', () => {
    const routes = [...proxyRoutes(), { method: 'POST', path: '/api/proxy/new-write', chain: ['authenticateProxyToken', '<anonymous>'] }];
    assert.deepEqual(censusViolations(routes), ['unclassified: POST /api/proxy/new-write (authenticateProxyToken > <anonymous>)']);
  });

  test('mutation: a route classified as scoped that lost its gate fails the census', () => {
    const routes = proxyRoutes().map(r => (r.method === 'POST' && r.path === '/api/proxy/dispatch'
      ? { ...r, chain: r.chain.filter(n => n !== 'requireWriteScope:dispatch') }
      : r));
    assert.ok(censusViolations(routes).includes('scoped without requireWriteScope:dispatch: POST /api/proxy/dispatch'));
  });

  test('mutation: a runner write that lost its stage gate fails the census', () => {
    const routes = proxyRoutes().map(r => (r.path === '/api/proxy/runner/take/:id'
      ? { ...r, chain: r.chain.filter(n => !n.startsWith('requireStageWrite')) }
      : r));
    assert.ok(censusViolations(routes).some(v => v.startsWith('gated without requireStageWrite:runnerTake')));
  });

  test('mutation: a not-ticket write that carries a stage gate fails the census', () => {
    const routes = proxyRoutes().map(r => (r.path === '/api/proxy/brief/:identifier'
      ? { ...r, chain: [...r.chain, 'requireWriteScope:createComment'] }
      : r));
    assert.ok(censusViolations(routes).includes('not-ticket route carries a stage gate: POST /api/proxy/brief/:identifier'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Over HTTP: the allowance refuses the write, and the ticket match holds
// ─────────────────────────────────────────────────────────────────────────────

const UUID_OF = { 'LIN-9': 'uuid-9', 'uuid-9': 'uuid-9', 'LIN-10': 'uuid-10', 'uuid-10': 'uuid-10' };
// A label id in UUID form: the label resolver passes a UUID through, where a bare name would need the provider's label list.
const LABEL_ID = '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

/**
 * A provider whose ticket resolution is real enough to test the match: an identifier and its UUID
 * resolve to one id, another ticket to another. Records every write it is asked to make.
 */
function targetProvider() {
  const calls = { createComment: [], updateIssue: [], createIssue: [], updateIssueLabels: [], createRelation: [] };
  const base = makeFakeProvider();
  const key = (id) => (/^LIN-/i.test(id) ? id.toUpperCase() : id.toLowerCase());
  return {
    calls,
    provider: {
      ...base,
      issueWriteGuard: async (_token, id) => {
        const uuid = UUID_OF[key(id)];
        return uuid ? { id: uuid, trashed: false, team: { id: 't1' } } : null;
      },
      createComment: async (_token, issueId, body) => {
        calls.createComment.push(issueId);
        return { success: true, comment: { id: 'c1', body, createdAt: new Date().toISOString(), user: { name: 'Fake' } } };
      },
      updateIssue: async (_token, issueId, input) => { calls.updateIssue.push({ issueId, input }); return { issue: { id: 'i1' }, success: true }; },
      createIssue: async (_token, input) => { calls.createIssue.push(input); return { issue: { id: 'new1', identifier: 'LIN-2' }, success: true }; },
      updateIssueLabels: async (_token, issueId, labelIds) => { calls.updateIssueLabels.push({ issueId, labelIds }); return { issue: { id: 'i1', labels: { nodes: [] } }, success: true }; },
      createRelation: async (_token, issueId, opts) => { calls.createRelation.push({ issueId, opts }); return { id: 'r1' }; }
    }
  };
}

/** An app whose proxy token resolves to the given stamp, on the given provider. */
function stageApp({ writes, writesTarget, scope = 'readWrite', grants = ['take', 'dispatch'] } = {}) {
  const { provider, calls } = targetProvider();
  const identity = { tokenId: 't1', urlKey: ACME, label: 'stage', scope, createdBy: 'u1', grants, workspaceId: 'ws-acme', writes, writesTarget };
  const proxyTokenStore = { ...BASE_DEPS().proxyTokenStore, validateToken: async () => identity };
  return { app: buildApp({ proxyTokenStore, provider }), calls };
}

/** A concrete path for a census route: each parameter filled with a value its handler accepts. */
function fill(path) {
  const values = { issueId: 'LIN-9', commentId: 'c1', relationId: 'r1', labelId: 'l1', decisionId: 'd1', jobId: 'j1',
    group: 'g1', presetId: 'p1', entryId: 'e1', identifier: 'LIN-9', urlKey: ACME, tokenId: 't1' };
  return path.replace(/:(\w+)/g, (_, name) => values[name] ?? crypto.randomUUID());
}

const STAGE_WRITE_ROUTES = CENSUS.filter(c => c.kind === 'scoped' || c.kind === 'gated');

describe('LIN-4468 — over HTTP: a none token is refused by every write mount', () => {
  for (const row of STAGE_WRITE_ROUTES) {
    test(`${row.m} ${row.p} (${row.op}) -> 403 naming the stage's allowance`, async () => {
      const { app, calls } = stageApp({ writes: 'none', writesTarget: 'LIN-9' });
      const res = await call(app, row.m, fill(row.p), { body: { body: 'x', title: 'x', prompt: 'x', labelId: 'l1', teamId: 't1', text: 'x' } });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error, `This stage's write allowance (none) does not permit ${row.op}.`);
      assert.deepEqual(calls.createComment, []);
      assert.deepEqual(calls.updateIssue, []);
      assert.deepEqual(calls.createIssue, []);
    });
  }
});

describe('LIN-4468 — over HTTP: one-comment holds the comment to its own ticket', () => {
  test('a comment on the stage\'s ticket is allowed', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: 'LIN-9' });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-9/comments', { body: { body: 'a finding' } });
    assert.ok(res.status < 300, JSON.stringify(res.body));
    assert.deepEqual(calls.createComment, ['LIN-9']);
  });

  test('the same ticket by its UUID or a lowercase key is the same ticket, and allowed', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: 'LIN-9' });
    const byUuid = await call(app, 'POST', '/api/proxy/issues/uuid-9/comments', { body: { body: 'a' } });
    const byLower = await call(app, 'POST', '/api/proxy/issues/lin-9/comments', { body: { body: 'b' } });
    assert.ok(byUuid.status < 300, JSON.stringify(byUuid.body));
    assert.ok(byLower.status < 300, JSON.stringify(byLower.body));
    assert.equal(calls.createComment.length, 2);
  });

  test('a comment on another ticket is refused, names the ticket it may write to, and writes nothing', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: 'LIN-9' });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-10/comments', { body: { body: 'wrong ticket' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /may write only to LIN-9; LIN-10 is outside its allowance/);
    assert.deepEqual(calls.createComment, [], 'nothing written');
  });

  test('a comment with a ticket that does not resolve is refused, not allowed through', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: 'LIN-9' });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-404/comments', { body: { body: 'x' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.deepEqual(calls.createComment, []);
  });

  test('a description edit, a label add and an issue update are refused by operation', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: 'LIN-9' });
    const description = await call(app, 'POST', '/api/proxy/issues/LIN-9/description/append', { body: { text: 'x' } });
    const label = await call(app, 'POST', '/api/proxy/issues/LIN-9/labels', { body: { labelId: 'l1' } });
    const update = await call(app, 'PATCH', '/api/proxy/issues/LIN-9', { body: { stateId: 's1' } });
    assert.equal(description.status, 403);
    assert.equal(label.status, 403);
    assert.equal(update.status, 403);
    assert.deepEqual(calls.updateIssue, []);
    assert.deepEqual(calls.updateIssueLabels, []);
  });
});

describe('LIN-4468 — over HTTP: ticket-fields holds the triage PATCH to its fields and ticket', () => {
  test('a PATCH of description is refused, even alongside an allowed field', async () => {
    const { app, calls } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    const res = await call(app, 'PATCH', '/api/proxy/issues/LIN-9', { body: { description: 'rewritten', stateId: 's1' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error, "This stage's write allowance (ticket-fields) does not permit updateIssue.");
    assert.deepEqual(calls.updateIssue, []);
  });

  test('a triage PATCH of assigneeId is refused 403 before the UUID check would answer 400', async () => {
    const { app } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    const res = await call(app, 'PATCH', '/api/proxy/issues/LIN-9', { body: { assigneeId: 'bob' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test('a title, parent or cycle change is refused the same way', async () => {
    const { app } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    for (const body of [{ title: 'renamed' }, { parentId: 'p' }, { cycleId: 'c' }]) {
      const res = await call(app, 'PATCH', '/api/proxy/issues/LIN-9', { body });
      assert.equal(res.status, 403, `${Object.keys(body)[0]}: ${JSON.stringify(res.body)}`);
    }
  });

  test('a state change on the stage\'s own ticket passes the gate', async () => {
    const { app } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    const res = await call(app, 'PATCH', '/api/proxy/issues/LIN-9', { body: { stateId: 's1' } });
    assert.ok(!(res.status === 403 && /allowance/.test(res.body.error ?? '')), JSON.stringify(res.body));
  });

  test('a label add on another ticket is refused, a label add on its own ticket is allowed', async () => {
    const { app, calls } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    const other = await call(app, 'POST', '/api/proxy/issues/LIN-10/labels', { body: { labelId: LABEL_ID } });
    assert.equal(other.status, 403);
    assert.match(other.body.error, /may write only to LIN-9/);
    const own = await call(app, 'POST', '/api/proxy/issues/LIN-9/labels', { body: { labelId: LABEL_ID } });
    assert.ok(own.status < 300, JSON.stringify(own.body));
    assert.equal(calls.updateIssueLabels.length, 1);
  });

  test('creating an issue and a description append are refused by operation', async () => {
    const { app, calls } = stageApp({ writes: 'ticket-fields', writesTarget: 'LIN-9' });
    const create = await call(app, 'POST', '/api/proxy/issues', { body: { title: 'new', teamId: 't1' } });
    const append = await call(app, 'POST', '/api/proxy/issues/LIN-9/description/append', { body: { text: 'x' } });
    assert.equal(create.status, 403);
    assert.equal(append.status, 403);
    assert.deepEqual(calls.createIssue, []);
  });
});

describe('LIN-4468 — over HTTP: a stamp that is absent, work, or unknown', () => {
  test('an unstamped token writes to any ticket, as before', async () => {
    const { app, calls } = stageApp({});
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-10/comments', { body: { body: 'anywhere' } });
    assert.ok(res.status < 300, JSON.stringify(res.body));
    assert.deepEqual(calls.createComment, ['LIN-10']);
  });

  test('a work token writes to any ticket and any operation, as before', async () => {
    const { app, calls } = stageApp({ writes: 'work' });
    const res = await call(app, 'PATCH', '/api/proxy/issues/LIN-10', { body: { title: 'renamed' } });
    assert.ok(res.status < 300, JSON.stringify(res.body));
    assert.equal(calls.updateIssue.length, 1);
  });

  test('a stamp outside the vocabulary refuses every write, the way none does', async () => {
    const { app, calls } = stageApp({ writes: 'bogus', writesTarget: 'LIN-9' });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-9/comments', { body: { body: 'x' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error, "This stage's write allowance (none) does not permit createComment.");
    assert.deepEqual(calls.createComment, []);
  });

  test('a read-scoped token is still refused by the scope gate, whatever its stamp', async () => {
    const { app } = stageApp({ writes: 'work', scope: 'read' });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-9/comments', { body: { body: 'x' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'This endpoint requires a read-write token');
  });

  test('a restricted stamp with no ticket refuses every ticket write, and says it names none', async () => {
    const { app, calls } = stageApp({ writes: 'one-comment', writesTarget: null });
    const res = await call(app, 'POST', '/api/proxy/issues/LIN-9/comments', { body: { body: 'x' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /names no ticket/);
    assert.deepEqual(calls.createComment, []);
  });
});

describe('LIN-4468 — the edges: the PATCH field list and the instructions page', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

  test('the PATCH handler reads exactly ISSUE_PATCH_FIELDS, so the triage gate sees every field it can write', () => {
    const src = readFileSync(join(REPO, 'routes/proxy-writes.js'), 'utf8');
    const handler = src.slice(src.indexOf("router.patch('/api/proxy/issues/:issueId',"));
    const destructured = /const \{([^}]+)\} = req\.body;/.exec(handler);
    assert.ok(destructured, 'the PATCH handler destructures its body');
    const names = destructured[1].split(',').map(n => n.trim()).filter(Boolean);
    assert.deepEqual([...names].sort(), [...ISSUE_PATCH_FIELDS].sort());
  });

  test('a restricted token is told its allowance under its scope; unstamped and work tokens see the catalog unchanged', () => {
    const plain = buildInstructions({ baseUrl: 'https://h', scope: 'readWrite' });
    assert.equal(buildInstructions({ baseUrl: 'https://h', scope: 'readWrite', writes: 'work', writesTarget: 'LIN-9' }), plain);
    assert.doesNotMatch(plain, /stage write allowance/);
    const stamped = buildInstructions({ baseUrl: 'https://h', scope: 'readWrite', writes: 'one-comment', writesTarget: 'LIN-9' });
    assert.match(stamped, /Your stage write allowance: one-comment \(ticket LIN-9\)\. The proxy refuses any write the allowance does not list/);
  });

  test('over HTTP, GET /api/proxy/instructions names a none token\'s allowance', async () => {
    const { app } = stageApp({ writes: 'none', writesTarget: 'LIN-9' });
    const res = await call(app, 'GET', '/api/proxy/instructions');
    assert.equal(res.status, 200);
    assert.match(res.body, /Your stage write allowance: none \(ticket LIN-9\)/);
  });
});
