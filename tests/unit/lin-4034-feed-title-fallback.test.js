/**
 * LIN-4034 — the live-console feed names each task, from the loops it already holds.
 *
 * A lane, a timeline run and every stream event take the task's title, and a timeline run or event
 * takes its `issueSource`, read from a loop for the SAME identifier in the same workspace. The
 * fallback never reads the store or the tracker, so the events poll stays free of both (LIN-1436).
 * A task with no loop in the window stays title-less: that is the honest floor.
 *
 * Run with: node --test tests/unit/lin-4034-feed-title-fallback.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConsoleFeed, buildConsoleEvents, buildTimeline, deriveLanes, issueFactsByTask
} from '../../lib/live-console.js';

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();

// A running loop on LIN-9 by default. Override anything.
function run(over = {}) {
  return {
    loopId: 'L',
    issueIdentifier: 'LIN-9',
    issueTitle: null,
    issueSource: undefined,
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
    target: 'cli',
    telemetry: { metrics: [], producedArtifacts: [] },
    ...over,
  };
}

const feedOf = (loops, statusItems = []) => buildConsoleFeed({ statusItems, loops }, { now: NOW });

// A finished loop on the same task that carries the title. It is not a lane member, so it only
// donates its facts to the task.
const titled = (over = {}) => run({
  loopId: 'DONE', issueTitle: 'Ship the thing', issueSource: 'linear',
  terminalStatus: 'done', terminalCompletedAt: at(20), agentState: 'done',
  dispatchedAt: at(60), agentTimestamp: at(20), ...over,
});

describe('LIN-4034 — a lane takes its task\'s title from a same-identifier loop in the window', () => {
  test('a title-less live loop takes the title of a finished loop for the same identifier', () => {
    const { lanes } = feedOf([run({ loopId: 'LIVE' }), titled()]);
    const lane = lanes.find(l => l.task === 'LIN-9');
    assert.ok(lane, 'the live loop is the lane');
    assert.equal(lane.title, 'Ship the thing');
  });

  test('the identity source\'s own title wins over the fallback', () => {
    const { lanes } = feedOf([run({ loopId: 'LIVE', issueTitle: 'Own title' }), titled()]);
    assert.equal(lanes.find(l => l.task === 'LIN-9').title, 'Own title');
  });

  test('a loop for ANOTHER identifier never supplies the title', () => {
    const { lanes } = feedOf([run({ loopId: 'LIVE' }), titled({ loopId: 'OTHER', issueIdentifier: 'LIN-10', issueTitle: 'Not this one' })]);
    assert.equal(lanes.find(l => l.task === 'LIN-9').title, null, 'LIN-9 must not borrow LIN-10\'s title');
  });

  test('a loop for the same identifier in ANOTHER workspace never supplies the title', () => {
    const { lanes } = feedOf([run({ loopId: 'LIVE' }), titled({ workspaceUrlKey: 'beta' })]);
    assert.equal(lanes.find(l => l.task === 'LIN-9' && l.workspaceUrlKey === 'acme').title, null);
  });

  test('a status-only lane (no loop in the window) stays title-less', () => {
    const statusItems = [{ id: 's1', taskIdentifier: 'LIN-77', status: 'working', action: 'implementation', summary: 'x', timestamp: at(1), workspaceUrlKey: 'acme' }];
    const { lanes } = feedOf([], statusItems);
    const lane = lanes.find(l => l.task === 'LIN-77');
    assert.ok(lane);
    assert.equal(lane.title, null);
    assert.deepEqual(deriveLanes([{ ...statusItems[0], kind: 'working', task: 'LIN-77', workspaceUrlKey: 'acme', ts: NOW - 60_000 }])[0].title, null);
  });
});

describe('LIN-4034 — a timeline run carries its task\'s title, and issueSource only when one is known', () => {
  test('a title-less run takes its task\'s title and issueSource from a same-identifier loop', () => {
    const { runs } = buildTimeline([run({ loopId: 'LIVE' }), titled()], { now: NOW });
    const live = runs.find(r => r.id === 'LIVE');
    assert.equal(live.title, 'Ship the thing');
    assert.equal(live.issueSource, 'linear');
  });

  test('issueSource is absent (not null) when no loop for the task carries one', () => {
    const { runs } = buildTimeline([run({ loopId: 'LIVE' })], { now: NOW });
    const live = runs.find(r => r.id === 'LIVE');
    assert.equal(live.title, null);
    assert.equal('issueSource' in live, false, 'the field is sparse, as on lanes');
  });

  test('the run\'s own issueSource wins over the task\'s', () => {
    const { runs } = buildTimeline([run({ loopId: 'LIVE', issueSource: 'github' }), titled()], { now: NOW });
    assert.equal(runs.find(r => r.id === 'LIVE').issueSource, 'github');
  });
});

describe('LIN-4034 — every kind of event carries its task\'s title and issueSource', () => {
  test('status, evidence and derived events for a titled task all carry the title and source', () => {
    const loops = [
      titled({
        telemetry: { metrics: [], producedArtifacts: [{ label: 'PR', url: 'https://example.test/pr/1', timestamp: at(15) }] },
      }),
    ];
    const statusItems = [{ id: 's1', taskIdentifier: 'LIN-9', status: 'working', action: 'implementation', summary: 'x', timestamp: at(18), workspaceUrlKey: 'acme', dispatchId: 'DONE' }];
    const { events } = buildConsoleEvents({ statusItems, loops, derivedSinceMs: NOW - 86_400_000, superseded: new Set() });
    const kinds = new Set(events.map(e => e.kind));
    assert.ok(kinds.has('evidence') && kinds.has('done') && events.some(e => e.id === 's1' || e.summary === 'x'), `events:\n${JSON.stringify(events, null, 2)}`);
    for (const ev of events) {
      assert.equal(ev.title, 'Ship the thing', `event ${ev.id} (${ev.kind}) must carry the title`);
      assert.equal(ev.issueSource, 'linear', `event ${ev.id} (${ev.kind}) must carry the source`);
    }
  });

  test('an event for a task with no loop in the window carries no title and no source', () => {
    const statusItems = [{ id: 's2', taskIdentifier: 'LIN-404', status: 'working', action: 'review', summary: 'y', timestamp: at(3), workspaceUrlKey: 'acme' }];
    const { events } = buildConsoleEvents({ statusItems, loops: [], derivedSinceMs: -Infinity, superseded: new Set() });
    const ev = events.find(e => e.id === 's2');
    assert.ok(ev);
    assert.equal(ev.title, null);
    assert.equal('issueSource' in ev, false);
  });

  test('the history pager\'s builder carries the same titles as the live poll (one pool, one fold)', () => {
    const loops = [run({ loopId: 'LIVE' }), titled()];
    const polled = feedOf(loops).events.filter(e => e.task === 'LIN-9');
    const paged = buildConsoleEvents({ statusItems: [], loops, derivedSinceMs: -Infinity, superseded: new Set() }).events.filter(e => e.task === 'LIN-9');
    assert.ok(paged.length > 0);
    for (const ev of paged) assert.equal(ev.title, 'Ship the thing');
    assert.deepEqual(paged.map(e => e.id).sort(), polled.map(e => e.id).sort());
  });
});

describe('LIN-4034 — the title index is read from the loops alone', () => {
  test('issueFactsByTask takes one argument, the loops, and never a store or a provider', () => {
    assert.equal(issueFactsByTask.length, 1);
  });

  test('the first non-empty title wins for the task; a later one does not replace it', () => {
    const facts = issueFactsByTask([run({ loopId: 'A' }), run({ loopId: 'B', issueTitle: 'First' }), run({ loopId: 'C', issueTitle: 'Second' })]);
    assert.equal(facts.get('acme::LIN-9').title, 'First');
  });

  test('a task key is its workspace and identifier, never the identifier alone', () => {
    const facts = issueFactsByTask([run({ loopId: 'A', issueTitle: 'Acme copy' }), run({ loopId: 'B', workspaceUrlKey: 'beta', issueTitle: 'Beta copy' })]);
    assert.equal(facts.get('acme::LIN-9').title, 'Acme copy');
    assert.equal(facts.get('beta::LIN-9').title, 'Beta copy');
  });
});
