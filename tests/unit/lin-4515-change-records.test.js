/**
 * LIN-4515 (P2 of LIN-4513): change records written per PR, heads refreshed by one function, merges end changes.
 *
 * The witnesses of plan-d5effe81 ("fail before, pass after"), against a real records store on MangoDB, the real
 * checked pipeline (lib/records/writes.js) and the real merge recorder, with only the PR reader and the tracker faked.
 * Witness 6 (the ladder lane makes no PR read) cannot fail before the change, so it is a characterization in
 * tests/unit/lin-4515-characterization.test.js.
 *
 * Engineering choices settled in beat 2 (see the commit message):
 * - Ordering: P2 does not wait for P1 (LIN-4514). P2 changes no decision's output, so the goldens P1 freezes for the
 *   flip (P5) are not needed to land it; the characterization file pins the outputs P2 touches instead.
 * - Backstop id: `fixedIdOf('change', taskId, key)`, where `key` is the case-blind `owner/repo#n`. The existence check
 *   is by ref within the task, because a stage's own change has a store-generated id the backstop cannot know. The
 *   stage writes before the run's terminal entry, so the backstop cannot race it in practice; the fixed id makes a retry
 *   of the backstop itself a no-op.
 * - Head at backstop: read through the injected PR reader. An unreadable PR still gets its change, without a head; the
 *   refresh fills the head once the PR can be read (fail open, as the refresh does).
 * - A change ref with no PR URL is refused at write: the refresh cannot read it and a landing cannot match it.
 *
 * Inert seams: lib/records/change-ref.js and lib/change-records.js return their input or nothing until beat 3, so the
 * assertions below fail on the missing behaviour, not on a missing module.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { askedOf } from '../../lib/asked-of.js';
import { canonicalChangeRef, changeKeyOf } from '../../lib/records/change-ref.js';
import { backstopChangeFor, refreshTaskChanges } from '../../lib/change-records.js';
import { createPipelineMergeRecorder } from '../../lib/close-out-merges.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';

const URL_KEY = 'lin-4515-workspace';
const TICKET = 'LIN-4515';
const REPO = 'acme/widget';
const PR_URL = `https://github.com/${REPO}/pull/41`;
const RUN = 'run-impl-4515';
const T0 = '2026-11-21T10:00:00.000Z';
const OPENED = '2026-11-21T10:05:00Z';
const MERGED = '2026-11-21T12:00:00Z';

const harness = createMangoTmpdir('lin-4515-change-records-');
before(() => harness.connect());
after(() => harness.close());

async function freshStore() {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  const store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(T0),
  });
  const writes = createRecordWrites({
    recordsStore: store, isTerminalState, askedText: askedOf, stageKinds: Object.keys(STAGE_KINDS), listPeople: async () => [],
  });
  return { store, writes, db };
}

/** The task for the ticket, made as the writers make it (a claim on the ticket, so a later merge finds it by ticket). */
async function taskFor(store) {
  const r = await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Slice 3 P2.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 });
  return r.id;
}

/** The stage's own change write, through the checked pipeline. Returns the change's id. */
async function stageChange(writes, taskId, ref, head, by = 'implementation') {
  const r = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref, head }, by });
  assert.ok(!r.problems, `the change write was refused: ${JSON.stringify(r.problems)}`);
  return r.record.id;
}

/** A readable PR status in the shape fetchPrStatus returns: the head is `head.sha`, the merge commit is not read. */
function status({ sha, merged = false, closed = false, extra = {} }) {
  return {
    repo: REPO, readable: true, number: 41,
    state: merged || closed ? 'closed' : 'open', merged,
    head: { ref: 'feat/lin-4515', sha }, ref: sha,
    created_at: OPENED, merged_at: merged ? MERGED : null, checks: [],
    ...extra,
  };
}

/** A fake PR reader, keyed by PR URL as the code keys statuses. `fn(url)` gives the status. */
const reader = (fn) => async ({ repo, number }) => fn(`https://github.com/${repo}/pull/${number}`);

/** The change's versions, ascending (the store returns them unsorted). */
async function versionsOf(store, id) {
  return (await store.versionsOf(URL_KEY, [id])).sort((a, b) => a.v - b.v);
}

describe('witness 1: a moving head', () => {
  test('a head that moves adds one change version per gating read that sees the move, and writes no verdict', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await stageChange(writes, taskId, PR_URL, 'H1');
    let head = 'H2';
    const readPrStatus = reader(() => status({ sha: head }));
    await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus }); // H1 -> H2
    await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus }); // H2 again: no version
    head = 'H3';
    await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus }); // H3
    const versions = await versionsOf(store, id);
    assert.deepEqual(versions.map((v) => v.fields.head), ['H1', 'H2', 'H3']);
    assert.equal((await store.find(URL_KEY, { kind: 'verdict' })).length, 0, 'the refresh writes no verdict');
  });
});

