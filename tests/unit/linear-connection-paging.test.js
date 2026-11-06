/**
 * LIN-4322: nested Linear issue connections are read whole, or say they were not.
 *
 * Linear answers a connection that names no `first:` with its default page of 50
 * and says nothing about the rest. These tests stub GraphQLClient.prototype.request
 * with a fake issue whose lists are served in cursor pages (the way Linear pages
 * them), and check that issueDetail, relations and fetchIssueComments read every
 * item in order, flag a cut list instead of hiding it, and never loop.
 *
 * Run with: node --test tests/unit/linear-connection-paging.test.js
 */
import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from 'graphql-request';

import {
  issueDetail,
  relations,
  fetchIssueComments,
  pageConnection,
  CONNECTION_CAP,
} from '../../lib/providers/linear/index.js';
import { flattenIssue } from '../../lib/proxy-wire.js';
import { latestReviewComment } from '../../lib/run-ledger.js';

let restore;
function stub(impl) {
  const m = mock.method(GraphQLClient.prototype, 'request', impl);
  restore = () => m.mock.restore();
  return m;
}

afterEach(() => {
  if (restore) restore();
  restore = undefined;
  mock.reset();
});

const encode = (n) => Buffer.from(String(n)).toString('base64');
const decode = (cursor) => Number(Buffer.from(cursor, 'base64').toString());

