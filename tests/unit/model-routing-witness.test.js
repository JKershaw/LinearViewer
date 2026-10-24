/**
 * The witness for LIN-3853: the model-routing store answers exactly as the resolvers did
 * at 6ea1371e, for every job in the registry, over a matrix of stored preferences.
 *
 * Old side: tests/unit/helpers/frozen-resolvers-6ea1371e.js (verbatim copies). New side:
 * the live resolvers over a real WorkspacePreferencesStore + ModelRoutingStore (the lazy
 * migration included) on memory collections. Every cell must be equal unless it is listed
 * in INTENDED_DIFFERENCES, whose only permitted tickets are D2 (LIN-3856) and D3 (LIN-3857),
 * each added by its own PR. This PR lands with the table empty.
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
import { resolveWorkspaceModel, resolveAiOperationModel, resolveDispatchDefaults } from '../../lib/workspace-preferences.js';
import { resolveRouting, createDispatchItem } from '../../lib/dispatch-factory.js';
import * as frozen from './helpers/frozen-resolvers-6ea1371e.js';
import { routingFixture } from './helpers/routing-fakes.js';

/** Named, reviewed differences between old and new. Entries: `{ ticket: 'D2'|'D3', cell, reason }`. */
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
  // Unrouted today (LIN-3856): hard-coded, no clamp, no store.
  ...Object.fromEntries(UNROUTED_JOBS.map((id) => [id, async () => DEFAULT_MODEL]))
};

const cellCount = new Map();
const hit = (job) => cellCount.set(job, (cellCount.get(job) || 0) + 1);
const allowed = (cell) => INTENDED_DIFFERENCES.some((d) => d.cell === cell);

async function fixtureFor(index, prefs) {
  const fx = routingFixture();
  const urlKey = `ws-${index}`;
  await fx.prefs.insertOne({ _id: urlKey, preferences: structuredClone(prefs) });
  return { ...fx, urlKey, oldStore: { getWorkspacePreferences: async () => structuredClone(prefs) } };
}

const FREE_TIER_MODEL = AVAILABLE_MODELS.find((m) => m.id !== DEFAULT_MODEL)?.id;

describe('witness: the store answers as the resolvers did at 6ea1371e', () => {
  test('the intended-differences table is empty, and could only ever hold D2 and D3', () => {
    assert.deepEqual(INTENDED_DIFFERENCES, []);
    for (const d of INTENDED_DIFFERENCES) assert.ok(PERMITTED_TICKETS.includes(d.ticket));
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
              const next = UNROUTED_JOBS.includes(job.id)
                ? DEFAULT_MODEL // nothing reads the store for it; the effective-setting read says so
                : await resolveAiOperationModel({ urlKey: fx.urlKey, workspacePreferencesStore: fx.preferencesStore, opKind: job.id, forceDefault });
              hit(job.id);
              if (!allowed(cell)) assert.equal(next, old, cell);
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
                if (!allowed(cell)) assert.deepEqual(next, old, cell);
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

  test('the precompute and run-paragraph stay unrouted: the gap is LIN-3856, not decided here', () => {
    const precompute = readFileSync(new URL('../../lib/session-materializer-precompute.js', import.meta.url), 'utf8');
    assert.ok(!/workspace-preferences|model-routing/.test(precompute), 'D2 (LIN-3856) routes the precompute, with its own intended-difference row');
    assert.deepEqual([...UNROUTED_JOBS], ['run-paragraph']);
  });

  // Last on purpose: it reads the counters the matrix tests filled in.
  test('coverage gate: every job in the registry has matrix cells', () => {
    const uncovered = JOBS.filter((j) => !cellCount.get(j.id)).map((j) => j.id);
    assert.deepEqual(uncovered, [], 'a job added to the registry needs matrix coverage in this witness');
  });
});
