/**
 * LIN-2076 (Half B) — route-level proof for GET /api/proxy/credential-health,
 * the new consumer-lane (bearer-token) provider-credential health endpoint.
 *
 * Two things this exists to pin, exactly the ticket's own constraints:
 *   1. `logEvent` actually persists `stage`/`credentialFingerprint` on every
 *      proxy-event row now, at the single existing write seam — previously
 *      computed and discarded (the ticket's own diagnosis).
 *   2. The new endpoint is bounded to the CALLING token's own rows — a
 *      second token's provider-lane 401s must never leak into this token's
 *      reported occupancy, and the response carries no other token's
 *      metadata (id, label, or otherwise).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyEventStore } from '../../lib/proxy-events.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

/** An in-memory collection just capable enough for ProxyEventStore. */
function fakeCollection() {
  const docs = [];
  return {
    docs,
    insertOne: async (doc) => { docs.push(doc); return { insertedId: doc._id }; },
    find: (query = {}, opts = {}) => ({
      toArray: async () => {
        let matched = docs.filter(d => {
          if (query.urlKey !== undefined && d.urlKey !== query.urlKey) return false;
          if (query.tokenId !== undefined && d.tokenId !== query.tokenId) return false;
          if (query.stage !== undefined && d.stage !== query.stage) return false;
          if (query.status !== undefined && d.status !== query.status) return false;
          if (query.expiresAt && d.expiresAt <= query.expiresAt.$gt) return false;
          if (query.timestamp && d.timestamp <= query.timestamp.$gt) return false;
          // LIN-1746 (found by code review, round 6): listSelfCredentialHealth's
          // query now unions both halves' row shapes via $or — without this,
          // the double silently stopped enforcing ANY stage/status scoping
          // (query.stage/.status are always undefined on that query), leaving
          // a regression that drops providerLaneOccupancy's own JS-level
          // stage filter completely undetected by this file.
          if (query.$or && !query.$or.some(clause => Object.entries(clause).every(([k, v]) => d[k] === v))) return false;
          return true;
        });
        if (opts.projection) {
          const keys = Object.keys(opts.projection);
          matched = matched.map(d => Object.fromEntries(keys.map(k => [k, d[k]])));
        }
        return matched;
      },
    }),
  };
}

function buildApp({ tokensById }) {
  const app = express();
  app.use(express.json());
  const proxyEventStore = new ProxyEventStore({ collection: fakeCollection() });

  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async (bearer) => tokensById[bearer],
    },
    proxyEventStore,
    resolveWorkspaceAccess: async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    }),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: () => true,
      viewer: async () => ({ id: 'u1', name: 'Alice' }),
    },
  }));
  return { app, proxyEventStore };
}

async function request(app, path, bearer) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('logEvent persists stage:provider-lane and credentialFingerprint on a provider-lane call', async () => {
  const { app, proxyEventStore } = buildApp({
    tokensById: { 'agent-token': { tokenId: 'tok-a', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' } },
  });

  const { status } = await request(app, '/api/proxy/me', 'agent-token');
  assert.equal(status, 200);

  const rows = proxyEventStore.collection.docs;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'provider-lane');
  assert.equal(rows[0].credentialFingerprint, fingerprintCredential('linear-tok'));
});

test('logEvent persists stage:proxy-token (and null fingerprint) for a workspace-free call', async () => {
  const { app, proxyEventStore } = buildApp({
    tokensById: { 'agent-token': { tokenId: 'tok-a', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' } },
  });

  // The credential-health endpoint itself never calls resolveProviderAccess —
  // it is a pure store read, so its OWN audit row should be proxy-token-staged.
  await request(app, '/api/proxy/credential-health', 'agent-token');

  const rows = proxyEventStore.collection.docs;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'proxy-token');
  assert.equal(rows[0].credentialFingerprint, null);
});

test('the consumer credential-health endpoint is bounded to the calling token, never leaking another token\'s rows', async () => {
  const { app, proxyEventStore } = buildApp({
    tokensById: {
      'token-a': { tokenId: 'tok-a', urlKey: 'acme', label: 'agent-a', scope: 'readWrite', createdBy: 'acct-owner' },
      'token-b': { tokenId: 'tok-b', urlKey: 'acme', label: 'agent-b', scope: 'readWrite', createdBy: 'acct-owner' },
    },
  });

  // Seed token-b with a clear fault signature directly into the store —
  // token-a must never see it through its own health read.
  const now = Date.now();
  const seed = (tokenId, offsetMs, status) => proxyEventStore.recordEvent({
    urlKey: 'acme', tokenId, tokenLabel: 'x', method: 'GET', endpoint: '/api/proxy/issues',
    status, stage: 'provider-lane', credentialFingerprint: 'deadbeef0000',
  }).then(doc => { doc.timestamp = new Date(now - offsetMs); return doc; });

  await seed('tok-b', 1000, 401);
  await seed('tok-b', 35_000, 401);
  await seed('tok-b', 65_000, 401);

  const { status, body } = await request(app, '/api/proxy/credential-health', 'token-a');
  assert.equal(status, 200);
  // token-a made this very request as a proxy-token-stage call (the health
  // route itself), so it has zero provider-lane evidence of its own.
  assert.equal(body.verdict, 'unknown');
  assert.equal(body.totalCalls, 0);
  assert.ok(!('tokenId' in body), 'response must not name any token id');
  assert.ok(!('tokens' in body), 'response must not be a workspace-wide token list');
});
