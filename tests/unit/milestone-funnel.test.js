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
import { buildCanonicalMap, isPullRequestUrl, stepsForAccountGroup, STEP_STATES } from '../../lib/milestone-funnel.js';
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
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history'),
    funnelEventStore: new FunnelEventStore({ collection: db.collection('funnel-events') })
  };
}

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

  test('first Go excludes abort rows and token-created (non-account) rows', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    await w.dispatchQueue.insertOne(dispatchRow(a._id, PAST(5000), { abort: true }));
    await w.dispatchQueue.insertOne(dispatchRow('token-created-row', PAST(4000)));
    const goAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, goAt));

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.firstGo.at, goAt.toISOString(), 'the abort and the token row are both skipped');
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

    const { steps } = await readSteps(w, [a._id]);
    assert.equal(steps.prOpened.at, prAt.toISOString());
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
