/**
 * Route-level tests for the LIN-2197 Phase 4 scan routes
 * (GET/POST /workspace/:urlKey/api/scan/:issueId, POST .../dismiss).
 *
 * Mounts the REAL router (`createWorkspaceApiRoutes`) with a REAL
 * `TaskDecisionsStore` backed by an in-memory mock collection — the
 * "mount-the-real-router" pattern from
 * tests/unit/brief-recap-ai-not-configured-contract.test.js — so this proves
 * the actual outcome-write path end to end (a real `markOutcome` call
 * through a real HTTP round trip), not a seeded test fixture. Also proves
 * the canonical-UUID guard at the route boundary and that a zero-finding
 * scan persists as a normal, non-error record.
 *
 * Run with: node --test tests/unit/scan-routes.test.js
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';

before(() => { process.env.NODE_ENV = 'test'; });

// Mirrors tests/unit/task-decisions-store.test.js's mock collection.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.issueId !== undefined && doc.issueId !== query.issueId) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
      }
      if (opts.upsert) {
        const doc = { ...(update.$set || {}) };
        docs.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedId: doc._id };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
    }
  };
}

let collection, taskDecisionsStore, app;

beforeEach(() => {
  collection = createMockCollection();
  taskDecisionsStore = new TaskDecisionsStore({ collection });
  app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      // test-token: NODE_ENV=test flips BOTH the data mock (testMockData
      // fixtures) and the AI mock (shouldMockAi) on for this workspace.
      req.workspace = { accessToken: 'test-token', urlKey: 'test-workspace' };
      req.session = {};
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
    taskDecisionsStore,
  }));
});

async function request(method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          host: '127.0.0.1', port, path, method,
          headers: payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}
        },
        (res) => {
          let raw = '';
          res.on('data', chunk => { raw += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.end(payload);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body ?? {});

// TEST-6 ("needs research and breakdown") and TEST-11 ("Waiting for API
// credentials") trigger the mock scan's decision-found branch; TEST-13/14/15
// (bug report / feature description with no blocking language) don't — see
// buildMockScanText in routes/workspace-api.js. All five have UUID-shaped
// fixture ids (tests/fixtures/mock-data.js), unlike TEST-1..5.
const DECISION_ISSUE = 'TEST-6';
const ZERO_FINDING_ISSUE = 'TEST-13';
const NON_UUID_ISSUE = 'TEST-1'; // fixture id is the literal string "issue-1"

describe('GET/POST /workspace/:urlKey/api/scan/:issueId', () => {
  test('GET before any scan reports missing', async () => {
    const { status, body } = await get(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'missing' });
  });

  test('POST persists a real decision, and GET agrees with it', async () => {
    const posted = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(posted.status, 200);
    assert.equal(posted.body.status, 'fresh');
    assert.ok(posted.body.decision, 'a decision was found');
    assert.equal(posted.body.outcome, null);
    assert.match(posted.body.id, /^scan_66666666_/);

    const got = await get(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.status, 'fresh');
    assert.deepEqual(got.body.decision, posted.body.decision);
    assert.equal(got.body.outcome, null);
  });

  test('POST on a task with no blocking language persists a zero-finding record, not a failure', async () => {
    const posted = await post(`/workspace/test-workspace/api/scan/${ZERO_FINDING_ISSUE}`);
    assert.equal(posted.status, 200);
    assert.equal(posted.body.status, 'fresh');
    assert.equal(posted.body.decision, null);

    const got = await get(`/workspace/test-workspace/api/scan/${ZERO_FINDING_ISSUE}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.status, 'fresh', 'a zero-finding scan is a normal, persisted record — not "missing"');
    assert.equal(got.body.decision, null);
  });

  test('re-POSTing unchanged content refreshes the same content-keyed record (idempotent id)', async () => {
    const first = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    const second = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(second.body.id, first.body.id);

    const rows = collection._docs.filter(d => d.issueId === '66666666-6666-6666-6666-666666666666');
    assert.equal(rows.length, 1, 'refreshed in place, never duplicated');
  });

  test('canonical-UUID guard: a fixture with a non-UUID id is rejected, nothing persisted', async () => {
    const posted = await post(`/workspace/test-workspace/api/scan/${NON_UUID_ISSUE}`);
    assert.equal(posted.status, 422);
    assert.equal(posted.body.code, 'CANONICAL_ID_REQUIRED');
    assert.equal(collection._docs.length, 0);

    const got = await get(`/workspace/test-workspace/api/scan/${NON_UUID_ISSUE}`);
    assert.equal(got.status, 422);
    assert.equal(got.body.code, 'CANONICAL_ID_REQUIRED');
  });

  test('scan store not configured → 503', async () => {
    const unconfiguredApp = express();
    unconfiguredApp.use(express.json());
    unconfiguredApp.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, _res, next) => {
        req.workspace = { accessToken: 'test-token', urlKey: 'test-workspace' };
        req.session = {};
        next();
      },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) }, customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
      reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
      // taskDecisionsStore omitted
    }));
    const server = unconfiguredApp.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const { port } = server.address();
      const result = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: `/workspace/test-workspace/api/scan/${DECISION_ISSUE}` }, (res) => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      assert.equal(result.status, 503);
      assert.equal(result.body.error, 'Scan store not configured');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('POST /workspace/:urlKey/api/scan/:issueId/dismiss', () => {
  test('dismisses a real scanned decision, proving the outcome-write path end to end', async () => {
    const scanned = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(scanned.body.outcome, null);

    const dismissed = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, { id: scanned.body.id });
    assert.equal(dismissed.status, 200);
    assert.equal(dismissed.body.outcome, 'dismissed');
    assert.ok(dismissed.body.outcomeAt);

    // GET now agrees: fresh (unchanged content) with the outcome stamped —
    // never regresses to "missing".
    const got = await get(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(got.body.status, 'fresh');
    assert.equal(got.body.outcome, 'dismissed');
  });

  test('a re-scan of unchanged, already-dismissed content never un-dismisses it', async () => {
    const scanned = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, { id: scanned.body.id });

    const rescanned = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    assert.equal(rescanned.body.id, scanned.body.id);
    assert.equal(rescanned.body.outcome, 'dismissed', 'the terminal row is returned unchanged, not silently un-dismissed');
  });

  test('dismissing an unknown record id 404s', async () => {
    const result = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, { id: 'scan_nope_nope' });
    assert.equal(result.status, 404);
  });

  test('dismissing without an id 400s', async () => {
    const result = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, {});
    assert.equal(result.status, 400);
  });

  test('a second dismiss is idempotent (first stamp wins, timestamp unchanged)', async () => {
    const scanned = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}`);
    const first = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, { id: scanned.body.id });
    const second = await post(`/workspace/test-workspace/api/scan/${DECISION_ISSUE}/dismiss`, { id: scanned.body.id });
    assert.equal(second.body.outcomeAt, first.body.outcomeAt);
  });
});
