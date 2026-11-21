/**
 * LIN-4515 (P2, beat 4): the change records' PR reader and the legacy refs.
 *
 * - Reader: the backstop's PR read goes through the one path the close-out chain uses (readPrStatusOf, which readPrStatuses
 *   calls too). A GitHub-bound repo reads with the workspace's own token; a Linear- or Jira-bound one with the owner's
 *   installation token; an unresolved workspace reads anonymously, and a private repo then reads unreadable, so its change is
 *   written headless rather than guessed.
 * - Legacy refs: a change written before the ref rule keeps its stored ref. A revise that names that same ref, a head revise,
 *   a refresh and an end all pass; only a ref being written or changed is validated.
 *
 * Real records store (MangoDB), real writers and the real close-out reader; only the PR reader and the tokens are faked.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createChangeBackstop, createChangePrReaders, refreshTaskChanges } from '../../lib/change-records.js';
import { readPrStatuses } from '../../lib/close-out-readiness.js';

const URL_KEY = 'lin-4515-beat4-workspace';
const TICKET = 'LIN-4515';
const REPO = 'acme/widget';
const PR_URL = `https://github.com/${REPO}/pull/41`;
const RUN = 'run-impl-beat4';
const T0 = '2026-11-21T10:00:00.000Z';

const harness = createMangoTmpdir('lin-4515-readers-legacy-');
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
  const writes = createRecordWrites({ recordsStore: store, isTerminalState, stageKinds: [], listPeople: async () => [] });
  return { store, writes };
}

async function taskFor(store) {
  return (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Slice 3 P2.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
}

/** A readable PR status in the shape fetchPrStatus returns. */
const readable = (sha) => ({ repo: REPO, readable: true, number: 41, state: 'open', merged: false, head: { ref: 'feat', sha }, ref: sha, checks: [] });

/** A recording seam: every status read is kept, and each returns `status`. */
function spySeam(status = readable('H1')) {
  const seen = [];
  return { seen, seam: { readPrStatus: async (args) => { seen.push(args); return status; } } };
}

describe('legacy refs: a change written before the rule keeps its stored ref', () => {
  /** A change as it was stored before the rule existed: the store takes it as it is (the checks did not exist then). */
  async function legacyChange(store, taskId) {
    const snap = await store.add(URL_KEY, { kind: 'change', state: 'open', fields: { ref: 'PR 9', head: 'abc' }, links: {}, in: taskId }, { by: 'implementation', at: T0 });
    return snap.id;
  }

  test('a revise that names the stored ref unchanged passes, and so does a head revise', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await legacyChange(store, taskId);
    const named = await writes.revise({ urlKey: URL_KEY, id, input: { ref: 'PR 9', head: 'def', reason: 'the same ref' }, by: 'harbour' });
    assert.ok(!named.problems, `the unchanged ref was refused: ${JSON.stringify(named.problems)}`);
    assert.equal(named.record.fields.ref, 'PR 9', 'the legacy ref is kept as stored');
    const headOnly = await writes.revise({ urlKey: URL_KEY, id, input: { head: 'ghi', reason: 'a head move' }, by: 'harbour' });
    assert.ok(!headOnly.problems);
    assert.equal(headOnly.record.fields.head, 'ghi');
  });

  test('a revise that changes a legacy ref is validated, and refused for a ref with no PR URL', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await legacyChange(store, taskId);
    const changed = await writes.revise({ urlKey: URL_KEY, id, input: { ref: 'some other prose', reason: 'rename' }, by: 'harbour' });
    assert.ok(changed.problems, 'a changed ref is validated');
    assert.equal(changed.problems[0].field, 'ref');
  });

  test('refreshing a legacy change never 422s and never reads the PR: it is skipped as having no PR URL', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await legacyChange(store, taskId);
    let reads = 0;
    const answers = await refreshTaskChanges({
      urlKey: URL_KEY, taskId, writes, recordsStore: store,
      readPrStatus: async () => { reads += 1; return readable('H9'); },
    });
    assert.deepEqual(answers, [{ id, skipped: 'no PR URL' }]);
    assert.equal(reads, 0);
  });

  test('ending a legacy change abandoned passes', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    const id = await legacyChange(store, taskId);
    const out = await writes.end({ urlKey: URL_KEY, id, input: { state: 'abandoned', reason: 'the work was dropped' }, by: 'harbour' });
    assert.ok(!out.problems, JSON.stringify(out.problems));
    assert.equal(out.record.state, 'abandoned');
  });
});

