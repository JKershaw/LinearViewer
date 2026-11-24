/**
 * Unit tests for routes/dashboard.js (LIN-509 / LIN-595).
 *
 * Run with: node --test tests/unit/dashboard-routes.test.js
 *
 * Exercises the route handlers directly (bypassing the workspaceFromUrl
 * middleware) against mock dispatch/agentStatus stores, asserting the load-bearing
 * contract: cross-workspace merge + workspace tagging, active/recent split, the
 * sessionId-grouped Observation feed (LIN-595), the terminal-only run-summary
 * gate, and the deterministic test-mode summary path with caching.
 *
 * NOTE: the experimental `dashboard` feature flag was retired in LIN-595 (the page
 * is first-class), so these endpoints are session-authed only — no flag gate.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { buildTestSummary, buildTestSessionSummary, deriveSessionStatus } from '../../routes/dashboard.js';
import { NOW_ISO, createDashboardRoutes, makeStores, findRouteLayer, getHandler, makeReqRes, makeRouter, recordsStoreOfChanges } from '../fixtures/dashboard-router.js';
import { createSessionsFeedCache } from '../../lib/sessions-feed-cache.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { createTaskDoneCache } from '../../lib/task-done-cache.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';
import { extractEmbeddedData, embeddedDataText } from '../helpers/embedded-data.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { endOpenQuestionsOfTicket } from '../../lib/records/question-facts.js';
import { REAP_INACTIVITY_MS } from '../../lib/run-liveness.js';

// A timestamp safely past the record window (SD's 7-day REAP_INACTIVITY_MS), so the fixture is `gone`.
const PAST_REAP_WINDOW_ISO = () => new Date(Date.now() - REAP_INACTIVITY_MS - 24 * 60 * 60 * 1000).toISOString();

// >24h ago: a session whose last activity is this old falls into Archive under
// the recency-only Active/Archive split (LIN-631).
const OLD_ISO = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

// Active/Archive is recency-only now (LIN-631), so a terminal session can be
// Active. Tests that only care about a session's payload (not its bucket) look
// it up across both lists.
function findSession(body, id) {
  return [...(body.active || []), ...(body.recent || [])].find(s => s.sessionId === id);
}

// ─── Mock dispatch/agentStatus stores ──────────────────────────────────────────────
// Shaped to drive lib/pipeline-loops.getLoopsForWorkspace deterministically:
//   - a live queue item  → agentState 'queued'  (active)
//   - a taken history item + agentStatus 'completed' → agentState 'complete' (recent)


function activeItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'plan', prompt: 'p', dispatchedAt: NOW_ISO };
}
function historyItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] };
}
function agentStatusDone(dispatchId, identifier, ts = NOW_ISO) {
  // The real agent-status-store maps every row to `id: doc._id` (a UUID); the
  // issue-scoped getSessionsForIssues read dedups rows by that `id`, so a faithful
  // fixture MUST carry one or the row is silently dropped (LIN-1022).
  return { id: `as-${dispatchId}`, dispatchId, taskIdentifier: identifier, action: 'implementation', status: 'completed', summary: 'all done', timestamp: ts };
}
// LIN-2775 Area 7 (S1 review ledger L5): a taken run whose matched
// agent-status entry is 'blocked' — per _deriveAgentState's truth table
// (lib/pipeline-loops.js) this derives agentState 'waiting', the ONE live
// (non-terminal) state the S1 handover flagged as having no fixture at all.
function agentStatusBlocked(dispatchId, identifier, ts = NOW_ISO) {
  return { id: `as-${dispatchId}`, dispatchId, taskIdentifier: identifier, action: 'implementation', status: 'blocked', summary: 'parked, waiting on the operator', timestamp: ts };
}
// A taken history item with a matching agentStatus row — paired with
// agentStatusDone/agentStatusBlocked above to derive 'complete'/'waiting'.
// (Distinct from `historyItem` above, which carries no decision and no
// agent-status pairing.)
function takenRunItem(id, identifier, ts = NOW_ISO) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: ts, resolvedAt: ts, status: 'taken' };
}
// A taken run that the runner finished via a [done] feedback marker but with NO
// agentStatus 'completed' entry — pipeline-loops alone derives 'running' for this.
function markerDoneItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] shipped it', timestamp: NOW_ISO }] };
}


// ─── Session fixtures (drive lib/pipeline-loops.getSessionsForWorkspace) ─────────
// An autopilot orchestrator dispatch (kind:'autopilot') anchors a session; its
// session id is the orchestrator's own dispatch id. Workers carry that id as
// `sessionId`. Terminality is folded in via agentStatus 'completed' / [done].
function autopilotHistoryItem(id, identifier, ts = NOW_ISO) {
  return { id, kind: 'autopilot', issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: ts, resolvedAt: ts, status: 'taken' };
}
function autopilotLiveItem(id, identifier, ts = NOW_ISO) {
  return { id, kind: 'autopilot', issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: ts };
}
function workerHistoryItem(id, identifier, sessionId, ts = NOW_ISO) {
  return { id, sessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: ts, resolvedAt: ts, status: 'taken', feedback: [{ message: 'pr opened' }] };
}
function workerLiveItem(id, identifier, sessionId, ts = NOW_ISO) {
  return { id, sessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: ts };
}
// A child autopilot fanned out FROM another session (`parentSessionId` — LIN-1314):
// it is a `kind:'autopilot'` member of its parent's loop set (so it stamps
// `sessionId: parentSessionId`), but its own `id` also anchors its OWN separate
// session (`_buildSessions` pass 1) — so its own workers ("grandchildren" of the
// parent) never land in the parent's own-group `sessionActivityMs`.
function childAutopilotLiveItem(id, identifier, parentSessionId, ts = NOW_ISO) {
  return { id, kind: 'autopilot', sessionId: parentSessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: ts };
}
function childAutopilotHistoryItem(id, identifier, parentSessionId, ts = NOW_ISO) {
  return { id, kind: 'autopilot', sessionId: parentSessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: ts, resolvedAt: ts, status: 'taken' };
}

/**
 * LIN-2934 (S4): a `gone` GENERAL (goal-only) autopilot anchor — `kind:'autopilot'`
 * with NO `issueIdentifier`, retained anchorless by R1's
 * `ANCHOR_KINDS_WITHOUT_ISSUE`. Terminal, well past the 7d record reap window, so
 * disposition is `gone` (never self-matches `liveDispatchOnAnchor`).
 */
function goneGeneralAnchorItem(id, decisionId, onAnswerEffect) {
  const oldIso = PAST_REAP_WINDOW_ISO(); // past REAP_INACTIVITY_MS (7d)
  const payload = { decision_id: decisionId, question: 'Proceed?', on_answer: { effect: onAnswerEffect } };
  return {
    id, kind: 'autopilot', issueIdentifier: null, issueTitle: 'Goal-only run',
    promptName: 'autopilot', prompt: 'p', dispatchedAt: oldIso, resolvedAt: oldIso,
    status: 'taken',
    feedback: [
      { kind: 'decision', message: JSON.stringify(payload), timestamp: oldIso },
      { message: '[done] shipped it', timestamp: oldIso }
    ]
  };
}

/**
 * LIN-2934 (S4): a live (queued, non-terminal) GENERAL autopilot anchor —
 * `kind:'autopilot'`, no `issueIdentifier`. An UNRELATED general run.
 */
function liveGeneralAnchorItem(id) {
  return { id, kind: 'autopilot', issueIdentifier: null, issueTitle: 'Another goal-only run', promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO };
}

// The page is first-class (LIN-595): no feature flag is required. ENABLED is kept
// as an empty session so the existing spreads (`{ ...ENABLED, workspaces }`) read
// naturally and document that no flag is needed.
const ENABLED = {};

