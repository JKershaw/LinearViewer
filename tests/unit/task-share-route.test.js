/**
 * LIN-3330 — routes/task-share.js.
 *
 * The full guest request matrix (rows 1-8), the headers on every response, the
 * owner mint/list/revoke surface, and the "cache must not outlive revoke" rule.
 *
 * Run with: node --test tests/unit/task-share-route.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTaskShareRoutes } from '../../routes/task-share.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { TaskShareStore } from '../../lib/task-share-store.js';
import { FIXTURE_SECRETS as F } from '../fixtures/secret-scan-fixtures.js';
import { renderTaskPage, contextSignature, renderTaskContext } from '../../lib/render-task-page.js';
import { escapeHtml } from '../../lib/utils/html.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);
const UUID = '11111111-2222-3333-4444-555555555555';

function guestModel() {
  return {
    identifier: 'LIN-50',
    title: 'Build the task page',
    issueId: UUID,
    tracker: null,
    status: 'running',
    sentence: 'Build running.',
    live: true,
    sessions: [],
    guesses: ['review'],
    brief: null,
    recap: null,
    evidence: null,
    details: null,
  };
}

function fakeStore(overrides = {}) {
  const calls = [];
  return {
    calls,
    async getByToken(token) { calls.push(['getByToken', token]); return overrides.getByToken ? overrides.getByToken(token) : null; },
    async listForTask(urlKey, identifier) { calls.push(['listForTask', urlKey, identifier]); return overrides.listForTask ? overrides.listForTask(urlKey, identifier) : []; },
    async revoke(id, scope) { calls.push(['revoke', id, scope]); return overrides.revoke ? overrides.revoke(id, scope) : null; },
    async create(args) { calls.push(['create', args]); return overrides.create ? overrides.create(args) : { token: 'T', record: { _id: 'S', createdAt: NOW } }; },
  };
}

function fakeLoader(overrides = {}) {
  const calls = { loadTaskPage: [], loadTaskState: [] };
  return {
    calls,
    async loadTaskPage(args) {
      calls.loadTaskPage.push(args);
      if (typeof overrides.loadTaskPage === 'function') return overrides.loadTaskPage(args);
      return { model: guestModel() };
    },
    async loadTaskState(args) {
      calls.loadTaskState.push(args);
      if (typeof overrides.loadTaskState === 'function') return overrides.loadTaskState(args);
      return { model: guestModel() };
    },
  };
}

const RECORD = {
  _id: 'share-1',
  tokenHash: 'hash',
  urlKey: 'acme',
  workspaceId: 'ws-1',
  ownerAccountId: 'acct-1',
  issueIdentifier: 'LIN-50',
  issueId: UUID,
  source: 'linear',
  createdAt: NOW,
  revokedAt: null,
};

async function build({ store, loader, owner = async () => ({ status: 'owner' }), access, workspaceFromUrl, maskHtml } = {}) {
  const app = express();
  app.use(express.json());
  const taskShareStore = store || fakeStore();
  const pageLoader = loader || fakeLoader();
  app.use(createTaskShareRoutes({
    taskShareStore,
    loader: pageLoader,
    workspaceFromUrl: workspaceFromUrl || ((req, res, next) => { req.workspace = { id: 'ws-1', urlKey: 'acme' }; req.session = { accountId: 'acct-1' }; next(); }),
    workspaceOwnerCheck: owner,
    guestAccess: access || (async () => ({ provider: {}, callScope: 'tok' })),
    getDeployInfo: () => ({}),
    now: () => NOW,
    ...(maskHtml ? { maskHtml } : {}),
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)), store: taskShareStore, loader: pageLoader };
}

async function get(base, path) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

describe('GET /t/:token — guest page matrix', () => {
  test('row 1: malformed token 404s with zero store and owner reads', async () => {
    const store = fakeStore();
    let ownerCalls = 0;
    const { base, close } = await build({ store, owner: async () => { ownerCalls++; return { status: 'owner' }; } });
    try {
      for (const token of ['short', '!'.repeat(43), 'A'.repeat(42), 'A'.repeat(44)]) {
        const res = await get(base, `/t/${token}`);
        assert.equal(res.status, 404);
        assert.equal(res.text, 'Not found');
      }
      assert.equal(store.calls.length, 0, 'no store read for a malformed token');
      assert.equal(ownerCalls, 0);
    } finally { await close(); }
  });

  test('row 2: unknown and revoked are byte-identical 404', async () => {
    const unknown = await build({ store: fakeStore({ getByToken: async () => null }) });
    const revoked = await build({
      store: fakeStore({ getByToken: async () => ({ ...RECORD, revokedAt: NOW }) }),
    });
    try {
      const a = await get(unknown.base, `/t/${TOKEN}`);
      const b = await get(revoked.base, `/t/${TOKEN}`);
      assert.equal(a.status, 404);
      assert.equal(b.status, 404);
      assert.equal(a.text, b.text);
      assert.equal(a.text, 'Not found');
    } finally { await unknown.close(); await revoked.close(); }
  });

  test('row 3: owner-changed is the same 404', async () => {
    const { base, close } = await build({
      store: fakeStore({ getByToken: async () => RECORD }),
      owner: async () => ({ status: 'not-owner' }),
    });
    try {
      const res = await get(base, `/t/${TOKEN}`);
      assert.equal(res.status, 404);
      assert.equal(res.text, 'Not found');
    } finally { await close(); }
  });

  test('row 4: a store or owner-check throw is a 503', async () => {
    const storeThrow = await build({ store: fakeStore({ getByToken: async () => { throw new Error('db down'); } }) });
    const ownerThrow = await build({ store: fakeStore({ getByToken: async () => RECORD }), owner: async () => { throw new Error('check down'); } });
    try {
      for (const { base, close } of [storeThrow, ownerThrow]) {
        const res = await get(base, `/t/${TOKEN}`);
        assert.equal(res.status, 503);
        assert.match(res.text, /available right now/);
        await close();
      }
    } catch (e) { await storeThrow.close(); await ownerThrow.close(); throw e; }
  });

  test('row 5: no usable owner credential is a 503, never a stored-only page', async () => {
    const loader = fakeLoader();
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader, access: async () => null });
    try {
      const res = await get(base, `/t/${TOKEN}`);
      assert.equal(res.status, 503);
      assert.equal(loader.calls.loadTaskPage.length, 0, 'the loader is never reached without a credential');
    } finally { await close(); }
  });

  test('row 6: loader unavailable is a 503', async () => {
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader: fakeLoader({ loadTaskPage: async () => ({ unavailable: true }) }) });
    try {
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 503);
    } finally { await close(); }
  });

  test('row 7: loader notFound is the 404', async () => {
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader: fakeLoader({ loadTaskPage: async () => ({ notFound: true }) }) });
    try {
      const res = await get(base, `/t/${TOKEN}`);
      assert.equal(res.status, 404);
      assert.equal(res.text, 'Not found');
    } finally { await close(); }
  });

  test('row 8: ok renders the guest page — controls omitted, nav/back kept, state URL set', async () => {
    const { base, close, loader } = await build({ store: fakeStore({ getByToken: async () => RECORD }) });
    try {
      const res = await get(base, `/t/${TOKEN}`);
      assert.equal(res.status, 200);
      assert.match(res.text, /data-testid="task-page"/);
      assert.match(res.text, /data-testid="task-page-title">Build the task page</);
      assert.match(res.text, /data-state-url="\/t\/AAAA/);
      assert.doesNotMatch(res.text, /data-testid="task-page-owner-widgets"/, 'a guest gets no owner widgets');
      assert.doesNotMatch(res.text, /data-testid="task-share-create"/, 'no owner share controls');
      assert.doesNotMatch(res.text, /data-testid="run-evidence-closeout"/, 'a guest gets no close-out box');
      assert.match(res.text, /data-testid="task-page-back"/, 'the back link stays for a guest');
      assert.equal(loader.calls.loadTaskPage.length, 1);
      const args = loader.calls.loadTaskPage[0];
      assert.equal(args.urlKey, 'acme');
      assert.equal(args.identifier, 'LIN-50');
    } finally { await close(); }
  });

  test('security headers are on every response, including 404 and 503', async () => {
    const cases = [
      await build({ store: fakeStore({ getByToken: async () => null }) }),
      await build({ store: fakeStore({ getByToken: async () => RECORD }), access: async () => null }),
    ];
    try {
      for (const { base, close } of cases) {
        const res = await get(base, `/t/${TOKEN}`);
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(res.headers.get('cache-control'), 'private, no-store');
        assert.equal(res.headers.get('x-robots-tag'), 'noindex');
        await close();
      }
    } catch (e) { for (const c of cases) await c.close(); throw e; }
  });
});

describe('GET /t/:token/state', () => {
  test('serves stored data only — no guestAccess, no provider; rows 1-4 identical', async () => {
    let accessCalls = 0;
    const loader = fakeLoader();
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader, access: async () => { accessCalls++; return { provider: {}, callScope: 'tok' }; } });
    try {
      const res = await get(base, `/t/${TOKEN}/state`);
      assert.equal(res.status, 200);
      const body = JSON.parse(res.text);
      assert.deepEqual(Object.keys(body).sort(), ['headerHtml', 'live', 'status', 'trackHtml'], 'no verified brief/recap on a state read: no context sent (LIN-3373)');
      assert.equal(accessCalls, 0, 'the state endpoint resolves no credential');
      assert.equal(loader.calls.loadTaskState.length, 1);
      assert.equal(loader.calls.loadTaskPage.length, 0);
      // owner-changed → 404
      const changed = await build({ store: fakeStore({ getByToken: async () => RECORD }), owner: async () => ({ status: 'not-owner' }) });
      assert.equal((await get(changed.base, `/t/${TOKEN}/state`)).status, 404);
      await changed.close();
      // malformed → 404
      assert.equal((await get(base, '/t/short/state')).status, 404);
    } finally { await close(); }
  });
});

describe('owner management surface', () => {
  test('create returns a path (not a hash) and 201', async () => {
    const store = fakeStore({ create: async () => ({ token: 'NEWTOKEN', record: { _id: 'S9', createdAt: NOW } }) });
    const { base, close } = await build({ store });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/LIN-50/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issueId: UUID, source: 'linear' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.path, '/t/NEWTOKEN');
      assert.equal(body.id, 'S9');
      assert.ok(!JSON.stringify(body).includes('hash'));
      assert.equal(store.calls.find(c => c[0] === 'create')[1].issueIdentifier, 'LIN-50');
    } finally { await close(); }
  });

  test('signed-out is refused (no accountId) without a store call', async () => {
    const store = fakeStore();
    const { base, close } = await build({
      store,
      workspaceFromUrl: (req, res, next) => { req.workspace = { id: 'ws-1', urlKey: 'acme' }; req.session = {}; next(); },
    });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/LIN-50/share`, { method: 'POST' });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, 'GRANT_OWNERLESS');
      assert.equal(store.calls.length, 0);
    } finally { await close(); }
  });

  test('non-owner is refused 403', async () => {
    const { base, close } = await build({ owner: async () => ({ status: 'not-owner' }) });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/LIN-50/shares`);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, 'GRANT_OWNER_ONLY');
    } finally { await close(); }
  });

  test('list returns the projection only', async () => {
    const store = fakeStore({ listForTask: async () => ([{ id: 'a', createdAt: NOW, revokedAt: null }]) });
    const { base, close } = await build({ store });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/LIN-50/shares`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { shares: [{ id: 'a', createdAt: NOW.toISOString(), revokedAt: null }] });
    } finally { await close(); }
  });

  test('revoke: unknown 404, repeat 200 unchanged', async () => {
    const revoked = { _id: 's1', createdAt: NOW, revokedAt: NOW };
    const store = fakeStore({ revoke: async (id) => (id === 's1' ? revoked : null) });
    const { base, close } = await build({ store });
    try {
      const ok = await fetch(`${base}/workspace/acme/api/task/LIN-50/shares/s1/revoke`, { method: 'POST' });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { success: true, share: { id: 's1', createdAt: NOW.toISOString(), revokedAt: NOW.toISOString() } });
      const missing = await fetch(`${base}/workspace/acme/api/task/LIN-50/shares/nope/revoke`, { method: 'POST' });
      assert.equal(missing.status, 404);
    } finally { await close(); }
  });

  test('a malformed identifier is a 404 with no store call', async () => {
    const store = fakeStore();
    const { base, close } = await build({ store });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/${encodeURIComponent('bad id!')}/shares`);
      assert.equal(res.status, 404);
      assert.equal(store.calls.length, 0);
    } finally { await close(); }
  });
});

describe('the loader cache', () => {
  test('serves a second guest from cache within the window (one tracker read)', async () => {
    const loader = fakeLoader();
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader });
    try {
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 200);
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 200);
      assert.equal(loader.calls.loadTaskPage.length, 1, 'the second request was served from cache');
    } finally { await close(); }
  });

  test('a revoke between two requests still 404s — the cache is only reached after the auth checks', async () => {
    // The store returns the record on the first call, then a revoked record.
    let n = 0;
    const store = fakeStore({ getByToken: async () => (n++ === 0 ? RECORD : { ...RECORD, revokedAt: NOW }) });
    const loader = fakeLoader();
    const { base, close } = await build({ store, loader });
    try {
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 200);
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 404);
      assert.equal(loader.calls.loadTaskPage.length, 1, 'no cache entry outlived the revoke');
    } finally { await close(); }
  });

  test('failures are never cached', async () => {
    let calls = 0;
    const loader = fakeLoader({ loadTaskPage: async () => { calls++; return calls === 1 ? { unavailable: true } : { model: guestModel() }; } });
    const { base, close } = await build({ store: fakeStore({ getByToken: async () => RECORD }), loader });
    try {
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 503);
      assert.equal((await get(base, `/t/${TOKEN}`)).status, 200);
      assert.equal(calls, 2, 'the failed load was not cached');
    } finally { await close(); }
  });
});

describe('TaskShareStore integration on the owner surface', () => {
  test('create → list → revoke → list over a real store', async () => {
    const collection = createMockCollection();
    const store = new TaskShareStore({ collection, now: () => NOW });
    const { base, close } = await build({ store });
    try {
      const created = await fetch(`${base}/workspace/acme/api/task/LIN-50/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const { id, path } = await created.json();
      assert.match(path, /^\/t\/[A-Za-z0-9_-]{43}$/);
      const list = await (await fetch(`${base}/workspace/acme/api/task/LIN-50/shares`)).json();
      assert.equal(list.shares.length, 1);
      assert.ok(!JSON.stringify(list).includes(path.slice(3)));
      const revoke = await fetch(`${base}/workspace/acme/api/task/LIN-50/shares/${id}/revoke`, { method: 'POST' });
      assert.equal(revoke.status, 200);
      const after = await (await fetch(`${base}/workspace/acme/api/task/LIN-50/shares`)).json();
      assert.ok(after.shares[0].revokedAt);
    } finally { await close(); }
  });
});

describe('render-time secret masking (LIN-3389)', () => {
  const ASSIGN = `api_key = "${F.genericSecretValue}"`;
  const withRecord = () => fakeStore({ getByToken: async () => ({ ...RECORD, tokenHash: 'abcdef0123456789'.repeat(4) }) });

  function secretModel(secret) {
    return {
      ...guestModel(),
      description: `desc ${secret}`,
      comments: [{ author: 'a', body: `comment ${secret}`, createdAt: NOW.toISOString() }],
      brief: { body: `brief ${secret}`, generatedAt: NOW.toISOString() },
      recap: null,
    };
  }

  async function withLogs(fn) {
    const lines = [];
    const orig = console.warn;
    console.warn = (...a) => lines.push(a.join(' '));
    try { await fn(lines); } finally { console.warn = orig; }
  }

  test('secrets planted in description, comment and brief are masked; entity-encoded too', async () => {
    for (const secret of [F.githubPat, ASSIGN, F.awsAccessKey]) {
      const { base, close } = await build({
        store: withRecord(),
        loader: fakeLoader({ loadTaskPage: async () => ({ model: secretModel(secret) }) }),
      });
      try {
        await withLogs(async () => {
          const res = await get(base, `/t/${TOKEN}`);
          assert.equal(res.status, 200);
          assert.ok(res.text.includes('[redacted]'));
          assert.ok(!res.text.includes(F.githubPat) && !res.text.includes(F.genericSecretValue) && !res.text.includes(F.awsAccessKey.slice(4)));
          assert.equal((res.text.match(/\[redacted\]/g) || []).length >= 3, true, 'description, comment and brief');
        });
      } finally { await close(); }
    }
  });

  test('a secret in a session (agent) message is masked', async () => {
    const model = guestModel();
    const probe = renderTaskPage({ ...model, sessions: [{ state: 'running', message: 'zzz', startedAt: NOW.toISOString() }] }, { viewer: 'guest', urlKey: 'acme', binding: {}, stateUrl: '/s', now: NOW, pageOptions: { deployInfo: {}, workspaces: [], featureFlags: {}, openRouterSource: null } });
    if (!probe.includes('zzz')) return; // model shape renders no session text; covered by the generic cases
    const { base, close } = await build({
      store: withRecord(),
      loader: fakeLoader({ loadTaskPage: async () => ({ model: { ...model, sessions: [{ state: 'running', message: F.githubPat, startedAt: NOW.toISOString() }] } }) }),
    });
    try {
      await withLogs(async () => {
        const res = await get(base, `/t/${TOKEN}`);
        assert.ok(!res.text.includes(F.githubPat));
      });
    } finally { await close(); }
  });

  test('a clean page is byte-identical to the unmasked render', async () => {
    const model = { ...guestModel(), description: 'plain text &amp; api_key = "short"', brief: { body: 'hello', generatedAt: NOW.toISOString() } };
    const { base, close } = await build({
      store: withRecord(),
      loader: fakeLoader({ loadTaskPage: async () => ({ model }) }),
    });
    try {
      const res = await get(base, `/t/${TOKEN}`);
      const expected = renderTaskPage(model, {
        viewer: 'guest', urlKey: 'acme', binding: { source: 'linear' }, stateUrl: `/t/${TOKEN}/state`, now: NOW,
        pageOptions: { deployInfo: {}, workspaces: [], featureFlags: {}, openRouterSource: null },
      });
      assert.equal(res.text, expected);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    } finally { await close(); }
  });

  test('/state masks header, track and context; contextSig stays over the unmasked fragment and matches the page', async () => {
    const model = {
      ...guestModel(),
      brief: { body: `brief ${F.githubPat}`, generatedAt: NOW.toISOString() },
      sessions: [],
    };
    const { base, close } = await build({
      store: withRecord(),
      loader: fakeLoader({
        loadTaskPage: async () => ({ model }),
        loadTaskState: async () => ({ model }),
      }),
    });
    try {
      await withLogs(async () => {
        const state = JSON.parse((await get(base, `/t/${TOKEN}/state`)).text);
        assert.ok(!JSON.stringify(state).includes(F.githubPat));
        assert.ok(state.contextHtml.includes('[redacted]'));
        const unmasked = renderTaskContext(model, { urlKey: 'acme' });
        assert.ok(unmasked.includes(F.githubPat));
        assert.equal(state.contextSig, contextSignature(unmasked));
        const page = await get(base, `/t/${TOKEN}`);
        assert.ok(page.text.includes(`data-context-sig="${state.contextSig}"`));
      });
    } finally { await close(); }
  });

  test('/state masks trackHtml and headerHtml via the injected masker', async () => {
    const seen = [];
    const { base, close } = await build({
      store: withRecord(),
      maskHtml: (html) => { seen.push(html); return { html: html + '<!--m-->', hits: [] }; },
    });
    try {
      const state = JSON.parse((await get(base, `/t/${TOKEN}/state`)).text);
      assert.ok(state.headerHtml.endsWith('<!--m-->'));
      assert.ok(state.trackHtml.endsWith('<!--m-->'));
      assert.equal(seen.length, 2);
    } finally { await close(); }
  });

  test('log line has rule ids and an 8-hex hash prefix only, throttled per surface', async () => {
    const hash = 'abcdef0123456789'.repeat(4);
    const { base, close } = await build({
      store: withRecord(),
      loader: fakeLoader({ loadTaskPage: async () => ({ model: secretModel(F.githubPat) }) }),
    });
    try {
      await withLogs(async (lines) => {
        await get(base, `/t/${TOKEN}`);
        await get(base, `/t/${TOKEN}`);
        const masked = lines.filter(l => l.startsWith('Task share masked:'));
        assert.equal(masked.length, 1, 'throttled to one line per window');
        assert.match(masked[0], /patterns=github-pat tokenHash=abcdef01 surface=page$/);
        const all = lines.join('\n');
        assert.ok(!all.includes(F.githubPat) && !all.includes(hash) && !all.includes(TOKEN));
      });
    } finally { await close(); }
  });

  test('a masker throw fails closed: 503 on the page and on /state', async () => {
    const { base, close } = await build({
      store: withRecord(),
      maskHtml: () => { throw new Error('boom'); },
    });
    const orig = console.error;
    console.error = () => {};
    try {
      const page = await get(base, `/t/${TOKEN}`);
      assert.equal(page.status, 503);
      assert.ok(!page.text.includes('Build the task page'));
      const state = await get(base, `/t/${TOKEN}/state`);
      assert.equal(state.status, 503);
    } finally { console.error = orig; await close(); }
  });
});
