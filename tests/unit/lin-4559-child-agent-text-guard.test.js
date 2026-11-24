/**
 * LIN-4559 (LIN-4508 piece D): a child agent's words are posted on its parent's row as `agent-text`, a kind that does
 * not speak for the run. Witnesses written before the change (beat 1), observed failing against main.
 *
 * A Claude Code run that hands work to a background agent (a subagent, `subagents/agent-<id>.jsonl`) gets that agent's
 * text relayed onto the run's OWN dispatch row, as `{ kind: 'agent-text', agent: '<child id>', message }`. The child
 * finishes its own piece with words like "[done] found 3 call sites". That line is the child's, not the run's: it must
 * not end the parent, close its lineage, wake the parent's orchestrator, or enter the run's account, and it must not
 * hide a wait the run itself is parked on. Every reader that takes a feedback entry as the run's statement is walked
 * here (the reader list is in the beat-1 report, grepped, not taken from the plan):
 *
 *   - the table and the intake: the `agent-text` row declares a role saying it does not speak for the run
 *     (`speaksForRun: false`), the runner may post it, and both feedback routes keep its kind and its `agent`;
 *   - terminal: findTerminalFeedback, deriveTerminalStatus, hasTerminalMarker, deriveLifecycleStatus, deriveCompletedAt,
 *     deriveWireStatus/deriveWireTerminal, run-liveness, recent runs; its twin, the KPI terminal entry (the digest's
 *     `kpiTerminalEntry`, which lib/kpi-stats.js reads before its `$regexMatch` projection); and the bulk closers'
 *     store filter `noOwnTerminalMarkerFilter` (a row whose only `[done]` is a child's has no terminal of its own);
 *   - wake: findWakeEvent, deriveBlockedStatus, derivePendingPark, and the store's wake mint in `addFeedback`;
 *   - lineage closure: the live closer in `addFeedback` and the pure backfill `selectLineageCloses`;
 *   - the run's account (lib/run-records.js): the run stays open, and its account is the run's own final text;
 *   - waiting: parseParkedWait still sees the run's wait when a child text is the newest entry;
 *   - Live Console (lanes and the timeline bar) and the task page / task timeline (session state, its message).
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FEEDBACK_KINDS, FEEDBACK_KIND_ROLES, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-feedback-kinds.js';
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';
import {
  findTerminalFeedback, deriveTerminalStatus, hasTerminalMarker, deriveLifecycleStatus, deriveCompletedAt,
  deriveWireStatus, deriveWireTerminal, findWakeEvent, deriveBlockedStatus, derivePendingPark, noOwnTerminalMarkerFilter
} from '../../lib/dispatch-terminal.js';
import { selectLineageCloses } from '../../lib/lineage-closure.js';
import { parseParkedWait, buildSessionTelemetry } from '../../lib/session-telemetry.js';
import { deriveLoopFacingFacts, digestFeedback } from '../../lib/digest-feedback.js';
import { runLoopFactsOf } from '../../lib/run-liveness.js';
import { recentRuns } from '../../lib/recent-runs.js';
import { __internal as pipelineInternal } from '../../lib/pipeline-loops.js';
import { enrichLoop, loopIsTerminal } from '../../lib/run-loop-state.js';
import { isLoopActive, deriveLoopLanes, buildTimeline } from '../../lib/live-console.js';
import { runSessionsOf } from '../../lib/task-page-loader.js';
import { deriveSessionWaiting } from '../../routes/dashboard.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRunRecords } from '../../lib/run-records.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { buildApp, call, ACME } from './lib/proxy-fake-deps.js';

const { _buildLoops } = pipelineInternal;

const AGENT = 'agent-a1b2c3';
const CHILD_DONE = '[done] found 3 call sites in lib/dispatch-terminal.js';
const NOW = Date.now();
const ago = (sec) => new Date(NOW - sec * 1000).toISOString();

/** A child agent's words on the parent's row, as the runner relays them. */
const childText = (message, timestamp = ago(5)) => ({ kind: 'agent-text', agent: AGENT, message, url: null, urlLabel: null, timestamp });
const parentText = (message, timestamp) => ({ kind: 'assistant-text', message, url: null, urlLabel: null, timestamp });