// ─── /loops ────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/loops', () => {
  test('serves the feed without a feature flag (first-class)', async () => {
    const router = makeRouter({ 'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const { req, res } = makeReqRes({ session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.active.length, 1);
  });

  test('merges runs across workspaces, tags each, and splits active/recent', async () => {
    const perWorkspace = {
      'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [historyItem('a-hist', 'LIN-2')], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] },
      'ws-b': { live: [], history: [historyItem('b-hist', 'LIN-3')], agentStatus: [agentStatusDone('b-hist', 'LIN-3')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.active.length, 1, 'one queued run is active');
    assert.equal(body.active[0].agentState, 'queued');
    assert.equal(body.active[0].workspaceUrlKey, 'ws-a');
    assert.equal(body.active[0].workspaceName, 'Alpha');
    assert.equal(body.recent.length, 2, 'two completed runs are recent');
    assert.ok(body.recent.every(r => r.agentState === 'complete'));
    // Every recent run carries its workspace tag.
    assert.deepEqual(new Set(body.recent.map(r => r.workspaceUrlKey)), new Set(['ws-a', 'ws-b']));
    assert.equal(body.counts.total, 3);
  });

  test('a [done] feedback marker promotes a taken run to recent (not stuck "running")', async () => {
    // Regression for "all sessions appear in progress" (LIN-509): without folding
    // the dispatch terminal marker in, this run would derive agentState 'running'
    // and never leave the active feed.
    const router = makeRouter({ 'ws-a': { live: [], history: [markerDoneItem('m1', 'LIN-7')], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.active.length, 0, 'marker-done run is not active');
    assert.equal(res.jsonBody.recent.length, 1, 'marker-done run is recent');
    assert.equal(res.jsonBody.recent[0].agentState, 'complete');
  });

  test('a [failed] marker maps to an error (terminal) run', async () => {
    const failItem = { id: 'f1', issueIdentifier: 'LIN-8', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] };
    const router = makeRouter({ 'ws-a': { live: [], history: [failItem], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.jsonBody.recent.length, 1);
    assert.equal(res.jsonBody.recent[0].agentState, 'error');
  });

  test('one failing workspace store does not blank the whole feed', async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return []; },
        async listHistory(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return { items: withFreshDigests([historyItem('g', 'LIN-9')]) }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('g', 'LIN-9')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'bad', name: 'Bad' }, { urlKey: 'good', name: 'Good' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.recent.length, 1, 'good workspace still contributes its run');
  });
});

// ─── Filtered rulings feed (LIN-1728 Phase 2) ─────────────────────────────────


describe('the old ruling writes are gone (LIN-4540 shelve; LIN-4541 dismiss, reverse-withdrawal, answer, keep)', () => {
  test('the rulings router registers the feed and no ruling write', () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    for (const write of ['shelve', 'dismiss', 'reverse-withdrawal', 'answer', 'keep']) {
      assert.throws(() => findRouteLayer(router, 'post', `/workspace/:urlKey/api/dashboard/rulings/${write}`), `${write} is gone`);
    }
    assert.ok(findRouteLayer(router, 'get', '/workspace/:urlKey/api/dashboard/rulings'), 'the feed stays');
  });
});
// ─── Escalation KPIs — operator-facing audit page (LIN-1736) ─────────────────

describe('GET /api/escalation-kpis (LIN-1736; question records, LIN-4538)', () => {
  const harness = createMangoTmpdir('lin-4538-kpi-route-');
  const ACCOUNT = 'acct-owner';
  const PERSON = `person:${ACCOUNT}`;
  const PEOPLE = [{ accountId: ACCOUNT, name: 'Owner' }];
  const DAY = 24 * 60 * 60 * 1000;
  let records;
  let writes;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(async () => {
    const db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
  });

  function makeKpiRouter(recordsStore) {
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...makeStores({}),
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      recordsStore,
    });
  }

  async function askQuestion(urlKey, task) {
    const made = await records.ensureTask(urlKey, { identifier: task, title: task }, { by: 'implementation' });
    assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
    const snap = await writes.add({
      urlKey, kind: 'question', by: 'implementation', run: null,
      input: { asks: 'Which way?', options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to: PERSON, in: task },
    });
    assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
    return snap.record.id;
  }

  const WS = [{ urlKey: 'ws-a', name: 'Alpha' }];
  const kpiReq = (query = {}) => makeReqRes({ session: { workspaces: WS }, query });

  test('an answer is answered, a person\'s dismissal is a false escalation, an open question is unanswered age', async () => {
    const answered = await askQuestion('ws-a', 'LIN-1');
    const dismissed = await askQuestion('ws-a', 'LIN-2');
    await askQuestion('ws-a', 'LIN-3');
    await records.end('ws-a', answered, { state: 'answered', reason: 'answered by decision-x' }, { by: PERSON });
    await records.end('ws-a', dismissed, { state: 'withdrawn', reason: 'dismissed' }, { by: PERSON });
    const handler = getHandler(makeKpiRouter(records), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const { req, res } = kpiReq();
    await handler(req, res);
    const body = res.jsonBody;
    assert.equal(body.falseEscalation.answered, 1);
    assert.equal(body.falseEscalation.dismissed, 1);
    assert.equal(body.falseEscalation.rate, 0.5);
    assert.equal(body.unansweredAge.count, 1, 'the open question is the one unanswered row');
    assert.equal(body.escalationRate.raisedInWindow, 3, 'all three were raised within the window');
  });

  test('LIN-4550: a dismissal ended `dismissed` and an old one ended `withdrawn` "dismissed" are both false escalations; an agent withdrawal is neither', async () => {
    const newer = await askQuestion('ws-a', 'LIN-11');
    const older = await askQuestion('ws-a', 'LIN-12');
    const byAgent = await askQuestion('ws-a', 'LIN-13');
    await records.end('ws-a', newer, { state: 'dismissed', reason: 'dismissed' }, { by: PERSON });
    await records.end('ws-a', older, { state: 'withdrawn', reason: 'dismissed' }, { by: PERSON });
    await records.end('ws-a', byAgent, { state: 'withdrawn', reason: 'answered it myself' }, { by: 'implementation' });
    const handler = getHandler(makeKpiRouter(records), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const { req, res } = kpiReq();
    await handler(req, res);
    assert.equal(res.jsonBody.falseEscalation.dismissed, 2);
    assert.equal(res.jsonBody.falseEscalation.answered, 0);
    assert.equal(res.jsonBody.falseEscalation.total, 2);
    assert.equal(res.jsonBody.escalationRate.raisedInWindow, 3);
  });

  test('a closed ticket\'s open question is "ticket closed": self-resolved, never a false escalation', async () => {
    await askQuestion('ws-a', 'LIN-9');
    const ended = await endOpenQuestionsOfTicket({ recordsStore: records, writes, urlKey: 'ws-a', ticket: 'LIN-9' });
    assert.equal(ended.ended, 1);
    const handler = getHandler(makeKpiRouter(records), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const { req, res } = kpiReq();
    await handler(req, res);
    assert.equal(res.jsonBody.selfResolved.count, 1);
    assert.equal(res.jsonBody.falseEscalation.dismissed, 0, 'the ticket closing is not a dismissal');
    assert.equal(res.jsonBody.falseEscalation.total, 0);
    assert.equal(res.jsonBody.escalationRate.raisedInWindow, 1);
  });

  test('one workspace whose records read fails degrades to a partial computation, not a 500', async () => {
    await askQuestion('ws-a', 'LIN-5');
    const flaky = Object.create(records);
    flaky.find = (urlKey, q) => (urlKey === 'ws-bad' ? Promise.reject(new Error('store down')) : records.find(urlKey, q));
    const handler = getHandler(makeKpiRouter(flaky), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const { req, res } = makeReqRes({ session: { workspaces: [{ urlKey: 'ws-bad', name: 'Bad' }, { urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.unansweredAge.count, 1, 'the healthy workspace still counts');
  });

  test('windowDays is clamped to [1, 365] and defaults to 30 when absent/invalid', async () => {
    const handler = getHandler(makeKpiRouter(records), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const noParam = kpiReq();
    await handler(noParam.req, noParam.res);
    assert.equal(noParam.res.jsonBody.windowDays, 30);
    const tooLarge = kpiReq({ windowDays: '9999' });
    await handler(tooLarge.req, tooLarge.res);
    assert.equal(tooLarge.res.jsonBody.windowDays, 365);
    const invalid = kpiReq({ windowDays: 'nope' });
    await handler(invalid.req, invalid.res);
    assert.equal(invalid.res.jsonBody.windowDays, 30);
  });

  test('targetPerDay is optional — omitted means no verdict, supplied produces a real one', async () => {
    await askQuestion('ws-a', 'LIN-6');
    await askQuestion('ws-a', 'LIN-7');
    const handler = getHandler(makeKpiRouter(records), 'get', '/workspace/:urlKey/api/escalation-kpis');
    const noTarget = kpiReq();
    await handler(noTarget.req, noTarget.res);
    assert.equal(noTarget.res.jsonBody.escalationRate.targetPerDay, null);
    assert.equal(noTarget.res.jsonBody.escalationRate.overTarget, null);
    const withTarget = kpiReq({ targetPerDay: '2' });
    await handler(withTarget.req, withTarget.res);
    assert.equal(withTarget.res.jsonBody.escalationRate.targetPerDay, 2);
    assert.equal(withTarget.res.jsonBody.escalationRate.overTarget, false);
  });
});

describe('feed memory (LIN-622)', () => {
  test('/api/dashboard/loops payload carries no promptText nor retained feedback[] (lean reconstruction)', async () => {
    const perWorkspace = {
      'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [historyItem('a-hist', 'LIN-2')], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const all = [...res.jsonBody.active, ...res.jsonBody.recent];
    assert.ok(all.length > 0, 'expected at least one run in the feed');
    for (const run of all) {
      assert.ok(!('promptText' in run), `feed run ${run.loopId} must not carry promptText`);
      // The raw heartbeat/[evidence] log — the dominant per-row bytes — must not
      // be retained on the lean feed; its derived facts ride telemetry + the
      // pre-derived terminal fields instead (LIN-622).
      assert.ok(!Array.isArray(run.feedback) || run.feedback.length === 0,
        `feed run ${run.loopId} must not retain raw feedback[]`);
    }
  });

  test('cross-workspace fan-out reconstructs at most 2 workspaces concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise(resolve => setTimeout(resolve, 5));
          inFlight--;
          return { items: [] };
        }
      },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const workspaces = Array.from({ length: 6 }, (_, i) => ({ urlKey: `ws-${i}`, name: `W${i}` }));
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(peak <= 2, `peak concurrent workspace reads ${peak} must be <= 2 (bounded fan-out)`);
    assert.ok(peak > 1, `expected some concurrency, got ${peak}`);
  });
});

// ─── /sessions (Observation feed; LIN-595) ───────────────────────────────────

describe('GET /api/dashboard/sessions', () => {
  test('groups loops into sessions, splits active/recent by recency, and tags each', async () => {
    const perWorkspace = {
      // Terminal session that finished >24h ago → Archive under the recency split.
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100', OLD_ISO), workerHistoryItem('w-1', 'LIN-101', 'sess-1', OLD_ISO)],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100', OLD_ISO), agentStatusDone('w-1', 'LIN-101', OLD_ISO)]
      },
      // Live session: queued autopilot anchor (not terminal).
      'ws-b': {
        live: [autopilotLiveItem('sess-2', 'LIN-200')],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.active.length, 1, 'the live session is active');
    assert.equal(body.recent.length, 1, 'the old terminal session is in the archive');

    const live = body.active[0];
    assert.equal(live.sessionId, 'sess-2');
    assert.equal(live.status, 'in-progress');
    assert.equal(live.terminal, false);
    assert.equal(live.workspaceUrlKey, 'ws-b');
    assert.equal(live.workspaceName, 'Beta');

    const done = body.recent[0];
    assert.equal(done.sessionId, 'sess-1');
    assert.equal(done.status, 'done');
    assert.equal(done.terminal, true);
    assert.equal(done.seedIssue, 'LIN-100');
    assert.deepEqual(done.tasksTouched, ['LIN-100', 'LIN-101']);
    // One worker run → one progress-bar segment (the anchor is excluded).
    assert.equal(done.runCount, 1);
    assert.equal(done.runs[0].issueIdentifier, 'LIN-101');
    // Telemetry runtime is attached (LIN-594).
    assert.ok(done.runtime, 'session carries a runtime telemetry block');
  });

  test('LIN-2934: taskPosition is null when no bound is declared (unaffected by this ticket)', async () => {
    const perWorkspace = {
      'ws-d': {
        live: [autopilotLiveItem('sess-4', 'LIN-400')],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-d', name: 'Delta' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const live = res.jsonBody.active.find(s => s.sessionId === 'sess-4');
    assert.ok(live);
    assert.strictEqual(live.taskPosition, null);
  });

  // LIN-2934 R1: a GENERAL (goal-only) autopilot kickoff — its own anchor row
  // carries NO issueIdentifier at all. Before R1 that row was dropped as
  // "malformed" by pipeline-loops.js's `_buildLoops`, so this session never
  // had an anchor loop to read its declared bounds off, and the dashboard
  // feed chip stayed null for every general run regardless of what was
  // declared at kickoff. `autopilotLiveItem(id, null)` builds exactly that
  // anchorless-by-design row.
  test('LIN-2934 R1: taskPosition surfaces for a GENERAL (goal-only) run too, not only a scoped one', async () => {
    const perWorkspace = {
      'ws-g': {
        live: [
          { ...autopilotLiveItem('sess-g', null), maxTasks: 3 },
          workerLiveItem('w-g', 'LIN-500', 'sess-g')
        ],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-g', name: 'Goal-only' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const live = res.jsonBody.active.find(s => s.sessionId === 'sess-g');
    assert.ok(live, 'expected the general (seedIssue-less) run to surface on the payload at all');
    assert.strictEqual(live.seedIssue, null, 'sanity: this really is the unscoped shape, not a scoped run in disguise');
    assert.deepEqual(live.taskPosition, { count: 1, maxTasks: 3 });
  });

  // LIN-2934 (S7): R1 made the general anchor `session.loops[0]` — before R1
  // that slot was always the first WORKER (a general kickoff row never
  // reached `_buildLoops` at all). A general kickoff names no single task, so
  // its own `issueTitle` is empty; the pre-S7 fallback chain
  // `anchor.issueTitle || session.loops[0].issueTitle || seedIssue || ''`
  // stopped at that title-less `loops[0]` and regressed the card to the
  // "autopilot session" placeholder instead of showing the first worker's
  // title, which is what a general run's card showed before R1.
  test('LIN-2934 (S7): a GENERAL run\'s card title falls back to the first WORKER\'s title, not the title-less anchor', async () => {
    const perWorkspace = {
      'ws-g': {
        live: [
          { ...autopilotLiveItem('sess-g7', null), issueTitle: null }, // no issueTitle at all — a goal-only kickoff
          workerLiveItem('w-g7', 'LIN-501', 'sess-g7')
        ],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-g', name: 'Goal-only' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const live = res.jsonBody.active.find(s => s.sessionId === 'sess-g7');
    assert.ok(live, 'expected the general run to surface on the payload');
    assert.equal(live.seedTitle, 'Title LIN-501', 'must skip the title-less anchor and use the first worker\'s title');
  });

  // LIN-2934 (S7, documented/accepted side effect): `sessionIsTerminal`
  // (routes/dashboard.js) already preferred anchor-loop terminality over an
  // all-loops-terminal fallback — but before R1 a general run had NO anchor
  // loop at all, so it always took the all-loops-terminal (wait for every
  // worker) path. Now that R1 retains the general anchor, a general run's
  // terminality follows the ORCHESTRATOR'S OWN status, exactly like a scoped
  // run's already does — even while a worker it dispatched is still running.
  // The review flagged this as an unreviewed-but-arguably-intended behavior
  // change (S7); this test states and pins it explicitly.
  test('LIN-2934 (S7, accepted): a GENERAL run\'s terminality follows the anchor, even while a worker it dispatched is still running', async () => {
    const perWorkspace = {
      'ws-g': {
        live: [
          workerLiveItem('w-g8', 'LIN-502', 'sess-g8') // still running — no resolvedAt
        ],
        history: [
          { ...autopilotHistoryItem('sess-g8', null), feedback: [{ message: '[done] wound down', timestamp: NOW_ISO }] }
        ],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-g', name: 'Goal-only' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const found = findSession(res.jsonBody, 'sess-g8');
    assert.ok(found, 'expected the general run to surface on the payload');
    assert.equal(found.terminal, true, 'terminality follows the anchor\'s own [done], not the still-running worker');
  });

  test('each run carries its Level-3 drill-down payload (telemetry + recap), Mongo-only', async () => {
    // A worker whose feedback carries a heartbeat (metrics) and an [evidence]
    // marker (produced artifact) — the read-only telemetry the drill-down renders.
    const richWorker = {
      id: 'w-rich', sessionId: 'sess-r', issueIdentifier: 'LIN-501', issueTitle: 'Rich worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { message: '[working] 6 tools/32s · alive', timestamp: NOW_ISO },
        { message: '[evidence] PR opened https://github.com/x/y/pull/1', url: 'https://github.com/x/y/pull/1', urlLabel: 'PR #1', timestamp: NOW_ISO },
        { message: '[done] shipped it', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-r', 'LIN-500'), richWorker],
        agentStatus: [agentStatusDone('sess-r', 'LIN-500'), agentStatusDone('w-rich', 'LIN-501')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-r');
    assert.ok(sess, 'session is present');
    const run = sess.runs.find(r => r.loopId === 'w-rich');
    assert.ok(run, 'worker run is present');
    // Recap fallback + evidence/metrics for the Level-3 node.
    assert.equal(run.agentSummary, 'all done');
    assert.ok(run.runtime && typeof run.runtime === 'object', 'run carries runtime telemetry');
    assert.ok(run.metrics.length >= 1, 'run carries activity metrics');
    assert.equal(run.metrics[0].toolCount, 6);
    assert.equal(run.producedArtifacts.length, 1, 'run carries produced artifacts');
    assert.equal(run.producedArtifacts[0].url, 'https://github.com/x/y/pull/1');
  });

  // ─── resources reaches BOTH projections (LIN-1789, close-out ledger item 3) ──
  // The two projection widenings (routes/dashboard.js per-run + session-level)
  // were the one link in the dispatch → telemetry → projection → render chain
  // with no test. Pins that `telemetry.resources` survives to the feed at both
  // levels, and that it degrades to null rather than undefined when absent.
  test('a kind:"resources" feedback entry reaches the runs[] projection; the session-level one stays inert under lean', async () => {
    const resourcesPayload = {
      peakRssBytes: 536870912,
      hostMemAvailableBytes: 2147483648,
      hostMemTotalBytes: 8589934592,
      loadAvg1: 1.5,
      cpuCount: 4,
    };
    const resourcefulWorker = {
      id: 'w-res', sessionId: 'sess-res', issueIdentifier: 'LIN-1789', issueTitle: 'Resources worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        // `model=` makes the session-level assertion below meaningful: model is a
        // feedback-derived session field that predates this ticket.
        { message: '[started] session abc · model=claude-opus-5', timestamp: NOW_ISO },
        { message: '[working] 6 tools/32s · alive', timestamp: NOW_ISO },
        { message: `[resources] ${JSON.stringify(resourcesPayload)}`, kind: 'resources', timestamp: NOW_ISO },
        { message: '[done] shipped it', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-res', 'LIN-1788'), resourcefulWorker],
        agentStatus: [agentStatusDone('sess-res', 'LIN-1788'), agentStatusDone('w-res', 'LIN-1789')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-res');
    assert.ok(sess, 'session is present');

    // Per-run widening (routes/dashboard.js runs[] projection). This is the one
    // that carries data: per-loop telemetry is built from the raw feedback
    // BEFORE the lean drop (lib/pipeline-loops.js), so it survives the feed.
    const run = sess.runs.find(r => r.loopId === 'w-res');
    assert.ok(run, 'worker run is present');
    assert.deepEqual(run.resources, resourcesPayload, 'run projects telemetry.resources');

    // Session-level widening (routes/dashboard.js session projection) is a NO-OP
    // on this feed, and not because of anything LIN-1789 did. `_assembleSession`
    // builds session telemetry by re-flattening `loop.feedback`, which the lean
    // feed has already emptied (LIN-622) — so every feedback-DERIVED session
    // field is null here. `model` is null for the identical reason (pinned
    // below); only `runtime`, derived from dispatchedAt/completedAt rather than
    // from feedback, survives. Pinned so a future fix to that seam flips a test
    // instead of silently changing the per-poll payload.
    assert.equal(sess.resources, null, 'session-level resources is inert on the lean feed');
    assert.equal(sess.model, null, 'session-level model is inert for the same pre-existing reason');
    assert.ok(sess.runtime && typeof sess.runtime === 'object', 'session runtime survives (not feedback-derived)');
  });

  test('sessions and runs with no kind:"resources" entry project resources as null', async () => {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-nores', 'LIN-840'), workerHistoryItem('w-nores', 'LIN-841', 'sess-nores')],
        agentStatus: [agentStatusDone('sess-nores', 'LIN-840'), agentStatusDone('w-nores', 'LIN-841')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-nores');
    assert.ok(sess, 'session is present');
    assert.equal(sess.resources, null, 'session resources is null, not undefined');
    const run = sess.runs.find(r => r.loopId === 'w-nores');
    assert.ok(run, 'worker run is present');
    assert.equal(run.resources, null, 'run resources is null, not undefined');
  });

  // ─── ticketWalk reaches the runs[] projection (LIN-2243) ─────────────────────
  // Same shape as the resources widening above: per-run telemetry is built from
  // raw feedback BEFORE the lean drop, so a worker-lane's [ticket] markers
  // survive to the feed on the run; the session-level field is inert on the
  // lean feed for the identical pre-existing reason resources/model are.
  test('a worker carrying [ticket] markers projects a ticketWalk on its run; session-level stays inert on the lean feed', async () => {
    const laneWorker = {
      id: 'w-lane', sessionId: 'sess-lane', issueIdentifier: 'LIN-2242', issueTitle: 'Lane worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { message: '[ticket] LIN-2242 started', timestamp: NOW_ISO },
        { message: '[ticket] LIN-2242 done — merged PR #1212', timestamp: NOW_ISO },
        { message: '[ticket] LIN-2243 started', timestamp: NOW_ISO },
        { message: '[working] 6 tools/32s · alive', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-lane', 'LIN-2240'), laneWorker],
        agentStatus: [agentStatusDone('sess-lane', 'LIN-2240'), agentStatusDone('w-lane', 'LIN-2242')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-lane');
    assert.ok(sess, 'session is present');

    const run = sess.runs.find(r => r.loopId === 'w-lane');
    assert.ok(run, 'lane worker run is present');
    assert.deepEqual(run.ticketWalk.map(w => [w.identifier, w.state]), [['LIN-2242', 'done'], ['LIN-2243', 'started']]);

    assert.equal(sess.ticketWalk, null, 'session-level ticketWalk is inert on the lean feed, same as resources/model');
  });

  // ─── parkedWait reaches the runs[] projection (LIN-2244) ────────────────────
  test('a worker currently parked on a scheduled-wakeup wait projects parkedWait on its run', async () => {
    const parkedWorker = {
      id: 'w-parked', sessionId: 'sess-parked', issueIdentifier: 'LIN-2244', issueTitle: 'Parked worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, status: 'taken',
      feedback: [
        { message: '[working] 6 tools/32s · alive', timestamp: NOW_ISO },
        { message: '[working · verifying] Not done yet — a scheduled wakeup still pending.', timestamp: NOW_ISO },
      ]
    };
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-parked', 'LIN-2240'), parkedWorker],
        history: [],
        agentStatus: [agentStatusDone('sess-parked', 'LIN-2240')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-parked');
    assert.ok(sess, 'session is present');
    const run = sess.runs.find(r => r.loopId === 'w-parked');
    assert.ok(run, 'parked worker run is present');
    assert.deepEqual(run.parkedWait, { since: NOW_ISO, latest: NOW_ISO, what: 'a scheduled wakeup' });
  });

  test('a worker with no scheduled-wakeup wait projects parkedWait as null, not undefined', async () => {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-noparked', 'LIN-840'), workerHistoryItem('w-noparked', 'LIN-841', 'sess-noparked')],
        agentStatus: [agentStatusDone('sess-noparked', 'LIN-840'), agentStatusDone('w-noparked', 'LIN-841')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-noparked');
    const run = sess.runs.find(r => r.loopId === 'w-noparked');
    assert.ok(run, 'worker run is present');
    assert.equal(run.parkedWait, null, 'run parkedWait is null, not undefined');
  });

  test('a worker with no [ticket] markers projects ticketWalk as null, not undefined', async () => {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-notick', 'LIN-840'), workerHistoryItem('w-notick', 'LIN-841', 'sess-notick')],
        agentStatus: [agentStatusDone('sess-notick', 'LIN-840'), agentStatusDone('w-notick', 'LIN-841')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-notick');
    const run = sess.runs.find(r => r.loopId === 'w-notick');
    assert.ok(run, 'worker run is present');
    assert.equal(run.ticketWalk, null, 'run ticketWalk is null, not undefined');
  });

  // ─── issue binding pair reaches the runs[] projection (LIN-3331) ────────────
  test('runs[] carries issueSource when stamped, sparsely when not', async () => {
    const stamped = { ...workerHistoryItem('w-bind', 'LIN-3331', 'sess-bind'), issueSource: 'linear' };
    const plain = workerHistoryItem('w-plain', 'LIN-3332', 'sess-bind');
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-bind', 'LIN-3330'), stamped, plain],
        agentStatus: [agentStatusDone('sess-bind', 'LIN-3330'), agentStatusDone('w-bind', 'LIN-3331'), agentStatusDone('w-plain', 'LIN-3332')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-bind');
    const bound = sess.runs.find(r => r.loopId === 'w-bind');
    assert.equal(bound.issueSource, 'linear');
    // Sparse: an unstamped run adds NO key (byte-identical row shape).
    const bare = sess.runs.find(r => r.loopId === 'w-plain');
    assert.ok(!('issueSource' in bare), 'no issueSource key when unstamped');
  });

  test('a live session carries a deterministic statusLine from its latest child (no per-poll summary fetch needed)', async () => {
    // A running worker decorated with an agent-status summary, under a live
    // (queued) autopilot anchor — i.e. a non-terminal session. The feed must
    // surface that summary as `statusLine` so the client renders it directly
    // instead of polling /session-summary every 5s (the OOM path).
    const runningWorker = { id: 'w-run', sessionId: 'sess-live', issueIdentifier: 'LIN-811', issueTitle: 'Worker', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO };
    const runningStatus = { dispatchId: 'w-run', taskIdentifier: 'LIN-811', action: 'implementation', status: 'working', summary: 'wiring the new route', timestamp: NOW_ISO };
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-live', 'LIN-810'), runningWorker],
        history: [],
        agentStatus: [runningStatus]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.active.find(x => x.sessionId === 'sess-live');
    assert.ok(s, 'live session is active');
    assert.equal(s.terminal, false);
    assert.equal(s.statusLine, 'wiring the new route', 'live status line is served on the feed');
  });

  test('a terminal session serves no statusLine (uses its cached AI summary instead)', async () => {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-t', 'LIN-820'), workerHistoryItem('w-t', 'LIN-821', 'sess-t')],
        agentStatus: [agentStatusDone('sess-t', 'LIN-820'), agentStatusDone('w-t', 'LIN-821')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-t');
    assert.ok(s, 'terminal session is present');
    assert.equal(s.terminal, true);
    assert.equal(s.statusLine, null, 'terminal sessions carry no feed status line');
  });

  test('runs ship a bounded metrics tail plus a precomputed tool peak (not every heartbeat)', async () => {
    // 10 heartbeats with rising tool counts: the feed must trim to the last 6 and
    // expose the peak (10) so a long run cannot bloat the per-poll payload.
    const beats = [];
    for (let i = 1; i <= 10; i++) beats.push({ message: `[working] ${i} tools/${i}s · alive`, timestamp: NOW_ISO });
    const longWorker = {
      id: 'w-long', sessionId: 'sess-long', issueIdentifier: 'LIN-831', issueTitle: 'Long worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [...beats, { message: '[done] shipped it', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-long', 'LIN-830'), longWorker],
        agentStatus: [agentStatusDone('sess-long', 'LIN-830'), agentStatusDone('w-long', 'LIN-831')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-long');
    const run = sess.runs.find(r => r.loopId === 'w-long');
    assert.ok(run, 'worker run present');
    assert.equal(run.metrics.length, 6, 'metrics trimmed to the recent tail');
    assert.equal(run.toolPeak, 10, 'peak tool count precomputed across ALL heartbeats');
  });

  // Review ledger L4 (PR #1560): the test above can't distinguish "reads the
  // digest's toolPeak" from "recomputes peakToolCount(metrics)", because all
  // 10 heartbeats share one timestamp close to "now" — R4 retention (last-6
  // OR within-6h) keeps every one of them, so the retained `metrics` list is
  // never actually trimmed below the true peak. This test forces a REAL
  // trim: an old (7h-ago) heartbeat carries the true peak (50 tools) and
  // falls outside both "last 6" and the 6h window, while nine recent,
  // lower-count heartbeats survive retention. `routes/dashboard.js:720` must
  // still report the true peak — only reachable by reading `l.toolPeak`
  // (the digest's own, always-full-window figure), never by recomputing
  // `peakToolCount` over the (now genuinely trimmed) `metrics` list.
  test('L4: runs[].toolPeak reads the digest peak even when it falls outside the retained metrics window (routes/dashboard.js:720)', async () => {
    const oldPeakBeat = { message: '[working] 50 tools/1s · alive', timestamp: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() };
    const recentBeats = [];
    for (let i = 1; i <= 9; i++) {
      recentBeats.push({ message: `[working] ${i} tools/${i}s · alive`, timestamp: new Date(Date.now() - i * 1000).toISOString() });
    }
    const trimmedWorker = {
      id: 'w-trimmed', sessionId: 'sess-trimmed', issueIdentifier: 'LIN-832', issueTitle: 'Trimmed worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [oldPeakBeat, ...recentBeats, { message: '[done] shipped it', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-trimmed', 'LIN-833'), trimmedWorker],
        agentStatus: [agentStatusDone('sess-trimmed', 'LIN-833'), agentStatusDone('w-trimmed', 'LIN-832')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-trimmed');
    const run = sess.runs.find(r => r.loopId === 'w-trimmed');
    assert.ok(run, 'worker run present');
    // Sanity: prove retention genuinely trimmed the old peak beat out of the
    // served metrics tail, so a pass below can't come from "nothing was
    // actually trimmed" (the failure mode of the sibling test above).
    assert.ok(run.metrics.every(m => (m.total ?? m.toolCount) < 50), 'sanity: the 50-tool beat is genuinely absent from the retained/served metrics');
    assert.equal(run.toolPeak, 50, 'toolPeak must still be exact — read from the digest, not recomputed over the (now-trimmed) metrics list');
  });

  // ─── Lineage identity survives into the runs[] projection (LIN-1487, T1) ─────
  // LIN-1477 pins `lineageId` DERIVATION (lib/pipeline-loops.js). This pins the
  // one novel thing S2c adds: the derived id reaches the FEED's runs[] projection
  // so the client can fold on it. Two workers sharing a rootItemId must project
  // the same lineageId; a worker with no rootItemId projects lineageId === its
  // own loopId (never null), matching pipeline-loops' `rootItemId ?? loopId`.
  test('runs[] carries lineageId — shared rootItemId folds to one id; absent → loopId (LIN-1487)', async () => {
    // Two workers in one session sharing a lineage (same rootItemId), plus a
    // third standalone worker with no rootItemId. All three are children of the
    // autopilot anchor, so all three enter runs[].
    const wA = {
      id: 'w-a', sessionId: 'sess-fold', rootItemId: 'lineage-root', issueIdentifier: 'LIN-901',
      issueTitle: 'Wake 1', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO,
      resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] one', timestamp: NOW_ISO }]
    };
    const wB = {
      id: 'w-b', sessionId: 'sess-fold', rootItemId: 'lineage-root', issueIdentifier: 'LIN-901',
      issueTitle: 'Wake 2', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO,
      resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] two', timestamp: NOW_ISO }]
    };
    const wSolo = {
      id: 'w-solo', sessionId: 'sess-fold', issueIdentifier: 'LIN-902',
      issueTitle: 'Solo', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO,
      resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] solo', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-fold', 'LIN-900'), wA, wB, wSolo],
        agentStatus: [
          agentStatusDone('sess-fold', 'LIN-900'), agentStatusDone('w-a', 'LIN-901'),
          agentStatusDone('w-b', 'LIN-901'), agentStatusDone('w-solo', 'LIN-902')
        ]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = findSession(res.jsonBody, 'sess-fold');
    assert.ok(sess, 'session present');
    // Invariant: the fold is presentation-only — runs[] keeps N entries.
    assert.equal(sess.runCount, 3, 'runs[] stays unfolded — three worker runs');
    const byId = id => sess.runs.find(r => r.loopId === id);
    const a = byId('w-a'), b = byId('w-b'), solo = byId('w-solo');
    assert.ok(a && b && solo, 'all three runs projected');
    // Shared rootItemId → identical lineageId (this is what the client groups on).
    assert.equal(a.lineageId, 'lineage-root');
    assert.equal(b.lineageId, 'lineage-root');
    assert.equal(a.lineageId, b.lineageId, 'the two wakes share one lineage id');
    // No rootItemId → lineageId falls back to the run's own loopId, never null.
    assert.equal(solo.lineageId, 'w-solo', 'a lineage-less run carries its own loopId as lineageId');
  });

  test('a [failed] worker yields an error-status session', async () => {
    const failWorker = { id: 'wf', sessionId: 'sess-9', issueIdentifier: 'LIN-301', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-9', 'LIN-300'), failWorker],
        agentStatus: [agentStatusDone('sess-9', 'LIN-300')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-9');
    assert.ok(s, 'terminal session is present');
    assert.equal(s.status, 'error');
  });

  // ── Session-level "waiting on user" rollup (LIN-1005) ────────────────────────
  test('a [blocked] feedback marker surfaces a session-level waiting state + message', async () => {
    // Non-terminal session (live autopilot anchor) whose worker posted a
    // [blocked] feedback marker but no agent-status blocked entry — the
    // feedback-only channel the fold otherwise misses.
    const blockedWorker = {
      id: 'w-b', sessionId: 'sess-b', issueIdentifier: 'LIN-401', issueTitle: 'Blocked worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [{ message: '[blocked] need your decision on the auth flow', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-b', 'LIN-400')], history: [blockedWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-b');
    assert.ok(s, 'waiting session is present');
    assert.equal(s.terminal, false, 'a [blocked] session is NOT terminal');
    assert.equal(s.status, 'waiting');
    assert.equal(s.waiting, true);
    assert.match(s.waitingMessage, /need your decision on the auth flow/);
  });

  test('an agent-status blocked run surfaces waiting even without a [blocked] feedback marker', async () => {
    // The other, independent channel: agentState==='waiting' from an agent-status
    // `blocked` entry (a close-out blocker awaiting verification, e.g. LIN-874).
    const blockedWorker = {
      id: 'w-ab', sessionId: 'sess-ab', issueIdentifier: 'LIN-411', issueTitle: 'Worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken'
    };
    const blockedStatus = { dispatchId: 'w-ab', taskIdentifier: 'LIN-411', action: 'implementation', status: 'blocked', summary: 'awaiting verification runs before close', timestamp: NOW_ISO };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-ab', 'LIN-410')], history: [blockedWorker], agentStatus: [blockedStatus] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-ab');
    assert.ok(s, 'waiting session is present');
    assert.equal(s.status, 'waiting');
    assert.equal(s.waiting, true);
    assert.match(s.waitingMessage, /awaiting verification/, 'falls back to the blocked run summary');
  });

  test('a [pending] feedback marker does NOT surface waiting — it is a machine handoff, not a human ask (LIN-1025)', async () => {
    // [pending] (LIN-843) is an agent-to-agent orchestrator handoff, not a request
    // for user input, so it must never roll up to the "Waiting on you" surface even
    // though it is a non-terminal wake marker (which still wakes the orchestrator via
    // the separate WAKE_FEEDBACK_REGEX). Mirrors the [blocked] positive case above.
    const pendingWorker = {
      id: 'w-p', sessionId: 'sess-p', issueIdentifier: 'LIN-441', issueTitle: 'Stepper worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [{ message: '[pending] my beat is done, the task is not', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-p', 'LIN-440')], history: [pendingWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-p');
    assert.ok(s, 'the [pending] session is present in the feed');
    assert.equal(s.waiting, false, '[pending] must not flag human-waiting');
    assert.notEqual(s.status, 'waiting', '[pending] session is in-progress, not waiting');
    assert.equal(s.waitingMessage, null, 'no "waiting on you" message for a machine handoff');
  });

  test('a session that emitted [blocked] then finished is done, not waiting (terminal precedence)', async () => {
    // [blocked] is a pause signal, not terminal — but a later [done] wins. The
    // session must report done with no lingering waiting flag.
    const worker = {
      id: 'w-bd', sessionId: 'sess-bd', issueIdentifier: 'LIN-421', issueTitle: 'Worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { message: '[blocked] waiting on you', timestamp: NOW_ISO },
        { message: '[done] resolved and shipped', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': { live: [], history: [autopilotHistoryItem('sess-bd', 'LIN-420'), worker], agentStatus: [agentStatusDone('sess-bd', 'LIN-420')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-bd');
    assert.ok(s, 'terminal session is present');
    assert.equal(s.terminal, true);
    assert.equal(s.status, 'done');
    assert.equal(s.waiting, false);
    assert.equal(s.waitingMessage, null);
  });

  test('a terminal session with a lingering blocked worker is done, NOT waiting (session-level terminal gate)', async () => {
    // The SESSION-level precedence gap (LIN-1005 review): the autopilot ANCHOR
    // finished (agentStatus completed → session terminal), but a SEPARATE worker
    // loop is still [blocked] with no later [done]. `deriveSessionWaiting` unions
    // across all loops and would report the worker as waiting; the emitted flag
    // must be gated on SESSION terminality so a finished session is never waiting.
    const blockedWorker = {
      id: 'w-tw', sessionId: 'sess-tw', issueIdentifier: 'LIN-431', issueTitle: 'Worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [{ message: '[blocked] need your decision on the auth flow', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': { live: [], history: [autopilotHistoryItem('sess-tw', 'LIN-430'), blockedWorker], agentStatus: [agentStatusDone('sess-tw', 'LIN-430')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-tw');
    assert.ok(s, 'terminal session is present');
    assert.equal(s.terminal, true);
    assert.equal(s.status, 'done', 'terminal status wins');
    assert.equal(s.waiting, false, 'the emitted waiting flag is gated on session terminality');
    assert.equal(s.waitingMessage, null, 'no lingering blocked message on a done session');
  });

  test('a reply after a [blocked] worker clears the session-level waiting state (LIN-1341 RC2)', async () => {
    // The block-then-replied bug: a worker posts [blocked], then a human follow-up
    // reply (no sessionId of its own, only followUpTo) resumes and completes
    // cleanly. Before RC2, deriveSessionWaiting unioned across ALL loops, so the
    // superseded [blocked] loop kept the whole session waiting forever.
    const blockedWorker = {
      id: 'w-br', sessionId: 'sess-br', issueIdentifier: 'LIN-451', issueTitle: 'Blocked worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [{ message: '[blocked] need your decision on the auth flow', timestamp: NOW_ISO }]
    };
    const REPLY_TS = new Date(Date.now() + 60000).toISOString();
    const replyWorker = {
      id: 'w-br-reply', followUpTo: 'w-br', target: 'cli', issueIdentifier: 'LIN-451', issueTitle: 'Blocked worker',
      promptName: 'implementation', prompt: 'reply', dispatchedAt: REPLY_TS, resolvedAt: REPLY_TS, status: 'taken',
      feedback: [{ message: '[done] resolved after your input', timestamp: REPLY_TS }]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-br', 'LIN-450')], history: [blockedWorker, replyWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-br');
    assert.ok(s, 'session is present');
    assert.equal(s.waiting, false, 'the reply clears the stale [blocked] on the loop it replied to');
    assert.notEqual(s.status, 'waiting');
  });

  // ── LIN-2184 (H5, beat 2): decision/decisionCase projection widenings ────────
  test('LIN-2184: the per-run runs[] entry surfaces decision/decisionCase (H3 loop-level fields, widened through)', async () => {
    const decisionWorker = {
      id: 'w-dec', sessionId: 'sess-dec', issueIdentifier: 'LIN-461', issueTitle: 'Decision worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { kind: 'assistant-text', message: 'Considered the schema diff.', timestamp: NOW_ISO },
        { kind: 'decision', message: '[decision] {"decision_id":"d-461","question":"Proceed?"}', timestamp: NOW_ISO },
        { message: '[blocked] awaiting your ruling', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-dec', 'LIN-460')], history: [decisionWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-dec');
    assert.ok(s, 'session is present');
    const run = s.runs.find(r => r.loopId === 'w-dec');
    assert.ok(run, 'the decision-bearing run is in runs[]');
    assert.deepEqual(run.decision, { decision_id: 'd-461', question: 'Proceed?' });
    assert.deepEqual(run.decisionCase, ['Considered the schema diff.']);
  });

  test('LIN-2184: the session-level payload surfaces producerLoopId/decision/decisionCase from the rollup', async () => {
    const decisionWorker = {
      id: 'w-dec2', sessionId: 'sess-dec2', issueIdentifier: 'LIN-471', issueTitle: 'Decision worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { kind: 'assistant-text', message: 'Considered the rollback plan.', timestamp: NOW_ISO },
        { kind: 'decision', message: '[decision] {"decision_id":"d-471"}', timestamp: NOW_ISO },
        { message: '[blocked] awaiting your ruling', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-dec2', 'LIN-470')], history: [decisionWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-dec2');
    assert.ok(s, 'session is present');
    assert.equal(s.producerLoopId, 'w-dec2');
    assert.deepEqual(s.decision, { decision_id: 'd-471' });
    assert.deepEqual(s.decisionCase, ['Considered the rollback plan.']);
  });

  test('LIN-2184: a decision on a non-waiting (session-terminal) loop still carries the fields in the payload — the payload is NOT waiting-gated', async () => {
    // Mirrors the existing "terminal session with a lingering blocked worker"
    // fixture above (session-level terminal gate nulls `waiting`/`waitingMessage`)
    // but adds a decision to the still-[blocked] worker loop, proving H4's ledger
    // rule holds through the widened projection: producerLoopId/decision/
    // decisionCase ride UNGATED even though the session's own `waiting` is false.
    const decisionWorker = {
      id: 'w-dec3', sessionId: 'sess-dec3', issueIdentifier: 'LIN-481', issueTitle: 'Worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { kind: 'assistant-text', message: 'Case for the lingering worker.', timestamp: NOW_ISO },
        { kind: 'decision', message: '[decision] {"decision_id":"d-481"}', timestamp: NOW_ISO },
        { message: '[blocked] need your decision on the auth flow', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': { live: [], history: [autopilotHistoryItem('sess-dec3', 'LIN-480'), decisionWorker], agentStatus: [agentStatusDone('sess-dec3', 'LIN-480')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-dec3');
    assert.ok(s, 'terminal session is present');
    assert.equal(s.terminal, true);
    assert.equal(s.waiting, false, 'the emitted waiting flag is still gated on session terminality (unchanged)');
    assert.equal(s.producerLoopId, 'w-dec3', 'producerLoopId is NOT gated on session terminality');
    assert.deepEqual(s.decision, { decision_id: 'd-481' }, 'decision is NOT gated on session terminality');
    assert.deepEqual(s.decisionCase, ['Case for the lingering worker.'], 'decisionCase is NOT gated on session terminality');
  });

  test('a non-terminal session idle > 24h is derived stale and bucketed out of Active', async () => {
    // Worker that died without a terminal marker, last seen 2 days ago (Bug 3).
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const staleAnchor = { id: 'sess-stale', kind: 'autopilot', issueIdentifier: 'LIN-700', issueTitle: 'Stale session', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    const router = makeRouter({ 'ws-a': { live: [staleAnchor], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-stale');
    assert.ok(s, 'stale session lands in the archive, not Active');
    assert.equal(s.stale, true);
    assert.equal(s.status, 'stale');
    assert.equal(s.terminal, false, 'stale is derived, never a terminal mutation');
    assert.ok(!res.jsonBody.active.some(x => x.sessionId === 'sess-stale'), 'stale session is not in Active');
  });

  test('recent child activity un-stales an otherwise-old session (stays Active)', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const oldAnchor = { id: 'sess-fresh', kind: 'autopilot', issueIdentifier: 'LIN-710', issueTitle: 'Fresh session', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    // A worker dispatched just now → recent activity advances the session's clock.
    const liveWorker = { id: 'w-fresh', sessionId: 'sess-fresh', issueIdentifier: 'LIN-711', issueTitle: 'Worker', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO };
    const router = makeRouter({ 'ws-a': { live: [oldAnchor, liveWorker], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.active.find(x => x.sessionId === 'sess-fresh');
    assert.ok(s, 'a later heartbeat keeps the session in Active');
    assert.equal(s.stale, false);
    assert.equal(s.status, 'in-progress');
  });

  test('a terminal session that finished <24h ago is Active, not Archive (LIN-631)', async () => {
    // Recency-only split: a just-completed session stays in Active for 24h instead
    // of dropping straight into the archive on completion.
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-rt', 'LIN-650'), workerHistoryItem('w-rt', 'LIN-651', 'sess-rt')],
        agentStatus: [agentStatusDone('sess-rt', 'LIN-650'), agentStatusDone('w-rt', 'LIN-651')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const inActive = res.jsonBody.active.find(x => x.sessionId === 'sess-rt');
    assert.ok(inActive, 'a terminal session within 24h shows in Active');
    assert.equal(inActive.terminal, true, 'it is still terminal — only its bucket changed');
    assert.ok(!res.jsonBody.recent.some(x => x.sessionId === 'sess-rt'), 'it is not in the archive');
  });

  test('recentKind surfaces the most-recently-active run kind (LIN-631)', async () => {
    // Two live workers with different kinds; the one with later activity wins.
    const wEarly = { id: 'w-e', sessionId: 'sess-k', kind: 'research', issueIdentifier: 'LIN-601', issueTitle: 'E', promptName: 'research', prompt: 'p', dispatchedAt: OLD_ISO };
    const wLate = { id: 'w-l', sessionId: 'sess-k', kind: 'plan', issueIdentifier: 'LIN-602', issueTitle: 'L', promptName: 'plan', prompt: 'p', dispatchedAt: NOW_ISO };
    const router = makeRouter({ 'ws-a': { live: [autopilotLiveItem('sess-k', 'LIN-600'), wEarly, wLate], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-k');
    assert.ok(s, 'session present');
    assert.equal(s.recentKind, 'plan', 'recentKind = kind of the most-recently-active non-terminal run');
  });

  test('archive paginates via offset/limit and reports recentTotal (LIN-631)', async () => {
    const history = [];
    const agentStatus = [];
    for (let i = 0; i < 5; i++) {
      history.push(autopilotHistoryItem(`sess-p${i}`, `LIN-9${i}0`, OLD_ISO));
      agentStatus.push(agentStatusDone(`sess-p${i}`, `LIN-9${i}0`, OLD_ISO));
    }
    const router = makeRouter({ 'ws-a': { live: [], history, agentStatus } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };

    const r1 = makeReqRes({ session, query: { offset: '0', limit: '2' } });
    await handler(r1.req, r1.res);
    assert.equal(r1.res.statusCode, 200);
    assert.equal(r1.res.jsonBody.recent.length, 2, 'first page honours limit');
    assert.equal(r1.res.jsonBody.recentTotal, 5, 'recentTotal is the full archive size');
    assert.equal(r1.res.jsonBody.recentOffset, 0);
    assert.equal(r1.res.jsonBody.recentLimit, 2);

    const r2 = makeReqRes({ session, query: { offset: '2', limit: '2' } });
    await handler(r2.req, r2.res);
    assert.equal(r2.res.jsonBody.recent.length, 2, 'second page honours offset+limit');
    const ids1 = new Set(r1.res.jsonBody.recent.map(s => s.sessionId));
    assert.ok(r2.res.jsonBody.recent.every(s => !ids1.has(s.sessionId)), 'pages do not overlap');
  });

  test('one failing workspace store does not blank the whole feed', async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return []; },
        async listHistory(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return { items: withFreshDigests([autopilotHistoryItem('sess-x', 'LIN-400')]) }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('sess-x', 'LIN-400')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'bad', name: 'Bad' }, { urlKey: 'good', name: 'Good' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 1, 'good workspace still contributes its session');
  });

  test('a second poll within the cache TTL is served without re-reading the stores (LIN-617)', async () => {
    // Count how often the slow whole-workspace read actually runs. With the
    // short-TTL feed cache, only the FIRST poll for this workspace set pays it;
    // the second poll is served from the cached merged feed.
    let historyReads = 0;
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() { historyReads++; return { items: withFreshDigests([autopilotHistoryItem('sess-c', 'LIN-617')]) }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('sess-c', 'LIN-617')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };

    const first = makeReqRes({ session });
    await handler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.jsonBody.counts.total, 1);
    assert.equal(historyReads, 1, 'first poll pays the whole-workspace read');

    const second = makeReqRes({ session });
    await handler(second.req, second.res);
    assert.equal(second.res.statusCode, 200);
    assert.deepEqual(
      second.res.jsonBody.recent.map(s => s.sessionId),
      first.res.jsonBody.recent.map(s => s.sessionId),
      'second poll returns the same feed'
    );
    assert.equal(historyReads, 1, 'second poll within TTL is served from cache (no re-scan)');
  });
});

// ─── Lineage-aware activity clock + stale derivation (LIN-1477) ───────────────
// `loopActivityMs` (routes/dashboard.js) folds in `loop.lineageLastActivityMs`
// (emitted by lib/pipeline-loops.js) so `sessionActivityMs`/`stale` inherit it —
// a session must not go stale while its lineage is still beating on a repoint,
// even when the specific loop THIS session tracks is itself long idle.
describe('lineage-aware activity clock (LIN-1477)', () => {
  test('a session stays out of stale while its lineage is beating, even though its OWN dispatch is >24h old (C3)', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const RECENT_BEAT_TS = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const staleAnchor = { id: 'sess-lineage', kind: 'autopilot', issueIdentifier: 'LIN-720', issueTitle: 'Lineage session', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    // A dispatch sharing the SAME lineage (rootItemId points back at the
    // anchor's own id) that beat recently. It is NOT itself a member of the
    // session — the lineage aggregate is built across every loop fetched, not
    // just a session's own loops (lib/pipeline-loops.js), so this alone must be
    // enough to advance the anchor's activity clock.
    const lineageSibling = {
      id: 'sibling-1', rootItemId: 'sess-lineage', issueIdentifier: 'LIN-721', issueTitle: 'Sibling',
      promptName: 'implementation', prompt: 'p', dispatchedAt: OLD_ISO, resolvedAt: OLD_ISO, status: 'taken',
      feedback: [{ message: '[working] 3 tools/30s · alive', url: null, urlLabel: null, timestamp: RECENT_BEAT_TS }]
    };
    const router = makeRouter({ 'ws-a': { live: [staleAnchor], history: [lineageSibling], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.active.find(x => x.sessionId === 'sess-lineage');
    assert.ok(s, 'the lineage heartbeat keeps the session in Active, not Archive');
    assert.equal(s.stale, false, 'not marked stale while its lineage is beating (LIN-1469 C3)');
    assert.equal(s.status, 'in-progress');
  });

  test('a lineage with no RECENT beat does NOT rescue the session — still goes stale (negative control)', async () => {
    // Same shape as the previous test, but the sibling's heartbeat is itself old
    // — isolates the wiring (reads the lineage timestamp) from a hardcoded pass
    // (any lineage sibling present ⇒ never stale).
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const staleAnchor = { id: 'sess-lineage-2', kind: 'autopilot', issueIdentifier: 'LIN-722', issueTitle: 'Lineage session 2', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    const staleLineageSibling = {
      id: 'sibling-2', rootItemId: 'sess-lineage-2', issueIdentifier: 'LIN-723', issueTitle: 'Sibling 2',
      promptName: 'implementation', prompt: 'p', dispatchedAt: OLD_ISO, resolvedAt: OLD_ISO, status: 'taken',
      feedback: [{ message: '[working] 3 tools/30s · alive', url: null, urlLabel: null, timestamp: OLD_ISO }]
    };
    const router = makeRouter({ 'ws-a': { live: [staleAnchor], history: [staleLineageSibling], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-lineage-2');
    assert.ok(s, 'no rescue: session lands in the archive');
    assert.equal(s.stale, true, 'a lineage with no recent beat still goes stale — proves the wiring reads timestamps, not just sibling presence');
    assert.ok(!res.jsonBody.active.some(x => x.sessionId === 'sess-lineage-2'));
  });

  // LIN-2182 review ledger 1. The two tests above pin the lineage clock against a
  // GENUINE heartbeat (recent ⇒ rescued from stale; old ⇒ not rescued). This pins
  // the third case the clock had no coverage for: a recent entry that is not a beat
  // at all, but whose PROSE matches HEARTBEAT_HINT. `kind:'decision'` entries exist
  // in live data today (S2/LIN-2186 is merged), and before LIN-2182's scoped
  // exclusion in `parseHeartbeats` such an entry minted a phantom beat carrying the
  // decision's timestamp — floating `lineageLastActivityMs` → `loopActivityMs` →
  // `sessionActivityMs` and rescuing a stale session from the archive on the
  // strength of a question a human has not answered yet. The C3 test above is the
  // positive control for this one: same fixture shape, genuine beat, rescued.
  test('a recent DECISION whose prose looks like a beat does NOT rescue the session from stale (LIN-2182)', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const RECENT_TS = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const staleAnchor = { id: 'sess-lineage-3', kind: 'autopilot', issueIdentifier: 'LIN-724', issueTitle: 'Lineage session 3', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    const decisionSibling = {
      id: 'sibling-3', rootItemId: 'sess-lineage-3', issueIdentifier: 'LIN-725', issueTitle: 'Sibling 3',
      promptName: 'implementation', prompt: 'p', dispatchedAt: OLD_ISO, resolvedAt: OLD_ISO, status: 'taken',
      feedback: [{
        kind: 'decision',
        // Reproduced live during LIN-2182 research: this question alone minted
        // { toolCount: 3 } when `parseHeartbeats` did not consult `kind`.
        message: `[decision] ${JSON.stringify({ decision_id: 'd-1', question: 'batch 3 tools in one turn, or keep them serial?' })}`,
        url: null, urlLabel: null, timestamp: RECENT_TS
      }]
    };
    const router = makeRouter({ 'ws-a': { live: [staleAnchor], history: [decisionSibling], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(!res.jsonBody.active.some(x => x.sessionId === 'sess-lineage-3'),
      'decision prose must not float the activity clock into the Active bucket');
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-lineage-3');
    assert.ok(s, 'the session lands in the archive, as it would with no late entry at all');
    assert.equal(s.stale, true, 'still stale — a question awaiting a human is not activity');
  });

  test('followUpTo supersede/unfreeze behavior is unaffected by lineage fields (I3)', async () => {
    // Mirrors the existing LIN-1341 RC2 block-then-replied regression test, with
    // rootItemId added to both loops, to pin that lineage aggregation composes
    // with — and never interferes with — the followUpTo supersede rule.
    const blockedWorker = {
      id: 'w-li-br', sessionId: 'sess-li-br', issueIdentifier: 'LIN-730', issueTitle: 'Blocked worker (lineage)',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      rootItemId: 'w-li-br',
      feedback: [{ message: '[blocked] need your decision on the auth flow', timestamp: NOW_ISO }]
    };
    const REPLY_TS = new Date(Date.now() + 60000).toISOString();
    const replyWorker = {
      id: 'w-li-br-reply', followUpTo: 'w-li-br', rootItemId: 'w-li-br', target: 'cli',
      issueIdentifier: 'LIN-730', issueTitle: 'Blocked worker (lineage)',
      promptName: 'implementation', prompt: 'reply', dispatchedAt: REPLY_TS, resolvedAt: REPLY_TS, status: 'taken',
      feedback: [{ message: '[done] resolved after your input', timestamp: REPLY_TS }]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-li-br', 'LIN-729')], history: [blockedWorker, replyWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-li-br');
    assert.ok(s, 'session is present');
    assert.equal(s.waiting, false, 'the reply still clears the superseded [blocked] loop even with rootItemId present on both loops');
    assert.notEqual(s.status, 'waiting');
  });
});

// ─── Descendant recency rollup (LIN-1314) ─────────────────────────────────────
// "Sub-session" = a descendant CHILD-AUTOPILOT session (its own separate
// sessionId group), not a worker loop within one session — sessionActivityMs
// already maxes over those. These fixtures nest a grandchild worker under a
// child autopilot that is itself a member of the parent's session.
describe('descendant recency rollup (LIN-1314)', () => {
  test("a grandchild worker's activity rolls up through a child-autopilot session into the parent's stamp", async () => {
    const PARENT_TS = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const CHILD_TS = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const perWorkspace = {
      'ws-a': {
        live: [
          autopilotLiveItem('sess-parent', 'LIN-900', PARENT_TS),
          childAutopilotLiveItem('sess-child', 'LIN-901', 'sess-parent', CHILD_TS),
          workerLiveItem('w-grand', 'LIN-902', 'sess-child', NOW_ISO)
        ],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const parent = findSession(res.jsonBody, 'sess-parent');
    assert.ok(parent, 'parent session present');
    // Without the rollup, the parent's own group tops out at CHILD_TS (the child
    // autopilot loop is a member of the parent's own session); the fix folds in
    // the grandchild worker's NOW_ISO activity from the separate 'sess-child' session.
    assert.equal(parent.lastActivity, NOW_ISO, "parent's stamp reflects the grandchild's activity");

    const child = findSession(res.jsonBody, 'sess-child');
    assert.ok(child, 'the child autopilot is also its own session');
    assert.equal(child.lastActivity, NOW_ISO);
  });

  test('an active grandchild un-stales a stale parent and keeps it Active (status + bucket)', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const perWorkspace = {
      'ws-a': {
        live: [
          autopilotLiveItem('sess-p2', 'LIN-910', OLD_ISO),
          childAutopilotLiveItem('sess-c2', 'LIN-911', 'sess-p2', OLD_ISO),
          workerLiveItem('w-grand2', 'LIN-912', 'sess-c2', NOW_ISO)
        ],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const parent = res.jsonBody.active.find(s => s.sessionId === 'sess-p2');
    assert.ok(parent, 'the parent stays in Active thanks to the active grandchild');
    assert.equal(parent.stale, false);
    assert.equal(parent.status, 'in-progress');
    assert.ok(!res.jsonBody.recent.some(s => s.sessionId === 'sess-p2'), 'the parent is not archived');
  });

  test('a session with no descendant sessions is left byte-identical (no-op path)', async () => {
    // Plain single-session fixture — no nested child autopilot — must resolve
    // exactly as it did before the rollup pass existed.
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-plain', 'LIN-920'), workerHistoryItem('w-plain', 'LIN-921', 'sess-plain')],
        agentStatus: [agentStatusDone('sess-plain', 'LIN-920'), agentStatusDone('w-plain', 'LIN-921')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = findSession(res.jsonBody, 'sess-plain');
    assert.ok(s, 'plain session present');
    assert.equal(s.lastActivity, NOW_ISO);
    assert.equal(s.status, 'done');
    assert.equal(s.terminal, true);
    assert.equal(s.stale, false);
  });

  test('a finished parent stays done even while a descendant child-autopilot session is still active', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const perWorkspace = {
      'ws-a': {
        live: [childAutopilotLiveItem('sess-c3', 'LIN-931', 'sess-p3', NOW_ISO)],
        history: [autopilotHistoryItem('sess-p3', 'LIN-930', OLD_ISO)],
        agentStatus: [agentStatusDone('sess-p3', 'LIN-930', OLD_ISO)]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const parent = findSession(res.jsonBody, 'sess-p3');
    assert.ok(parent, 'terminal parent present');
    assert.equal(parent.terminal, true);
    assert.equal(parent.status, 'done', 'a finished parent stays done even though a descendant is still active');
    assert.equal(parent.stale, false, 'terminal sessions are never derived stale');
    // The stamp itself still advances to reflect the live descendant (the hub
    // field the sort/Active-Archive splits read), even though status/terminal
    // precedence is preserved.
    assert.equal(parent.lastActivity, NOW_ISO);
  });
});

// ─── Materialized read-model swap (LIN-623) ───────────────────────────────────

describe('GET /api/dashboard/sessions — materialized read-model (LIN-623)', () => {
  // The session objects the derived store holds are exactly the lean
  // getSessionsForWorkspace output, so produce them from a fixture once.
  async function realSessions(perWorkspace, urlKey) {
    const { getSessionsForWorkspace } = await import('../../lib/pipeline-loops.js');
    const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
    return getSessionsForWorkspace(urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore, lean: true });
  }
  const throwingStores = {
    dispatchQueueStore: {
      async listItems() { throw new Error('live path must not be read on a derived hit'); },
      async listHistory() { throw new Error('live path must not be read on a derived hit'); }
    },
    agentStatusStore: { async listStatus() { throw new Error('live path must not be read on a derived hit'); } }
  };

  test('serves the derived read-model and never touches the live reconstruction on a hit', async () => {
    const perWorkspace = { 'ws-a': { live: [], history: [autopilotHistoryItem('sess-a', 'LIN-1'), workerHistoryItem('w-a', 'LIN-2', 'sess-a')], agentStatus: [agentStatusDone('w-a', 'LIN-2')] } };
    const sessions = await realSessions(perWorkspace, 'ws-a');

    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...throwingStores,
      observationSessionsStore: { async findByWorkspace(urlKey) { return urlKey === 'ws-a' ? { sessions, backfilledAt: new Date() } : { sessions: [], backfilledAt: null }; } },
      observationMaterializer: { backfillWorkspace() { throw new Error('no backfill on a hit'); } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token', fetchIssueContext: async () => ({}), fetchWorkspaceIssues: async () => [], getOpenRouterSource: () => 'env', getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 1, 'served the derived session without reading the live stores');
    const all = [...res.jsonBody.active, ...res.jsonBody.recent];
    assert.equal(all[0].sessionId, 'sess-a');
    assert.equal(all[0].workspaceUrlKey, 'ws-a');
  });

  test('LIN-1341: a stamped, drip-fed (stepper) follow-up thread renders as ONE continuation on the default Autopilot feed, not N cards', async () => {
    // Autopilot orchestrator + worker, then two drip-fed follow-up beats resuming
    // the worker in turn — each stamped with the group id a real dispatch would
    // inherit (the worker's own sessionId, i.e. the orchestrator's id).
    const orchestrator = autopilotHistoryItem('ap-1', 'LIN-900');
    const w1 = workerHistoryItem('w1', 'LIN-901', 'ap-1');
    const T1 = new Date(Date.now() + 60000).toISOString();
    const beat2 = {
      id: 'beat-2', followUpTo: 'w1', target: 'cli', sessionGroupId: 'ap-1', issueIdentifier: 'LIN-901', issueTitle: 'Title LIN-901',
      promptName: 'implementation', prompt: 'p', dispatchedAt: T1, resolvedAt: T1, status: 'taken',
      feedback: [{ message: '[pending] beat 2 done', timestamp: T1 }]
    };
    const T2 = new Date(Date.now() + 120000).toISOString();
    const beat3 = {
      id: 'beat-3', followUpTo: 'beat-2', target: 'cli', sessionGroupId: 'ap-1', issueIdentifier: 'LIN-901', issueTitle: 'Title LIN-901',
      promptName: 'implementation', prompt: 'p', dispatchedAt: T2, resolvedAt: T2, status: 'taken',
      feedback: [{ message: '[done] all beats complete', timestamp: T2 }]
    };
    const perWorkspace = { 'ws-a': { live: [], history: [orchestrator, w1, beat2, beat3], agentStatus: [agentStatusDone('ap-1', 'LIN-900')] } };

    const sessions = await realSessions(perWorkspace, 'ws-a');
    assert.equal(sessions.length, 1, 'the real builder grouped the orchestrator, worker, and both drip-fed beats into ONE session');
    assert.deepEqual(sessions[0].loops.map(l => l.loopId).sort(), ['ap-1', 'beat-2', 'beat-3', 'w1']);

    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...throwingStores, // proves the Autopilot feed reads the materialized store, not live
      observationSessionsStore: { async findByWorkspace(urlKey) { return urlKey === 'ws-a' ? { sessions, backfilledAt: new Date() } : { sessions: [], backfilledAt: null }; } },
      observationMaterializer: { backfillWorkspace() { throw new Error('no backfill on a hit'); } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token', fetchIssueContext: async () => ({}), fetchWorkspaceIssues: async () => [], getOpenRouterSource: () => 'env', getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const all = [...res.jsonBody.active, ...res.jsonBody.recent];
    assert.equal(all.length, 1, 'the default Autopilot feed renders the drip-fed thread as one card, not three');
    assert.equal(all[0].sessionId, 'ap-1');
  });

  test('read-miss falls back to the live path AND kicks a one-time background backfill', async () => {
    const perWorkspace = { 'ws-a': { live: [], history: [autopilotHistoryItem('sess-a', 'LIN-1')], agentStatus: [agentStatusDone('sess-a', 'LIN-1')] } };
    const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
    const backfilled = [];
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore, agentStatusStore,
      observationSessionsStore: { async findByWorkspace() { return { sessions: [], backfilledAt: null }; } }, // miss: empty + unbackfilled
      observationMaterializer: { backfillWorkspace(urlKey) { backfilled.push(urlKey); return Promise.resolve(); } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token', fetchIssueContext: async () => ({}), fetchWorkspaceIssues: async () => [], getOpenRouterSource: () => 'env', getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 1, 'fell back to the correct live reconstruction');
    assert.deepEqual(backfilled, ['ws-a'], 'kicked the background backfill exactly once for the missed workspace');
  });

  test('a backfilled-but-empty workspace serves empty WITHOUT re-fanning to the live path', async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...throwingStores, // proves the live path is never read
      observationSessionsStore: { async findByWorkspace() { return { sessions: [], backfilledAt: new Date() }; } }, // empty, but backfilled
      observationMaterializer: { backfillWorkspace() { throw new Error('no re-backfill for a known-empty workspace'); } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token', fetchIssueContext: async () => ({}), fetchWorkspaceIssues: async () => [], getOpenRouterSource: () => 'env', getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 0);
  });

  test('with no observationSessionsStore wired, the feed is byte-identical to the live path (default)', async () => {
    const perWorkspace = { 'ws-a': { live: [], history: [autopilotHistoryItem('sess-a', 'LIN-1')], agentStatus: [agentStatusDone('sess-a', 'LIN-1')] } };
    const router = makeRouter(perWorkspace); // no observation deps
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 1);
  });
});

// ─── Sessions view / in-flight tab (LIN-1194) ─────────────────────────────────
//
// The Observation page gained a second tab. The same /api/dashboard/sessions
// endpoint serves both, discriminated by `?view=sessions`:
//   - default (Autopilot): UNCHANGED — standalone sessions filtered OUT.
//   - view=sessions: standalone user-dispatched cli/web sessions INCLUDED, split
//     running-only (taken ∧ non-terminal) Active vs terminal Archive.

// A standalone (non-autopilot, no sessionId) cli dispatch — the case the current
// feed drops. `target: 'cli'` is required for pass 3 to synthesize a session.
function standaloneRunning(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', target: 'cli', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'working…' }] };
}
function standaloneTerminal(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', target: 'cli', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] shipped', timestamp: NOW_ISO }] };
}
// A queued-but-not-yet-taken standalone dispatch (still on the live queue).
function standaloneQueued(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', target: 'cli', dispatchedAt: NOW_ISO };
}

const sessionsHandler = (router) => getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
const wsSession = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };

describe('GET /api/dashboard/sessions — Sessions view (LIN-1194)', () => {
  test('a running standalone cli dispatch appears in the Sessions view active, NOT in Autopilot', async () => {
    const router = makeRouter({ 'ws-a': { live: [], history: [standaloneRunning('m1', 'LIN-1')], agentStatus: [] } });
    const handler = sessionsHandler(router);

    // Autopilot (default) — standalone filtered out entirely.
    const auto = makeReqRes({ session: wsSession, query: {} });
    await handler(auto.req, auto.res);
    assert.equal(auto.res.statusCode, 200);
    assert.equal(findSession(auto.res.jsonBody, 'm1'), undefined, 'standalone leaked into Autopilot');
    assert.equal(auto.res.jsonBody.view, 'autopilot');

    // Sessions view — the standalone session is present and in the Active list.
    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);
    assert.equal(sess.res.jsonBody.view, 'sessions');
    const s = sess.res.jsonBody.active.find(x => x.sessionId === 'm1');
    assert.ok(s, 'standalone running session is in-flight/active');
    assert.equal(s.standalone, true);
    assert.equal(s.taken, true);
    assert.equal(s.terminal, false);
  });

  test('a queued-but-not-taken standalone dispatch is excluded from the Sessions view (running-only V1)', async () => {
    const router = makeRouter({ 'ws-a': { live: [standaloneQueued('q1', 'LIN-2')], history: [], agentStatus: [] } });
    const handler = sessionsHandler(router);
    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);
    assert.equal(findSession(sess.res.jsonBody, 'q1'), undefined, 'queued-but-not-taken must not surface as in-flight');
  });

  test('one recency rule on the Sessions source (LIN-3983): a session finished within a day is Active, as on Autopilot', async () => {
    const router = makeRouter({ 'ws-a': { live: [], history: [standaloneTerminal('t1', 'LIN-3')], agentStatus: [] } });
    const handler = sessionsHandler(router);
    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);
    assert.ok(sess.res.jsonBody.active.find(x => x.sessionId === 't1'), 'touched within 24h, so Active');
    assert.equal(sess.res.jsonBody.recent.find(x => x.sessionId === 't1'), undefined);
  });

  test('a standalone session untouched for over a day is archived on the Sessions source (LIN-3983)', async () => {
    const old = { ...standaloneTerminal('t2', 'LIN-4'), dispatchedAt: OLD_ISO, resolvedAt: OLD_ISO, feedback: [{ message: '[done] shipped', timestamp: OLD_ISO }] };
    const router = makeRouter({ 'ws-a': { live: [], history: [old], agentStatus: [] } });
    const handler = sessionsHandler(router);
    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);
    assert.equal(sess.res.jsonBody.active.find(x => x.sessionId === 't2'), undefined);
    assert.ok(sess.res.jsonBody.recent.find(x => x.sessionId === 't2'), 'an old finished standalone is archived');
  });

  test('a waiting session names every loop it waits on, and a finished one names none (LIN-3983)', async () => {
    const router = makeRouter({
      'ws-a': {
        live: [],
        history: [{ ...standaloneRunning('w1', 'LIN-30'), feedback: [{ message: '[blocked] need a decision', timestamp: NOW_ISO }] }, standaloneTerminal('t3', 'LIN-31')],
        agentStatus: []
      }
    });
    const handler = sessionsHandler(router);
    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);

    const waiting = findSession(sess.res.jsonBody, 'w1');
    assert.equal(waiting.waiting, true);
    assert.deepEqual(waiting.waitingLoopIds, [waiting.producerLoopId], 'one blocked loop, named');

    const done = findSession(sess.res.jsonBody, 't3');
    assert.deepEqual(done.waitingLoopIds, [], 'a finished session waits on nothing');
  });

  test('an autopilot session stays in the Autopilot view AND appears in the Sessions view (in-flight superset)', async () => {
    const router = makeRouter({
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('ap1', 'LIN-10'), workerHistoryItem('w1', 'LIN-11', 'ap1')],
        agentStatus: []
      }
    });
    const handler = sessionsHandler(router);

    const auto = makeReqRes({ session: wsSession, query: {} });
    await handler(auto.req, auto.res);
    const apAuto = findSession(auto.res.jsonBody, 'ap1');
    assert.ok(apAuto, 'autopilot session present in Autopilot view');
    assert.equal(apAuto.standalone, false);

    const sess = makeReqRes({ session: wsSession, query: { view: 'sessions' } });
    await handler(sess.req, sess.res);
    assert.ok(findSession(sess.res.jsonBody, 'ap1'), 'autopilot in-flight session also shows in Sessions view');
  });

  test('the Autopilot view is byte-identical whether or not a standalone session exists (regression pin)', async () => {
    const withoutStandalone = makeRouter({ 'ws-a': { live: [], history: [autopilotHistoryItem('ap1', 'LIN-10')], agentStatus: [] } });
    const withStandalone = makeRouter({ 'ws-a': { live: [], history: [autopilotHistoryItem('ap1', 'LIN-10'), standaloneRunning('m1', 'LIN-99')], agentStatus: [] } });

    const a = makeReqRes({ session: wsSession, query: {} });
    await sessionsHandler(withoutStandalone)(a.req, a.res);
    const b = makeReqRes({ session: wsSession, query: {} });
    await sessionsHandler(withStandalone)(b.req, b.res);

    const ids = (body) => [...(body.active || []), ...(body.recent || [])].map(s => s.sessionId).sort();
    assert.deepEqual(ids(a.res.jsonBody), ['ap1'], 'only the autopilot session, no standalone');
    assert.deepEqual(ids(b.res.jsonBody), ['ap1'], 'the standalone session did NOT leak into Autopilot');
  });
});


// LIN-3658: the free-tier refusal body at each summary route, byte for byte. A
// free-tier session (no session key, no paid env key, a free-tier key set)
// reaching the REAL model path (the offline mock is off) is denied by the store;
// the 429 must carry exactly `error` then the four-field `freeTier` block.
const DENIED_RECORD = { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' };
const DENIED_429_BODY = '{"error":"Free tier limit reached","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-09-01T00:00:00.000Z"}}';

async function withFreeTierRealPathEnv(fn) {
  const keys = ['NODE_ENV', 'HARBOUR_DISABLE_AI_MOCK', 'OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.env.NODE_ENV = 'test';
  process.env.HARBOUR_DISABLE_AI_MOCK = '1';
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_FREE_TIER_KEY = 'free-tier-test-key';
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

// ─── run-summary ─────────────────────────────────────────────────────────────

describe('run-summary endpoint', () => {
  test('404 when the loop is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('409 for a non-terminal (active) run', async () => {
    const router = makeRouter({ 'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-live' } });
    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.jsonBody.agentState, 'queued');
  });

  test('a [done]-marker run is summarisable (effective-terminal), not 409', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const router = makeRouter({ 'ws-a': { history: [markerDoneItem('m9', 'LIN-7')], live: [], agentStatus: [] } });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'm9' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET ?cachedOnly returns 204 on a cache miss (no generation)', async () => {
    const router = makeRouter({ 'ws-a': { history: [historyItem('a-hist', 'LIN-2')], live: [], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-hist' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  });

  test('LIN-3658: a free-tier denial is a 429 with the exact error + freeTier body (key order)', async () => {
    await withFreeTierRealPathEnv(async () => {
      const calls = [];
      const freeTierStore = { async tryUse(urlKey) { calls.push(urlKey); return DENIED_RECORD; } };
      const router = makeRouter(
        { 'ws-a': { history: [historyItem('a-hist', 'LIN-2')], live: [], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] } },
        { freeTierStore }
      );
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-hist' } });
      await handler(req, res);
      assert.equal(res.statusCode, 429);
      assert.equal(JSON.stringify(res.jsonBody), DENIED_429_BODY);
      assert.deepEqual(calls, ['ws-a'], 'the gate charged the store once for the workspace');
    });
  });

  test('test-mode returns and caches a deterministic summary for a terminal run', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemoryRunSummaryCacheStore();
      const router = makeRouter(
        { 'ws-a': { history: [historyItem('a-hist', 'LIN-2')], live: [], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] } },
        { runSummaryCacheStore: cache }
      );
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-hist' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
      assert.match(res.jsonBody.summary.outcome, /LIN-2/);
      // Cached for next time.
      const cached = await cache.get('ws-a', 'a-hist');
      assert.ok(cached, 'summary is cached');
      assert.deepEqual(cached.summary, res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// ─── buildTestSummary (pure) ─────────────────────────────────────────────────

describe('buildTestSummary', () => {
  test('reports completion and folds in summary + feedback', () => {
    const s = buildTestSummary({ issueIdentifier: 'LIN-5', iteration: 3, agentState: 'complete', stage: 'review', agentSummary: 'looked good', feedback: [{ message: 'a' }] });
    assert.match(s.outcome, /LIN-5/);
    assert.match(s.outcome, /completed/);
    assert.ok(s.whatHappened.length >= 1);
    assert.deepEqual(s.blockers, []);
  });

  test('flags an error run as a blocker', () => {
    const s = buildTestSummary({ issueIdentifier: 'LIN-6', iteration: 1, agentState: 'error', feedback: [] });
    assert.match(s.outcome, /error/);
    assert.equal(s.blockers.length, 1);
  });
});

// ─── deriveSessionStatus (LIN-749) ───────────────────────────────────────────

describe('deriveSessionStatus', () => {
  test('stale wins first (a stale session is never terminal)', () => {
    assert.equal(deriveSessionStatus({ terminal: false, stale: true, hasError: true }), 'stale');
  });

  test('a non-terminal, non-stale session is in-progress', () => {
    assert.equal(deriveSessionStatus({ terminal: false, stale: false, hasError: false }), 'in-progress');
  });

  test('a clean terminal session is done', () => {
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: false }), 'done');
  });

  test('a terminal session with an errored run is error when the task is not done', () => {
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: true }), 'error');
  });

  test('a terminal+errored session whose task is now done is done-with-warning', () => {
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: true, taskDone: true }), 'done-with-warning');
  });

  test('taskDone is inert without an error (a clean done stays done)', () => {
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: false, taskDone: true }), 'done');
  });

  test('taskDone defaults to false (the per-poll feed never supplies it)', () => {
    // The cost-contract call site omits taskDone entirely; it must degrade to error.
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: true }), 'error');
  });

  // ── waiting (LIN-1005) ──────────────────────────────────────────────────────
  test('a non-terminal waiting session is waiting', () => {
    assert.equal(deriveSessionStatus({ terminal: false, stale: false, hasError: false, waiting: true }), 'waiting');
  });

  test('waiting defaults to false (existing call sites stay in-progress)', () => {
    assert.equal(deriveSessionStatus({ terminal: false, stale: false, hasError: false }), 'in-progress');
  });

  test('terminal wins over waiting (a finished session is never waiting)', () => {
    // [blocked] is non-terminal, but if the session is actually terminal, done wins.
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: false, waiting: true }), 'done');
    assert.equal(deriveSessionStatus({ terminal: true, stale: false, hasError: true, waiting: true }), 'error');
  });

  test('stale wins over waiting (a day-dead session is not shown as waiting)', () => {
    assert.equal(deriveSessionStatus({ terminal: false, stale: true, hasError: false, waiting: true }), 'stale');
  });
});

// ─── session-summary ─────────────────────────────────────────────────────────

describe('session-summary endpoint', () => {
  // A terminal session: completed autopilot anchor + one completed worker.
  function terminalSessionWorkspace() {
    return {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100'), workerHistoryItem('w-1', 'LIN-101', 'sess-1')],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100'), agentStatusDone('w-1', 'LIN-101')]
      }
    };
  }

  test('404 when the session is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  // LIN-632: the summary lookup reuses the same read-model point-read as
  // session-context. Empty stores → reconstruction would 404; the read-model hit
  // serves it, proving the by-id lookup skipped the full workspace rebuild.
  test('finds the session via the read-model point-read, skipping reconstruction (LIN-632)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const session = {
        sessionId: 'sess-1', seedIssue: 'LIN-100', tasksTouched: ['LIN-100', 'LIN-101'],
        dispatchedAt: NOW_ISO, completedAt: NOW_ISO,
        loops: [{ loopId: 'sess-1', kind: 'autopilot', issueIdentifier: 'LIN-100', agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: NOW_ISO }]
      };
      let getCalls = 0;
      const observationSessionsStore = { async getSession() { getCalls++; return session; } };
      const cache = new InMemorySessionSummaryCacheStore();
      const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } }, { sessionSummaryCacheStore: cache, observationSessionsStore });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await handler(req, res);

      assert.equal(getCalls, 1, 'read-model point-read used for the summary lookup');
      assert.equal(res.statusCode, 200, 'served despite empty stores → no reconstruction');
      assert.equal(res.jsonBody.live, false, 'terminal session was summarised');
      assert.match(res.jsonBody.summary.outcome, /sess-1/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('LIN-3658: a free-tier denial is a 429 with the exact error + freeTier body (key order)', async () => {
    await withFreeTierRealPathEnv(async () => {
      const calls = [];
      const freeTierStore = { async tryUse(urlKey) { calls.push(urlKey); return DENIED_RECORD; } };
      const router = makeRouter(terminalSessionWorkspace(), { freeTierStore });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await handler(req, res);
      assert.equal(res.statusCode, 429);
      assert.equal(JSON.stringify(res.jsonBody), DENIED_429_BODY);
      assert.deepEqual(calls, ['ws-a'], 'the gate charged the store once for the workspace');
    });
  });

  test('test-mode returns and caches a deterministic rollup for a terminal session', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemorySessionSummaryCacheStore();
      const router = makeRouter(terminalSessionWorkspace(), { sessionSummaryCacheStore: cache });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
      assert.equal(res.jsonBody.live, false);
      assert.match(res.jsonBody.summary.outcome, /sess-1/);
      assert.match(res.jsonBody.summary.statusLine, /task/);
      // Highlights name the tasks touched (seed first).
      assert.ok(res.jsonBody.summary.highlights.some(h => /LIN-100/.test(h)));
      // Cached for next time.
      const cached = await cache.get('ws-a', 'sess-1');
      assert.ok(cached, 'session summary is cached');
      assert.deepEqual(cached.summary, res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET returns the cached rollup on a hit (no regeneration)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemorySessionSummaryCacheStore();
      const router = makeRouter(terminalSessionWorkspace(), { sessionSummaryCacheStore: cache });
      const post = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const r1 = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await post(r1.req, r1.res);
      const get = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const r2 = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await get(r2.req, r2.res);
      assert.equal(r2.res.statusCode, 200);
      assert.equal(r2.res.jsonBody.status, 'cached');
      assert.deepEqual(r2.res.jsonBody.summary, r1.res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET ?cachedOnly returns 204 on a cache miss (no generation)', async () => {
    const router = makeRouter(terminalSessionWorkspace());
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  });

  test('a live session is not cached and returns the latest-completed-child statusLine proxy', async () => {
    // Live anchor (queued) + one completed worker child with a cached run-summary.
    const runCache = new InMemoryRunSummaryCacheStore();
    await runCache.put('ws-a', 'w-1', { inputHash: 'x', summary: { outcome: 'Implemented LIN-101 and opened a PR', whatHappened: [], blockers: [], next: '' }, model: 'm' });
    const sessCache = new InMemorySessionSummaryCacheStore();
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-2', 'LIN-200')],
        history: [workerHistoryItem('w-1', 'LIN-101', 'sess-2')],
        agentStatus: [agentStatusDone('w-1', 'LIN-101')]
      }
    };
    const router = makeRouter(perWorkspace, { runSummaryCacheStore: runCache, sessionSummaryCacheStore: sessCache });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-2' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.status, 'live');
    assert.equal(res.jsonBody.live, true);
    assert.equal(res.jsonBody.summary.outcome, '', 'no outcome is asserted for a live session');
    assert.match(res.jsonBody.summary.statusLine, /Implemented LIN-101/);
    assert.equal(res.jsonBody.statusLineSource, 'latest-completed-child');
    assert.equal(res.jsonBody.statusLineLoopId, 'w-1');
    // Nothing was cached for the live session.
    assert.equal(await sessCache.get('ws-a', 'sess-2'), null);
  });

  test('a live session with only a RUNNING child surfaces that child\'s live summary (Bug 2)', async () => {
    // Regression for "tasks in progress don't get summaries" (LIN-608): before the
    // fix, liveStatusLine filtered to terminal children only, so a session whose
    // latest child is still running returned an empty status line forever (the UI
    // showed a permanent "◐ working…"). It must now fall back to the running
    // child's own agentSummary — deterministically, no LLM call.
    const runningWorker = { id: 'as-w-run', dispatchId: 'w-run', taskIdentifier: 'LIN-801', action: 'implementation', status: 'working', summary: 'Refactoring the parser', timestamp: NOW_ISO };
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-live', 'LIN-800')],
        history: [workerHistoryItem('w-run', 'LIN-801', 'sess-live')],
        agentStatus: [runningWorker]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-live' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.status, 'live');
    assert.equal(res.jsonBody.live, true);
    assert.match(res.jsonBody.summary.statusLine, /Refactoring the parser/, 'running child summary is surfaced');
    assert.equal(res.jsonBody.statusLineLoopId, 'w-run');
  });
});

// ─── session-context ───────────────────────────────────────────────────────────

describe('session-context endpoint', () => {
  // Same terminal session as session-summary: autopilot anchor 'sess-1' on LIN-100
  // (seed) + worker 'w-1' on LIN-101. So tasksTouched = [LIN-100, LIN-101].
  function terminalSessionWorkspace() {
    return {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100'), workerHistoryItem('w-1', 'LIN-101', 'sess-1')],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100'), agentStatusDone('w-1', 'LIN-101')]
      }
    };
  }

  // An issue set where LIN-101 is a breakdown child of the seed LIN-100, created
  // in the run window (createdAt === dispatchedAt = NOW_ISO) → spun-off.
  function issueSet() {
    const mk = (id, identifier, parentIdent, createdAt) => ({
      id, identifier, title: `Title ${identifier}`, url: `https://x/${identifier}`,
      state: { name: 'In Progress', type: 'started' },
      parent: parentIdent ? { id: parentIdent } : null,
      createdAt,
      relations: { nodes: [] }, inverseRelations: { nodes: [] }
    });
    return [
      mk('LIN-100', 'LIN-100', null, '2020-01-01T00:00:00.000Z'),     // seed, pre-existing
      mk('LIN-101', 'LIN-101', 'LIN-100', NOW_ISO)                    // spun-off in window
    ];
  }

  test('404 when the session is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } }, { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('returns a provenance-tagged session graph for the touched tasks', async () => {
    const router = makeRouter(terminalSessionWorkspace(), { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.sessionId, 'sess-1');
    assert.equal(body.seedIssue, 'LIN-100');
    assert.deepEqual(body.tasksTouched, ['LIN-100', 'LIN-101']);
    // The graph carries one node per touched task, seed first, each tagged.
    const tags = Object.fromEntries(body.graph.tasks.map(t => [t.root.identifier, t.provenance]));
    assert.equal(tags['LIN-100'], 'seed');
    assert.equal(tags['LIN-101'], 'spun-off', 'breakdown child created in-window is spun-off');
    // LIN-101's neighborhood shows its parent is the seed (parent/children edge).
    const child = body.graph.tasks.find(t => t.root.identifier === 'LIN-101');
    assert.equal(child.parent.identifier, 'LIN-100');
  });

  // LIN-2934 (S6): `pointReadSession` (this endpoint's issue-scoped point-read,
  // used whenever `observationSessionsStore` misses/is absent) must build a
  // GENERAL run's session with the SAME anchor-aware construction as the feed
  // (`getSessionsForIssues`'s `extraItems`) — not the old orphan shape, which
  // silently dropped the anchor row entirely because it carries no
  // `issueIdentifier` for the per-issue queries to find. The anchor's own
  // completion time is LATER than its worker's, so `window.completedAt`
  // (session-level completion = the LATEST terminal loop, but only once EVERY
  // loop is terminal) is the observable proof: the orphan build never even
  // sees the anchor loop, so it reads the worker's own (earlier) completion.
  //
  // Uses `scopedStore` (defined below), whose listItems/listHistory actually
  // FILTER by `issueIdentifier`/`sessionId` like the real store — the generic
  // `makeRouter`/`makeStores` mock returns every row regardless of query
  // options, which would let the anchor leak in even without `extraItems` and
  // mask exactly the bug this test exists to catch.
  test('a GENERAL (goal-only) session point-read includes the anchor loop, not the old orphan shape', async () => {
    const anchorDispatch = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const workerDispatch = new Date(Date.now() - 50 * 60 * 1000).toISOString();
    const workerResolve = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const anchorResolve = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // later than the worker's own completion
    const stores = scopedStore({
      live: [],
      history: [
        {
          id: 'sess-g6', kind: 'autopilot', issueIdentifier: null, issueTitle: 'Goal-only run',
          promptName: 'autopilot', prompt: 'p', dispatchedAt: anchorDispatch, resolvedAt: anchorResolve,
          status: 'taken', feedback: [{ message: '[done] wound down', timestamp: anchorResolve }]
        },
        {
          id: 'w-g6', sessionId: 'sess-g6', issueIdentifier: 'LIN-600', issueTitle: 'Title LIN-600',
          promptName: 'implementation', prompt: 'p', dispatchedAt: workerDispatch, resolvedAt: workerResolve,
          status: 'taken', feedback: [{ message: '[done] shipped', timestamp: workerResolve }]
        }
      ],
      agentStatus: [agentStatusDone('w-g6', 'LIN-600', workerResolve)]
    });
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-g6' } });
    await handler(req, res);

    assert.equal(res.statusCode, 200, 'the general-run session must be found at all, not 404');
    assert.equal(res.jsonBody.seedIssue, null, 'sanity: this really is a general (unscoped) run');
    assert.deepEqual(res.jsonBody.tasksTouched, ['LIN-600']);
    assert.equal(res.jsonBody.window.completedAt, anchorResolve, 'the anchor loop must be counted — the orphan build (anchor missing) would read the worker\'s own earlier completion instead');
  });

  test('400 when sessionId is missing', async () => {
    const router = makeRouter(terminalSessionWorkspace(), { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: {} });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  // LIN-632: when the read-model has the session, the route serves it WITHOUT the
  // full 30-day workspace reconstruction. Proven by leaving the dispatch/status
  // stores EMPTY — reconstruction would 404, the read-model hit must 200.
  test('serves from the read-model point-read, skipping workspace reconstruction (LIN-632)', async () => {
    const session = {
      sessionId: 'sess-1', seedIssue: 'LIN-100', tasksTouched: ['LIN-100', 'LIN-101'],
      dispatchedAt: NOW_ISO, completedAt: NOW_ISO, loops: []
    };
    let getCalls = 0;
    const observationSessionsStore = {
      async getSession(urlKey, sessionId) { getCalls++; return (urlKey === 'ws-a' && sessionId === 'sess-1') ? session : null; }
    };
    // EMPTY stores → any reconstruction attempt finds no session and 404s.
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } }, { issues: issueSet(), observationSessionsStore });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
    await handler(req, res);

    assert.equal(getCalls, 1, 'read-model point-read was used');
    assert.equal(res.statusCode, 200, 'served despite empty stores → no reconstruction needed');
    assert.deepEqual(res.jsonBody.tasksTouched, ['LIN-100', 'LIN-101']);
    const tags = Object.fromEntries(res.jsonBody.graph.tasks.map(t => [t.root.identifier, t.provenance]));
    assert.equal(tags['LIN-100'], 'seed');
    assert.equal(tags['LIN-101'], 'spun-off');
  });

  // LIN-632: a read-model MISS must still fall back to live reconstruction.
  test('falls back to workspace reconstruction when the read-model misses (LIN-632)', async () => {
    const observationSessionsStore = { async getSession() { return null; } };
    const router = makeRouter(terminalSessionWorkspace(), { issues: issueSet(), observationSessionsStore });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
    await handler(req, res);

    assert.equal(res.statusCode, 200, 'reconstruction backstop served the session');
    assert.deepEqual(res.jsonBody.tasksTouched, ['LIN-100', 'LIN-101']);
  });
});

// ─── Request-layer keepalive on the workspace-wide reads (LIN-615) ────────────
// The /loops and /sessions feeds (and session-context) read the whole-workspace
// loop log with no selective predicate to push down. Instead of capping the
// store read (which the truncation-footgun guard forbids), the handlers arm a
// keepalive heartbeat so a slow bounded request survives Heroku's 30s H12 router
// timeout. These tests drive a deliberately-stalled store with mocked timers and
// assert the heartbeat fires, then the real JSON body still lands.

describe('workspace-wide reads arm a keepalive heartbeat (LIN-615)', () => {
  // A res that records the flushed-heartbeat path (status/setHeader/flushHeaders/
  // write/end) as well as the fast json() path.
  function makeFlushRes() {
    return {
      statusCode: 200,
      headers: {},
      flushedHeaders: false,
      writes: [],
      endedWith: undefined,
      jsonBody: null,
      writableEnded: false,
      destroyed: false,
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; return this; },
      flushHeaders() { this.flushedHeaders = true; return this; },
      write(chunk) { this.writes.push(chunk); return true; },
      json(b) { this.jsonBody = b; return this; },
      end(b) { this.endedWith = b; this.writableEnded = true; return this; }
    };
  }

  // A dispatch store whose listHistory hangs on an externally-resolved promise,
  // so the handler stays pending until we both advance timers AND release it.
  function stallableStores() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    return {
      release: () => release(),
      stores: {
        dispatchQueueStore: {
          async listItems() { return []; },
          async listHistory() { await gate; return { items: [] }; }
        },
        agentStatusStore: { async listStatus() { return { items: [] }; } }
      }
    };
  }

  async function runStalledFeed(t, path) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { release, stores } = stallableStores();
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...stores,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', path);
    const req = { session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] }, params: {}, query: {}, protocol: 'http', get: () => 'localhost' };
    const res = makeFlushRes();

    const done = handler(req, res);
    // Past the 25s flush threshold: headers committed as 200 + JSON, no body yet.
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the slow read finished');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    // One heartbeat interval later: a single whitespace byte (JSON-safe).
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written');

    release();
    await done;

    // The real payload still lands, serialized into res.end (committed status path).
    assert.ok(res.endedWith, 'final JSON body delivered via res.end after the heartbeat');
    return JSON.parse(res.endedWith);
  }

  test('/api/dashboard/loops arms keepalive and still returns the feed', async (t) => {
    const body = await runStalledFeed(t, '/workspace/:urlKey/api/dashboard/loops');
    assert.ok(Array.isArray(body.active) && Array.isArray(body.recent));
    assert.ok(body.counts && typeof body.counts.total === 'number');
  });

  test('/api/dashboard/sessions arms keepalive and still returns the feed', async (t) => {
    const body = await runStalledFeed(t, '/workspace/:urlKey/api/dashboard/sessions');
    assert.ok(Array.isArray(body.active) && Array.isArray(body.recent));
    assert.ok(body.counts && typeof body.counts.total === 'number');
  });
});

// ─── buildTestSessionSummary (pure) ───────────────────────────────────────────

describe('buildTestSessionSummary', () => {
  test('rolls tasks into a present-tense status line and highlights', () => {
    const s = buildTestSessionSummary({ sessionId: 'sess-9', tasksTouched: ['LIN-1', 'LIN-2'] });
    assert.match(s.outcome, /sess-9/);
    assert.match(s.outcome, /2 tasks/);
    assert.match(s.statusLine, /2 tasks/);
    assert.deepEqual(s.highlights, ['Touched LIN-1', 'Touched LIN-2']);
  });

  test('handles a single task and a missing task list', () => {
    assert.match(buildTestSessionSummary({ sessionId: 's', tasksTouched: ['LIN-1'] }).outcome, /1 task\b/);
    assert.match(buildTestSessionSummary({ sessionId: 's' }).outcome, /0 tasks/);
  });
});

// ─── Per-session page through the real route (LIN-1003 close-out) ───────────────
// Drives the REAL route handler end-to-end for a session whose worker loop carries an issue UUID. LIN-4537 retired the
// brief/recap cache join this block was written to pin; it now pins that the page draws none, and the anchor title.
describe('GET /observation/session/:sessionId — the page through the route (LIN-1003)', () => {
  const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';

  // A worker carrying the issue UUID (pipeline-loops copies item.issueId →
  // loop.issueId, pipeline-loops.js:324) + a [done] marker → terminal session.
  function workerWithUuid(id, identifier, sessionId, issueId) {
    return { id, sessionId, issueId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] shipped it', timestamp: NOW_ISO }] };
  }

  function makeSessionRouter() {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-ctx', 'LIN-900'), workerWithUuid('w-ctx', 'LIN-901', 'sess-ctx', ISSUE_UUID)],
        agentStatus: [agentStatusDone('sess-ctx', 'LIN-900'), agentStatusDone('w-ctx', 'LIN-901')]
      }
    };
    const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore, agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
  }

  function driveSessionPage(router) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-ctx' }
    });
    return handler(req, res).then(() => res);
  }

  test('LIN-4537: the run page reads no brief or recap and draws no Task context section', async () => {
    const res = await driveSessionPage(makeSessionRouter());
    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.ok(html, 'the page rendered');
    assert.ok(!/sess-context-section|sess-ctx-|session-(?:brief|recap)/.test(html), 'no brief/recap panel or Task context');
  });

  test('LIN-1801: the anchor loop\'s issueTitle is threaded into renderSessionPage and rendered on the page', async () => {
    const router = makeSessionRouter();
    const res = await driveSessionPage(router);

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    // The anchor loop is the kind:'autopilot' loop whose loopId === sessionId
    // (autopilotHistoryItem('sess-ctx', 'LIN-900') here), carrying issueTitle
    // 'Title LIN-900' — distinct from the session's bare seedIssue 'LIN-900'.
    assert.match(html, /data-testid="session-seed-title"[^>]*>Title LIN-900</);
    assert.match(html, /data-testid="session-title"[^>]*>Title LIN-900</);
    assert.match(html, /data-testid="session-run-id"[^>]*>Run sess-ctx</);
  });
});

describe('GET /observation/session/:sessionId — stored run paragraph, read-only (LIN-3253 S3)', () => {
  function paragraphWorkspace() {
    return {
      'ws-a': {
        live: [],
        history: [
          autopilotHistoryItem('sess-para', 'LIN-3253'),
          workerHistoryItem('w-para', 'LIN-3254', 'sess-para')
        ],
        agentStatus: [agentStatusDone('sess-para', 'LIN-3253'), agentStatusDone('w-para', 'LIN-3254')]
      }
    };
  }

  function paragraphRouter(runParagraphStore) {
    const { dispatchQueueStore, agentStatusStore } = makeStores(paragraphWorkspace());
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore, agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      runParagraphStore,
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
  }

  function driveSessionPage(router) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-para' }
    });
    return handler(req, res).then(() => res);
  }

  // The store is the ONLY seam the route has. `get` serves the stored doc; `put`
  // THROWS, so any generation/write on the page path fails the test loudly.
  function trappingStore(doc) {
    return {
      gets: [],
      puts: 0,
      async get(urlKey, runId) { this.gets.push({ urlKey, runId }); return doc; },
      async put() { this.puts++; throw new Error('the run-page route must never generate or write the paragraph'); }
    };
  }

  test('a miss renders the empty, hidden slot and never writes (no generation)', async () => {
    const store = trappingStore(null);
    const res = await driveSessionPage(paragraphRouter(store));

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.deepEqual(store.gets, [{ urlKey: 'ws-a', runId: 'sess-para' }], 'one read for this urlKey:runId');
    assert.equal(store.puts, 0, 'a miss writes nothing');
    assert.match(html, /data-testid="session-paragraph"[^>]*aria-hidden="true"/, 'empty slot stays hidden');
    assert.ok(!html.includes('session-paragraph-text'), 'no paragraph text on a miss');
  });

  test('a hit renders the stored paragraph text and still writes nothing', async () => {
    const store = trappingStore({ inputHash: 'current', paragraph: 'STORED-PARA-BODY', model: 'small-tier', final: false });
    const res = await driveSessionPage(paragraphRouter(store));

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.equal(store.puts, 0, 'a hit still never writes');
    assert.ok(html.includes('data-testid="session-paragraph-text"'), 'the paragraph slot rendered text');
    assert.ok(html.includes('STORED-PARA-BODY'), 'the stored paragraph text is on the page');
    assert.ok(!html.includes('aria-hidden="true" data-testid="session-paragraph-text"'), 'the filled slot is not hidden');
  });

  test('a hit HTML-escapes the stored paragraph so model text cannot inject (review MRt3 / L2)', async () => {
    const store = trappingStore({ inputHash: 'current', paragraph: '<b>x</b>', model: 'small-tier', final: false });
    const res = await driveSessionPage(paragraphRouter(store));

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), 'the stored paragraph text is HTML-escaped on the page');
    assert.ok(!html.includes('<b>x</b>'), 'the raw model HTML must not be injected');
  });

  test('a stale hit renders the stored paragraph and never regenerates', async () => {
    // The stored inputHash differs from what the live view would hash — the route
    // is READ ONLY, so it serves the stored paragraph rather than generating.
    const store = trappingStore({ inputHash: 'STALE-HASH', paragraph: 'STALE-PARA-BODY', model: 'small-tier', final: false });
    const res = await driveSessionPage(paragraphRouter(store));

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.equal(store.puts, 0, 'a stale hit regenerates nothing');
    assert.ok(html.includes('STALE-PARA-BODY'), 'the stored (stale) paragraph is served');
  });

  test('the run-page route module never imports or calls the generator', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../routes/dashboard.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /run-paragraph(?:-hook)?\.js/, 'no generator/hook module import in the route');
    assert.doesNotMatch(src, /generateRunParagraph/, 'no generator call in the route');
  });
});

describe('GET /observation/session/:sessionId — waiting banner clears after a reply (LIN-1341 RC2)', () => {
  test('a reply after a [blocked] worker clears the session-page waiting banner', async () => {
    // Same scenario as the feed-level RC2 test, driven through the per-session
    // page instead — `deriveSessionWaiting` is the single shared truth for both
    // surfaces (routes/dashboard.js), so this pins that the fix composes there too.
    const blockedWorker = {
      id: 'w-sp', sessionId: 'sess-sp', issueIdentifier: 'LIN-461', issueTitle: 'Blocked worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [{ message: '[blocked] need your decision', timestamp: NOW_ISO }]
    };
    const REPLY_TS = new Date(Date.now() + 60000).toISOString();
    const replyWorker = {
      id: 'w-sp-reply', followUpTo: 'w-sp', target: 'cli', issueIdentifier: 'LIN-461', issueTitle: 'Blocked worker',
      promptName: 'implementation', prompt: 'reply', dispatchedAt: REPLY_TS, resolvedAt: REPLY_TS, status: 'taken',
      feedback: [{ message: '[done] resolved after your input', timestamp: REPLY_TS }]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-sp', 'LIN-460')], history: [blockedWorker, replyWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-sp' }
    });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const html = res.sentBody;
    assert.ok(html, 'the page rendered');
    assert.ok(!html.includes('session-waiting-banner'), 'no waiting banner once the reply cleared the block');
    assert.ok(html.includes('data-session-waiting="false"'), 'the waiting flag threaded to the client is false');
  });
});

// ─── LIN-3252 S2.7: the bare-BLOCKED card's producer routing ───────────────────
//
// A waiting loop with no DECISION row makes no ruling row, so the card's second
// source is the waiting producer loop itself. The route must thread that loop's
// own target/issue (so the follow-up resumes THAT run, not a hard-defaulted cli
// target) and its latest assistant text (the "why" fallback, since a bare
// blocker has no decisionCase).
describe('GET /observation/session/:sessionId — bare-BLOCKED card routing (LIN-3252 S2.7)', () => {
  test('threads the producer loop\'s target/issue and latest assistant text into the card', async () => {
    const blockedWorker = {
      id: 'w-bare', sessionId: 'sess-bare', target: 'web', issueIdentifier: 'LIN-461', issueId: 'uuid-461',
      issueTitle: 'Blocked worker', promptName: 'implementation', prompt: 'p',
      dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { kind: 'assistant-text', message: 'I compared the two rollout strategies and they diverge.', timestamp: NOW_ISO },
        { message: '[blocked] need your decision', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': { live: [autopilotLiveItem('sess-bare', 'LIN-460')], history: [blockedWorker], agentStatus: [] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-bare' }
    });
    await handler(req, res);

    assert.equal(res.statusCode, 200, 'the page rendered');
    const html = res.sentBody;
    assert.match(html, /data-testid="session-question-card"/, 'the bare-blocked card rendered');
    assert.match(html, /data-testid="session-question-card-question"[^>]*>\[blocked\] need your decision</);
    assert.match(html, /data-testid="session-question-card-why-chunk"[^>]*>I compared the two rollout strategies and they diverge\.</, 'why falls back to the latest assistant text');
    assert.match(html, /data-testid="session-question-card"[^>]*data-loop-id="w-bare"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-target="web"/, 'the producer\'s real target, not a hard-defaulted cli');
    assert.match(html, /data-testid="session-question-card"[^>]*data-issue-id="uuid-461"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-issue-identifier="LIN-461"/);
    assert.ok(!html.includes('session-question-card-dismiss'), 'no dismiss on a bare blocker');
  });
});

// ─── LIN-1021: the per-session page is issue-scoped, never a whole-workspace read ──
//
// The H12 fix. A well-formed sessionId-first session must render its non-lean
// transcript WITHOUT the route ever issuing an unscoped (no issueIdentifier / no
// sessionId) history/queue read — that unscoped read transferred the whole 30-day
// workspace's feedback and tripped Heroku's H12. This store fails loud on any such
// read, so a regression back to getSessionsForWorkspace on the happy path breaks it.
// A store that fails LOUD (records into `unscoped`) on any read lacking an
// issueIdentifier / sessionId / taskIdentifier — i.e. a whole-workspace scan.
// Shared by the LIN-1021 per-session-page test and the LIN-1022 sibling-handler
// tests below, which all assert the SAME invariant: the happy path is issue-scoped.
function scopedStore(items) {
  const unscoped = [];
  // LIN-3975: `sessionGroupId` is an indexed key too (`{urlKey, sessionGroupId}`, lib/db-indexes.js), so a group
  // read is scoped the same way a session read is.
  const scope = (arr, opts, key) => {
    if (!opts.issueIdentifier && !opts.sessionId && !opts.sessionGroupId) unscoped.push(key);
    let r = arr;
    if (opts.issueIdentifier) r = r.filter(i => i.issueIdentifier === opts.issueIdentifier);
    if (opts.sessionId) r = r.filter(i => i.sessionId === opts.sessionId);
    if (opts.sessionGroupId) r = r.filter(i => i.sessionGroupId === opts.sessionGroupId);
    return r;
  };
  let getItemStatusCalls = 0;
  const dispatchQueueStore = {
    async getItemStatus(_urlKey, id) { getItemStatusCalls++; return [...items.live, ...items.history].find(i => i.id === id) || null; },
    async listItems(_urlKey, opts = {}) { return scope(items.live, opts, 'listItems'); },
    async listHistory(_urlKey, opts = {}) { return { items: scope(items.history, opts, 'listHistory') }; }
  };
  const agentStatusStore = {
    async listStatus(_urlKey, opts = {}) {
      if (!opts.taskIdentifier) unscoped.push('listStatus');
      const r = (items.agentStatus || []).filter(s => !opts.taskIdentifier || s.taskIdentifier === opts.taskIdentifier);
      return { items: r };
    }
  };
  return { dispatchQueueStore, agentStatusStore, unscoped, get getItemStatusCalls() { return getItemStatusCalls; } };
}

describe('GET /observation/session/:sessionId — issue-scoped read, no whole-workspace scan (LIN-1021)', () => {
  test('renders the transcript via issue-scoped reads only (no unscoped whole-workspace read)', async () => {
    // Root autopilot (LIN-900, no sessionId — only reachable by id) + a worker
    // stamped sessionId, carrying the [done] transcript.
    const stores = scopedStore({
      live: [],
      history: [autopilotHistoryItem('sess-ctx', 'LIN-900'), workerHistoryItem('w-ctx', 'LIN-901', 'sess-ctx')],
      agentStatus: [agentStatusDone('sess-ctx', 'LIN-900'), agentStatusDone('w-ctx', 'LIN-901')]
    });
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-ctx' }
    });
    await handler(req, res);

    assert.equal(res.statusCode, 200, 'the page rendered');
    const html = res.sentBody;
    assert.ok(html.includes('sess-ctx'), 'the session rendered');
    assert.ok(html.includes('LIN-901'), 'the touched worker task is present (transcript reconstructed)');
    // The load-bearing LIN-1021 claim: NO unscoped whole-workspace read on the happy path.
    assert.deepEqual(stores.unscoped, [], 'no unscoped (whole-workspace) history/queue/status read');
    assert.ok(stores.getItemStatusCalls >= 1, 'the root dispatch is fetched by id (seed issue derivation)');
  });

  test('an unknown session 404s through the fallback without crashing', async () => {
    // issue-scoping yields nothing → the safety-net full read runs → still not
    // found → a clean 404 (never a 500 from the new derivation path).
    const stores = scopedStore({
      live: [],
      history: [autopilotHistoryItem('sess-real', 'LIN-900')],
      agentStatus: [agentStatusDone('sess-real', 'LIN-900')]
    });
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'nope-not-a-session' }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 404, 'unknown session 404s');
    assert.ok(stores.unscoped.length > 0, 'the full-read fallback ran (issue-scoping found nothing)');
  });
});

// ─── LIN-3260: the run page sees live runs in OTHER sessions on the same issue ─
//
// The residual named by the LIN-3252 pass-3 review (G2, mutation M5). The card's
// `liveDispatchOnAnchor` predicate must consult the workspace-wide loop set the
// rulings feed uses — the warm `sessionsFeedCache` `rulings` entry — NOT the
// session's own loops alone. The read is a NON-producing `peek`: the run page
// must never trigger a whole-workspace reconstruction (LIN-1021/H12); a cold
// cache falls back to the session's own loops.
describe('GET /observation/session/:sessionId — cross-session live anchor (LIN-3260)', () => {
  const OLD_ISO = PAST_REAP_WINDOW_ISO(); // past the 7d record reap window

  // A worker whose decision is terminal + reaped (past the reap window) — the
  // `gone` row whose answer would start a fresh run.
  function goneDecisionWorker({ id, identifier, sessionId, decisionId, ts = OLD_ISO }) {
    return {
      id, sessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
      promptName: 'implementation', prompt: 'p', dispatchedAt: ts, resolvedAt: ts, status: 'taken',
      feedback: [
        { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed?' }), timestamp: ts },
        { message: '[done] shipped it', timestamp: ts }
      ]
    };
  }

  function makeSessionPageRouter({ dispatchQueueStore, agentStatusStore, sessionsFeedCache }) {
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore,
      agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      sessionsFeedCache
    });
  }

  // The workspaces carry EXTRA fields beyond { urlKey, name }. `keyFor`
  // (lib/sessions-feed-cache.js:55-58) derives the key from `urlKey`s ONLY
  // (sorted), so the Rulings route's raw objects and the run page's mapped
  // `{ urlKey, name }` must collapse to one key — this proves it end to end.
  const SESSION = {
    ...ENABLED,
    workspaces: [{ urlKey: 'ws-a', name: 'Alpha', provider: 'linear', nwo: 'acme/widget', pinned: 42 }]
  };

  async function renderSession(router, sessionId, session = SESSION) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({ session, workspace: { urlKey: 'ws-a' }, params: { sessionId } });
    await handler(req, res);
    return res;
  }

  // Warm the SHARED cache through the REAL Rulings route — its own
  // `keyFor(req.session.workspaces, 'rulings')` producer — never a hand-rolled
  // stub, so the test exercises the actual key derivation both sides use.
  async function warmRulings(router, session = SESSION) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/rulings');
    const { req, res } = makeReqRes({ session, workspace: { urlKey: 'ws-a' } });
    await handler(req, res);
    return res;
  }

  const cardFor = (html, decisionId) =>
    (html.match(/data-testid="session-question-card"[^>]*/g) || []).find(c => c.includes(`data-decision-id="${decisionId}"`));

});

