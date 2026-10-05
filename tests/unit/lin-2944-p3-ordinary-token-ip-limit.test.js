/**
 * LIN-2944 P3 beat 1 — regression guard for the pre-existing per-IP token-mint
 * limit, alongside the default-copy witness in
 * tests/unit/lin-2944-p3-default-copy-token-limit.test.js.
 *
 * The fix gives the DEFAULT ("prompt-proxy") copy mint its own per-account
 * allowance, but every OTHER token creation must keep the module-scope per-IP
 * `proxyTokenCreationLimiter` (routes/proxy.js:270; 10 requests / 15 min / IP).
 *
 * This lives in its OWN file on purpose: the limiter is a module-scope
 * singleton, so within one process its budget is shared across tests. Keeping
 * the ordinary (per-IP) traffic here means the default-copy file starts every
 * process with a fresh per-IP budget and its RED reads as the literal 11th
 * request. This file is GREEN both before and after the fix.
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';
const realNodeEnv = process.env.NODE_ENV;
const ORDINARY_BODY = { label: 'ordinary', scope: 'read' };

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

describe('LIN-2944 P3 — ordinary token creation keeps the per-IP limit', () => {
  process.env.NODE_ENV = 'development';
  after(() => {
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  test('the 11th ordinary (non-default-copy) token mint from one IP is 429', async () => {
    const app = buildApp();
    const statuses = await postMany(app, 11, ORDINARY_BODY, 'acct-ordinary');
    for (let i = 0; i < 10; i++) {
      assert.notEqual(statuses[i], 429,
        `ordinary request ${i + 1} must not be rate-limited yet (statuses ${statuses.join(',')})`);
    }
    assert.equal(statuses[10], 429,
      `the 11th ordinary request must hit the per-IP limit (statuses ${statuses.join(',')})`);
  });
});
