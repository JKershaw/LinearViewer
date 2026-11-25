/**
 * LIN-4562: `searchTasks` (lib/home-rows.js), the search page's reader. It finds tasks across the workspace: done work
 * and every project included, open first, then done (most recently finished first), each once, capped. Home's own
 * `searchRows` stays as it was (open work only).
 *
 * Witness: before this reader, the only search (Home's) dropped "Finished item 42" (done) entirely; the done-task test
 * here is the case it could not answer.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/search-tasks.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTasks, homeRowsFor, SEARCH_TASKS_LIMIT } from '../../lib/home-rows.js';
import { PERIODICALS_PROJECT_ID, buildForest, partitionCompleted } from '../../lib/tree.js';
import { shapedLocalSeed } from '../fixtures/local-harness.js';

const issue = (identifier, title, type = 'unstarted', extra = {}) => ({ id: identifier, identifier, title, state: { name: type, type }, ...extra });
const node = (i, children = []) => ({ issue: i, children });

const trees = [
  { project: { id: 'p1', name: 'Alpha' }, incomplete: [node(issue('A-1', 'Write the rail'), [node(issue('A-2', 'Rail drawer', 'started'))])], completed: [node(issue('A-3', 'Rail sketch', 'completed', { completedAt: '2026-11-01T00:00:00Z' }))] },
  { project: { id: 'p2', name: 'Beta' }, incomplete: [node(issue('B-1', 'Unrelated'))], completed: [node(issue('B-2', 'Old rail notes', 'completed', { completedAt: '2026-11-10T00:00:00Z' }), [node(issue('B-3', 'Rail child of done', 'backlog'))])] },
  { project: { id: PERIODICALS_PROJECT_ID, name: 'Periodicals' }, incomplete: [node(issue('PER-1', 'Rail periodical'))], completed: [] },
];

describe('searchTasks', () => {
  test('open first in tree order, then done most recently finished first; every project; children of done work too', () => {
    const r = searchTasks({ q: 'rail', trees });
    assert.deepEqual(r.matches.map(m => m.issue.identifier), ['A-1', 'A-2', 'B-3', 'B-2', 'A-3']);
    assert.deepEqual(r.matches.map(m => m.done), [false, false, false, true, true]);
    assert.equal(r.open, 3);
    assert.equal(r.done, 2);
    assert.equal(r.remaining, 0);
    assert.equal(r.matches.find(m => m.issue.identifier === 'B-2').project.name, 'Beta');
  });

  test('Periodicals templates are not tasks and are never found', () => {
    assert.ok(!searchTasks({ q: 'periodical', trees }).matches.length);
  });

  test('matches the fields Home searches (identifier, assignee, label), case-insensitive; an empty search finds nothing', () => {
    const t = [{ project: { id: 'p', name: 'P' }, incomplete: [node(issue('X-9', 'Plain', 'unstarted', { assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] } }))], completed: [] }];
    for (const q of ['x-9', 'CHARLIE', 'Urgent']) assert.equal(searchTasks({ q, trees: t }).matches.length, 1, q);
    assert.deepEqual(searchTasks({ q: '   ', trees: t }), { matches: [], open: 0, done: 0, remaining: 0 });
  });

  test('capped at the limit, with the rest counted', () => {
    const many = [{ project: { id: 'p', name: 'P' }, incomplete: Array.from({ length: SEARCH_TASKS_LIMIT + 7 }, (_, i) => node(issue(`M-${i}`, `match ${i}`))), completed: [] }];
    const r = searchTasks({ q: 'match', trees: many });
    assert.equal(r.matches.length, SEARCH_TASKS_LIMIT);
    assert.equal(r.remaining, 7);
  });

  test('Home\'s fold search is unchanged: it still returns open work only', () => {
    const r = homeRowsFor({ kind: 'search', q: 'rail', trees, inProgressTrees: [] });
    const ids = JSON.stringify(r.nodes);
    assert.ok(!ids.includes('"A-3"') && !ids.includes('"B-2"'), 'no done task in Home\'s fold');
  });
});

describe('searchTasks on a workspace of the real one\'s shape (3,000 tasks, 30 projects)', () => {
  // The trees Home reads are built the way fetchAndPrepareProjects builds them: buildForest, then partitionCompleted.
  const seed = shapedLocalSeed('shape', { tasks: 3000, projects: 30 });
  const issues = seed.issues.map(i => ({
    ...i, project: { id: i.projectId }, parent: i.parentId ? { id: i.parentId } : null, labels: { nodes: [] },
  }));
  const forest = buildForest(issues);
  const shaped = seed.projects.map(project => ({ project, ...partitionCompleted(forest.get(project.id)?.roots || []) }));

  test('a done task and a task in another project are both found', () => {
    const done = searchTasks({ q: 'Finished item 42', trees: shaped }).matches.find(m => m.issue.identifier === 'SHAPE-42');
    assert.ok(done, 'SHAPE-42 (done) is found');
    assert.equal(done.done, true);
    const elsewhere = searchTasks({ q: 'Open task 2961', trees: shaped }).matches;
    assert.equal(elsewhere.length, 1);
    assert.equal(elsewhere[0].issue.identifier, 'SHAPE-2961');
    assert.equal(elsewhere[0].project.name, 'Project 21');
  });

  test('a broad search over every task stays well inside a page render (median of 5 under 50 ms)', () => {
    const samples = [];
    for (let i = 0; i < 5; i += 1) {
      const start = process.hrtime.bigint();
      const r = searchTasks({ q: 'task', trees: shaped });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
      assert.equal(r.matches.length, SEARCH_TASKS_LIMIT);
    }
    const median = samples.sort((a, b) => a - b)[2];
    assert.ok(median < 50, `median ${median.toFixed(1)} ms`);
  });
});
