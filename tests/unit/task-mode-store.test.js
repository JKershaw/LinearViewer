/**
 * Unit tests for lib/task-mode-store.js (LIN-2942).
 *
 * Run with: node --test tests/unit/task-mode-store.test.js
 *
 * Covers the append-only record contract and the query surface: record +
 * getTaskMode (entry / taken / furthest, ladder order), the merge-group query,
 * listForAccount, countByEntryRung carrying no identifiers, vocabulary
 * rejection, and that neither writes nor reads throw on a failing collection.
 * Reads run on a real MangoDB engine so `$in`, sort and projection are
 * exercised rather than faked.
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import {
  TaskModeStore, RUNGS, ACTS, NEEDS, SURFACES, RUNG_ACTS, INSTRUMENTED_SURFACES, DISPATCH_RUNGS, CLIENT_ACTS, validateTaskModeEvent
} from '../../lib/task-mode-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const TASK = { accountId: 'acct-1', urlKey: 'ws', issueId: 'uuid-42', issueIdentifier: 'LIN-42' };

const copyAct = (over = {}) => ({ ...TASK, rung: 'copy', ready: true, needs: null, act: 'copy', surface: 'swipe', ...over });
const setupPress = (rung, needs, over = {}) => ({ ...TASK, rung, ready: false, needs, act: 'press', surface: 'swipe', ...over });
const dispatchAct = (rung, dispatchId, over = {}) => ({ ...TASK, rung, ready: true, needs: null, act: 'dispatch', dispatchId, ...over });

// Rows are stamped `at = new Date()` in record(); give each a distinct
// millisecond so ordering assertions are about `at`, not insertion luck.
async function recordInOrder(store, events) {
  for (const event of events) {
    await store.record(event);
    await new Promise(resolve => setTimeout(resolve, 3));
  }
}

const harness = createMangoTmpdir('lin-2942-task-mode-');
before(() => harness.connect());
after(() => harness.close());

describe('vocabulary', () => {
  test('is frozen, in ladder order, and matches renderLadder\'s data-rung / data-setup-needs values', () => {
    assert.deepStrictEqual([...RUNGS], ['copy', 'run-step', 'run-task']);
    assert.deepStrictEqual([...ACTS], ['press', 'copy', 'dispatch']);
    assert.deepStrictEqual([...NEEDS], ['prompt', 'dispatch', 'proxy']);
    assert.deepStrictEqual([...SURFACES], ['swipe', 'home']);
    for (const list of [RUNGS, ACTS, NEEDS, SURFACES, RUNG_ACTS, INSTRUMENTED_SURFACES, ...Object.values(RUNG_ACTS)]) {
      assert.ok(Object.isFrozen(list));
    }
    assert.deepStrictEqual(Object.keys(RUNG_ACTS), [...RUNGS]);
    assert.deepStrictEqual([...DISPATCH_RUNGS], ['run-step', 'run-task']);
    assert.deepStrictEqual([...CLIENT_ACTS], ['press', 'copy']);
    assert.ok(Object.isFrozen(DISPATCH_RUNGS) && Object.isFrozen(CLIENT_ACTS));
  });

  test('validateTaskModeEvent accepts every mapped press and act', () => {
    for (const event of [
      copyAct(),
      setupPress('copy', 'prompt'),
      dispatchAct('run-step', 'd-1'),
      setupPress('run-step', 'dispatch'),
      setupPress('run-step', 'prompt'),
      { ...TASK, rung: 'run-task', ready: true, needs: null, act: 'press', surface: 'swipe' },
      copyAct({ rung: 'run-task' }),
      dispatchAct('run-task', 'd-2'),
      setupPress('run-task', 'proxy'),
    ]) {
      assert.strictEqual(validateTaskModeEvent(event), null, JSON.stringify(event));
    }
  });

  test('validateTaskModeEvent rejects out-of-vocabulary values and broken invariants', () => {
    const cases = {
      'unknown rung': copyAct({ rung: 'run-everything' }),
      'unknown act': copyAct({ act: 'download' }),
      'unknown needs': setupPress('copy', 'openrouter'),
      'unknown surface': copyAct({ surface: 'mobile' }),
      'act not on rung (copy rung dispatching)': dispatchAct('copy', 'd-1'),
      'act not on rung (run-step copy)': copyAct({ rung: 'run-step' }),
      'not-ready without needs': setupPress('copy', null),
      'ready with needs': copyAct({ needs: 'prompt' }),
      'not-ready rung taken': { ...setupPress('copy', 'prompt'), act: 'copy' },
      'dispatch without dispatchId': dispatchAct('run-step', null),
      'dispatchId on a copy': copyAct({ dispatchId: 'd-1' }),
      'ready not boolean': copyAct({ ready: 'true' }),
      'missing accountId': copyAct({ accountId: undefined }),
      'missing urlKey': copyAct({ urlKey: '' }),
      'missing issueIdentifier': copyAct({ issueIdentifier: null }),
      'non-string issueId': copyAct({ issueId: 42 }),
      'oversized identifier': copyAct({ issueIdentifier: 'x'.repeat(201) }),
      'control characters in an identifier': copyAct({ issueIdentifier: 'LIN-42\n' }),
    };
    for (const [name, event] of Object.entries(cases)) {
      assert.strictEqual(typeof validateTaskModeEvent(event), 'string', name);
    }
    assert.strictEqual(typeof validateTaskModeEvent(null), 'string');
  });
});

describe('TaskModeStore.record', () => {
  let db;
  let store;

  beforeEach(() => {
    db = harness.freshDb();
    store = new TaskModeStore({ collection: db.collection('task-mode-events') });
  });

  test('stores one document per event with the full schema and a server timestamp', async () => {
    const before = Date.now();
    const doc = await store.record(dispatchAct('run-step', 'd-1', { surface: 'swipe' }));
    const [stored] = await db.collection('task-mode-events').find({}).toArray();
    assert.deepStrictEqual(Object.keys(stored).sort(), [
      '_id', 'accountId', 'act', 'at', 'dispatchId', 'issueId', 'issueIdentifier', 'needs', 'ready', 'rung', 'surface', 'urlKey'
    ]);
    assert.strictEqual(stored._id, doc._id);
    assert.strictEqual(stored.accountId, 'acct-1');
    assert.strictEqual(stored.rung, 'run-step');
    assert.strictEqual(stored.act, 'dispatch');
    assert.strictEqual(stored.dispatchId, 'd-1');
    assert.strictEqual(stored.needs, null);
    assert.ok(new Date(stored.at).getTime() >= before);
  });

  test('ignores a caller-supplied at and unknown fields (no content is stored)', async () => {
    await store.record(copyAct({ at: new Date(0), prompt: 'secret prompt text' }));
    const [stored] = await db.collection('task-mode-events').find({}).toArray();
    assert.ok(new Date(stored.at).getTime() > 0);
    assert.strictEqual(stored.prompt, undefined);
  });

  test('defaults optional fields to null', async () => {
    await store.record({ ...TASK, issueId: undefined, rung: 'copy', ready: true, act: 'copy' });
    const [stored] = await db.collection('task-mode-events').find({}).toArray();
    assert.strictEqual(stored.issueId, null);
    assert.strictEqual(stored.needs, null);
    assert.strictEqual(stored.dispatchId, null);
    assert.strictEqual(stored.surface, null);
  });

  test('an out-of-vocabulary event is not stored, returns null and does not throw', async () => {
    const result = await store.record(copyAct({ rung: 'run-everything' }));
    assert.strictEqual(result, null);
    assert.strictEqual(await store.record(undefined), null);
    assert.strictEqual((await db.collection('task-mode-events').find({}).toArray()).length, 0);
  });

  test('a failing collection never throws: the unpersisted doc is still returned', async () => {
    const failing = new TaskModeStore({ collection: { insertOne: async () => { throw new Error('db down'); } } });
    const doc = await failing.record(copyAct());
    assert.strictEqual(doc.rung, 'copy');
    assert.strictEqual(doc.act, 'copy');
  });
});

describe('TaskModeStore.getTaskMode', () => {
  let store;

  beforeEach(() => {
    store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
  });

  test('entry is the first event, taken the first copy/dispatch, furthest the highest rung in ladder order', async () => {
    await recordInOrder(store, [
      setupPress('run-task', 'proxy'),        // entered on run-task, not set up
      setupPress('run-step', 'dispatch'),
      copyAct(),                              // fell back to copy: first act taken
      dispatchAct('run-step', 'd-9'),
    ]);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.deepStrictEqual(
      { rung: mode.entry.rung, ready: mode.entry.ready },
      { rung: 'run-task', ready: false }
    );
    assert.strictEqual(typeof mode.entry.at, 'string');
    assert.deepStrictEqual({ rung: mode.taken.rung, dispatchId: mode.taken.dispatchId }, { rung: 'copy', dispatchId: null });
    // run-task was pressed first, so ladder order (not recency) makes it furthest.
    assert.strictEqual(mode.furthest, 'run-task');
    assert.deepStrictEqual(mode.events.map(e => `${e.rung}/${e.act}`), [
      'run-task/press', 'run-step/press', 'copy/copy', 'run-step/dispatch'
    ]);
    assert.deepStrictEqual(mode.events[3], {
      rung: 'run-step', ready: true, needs: null, act: 'dispatch', dispatchId: 'd-9', surface: null, at: mode.events[3].at
    });
    assert.deepStrictEqual(mode.coverage, { surfaces: ['swipe', 'home'] });
  });

  test('furthest follows ladder order when the highest rung comes last', async () => {
    await recordInOrder(store, [copyAct(), dispatchAct('run-task', 'd-1'), dispatchAct('run-step', 'd-2')]);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.strictEqual(mode.furthest, 'run-task');
    assert.strictEqual(mode.entry.rung, 'copy');
  });

  test('taken carries the dispatchId when the first act taken created a run', async () => {
    await recordInOrder(store, [{ ...TASK, rung: 'run-task', ready: true, act: 'press', surface: 'swipe' }, dispatchAct('run-task', 'd-auto')]);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.deepStrictEqual({ rung: mode.taken.rung, dispatchId: mode.taken.dispatchId }, { rung: 'run-task', dispatchId: 'd-auto' });
    assert.deepStrictEqual({ rung: mode.entry.rung, ready: mode.entry.ready }, { rung: 'run-task', ready: true });
  });

  test('taken is null while only presses were recorded', async () => {
    await recordInOrder(store, [setupPress('copy', 'prompt')]);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.strictEqual(mode.taken, null);
    assert.strictEqual(mode.furthest, 'copy');
  });

  test('is scoped to the task, the workspace and the account', async () => {
    await recordInOrder(store, [
      copyAct({ issueIdentifier: 'LIN-43' }),
      copyAct({ urlKey: 'other-ws' }),
      copyAct({ accountId: 'someone-else' }),
    ]);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.deepStrictEqual(mode, { entry: null, taken: null, furthest: null, events: [], coverage: { surfaces: ['swipe', 'home'] } });
  });

  test('queries across the merge group, entry being the group\'s first event', async () => {
    await recordInOrder(store, [
      setupPress('run-step', 'dispatch', { accountId: 'merged-away' }), // recorded before the merge
      copyAct({ accountId: 'canonical' }),
      copyAct({ accountId: 'unrelated' }),
    ]);
    const mode = await store.getTaskMode({ accountIds: ['canonical', 'merged-away'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.strictEqual(mode.events.length, 2);
    assert.strictEqual(mode.entry.rung, 'run-step');
    assert.strictEqual(mode.taken.rung, 'copy');

    const canonicalOnly = await store.getTaskMode({ accountIds: ['canonical'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.strictEqual(canonicalOnly.entry.rung, 'copy');
  });

  test('a missing account or task returns the empty mode without reading', async () => {
    let reads = 0;
    const counting = new TaskModeStore({ collection: { find: () => { reads++; throw new Error('should not read'); } } });
    for (const query of [
      { accountIds: [], urlKey: 'ws', issueIdentifier: 'LIN-42' },
      { accountIds: [null], urlKey: 'ws', issueIdentifier: 'LIN-42' },
      { accountIds: ['acct-1'], urlKey: 'ws' },
      undefined,
    ]) {
      const mode = await counting.getTaskMode(query);
      assert.strictEqual(mode.entry, null);
    }
    assert.strictEqual(reads, 0);
  });

  test('a failing collection never throws: reads return the empty mode', async () => {
    const failing = new TaskModeStore({ collection: { find: () => { throw new Error('db down'); } } });
    const mode = await failing.getTaskMode({ accountIds: ['acct-1'], urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.deepStrictEqual(mode, { entry: null, taken: null, furthest: null, events: [], coverage: { surfaces: ['swipe', 'home'] } });
    assert.deepStrictEqual(await failing.listForAccount(['acct-1']), []);
    assert.strictEqual((await failing.countByEntryRung()).total, 0);
  });
});

describe('TaskModeStore.listForAccount', () => {
  let store;

  beforeEach(() => {
    store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
  });

  test('returns the merge group\'s events across tasks, oldest first, honouring since', async () => {
    await recordInOrder(store, [
      copyAct({ accountId: 'merged-away', issueIdentifier: 'LIN-1' }),
      copyAct({ accountId: 'unrelated', issueIdentifier: 'LIN-2' }),
    ]);
    const cutoff = new Date();
    await new Promise(resolve => setTimeout(resolve, 3));
    await recordInOrder(store, [dispatchAct('run-step', 'd-1', { accountId: 'canonical', issueIdentifier: 'LIN-3' })]);

    const all = await store.listForAccount(['canonical', 'merged-away']);
    assert.deepStrictEqual(all.map(e => [e.accountId, e.issueIdentifier, e.act]), [
      ['merged-away', 'LIN-1', 'copy'],
      ['canonical', 'LIN-3', 'dispatch'],
    ]);
    assert.strictEqual(all[1].urlKey, 'ws');
    assert.strictEqual(all[1].dispatchId, 'd-1');

    const recent = await store.listForAccount(['canonical', 'merged-away'], { since: cutoff });
    assert.deepStrictEqual(recent.map(e => e.issueIdentifier), ['LIN-3']);
  });

  test('an empty account list returns nothing', async () => {
    await recordInOrder(store, [copyAct()]);
    assert.deepStrictEqual(await store.listForAccount([]), []);
  });
});

describe('TaskModeStore.countByEntryRung', () => {
  let store;

  beforeEach(() => {
    store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
  });

  test('counts each (account, workspace, task) once, by its entry rung', async () => {
    await recordInOrder(store, [
      setupPress('run-task', 'proxy', { issueIdentifier: 'LIN-1' }),
      copyAct({ issueIdentifier: 'LIN-1' }),                         // not an entry
      copyAct({ issueIdentifier: 'LIN-2' }),
      copyAct({ accountId: 'acct-2', issueIdentifier: 'LIN-2' }),
      dispatchAct('run-step', 'd-1', { urlKey: 'ws-2', issueIdentifier: 'LIN-2' }),
    ]);
    const counts = await store.countByEntryRung();
    assert.deepStrictEqual(counts, {
      total: 4,
      byRung: [
        { rung: 'copy', entries: 2, notReady: 0 },
        { rung: 'run-step', entries: 1, notReady: 0 },
        { rung: 'run-task', entries: 1, notReady: 1 },
      ],
      coverage: { surfaces: ['swipe', 'home'] },
    });
  });

  test('carries counts and labels only — no account, workspace or issue identifier', async () => {
    await recordInOrder(store, [copyAct({ accountId: 'acct-secret', urlKey: 'ws-secret', issueId: 'uuid-secret', issueIdentifier: 'SEC-1' })]);
    const serialized = JSON.stringify(await store.countByEntryRung());
    for (const identifier of ['acct-secret', 'ws-secret', 'uuid-secret', 'SEC-1']) {
      assert.ok(!serialized.includes(identifier), `${identifier} leaked into ${serialized}`);
    }
  });

  test('since bounds the entry: a task entered before it is not recounted at a later rung', async () => {
    await recordInOrder(store, [setupPress('run-task', 'proxy', { issueIdentifier: 'LIN-old' })]);
    const cutoff = new Date();
    await new Promise(resolve => setTimeout(resolve, 3));
    await recordInOrder(store, [
      copyAct({ issueIdentifier: 'LIN-old' }),
      dispatchAct('run-step', 'd-1', { issueIdentifier: 'LIN-new' }),
    ]);
    const counts = await store.countByEntryRung({ since: cutoff });
    assert.strictEqual(counts.total, 1);
    assert.deepStrictEqual(counts.byRung.map(r => r.entries), [0, 1, 0]);
  });

  // LIN-2952 characterization: `countByEntryRung` takes ONE options object, so
  // the canonical map the funnel adds must be an additive key that defaults to
  // identity. An unrecognized key (and an empty map) must leave the count
  // exactly as it is today — grouped by the account as recorded.
  test('an unrecognized option key does not change the default count', async () => {
    await recordInOrder(store, [
      copyAct({ issueIdentifier: 'LIN-1' }),
      copyAct({ accountId: 'acct-2', issueIdentifier: 'LIN-2' }),
    ]);
    const plain = await store.countByEntryRung();
    const withExtra = await store.countByEntryRung({ canonicalByAccountId: new Map() });
    assert.deepStrictEqual(withExtra, plain);
    assert.strictEqual(withExtra.byRung[0].entries, 2, 'the recorded accounts stay separate by default');
  });
});

describe('TaskModeStore.clear', () => {
  test('deletes only the named workspace\'s events (the test-only clear seam)', async () => {
    const store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
    await recordInOrder(store, [copyAct(), copyAct({ urlKey: 'other-ws' })]);
    assert.strictEqual(await store.clear('ws'), 1);
    assert.deepStrictEqual((await store.listForAccount(['acct-1'])).map(e => e.urlKey), ['other-ws']);
    assert.strictEqual(await store.clear(''), 0);
  });
});
