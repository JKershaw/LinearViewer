/**
 * LIN-4501 (P1): the run–task seam and the task made at dispatch, on the real records store.
 *
 * - a run that opens for a ticket with a held task opens `in` that task, with no tracker read;
 * - a take with no claimed task makes the task through the checked writer, and the run opens in it;
 * - a take whose fallback fails (the ticket read fails) opens a task-less run and logs `task-missing-at-take`
 *   with the reason;
 * - a task's `asked` is askedOf(description): the sealed words, else the words before the first plan heading,
 *   else the whole description;
 * - the checked writer's taskOfTicket makes a ticket's task once, with that `asked`, and refuses a closed ticket
 *   with its reason.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRunRecords } from '../../lib/run-records.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { splitQuote } from '../../lib/brief-quote.js';
import { askedOf } from '../../lib/asked-of.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { COMPLETED } from '../../lib/providers/models.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'lin-4501-workspace';
const harness = createMangoTmpdir('lin-4501-');
let db;
let store;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
});

/** A tracker fake: `issues` maps identifier -> flattened issue; `failing` makes every read throw. */
function trackerFake(issues, { failing = false } = {}) {
  const reads = [];
  return {
    reads,
    async readTicket(ctx, ref) {
      reads.push(ref);
      if (failing) throw new Error('tracker unreachable');
      return issues[ref] ? structuredClone(issues[ref]) : null;
    }
  };
}

const ticket = (identifier, description, over = {}) => ({
  identifier,
  title: `${identifier} title`,
  description,
  state: { name: 'In Progress', type: 'started' },
  trashed: false,
  parent: null,
  ...over
});

function writesWith(tracker) {
  return createRecordWrites({ recordsStore: store, isTerminalState, readTicket: tracker.readTicket, askedText: askedOf });
}

function seamWith(tracker) {
  const writes = writesWith(tracker);
  const ctx = { provider: 'fake', token: 'fake' };
  return createRunRecords({
    recordsStore: store,
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    taskOfTicket: (urlKey, ref) => writes.taskOfTicket(ctx, urlKey, ref, 'dispatch')
  });
}

const row = (over) => ({ _id: 'row-1', urlKey: URL_KEY, kind: 'implementation', rootItemId: null, runRecordId: null, issueIdentifier: 'LIN-1', ...over });

/** Capture console.log lines for the duration of `fn`, so a named miss can be asserted. */
async function logged(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.log = original;
  }
}

describe('askedOf: the one rule for a task\'s asked', () => {
  test('a sealed description takes its sealed words', () => {
    const description = '## As asked\n\nFix the footer.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*\n\n## Notes\nplan here';
    assert.equal(askedOf(description), splitQuote(description).words);
  });

  test('an unsealed description with a plan takes the words before the plan heading', () => {
    const description = 'Make the seam take its task.\n\nIt matters for briefs.\n\n## Implementation Plan\n\nFiles: lib/run-records.js';
    assert.equal(askedOf(description), 'Make the seam take its task.\n\nIt matters for briefs.');
  });

  test('a phrase in the person\'s own prose is their words, not a cut', () => {
    const description = 'This fits in one change comfortably.\n\nDo the thing.';
    assert.equal(askedOf(description), description);
  });

  test('an unsealed description with no plan takes the whole description, and an empty one takes nothing', () => {
    assert.equal(askedOf('Just the words.'), 'Just the words.');
    assert.equal(askedOf(''), '');
    assert.equal(askedOf(null), '');
  });
});

