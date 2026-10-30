/**
 * LIN-3774: fetchAndPrepareProjects wiring for a SECONDARY connection-backed
 * GitHub binding on a Linear-primary workspace.
 *
 *  - proactive: an expired secondary token is re-minted BEFORE its provider call;
 *  - reactive:  a failing binding's error is tagged `error.binding` so
 *               handleUnauthorizedError can re-mint that binding only;
 *  - degrade:   on the retry pass (`degradeSecondary`) a secondary that still
 *               fails is left out and reported in `degradedSources`, the other
 *               sources render; the first pass always rethrows.
 *
 * server.js is not import-safe, so the function's real source is sliced into a
 * vm context (as lin-3688-*). Names it takes from ./lib/ are bound to the REAL
 * modules; only the providers, matchTeamId-free I/O and the freshness seam's
 * re-mint are faked. `secondaryRemint` is the REAL seam over a counting re-mint.
 *
 * Run: node --test tests/unit/lin-3774-fetch-and-prepare-projects-secondary-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSecondaryBindingRemint } from '../../lib/connection-secondary-remint.js';
import { rehydrateBindingAfterRefresh } from '../../lib/connection-credential.js';
import { setBindingCredential } from '../../lib/connection-binding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const NOW = 1_800_000_000_000;
const FAKED = new Set(['getProvider', 'isWorkspaceFeatureEnabled']);

function sliceFetchAndPrepareProjects() {
  const startIdx = SERVER_SRC.indexOf('async function fetchAndPrepareProjects(');
  assert.notEqual(startIdx, -1);
  const endIdx = SERVER_SRC.indexOf('\n}\n', startIdx);
  const src = SERVER_SRC.slice(startIdx, endIdx + 2);
  assert.equal((src.match(/{/g) || []).length, (src.match(/}/g) || []).length, 'brace-balanced slice');
  return src;
}

async function bindImports(src) {
  const bound = {};
  for (const m of SERVER_SRC.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.\/lib\/[^']+)'/gm)) {
    for (const spec of m[1].split(',')) {
      const [imported, local] = spec.trim().split(/\s+as\s+/);
      const name = (local || imported || '').trim();
      if (!name || FAKED.has(name) || !new RegExp(`\\b${name}\\b`).test(src)) continue;
      const mod = await import(new URL(m[2].replace('./', '../../'), import.meta.url));
      bound[name] = mod[imported.trim()];
    }
  }
  return bound;
}

/** vm results carry the context's own prototypes; compare as plain data. */
const plain = (v) => JSON.parse(JSON.stringify(v));

const authError = () => Object.assign(new Error('Bad credentials'), { status: 401 });

/** Linear-primary workspace: [linear (active), github (secondary)] unless `order` flips them. */
function makeWorkspace({ ghExpiry = NOW - 1000, order = ['linear', 'github'] } = {}) {
  const linear = { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' };
  const github = { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'a::github::1' };
  setBindingCredential(linear, { token: 'lin-token', tokenExpiresAt: NOW + 3_600_000 });
  setBindingCredential(github, { token: 'stale-gh', tokenExpiresAt: ghExpiry });
  const byName = { linear, github };
  return { id: 'org-1', urlKey: 'lv', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: order.map(n => byName[n]) };
}

async function run(workspace, { githubFails = null, linearFails = null, opts = {}, secondary = true } = {}) {
  const calls = { remint: [], githubTokens: [], linearTokens: [] };
  const projectsFor = (name) => ({ organizationName: `${name}-org`, projects: [{ id: `${name}-p`, name: `${name} project`, sortOrder: 1 }], issues: [] });
  const providers = {
    linear: {
      fetchTeams: async (scope) => { calls.linearTokens.push(scope); if (linearFails) throw linearFails; return [{ id: 'lt', name: 'Eng' }]; },
      fetchProjects: async () => projectsFor('linear'),
    },
    github: {
      fetchTeams: async (scope) => { calls.githubTokens.push(scope.token); if (githubFails) throw githubFails; return []; },
      fetchProjects: async () => projectsFor('github'),
    },
  };
  const src = sliceFetchAndPrepareProjects();
  const secondaryRemint = secondary
    ? createSecondaryBindingRemint({
      refreshConnectionForWorkspace: async (connection, accountId, urlKey) => {
        calls.remint.push({ connection, accountId, urlKey });
        return { token: 'fresh-gh', expiresAt: NOW + 3_600_000 };
      },
      applyRefreshed: rehydrateBindingAfterRefresh,
      now: () => NOW,
      logger: { error: () => {} },
    })
    : null;
  const context = vm.createContext({
    ...(await bindImports(src)),
    process,
    console: { ...console, error: () => {} },
    getProvider: (name) => providers[name],
    isWorkspaceFeatureEnabled: async () => false,
    workspacePreferencesStore: {},
    secondaryRemint,
  });
  const fn = vm.runInContext(`(${src})`, context);
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const result = await fn(workspace, null, null, null, { accountId: 'a', ...opts }).then(value => ({ value }), error => ({ error }));
    return { calls, ...result };
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
  }
}

