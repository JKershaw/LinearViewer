/**
 * LIN-3966: the LIN-1694 crossed pair (a model read from a row scoped to one harness, stamped
 * against another) must not reach a run from the callers that do not settle the harness first:
 * the proxy lanes (proxy, kickoff), the close-out press (`entryRung`, no `surface`) and the dispatch
 * page (neither field).
 *
 * The cause is `resolveFields` (lib/model-routing.js): with no harness in force, a row's model and
 * effort were read against nothing, so a row scoped to another harness donated across the harness
 * the rows themselves state. The fix keys eligibility on that stated harness (a stated blank being the
 * default harness, which is what runs).
 *
 * Witnesses, each shown red before the change and green after (the `red` tests name the probe rows):
 *  - the crossed table through the proxy lane, the kickoff, the close-out press and the dispatch page;
 *  - the stamp's harness and bootstrap token are unchanged (only the crossed model is dropped);
 *  - the blank shapes (`''`, whitespace) that the review found, through the table, the legacy
 *    migration and a preset;
 *  - the LIN-1111 blank-donates pins and the surface-settled results, which stay green.
 *
 * Run with: node --test tests/unit/lin-3966-crossed-pair-lanes.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { enterSessionDispatch } from '../../lib/dispatch-entrance.js';
import { resolveRoutingWithSources } from '../../lib/dispatch-factory.js';
import { emptyTable, resolveFromRows, tableFromPreferences } from '../../lib/model-routing.js';
import { BASE_DEPS, call } from './lib/proxy-fake-deps.js';
import { routingFixture } from './helpers/routing-fakes.js';

const MODEL = 'deepseek/deepseek-v4-pro';
const BOOTSTRAP = 'bootstrap-token-1';

// The LIN-1694 crossed table: the job row states claude-code, the steer group states opencode with a model.
function crossedTable(job = 'autopilot', jobRow = { harness: 'claude-code' }) {
  const table = emptyTable();
  table.jobs[job] = jobRow;
  table.groups['agent-session'].steer = { harness: 'opencode', model: MODEL };
  return table;
}

// The close-out press resolves `jobs['close-out']` and group `make` (lib/llm-jobs.js).
function closeOutTable(jobRow, { crossed = true } = {}) {
  const table = emptyTable();
  table.jobs['close-out'] = jobRow;
  if (crossed) table.groups['agent-session'].make = { harness: 'opencode', model: MODEL };
  return table;
}

const storeWith = (table) => ({ getRoutingTable: async () => table });
const proxyStore = (table) => ({ getWorkspacePreferences: async () => ({}), ...storeWith(table) });

// The proxy lane (`POST /api/proxy/dispatch`) and kickoff, through the real composer. Returns the row
// the lane stored and the receipt.
async function proxyRow(path, body, table) {
  const captured = {};
  const deps = {
    ...BASE_DEPS(),
    workspacePreferencesStore: proxyStore(table),
    dispatchQueueStore: {
      ...BASE_DEPS().dispatchQueueStore,
      addItem: async (_urlKey, item) => { captured.item = item; return { _id: 'disp-1', ...item }; }
    },
    proxyTokenStore: {
      ...BASE_DEPS().proxyTokenStore,
      createToken: async () => ({ token: BOOTSTRAP, kind: 'bootstrap', scope: 'readWrite' }),
      mintGrantBootstrap: async () => ({ token: BOOTSTRAP, kind: 'bootstrap', scope: 'readWrite' })
    }
  };
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes(deps));
  const res = await call(app, 'POST', path, { body });
  assert.equal(res.status, 201, `${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return captured.item;
}

// The close-out press (`enterSessionDispatch`), no `surface`: the payload of public/close-out.js.
async function pressRow(body, table) {
  let row = null;
  const responses = [];
  const res = {
    status(code) { responses.push({ status: code }); return this; },
    json(payload) { responses.at(-1).body = payload; return this; },
    set() { return this; }
  };
  await enterSessionDispatch({
    req: {
      body: { prompt: 'p', target: 'cli', issueIdentifier: 'LIN-1', issueId: 'issue-1', ...body },
      session: { accountId: 'acct-owner' },
      protocol: 'http',
      get: () => 'localhost:3000'
    },
    res,
    workspace: { urlKey: 'alpha', id: 'ws-alpha' },
    ownerGate: async () => false,
    dispatchQueueStore: {
      addItem: async (_urlKey, fields) => { row = fields; return { _id: 'item-1', ...fields }; },
      expandCascadeAborts: async () => ({}),
      getItemStatus: async () => null
    },
    dispatchTokenStore: { listTokens: async () => [] },
    proxyTokenStore: { createToken: async () => ({ token: BOOTSTRAP }) },
    dispatchPresetsStore: { get: async () => null },
    workspacePreferencesStore: storeWith(table),
    afterEnqueue: async () => undefined
  });
  assert.equal(responses[0]?.status, 201, `the press answered ${responses[0]?.status}: ${JSON.stringify(responses[0]?.body)}`);
  return row;
}

// The dispatch page's payload: neither `surface` nor `entryRung`.
const PAGE = { kind: 'autopilot' };
const CLOSE_OUT = { kind: 'close-out', promptName: 'close-out', entryRung: 'run-step' };

// Proxy-style resolution: the default-harness interpose on, no settle (what the proxy lanes do).
const proxyResolve = (args) => resolveRoutingWithSources({ urlKey: 'acme', applyDefaultHarness: true, ...args });

describe('LIN-3966 — the proxy lanes do not stamp a model across the harness the rows state', () => {
  // red: at HEAD the proxy stamps claude-code + deepseek (the opencode-scoped row's model).
  test('proxy lane, crossed table: stamps claude-code and no model', async () => {
    const row = await proxyRow('/api/proxy/dispatch', { prompt: 'run me', kind: 'autopilot' }, crossedTable());
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
  });

  // red: the same lane through the kickoff route.
  test('kickoff, crossed table: stamps claude-code and no model', async () => {
    const row = await proxyRow('/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli' }, crossedTable());
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
  });

  // red: the blank job row, which the review found still crosses on the proxy lane.
  test('proxy lane, job row stating a blank harness over the opencode group: claude-code and no model', async () => {
    const row = await proxyRow('/api/proxy/dispatch', { prompt: 'run me', kind: 'autopilot' }, crossedTable('autopilot', { harness: '' }));
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
  });

  // red: the whitespace-only harness is blank too (applyDefaultDispatchHarness trims), so it must not
  // key eligibility on the literal ' ' and drop a runnable pair.
  test('proxy lane, job row stating a whitespace harness over the opencode group: claude-code and no model', async () => {
    const row = await proxyRow('/api/proxy/dispatch', { prompt: 'run me', kind: 'autopilot' }, crossedTable('autopilot', { harness: ' ' }));
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
  });

  // green: a row scoped to the harness it stamps keeps its model (the donate rule is unchanged for a match).
  test('proxy lane, a table whose own harness is opencode keeps its model', async () => {
    const table = emptyTable();
    table.groups['agent-session'].steer = { harness: 'opencode', model: MODEL };
    const row = await proxyRow('/api/proxy/dispatch', { prompt: 'run me', kind: 'autopilot' }, table);
    assert.equal(row.harness, 'opencode');
    assert.equal(row.model, MODEL);
  });
});

describe('LIN-3966 — the close-out press keeps its stamp and token, and drops the crossed model', () => {
  // The control: the same job row with no crossed group. Its stamp and token are what the crossed
  // press must keep (the ticket's acceptance: the stamp and token path are unchanged).
  const control = () => pressRow(CLOSE_OUT, closeOutTable({ harness: 'claude-code' }, { crossed: false }));

  // red: at HEAD the press stamps claude-code + deepseek.
  test('crossed table: harness claude-code, model null, and the token equals the uncrossed press', async () => {
    const row = await pressRow(CLOSE_OUT, closeOutTable({ harness: 'claude-code' }));
    const base = await control();
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
    assert.equal(row.bootstrapToken ?? null, base.bootstrapToken ?? null, 'the token path is the one the uncrossed press takes');
  });

  // red: the blank job row, the case the review found still crossed on the press (the stamp stays '').
  test('crossed table, job row stating a blank harness: harness stays blank, model null, token equals the uncrossed press', async () => {
    const row = await pressRow(CLOSE_OUT, closeOutTable({ harness: '' }));
    const base = await pressRow(CLOSE_OUT, closeOutTable({ harness: '' }, { crossed: false }));
    assert.equal(row.harness, '');
    assert.equal(row.model, null);
    assert.equal(row.bootstrapToken ?? null, base.bootstrapToken ?? null);
  });

  // green: an empty table keeps the null passthrough (the press stamps null when nothing states a harness).
  test('empty table: harness null and model null, as before', async () => {
    const row = await pressRow(CLOSE_OUT, emptyTable());
    assert.equal(row.harness, null);
    assert.equal(row.model, null);
    assert.ok(!row.bootstrapToken);
  });
});

describe('LIN-3966 — the dispatch page (neither surface nor entryRung)', () => {
  // red: the page crosses in the same way as the proxy lane at HEAD.
  test('crossed table: the model is not the opencode row\'s model', async () => {
    const row = await pressRow(PAGE, crossedTable());
    assert.equal(row.harness, 'claude-code', 'the harness the job row states');
    assert.equal(row.model, null);
  });

  // green: blank = send null is kept for an empty table.
  test('empty table: harness and model stay null (blank = send null)', async () => {
    const row = await pressRow(PAGE, emptyTable());
    assert.equal(row.harness, null);
    assert.equal(row.model, null);
  });
});

describe('LIN-3966 — the blank shapes the review found, through the legacy migration and a preset', () => {
  // red: legacy preferences copy the top-level harness and model into every group, so a byKind row that
  // states '' sits above an opencode-scoped model. This is how a crossed table exists in production.
  test('legacy prefs, byKind row stating a blank harness: proxy lane stamps claude-code and no model', async () => {
    const fx = routingFixture();
    await fx.prefs.insertOne({
      _id: 'acme',
      preferences: { dispatchDefaults: { harness: 'opencode', model: MODEL, byKind: { autopilot: { harness: '' } } } }
    });
    const routing = await proxyResolve({ kind: 'autopilot', workspacePreferencesStore: fx.preferencesStore });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, null);
  });

  // red: the non-blank form of the same legacy shape.
  test('legacy prefs, byKind row stating claude-code: proxy lane stamps claude-code and no model', async () => {
    const fx = routingFixture();
    await fx.prefs.insertOne({
      _id: 'acme',
      preferences: { dispatchDefaults: { harness: 'opencode', model: MODEL, byKind: { autopilot: { harness: 'claude-code' } } } }
    });
    const routing = await proxyResolve({ kind: 'autopilot', workspacePreferencesStore: fx.preferencesStore });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, null);
  });

  // red: a preset whose byKind row states '' above its own opencode model, resolved on an empty table.
  test('preset with a blank byKind harness over an opencode model: proxy lane stamps claude-code and no model', async () => {
    const preset = { id: 'careful', name: 'Careful', config: { harness: 'opencode', model: MODEL, byKind: { autopilot: { harness: '' } } } };
    const routing = await proxyResolve({ kind: 'autopilot', preset, anchor: null, workspacePreferencesStore: storeWith(emptyTable()) });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, null);
  });

  // green (LIN-1111): a bare harness-less row above a model still donates; a blank row inherits.
  test('LIN-1111 pins: a blank row above a bare model still donates it, and a harness-less row takes the scoped harness', () => {
    assert.deepEqual(resolveFromRows([{ harness: '' }, { model: 'bare' }]), { harness: '', model: 'bare', effort: null });
    assert.deepEqual(resolveFromRows([{}, { harness: 'opencode', model: 'm' }]), { harness: 'opencode', model: 'm', effort: null });
    assert.deepEqual(
      resolveFromRows([{ harness: '' }, { harness: 'claude-code', model: 'opus' }]),
      { harness: '', model: 'opus', effort: null }
    );
  });

  // green: the settled (opened-task) result for a blank row is unchanged by the fix.
  test('the surface-settled result for a blank job row over the opencode group is claude-code and no model', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(crossedTable('autopilot', { harness: '' })),
      applyDefaultHarness: true, settleHarness: true
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, null);
  });

  // red, and a deliberate change on the opened-task settle path (surfaced in the PR): a whitespace-only
  // stated harness is blank, so the claude-code row it runs as donates its model. Before, the settle keyed
  // eligibility on the literal ' ' and dropped the runnable pair. The '' edge was already this answer.
  test('the surface settle with a whitespace job row over a claude-code group: the runnable model is kept (LIN-3966 choice)', async () => {
    const table = emptyTable();
    table.jobs.autopilot = { harness: ' ' };
    table.groups['agent-session'].steer = { harness: 'claude-code', model: 'opus' };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(table), applyDefaultHarness: true, settleHarness: true
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, 'opus');
  });

  // green: the migration of a table with no crossed row is unaffected.
  test('the migrated table of a plain legacy default still answers its own model', () => {
    const table = tableFromPreferences({ dispatchDefaults: { harness: 'opencode', model: MODEL } });
    assert.deepEqual(resolveFromRows([table.jobs.autopilot ?? {}, table.groups['agent-session'].steer]), { harness: 'opencode', model: MODEL, effort: null });
  });
});
