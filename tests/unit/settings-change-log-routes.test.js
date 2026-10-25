/**
 * LIN-3846: everyone-changes on Settings ask why, land in the change log, and can be undone.
 * Also the owner gate on the two halt writers (running/halt and the Undo of a halt entry),
 * in the style of tests/unit/lin-3398-session-runner-gates.test.js:
 *   a member is refused 403 RUNNER_OWNER_ONLY and the halt document is untouched;
 *   the owner is allowed; an absent owner seam fails closed.
 * And: a model-routing-log entry shows in the merged Change log and is undone through the
 * real ModelRoutingStore.
 *
 * Run with: node --test tests/unit/settings-change-log-routes.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSettingsRouter } from '../../routes/settings.js';
import { WorkspaceChangeLogStore } from '../../lib/workspace-change-log.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { getWorkspaceFeatures, setWorkspaceFeature, resolveWorkspaceModel } from '../../lib/workspace-preferences.js';
import { projectLegacy, currentValue } from '../../lib/model-routing.js';
import { getProvider, getProviderForWorkspace } from '../../lib/providers/registry.js';
import '../../lib/providers/index.js';
import { memoryCollection, routingFixture } from './helpers/routing-fakes.js';

const COPY = "Only this workspace's owner can act on its runner.";
const OWNER = 'acct-owner';
const MEMBER = 'acct-member';
const ownerCheck = async ({ accountId }) => ({ status: accountId === OWNER ? 'owner' : 'not-owner' });

let server, base, fx, haltCollection, haltStore, logStore, state;

before(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const workspaceFromUrl = (req, _res, next) => {
    req.workspace = { urlKey: 'alpha', id: 'ws-alpha', name: 'Alpha', provider: 'local', bindings: [] };
    req.session = { accountId: state.accountId, workspaces: [] };
    next();
  };
  app.use((req, res, next) => {
    const deps = {
      workspaceFromUrl,
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      userPreferencesStore: { getOpenRouterConsent: async () => null },
      workspacePreferencesStore: fx.preferencesStore,
      llmCallLogStore: { summarize: async () => ({}) },
      promptTraceStore: { summarizeProviderContext: async () => ({}) },
      accountStore: { listEmailIdentities: async () => [] },
      requestFeatureFlags: async () => ({}),
      resolveWorkspaceModel,
      getWorkspaceFeatures,
      setWorkspaceFeature,
      projectLegacy,
      getModelCatalog: async () => [],
      shouldMockAi: () => true,
      AVAILABLE_MODELS: [],
      getProvider,
      getProviderForWorkspace,
      getBindingsForWorkspace: () => [],
      getBindingCredentials: () => ({}),
      isActiveBinding: () => false,
      dispatchPresetsStore: null,
      proxyTokenStore: { listTokens: async () => state.proxyRows },
      dispatchTokenStore: { listTokens: async () => state.dispatchRows },
      proxyEventStore: null,
      workspaceHaltStore: haltStore,
      workspaceChangeLogStore: logStore,
      modelRoutingStore: fx.routingStore,
      workspaceOwnerCheck: state.ownerCheck
    };
    createSettingsRouter(deps)(req, res, next);
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  fx = routingFixture();
  haltCollection = memoryCollection();
  haltStore = new WorkspaceHaltStore({ collection: haltCollection });
  logStore = new WorkspaceChangeLogStore({ collection: memoryCollection() });
  // The same wiring as server.js: every halt writer lands in the log through the store's hook.
  haltStore.setOnChange(({ urlKey, from, to, via, setBy, reason }) =>
    logStore.record({ urlKey, setting: 'halt', from, to, reason: reason || 'Changed outside Settings (Dispatch page or API)', actor: { via, ...(setBy ? { id: setBy } : {}) } }));
  state = { accountId: OWNER, ownerCheck, proxyRows: [], dispatchRows: [] };
});

const post = (path, body) => fetch(`${base}/workspace/alpha/settings/${path}`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString()
});
const haltMode = async () => (await haltCollection.findOne({ _id: 'alpha' }))?.mode || 'none';
const periodicals = async () => !!(await getWorkspaceFeatures({ urlKey: 'alpha', store: fx.preferencesStore })).periodicals;

describe('periodic reviews: for everyone, so it asks why and is logged', () => {
  test('without a reason it is a 400 and nothing changes (a tightening of the old route)', async () => {
    const res = await post('workspace-features', { feature: 'periodicals', enabled: 'true' });
    assert.equal(res.status, 400);
    assert.equal(await periodicals(), false);
    assert.equal((await logStore.getLog('alpha')).length, 0);
  });

  test('with a reason it changes the setting and logs one entry, any member may do it', async () => {
    state.accountId = MEMBER;
    const res = await post('workspace-features', { feature: 'periodicals', enabled: 'true', reason: 'We want the weekly reviews' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/running?changed=1');
    assert.equal(await periodicals(), true);
    const [entry] = await logStore.getLog('alpha');
    assert.equal(entry.setting, 'periodicals');
    assert.deepEqual([entry.from, entry.to, entry.reason], [false, true, 'We want the weekly reviews']);
    assert.deepEqual(entry.actor, { via: 'page', id: MEMBER, name: 'former member' });
  });

  test('a reason over 500 characters is refused', async () => {
    const res = await post('workspace-features', { feature: 'periodicals', enabled: 'true', reason: 'x'.repeat(501) });
    assert.equal(res.status, 400);
    assert.equal(await periodicals(), false);
  });

  test('Undo puts it back, logs an undo, and a member may do it', async () => {
    await post('workspace-features', { feature: 'periodicals', enabled: 'true', reason: 'on' });
    const [entry] = await logStore.getLog('alpha');
    state.accountId = MEMBER;
    const res = await post(`change-log/workspace/${entry._id}/undo`, { reason: 'changed my mind' });
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/change-log?undone=1');
    assert.equal(await periodicals(), false);
    const log = await logStore.getLog('alpha');
    assert.deepEqual(log.map(r => r.kind).sort(), ['change', 'undo']);
  });

  test('Undo refuses when the value has changed since, and a second Undo is refused', async () => {
    await post('workspace-features', { feature: 'periodicals', enabled: 'true', reason: 'on' });
    const [first] = await logStore.getLog('alpha');
    // The log orders by `at` (milliseconds): a second change in the same millisecond ties the first, and the
    // newest-first read then keeps insertion order. Let the clock move so "newest" means the second change.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await post('workspace-features', { feature: 'periodicals', enabled: 'false', reason: 'off again' });
    const conflict = await post(`change-log/workspace/${first._id}/undo`, { reason: 'undo the first' });
    assert.equal(conflict.headers.get('location'), '/workspace/alpha/settings/change-log?error=conflict');
    assert.equal(await periodicals(), false, 'nothing was overwritten');

    const [latest] = await logStore.getLog('alpha');
    assert.equal((await post(`change-log/workspace/${latest._id}/undo`, { reason: 'ok' })).headers.get('location'), '/workspace/alpha/settings/change-log?undone=1');
    const again = await post(`change-log/workspace/${latest._id}/undo`, { reason: 'twice' });
    assert.match(again.headers.get('location'), /error=already_undone/);
  });
});

describe('pause / stop / resume from Settings: owner-only', () => {
  const haltBody = (mode, reason = 'Deploy in progress') => ({ mode, reason });

  test('owner: pause writes the halt and logs it with the typed reason', async () => {
    const res = await post('running/halt', haltBody('pause'));
    assert.equal(res.status, 302);
    assert.equal(await haltMode(), 'pause');
    const [entry] = await logStore.getLog('alpha');
    assert.deepEqual([entry.setting, entry.from, entry.to, entry.reason], ['halt', 'none', 'pause', 'Deploy in progress']);
  });

  for (const mode of ['pause', 'stop', 'resume']) {
    test(`member: ${mode} is refused 403 RUNNER_OWNER_ONLY and the halt document is untouched`, async () => {
      state.accountId = MEMBER;
      await haltStore.setWorkspaceHalt('alpha', { mode: 'stop', setBy: OWNER, now: new Date() });
      const before = structuredClone(await haltCollection.findOne({ _id: 'alpha' }));
      const res = await post('running/halt', haltBody(mode));
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'RUNNER_OWNER_ONLY');
      assert.equal(body.error, COPY);
      assert.deepEqual(await haltCollection.findOne({ _id: 'alpha' }), before, 'untouched');
      assert.equal((await logStore.getLog('alpha')).length, 0, 'nothing logged');
    });
  }

  test('member: a halt with no reason is refused at the gate (403), not sent back to ask for a reason', async () => {
    state.accountId = MEMBER;
    await haltStore.setWorkspaceHalt('alpha', { mode: 'stop', setBy: OWNER, now: new Date() });
    const before = structuredClone(await haltCollection.findOne({ _id: 'alpha' }));
    const res = await post('running/halt', { mode: 'pause' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('location'), null, 'no ?error=reason redirect: the gate comes before the reason is looked at');
    assert.equal((await res.json()).code, 'RUNNER_OWNER_ONLY');
    assert.deepEqual(await haltCollection.findOne({ _id: 'alpha' }), before, 'the halt is unchanged');
  });

  test('FAIL-CLOSED: no owner seam refuses the owner too, and writes nothing', async () => {
    state.ownerCheck = null;
    const res = await post('running/halt', haltBody('stop'));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(await haltMode(), 'none');
  });

  test('an invalid mode is a 400 for anyone (validation precedes the gate), and a missing reason is refused after the gate', async () => {
    state.accountId = MEMBER;
    assert.equal((await post('running/halt', haltBody('bogus'))).status, 400);
    state.accountId = OWNER;
    const noReason = await post('running/halt', { mode: 'pause' });
    assert.equal(noReason.headers.get('location'), '/workspace/alpha/settings/running?error=reason');
    assert.equal(await haltMode(), 'none');
  });

  test('a halt made from the Dispatch page or the proxy lands in the log as "Changed outside Settings"', async () => {
    await haltStore.setWorkspaceHalt('alpha', { mode: 'stop', setBy: OWNER, now: new Date(), via: 'page' });
    const [entry] = await logStore.getLog('alpha');
    assert.equal(entry.reason, 'Changed outside Settings (Dispatch page or API)');
    assert.deepEqual([entry.from, entry.to], ['none', 'stop']);
  });
});

describe('Undo of a halt entry: owner-only, before the conflict check and any write', () => {
  async function stoppedByOwner() {
    await post('running/halt', { mode: 'stop', reason: 'Runaway session' });
    const [entry] = await logStore.getLog('alpha');
    return entry;
  }

  test('member: refused 403, the stop stands, nothing logged, even with a conflicting value', async () => {
    const entry = await stoppedByOwner();
    state.accountId = MEMBER;
    const res = await post(`change-log/workspace/${entry._id}/undo`, { reason: 'let it run' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'RUNNER_OWNER_ONLY');
    assert.equal(await haltMode(), 'stop');
    assert.equal((await logStore.getLog('alpha')).length, 1);
  });

  test('owner: undoing a stop resumes, writes ONE undo entry (no "Changed outside Settings" extra)', async () => {
    const entry = await stoppedByOwner();
    const res = await post(`change-log/workspace/${entry._id}/undo`, { reason: 'false alarm' });
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/change-log?undone=1');
    assert.equal(await haltMode(), 'none');
    const log = await logStore.getLog('alpha');
    assert.equal(log.length, 2);
    assert.deepEqual(log.map(r => r.kind).sort(), ['change', 'undo']);
    assert.ok(!log.some(r => r.reason.startsWith('Changed outside Settings')));
  });

  test('owner: refuses (conflict) when the halt changed since, and when the previous value is unknown', async () => {
    const entry = await stoppedByOwner();
    await haltStore.setWorkspaceHalt('alpha', { mode: 'pause', setBy: OWNER, now: new Date() });
    assert.match((await post(`change-log/workspace/${entry._id}/undo`, { reason: 'x' })).headers.get('location'), /error=conflict/);

    // A halt whose prior read failed has nothing to restore: undo refuses rather than guess a resume.
    await logStore.collection.insertOne({ _id: 'unk', urlKey: 'alpha', at: new Date(), actor: { via: 'page' }, setting: 'halt', kind: 'change', reason: 'r', from: 'unknown', to: 'pause' });
    assert.match((await post('change-log/workspace/unk/undo', { reason: 'x' })).headers.get('location'), /error=not_undoable/);
    assert.equal(await haltMode(), 'pause');
  });

  test('FAIL-CLOSED on the undo too: no owner seam refuses', async () => {
    const entry = await stoppedByOwner();
    state.ownerCheck = null;
    const res = await post(`change-log/workspace/${entry._id}/undo`, { reason: 'x' });
    assert.equal(res.status, 503);
    assert.equal(await haltMode(), 'stop');
  });
});

describe('the Change log shows model-routing-log beside the others and undoes it through the store', () => {
  test('a model entry is listed and Undo calls ModelRoutingStore.undo', async () => {
    await fx.routingStore.changeJob('recommend', { model: 'anthropic/claude-sonnet-4' }, { urlKey: 'alpha', reason: 'try sonnet', actor: { via: 'page', id: OWNER } });
    await post('workspace-features', { feature: 'periodicals', enabled: 'true', reason: 'on' });

    const html = await (await fetch(`${base}/workspace/alpha/settings/change-log`)).text();
    assert.match(html, /data-testid="settings-change-model"/);
    assert.match(html, /data-testid="settings-change-workspace"/);
    assert.match(html, /try sonnet/);

    const modelEntry = (await fx.routingStore.getLog('alpha')).find(r => r.reason === 'try sonnet');
    const res = await post(`change-log/model/${modelEntry._id}/undo`, { reason: 'back to default' });
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/change-log?undone=1');
    const log = await fx.routingStore.getLog('alpha');
    assert.ok(log.some(r => r.kind === 'undo' && r.undoes === modelEntry._id), 'the store wrote its own undo entry');
    const jobs = (await fx.routingStore.getEffectiveTable('alpha', { defaultModel: 'x/default' })).jobs;
    assert.notEqual(jobs.find(j => j.id === 'recommend').model, 'anthropic/claude-sonnet-4');
  });

  test('a model undo that conflicts is refused by the store and the page says so', async () => {
    await fx.routingStore.changeJob('recommend', { model: 'a/one' }, { urlKey: 'alpha', reason: 'one', actor: { via: 'page' } });
    const first = (await fx.routingStore.getLog('alpha'))[0];
    await fx.routingStore.changeJob('recommend', { model: 'a/two' }, { urlKey: 'alpha', reason: 'two', actor: { via: 'page' } });
    const res = await post(`change-log/model/${first._id}/undo`, { reason: 'undo one' });
    assert.match(res.headers.get('location'), /error=conflict/);
  });
});

describe('a model undo is judged by the runnable check (LIN-3855)', () => {
  // A and B go through the store with no guard, as the proxy writes them. A moves Make to OpenCode; B moves
  // Make to a model only OpenCode runs. Undoing A would leave Make on the default harness with that model,
  // so the undo is refused, and the refusal writes nothing.
  const ctx = (reason) => ({ urlKey: 'alpha', reason, actor: { via: 'proxy' } });
  const entry = async (reason) => (await fx.routingStore.getLog('alpha')).find((r) => r.reason === reason);
  const undoEntry = async (reason) => post(`change-log/model/${(await entry(reason))._id}/undo`, { reason: `undo ${reason}` });
  const snapshot = () => JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs]);

  test('undoing A is refused INVALID when B leaves Make unable to run its model: nothing is written', async () => {
    await fx.routingStore.changeGroup('agent-session', 'make', { harness: 'opencode' }, ctx('A'));
    await fx.routingStore.changeGroup('agent-session', 'make', { model: 'openai/gpt-6.1-sol' }, ctx('B'));
    const before = snapshot();
    const res = await undoEntry('A');
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/change-log?error=invalid');
    assert.equal(snapshot(), before, 'the table, its version and the log are untouched');
  });

  test('the same undo with no B is allowed: the guard refuses only what would not run', async () => {
    await fx.routingStore.changeGroup('agent-session', 'make', { harness: 'opencode' }, ctx('A'));
    const res = await undoEntry('A');
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/change-log?undone=1');
    const table = await fx.routingStore.getTable('alpha');
    assert.equal(currentValue(table, { scope: 'group', surface: 'agent-session', key: 'make', field: 'harness' }), null);
  });
});

describe('the index and the areas', () => {
  test('the index renders the list; every area renders; an unknown area is not a page', async () => {
    const index = await fetch(`${base}/workspace/alpha/settings`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /data-view="index"/);
    for (const id of ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account']) {
      const res = await fetch(`${base}/workspace/alpha/settings/${id}`);
      assert.equal(res.status, 200, id);
      assert.match(await res.text(), new RegExp(`data-view="area" data-area="${id}"`));
    }
    const unknown = await fetch(`${base}/workspace/alpha/settings/nope`);
    assert.equal(unknown.status, 404);
  });

  test('a workspace with only a live queue token reads "Runner ready" and shows the queue token as the last poll', async () => {
    // plan-review B4: Settings and the Dispatch run controls must agree on "has a runner".
    // The route wires hasLiveRunnerKey || hasLiveQueueToken itself, so this goes through the route.
    state.proxyRows = [];
    state.dispatchRows = [{ tokenId: 'q', label: 'legacy', hasOwner: true, createdAt: new Date(Date.now() - 864e5).toISOString(), lastUsedAt: new Date(Date.now() - 6e4).toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() }];
    const index = await (await fetch(`${base}/workspace/alpha/settings`)).text();
    assert.match(index, /data-testid="settings-state-running"[^>]*>\s*Runner ready/);
    const running = await (await fetch(`${base}/workspace/alpha/settings/running`)).text();
    assert.match(running, /data-testid="settings-runner-last-poll"[\s\S]*?queue token/);
  });

  test('with no keys at all the Running state reads "No runner"', async () => {
    const index = await (await fetch(`${base}/workspace/alpha/settings`)).text();
    assert.match(index, /data-testid="settings-state-running"[^>]*>\s*No runner/);
  });

  test('a provider return on the bare index goes to Sources with its query intact', async () => {
    const res = await fetch(`${base}/workspace/alpha/settings?provider_ok=jira`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/workspace/alpha/settings/sources?provider_ok=jira');
  });
});
