/**
 * Unit tests for lib/local-store.js (LIN-356).
 *
 * Run with: node --test tests/unit/local-store.test.js
 *
 * Covers CRUD over the single scope-partitioned collection, the _id/identifier
 * dual lookup, scope isolation, and the read-modify-write array mutations
 * (comments/labels/relations) that use $set rather than $push.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createLocalStore } from '../fixtures/local-harness.js';

const SCOPE = 'ws-1';

describe('LocalStore', () => {
  let store;

  beforeEach(() => {
    ({ store } = createLocalStore());
  });

  test('creates an issue with a generated identifier and canonical defaults', async () => {
    const a = await store.createIssue(SCOPE, { title: 'First' });
    const b = await store.createIssue(SCOPE, { title: 'Second' });
    assert.equal(a.identifier, 'LOCAL-1');
    assert.equal(b.identifier, 'LOCAL-2');
    assert.equal(a.kind, 'issue');
    assert.equal(a.scope, SCOPE);
    assert.deepEqual(a.state, { name: 'Backlog', type: 'backlog' });
    assert.ok(a._id);
  });

  test('honours explicit id/identifier (seeding) and upserts idempotently', async () => {
    await store.createIssue(SCOPE, { id: 'fixed', identifier: 'SEED-9', title: 'X' });
    await store.createIssue(SCOPE, { id: 'fixed', identifier: 'SEED-9', title: 'X (again)' });
    const all = await store.listIssues(SCOPE);
    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'X (again)');
  });

  test('getIssue resolves by _id and by identifier', async () => {
    const created = await store.createIssue(SCOPE, { title: 'Lookup' });
    assert.equal((await store.getIssue(SCOPE, created._id)).title, 'Lookup');
    assert.equal((await store.getIssue(SCOPE, created.identifier)).title, 'Lookup');
    assert.equal(await store.getIssue(SCOPE, 'nope'), null);
  });

  test('updateIssue patches only mutable fields, ignores immutables', async () => {
    const created = await store.createIssue(SCOPE, { title: 'Before' });
    const updated = await store.updateIssue(SCOPE, created._id, {
      title: 'After',
      state: { name: 'Done', type: 'completed' },
      _id: 'hacked', scope: 'other', kind: 'project',
    });
    assert.equal(updated.title, 'After');
    assert.equal(updated.state.type, 'completed');
    assert.equal(updated._id, created._id);
    assert.equal(updated.scope, SCOPE);
    assert.equal(updated.kind, 'issue');
    assert.equal(await store.updateIssue(SCOPE, 'missing', { title: 'x' }), null);
  });

  test('deleteIssue removes the row', async () => {
    const created = await store.createIssue(SCOPE, { title: 'Doomed' });
    assert.equal(await store.deleteIssue(SCOPE, created.identifier), true);
    assert.equal(await store.getIssue(SCOPE, created._id), null);
    assert.equal(await store.deleteIssue(SCOPE, created._id), false);
  });

  test('getChildren returns direct children only', async () => {
    const parent = await store.createIssue(SCOPE, { title: 'Parent' });
    await store.createIssue(SCOPE, { title: 'Child A', parentId: parent._id });
    await store.createIssue(SCOPE, { title: 'Child B', parentId: parent._id });
    await store.createIssue(SCOPE, { title: 'Unrelated' });
    const kids = await store.getChildren(SCOPE, parent._id);
    assert.equal(kids.length, 2);
  });

  test('searchIssues matches title and description, case-insensitive', async () => {
    await store.createIssue(SCOPE, { title: 'Fix login bug', description: 'auth' });
    await store.createIssue(SCOPE, { title: 'Add pagination', description: 'LOGIN flow note' });
    await store.createIssue(SCOPE, { title: 'Unrelated', description: '' });
    const hits = await store.searchIssues(SCOPE, 'login');
    assert.equal(hits.length, 2);
  });

  test('comments append read-modify-write and survive reload', async () => {
    const issue = await store.createIssue(SCOPE, { title: 'Commented' });
    const c1 = await store.addComment(SCOPE, issue._id, 'first');
    await store.addComment(SCOPE, issue.identifier, 'second');
    assert.ok(c1.id);
    const reloaded = await store.getIssue(SCOPE, issue._id);
    assert.equal(reloaded.comments.length, 2);
    assert.deepEqual(reloaded.comments.map(c => c.body), ['first', 'second']);
    assert.equal(await store.addComment(SCOPE, 'missing', 'x'), null);
  });

  test('removeComment finds the holder issue and removes the matching entry (LIN-1160)', async () => {
    const issue = await store.createIssue(SCOPE, { title: 'Commented' });
    const c1 = await store.addComment(SCOPE, issue._id, 'first');
    await store.addComment(SCOPE, issue._id, 'second');
    assert.equal(await store.removeComment(SCOPE, c1.id), true);
    const reloaded = await store.getIssue(SCOPE, issue._id);
    assert.equal(reloaded.comments.length, 1);
    assert.equal(reloaded.comments[0].body, 'second');
    assert.equal(await store.removeComment(SCOPE, 'missing'), false);
    assert.equal(await store.removeComment(SCOPE, null), false);
  });

  test('updateComment finds the holder issue and replaces the body (LIN-1160)', async () => {
    const issue = await store.createIssue(SCOPE, { title: 'Commented' });
    const c1 = await store.addComment(SCOPE, issue._id, 'first');
    const updated = await store.updateComment(SCOPE, c1.id, 'edited');
    assert.equal(updated.id, c1.id);
    assert.equal(updated.body, 'edited');
    const reloaded = await store.getIssue(SCOPE, issue._id);
    assert.equal(reloaded.comments[0].body, 'edited');
    assert.equal(await store.updateComment(SCOPE, 'missing', 'x'), null);
    assert.equal(await store.updateComment(SCOPE, null, 'x'), null);
  });

  test('labels add (idempotent) / remove', async () => {
    const issue = await store.createIssue(SCOPE, { title: 'Labeled' });
    assert.equal(await store.addLabel(SCOPE, issue._id, 'bug'), true);
    assert.equal(await store.addLabel(SCOPE, issue._id, 'bug'), true); // idempotent
    await store.addLabel(SCOPE, issue._id, 'urgent');
    assert.deepEqual((await store.getIssue(SCOPE, issue._id)).labels, ['bug', 'urgent']);
    await store.removeLabel(SCOPE, issue._id, 'bug');
    assert.deepEqual((await store.getIssue(SCOPE, issue._id)).labels, ['urgent']);
    assert.deepEqual(await store.listLabels(SCOPE), ['urgent']);
  });

  test('relations append', async () => {
    const a = await store.createIssue(SCOPE, { title: 'A' });
    const b = await store.createIssue(SCOPE, { title: 'B' });
    const rel = await store.addRelation(SCOPE, a._id, { type: 'blocks', relatedIssueId: b._id });
    assert.equal(rel.type, 'blocks');
    const reloaded = await store.getIssue(SCOPE, a._id);
    assert.equal(reloaded.relations.length, 1);
    assert.equal(reloaded.relations[0].relatedIssueId, b._id);
  });

  test('projects: create + list sorted by sortOrder', async () => {
    await store.createProject(SCOPE, { id: 'p2', name: 'Beta', sortOrder: 2 });
    await store.createProject(SCOPE, { id: 'p1', name: 'Alpha', sortOrder: 1 });
    const projects = await store.listProjects(SCOPE);
    assert.deepEqual(projects.map(p => p.name), ['Alpha', 'Beta']);
  });

  test('scope isolation: a different scope sees nothing', async () => {
    await store.createIssue(SCOPE, { title: 'Mine' });
    await store.createProject(SCOPE, { name: 'Mine too' });
    assert.equal((await store.listIssues('other')).length, 0);
    assert.equal((await store.listProjects('other')).length, 0);
  });

  test('seed bulk-loads and clear wipes the scope', async () => {
    const { projects, issues } = await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha' }],
      issues: [{ id: 'i1', title: 'One', projectId: 'p1' }, { id: 'i2', title: 'Two' }],
    });
    assert.equal(projects.length, 1);
    assert.equal(issues.length, 2);
    assert.equal((await store.listIssues(SCOPE)).length, 2);
    const removed = await store.clear(SCOPE);
    assert.equal(removed, 3);
    assert.equal((await store.listIssues(SCOPE)).length, 0);
    assert.equal((await store.listProjects(SCOPE)).length, 0);
  });
});
