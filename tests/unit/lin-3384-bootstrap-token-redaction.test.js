/**
 * LIN-3384 (LIN-2954 S1.5) — no live bootstrap token in any response a session
 * can read. Helper semantics, the four redacted routes (incl. the proxy
 * `/:id/prompt` read for two different proxy creators), both real prose
 * embeddings, and every runner path that must STAY token-bearing.
 * The call-site census lives in lin-3384-redaction-census.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createProxyRunnerRoutes } from '../../routes/proxy-runner.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { buildCollectiveParticipantPrompt } from '../../lib/prompts/collective-participant.js';
import {
  isItemOwner, maskBootstrapTokens, redactSessionItem, REDACTED_TOKEN_PLACEHOLDER
} from '../../lib/dispatch-session-redaction.js';

const TOKEN = 'HBq7Zk2mXv9RtLw4NpYc8DsEaGh1JfUoB3VnMiK6xQe'; // 43 chars, HB-prefixed
const OTHER_TOKEN = 'k3J9xQ2mZpL7vRtYw4NcB8DsEaGh1HfUoVnMiK6xQeA'; // 43 chars, bare
assert.equal(TOKEN.length, 43);
assert.equal(OTHER_TOKEN.length, 43);

const PROSE = `do the thing\n\ncurl -X POST -H "Authorization: Bearer ${TOKEN}" http://h/api/proxy/token\nthen finish`;

describe('helper', () => {
  test('masks the bearer token, keeps the rest of the prompt', () => {
    const out = maskBootstrapTokens(PROSE);
    assert.ok(!out.includes(TOKEN));
    assert.ok(out.includes(REDACTED_TOKEN_PLACEHOLDER));
    assert.ok(out.startsWith('do the thing'));
    assert.ok(out.endsWith('then finish'));
  });

  test('masks repeated matches (shared /g regex is cloned, no lastIndex bleed)', () => {
    for (let i = 0; i < 3; i++) {
      const out = maskBootstrapTokens(`Bearer ${TOKEN}\nBearer ${OTHER_TOKEN}`);
      assert.ok(!out.includes(TOKEN) && !out.includes(OTHER_TOKEN));
    }
  });

  test('masks the bootstrap_token = "..." assignment shape', () => {
    assert.ok(!maskBootstrapTokens(`bootstrap_token = "${OTHER_TOKEN}"`).includes(OTHER_TOKEN));
  });

  test('isItemOwner is null-safe', () => {
    assert.equal(isItemOwner({ dispatchedBy: null }, null), false);
    assert.equal(isItemOwner({}, undefined), false);
    assert.equal(isItemOwner({ dispatchedBy: '' }, ''), false);
    assert.equal(isItemOwner({ dispatchedBy: 'a' }, 'b'), false);
    assert.equal(isItemOwner({ dispatchedBy: 'a' }, 'a'), true);
  });

  test('redactSessionItem: nulls the field always; owner prompt unchanged, others masked; other fields kept', () => {
    const item = { id: 'x', prompt: PROSE, bootstrapToken: TOKEN, dispatchedBy: 'a', consumerPollWarning: { w: 1 } };
    const owner = redactSessionItem(item, 'a');
    assert.equal(owner.bootstrapToken, null);
    assert.equal(owner.prompt, PROSE);
    const other = redactSessionItem(item, 'b');
    assert.equal(other.bootstrapToken, null);
    assert.ok(!other.prompt.includes(TOKEN));
    assert.deepEqual(other.consumerPollWarning, { w: 1 });
    assert.equal(other.id, 'x');
    assert.equal(item.bootstrapToken, TOKEN, 'input not mutated');
    // ownerless row + anonymous reader must not count as owner
    assert.ok(!redactSessionItem({ prompt: PROSE, dispatchedBy: null }, null).prompt.includes(TOKEN));
  });
});

describe('declaredMint marker (declared-resume rows)', () => {
  test('the owner is masked too when the marker is set, and the marker never leaves', () => {
    const item = { id: 'x', prompt: PROSE, bootstrapToken: TOKEN, dispatchedBy: 'a', declaredMint: true };
    for (const caller of ['a', 'b', null]) {
      const out = redactSessionItem(item, caller);
      assert.ok(!out.prompt.includes(TOKEN), `caller ${caller} must not see the token`);
      assert.equal(out.bootstrapToken, null);
      assert.equal('declaredMint' in out, false);
    }
    assert.equal(item.declaredMint, true, 'input not mutated');
  });

  test('an ordinary row (no marker) still shows the owner their own prompt', () => {
    const out = redactSessionItem({ prompt: PROSE, dispatchedBy: 'a', declaredMint: false }, 'a');
    assert.equal(out.prompt, PROSE);
    assert.equal('declaredMint' in out, false);
  });

  test('both formatters set the marker only for a row carrying grantDeclaration, as a boolean never the record', () => {
    const store = Object.create(DispatchQueueStore.prototype);
    const base = { _id: 'r1', prompt: PROSE, dispatchedBy: 'a', status: 'queued' };
    const record = { grants: ['dispatch'], ownerAccountId: 'owner' };
    for (const fmt of ['_formatItem', '_formatHistoryItem']) {
      const declared = store[fmt]({ ...base, grantDeclaration: record });
      assert.strictEqual(declared.declaredMint, true, fmt);
      assert.equal('grantDeclaration' in declared, false, fmt);
      const plain = store[fmt](base);
      assert.equal('declaredMint' in plain, false, `${fmt}: sparse — an undeclared row's key set is unchanged`);
    }
  });
});

function buildApp(store, accountId) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1', accountId };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

async function get(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const row = (extra = {}) => ({ id: 'i1', prompt: PROSE, bootstrapToken: TOKEN, dispatchedBy: 'owner-1', ...extra });
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const store = {
  listItems: async () => [row()],
  listHistory: async () => ({ items: [row({ bootstrapToken: null })], total: 1 }),
  trimSessionBudget: async () => ({ ok: true, item: row() }),
  pollAvailable: async () => [row()]
};

describe('session-readable routes', () => {
  test('queue list: bootstrapToken null, non-owner prose masked', async () => {
    const res = await get(buildApp(store, 'someone-else'), 'GET', '/workspace/acme/api/dispatch');
    assert.equal(res.status, 200);
    assert.equal(res.body.items[0].bootstrapToken, null);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  });

  test('queue list: owner prompt unchanged, field still null', async () => {
    const res = await get(buildApp(store, 'owner-1'), 'GET', '/workspace/acme/api/dispatch');
    assert.equal(res.body.items[0].bootstrapToken, null);
    assert.equal(res.body.items[0].prompt, PROSE);
  });

  test('history: non-owner prose masked, envelope fields kept', async () => {
    const res = await get(buildApp(store, 'someone-else'), 'GET', '/workspace/acme/api/dispatch/history');
    assert.equal(res.body.total, 1);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  });

  test('trim: bootstrapToken null and prose masked', async () => {
    const res = await get(buildApp(store, 'someone-else'), 'PATCH', `/workspace/acme/api/dispatch/${SESSION_ID}/trim`, { maxTasks: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.bootstrapToken, null);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  });
});

describe('trim: both row shapes', () => {
  test('an archived (history-shape) row gains no bootstrapToken key', async () => {
    const archived = { id: 'h1', prompt: PROSE, dispatchedBy: 'owner-1' }; // _formatHistoryItem shape: no key
    const hstore = { ...store, trimSessionBudget: async () => ({ ok: true, item: archived }) };
    const res = await get(buildApp(hstore, 'someone-else'), 'PATCH', `/workspace/acme/api/dispatch/${SESSION_ID}/trim`, { maxTasks: 1 });
    assert.equal(res.status, 200);
    assert.ok(!('bootstrapToken' in res.body.item), 'no bootstrapToken key added to a history row');
    assert.ok(!JSON.stringify(res.body).includes(TOKEN), 'prose still masked for a non-owner');
  });
});

describe('both real prose embeddings are masked', () => {
  // The two production sites that write `Authorization: Bearer <bootstrap>`:
  // lib/proxy-preamble.js (buildProxyContextPreamble) and
  // lib/prompts/collective-participant.js (buildLinearAccessBlock).
  const preamble = `do the task${buildProxyContextPreamble({ baseUrl: 'https://h.test', token: TOKEN, issueIdentifier: 'LIN-1', tokenDelivery: 'prose' })}`;
  const collective = buildCollectiveParticipantPrompt({
    channel: '#Collective', nick: 'P1', yapBaseUrl: 'https://yap.test', yapPassword: 'pw',
    proxyBaseUrl: 'https://h.test', proxyToken: TOKEN
  });

  for (const [name, prompt] of [['proxy-preamble', preamble], ['collective-participant', collective]]) {
    test(`${name}: the generated prompt carries the token, the mask removes only it`, () => {
      assert.ok(prompt.includes(`Bearer ${TOKEN}`), 'precondition: the real generator embeds the token');
      const masked = maskBootstrapTokens(prompt);
      assert.ok(!masked.includes(TOKEN));
      assert.equal(masked, prompt.replace(TOKEN, REDACTED_TOKEN_PLACEHOLDER), 'the rest of the prompt is byte-identical');
      assert.ok(masked.includes('<WORKING_TOKEN>'), 'the placeholder survives');
    });

    test(`${name}: through the session list, non-owner masked / owner unchanged`, async () => {
      const pstore = { ...store, listItems: async () => [row({ prompt, bootstrapToken: null })] };
      const other = await get(buildApp(pstore, 'someone-else'), 'GET', '/workspace/acme/api/dispatch');
      assert.ok(!JSON.stringify(other.body).includes(TOKEN));
      const owner = await get(buildApp(pstore, 'owner-1'), 'GET', '/workspace/acme/api/dispatch');
      assert.equal(owner.body.items[0].prompt, prompt);
    });
  }
});

describe('GET /api/proxy/dispatch/:id/prompt — masked by proxy creator', () => {
  const ITEM_ID = '11111111-2222-3333-4444-555555555555';
  function proxyApp(createdBy, dispatchedBy) {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy })
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore: {
        getItemStatus: async (urlKey, id) => ({
          id, prompt: PROSE, promptName: 'implementation', kind: 'implementation', target: 'cli',
          followUpTo: null, sessionId: null, dispatchedBy, bootstrapToken: TOKEN
        })
      },
      workspaceFromUrl: (req, res, next) => next(),
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    return app;
  }
  async function readPrompt(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/dispatch/${ITEM_ID}/prompt`, {
        headers: { Authorization: 'Bearer anything' }
      });
      return { status: res.status, text: await res.text() };
    } finally {
      await new Promise(r => server.close(r));
    }
  }

  test("another account's proxy token: the bearer token is masked", async () => {
    const res = await readPrompt(proxyApp('someone-else', 'owner-1'));
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes(TOKEN));
    assert.ok(res.text.includes(REDACTED_TOKEN_PLACEHOLDER));
  });

  test("the dispatcher's own proxy token: the prompt is returned byte for byte", async () => {
    const res = await readPrompt(proxyApp('owner-1', 'owner-1'));
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).prompt, PROSE);
  });

  test('ownerless row read by an ownerless token (null/null): masked, not revealed', async () => {
    const res = await readPrompt(proxyApp(null, null));
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes(TOKEN));
  });
});

describe('runner paths stay token-bearing (route level)', () => {
  const ITEM_ID = '22222222-2222-4222-8222-222222222222';
  const runnerStore = {
    pollAvailable: async () => [row()],
    takeItem: async () => row(),
    listItems: async () => [row()]
  };
  async function call(app, method, path, bearer) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined
      });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise(r => server.close(r));
    }
  }
  function legacyApp() {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: runnerStore,
      dispatchTokenStore: { validateToken: async () => ({ urlKey: 'acme', label: 'r', tokenId: 't', createdBy: 'u' }) },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null
    }));
    return app;
  }
  function proxyRunnerApp() {
    const app = express();
    app.use(express.json());
    app.use(createProxyRunnerRoutes({
      proxyLimiter: (req, res, next) => next(),
      authenticateProxyToken: (req, res, next) => {
        req.proxyUrlKey = 'acme'; req.proxyTokenLabel = 'runner'; req.proxyTokenId = 'runner-1'; req.proxyCreatedBy = 'someone-else'; next();
      },
      requireGrant: () => (req, res, next) => next(),
      logEvent: () => {},
      dispatchQueueStore: runnerStore,
      dispatchTokenStore: {},
      proxyTokenStore: {},
      workspaceHaltStore: { getWorkspaceHalt: async () => null, getLastKnownHalt: () => null }
    }));
    return app;
  }

  test('legacy GET /api/dispatch/poll', async () => {
    const res = await call(legacyApp(), 'GET', '/api/dispatch/poll', 'x');
    assert.equal(res.status, 200);
    assert.equal(res.body.items[0].bootstrapToken, TOKEN);
  });
  test('legacy POST /api/dispatch/take/:itemId', async () => {
    const res = await call(legacyApp(), 'POST', `/api/dispatch/take/${ITEM_ID}`, 'x');
    assert.equal(res.status, 200);
    assert.equal(res.body.item.bootstrapToken, TOKEN);
  });
  test('proxy runner GET /api/proxy/runner/poll', async () => {
    const res = await call(proxyRunnerApp(), 'GET', '/api/proxy/runner/poll', 'x');
    assert.equal(res.status, 200);
    assert.equal(res.body.items[0].bootstrapToken, TOKEN);
  });
  test('proxy runner POST /api/proxy/runner/take/:id', async () => {
    const res = await call(proxyRunnerApp(), 'POST', `/api/proxy/runner/take/${ITEM_ID}`, 'x');
    assert.equal(res.status, 200);
    assert.equal(res.body.item.bootstrapToken, TOKEN);
  });
});
