/**
 * LIN-3833 step 1: the dispatch resolver reports where each field came from, and the opened task's
 * run (a request that names its `surface`) settles the harness before model and effort.
 *
 * Witnesses, each shown red before the change and green after:
 *  - `resolveRoutingWithSources` answers the same values as `resolveRouting`, with a source per field.
 *  - The LIN-1694 crossed pair: with the settle a row scoped to another harness cannot donate; without
 *    it (every caller but the opened task) the pair is unchanged.
 *  - The preview's answer equals the row `createDispatchItem` stamps, once per source and for two kinds.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem, resolveRouting, resolveRoutingWithSources } from '../../lib/dispatch-factory.js';
import { emptyTable, tableFromPreferences } from '../../lib/model-routing.js';
import { deriveDispatchKind } from '../../lib/prompt-templates.js';

function capturingStore() {
  const captured = {};
  return {
    captured,
    addItem: async (urlKey, item) => {
      captured.item = item;
      return { _id: 'item-1', ...item };
    }
  };
}

// A workspace routing table served the way the store serves one (`getRoutingTable`).
function storeWith(table) {
  return { getRoutingTable: async () => table };
}

// The LIN-1694 crossed-pair table: the job row says claude-code, the steer group says opencode with a model.
function crossedTable() {
  const table = emptyTable();
  table.jobs.autopilot = { harness: 'claude-code' };
  table.groups['agent-session'].steer = { harness: 'opencode', model: 'deepseek-v4-pro' };
  return table;
}

const SETTLE = { applyDefaultHarness: true, settleHarness: true };

describe('resolveRoutingWithSources — values match resolveRouting, with a source per field', () => {
  test('a stored job row answers, and says it is the job row', async () => {
    const table = emptyTable();
    table.jobs.implementation = { harness: 'opencode', model: 'job-model' };
    const store = storeWith(table);
    const routing = await resolveRoutingWithSources({ urlKey: 'acme', kind: 'implementation', workspacePreferencesStore: store });
    assert.deepEqual(
      { model: routing.model, harness: routing.harness, effort: routing.effort, sources: routing.sources },
      { model: 'job-model', harness: 'opencode', effort: null, sources: { harness: 'job', model: 'job', effort: 'none' } }
    );
    const plain = await resolveRouting({ urlKey: 'acme', kind: 'implementation', workspacePreferencesStore: store });
    assert.equal(plain.sources, undefined, 'resolveRouting keeps its shape: no sources key');
    assert.deepEqual({ model: plain.model, harness: plain.harness, effort: plain.effort }, { model: 'job-model', harness: 'opencode', effort: null });
  });

  test('explicit fields and a preset each name their tier', async () => {
    const preset = { id: 'careful', name: 'Careful', config: { harness: 'opencode', model: 'preset-model' } };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', model: 'explicit-model', preset, anchor: null
    });
    assert.equal(routing.model, 'explicit-model');
    assert.equal(routing.harness, 'opencode');
    assert.deepEqual(routing.sources, { harness: 'preset', model: 'explicit', effort: 'none' });
  });

  test('a blank table with the default interpose says fallback for the harness', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', workspacePreferencesStore: storeWith(emptyTable()), applyDefaultHarness: true
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.sources.harness, 'fallback');
  });
});

describe('the LIN-1694 crossed pair — settled for the opened task, unchanged for everyone else', () => {
  test('without the settle (a proxy-style caller) the steer row still donates its model across claude-code', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(crossedTable()), applyDefaultHarness: true
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, 'deepseek-v4-pro', 'the pre-existing crossed pair stays for callers that do not settle');
  });

  test('with the settle the harness in force is claude-code and the opencode row cannot donate its model', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(crossedTable()), ...SETTLE
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.model, null);
    assert.equal(routing.sources.harness, 'job');
    assert.equal(routing.sources.model, 'none');
  });

  test('an effort on the opencode row cannot cross the settled claude-code harness either', async () => {
    const table = emptyTable();
    table.jobs.autopilot = { harness: 'claude-code' };
    table.groups['agent-session'].steer = { harness: 'opencode', effort: 'high' };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(table), ...SETTLE
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.effort, null);
  });

  test('a table whose own harness is opencode settles to opencode, and its model is consistent with it', async () => {
    const table = emptyTable();
    table.groups['agent-session'].steer = { harness: 'opencode', model: 'deepseek-v4-pro' };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', workspacePreferencesStore: storeWith(table), ...SETTLE
    });
    assert.deepEqual({ harness: routing.harness, model: routing.model }, { harness: 'opencode', model: 'deepseek-v4-pro' });
    assert.equal(routing.sources.harness, 'group');
  });

  test('an explicit harness settles first, and the model is read against it', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'autopilot', harness: 'opencode', workspacePreferencesStore: storeWith(crossedTable()), ...SETTLE
    });
    assert.equal(routing.harness, 'opencode');
    assert.equal(routing.model, 'deepseek-v4-pro');
    assert.equal(routing.sources.harness, 'explicit');
  });
});

describe('createDispatchItem — the stamp the preview must equal', () => {
  test('a surface-tagged run with no harness stamps the table harness, else claude-code', async () => {
    const withRow = capturingStore();
    await createDispatchItem({
      store: withRow, urlKey: 'acme', kind: 'autopilot', prompt: 'x', workspacePreferencesStore: storeWith(crossedTable()), ...SETTLE
    });
    assert.equal(withRow.captured.item.harness, 'claude-code');
    assert.equal(withRow.captured.item.model, null);

    const blank = capturingStore();
    await createDispatchItem({
      store: blank, urlKey: 'acme', kind: 'implementation', prompt: 'x', workspacePreferencesStore: storeWith(emptyTable()), ...SETTLE
    });
    assert.equal(blank.captured.item.harness, 'claude-code');
  });

  test('the preview equals the stamp, once per source (default, preset, chosen) and for two kinds', async () => {
    const table = emptyTable();
    table.defaults['agent-session'] = { model: 'ws-model', harness: 'opencode' };
    table.jobs.review = { model: 'review-model' };
    const store = storeWith(table);
    const preset = { id: 'careful', name: 'Careful', config: { model: 'preset-model', harness: 'claude-code' } };
    const cases = [
      { label: 'default', promptName: 'implementation', presetId: null, preset: null, model: undefined },
      { label: 'preset', promptName: 'review', presetId: 'careful', preset, model: undefined },
      { label: 'chosen', promptName: 'review', presetId: null, preset: null, model: 'chosen-model' }
    ];
    for (const c of cases) {
      const kind = deriveDispatchKind(c.promptName);
      const preview = await resolveRoutingWithSources({
        urlKey: 'acme', kind, model: c.model, preset: c.preset, anchor: null, workspacePreferencesStore: store, ...SETTLE
      });
      const stamped = capturingStore();
      await createDispatchItem({
        store: stamped,
        urlKey: 'acme',
        workspacePreferencesStore: store,
        dispatchPresetsStore: { get: async (_u, id) => (id === c.presetId ? c.preset : null) },
        presetId: c.presetId,
        model: c.model,
        prompt: 'x',
        fields: { promptName: c.promptName },
        ...SETTLE
      });
      assert.deepEqual(
        { model: stamped.captured.item.model, harness: stamped.captured.item.harness, effort: stamped.captured.item.effort },
        { model: preview.model, harness: preview.harness, effort: preview.effort },
        `${c.label}: preview equals stamp`
      );
    }
  });

  test('the table fallback path reports the same harness the stamp uses', async () => {
    const table = tableFromPreferences({ dispatchDefaults: { harness: 'opencode', model: 'ws-model' } });
    const preview = await resolveRoutingWithSources({ urlKey: 'acme', kind: 'plan', workspacePreferencesStore: storeWith(table), ...SETTLE });
    assert.equal(preview.harness, 'opencode');
    assert.equal(preview.sources.harness, 'group');
  });
});
