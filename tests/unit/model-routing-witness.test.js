/**
 * The witness for LIN-3853: the model-routing store answers exactly as the resolvers did
 * at 6ea1371e, for every job in the registry, over a matrix of stored preferences.
 *
 * Old side: tests/unit/helpers/frozen-resolvers-6ea1371e.js (verbatim copies). New side:
 * the live resolvers over a real WorkspacePreferencesStore + ModelRoutingStore (the lazy
 * migration included) on memory collections. Every cell must be equal unless it is listed
 * in INTENDED_DIFFERENCES, whose only permitted tickets are D2 (LIN-3856) and D3 (LIN-3857),
 * each added by its own PR. LIN-3857 adds the D3 rule (opencode rows: effort becomes null and is
 * reported as not applied). LIN-3856 adds the D2 entries (run-paragraph, and the
 * session-summary precompute path); a listed cell must equal its `expect`, every other
 * cell must still equal the old side.
 *
 * Run with: node --test tests/unit/model-routing-witness.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '../../lib/openrouter.js';
import { JOBS } from '../../lib/llm-jobs.js';
import { AI_OPERATION_KINDS, UNROUTED_JOBS } from '../../lib/model-routing.js';
import { DEFAULT_SESSION_SUMMARY_MODEL } from '../../lib/session-summary.js';
import { createSessionSummaryPrecompute } from '../../lib/session-materializer-precompute.js';
import { resolveWorkspaceModel, resolveAiOperationModel, resolveDispatchDefaults, jobModelResolver } from '../../lib/workspace-preferences.js';
import { resolveRouting, createDispatchItem } from '../../lib/dispatch-factory.js';
import * as frozen from './helpers/frozen-resolvers-6ea1371e.js';
import { routingFixture } from './helpers/routing-fakes.js';

/**
 * Named, reviewed differences between old and new. Entries:
 * `{ ticket: 'D2'|'D3', cell, reason, expect }`, `expect` being what the new side must answer.
 * The D2 rows are built from D2_EXPECT below, a hand table (not a pattern that only exempts).
 */
export const INTENDED_DIFFERENCES = [];
const PERMITTED_TICKETS = ['D2', 'D3'];

// ---- the matrix of stored preferences --------------------------------------

const PREFS = {
  empty: {},
  'workspace model only': { modelId: 'anthropic/ws-model' },
  'workspace-wide dispatch only': { dispatchDefaults: { model: 'top-m', harness: 'claude-code', effort: 'high' } },
  'workspace-wide model only': { dispatchDefaults: { model: 'top-m' } },
  'partial per-kind rows': {
    modelId: 'anthropic/ws-model',
    dispatchDefaults: { model: 'top-m', byKind: { implementation: { model: 'impl-m' }, review: { harness: 'opencode' }, autopilot: { effort: 'low' }, plan: {} } }
  },
  'rows scoped to the other harness (LIN-1694)': {
    dispatchDefaults: { model: 'top-m', byKind: { implementation: { model: 'oc-m', harness: 'opencode' }, review: { model: 'cc-m', harness: 'claude-code', effort: 'max' } } }
  },
  'scoped row above an unscoped top row': {
    dispatchDefaults: { harness: 'claude-code', model: 'cc-top', effort: 'mid', byKind: { implementation: { harness: 'opencode', model: 'oc-m', effort: 'xhigh' }, bug: { model: 'bug-m' } } }
  },
  'opencode top row, claude-code kind rows': {
    dispatchDefaults: { harness: 'opencode', model: 'oc-top', byKind: { triage: { harness: 'claude-code', model: 'cc-triage' }, research: { effort: 'high' } } }
  },
  'empty strings everywhere': {
    modelId: '',
    dispatchDefaults: { model: '', harness: '', effort: '', byKind: { implementation: { model: '', harness: '', effort: '' }, review: { model: 'r-m' } } },
    aiModelOverrides: { byKind: { recommend: { model: '' }, scan: { model: '' } } }
  },
  // LIN-3853 review F2: a blank per-op override above a NON-blank modelId. Old code
  // falls through on `||`; a `??`/`!== undefined` unification would return ''.
  'blank per-op override above a non-blank modelId': {
    modelId: 'anthropic/ws-model',
    aiModelOverrides: { byKind: { recommend: { model: '' }, scan: { model: '' } } }
  },
  'null values': { modelId: null, dispatchDefaults: { model: null, harness: null, byKind: { implementation: null, bug: { model: null } } } },
  'stray byKind for custom / periodical / non-op keys': {
    modelId: 'anthropic/ws-model',
    dispatchDefaults: { model: 'top-m', byKind: { custom: { model: 'c-m' }, periodical: { harness: 'opencode' }, bogus: { model: 'b-m' }, defer: { model: 'd-m' } } },
    aiModelOverrides: { byKind: { 'feedback-title': { model: 'ft-m' }, roadmap: { model: 'r-m' }, nonsense: { model: 'n-m' } } }
  },
  'a scan override': { modelId: 'anthropic/ws-model', aiModelOverrides: { byKind: { scan: { model: 'anthropic/scan-m' } } } },
  'a scan override and no workspace model': { aiModelOverrides: { byKind: { scan: { model: 'anthropic/scan-m' } } } },
  'every operation overridden': {
    modelId: 'anthropic/ws-model',
    aiModelOverrides: { byKind: Object.fromEntries(AI_OPERATION_KINDS.map((op) => [op, { model: `anthropic/${op}-m` }])) }
  },
  'everything set': {
    modelId: 'anthropic/ws-model',
    dispatchDefaults: { model: 'top-m', harness: 'claude-code', effort: 'high', byKind: { implementation: { model: 'impl-m', harness: 'claude-code' }, autopilot: { harness: 'opencode', model: 'ap-m' } } },
    aiModelOverrides: { byKind: { recommend: { model: 'anthropic/rec-m' }, 'task-chat': { model: 'anthropic/tc-m' } } }
  }
};