/** A live parent: it handed work to a background agent, and the newest entry is that child's `[done]`. */
function liveParentFeedback() {
  return [
    { kind: 'heartbeat', message: '[working] 4 tools/30s · alive', url: null, urlLabel: null, timestamp: ago(120) },
    parentText('Handed the call-site search to a background agent.', ago(90)),
    childText('Searching lib/ for findTerminalFeedback callers.', ago(60)),
    childText(CHILD_DONE, ago(5))
  ];
}

// ── The table and the intake ────────────────────────────────────────────────

describe('LIN-4559: the agent-text kind is one row that says it does not speak for the run', () => {
  const row = FEEDBACK_KINDS.find((r) => r.kind === 'agent-text');

  test('the table has an agent-text row', () => {
    assert.ok(row, 'no `agent-text` row in FEEDBACK_KINDS (lib/dispatch-feedback-kinds.js)');
  });

  test('a role column says whether a kind speaks for the run; agent-text does not, every other kind does', () => {
    assert.ok(FEEDBACK_KIND_ROLES.includes('speaksForRun'), `roles are ${FEEDBACK_KIND_ROLES.join(', ')}: none says whether a kind speaks for the run`);
    for (const r of FEEDBACK_KINDS) assert.equal(r.speaksForRun, r.kind !== 'agent-text', r.kind);
  });

  test('the runner may post it; it carries no wake and is not a relay, a stamp or refused', () => {
    assert.ok(row);
    assert.equal(row.runnerPostable, true);
    assert.equal(row.mayCarryWake, false);
    assert.equal(row.decisionStamp, false);
    assert.equal(row.refuse, false);
    assert.ok(FEEDBACK_ENTRY_KINDS.includes('agent-text'));
  });
});

describe('LIN-4559: the intake keeps the kind and names the agent', () => {
  test('validateFeedbackBody keeps kind agent-text and its agent', () => {
    const { value, error } = validateFeedbackBody({ message: CHILD_DONE, kind: 'agent-text', agent: AGENT });
    assert.equal(error, undefined);
    assert.equal(value.kind, 'agent-text', 'the kind was dropped: the entry would store kind-less, as the run\'s own words');
    assert.equal(value.agent, AGENT);
  });

  test('an agent-text post with no agent is refused, never stored as the run\'s words', () => {
    const res = validateFeedbackBody({ message: CHILD_DONE, kind: 'agent-text' });
    assert.ok(res.error, 'an agent-text post naming no agent was accepted');
  });

  test('the runner route hands addFeedback the kind and the agent', async () => {
    const calls = [];
    const app = buildApp({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'] }),
        listTokens: async () => [],
        describeRejectionCause: async () => null
      },
      dispatchQueueStore: {
        pollAvailable: async () => [],
        takeItem: async () => null,
        addFeedback: async (id, urlKey, feedback) => { calls.push(feedback); return { success: true, feedbackCount: 1 }; }
      },
      dispatchTokenStore: { listTokens: async () => [] },
      workspaceHaltStore: { getWorkspaceHalt: async () => null, getLastKnownHalt: () => null, setWorkspaceHalt: async () => {}, clearWorkspaceHalt: async () => {} }
    });
    const res = await call(app, 'POST', '/api/proxy/runner/feedback/00000000-0000-4000-8000-000000000000', { body: { message: CHILD_DONE, kind: 'agent-text', agent: AGENT } });
    assert.equal(res.status, 200);
    assert.equal(calls[0]?.kind, 'agent-text');
    assert.equal(calls[0]?.agent, AGENT);
  });

  test('the store keeps the agent on the entry', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const item = await store.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1' });
    await store.takeItem(item._id, 'acme', 'tok');
    await store.addFeedback(item._id, 'acme', { message: 'Searching.', kind: 'agent-text', agent: AGENT }, 'tok');
    const [entry] = store.historyCollection._docs.find((d) => d._id === item._id).feedback;
    assert.equal(entry.kind, 'agent-text');
    assert.equal(entry.agent, AGENT);
  });
});

