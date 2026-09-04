/**
 * LIN-2526: resolveAssigneeSelection(req, provider, scope) — the ?assignee=
 * URL-param resolver. Unlike resolveTeamSelection there is no persistence: an
 * absent/`all` param means unfiltered, a literal name is passed through
 * as-is (options come from the loaded issue set, never free text), and `me`
 * is capability-gated on `provider.supports('viewer')` then resolved via
 * `provider.viewer(scope)`.
 *
 * `me` must degrade SILENTLY to unfiltered — no thrown error, no visible
 * failure page — on two of its three failure paths (provider lacks `viewer`,
 * `viewer()` throws); the third (resolved name matches no loaded issue) is
 * proven separately at the fetchAndPrepareProjects filter seam, since no
 * issues are loaded at this point.
 *
 * server.js is not import-safe in a unit test (connects to Mongo, calls
 * app.listen() at module load — the established constraint documented in
 * tests/unit/lin-2521-resolve-team-selection-wiring.test.js's header and
 * others). resolveAssigneeSelection has no server.js-module-level
 * dependencies beyond `console`, so unlike those source-text-pin siblings
 * this test slices the REAL function and EXECUTES it in a `node:vm` context
 * — genuine behavioral coverage, not just a wiring pin.
 *
 * Run with: node --test tests/unit/lin-2526-resolve-assignee-selection.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceResolveAssigneeSelection() {
  const startMarker = 'async function resolveAssigneeSelection(req, provider, scope) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find resolveAssigneeSelection in server.js');
  const endIdx = SERVER_SRC.indexOf('\n/**\n * Workspace project view', startIdx);
  assert.notEqual(endIdx, -1, 'expected the docstring marker bounding resolveAssigneeSelection — if this fails the function was moved and this harness needs re-anchoring');
  return SERVER_SRC.slice(startIdx, endIdx);
}

function makeProvider({ supportsViewer = false, viewer = null, viewerThrows = null } = {}) {
  return {
    supports: (method) => method === 'viewer' && supportsViewer,
    viewer: async () => {
      if (viewerThrows) throw viewerThrows;
      return viewer;
    }
  };
}

async function resolve(rawAssignee, providerOpts = {}) {
  const context = vm.createContext({ console: { error() {} } });
  const script = [sliceResolveAssigneeSelection(), '', 'resolveAssigneeSelection'].join('\n');
  const fn = vm.runInContext(script, context);
  const req = { query: rawAssignee === undefined ? {} : { assignee: rawAssignee } };
  return fn(req, makeProvider(providerOpts), { token: 'x' });
}

describe('LIN-2526 resolveAssigneeSelection', () => {
  test('absent ?assignee= resolves to unfiltered', async () => {
    const result = await resolve(undefined);
    assert.deepEqual(result, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });

  test('?assignee=all resolves to unfiltered', async () => {
    const result = await resolve('all');
    assert.deepEqual(result, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });

  test('a literal name passes through as-is (sourced from the loaded issue set, never free text)', async () => {
    const result = await resolve('Jane Doe');
    assert.deepEqual(result, { selectedAssignee: 'Jane Doe', resolvedAssigneeName: 'Jane Doe' });
  });

  test('?assignee=me on a viewer-capable provider resolves the viewer\'s display name', async () => {
    const result = await resolve('me', { supportsViewer: true, viewer: { id: 'local-user', name: 'Local User', email: 'local@localhost' } });
    assert.deepEqual(result, { selectedAssignee: 'me', resolvedAssigneeName: 'Local User' });
  });

  test('failure path 1: provider does not support viewer — degrades silently to unfiltered', async () => {
    const result = await resolve('me', { supportsViewer: false });
    assert.deepEqual(result, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });

  test('failure path 2: provider.viewer() throws — degrades silently to unfiltered, never propagates', async () => {
    const result = await resolve('me', { supportsViewer: true, viewerThrows: new Error('upstream blew up') });
    assert.deepEqual(result, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });

  test('a viewer resolving to no name (malformed provider response) degrades silently to unfiltered', async () => {
    const result = await resolve('me', { supportsViewer: true, viewer: { id: 'x', name: null } });
    assert.deepEqual(result, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });
});

describe('LIN-2526 — fetchAndPrepareProjects: a resolved name matching no loaded issue degrades to unfiltered (failure path 3)', () => {
  const body = (() => {
    const startMarker = "async function fetchAndPrepareProjects(workspace, teamId = null, mockOverride = null, urlKey = null, { slim = false, assigneeName = null } = {}) {";
    const startIdx = SERVER_SRC.indexOf(startMarker);
    assert.notEqual(startIdx, -1);
    const afterStart = startIdx + startMarker.length;
    const nextDoc = SERVER_SRC.indexOf('\n/**', afterStart);
    const nextApp = SERVER_SRC.indexOf('\napp.', afterStart);
    const endIdx = Math.min(...[nextDoc, nextApp].filter(i => i !== -1));
    return SERVER_SRC.slice(startIdx, endIdx);
  })();

  test('the narrowing filter is gated on matchedIds.size > 0 — an empty match set skips the filter instead of emptying `issues`', () => {
    assert.match(body, /if \(matchedIds\.size > 0\) \{/,
      'expected the filter application itself to be gated on a non-empty match set, so a `me` viewer with zero assigned issues (or any name matching nothing) renders the full unfiltered set rather than an empty dashboard');
  });
});