describe('the run opens in its ticket\'s task', () => {
  test('a held task is used with no tracker read, and the run opens in it', async () => {
    const tracker = trackerFake({ 'LIN-1': ticket('LIN-1', 'Words.') });
    const writes = writesWith(tracker);
    const made = await writes.taskOfTicket({}, URL_KEY, 'LIN-1', 'dispatch');
    assert.ok(made.id, 'the task is made from the ticket');
    tracker.reads.length = 0;

    const run = await seamWith(tracker).onTaken(row({ _id: 'row-held' }));
    assert.equal(run.in, made.id, 'the run is in its ticket\'s task');
    assert.deepEqual(tracker.reads, [], 'a held task is read with no tracker read');
  });

  test('a take with no claimed task makes the task through the checked writer, and the run opens in it', async () => {
    const tracker = trackerFake({ 'LIN-2': ticket('LIN-2', 'Build the seam.\n\n## Implementation Plan\n\nplan') });
    const { value: run, lines } = await logged(() => seamWith(tracker).onTaken(row({ _id: 'row-fallback', issueIdentifier: 'LIN-2' })));
    assert.ok(run.in, 'the run names a task');
    const task = await store.current(URL_KEY, run.in);
    assert.equal(task.kind, 'task');
    assert.equal(task.fields.ref, 'LIN-2');
    assert.equal(task.fields.asked, 'Build the seam.', 'the task takes the words before the plan');
    assert.ok(lines.some((l) => l.startsWith('[task-made-at-take]')), 'the made task is logged');
    assert.deepEqual(tracker.reads, ['LIN-2']);
  });

  test('a take whose fallback fails opens a task-less run and logs task-missing-at-take with the reason', async () => {
    const tracker = trackerFake({}, { failing: true });
    const { value: run, lines } = await logged(() => seamWith(tracker).onTaken(row({ _id: 'row-blind', issueIdentifier: 'LIN-3' })));
    assert.equal(run.state, 'open', 'the run still opens');
    assert.equal(run.in, undefined, 'it names no task');
    const miss = lines.find((l) => l.startsWith('[task-missing-at-take]'));
    assert.ok(miss, 'the miss is logged');
    assert.match(miss, /LIN-3/);
    assert.match(miss, /tracker unreachable/, 'the reason is named');
  });

  test('a closed ticket with no task is a named miss, and the run opens task-less', async () => {
    const tracker = trackerFake({ 'LIN-4': ticket('LIN-4', 'Done already.', { state: { name: 'Done', type: 'completed' } }) });
    const { value: run, lines } = await logged(() => seamWith(tracker).onTaken(row({ _id: 'row-closed', issueIdentifier: 'LIN-4' })));
    assert.equal(run.in, undefined);
    assert.ok(lines.some((l) => l.startsWith('[task-missing-at-take]') && /is closed/.test(l)), 'the closed reason is named');
  });

  test('a row with no ticket opens its run with no task and no miss', async () => {
    const tracker = trackerFake({});
    const { value: run, lines } = await logged(() => seamWith(tracker).onTaken(row({ _id: 'row-free', issueIdentifier: null })));
    assert.equal(run.in, undefined);
    assert.equal(lines.filter((l) => l.startsWith('[task-missing-at-take]')).length, 0);
  });
});

