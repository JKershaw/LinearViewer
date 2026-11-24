// =============================================================================
// LIN-4535 review witnesses (PR #2501, verdict-d11e83be): each load-bearing wiring is pinned by a test that goes red when
// the call is removed. The three the review named: the ender in endRunOf (run-records.js), the page-reply finding (filed by
// the comment seam, lib/harbour-comment-post.js, since LIN-4548; the route states the member as `by`) and the ingest in prepareRecommendationInput (recommendation-input.js), plus
// the dispatch seat's ingest (dispatch-factory.js). The other findings: the client-chosen comment id (record before post),
// the per-provider author ids, the cutover at workspace creation, and the finding's time.
// =============================================================================

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRunRecords } from '../../lib/run-records.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';
import { askedOf } from '../../lib/asked-of.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { LinearProvider } from '../../lib/providers/linear/index.js';
import { setLinearFetchImpl, getLinearFetchImpl } from '../../lib/linear-fetch.js';
import {
  postHarbourComment,
  HARBOUR,
  configureHarbourCommentLedger,
  harbourCommentLedgerGaps,
  resetHarbourCommentLedgerGaps,
  LEDGER_REFUSAL,
  LEDGER_ATTEMPTS
} from '../../lib/harbour-comment-post.js';
import {
  configureCommentIngest,
  personCommentsOf,
  ingestPersonComments,
  personFindingsOf
} from '../../lib/comment-ingest.js';

const URL_KEY = 'lin-4535-witness';
const T = (hm) => `2026-11-23T${hm}:00.000Z`;

/** A ledger that records what it is asked to: `failing` makes every record throw (a ledger that never lands). */
function ledgerSpy({ failing = false } = {}) {
  const recorded = new Set();
  const calls = [];
  return {
    calls,
    recorded,
    async record({ urlKey, commentId }) {
      calls.push({ urlKey, commentId });
      if (failing) throw new Error('ledger down');
      recorded.add(commentId);
      return { urlKey, commentId };
    },
    async wereRecordedByHarbour(_urlKey, comments) {
      return new Set((comments || []).map((c) => c.commentId || c.id).filter((id) => recorded.has(id)));
    }
  };
}

// ---- A. the ledger seam: record before post where the tracker takes a client-chosen id -------------------------------