// ─── LIN-1022: the sibling :id-keyed handlers are issue-scoped too ─────────────
//
// Class check on LIN-1021 (widen the model, don't patch the witness). session-summary,
// session-context, and run-summary each reconstructed ONE record by id from the whole
// 30-day workspace (getSessionsForWorkspace / getLoopsForWorkspace) and H12'd at scale —
// session-summary?cachedOnly=1 fired one such read per Observation card, starving the
// event loop into mass H12. Each now point-reads via the same issue-scoped path the
// per-session page uses; the scopedStore fails loud on any whole-workspace read, so a
// regression back to the old reconstruct-by-id breaks these.
describe('sibling :id-keyed handlers are issue-scoped, no whole-workspace scan (LIN-1022)', () => {
  // Terminal session sess-ss (root LIN-950, only reachable by id) + a worker stamped
  // sessionId carrying LIN-951; both terminal via agentStatusDone.
  function terminalSessionItems() {
    return {
      live: [],
      history: [autopilotHistoryItem('sess-ss', 'LIN-950'), workerHistoryItem('w-ss', 'LIN-951', 'sess-ss')],
      agentStatus: [agentStatusDone('sess-ss', 'LIN-950'), agentStatusDone('w-ss', 'LIN-951')]
    };
  }

  function makeScopedRouter(stores, extra = {}) {
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      ...extra
    });
  }

  test('session-summary resolves the session via issue-scoped reads only', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const stores = scopedStore(terminalSessionItems());
      const router = makeScopedRouter(stores);
      const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-ss' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200, 'summarised the terminal session');
      assert.equal(res.jsonBody.live, false);
      assert.match(res.jsonBody.summary.outcome, /sess-ss/);
      assert.deepEqual(stores.unscoped, [], 'no unscoped (whole-workspace) read on the summary lookup');
      assert.ok(stores.getItemStatusCalls >= 1, 'the session root is fetched by id (issue derivation)');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('session-context resolves the session via issue-scoped reads only', async () => {
    const stores = scopedStore(terminalSessionItems());
    const router = makeScopedRouter(stores);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-ss' }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200, 'built the session context');
    assert.equal(res.jsonBody.sessionId, 'sess-ss');
    assert.deepEqual(stores.unscoped, [], 'no unscoped (whole-workspace) read on the context lookup');
    assert.ok(stores.getItemStatusCalls >= 1, 'the session root is fetched by id (issue derivation)');
  });

  test('run-summary resolves the run via issue-scoped reads only', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const stores = scopedStore(terminalSessionItems());
      const router = makeScopedRouter(stores);
      // POST → force generation; loopId 'w-ss' is a terminal worker run.
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'w-ss' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200, 'summarised the terminal run');
      assert.equal(res.jsonBody.loopId, 'w-ss');
      assert.deepEqual(stores.unscoped, [], 'no unscoped (whole-workspace) read on the run lookup');
      assert.ok(stores.getItemStatusCalls >= 1, 'the run is resolved to its issue by id');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  // The actual prod H12 (LIN-1022): the Observation page fires one session-summary
  // ?cachedOnly=1 peek per terminal card, INCLUDING cards for stale/expired
  // sessionIds no longer in the 30-day window. The pre-fix handler paid the whole-
  // workspace reconstruction (measured 337s on prod) on each such peek merely to 404,
  // and a page's worth of them starved the event loop into mass H12. A peek must
  // resolve cheaply or 204 — NEVER the whole-workspace read.
  test('session-summary cachedOnly peek for a stale/unresolvable session 204s WITHOUT a whole-workspace read', async () => {
    const stores = scopedStore({ live: [], history: [], agentStatus: [] });
    const router = makeScopedRouter(stores);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'stale-nonexistent' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204, 'peek miss → 204 (client leaves the generate affordance)');
    assert.deepEqual(stores.unscoped, [], 'NO whole-workspace read paid for a stale peek (the LIN-1022 H12)');
  });

  test('run-summary cachedOnly peek for a stale/unresolvable loopId 204s WITHOUT a whole-workspace read', async () => {
    const stores = scopedStore({ live: [], history: [], agentStatus: [] });
    const router = makeScopedRouter(stores);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'stale-loop' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204, 'peek miss → 204');
    assert.deepEqual(stores.unscoped, [], 'NO whole-workspace read paid for a stale run peek');
  });

  // The asymmetry: a NON-peek request (force/POST, or a GET that will spend an LLM
  // call) still pays the whole-workspace fallback — it is the only path that
  // reconstructs a genuinely inference-grouped historical session, and it is a
  // single deliberate request, not a page-load burst.
  test('a non-peek session-summary miss still pays the whole-workspace fallback (then 404s)', async () => {
    const stores = scopedStore({ live: [], history: [], agentStatus: [] });
    const router = makeScopedRouter(stores);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'stale-nonexistent' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404, 'non-peek miss → 404');
    assert.ok(stores.unscoped.length > 0, 'the whole-workspace fallback ran for the non-peek request');
  });
});

