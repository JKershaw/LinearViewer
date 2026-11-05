/**
 * LIN-4143 — the task page's question card has the same effect as the feed's row for the same loops.
 *
 * Witness (commit 1, expected green at base): the task page's card rows are read through the live-run guard
 * (`deriveSessionDecisions` → `liveOnAnchor`), so for a waiting ruling with a live run on its task the card's
 * `effect` equals the feed's, and the rendered `data-effect` matches. The unguarded reduction over the same loops
 * gives `effect: null`, so this test would fail if the page read the ruling without the guard.
 *
 * Run with: node --test tests/unit/lin-4143-task-page-guard.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { collectUnansweredDecisions, rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { liveOnAnchor } from '../../lib/live-anchor.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-06T15:00:00.000Z');
const URL_KEY = 'acme';
const UUID = '11111111-2222-3333-4444-555555555555';
const PAGE_OPTIONS = { deployInfo: { version: 't', commit: 't' }, featureFlags: {}, workspaces: [] };

function loop(over = {}) {
  return {
    loopId: 'loop-x', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'T', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running', target: 'cli',
    dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [],
    telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null,
    ...over,
  };
}
// A waiting worker whose wait has message text but no wake marker: its ruling is read-only (`indeterminate`), so its
// effect is decided by the live-run guard alone. The waiting loop is itself non-terminal, so the guard matches it.
const waitingNoMarker = (over = {}) => loop({
  loopId: 'impl-2', agentState: 'waiting', waitingMessage: 'which API key?',
  decision: { decision_id: 'd-key', question: 'which API key?' }, ...over,
});
// A `[blocked]` waiting worker: resumable, so its effect is `resume` whatever the guard says.
const blocked = (over = {}) => loop({
  loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?',
  feedback: [{ message: '[blocked] which API key?' }], decision: { decision_id: 'd-key', question: 'which API key?' }, ...over,
});

const pick = (rows) => rows.map((r) => ({ id: r.decision?.decision_id, disposition: r.disposition, effect: r.effect }));

/** The task page's model over one task's loops, as the page-load path builds it (the workspace's ruling standing). */
function taskPageFor(loops) {
  const ruling = rulingStandingOf({ urlKey: URL_KEY, loops, shelvedRulings: [] }, { now: NOW, enrichLoop });
  return buildTaskPageModel({
    identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, deriveSessionDecisions, ruling, now: NOW,
  });
}

/** The feed's row reduction over the same loops: the feed hands `liveOnAnchor` over the merged loops (routes/dashboard-rulings.js). */
function feedRowsFor(loops) {
  const enriched = loops.map(enrichLoop);
  return collectUnansweredDecisions(
    { loops: enriched, taskDecisions: [], shelvedRulings: [], newestScanByTask: {} },
    { now: NOW, liveDispatchOnAnchor: liveOnAnchor(enriched) }
  );
}

/** The same reduction with no live-run predicate: what a page that read the ruling without the guard would show. */
function unguardedRowsFor(loops) {
  const enriched = loops.map(enrichLoop);
  return collectUnansweredDecisions({ loops: enriched, taskDecisions: [], shelvedRulings: [], newestScanByTask: {} }, { now: NOW });
}

describe('LIN-4143 witness: the task page card has the feed\'s effect for the same loops', () => {
  test('a waiting ruling with a live run on its task: the card reads record, as the feed does', () => {
    const loops = [waitingNoMarker(), loop()];
    const model = taskPageFor(loops);

    assert.equal(model.waitingFor, 'ruling', 'the owner is being asked');
    const cardRows = pick(model.question.decisions);
    const feedRows = pick(feedRowsFor(loops));
    assert.deepEqual(cardRows, [{ id: 'd-key', disposition: 'indeterminate', effect: 'record' }]);
    assert.deepEqual(cardRows, feedRows, 'the task page card row equals the feed row for the same loops');

    // The foil: without the live-run guard the same ruling reads effect null, so the equality above is not vacuous.
    assert.deepEqual(pick(unguardedRowsFor(loops)), [{ id: 'd-key', disposition: 'indeterminate', effect: null }]);

    const html = renderTaskPage(model, { viewer: 'owner', urlKey: URL_KEY, binding: { source: 'linear' }, stateUrl: '/s', now: NOW, pageOptions: PAGE_OPTIONS, taskState: null });
    assert.match(html, /data-testid="session-question-card"[^>]*data-effect="record"/, 'the rendered card carries the same effect');
  });

  test('a resumable ruling with a live run on its task: the card reads resume, as the feed does', () => {
    const loops = [blocked(), loop()];
    const model = taskPageFor(loops);

    const cardRows = pick(model.question.decisions);
    assert.deepEqual(cardRows, [{ id: 'd-key', disposition: 'resumable', effect: 'resume' }]);
    assert.deepEqual(cardRows, pick(feedRowsFor(loops)));
  });
});