const NON_JOB_KINDS = ['defer', null, 'not-a-kind'];
const AGENT_KINDS = [...JOBS.filter((j) => j.surface === 'agent-session').map((j) => j.id), ...NON_JOB_KINDS];

const EXPLICIT = [{}, { model: 'x-model' }, { harness: 'claude-code' }, { harness: 'opencode', model: 'x-model', effort: 'x-effort' }];
const PRESETS = [
  null,
  { config: { model: 'p-model', harness: 'opencode' } },
  { config: { harness: 'claude-code', byKind: { implementation: { model: 'p-impl', harness: 'claude-code' }, review: { effort: 'p-eff' } } } }
];
const ANCHORS = [
  null,
  { presetConfig: { model: 'a-model', byKind: { plan: { harness: 'opencode' } } } },
  { harness: 'opencode' },
  { harness: 'claude-code', presetConfig: { effort: 'a-eff' } }
];

// How the old code resolved each Harbour job. A Harbour job missing here fails the gate.
const WORKSPACE_WIDE_ONLY = ['feedback-title', 'roadmap', 'roadmap-orientation', 'roadmap-chat', 'observer-pass'];
const HARBOUR_OLD = {
  ...Object.fromEntries(AI_OPERATION_KINDS.map((op) => [op, (args) => frozen.resolveAiOperationModel({ ...args, opKind: op })])),
  // workspace-api.js read the `scan` override for the retire re-scan as well.
  'scan-retire': (args) => frozen.resolveAiOperationModel({ ...args, opKind: 'scan' }),
  ...Object.fromEntries(WORKSPACE_WIDE_ONLY.map((id) => [id, (args) => frozen.resolveWorkspaceModel(args)])),
  // Frozen old side (LIN-3856): run-paragraph was hard-coded, no clamp, no store.
  'run-paragraph': async () => DEFAULT_MODEL
};

const cellCount = new Map();
const seenDiffs = new Set();
const hit = (job) => cellCount.set(job, (cellCount.get(job) || 0) + 1);

async function fixtureFor(index, prefs) {
  const fx = routingFixture();
  const urlKey = `ws-${index}`;
  await fx.prefs.insertOne({ _id: urlKey, preferences: structuredClone(prefs) });
  return { ...fx, urlKey, oldStore: { getWorkspacePreferences: async () => structuredClone(prefs) } };
}

const FREE_TIER_MODEL = AVAILABLE_MODELS.find((m) => m.id !== DEFAULT_MODEL)?.id;

