/**
 * Rung-7 replay AI-path coverage (LIN-3880).
 *
 * The replay's fakes were written before LIN-3853 moved model routing into a
 * table. A workspace store without `getRoutingTable` made every POST scan, retire,
 * recap and brief die with a 500 before the model call, and the replay still
 * printed `differing: 0`. These pins hold the fakes to the table the production
 * store answers with, hold the Principle 0 seam to its `null` arm, and hold the
 * coverage floor that turns a run which never reaches the model call into a failure.
 *
 * Pure functions only: no server, no socket, no model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableFromPreferences } from '../../lib/model-routing.js';
import { extractPrincipleZeroSection } from '../../lib/prompts/autopilot-manual.js';
import { newRecorder } from '../../experiments/replay-kit/lib/router/common.mjs';
import { evaluateAiCoverage } from '../../experiments/replay-kit/lib/router/ai-coverage.mjs';
import { storeSet, seamHandler, AI_FLOORS, aiCountersFor } from '../../experiments/rebuild-rung7/replay/lib/fakes.mjs';

const libs = { tableFromPreferences };

function sideWith(scStores = {}, sc = {}) {
  const ctx = { sc: { ...sc, stores: scStores, ai: sc.ai || {} }, rec: newRecorder(), callCounts: new Map() };
  return { holder: { ctx }, ctx };
}

// --- the fake store answers getRoutingTable as production does (LIN-3853) ----------

const PREFS = [
  {},
  { modelId: 'anthropic/claude-x' },
  { aiModelOverrides: { byKind: { scan: { model: 'openai/gpt-x' } } } },
  { dispatchDefaults: { byKind: { recap: { model: 'm-recap' } } }, modelId: 'm-chat' },
];
for (const prefs of PREFS) {
  test(`fake getRoutingTable equals tableFromPreferences for ${JSON.stringify(prefs)}`, async () => {
    const { holder } = sideWith({ workspacePreferencesStore: { getWorkspacePreferences: { ret: prefs } } });
    const store = storeSet(holder, libs, { items: [] }).workspacePreferencesStore;
    assert.deepEqual(await store.getRoutingTable('acme'), tableFromPreferences(prefs));
  });
}

test('fake getRoutingTable answers the empty table when getWorkspacePreferences throws', async () => {
  const { holder } = sideWith({ workspacePreferencesStore: { getWorkspacePreferences: { throw: { kind: 'plain', message: 'store down' } } } });
  const store = storeSet(holder, libs, { items: [] }).workspacePreferencesStore;
  assert.deepEqual(await store.getRoutingTable('acme'), tableFromPreferences({}));
});

test('fake getRoutingTable with no scenario preference answers the empty table', async () => {
  const { holder } = sideWith({});
  const store = storeSet(holder, libs, { items: [] }).workspacePreferencesStore;
  assert.deepEqual(await store.getRoutingTable('acme'), tableFromPreferences({}));
});

test('REPLAY_STALE_FAKES reproduces the pre-LIN-3853 store: no routing table, so resolution throws', async () => {
  const { holder } = sideWith({ workspacePreferencesStore: { getWorkspacePreferences: { ret: { modelId: 'x' } } } });
  const store = storeSet(holder, libs, { items: [] }, { staleFakes: true }).workspacePreferencesStore;
  assert.equal(await store.getRoutingTable('acme'), undefined);
});

// --- the Principle 0 seam: null on demand, the real extraction otherwise --------------

test('the P0 seam answers null when the scenario asks for the fail-closed arm', () => {
  const { holder, ctx } = sideWith({}, { ai: { principleZero: null } });
  const handle = seamHandler(holder, libs);
  const got = handle(ctx, 'lib/prompts/autopilot-manual.js', 'extractPrincipleZeroSection', [], () => 'REAL SECTION');
  assert.equal(got, null);
});

test('the P0 seam hands back the real extraction when the scenario does not ask for null', () => {
  const { holder, ctx } = sideWith({}, { ai: {} });
  const handle = seamHandler(holder, libs);
  const got = handle(ctx, 'lib/prompts/autopilot-manual.js', 'extractPrincipleZeroSection', [], extractPrincipleZeroSection);
  assert.equal(typeof got, 'string');
  assert.notEqual(got, null);
});

// --- the coverage floor -----------------------------------------------------------

const FLOORS = [{ key: 'model:scan', min: 1, needs: 'gen' }, { key: 'model:recap', min: 1, needs: 'gen' }];
const EMPTY = { old: {}, new: {} };

test('a run that never reaches the model call fails under the default mode', () => {
  const r = evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['gen'], mode: 'fail' });
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(r.sides.new.missed.map(m => m.key), ['model:scan', 'model:recap']);
  assert.deepEqual(r.sides.new.missed[0], { key: 'model:scan', min: 1, have: 0 });
});

test('warn mode names the same misses but does not fail', () => {
  assert.equal(evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['gen'], mode: 'warn' }).verdict, 'warn');
});

test('off mode records counts and never judges them', () => {
  assert.equal(evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['gen'], mode: 'off' }).verdict, 'off');
});

test('a run that reaches every floor passes', () => {
  const counts = { old: { 'model:scan': 3, 'model:recap': 1 }, new: { 'model:scan': 3, 'model:recap': 1 } };
  assert.equal(evaluateAiCoverage({ counts, floors: FLOORS, tiers: ['gen'], mode: 'fail' }).verdict, 'pass');
});

test('one side short of a floor fails the run', () => {
  const counts = { old: { 'model:scan': 3, 'model:recap': 1 }, new: { 'model:scan': 3 } };
  const r = evaluateAiCoverage({ counts, floors: FLOORS, tiers: ['gen'], mode: 'fail' });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.sides.old.missed.length, 0);
  assert.deepEqual(r.sides.new.missed.map(m => m.key), ['model:recap']);
});

test('a floor needing a tier the run did not execute is listed but not judged', () => {
  const edgeOnly = [{ key: 'arm:p0Null:scan', min: 1, needs: 'edge' }];
  const r = evaluateAiCoverage({ counts: EMPTY, floors: edgeOnly, tiers: ['gen'], mode: 'fail' });
  assert.equal(r.verdict, 'pass');
  assert.equal(r.floors[0].judged, false);
  assert.deepEqual(r.sides.new.missed, []);
});

test('a --only run and a test-only run are skipped, not failed', () => {
  assert.equal(evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['gen'], mode: 'fail', only: true }).verdict, 'skip');
  assert.equal(evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['test'], mode: 'fail' }).verdict, 'skip');
});

test('an unknown floor mode is refused, not silently treated as a mode', () => {
  assert.throws(() => evaluateAiCoverage({ counts: EMPTY, floors: FLOORS, tiers: ['gen'], mode: 'strict' }), /ai floor mode/);
});

test('the shipped floors cover the model call, the store write, every fail-closed arm and every verb on each AI path', () => {
  const keys = AI_FLOORS.map(f => f.key);
  for (const fam of ['scan', 'scan-retire', 'recap', 'brief', 'recommend']) assert.ok(keys.includes(`model:${fam}`), fam);
  assert.ok(keys.includes('store:recordScan'));
  for (const verb of ['OPTIONS', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'GET', 'POST']) assert.ok(keys.includes(`verb:${verb}:scan`), verb);
  assert.ok(keys.includes('arm:p0Null:scan') && keys.includes('arm:p0Null:retire'));
  for (const fam of ['scan', 'retire', 'recap', 'brief']) {
    assert.ok(keys.includes(`arm:notConfigured:${fam}`), fam);
    assert.ok(keys.includes(`arm:upstream503:${fam}`), fam);
  }
});

// --- what a request counts as ----------------------------------------------------

test('aiCountersFor reads a model call, the store write and the fail-closed arm from the outcome', () => {
  const sc = { routeKey: 'POST /workspace/:urlKey/api/scan/:issueId', method: 'POST' };
  const o = {
    status: 503,
    body: { error: 'Scan rubric is temporarily unavailable; nothing was evaluated', code: 'PRINCIPLE_ZERO_UNAVAILABLE' },
    calls: { seams: [{ seam: 'openrouter.streamChat', feature: 'scan' }], store: [{ store: 'taskDecisionsStore', op: 'recordScan' }] },
  };
  const keys = aiCountersFor(sc, o);
  assert.ok(keys.includes('model:scan'));
  assert.ok(keys.includes('store:recordScan'));
  assert.ok(keys.includes('arm:p0Null:scan'));
});

test('aiCountersFor counts the verb a request was sent with on an AI path', () => {
  const sc = { routeKey: 'UNMATCHED', method: 'OPTIONS', verbFamily: 'scan' };
  assert.deepEqual(aiCountersFor(sc, { status: 404, body: {}, calls: {} }), ['verb:OPTIONS:scan']);
});