// `n` items, oldest first. createdAt rises one second per item, so creation
// order and array order agree.
function items(prefix, n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    body: `${prefix} ${i}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
    user: { name: 'Fake' },
    identifier: `${prefix}-${i}`,
    title: `${prefix} ${i}`,
    state: { name: 'Todo', type: 'unstarted' },
    type: 'blocks',
    relatedIssue: { id: `r${i}`, identifier: `R-${i}`, title: 'r', state: { name: 'Todo', type: 'unstarted' } },
    issue: { id: `r${i}`, identifier: `R-${i}`, title: 'r', state: { name: 'Todo', type: 'unstarted' } },
  }));
}

// A fake Linear issue. The main query (no `after`) returns each list's first
// page; a follow-up (with `after`) returns the page that cursor names. Every
// request is recorded so a test can check the query each one sent.
function fakeLinear({ comments = [], children = [], relations: rel = [], inverseRelations: inv = [], pageSize = 100, trashed = false } = {}) {
  const lists = { comments, children, relations: rel, inverseRelations: inv };
  const requests = [];
  const pageOf = (field, after) => {
    const all = lists[field];
    const start = after === undefined ? 0 : decode(after);
    const end = Math.min(start + pageSize, all.length);
    const more = end < all.length;
    return { nodes: all.slice(start, end), pageInfo: { hasNextPage: more, endCursor: more ? encode(end) : null } };
  };
  const impl = async (query, variables) => {
    requests.push({ query, variables });
    if (variables.after !== undefined) {
      const field = /issue\(id: \$id\) \{\s*(\w+)\(first/.exec(query)[1];
      return { issue: { [field]: pageOf(field, variables.after) } };
    }
    return {
      issue: {
        id: 'issue-1',
        identifier: 'LIN-4150',
        trashed,
        ...Object.fromEntries(Object.keys(lists).map((f) => [f, pageOf(f)])),
      },
    };
  };
  return { impl, requests, followUps: () => requests.filter((r) => r.variables.after !== undefined) };
}

describe('issueDetail reads nested lists whole', () => {
  test('120 comments come back whole and in order across the page boundary', async () => {
    const fake = fakeLinear({ comments: items('c', 120) });
    stub(fake.impl);

    const detail = await issueDetail('lin_api_test', 'LIN-4150');

    assert.equal(detail.comments.nodes.length, 120);
    assert.deepEqual(detail.comments.nodes.map((c) => c.id), items('c', 120).map((c) => c.id));
    const times = detail.comments.nodes.map((c) => Date.parse(c.createdAt));
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'ascending by createdAt');
    assert.equal(fake.followUps().length, 1, 'one follow-up page for the 20 past the first 100');
    assert.equal('truncated' in detail, false, 'nothing was cut, so no truncated key');
  });

  test('every request, the main query and each follow-up, names orderBy: createdAt and a first: bound', async () => {
    const fake = fakeLinear({ comments: items('c', 250), children: items('k', 150) });
    stub(fake.impl);

    await issueDetail('lin_api_test', 'LIN-4150');

    assert.ok(fake.requests.length >= 2);
    for (const r of fake.requests) {
      assert.match(r.query, /orderBy: createdAt/);
      assert.match(r.query, /first: 100/);
    }
  });

  test('an issue whose lists fit in one page costs no follow-up request', async () => {
    const fake = fakeLinear({ comments: items('c', 50), children: items('k', 3), relations: items('r', 2), inverseRelations: [] });
    stub(fake.impl);

    const detail = await issueDetail('lin_api_test', 'LIN-4150');

    assert.equal(detail.comments.nodes.length, 50);
    assert.equal(fake.requests.length, 1);
  });

  test('exactly CONNECTION_CAP comments are whole and unflagged', async () => {
    const fake = fakeLinear({ comments: items('c', CONNECTION_CAP) });
    stub(fake.impl);

    const detail = await issueDetail('lin_api_test', 'LIN-4150');

    assert.equal(detail.comments.nodes.length, CONNECTION_CAP);
    assert.equal('truncated' in detail, false);
  });

  test('past the cap: exactly CONNECTION_CAP returned, and only that list is flagged', async () => {
    const fake = fakeLinear({ comments: items('c', CONNECTION_CAP + 1), children: items('k', 2) });
    stub(fake.impl);

    const detail = await issueDetail('lin_api_test', 'LIN-4150');

    assert.equal(detail.comments.nodes.length, CONNECTION_CAP);
    assert.deepEqual(detail.comments.nodes[0].id, 'c0', 'keeps the oldest 1,000 by creation time');
    assert.deepEqual(detail.truncated, { comments: true }, 'other lists absent from the flag');
    assert.equal(detail.children.nodes.length, 2);
  });
});

describe('pageConnection termination', () => {
  test('a missing pageInfo means done: no follow-up request, the page is returned as is', async () => {
    const calls = [];
    const client = { request: async (...args) => { calls.push(args); return {}; } };

    const page = await pageConnection(client, 'LIN-1', 'comments', 'id', { nodes: [{ id: 'a' }] });

    assert.deepEqual(page, { nodes: [{ id: 'a' }], truncated: false });
    assert.equal(calls.length, 0);
  });

  test('hasNextPage with a null endCursor stops at once and counts as truncated', async () => {
    const calls = [];
    const client = { request: async (...args) => { calls.push(args); return {}; } };

    const page = await pageConnection(client, 'LIN-1', 'comments', 'id', {
      nodes: [{ id: 'a' }],
      pageInfo: { hasNextPage: true, endCursor: null },
    });

    assert.equal(page.truncated, true);
    assert.equal(calls.length, 0);
  });

  test('a repeated endCursor stops the loop and counts as truncated', async () => {
    let calls = 0;
    const client = {
      request: async () => {
        calls += 1;
        return { issue: { comments: { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: true, endCursor: 'same' } } } };
      },
    };

    const page = await pageConnection(client, 'LIN-1', 'comments', 'id', {
      nodes: [{ id: 'a' }],
      pageInfo: { hasNextPage: true, endCursor: 'same' },
    });

    assert.equal(page.truncated, true);
    assert.equal(calls, 1, 'one follow-up, then the repeat is refused');
    assert.deepEqual(page.nodes.map((n) => n.id), ['a', 'b']);
  });

  test('a server that keeps answering with the same page does not loop forever', async () => {
    let calls = 0;
    stub(async (query, variables) => {
      calls += 1;
      assert.ok(calls < 10, 'pageConnection must stop');
      if (variables.after === undefined) {
        return { issue: { comments: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'X' } } } };
      }
      return { issue: { comments: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'X' } } } };
    });

    const detail = await issueDetail('lin_api_test', 'LIN-4150');

    assert.deepEqual(detail.truncated, { comments: true });
    assert.ok(calls <= 3, `stopped after ${calls} requests`);
  });
});

describe('relations reads both lists whole, and flags a cut one', () => {
  test('120 relations are returned whole and unflagged', async () => {
    const fake = fakeLinear({ relations: items('r', 120), inverseRelations: items('i', 3) });
    stub(fake.impl);

    const result = await relations('lin_api_test', 'LIN-4150');

    assert.equal(result.relations.nodes.length, 120);
    assert.equal(result.inverseRelations.nodes.length, 3);
    assert.equal('truncated' in result, false);
    assert.equal(result.trashed, false);
  });

  test('a cut inverseRelations list is flagged by name at the top level', async () => {
    const fake = fakeLinear({ relations: items('r', 1), inverseRelations: items('i', CONNECTION_CAP + 1) });
    stub(fake.impl);

    const result = await relations('lin_api_test', 'LIN-4150');

    assert.equal(result.inverseRelations.nodes.length, CONNECTION_CAP);
    assert.deepEqual(result.truncated, { inverseRelations: true });
  });
});

describe('fetchIssueComments (the close-out gate read)', () => {
  test('returns all 120 comments, and the latest review verdict past index 50 is among them', async () => {
    const trail = items('c', 120);
    trail[110] = {
      ...trail[110],
      body: '## Code review\n\nVerdict: Approved',
    };
    const fake = fakeLinear({ comments: trail });
    stub(fake.impl);

    const comments = await fetchIssueComments('lin_api_test', 'LIN-4150');

    assert.equal(comments.length, 120);
    assert.equal(latestReviewComment(comments)?.id, 'c110', 'the verdict at index 110, not a stale prefix');
  });

  test('a trail past the cap throws rather than return a prefix that reads as complete', async () => {
    const fake = fakeLinear({ comments: items('c', CONNECTION_CAP + 1) });
    stub(fake.impl);

    await assert.rejects(
      () => fetchIssueComments('lin_api_test', 'LIN-4150'),
      /cannot read the latest review/,
    );
  });
});

describe('the wire keeps the truncated flag', () => {
  test('flattenIssue leaves the top-level truncated flag and flattens the lists', async () => {
    const fake = fakeLinear({ comments: items('c', CONNECTION_CAP + 1) });
    stub(fake.impl);

    const wire = flattenIssue(await issueDetail('lin_api_test', 'LIN-4150'));

    assert.deepEqual(wire.truncated, { comments: true });
    assert.equal(Array.isArray(wire.comments), true);
    assert.equal(wire.comments.length, CONNECTION_CAP);
  });
});
