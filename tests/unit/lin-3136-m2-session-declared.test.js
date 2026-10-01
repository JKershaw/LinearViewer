/**
 * LIN-3136 S3 (acceptance 7 and 16) — M2 / M2b: the owner's session dispatch of
 * an autopilot (and of a periodical "+ Autopilot" variant) declares
 * `['dispatch']` for the run it launches.
 *
 * Real `createDispatchRoutes` (session auth) over a REAL `ProxyTokenStore`.
 *  - M2: `kind: 'autopilot'` + `attachProxy` from the owner → `site: 'M2'`, the
 *    bootstrap exchanges to `['dispatch']`, in both harness modes: an explicit
 *    claude-code harness (the MCP field), and prose (a blank harness, since this
 *    route applies no default harness, or an explicit opencode).
 *  - Refusals (nothing enqueued, no token): non-owner 403 GRANT_OWNER_ONLY,
 *    owner-less 409, no accountId 503 GRANT_OWNERLESS, seam unwired 503
 *    OWNER_CHECK_UNAVAILABLE with retryable:true and the owner-check text (not
 *    the rate-limit text); all with human text from the shared vocabulary.
 *  - M2b: the request is built from the RENDERED periodical container exactly
 *    as `public/app.js` builds it (prompt text through its own
 *    `stripCodeBlockFences`, `kind`, `periodicalId`, `attachProxy` from
 *    `data-proxy-force`). "+ Autopilot" declares; plain Mint does not; a
 *    non-owner "+ Autopilot" is refused.
 *  - Leaves stay grant-less: a non-autopilot kind, an unforced autopilot, a
 *    periodical prompt without the server-owned tail, or the tail with no
 *    validated periodicalId.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { renderPage } from '../../lib/render.js';
import { PERIODICAL_AUTOPILOT_TAIL } from '../../lib/periodicals.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { testMockPeriodicalsTree } from '../fixtures/mock-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNER = 'account-A';
const WS = 'ws-1';
const PATH = '/workspace/acme/api/dispatch';
const PERIODICAL_ID = 'documentation-review';

// The client's own fence-stripper, run as shipped (public/app.js).
const APP_SRC = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');
const stripSrc = APP_SRC.slice(APP_SRC.indexOf('function stripCodeBlockFences('), APP_SRC.indexOf('\n}\n', APP_SRC.indexOf('function stripCodeBlockFences(')) + 2);
const stripCodeBlockFences = new Function(`${stripSrc}; return stripCodeBlockFences;`)();

function world({ ownerCheck, session } = {}) {
  const store = new ProxyTokenStore({ collection: createMockCollection() });
  const state = { owners: { [WS]: OWNER } };
  if (ownerCheck !== null) {
    store.setOwnerCheck(ownerCheck || (async ({ workspaceId, accountId }) => {
      const owner = state.owners[workspaceId];
      if (!owner) return { status: 'no-owner' };
      return { status: owner === accountId ? 'owner' : 'not-owner' };
    }));
  }
  const spy = { grant: [], plain: [] };
  const realGrant = store.mintGrantBootstrap.bind(store);
  store.mintGrantBootstrap = async (args) => { spy.grant.push(args); return realGrant(args); };
  const realCreate = store.createToken.bind(store);
  store.createToken = async (urlKey, opts) => { spy.plain.push(opts); return realCreate(urlKey, opts); };
  const items = [];
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        items.push(item);
        return { _id: `disp-${items.length}`, dispatchedAt: '2026-10-01T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    proxyTokenStore: store,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', id: WS, provider: 'linear' };
      req.session = session === undefined ? { accountId: OWNER } : session;
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return { store, state, spy, items, app, docs: () => store.collection._docs };
}

async function post(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const proseToken = (prompt) => (prompt.match(/Authorization: Bearer (\S+)" /) || [])[1];
const AUTOPILOT = { prompt: 'Run the autopilot on LIN-1.', promptName: 'Autopilot', kind: 'autopilot', issueId: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'LIN-1', attachProxy: true, target: 'cli' };

async function assertDeclared(w, res, { prose }) {
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(w.spy.grant.length, 1, 'one declared mint');
  assert.equal(w.spy.plain.length, 0, 'no grant-less mint');
  assert.deepEqual(w.spy.grant[0], {
    urlKey: 'acme', workspaceId: WS, ownerAccountId: OWNER, grants: ['dispatch'], label: 'dispatch-bootstrap', profile: 'worker'
  });
  const item = w.items[0];
  assert.equal(item.grantDeclaration.site, 'M2');
  assert.deepEqual(item.grantDeclaration.grants, ['dispatch']);
  const bootstrap = prose ? proseToken(item.prompt) : item.bootstrapToken;
  assert.ok(bootstrap, 'the run carries its bootstrap');
  const working = await w.store.exchangeBootstrapToken(bootstrap);
  assert.deepEqual(working.grants, ['dispatch']);
  assert.equal(working.scope, 'readWrite');
}

function assertLeaf(w, res) {
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(w.spy.grant.length, 0, 'no declared mint');
  assert.equal(w.items[0].grantDeclaration ?? null, null);
}

describe('LIN-3136 M2 — the owner\'s autopilot dispatch declares [dispatch]', () => {
  test('explicit claude-code harness (MCP field)', async () => {
    const w = world();
    await assertDeclared(w, await post(w.app, { ...AUTOPILOT, harness: 'claude-code' }), { prose: false });
  });

  test('blank harness (prose: this route interposes no default harness)', async () => {
    const w = world();
    await assertDeclared(w, await post(w.app, AUTOPILOT), { prose: true });
  });

  test('explicit opencode harness (prose)', async () => {
    const w = world();
    await assertDeclared(w, await post(w.app, { ...AUTOPILOT, harness: 'opencode' }), { prose: true });
  });
});

describe('LIN-3136 M2 — refusals: nothing enqueued, no token, human text', () => {
  const cases = [
    ['non-owner → 403 GRANT_OWNER_ONLY', {}, (w) => { w.state.owners[WS] = 'account-B'; }, 403,
      { error: "Only this workspace's owner can mint an autopilot launch credential", code: 'GRANT_OWNER_ONLY', retryable: false }],
    ['owner-less workspace → 409 WORKSPACE_OWNER_UNSET', {}, (w) => { delete w.state.owners[WS]; }, 409,
      { error: 'This workspace has no recorded owner', code: 'WORKSPACE_OWNER_UNSET', retryable: false }],
    ['no accountId → 503 GRANT_OWNERLESS', { session: { linearUserId: 'u1' } }, () => {}, 503,
      { error: 'This session has no account owner', code: 'GRANT_OWNERLESS', retryable: false }],
    ['seam unwired → 503 OWNER_CHECK_UNAVAILABLE, retryable, owner-check text', { ownerCheck: null }, () => {}, 503,
      { error: 'Owner verification is temporarily unavailable', code: 'OWNER_CHECK_UNAVAILABLE', retryable: true }]
  ];
  for (const harness of ['claude-code', undefined]) {
    for (const [desc, opts, arrange, status, body] of cases) {
      test(`${desc} (${harness || 'blank harness'})`, async () => {
        const w = world(opts);
        arrange(w);
        const res = await post(w.app, { ...AUTOPILOT, ...(harness ? { harness } : {}) });
        assert.equal(res.status, status, JSON.stringify(res.body));
        assert.deepEqual(res.body, body);
        assert.equal(w.items.length, 0, 'nothing enqueued');
        assert.equal(w.docs().length, 0, 'no token written');
        assert.equal(w.spy.plain.length, 0, 'never degrades to a grant-less mint');
      });
    }
  }
});

// ── M2b: the request a click on the rendered container sends ────────────────

const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The rendered periodical container for `periodicalId`, the forced variant or the plain one. */
function renderedContainer({ forced }) {
  const html = renderPage([testMockPeriodicalsTree], [], [], 'Test', { isLanding: false, urlKey: 'acme', featureFlags: { proxy: true } });
  const re = /<div class="prompt-container"([^>]*)><div class="prompt-header"><span class="prompt-name">([^<]*)<\/span>[\s\S]*?<div class="prompt-text">([\s\S]*?)<\/div><\/div>/g;
  for (const m of html.matchAll(re)) {
    const attrs = m[1];
    if (!attrs.includes(`data-periodical-id="${PERIODICAL_ID}"`)) continue;
    if (attrs.includes('data-proxy-force="true"') !== forced) continue;
    return {
      kind: (attrs.match(/data-kind="([^"]*)"/) || [])[1],
      periodicalId: (attrs.match(/data-periodical-id="([^"]*)"/) || [])[1],
      proxyForce: attrs.includes('data-proxy-force="true"'),
      promptName: unescapeHtml(m[2]),
      textContent: unescapeHtml(m[3])
    };
  }
  throw new Error(`no ${forced ? 'forced' : 'plain'} container for ${PERIODICAL_ID}`);
}

