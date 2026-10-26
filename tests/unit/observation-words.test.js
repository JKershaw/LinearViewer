/**
 * LIN-3983 PR 2: the words the Observation card reads, built on the server.
 *
 *   - `stageWord` (per run and per session) comes from the same `stageLabel` the
 *     Live Console reads, so the two pages never name a stage differently.
 *   - `stageSince` is when the stage the card is about started. It is the
 *     waiting question's producer when the session waits, else its most recent
 *     run, so the card can say how long that stage has run.
 *
 * Built on the real `buildSessionPayload`, so these pin what the feed sends.
 * Run with: node --test tests/unit/observation-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionPayload } from '../../routes/dashboard-feed.js';
import { stageLabel } from '../../lib/run-view.js';

const WS = { urlKey: 'acme', name: 'Acme' };
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();
const EARLIER = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function loop(over = {}) {
  return {
    loopId: 'w', lineageId: null, kind: 'implementation', followUpTo: null, sessionId: 'S',
    issueIdentifier: 'LIN-900', workspaceUrlKey: 'acme', dispatchedAt: RECENT, resolvedAt: null,
    decision: null, decisionCase: [], answeredDecisions: [], withdrawal: null,
    wakeMarker: null, waitingMessage: null,
    ...over
  };
}
const anchor = (over = {}) => loop({ loopId: 'ap', lineageId: 'ap', kind: 'autopilot', sessionId: 'ap', issueIdentifier: null, ...over });
const blocked = (over = {}) => loop({ wakeMarker: 'blocked', waitingMessage: '[blocked] which way?', ...over });

describe('stageWord and stageSince on a session (LIN-3983 PR 2)', () => {
  test('a waiting session names the stage of the run it waits on, from stageLabel', () => {
    const p = buildSessionPayload({ sessionId: 'S', loops: [anchor(), blocked({ loopId: 'w', kind: 'plan-review', dispatchedAt: EARLIER })] }, WS, false);
    assert.equal(p.waiting, true);
    assert.equal(p.producerLoopId, 'w');
    assert.equal(p.stageWord, stageLabel('plan-review'));
    assert.equal(p.stageSince, new Date(EARLIER).toISOString(), 'the stage started when its run was dispatched');
  });

  test('a running session names its most recent run', () => {
    const p = buildSessionPayload({
      sessionId: 'S',
      loops: [anchor(), loop({ loopId: 'old', kind: 'research', dispatchedAt: EARLIER, resolvedAt: EARLIER }), loop({ loopId: 'now', kind: 'implementation', dispatchedAt: RECENT })]
    }, WS, false);
    assert.equal(p.waiting, false);
    assert.equal(p.stageWord, stageLabel('implementation'));
    assert.equal(p.stageSince, new Date(RECENT).toISOString());
  });

  test('a session with no run has no stage: both fields are null, not a placeholder', () => {
    const p = buildSessionPayload({ sessionId: 'S', loops: [] }, WS, false);
    assert.equal(p.runs.length, 0);
    assert.equal(p.stageWord, null);
    assert.equal(p.stageSince, null);
  });
});

describe('stageWord per run (LIN-3983 PR 2)', () => {
  test('each run carries its stage word, and an unlabelled run carries null', () => {
    const p = buildSessionPayload({
      sessionId: 'S',
      loops: [anchor(), loop({ loopId: 'a', kind: 'implementation' }), loop({ loopId: 'b', kind: null })]
    }, WS, false);
    const byId = Object.fromEntries(p.runs.map(r => [r.loopId, r.stageWord]));
    assert.equal(byId.a, stageLabel('implementation'));
    assert.equal(byId.b, null);
  });
});
