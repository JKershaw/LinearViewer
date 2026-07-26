/**
 * LIN-1173 — Collective fan-out routes token delivery through the shared
 * finalizePrompt → attachProxyContext seam.
 *
 * Follow-up from LIN-1162's class check: the Collective fan-out was the remaining
 * dispatch path that minted a readWrite bootstrap and embedded it INLINE in the
 * participant prompt prose (buildLinearAccessBlock), passing a plain prompt with no
 * finalizePrompt — so a claude-code participant received the injection-prone
 * in-prose token and NO structured `bootstrapToken` field. This pins the fix:
 *
 *   - claude-code participant (resolved harness) → the bootstrap travels out-of-band
 *     as the `bootstrapToken` dispatch-item field and the prompt carries NO token /
 *     curl prose (attachProxyContext, mcp mode);
 *   - every other harness (incl. null default) → the byte-identical bespoke
 *     Linear-access prose block with the token embedded inline, bootstrapToken null;
 *   - fail-closed (LIN-1175): a claude-code participant whose token cannot be minted
 *     is marked ok:false rather than dispatched credential-less.
 *
 * Run with: node --test tests/unit/collective-mcp-token.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) { return docs.find(d => d._id === query._id) || null; },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    }
  };
}

const WORKSPACES = [
  { urlKey: 'alpha', name: 'Alpha Project' },
  { urlKey: 'bravo', name: 'Bravo Project' },
];

// A proxy-token store that mints a deterministic per-workspace bootstrap so the
// test can assert exactly which token was (or was not) placed where.
function mintingStore(minted) {
  return {
    async createToken(urlKey, opts) {
      minted.push({ urlKey, opts });
      return { token: `boot_${urlKey}` };
    },
  };
}

function buildApp(captured, { workspacePreferencesStore, proxyTokenStore, accountId } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { _id: `disp-${captured.length}`, ...item };
      },
    },
    proxyTokenStore: proxyTokenStore ?? null,
    yapClient: { baseUrl: 'https://yap.test' },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspacePreferencesStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      // `accountId` is what stamps a mint's `createdBy` (LIN-1376). Left unset by
      // default, matching the historical fixture — the LIN-1582 tests below opt in
      // to an owned session explicitly.
      req.session = { linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
      if (accountId !== undefined) req.session.accountId = accountId;
      next();
    },
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const START_PATH = '/workspace/alpha/collective/start';

async function prefsWith(defaults) {
  const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
  for (const [urlKey, dispatchDefaults] of Object.entries(defaults)) {
    await store.saveWorkspacePreferences(urlKey, { dispatchDefaults });
  }
  return store;
}

describe('LIN-1173 — Collective fan-out token delivery via attachProxyContext', () => {
  test('claude-code participant: token travels as the bootstrapToken field, NOT in prompt prose', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    // The structured field carries the minted bootstrap...
    assert.equal(item.harness, 'claude-code');
    assert.equal(item.bootstrapToken, 'boot_alpha', 'bootstrap must travel as the structured field');
    // ...and the prompt carries NO token and NO curl-exchange prose.
    assert.ok(!item.prompt.includes('boot_alpha'), 'claude-code prompt must not embed the token');
    assert.ok(!item.prompt.includes('FIRST, exchange your single-use bootstrap token'), 'no bespoke inline exchange prose');
    assert.ok(!item.prompt.includes('curl -X POST -H "Authorization: Bearer'), 'no curl exchange in prompt');
    // The shared MCP access block is what got appended instead.
    assert.ok(item.prompt.includes('HARBOUR_LOCAL_BASE'), 'MCP access block present (local-broker framing)');
    // A single-use bootstrap was minted for the participant workspace.
    assert.ok(minted.some(m => m.urlKey === 'alpha' && m.opts.kind === 'bootstrap' && m.opts.scope === 'readWrite'));
  });

  test('non-claude-code participant: byte-identical inline prose block, no bootstrapToken field', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    assert.equal(item.harness, 'opencode');
    assert.strictEqual(item.bootstrapToken, null, 'prose path carries no structured token field');
    // The bespoke Linear-access block IS present, with the token embedded inline.
    assert.ok(item.prompt.includes('## Workspace API access (auto-appended)'), 'bespoke access block present');
    assert.ok(item.prompt.includes('FIRST, exchange your single-use bootstrap token for a working token:'), 'inline exchange prose present');
    assert.ok(item.prompt.includes('boot_alpha'), 'token embedded inline for a prose harness');
    // NOT the MCP block.
    assert.ok(!item.prompt.includes('HARBOUR_LOCAL_BASE'), 'no MCP block on the prose path');
  });

  test('claude-code fail-closed: an un-mintable token marks the participant ok:false, never dispatches credential-less', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const captured = [];
    // No proxy-token store → attachProxyContext throws in mcp mode (LIN-1175).
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: null });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 0, 'a credential-less claude-code participant must NOT be enqueued');
    assert.equal(res.body.dispatched.length, 1);
    assert.equal(res.body.dispatched[0].ok, false, 'the participant is reported failed');
  });

  test('mixed room: claude-code seat gets the field, opencode seat gets inline prose', async () => {
    const workspacePreferencesStore = await prefsWith({
      alpha: { harness: 'claude-code' },
      bravo: { harness: 'opencode' },
    });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room',
      characters: [{ workspaceUrlKey: 'alpha' }, { workspaceUrlKey: 'bravo' }],
      target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const byKey = Object.fromEntries(captured.map(c => [c.urlKey, c.item]));

    // alpha (claude-code): field-delivered, no inline token.
    assert.equal(byKey.alpha.bootstrapToken, 'boot_alpha');
    assert.ok(!byKey.alpha.prompt.includes('boot_alpha'));
    // bravo (opencode): inline prose, no field.
    assert.strictEqual(byKey.bravo.bootstrapToken, null);
    assert.ok(byKey.bravo.prompt.includes('boot_bravo'));
  });
});

// LIN-1582 — the prose branch's mint is now governed by the ownerless switch.
//
// Before this, the prose branch called proxyTokenStore.createToken directly while
// the claude-code branch above went through attachProxyContext →
// provisionBootstrapToken, so with DISPATCH_OWNERLESS_BROKER_COMPAT=off the prose
// branch could still mint an ownerless bootstrap — silently, with the
// ownerlessness then inherited by the exchanged working token (the LIN-1576 shape).
// Both branches now share provisionBootstrapToken; their only remaining divergence
// is shouldUseMcpTokenField, which decides throw-vs-null.
//
// The load-bearing distinction from the claude-code path pinned at :168 is that
// prose mode stays GRACEFUL: a refused mint drops the access block and the
// participant is still dispatched ok:true, because a prose prompt that carries no
// token never claims to have one. Failing the participant would be a regression,
// not extra safety.
describe('LIN-1582 — Collective prose branch under the ownerless switch', () => {
  const ENV = 'DISPATCH_OWNERLESS_BROKER_COMPAT';
  const restore = (t) => {
    const before = process.env[ENV];
    t.after(() => {
      if (before === undefined) delete process.env[ENV];
      else process.env[ENV] = before;
    });
  };

  test('owned session: mint options are byte-identical to the pre-LIN-1582 inline call', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, {
      workspacePreferencesStore, proxyTokenStore: mintingStore(minted), accountId: 'account-A',
    });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(minted.length, 1, 'exactly one mint, as before');
    // The four forwarded options plus the owner stamp — this is the equivalence
    // the swap to provisionBootstrapToken has to preserve.
    assert.deepEqual(minted[0], {
      urlKey: 'alpha',
      opts: {
        kind: 'bootstrap',
        scope: 'readWrite',
        label: 'collective',
        ttl: BOOTSTRAP_TOKEN_TTL_SECONDS,
        createdBy: 'account-A',
      },
    });
    // ...and the prose block still carries the token inline.
    const { item } = captured[0];
    assert.ok(item.prompt.includes('## Workspace API access (auto-appended)'), 'access block present');
    assert.ok(item.prompt.includes('boot_alpha'), 'token embedded inline');
    assert.strictEqual(item.bootstrapToken, null, 'prose path carries no structured field');
  });

  test('compat ON + ownerless session: still mints and still embeds, but warns', async (t) => {
    restore(t);
    delete process.env[ENV];
    const warnMock = t.mock.method(console, 'warn', () => {});
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(minted.length, 1, 'the compat population is still served');
    assert.equal(minted[0].opts.createdBy, null);
    assert.ok(captured[0].item.prompt.includes('boot_alpha'), 'prose block unchanged under compat');

    const warned = warnMock.mock.calls.map(c => c.arguments.join(' ')).join('\n');
    assert.match(warned, /LIN-1448/, 'the ownerless mint is countable, never silent');
    assert.ok(!warned.includes('boot_alpha'), 'never logs token bytes');
  });

  test('compat OFF + ownerless session: no mint, no access block, participant still dispatched', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(minted.length, 0, 'the ownerless bootstrap is never minted');
    // Graceful, NOT fail-closed — contrast the claude-code case at :168.
    assert.equal(captured.length, 1, 'the participant is still enqueued');
    assert.equal(res.body.dispatched[0].ok, true, 'a token-less prose participant is not a failure');
    const { item } = captured[0];
    assert.ok(!item.prompt.includes('## Workspace API access (auto-appended)'),
      'the token-dependent block is dropped rather than emitted token-less');
    assert.ok(!item.prompt.includes('boot_alpha'));
    assert.strictEqual(item.bootstrapToken, null);
    // The discussion itself still works — the participant just lacks Linear access.
    assert.ok(item.prompt.includes('#room'), 'the participant prompt is otherwise intact');
  });

  test('compat OFF + owned session: the claude-code branch still gets its field token', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, {
      workspacePreferencesStore, proxyTokenStore: mintingStore(minted), accountId: 'account-A',
    });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured[0].item.bootstrapToken, 'boot_alpha', 'the owned dispatch path is untouched');
    assert.equal(minted[0].opts.createdBy, 'account-A');
  });
});

// LIN-1189 — the facilitator seat rides the SAME harness-agnostic finalizePrompt/
// buildPrompt branch as a participant (only `isFacilitator` swaps the builder), so
// the risk that the field-vs-prose split behaves differently there is low — but it
// was untested. These pin the facilitator variant explicitly. A facilitator seat is
// designated by naming its bound workspaceUrlKey in the `facilitator` body field.
describe('LIN-1189 — facilitator seat token delivery via attachProxyContext', () => {
  test('claude-code facilitator: token travels as the bootstrapToken field, NOT in prompt prose', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], facilitator: 'alpha', target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    // This really is the facilitator seat, not a participant.
    assert.equal(item.promptName, 'collective-facilitator', 'the designated seat gets the facilitator prompt');
    assert.ok(item.prompt.includes('## You are the facilitator'), 'facilitator prompt body present');

    // The structured field carries the minted bootstrap...
    assert.equal(item.harness, 'claude-code');
    assert.equal(item.bootstrapToken, 'boot_alpha', 'bootstrap must travel as the structured field');
    // ...and the prompt carries NO token and NO curl-exchange prose.
    assert.ok(!item.prompt.includes('boot_alpha'), 'claude-code prompt must not embed the token');
    assert.ok(!item.prompt.includes('FIRST, exchange your single-use bootstrap token'), 'no bespoke inline exchange prose');
    assert.ok(!item.prompt.includes('curl -X POST -H "Authorization: Bearer'), 'no curl exchange in prompt');
    // The shared MCP access block is what got appended instead.
    assert.ok(item.prompt.includes('HARBOUR_LOCAL_BASE'), 'MCP access block present (local-broker framing)');
    // A single-use bootstrap was minted for the facilitator's workspace.
    assert.ok(minted.some(m => m.urlKey === 'alpha' && m.opts.kind === 'bootstrap' && m.opts.scope === 'readWrite'));
  });

  test('non-claude-code facilitator: byte-identical inline prose block, no bootstrapToken field', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], facilitator: 'alpha', target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    assert.equal(item.promptName, 'collective-facilitator', 'the designated seat gets the facilitator prompt');
    assert.ok(item.prompt.includes('## You are the facilitator'), 'facilitator prompt body present');

    assert.equal(item.harness, 'opencode');
    assert.strictEqual(item.bootstrapToken, null, 'prose path carries no structured token field');
    // The bespoke Linear-access block IS present, with the token embedded inline.
    assert.ok(item.prompt.includes('## Workspace API access (auto-appended)'), 'bespoke access block present');
    assert.ok(item.prompt.includes('FIRST, exchange your single-use bootstrap token for a working token:'), 'inline exchange prose present');
    assert.ok(item.prompt.includes('boot_alpha'), 'token embedded inline for a prose harness');
    // NOT the MCP block.
    assert.ok(!item.prompt.includes('HARBOUR_LOCAL_BASE'), 'no MCP block on the prose path');

    // The prose access block is byte-identical to the participant seat's — both
    // builders share buildLinearAccessBlock, so the facilitator's appended block
    // must match a participant's for the same workspace/token exactly.
    const participantCaptured = [];
    const participantApp = buildApp(participantCaptured, {
      workspacePreferencesStore: await prefsWith({ alpha: { harness: 'opencode' } }),
      proxyTokenStore: mintingStore([]),
    });
    await call(participantApp, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });
    const MARKER = '## Workspace API access (auto-appended)';
    // Normalise the ephemeral test-server origin (each `call` binds a fresh random
    // port) so the comparison pins the prose, not the port.
    const normalise = (p) => p.slice(p.indexOf(MARKER)).replace(/http:\/\/127\.0\.0\.1:\d+/g, 'ORIGIN');
    const facilitatorBlock = normalise(item.prompt);
    const participantBlock = normalise(participantCaptured[0].item.prompt);
    assert.ok(facilitatorBlock.startsWith(MARKER), 'access-block marker found in facilitator prompt');
    assert.strictEqual(facilitatorBlock, participantBlock, 'facilitator prose block is byte-identical to the participant one');
  });
});