/** What public/app.js's dispatch handler + window.dispatchPrompt post for that container (issueless). */
function clientPayload(container) {
  const payload = { prompt: stripCodeBlockFences(container.textContent), promptName: container.promptName, target: 'cli' };
  if (container.proxyForce) payload.attachProxy = true;
  if (container.kind) payload.kind = container.kind;
  if (container.periodicalId) payload.periodicalId = container.periodicalId;
  return payload;
}

describe('LIN-3136 M2b — the periodical "+ Autopilot" dispatch', () => {
  test('the rendered "+ Autopilot" container carries the server-owned tail', () => {
    const c = renderedContainer({ forced: true });
    assert.ok(clientPayload(c).prompt.includes(PERIODICAL_AUTOPILOT_TAIL));
    assert.ok(!clientPayload(renderedContainer({ forced: false })).prompt.includes(PERIODICAL_AUTOPILOT_TAIL));
  });

  test('owner "+ Autopilot" → site M2, the bootstrap exchanges to [dispatch]', async () => {
    const w = world();
    await assertDeclared(w, await post(w.app, clientPayload(renderedContainer({ forced: true }))), { prose: true });
  });

  test('plain Mint stays a grant-less leaf (even when force-attached)', async () => {
    const w = world();
    const plain = clientPayload(renderedContainer({ forced: false }));
    assertLeaf(w, await post(w.app, { ...plain, attachProxy: true }));
  });

  test('a non-owner "+ Autopilot" → 403 GRANT_OWNER_ONLY, nothing enqueued', async () => {
    const w = world();
    w.state.owners[WS] = 'account-B';
    const res = await post(w.app, clientPayload(renderedContainer({ forced: true })));
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(w.items.length, 0);
  });

  test('the tail without a periodicalId stays grant-less', async () => {
    const w = world();
    const { periodicalId, ...rest } = clientPayload(renderedContainer({ forced: true }));
    assert.ok(periodicalId);
    assertLeaf(w, await post(w.app, rest));
  });
});

describe('LIN-3136 M2 — leaves stay grant-less', () => {
  test('a non-autopilot kind with attachProxy', async () => {
    const w = world();
    assertLeaf(w, await post(w.app, { ...AUTOPILOT, kind: 'implementation' }));
    assert.equal(w.spy.plain.length, 1, 'the ordinary grant-less mint');
  });

  test('an autopilot dispatch without attachProxy mints nothing', async () => {
    const w = world();
    const { attachProxy, ...unforced } = AUTOPILOT;
    assertLeaf(w, await post(w.app, unforced));
    assert.equal(w.spy.plain.length, 0);
  });
});
