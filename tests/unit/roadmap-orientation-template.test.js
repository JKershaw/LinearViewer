/**
 * Tests for the roadmap orientation prompt template (LIN-300, Step 1).
 *
 * Contract:
 *   - Enumerates the not-yet-started candidate queue (in-progress excluded;
 *     terminal states — completed/canceled/duplicate — already excluded by
 *     buildExecutionQueue and inherited here).
 *   - Instructs the model to return JSON only (an array of
 *     { identifier, bearing, reason, archived }).
 *   - Carries the drift-as-rationalization guard (north star is fixed) and the
 *     delivery-not-projections discipline, mirroring the north-star template.
 *
 * Run with: node --test tests/unit/roadmap-orientation-template.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildRoadmapOrientationMessages,
  buildRoadmapOrientationPrompt,
  serializeOrientationCandidates,
  countOrientationCandidates,
  ORIENTATION_BEARINGS,
  ORIENTATION_CANDIDATE_CAP
} from '../../lib/prompts/roadmap-orientation-template.js';
import { buildRoadmapModel } from '../../lib/roadmap.js';

// A roadmap model is normally produced by buildRoadmapModel; for the
// serialization unit tests we hand-build the only field the helper reads.
function modelWithQueue(queue) {
  return { executionQueue: queue };
}

describe('serializeOrientationCandidates', () => {
  test('includes not-yet-started (unstarted + backlog), excludes in-progress', () => {
    const candidates = serializeOrientationCandidates(modelWithQueue([
      { identifier: 'A-1', title: 'Todo task', projectName: 'Alpha', stateType: 'unstarted' },
      { identifier: 'A-2', title: 'In progress task', projectName: 'Alpha', stateType: 'started' },
      { identifier: 'A-3', title: 'Backlog task', projectName: 'Beta', stateType: 'backlog' }
    ]));
    const ids = candidates.map(c => c.identifier);
    assert.deepStrictEqual(ids, ['A-1', 'A-3']);
    assert.ok(!ids.includes('A-2'), 'in-progress work stays on the ship, not in candidates');
  });

  test('serializes identifier + title + project', () => {
    const [c] = serializeOrientationCandidates(modelWithQueue([
      { identifier: 'A-1', title: 'Todo task', projectName: 'Alpha', stateType: 'unstarted' }
    ]));
    assert.deepStrictEqual(c, { identifier: 'A-1', title: 'Todo task', project: 'Alpha' });
  });

  test('defaults a missing project to Unassigned', () => {
    const [c] = serializeOrientationCandidates(modelWithQueue([
      { identifier: 'A-1', title: 'Orphan', projectName: null, stateType: 'unstarted' }
    ]));
    assert.strictEqual(c.project, 'Unassigned');
  });

  test('empty / missing queue yields no candidates', () => {
    assert.deepStrictEqual(serializeOrientationCandidates(modelWithQueue([])), []);
    assert.deepStrictEqual(serializeOrientationCandidates({}), []);
    assert.deepStrictEqual(serializeOrientationCandidates(null), []);
  });

  // LIN-324: safety cap + uncapped count.
  test('caps the candidate list at the high safety ceiling (priority tail dropped)', () => {
    const queue = Array.from({ length: ORIENTATION_CANDIDATE_CAP + 25 }, (_, i) => ({
      identifier: 'Q-' + i, title: 'Task ' + i, projectName: 'Alpha', stateType: 'unstarted'
    }));
    const candidates = serializeOrientationCandidates(modelWithQueue(queue));
    assert.strictEqual(candidates.length, ORIENTATION_CANDIDATE_CAP, 'cap bites only past the ceiling');
    // Priority order preserved — the kept slice is the highest-priority head.
    assert.strictEqual(candidates[0].identifier, 'Q-0');
    assert.strictEqual(candidates[candidates.length - 1].identifier, 'Q-' + (ORIENTATION_CANDIDATE_CAP - 1));
  });

  test('cap is configurable (tests can disable it) but realistic sizes are untouched', () => {
    const queue = Array.from({ length: 44 }, (_, i) => ({
      identifier: 'Q-' + i, title: 'Task ' + i, projectName: 'Alpha', stateType: 'unstarted'
    }));
    // A real-sized queue (44) sits well under the cap — nothing dropped.
    assert.strictEqual(serializeOrientationCandidates(modelWithQueue(queue)).length, 44);
    // Explicit small cap drops the tail; cap <= 0 disables capping.
    assert.strictEqual(serializeOrientationCandidates(modelWithQueue(queue), { cap: 10 }).length, 10);
    assert.strictEqual(serializeOrientationCandidates(modelWithQueue(queue), { cap: 0 }).length, 44);
  });

  test('countOrientationCandidates returns the uncapped total (drives token scaling + drop detection)', () => {
    const queue = Array.from({ length: ORIENTATION_CANDIDATE_CAP + 7 }, (_, i) => ({
      identifier: 'Q-' + i, title: 'Task ' + i, projectName: 'Alpha', stateType: 'unstarted'
    }));
    // in-progress work is still excluded from the count, mirroring serialize.
    queue.push({ identifier: 'WIP', title: 'Running', projectName: 'Alpha', stateType: 'started' });
    assert.strictEqual(countOrientationCandidates(modelWithQueue(queue)), ORIENTATION_CANDIDATE_CAP + 7);
    const dropped = countOrientationCandidates(modelWithQueue(queue))
      - serializeOrientationCandidates(modelWithQueue(queue)).length;
    assert.strictEqual(dropped, 7, 'count - capped length = the surfaced tail-drop');
  });

  test('inherits buildExecutionQueue terminal filtering — duplicates excluded', () => {
    // buildExecutionQueue drops completed/canceled/DUPLICATE (LIN-276); the
    // candidate queue inherits that for free since it reads executionQueue.
    const issues = [
      { id: '1', identifier: 'A-1', title: 'Todo', state: { type: 'unstarted', name: 'Todo' }, project: { name: 'Alpha' } },
      { id: '2', identifier: 'A-2', title: 'Dup', state: { type: 'duplicate', name: 'Duplicate' }, project: { name: 'Alpha' } },
      { id: '3', identifier: 'A-3', title: 'Done', state: { type: 'completed', name: 'Done' }, project: { name: 'Alpha' } },
      { id: '4', identifier: 'A-4', title: 'WIP', state: { type: 'started', name: 'In Progress' }, project: { name: 'Alpha' } }
    ];
    const model = buildRoadmapModel([{ id: 'p', name: 'Alpha' }], issues);
    const ids = serializeOrientationCandidates(model).map(c => c.identifier);
    assert.deepStrictEqual(ids, ['A-1'], 'only the not-yet-started, non-terminal task is a candidate');
  });
});

describe('buildRoadmapOrientationMessages', () => {
  const model = modelWithQueue([
    { identifier: 'A-1', title: 'Ship onboarding', projectName: 'Alpha', stateType: 'unstarted' }
  ]);
  const northStar = 'Be the simplest way to ship software.';

  test('returns a system + user messages array', () => {
    const messages = buildRoadmapOrientationMessages(model, northStar);
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('enumerates candidates by identifier + title + project in the user message', () => {
    const messages = buildRoadmapOrientationMessages(model, northStar);
    const user = messages[1].content;
    assert.ok(user.includes('A-1'), 'identifier present');
    assert.ok(user.includes('Ship onboarding'), 'title present');
    assert.ok(user.includes('Alpha'), 'project present');
    assert.ok(user.includes(northStar), 'north star included verbatim');
  });

  test('instructs JSON-only output with the four-field shape', () => {
    const prompt = buildRoadmapOrientationPrompt(model, northStar);
    assert.ok(/JSON ONLY/i.test(prompt), 'demands JSON only');
    assert.ok(/no code fences/i.test(prompt), 'forbids code fences');
    for (const key of ['identifier', 'bearing', 'reason', 'archived']) {
      assert.ok(prompt.includes(`"${key}"`), `mentions the ${key} field`);
    }
  });

  test('emits the 8-point compass vocabulary', () => {
    const prompt = buildRoadmapOrientationPrompt(model, northStar);
    assert.ok(prompt.includes(ORIENTATION_BEARINGS.join(', ')), 'lists the 8-point set');
    assert.deepStrictEqual(ORIENTATION_BEARINGS, ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });

  test('carries the drift-as-rationalization guard (north star is fixed)', () => {
    const prompt = buildRoadmapOrientationPrompt(model, northStar);
    assert.ok(/north star is FIXED/i.test(prompt), 'states the north star is fixed');
    assert.ok(/never.*(suggest|describe).*north.star|never.*north-star edits/i.test(prompt),
      'forbids suggesting north-star edits');
  });

  test('carries the delivery-not-projections discipline', () => {
    const prompt = buildRoadmapOrientationPrompt(model, northStar);
    assert.ok(/DELIVERY, NOT PROJECTIONS/i.test(prompt), 'states the delivery discipline');
    assert.ok(/ETA|projection|forecast/i.test(prompt), 'forbids projection language');
  });

  test('renders a placeholder when there are no candidates', () => {
    const user = buildRoadmapOrientationMessages(modelWithQueue([]), northStar)[1].content;
    assert.ok(/no not-yet-started candidate/i.test(user));
  });
});
