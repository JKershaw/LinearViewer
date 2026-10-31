/**
 * LIN-4069 (piece A of LIN-4068), review ledger item 1: the subtree index is built over the set BEFORE the assignee
 * filter, at the REAL seam.
 *
 * The earlier test in lin-4069-gather-home.test.js filters its own fixture, so it never touches `fetchAndPrepareProjects`
 * and cannot fail when `const stateIssues = issues;` moves after the assignee filter (review mutation M1: 21,894 tests,
 * 0 new failures). This one drives the real function — its source sliced from server.js and run in a vm context, bound to
 * the real `./lib/` modules (the LIN-3688 / LIN-2006 harness; server.js is not import-safe) — with `mockOverride` and
 * `assigneeName: 'Sam'`, then reads Home's row states through the real `createHomeRowStates` over the result.
 *
 * The shape. The review suggested P (Backlog) → C (Sam) → G (another assignee, started). That shape cannot discriminate:
 * `expandToTreeContext` keeps a match's ancestors AND all its descendants, so G survives the filter and the mutation
 * would still pass. What the filter does drop is the match's SIBLING branch. So:
 *
 *     P (Backlog, no assignee)
 *     ├── C (Todo, Sam)            ← the match; P is kept as its ancestor
 *     └── S (Todo, Alex)           ← a sibling branch: dropped by the filter
 *         └── G (Started, Alex)    ← running a session: dropped with it
 *
 * Home shows P (it is C's ancestor). P must read as running because G, three levels down on a branch the filter
 * removed, is running. Built from the filtered `issues`, the index has no S or G and P reads as not running.
 *
 * Check it goes red: in server.js move `const stateIssues = issues;` to just after the `if (assigneeName) { … }` block.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { inReadWindow } from '../../lib/read-horizon.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceFetchAndPrepareProjects() {
  const startIdx = SERVER_SRC.indexOf('async function fetchAndPrepareProjects(');
  assert.notEqual(startIdx, -1, 'expected to find fetchAndPrepareProjects in server.js');
  const endIdx = SERVER_SRC.indexOf('\n}\n', startIdx);
  assert.notEqual(endIdx, -1, 'expected the closing brace of fetchAndPrepareProjects');
  const src = SERVER_SRC.slice(startIdx, endIdx + 2);
  assert.equal((src.match(/{/g) || []).length, (src.match(/}/g) || []).length, 'the sliced function must be brace-balanced');
  return src;
}

/** Names that stay faked: I/O, or local to server.js. */
const FAKED = new Set(['getBindingsForWorkspace', 'getProvider', 'getBindingCredentials', 'getBindingCallScope', 'matchTeamId', 'isWorkspaceFeatureEnabled']);

/** `{ localName: {specifier, imported} }` for every named import server.js takes from `./lib/`. */
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

const NOW = new Date('2026-10-31T10:00:00.000Z');
const atMinutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();

const issue = (identifier, type, { parent = null, assignee = null } = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type === 'started' ? 'In Progress' : type === 'backlog' ? 'Backlog' : 'Todo', type },
  parent: parent ? { id: `id-${parent}` } : null,
  assignee: assignee ? { name: assignee } : null,
  project: { id: 'proj-1', name: 'Proj' },
  team: { id: 'team-1' },
  createdAt: atMinutesAgo(600), updatedAt: atMinutesAgo(5),
});

const SET = [
  issue('LIN-1', 'backlog'),
  issue('LIN-2', 'unstarted', { parent: 'LIN-1', assignee: 'Sam' }),
  issue('LIN-3', 'unstarted', { parent: 'LIN-1', assignee: 'Alex' }),
  issue('LIN-4', 'started', { parent: 'LIN-3', assignee: 'Alex' }),
];

const runningLoop = (identifier) => ({
  loopId: 'l1', lineageId: 'l1', issueIdentifier: identifier, kind: 'implementation', iteration: 1,
  source: 'history', historyStatus: 'taken', agentState: 'running',
  dispatchedAt: atMinutesAgo(30), takenAt: atMinutesAgo(30), resolvedAt: atMinutesAgo(30),
  terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
  feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
});

async function runFetch(options) {
  const src = sliceFetchAndPrepareProjects();
  const provider = { fetchTeams: async () => [], fetchProjects: async () => { throw new Error('mockOverride must be used, not the provider'); } };
  const context = vm.createContext({
    ...(await bindImports(src)),
    process,
    console,
    getBindingsForWorkspace: () => [{ provider: 'linear' }],
    getProvider: () => provider,
    getBindingCredentials: () => ({ token: 'test-token' }),
    getBindingCallScope: () => 'call-scope',
    secondaryRemint: { ensureFresh: async () => false, isSecondaryBinding: () => false },
    matchTeamId: () => null,
    isWorkspaceFeatureEnabled: async () => false,
    workspacePreferencesStore: {},
    testMockTeams: [],
    testMockData: { organizationName: 'acme', projects: [], issues: [] },
  });
  const fn = vm.runInContext(`(${src})`, context);
  const priorEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test'; // with the 'test-token' credential, this is the harness's mock branch
  try {
    return await fn({ id: 'ws-1' }, null, { organizationName: 'acme', projects: [{ id: 'proj-1', name: 'Proj', sortOrder: 1 }], issues: SET }, null, options);
  } finally {
    if (priorEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorEnv;
  }
}

const idsOfForest = (trees) => {
  const ids = [];
  const visit = (node) => { ids.push(node.issue.identifier); (node.children || []).forEach(visit); };
  for (const t of trees) [...(t.incomplete || []), ...(t.completed || [])].forEach(visit);
  return ids;
};

describe('LIN-4069 ledger 1: the index is built over the set before the assignee filter (the real seam)', () => {
  test('?assignee=Sam: the filtered trees drop the sibling branch, the held set does not, and P reads running from the dropped G', async () => {
    const fetched = await runFetch({ slim: true, assigneeName: 'Sam' });

    assert.equal(fetched.appliedAssigneeName, 'Sam', 'the filter was applied');
    const shown = idsOfForest(fetched.trees);
    assert.ok(shown.includes('LIN-1') && shown.includes('LIN-2'), `Home shows P and the match C: ${shown}`);
    assert.ok(!shown.includes('LIN-3') && !shown.includes('LIN-4'), `the filter drops the sibling branch from the trees: ${shown}`);

    const held = [...fetched.stateIssues.map((i) => i.identifier)].sort(); // spread: the vm realm's arrays are not this realm's
    assert.deepEqual(held, ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4'], 'stateIssues is the set BEFORE the assignee filter');

    const homeRowStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [runningLoop('LIN-4')].filter((l) => inReadWindow(l.dispatchedAt, NOW)),
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
    });
    const home = await homeRowStates({ urlKey: 'acme', issues: fetched.stateIssues, runControls: true });
    assert.equal(home.states.get('LIN-4').state, 'running', 'G itself runs');
    assert.equal(home.states.get('LIN-1').state, 'running', 'P, three levels above the running G on a branch the filter removed, reads running');
  });

  test('without the filter the same state is read, so the filtered view and the whole view agree', async () => {
    const whole = await runFetch({ slim: true });
    const filtered = await runFetch({ slim: true, assigneeName: 'Sam' });
    assert.deepEqual([...filtered.stateIssues.map((i) => i.identifier)], [...whole.stateIssues.map((i) => i.identifier)]);
  });
});