describe('LIN-3774 fetchAndPrepareProjects — proactive freshness', () => {
  test('an expired secondary is re-minted once BEFORE its provider call, and the call carries the fresh token', async () => {
    const { calls, value, error } = await run(makeWorkspace());
    assert.equal(error, undefined);
    assert.equal(calls.remint.length, 1);
    assert.deepEqual(plain(calls.remint[0]), { connection: { _id: 'a::github::1', provider: 'github' }, accountId: 'a', urlKey: 'lv' });
    assert.deepEqual(plain(calls.githubTokens), ['fresh-gh'], 'the provider call must not see the stale token');
    assert.deepEqual(plain(value.degradedSources), []);
    assert.equal(value.showSource, true);
  });

  test('a fresh secondary is not re-minted', async () => {
    const { calls } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }));
    assert.equal(calls.remint.length, 0);
    assert.deepEqual(plain(calls.githubTokens), ['stale-gh']);
  });

  test('the accountId option reaches the re-mint (the three non-dashboard routes pass it too)', async () => {
    const { calls } = await run(makeWorkspace(), { opts: { accountId: 'acct-9' } });
    assert.equal(calls.remint[0].accountId, 'acct-9');
  });
});

describe('LIN-3774 fetchAndPrepareProjects — tag and degrade', () => {
  test('first pass: a secondary 401 is rethrown tagged with its binding (provider, scope, connectionId)', async () => {
    const { error, calls } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }), { githubFails: authError() });
    assert.equal(error.message, 'Bad credentials');
    assert.deepEqual(plain(error.binding), { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'a::github::1' });
    assert.equal(calls.remint.length, 0, 'the proactive step does not fire on a fresh token');
  });

  test('first pass: a NON-auth secondary failure still fails the page (open question 1: today\'s behaviour)', async () => {
    const boom = Object.assign(new Error('GitHub 502'), { status: 502 });
    const { error } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }), { githubFails: boom });
    assert.equal(error, boom);
  });

  test('the ACTIVE binding\'s failure is tagged too (LIN-3775 reads it) but is never degraded, even on the retry pass', async () => {
    const { error } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }), { linearFails: authError(), opts: { degradeSecondary: true } });
    assert.deepEqual(plain(error.binding), { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' });
  });

  test('retry pass: a secondary that still fails is degraded; the other source renders and degradedSources names it', async () => {
    const { value, error } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }), { githubFails: authError(), opts: { degradeSecondary: true } });
    assert.equal(error, undefined);
    assert.deepEqual(plain(value.degradedSources), [{ provider: 'github', scope: 'JKershaw/LinearViewer' }]);
    assert.equal(value.organizationName, 'linear-org');
    assert.deepEqual(plain(value.teams), [{ id: 'lt', name: 'Eng' }]);
    assert.equal(value.trees.length, 1, 'only the linear project is rendered');
  });

  test('retry pass: any in-scope secondary error degrades, not only an auth error', async () => {
    const { value } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000 }), { githubFails: Object.assign(new Error('502'), { status: 502 }), opts: { degradeSecondary: true } });
    assert.equal(value.degradedSources.length, 1);
  });

  test('retry pass: the re-mint is not repeated for a binding the handler just re-minted (cap)', async () => {
    const ws = makeWorkspace({ ghExpiry: NOW - 1000 });
    const { calls, value } = await run(ws, { githubFails: authError(), opts: { degradeSecondary: true } });
    assert.equal(calls.remint.length, 1, 'one proactive attempt; the failing call then degrades');
    assert.equal(value.degradedSources.length, 1);
  });

  test('org name and teams come from the first binding that loads when bindings[0] degrades', async () => {
    const { value } = await run(makeWorkspace({ ghExpiry: NOW + 3_600_000, order: ['github', 'linear'] }), { githubFails: authError(), opts: { degradeSecondary: true } });
    assert.equal(value.organizationName, 'linear-org');
    assert.deepEqual(plain(value.teams), [{ id: 'lt', name: 'Eng' }]);
    assert.deepEqual(plain(value.degradedSources), [{ provider: 'github', scope: 'JKershaw/LinearViewer' }]);
  });

  test('a single-binding workspace yields degradedSources: [] and the same result as before', async () => {
    const linear = { provider: 'linear', scope: 'org-1', credentials: { token: 'legacy-token' } };
    const ws = { id: 'org-1', urlKey: 'lv', provider: 'linear', bindings: [linear] };
    const { value, calls } = await run(ws);
    assert.deepEqual(plain(value.degradedSources), []);
    assert.equal(value.showSource, false);
    assert.equal(value.organizationName, 'linear-org');
    assert.equal(calls.remint.length, 0);
  });
});

