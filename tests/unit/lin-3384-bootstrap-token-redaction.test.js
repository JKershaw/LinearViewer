/**
 * LIN-3384 (LIN-2954 S1.5) — no live bootstrap token in any response a session
 * can read. Helper semantics, the four redacted routes, the runner paths that
 * must STAY token-bearing, and a census of formatter/reader callers.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDispatchRoutes } from '../../routes/dispatch.js';
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

describe('runner paths stay token-bearing', () => {
  test('poll still returns the live bootstrapToken', async () => {
    const app = express();
    app.use(createDispatchRoutes({
      dispatchQueueStore: store,
      dispatchTokenStore: {
        validateToken: async () => ({ urlKey: 'acme', label: 'r', tokenId: 't', createdBy: 'u' })
      },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dispatch/poll`, { headers: { Authorization: 'Bearer x' } });
      const body = await res.json();
      if (res.status === 200) assert.equal(body.items[0].bootstrapToken, TOKEN);
      else assert.fail(`poll auth fake rejected: ${res.status}`);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});

describe('census: session-reachable readers go through the redactor', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

  test('routes/dispatch.js: every non-runner reader response is redacted', () => {
    const src = read('routes/dispatch.js');
    for (const call of ['listItems(', 'listHistory(', 'trimSessionBudget(']) {
      assert.ok(src.includes(`dispatchQueueStore.${call}`), `${call} caller expected`);
    }
    assert.equal((src.match(/redactSessionItems?\(/g) || []).length >= 3, true);
    // poll/take responses must not be redacted
    for (const marker of ["router.get('/api/dispatch/poll'", "router.post('/api/dispatch/take/:itemId'"]) {
      const start = src.indexOf(marker);
      assert.ok(start > 0, marker);
      const body = src.slice(start, src.indexOf('\n  });', start));
      assert.ok(!body.includes('redactSession'), `${marker} must stay token-bearing`);
    }
  });

  test('proxy prompt route is redacted', () => {
    const src = read('routes/proxy-dispatch.js');
    const start = src.indexOf("router.get('/api/proxy/dispatch/:id/prompt'");
    const body = src.slice(start, src.indexOf('\n  });', start));
    assert.ok(body.includes('redactSessionItem('));
  });

  test('no other route file echoes a raw store item (formatter/reader census)', () => {
    // Every file calling a token-bearing reader must be classified. A new caller
    // fails here until someone decides redact / runner / projects-an-allowlist.
    const CLASSIFIED = new Set([
      'dispatch.js', 'proxy-dispatch.js',            // redacted (above)
      'proxy-runner.js',                              // runner: token-bearing by design
      'proxy-compute.js', 'dashboard.js', 'proxy-kickoff.js', 'test.js' // read fields into allowlisted projections
    ]);
    const READER = /\.(listItems|listHistory|getItemStatus|trimSessionBudget|pollAvailable|takeItem)\(/;
    const offenders = readdirSync(join(REPO, 'routes'))
      .filter(f => f.endsWith('.js') && READER.test(read(`routes/${f}`)) && !CLASSIFIED.has(f));
    assert.deepEqual(offenders, []);
  });
});
