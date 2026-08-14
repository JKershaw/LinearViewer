/**
 * Unit tests for lib/render-swipe.js — issueToCard() provenance stamp (LIN-2046).
 *
 * Run with: node --test tests/unit/render-swipe.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { flattenTrees } from '../../lib/render-swipe.js';
import { issueSource } from '../../lib/providers/models.js';

// Build a single-project tree shaped like buildForest output, so flattenTrees
// runs the real issueToCard mapping on the supplied raw issues (mirrors the
// treeFor() helper in swipe-sort.test.js's blocksIds-extraction suite).
function treeFor(issues) {
  return [{
    project: { name: 'P' },
    incomplete: issues.map(issue => ({ issue, children: [] })),
  }];
}

describe('issueToCard source stamp (LIN-2046)', () => {
  test('every card carries source equal to issueSource(issue) for a mixed-provider tree', () => {
    const localIssue = {
      id: 'local-1',
      identifier: 'LOC-1',
      title: 'Local issue',
      state: { type: 'unstarted', name: 'Todo' },
      source: 'local',
    };
    const jiraIssue = {
      id: 'jira-1',
      identifier: 'JIRA-1',
      title: 'Jira issue',
      state: { type: 'unstarted', name: 'Todo' },
      source: 'jira',
    };

    const cards = flattenTrees(treeFor([localIssue, jiraIssue]), 'project');

    assert.strictEqual(cards.length, 2);
    assert.strictEqual(cards[0].source, issueSource(localIssue));
    assert.strictEqual(cards[0].source, 'local');
    assert.strictEqual(cards[1].source, issueSource(jiraIssue));
    assert.strictEqual(cards[1].source, 'jira');
  });

  test('source falls back to the default when the issue carries none (single-binding parity)', () => {
    const issue = { id: 'no-source', state: { type: 'unstarted', name: 'Todo' } };
    const [card] = flattenTrees(treeFor([issue]), 'project');
    assert.strictEqual(card.source, issueSource(issue));
  });

  test('the source stamp is additive only — every other card field is unchanged', () => {
    const issue = {
      id: 'a',
      identifier: 'LIN-1',
      title: 'Title',
      description: 'Desc',
      priority: 2,
      url: 'https://example.com/a',
      state: { type: 'started', name: 'In Progress' },
      assignee: { name: 'Ada' },
      labels: { nodes: [{ name: 'bug' }] },
      completedAt: null,
      dueDate: null,
      relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'b' } }] },
      parent: { id: 'p' },
      source: 'github',
    };

    const [card] = flattenTrees(treeFor([issue]), 'project');

    assert.deepStrictEqual(Object.keys(card).sort(), [
      'assignee',
      'blocksIds',
      'completedAt',
      'description',
      'dueDate',
      'id',
      'identifier',
      'labels',
      'parentId',
      'priority',
      'projectName',
      'section',
      'source',
      'stateName',
      'stateType',
      'title',
      'url',
    ]);
    assert.strictEqual(card.id, 'a');
    assert.strictEqual(card.identifier, 'LIN-1');
    assert.strictEqual(card.title, 'Title');
    assert.strictEqual(card.description, 'Desc');
    assert.strictEqual(card.priority, 2);
    assert.strictEqual(card.url, 'https://example.com/a');
    assert.strictEqual(card.stateType, 'started');
    assert.strictEqual(card.stateName, 'In Progress');
    assert.strictEqual(card.assignee, 'Ada');
    assert.deepStrictEqual(card.labels, ['bug']);
    assert.strictEqual(card.projectName, 'P');
    assert.strictEqual(card.completedAt, null);
    assert.strictEqual(card.dueDate, null);
    assert.strictEqual(card.section, 'project');
    assert.deepStrictEqual(card.blocksIds, ['b']);
    assert.strictEqual(card.parentId, 'p');
    assert.strictEqual(card.source, 'github');
  });
});