// LIN-3856 (D2): the one hand-written table of what changed. `run-paragraph` was
// hard-coded to DEFAULT_MODEL with no clamp; it now resolves like every other job.
// PAID: the model the job's stored settings give (the `tell` group default, which the
// migration seeds from the workspace `modelId`); sets that name none still answer
// DEFAULT_MODEL and so are not listed. FREE: with a curated OPENROUTER_FREE_TIER_MODEL the
// clamp answers it whatever is stored; without one the clamp is DEFAULT_MODEL (no change).
const D2_PAID = {
  'workspace model only': 'anthropic/ws-model',
  'partial per-kind rows': 'anthropic/ws-model',
  'blank per-op override above a non-blank modelId': 'anthropic/ws-model',
  'stray byKind for custom / periodical / non-op keys': 'anthropic/ws-model',
  'a scan override': 'anthropic/ws-model',
  'every operation overridden': 'anthropic/ws-model',
  'everything set': 'anthropic/ws-model'
};
for (const [name, expect] of Object.entries(D2_PAID)) {
  for (const freeModel of [undefined, FREE_TIER_MODEL]) {
    INTENDED_DIFFERENCES.push({ ticket: 'D2', cell: `harbour/run-paragraph/${name}/free=false/freeModel=${freeModel}`, reason: 'a paid key resolves the job setting, not DEFAULT_MODEL', expect });
  }
}
for (const name of Object.keys(PREFS)) {
  INTENDED_DIFFERENCES.push({ ticket: 'D2', cell: `harbour/run-paragraph/${name}/free=true/freeModel=${FREE_TIER_MODEL}`, reason: 'a free key takes the free-tier clamp', expect: FREE_TIER_MODEL });
}
// LIN-3857 (D3): the one rule entry. INTENDED_DIFFERENCES holds hand-listed cells, which cannot say
// "every opencode row", so this is a rule: where the old side resolved an effort on the opencode
// harness, the new side stamps effort null and reports what was asked for. `layer` is one of the four
// tiers; which one is pinned per tier by tests/unit/dispatch-factory-effort-not-applied.test.js.
const EFFORT_LAYERS = ['explicit', 'preset', 'anchor', 'workspace'];
const D3_RULE = {
  ticket: 'D3',
  cell: 'agent/*/opencode-effort',
  reason: 'opencode has no effort control: the effort that runs is null, and the one asked for is reported as not applied',
  applies: (old) => old.harness === 'opencode' && Boolean(old.effort),
  expect: (old) => ({ ...old, effort: null, effortNotApplied: { requested: old.effort, harness: 'opencode', layer: EFFORT_LAYERS } })
};
INTENDED_DIFFERENCES.push(D3_RULE);
let d3RuleHits = 0;
const diffFor = (cell) => INTENDED_DIFFERENCES.find((d) => d.cell === cell);

