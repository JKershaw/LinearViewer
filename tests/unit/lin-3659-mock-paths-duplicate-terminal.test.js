// LIN-3659: the three mock/e2e-fake paths decide "open child" with
// isTerminalState (lib/providers/state-map.js), so a `duplicate` child counts as
// closed like completed/canceled (LIN-276), matching LIN-3656's real surfaces.
// Fixture: a parent whose only child is `duplicate`. Red on main (the literal
// `!== 'completed' && !== 'canceled'` pair kept the duplicate child open).
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testMockData } from '../../lib/sample-data/mock-data.js';
import { planMockDescent } from '../../lib/workspace-api-mocks.js';
import { buildMockAnswer } from '../../routes/task-chat.js';
import { buildApp, call } from './lib/proxy-fake-deps.js';

const PARENT = { id: 'lin3659-parent', identifier: 'DUP-1', title: 'Finished parent', description: 'd', url: 'https://linear.app/test/issue/DUP-1', parent: null, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };
const DUP_CHILD = { id: 'lin3659-child', identifier: 'DUP-2', title: 'Duplicate child', description: 'd', url: 'https://linear.app/test/issue/DUP-2', parent: { id: PARENT.id }, project: { id: 'proj-alpha', name: 'Project Alpha' }, state: { name: 'Duplicate', type: 'duplicate' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } };

before(() => { testMockData.issues.push(PARENT, DUP_CHILD); });
after(() => { testMockData.issues = testMockData.issues.filter(i => i !== PARENT && i !== DUP_CHILD); });

describe('LIN-3659: duplicate child is closed on the mock paths', () => {
  test('planMockDescent: a parent whose only child is duplicate is a plain leaf', () => {
    assert.equal(planMockDescent(PARENT), null);
  });

  test('buildMockAnswer: a duplicate child is not an open subtask', () => {
    const answer = buildMockAnswer({ issue: PARENT, children: [DUP_CHILD] }, 'status?', null);
    assert.doesNotMatch(answer, /open subtask/);
    assert.match(answer, /All of my subtasks are complete/);
  });

  test('mock recommend: a duplicate child is not deferred to', async () => {
    const app = buildApp({ resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }) });
    const res = await call(app, 'get', `/api/proxy/recommend/${PARENT.identifier}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.recommendedAction, 'recommend');
    assert.deepEqual(res.body.deferredVia, [PARENT.identifier], 'resolves at the parent itself, no descent');
    assert.doesNotMatch(JSON.stringify(res.body), /actionable work lives in/);
  });

  test('control: a todo child still counts as open on all three paths', async () => {
    const todo = { ...DUP_CHILD, state: { name: 'Todo', type: 'unstarted' } };
    testMockData.issues[testMockData.issues.indexOf(DUP_CHILD)] = todo;
    try {
      assert.ok(planMockDescent(PARENT));
      assert.match(buildMockAnswer({ issue: PARENT, children: [todo] }, 'q', null), /1 open subtask/);
      const app = buildApp({ resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }) });
      const res = await call(app, 'get', `/api/proxy/recommend/${PARENT.identifier}`);
      assert.match(JSON.stringify(res.body), /DUP-2/);
    } finally {
      testMockData.issues[testMockData.issues.indexOf(todo)] = DUP_CHILD;
    }
  });
});
