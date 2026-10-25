/**
 * LIN-3833 — the opened task's "Needs you" line: a subtask that needs you, named with an Open link.
 *
 * Witnesses:
 *  - `subtaskNeedingYouOf` names the first subtask whose row state says it needs you, with its task-page
 *    link (the top task's source carried), and says nothing when no subtask needs you, when there is no
 *    row-state map (a viewer with no sessions), or when the top task has no subtasks.
 *  - Home's prompt options carry `topTaskSubtask` when a subtask needs you, and are byte-identical to
 *    today when none does (the key is added only when set).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subtaskNeedingYouOf } from '../../lib/task-board-view.js';
import { renderPage } from '../../lib/render.js';

const TOP = {
  identifier: 'LIN-10',
  source: 'linear',
  subtasks: [
    { id: 'a', identifier: 'LIN-11', title: 'Quiet child', stateType: 'started' },
    { id: 'b', identifier: 'LIN-12', title: 'Waiting child', stateType: 'started' }
  ]
};

describe('LIN-3833 subtaskNeedingYouOf — the top task\'s subtask that needs you', () => {
  test('names the subtask that needs you, with its task-page link', () => {
    const rowStates = new Map([
      ['LIN-11', { needsYou: false }],
      ['LIN-12', { needsYou: true }]
    ]);
    assert.deepEqual(
      subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }),
      { identifier: 'LIN-12', title: 'Waiting child', href: '/workspace/acme/task/LIN-12?source=linear' }
    );
  });

  test('says nothing when no subtask needs you', () => {
    const rowStates = new Map([['LIN-11', { needsYou: false }], ['LIN-12', { needsYou: false }]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }), null);
  });

  test('says nothing without row states (a copy-first viewer reads no sessions)', () => {
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates: null }), null);
  });

  test('says nothing when the top task has no subtasks, or there is no top task', () => {
    const rowStates = new Map([['LIN-12', { needsYou: true }]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: { identifier: 'LIN-1', source: 'linear' }, rowStates }), null);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: null, rowStates }), null);
  });
});

describe('LIN-3833 — Home\'s prompt options carry the subtask only when one needs you', () => {
  const fixture = (over = {}) => renderPage([], [], [], 'Test', {
    urlKey: 'acme',
    workspace: { urlKey: 'acme', provider: 'linear' },
    topTaskId: 'linear:top',
    topTaskWhy: [],
    ...over
  });

  test('a subtask that needs you is in the page options', () => {
    const html = fixture({ topTaskSubtask: { identifier: 'LIN-12', title: 'Waiting child', href: '/workspace/acme/task/LIN-12' } });
    assert.match(html, /topTaskSubtask/);
    assert.match(html, /LIN-12/);
  });

  test('with no subtask needing you, the options are unchanged (no topTaskSubtask key)', () => {
    assert.equal(/topTaskSubtask/.test(fixture({ topTaskSubtask: null })), false);
  });
});