describe('A. the ledger seam records a Linear comment id before the post (finding-4b1858bf)', () => {
  beforeEach(() => resetHarbourCommentLedgerGaps());

  test('a client-chosen id: the record lands first, and the post is made with that same id', async () => {
    const order = [];
    const store = ledgerSpy();
    const originalRecord = store.record;
    store.record = async (args) => { order.push('record'); return originalRecord(args); };
    let postedWith = null;
    const answer = await postHarbourComment({
      urlKey: URL_KEY,
      by: HARBOUR,
      store,
      clientIds: true,
      post: async (commentId) => { order.push('post'); postedWith = commentId; return { success: true, comment: { id: commentId, body: 'x' } }; }
    });
    assert.deepEqual(order, ['record', 'post'], 'the ledger record is written before the tracker is asked to post');
    assert.equal(store.calls[0].commentId, postedWith, 'the recorded id is the id the tracker was given');
    assert.equal(answer.success, true);
  });

  test('a client-chosen id whose record never lands posts NOTHING and answers a refusal (no gap is possible on this path)', async () => {
    let posted = 0;
    const answer = await postHarbourComment({
      urlKey: URL_KEY,
      by: HARBOUR,
      store: ledgerSpy({ failing: true }),
      clientIds: true,
      post: async () => { posted += 1; return { success: true, comment: { id: 'never' } }; }
    });
    assert.equal(posted, 0, 'a comment whose record never lands is never posted, so it can never read as a person\'s');
    assert.deepEqual(answer, LEDGER_REFUSAL);
    assert.equal(harbourCommentLedgerGaps(), 0, 'nothing posted, so nothing is a gap');
  });

  test('a provider that mints its id: the post comes first, and a record that never lands is a counted gap', async () => {
    configureHarbourCommentLedger(null);
    let posted = 0;
    const store = ledgerSpy({ failing: true });
    const answer = await postHarbourComment({
      urlKey: URL_KEY,
      by: HARBOUR,
      store,
      post: async () => { posted += 1; return { id: 'gh-7', body: 'x' }; }
    });
    assert.equal(posted, 1);
    assert.equal(answer.id, 'gh-7', 'the answer is the provider\'s, as before');
    assert.equal(store.calls.length, LEDGER_ATTEMPTS, 'retried the bounded number of times');
    assert.equal(harbourCommentLedgerGaps(), 1, 'and counted as a gap');
  });

  test('Linear declares the client-chosen id, and its commentCreate sends the id it is given (CommentCreateInput.id)', async () => {
    const provider = new LinearProvider();
    assert.equal(provider.clientCommentIds, true);
    const kept = getLinearFetchImpl();
    const sent = [];
    setLinearFetchImpl(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      return new Response(JSON.stringify({ data: { commentCreate: { success: true, comment: { id: body.variables.input.id, body: 'hi', createdAt: T('10:00'), user: { name: 'Harbour' } } } } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const id = '6f1c2a3e-5b7d-4c8e-9f10-112233445566';
      const out = await provider.createComment('lin_api_test', 'LIN-1', 'hi', id);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].variables.input.id, id, 'the mutation sends the id Harbour recorded');
      assert.equal(out.comment.id, id);
    } finally {
      setLinearFetchImpl(kept);
    }
  });
});

// ---- B. the author ids of GitHub and Jira comments (finding-c2347a7d) ----------------------------------------------

describe('B. GitHub and Jira carry the author id the ingest matches (finding-c2347a7d)', () => {
  test('GitHub: a listed comment and a created comment carry the author\'s user id, as a string', async () => {
    const provider = new GitHubProvider();
    provider._clientFor = () => ({
      repo: 'acme/app',
      client: {
        async listComments() { return [{ id: 7, body: 'by Mo', created_at: T('10:00'), user: { id: 42, login: 'mo' } }]; },
        async createComment() { return { id: 8, body: 'by Harbour', created_at: T('10:01'), user: { id: 99, login: 'harbour-bot' } }; }
      }
    });
    const listed = await provider.fetchIssueComments('tok', '12');
    assert.equal(listed[0].authorId, '42');
    assert.equal(listed[0].user, 'mo', 'the display name is unchanged');
    const created = await provider.createComment('tok', '12', 'by Harbour');
    assert.equal(created.authorId, '99');
    const people = [{ accountId: 'mo', name: 'Mo', trackerUserId: '42' }];
    assert.deepEqual(personCommentsOf(listed, { cutoffAt: Date.parse(T('09:00')), people }).map((c) => c.accountId), ['mo'],
      'a GitHub comment by a workspace person\'s GitHub user is that person\'s');
  });

  test('GitHub: a comment with no user id is left out, never credited to anyone', async () => {
    const provider = new GitHubProvider();
    provider._clientFor = () => ({ repo: 'acme/app', client: { async listComments() { return [{ id: 9, body: 'anon', created_at: T('10:00'), user: null }]; } } });
    const listed = await provider.fetchIssueComments('tok', '12');
    assert.equal(listed[0].authorId, null);
    assert.deepEqual(personCommentsOf(listed, { cutoffAt: null, people: [{ accountId: 'mo', trackerUserId: '42' }] }), []);
  });

  test('Jira: a listed comment and a created comment carry the author\'s account id', async () => {
    const provider = new JiraProvider();
    const adfBody = { type: 'doc', version: 1, content: [] };
    provider._clientFor = () => ({
      async listAllComments() { return [{ id: '3', body: adfBody, created: T('10:00'), author: { accountId: 'jira-mo', displayName: 'Mo' } }]; },
      async createComment() { return { id: '4', body: adfBody, created: T('10:01'), author: { accountId: 'jira-bot', displayName: 'Harbour' } }; }
    });
    const listed = await provider.fetchIssueComments('tok', 'PROJ-1');
    assert.equal(listed[0].authorId, 'jira-mo');
    const created = await provider.createComment('tok', 'PROJ-1', 'hi');
    assert.equal(created.authorId, 'jira-bot');
    assert.deepEqual(personCommentsOf(listed, { cutoffAt: null, people: [{ accountId: 'mo', trackerUserId: 'jira-mo' }] }).map((c) => c.accountId), ['mo']);
  });

  test('Local: its comments carry no tracker author id, so none is a person\'s by the ingest (a page reply is filed by its route)', async () => {
    // Local's store writes every comment as "Local" with no author identity. Its person comments reach the workspace only
    // through the page's reply route, which files the finding under the member's account (see section C), so no
    // unledgered person comment exists to ingest there. The ingest leaves a comment with no author id out.
    const localComment = { id: 'l-1', body: 'typed on Local', createdAt: T('10:00'), user: 'Local' };
    assert.deepEqual(personCommentsOf([localComment], { cutoffAt: null, people: [{ accountId: 'mo', trackerUserId: 'local-mo' }] }), []);
  });
});

// ---- C. the page reply route credits a non-owner member (the route's call; finding-a9a85539 (b)) ----------------------

describe('C. the page reply route files a non-owner member\'s reply under that member (the seam files it from the route\'s `by`)', () => {
  const PROVIDER_NAME = 'lin-4535-reply-fake';
  let findings;
  let ledger;

  beforeEach(() => {
    findings = [];
    ledger = ledgerSpy();
    configureHarbourCommentLedger(null);
    configureCommentIngest({
      writes: {
        async add({ urlKey, kind, input, by, via, fixedId, at }) {
          findings.push({ urlKey, kind, by, via, fixedId, at, says: input.says, in: input.in });
          return { record: { id: fixedId } };
        },
        async end() { return { record: null }; }
      },
      listPeople: async () => [{ accountId: 'member-2', name: 'Member', trackerUserId: 'gh-member' }],
      cutoffOf: async () => Date.parse(T('09:00')),
      ledger,
      taskForTicket: async (_urlKey, ticket) => (ticket === 'LIN-901' ? 'task-901' : null),
      taskOfTicket: async () => 'task-901'
    });
    registerProvider({
      name: PROVIDER_NAME,
      supports: (cap) => cap === 'createComment',
      async createComment(_token, issueId, body) {
        return { success: true, comment: { id: 'reply-1', body, createdAt: T('10:30'), user: { name: 'the owner\'s key' } } };
      },
      async issueWriteGuard() { return { id: 'iss-901', trashed: false, team: { id: 't' } }; }
    });
  });

  afterEach(() => configureCommentIngest(null));

  function appFor(accountId) {
    const app = express();
    app.use(express.json());
    app.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => {
        // A real (non-test) token, so the route takes its production path and not the hermetic stub.
        req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-owner-token' };
        req.session = { accountId };
        next();
      },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      customPromptsStore: {},
      reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
      harbourCommentsStore: ledger,
    }));
    return app;
  }

  async function postReply(app, text) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/api/comments/LIN-901`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
      });
      return { status: res.status };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  test('a non-owner member\'s page reply is a finding by person:<the member\'s account>, under the comment\'s fixed id', async () => {
    const { status } = await postReply(appFor('member-2'), 'Take the narrow path.');
    assert.equal(status, 201);
    assert.equal(findings.length, 1, 'the seam wrote the reply\'s finding (the route says `by: person:<member>`; say HARBOUR and this is 0)');
    assert.equal(findings[0].by, 'person:member-2', 'credited to the member, not to the owner whose credential posted it');
    assert.equal(findings[0].fixedId, fixedIdOf('finding', 'comment', 'reply-1'));
    assert.equal(findings[0].via, 'comment');
    assert.equal(findings[0].at, T('10:30'), 'dated by the reply\'s own time');
    assert.deepEqual(ledger.calls.map((c) => c.commentId), ['reply-1'], 'and ledgered as Harbour\'s, so the ingest never takes it again');
  });

  test('LIN-4548: a finding write that throws leaves the reply a 201 (the comment is written)', async () => {
    configureCommentIngest({
      writes: { async add() { throw new Error('records down'); }, async end() { return { record: null }; } },
      listPeople: async () => [], cutoffOf: async () => null, ledger,
      taskForTicket: async () => 'task-901', taskOfTicket: async () => 'task-901'
    });
    const { status } = await postReply(appFor('member-2'), 'Records are down, the reply still lands.');
    assert.equal(status, 201);
    assert.equal(ledger.calls.length, 1);
  });

  // LIN-4541: a reply is a comment, never a ruling. The page reply appends no ruling mark, so its finding holds the person's
  // words exactly, and it reads back as a person's comment with no ruling flag (a ruling is a decision record).
  test('the reply\'s finding holds the person\'s words exactly and reads back with no ruling flag', async () => {
    await postReply(appFor('member-2'), 'Take the wide path.');
    const [filed] = findings;
    assert.equal(filed.says, 'Take the wide path.', 'no mark is appended to the person\'s words');
    const read = personFindingsOf([{ id: filed.fixedId, by: filed.by, via: filed.via, at: filed.at, fields: { says: filed.says } }]);
    assert.equal(read.length, 1);
    assert.equal('ruling' in read[0], false);
  });
});

// ---- D. the dispatch seat ingests the person's comment before the run opens (finding-83a0ca32) ---------------------

const harness = createMangoTmpdir('lin-4535-witness-');
let db;
let store;
before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
});

/** A tracker fake for the task seam: `readTicket` answers a ticket by identifier. */
function trackerFake(issues) {
  return {
    async readTicket(_ctx, ref) { return issues[ref] ? structuredClone(issues[ref]) : null; }
  };
}
const ticket = (identifier, description) => ({ identifier, title: `${identifier} title`, description, state: { name: 'In Progress', type: 'started' }, trashed: false, parent: null });

function writesWith(tracker) {
  return createRecordWrites({ recordsStore: store, isTerminalState, readTicket: tracker.readTicket, askedText: askedOf });
}

const PEOPLE = [{ accountId: 'mo', name: 'Mo', trackerUserId: 'u-mo' }];

describe('D. the dispatch seat ingests the ticket\'s person comments before its run record opens', () => {
  test('a person comment, then a direct dispatch with no recommendation read: the finding exists, dated by the comment, before the run opens', async () => {
    const tracker = trackerFake({ 'LIN-9': ticket('LIN-9', 'Words.') });
    const writes = writesWith(tracker);
    const ctx = { provider: 'fake', token: 'fake' };
    configureCommentIngest({
      writes,
      listPeople: async () => PEOPLE,
      cutoffOf: async () => Date.parse(T('09:00')),
      ledger: ledgerSpy(),
      taskForTicket: (u, t) => store.taskForTicket(u, t),
      taskOfTicket: (c, u, t) => writes.taskOfTicket(c, u, t, 'dispatch')
    });
    try {
      const dispatchStore = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
      // The seat's task seam: the task is made the way server.js makes it (the checked writer, through the dispatch's access).
      dispatchStore.taskOnDispatch = async (urlKey, t, resolveAccess) => {
        await resolveAccess();
        return writes.taskOfTicket(ctx, urlKey, t, 'dispatch');
      };
      const provider = {
        issueDescription: async () => 'Words.',
        fetchIssueComments: async () => [{ id: 'c-mo', body: 'Take the narrow path.', createdAt: T('10:00'), authorId: 'u-mo', user: 'Mo' }]
      };
      await createDispatchItem({
        store: dispatchStore,
        urlKey: URL_KEY,
        prompt: 'base',
        finalizePrompt: async () => ({ prompt: 'final', bootstrapToken: null }),
        issueAccess: () => ({ provider, token: 'tok-real' }),
        fields: { promptName: 'Prompt', issueIdentifier: 'LIN-9' }
      });
      const taskId = await store.taskForTicket(URL_KEY, 'LIN-9');
      assert.ok(taskId, 'the task exists');
      const found = personFindingsOf(await store.find(URL_KEY, { kind: 'finding', inRef: taskId }));
      assert.equal(found.length, 1, 'the seat wrote the person\'s finding (remove the seat call and this is 0)');
      assert.equal(found[0].accountId, 'mo');
      assert.equal(found[0].at, T('10:00'), 'dated by the comment, not by the ingest time');
    } finally {
      configureCommentIngest(null);
    }
  });
});

// ---- E. the ender ends the findings the run's brief carried, at the run that carried them (finding-cc3d47df) ----------

describe('E. the ender ends a person finding at the run whose brief carried it', () => {
  const row = (over) => ({ _id: 'run-1', urlKey: URL_KEY, kind: 'implementation', rootItemId: null, runRecordId: null, issueIdentifier: 'LIN-1', feedback: [], ...over });

  async function seamAndFinding() {
    const tracker = trackerFake({ 'LIN-1': ticket('LIN-1', 'Words.') });
    const writes = writesWith(tracker);
    const ctx = { provider: 'fake', token: 'fake' };
    const taskId = (await writes.taskOfTicket(ctx, URL_KEY, 'LIN-1', 'dispatch')).id;
    const fixedId = fixedIdOf('finding', 'comment', 'c-mo');
    await writes.add({ urlKey: URL_KEY, kind: 'finding', input: { says: 'Take the narrow path.', to: taskId, in: taskId }, by: 'person:mo', via: 'comment', fixedId, at: T('10:00') });
    const seam = createRunRecords({
      recordsStore: store,
      now: () => new Date(T('10:30')),
      taskOfTicket: (u, ref) => writes.taskOfTicket(ctx, u, ref, 'dispatch')
    });
    configureCommentIngest({ writes, listPeople: async () => [], cutoffOf: async () => null, ledger: ledgerSpy(), taskForTicket: async () => taskId, taskOfTicket: async () => taskId });
    return { seam, fixedId, taskId };
  }

  const stateOf = async (id) => (await store.find(URL_KEY, { kind: 'finding' })).find((r) => r.id === id)?.state;

  test('a run whose brief carried the finding ends it when the run ends, by harbour', async () => {
    const { seam, fixedId } = await seamAndFinding();
    try {
      await seam.onTaken(row({ _id: 'run-1' }));
      const brief = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-1' });
      assert.ok(brief.carries?.includes(fixedId), 'the brief carried the finding');
      await seam.onClosed([row({ _id: 'run-1' })], { reason: 'done', terminal: 'done' });
      assert.equal(await stateOf(fixedId), 'done', 'the finding the brief carried is ended (remove the ender call and it stays open)');
    } finally {
      configureCommentIngest(null);
    }
  });

  test('a run that ended without composing a brief ends nothing: the finding stays open for the next run that is briefed', async () => {
    const { seam, fixedId } = await seamAndFinding();
    try {
      await seam.onTaken(row({ _id: 'run-2' }));
      await seam.onClosed([row({ _id: 'run-2' })], { reason: 'done', terminal: 'failed' });
      assert.equal(await stateOf(fixedId), 'open', 'a run that never read its brief did not carry the finding');
    } finally {
      configureCommentIngest(null);
    }
  });
});

// ---- F. a workspace created after boot has its cutover at creation (finding-85c8d859) ----------------------------------

describe('F. a workspace created after boot takes no comment older than its creation', () => {
  test('createWorkspace stamps commentCutoverAt on insert, and the ingest reads that cutover', async () => {
    const writes = [];
    const collection = { async findOneAndUpdate(_filter, update) { writes.push(update); return null; } };
    const before = Date.now();
    const out = await new WorkspaceStore({ collection }).createWorkspace({ id: 'w-new', urlKey: 'acme', provider: 'linear' });
    assert.equal(out.ok, true);
    const cutover = writes[0].$setOnInsert.commentCutoverAt;
    assert.ok(cutover instanceof Date, 'the cutover is set on insert');
    assert.ok(cutover.getTime() >= before, 'at the creation, not at some later boot');
    const older = [{ commentId: 'c-old', authorId: 'u-mo', createdAt: new Date(before - 60_000).toISOString(), body: 'from before the workspace existed' }];
    assert.deepEqual(personCommentsOf(older, { cutoffAt: cutover.getTime(), people: PEOPLE }), [], 'a comment dated before the workspace is never ingested');
  });
});

// ---- G. the finding is dated by the comment (finding-83a0ca32) -----------------------------------------------------------

describe('G. a person\'s finding is dated by the comment\'s own time', () => {
  test('ingestPersonComments writes the finding with the comment\'s createdAt as its at', async () => {
    const seen = [];
    configureCommentIngest({
      writes: { async add(args) { seen.push(args); return { record: {} }; }, async end() { return {}; } },
      listPeople: async () => PEOPLE,
      cutoffOf: async () => null,
      ledger: ledgerSpy(),
      taskForTicket: async () => 'task-1',
      taskOfTicket: async () => 'task-1'
    });
    try {
      await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: [{ id: 'c-mo', body: 'Take it.', createdAt: T('10:00'), authorId: 'u-mo' }] });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].at, T('10:00'), 'the comment\'s time, so a run dispatched after it is correctly later (remove the at and this is undefined)');
    } finally {
      configureCommentIngest(null);
    }
  });
});

// ---- I. a ledger that cannot be read ingests nothing (blind-read finding-d58e9e8f) --------------------------------------

describe('I. a ledger read that fails skips the batch, never crediting Harbour\'s own post to the owner', () => {
  test('the ledger read throws: nothing is written, and a later read with a working ledger takes the comment', async () => {
    const written = [];
    let ledgerUp = false;
    configureCommentIngest({
      writes: { async add(args) { written.push(args); return { record: {} }; }, async end() { return {}; } },
      listPeople: async () => PEOPLE,
      cutoffOf: async () => null,
      ledger: {
        async wereRecordedByHarbour() {
          // The real store throws on a read fault (LIN-4540: every read is strict); the ingest must not take an empty answer.
          if (!ledgerUp) throw new Error('ledger read fault');
          return new Set();
        }
      },
      taskForTicket: async () => 'task-1',
      taskOfTicket: async () => 'task-1'
    });
    const comments = [{ id: 'c-own', body: 'A Harbour post under the owner\'s key.', createdAt: T('10:00'), authorId: 'u-mo' }];
    try {
      const first = await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments });
      assert.deepEqual(first, { ingested: 0, failed: 0 });
      assert.equal(written.length, 0, 'a ledger that cannot be read writes no finding (take an empty answer on a fault and the comment is written as the owner\'s)');
      ledgerUp = true;
      const second = await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments });
      assert.equal(second.ingested, 1, 'the next read, with the ledger up, takes it');
    } finally {
      configureCommentIngest(null);
    }
  });
});

// ---- H. the recommendation input takes the person's comments as findings (finding-a9a85539 (c)) -----------------------

describe('H. prepareRecommendationInput takes a matched person\'s comment as a finding, and reads it back', () => {
  test('the comment by a matched person is in personFindings on return (remove the ingest call and personFindings is empty)', async () => {
    const { prepareRecommendationInput } = await import('../../lib/recommendation-input.js');
    const tracker = trackerFake({ 'LIN-1': ticket('LIN-1', 'Words.') });
    const writes = writesWith(tracker);
    const ctx = { provider: 'fake', token: 'fake' };
    await writes.taskOfTicket(ctx, URL_KEY, 'LIN-1', 'dispatch');
    configureCommentIngest({
      writes,
      listPeople: async () => PEOPLE,
      cutoffOf: async () => Date.parse(T('09:00')),
      ledger: ledgerSpy(),
      taskForTicket: (u, t) => store.taskForTicket(u, t),
      taskOfTicket: (c, u, t) => writes.taskOfTicket(c, u, t, 'dispatch')
    });
    try {
      const out = await prepareRecommendationInput(
        { focusedChild: null, comments: [{ id: 'c-mo', body: 'Take the narrow path.', createdAt: T('10:00'), authorId: 'u-mo', user: 'Mo' }] },
        { dispatchQueueStore: new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() }), urlKey: URL_KEY, identifier: 'LIN-1', recordsStore: store }
      );
      assert.ok(Array.isArray(out.personFindings), 'the person findings are read');
      assert.equal(out.personFindings.length, 1, 'the ingest wrote the comment\'s finding before the read (remove the call and this is 0)');
      assert.equal(out.personFindings[0].accountId, 'mo');
      assert.equal(out.personFindings[0].says, 'Take the narrow path.');
    } finally {
      configureCommentIngest(null);
    }
  });
});
