/**
 * LIN-3853: the model-routing store — reasons, log, undo, presets, the seeded first entry,
 * the write protocol, and that no person's name is ever stored.
 *
 * Run with: node --test tests/unit/model-routing-store.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { routingFixture, memoryCollection } from './helpers/routing-fakes.js';
import { ERASED_ACCOUNT_ID } from '../../lib/account-erasure.js';
import { ModelRoutingStore } from '../../lib/model-routing-store.js';
import { SEEDED_ENTRY, UNROUTED_JOBS } from '../../lib/model-routing.js';
import { JOBS } from '../../lib/llm-jobs.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';

const URL_KEY = 'acme';
const ctx = (reason = 'because', actor = { via: 'page', id: 'acct-1' }) => ({ urlKey: URL_KEY, reason, actor });

describe('the model-routing store', () => {
  let fx;
  beforeEach(() => { fx = routingFixture(); });
  const store = () => fx.routingStore;

  test('a store write without a reason is refused, for every operation, and writes nothing', async () => {
    await store().savePreset('keep', ctx('seed'));
    const preset = (await store().listPresets(URL_KEY))[0];
    const log = await store().getLog(URL_KEY);
    const before = JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs, fx.collections.presets._docs]);
    const ops = {
      changeJob: (c) => store().changeJob('review', { model: 'm' }, c),
      changeGroup: (c) => store().changeGroup('agent-session', 'judge', { model: 'm' }, c),
      changeDefault: (c) => store().changeDefault('harbour-call', { model: 'm' }, c),
      applyChanges: (c) => store().applyChanges([{ scope: 'job', surface: 'agent-session', key: 'review', field: 'model', to: 'm' }], c),
      saveHarbourModel: (c) => store().saveHarbourModel('a/b', c),
      saveDispatchDefaults: (c) => store().saveDispatchDefaults({}, {}, c),
      saveAiOverrides: (c) => store().saveAiOverrides({}, c),
      savePreset: (c) => store().savePreset('another', c),
      applyPreset: (c) => store().applyPreset(preset._id, c),
      undo: (c) => store().undo(log[0]._id, c)
    };
    for (const [name, run] of Object.entries(ops)) {
      for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
        await assert.rejects(run({ ...ctx(), reason }), (e) => e.code === 'REASON_REQUIRED', `${name} with ${JSON.stringify(reason)?.slice(0, 12)}`);
      }
    }
    assert.equal(JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs, fx.collections.presets._docs]), before);
  });

  test('LIN-3854: a proxy actor keeps its token id beside the account id, and nothing else new', async () => {
    await store().changeJob('review', { model: 'm' }, ctx('r', { via: 'proxy', id: 'acct-1', tokenId: 'tok-1', label: 'typed label', name: 'A Person', extra: 'x' }));
    const [entry] = await fx.collections.log._docs;
    assert.deepEqual(entry.actor, { via: 'proxy', id: 'acct-1', tokenId: 'tok-1', label: 'typed label' });
  });

  test('changeJob stores the value, the effective table reads it, and one entry records from and to', async () => {
    await store().changeJob('review', { model: 'sonnet', effort: 'high' }, ctx('judging to Sonnet'));
    const table = await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL });
    const review = table.jobs.find((j) => j.id === 'review');
    assert.deepEqual([review.model, review.effort, review.source.model, review.source.harness], ['sonnet', 'high', 'job', 'none']);
    const [entry, ...rest] = await store().getLog(URL_KEY);
    assert.equal(rest.length, 0);
    assert.equal(entry.seq, 1);
    assert.equal(entry.reason, 'judging to Sonnet');
    assert.deepEqual(entry.changes.map((c) => [c.key, c.field, c.from, c.to]).sort(), [['review', 'effort', null, 'high'], ['review', 'model', null, 'sonnet']]);
  });

  test('a group default is what a job follows until it has its own, field by field', async () => {
    await store().changeGroup('agent-session', 'judge', { model: 'g-model', harness: 'opencode' }, ctx());
    await store().changeJob('review', { model: 'own-model' }, ctx());
    const jobs = Object.fromEntries((await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.map((j) => [j.id, j]));
    assert.deepEqual([jobs.review.model, jobs.review.harness, jobs.review.source.model, jobs.review.source.harness], ['own-model', 'opencode', 'job', 'group']);
    assert.deepEqual([jobs['plan-review'].model, jobs['plan-review'].source.model], ['g-model', 'group']);
    assert.equal(jobs.plan.model, null);
  });

  test('null clears a field so the job follows its group again; invalid values and unknown targets are refused', async () => {
    await store().changeGroup('harbour-call', 'tell', { model: 'g' }, ctx());
    await store().changeJob('brief', { model: 'own' }, ctx());
    await store().changeJob('brief', { model: null }, ctx());
    const brief = (await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'brief');
    assert.deepEqual([brief.model, brief.source.model], ['g', 'group']);
    await assert.rejects(store().changeJob('brief', { harness: 'x' }, ctx()), /no "harness" field|has no/);
    await assert.rejects(store().changeJob('nope', { model: 'x' }, ctx()), (e) => e.code === 'INVALID');
    await assert.rejects(store().changeJob('review', { model: 5 }, ctx()), (e) => e.code === 'INVALID');
    await assert.rejects(store().changeJob('review', { model: 'a\nb' }, ctx()), (e) => e.code === 'INVALID');
    await assert.rejects(store().changeGroup('agent-session', 'nope', { model: 'x' }, ctx()), (e) => e.code === 'INVALID');
  });

  test('a stored run-paragraph setting is the effective one, routed (LIN-3856 D2)', async () => {
    await store().changeJob('run-paragraph', { model: 'stored-and-read' }, ctx());
    const row = (await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'run-paragraph');
    assert.deepEqual([row.model, row.routed, row.source.model, row.tracked], ['stored-and-read', true, 'job', undefined]);
    assert.deepEqual([...UNROUTED_JOBS], []);
  });

  describe('undo', () => {
    test('appends an entry that restores the earlier value', async () => {
      await store().changeJob('review', { model: 'a' }, ctx());
      const changed = await store().changeJob('review', { model: 'b' }, ctx('to b'));
      const undone = await store().undo(changed._id, ctx('wrong move'));
      assert.equal(undone.kind, 'undo');
      assert.equal(undone.undoes, changed._id);
      assert.equal(undone.seq, 3);
      const review = (await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'review');
      assert.equal(review.model, 'a');
      assert.equal((await store().getLog(URL_KEY)).length, 3);
    });

    test('refuses, naming the fields, when a later edit would be overwritten', async () => {
      const first = await store().changeJob('review', { model: 'a' }, ctx());
      await store().changeJob('review', { model: 'later' }, ctx());
      await assert.rejects(store().undo(first._id, ctx()), (e) => {
        assert.equal(e.code, 'CONFLICT');
        assert.deepEqual(e.details.conflicts.map((c) => [c.key, c.field, c.expected, c.current]), [['review', 'model', 'a', 'later']]);
        return true;
      });
      assert.equal((await store().getLog(URL_KEY)).length, 2);
    });

    test('undo of an undo restores the change (a redo), under the same rule', async () => {
      const change = await store().changeJob('review', { model: 'a' }, ctx());
      const undo = await store().undo(change._id, ctx());
      await store().undo(undo._id, ctx('redo'));
      assert.equal((await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'review').model, 'a');
    });

    test('a preset-save has nothing to undo, and an unknown entry is not found', async () => {
      const { entry } = await store().savePreset('p', ctx());
      await assert.rejects(store().undo(entry._id, ctx()), (e) => e.code === 'NOT_UNDOABLE');
      await assert.rejects(store().undo('nope', ctx()), (e) => e.code === 'NOT_FOUND');
    });
  });

  describe('presets', () => {
    test('applying a preset adds exactly one entry, also when nothing differs; saving adds one and leaves the table equal', async () => {
      await store().changeJob('review', { model: 'a' }, ctx());
      const tableBefore = JSON.stringify(await store().getTable(URL_KEY));
      const { preset } = await store().savePreset('baseline', ctx('save'));
      const afterSave = await store().getTable(URL_KEY);
      assert.equal(JSON.stringify({ ...afterSave, version: 1 }), JSON.stringify({ ...JSON.parse(tableBefore), version: 1 }));
      assert.equal((await store().getLog(URL_KEY)).length, 2);

      await store().applyPreset(preset._id, ctx('no-op apply'));
      const log = await store().getLog(URL_KEY);
      assert.equal(log.length, 3);
      assert.deepEqual([log[0].kind, log[0].changes.length, log[0].presetId], ['preset-apply', 0, preset._id]);

      await store().changeJob('review', { model: 'b' }, ctx());
      await store().applyPreset(preset._id, ctx('back to baseline'));
      assert.equal((await store().getLog(URL_KEY)).length, 5);
      assert.equal((await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'review').model, 'a');
    });

    test('is capped at 20 per workspace and needs a name', async () => {
      for (let i = 0; i < 20; i++) await store().savePreset(`p${i}`, ctx());
      await assert.rejects(store().savePreset('one too many', ctx()), (e) => e.code === 'PRESET_LIMIT');
      await assert.rejects(store().savePreset('  ', ctx()), (e) => e.code === 'INVALID');
    });
  });

  describe('the seeded first log entry (the 23 October autopilot move)', () => {
    const seeded = { ...SEEDED_ENTRY, urlKey: 'john-ws', from: 'opus-5-5', to: 'sonnet-5-5' };
    const prefsWithAutopilot = (model) => ({ dispatchDefaults: { byKind: { autopilot: { model } } } });
    async function migrate(urlKey, prefs, entry = seeded) {
      const f = routingFixture({ seededEntry: entry });
      await f.prefs.insertOne({ _id: urlKey, preferences: prefs });
      await f.routingStore.getTable(urlKey);
      return f;
    }

    test('is entry 1 when the workspace AND the migrated value match', async () => {
      const f = await migrate('john-ws', prefsWithAutopilot('sonnet-5-5'));
      const [entry] = await f.routingStore.getLog('john-ws');
      assert.equal(entry.seq, 1);
      assert.equal(entry.at.toISOString(), seeded.at);
      assert.deepEqual(entry.changes, [{ scope: 'job', surface: 'agent-session', key: 'autopilot', field: 'model', from: 'opus-5-5', to: 'sonnet-5-5' }]);
      assert.equal(entry.actor.via, 'migration');
      assert.equal(entry.actor.name, seeded.label);
      assert.equal(JSON.stringify(entry).includes('John'), false, 'no person is named in stored data');
      // later writes follow it, ordered by seq, not by the backdated `at`
      await f.routingStore.changeJob('review', { model: 'x' }, { urlKey: 'john-ws', reason: 'r', actor: { via: 'page', id: 'a' } });
      assert.deepEqual((await f.routingStore.getLog('john-ws')).map((e) => e.seq), [2, 1]);
    });

    test('the same value on a different workspace gets no entry (a false dated record)', async () => {
      const f = await migrate('someone-else', prefsWithAutopilot('sonnet-5-5'));
      assert.deepEqual(await f.routingStore.getLog('someone-else'), []);
    });

    test('the right workspace with a different value gets no entry', async () => {
      const f = await migrate('john-ws', prefsWithAutopilot('opus-5-5'));
      assert.deepEqual(await f.routingStore.getLog('john-ws'), []);
    });

    test('fails closed: the shipped default has no urlKey, so nothing is seeded anywhere', async () => {
      assert.equal(SEEDED_ENTRY.urlKey, null);
      const f = await migrate('john-ws', prefsWithAutopilot('sonnet-5-5'), SEEDED_ENTRY);
      assert.deepEqual(await f.routingStore.getLog('john-ws'), []);
    });

    test('migrating twice (or racing) seeds once', async () => {
      const f = routingFixture({ seededEntry: seeded });
      await f.prefs.insertOne({ _id: 'john-ws', preferences: prefsWithAutopilot('sonnet-5-5') });
      await Promise.all([f.routingStore.getTable('john-ws'), f.routingStore.getTable('john-ws')]);
      assert.equal((await f.routingStore.getLog('john-ws')).length, 1);
    });
  });

  describe('the write protocol', () => {
    test('two concurrent changes both land (one retries) with distinct seqs', async () => {
      await store().getTable(URL_KEY);
      const [a, b] = await Promise.all([
        store().changeJob('review', { model: 'a' }, ctx()),
        store().changeJob('plan', { model: 'b' }, ctx())
      ]);
      assert.deepEqual([a.seq, b.seq].sort(), [1, 2]);
      const jobs = Object.fromEntries((await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.map((j) => [j.id, j.model]));
      assert.deepEqual([jobs.review, jobs.plan], ['a', 'b']);
    });

    test('a log insert that fails after the table write surfaces LOG_WRITE_FAILED and getLog flags the gap', async () => {
      await store().changeJob('review', { model: 'a' }, ctx());
      const realInsert = fx.collections.log.insertOne;
      fx.collections.log.insertOne = async () => { throw new Error('disk full'); };
      const silenced = console.error;
      console.error = () => {};
      try {
        await assert.rejects(store().changeJob('review', { model: 'b' }, ctx()), (e) => e.code === 'LOG_WRITE_FAILED');
      } finally { console.error = silenced; }
      fx.collections.log.insertOne = realInsert;
      await store().changeJob('review', { model: 'c' }, ctx());
      const log = await store().getLog(URL_KEY);
      assert.deepEqual(log.map((e) => [e.seq, e.gap]), [[3, true], [1, false]]);
    });

    test('a log insert that fails once is retried and the change is recorded', async () => {
      const realInsert = fx.collections.log.insertOne.bind(fx.collections.log);
      let failures = 1;
      fx.collections.log.insertOne = async (doc) => { if (failures-- > 0) throw new Error('blip'); return realInsert(doc); };
      await store().changeJob('review', { model: 'a' }, ctx());
      assert.equal((await store().getLog(URL_KEY)).length, 1);
    });

    test('nothing is cached in-process: a deleted workspace is seen by the next read', async () => {
      await store().changeJob('review', { model: 'a' }, ctx());
      await store().savePreset('p', ctx());
      await store().deleteWorkspace(URL_KEY);
      assert.deepEqual([await store().getLog(URL_KEY), await store().listPresets(URL_KEY)], [[], []]);
      assert.equal((await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.find((j) => j.id === 'review').model, null);
    });
  });

  describe('actors: ids and labels are stored, names are resolved when read', () => {
    test('a stored entry holds the account id and no name; the name comes from the resolver at read time', async () => {
      const f = routingFixture({ resolveActorName: async (id) => (id === 'acct-1' ? 'Ada' : null) });
      await f.routingStore.changeJob('review', { model: 'a' }, ctx('r', { via: 'page', id: 'acct-1' }));
      assert.deepEqual(f.collections.log._docs[0].actor, { via: 'page', id: 'acct-1' });
      assert.equal(JSON.stringify(f.collections.log._docs).includes('Ada'), false);
      assert.equal((await f.routingStore.getLog(URL_KEY))[0].actor.name, 'Ada');
    });

    test('an erased id, or one that no longer resolves, reads as "former member"', async () => {
      const f = routingFixture({ erasedAccountId: ERASED_ACCOUNT_ID, resolveActorName: async () => null });
      await f.routingStore.changeJob('review', { model: 'a' }, ctx('r', { via: 'page', id: ERASED_ACCOUNT_ID }));
      await f.routingStore.changeJob('review', { model: 'b' }, ctx('r', { via: 'page', id: 'gone' }));
      assert.deepEqual((await f.routingStore.getLog(URL_KEY)).map((e) => e.actor.name), ['former member', 'former member']);
    });

    test('the default erased id is the one account erasure writes', () => {
      assert.equal(new ModelRoutingStore({}).erasedAccountId, ERASED_ACCOUNT_ID);
    });

    test('a proxy actor id is an account id (LIN-3854): one that no longer resolves reads as former member, never as the id', async () => {
      await store().changeJob('review', { model: 'a' }, ctx('r', { via: 'proxy', id: 'gone', tokenId: 'tok-1' }));
      const [entry] = await store().getLog(URL_KEY);
      assert.equal(entry.actor.name, 'former member');
    });
  });

  test('the registry census: 20 agent jobs and 17 Harbour calls resolve from the table', async () => {
    const table = await store().getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL });
    assert.equal(table.jobs.length, JOBS.length);
    assert.deepEqual(table.jobs.map((j) => j.id), JOBS.map((j) => j.id));
  });
});