// ── Pure readers: a child [done] is not the run's ────────────────────────────

describe('LIN-4559: a child [done] on the parent\'s row is not the run\'s terminal (pure readers)', () => {
  const feedback = liveParentFeedback();

  test('terminal: findTerminalFeedback, deriveTerminalStatus, hasTerminalMarker, deriveLifecycleStatus, deriveCompletedAt', () => {
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(deriveTerminalStatus(feedback), null);
    assert.equal(hasTerminalMarker(feedback, 'done'), false);
    assert.equal(deriveLifecycleStatus(feedback), null);
    assert.equal(deriveCompletedAt(feedback), null);
  });

  test('wire: deriveWireStatus and deriveWireTerminal read the run as live', () => {
    assert.equal(deriveWireStatus({ feedback, bookkeeping: null }), null);
    assert.equal(deriveWireTerminal({ feedback, bookkeeping: null }), null);
  });

  test('wake: findWakeEvent finds none; a child [blocked] or [pending] neither blocks nor parks the run', () => {
    assert.equal(findWakeEvent(feedback), null);
    const blocked = [...feedback, childText('[blocked] which branch should I search?')];
    assert.equal(deriveBlockedStatus(blocked), null);
    assert.equal(findWakeEvent(blocked), null);
    assert.equal(derivePendingPark([...feedback, childText('[pending] waiting on CI')]), null);
  });

  test('the loop-facing facts (digest) carry no terminal and no wake', () => {
    const facts = deriveLoopFacingFacts(feedback, ago(200));
    assert.equal(facts.terminal, null);
    assert.equal(facts.wake, null);
  });

  test('the KPI twin: the digest\'s kpiTerminalEntry is null, and telemetry has no completion', () => {
    const doc = { _id: 'p', dispatchedAt: new Date(ago(200)), feedback: feedback.map((f) => ({ ...f, timestamp: new Date(f.timestamp) })) };
    assert.equal(digestFeedback(doc, { now: NOW }).kpiTerminalEntry, null);
    assert.equal(buildSessionTelemetry({ dispatchedAt: ago(200), loops: [{ feedback }] }).completedAt ?? null, null);
  });

  test('run liveness: runLoopFactsOf reads a running row; recent runs give it no outcome', () => {
    const row = { _id: 'p', kind: 'implementation', status: 'taken', dispatchedAt: ago(200), bookkeeping: null, feedback };
    const facts = runLoopFactsOf(row);
    assert.equal(facts.terminalStatus, null);
    assert.equal(facts.agentState, 'running');
    const [run] = recentRuns([row]);
    assert.notEqual(run?.outcome, 'done');
  });

  test('lineage closure (backfill): selectLineageCloses closes nothing on a child [done]', () => {
    const fb = (f) => ({ ...f, timestamp: new Date(f.timestamp), rootItemId: 'P' });
    const rows = [
      { _id: 'P', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: new Date(ago(300)), resolvedAt: new Date(ago(300)), followUpTo: null, bookkeeping: null, feedback: feedback.map(fb) },
      { _id: 'beat', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: new Date(ago(250)), resolvedAt: new Date(ago(240)), followUpTo: 'P', bookkeeping: null, feedback: [] }
    ];
    assert.deepEqual(selectLineageCloses(rows).closes.map((c) => c.id), []);
  });

  test('waiting: parseParkedWait still sees the run\'s wait when a child text is the newest entry', () => {
    const parked = [
      parentText('Pushed; CI is running.', ago(100)),
      { kind: 'heartbeat', message: '[working · verifying] Not done yet — a scheduled wakeup still pending.', url: null, urlLabel: null, timestamp: ago(60) },
      childText('Still reading the CI log.', ago(5))
    ];
    const wait = parseParkedWait(parked);
    assert.ok(wait, 'the child text hid the run\'s parked wait');
    assert.equal(wait.since, ago(60));
  });
});

