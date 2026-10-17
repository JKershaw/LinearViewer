/**
 * LIN-3611 (A3) — the `addItem` argument's key set, per lane.
 *
 * lin-3134's C2 census forced the dispatch entrances' one `createDispatchItem` call to carry
 * an inline, spread-free `fields:` literal, so the row's key list was written there as well as
 * in the entrance's row table. This is the behaviour witness that replaces what that literal
 * guarded: each of the five lanes (S session dispatch, P proxy dispatch, Ro and Rl the two arms
 * of recommend-and-dispatch, K kickoff) is posted every field it accepts plus a canary key, and
 * the argument the real store's `addItem` receives must have exactly the lane's key set, with
 * the canary nowhere in it. A `...body` spread into the call, or a key a lane should not carry,
 * fails here.
 *
 * The key sets are literals, taken from the entrance at the base of LIN-3611 (a deliberate new
 * row key is made by editing the literal in the same change). Order is not asserted: the
 * store reads named keys, and the replay compares `addItem` arguments with sorted keys.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { BASE_DEPS } from './lib/proxy-fake-deps.js';
import { request } from './lib/entrance-route-sweep.js';

const URL_KEY = 'acme';
const OWNER = 'acct-owner';
const CANARY = 'canaryFieldNotInAnyRow';
const CANARY_VALUE = 'canary-value-must-not-reach-the-row';

function makeWorld() {
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
  const tokens = new ProxyTokenStore({ collection: createMockCollection() });
  tokens.setOwnerCheck(async () => ({ status: 'owner' }));
  tokens.validateToken = async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: OWNER, grants: ['dispatch'], workspaceId: 'ws-acme' });
  const added = [];
  const realAdd = store.addItem.bind(store);
  store.addItem = async (urlKey, fields) => { added.push(fields); return realAdd(urlKey, fields); };
  const app = (router) => { const a = express(); a.use(express.json()); a.use(router); return a; };
  const proxyApp = app(createProxyRoutes({
    ...BASE_DEPS(),
    proxyTokenStore: tokens,
    proxyEventStore: { recordEvent: async () => {} },
    dispatchQueueStore: store,
    dispatchTokenStore: { listTokens: async () => [] },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  const sessionApp = app(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: { listTokens: async () => [], createToken: async () => ({ tokenId: 't', token: 'dispatch-token-fixture', label: 'x' }) },
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: URL_KEY, id: 'ws-acme', provider: 'linear' };
      req.session = { accountId: OWNER };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: tokens
  }));
  return { added, proxyApp, sessionApp };
}

const post = (app, path, body, headers = { Authorization: 'Bearer anything' }) => request(app, 'POST', path, { body: { ...body, [CANARY]: CANARY_VALUE }, headers });

// Every field the lane accepts and stores. Values are valid for the lane's own checks.
const SESSION_BODY = {
  prompt: 'do the thing', promptName: 'Named', kind: 'custom', issueId: 'id-1', issueIdentifier: 'TEST-1', issueTitle: 'T',
  issueUrl: 'https://example.test/TEST-1', issueSource: 'linear', target: 'cli', repo: 'some-repo', model: 'm', harness: 'claude-code',
  effort: 'high', force: true, sessionId: 'sess-1', waitForFollowUps: true, queueIfBusy: true, subscription: 'everything', maxTasks: 3
};
const PROXY_BODY = { ...SESSION_BODY, kind: 'custom' };
const RECOMMEND_BODY = {
  issueIdentifier: 'TEST-1', issueSource: 'linear', target: 'cli', repo: 'some-repo', model: 'm', harness: 'claude-code', effort: 'high',
  force: true, sessionId: 'sess-1', waitForFollowUps: true, queueIfBusy: true, subscription: 'everything'
};
const KICKOFF_BODY = {
  goal: 'walk the stack', mode: 'write', variant: 'standard', issueIdentifier: 'TEST-1', issueSource: 'linear', target: 'cli', repo: 'some-repo',
  sessionId: 'sess-1', subscription: 'everything', model: 'm', harness: 'claude-code', effort: 'high', maxTasks: 3
};

// The `addItem` argument's key set per lane: the lane's row keys plus what the factory adds.
const EXPECTED = {
  'S session dispatch': [
    'abort', 'abortTo', 'bootstrapToken', 'cascade', 'consumerLastSeenAt', 'dispatchedBy', 'effort', 'followUpTo',
    'force', 'harness', 'issueId', 'issueIdentifier', 'issueSource', 'issueTitle', 'issueUrl', 'kind', 'maxTasks',
    'model', 'periodicalId', 'presetConfig', 'presetName', 'prompt', 'promptName', 'queueIfBusy', 'repo', 'sessionId',
    'stopAt', 'subscription', 'target', 'terminal', 'variant', 'waitForFollowUps'
  ],
  'P proxy dispatch': [
    'abort', 'abortTo', 'bootstrapToken', 'cascade', 'consumerLastSeenAt', 'dispatchedBy', 'effort', 'followUpTo',
    'force', 'harness', 'issueId', 'issueIdentifier', 'issueSource', 'issueTitle', 'issueUrl', 'kind', 'maxTasks',
    'model', 'periodicalId', 'presetConfig', 'presetName', 'prompt', 'promptName', 'queueIfBusy', 'repo', 'sessionId',
    'subscription', 'target', 'terminal', 'waitForFollowUps'
  ],
  'Ro recommend-and-dispatch, verb override': [
    'bootstrapToken', 'consumerLastSeenAt', 'dispatchedBy', 'effort', 'followUpTo', 'force', 'harness', 'issueId',
    'issueIdentifier', 'issueSource', 'issueTitle', 'issueUrl', 'kind', 'model', 'periodicalId', 'presetConfig',
    'presetName', 'prompt', 'promptName', 'queueIfBusy', 'repo', 'sessionId', 'subscription', 'target', 'terminal',
    'waitForFollowUps'
  ],
  'Rl recommend-and-dispatch, LLM descent': [
    'bootstrapToken', 'consumerLastSeenAt', 'dispatchedBy', 'effort', 'followUpTo', 'force', 'harness', 'issueId',
    'issueIdentifier', 'issueSource', 'issueTitle', 'issueUrl', 'kind', 'model', 'periodicalId', 'presetConfig',
    'presetName', 'prompt', 'promptName', 'queueIfBusy', 'repo', 'sessionId', 'subscription', 'target', 'terminal',
    'waitForFollowUps'
  ],
  'K kickoff': [
    'bootstrapToken', 'consumerLastSeenAt', 'dispatchedBy', 'effort', 'grantDeclaration', 'harness',
    'issueIdentifier', 'issueSource', 'kind', 'maxTasks', 'model', 'presetConfig', 'presetName', 'prompt',
    'promptName', 'repo', 'sessionId', 'subscription', 'target', 'terminal', 'variant', 'waitForFollowUps'
  ]
};

const LANES = [
  { name: 'S session dispatch', run: (w) => post(w.sessionApp, `/workspace/${URL_KEY}/api/dispatch`, SESSION_BODY, {}) },
  { name: 'P proxy dispatch', run: (w) => post(w.proxyApp, '/api/proxy/dispatch', PROXY_BODY) },
  { name: 'Ro recommend-and-dispatch, verb override', run: (w) => post(w.proxyApp, '/api/proxy/recommend-and-dispatch', { ...RECOMMEND_BODY, kind: 'implementation' }) },
  { name: 'Rl recommend-and-dispatch, LLM descent', run: (w) => post(w.proxyApp, '/api/proxy/recommend-and-dispatch', RECOMMEND_BODY) },
  { name: 'K kickoff', run: (w) => post(w.proxyApp, '/api/proxy/autopilot/kickoff', KICKOFF_BODY) }
];

describe('LIN-3611 A3 — the addItem argument per lane', () => {
  const seen = {};
  for (const lane of LANES) {
    test(`${lane.name}: 201, no canary key or value in the row, key set recorded`, async () => {
      const w = makeWorld();
      const res = await lane.run(w);
      assert.equal(res.status, 201, res.text);
      assert.equal(w.added.length, 1, 'exactly one addItem');
      const arg = w.added[0];
      assert.ok(!(CANARY in arg), `${CANARY} must not reach the row`);
      assert.ok(!JSON.stringify(arg).includes(CANARY_VALUE), 'the canary value must not reach the row');
      seen[lane.name] = Object.keys(arg).sort();
    });
  }

  test('the key set of each lane equals its literal', () => {
    assert.deepEqual(seen, EXPECTED);
  });
});