describe('the checked writer makes a ticket\'s task once, with its asked', () => {
  test('taskOfTicket makes the task with askedOf(description) and returns the same id on a second call', async () => {
    const tracker = trackerFake({ 'LIN-5': ticket('LIN-5', 'Words only.') });
    const writes = writesWith(tracker);
    const first = await writes.taskOfTicket({}, URL_KEY, 'LIN-5', 'dispatch');
    const second = await writes.taskOfTicket({}, URL_KEY, 'LIN-5', 'dispatch');
    assert.equal(second.id, first.id);
    assert.equal((await store.current(URL_KEY, first.id)).fields.asked, 'Words only.');
    assert.equal(tracker.reads.length, 1, 'the second call reads no tracker');
  });

  // John's ruling (20 Nov, on LIN-4501): make the closed parent's task first, then link the child.
  test('a completed parent with no task gets its task made and ended done, and the child\'s task is in it', async () => {
    const tracker = trackerFake({
      'LIN-6': ticket('LIN-6', 'Child.', { parent: { identifier: 'LIN-7' } }),
      'LIN-7': ticket('LIN-7', 'Parent words.', { state: { name: 'Done', type: COMPLETED } })
    });
    const made = await writesWith(tracker).taskOfTicket({}, URL_KEY, 'LIN-6', 'dispatch');
    assert.ok(made.id, `the child gets its task (${made.problem || ''})`);
    const child = await store.current(URL_KEY, made.id);
    assert.equal(child.state, 'open', 'the child is open work');
    assert.ok(child.in, 'the child is linked to its parent\'s task');
    const parent = await store.current(URL_KEY, child.in);
    assert.equal(parent.fields.ref, 'LIN-7');
    assert.equal(parent.fields.asked, 'Parent words.');
    assert.equal(parent.state, 'done', 'a completed ticket\'s task ends done');
    assert.match(parent.ended.reason, /closed \(Done\)/);
  });

  test('a canceled parent\'s task ends declined', async () => {
    const tracker = trackerFake({
      'LIN-8': ticket('LIN-8', 'Child.', { parent: { identifier: 'LIN-9' } }),
      'LIN-9': ticket('LIN-9', 'Parent.', { state: { name: 'Canceled', type: 'canceled' } })
    });
    const made = await writesWith(tracker).taskOfTicket({}, URL_KEY, 'LIN-8', 'dispatch');
    const parent = await store.current(URL_KEY, (await store.current(URL_KEY, made.id)).in);
    assert.equal(parent.state, 'declined');
  });

  test('a second child of the same closed parent links to the same task, which is ended once', async () => {
    const tracker = trackerFake({
      'LIN-10': ticket('LIN-10', 'First child.', { parent: { identifier: 'LIN-12' } }),
      'LIN-11': ticket('LIN-11', 'Second child.', { parent: { identifier: 'LIN-12' } }),
      'LIN-12': ticket('LIN-12', 'Parent.', { state: { name: 'Done', type: COMPLETED } })
    });
    const writes = writesWith(tracker);
    const a = await store.current(URL_KEY, (await writes.taskOfTicket({}, URL_KEY, 'LIN-10', 'dispatch')).id);
    const b = await store.current(URL_KEY, (await writes.taskOfTicket({}, URL_KEY, 'LIN-11', 'dispatch')).id);
    assert.equal(a.in, b.in);
    const parent = await store.current(URL_KEY, a.in);
    assert.equal(parent.v, 2, 'made once (v1) and ended once (v2)');
  });

  test('the closed ticket a write names is still refused: only an ancestor is made', async () => {
    const tracker = trackerFake({ 'LIN-13': ticket('LIN-13', 'Done.', { state: { name: 'Done', type: COMPLETED } }) });
    const made = await writesWith(tracker).taskOfTicket({}, URL_KEY, 'LIN-13', 'dispatch');
    assert.equal(made.id, undefined);
    assert.match(made.problem, /LIN-13 is closed/);
  });

  test('a take under a closed parent opens its run in the child\'s task, with no miss', async () => {
    const tracker = trackerFake({
      'LIN-14': ticket('LIN-14', 'Follow-up.', { parent: { identifier: 'LIN-15' } }),
      'LIN-15': ticket('LIN-15', 'Epic.', { state: { name: 'Done', type: COMPLETED } })
    });
    const { value: run, lines } = await logged(() => seamWith(tracker).onTaken(row({ _id: 'row-under-closed', issueIdentifier: 'LIN-14' })));
    assert.ok(run.in);
    assert.equal((await store.current(URL_KEY, run.in)).fields.ref, 'LIN-14');
    assert.equal(lines.filter((l) => l.startsWith('[task-missing-at-take]')).length, 0);
  });
});

describe('askedForTickets: the person\'s words for many tickets in one read (the readers\' source)', () => {
  test('each ticket with a task maps to its asked; no task, or a task with no asked, is absent', async () => {
    const tracker = trackerFake({
      'LIN-20': ticket('LIN-20', 'First words.'),
      'LIN-21': ticket('LIN-21', 'Second words.\n\n## Implementation Plan\n\nplan'),
      'LIN-22': ticket('LIN-22', '')
    });
    const writes = writesWith(tracker);
    for (const ref of ['LIN-20', 'LIN-21', 'LIN-22']) await writes.taskOfTicket({}, URL_KEY, ref, 'dispatch');
    const got = await store.askedForTickets(URL_KEY, ['LIN-20', 'LIN-21', 'LIN-22', 'LIN-99', null, 'LIN-20']);
    assert.deepEqual(Object.fromEntries(got), { 'LIN-20': 'First words.', 'LIN-21': 'Second words.' });
    assert.equal(await store.askedForTicket(URL_KEY, 'LIN-21'), 'Second words.');
    assert.equal(await store.askedForTicket(URL_KEY, 'LIN-99'), null);
    assert.equal((await store.askedForTickets('another-workspace', ['LIN-20'])).size, 0, 'one workspace\'s words never answer another');
  });
});

