/**
 * LIN-4049 review fixes (items 4, 6, and the cap's page read): the task page's own pill and next line read the subtree's
 * rolled-up state; a full child page is over the cap and fails closed; the Linear detail asks for one page past the cap.
 *
 * Witnesses: the pill follows the rolled-up state and keeps the page's own words when the state agrees with the task; the
 * next line for a viewer with no run control names the subtask that runs, needs you, or is over the cap.
 */
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { renderTaskStatus, renderNextLine } from '../../lib/render-task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');

/** A model the page renders, as `buildTaskPageModel` shapes it, for a task with no sessions of its own. */
const idleModel = (over = {}) => ({
  identifier: 'LIN-1', status: 'idle', sentence: 'No sessions yet.', sentenceAt: null, waitingFor: null, sessions: [],
  guesses: [], nextStep: { kind: 'research', label: 'Research', why: 'usual', failed: false, reason: 'the next step for this task' },
  finished: false, ...over,
});

describe('LIN-4049 review 4 — the page\'s pill reads the rolled-up state', () => {
  test('a parent whose subtask runs reads running, not the idle its own sessions say', () => {
    const html = renderTaskStatus(idleModel(), { now: NOW, taskState: { state: 'running' } });
    assert.match(html, /data-testid="task-page-status-pill"[^>]*>(?:<[^>]+>)*running</);
    assert.match(html, /A subtask is running\./, 'the sentence names the subtask, not "No sessions yet"');
  });

  test('the same state as the task\'s own status keeps the page\'s own words', () => {
    const waiting = idleModel({ status: 'waiting', sentence: 'Waiting on a question.', waitingFor: 'ruling' });
    const html = renderTaskStatus(waiting, { now: NOW, taskState: { state: 'needs-you' } });
    assert.match(html, /task-status-pill[^>]*>(?:<[^>]+>)*waiting</);
    assert.match(html, /Waiting on a question\./, 'the task\'s own sentence stands when the state agrees with it');
  });

  test('with no rolled-up state the page renders as before (share and repaint paths that have none)', () => {
    const html = renderTaskStatus(idleModel({ status: 'idle', sentence: 'No sessions yet.' }), { now: NOW });
    assert.match(html, /task-status-pill[^>]*>(?:<[^>]+>)*idle</);
    assert.match(html, /No sessions yet\./);
  });
});

describe('LIN-4049 review 6 — the next line for a viewer with no run control', () => {
  test('a subtask that runs is named, instead of the task\'s own next step', () => {
    assert.match(renderNextLine(idleModel(), { taskState: { state: 'running' } }), />A subtask is running, so nothing else is offered yet\./);
  });

  test('a subtask that needs you says the question is open', () => {
    assert.match(renderNextLine(idleModel(), { taskState: { state: 'needs-you' } }), />Nothing comes next until a subtask that needs you is answered\./);
  });

  test('over the cap or incomplete, the plain sentence the box gives is the next line', () => {
    const note = 'This task has more subtasks than the run box checks, so it offers no run. Open a subtask to run it.';
    assert.match(renderNextLine(idleModel(), { taskState: { state: 'todo' }, note }), />This task has more subtasks than the run box checks/);
  });

  test('with no subtree state the task\'s own line stands (a leaf, or a share page)', () => {
    assert.match(renderNextLine(idleModel()), />Research comes next\./);
  });
});

describe('LIN-4049 — a parent whose child page is full fails closed, and the Linear read asks for one page past the cap', () => {
  const ctxWithChildren = (n) => ({
    issue: { id: 'id-LIN-1', identifier: 'LIN-1', title: 'Parent', state: { name: 'In Progress', type: 'started' }, labels: [], description: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' },
    parent: null,
    children: Array.from({ length: n }, (_, i) => ({ id: `id-LIN-${300 + i}`, identifier: `LIN-${300 + i}`, title: 'Child', state: { name: 'Todo', type: 'unstarted' } })),
    comments: [],
    stateTransitions: [],
  });

  test('101 direct children is over the cap: the page reads nothing below and says why', async () => {
    const provider = {
      async fetchRecommendationContext(_scope, id, opts) {
        if (id === 'LIN-1' || !opts?.noDescend) return ctxWithChildren(101);
        throw new Error('no child may be read past the cap');
      },
      async fetchIssueComments() { return []; },
      async fetchIssueFields() { return null; },
      async fetchProjects() { return { projects: [] }; },
    };
    const loader = createTaskPageLoader({
      enrichLoop, deriveSessionWaiting, getLoopsForIssue: async () => [],
      taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
      shelvedRulingsStore: { listForWorkspaces: async () => [] }, now: () => NOW,
    });
    const page = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-1', access: { provider, callScope: 'tok' } });
    assert.equal(page.subtree.incomplete, false, 'over the cap is not an incomplete read');
    assert.equal(page.taskState.state !== undefined, true);
    assert.match(page.note, /more subtasks than the run box checks/);
  });

  test('the issue detail asks Linear for one page past the cap, not its default of 50', async () => {
    const source = await readFile(new URL('../../lib/providers/linear/index.js', import.meta.url), 'utf8');
    assert.match(source, /\n {6}children\(first: 101\) \{/, 'the top-level children connection is read to 101');
  });
});