describe('witness: the store answers as the resolvers did at 6ea1371e', () => {
  test('the intended-differences table holds only D2 and D3 entries, none vacuous', async () => {
    assert.ok(INTENDED_DIFFERENCES.length > 0);
    for (const d of INTENDED_DIFFERENCES) assert.ok(PERMITTED_TICKETS.includes(d.ticket));
    // Every entry's expectation differs from the old side (no exemption that changes nothing).
    for (const d of INTENDED_DIFFERENCES) assert.notEqual(d.expect, DEFAULT_MODEL, d.cell);
    assert.ok(INTENDED_DIFFERENCES.some((d) => d.ticket === 'D3'), 'the D3 entry is present');
  });

  test('Harbour calls: every job, every stored preference, free tier on and off', async () => {
    const saved = process.env.OPENROUTER_FREE_TIER_MODEL;
    try {
      let index = 0;
      for (const [name, prefs] of Object.entries(PREFS)) {
        const fx = await fixtureFor(index++, prefs);
        for (const freeTierModel of [undefined, FREE_TIER_MODEL]) {
          if (freeTierModel === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
          else process.env.OPENROUTER_FREE_TIER_MODEL = freeTierModel;
          for (const forceDefault of [false, true]) {
            for (const job of JOBS.filter((j) => j.surface === 'harbour-call')) {
              const oldFn = HARBOUR_OLD[job.id];
              assert.ok(oldFn, `Harbour job "${job.id}" has no old-side resolver in the witness: add its matrix coverage`);
              const cell = `harbour/${job.id}/${name}/free=${forceDefault}/freeModel=${freeTierModel}`;
              const old = await oldFn({ urlKey: fx.urlKey, workspacePreferencesStore: fx.oldStore, forceDefault });
              const next = await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, opKind: job.id, forceDefault });
              hit(job.id);
              const diff = diffFor(cell);
              assert.equal(next, diff ? diff.expect : old, cell);
              if (diff) seenDiffs.add(cell);
            }
            // Callers with no job: the workspace-wide value, and kinds the table does not know.
            const cell = `harbour/job-less/${name}/free=${forceDefault}`;
            assert.equal(
              await resolveWorkspaceModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, forceDefault }),
              await frozen.resolveWorkspaceModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.oldStore, forceDefault }),
              cell
            );
          }
        }
      }
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
      else process.env.OPENROUTER_FREE_TIER_MODEL = saved;
    }
  });

  test('agent sessions: every job and non-job kind, explicit fields, presets, anchors, default harness on and off', async () => {
    let index = 100;
    for (const [name, prefs] of Object.entries(PREFS)) {
      const fx = await fixtureFor(index++, prefs);
      for (const kind of AGENT_KINDS) {
        for (const explicit of EXPLICIT) {
          for (const preset of PRESETS) {
            for (const anchor of ANCHORS) {
              for (const applyDefaultHarness of [false, true]) {
                const args = { urlKey: fx.urlKey, kind, ...explicit, preset, anchor, applyDefaultHarness };
                const cell = `agent/${kind}/${name}/${JSON.stringify([explicit, !!preset, anchor, applyDefaultHarness])}`;
                const old = await frozen.resolveRouting({ ...args, workspacePreferencesStore: fx.oldStore });
                const next = await resolveRouting({ ...args, workspacePreferencesStore: fx.preferencesStore });
                hit(kind);
                if (D3_RULE.applies(old)) {
                  d3RuleHits++;
                  const want = D3_RULE.expect(old);
                  const { layer, ...reported } = next.effortNotApplied || {};
                  assert.ok(EFFORT_LAYERS.includes(layer), `${cell}: layer ${layer}`);
                  assert.deepEqual({ ...next, effortNotApplied: reported }, { ...want, effortNotApplied: { requested: old.effort, harness: 'opencode' } }, cell);
                } else {
                  assert.deepEqual(next, old, cell);
                }
              }
            }
          }
        }
      }
      // The bare resolver the dispatch page and feedback widget call, with and without a harness in force.
      for (const kind of [...AGENT_KINDS, undefined]) {
        for (const harnessInForce of [null, 'claude-code', 'opencode']) {
          const old = await frozen.resolveDispatchDefaults({ urlKey: fx.urlKey, kind, store: fx.oldStore, harnessInForce });
          const next = await resolveDispatchDefaults({ urlKey: fx.urlKey, kind, store: fx.preferencesStore, harnessInForce });
          assert.deepEqual(next, old, `dispatch-defaults/${kind}/${name}/${harnessInForce}`);
        }
      }
    }
  });

  test('the store-less branch (a bare { getWorkspacePreferences } fake) answers like the store', async () => {
    let index = 200;
    for (const [name, prefs] of Object.entries(PREFS)) {
      const fx = await fixtureFor(index++, prefs);
      for (const kind of AGENT_KINDS) {
        assert.deepEqual(
          await resolveDispatchDefaults({ urlKey: fx.urlKey, kind, store: fx.oldStore }),
          await resolveDispatchDefaults({ urlKey: fx.urlKey, kind, store: fx.preferencesStore }),
          `${kind}/${name}`
        );
      }
      for (const job of JOBS.filter((j) => j.surface === 'harbour-call')) {
        assert.equal(
          await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.oldStore, opKind: job.id }),
          await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, opKind: job.id }),
          `${job.id}/${name}`
        );
      }
    }
  });

  test('a scan override also reaches scan-retire, as the retire route read it', async () => {
    const fx = await fixtureFor(300, PREFS['a scan override']);
    for (const opKind of ['scan', 'scan-retire']) {
      assert.equal(await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, opKind }), 'anthropic/scan-m');
    }
  });

  test('through createDispatchItem the stamped row carries the resolved routing and the job id', async () => {
    const fx = await fixtureFor(400, PREFS['everything set']);
    const captured = {};
    const store = { addItem: async (urlKey, item) => { captured.item = item; return { _id: 'i1', ...item }; } };
    await createDispatchItem({ store, urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, kind: 'implementation', prompt: 'x' });
    const old = await frozen.resolveRouting({ urlKey: fx.urlKey, kind: 'implementation', workspacePreferencesStore: fx.oldStore, applyDefaultHarness: true });
    assert.equal(captured.item.model, old.model);
    assert.equal(captured.item.harness, old.harness);
    assert.equal(captured.item.effort, old.effort);
    assert.equal(captured.item.jobId, 'implementation');
  });

  test('precompute/session-summary: the old side is the DEFAULT_MODEL alias; free gets the clamp, paid the job setting (D2)', async () => {
    const saved = process.env.OPENROUTER_FREE_TIER_MODEL;
    try {
      let index = 500;
      for (const [name, prefs] of Object.entries(PREFS)) {
        const fx = await fixtureFor(index++, prefs);
        const resolveModel = jobModelResolver(fx.preferencesStore);
        for (const freeModel of [undefined, FREE_TIER_MODEL]) {
          if (freeModel === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
          else process.env.OPENROUTER_FREE_TIER_MODEL = freeModel;
          for (const isFreeTier of [false, true]) {
            const called = [];
            const sessionSummaryStore = { get: async () => null, put: async () => {} };
            const pre = createSessionSummaryPrecompute({
              sessionSummaryStore,
              isTerminal: () => true,
              resolveModel,
              freeTierStore: { tryUse: async () => ({ allowed: true }) }, // LIN-3875: the free cell must pass the gate to reach the model
              generateSummary: async (_s, opts) => { called.push(opts.model); return { summary: {}, model: opts.model }; }
            });
            await pre(fx.urlKey, { sessionId: 's' }, { apiKey: 'k', isFreeTier });
            // What the on-demand route resolves for the same inputs: the new side must agree.
            const expected = await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, opKind: 'session-summary', forceDefault: isFreeTier });
            const cell = `precompute/session-summary/${name}/free=${isFreeTier}/freeModel=${freeModel}`;
            assert.deepEqual(called, [expected], cell);
            if (isFreeTier && freeModel) assert.equal(called[0], freeModel, cell);
            // Nothing stored, or the clamp without a curated id: the old default (a live alias of DEFAULT_MODEL).
            if (expected === DEFAULT_MODEL) assert.equal(called[0], DEFAULT_SESSION_SUMMARY_MODEL, cell);
            hit('session-summary');
          }
        }
      }
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
      else process.env.OPENROUTER_FREE_TIER_MODEL = saved;
    }
  });

  test('UNROUTED_JOBS is empty and server.js hands both precomputes jobModelResolver(workspacePreferencesStore)', () => {
    assert.deepEqual([...UNROUTED_JOBS], []);
    const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const m = server.match(/const (\w+) = jobModelResolver\(workspacePreferencesStore\)/);
    assert.ok(m, 'server.js builds the resolver from the production export');
    const closure = new RegExp(`createRunParagraphPrecompute\\(\\{[^}]*resolveModel: ${m[1]}[^}]*\\}\\)`);
    const summary = new RegExp(`createSessionSummaryPrecompute\\(\\{[^}]*resolveModel: ${m[1]}[^}]*\\}\\)`);
    assert.match(server, closure);
    assert.match(server, summary);
  });

  test('every D2 entry was exercised by the matrix', () => {
    for (const d of INTENDED_DIFFERENCES.filter((e) => e.ticket === 'D2')) assert.ok(seenDiffs.has(d.cell), `unused D2 entry: ${d.cell}`);
  });

  // LIN-3857: the D3 rule is not vacuous, and the matrix holds the preset/anchor cell the plan review found.
  test('the D3 rule matched opencode cells in the matrix', () => {
    assert.ok(d3RuleHits > 0, 'the D3 opencode-effort rule matched nothing');
  });

  // Last on purpose: it reads the counters the matrix tests filled in.
  test('coverage gate: every job in the registry has matrix cells', () => {
    const uncovered = JOBS.filter((j) => !cellCount.get(j.id)).map((j) => j.id);
    assert.deepEqual(uncovered, [], 'a job added to the registry needs matrix coverage in this witness');
  });
});
