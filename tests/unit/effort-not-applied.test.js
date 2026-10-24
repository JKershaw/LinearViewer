/**
 * LIN-3857 (D3): an effort is never dropped silently. Where the harness in force has no
 * effort control (opencode), the effort that RUNS is null and the one that was asked for is
 * REPORTED, at every surface that shows or accepts an agent-session effort:
 *
 *   1. the dispatch stamp (`resolveRouting` / `createDispatchItem`), with the tier it came from
 *   2. the dispatch receipts (`POST /api/proxy/dispatch`)
 *   3. `GET /api/proxy/model-routing` (what runs; the stored value rides `effortNotApplied`)
 *   4. the model-routing proxy writes (accepted, flagged)
 *   5. the dispatch preset create/update responses
 *   6. the dispatch page prefill
 *
 * The resolvers (`resolveFields` and what is built on it) stay value-faithful and ungated, so a
 * preset/anchor effort is still there to report (plan review B1); the last test guards that.
 *
 * Run with: node --test tests/unit/effort-not-applied.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchPresetsStore } from '../../lib/dispatch-presets-store.js';
import { createDispatchItem, resolveRouting } from '../../lib/dispatch-factory.js';
import {
  effectiveTable, effortAppliesTo, effortNotAppliedForChanges, effortNotAppliedForRow, prefillDefaults,
  resolveFields, resolveAgentFromTable, emptyTable, applyChangesToTable
} from '../../lib/model-routing.js';
import { effortNotAppliedForConfig, resolveRoutingFromConfig } from '../../lib/workspace-preferences.js';
import { setWorkspaceFeature } from '../../lib/workspace-preferences.js';
import { WORKSPACE_FEATURES } from '../../lib/feature-defaults.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { ACME, BASE_DEPS, buildApp as buildBaseApp, call } from './lib/proxy-fake-deps.js';
import { routingFixture } from './helpers/routing-fakes.js';

const prefsWith = async (dispatchDefaults) => {
  const fx = routingFixture();
  await fx.prefs.insertOne({ _id: 'acme', preferences: { dispatchDefaults } });
  return fx.preferencesStore;
};

describe('the predicate', () => {
  test('opencode does not apply effort; claude-code, a blank harness and an unknown one do', () => {
    assert.equal(effortAppliesTo('opencode'), false);
    for (const h of ['claude-code', '', null, undefined, 'scripted']) assert.equal(effortAppliesTo(h), true, String(h));
  });
  test('effortNotAppliedForRow names the stored value and the harness, only when there is an effort to drop', () => {
    assert.deepEqual(effortNotAppliedForRow({ harness: 'opencode', effort: 'high' }), { stored: 'high', harness: 'opencode' });
    assert.equal(effortNotAppliedForRow({ harness: 'opencode', effort: null }), null);
    assert.equal(effortNotAppliedForRow({ harness: 'claude-code', effort: 'high' }), null);
    assert.equal(effortNotAppliedForRow(null), null);
  });
});

describe('Surface 1: the dispatch stamp (resolveRouting / createDispatchItem)', () => {
  const route = (args) => resolveRouting({ urlKey: 'acme', kind: 'implementation', ...args });

  test('an explicit effort on an opencode dispatch is stamped null and reported with layer explicit', async () => {
    const r = await route({ harness: 'opencode', effort: 'high' });
    assert.equal(r.effort, null);
    assert.deepEqual(r.effortNotApplied, { requested: 'high', harness: 'opencode', layer: 'explicit' });
  });

  test('a preset effort is reported with layer preset (the value is read before any gate)', async () => {
    const r = await route({ preset: { config: { harness: 'opencode', effort: 'p-eff' } } });
    assert.equal(r.effort, null);
    assert.deepEqual(r.effortNotApplied, { requested: 'p-eff', harness: 'opencode', layer: 'preset' });
  });

  test('an anchor preset effort is reported with layer anchor, including the cell the plan review found', async () => {
    const r = await route({ preset: { config: { model: 'p-model', harness: 'opencode' } }, anchor: { harness: 'claude-code', presetConfig: { effort: 'a-eff' } } });
    assert.equal(r.harness, 'opencode');
    assert.equal(r.effort, null);
    assert.deepEqual(r.effortNotApplied, { requested: 'a-eff', harness: 'opencode', layer: 'anchor' });
  });

  test('a workspace row effort is reported with layer workspace', async () => {
    const store = await prefsWith({ harness: 'opencode', effort: 'ws-eff' });
    const r = await route({ workspacePreferencesStore: store });
    assert.equal(r.effort, null);
    assert.deepEqual(r.effortNotApplied, { requested: 'ws-eff', harness: 'opencode', layer: 'workspace' });
  });

  test('a default harness of opencode (blank dispatch) drops and reports too', async () => {
    const store = await prefsWith({ effort: 'ws-eff' });
    const r = await route({ workspacePreferencesStore: store, harness: 'opencode' });
    assert.equal(r.effortNotApplied.layer, 'workspace');
  });

  test('claude-code and blank-harness dispatches keep their effort and carry no key', async () => {
    for (const args of [{ harness: 'claude-code', effort: 'high' }, { effort: 'high' }, { harness: 'claude-code' }]) {
      const r = await route(args);
      assert.equal(r.effort, args.effort ?? null, JSON.stringify(args));
      assert.equal('effortNotApplied' in r, false, JSON.stringify(args));
    }
  });

  test('a blank harness that the default-harness interpose lands on claude-code keeps its effort', async () => {
    const r = await route({ effort: 'high', applyDefaultHarness: true });
    assert.equal(r.harness, 'claude-code');
    assert.equal(r.effort, 'high');
    assert.equal('effortNotApplied' in r, false);
  });

  test('createDispatchItem stamps null and attaches the report to the returned item, not to the stored row', async () => {
    const captured = {};
    const store = { addItem: async (urlKey, item) => { captured.item = item; return { _id: 'i1', ...item }; } };
    const item = await createDispatchItem({ store, urlKey: 'acme', kind: 'implementation', prompt: 'x', harness: 'opencode', effort: 'high' });
    assert.equal(captured.item.effort, null);
    assert.equal('effortNotApplied' in captured.item, false);
    assert.deepEqual(item.effortNotApplied, { requested: 'high', harness: 'opencode', layer: 'explicit' });
  });
});

describe('Surface 2: the dispatch receipts', () => {
  function app(captured) {
    const a = express();
    a.use(express.json());
    a.use(createProxyRoutes({
      proxyTokenStore: {
        createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
        validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore: { addItem: async (urlKey, item) => { captured.item = item; return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; } },
      workspaceFromUrl: (req, res, next) => next(),
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    return a;
  }
  const post = async (body) => {
    const captured = {};
    const server = app(captured).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/dispatch`, {
        method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json(), captured };
    } finally { await new Promise((r) => server.close(r)); }
  };

  test('the proxy receipt reports the dropped effort, and the stored row carries null', async () => {
    const res = await post({ prompt: 'run me', harness: 'opencode', effort: 'high' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.effortNotApplied, { requested: 'high', harness: 'opencode', layer: 'explicit' });
    assert.equal(res.captured.item.effort, null);
  });

  test('the receipt omits the key when nothing was dropped', async () => {
    const res = await post({ prompt: 'run me', harness: 'claude-code', effort: 'high' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal('effortNotApplied' in res.body, false);
    assert.equal(res.captured.item.effort, 'high');
  });
});

describe('Surface 3: effectiveTable (GET /model-routing)', () => {
  const tableWith = (changes) => applyChangesToTable(emptyTable(), changes.map((c) => ({ surface: 'agent-session', ...c })));
  const jobOf = (table, id) => effectiveTable(table, { defaultModel: DEFAULT_MODEL }).jobs.find((j) => j.id === id);

  test('an opencode job shows null effort, the unchanged source, and the stored value as not applied', () => {
    const table = tableWith([{ scope: 'job', key: 'review', field: 'harness', to: 'opencode' }, { scope: 'job', key: 'review', field: 'effort', to: 'high' }]);
    const job = jobOf(table, 'review');
    assert.equal(job.effort, null);
    assert.equal(job.source.effort, 'job');
    assert.deepEqual(job.effortNotApplied, { stored: 'high', harness: 'opencode' });
  });

  test('a group-sourced effort keeps source group', () => {
    const table = tableWith([{ scope: 'group', key: 'judge', field: 'harness', to: 'opencode' }, { scope: 'group', key: 'judge', field: 'effort', to: 'low' }]);
    const job = jobOf(table, 'review');
    assert.equal(job.effort, null);
    assert.equal(job.source.effort, 'group');
    assert.deepEqual(job.effortNotApplied, { stored: 'low', harness: 'opencode' });
  });

  test('a claude-code job is untouched and carries no key', () => {
    const table = tableWith([{ scope: 'job', key: 'review', field: 'harness', to: 'claude-code' }, { scope: 'job', key: 'review', field: 'effort', to: 'high' }]);
    const job = jobOf(table, 'review');
    assert.equal(job.effort, 'high');
    assert.equal('effortNotApplied' in job, false);
  });
});

describe('Surface 4: the model-routing proxy writes are accepted and flagged', () => {
  let fx;
  const BASE = '/api/proxy/model-routing';
  const token = BASE_DEPS().proxyTokenStore;
  const build = () => buildBaseApp({
    proxyTokenStore: { ...token, validateToken: async () => ({ tokenId: 'tok-1', urlKey: ACME, label: 'l', scope: 'readWrite', createdBy: 'acct-9', workspaceId: 'ws-acme' }) },
    modelRoutingStore: fx.routingStore,
    workspacePreferencesStore: fx.preferencesStore
  });
  const post = (path, body) => call(build(), 'POST', `${BASE}${path}`, { body });

  beforeEach(async () => {
    fx = routingFixture();
    await setWorkspaceFeature({ urlKey: ACME, featureKey: WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES, enabled: true, store: fx.preferencesStore });
  });

  test('setting an effort on an opencode job is accepted and the response flags it', async () => {
    await post('/jobs/review', { reason: 'r', harness: 'opencode' });
    const res = await post('/jobs/review', { reason: 'r', effort: 'high' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.effortNotApplied, [{ job: 'review', stored: 'high', harness: 'opencode' }]);
  });

  test('setting the harness to opencode over a stored effort flags it (the order set-effort-then-harness stays legal)', async () => {
    assert.equal((await post('/jobs/review', { reason: 'r', effort: 'high' })).body.effortNotApplied, undefined);
    const res = await post('/jobs/review', { reason: 'r', harness: 'opencode' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.effortNotApplied, [{ job: 'review', stored: 'high', harness: 'opencode' }]);
  });

  test('a claude-code job and a model-only change carry no flag', async () => {
    const res = await post('/jobs/review', { reason: 'r', harness: 'claude-code', effort: 'high' });
    assert.equal(res.status, 200);
    assert.equal('effortNotApplied' in res.body, false);
    assert.equal('effortNotApplied' in (await post('/jobs/review', { reason: 'r', model: 'opus' })).body, false);
  });

  test('a group write flags only that group\'s jobs that now carry an ignored effort', async () => {
    const res = await post('/groups/judge', { reason: 'r', surface: 'agent-session', harness: 'opencode', effort: 'low' });
    assert.equal(res.status, 200);
    const jobs = res.body.effortNotApplied.map((e) => e.job);
    assert.ok(jobs.includes('review'));
    assert.ok(res.body.effortNotApplied.every((e) => e.stored === 'low' && e.harness === 'opencode'));
  });

  test('undo of a harness change to opencode restores the harness and drops the flag', async () => {
    await post('/jobs/review', { reason: 'r', effort: 'high' });
    const set = await post('/jobs/review', { reason: 'r', harness: 'opencode' });
    const undo = await post(`/log/${set.body.entry._id || set.body.entry.id}/undo`, { reason: 'undo' });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal('effortNotApplied' in undo.body, false);
  });

  test('effortNotAppliedForChanges reports a default change as its own default row, not as registry jobs', () => {
    const table = applyChangesToTable(emptyTable(), [
      { surface: 'agent-session', scope: 'default', key: 'default', field: 'harness', to: 'opencode' },
      { surface: 'agent-session', scope: 'default', key: 'default', field: 'effort', to: 'high' }
    ]);
    const flags = effortNotAppliedForChanges(table, [{ surface: 'agent-session', scope: 'default', key: 'default', field: 'effort', from: null, to: 'high' }]);
    assert.deepEqual(flags, [{ job: null, scope: 'default', stored: 'high', harness: 'opencode' }]);
  });
});

describe('Surface 5: dispatch preset create/update responses', () => {
  function docs() {
    const rows = [];
    return {
      async findOne(q) { return rows.find((d) => d._id === q._id && (q.urlKey === undefined || d.urlKey === q.urlKey)) || null; },
      async updateOne(q, u, o = {}) {
        let doc = rows.find((d) => d._id === q._id && (q.urlKey === undefined || d.urlKey === q.urlKey));
        if (!doc) { if (!o.upsert) return { matchedCount: 0 }; doc = { _id: q._id, ...(u.$setOnInsert || {}) }; rows.push(doc); }
        Object.assign(doc, u.$set || {});
        return { matchedCount: 1 };
      },
      find(q = {}) { return { async toArray() { return rows.filter((d) => q.urlKey === undefined || d.urlKey === q.urlKey); } }; },
      async insertOne(d) { rows.push(d); return { insertedId: d._id }; },
      async deleteOne() { return { deletedCount: 0 }; }
    };
  }
  async function send(app, method, path, body) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    } finally { await new Promise((r) => server.close(r)); }
  }
  const build = (dispatchPresetsStore) => {
    const a = express();
    a.use(express.json());
    a.use(createDispatchRoutes({
      dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; req.session = { linearUserId: 'u1' }; next(); },
      userPreferencesStore: {}, harbourFeedbackTokenStore: null, workspacePreferencesStore: null, dispatchPresetsStore
    }));
    return a;
  };
  const BASE = '/workspace/acme/api/dispatch/presets';

  test('create flags an opencode+effort config, including a byKind row', async () => {
    const app = build(new DispatchPresetsStore({ collection: docs() }));
    const top = await send(app, 'POST', BASE, { name: 'P', harness: 'opencode', effort: 'high' });
    assert.equal(top.status, 201);
    assert.deepEqual(top.body.effortNotApplied, [{ kind: null, requested: 'high', harness: 'opencode' }]);
    const kind = await send(app, 'POST', BASE, { name: 'Q', harness: 'claude-code', byKind: { review: { harness: 'opencode', effort: 'low' } } });
    assert.equal(kind.status, 201, JSON.stringify(kind.body));
    assert.deepEqual(kind.body.effortNotApplied, [{ kind: 'review', requested: 'low', harness: 'opencode' }]);
  });

  test('create omits the key for claude-code, and update flags then clears it', async () => {
    const app = build(new DispatchPresetsStore({ collection: docs() }));
    const ok = await send(app, 'POST', BASE, { name: 'P', harness: 'claude-code', effort: 'high' });
    assert.equal('effortNotApplied' in ok.body, false);
    const id = ok.body.preset._id || ok.body.preset.id;
    const flagged = await send(app, 'PATCH', `${BASE}/${id}`, { harness: 'opencode', effort: 'high' });
    assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
    assert.deepEqual(flagged.body.effortNotApplied, [{ kind: null, requested: 'high', harness: 'opencode' }]);
    const cleared = await send(app, 'PATCH', `${BASE}/${id}`, { harness: 'claude-code', effort: 'high' });
    assert.equal('effortNotApplied' in cleared.body, false);
  });

  test('a config-scoped effort is judged against the harness it resolves to, not misflagged', () => {
    // top-level harness claude-code with a byKind row that names opencode only for model: effort stays claude-code's.
    const config = { harness: 'claude-code', effort: 'high', byKind: { review: { model: 'm' } } };
    assert.deepEqual(effortNotAppliedForConfig(config), []);
    assert.deepEqual(effortNotAppliedForConfig({ harness: 'opencode', effort: 'high', byKind: { review: { harness: 'claude-code' } } }), [{ kind: null, requested: 'high', harness: 'opencode' }]);
  });
});

describe('Surface 6: the dispatch page prefill', () => {
  test('the effort is nulled for an opencode default harness and kept otherwise', () => {
    assert.deepEqual(prefillDefaults({ model: 'm', harness: 'opencode', effort: 'high' }), { model: 'm', harness: 'opencode', effort: null });
    assert.deepEqual(prefillDefaults({ model: 'm', harness: 'claude-code', effort: 'high' }), { model: 'm', harness: 'claude-code', effort: 'high' });
    assert.deepEqual(prefillDefaults({ model: null, harness: null, effort: 'high' }), { model: null, harness: null, effort: 'high' });
  });
});

describe('B1 guard: the resolvers stay value-faithful and ungated', () => {
  test('resolveFields, resolveAgentFromTable and resolveRoutingFromConfig still return an effort on opencode', () => {
    assert.equal(resolveFields([{ harness: 'opencode', effort: 'high' }], { harnessInForce: 'opencode' }).effort, 'high');
    const table = applyChangesToTable(emptyTable(), [
      { surface: 'agent-session', scope: 'job', key: 'review', field: 'harness', to: 'opencode' },
      { surface: 'agent-session', scope: 'job', key: 'review', field: 'effort', to: 'high' }
    ]);
    assert.equal(resolveAgentFromTable(table, 'review', { harnessInForce: 'opencode' }).effort, 'high');
    assert.equal(resolveRoutingFromConfig({ harness: 'opencode', effort: 'high' }, null, { harnessInForce: 'opencode' }).effort, 'high');
  });
});