// ── Loops: Live Console and the task page ───────────────────────────────────

describe('LIN-4559: Live Console and the task page read the parent as still running', () => {
  const liveRow = () => ({
    id: 'parent-1', _id: 'parent-1', issueIdentifier: 'LIN-9001', dispatchedAt: ago(200), resolvedAt: ago(195), status: 'taken',
    feedback: liveParentFeedback(), kind: 'implementation', sessionId: null, sessionGroupId: null, followUpTo: null,
    promptName: 'implementation', prompt: 'do it', issueId: 'issue-1', issueTitle: 'A task', issueUrl: null,
    dispatchedBy: 'tester', target: 'cli', repo: 'LinearViewer', bookkeeping: null, rootItemId: 'parent-1', abort: false, abortTo: null
  });
  const loops = () => _buildLoops({ liveItems: [], historyItems: [liveRow()], agentStatusEntries: [], now: new Date(NOW), lean: false });

  test('the built loop has no terminal status and is not terminal', () => {
    const [loop] = loops();
    assert.ok(loop, 'the row built no loop');
    assert.equal(loop.terminalStatus ?? null, null);
    assert.equal(loopIsTerminal(enrichLoop(loop)), false);
  });

  test('Live Console: the loop is active, keeps a lane, and its timeline bar reads working', () => {
    const built = loops();
    assert.equal(isLoopActive(built[0]), true);
    assert.equal(deriveLoopLanes(built).length > 0, true, 'the lane dropped off Live Console');
    const { runs } = buildTimeline(built, { now: NOW });
    assert.equal(runs.length, 1, 'the run has no bar on the Live Console timeline');
    assert.equal(runs[0].outcomeKind, 'working');
  });

  test('task page and task timeline: the session is running (open), and its message is not the child\'s line', () => {
    const [session] = runSessionsOf(loops(), { enrichLoop, deriveSessionWaiting, now: new Date(NOW) });
    assert.equal(session.state, 'running');
    assert.equal(session.open, true);
    assert.ok(!String(session.message || '').includes('found 3 call sites'), `the run's message is the child's: ${session.message}`);
  });
});

// ── The store: no end, no closure, no wake, no account ──────────────────────

