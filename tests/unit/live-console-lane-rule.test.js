/**
 * LIN-3986: one lane per task key, chosen by one written rule.
 *
 * The rule, as documented beside `chooseKeyLane` in lib/live-console.js:
 *   1. Key    — one lane per workspace::task. A reply joins its anchor's group.
 *   2. Stale  — a member silent past laneStaleMs is removed before the choice.
 *   3. Superseded — a loop named by another loop's followUpTo is not waiting.
 *   4. Rank   — fresh waiting > fresh working > finished. Ties go to the most
 *               recent activity, then the newer sinceMs, then a loop lane over a
 *               status-only lane, then input order.
 *
 * The witnesses below were committed before the change and fail at the base
 * commit (dfeabc20). The pins (a lone lane, independent tasks, the existing wake
 * fold in live-console.test.js) pass at both ends.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Namespace import: at the base commit `chooseKeyLane` does not exist yet, and a
// named import would fail the whole file to load instead of failing one test.
import * as liveConsole from '../../lib/live-console.js';

const { deriveLoopLanes, buildConsoleFeed, chooseKeyLane } = liveConsole;

const NOW = Date.parse('2026-07-19T12:00:00Z');
const MIN = 60 * 1000;
const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();

// A lean running loop, shaped like getLoopsForWorkspace(lean) output.
function run(over = {}) {
  return {
    loopId: 'run',
    issueIdentifier: 'LIN-9',
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    agentState: 'running',
    agentAction: 'implementation',
    agentSummary: '',
    dispatchedAt: at(10),
    agentTimestamp: at(10),
    telemetry: { metrics: [], producedArtifacts: [] },
    ...over,
  };
}

// A workspace-tagged agent-status entry, shaped like the store's listStatus items.
function statusItem(over = {}) {
  return {
    id: 'status-1',
    taskIdentifier: 'LIN-9',
    action: 'implementation',
    status: 'in_progress',
    summary: 'editing',
    timestamp: at(5),
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    ...over,
  };
}

// ─── 1. A reply to a blocked run joins the anchor's lane ─────────────────────

test('LIN-3986 (witness, review round 1): a reply to a blocked run is one lane, and the lane is the reply\'s, not the superseded anchor\'s', () => {
  const anchor = run({ loopId: 'anchor', agentAction: 'plan', dispatchedAt: at(45), agentTimestamp: at(45), wakeMarker: 'blocked', agentTokenId: 'tok-anchor' });
  const reply = run({ loopId: 'reply', followUpTo: 'anchor', agentAction: 'implementation', dispatchedAt: at(30), agentTimestamp: at(30), agentTokenId: 'tok-reply' });
  const lanes = deriveLoopLanes([anchor, reply], { credentialByToken: { 'tok-anchor': 'ok', 'tok-reply': 'credential_dead' } });
  assert.equal(lanes.length, 1, 'the reply and its anchor are one lane, not two');
  assert.equal(lanes[0].action, 'implementation', 'action comes from the reply, not the anchor\'s pre-block action');
  assert.equal(lanes[0].credential.state, 'dead', 'credential comes from the reply too');
  assert.equal(lanes[0].sinceMs, Date.parse(at(30)));
});

test('LIN-3986 (witness): the feed shows a reply to a blocked run once, as the reply, and counts it once', () => {
  const anchor = run({ loopId: 'anchor', agentAction: 'plan', dispatchedAt: at(45), agentTimestamp: at(45), wakeMarker: 'blocked' });
  const reply = run({ loopId: 'reply', followUpTo: 'anchor', agentAction: 'implementation', dispatchedAt: at(30), agentTimestamp: at(30) });
  const feed = buildConsoleFeed({ statusItems: [], loops: [anchor, reply] }, { now: NOW });
  assert.equal(feed.lanes.length, 1);
  assert.equal(feed.lanes[0].action, 'implementation');
  assert.equal(feed.summary.active, 1);
});

// ─── 2. Two-loop slice, three-link chain, and a cycle ────────────────────────

test('LIN-3986 (witness): a two-link slice and a three-link chain each fold into one lane, led by the freshest member', () => {
  const a = run({ loopId: 'a', dispatchedAt: at(120), agentTimestamp: at(120), wakeMarker: 'blocked' });
  const b = run({ loopId: 'b', followUpTo: 'a', dispatchedAt: at(90), agentTimestamp: at(90) });
  const c = run({ loopId: 'c', followUpTo: 'b', dispatchedAt: at(10), agentTimestamp: at(10) });

  assert.equal(deriveLoopLanes([a, b]).length, 1, 'two-link slice: one lane');

  const chain = deriveLoopLanes([a, b, c]);
  assert.equal(chain.length, 1, 'three-link chain: one lane');
  assert.equal(chain[0].sinceMs, Date.parse(at(10)), 'the freshest member (the tip) supplies the lane');
});

test('LIN-3986 (witness): a followUpTo cycle, and a self-reference, fold without hanging', () => {
  const x = run({ loopId: 'x', issueIdentifier: 'LIN-11', followUpTo: 'y' });
  const y = run({ loopId: 'y', issueIdentifier: 'LIN-11', followUpTo: 'x' });
  assert.equal(deriveLoopLanes([x, y]).length, 1, 'a two-loop cycle is one lane');

  const s = run({ loopId: 's', issueIdentifier: 'LIN-12', followUpTo: 's' });
  assert.equal(deriveLoopLanes([s]).length, 1, 'a self-reference is one lane');
});

// ─── 3. Fresh waiting beside fresh working ───────────────────────────────────

for (const [label, waitingAgo, workingAgo] of [
  ['the waiting run was dispatched first', 50, 20],
  ['the waiting run was dispatched last', 20, 50],
]) {
  test(`LIN-3986 (witness): fresh waiting beside fresh working on one key shows the waiting lane — ${label}`, () => {
    const waiting = run({ loopId: 'w', agentAction: 'review', kind: 'review', dispatchedAt: at(waitingAgo), agentTimestamp: at(waitingAgo), wakeMarker: 'blocked' });
    const working = run({ loopId: 'k', agentAction: 'implementation', kind: 'implementation', dispatchedAt: at(workingAgo), agentTimestamp: at(workingAgo) });
    const feed = buildConsoleFeed({ statusItems: [], loops: [waiting, working] }, { now: NOW });
    assert.equal(feed.lanes.length, 1, 'one lane for the shared key');
    assert.equal(feed.lanes[0].action, 'review', 'the key never shows as not waiting');
  });
}

// ─── 4. Stale waiting beside fresh working ───────────────────────────────────

test('LIN-3986 (witness, order 1): a stale waiting run dispatched before a fresh working run does not hide the working lane', () => {
  const staleWaiting = run({ loopId: 'sw', agentAction: 'review', dispatchedAt: at(300), agentTimestamp: at(300), wakeMarker: 'blocked' });
  const freshWorking = run({ loopId: 'fw', agentAction: 'implementation', dispatchedAt: at(10), agentTimestamp: at(10) });
  const feed = buildConsoleFeed({ statusItems: [], loops: [staleWaiting, freshWorking] }, { now: NOW });
  assert.deepEqual(feed.lanes.map(l => l.action), ['implementation'], 'the working lane survives the stale-filter');
  assert.ok(feed.summary.active >= 1, 'the dot does not read idle while a fresh member works');
});

test('LIN-3986 (pin, order 2): a stale waiting run dispatched after a fresh working run still leaves the working lane', () => {
  const staleWaiting = run({ loopId: 'sw2', agentAction: 'review', dispatchedAt: at(90), agentTimestamp: at(90), wakeMarker: 'blocked' });
  const freshWorking = run({ loopId: 'fw2', agentAction: 'implementation', dispatchedAt: at(400), agentTimestamp: at(400), telemetry: { metrics: [{ toolCount: 9, total: 9, timestamp: at(2) }], producedArtifacts: [] } });
  const feed = buildConsoleFeed({ statusItems: [], loops: [staleWaiting, freshWorking] }, { now: NOW });
  assert.deepEqual(feed.lanes.map(l => l.action), ['implementation']);
  assert.equal(feed.summary.active, 1);
});

// ─── 5. Stale loop lane beside fresh status-only lane ────────────────────────

test('LIN-3986 (witness): a stale loop lane does not hide a fresh status-only lane on the same key', () => {
  const stale = run({ loopId: 'old', agentAction: 'implementation', dispatchedAt: at(300), agentTimestamp: at(300) });
  const feed = buildConsoleFeed({ statusItems: [statusItem({ timestamp: at(5) })], loops: [stale] }, { now: NOW });
  assert.equal(feed.lanes.length, 1);
  assert.equal(feed.lanes[0].task, 'LIN-9');
  assert.equal(feed.lanes[0].sinceMs, Date.parse(at(5)), 'the fresh status-only lane is the one shown');
});

test('LIN-3986 (witness, e2e regression): a fresh loop lane keeps its key over a status-only lane, even when the status row is newer than the dispatch', () => {
  // The status-only lane is the fallback for a task with no live loop (deriveLanes).
  // Its status row is usually newer than the loop's dispatch, so recency alone must
  // not let it take the key: the loop lane's heartbeat and credential would vanish.
  const dispatched = run({ loopId: 'l-e2e', issueIdentifier: 'LIN-1588B', dispatchedAt: at(10), agentTimestamp: at(2), agentTokenId: 'tok-dead' });
  const status = statusItem({ id: 's-e2e', taskIdentifier: 'LIN-1588B', timestamp: at(2) });
  const feed = buildConsoleFeed({ statusItems: [status], loops: [dispatched] }, { now: NOW, credentialByToken: { 'tok-dead': 'credential_dead' } });
  assert.equal(feed.lanes.length, 1);
  assert.equal(feed.lanes[0].credential.state, 'dead', 'the loop lane, with its credential, shows');
});

// ─── 6. Pins: independent tasks never merge; a lone lane is unchanged ────────

test('LIN-3986 (pin): a reply naming a different issue, or a different workspace, does not fold', () => {
  const anchor = run({ loopId: 'anchor', issueIdentifier: 'LIN-9', dispatchedAt: at(30), agentTimestamp: at(30), wakeMarker: 'blocked' });
  const otherIssue = run({ loopId: 'r-issue', issueIdentifier: 'LIN-20', followUpTo: 'anchor', dispatchedAt: at(20), agentTimestamp: at(20) });
  assert.deepEqual(deriveLoopLanes([anchor, otherIssue]).map(l => l.task).sort(), ['LIN-20', 'LIN-9']);

  const otherWorkspace = run({ loopId: 'r-ws', workspaceUrlKey: 'globex', workspaceName: 'Globex', followUpTo: 'anchor', dispatchedAt: at(20), agentTimestamp: at(20) });
  assert.equal(deriveLoopLanes([anchor, otherWorkspace]).length, 2, 'same issue id in another workspace stays its own lane');
});

test('LIN-3986 (pin): two workspaces sharing a task id, and two tasks in one workspace, never merge', () => {
  const acme = run({ loopId: 'acme-9', workspaceUrlKey: 'acme' });
  const globex = run({ loopId: 'globex-9', workspaceUrlKey: 'globex', workspaceName: 'Globex' });
  const acmeOther = run({ loopId: 'acme-10', issueIdentifier: 'LIN-10' });
  assert.equal(deriveLoopLanes([acme, globex]).length, 2);
  assert.equal(deriveLoopLanes([acme, acmeOther]).length, 2);
});

test('LIN-3986 (pin): a lone lane is deep-equal to today\'s lane shape, sparse issueSource included', () => {
  const lone = run({
    loopId: 'solo', agentAction: 'implementation', agentSummary: 'editing', dispatchedAt: at(30), agentTimestamp: at(5),
    agentTokenId: 'tok', issueSource: 'linear',
    telemetry: { metrics: [{ toolCount: 4, total: 4, timestamp: at(2) }], producedArtifacts: [] },
  });
  const { lanes } = buildConsoleFeed({ statusItems: [], loops: [lone] }, { now: NOW, credentialByToken: { tok: 'ok' } });
  assert.deepEqual(lanes, [{
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    task: 'LIN-9',
    action: 'implementation',
    summary: 'editing',
    sinceMs: Date.parse(at(30)),
    lastActivityMs: Date.parse(at(2)),
    heartbeat: { toolCount: 4, elapsedSeconds: null, breakdown: null, total: 4, state: null },
    ticketWalk: null,
    parkedWait: null,
    credential: { state: 'ok', label: null },
    issueSource: 'linear',
  }]);
});

// ─── 7. The rank table: chooseKeyLane ────────────────────────────────────────

// A candidate for one key. `members` carry the per-member state and activity the
// chooser filters on; `origin` is 'loop' (carries lastActivityMs) or 'status'.
function cand(state, { ago, since = ago, origin = 'loop', id = state } = {}) {
  const lastActivityMs = NOW - ago * MIN;
  const lane = {
    workspaceUrlKey: 'acme',
    task: 'LIN-9',
    action: id,
    sinceMs: NOW - since * MIN,
    ...(origin === 'loop' ? { lastActivityMs } : {}),
  };
  return { origin, lane, members: [{ state, lastActivityMs }] };
}

const pick = (candidates) => {
  const lane = chooseKeyLane(candidates, { now: NOW, staleMs: 60 * MIN });
  return lane ? lane.action : null;
};

test('LIN-3986 (witness, rank): waiting > working > finished among fresh members, in every input order', () => {
  const w = cand('waiting', { ago: 5, id: 'W' });
  const k = cand('working', { ago: 5, id: 'K' });
  const f = cand('finished', { ago: 5, id: 'F' });
  for (const order of [[w, k, f], [f, k, w], [k, w, f], [f, w, k]]) assert.equal(pick(order), 'W');
  for (const order of [[k, f], [f, k]]) assert.equal(pick(order), 'K');
});

test('LIN-3986 (witness, rank): a stale member drops out before the choice, whatever its state', () => {
  const staleWaiting = cand('waiting', { ago: 300, id: 'SW' });
  const freshWorking = cand('working', { ago: 5, id: 'FW' });
  const freshFinished = cand('finished', { ago: 5, id: 'FF' });
  assert.equal(pick([staleWaiting, freshWorking]), 'FW', 'a stale waiting member never wins over a fresh working one');
  assert.equal(pick([staleWaiting, freshFinished]), 'FF', 'a stale waiting member never wins over a fresh finished one');
  assert.equal(pick([cand('working', { ago: 300, id: 'SK' })]), null, 'a key whose members are all stale shows nothing');
});

test('LIN-3986 (witness, rank): a candidate is judged on its fresh members only', () => {
  // One candidate, two members: a stale waiting run and a fresh working run on the same key.
  const liveLane = { workspaceUrlKey: 'acme', task: 'LIN-9', action: 'MIXED', sinceMs: NOW - 400 * MIN, lastActivityMs: NOW - 5 * MIN };
  const mixed = { origin: 'loop', lane: liveLane, members: [
    { state: 'waiting', lastActivityMs: NOW - 300 * MIN },
    { state: 'working', lastActivityMs: NOW - 5 * MIN },
  ] };
  assert.equal(pick([mixed, cand('waiting', { ago: 5, id: 'FW' })]), 'FW', 'the stale waiting member does not make the mixed candidate waiting');
  assert.equal(pick([mixed, cand('finished', { ago: 5, id: 'FF' })]), 'MIXED', 'the mixed candidate ranks as working, above finished');
});

test('LIN-3986 (witness, tie-break): among equal states, the most recent activity wins, not the input order or the dispatch time', () => {
  const olderDispatchMoreActive = cand('working', { ago: 5, since: 60, id: 'ACTIVE' });
  const newerDispatchIdle = cand('working', { ago: 20, since: 30, id: 'IDLE' });
  assert.equal(pick([newerDispatchIdle, olderDispatchMoreActive]), 'ACTIVE');
  assert.equal(pick([olderDispatchMoreActive, newerDispatchIdle]), 'ACTIVE');
});

test('LIN-3986 (witness, tie-break): equal activity falls to the newer sinceMs', () => {
  const earlier = cand('working', { ago: 5, since: 50, id: 'EARLIER' });
  const later = cand('working', { ago: 5, since: 30, id: 'LATER' });
  assert.equal(pick([earlier, later]), 'LATER');
  assert.equal(pick([later, earlier]), 'LATER');
});

test('LIN-3986 (witness, tie-break): a loop lane beats a status-only lane even when the status lane is more recently active', () => {
  const loopLane = cand('working', { ago: 20, since: 20, id: 'LOOP' });
  const statusLane = cand('working', { ago: 2, since: 2, origin: 'status', id: 'STATUS' });
  assert.equal(pick([statusLane, loopLane]), 'LOOP');
  assert.equal(pick([loopLane, statusLane]), 'LOOP');
});

test('LIN-3986 (witness, tie-break): equal activity and dispatch — a loop lane beats a status-only lane, then input order decides', () => {
  const loopLane = cand('working', { ago: 5, since: 5, id: 'LOOP' });
  const statusLane = cand('working', { ago: 5, since: 5, origin: 'status', id: 'STATUS' });
  assert.equal(pick([statusLane, loopLane]), 'LOOP');
  assert.equal(pick([loopLane, statusLane]), 'LOOP');
  const first = cand('working', { ago: 5, since: 5, id: 'FIRST' });
  const second = cand('working', { ago: 5, since: 5, id: 'SECOND' });
  assert.equal(pick([first, second]), 'FIRST', 'a full tie keeps the first candidate given');
});

test('LIN-3986 (witness, rank): with no `now`, nothing is judged stale, so the best state still wins', () => {
  const oldWaiting = cand('waiting', { ago: 9000, id: 'OLD-W' });
  const freshWorking = cand('working', { ago: 5, id: 'FW' });
  const lane = chooseKeyLane([freshWorking, oldWaiting], {});
  assert.equal(lane.action, 'OLD-W');
});

test('LIN-3986 (witness, rank): a group ranks by its freshest member — a working group beats a fresh finished candidate on the same key', () => {
  // deriveLoopLanes hands the chooser one candidate per group. Its freshest member
  // is a working reply, so the candidate is working, and working beats finished.
  const group = { origin: 'loop', lane: { workspaceUrlKey: 'acme', task: 'LIN-9', action: 'GROUP', sinceMs: NOW - 30 * MIN, lastActivityMs: NOW - 2 * MIN }, members: [
    { state: 'working', lastActivityMs: NOW - 2 * MIN },
  ] };
  assert.equal(pick([cand('finished', { ago: 3, id: 'FF' }), group]), 'GROUP');
});
