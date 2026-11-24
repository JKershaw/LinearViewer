/**
 * LIN-4558: a run parked on a child says what it waits on, and its lane stays on Live Console.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4558-waiting-lane.test.js
 *
 * End to end over the pure readers: the run's feedback goes through the real telemetry builder
 * (lib/session-telemetry.js buildRunTelemetry, which reads parseParkedWait) and then the real Live Console
 * feed (lib/live-console.js buildConsoleFeed, which drops a lane silent past laneStaleMs, 60 min). The
 * runner lines are the exact shapes simple-dispatcher sends: its waiting heartbeat for a PENDING-EXTERNAL
 * park (heartbeat.js buildWaitingMessage) and its background-wait beat (buildHeartbeatMessage).
 *
 * Before LIN-4558 the waiting check knew only "scheduled wakeup", and neither line minted a heartbeat metric
 * (no tool count), so a parked run read as working and dropped off Live Console an hour after its last tool beat.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as telemetry from '../../lib/session-telemetry.js';
import { buildConsoleFeed } from '../../lib/live-console.js';
import { sessionIdByLoop as buildSessionIdByLoop } from '../../lib/pipeline-loops.js';

const { buildRunTelemetry, parseParkedWait } = telemetry;

const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

// A run row as the loop builder hands it to Live Console, with its telemetry built from its feedback.
function runLoop(feedback, over = {}) {
  return {
    loopId: 'parent-1',
    issueIdentifier: 'LIN-1',
    issueTitle: 'Parent',
    agentState: 'running',
    terminalStatus: null,
    dispatchedAt: at(0),
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    telemetry: buildRunTelemetry({ dispatchedAt: at(0), feedback }),
    ...over,
  };
}

const WORK = { kind: 'heartbeat', message: '[working · editing] 6 tools in 4m: Edit×4, Bash×2 · 6 total · next heartbeat in ≤30s', timestamp: at(5) };
const PARK = { kind: 'status', message: '[pending] Not done — waiting on LIN-9 to finish the build. Awaiting completion...', timestamp: at(10) };
const WAITING_WHAT = 'child run LIN-9 "Child build" (run child-1)';

// The runner's waiting heartbeat every 5 minutes from the park to `untilMin`.
function waitingBeats(fromMin, untilMin) {
  const out = [];
  for (let m = fromMin; m <= untilMin; m += 5) {
    const age = m - 10;
    out.push({ kind: 'heartbeat', message: `[waiting] waiting on ${WAITING_WHAT} · ${age}m · next heartbeat in ≤5m`, timestamp: at(m) });
  }
  return out;
}

const NOW = T0 + 102 * 60000;
const sessionIdByLoop = new Map([['acme::parent-1', 'S-parent'], ['acme::child-1', 'S-child']]);
const feed = (loops) => buildConsoleFeed({ loops }, { now: NOW, sessionIdByLoop });

describe('LIN-4558 Live Console: a PENDING-EXTERNAL park with waiting heartbeats for 90 minutes', () => {
  const loopWith = runLoop([WORK, PARK, ...waitingBeats(15, 100)]);

  test('stays on Live Console', () => {
    const { lanes } = feed([loopWith]);
    assert.equal(lanes.length, 1, 'the parked lane is still listed 92 minutes after the park');
    assert.equal(lanes[0].task, 'LIN-1');
  });

  test('shows what it waits on, since when, and links the child run', () => {
    const [lane] = feed([loopWith]).lanes;
    assert.equal(lane.parkedWait.what, 'child run LIN-9 "Child build"');
    assert.equal(lane.parkedWait.since, at(10), 'the wait is measured from the park, not the latest beat');
    assert.equal(lane.parkedWait.latest, at(100));
    assert.deepEqual(lane.parkedWait.runIds, ['child-1']);
    assert.equal(lane.parkedWait.childSessionId, 'S-child');
    assert.equal(Math.round((NOW - Date.parse(lane.parkedWait.since)) / 60000), 92, 'how long: 92 minutes');
  });

  test('the same run without waiting heartbeats drops off', () => {
    const { lanes } = feed([runLoop([WORK, PARK])]);
    assert.equal(lanes.length, 0);
  });

  test('a run whose waiting beats stopped over an hour ago drops off too (beats are proof of life, not a pass)', () => {
    const { lanes } = feed([runLoop([WORK, PARK, ...waitingBeats(15, 40)])]);
    assert.equal(lanes.length, 0);
  });
});

describe('LIN-4558 Live Console: a background sub-agent wait inside a turn', () => {
  const STOP = { kind: 'status', message: '[working · verifying] Not done yet — sub-agent "Explore tests" still pending. Awaiting completion...', timestamp: at(10) };
  const beat = (m) => ({ kind: 'heartbeat', message: `[working · verifying] verifying in background (Explore tests) · idle ${m - 10}m · next heartbeat in ≤10m`, timestamp: at(m) });

  test('with its background beats for 90 minutes it stays, waiting on the sub-agent', () => {
    const beats = [];
    for (let m = 20; m <= 100; m += 10) beats.push(beat(m));
    const { lanes } = feed([runLoop([WORK, STOP, ...beats])]);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0].parkedWait.what, 'Explore tests');
    assert.equal(lanes[0].parkedWait.since, at(10));
    assert.equal(lanes[0].parkedWait.childSessionId, undefined, 'no child run to link');
  });
});

describe('LIN-4558 the waiting check recognises each runner wait line', () => {
  const line = (m) => (typeof telemetry.parseParkedWaitLine === 'function' ? telemetry.parseParkedWaitLine(m) : null);

  test('the waiting heartbeat: what, without the run ids, and the run ids', () => {
    assert.deepEqual(line(`[waiting] waiting on ${WAITING_WHAT} · 48m · next heartbeat in ≤5m`), { what: 'child run LIN-9 "Child build"', runIds: ['child-1'] });
    assert.deepEqual(line('[waiting] waiting on 2 child runs: LIN-1 (run a1), LIN-2 (run b2) · 3m · next heartbeat in ≤5m'), { what: '2 child runs: LIN-1, LIN-2', runIds: ['a1', 'b2'] });
  });

  test('the background-wait beat ("[working · verifying] … (task)")', () => {
    assert.deepEqual(line('[working · verifying] verifying in background (npm run test:e2e) · idle 12m · next heartbeat in ≤10m'), { what: 'npm run test:e2e', runIds: [] });
    assert.deepEqual(line('[working · verifying] verifying in background (scheduled wakeup) · idle 2m · next heartbeat in ≤1m'), { what: 'a scheduled wakeup', runIds: [] });
  });

  test('the park statuses: PENDING-EXTERNAL, a structural wait, PENDING-INTERNAL', () => {
    assert.deepEqual(line(PARK.message), { what: 'waiting on LIN-9 to finish the build', runIds: [] });
    assert.deepEqual(line('[pending] waiting for CI'), { what: null, runIds: [] });
    assert.deepEqual(line('[working · verifying] Not done yet — background task "e2e" still pending. Awaiting completion...'), { what: 'background task "e2e"', runIds: [] });
    assert.deepEqual(line('[working · verifying] Not done — the deploy is still rolling. Awaiting self-completion...'), { what: 'the deploy is still rolling', runIds: [] });
  });

  test('not waits: real work, completion unconfirmed, the coordinator cross-check, a blocked question', () => {
    assert.equal(line('[working · editing] 6 tools in 4m: Edit×4 · 6 total'), null);
    assert.equal(line('[working · verifying] verifying in background (completion unconfirmed) · idle 3m · next heartbeat in ≤1m'), null);
    assert.equal(line('[working · verifying] Completion unconfirmed — no DONE/PENDING sentinel in the reply. Awaiting confirmation...'), null);
    assert.equal(line('[working · verifying] Confirming completion — asked the agent to declare DONE or PENDING...'), null);
    assert.equal(line('[blocked] Which branch should I use?'), null);
    assert.equal(line('pending review from the team'), null);
  });

  test('parseParkedWait takes what from the newest line that says, across a bare [pending]', () => {
    const fb = [
      { message: '[pending] waiting for CI', timestamp: 't1' },
      { kind: 'heartbeat', message: '[waiting] waiting on the CI run · 5m · next heartbeat in ≤5m', timestamp: 't2' },
    ];
    assert.deepEqual(parseParkedWait(fb), { since: 't1', latest: 't2', what: 'the CI run' });
  });
});

// The run page links a parked run's child only when the child is a row on the same run page (lib/render-run-steps.js
// parkedChildLink); Live Console links it through the session index. These two cases pin which children share a page.
describe('LIN-4558 which child runs share the parent\'s run page', () => {
  const row = (loopId, over = {}) => ({
    loopId, workspaceUrlKey: 'acme', kind: 'worker', target: 'cli', issueIdentifier: `LIN-${loopId.length}`,
    dispatchedAt: at(0), sessionId: null, followUpTo: null, ...over,
  });

  test('under an autopilot window a parent and its child are one run page: the run page can link the child in page', () => {
    const ap = { loopId: 'ap-1', workspaceUrlKey: 'acme', kind: 'autopilot', issueIdentifier: 'LIN-1', dispatchedAt: at(-1), sessionId: null, followUpTo: null };
    const ids = buildSessionIdByLoop([ap, row('parent-1', { sessionId: 'ap-1' }), row('child-1', { sessionId: 'ap-1', parentSessionId: 'parent-1' })]);
    assert.equal(ids.get('acme::child-1'), ids.get('acme::parent-1'));
  });

  test('a worker with no autopilot and the child it dispatched are two runs: only Live Console can link the child', () => {
    const ids = buildSessionIdByLoop([row('parent-1'), row('child-1', { parentSessionId: 'parent-1', rootItemId: 'parent-1' })]);
    assert.notEqual(ids.get('acme::child-1'), ids.get('acme::parent-1'));
    const lane = buildConsoleFeed({ loops: [runLoop([PARK, ...waitingBeats(15, 15)])] }, { now: T0 + 20 * 60000, sessionIdByLoop: ids }).lanes[0];
    assert.equal(lane.parkedWait.childSessionId, ids.get('acme::child-1'));
  });
});