describe('LIN-4559: a child [done] posted on the parent\'s row through the store (real MangoDB)', () => {
  const URL_KEY = 'lin-4559-workspace';
  const harness = createMangoTmpdir('lin-4559-');
  let db;
  let records;
  let dispatch;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(async () => {
    db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
    dispatch.runRecords = createRunRecords({ recordsStore: records, readRow: (urlKey, id) => dispatch.rowForRunRecords(urlKey, id) });
  });

  const queued = (id, extra = {}) => ({
    _id: id, urlKey: URL_KEY, prompt: 'work', promptName: null, kind: 'implementation', target: 'cli', issueIdentifier: 'LIN-1',
    dispatchedAt: new Date(NOW - 600000), dispatchedBy: null, followUpTo: null, abort: false, cascade: false, sessionId: null,
    rootItemId: id, runRecordId: id, feedback: [], expiresAt: new Date('2099-01-01T00:00:00.000Z'), ...extra
  });
  const post = (id, message, kind, extra = {}) => dispatch.addFeedback(id, URL_KEY, { message, ...(kind ? { kind } : {}), ...extra }, null, null);
  const postChild = (id, message) => post(id, message, 'agent-text', { agent: AGENT, rootItemId: id });
  const row = (id) => dispatch.historyCollection.findOne({ _id: id });

  test('the run does not end, and the row stays live', async () => {
    await dispatch.collection.insertOne(queued('parent'));
    await dispatch.takeItem('parent', URL_KEY);
    await post('parent', 'Handed the search to a background agent.', 'assistant-text');
    await postChild('parent', CHILD_DONE);

    assert.equal((await records.run(URL_KEY, 'parent')).state, 'open', 'the child\'s [done] ended the parent\'s run');
    const doc = await row('parent');
    assert.equal(deriveTerminalStatus(doc.feedback), null);
    assert.equal(doc.bookkeeping ?? null, null);
  });

  test('the account is the run\'s own final text: a child text before the run\'s [done] neither ends it nor enters it', async () => {
    await dispatch.collection.insertOne(queued('parent'));
    await dispatch.takeItem('parent', URL_KEY);
    await post('parent', 'Looked at the callers.', 'assistant-text');
    await postChild('parent', 'Searching lib/.');
    await postChild('parent', CHILD_DONE);
    await post('parent', 'Merged the agent\'s list into the plan.', 'assistant-text');
    await postChild('parent', 'One more note from the agent.');
    await post('parent', '[done] Task completed');

    const run = await records.run(URL_KEY, 'parent');
    assert.equal(run.state, 'done');
    assert.equal(run.fields.account, 'Looked at the callers.\nMerged the agent\'s list into the plan.');
  });

  test('the lineage is not closed: an earlier taken row of the same lineage keeps no stamp', async () => {
    await dispatch.historyCollection.insertOne({
      ...queued('earlier-beat', { rootItemId: 'parent', runRecordId: 'earlier-beat' }),
      status: 'taken', resolvedAt: new Date(NOW - 500000), bookkeeping: null, takenByTokenLabel: null, takenByTokenId: null
    });
    await dispatch.collection.insertOne(queued('parent'));
    await dispatch.takeItem('parent', URL_KEY);
    await postChild('parent', CHILD_DONE);

    assert.equal((await row('earlier-beat')).bookkeeping ?? null, null, 'the child\'s [done] closed the parent\'s lineage');
  });

  test('the bulk closers\' filter reads a row whose only [done] is a child\'s as having no terminal of its own', async () => {
    await dispatch.collection.insertOne(queued('parent'));
    await dispatch.takeItem('parent', URL_KEY);
    await postChild('parent', CHILD_DONE);

    const found = await dispatch.historyCollection.find({ _id: 'parent', ...noOwnTerminalMarkerFilter() }).toArray();
    assert.equal(found.length, 1, 'noOwnTerminalMarkerFilter counts the child\'s [done] as the row\'s own terminal');
  });
});

describe('LIN-4559: a child [done] on a subscribed row wakes no parent', () => {
  test('the orchestrator gets no wake from a child\'s [done] (control: the row\'s own [done] does wake it)', async () => {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    const store = new DispatchQueueStore({ collection, historyCollection });
    const wakesTo = (parentId) => [...collection._docs, ...historyCollection._docs].filter((d) => d.kind === 'wake' && d.followUpTo === parentId);

    const orchestrator = await store.addItem('acme', { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
    const worker = await store.addItem('acme', { prompt: 'build', kind: 'implementation', issueIdentifier: 'LIN-42', sessionId: orchestrator._id, subscription: 'terminal-only' });
    await store.takeItem(worker._id, 'acme', 'tok');

    await store.addFeedback(worker._id, 'acme', { message: CHILD_DONE, kind: 'agent-text', agent: AGENT }, 'tok');
    assert.equal(wakesTo(orchestrator._id).length, 0, 'the child\'s [done] woke the orchestrator');

    await store.addFeedback(worker._id, 'acme', { message: '[done] Task completed' }, 'tok');
    assert.equal(wakesTo(orchestrator._id).length, 1, 'control: the run\'s own [done] wakes it once');
  });
});
