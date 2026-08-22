/**
 * Unit test for GET /test/task-decisions (LIN-2217) — the read sibling to
 * /test/clear-task-decisions that lets the e2e suite pin the durable
 * 'answered' stamp round trip (see tests/e2e/scan.spec.js).
 *
 * Run with: node --test tests/unit/test-routes-task-decisions.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createTestRoutes } from '../../routes/test.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes({ query = {} } = {}) {
  const req = { query };
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    send(b) { this.jsonBody = b; return this; },
  };
  return { req, res };
}

// Minimal in-memory mock of the collection surface, mirroring
// tests/unit/task-decisions-store.test.js's mock.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.issueId !== undefined && doc.issueId !== query.issueId) return false;
    return true;
  }
  return {
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
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
    },
  };
}

const URL_KEY = 'test-workspace';
const ISSUE_ID = '66666666-6666-6666-6666-666666666666';

describe('routes/test.js — GET /test/task-decisions (LIN-2217)', () => {
  test('returns the durable record verbatim, including a stamped outcome', async () => {
    const taskDecisionsStore = new TaskDecisionsStore({ collection: createMockCollection() });
    const scanned = await taskDecisionsStore.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, issueIdentifier: 'TEST-6', inputHash: 'hash1', decision: { question: 'Proceed?' }
    });
    await taskDecisionsStore.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id: scanned.id, outcome: 'answered' });

    const router = createTestRoutes({ taskDecisionsStore });
    const handler = getHandler(router, 'get', '/test/task-decisions');
    const { req, res } = makeReqRes({ query: { urlKey: URL_KEY, issueId: ISSUE_ID } });

    await handler(req, res);

    assert.strictEqual(res.jsonBody.ok, true);
    assert.strictEqual(res.jsonBody.record.outcome, 'answered');
    assert.strictEqual(res.jsonBody.record.issueId, ISSUE_ID);
  });

  test('returns record: null when no store is injected', async () => {
    const router = createTestRoutes({});
    const handler = getHandler(router, 'get', '/test/task-decisions');
    const { req, res } = makeReqRes({ query: { urlKey: URL_KEY, issueId: ISSUE_ID } });

    await handler(req, res);

    assert.strictEqual(res.jsonBody.ok, true);
    assert.strictEqual(res.jsonBody.record, null);
  });

  test('the 500 branch reports a store error rather than throwing', async () => {
    const taskDecisionsStore = { getStatus: async () => { throw new Error('boom'); } };
    const router = createTestRoutes({ taskDecisionsStore });
    const handler = getHandler(router, 'get', '/test/task-decisions');
    const { req, res } = makeReqRes({ query: { urlKey: URL_KEY, issueId: ISSUE_ID } });

    await handler(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.jsonBody.error, 'boom');
  });
});
