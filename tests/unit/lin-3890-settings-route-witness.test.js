/**
 * LIN-3890 review findings 1 and 2: the Settings routes, not a copy of their inputs, are what
 * the witnesses drive. The sidebar's "N live keys" comes from GET /settings through
 * routes/settings.js, and "You" in the change log comes from the viewer's session through the
 * same route. Each test seeds the stores the route reads and asserts on the rendered page.
 *
 * Mutation checks (recorded in the PR): with `keyCount: keys.length` restored in routes/settings.js
 * the first test goes red; with `viewerAccountId` removed from the change-log render the second goes red.
 *
 * Run with: node --test tests/unit/lin-3890-settings-route-witness.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSettingsRouter } from '../../routes/settings.js';
import { WorkspaceChangeLogStore } from '../../lib/workspace-change-log.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { getWorkspaceFeatures, setWorkspaceFeature, resolveWorkspaceModel } from '../../lib/workspace-preferences.js';
import { projectLegacy } from '../../lib/model-routing.js';
import { getProvider, getProviderForWorkspace } from '../../lib/providers/registry.js';
import '../../lib/providers/index.js';
import { memoryCollection, routingFixture } from './helpers/routing-fakes.js';

const OWNER = 'acct-owner';
const ownerCheck = async ({ accountId }) => ({ status: accountId === OWNER ? 'owner' : 'not-owner' });
const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString();
const PAST = new Date(Date.now() - 864e5).toISOString();

let server, base, fx, logStore, state;

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
    createSettingsRouter({
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
      workspaceHaltStore: new WorkspaceHaltStore({ collection: memoryCollection() }),
      workspaceChangeLogStore: logStore,
      modelRoutingStore: fx.routingStore,
      workspaceOwnerCheck: ownerCheck
    })(req, res, next);
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  fx = routingFixture();
  // Names resolve at read time (server.js does the same): an account that still exists has a name.
  const names = { [OWNER]: 'Ada', 'acct-other': 'Grace' };
  logStore = new WorkspaceChangeLogStore({ collection: memoryCollection(), resolveActorName: async (id) => names[id] || null });
  state = { accountId: OWNER, proxyRows: [], dispatchRows: [] };
});

const row = (over) => ({
  tokenId: over.tokenId, label: '', kind: 'standard', scope: 'read', grants: [],
  expiresAt: FUTURE, lastUsedAt: null, consumed: false, parentTokenId: null, hasOwner: true,
  ...over
});

const sidebarState = (html, area) => {
  const m = new RegExp(`data-testid="settings-state-${area}">(?:<span[^>]*></span>)?([^<]*)<`).exec(html);
  return m ? m[1] : null;
};

describe('the sidebar count is the live person-made keys the route reads', () => {
  test('expired, spent-bootstrap, run and copied-prompt rows do not count; the live person key does', async () => {
    state.proxyRows = [
      row({ tokenId: 'expired', expiresAt: PAST }),
      row({ tokenId: 'spent', kind: 'bootstrap', consumed: true, grants: ['dispatch'] }),
      row({ tokenId: 'person', label: 'laptop', scope: 'readWrite' }),
      row({ tokenId: 'run', label: 'dispatch run', parentTokenId: 'bootstrap-1' }),
      row({ tokenId: 'copied', label: 'copied prompt', parentTokenId: 'bootstrap-2' })
    ];
    const res = await fetch(`${base}/workspace/alpha/settings`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(sidebarState(html, 'agent-access'), '1 live key');
  });

  test('the Agent access page lists the person key and reports the run keys as one summary row', async () => {
    state.proxyRows = [
      row({ tokenId: 'person', label: 'laptop', scope: 'readWrite' }),
      row({ tokenId: 'run', parentTokenId: 'bootstrap-1' })
    ];
    const html = await (await fetch(`${base}/workspace/alpha/settings/agent-access`)).text();
    assert.equal(sidebarState(html, 'agent-access'), '1 live key');
    assert.match(html, /Run keys · 1/);
  });
});

describe('"You" in the change log comes from the viewer’s session through the route', () => {
  test('the owner’s own change reads "You", and the account id is not in the page', async () => {
    await logStore.record({ urlKey: 'alpha', setting: 'periodicals', reason: 'weekly', actor: { via: 'page', id: OWNER, name: 'Ada' }, from: false, to: true });
    const html = await (await fetch(`${base}/workspace/alpha/settings/change-log`)).text();
    assert.match(html, /You · /);
    assert.ok(!html.includes(OWNER), 'no account id in the markup');
  });

  test('a member sees another member’s change by name, not "You"', async () => {
    await logStore.record({ urlKey: 'alpha', setting: 'periodicals', reason: 'weekly', actor: { via: 'page', id: 'acct-other', name: 'Grace' }, from: false, to: true });
    state.accountId = 'acct-member';
    const html = await (await fetch(`${base}/workspace/alpha/settings/change-log`)).text();
    assert.match(html, /Grace · /);
    assert.doesNotMatch(html, /You · /);
  });
});

describe('the change-log route passes the clock through', () => {
  describe('a future expiry reads as a count at the injected time', () => {
    test('the sidebar and key row agree on "in 2d"', async () => {
      state.proxyRows = [row({ tokenId: 'person', label: 'laptop', scope: 'readWrite', expiresAt: new Date(Date.now() + 2 * 864e5 + 3600e3).toISOString() })];
      const html = await (await fetch(`${base}/workspace/alpha/settings/agent-access`)).text();
      assert.match(html, /expires in 2d/);
    });
  });
});
