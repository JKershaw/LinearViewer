// LIN-3968: the copy-first view says which task a written prompt is for, so the `done` event carries the target's
// title. The mock stream (test mode) is the path Home's e2e and the judge run through; the production descent is
// pinned in recommend-one-path.test.js. A stub stream would hide a dropped `title`, so this one reads the real route.
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testMockData } from '../../lib/sample-data/mock-data.js';
import { streamMockFixture } from '../../routes/workspace-api.js';

const PARENT = { id: 'lin3968-parent', identifier: 'TTL-1', title: 'Container for the title', description: 'd', url: 'https://linear.app/test/issue/TTL-1', parent: null, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };
const CHILD = { id: 'lin3968-child', identifier: 'TTL-2', title: 'Write the test for the title', description: 'd', url: 'https://linear.app/test/issue/TTL-2', parent: { id: PARENT.id }, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };

before(() => { testMockData.issues.push(PARENT, CHILD); });
after(() => { testMockData.issues = testMockData.issues.filter(i => i !== PARENT && i !== CHILD); });

/** A response stand-in that records what the route writes; enough for openSse and sendSSE. */
function fakeRes() {
  const chunks = [];
  return {
    chunks,
    set() {},
    flushHeaders() {},
    write(chunk) { chunks.push(String(chunk)); },
    end() {},
  };
}

function doneEvents(res) {
  return res.chunks.join('').split('\n\n')
    .filter(block => block.startsWith('event: done'))
    .map(block => JSON.parse(block.split('\n').find(line => line.startsWith('data: ')).slice('data: '.length)));
}

describe('LIN-3968: the mock stream names the target task on done', () => {
  test('a container descends, and done carries the target identifier and its title', () => {
    const res = fakeRes();
    streamMockFixture(res, PARENT);
    const [done] = doneEvents(res);
    assert.ok(done, 'the stream ends with a done event');
    assert.equal(done.identifier, CHILD.identifier, 'the prompt is for the subtask the container routed to');
    assert.equal(done.title, CHILD.title, 'the title rides on done, so the copy-first view can name the task');
  });
});
