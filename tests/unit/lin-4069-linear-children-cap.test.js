/**
 * LIN-4069 (LIN-4068 piece A, lifted from LIN-4049): the Linear task-detail read asks for `children(first: 101)`, holds
 * at most 100 direct children, and says `childrenTruncated` when there were more. Linear's default page is 50, so before
 * this a parent with more children was read short and nothing said so.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setLinearFetchImpl } from '../../lib/linear-fetch.js';
import { fetchIssueContext } from '../../lib/providers/linear/index.js';

/** Serve one issue whose direct children are `count` nodes, and capture the query sent. */
async function detailOf(count) {
  let sent = null;
  setLinearFetchImpl(async (_url, init) => {
    sent = JSON.parse(init.body);
    const children = Array.from({ length: count }, (_, i) => ({
      id: `child-${i}`, identifier: `LIN-${1000 + i}`, title: `child ${i}`, updatedAt: '2026-10-30T00:00:00.000Z',
      state: { name: 'Todo', type: 'unstarted' }, labels: { nodes: [] }, inverseRelations: { nodes: [] }, relations: { nodes: [] },
    }));
    const issue = {
      id: 'parent-1', identifier: 'LIN-1', title: 'Parent', description: '', url: 'https://linear.app/x/issue/LIN-1',
      state: { name: 'In Progress', type: 'started' }, labels: { nodes: [] }, inverseRelations: { nodes: [] },
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z',
      trashed: false, parent: null, project: null, comments: { nodes: [] }, children: { nodes: children }, attachments: { nodes: [] },
    };
    return new Response(JSON.stringify({ data: { issue } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const context = await fetchIssueContext('lin_api_fixture', 'LIN-1');
    return { context, query: sent.query };
  } finally {
    setLinearFetchImpl(null);
  }
}

describe('the Linear detail read fails closed over the subtree cap (LIN-4069)', () => {
  test('the detail query asks for one past the cap: children(first: 101)', async () => {
    const { query } = await detailOf(3);
    assert.match(query, /children\(first: 101\)/, 'a parent with 101 children must be visibly over the cap');
  });

  test('101 children: the list is held to 100 and the read says it is truncated', async () => {
    const { context } = await detailOf(101);
    assert.equal(context.children.length, 100);
    assert.equal(context.childrenTruncated, true);
  });

  test('100 children are read whole and are not truncated', async () => {
    const { context } = await detailOf(100);
    assert.equal(context.children.length, 100);
    assert.equal(context.childrenTruncated, false);
  });

  test('a leaf reads no children and is not truncated', async () => {
    const { context } = await detailOf(0);
    assert.deepEqual(context.children, []);
    assert.equal(context.childrenTruncated, false);
  });
});
