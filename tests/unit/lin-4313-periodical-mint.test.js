/**
 * LIN-4313 — `POST /api/proxy/periodicals/:id/mint`: a proxy token holding `dispatch` mints a
 * Periodical run by registry id, plain or + Autopilot, as the UI's Mint and Mint + Autopilot
 * actions do. The server renders the prompt; the caller never sees it.
 *
 * Real `createProxyRoutes` over a REAL `ProxyTokenStore`, as in lin-3136-m1-kickoff-declared.
 * Covers:
 *  - grant witnesses: an owner's dispatch token minting + Autopilot declares `['dispatch']`
 *    (site M5) and its child can enqueue; a non-owner is REFUSED, never handed a leaf; a
 *    plain mint from any dispatch holder stays a grant-less leaf; no `dispatch` → 403;
 *  - parity: for every registry id and both variants the stored prompt begins with the text
 *    the UI's node carries (`buildPeriodicalNodes`), and kind / periodicalId / promptName
 *    equal what the UI action sends;
 *  - unknown id → 404 before any store read or mint;
 *  - the optional operator note: placed before the template text, template text untouched,
 *    refused when over 500 characters, carrying any control character, or not a string;
 *  - run-state visibility: after a mint, GET /api/proxy/periodicals shows the template recent.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import crypto from 'crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { getPeriodicals, buildPeriodicalNodes, PERIODICAL_AUTOPILOT_TAIL } from '../../lib/periodicals.js';

const OWNER = 'account-A';
const WS = 'ws-1';
const HOURS_48 = 48 * 3600;
const mintPath = (id) => `/api/proxy/periodicals/${id}/mint`;
const PROXY_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created (LIN-1175) — refusing to launch a credential-less session; you may have hit the token rate limit, wait a minute and retry.';
const NOTE = 'Also read as a drift check on the run; context, not scope.';

// The first registry entry is enough for the grant witnesses; parity covers every id.
const TEMPLATE = getPeriodicals()[0];

function world({ freeTierCheck = null } = {}) {
  const store = new ProxyTokenStore({ collection: createMockCollection() });
  const state = { owners: { [WS]: OWNER }, fault: false };
  store.setOwnerCheck(async ({ workspaceId, accountId }) => {
    if (state.fault) throw new Error('owner store down');
    const owner = state.owners[workspaceId];
    if (!owner) return { status: 'no-owner' };
    return { status: owner === accountId ? 'owner' : 'not-owner' };
  });
  const spy = { grant: [], plain: [] };
  const realGrant = store.mintGrantBootstrap.bind(store);
  store.mintGrantBootstrap = async (args) => { spy.grant.push(args); return realGrant(args); };
  const realCreate = store.createToken.bind(store);
  store.createToken = async (urlKey, opts) => { spy.plain.push(opts); return realCreate(urlKey, opts); };
  const items = [];
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        items.push(item);
        return { _id: `disp-${items.length}`, dispatchedAt: '2026-10-01T00:00:00.000Z', ...item };
      },
      listItems: async (urlKey) => items.filter(i => i.urlKey === undefined || i.urlKey === urlKey),
      listHistory: async () => ({ items: [], total: 0 }),
      historyTtl: 30 * 24 * 60 * 60
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }), checkRun: freeTierCheck || (async () => ({ allowed: true })) }
  }));
  return { store, state, spy, items, app };
}

async function call(app, method, path, { token, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method: method.toUpperCase(), headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** A dispatch-holding caller, minted and exchanged like a driver copy. */
async function dispatchCaller(w) {
  const bootstrap = await w.store.mintGrantBootstrap({
    urlKey: 'acme', workspaceId: WS, ownerAccountId: OWNER, grants: ['dispatch'], profile: 'worker'
  });
  const working = await w.store.exchangeBootstrapToken(bootstrap.token);
  w.spy.grant.length = 0;
  w.spy.plain.length = 0;
  return working.token;
}

/** What the UI's own node carries for an id: the parity source (lib/periodicals.js). */
function uiNode(id) {
  const node = buildPeriodicalNodes().find(n => n.issue.id === id);
  assert.ok(node, `the UI renders ${id}`);
  return node.periodical;
}