describe('witness 2: a merge ends the change, with the head at merge', () => {
  test('a PR merged and seen only by the refresh ends its change merged, its last head the head at merge, not the merge commit', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await stageChange(writes, taskId, PR_URL, 'H1');
    const readPrStatus = reader(() => status({ sha: 'H9', merged: true, extra: { merge_commit_sha: 'M9' } }));
    await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });
    const ended = await store.find(URL_KEY, { kind: 'change', inRef: taskId, state: 'merged' });
    assert.equal(ended.length, 1, 'the change ends merged');
    assert.equal(ended[0].id, id);
    const versions = await versionsOf(store, id);
    assert.equal(versions.at(-1).fields.head, 'H9', 'the last head is the PR head at merge');
    assert.ok(!versions.some((v) => v.fields.head === 'M9'), 'the merge commit is never a head');
  });

  test('the Done merge seam ends the change merged with the head at merge', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await stageChange(writes, taskId, PR_URL, 'H1');
    const db = harness.freshDb();
    const closeOutEventsStore = new CloseOutEventsStore({ collection: db.collection('close-out-events') });
    const provider = { name: 'github', async fetchIssueComments() { return [{ body: PR_URL, createdAt: '2026-11-21T11:00:00Z', user: 'w' }]; } };
    const dispatchStore = {
      async listItems() { return []; },
      async listHistory() { return []; },
      async getItemStatus() { return null; },
    };
    const recordPipelineMerge = createPipelineMergeRecorder({
      closeOutEventsStore,
      dispatchStore,
      recordsStore: store,
      readPrStatus: reader(() => status({ sha: 'H9', merged: true })),
      log: () => {},
    });
    await recordPipelineMerge({
      urlKey: URL_KEY,
      workspaceId: 'ws-id',
      accountId: 'acct-1',
      provider,
      callScope: { token: 'ghs_token', repo: REPO },
      written: { id: 'iss-1', identifier: TICKET, state: { type: 'completed' } },
    });
    const ended = await store.find(URL_KEY, { kind: 'change', inRef: taskId, state: 'merged' });
    assert.equal(ended.length, 1, 'the merge recorder ends the change merged');
    assert.equal((await versionsOf(store, id)).at(-1).fields.head, 'H9');
  });
});

describe('witness 3: the backstop', () => {
  async function doneImplementationRun(store, taskId) {
    await store.openRun(URL_KEY, { id: RUN, stage: 'implementation', taskId, lineage: RUN, at: T0 });
  }

  test('a done implementation run that reported a PR and has no change gets one, under its run', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    await doneImplementationRun(store, taskId);
    await backstopChangeFor({ urlKey: URL_KEY, taskId, runId: RUN, prUrl: PR_URL, writes, recordsStore: store, readPrStatus: reader(() => status({ sha: 'H1' })) });
    const changes = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(changes.length, 1, 'one change for the PR');
    assert.equal(changes[0].fields.ref, PR_URL);
    assert.equal(changes[0].fields.head, 'H1');
    assert.equal(changes[0].run, RUN, 'the change is written under the run');
  });

  test('a retry of the backstop writes no second change', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    await doneImplementationRun(store, taskId);
    const readPrStatus = reader(() => status({ sha: 'H1' }));
    await backstopChangeFor({ urlKey: URL_KEY, taskId, runId: RUN, prUrl: PR_URL, writes, recordsStore: store, readPrStatus });
    await backstopChangeFor({ urlKey: URL_KEY, taskId, runId: RUN, prUrl: PR_URL, writes, recordsStore: store, readPrStatus });
    assert.equal((await store.find(URL_KEY, { kind: 'change', inRef: taskId })).length, 1);
  });

  test('a stage that already wrote its change gets no second one from the backstop', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    await doneImplementationRun(store, taskId);
    const stagedId = await stageChange(writes, taskId, PR_URL, 'H1');
    await backstopChangeFor({ urlKey: URL_KEY, taskId, runId: RUN, prUrl: PR_URL, writes, recordsStore: store, readPrStatus: reader(() => status({ sha: 'H1' })) });
    const changes = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].id, stagedId);
  });
});

describe('witness 4: an unreadable PR', () => {
  test('leaves its change alone: no new version, still open, head unchanged', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await stageChange(writes, taskId, PR_URL, 'H1');
    await refreshTaskChanges({
      urlKey: URL_KEY, taskId, writes, recordsStore: store,
      readPrStatus: reader(() => ({ repo: REPO, readable: false, state: 'unknown', reason: 'rate limited' })),
    });
    const versions = await versionsOf(store, id);
    assert.equal(versions.length, 1, 'no version is written for an unreadable PR');
    assert.equal(versions[0].fields.head, 'H1');
    assert.equal((await store.find(URL_KEY, { kind: 'change', inRef: taskId, state: 'open' })).length, 1, 'still open');
  });
});

describe('witness 5: the change ref', () => {
  const PROSE = 'https://github.com/JKershaw/LinearViewer/pull/2447 (branch feat/lin-4469-prompt-folds)';
  const BARE = 'https://github.com/JKershaw/LinearViewer/pull/2447';

  test('a ref with branch prose normalises to the bare PR URL, and to the same key', () => {
    assert.equal(canonicalChangeRef(PROSE), BARE);
    assert.equal(changeKeyOf(PROSE), changeKeyOf(BARE));
  });

  test('the key is case-blind on the repository, as GitHub is', () => {
    assert.equal(changeKeyOf(BARE), changeKeyOf(BARE.toLowerCase()));
  });

  test('a change written with prose is stored under the bare URL, so the backstop finds it and writes no second', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    await doneImplementationRun(store, taskId);
    const id = await stageChange(writes, taskId, PROSE, 'H1');
    assert.equal((await store.current(URL_KEY, id)).fields.ref, BARE, 'the stored ref is the bare PR URL');
    await backstopChangeFor({ urlKey: URL_KEY, taskId, runId: RUN, prUrl: BARE, writes, recordsStore: store, readPrStatus: reader(() => status({ sha: 'H1' })) });
    assert.equal((await store.find(URL_KEY, { kind: 'change', inRef: taskId })).length, 1);
  });

  test('a ref that names no PR is refused at write, naming the PR URL form', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const r = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref: 'abc1234', head: 'H1' }, by: 'implementation' });
    assert.ok(r.problems, 'a change ref with no PR URL is refused');
    assert.equal(r.problems[0].field, 'ref');
  });

  async function doneImplementationRun(store, taskId) {
    await store.openRun(URL_KEY, { id: RUN, stage: 'implementation', taskId, lineage: RUN, at: T0 });
  }
});
