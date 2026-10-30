/**
 * LIN-4028: a recorded routing ruling is a tier of the routing resolver, between the explicit request
 * value and the preset/anchor/table. Witnesses, each shown red before the change and green after:
 *
 *  - the ruling's model and effort beat the workspace table and a preset, and say they came from a ruling;
 *  - an explicit `model`/`effort` in the request still wins, and says so;
 *  - a ruling that names a harness the dispatch is not on (the body's, or a follow-up's anchor's) is skipped
 *    whole, so a resume stays on its session's runner (the LIN-1431 tier, review note 1);
 *  - a model-only ruling applies on whichever harness is in force (the chosen behaviour, pinned here);
 *  - no ruling: the result, sources included, is unchanged;
 *  - `createDispatchItem` reports the provenance on the returned item, and never on the stored row.
 *
 * Run with: node --test tests/unit/lin-4028-ruling-tier.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem, resolveRouting, resolveRoutingWithSources } from '../../lib/dispatch-factory.js';
import { emptyTable } from '../../lib/model-routing.js';

function capturingStore(anchor = null) {
  const captured = {};
  return {
    captured,
    getItemStatus: async (_urlKey, id) => (anchor && id === anchor.id ? anchor : null),
    addItem: async (urlKey, item) => {
      captured.item = item;
      return { _id: 'item-1', ...item };
    }
  };
}

function storeWith(table) {
  return { getRoutingTable: async () => table };
}

// The workspace table for `implementation`: a job row on claude-code with a model, and no effort.
function jobTable() {
  const table = emptyTable();
  table.jobs.implementation = { harness: 'claude-code', model: 'claude-haiku-5-5' };
  return table;
}

const RULING = { model: 'opus', effort: 'high' };

describe('the ruling tier — above the table and a preset, below an explicit request (LIN-4028)', () => {
  test('a ruling pins the model and effort over the workspace table, and says so', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', ruling: RULING, workspacePreferencesStore: storeWith(jobTable())
    });
    assert.deepEqual(
      { model: routing.model, harness: routing.harness, effort: routing.effort, sources: routing.sources },
      { model: 'opus', harness: 'claude-code', effort: 'high', sources: { harness: 'job', model: 'ruling', effort: 'ruling' } }
    );
  });

  test('a ruling beats a preset, the run-wide choice a follow-up would inherit', async () => {
    const preset = { id: 'careful', name: 'Careful', config: { model: 'preset-model', effort: 'low' } };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'close-out', ruling: { model: 'opus' }, preset, anchor: null
    });
    assert.equal(routing.model, 'opus');
    assert.equal(routing.sources.model, 'ruling');
    assert.equal(routing.effort, 'low', 'the preset still answers the field the ruling leaves open');
    assert.equal(routing.sources.effort, 'preset');
  });

  test('an explicit model and effort in the request still win, and say they are explicit', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', model: 'sonnet-5-5', effort: 'medium', ruling: RULING,
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.equal(routing.model, 'sonnet-5-5');
    assert.equal(routing.effort, 'medium');
    assert.deepEqual(routing.sources, { harness: 'job', model: 'explicit', effort: 'explicit' });
  });

  test('a ruling that names the harness in force pins that harness, and says so', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', ruling: { harness: 'claude-code', model: 'opus' },
      workspacePreferencesStore: storeWith(emptyTable())
    });
    assert.equal(routing.harness, 'claude-code');
    assert.equal(routing.sources.harness, 'ruling');
  });
});

describe('the ruling tier — a harness it does not match is skipped whole (review note 1)', () => {
  test('a ruling naming a harness other than the body\'s is skipped: its model was chosen for that other harness', async () => {
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', harness: 'claude-code',
      ruling: { harness: 'opencode', model: 'deepseek-v4-pro' },
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.equal(routing.model, 'claude-haiku-5-5', 'the table answers, as it did before the ruling');
    assert.equal(routing.harness, 'claude-code');
    assert.notEqual(routing.sources.model, 'ruling');
    assert.notEqual(routing.sources.harness, 'ruling');
  });

  test('a follow-up whose anchor runs on claude-code is not moved to another runner by a ruling on opencode', async () => {
    const anchor = { id: 'anchor-1', harness: 'claude-code', presetConfig: null };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', anchor, ruling: { harness: 'opencode', model: 'deepseek-v4-pro' },
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.equal(routing.harness, 'claude-code', 'the resume stays on the harness of the session it resumes');
    assert.equal(routing.sources.harness, 'anchor');
    assert.notEqual(routing.sources.model, 'ruling');
  });

  test('a ruling naming the anchor\'s own harness applies to a follow-up', async () => {
    const anchor = { id: 'anchor-1', harness: 'claude-code', presetConfig: null };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', anchor, ruling: { harness: 'claude-code', model: 'opus' },
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.equal(routing.model, 'opus');
    assert.equal(routing.sources.model, 'ruling');
  });
});

describe('the ruling tier — a model-only ruling (the chosen behaviour, review note 1)', () => {
  test('a ruling with a model and no harness applies that model on whichever harness is in force', async () => {
    const table = emptyTable();
    table.jobs.implementation = { harness: 'opencode', model: 'deepseek-v4-pro' };
    const routing = await resolveRoutingWithSources({
      urlKey: 'acme', kind: 'implementation', ruling: { model: 'opus' }, workspacePreferencesStore: storeWith(table)
    });
    assert.equal(routing.harness, 'opencode');
    assert.equal(routing.model, 'opus', 'a person ruled the model; the harness they did not name does not veto it');
    assert.equal(routing.sources.model, 'ruling');
  });
});

describe('no ruling — the resolver answers exactly as it did (LIN-4028)', () => {
  test('a null ruling and an absent one give the same routing and sources, with no ruling source', async () => {
    const args = { urlKey: 'acme', kind: 'implementation', workspacePreferencesStore: storeWith(jobTable()) };
    const absent = await resolveRoutingWithSources(args);
    const isNull = await resolveRoutingWithSources({ ...args, ruling: null });
    assert.deepEqual(isNull, absent);
    assert.equal(JSON.stringify(absent).includes('"ruling"'), false);
    assert.deepEqual(await resolveRouting(args), { model: 'claude-haiku-5-5', harness: 'claude-code', effort: null });
  });
});

describe('createDispatchItem — the provenance rides the returned item, never the stored row (LIN-4028)', () => {
  test('a ruling-routed dispatch reports its routing and sources on the item, and the stored row carries none of it', async () => {
    const store = capturingStore();
    const item = await createDispatchItem({
      store,
      urlKey: 'acme',
      kind: 'implementation',
      prompt: 'write it',
      ruling: RULING,
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.equal(item.model, 'opus');
    assert.equal(item.effort, 'high');
    assert.deepEqual(item.routing, {
      harness: 'claude-code',
      model: 'opus',
      effort: 'high',
      sources: { harness: 'job', model: 'ruling', effort: 'ruling' }
    });
    assert.equal(store.captured.item.model, 'opus', 'the stored row carries the pinned model');
  });

  test('a dispatch with no ruling still reports where its routing came from', async () => {
    const item = await createDispatchItem({
      store: capturingStore(),
      urlKey: 'acme',
      kind: 'implementation',
      prompt: 'write it',
      workspacePreferencesStore: storeWith(jobTable())
    });
    assert.deepEqual(item.routing.sources, { harness: 'job', model: 'job', effort: 'none' });
  });
});
