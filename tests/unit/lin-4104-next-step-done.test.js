// LIN-4104 D3: the recommend stream's `done` event carries the stage (`kind`) and the terminal issue's id (`issueId`), so
// the Next step confirm can say which stage it is and dispatch on the right issue (a defer into a subtask). The client's
// one recommend call (fetchPrompt('__ai__') → .../recommend/:issueId/stream) reads these; no second route is added.
//
// The test-mode mock stream is read through the real route (streamMockFixture), so a dropped field fails here.
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testMockData } from '../../lib/sample-data/mock-data.js';
import { streamMockFixture } from '../../routes/workspace-api.js';

const PARENT = { id: 'lin4104-parent', identifier: 'TTL-41', title: 'Container for the next step', description: 'd', url: 'https://linear.app/test/issue/TTL-41', parent: null, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };
const CHILD = { id: 'lin4104-child', identifier: 'TTL-42', title: 'Write the next step', description: 'd', url: 'https://linear.app/test/issue/TTL-42', parent: { id: PARENT.id }, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };
const LEAF = { id: 'lin4104-leaf', identifier: 'TTL-43', title: 'A leaf task', description: 'd', url: 'https://linear.app/test/issue/TTL-43', parent: null, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };

before(() => { testMockData.issues.push(PARENT, CHILD, LEAF); });
after(() => { testMockData.issues = testMockData.issues.filter(i => i !== PARENT && i !== CHILD && i !== LEAF); });

/** A response stand-in that records what the route writes; enough for openSse and sendSSE. */
function fakeRes() {
  const chunks = [];
  return { chunks, set() {}, flushHeaders() {}, write(chunk) { chunks.push(String(chunk)); }, end() {} };
}

function doneEvents(res) {
  return res.chunks.join('').split('\n\n')
    .filter(block => block.startsWith('event: done'))
    .map(block => JSON.parse(block.split('\n').find(line => line.startsWith('data: ')).slice('data: '.length)));
}

describe('LIN-4104 D3: the stream\'s done names the stage and the issue it is for (test-mode mock stream)', () => {
  test('a leaf: done carries the stage as a dispatch kind and the issue id, beside identifier and title', () => {
    const res = fakeRes();
    streamMockFixture(res, LEAF);
    const [done] = doneEvents(res);
    assert.ok(done, 'the stream ends with a done event');
    assert.equal(done.identifier, LEAF.identifier);
    assert.equal(done.issueId, LEAF.id, 'the terminal issue id, so Run dispatches on it');
    assert.equal(done.kind, 'implementation', 'the stage the recommendation names, as a dispatch kind');
  });

  test('a container that defers into a subtask: done carries the subtask\'s id and its stage, not the container\'s', () => {
    const res = fakeRes();
    streamMockFixture(res, PARENT);
    const [done] = doneEvents(res);
    assert.equal(done.identifier, CHILD.identifier, 'the prompt is for the subtask');
    assert.equal(done.issueId, CHILD.id, 'Run dispatches on the subtask (a defer into a subtask)');
    assert.equal(done.kind, 'implementation');
    assert.ok(done.deferredVia.includes(PARENT.identifier), 'the container it routed through is named');
  });
});