describe('the dispatch seat makes the task on every dispatch that names a ticket', () => {
  // The real factory on a real dispatch store (the lin-3134 pattern); the store's seam is a recording fake, as
  // server.js injects the real one.
  const dispatch = (store, fields) => createDispatchItem({
    store,
    urlKey: 'acme',
    prompt: 'base',
    finalizePrompt: async () => ({ prompt: 'final', bootstrapToken: null }),
    fields: { promptName: 'Prompt', ...fields }
  });
  const newStore = () => new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

  test('a dispatch naming a ticket asks the seam for its task, passing the dispatch\'s own access resolver', async () => {
    const store = newStore();
    const calls = [];
    store.taskOnDispatch = async (urlKey, ticket, resolveAccess) => {
      calls.push({ urlKey, ticket, access: await resolveAccess() });
      return { id: 'task-1' };
    };
    // A dispatch's access is resolved by the lane (issueAccess); the seam receives the resolver, not a copy.
    await dispatch(store, { issueIdentifier: 'LIN-9' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].urlKey, 'acme');
    assert.equal(calls[0].ticket, 'LIN-9');
    assert.equal(calls[0].access, null, 'no issueAccess given: the resolver answers no access, and the seam decides');
  });

  test('a dispatch naming no ticket does not ask the seam', async () => {
    const store = newStore();
    let asked = 0;
    store.taskOnDispatch = async () => { asked += 1; return { id: 'x' }; };
    await dispatch(store, {});
    assert.equal(asked, 0);
  });

  test('a seam that throws never fails the dispatch, and the miss is logged with its reason', async () => {
    const store = newStore();
    store.taskOnDispatch = async () => { throw new Error('store down'); };
    const { value: item, lines } = await logged(() => dispatch(store, { issueIdentifier: 'LIN-11' }));
    assert.ok(item?._id, 'the dispatch is enqueued');
    assert.ok(lines.some((l) => l.startsWith('[task-missing-at-dispatch]') && /store down/.test(l)), 'the reason is logged');
  });

  test('a seam that names a problem is logged, and the dispatch is enqueued', async () => {
    const store = newStore();
    store.taskOnDispatch = async () => ({ problem: 'LIN-11 is closed (Done); no task can be made for it' });
    const { value: item, lines } = await logged(() => dispatch(store, { issueIdentifier: 'LIN-11' }));
    assert.ok(item?._id);
    assert.ok(lines.some((l) => l.startsWith('[task-missing-at-dispatch]') && /is closed/.test(l)));
  });
});

describe('the readings count a take that opened task-less (records.tasklessRuns)', () => {
  test('a run whose fallback failed counts, a run in its task does not, and --since narrows the window', async () => {
    const { recordsOfSnapshots } = await import('../../scripts/records-readings.mjs');
    const good = trackerFake({ 'LIN-30': ticket('LIN-30', 'Words.') });
    const opened = (at) => createRunRecords({
      recordsStore: store,
      now: () => new Date(at),
      taskOfTicket: (urlKey, ref) => writesWith(ref === 'LIN-30' ? good : trackerFake({}, { failing: true })).taskOfTicket({}, urlKey, ref, 'dispatch')
    });
    await logged(() => opened('2026-11-20T10:00:00.000Z').onTaken(row({ _id: 'row-old', issueIdentifier: 'LIN-31' })));
    await logged(() => opened('2026-11-20T14:00:00.000Z').onTaken(row({ _id: 'row-in', issueIdentifier: 'LIN-30' })));
    await logged(() => opened('2026-11-20T15:00:00.000Z').onTaken(row({ _id: 'row-miss', issueIdentifier: 'LIN-32' })));
    const snaps = await store.snapshots(URL_KEY);
    const asOf = '2026-11-20T16:00:00.000Z';
    assert.deepEqual(recordsOfSnapshots(snaps, asOf).tasklessRuns, { count: 2, of: 3, since: null, asOf, runs: ['row-old', 'row-miss'] });
    const sinceDeploy = recordsOfSnapshots(snaps, asOf, { since: '2026-11-20T12:00:00.000Z' }).tasklessRuns;
    assert.deepEqual([sinceDeploy.count, sinceDeploy.of, sinceDeploy.runs], [1, 2, ['row-miss']], 'since the deploy: only the miss');
  });
});
