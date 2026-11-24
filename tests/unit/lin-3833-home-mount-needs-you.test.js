/**
 * LIN-3833 — the subtask "needs you" line reaches the opened task on any Home row, not only the top task
 * (review 1b874ec6, finding 3). This reads the real opts `public/app.js` mounts each opened task with
 * (`homePromptOpts`, a module export since LIN-4463 piece 5) over two placeholders: the top task (nothing waiting) and a
 * row below it (a child waiting). The line must reach the row's own opts through the lookup by node key.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

// A placeholder as the server emits it: identity on data attributes, one per opened task.
const placeholder = (nodeKey, issueId) => ({
  dataset: { issueId, identifier: `LIN-${issueId}`, title: `Task ${issueId}`, url: '', source: 'linear', stateType: 'started', nodeKey, instanceKey: nodeKey },
});

describe('LIN-3833 — the needs-you line is passed to each mounted opened task by its node key', () => {
  test('a row below the top task gets its own waiting child; the top task gets none', async (t) => {
    const world = importWorld({ window: { addEventListener() {} } });
    t.after(() => world.restore());
    const { homePromptOpts } = await world.importPage('app.js');
    const page = {
      topTaskId: 'linear:top',
      // LIN-4016: the row's decision record carries its subtask line (`attention`).
      rowData: { 'linear:row-b': { container: true, finished: false, copyStep: { label: '__ai__', name: null, why: '' }, trackerWord: 'In progress', attention: { identifier: 'LIN-22', title: 'Waiting child', href: '/workspace/acme/task/LIN-22', state: 'needs-you', lead: 'A subtask needs you', detail: '', words: 'A subtask needs you: LIN-22' } } },
      defaultPromptKeys: [], morePromptKeys: [],
    };

    assert.deepEqual(homePromptOpts(placeholder('linear:row-b', '2'), page).row.attention, { identifier: 'LIN-22', title: 'Waiting child', href: '/workspace/acme/task/LIN-22', state: 'needs-you', lead: 'A subtask needs you', detail: '', words: 'A subtask needs you: LIN-22' });
    assert.equal(homePromptOpts(placeholder('linear:top', '1'), page).row, null);
  });
});
