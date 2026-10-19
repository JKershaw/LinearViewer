/**
 * LIN-3618 — new dispatch tokens get a 90-day lifetime at the store level.
 *
 * LIN-3421 added `expiresAt` but production built the store with no TTL, so
 * every token was permanent. The cause is the wiring in server.js, so the fix is
 * the store default (not a special case in the mint route): `/test/create-dispatch-token`
 * and any future caller inherit it. Existing rows are never rewritten here.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { DispatchTokenStore, DISPATCH_TOKEN_DEFAULT_TTL_SECONDS } from '../../lib/dispatch-tokens.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('LIN-3618 default dispatch token lifetime', () => {
  let harness;
  before(async () => { harness = createMangoTmpdir('lin-3618-ttl-'); await harness.connect(); });
  after(async () => { await harness.close(); });

  test('the constant is 90 days in seconds', () => {
    assert.equal(DISPATCH_TOKEN_DEFAULT_TTL_SECONDS, 7_776_000);
  });

  test('a store built with the constant stamps expiresAt = creation + 90 days, returned as ISO', async () => {
    const collection = harness.freshDb().collection('dispatch-tokens');
    const store = new DispatchTokenStore({ collection, defaultTtlSeconds: DISPATCH_TOKEN_DEFAULT_TTL_SECONDS });
    const before = Date.now();
    const created = await store.createToken('acme', 'ci', 'acct-1');
    const row = await collection.findOne({ _id: created.tokenId });
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 90 * DAY_MS);
    assert.ok(row.createdAt.getTime() >= before);
    assert.equal(created.expiresAt, row.expiresAt.toISOString());
  });

  test('the class default is still null: no TTL, createToken returns expiresAt null', async () => {
    const collection = harness.freshDb().collection('dispatch-tokens');
    const store = new DispatchTokenStore({ collection });
    const created = await store.createToken('acme', 'plain');
    assert.equal(created.expiresAt, null);
    assert.equal((await collection.findOne({ _id: created.tokenId })).expiresAt, null);
  });

  test('existing rows (no expiresAt / expiresAt null) are untouched by a new mint and still validate', async () => {
    const collection = harness.freshDb().collection('dispatch-tokens');
    const store = new DispatchTokenStore({ collection, defaultTtlSeconds: DISPATCH_TOKEN_DEFAULT_TTL_SECONDS });
    const legacy = await new DispatchTokenStore({ collection }).createToken('acme', 'legacy');
    const nulled = await new DispatchTokenStore({ collection }).createToken('acme', 'nulled');
    await collection.updateOne({ _id: legacy.tokenId }, { $unset: { expiresAt: '' } });
    const snapshot = async () => [
      await collection.findOne({ _id: legacy.tokenId }),
      await collection.findOne({ _id: nulled.tokenId })
    ];
    const beforeRows = await snapshot();
    assert.ok(!('expiresAt' in beforeRows[0]), 'the legacy row really has no expiresAt');

    await store.createToken('acme', 'fresh');

    assert.deepEqual(await snapshot(), beforeRows);
    assert.ok(await store.validateToken(legacy.token, { touch: false }));
    assert.ok(await store.validateToken(nulled.token, { touch: false }));
    const listed = await store.listTokens('acme');
    assert.equal(listed.find(t => t.tokenId === legacy.tokenId).expiresAt, null);
    assert.equal(listed.find(t => t.tokenId === nulled.tokenId).expiresAt, null);
    assert.ok(listed.find(t => t.label === 'fresh').expiresAt);
  });

  describe('through the real mint and list routes', () => {
    async function withApp(fn) {
      const collection = harness.freshDb().collection('dispatch-tokens');
      const dispatchTokenStore = new DispatchTokenStore({ collection, defaultTtlSeconds: DISPATCH_TOKEN_DEFAULT_TTL_SECONDS });
      const app = express();
      app.use(express.json());
      app.use(createDispatchRoutes({
        dispatchQueueStore: {},
        dispatchTokenStore,
        workspaceFromUrl: (req, res, next) => {
          req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
          req.session = { accountId: 'acct-owner' };
          next();
        },
        userPreferencesStore: {},
        workspaceOwnerCheck: async () => ({ status: 'owner' })
      }));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/workspace/acme/api/dispatch/tokens`;
      try { await fn(base); } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }

    test('POST 201 carries expiresAt (90 days out) and GET lists it per token', async () => {
      await withApp(async (base) => {
        const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(res.status, 201);
        const body = await res.json();
        const ms = new Date(body.expiresAt).getTime() - Date.now();
        assert.ok(Math.abs(ms - 90 * DAY_MS) < 60_000, `expiresAt is ~90 days out, got ${body.expiresAt}`);

        const { tokens } = await (await fetch(base)).json();
        assert.equal(tokens.length, 1);
        assert.equal(tokens[0].expiresAt, body.expiresAt);
      });
    });
  });

  describe('source pins', () => {
    test('server.js passes the constant to the DispatchTokenStore, not the mint route', () => {
      const src = read('server.js');
      const at = src.indexOf('new DispatchTokenStore(');
      assert.ok(at > -1);
      assert.match(src.slice(at, src.indexOf('})', at)), /defaultTtlSeconds:\s*DISPATCH_TOKEN_DEFAULT_TTL_SECONDS/);
      assert.doesNotMatch(read('routes/dispatch.js'), /DISPATCH_TOKEN_DEFAULT_TTL_SECONDS|ttlSeconds/);
    });

    test('no other non-test file imports the constant', () => {
      const hits = [];
      const walk = (dir) => {
        for (const name of readdirSync(join(ROOT, dir))) {
          if (['node_modules', 'tests', 'docs', 'data', 'test-results', 'experiments', 'plans', 'prototypes', '.git'].includes(name)) continue;
          const rel = join(dir, name);
          const st = statSync(join(ROOT, rel));
          if (st.isDirectory()) walk(rel);
          else if (/\.(m?js)$/.test(name) && read(rel).includes('DISPATCH_TOKEN_DEFAULT_TTL_SECONDS')) hits.push(rel);
        }
      };
      walk('.');
      assert.deepEqual(hits.sort(), ['lib/dispatch-tokens.js', 'server.js']);
    });
  });
});
