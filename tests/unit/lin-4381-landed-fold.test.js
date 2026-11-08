/**
 * LIN-4381 — the `landed` lane state in foldPeriodicalRuns (lib/periodical-runs.js).
 *
 * A lane reads `landed` only when it is a `scope: 'repo'` template, would
 * otherwise read `recent`, has no queue row, has a same-repo landing newer than
 * its last run, and its last run is at least LANDED_MIN_GAP_MS old. `due` beats
 * it, a landing on a Periodical's own issue is ignored, and `never` is
 * untouched. The fold stays pure: landings arrive as data.
 *
 * tests/unit/periodical-runs.test.js is left unchanged; these cases are new.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { foldPeriodicalRuns, LANDED_MIN_GAP_MS } from '../../lib/periodical-runs.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse('2026-11-08T12:00:00Z');
const HISTORY_TTL_MS = 30 * DAY_MS;
const ago = ms => new Date(NOW - ms).toISOString();

const repoTemplate = { id: 'seams-tangles', title: 'Seams & Tangles', mode: 'corrective', scope: 'repo', cadence: 'weekly' };
const workspaceTemplate = { id: 'recent-headwinds', title: 'Recent Headwinds', mode: 'advisory', scope: 'workspace', cadence: 'weekly' };

function run(overrides = {}) {
  return {
    kind: 'periodical',
    periodicalId: repoTemplate.id,
    promptName: repoTemplate.title,
    issueIdentifier: null,
    dispatchedAt: ago(3 * DAY_MS),
    status: 'taken',
    followUpTo: null,
    abort: false,
    repo: null,
    feedback: [{ message: '[done] Task completed', timestamp: ago(3 * DAY_MS) }],
    ...overrides
  };
}

const landing = (overrides = {}) => ({
  repo: 'JKershaw/LinearViewer',
  mergedAt: ago(DAY_MS),
  issueIdentifier: 'LIN-1',
  ...overrides
});

function fold({ templates = [repoTemplate], queueRows = [], historyRows = [run()], landings } = {}) {
  const rows = { queueRows, historyRows };
  if (landings !== undefined) rows.landings = landings;
  return foldPeriodicalRuns(templates, rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
}

describe('LIN-4381: foldPeriodicalRuns — landed', () => {
  test('LANDED_MIN_GAP_MS is one day', () => {
    assert.equal(LANDED_MIN_GAP_MS, DAY_MS);
  });

  test('a recent lane with a newer same-repo landing, past the gap, reads landed (lane and top level)', () => {
    const [result] = fold({ landings: [landing()] });
    assert.equal(result.repos[0].state, 'landed');
    assert.equal(result.state, 'landed');
  });

  test('a lane past its cadence with landings still reads due: the floor wins', () => {
    const [result] = fold({ historyRows: [run({ dispatchedAt: ago(8 * DAY_MS) })], landings: [landing()] });
    assert.equal(result.repos[0].state, 'due');
    assert.equal(result.state, 'due');
  });

  test('a queue row beats a landing', () => {
    const [result] = fold({ queueRows: [run({ status: undefined, feedback: undefined })], landings: [landing()] });
    assert.equal(result.repos[0].state, 'recent');
    assert.equal(result.state, 'recent');
  });

  test('a landing older than the last run leaves the lane recent', () => {
    const [result] = fold({ landings: [landing({ mergedAt: ago(4 * DAY_MS) })] });
    assert.equal(result.repos[0].state, 'recent');
  });

  test('a landing merged exactly at the last run is not newer: recent', () => {
    const [result] = fold({ landings: [landing({ mergedAt: ago(3 * DAY_MS) })] });
    assert.equal(result.repos[0].state, 'recent');
  });

  test('a landing inside the one-day gap leaves the lane recent; at the gap it reads landed', () => {
    const inside = fold({ historyRows: [run({ dispatchedAt: ago(DAY_MS - HOUR_MS) })], landings: [landing({ mergedAt: ago(HOUR_MS) })] });
    assert.equal(inside[0].repos[0].state, 'recent');
    const atGap = fold({ historyRows: [run({ dispatchedAt: ago(DAY_MS) })], landings: [landing({ mergedAt: ago(HOUR_MS) })] });
    assert.equal(atGap[0].repos[0].state, 'landed');
  });

  test('a failed or empty events read (no landings, or the key absent) gives recent', () => {
    assert.equal(fold({ landings: [] })[0].state, 'recent');
    assert.equal(fold({})[0].state, 'recent');
    assert.equal(fold({ landings: null })[0].state, 'recent');
  });

  test('a landing on an issue a Periodical row names leaves the lane recent', () => {
    const [result] = fold({
      historyRows: [run(), run({ kind: 'review', issueIdentifier: 'LIN-900', dispatchedAt: ago(3 * DAY_MS) })],
      landings: [landing({ issueIdentifier: 'LIN-900' })]
    });
    assert.equal(result.repos[0].state, 'recent');
    assert.equal(result.state, 'recent');
  });

  test('the exclusion counts every Periodical row: a failed run and a queued run name their issue too', () => {
    const failed = run({ kind: 'review', issueIdentifier: 'LIN-901', feedback: [{ message: '[failed] boom', timestamp: ago(2 * DAY_MS) }] });
    assert.equal(fold({ historyRows: [run(), failed], landings: [landing({ issueIdentifier: 'LIN-901' })] })[0].state, 'recent');
    const queuedOtherLane = run({ repo: 'simple-dispatcher', issueIdentifier: 'LIN-902', status: undefined, feedback: undefined });
    assert.equal(fold({ queueRows: [queuedOtherLane], landings: [landing({ issueIdentifier: 'LIN-902' })] })[0].repos
      .find(r => r.repo === null).state, 'recent');
  });

  test('a landing on an unrelated issue still reads landed beside an excluded one', () => {
    const [result] = fold({
      historyRows: [run(), run({ kind: 'review', issueIdentifier: 'LIN-900' })],
      landings: [landing({ issueIdentifier: 'LIN-900' }), landing({ issueIdentifier: 'LIN-77' })]
    });
    assert.equal(result.state, 'landed');
  });

  test('the null lane matches a landing in any repo, even one whose repo could not be read', () => {
    assert.equal(fold({ landings: [landing({ repo: 'someone/else' })] })[0].repos[0].state, 'landed');
    assert.equal(fold({ landings: [landing({ repo: null })] })[0].repos[0].state, 'landed');
  });

  test('a named lane matches equivalent spellings of its repo and no other repo', () => {
    const lane = spelling => fold({
      historyRows: [run({ repo: spelling })],
      landings: [landing({ repo: 'JKershaw/LinearViewer' })]
    })[0].repos.find(r => r.repo === spelling).state;
    for (const spelling of ['LinearViewer', 'linearviewer', 'JKershaw/LinearViewer', 'jkershaw/linearviewer', 'https://github.com/JKershaw/LinearViewer', 'https://github.com/JKershaw/LinearViewer.git', 'JKershaw/LinearViewer/']) {
      assert.equal(lane(spelling), 'landed', `lane "${spelling}" should match JKershaw/LinearViewer`);
    }
    for (const spelling of ['simple-dispatcher', 'someone/LinearViewer', 'LinearViewer2']) {
      assert.equal(lane(spelling), 'recent', `lane "${spelling}" should not match JKershaw/LinearViewer`);
    }
    // A named lane never matches a landing whose repo could not be read.
    assert.equal(fold({ historyRows: [run({ repo: 'LinearViewer' })], landings: [landing({ repo: null })] })[0].repos[0].state, 'recent');
  });

  test('lanes are judged apart: a landing in one repo leaves another named lane recent', () => {
    const [result] = fold({
      historyRows: [run({ repo: 'LinearViewer' }), run({ repo: 'simple-dispatcher' })],
      landings: [landing({ repo: 'JKershaw/simple-dispatcher' })]
    });
    const byRepo = Object.fromEntries(result.repos.map(r => [r.repo, r.state]));
    assert.deepEqual(byRepo, { LinearViewer: 'recent', 'simple-dispatcher': 'landed' });
    assert.equal(result.state, 'landed');
  });

  test('a workspace-scoped template never reads landed', () => {
    const [result] = fold({
      templates: [workspaceTemplate],
      historyRows: [run({ periodicalId: workspaceTemplate.id, promptName: workspaceTemplate.title })],
      landings: [landing()]
    });
    assert.equal(result.repos[0].state, 'recent');
    assert.equal(result.state, 'recent');
  });

  test('a lane reading never is unchanged by landings, and so is its top level', () => {
    const [result] = fold({ historyRows: [], landings: [landing({ mergedAt: ago(HOUR_MS) })] });
    assert.equal(result.repos[0].state, 'never');
    assert.equal(result.state, 'never');
    assert.equal(result.lastDispatchedAt, null);
  });

  test('top level reads landed when it would read recent and some lane reads landed, even with a queue row on another lane', () => {
    const [result] = fold({
      queueRows: [run({ repo: 'simple-dispatcher', status: undefined, feedback: undefined })],
      historyRows: [run({ repo: 'LinearViewer' })],
      landings: [landing()]
    });
    const byRepo = Object.fromEntries(result.repos.map(r => [r.repo, r.state]));
    assert.deepEqual(byRepo, { 'simple-dispatcher': 'recent', LinearViewer: 'landed' });
    assert.equal(result.state, 'landed');
  });

  test('a top level reading due is untouched by landings', () => {
    // The top level ages from the newest run across lanes, so when it is due every
    // lane is due too and none can read landed; landings change nothing here.
    const [result] = fold({ historyRows: [run({ dispatchedAt: ago(9 * DAY_MS) })], landings: [landing({ mergedAt: ago(HOUR_MS) })] });
    assert.equal(result.state, 'due');
  });

  test('the fold stays pure: identical inputs give identical output and the inputs are not mutated', () => {
    const input = { historyRows: [run()], landings: [landing()] };
    const snapshot = JSON.stringify(input);
    const a = fold(input);
    const b = fold(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), snapshot);
  });

  test('lane entries keep exactly their six published keys', () => {
    const [result] = fold({ landings: [landing()] });
    assert.deepEqual(Object.keys(result.repos[0]).sort(), ['daysSince', 'isDefault', 'lastDispatchedAt', 'repo', 'runs', 'state']);
  });
});
