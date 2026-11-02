/**
 * LIN-4104 D2 — the reach of the last dispatch, and the filled button it selects.
 *
 * `reach` is derived on the server where the dispatch event is recorded (routes/dispatch.js afterEnqueue):
 *   stopAt 'pr' → pr; autopilot with no stopAt → done; run-step → next-step.
 * Legacy rows (recorded before `reach`) map by rung: run-step → next-step, run-task → pr.
 * A workspace with no prior dispatch fills Next step. The filled button is read ONCE per page load (never on the
 * `/state` poll), keyed to the viewer's account group and workspace.
 *
 * Runs on a real MangoDB engine (createMangoTmpdir), so the latest-per-workspace query is exercised, not faked.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TaskModeStore, reachOf, legacyReachOf, filledRungOf, readFilledRung, validateTaskModeEvent, REACHES,
} from '../../lib/task-mode-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const GROUP = ['acct-1', 'acct-2'];
const TASK = { accountId: 'acct-1', urlKey: 'ws', issueId: 'uuid-42', issueIdentifier: 'LIN-42' };
const dispatchAct = (rung, reach, over = {}) => ({ ...TASK, rung, ready: true, needs: null, act: 'dispatch', dispatchId: `d-${Math.random()}`, reach, ...over });
const copyAct = (over = {}) => ({ ...TASK, rung: 'copy', ready: true, needs: null, act: 'copy', ...over });

const harness = createMangoTmpdir('lin-4104-reach-');
before(() => harness.connect());
after(() => harness.close());

// Rows are stamped `at = new Date()`; a pause keeps "latest" meaningful.
const tick = () => new Promise((resolve) => setTimeout(resolve, 4));

describe('reachOf — the reach a recorded dispatch carries (derived where the event is recorded)', () => {
  test('a stopAt pr autopilot run reaches pr', () => {
    assert.equal(reachOf({ kind: 'autopilot', stopAt: 'pr', entryRung: 'run-task' }), 'pr');
  });
  test('an autopilot run with no stopAt reaches done', () => {
    assert.equal(reachOf({ kind: 'autopilot', stopAt: null, entryRung: 'run-task' }), 'done');
    assert.equal(reachOf({ kind: 'autopilot', entryRung: 'run-task' }), 'done');
  });
  test('a run-step (Next step, and Another step, which sends entryRung run-step) reaches next-step', () => {
    assert.equal(reachOf({ kind: 'implementation', entryRung: 'run-step' }), 'next-step');
    assert.equal(reachOf({ entryRung: 'run-step' }), 'next-step');
  });
  test('a dispatch that is not a ladder press has no reach', () => {
    assert.equal(reachOf({ kind: 'implementation', entryRung: null }), null);
    assert.equal(reachOf({}), null);
  });
  test('REACHES is the closed vocabulary', () => {
    assert.deepStrictEqual([...REACHES], ['next-step', 'pr', 'done']);
  });
});

describe('legacyReachOf — rows recorded before `reach` existed map by rung', () => {
  test('run-step → next-step, run-task → pr, anything else → null', () => {
    assert.equal(legacyReachOf('run-step'), 'next-step');
    assert.equal(legacyReachOf('run-task'), 'pr');
    assert.equal(legacyReachOf('copy'), null);
  });
});

describe('filledRungOf — the button the viewer\'s last dispatch fills', () => {
  test('a workspace with no prior dispatch fills Next step', () => {
    assert.equal(filledRungOf(null), 'next-step');
    assert.equal(filledRungOf(undefined), 'next-step');
  });
  test('next-step fills Next step, pr fills Run to PR, done fills Run to Done', () => {
    assert.equal(filledRungOf('next-step'), 'next-step');
    assert.equal(filledRungOf('pr'), 'pr');
    assert.equal(filledRungOf('done'), 'done');
  });
});

describe('validateTaskModeEvent — reach is optional, closed, and the dispatch validator is unchanged', () => {
  test('accepts a dispatch with a known reach, and one without', () => {
    assert.equal(validateTaskModeEvent(dispatchAct('run-task', 'pr')), null);
    assert.equal(validateTaskModeEvent(dispatchAct('run-step', null)), null);
    const { reach: _omitted, ...withoutReach } = dispatchAct('run-step', null);
    assert.equal(validateTaskModeEvent(withoutReach), null);
  });
  test('rejects an unknown reach', () => {
    assert.match(validateTaskModeEvent(dispatchAct('run-task', 'merge')), /reach/);
  });
});

describe('TaskModeStore — the latest dispatch per account group and workspace', () => {
  test('record stores reach on the dispatch event', async () => {
    const store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
    const doc = await store.record(dispatchAct('run-task', 'pr'));
    assert.equal(doc.reach, 'pr');
    const [stored] = await store.collection.find({}).toArray();
    assert.equal(stored.reach, 'pr');
  });

  test('a new workspace (no prior dispatch) reads null, so the button fills Next step', async () => {
    const store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
    assert.equal(await store.lastDispatchReach({ accountIds: GROUP, urlKey: 'ws' }), null);
  });

  test('the latest dispatch in the group and workspace wins; copies never count; other workspaces and accounts are excluded', async () => {
    const store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
    await store.record(dispatchAct('run-task', 'pr', { accountId: 'acct-2' }));
    await tick();
    await store.record(dispatchAct('run-step', 'next-step'));
    await tick();
    await store.record(copyAct());
    await tick();
    await store.record(dispatchAct('run-task', 'done', { urlKey: 'other-ws' }));
    await store.record(dispatchAct('run-task', 'done', { accountId: 'stranger' }));
    const latest = await store.lastDispatchReach({ accountIds: GROUP, urlKey: 'ws' });
    assert.equal(latest.reach, 'next-step', 'the newest dispatch in this workspace for this group, not the copy');
    assert.ok(latest.at, 'it names when that dispatch was recorded');
  });

  test('a legacy dispatch row with no reach maps by its rung (run-task → pr)', async () => {
    const collection = harness.freshDb().collection('task-mode-events');
    await collection.insertOne({ _id: 'legacy-1', accountId: 'acct-1', urlKey: 'ws', issueId: null, issueIdentifier: 'LIN-42', rung: 'run-task', ready: true, needs: null, act: 'dispatch', dispatchId: 'd-old', surface: null, at: new Date() });
    const store = new TaskModeStore({ collection });
    assert.equal((await store.lastDispatchReach({ accountIds: GROUP, urlKey: 'ws' })).reach, 'pr');
  });

  test('a read on a store with no collection, or a failing one, reads null and never throws', async () => {
    assert.equal(await new TaskModeStore({}).lastDispatchReach({ accountIds: GROUP, urlKey: 'ws' }), null);
    const broken = new TaskModeStore({ collection: { find() { throw new Error('boom'); } } });
    assert.equal(await broken.lastDispatchReach({ accountIds: GROUP, urlKey: 'ws' }), null);
  });
});

describe('readFilledRung — read once per page load, into the prompt options', () => {
  test('reads the store once, for the session account group and this workspace, and returns the filled rung', async () => {
    const store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
    await store.record(dispatchAct('run-task', 'pr'));
    const calls = [];
    const spy = { lastDispatchReach: async (args) => { calls.push(args); return store.lastDispatchReach(args); } };
    const accountStore = {
      resolveCanonicalAccountId: async (id) => id,
      listMergedAccounts: async () => [{ _id: 'acct-2' }],
    };
    const rung = await readFilledRung({ taskModeStore: spy, accountStore, accountId: 'acct-1', urlKey: 'ws' });
    assert.equal(rung, 'pr');
    assert.equal(calls.length, 1, 'one read per page load');
    assert.deepStrictEqual([...calls[0].accountIds].sort(), ['acct-1', 'acct-2'], 'the whole merge group');
    assert.equal(calls[0].urlKey, 'ws');
  });

  test('no store or no session account: Next step (no read to make)', async () => {
    assert.equal(await readFilledRung({ taskModeStore: null, accountStore: null, accountId: 'acct-1', urlKey: 'ws' }), 'next-step');
    assert.equal(await readFilledRung({ taskModeStore: { lastDispatchReach: async () => ({ reach: 'pr' }) }, accountId: null, urlKey: 'ws' }), 'next-step');
  });
});

describe('the /state poll does not read the filled rung (read once per page load)', () => {
  test('the /state route and the loader never reference the dispatch reach', () => {
    const route = readFileSync(new URL('../../routes/task-page.js', import.meta.url), 'utf8');
    const start = route.indexOf("router.get('/workspace/:urlKey/api/task/:identifier/state'");
    assert.ok(start > 0, 'the /state route is present');
    const end = route.indexOf('router.get(', start + 10);
    const stateRoute = route.slice(start, end > 0 ? end : undefined);
    assert.doesNotMatch(stateRoute, /readFilledRung|lastDispatchReach|taskModeStore/, '/state reads no dispatch reach');
    const loader = readFileSync(new URL('../../lib/task-page-loader.js', import.meta.url), 'utf8');
    assert.doesNotMatch(loader, /readFilledRung|lastDispatchReach/, 'the loader reads no dispatch reach');
  });
});