describe('LIN-3790 fetchAndPrepareProjects — legacy (not connection-backed) secondary', () => {
  /** Legacy Linear-primary workspace with a legacy GitHub secondary; `provider` may be undefined. */
  function legacyWorkspace({ provider = 'linear' } = {}) {
    const linear = { provider: 'linear', scope: 'org-1', credentials: { token: 'legacy-lin' } };
    const github = { provider: 'github', scope: 'JKershaw/LinearViewer', credentials: { token: 'legacy-gh' } };
    const ws = { id: 'org-1', urlKey: 'lv', accessToken: 'legacy-lin', bindings: [linear, github] };
    if (provider) ws.provider = provider;
    return ws;
  }

  test('retry pass: a legacy GitHub secondary that fails is degraded, the Linear source renders, and nothing is renewed', async () => {
    const { value, error, calls } = await run(legacyWorkspace(), { githubFails: authError(), opts: { degradeSecondary: true } });
    assert.equal(error, undefined);
    assert.deepEqual(plain(value.degradedSources), [{ provider: 'github', scope: 'JKershaw/LinearViewer' }]);
    assert.equal(value.organizationName, 'linear-org');
    assert.equal(calls.remint.length, 0, 'a legacy binding has no renewal path');
  });

  test('first pass: a legacy secondary 401 still rethrows, tagged with an undefined connectionId', async () => {
    const { error } = await run(legacyWorkspace(), { githubFails: authError() });
    assert.equal(error.message, 'Bad credentials');
    assert.deepEqual(plain(error.binding), { provider: 'github', scope: 'JKershaw/LinearViewer' });
  });

  for (const provider of ['linear', undefined]) {
    test(`retry pass: the legacy ACTIVE binding's failure still rethrows (workspace.provider ${provider}) — never an empty dashboard`, async () => {
      const { error, value } = await run(legacyWorkspace({ provider }), { linearFails: authError(), opts: { degradeSecondary: true } });
      assert.equal(value, undefined);
      assert.equal(error.message, 'Bad credentials');
    });
  }

  test('a single legacy binding with an undefined provider takes no degrade path: a failure rethrows', async () => {
    const linear = { provider: 'linear', scope: 'org-1', credentials: { token: 'legacy-token' } };
    const ws = { id: 'org-1', urlKey: 'lv', accessToken: 'legacy-token', bindings: [linear] };
    const { error } = await run(ws, { linearFails: authError(), opts: { degradeSecondary: true } });
    assert.equal(error.message, 'Bad credentials');
  });
});

describe('LIN-3774 every fetchAndPrepareProjects call site passes accountId', () => {
  test('all six call sites carry accountId; the three non-dashboard sites keep urlKey null', () => {
    // LIN-4024: the Home rows route is a call site too; it carries the workspace urlKey like the dashboard. LIN-4016:
    // the post-401 render's call is in lib/dashboard-refresh.js, so the sites are scanned in both files.
    const sources = SERVER_SRC + readFileSync(join(__dirname, '../../lib/dashboard-refresh.js'), 'utf8');
    const calls = [...sources.matchAll(/(?<!function )fetchAndPrepareProjects\((workspace,[^\n]*)/g)].map(m => m[1]);
    assert.equal(calls.length, 6, `expected 6 call sites, found ${calls.length}`);
    for (const c of calls) assert.match(c, /accountId: (req\.)?session\.accountId/, c);
    const nonDashboard = calls.filter(c => !c.includes('workspace.urlKey'));
    assert.equal(nonDashboard.length, 3);
    for (const c of nonDashboard) assert.match(c, /, null, \{ accountId: req\.session\.accountId \}\)/, `urlKey must stay null: ${c}`);
  });
});
