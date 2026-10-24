/**
 * LIN-3854: the proxy model-routing routes (routes/proxy-model-routing.js), driven through
 * the real composed proxy router over a real ModelRoutingStore and WorkspacePreferencesStore.
 *
 * Run with: node --test tests/unit/proxy-model-routing.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACME, BASE_DEPS, buildApp as buildBaseApp, call } from './lib/proxy-fake-deps.js';
import { routingFixture } from './helpers/routing-fakes.js';
import { setWorkspaceFeature, isWorkspaceFeatureEnabled } from '../../lib/workspace-preferences.js';
import { WORKSPACE_FEATURES, WORKSPACE_FEATURE_KEYS, WORKSPACE_FEATURE_DEFAULTS } from '../../lib/feature-defaults.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = '/api/proxy/model-routing';
const FEATURE = WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES;

const token = (scope, createdBy = 'acct-9') => ({
  ...BASE_DEPS().proxyTokenStore,
  validateToken: async () => ({ tokenId: 'tok-1', urlKey: ACME, label: 'a free-text label', scope, createdBy, workspaceId: 'ws-acme' })
});

describe('LIN-3854: proxy model routing', () => {
  let fx;
  let app;
  const enable = (enabled = true) => setWorkspaceFeature({ urlKey: ACME, featureKey: FEATURE, enabled, store: fx.preferencesStore });
  const buildApp = (scope = 'readWrite', extra = {}) => buildBaseApp({
    proxyTokenStore: token(scope, extra.createdBy),
    modelRoutingStore: fx.routingStore,
    workspacePreferencesStore: fx.preferencesStore,
    ...extra.deps
  });
  const snapshot = () => JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs, fx.collections.presets._docs]);
  const post = (path, body, scope) => call(buildApp(scope), 'POST', `${BASE}${path}`, { body });
  const review = async () => (await fx.routingStore.getEffectiveTable(ACME, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'review');

  beforeEach(() => { fx = routingFixture(); app = buildApp('read'); });

  test('the setting exists, is off by default and is a settable workspace feature', async () => {
    assert.ok(WORKSPACE_FEATURE_KEYS.includes(FEATURE));
    assert.equal(WORKSPACE_FEATURE_DEFAULTS[FEATURE], false);
    assert.equal(await isWorkspaceFeatureEnabled({ urlKey: ACME, featureKey: FEATURE, store: fx.preferencesStore }), false);
    await enable();
    assert.equal(await isWorkspaceFeatureEnabled({ urlKey: ACME, featureKey: FEATURE, store: fx.preferencesStore }), true);
  });

  test('a read token gets the table, presets and log, with the setting off', async () => {
    await fx.routingStore.changeJob('review', { model: 'opus' }, { urlKey: ACME, reason: 'seed', actor: { via: 'page', id: 'acct-1' } });
    await fx.routingStore.savePreset('keep', { urlKey: ACME, reason: 'seed', actor: { via: 'page', id: 'acct-1' } });
    const table = await call(app, 'GET', BASE);
    assert.equal(table.status, 200);
    const job = table.body.jobs.find((j) => j.id === 'review');
    assert.deepEqual([job.model, job.source.model], ['opus', 'job']);
    assert.ok(table.body.groups && table.body.defaults);
    const presets = await call(app, 'GET', `${BASE}/presets`);
    assert.equal(presets.status, 200);
    assert.deepEqual(presets.body.presets.map((p) => p.name), ['keep']);
    const log = await call(app, 'GET', `${BASE}/log?limit=1`);
    assert.equal(log.status, 200);
    assert.equal(log.body.entries.length, 1);
    assert.equal(log.body.entries[0].actor.id, undefined, 'the account id is not returned');
  });

  test('no read response carries the setting', async () => {
    for (const path of [BASE, `${BASE}/presets`, `${BASE}/log`]) {
      const res = await call(app, 'GET', path);
      assert.ok(!JSON.stringify(res.body).includes('modelRoutingProxyWrites'), path);
      assert.ok(!JSON.stringify(res.body).includes('ProxyWrites'), path);
    }
  });

  const WRITES = [
    ['/jobs/review', { reason: 'r', model: 'opus' }],
    ['/groups/judge', { reason: 'r', surface: 'agent-session', model: 'opus' }],
    ['/presets/nope/apply', { reason: 'r' }],
    ['/log/nope/undo', { reason: 'r' }]
  ];

  test('with the setting off every write is 403 MODEL_ROUTING_WRITES_DISABLED and nothing changes', async () => {
    await fx.routingStore.getTable(ACME);
    const before = snapshot();
    for (const [path, body] of WRITES) {
      const res = await post(path, body);
      assert.equal(res.status, 403, path);
      assert.equal(res.body.code, 'MODEL_ROUTING_WRITES_DISABLED');
      assert.equal(res.body.setting, 'modelRoutingProxyWrites');
    }
    // Even an invalid body is refused by the gate first, not validated.
    assert.equal((await post('/jobs/review', {})).status, 403);
    assert.equal(snapshot(), before);
  });

  test('a read-scope token on a write is 403 whatever the setting says', async () => {
    for (const on of [false, true]) {
      await enable(on);
      const res = await post('/jobs/review', { reason: 'r', model: 'opus' }, 'read');
      assert.equal(res.status, 403);
      assert.notEqual(res.body.code, 'MODEL_ROUTING_WRITES_DISABLED');
    }
    assert.equal((await review()).model, null);
  });

  test('with the setting on, a job change lands and the log shows via proxy, the creator and the token id', async () => {
    await enable();
    const res = await post('/jobs/review', { reason: 'judge on Sonnet', model: 'sonnet', effort: 'high' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const job = await review();
    assert.deepEqual([job.model, job.effort, job.source.model], ['sonnet', 'high', 'job']);
    const [entry] = await fx.routingStore.getLog(ACME);
    assert.equal(entry.reason, 'judge on Sonnet');
    assert.deepEqual([entry.actor.via, entry.actor.id, entry.actor.tokenId], ['proxy', 'acct-9', 'tok-1']);
    assert.equal(entry.actor.label, undefined, 'the free-text token label is not stored');
    assert.equal(res.body.entry.actor.id, undefined);
    assert.equal(res.body.entry.actor.tokenId, 'tok-1');
  });

  test('an ownerless token logs without an id', async () => {
    await enable();
    const res = await call(buildApp('readWrite', { createdBy: null }), 'POST', `${BASE}/jobs/review`, { body: { reason: 'r', model: 'x' } });
    assert.equal(res.status, 200);
    const [entry] = await fx.routingStore.getLog(ACME);
    assert.equal(entry.actor.id, undefined);
    assert.equal(entry.actor.tokenId, 'tok-1');
    assert.equal(entry.actor.name, 'former member');
  });

  test('a log read never returns the account id of a creator that no longer resolves', async () => {
    fx = routingFixture({ resolveActorName: async () => null });
    await enable();
    const res = await call(buildApp('readWrite', { createdBy: 'acct-SECRET-123' }), 'POST', `${BASE}/jobs/review`, { body: { reason: 'r', model: 'x' } });
    assert.equal(res.status, 200);
    const log = await call(buildApp('read', { createdBy: 'acct-SECRET-123' }), 'GET', `${BASE}/log`);
    assert.equal(log.status, 200);
    assert.equal(log.body.entries[0].actor.name, 'former member');
    assert.ok(!JSON.stringify(log.body).includes('acct-SECRET-123'), 'the account id is not in the body');
  });

  test('validation: reason, keys, values, ids', async () => {
    await enable();
    await fx.routingStore.getTable(ACME);
    const before = snapshot();
    const cases = [
      ['/jobs/review', { model: 'x' }, 400],
      ['/jobs/review', { reason: '', model: 'x' }, 400],
      ['/jobs/review', { reason: '   ', model: 'x' }, 400],
      ['/jobs/review', { reason: 'x'.repeat(501), model: 'x' }, 400],
      ['/jobs/review', { reason: 'r', modle: 'x' }, 400],
      ['/jobs/review', { reason: 'r' }, 400],
      ['/jobs/review', { reason: 'r', model: 5 }, 400],
      ['/jobs/review', { reason: 'r', model: 'bad\u0001id' }, 400],
      ['/jobs/review', { reason: 'r', model: '' }, 400],
      ['/jobs/recap', { reason: 'r', model: 'claude opus' }, 400],
      ['/jobs/recap', { reason: 'r', harness: 'claude-code' }, 400],
      ['/jobs/nope', { reason: 'r', model: 'x' }, 404],
      ['/groups/judge', { reason: 'r', model: 'x' }, 400],
      ['/groups/nope', { reason: 'r', surface: 'agent-session', model: 'x' }, 404],
      ['/presets/nope/apply', { reason: 'r' }, 404],
      ['/presets/nope/apply', {}, 400],
      ['/log/nope/undo', { reason: 'r' }, 404]
    ];
    for (const [path, body, status] of cases) {
      assert.equal((await post(path, body)).status, status, `${path} ${JSON.stringify(body).slice(0, 40)}`);
    }
    assert.equal(snapshot(), before, 'no rejected write changed the store');
  });

  test('a Harbour-call model passes the provider/model pattern; null clears', async () => {
    await enable();
    assert.equal((await post('/jobs/recap', { reason: 'r', model: 'anthropic/claude-sonnet-4' })).status, 200);
    const got = (await fx.routingStore.getEffectiveTable(ACME, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'recap');
    assert.equal(got.model, 'anthropic/claude-sonnet-4');
    assert.equal((await post('/jobs/recap', { reason: 'back', model: null })).status, 200);
    const cleared = (await fx.routingStore.getEffectiveTable(ACME, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'recap');
    assert.equal(cleared.source.model, 'none');
  });

  test('a group write needs a surface and lands on that surface\'s row', async () => {
    await enable();
    const res = await post('/groups/judge', { reason: 'r', surface: 'agent-session', model: 'opus' });
    assert.equal(res.status, 200);
    const table = await fx.routingStore.getTable(ACME);
    assert.equal(table.groups['agent-session'].judge.model, 'opus');
    assert.equal(table.groups['harbour-call'].judge.model, undefined);
    assert.equal((await review()).source.model, 'group');
  });

  test('undo over the proxy appends a restoring entry; after a later edit it is 409', async () => {
    await enable();
    await post('/jobs/review', { reason: 'one', model: 'a' });
    const [first] = await fx.routingStore.getLog(ACME);
    const undone = await post(`/log/${first._id}/undo`, { reason: 'wrong call' });
    assert.equal(undone.status, 200);
    assert.equal((await review()).model, null);
    const log = await fx.routingStore.getLog(ACME);
    assert.equal(log.length, 2);
    assert.equal(log[0].kind, 'undo');
    assert.equal(log[0].undoes, first._id);
    assert.equal(log[0].actor.via, 'proxy');

    await post('/jobs/review', { reason: 'two', model: 'b' });
    const [second] = await fx.routingStore.getLog(ACME);
    await post('/jobs/review', { reason: 'three', model: 'c' });
    const before = snapshot();
    const conflict = await post(`/log/${second._id}/undo`, { reason: 'late' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.details.conflicts.length, 1);
    assert.equal(snapshot(), before);
  });

  test('applying a preset is one entry', async () => {
    await enable();
    const ctx = { urlKey: ACME, reason: 'seed', actor: { via: 'page', id: 'acct-1' } };
    await fx.routingStore.changeJob('review', { model: 'keep' }, ctx);
    const { preset } = await fx.routingStore.savePreset('keep', ctx);
    await post('/jobs/review', { reason: 'drift', model: 'other' });
    const before = (await fx.routingStore.getLog(ACME)).length;
    const res = await post(`/presets/${preset._id}/apply`, { reason: 'restore' });
    assert.equal(res.status, 200);
    assert.equal((await fx.routingStore.getLog(ACME)).length, before + 1);
    assert.equal((await review()).model, 'keep');
  });

  test('a log write failure is a 500 that says the change landed', async () => {
    await enable();
    fx.collections.log.insertOne = async () => { throw new Error('disk'); };
    const res = await post('/jobs/review', { reason: 'r', model: 'x' });
    assert.equal(res.status, 500);
    assert.equal(res.body.code, 'LOG_WRITE_FAILED');
    assert.match(res.body.error, /saved but its log entry/);
  });

  test('a missing store is a JSON 500, not a throw', async () => {
    const res = await call(buildBaseApp({ proxyTokenStore: token('read'), modelRoutingStore: null }), 'GET', BASE);
    assert.equal(res.status, 500);
  });

  describe('no proxy path toggles the setting', () => {
    // Every `router.<write verb>(` registration in routes/proxy*.js, whatever its spelling: a
    // single-quoted literal, a backtick literal, a `${CONST}` prefix, a bare const, an array of
    // paths, or a path on the line after the `(`. Consts are resolved from the same file. A form
    // this cannot resolve fails the test rather than being skipped, so a new spelling cannot
    // hide a route from the sweep (LIN-3854 review: the old sweep read only '...' literals).
    const writeRoutes = () => {
      const dir = join(__dirname, '../../routes');
      const out = [];
      let registrations = 0;
      let expected = 0;
      for (const f of readdirSync(dir).filter((n) => /^proxy.*\.js$/.test(n))) {
        const src = readFileSync(join(dir, f), 'utf8');
        expected += (src.match(/router\.(?:post|put|patch|delete)\(/g) || []).length;
        const consts = {};
        for (const m of src.matchAll(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'([^']*)'|`([^`]*)`)\s*;?\s*$/gm)) consts[m[1]] = m[2] ?? m[3];
        const resolve = (expr) => {
          const lit = expr.match(/^(?:'([^']*)'|`([^`]*)`)$/);
          if (lit) return (lit[1] ?? lit[2]).replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_, n) => { if (!(n in consts)) throw new Error(`${f}: unresolved \${${n}}`); return consts[n]; });
          if (expr in consts) return consts[expr];
          throw new Error(`${f}: cannot resolve route expression ${expr}`);
        };
        for (const m of src.matchAll(/router\.(post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*'|`[^`]*`|[A-Za-z_$][\w$]*)/g)) {
          registrations++;
          const arg = m[2];
          const paths = arg.startsWith('[') ? arg.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) : [arg];
          for (const p of paths) out.push(resolve(p).replace(/:[A-Za-z]+\??/g, 'x'));
        }
      }
      return { urls: out, registrations, expected };
    };
    test('the sweep resolves every write registration in routes/proxy*.js, template literals and consts included', () => {
      const { urls, registrations, expected } = writeRoutes();
      assert.equal(registrations, expected, 'every router.<write>( call must be matched by the sweep');
      assert.ok(registrations > 30, 'the sweep must find the real surface, never pass on a thin one');
      assert.ok(urls.includes(`${BASE}/jobs/x`), 'this route\'s own template-literal registrations are swept');
      assert.ok(urls.some((u) => u.endsWith('/dispatch/halt')), 'a const-named route is swept');
    });

    test('behavioural: every proxy write route, sent the toggle, leaves it off', async () => {
      const { urls } = writeRoutes();
      const a = buildApp('readWrite');
      for (const url of new Set(urls)) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          await call(a, method, url, { body: { feature: FEATURE, enabled: true, [FEATURE]: true, reason: 'x' } }).catch(() => {});
        }
      }
      assert.equal(await isWorkspaceFeatureEnabled({ urlKey: ACME, featureKey: FEATURE, store: fx.preferencesStore }), false);
    });

    test('source census: no proxy file writes workspace features', () => {
      const files = [
        ...readdirSync(join(__dirname, '../../routes')).filter((n) => /^proxy.*\.js$/.test(n)).map((n) => `routes/${n}`),
        ...readdirSync(join(__dirname, '../../lib')).filter((n) => /^proxy-.*\.js$/.test(n)).map((n) => `lib/${n}`)
      ];
      for (const f of files) {
        const src = readFileSync(join(__dirname, '../..', f), 'utf8');
        assert.ok(!/setWorkspaceFeature|saveWorkspacePreferences|deleteWorkspacePreferences|settings\/workspace-features/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${f} must not write workspace features`);
      }
    });
  });
});