// ─── Bounded server-side feed hydration (LIN-1258, Axis B) ───────────────────
//
// The feed now hydrates the touched SEED task's live done-state for eligible
// sessions and feeds a real `taskDone` into `deriveSessionStatus`, so an errored
// terminal session whose task is Done shows `done-with-warning` on the COLLAPSED
// card without a drill-in — while honouring the no-Linear-read-per-poll contract
// via a per-poll cap and a 60s TTL cache. These tests drive the real
// `/api/dashboard/sessions` handler with a COUNTING fake `fetchIssueContext` and
// a pass-through feed cache (so the LIN-617 output cache never masks a re-poll),
// and assert the exact backend read COUNT — the falsifiable proof of the gate,
// the cap, and the cache.

describe('bounded feed hydration (LIN-1258)', () => {
  // A worker run whose [failed] marker makes its session terminal + error — the
  // sole eligibility class for a done-with-warning upgrade.
  function failWorker(id, identifier, sessionId) {
    return { id, sessionId, issueIdentifier: identifier, issueTitle: `T ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] };
  }
  // Autopilot anchor (agentStatus completed → session terminal) + a failed worker
  // ⇒ a terminal, errored session seeded on `seedIdent`.
  function errorSessionFixture(sessionId, seedIdent, workerIdent) {
    return {
      history: [autopilotHistoryItem(sessionId, seedIdent), failWorker(`${sessionId}-w`, workerIdent, sessionId)],
      agentStatus: [agentStatusDone(sessionId, seedIdent)]
    };
  }
  // Same terminal+error session, but with N failed workers so `tasksTouched` is
  // [seed, ...workerIdents] in order (worker loopIds `-w0..-wN` keep first-seen order
  // deterministic). Lets a test drive the any-touched hydration path where the Done
  // task is NOT the seed (LIN-1259, item 1).
  function multiTaskErrorSession(sessionId, seedIdent, workerIdents) {
    const history = [autopilotHistoryItem(sessionId, seedIdent)];
    workerIdents.forEach((ident, i) => history.push(failWorker(`${sessionId}-w${i}`, ident, sessionId)));
    return { history, agentStatus: [agentStatusDone(sessionId, seedIdent)] };
  }
  // Pass-through feed cache: always re-runs the producer, so a second poll really
  // re-enters mergeSessions and the read count reflects the task-done cache alone.
  function passThroughFeedCache() {
    return { keyFor: () => 'k', get: async (_k, producer) => producer() };
  }
  function hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache, taskDoneCache }) {
    const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore,
      agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext,
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      sessionsFeedCache,
      // Injected only by the cross-TTL test (LIN-1259 item 2), which drives an
      // injectable-clock cache to cross the 60s boundary; unset ⇒ the router's own
      // default cache, exactly as production runs.
      ...(taskDoneCache ? { taskDoneCache } : {})
    });
  }
  const doneCtx = { issue: { state: { name: 'Done', type: 'completed' } } };
  const notDoneCtx = { issue: { state: { name: 'In Progress', type: 'started' } } };

  async function poll(router, workspaces) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    return res.jsonBody;
  }
  function allSessions(body) {
    return [...(body.active || []), ...(body.recent || [])];
  }

  test('the eligibility gate: ONLY terminal+error sessions are hydrated (non-error / non-terminal ⇒ zero reads)', async () => {
    const perWorkspace = {
      'ws-a': {
        // Eligible: terminal + error, seed LIN-300.
        ...errorSessionFixture('sess-err', 'LIN-300', 'LIN-301'),
      },
      'ws-b': {
        // Clean terminal (done) — NOT eligible.
        history: [autopilotHistoryItem('sess-done', 'LIN-400'), workerHistoryItem('w-done', 'LIN-401', 'sess-done')],
        agentStatus: [agentStatusDone('sess-done', 'LIN-400'), agentStatusDone('w-done', 'LIN-401')]
      },
      'ws-c': {
        // Live (non-terminal) — NOT eligible.
        live: [autopilotLiveItem('sess-live', 'LIN-500')], history: [], agentStatus: []
      }
    };
    let reads = 0;
    const fetchIssueContext = async (_t, ident) => { reads++; assert.equal(ident, 'LIN-300', 'only the errored session seed is read'); return doneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });
    const workspaces = [{ urlKey: 'ws-a', name: 'A' }, { urlKey: 'ws-b', name: 'B' }, { urlKey: 'ws-c', name: 'C' }];

    const body = await poll(router, workspaces);
    assert.equal(reads, 1, 'exactly ONE read — only the terminal+error session, never the done or live one');

    const byId = Object.fromEntries(allSessions(body).map(s => [s.sessionId, s]));
    assert.equal(byId['sess-err'].status, 'done-with-warning', 'errored+done session is upgraded server-side (collapsed-card fix)');
    assert.equal(byId['sess-done'].status, 'done', 'clean terminal session unchanged, no read');
    assert.equal(byId['sess-live'].status, 'in-progress', 'live session unchanged, no read');
  });

  test('the per-poll cap: at most N=5 reads even with 6 eligible sessions; the overflow keeps taskDone=false', async () => {
    const perWorkspace = { 'ws-a': { live: [], history: [], agentStatus: [] } };
    for (let i = 1; i <= 6; i++) {
      const f = errorSessionFixture(`sess-${i}`, `LIN-${600 + i}`, `LIN-${700 + i}`);
      perWorkspace['ws-a'].history.push(...f.history);
      perWorkspace['ws-a'].agentStatus.push(...f.agentStatus);
    }
    let reads = 0;
    const fetchIssueContext = async () => { reads++; return doneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    assert.equal(reads, 5, 'the cap bounds the poll to exactly 5 backend reads regardless of eligible count');

    const statuses = allSessions(body).map(s => s.status);
    assert.equal(statuses.filter(x => x === 'done-with-warning').length, 5, 'five eligible sessions were hydrated');
    assert.equal(statuses.filter(x => x === 'error').length, 1, 'the overflow session keeps taskDone=false (still error) this poll');
  });

  test('the no-Linear-per-poll contract: a second poll within the TTL adds ZERO reads (cache hit)', async () => {
    const perWorkspace = {
      'ws-a': {
        ...errorSessionFixture('sess-1', 'LIN-810', 'LIN-811'),
      }
    };
    // Two eligible sessions in one workspace to make the count meaningful.
    const f2 = errorSessionFixture('sess-2', 'LIN-820', 'LIN-821');
    perWorkspace['ws-a'].history.push(...f2.history);
    perWorkspace['ws-a'].agentStatus.push(...f2.agentStatus);

    let reads = 0;
    const fetchIssueContext = async () => { reads++; return doneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });
    const workspaces = [{ urlKey: 'ws-a', name: 'A' }];

    const first = await poll(router, workspaces);
    assert.equal(reads, 2, 'first poll reads both eligible seed tasks once');
    assert.equal(allSessions(first).filter(s => s.status === 'done-with-warning').length, 2);

    // Second poll immediately after (well within the 60s TTL): the feed re-runs
    // mergeSessions (pass-through cache) but every task is served from the 60s
    // task-done cache — no additional backend reads.
    const second = await poll(router, workspaces);
    assert.equal(reads, 2, 'no additional Linear reads on the second poll within the TTL');
    assert.equal(allSessions(second).filter(s => s.status === 'done-with-warning').length, 2, 'the upgrade still shows on the re-poll');
  });

  test('buildSessionPayload back-compat: an errored session with NO done touched task stays "error" (default-false path unchanged)', async () => {
    const perWorkspace = { 'ws-a': { ...errorSessionFixture('sess-1', 'LIN-900', 'LIN-901') } };
    let reads = 0;
    const fetchIssueContext = async () => { reads++; return notDoneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    // Any-touched hydration (LIN-1259): with no Done task to short-circuit on, the
    // feed now reads BOTH touched tasks (seed LIN-900 + worker LIN-901) before it can
    // conclude not-done — the cost the read-based cap exists to bound. Seed-only
    // hydration (LIN-1258) read just one; the extra read is the multi-task any-touched
    // coverage, not a regression.
    assert.equal(reads, 2, 'both touched tasks are read when neither is Done (no short-circuit)');
    const s = allSessions(body).find(x => x.sessionId === 'sess-1');
    assert.equal(s.status, 'error', 'no touched task done ⇒ status byte-identical to the pre-hydration feed');
  });

  test('a hydration read that throws never breaks the feed (session degrades to error, not a 500)', async () => {
    const perWorkspace = { 'ws-a': { ...errorSessionFixture('sess-1', 'LIN-950', 'LIN-951') } };
    const fetchIssueContext = async () => { throw new Error('backend down'); };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    const s = allSessions(body).find(x => x.sessionId === 'sess-1');
    assert.ok(s, 'the feed still renders the session');
    assert.equal(s.status, 'error', 'a hydration miss leaves the Mongo-sourced status untouched');
  });

  // ─── LIN-1259: any-touched-task hydration + read-based cap hardening ──────────
  //
  // The primary follow-up: the server feed must upgrade an errored session when ANY
  // touched task is Done, not just the seed (tasksTouched[0]) — matching the client's
  // any-touched `ensureHydration` OR. Before the fix a multi-task session whose seed
  // is NOT done but a later touched task IS shows `error` on the collapsed feed card
  // yet `done-with-warning` on drill-in: the exact feed-vs-drill-in disagreement.

  test('any-touched (primary): a non-seed touched task being Done upgrades the collapsed card (feed matches drill-in)', async () => {
    // tasksTouched = [LIN-100 (seed, NOT done), LIN-101, LIN-102 (Done)].
    const perWorkspace = { 'ws-a': { ...multiTaskErrorSession('sess-1', 'LIN-100', ['LIN-101', 'LIN-102']) } };
    const reads = [];
    const doneByIdent = { 'LIN-102': true };
    const fetchIssueContext = async (_t, ident) => { reads.push(ident); return doneByIdent[ident] ? doneCtx : notDoneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    const s = allSessions(body).find(x => x.sessionId === 'sess-1');
    assert.equal(s.status, 'done-with-warning', 'a Done NON-seed touched task upgrades the feed card (seed-only would have left it error)');
    // Reads walk touched order and short-circuit ON the Done task — no read past it.
    assert.deepEqual(reads, ['LIN-100', 'LIN-101', 'LIN-102'], 'reads seed→touched order and stops at the first Done task');
  });

  test('short-circuit: the seed being Done costs exactly ONE read even for a many-task session', async () => {
    const perWorkspace = { 'ws-a': { ...multiTaskErrorSession('sess-1', 'LIN-200', ['LIN-201', 'LIN-202', 'LIN-203']) } };
    let reads = 0;
    // Every task would report Done, but the seed is read first and short-circuits.
    const fetchIssueContext = async () => { reads++; return doneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    assert.equal(reads, 1, 'the common case (seed is the done task) stays a single read regardless of touched count');
    assert.equal(allSessions(body).find(x => x.sessionId === 'sess-1').status, 'done-with-warning');
  });

  test('cap = READS not sessions: a single multi-task session is bounded to N=5 reads and defers the rest', async () => {
    // ONE eligible session with 7 touched tasks, NONE done. Under seed-only (LIN-1258)
    // this cost 1 read; any-touched would cost 7 — the read-based cap (LIN-1259) bounds
    // it to 5 this poll, proving the cap counts reads, not sessions (a per-session cap
    // of 5 would have let all 7 through).
    const workers = ['LIN-301', 'LIN-302', 'LIN-303', 'LIN-304', 'LIN-305', 'LIN-306'];
    const perWorkspace = { 'ws-a': { ...multiTaskErrorSession('sess-1', 'LIN-300', workers) } };
    let reads = 0;
    const fetchIssueContext = async () => { reads++; return notDoneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache() });

    const body = await poll(router, [{ urlKey: 'ws-a', name: 'A' }]);
    assert.equal(reads, 5, 'a single session cannot exceed the N=5 per-poll READ budget');
    assert.equal(allSessions(body).find(x => x.sessionId === 'sess-1').status, 'error', 'no Done found within budget ⇒ stays error, fills in on a later poll');
  });

  // ─── LIN-1259 item 2: cross-TTL overflow flicker (hardening — documented) ─────
  //
  // The resolved `done-with-warning` is NOT persisted per session; it is recomputed
  // each poll from the 60s task-done cache. When a resolved card's cache entry EXPIRES
  // and that same poll has more errored-terminal cache-misses than the read cap, the
  // card can be deferred past the cap and briefly re-render `error` until re-read on a
  // later poll (the client `warnedSessions` fallback only rescues it if the user had
  // drilled in). This is a known, low-probability, SELF-HEALING limitation (Done is
  // sticky). Per LIN-1259 we harden by DOCUMENTING it with a direct cross-TTL
  // regression test rather than adding a sticky-resolved marker (kept out of scope to
  // avoid unbounded per-session server memory for a rare cosmetic flicker). This test
  // drives the boundary directly via an injectable-clock cache.

  test('cross-TTL overflow: a resolved card whose cache expired flickers to error when the poll overflows the read cap, then self-heals', async () => {
    let clock = 1_000_000;
    const cache = createTaskDoneCache({ ttlMs: 60_000, now: () => clock });

    // sess-keep: a single-task session, seed Done — resolves on poll 1 and caches.
    // sess-1..6: six MORE single-task errored sessions, all Done, that only become
    // eligible on poll 2 (added below). Six fresh misses > cap 5 ⇒ on poll 2, after
    // sess-keep's entry has expired, it competes for the read budget and can lose.
    const perWorkspace = { 'ws-a': { ...errorSessionFixture('sess-keep', 'LIN-500', 'LIN-599') } };
    let reads = 0;
    const fetchIssueContext = async () => { reads++; return doneCtx; };
    const router = hydrationRouter(perWorkspace, { fetchIssueContext, sessionsFeedCache: passThroughFeedCache(), taskDoneCache: cache });
    const workspaces = [{ urlKey: 'ws-a', name: 'A' }];

    // Poll 1: sess-keep is read (seed LIN-500 Done) and upgraded; its done-state cached.
    const p1 = await poll(router, workspaces);
    assert.equal(allSessions(p1).find(s => s.sessionId === 'sess-keep').status, 'done-with-warning', 'poll 1 resolves sess-keep');
    const readsAfterP1 = reads;

    // Advance the clock PAST the 60s TTL so sess-keep's cached entry expires, and add
    // six fresh single-task eligible sessions whose seeds sort BEFORE LIN-500, so they
    // consume the whole 5-read budget first and defer sess-keep this poll.
    clock += 61_000;
    for (let i = 1; i <= 6; i++) {
      const f = errorSessionFixture(`sess-${i}`, `LIN-40${i}`, `LIN-45${i}`);
      perWorkspace['ws-a'].history.push(...f.history);
      perWorkspace['ws-a'].agentStatus.push(...f.agentStatus);
    }

    // Poll 2: 7 eligible, all cache-expired/fresh ⇒ 7 misses, cap = 5 reads. The six
    // LIN-40x sessions (ordered first) consume the budget; sess-keep is deferred and
    // re-renders `error` — the documented cross-TTL flicker.
    const p2 = await poll(router, workspaces);
    assert.equal(reads - readsAfterP1, 5, 'poll 2 is still hard-bounded to 5 reads across the 7 eligible sessions');
    assert.equal(allSessions(p2).find(s => s.sessionId === 'sess-keep').status, 'error', 'the resolved card flickers back to error under cache-expiry + cap overflow (known limitation)');

    // Poll 3 (same instant, within TTL of poll 2's reads): the six LIN-40x are now
    // cached, so sess-keep is the only miss and is re-read → self-heals. Proves the
    // flicker is transient, not a stuck state.
    const p3 = await poll(router, workspaces);
    assert.equal(allSessions(p3).find(s => s.sessionId === 'sess-keep').status, 'done-with-warning', 'the flicker self-heals on the next poll once the overflow sessions are cached');
  });
});

describe('GET /workspace/:urlKey/observation — async try/catch (LIN-2706 §B.1; the scan estimate retired with the scan, LIN-4540)', () => {
  function makeObservationRouter({ renderObservationPage } = {}) {
    const { dispatchQueueStore, agentStatusStore } = makeStores({});
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore,
      agentStatusStore,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      ...(renderObservationPage ? { renderObservationPage } : {})
    });
  }

  test('the page renders, and its embedded data carries no scan estimate (LIN-4540)', async () => {
    const router = makeObservationRouter();
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation');
    const { req, res } = makeReqRes({
      session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a', name: 'Alpha' }
    });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const data = extractEmbeddedData(res.sentBody, '__OBSERVATION_DATA__');
    assert.ok(!('scanCostEstimate' in data), 'the Scan-due tab and its estimate are gone');
  });

  test('a throwing renderObservationPage (stubbed) yields a 500 rather than a hung request (F1)', async () => {
    // Express ^4.18.2 never awaits a route handler's promise, so without a
    // handler-level try/catch this would surface only as an unhandled
    // rejection — the process survives but no response is ever sent. The
    // request would hang forever rather than 500ing, which this test cannot
    // observe directly (there is no timeout to assert against); asserting the
    // 500 IS the proof the try/catch actually wraps the render call.
    const router = makeObservationRouter({
      renderObservationPage: () => { throw new Error('render exploded'); }
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation');
    const { req, res } = makeReqRes({
      session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a', name: 'Alpha' }
    });
    await handler(req, res);

    assert.equal(res.statusCode, 500);
    assert.match(res.sentBody, /Failed to render the Observation page/);
    assert.match(res.sentBody, /<h1[^>]*>Harbour<\/h1>/, 'the one Harbour error page');
  });
});

// ─── Widened hydrate route — neighborhood (LIN-2775 Area 6) ────────────────
//
// GET /workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier is the
// only production caller-tested route this ticket touches directly (the
// client's only caller, ensureHydration in public/observation.js, reads only
// hydrated/state/labels/url — the new field is additive to it with zero
// compatibility handling needed).
describe('GET /api/dashboard/hydrate/:wsUrlKey/:identifier — widened neighborhood (LIN-2775 Area 6)', () => {
  const NO_OP_STORES = {
    dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
    agentStatusStore: { async listStatus() { return { items: [] }; } }
  };

  function makeHydrateRouter({ fetchIssueContext, getWorkspaceAccessToken } = {}) {
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...NO_OP_STORES,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: getWorkspaceAccessToken || (async () => 'token'),
      fetchIssueContext: fetchIssueContext || (async () => ({})),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
  }

  function callHydrate(router, { wsUrlKey = 'ws-a', identifier = 'LIN-1' } = {}) {
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier');
    const { req, res } = makeReqRes({
      session: { workspaces: [{ urlKey: wsUrlKey, name: 'Alpha' }] },
      params: { wsUrlKey, identifier }
    });
    return handler(req, res).then(() => res);
  }

  test('the response gains neighborhood: {parent, siblings, children, cousins}, additive alongside the existing fields', async () => {
    let contextCalls = 0;
    const context = {
      issue: { state: { name: 'In Progress', type: 'started' }, labels: { nodes: [{ name: 'bug' }] }, url: 'https://example.test/LIN-1' },
      parent: { id: 'id-parent', identifier: 'LIN-PARENT', title: 'Parent', state: { name: 'Todo', type: 'unstarted' } },
      siblings: [{ id: 'id-sib', identifier: 'LIN-SIB', title: 'Sib', state: { name: 'In Progress', type: 'started' }, labels: { nodes: [] }, inverseRelations: { nodes: [] } }],
      children: [{ id: 'id-child', identifier: 'LIN-CHILD', title: 'Child', state: { name: 'Done', type: 'completed' }, updatedAt: '2026-01-01', labels: { nodes: [] } }],
      cousins: [{ id: 'id-cousin', identifier: 'LIN-COUSIN', title: 'Cousin', state: { name: 'Todo', type: 'unstarted' } }]
    };
    const router = makeHydrateRouter({ fetchIssueContext: async () => { contextCalls += 1; return context; } });

    const res = await callHydrate(router);

    assert.equal(res.statusCode, 200);
    // Existing fields, byte-identical to before this Area.
    assert.equal(res.jsonBody.hydrated, true);
    assert.deepEqual(res.jsonBody.state, { name: 'In Progress', type: 'started' });
    assert.deepEqual(res.jsonBody.labels, ['bug']);
    assert.equal(res.jsonBody.url, 'https://example.test/LIN-1');
    // New field.
    assert.deepEqual(res.jsonBody.neighborhood.parent, { id: 'id-parent', identifier: 'LIN-PARENT', title: 'Parent', state: { name: 'Todo', type: 'unstarted' } });
    assert.deepEqual(res.jsonBody.neighborhood.siblings, [{ id: 'id-sib', identifier: 'LIN-SIB', title: 'Sib', state: { name: 'In Progress', type: 'started' } }]);
    assert.deepEqual(res.jsonBody.neighborhood.children, [{ id: 'id-child', identifier: 'LIN-CHILD', title: 'Child', state: { name: 'Done', type: 'completed' } }]);
    assert.deepEqual(res.jsonBody.neighborhood.cousins, [{ id: 'id-cousin', identifier: 'LIN-COUSIN', title: 'Cousin', state: { name: 'Todo', type: 'unstarted' } }]);
    // The projection drops fields a membership/terminality check has no use
    // for (labels/inverseRelations/etc on the raw sibling/child GraphQL nodes) —
    // pinned by the deepEqual above matching the small shape exactly, not a
    // superset.
    assert.equal(contextCalls, 1, 'no second provider read — one fetchIssueContext call resolves both neighbourhood membership and target terminality');
  });

  test('a parent-less issue (top-level) gets neighborhood.parent: null, siblings/children/cousins: []', async () => {
    const router = makeHydrateRouter({ fetchIssueContext: async () => ({ issue: { state: { name: 'Todo', type: 'unstarted' } } }) });
    const res = await callHydrate(router);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody.neighborhood, { parent: null, siblings: [], children: [], cousins: [] });
  });

  test('a session that lacks wsUrlKey gets 403 and no provider read (LIN-2389)', async () => {
    let tokenCalls = 0;
    const router = makeHydrateRouter({ getWorkspaceAccessToken: async () => { tokenCalls += 1; return 'token'; } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier');
    for (const session of [{ workspaces: [{ urlKey: 'ws-other', name: 'Other' }] }, { workspaces: [] }, {}]) {
      const { req, res } = makeReqRes({ session, params: { wsUrlKey: 'ws-a', identifier: 'LIN-1' } });
      await handler(req, res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.jsonBody, { error: 'Not connected to that workspace' });
    }
    assert.equal(tokenCalls, 0);
  });

  test('no token → hydrated: false, reason: no_token — unchanged, no neighborhood field at all', async () => {
    const router = makeHydrateRouter({ getWorkspaceAccessToken: async () => null });
    const res = await callHydrate(router);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody, { hydrated: false, reason: 'no_token' });
  });

  test('fetchIssueContext throwing "not found" degrades to hydrated: false, reason: not_found — never a 500', async () => {
    const router = makeHydrateRouter({ fetchIssueContext: async () => { throw new Error('Issue not found: LIN-1'); } });
    const res = await callHydrate(router);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody, { hydrated: false, reason: 'not_found' });
  });
});

// ─── LIN-3251 (LIN-2948 S1b): live PR state, cache and upstream budget ────────
//
// The route resolves the run's PR URL through LIN-2949's run-evidence model and
// reads the live state through lib/github-pr-status.js. These tests use a
// counting fetch stub (upstream GitHub) and an
// injected clock — no sleeps, no network. They discharge condition C1.
describe('GET /api/run/:runId/pr-state (LIN-3251, C1)', () => {
  const PATH = '/workspace/:urlKey/api/run/:runId/pr-state';
  const PR_URL = 'https://github.com/acme/widget/pull/12';

  // LIN-4533: a run's PR is its task's change record, not a tracker comment (a stage run posts none). `changes` is the live
  // list of PR URLs the fake records store holds as change records for the run's ticket.
  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
  }

  // Counts every real upstream GitHub GET `fetchPrStatus` makes: the repo
  // visibility probe, the pull, the check-runs, and the commit-status reads.
  function githubStub({ state = 'open', merged = false, sha = 'abc1234', checkRuns = [{ name: 'unit', conclusion: 'success' }], counts }) {
    return async (url) => {
      counts.github += 1;
      if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return jsonResponse(200, { private: false });
      if (/\/pulls\/\d+$/.test(url)) return jsonResponse(200, { state, merged, head: { ref: 'feature', sha }, base: { ref: 'main' }, mergeable: true });
      if (/\/check-runs$/.test(url)) return jsonResponse(200, { check_runs: checkRuns });
      if (/\/status$/.test(url)) return jsonResponse(200, { statuses: [] });
      return jsonResponse(404, {});
    };
  }

  function makePrStateRouter({
    changes = [],
    comments = [],
    github = {},
    now = () => Date.now(),
    bucket,
    cache,
    loadRun,
    recordsThrow = false
  } = {}) {
    const counts = { github: 0, comments: 0 };
    // A comment is read by nothing here: the provider counts any read of it, so a test can show none was made.
    const provider = {
      async fetchIssueComments() { counts.comments += 1; return comments; }
    };
    const router = makeRouter({}, {
      recordsStore: recordsStoreOfChanges(changes, { throws: recordsThrow, ticket: 'LIN-1' }),
      prState: {
        now,
        cache: cache || new Map(),
        bucket: bucket || [],
        resolveProvider: () => ({ provider, callScope: 'scope' }),
        loadRun: loadRun || (async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] })),
        githubFetch: githubStub({ ...github, counts })
      }
    });
    return { router, counts, provider };
  }

  async function callPrState(router, runId = 'run-1') {
    const handler = getHandler(router, 'get', PATH);
    const { req, res } = makeReqRes({ workspace: { urlKey: 'ws-a' }, params: { runId } });
    await handler(req, res);
    return res;
  }

  test('two GETs within 15 min make one fetchPrStatus (4 upstream calls)', async () => {
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'open' }
    });

    const first = await callPrState(router);
    const second = await callPrState(router);

    assert.equal(first.statusCode, 200);
    assert.equal(first.jsonBody.state, 'open');
    assert.equal(first.jsonBody.number, 12);
    assert.equal(first.jsonBody.checks, 'passing');
    assert.equal(first.jsonBody.url, PR_URL);
    assert.equal(second.jsonBody.state, 'open');
    assert.equal(counts.github, 4, 'the 4-call reader ran exactly once');
  });

  test('LIN-3443: a GitHub-bound workspace reads its repo with its own token, cached under the workspace', async () => {
    const authHeaders = [];
    const stub = githubStub({ counts: { github: 0 } });
    const router = makeRouter({}, {
      recordsStore: recordsStoreOfChanges([PR_URL], { ticket: 'LIN-1' }),
      prState: {
        now: () => Date.now(),
        cache: new Map(),
        bucket: [],
        resolveProvider: () => ({ provider: { async fetchIssueComments() { return []; } }, callScope: { repo: 'acme/widget', token: 'ghs_tok' } }),
        loadRun: async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] }),
        githubFetch: async (url, opts) => { authHeaders.push(opts?.headers?.Authorization); return stub(url, opts); }
      }
    });
    const res = await callPrState(router);
    assert.equal(res.jsonBody.state, 'open');
    assert.equal(authHeaders.length, 4);
    assert.ok(authHeaders.every(h => h === 'Bearer ghs_tok'), 'all four calls carry the workspace token');
  });

  test('a merged PR is not re-read within 24 h (injected clock, no sleeps)', async () => {
    let clock = 1_000_000;
    const bucket = [];
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'closed', merged: true },
      now: () => clock,
      bucket
    });

    const first = await callPrState(router);
    assert.equal(first.jsonBody.state, 'merged');
    assert.equal(counts.github, 4);

    clock += 20 * 60 * 60 * 1000; // 20 h later, still inside the 24 h closed TTL
    const second = await callPrState(router);
    assert.equal(second.jsonBody.state, 'merged');
    assert.equal(counts.github, 4, 'no re-read inside the 24 h closed TTL');
  });

  test('with the budget spent, a GET serves the stale value with zero upstream fetches and status 200', async () => {
    let clock = 2_000_000;
    const bucket = [];
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'open' },
      now: () => clock,
      bucket
    });

    const first = await callPrState(router);
    assert.equal(first.jsonBody.state, 'open');
    assert.equal(counts.github, 4);

    // Spend the trailing 60-minute span's whole 36-call budget.
    bucket.splice(0, bucket.length, ...Array(36).fill(clock));
    clock += 16 * 60 * 1000; // past the 15 min open TTL, so a refresh would run
    const second = await callPrState(router);
    assert.equal(second.statusCode, 200);
    assert.equal(second.jsonBody.state, 'open', 'the stale cached value is served');
    assert.equal(counts.github, 4, 'the spent budget made zero upstream fetches');
  });

  test('budget spent with no stale value returns state not reported, status 200, zero upstream fetches', async () => {
    const nowMs = 3_000_000;
    const bucket = Array(36).fill(nowMs);
    const { router, counts } = makePrStateRouter({
      now: () => nowMs,
      bucket,
      cache: new Map(),
      changes: [PR_URL],
      github: { state: 'open' }
    });

    const res = await callPrState(router, 'run-x');
    assert.equal(res.statusCode, 200, 'never a 403');
    assert.equal(res.jsonBody.state, 'unknown');
    assert.equal(res.jsonBody.number, 12);
    assert.equal(counts.github, 0, 'zero upstream GitHub fetches');
  });

  test('the sliding window holds across a boundary: 36 calls during the hour refuse a t=61min read, but age out by t=120min', async () => {
    const base = 10_000_000;
    let clock = base + 61 * 60 * 1000;
    // 36 calls, one per minute from t=0 to t=35min. At t=61min the recent ones
    // are still inside the trailing 60 min, so a sliding window still refuses;
    // a fixed window that started at t=0 would have reset and wrongly allowed.
    const bucket = Array.from({ length: 36 }, (_, i) => base + i * 60 * 1000);
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'open' },
      now: () => clock,
      bucket
    });

    const refused = await callPrState(router);
    assert.equal(refused.statusCode, 200);
    assert.equal(refused.jsonBody.state, 'unknown', 'no room for the 4-call read → state not reported');
    assert.equal(counts.github, 0, 'zero upstream fetches at t=61min');

    clock = base + 120 * 60 * 1000; // all 36 calls are now older than 60 min
    const allowed = await callPrState(router);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.jsonBody.state, 'open', 'the aged-out budget permits a fresh read');
    assert.equal(counts.github, 4, 'the read ran upstream once the window emptied');
  });

  test('reserving the whole read: 34 calls used leaves no room, so a new read makes zero upstream calls', async () => {
    const nowMs = 20_000_000;
    const bucket = Array(34).fill(nowMs);
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'open' },
      now: () => nowMs,
      bucket
    });

    const res = await callPrState(router);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state, 'unknown');
    assert.equal(counts.github, 0, '34 + 4 > 36 → the read never starts');
  });

  test('a records read that throws returns 200 unknown, never a 403 (N2)', async () => {
    const nowMs = 30_000_000;
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      recordsThrow: true,
      github: { state: 'open' },
      now: () => nowMs
    });

    const res = await callPrState(router);
    assert.equal(res.statusCode, 200, 'a failed records read is not a 403');
    assert.equal(res.jsonBody.state, 'unknown');
    assert.equal(res.jsonBody.number, null);
    assert.equal(counts.github, 0, 'no PR resolved → no GitHub read');
  });

  test('a change record newly written for the run is picked up on the next poll (one fetchPrStatus)', async () => {
    const changes = []; // the records store reads this live reference each GET
    const { router, counts } = makePrStateRouter({
      changes,
      github: { state: 'open' }
    });

    const first = await callPrState(router);
    assert.equal(first.jsonBody.state, 'none', 'no PR on record yet');

    // the implementation records its change after the first poll
    changes.push(PR_URL);

    const second = await callPrState(router);
    assert.equal(second.jsonBody.state, 'open', 'the newly recorded PR is seen on the next poll');
    assert.equal(second.jsonBody.number, 12);
    assert.equal(counts.github, 4, 'exactly one fetchPrStatus call (4 upstream)');
  });

  test('no change record on the run returns the none state with zero upstream fetches', async () => {
    const { router, counts } = makePrStateRouter({
      changes: [],
      github: { state: 'open' }
    });

    const res = await callPrState(router);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state, 'none');
    assert.equal(res.jsonBody.url, null);
    assert.equal(counts.github, 0, 'no PR -> no GitHub read');
  });

  // finding-84f02273: a PR URL in a tracker comment is no longer where a run's PR is found. Mutation: reading the
  // comments again turns this red (the state would be 'open').
  test('a PR URL only in a comment, with no change record, returns none and the comments are never read', async () => {
    const { router, counts } = makePrStateRouter({
      changes: [],
      comments: [{ body: `opened ${PR_URL}`, createdAt: '2026-07-01T00:00:00.000Z', user: 'worker' }],
      github: { state: 'open' }
    });

    const res = await callPrState(router);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state, 'none');
    assert.equal(counts.comments, 0, 'the tracker comments are not read');
    assert.equal(counts.github, 0, 'no PR -> no GitHub read');
  });

  test('two change records name two PRs: withheld as unknown, never one picked silently', async () => {
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL, 'https://github.com/acme/widget/pull/13'],
      github: { state: 'open' }
    });

    const res = await callPrState(router);
    assert.equal(res.jsonBody.state, 'unknown');
    assert.equal(counts.github, 0);
  });

  test('a PR in any repo is read now that the allowlist is gone (LIN-3333)', async () => {
    const { router, counts } = makePrStateRouter({
      changes: [PR_URL],
      github: { state: 'open' }
    });

    const res = await callPrState(router);
    assert.equal(res.jsonBody.state, 'open', 'a foreign repo URL is no longer filtered out');
    assert.equal(counts.github, 4);
  });
});

// LIN-3722: the run page's `stopAt` fact is the shared `stopAtFromRows` rule over
// the seed issue's own rows. LIN-3725: it now also follows the sessionId hop and
// skips a missing store method, via `readTaskRunFacts`. The row table below was
// captured on the base commit (before the extraction); only the missing-method
// row changed (defaults -> skipped).
describe('GET /observation/session/:sessionId — run-facts stopAt (LIN-3722)', () => {
  const PR = { kind: 'autopilot', stopAt: 'pr' };
  const cases = [
    ['pr row', { live: [PR] }, 'pr'],
    ['merge row', { live: [{ stopAt: 'merge' }] }, null],
    ['null stopAt', { live: [{ stopAt: null }] }, null],
    ['undefined stopAt', { live: [{}] }, null],
    ['no rows', { live: [] }, null],
    ['falsy rows among a pr row', { live: [null, undefined, false, 0, PR] }, 'pr'],
    ['falsy rows only', { live: [null, undefined, false, 0] }, null],
    ['pr first', { live: [PR, { stopAt: 'merge' }] }, 'pr'],
    ['pr last', { live: [{ stopAt: 'merge' }, PR] }, 'pr'],
    ['pr in history only', { live: [], history: [PR] }, 'pr'],
    ['pr in queue only', { live: [PR], history: [] }, 'pr'],
    ['history as { items }', { live: [], history: { items: [PR] } }, 'pr'],
    ['history as null', { live: [PR], history: null }, 'pr'],
    ['history null, no pr', { live: [], history: null }, null],
    ['rejecting listItems, pr in history', { liveThrows: true, history: [PR] }, 'pr'],
    ['rejecting listItems, nothing else', { liveThrows: true, history: [] }, null],
    ['store without listItems is skipped, history still read', { noListItems: true, history: [PR] }, 'pr'],
  ];

  async function factsSeen({ live = [], history = [], hops = {}, liveThrows = false, noListItems = false }) {
    const base = makeStores({ 'ws-a': {
      live: [], history: [autopilotHistoryItem('sess-rf', 'LIN-900')], agentStatus: [agentStatusDone('sess-rf', 'LIN-900')]
    } });
    // The session point-read passes the same options, so tell the facts read apart
    // by its caller.
    const isFactsRead = () => /readRunFacts/.test(new Error().stack);
    const dispatchQueueStore = {
      async listItems(urlKey, opts) {
        if (!isFactsRead(opts)) return base.dispatchQueueStore.listItems(urlKey, opts);
        if (liveThrows) throw new Error('boom');
        return live;
      },
      async listHistory(urlKey, opts) {
        if (!isFactsRead(opts)) return base.dispatchQueueStore.listHistory(urlKey, opts);
        return history;
      },
      async getItemStatus(urlKey, id) {
        return hops[id] || base.dispatchQueueStore.getItemStatus?.(urlKey, id) || null;
      },
    };
    if (noListItems) {
      // LIN-3725: the facts read now skips a missing store method (the task page's
      // guard), so hide `listItems` from the facts read only; the session
      // point-read still needs it.
      const real = dispatchQueueStore.listItems;
      Object.defineProperty(dispatchQueueStore, 'listItems', {
        get() { return isFactsRead() ? undefined : real; },
      });
    }
    const seen = [];
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore, agentStatusStore: base.agentStatusStore,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      readRunEvidence: async args => { seen.push(args); return null; },
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/observation/session/:sessionId');
    const { req, res } = makeReqRes({
      session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      workspace: { urlKey: 'ws-a' },
      params: { sessionId: 'sess-rf' }
    });
    await handler(req, res, err => { throw err; });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.length, 1, 'the evidence reader was handed the run facts once');
    return seen[0];
  }

  async function stopAtSeen(input) {
    return (await factsSeen(input)).stopAt;
  }

  for (const [name, input, expected] of cases) {
    test(`stopAt for ${name} is ${expected}`, async () => {
      assert.equal(await stopAtSeen(input), expected);
    });
  }

  // LIN-3725: the run page follows the sessionId hop, as the task page does. The
  // worker row names the parent run row, which carries `stopAt: 'pr'`.
  test('sessionId hop: worker rows alone lift the run page to pr via the parent run row', async () => {
    assert.equal(await stopAtSeen({
      live: [{ sessionId: 'sess-rf', kind: 'implementation' }],
      hops: { 'sess-rf': { kind: 'autopilot', stopAt: 'pr' } },
    }), 'pr');
  });

  test('sessionId hop: a parent without stopAt pr leaves the run page null', async () => {
    assert.equal(await stopAtSeen({
      live: [{ sessionId: 'sess-rf', kind: 'implementation' }],
      hops: { 'sess-rf': { kind: 'autopilot', stopAt: 'merge' } },
    }), null);
  });

  // LIN-3725: the hop lifts `stopAt` only. `variant` stays the seed issue's own
  // kickoff row, so a parent that says `standard` must not leak onto the run page
  // (the call site passes `hopVariant: false`).
  test('sessionId hop: lifts stopAt but variant stays unknown', async () => {
    const facts = await factsSeen({
      live: [{ sessionId: 'sess-rf', kind: 'implementation' }],
      hops: { 'sess-rf': { kind: 'autopilot', stopAt: 'pr', variant: 'standard' } },
    });
    assert.equal(facts.stopAt, 'pr');
    assert.equal(facts.variant, 'unknown');
  });
});
