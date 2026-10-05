/**
 * LIN-3300: the stage selector reads the task's recent runs from Harbour's dispatch
 * record, as plain facts, instead of reconstructing them from the ticket's prose.
 *
 * Run with: node --test tests/unit/recent-runs.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recentRuns, loadRecentRuns, formatRecentRuns, RECENT_RUNS } from '../../lib/recent-runs.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';

const fb = (message, timestamp) => ({ message, timestamp });
const row = (kind, over = {}) => ({ kind, status: 'taken', dispatchedAt: '2026-10-04T14:00:00.000Z', feedback: [], ...over });
const done = (kind, at) => row(kind, { feedback: [fb('[working] started', at), fb('[done] finished', at)] });

describe('recentRuns (LIN-3300)', () => {
  test('each stage run reads as its stage, outcome and time, oldest first', () => {
    const runs = recentRuns([
      done('plan', '2026-10-04T14:51:34.000Z'),
      done('plan-review', '2026-10-04T14:46:34.000Z'),
      row('implementation', { feedback: [fb('[failed] the runner gave up', '2026-10-04T15:10:00.000Z')] }),
      row('review', { feedback: [fb('[blocked] needs a decision', '2026-10-04T15:20:00.000Z')] }),
      row('close-out', { dispatchedAt: '2026-10-04T15:30:00.000Z', feedback: [fb('[working] on it', '2026-10-04T15:31:00.000Z')] })
    ]);
    assert.deepEqual(runs, [
      { stage: 'plan-review', at: '2026-10-04T14:46:34.000Z', outcome: 'done' },
      { stage: 'plan', at: '2026-10-04T14:51:34.000Z', outcome: 'done' },
      { stage: 'implementation', at: '2026-10-04T15:10:00.000Z', outcome: 'failed' },
      { stage: 'review', at: '2026-10-04T15:20:00.000Z', outcome: 'waiting on a person' },
      { stage: 'close-out', at: '2026-10-04T15:30:00.000Z', outcome: 'running' }
    ]);
  });

  test('only stage runs that ran count, and only the newest few', () => {
    const notStages = [row('custom'), row('autopilot'), row('wake'), row('plan', { abort: true }),
      row('plan', { status: 'cancelled' }), row('plan', { status: 'expired' })];
    assert.deepEqual(recentRuns(notStages), []);
    const many = Array.from({ length: 8 }, (_, i) => done('plan', `2026-10-0${i + 1}T00:00:00.000Z`));
    const kept = recentRuns(many);
    assert.equal(kept.length, RECENT_RUNS);
    assert.equal(kept[0].at, '2026-10-04T00:00:00.000Z', 'the oldest kept is the fifth newest');
  });

  test('loadRecentRuns reads the queue and the history, and never throws', async () => {
    const store = {
      listItems: async (urlKey, { issueIdentifier }) => (issueIdentifier === 'LIN-1' ? [row('implementation', { dispatchedAt: '2026-10-05T00:00:00.000Z', status: undefined })] : []),
      listHistory: async () => ({ items: [done('plan', '2026-10-04T00:00:00.000Z')] })
    };
    assert.deepEqual(await loadRecentRuns(store, 'acme', 'LIN-1'), [
      { stage: 'plan', at: '2026-10-04T00:00:00.000Z', outcome: 'done' },
      { stage: 'implementation', at: '2026-10-05T00:00:00.000Z', outcome: 'queued' }
    ]);
    assert.deepEqual(await loadRecentRuns(null, 'acme', 'LIN-1'), []);
    assert.deepEqual(await loadRecentRuns({ listItems: async () => { throw new Error('down'); } }, 'acme', 'LIN-1'), []);
  });

  test('no runs, no lines', () => {
    assert.equal(formatRecentRuns([]), '');
    assert.equal(formatRecentRuns(undefined), '');
  });
});

describe('the selector sees a revised plan from the runs alone (LIN-3300)', () => {
  const issue = { identifier: 'LIN-3309', title: 'A planned leaf', description: 'Goal.\n\n## Implementation Plan\n\nThe plan.', state: { name: 'In Progress', type: 'started' }, labels: [] };
  const verdict = { user: 'Agent', createdAt: '2026-10-04T14:46:17.000Z', body: '### Plan Review Verdict\n\n**Verdict:** Request Changes.' };
  const person = { user: 'John', createdAt: '2026-10-04T14:48:05.000Z', body: 'F3 is right; take the narrow revision.' };
  const runs = recentRuns([done('plan', '2026-10-04T14:34:25.000Z'), done('plan-review', '2026-10-04T14:46:34.000Z'), done('plan', '2026-10-04T14:51:34.000Z')]);
  const prompt = (context) => buildRouterPrompt(buildSelectorArgs(issue, { comments: [verdict, person], ...context }));

  test('a plan run after the verdict, with nothing in the comments, is a visible fact', () => {
    const p = prompt({ runs });
    const list = p.slice(p.indexOf('- Recent runs on this task'));
    assert.match(list, /^- Recent runs on this task, from Harbour's dispatch record \(oldest first\):\n  - plan: done, 2026-10-04 14:34\n  - plan-review: done, 2026-10-04 14:46\n  - plan: done, 2026-10-04 14:51\n/);
    assert.match(p, /latest: request changes \(2026-10-04 14:46\)/, 'the verdict time is comparable with the runs');
    assert.doesNotMatch(p, /an agent acted after it \(a note/, 'with runs, the comment-derived reading is left out');
    assert.match(p, /- Latest person's comment[^\n]*2026-10-04 14:48 \(shown with the comments\)\n/);
  });

  test('with no runs the selector decides from the ticket, as before', () => {
    const p = prompt({});
    assert.doesNotMatch(p, /Recent runs/);
    assert.match(p, /an agent acted after it \(a note, landed work or a close-out\): no/);
  });
});