describe('the change PR reader: one path, the workspace\'s credential', () => {
  test('a GitHub-bound repo is read with the workspace\'s own token, scoped to the workspace', async () => {
    const { seen, seam } = spySeam();
    const reader = createChangePrReaders({
      resolveAccess: async () => ({ callScope: { token: 'ghs_own', repo: REPO }, providerKind: 'github' }),
      seam,
    })(URL_KEY);
    await reader({ repo: REPO, number: 41 });
    assert.equal(seen[0].token, 'ghs_own');
    assert.equal(seen[0].scopeKey, URL_KEY);
  });

  test('a Linear-bound repo is read with the owner installation token, minted for the live workspace', async () => {
    const { seen, seam } = spySeam();
    const reader = createChangePrReaders({
      resolveAccess: async () => ({ callScope: 'lin-token', providerKind: 'linear' }),
      resolveWorkspaceId: async () => 'ws-id-1',
      installationTokenFor: async ({ workspaceId, repo }) => (workspaceId === 'ws-id-1' && repo === REPO ? 'ghs_install' : null),
      seam,
    })(URL_KEY);
    await reader({ repo: REPO, number: 41 });
    assert.equal(seen[0].token, 'ghs_install');
    assert.equal(seen[0].scopeKey, URL_KEY);
  });

  test('the change reader and the close-out chain reach the fail-open reader with the same arguments for the same PR', async () => {
    const access = async () => ({ callScope: 'lin-token', providerKind: 'linear' });
    const resolveWorkspaceId = async () => 'ws-id-1';
    const installationTokenFor = async ({ workspaceId, repo }) => (workspaceId === 'ws-id-1' && repo === REPO ? 'ghs_install' : null);
    const { seen, seam } = spySeam();
    const reader = createChangePrReaders({ resolveAccess: access, resolveWorkspaceId, installationTokenFor, seam })(URL_KEY);
    await reader({ repo: REPO, number: 41 });
    await readPrStatuses({
      prUrls: [{ repo: REPO, number: 41 }],
      callScope: 'lin-token',
      workspace: { urlKey: URL_KEY, id: 'ws-id-1' },
      seam,
      prStatusCache: null,
      providerKind: 'linear',
      workspaceId: 'ws-id-1',
      installationTokenFor,
    });
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], seen[1], 'one PR read path: the same args reach the reader');
  });

  test('the backstop reads the head through the workspace reader, so a private repo\'s change gets its head', async () => {
    const { store, writes } = await freshStore();
    const taskId = await taskFor(store);
    await store.openRun(URL_KEY, { id: RUN, stage: 'implementation', taskId, lineage: RUN, at: T0 });
    const { seen, seam } = spySeam(readable('H7'));
    const changeBackstop = createChangeBackstop({
      recordsStore: store,
      prReaderFor: createChangePrReaders({
        resolveAccess: async () => ({ callScope: 'lin-token', providerKind: 'linear' }),
        resolveWorkspaceId: async () => 'ws-id-1',
        installationTokenFor: async () => 'ghs_install',
        seam,
      }),
      log: () => {},
    });
    await changeBackstop({ urlKey: URL_KEY, runId: RUN, feedback: [{ message: `DONE: ${PR_URL}` }] });
    const [change] = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(change.fields.head, 'H7', 'the head came from the workspace reader');
    assert.equal(seen[0].token, 'ghs_install', 'and it was read with the owner installation token');
    assert.equal(change.run, RUN);
  });

  test('an unresolved workspace reads anonymously: a private repo is written headless, never guessed', async () => {
    const { store } = await freshStore();
    const taskId = await taskFor(store);
    await store.openRun(URL_KEY, { id: RUN, stage: 'implementation', taskId, lineage: RUN, at: T0 });
    const { seen, seam } = spySeam({ repo: REPO, readable: false, state: 'unknown', reason: 'not visible' });
    const changeBackstop = createChangeBackstop({
      recordsStore: store,
      prReaderFor: createChangePrReaders({ resolveAccess: async () => null, installationTokenFor: async () => null, seam }),
      log: () => {},
    });
    await changeBackstop({ urlKey: URL_KEY, runId: RUN, feedback: [{ message: `DONE: ${PR_URL}` }] });
    const [change] = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.ok(change, 'the change is still written');
    assert.equal(change.fields.head, undefined, 'without a readable head, none is guessed');
    assert.equal(seen[0].token, undefined, 'the read was anonymous');
  });

  test('a backstop built without a reader is refused at construction, so no caller falls back to an anonymous read', async () => {
    const { store } = await freshStore();
    assert.throws(() => createChangeBackstop({ recordsStore: store }), /prReaderFor/);
  });
});
