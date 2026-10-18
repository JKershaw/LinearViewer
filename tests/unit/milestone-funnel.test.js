/**
 * Unit tests for lib/milestone-funnel.js's canonicalization (LIN-2952, Beat A)
 * and the canonical-map parameter it feeds on TaskModeStore.countByEntryRung.
 *
 * Run with: node --test tests/unit/milestone-funnel.test.js
 *
 * Every test runs against a REAL AccountStore (MangoDB) so merge resolution is
 * exercised end to end, not stubbed: a merged person counted once, a chain
 * merged twice folded to one, and a corrupt/cyclic mergedInto chain falling
 * back per id rather than dropping or crashing.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { TaskModeStore } from '../../lib/task-mode-store.js';
import { FunnelEventStore } from '../../lib/funnel-event-store.js';
import { buildCanonicalMap, isPullRequestUrl, stepsForAccountGroup, collectMilestoneFunnel, STEP_STATES } from '../../lib/milestone-funnel.js';
import { isFreshRun, DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const harness = createMangoTmpdir('lin-2952-milestone-');
before(() => harness.connect());
after(() => harness.close());

function freshStores() {
  const db = harness.freshDb();
  return {
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    taskModeStore: new TaskModeStore({ collection: db.collection('task-mode-events') })
  };
}

// A full funnel world: the three account/edge/dispatch stores plus the
// funnel-event store, all real, on one fresh db.
function freshWorld() {
  const db = harness.freshDb();
  return {
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    taskModeStore: new TaskModeStore({ collection: db.collection('task-mode-events') }),
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history'),
    funnelEventStore: new FunnelEventStore({ collection: db.collection('funnel-events') })
  };
}

const aggDeps = (w) => ({
  taskModeStore: w.taskModeStore,
  accountStore: w.accountStore,
  accountWorkspaceStore: w.accountWorkspaceStore,
  funnelEventStore: w.funnelEventStore,
  dispatchQueue: w.dispatchQueue,
  dispatchHistory: w.dispatchHistory
});

// A dispatch collection with the real driver's projection semantics: a dotted
// projection on an array field (`feedback.kind`) keeps EVERY entry, narrowed to
// the projected subfields. MangoDB instead collapses the array to one object, so
// a multi-entry row only reads right against this wrapper (LIN-3501).
function driverProjected(collection) {
  const project = (doc, projection) => {
    const out = { _id: doc._id };
    for (const key of Object.keys(projection)) {
      const [field, sub] = key.split('.');
      if (sub === undefined) {
        if (field in doc) out[field] = doc[field];
      } else if (Array.isArray(doc[field])) {
        out[field] = (out[field] || doc[field].map(() => ({})));
        doc[field].forEach((entry, i) => { if (sub in entry) out[field][i][sub] = entry[sub]; });
      }
    }
    return out;
  };
  return {
    find(filter, { projection } = {}) {
      return { toArray: async () => (await collection.find(filter).toArray()).map(doc => (projection ? project(doc, projection) : doc)) };
    }
  };
}

const DAY = 24 * 60 * 60 * 1000;
const PAST = (msAgo) => new Date(Date.now() - msAgo);
const dispatchRow = (accountId, dispatchedAt, over = {}) => ({
  _id: `d-${Math.random().toString(36).slice(2)}`,
  urlKey: 'ws', dispatchedBy: accountId, dispatchedAt, abort: false, feedback: [], ...over
});

const entry = (accountId, issueIdentifier) => ({
  accountId, urlKey: 'ws', issueId: 'uuid', issueIdentifier,
  rung: 'copy', ready: true, needs: null, act: 'copy', surface: 'swipe'
});

async function recordInOrder(store, events) {
  for (const event of events) {
    await store.record(event);
    await new Promise(resolve => setTimeout(resolve, 3));
  }
}

describe('buildCanonicalMap', () => {
  test('resolves merged ids to their canonical survivor and leaves others as themselves', async () => {
    const { accountStore } = freshStores();
    const canonical = await accountStore.createAccount();
    const merged = await accountStore.createAccount();
    const bystander = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);

    const map = await buildCanonicalMap([canonical._id, merged._id, bystander._id], accountStore);
    assert.strictEqual(map.get(canonical._id), canonical._id);
    assert.strictEqual(map.get(merged._id), canonical._id);
    assert.strictEqual(map.get(bystander._id), bystander._id);
  });

  test('a corrupt cyclic chain falls back per id — the corrupt id keeps itself, others still resolve', async () => {
    const { accountStore } = freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    const healthy = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    // `mergeAccounts` refuses to build a cycle, so seed the corruption directly.
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    assert.equal((await accountStore.mergeAccounts(survivor._id, healthy._id)).ok, true);

    // The resolution itself throws for the corrupt pair...
    await assert.rejects(accountStore.resolveCanonicalAccountId(a._id), /resolveCanonicalAccountId/);

    // ...but the map builder degrades per id: no throw, no drop.
    const map = await buildCanonicalMap([a._id, b._id, healthy._id], accountStore);
    assert.strictEqual(map.get(a._id), a._id);
    assert.strictEqual(map.get(b._id), b._id);
    assert.strictEqual(map.get(healthy._id), survivor._id, 'the healthy chain still resolves');
  });
});

describe('countByEntryRung — canonical map (LIN-2952)', () => {
  test('a person split across two recorded ids is counted once when the map is supplied', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const canonical = await accountStore.createAccount();
    const merged = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);

    // The SAME person's SAME task, entered first under the merged id and again
    // under the canonical id — the post-merge double-count the map removes.
    await recordInOrder(taskModeStore, [
      entry(merged._id, 'LIN-1'),
      entry(canonical._id, 'LIN-1'),
    ]);
    const map = await buildCanonicalMap([canonical._id, merged._id], accountStore);

    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 1);
    assert.deepStrictEqual(counted.byRung.map(r => r.entries), [1, 0, 0]);
  });

  test('a chain merged twice (X→Y→Z) folds to one person; the default call still counts two', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const x = await accountStore.createAccount();
    const y = await accountStore.createAccount();
    const z = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(y._id, x._id)).ok, true);
    assert.equal((await accountStore.mergeAccounts(z._id, y._id)).ok, true);

    await recordInOrder(taskModeStore, [
      entry(x._id, 'LIN-1'),
      entry(z._id, 'LIN-1'),
    ]);
    const map = await buildCanonicalMap([x._id, y._id, z._id], accountStore);
    assert.strictEqual(map.get(x._id), z._id);
    assert.strictEqual(map.get(y._id), z._id);

    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 1, 'the chain folds to one canonical person');

    const unchanged = await taskModeStore.countByEntryRung();
    assert.strictEqual(unchanged.total, 2, 'without the map, grouping is by the account as recorded');
  });

  test('a corrupt chain under the map degrades to the recorded id rather than dropping events', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    await recordInOrder(taskModeStore, [
      entry(a._id, 'LIN-1'),
      entry(b._id, 'LIN-2'),
    ]);

    const map = await buildCanonicalMap([a._id, b._id], accountStore);
    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 2, 'each corrupt id falls back to itself — under-count, never drop');
  });
});

describe('isPullRequestUrl', () => {
  test('accepts a GitHub pull-request URL (the runner links.js canon) and nothing else', () => {
    assert.equal(isPullRequestUrl('https://github.com/JKershaw/LinearViewer/pull/121'), true);
    assert.equal(isPullRequestUrl('https://github.com/o/r/pull/1/'), true);
    assert.equal(isPullRequestUrl('http://github.com/o/r/pull/1?x=1'), true);
    assert.equal(isPullRequestUrl('https://github.com/o/r/issues/1'), false);
    assert.equal(isPullRequestUrl('https://github.com/o/r/commit/abc1234'), false);
    assert.equal(isPullRequestUrl('https://github.com/o/r/compare/main...x'), false);
    assert.equal(isPullRequestUrl('https://gitlab.com/o/r/merge_requests/1'), false);
    assert.equal(isPullRequestUrl('not a url'), false);
    assert.equal(isPullRequestUrl(null), false);
  });
});

describe('isFreshRun — the single LIN-2955 Q1 predicate (LIN-2952 consumes it)', () => {
  test('a plain row is fresh; every continuation shape is not', () => {
    assert.equal(isFreshRun({ dispatchedAt: new Date() }), true, 'a bare fresh dispatch is a Go');
    assert.equal(isFreshRun({ followUpTo: 'parent-1' }), false, 'a follow-up continues a run');
    assert.equal(isFreshRun({ sessionId: 'run-1' }), false, 'a worker continues its orchestrator run');
    assert.equal(isFreshRun({ cascade: true }), false, 'a cascade emits aborts, not runs');
    assert.equal(isFreshRun({ kind: 'wake' }), false, 'a wake continues a run');
    assert.equal(isFreshRun({ abort: true }), false, 'an abort closes a session');
    assert.equal(isFreshRun(null), false);
  });
});

describe('isFreshRun agrees with countFreshRunsSince\'s Mongo filter (LIN-3238 #1715 x LIN-2952)', () => {
  test('the JS predicate and the run-count filter select the same fixture rows', async () => {
    // #1715 has no exported JS predicate, so isFreshRun (lib/dispatch-store.js) is
    // the single JS form and countFreshRunsSince's query must state the same
    // clauses. One fixture row per clause, split across queue and history, plus
    // out-of-scope (other account, before the window) rows.
    const db = harness.freshDb();
    const queue = db.collection('dispatch-queue');
    const history = db.collection('dispatch-history');
    const store = new DispatchQueueStore({ collection: queue, historyCollection: history });

    const me = 'acct-me';
    const since = PAST(60 * 60 * 1000);
    const rows = [
      dispatchRow(me, PAST(1000), {}),                        // fresh
      dispatchRow(me, PAST(2000), { kind: 'implementation' }), // fresh, any kind
      dispatchRow(me, PAST(3000), { followUpTo: 'p-1' }),     // follow-up
      dispatchRow(me, PAST(4000), { sessionId: 's-1' }),      // worker continues a run
      dispatchRow(me, PAST(5000), { cascade: true }),         // cascade
      dispatchRow(me, PAST(6000), { kind: 'wake' }),          // wake
      dispatchRow(me, PAST(7000), { abort: true }),           // abort
      dispatchRow('someone-else', PAST(1500), {}),            // another person
      dispatchRow(me, PAST(2 * 60 * 60 * 1000), {})           // before the window
    ];
    await queue.insertMany(rows.slice(0, 5));
    await history.insertMany(rows.slice(5));

    const expected = rows
      .filter(r => r.dispatchedBy === me && r.dispatchedAt >= since)
      .filter(isFreshRun).length;
    const counted = await store.countFreshRunsSince([me], since);
    assert.strictEqual(counted, expected, 'countFreshRunsSince must agree with isFreshRun');
    assert.strictEqual(counted, 2, 'only the two in-scope fresh rows are a Go');
  });
});

describe('stepsForAccountGroup — five steps, three states (LIN-2952)', () => {
  const readSteps = (w, accountIds, overrides = {}) => stepsForAccountGroup({
    accountIds,
    accountStore: w.accountStore,
    accountWorkspaceStore: w.accountWorkspaceStore,
    dispatchQueue: w.dispatchQueue,
    dispatchHistory: w.dispatchHistory,
    funnelEventStore: w.funnelEventStore,
    ...overrides
  });

  test('reads each step\'s own recorded time; merge-clicked is no-signal until instrumented', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const loginAt = PAST(4000);
    await w.accountStore.collection.updateOne({ _id: a._id }, { $set: { createdAt: loginAt } });
    const connectedAt = PAST(3000);
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-1');
    await w.accountWorkspaceStore.collection.updateOne({ accountId: a._id }, { $set: { createdAt: connectedAt } });
    const goAt = PAST(2000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, goAt));
    const prAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1500), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/9', timestamp: prAt }]
    }));

    const { steps, outOfOrder } = await readSteps(w, [a._id]);
    assert.equal(steps.login.state, STEP_STATES.REACHED);
    assert.equal(steps.login.at, loginAt.toISOString());
    assert.equal(steps.connected.at, connectedAt.toISOString());
    assert.equal(steps.firstGo.at, goAt.toISOString(), 'first Go is the earliest dispatch');
    assert.equal(steps.prOpened.at, prAt.toISOString(), 'PR opened is the evidence-entry time');
    assert.equal(steps.mergeClicked.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.mergeClicked.at, null, 'no timestamp is synthesized for a no-signal step');
    assert.deepEqual(outOfOrder, []);
  });

  test('finds a dispatch recorded under a merged-away id (whole-group read)', async () => {
    const w = freshWorld();
    const canonical = await w.accountStore.createAccount();
    const merged = await w.accountStore.createAccount();
    assert.equal((await w.accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);
    const goAt = PAST(2000);
    await w.dispatchHistory.insertOne(dispatchRow(merged._id, goAt));

    const { steps } = await readSteps(w, [canonical._id, merged._id]);
    assert.equal(steps.firstGo.state, STEP_STATES.REACHED);
    assert.equal(steps.firstGo.at, goAt.toISOString());
  });

  test('never reads another account\'s dispatches', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const stranger = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(stranger._id, PAST(5000), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/1', timestamp: PAST(4000) }]
    }));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.firstGo.state, STEP_STATES.NOT_REACHED);
    assert.equal(steps.prOpened.state, STEP_STATES.NOT_REACHED);
  });

  test('first Go is one fresh Go press — follow-up, worker, cascade, wake and abort rows are continuations, not a Go', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(6000), { abort: true }));
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(5000), { followUpTo: 'parent-1' }));
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(4500), { sessionId: 'run-1' }));
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(4000), { cascade: true }));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(3500), { kind: 'wake' }));
    const goAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, goAt));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.firstGo.at, goAt.toISOString(), 'only the fresh Go press counts as first Go');
  });

  test('G1a: a lone follow-up row is not a Go — firstGo is not-reached', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(2000), { followUpTo: 'parent-1' }));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.firstGo.state, STEP_STATES.NOT_REACHED, 'a continuation is not a Go press');
    assert.equal(steps.firstGo.at, null);
  });

  test('PR opened is not narrowed: evidence on a follow-up/worker continuation still counts', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const prAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(2000), {
      followUpTo: 'parent-1',
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/9', timestamp: prAt }]
    }));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.firstGo.state, STEP_STATES.NOT_REACHED, 'the follow-up run is a continuation, not a Go');
    assert.equal(steps.prOpened.at, prAt.toISOString(), 'PR evidence rides the run\'s later continuation rows');
  });

  test('PR opened requires an EVIDENCE entry whose url is a PR', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const prAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(3000), {
      feedback: [
        { kind: 'evidence', url: 'https://github.com/o/r/issues/5', timestamp: PAST(2500) }, // not a PR
        { kind: 'status', url: 'https://github.com/o/r/pull/5', timestamp: PAST(2000) },      // not evidence
        { kind: 'evidence', url: 'https://github.com/o/r/pull/6', timestamp: prAt }           // the one
      ]
    }));

    const { steps } = await readSteps(w, [a._id], { dispatchHistory: driverProjected(w.dispatchHistory) });
    assert.equal(steps.prOpened.at, prAt.toISOString());
  });

  test('PR opened reads a collapsed feedback object without throwing (MangoDB projection)', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(3000), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/6', timestamp: PAST(1000) }]
    }));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.prOpened.state, STEP_STATES.REACHED);
  });

  test('the route reader projects both dispatch reads: no prompt, no feedback message', async () => {
    const w = freshWorld();
    const seen = [];
    const recording = () => ({
      find(_filter, options) { seen.push(options?.projection ?? null); return { toArray: async () => [] }; }
    });
    await readSteps(w, ['a'], { dispatchQueue: recording(), dispatchHistory: recording() });

    assert.equal(seen.length, 2, 'both dispatch collections were read');
    for (const projection of seen) {
      assert.ok(projection, 'the read is projected');
      assert.equal(projection.prompt, undefined, 'prompt must never be projected');
      assert.equal(projection['feedback.message'], undefined, 'the raw feedback body must never be projected');
      assert.equal(projection['feedback.kind'], 1);
      assert.equal(projection['feedback.url'], 1);
    }
  });

  test('no dispatch collection injected is no-signal, not not-reached', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();

    const { steps } = await readSteps(w, [a._id], { dispatchQueue: null, dispatchHistory: null });
    assert.equal(steps.firstGo.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.prOpened.state, STEP_STATES.NO_SIGNAL);
  });

  test('flags an out-of-order step without reordering or dropping it', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const loginAt = PAST(1000);
    await w.accountStore.collection.updateOne({ _id: a._id }, { $set: { createdAt: loginAt } });
    const goAt = PAST(5000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, goAt));

    const { steps, outOfOrder } = await readSteps(w, [a._id]);
    assert.deepEqual(outOfOrder, ['firstGo']);
    assert.equal(steps.login.at, loginAt.toISOString(), 'times are not reordered');
    assert.equal(steps.firstGo.at, goAt.toISOString());
  });

  test('a failed dispatch read is no-signal, not not-reached', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const throwing = { find() { throw new Error('db down'); } };

    const { steps } = await readSteps(w, [a._id], { dispatchQueue: throwing, dispatchHistory: null });
    assert.equal(steps.firstGo.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.prOpened.state, STEP_STATES.NO_SIGNAL);
  });

  test('R2: an instrumented merge-click read that throws is no-signal, never not-reached', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const throwing = new FunnelEventStore({ collection: { find: () => { throw new Error('db down'); } } });

    const { steps } = await readSteps(w, [a._id], { funnelEventStore: throwing, instrumentedSteps: ['merge-clicked'] });
    assert.equal(steps.mergeClicked.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.mergeClicked.at, null);
  });

  test('an empty group reads every un-instrumented step as not-reached (merge-click no-signal)', async () => {
    const w = freshWorld();
    const { steps } = await readSteps(w, []);
    assert.equal(steps.login.state, STEP_STATES.NOT_REACHED);
    assert.equal(steps.connected.state, STEP_STATES.NOT_REACHED);
    assert.equal(steps.firstGo.state, STEP_STATES.NOT_REACHED);
    assert.equal(steps.prOpened.state, STEP_STATES.NOT_REACHED);
    assert.equal(steps.mergeClicked.state, STEP_STATES.NO_SIGNAL);
  });
});

describe('collectMilestoneFunnel — cross-account aggregate (LIN-2952)', () => {
  const WINDOW_START = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const taskModeEntry = (accountId, over = {}) => ({
    accountId, urlKey: 'ws', issueId: null, issueIdentifier: 'LIN-1',
    rung: 'copy', ready: true, needs: null, act: 'copy', surface: 'swipe', ...over
  });

  test('counts distinct canonical people — a person split across two accounts counts once', async () => {
    const w = freshWorld();
    const canonical = await w.accountStore.createAccount();
    const merged = await w.accountStore.createAccount();
    assert.equal((await w.accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);
    // The same person's dispatches AND mode entry under BOTH recorded ids.
    await w.dispatchHistory.insertOne(dispatchRow(canonical._id, PAST(2000)));
    await w.dispatchHistory.insertOne(dispatchRow(merged._id, PAST(1000)));
    await w.taskModeStore.record(taskModeEntry(canonical._id));
    await w.taskModeStore.record(taskModeEntry(merged._id));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.firstGo.state, 'reached');
    assert.equal(result.steps.firstGo.count, 1, 'one canonical person, not two');
    assert.equal(result.mode.total, 1, 'the mode count folds the merge too');
  });

  test('no-signal vs zero: an absent instrument is never a zero count', async () => {
    const w = freshWorld();
    await w.accountStore.createAccount();

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.firstGo.state, 'reached');
    assert.equal(result.steps.firstGo.count, 0, 'an instrument present with no events is an honest zero');
    assert.equal(result.steps.mergeClicked.state, 'no-signal');
    assert.equal(result.steps.mergeClicked.count, null, 'an absent instrument is no-signal, never 0');

    // With no dispatch deps at all, firstGo degrades to no-signal (not 0).
    const noDispatch = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), dispatchQueue: null, dispatchHistory: null });
    assert.equal(noDispatch.steps.firstGo.state, 'no-signal');
    assert.equal(noDispatch.steps.firstGo.count, null);
  });

  test('R2: an instrumented merge-click read that throws is no-signal, never count 0', async () => {
    const w = freshWorld();
    await w.accountStore.createAccount();
    const throwing = new FunnelEventStore({ collection: { find: () => { throw new Error('db down'); } } });

    const result = await collectMilestoneFunnel({
      since: WINDOW_START, ...aggDeps(w), funnelEventStore: throwing, instrumentedSteps: ['merge-clicked']
    });
    assert.equal(result.steps.mergeClicked.state, 'no-signal');
    assert.equal(result.steps.mergeClicked.count, null);
  });

  test('G1a: continuations never inflate firstGo — a world of follow-up/worker/cascade/wake rows counts 0', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(4000), { followUpTo: 'parent-1' }));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(3000), { sessionId: 'run-1' }));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(2000), { cascade: true }));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000), { kind: 'wake' }));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.firstGo.state, 'reached');
    assert.equal(result.steps.firstGo.count, 0, 'no fresh Go press among the continuations');

    // One real fresh row on top of the continuations is exactly one Go.
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(500)));
    const withGo = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(withGo.steps.firstGo.count, 1);
  });

  test('publishes the notReady subset of the mode entry rungs', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.taskModeStore.record(taskModeEntry(a._id, { rung: 'copy', ready: false, needs: 'prompt', act: 'press' }));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    const copy = result.mode.byRung.find(r => r.rung === 'copy');
    assert.equal(copy.entries, 1);
    assert.equal(copy.notReady, 1, 'the not-ready subset is published alongside the entry count');
  });

  test('an absent dep is no-signal for every step, and the mode is null', async () => {
    const absent = await collectMilestoneFunnel({ since: WINDOW_START });
    for (const key of ['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']) {
      assert.equal(absent.steps[key].state, STEP_STATES.NO_SIGNAL, `${key} must be no-signal`);
      assert.equal(absent.steps[key].count, null);
    }
    assert.equal(absent.mode, null);
  });

  test('a failing cohort read makes all five steps no-signal, never zero (funnel only, LIN-3501)', async () => {
    const w = freshWorld();
    const throwing = { collection: { find() { throw new Error('boom'); } } };
    const { steps, mode } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), taskModeStore: undefined, accountStore: throwing });
    for (const key of ['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']) {
      assert.equal(steps[key].state, STEP_STATES.NO_SIGNAL, `${key} must be no-signal`);
      assert.equal(steps[key].count, null);
    }
    assert.equal(mode, null);
  });

  // LIN-3501 close-out L2: "any person's no-signal step makes the whole step no-signal, count null,
  // never a partial count". A person B who DID reach must not leak a count of 1 when person A's
  // read fails, which is what `every(no-signal)` instead of `includes(no-signal)` would do.
  test('one person\'s unreadable step makes the whole step no-signal, never a partial count (LIN-3501)', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const b = await w.accountStore.createAccount();
    const prEvidence = [{ kind: 'evidence', url: 'https://github.com/o/r/pull/1', timestamp: PAST(500) }];
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(2000), { feedback: prEvidence }));
    await w.dispatchHistory.insertOne(dispatchRow(b._id, PAST(1500), { feedback: prEvidence }));

    // Throws only for A's group; B's read delegates to the real collection.
    const failsForA = {
      find(filter, options) {
        if (filter?.dispatchedBy?.$in?.includes(a._id)) throw new Error('read failed for A');
        return w.dispatchHistory.find(filter, options);
      }
    };

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), dispatchHistory: failsForA });
    assert.equal(steps.login.count, 2, 'both people signed up in the window');
    for (const key of ['firstGo', 'prOpened']) {
      assert.equal(steps[key].state, STEP_STATES.NO_SIGNAL, `${key}: one person's no-signal makes the step no-signal`);
      assert.equal(steps[key].count, null, `${key}: never a partial count of the person who did read`);
    }

    // Control: with A's read healthy, both people reach both steps.
    const healthy = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(healthy.steps.firstGo.count, 2);
    assert.equal(healthy.steps.prOpened.count, 2);
  });

  test('a candidate whose sign-in cannot be read makes all five steps no-signal, not an under-count', async () => {
    const w = freshWorld();
    await w.accountStore.createAccount();
    const accountStore = Object.create(w.accountStore, { getAccount: { value: async () => { throw new Error('boom'); } } });

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), accountStore });
    for (const key of ['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']) {
      assert.equal(steps[key].state, STEP_STATES.NO_SIGNAL, `${key} must be no-signal`);
    }
  });

  test('a throwing dispatch collection: first go and PR opened are no-signal, the other steps still count', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-1');
    const rejecting = { find: () => ({ toArray: async () => { throw new Error('boom'); } }) };

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), dispatchHistory: rejecting });
    assert.equal(steps.firstGo.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.firstGo.count, null, 'never a partial count');
    assert.equal(steps.prOpened.state, STEP_STATES.NO_SIGNAL);
    assert.equal(steps.prOpened.count, null);
    assert.equal(steps.login.count, 1);
    assert.equal(steps.connected.count, 1);
  });

  test('R3: the mode still rejects — a throwing task-mode store, or an unreadable account list under it (LIN-3002)', async () => {
    const w = freshWorld();
    await assert.rejects(
      collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), taskModeStore: { countByEntryRung: async () => { throw new Error('boom'); } } }),
      /boom/
    );
    // Only the unfiltered account read throws, so the funnel's own cohort read works.
    const allThrows = { ...w.accountStore, collection: { find: (filter, opts) => {
      if (Object.keys(filter || {}).length === 0) throw new Error('boom');
      return w.accountStore.collection.find(filter, opts);
    } } };
    Object.setPrototypeOf(allThrows, w.accountStore);
    await assert.rejects(
      collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), accountStore: allThrows }),
      /boom/
    );
  });

  test('R4: the aggregate dispatch read is projected to predicate + feedback-link fields only', async () => {
    const w = freshWorld();
    await w.accountStore.createAccount();
    const seen = [];
    const recording = () => ({
      find(_filter, options) { seen.push(options?.projection ?? null); return { toArray: async () => [] }; }
    });

    await collectMilestoneFunnel({
      since: WINDOW_START, ...aggDeps(w), dispatchQueue: recording(), dispatchHistory: recording()
    });

    assert.ok(seen.length >= 1, 'the aggregate read the dispatch collections');
    for (const projection of seen) {
      assert.equal(projection.prompt, undefined, 'prompt must never be projected');
      assert.equal(projection['feedback.message'], undefined, 'the raw feedback body must never be projected');
      assert.equal(projection.dispatchedBy, 1);
      assert.equal(projection.dispatchedAt, 1);
      assert.equal(projection['feedback.kind'], 1);
      assert.equal(projection['feedback.url'], 1);
    }
  });

  test('M2: an aggregate abort row is not a first Go', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const b = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(6000), { abort: true }));
    await w.dispatchHistory.insertOne(dispatchRow(b._id, PAST(1000)));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.firstGo.state, 'reached');
    assert.equal(result.steps.firstGo.count, 1, 'the abort row is not a Go press');
  });

  test('M3: a person\'s first-ever dispatch counts, however old (the funnel is first-ever, not windowed)', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(31 * DAY)));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.firstGo.count, 1);
  });

  test('M4: an out-of-window account is excluded from aggregate login', async () => {
    const w = freshWorld();
    await w.accountStore.createAccount();
    const old = await w.accountStore.createAccount();
    await w.accountStore.collection.updateOne({ _id: old._id }, { $set: { createdAt: PAST(31 * 24 * 60 * 60 * 1000) } });

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.login.state, 'reached');
    assert.equal(result.steps.login.count, 1, 'only the in-window account counted');
  });

  test('M5: a person with an old membership edge and an in-window sign-in still counts as connected', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-1');
    await w.accountWorkspaceStore.collection.updateOne({ accountId: a._id }, { $set: { createdAt: PAST(31 * DAY) } });

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.connected.count, 1);
  });

  test('M6: a non-evidence entry with a PR URL does not count as PR opened', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000), {
      feedback: [{ kind: 'status', url: 'https://github.com/o/r/pull/9', timestamp: PAST(500) }]
    }));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.prOpened.state, 'reached');
    assert.equal(result.steps.prOpened.count, 0, 'a non-evidence entry is not PR-opened evidence');
  });

  test('M7: an evidence entry with a non-PR URL does not count as PR opened', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/issues/5', timestamp: PAST(500) }]
    }));

    const result = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(result.steps.prOpened.state, 'reached');
    assert.equal(result.steps.prOpened.count, 0, 'a non-PR URL is not PR-opened evidence');
  });

  test('an abort row carrying PR evidence is not PR opened — route and aggregate', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000), {
      abort: true,
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/9', timestamp: PAST(500) }]
    }));

    const aggregate = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(aggregate.steps.prOpened.count, 0, 'an abort row is not a PR-opened row in the aggregate');

    const route = await stepsForAccountGroup({ accountIds: [a._id], ...aggDeps(w) });
    assert.equal(route.steps.prOpened.state, 'not-reached');
  });

  test('an older account active in the window is left out of every step', async () => {
    const w = freshWorld();
    const old = await w.accountStore.createAccount();
    await w.accountStore.collection.updateOne({ _id: old._id }, { $set: { createdAt: PAST(40 * DAY) } });
    await w.accountWorkspaceStore.bindAccountToWorkspace(old._id, 'ws-1');
    await w.dispatchHistory.insertOne(dispatchRow(old._id, PAST(1000), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/9', timestamp: PAST(500) }]
    }));

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    for (const key of ['login', 'connected', 'firstGo', 'prOpened']) {
      assert.equal(steps[key].state, STEP_STATES.REACHED, key);
      assert.equal(steps[key].count, 0, `${key}: the 40-day-old account is not in the cohort`);
    }
  });

  test('one person active in two workspaces counts once per step', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-1');
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-2');
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(3000), { urlKey: 'ws-1' }));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(2000), { urlKey: 'ws-2' }));
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(1000), { urlKey: 'ws-2' }));

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(steps.login.count, 1);
    assert.equal(steps.connected.count, 1);
    assert.equal(steps.firstGo.count, 1);
  });

  test('a merged group with both accounts in the window counts once, under rows from either id', async () => {
    const w = freshWorld();
    const canonical = await w.accountStore.createAccount();
    const merged = await w.accountStore.createAccount();
    assert.equal((await w.accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);
    await w.accountWorkspaceStore.bindAccountToWorkspace(merged._id, 'ws-1');
    await w.dispatchHistory.insertOne(dispatchRow(merged._id, PAST(1000)));

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(steps.login.count, 1, 'two accounts, one person');
    assert.equal(steps.connected.count, 1);
    assert.equal(steps.firstGo.count, 1);
  });

  test('an in-window account merged into a 40-day-old canonical is not a new person', async () => {
    const w = freshWorld();
    const canonical = await w.accountStore.createAccount();
    await w.accountStore.collection.updateOne({ _id: canonical._id }, { $set: { createdAt: PAST(40 * DAY) } });
    const fresh = await w.accountStore.createAccount();
    assert.equal((await w.accountStore.mergeAccounts(canonical._id, fresh._id)).ok, true);
    await w.dispatchHistory.insertOne(dispatchRow(fresh._id, PAST(1000)));

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(steps.login.count, 0);
    assert.equal(steps.firstGo.count, 0);
  });

  test('a person counts at their first-ever step even when it predates the window', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000)));
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(100)));

    const { steps } = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(steps.firstGo.count, 1, 'a second Go is not a second person');
  });

  test('an empty cohort reads an absent or uninstrumented step as no-signal, a present one as zero', async () => {
    const w = freshWorld();
    const empty = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) });
    assert.equal(empty.steps.login.count, 0);
    assert.equal(empty.steps.firstGo.count, 0);
    assert.equal(empty.steps.mergeClicked.state, STEP_STATES.NO_SIGNAL, 'not instrumented');

    const noDispatch = await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w), dispatchQueue: null, dispatchHistory: null });
    assert.equal(noDispatch.steps.firstGo.state, STEP_STATES.NO_SIGNAL);
    assert.equal(noDispatch.steps.prOpened.state, STEP_STATES.NO_SIGNAL);
    assert.equal(noDispatch.steps.login.count, 0);
  });

  test('carries counts and labels only — no account id, workspace key, issue id or PR url', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'SECRET-WSID');
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1000), {
      urlKey: 'SECRET-WSKEY', issueIdentifier: 'SECRET-ISSUE',
      feedback: [{ kind: 'evidence', url: 'https://github.com/SECRET-OWNER/SECRET-REPO/pull/9', timestamp: PAST(500) }]
    }));

    const serialized = JSON.stringify(await collectMilestoneFunnel({ since: WINDOW_START, ...aggDeps(w) }));
    for (const canary of [a._id, 'SECRET-WSID', 'SECRET-WSKEY', 'SECRET-ISSUE', 'SECRET-OWNER', '/pull/9']) {
      assert.ok(!serialized.includes(canary), `${canary} leaked into the aggregate`);
    }
  });
});
