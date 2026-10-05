/**
 * LIN-2944 P3 beat 1 — N2 witness (review df4ed4dc, mutation MC): the
 * per-account default-copy allowance applies ONLY to the actual default-copy
 * shape `{ label: 'prompt-proxy', scope: 'readWrite', bootstrap: true }`, not to
 * any request that merely borrows the `prompt-proxy` label. A label-only mint
 * (no `bootstrap`) stays on the module-scope per-IP `proxyTokenCreationLimiter`
 * (10 / 15 min / IP; routes/proxy.js:277), so the 11th is a 429.
 *
 * MC drops the `bootstrap` half of `isDefaultCopyMint`
 * (routes/proxy-tokens-admin.js:42). The label-only body is then mistaken for a
 * default-copy mint: the per-IP limiter skips it (an account is present) and the
 * per-account limiter counts it against the 60 budget, so the 11th is a 201 and
 * this test goes RED.
 *
 * This lives in its OWN file on purpose: the limiter is a module-scope
 * singleton, so within one process its budget is shared across tests. Keeping
 * this per-IP traffic here means the test starts its process with a fresh
 * per-IP budget and its RED reads as the literal 11th request.
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';
const realNodeEnv = process.env.NODE_ENV;

// `prompt-proxy` label WITHOUT `bootstrap` — not the default-copy shape.
const LABEL_ONLY_BODY = { label: 'prompt-proxy', scope: 'readWrite' };

function createMockCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; }
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      accountId: req.headers['x-test-account'] || null,
      features: { proxy: true }
    };
    next();
  });
  app.use(createProxyRoutes({
    proxyTokenStore: new ProxyTokenStore({ collection: createMockCollection() }),
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'local' };
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {}
  }));
  return app;
}

async function postMany(app, count, body, account) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const statuses = [];
  try {
    for (let i = 0; i < count; i++) {
      const res = await fetch(`http://127.0.0.1:${port}${TOKENS_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(account ? { 'x-test-account': account } : {})
        },
        body: JSON.stringify(body)
      });
      statuses.push(res.status);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  return statuses;
}

describe('LIN-2944 P3 — a prompt-proxy label without bootstrap stays on the per-IP limit', () => {
  process.env.NODE_ENV = 'development';
  after(() => {
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  test('the 11th label-only prompt-proxy mint from one account is 429 (not the per-account allowance)', async () => {
    const app = buildApp();
    const statuses = await postMany(app, 11, LABEL_ONLY_BODY, 'acct-label-only');
    for (let i = 0; i < 10; i++) {
      assert.notEqual(statuses[i], 429,
        `label-only prompt-proxy request ${i + 1} must not be rate-limited yet (statuses ${statuses.join(',')})`);
    }
    assert.equal(statuses[10], 429,
      `the 11th label-only prompt-proxy request must hit the per-IP limit, not the 60 per-account ` +
      `default-copy allowance (statuses ${statuses.join(',')})`);
  });
});