describe('LIN-4313 — the owner\'s + Autopilot mint declares [dispatch] for its orchestrator', () => {
  test('owner token + autopilot:true → 201, declared site M5, owner\'s; the child can enqueue', async () => {
    const w = world();
    const caller = await dispatchCaller(w);

    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(w.items.length, 1);
    const item = w.items[0];
    assert.equal(w.spy.grant.length, 1, 'one declared mint');
    assert.equal(w.spy.plain.length, 0, 'no grant-less mint');
    assert.deepEqual(w.spy.grant[0], {
      urlKey: 'acme', workspaceId: WS, ownerAccountId: OWNER, grants: ['dispatch'], label: 'periodical-bootstrap', profile: 'worker'
    });
    assert.equal(item.grantDeclaration.site, 'M5');
    assert.deepEqual(item.grantDeclaration.grants, ['dispatch']);
    assert.equal(item.grantDeclaration.ownerAccountId, OWNER);
    assert.equal(item.grantDeclaration.workspaceId, WS);

    const child = await w.store.exchangeBootstrapToken(item.bootstrapToken);
    assert.equal(child.scope, 'readWrite');
    assert.deepEqual(child.grants, ['dispatch'], 'the exchange copies the declaration and adds nothing');
    const ttl = (new Date(child.expiresAt).getTime() - Date.now()) / 1000;
    assert.ok(ttl > HOURS_48 - 60 && ttl <= HOURS_48 + 5, `worker 48h, got ${ttl}s`);
    assert.equal((await w.store.validateToken(child.token)).createdBy, OWNER);

    const enqueued = await call(w.app, 'post', '/api/proxy/dispatch', { token: child.token, body: { prompt: 'child work', kind: 'implementation' } });
    assert.equal(enqueued.status, 201, JSON.stringify(enqueued.body));
  });

  test('a non-owner\'s dispatch token asking for + Autopilot → 403 GRANT_OWNER_ONLY; nothing enqueued, no leaf', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    w.state.owners[WS] = 'account-B';
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.match(res.body.error, /periodical \+ Autopilot launch credential/, 'the refusal names this credential, not kickoff\'s');
    assert.equal(res.body.retryable, false);
    assert.equal(w.items.length, 0, 'no item');
    assert.equal(w.spy.plain.length, 0, 'never degrades to a grant-less leaf');
  });

  test('a caller token with no stored workspace + autopilot:true → 400 INVALID_GRANTS (fails closed)', async () => {
    const w = world();
    const token = crypto.randomBytes(24).toString('hex');
    await w.store.collection.insertOne({
      _id: crypto.randomUUID(), urlKey: 'acme', tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      label: 'legacy', scope: 'readWrite', kind: 'standard', singleUse: false, createdBy: OWNER,
      grants: ['dispatch'], parentTokenId: null, workspaceId: null, createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, consumed: false
    });
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token, body: { autopilot: true } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'INVALID_GRANTS');
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
  });

  test('owner check unavailable on + Autopilot → the transient 503, nothing enqueued', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    w.state.fault = true;
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true } });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.error, PROXY_ATTACH_FAILED_MESSAGE);
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.plain.length, 0);
  });

  test('a plain mint from a non-owner dispatch holder is a grant-less leaf, as the UI\'s plain Mint is', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    w.state.owners[WS] = 'account-B';
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: {} });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const item = w.items[0];
    assert.equal(w.spy.grant.length, 0, 'no declared mint for a plain Mint');
    assert.equal(item.grantDeclaration ?? null, null);
    const child = await w.store.exchangeBootstrapToken(item.bootstrapToken);
    assert.deepEqual(child.grants ?? [], []);
  });

  test('no dispatch grant → 403 DISPATCH_GRANT_REQUIRED before the sink; nothing minted', async () => {
    const w = world();
    const { token } = await w.store.createToken('acme', { scope: 'readWrite', createdBy: OWNER });
    w.spy.plain.length = 0;
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token, body: { autopilot: true } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'DISPATCH_GRANT_REQUIRED');
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
  });

  test('the run gate applies to the route: an over-limit free-tier account gets the run-limit refusal, nothing enqueued', async () => {
    const w = world({ freeTierCheck: async () => ({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: '2026-11-07T00:00:00.000Z' }) });
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true } });
    assert.ok([429, 503].includes(res.status), `a refused run is never admitted, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0, 'no token minted for a refused run');
  });
});

describe('LIN-4313 — parity: the route dispatches the text the UI\'s action sends', () => {
  for (const template of getPeriodicals()) {
    for (const autopilot of [false, true]) {
      test(`${template.id} ${autopilot ? '+ Autopilot' : 'plain'}: prompt, kind, periodicalId and promptName match the UI, without a note`, async () => {
        const w = world();
        const caller = await dispatchCaller(w);
        const res = await call(w.app, 'post', mintPath(template.id), { token: caller, body: { autopilot } });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        const item = w.items[0];
        const ui = uiNode(template.id);
        const expected = autopilot ? ui.autopilotPrompt : ui.prompt;

        assert.ok(item.prompt.startsWith(expected), 'the stored prompt begins with the UI\'s text, byte for byte');
        assert.equal(item.kind, 'periodical');
        assert.equal(item.periodicalId, template.id, 'stamped so the run shows in GET /periodicals');
        assert.equal(item.promptName, autopilot ? `${template.title} + Autopilot` : template.title);
        // The grant is declared exactly where the variant carries the handoff tail.
        assert.equal(item.grantDeclaration != null, autopilot);
        assert.equal(expected.includes(PERIODICAL_AUTOPILOT_TAIL), autopilot);
      });
    }
  }
});

describe('LIN-4313 — unknown id and the operator note', () => {
  test('an unknown registry id → 404 naming GET /api/proxy/periodicals; nothing minted or enqueued', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', mintPath('no-such-periodical'), { token: caller, body: { autopilot: true } });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.match(res.body.error, /GET \/api\/proxy\/periodicals/);
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
  });

  test('the note sits before the template text, and the template text is unchanged', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true, note: NOTE } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { prompt } = w.items[0];
    const ui = uiNode(TEMPLATE.id);
    assert.ok(prompt.includes(ui.autopilotPrompt), 'the template text, tail included, is present verbatim');
    assert.ok(prompt.indexOf(NOTE) < prompt.indexOf(ui.autopilotPrompt), 'the note comes before the template');
    assert.ok(prompt.includes(PERIODICAL_AUTOPILOT_TAIL), 'the tail still gates the grant');
  });

  test('a note of exactly 500 characters is admitted; 501 is refused', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const ok = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { note: 'x'.repeat(500) } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const tooLong = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { note: 'x'.repeat(501) } });
    assert.equal(tooLong.status, 400, JSON.stringify(tooLong.body));
    assert.equal(w.items.length, 1, 'only the admitted note minted');
  });

  for (const [label, note] of [
    ['a newline', `line one\nline two`],
    ['a tab', 'a\tb'],
    ['a NUL', 'a\u0000b'],
    ['an ESC', 'a\u001bb'],
    ['a C1 control', 'a\u0085b'],
    ['DEL', 'a\u007fb'],
    ['an empty string', ''],
    ['a number', 123],
    ['an array', ['a']],
    ['an object', { text: 'a' }],
    ['the whole autopilot tail (too long, and multi-line)', PERIODICAL_AUTOPILOT_TAIL],
  ]) {
    test(`a note with ${label} → 400, nothing minted or enqueued`, async () => {
      const w = world();
      const caller = await dispatchCaller(w);
      const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true, note } });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(w.items.length, 0);
      assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
    });
  }

  test('the tail is longer than any admitted note, so a note cannot carry or fake it', () => {
    assert.ok(PERIODICAL_AUTOPILOT_TAIL.length > 500, `tail is ${PERIODICAL_AUTOPILOT_TAIL.length} characters`);
  });

  test('autopilot must be a boolean when present', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: 'yes' } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(w.items.length, 0);
  });
});

describe('LIN-4313 — run-state visibility', () => {
  test('after a mint, GET /api/proxy/periodicals shows the template with a run stamped by periodicalId', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const minted = await call(w.app, 'post', mintPath(TEMPLATE.id), { token: caller, body: { autopilot: true } });
    assert.equal(minted.status, 201, JSON.stringify(minted.body));
    const res = await call(w.app, 'get', '/api/proxy/periodicals', { token: caller });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = (res.body.periodicals || res.body).find(p => p.id === TEMPLATE.id);
    assert.ok(entry, 'the template is listed');
    assert.notEqual(entry.state ?? entry.status, undefined, 'the entry carries a run state');
  });
});
