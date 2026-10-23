/**
 * LIN-3688: fetchAndPrepareProjects resolves the request's team ref against the
 * primary binding's team list (`matchTeamId`, LIN-2025) and must hand the
 * RESOLVED id to `provider.fetchProjects`, never the raw request `teamId`.
 * The roadmap route's equivalent is pinned by LIN-3683 in
 * lin-2522-roadmap-unconditional-teams-fetch.test.js; this closes the same
 * blind spot for fetchAndPrepareProjects (the dashboard/swim/ship helper).
 *
 * server.js is not import-safe in a unit test (it connects to Mongo and calls
 * app.listen() at module load), so this slices the function's real source and
 * runs it in a vm context, following the roadmap test. Names it takes from
 * server.js's `./lib/` imports are bound to the REAL modules; only I/O and
 * matchTeamId are faked. matchTeamId is a spy (as in the roadmap test) because
 * the real one matches by id only, so it cannot make a raw ref ('Engineering')
 * differ from its resolution ('t1'). isTestMode stays false (real credential
 * token, NODE_ENV not 'test') so the provider.fetchProjects branch runs.
 *
 * Run with: node --test tests/unit/lin-3688-fetch-and-prepare-projects-matched-team-id.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

/** The function's source, from its declaration to the closing brace at column 0. */
function sliceFetchAndPrepareProjects() {
  const startIdx = SERVER_SRC.indexOf('async function fetchAndPrepareProjects(');
  assert.notEqual(startIdx, -1, 'expected to find fetchAndPrepareProjects in server.js');
  const endIdx = SERVER_SRC.indexOf('\n}\n', startIdx);
  assert.notEqual(endIdx, -1, 'expected the closing brace of fetchAndPrepareProjects');
  const src = SERVER_SRC.slice(startIdx, endIdx + 2);
  assert.equal(
    (src.match(/{/g) || []).length,
    (src.match(/}/g) || []).length,
    'the sliced function must be brace-balanced — if this fails it was reformatted and this harness needs re-anchoring'
  );
  return src;
}

/** Names that stay faked: I/O, or local to server.js. */
const FAKED = new Set([
  'getBindingsForWorkspace',
  'getProvider',
  'getBindingCredentials',
  'getBindingCallScope',
  'matchTeamId', // spy: resolves a raw ref to an id that differs from it
  'isWorkspaceFeatureEnabled'
]);

/** `{ localName: modulePath }` for every named import server.js takes from `./lib/`. */
function serverLibImports() {
  const bindings = {};
  for (const m of SERVER_SRC.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.\/lib\/[^']+)'/gm)) {
    for (const spec of m[1].split(',')) {
      const [imported, local] = spec.trim().split(/\s+as\s+/);
      if (imported) bindings[local || imported] = { specifier: m[2], imported: imported.trim() };
    }
  }
  return bindings;
}

async function bindImports(src) {
  const bound = {};
  for (const [name, { specifier, imported }] of Object.entries(serverLibImports())) {
    if (FAKED.has(name) || !new RegExp(`\\b${name}\\b`).test(src)) continue;
    const mod = await import(new URL(specifier.replace('./', '../../'), import.meta.url));
    bound[name] = mod[imported];
  }
  return bound;
}

async function runFetchAndPrepareProjects(teamId, teams, matchedTeamId) {
  const calls = { fetchProjectsArgs: null, matchTeamIdArgs: null };
  const provider = {
    fetchTeams: async () => teams,
    fetchProjects: async (...args) => {
      calls.fetchProjectsArgs = args;
      return { organizationName: 'acme', projects: [], issues: [] };
    }
  };
  const src = sliceFetchAndPrepareProjects();
  const context = vm.createContext({
    ...(await bindImports(src)),
    process,
    getBindingsForWorkspace: () => [{ provider: 'linear' }],
    getProvider: () => provider,
    getBindingCredentials: () => ({ token: 'real-token' }),
    getBindingCallScope: () => 'call-scope',
    // LIN-3774: local to server.js; no secondary binding in this harness
    secondaryRemint: { ensureFresh: async () => false, isSecondaryRemintable: () => false },
    matchTeamId: (t, rawTeamId) => { calls.matchTeamIdArgs = { teams: t, rawTeamId }; return matchedTeamId; },
    isWorkspaceFeatureEnabled: async () => false,
    workspacePreferencesStore: {} // local to server.js; unused with urlKey null
  });
  const fn = vm.runInContext(`(${src})`, context);
  const priorEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const result = await fn({ id: 'ws-1' }, teamId);
    return { calls, result };
  } finally {
    if (priorEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorEnv;
  }
}

describe('LIN-3688 — fetchAndPrepareProjects passes the matched team id to fetchProjects', () => {
  test("a raw ref ('Engineering') reaches fetchProjects as the matched id ('t1'), not the raw ref", async () => {
    const { calls, result } = await runFetchAndPrepareProjects('Engineering', [{ id: 't1', name: 'Engineering' }], 't1');
    assert.deepEqual(calls.matchTeamIdArgs, { teams: [{ id: 't1', name: 'Engineering' }], rawTeamId: 'Engineering' });
    assert.ok(calls.fetchProjectsArgs, 'provider.fetchProjects must have been called (isTestMode false)');
    assert.equal(calls.fetchProjectsArgs[0], 'call-scope');
    assert.equal(calls.fetchProjectsArgs[1], 't1', 'the matched team id (not the raw request ref) must reach fetchProjects');
    assert.equal(result.selectedTeamId, 't1');
  });

  test('a ref matchTeamId cannot resolve drops to unscoped (null), not the raw ref', async () => {
    const { calls } = await runFetchAndPrepareProjects('Nonexistent', [{ id: 't1', name: 'Engineering' }], null);
    assert.equal(calls.fetchProjectsArgs[1], null);
  });
});
