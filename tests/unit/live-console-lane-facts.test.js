/**
 * LIN-3977 — what a lane and a stream row SAY, and which runs they are about.
 *
 * Run with: node --test tests/unit/live-console-lane-facts.test.js
 *
 * Each block is a witness from the plan's Testing section: the lane facts (title,
 * stage, sessionId, waiting, waitingSince, waitingFor), the two waiting channels
 * (agent-status `blocked` and the `[blocked]` marker, LIN-1005), the stage walk
 * over the fold chain, the derived stream moments and their dedupe (W1: a wait
 * time is read only behind the marker channel), paging over one pool, the dot's
 * red, the promotion rule, and the run-id index.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildConsoleFeed, buildConsoleEvents, deriveLoopEvents, pageEvents, FOLD_SKEW_MS, stageKindOf, freshMembers,
  chooseKeyLane, LANE_RANK,
} from '../../lib/live-console.js';
import { sessionIdByLoop, __internal } from '../../lib/pipeline-loops.js';
import { computeSupersededLoopIds } from '../../lib/loop-supersede.js';
import { loopIsWaiting } from '../../lib/run-loop-state.js';
import { enrichLoop } from '../../lib/run-loop-state.js';
import { stageLabel as runViewStageLabel } from '../../lib/run-view.js';
import { stageLabel as loaderStageLabel } from '../../lib/task-page-loader.js';
import { liveConsoleOn, requestFeatureFlags, setRunControlsResolver } from '../../lib/run-controls.js';
import { createLiveConsoleRoutes } from '../../routes/live-console.js';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();

// A running loop on LIN-9 by default. Override anything.
function run(over = {}) {
  return {
    loopId: 'L',
    issueIdentifier: 'LIN-9',
    issueTitle: 'Ship the thing',
    kind: 'implementation',
    agentState: 'running',
    agentAction: 'implementation',
    agentSummary: 'working',
    dispatchedAt: at(30),
    agentTimestamp: at(2),
    takenAt: null,
    terminalStatus: null,
    terminalCompletedAt: null,
    wakeMarker: null,
    wakeAt: null,
    waitingMessage: null,
    followUpTo: null,
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    // the session ledger seats only cli/web runs (isFree in pipeline-loops)
    target: 'cli',
    telemetry: { metrics: [], producedArtifacts: [] },
    ...over,
  };
}

const feedOf = (loops, statusItems = [], opts = {}) => buildConsoleFeed({ statusItems, loops }, { now: NOW, ...opts });
const laneFor = (feed, task) => feed.lanes.find(l => l.task === task);

describe('lane facts: title, stage, and the words of a wait', () => {
  test('a parked run waiting on a [blocked] marker is a waiting lane with its time and question', () => {
    const feed = feedOf([run({ loopId: 'P', wakeMarker: 'blocked', wakeAt: at(5), waitingMessage: 'Which branch?' })]);
    assert.equal(feed.lanes.length, 1);
    const lane = feed.lanes[0];
    assert.equal(lane.waiting, true);
    assert.equal(lane.waitingSince, Date.parse(at(5)));
    assert.equal(lane.waitingFor, 'Which branch?');
    assert.equal(feed.summary.waiting, 1);
    assert.equal(feed.summary.working, 0);
  });

  test('a working lane is not waiting and carries no wait time', () => {
    const feed = feedOf([run({ loopId: 'W' })]);
    assert.equal(feed.lanes[0].waiting, false);
    assert.equal(feed.lanes[0].waitingSince, null);
    assert.equal(feed.summary.working, 1);
  });

  test('title is the identity source\'s own title; stage is the plain word for its kind', () => {
    const lane = feedOf([run({ loopId: 'T' })]).lanes[0];
    assert.equal(lane.task, 'LIN-9');
    assert.equal(lane.title, 'Ship the thing');
    assert.equal(lane.stage, 'Build', 'implementation reads as Build, never the raw kind');
  });

  test('a status-only lane is never waiting, has no run and no title', () => {
    const feed = feedOf([], [{
      id: 's1', taskIdentifier: 'LIN-50', action: 'implementation', status: 'in_progress',
      summary: 'editing', timestamp: at(2), workspaceUrlKey: 'acme', workspaceName: 'Acme',
    }]);
    const lane = laneFor(feed, 'LIN-50');
    assert.ok(lane, 'the status-only lane is still shown');
    assert.equal(lane.waiting, false);
    assert.equal(lane.waitingSince, null);
    assert.equal(lane.sessionId, null);
    assert.equal(lane.title, null);
    assert.equal(lane.stage, 'Build');
  });

  test('channel (a) alone: an agent-status-blocked run is waiting with no time and its summary as the question', () => {
    const feed = feedOf([run({ loopId: 'A', agentState: 'waiting', agentSummary: 'Should I drop the table?' })]);
    assert.equal(feed.lanes.length, 1, 'a channel-(a) run now has its lane');
    assert.equal(feed.lanes[0].waiting, true);
    assert.equal(feed.lanes[0].waitingSince, null, 'no time for a channel-(a) wait (W1)');
    assert.equal(feed.lanes[0].waitingFor, 'Should I drop the table?');
  });

  test('channel (a) with a [pending] marker is waiting with no time (the union form of W1)', () => {
    const feed = feedOf([run({ loopId: 'AP', agentState: 'waiting', wakeMarker: 'pending', wakeAt: at(3) })]);
    assert.equal(feed.lanes[0].waiting, true);
    assert.equal(feed.lanes[0].waitingSince, null, 'a [pending] time is never a wait time');
  });

  test('a terminal run with agentState waiting has no lane (terminal wins through enrichLoop)', () => {
    const feed = feedOf([run({ loopId: 'T', agentState: 'waiting', terminalStatus: 'done', terminalCompletedAt: at(1) })]);
    assert.equal(feed.lanes.length, 0);
  });

  test('both channels on one run, a status row two minutes from the marker: one waiting moment, with the status row\'s summary', () => {
    const loops = [run({ loopId: 'B', agentState: 'waiting', wakeMarker: 'blocked', wakeAt: at(4), waitingMessage: 'Q?' })];
    const statusItems = [{
      id: 'st-b', dispatchId: 'B', taskIdentifier: 'LIN-9', action: 'implementation', status: 'blocked',
      summary: 'Need a decision on the schema', timestamp: at(2), workspaceUrlKey: 'acme', workspaceName: 'Acme',
    }];
    const { events } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW - 86_400_000, superseded: computeSupersededLoopIds(loops) });
    const waits = events.filter(e => e.loopId === 'B' && e.kind === 'blocked');
    assert.equal(waits.length, 1, 'the two channels report one wait');
    assert.equal(waits[0].id, 'd:B:waiting');
    assert.equal(waits[0].summary, 'Need a decision on the schema', 'the folded row keeps the status row\'s words');
  });
});

describe('the stage walk: a lane says the stage the session is in', () => {
  test('(a) a reply to a blocked Plan reads "Plan", never "Custom", and takes the anchor\'s title', () => {
    const anchor = run({ loopId: 'A', kind: 'plan', issueTitle: 'Plan the thing', wakeMarker: 'blocked', wakeAt: at(20), agentTimestamp: at(20), dispatchedAt: at(40) });
    const reply = run({ loopId: 'B', kind: 'custom', followUpTo: 'A', dispatchedAt: at(5), agentTimestamp: at(5) });
    const feed = feedOf([anchor, reply]);
    assert.equal(feed.lanes.length, 1);
    assert.equal(feed.lanes[0].title, 'Plan the thing');
    assert.equal(feed.lanes[0].task, 'LIN-9');
    assert.equal(feed.lanes[0].stage, 'Plan');
  });

  test('(b) a woken Build reads "Build" with the target\'s title; the wake\'s own identifier is not the task', () => {
    const target = run({ loopId: 'T', kind: 'implementation', issueTitle: 'Build the thing', wakeMarker: 'blocked', wakeAt: at(30), agentTimestamp: at(30), dispatchedAt: at(60) });
    const wake = run({ loopId: 'W', kind: 'wake', followUpTo: 'T', issueIdentifier: 'LIN-77', issueTitle: null, dispatchedAt: at(3), agentTimestamp: at(3) });
    const feed = feedOf([target, wake]);
    const lane = feed.lanes[0];
    assert.equal(lane.task, 'LIN-9', 'the task is the target\'s issue');
    assert.equal(lane.title, 'Build the thing', 'never a null title for a folded wake');
    assert.equal(lane.stage, 'Build', 'never "Check-in" for a folded wake');
  });

  test('(c) a same-task plan-review follow-up of a Plan reads "Plan review"', () => {
    const plan = run({ loopId: 'A', kind: 'plan', issueTitle: 'Plan', dispatchedAt: at(40), agentTimestamp: at(30) });
    const review = run({ loopId: 'B', kind: 'plan-review', followUpTo: 'A', dispatchedAt: at(5), agentTimestamp: at(5) });
    assert.equal(feedOf([plan, review]).lanes[0].stage, 'Plan review');
  });

  test('(d) implementation ← plan-review ← reply: the walk stops at the nearest stage kind', () => {
    const build = run({ loopId: 'A', kind: 'implementation', dispatchedAt: at(60), agentTimestamp: at(50) });
    const review = run({ loopId: 'B', kind: 'plan-review', followUpTo: 'A', dispatchedAt: at(20), agentTimestamp: at(20) });
    const reply = run({ loopId: 'C', kind: 'custom', followUpTo: 'B', dispatchedAt: at(2), agentTimestamp: at(2) });
    assert.equal(feedOf([build, review, reply]).lanes[0].stage, 'Plan review');
  });

  test('(e) a lone custom run reads "Custom" (the identity source\'s own kind is the fallback)', () => {
    assert.equal(feedOf([run({ loopId: 'C', kind: 'custom' })]).lanes[0].stage, 'Custom');
  });

  test('(f) a two-loop follow-up cycle ends the walk and reads the identity source\'s kind', () => {
    const a = run({ loopId: 'A', kind: 'custom', followUpTo: 'B' });
    const b = run({ loopId: 'B', kind: 'custom', followUpTo: 'A' });
    const feed = feedOf([a, b]);
    assert.equal(feed.lanes.length, 1);
    assert.equal(feed.lanes[0].stage, 'Custom');
  });

  test('stageKindOf skips a null kind and an orchestration kind, and keeps walking', () => {
    const anchor = run({ loopId: 'A', kind: 'review' });
    const legacy = run({ loopId: 'B', kind: null, followUpTo: 'A' });
    const wake = run({ loopId: 'C', kind: 'wake', followUpTo: 'B' });
    const byLoopId = new Map([anchor, legacy, wake].map(l => [l.loopId, l]));
    assert.equal(stageKindOf(wake, byLoopId), 'review');
  });

  test('the stage word is one function: the task-page loader re-exports run-view\'s stageLabel', () => {
    assert.equal(loaderStageLabel, runViewStageLabel);
    assert.equal(runViewStageLabel('implementation'), 'Build');
  });
});

describe('the two waiting channels agree with the banner rule', () => {
  test('blocked reply B follows blocked A: one lane, waiting from B, the run id from the ledger', () => {
    const A = run({ loopId: 'A', wakeMarker: 'blocked', wakeAt: at(20), dispatchedAt: at(40), agentTimestamp: at(20) });
    const B = run({ loopId: 'B', kind: null, followUpTo: 'A', wakeMarker: 'blocked', wakeAt: at(4), waitingMessage: 'Second question?', dispatchedAt: at(10), agentTimestamp: at(4) });
    const loops = [A, B];
    const sessionIds = sessionIdByLoop(loops, { now: new Date(NOW) });
    const feed = feedOf(loops, [], { sessionIdByLoop: sessionIds });
    assert.equal(feed.lanes.length, 1);
    const lane = feed.lanes[0];
    assert.equal(lane.waiting, true);
    assert.equal(lane.waitingSince, Date.parse(at(4)), 'the wait time is B\'s');
    assert.equal(lane.waitingFor, 'Second question?');
    assert.equal(lane.sessionId, sessionIds.get('acme::A'), 'the reply is in the anchor\'s session');
    assert.equal(feed.summary.waiting, 1);
    assert.equal(feed.summary.working, 0);
  });

  test('the same chain with the reply working: one lane from the reply, not waiting', () => {
    const A = run({ loopId: 'A', wakeMarker: 'blocked', wakeAt: at(20), dispatchedAt: at(40), agentTimestamp: at(20) });
    const B = run({ loopId: 'B', kind: null, followUpTo: 'A', dispatchedAt: at(10), agentTimestamp: at(1) });
    const feed = feedOf([A, B]);
    assert.equal(feed.lanes.length, 1);
    assert.equal(feed.lanes[0].waiting, false);
    assert.equal(feed.summary.working, 1);
  });

  test('a stale blocked run and a fresh working run on one key: the fresh one holds the lane, not waiting (S1)', () => {
    // A: a plan-review that asked via [blocked] and has been silent 90 min.
    // B: an independent Build, heartbeating now. Same issue, different runs.
    const A = run({ loopId: 'A', kind: 'plan-review', wakeMarker: 'blocked', wakeAt: at(90), dispatchedAt: at(100), agentTimestamp: at(90) });
    const B = run({ loopId: 'B', kind: 'implementation', dispatchedAt: at(150), agentTimestamp: at(1) });
    const feed = feedOf([A, B]);
    assert.equal(feed.lanes.length, 1);
    assert.equal(feed.lanes[0].waiting, false);
    assert.equal(feed.lanes[0].stage, 'Build');
    assert.equal(feed.summary.working, 1);
    assert.equal(feed.summary.waiting, 0);
  });

  test('the stamp reads fresh members only: a stale waiting member does not make a fresh working lane wait', () => {
    const candidate = {
      origin: 'loop',
      lane: { workspaceUrlKey: 'acme', task: 'LIN-9', sinceMs: 0, lastActivityMs: NOW - 60_000 },
      members: [
        { state: 'waiting', lastActivityMs: NOW - 90 * 60_000, waitingSince: 1, waitingFor: 'old' },
        { state: 'working', lastActivityMs: NOW - 60_000 },
      ],
    };
    assert.equal(freshMembers(candidate, { now: NOW }).length, 1);
    assert.equal(chooseKeyLane([candidate], { now: NOW }), candidate.lane);
    assert.equal(LANE_RANK.waiting < LANE_RANK.working, true);
  });

  test('an agreement grid: lane membership and lane.waiting match the banner rule for every single-run cell', () => {
    const agentStates = ['running', 'waiting', 'complete'];
    const markers = [null, 'blocked', 'pending', 'done'];
    const terminals = [null, 'done', 'failed'];
    const closed = [false, true];
    for (const agentState of agentStates) for (const wakeMarker of markers) for (const terminalStatus of terminals) for (const isClosed of closed) {
      const loop = run({
        loopId: 'G', agentState, wakeMarker, wakeAt: wakeMarker ? at(3) : null, terminalStatus,
        terminalCompletedAt: terminalStatus ? at(1) : null,
        bookkeeping: isClosed ? { at: at(1) } : undefined,
      });
      const feed = feedOf([loop]);
      const bannerWaiting = loopIsWaiting(enrichLoop(loop));
      const member = (agentState === 'running' && !terminalStatus && !isClosed) || bannerWaiting;
      const label = JSON.stringify({ agentState, wakeMarker, terminalStatus, isClosed });
      if (member) {
        assert.equal(feed.lanes.length, 1, `member: ${label}`);
        assert.equal(feed.lanes[0].waiting, bannerWaiting, `lane.waiting matches the banner: ${label}`);
      } else {
        assert.equal(feed.lanes.length, 0, `not a member: ${label}`);
      }
    }
  });

  test('a superseded blocked run is not waiting: its reply\'s lane is shown and summary.waiting stays 0', () => {
    const A = run({ loopId: 'A', wakeMarker: 'blocked', wakeAt: at(20), dispatchedAt: at(40), agentTimestamp: at(20) });
    const R = run({ loopId: 'R', kind: null, followUpTo: 'A', dispatchedAt: at(5), agentTimestamp: at(1) });
    const feed = feedOf([A, R]);
    assert.equal(feed.summary.waiting, 0);
    assert.equal(feed.lanes.every(l => l.waiting === false), true);
  });
});

describe('the stream: derived moments, once, from the loop\'s own record', () => {
  test('a [done] run yields one finished row and no waiting row, though its wakeAt is set (W1)', () => {
    const done = run({ loopId: 'D', terminalStatus: 'done', terminalCompletedAt: at(3), wakeMarker: 'done', wakeAt: at(3), agentState: 'complete' });
    const feed = feedOf([done]);
    assert.equal(feed.events.filter(e => e.id === 'd:D:finished').length, 1);
    assert.equal(feed.events.filter(e => e.id === 'd:D:waiting').length, 0);
    assert.equal(feed.lanes.length, 0);
  });

  test('a harvested abort yields one stopped row and no waiting row (W1)', () => {
    const aborted = run({ loopId: 'X', terminalStatus: 'aborted', terminalCompletedAt: at(3), wakeMarker: 'aborted', wakeAt: at(3), agentState: 'error' });
    const feed = feedOf([aborted]);
    assert.equal(feed.events.filter(e => e.id === 'd:X:stopped').length, 1);
    assert.equal(feed.events.filter(e => e.id === 'd:X:waiting').length, 0);
  });

  test('a [failed] run and a [pending] run yield no waiting row', () => {
    const failed = run({ loopId: 'F', terminalStatus: 'failed', terminalCompletedAt: at(4), wakeMarker: 'failed', wakeAt: at(4), agentState: 'error' });
    const pending = run({ loopId: 'P', wakeMarker: 'pending', wakeAt: at(4) });
    const feed = feedOf([failed, pending]);
    assert.equal(feed.events.filter(e => e.id === 'd:F:failed').length, 1);
    assert.equal(feed.events.filter(e => e.id === 'd:F:waiting' || e.id === 'd:P:waiting').length, 0);
  });

  test('a closed-at-source row with a blocked marker yields no waiting row and no lane (LIN-3364)', () => {
    const feed = feedOf([run({ loopId: 'C', wakeMarker: 'blocked', wakeAt: at(4), bookkeeping: { at: at(1) } })]);
    assert.equal(feed.events.filter(e => e.id === 'd:C:waiting').length, 0);
    assert.equal(feed.lanes.length, 0);
  });

  test('a [blocked] run not superseded yields exactly one waiting row at wakeAt, and its lane says the same time', () => {
    const feed = feedOf([run({ loopId: 'B', wakeMarker: 'blocked', wakeAt: at(4) })]);
    const rows = feed.events.filter(e => e.id === 'd:B:waiting');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ts, Date.parse(at(4)));
    assert.equal(feed.lanes[0].waitingSince, Date.parse(at(4)));
  });

  test('an old digest (no wakeAt) gives a waiting lane with no time and no waiting row', () => {
    const feed = feedOf([run({ loopId: 'O', wakeMarker: 'blocked', wakeAt: null })]);
    assert.equal(feed.lanes[0].waiting, true);
    assert.equal(feed.lanes[0].waitingSince, null);
    assert.equal(feed.events.filter(e => e.id === 'd:O:waiting').length, 0);
  });

  test('a [done] status row folds into the finished moment: one row, stable across two builds', () => {
    const loops = [run({ loopId: 'D', terminalStatus: 'done', terminalCompletedAt: at(3), agentState: 'complete' })];
    const statusItems = [{ id: 'st-d', dispatchId: 'D', taskIdentifier: 'LIN-9', action: 'implementation', status: 'completed', summary: 'Shipped', timestamp: new Date(Date.parse(at(3)) + 1000).toISOString(), workspaceUrlKey: 'acme', workspaceName: 'Acme' }];
    const first = feedOf(loops, statusItems);
    const second = feedOf(loops, statusItems);
    for (const feed of [first, second]) {
      const rows = feed.events.filter(e => e.loopId === 'D');
      assert.equal(rows.length, 1, 'one stream row for the moment');
      assert.equal(rows[0].summary, 'Shipped', 'the merged row keeps the status row\'s words');
    }
  });

  test('a started row folds with a matching working status row, and an unmatched status row stays', () => {
    const loops = [run({ loopId: 'S', takenAt: at(20), dispatchedAt: at(21), agentTimestamp: at(19) })];
    const statusItems = [
      { id: 'st-s', dispatchId: 'S', taskIdentifier: 'LIN-9', action: 'implementation', status: 'in_progress', summary: 'Started', timestamp: at(19), workspaceUrlKey: 'acme', workspaceName: 'Acme' },
      { id: 'st-x', taskIdentifier: 'LIN-50', action: 'research', status: 'in_progress', summary: 'Lonely', timestamp: at(10), workspaceUrlKey: 'acme', workspaceName: 'Acme' },
    ];
    const { events } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW - 86_400_000, superseded: new Set() });
    assert.equal(events.filter(e => e.loopId === 'S').length, 1);
    assert.equal(events.filter(e => e.id === 'st-x').length, 1, 'a status row no run owns is kept as it is');
  });

  test('deriveLoopEvents gives a plain stage word on every derived row, never a raw kind', () => {
    const loops = [run({ loopId: 'R', kind: 'autopilot', takenAt: at(5), terminalStatus: 'done', terminalCompletedAt: at(1), agentState: 'complete' })];
    const byLoopId = new Map(loops.map(l => [l.loopId, l]));
    const rows = deriveLoopEvents(loops, { sinceMs: -Infinity, superseded: new Set(), byLoopId });
    assert.ok(rows.length >= 2);
    for (const r of rows) assert.notEqual(r.summary.toLowerCase().startsWith('autopilot'), true, r.summary);
  });

  test('a run\'s stream rows carry the run id from the ledger', () => {
    const loops = [run({ loopId: 'R1', terminalStatus: 'done', terminalCompletedAt: at(2), agentState: 'complete' })];
    const sessionIds = sessionIdByLoop(loops, { now: new Date(NOW) });
    const feed = feedOf(loops, [], { sessionIdByLoop: sessionIds });
    const row = feed.events.find(e => e.id === 'd:R1:finished');
    assert.equal(row.sessionId, sessionIds.get('acme::R1'));
  });
});

describe('paging: one pool, every row once', () => {
  test('more than 60 rows, paged to exhaustion: every id exactly once, a derived row past the 60th included', () => {
    const loops = [];
    for (let i = 0; i < 70; i++) {
      // distinct timestamps (one minute apart) so the strict `ts < before` cursor is not ambiguous
      loops.push(run({ loopId: `P${i}`, takenAt: at(i + 1), dispatchedAt: at(i + 2), agentTimestamp: at(i + 1), agentState: 'complete', terminalStatus: i % 2 ? 'done' : null, terminalCompletedAt: i % 2 ? at(i + 1) : null }));
    }
    const statusItems = [{ id: 'st-f', dispatchId: 'P3', taskIdentifier: 'LIN-9', action: 'implementation', status: 'completed', summary: 'Folded', timestamp: at(4), workspaceUrlKey: 'acme', workspaceName: 'Acme' }];
    const { events: pool } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW - 86_400_000, superseded: new Set() });
    const seen = [];
    let before = null;
    for (let guard = 0; guard < 20; guard++) {
      const { page, hasMore, oldestTs } = pageEvents(pool, { before, pageSize: 60 });
      seen.push(...page.map(e => e.id));
      if (!hasMore) break;
      before = oldestTs;
    }
    assert.equal(new Set(seen).size, seen.length, 'no id twice');
    assert.deepEqual([...new Set(seen)].sort(), pool.map(e => e.id).sort(), 'every pool row appears once');
    assert.ok(seen.includes('d:P69:started'), 'the oldest derived row past the first page is reachable');
    assert.equal(seen.filter(id => id === 'd:P3:finished').length, 1, 'the folded moment shows once');
    assert.equal(seen.includes('st-f'), false, 'the status row that folded in is not shown on its own');
  });
});

describe('the dot: red only for a failure nothing has followed', () => {
  test('a failed run with nothing after it is red (failedNow 1)', () => {
    const feed = feedOf([run({ loopId: 'F', terminalStatus: 'failed', terminalCompletedAt: at(120), dispatchedAt: at(130), agentTimestamp: at(120), agentState: 'error' })]);
    assert.equal(feed.summary.failedNow, 1);
  });

  test('a later working run on the same task clears it (failedNow 0)', () => {
    const feed = feedOf([
      run({ loopId: 'F', terminalStatus: 'failed', terminalCompletedAt: at(120), dispatchedAt: at(130), agentTimestamp: at(120), agentState: 'error' }),
      run({ loopId: 'W', dispatchedAt: at(10), agentTimestamp: at(2) }),
    ]);
    assert.equal(feed.summary.failedNow, 0);
  });

  test('a status-only lane on the failed task clears the dot (it is a lane on that key, not a later run)', () => {
    // The task's latest run failed. A status-only working row on the same task is a lane on
    // its key with no loop behind it, and that lane is what the page shows now: the dot clears.
    const failed = run({ loopId: 'F', issueIdentifier: 'LIN-7', dispatchedAt: at(60), takenAt: at(59), terminalStatus: 'failed', terminalCompletedAt: at(50), agentState: 'error' });
    const statusItems = [{ id: 'st-7', taskIdentifier: 'LIN-7', action: 'research', status: 'in_progress', summary: 'Looking again', timestamp: at(3), workspaceUrlKey: 'acme', workspaceName: 'Acme' }];
    const withLane = feedOf([failed], statusItems);
    assert.ok(withLane.lanes.some(l => l.task === 'LIN-7'), 'the status-only row is a lane on LIN-7');
    assert.equal(withLane.summary.failedNow, 0);
    assert.equal(feedOf([failed], []).summary.failedNow, 1, 'with no lane on the key, the failed run is red');
  });
  test('"0 working" with only a failure older than the 24 h window is not red', () => {
    const feed = feedOf([run({ loopId: 'O', terminalStatus: 'failed', terminalCompletedAt: at(29 * 60), dispatchedAt: at(30 * 60), agentTimestamp: at(29 * 60), agentState: 'error' })]);
    assert.equal(feed.summary.working, 0);
    assert.equal(feed.summary.failedNow, 0);
  });
});

describe('the run id: the session ledger\'s, never loopId or groupKey', () => {
  test('sessionIdByLoop gives a stitched follow-up its chain root\'s session, matching _buildSessions', () => {
    const A = run({ loopId: 'A', dispatchedAt: at(30), agentTimestamp: at(30), agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: at(29) });
    const B = run({ loopId: 'B', kind: null, followUpTo: 'A', dispatchedAt: at(10), agentTimestamp: at(10), agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: at(9) });
    const loops = [A, B].map(l => ({ ...l, workspaceUrlKey: 'acme' }));
    const map = sessionIdByLoop(loops, { now: new Date(NOW) });
    const sessions = __internal._buildSessions(loops, { issueGraph: null, now: new Date(NOW) });
    for (const session of sessions) for (const l of session.loops) {
      assert.equal(map.get(`acme::${l.loopId}`), session.sessionId, `${l.loopId} is in the ledger's session`);
    }
    assert.equal(map.get('acme::B'), map.get('acme::A'));
  });

  test('the index is per workspace: the same loop id in two workspaces keeps two keys', () => {
    const loops = [run({ loopId: 'Z', workspaceUrlKey: 'acme' }), run({ loopId: 'Z', workspaceUrlKey: 'globex' })];
    const map = sessionIdByLoop(loops, { now: new Date(NOW) });
    assert.ok(map.has('acme::Z') && map.has('globex::Z'));
  });
});

describe('run links: a bar and a status row carry the ledger id, not the loop id (LIN-3977 witness)', () => {
  // B is a stitched follow-up of A, so its ledger session is A's, not its own loopId.
  // A witness that a loopId-built link would fail: the id differs from 'B'.
  const chain = () => {
    const A = run({ loopId: 'A', dispatchedAt: at(30), agentTimestamp: at(30), agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: at(29) });
    const B = run({ loopId: 'B', kind: null, followUpTo: 'A', dispatchedAt: at(10), agentTimestamp: at(10), agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: at(9) });
    return [A, B].map(l => ({ ...l, workspaceUrlKey: 'acme' }));
  };

  test('the timeline bar of a stitched follow-up carries its chain root\'s session id', () => {
    const loops = chain();
    const sessionIds = sessionIdByLoop(loops, { now: new Date(NOW) });
    const root = sessionIds.get('acme::A');
    assert.notEqual(root, 'B', 'the session id is the ledger\'s, not the loop id');
    assert.equal(sessionIds.get('acme::B'), root);
    const feed = feedOf(loops, [], { sessionIdByLoop: sessionIds });
    const bars = feed.timeline.rows.flat();
    assert.equal(bars.find(r => r.id === 'B').sessionId, root);
    assert.equal(bars.find(r => r.id === 'A').sessionId, root);
  });

  test('a status row about a run keeps the run\'s session id when it is not folded into a derived moment', () => {
    const loops = chain();
    const sessionIds = sessionIdByLoop(loops, { now: new Date(NOW) });
    const statusItems = [{ id: 'st-b', dispatchId: 'B', taskIdentifier: 'LIN-9', action: 'implementation', status: 'in_progress', summary: 'Follow-up', timestamp: at(9), workspaceUrlKey: 'acme', workspaceName: 'Acme' }];
    // derivedSinceMs past every loop event: nothing derives, so the status row stands alone.
    const { events } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW + 1, superseded: new Set(), sessionIdByLoop: sessionIds });
    assert.equal(events.find(e => e.id === 'st-b').sessionId, sessionIds.get('acme::B'));
  });
});

describe('the fold: a status row joins only the run that owns it (LIN-3977 review finding 10a)', () => {
  test('two same-task runs that end within 5 minutes: the row folds into its own run, not the other', () => {
    // X and Y are two implementation runs on LIN-9 that finish two minutes apart. The
    // status row S is X's own match (its timestamp, action and summary are X's record).
    const X = run({ loopId: 'X', dispatchedAt: at(30), takenAt: at(29), terminalStatus: 'done', terminalCompletedAt: at(20), agentState: 'complete', agentTimestamp: at(20.5), agentSummary: 'X summary', agentAction: 'implementation' });
    const Y = run({ loopId: 'Y', dispatchedAt: at(19), takenAt: at(18.5), terminalStatus: 'done', terminalCompletedAt: at(18), agentState: 'complete', agentTimestamp: at(18.2), agentSummary: 'Y summary', agentAction: 'implementation' });
    const loops = [Y, X];
    const statusItems = [{ id: 'st-x', taskIdentifier: 'LIN-9', action: 'implementation', status: 'done', summary: 'X summary', timestamp: at(20.5), workspaceUrlKey: 'acme', workspaceName: 'Acme' }];
    const { events } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW - 86_400_000, superseded: new Set() });
    assert.equal(events.find(e => e.id === 'st-x'), undefined, 'the status row is folded, not shown beside its moment');
    const xFinished = events.find(e => e.id === 'd:X:finished');
    const yFinished = events.find(e => e.id === 'd:Y:finished');
    assert.equal(xFinished.summary, 'X summary', 'X\'s finished row keeps the row it owns');
    assert.notEqual(yFinished.summary, 'X summary', 'Y\'s finished row never takes X\'s summary');
  });
});

describe('promotion: one rule for stored flag and owner-with-runner', () => {
  test('liveConsoleOn truth table: a stored false opts out; a stored true opts in; unset follows the runner', () => {
    assert.equal(liveConsoleOn(undefined, false), false);
    assert.equal(liveConsoleOn(undefined, true), true, 'an owner with a runner and no stored flag gets it');
    assert.equal(liveConsoleOn(false, true), false, 'a stored false opts out even for an owner with a runner');
    assert.equal(liveConsoleOn(true, false), true, 'a stored true opts in');
    assert.equal(liveConsoleOn(true, true), true);
    assert.equal(liveConsoleOn(false, false), false);
  });
});

describe('the events gate: no wider than the page', () => {
  function appFor(session) {
    const app = express();
    app.use(createLiveConsoleRoutes({
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { id: 'ws-1', urlKey: 'acme', name: 'Acme' };
        req.session = { ...session, workspaces: [{ urlKey: 'acme', name: 'Acme' }] };
        next();
      },
      agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
      dispatchQueueStore: null,
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
    }));
    return app;
  }
  async function status(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
      return (await fetch(`http://127.0.0.1:${port}/workspace/acme/api/live-console/events`)).status;
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
  const resolverFor = ({ owner, runner }) => setRunControlsResolver(async () => ({ runControls: owner && runner, runSetup: false }));

  after(() => setRunControlsResolver(null));

  test('a non-owner with no stored flag gets 403', async () => {
    resolverFor({ owner: false, runner: true });
    assert.equal(await status(appFor({ accountId: 'a' })), 403);
  });

  test('an owner without a runner and no stored flag gets 403', async () => {
    resolverFor({ owner: true, runner: false });
    assert.equal(await status(appFor({ accountId: 'a' })), 403);
  });

  test('an owner with a runner and no stored flag gets 200', async () => {
    resolverFor({ owner: true, runner: true });
    assert.equal(await status(appFor({ accountId: 'a' })), 200);
  });

  test('a stored false gets 403 even for an owner with a runner', async () => {
    resolverFor({ owner: true, runner: true });
    assert.equal(await status(appFor({ accountId: 'a', features: { liveConsole: false } })), 403);
  });

  test('a stored true keeps today\'s result for a non-owner', async () => {
    resolverFor({ owner: false, runner: false });
    assert.equal(await status(appFor({ accountId: 'a', features: { liveConsole: true } })), 200);
  });

  test('requestFeatureFlags resolves the page\'s liveConsole the same way the events gate does', async () => {
    resolverFor({ owner: true, runner: true });
    const req = { workspace: { id: 'ws-1', urlKey: 'acme' }, session: { accountId: 'a' } };
    const flags = await requestFeatureFlags(req);
    assert.equal(flags.liveConsole, true);
  });
});
