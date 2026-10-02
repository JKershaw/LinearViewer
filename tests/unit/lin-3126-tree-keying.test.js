/**
 * LIN-3240 (LIN-3126 slice 1, §2) — merged-tree keying + render byte-identity.
 *
 * The merged fan-out can merge two bindings of the SAME provider whose ids
 * collide (a GitHub issue id is its number, so repoA#1 and repoB#1 both key
 * `github:1`). The binding stamp `issue.bindingScope` (set at the server
 * fan-out) extends the key to `source[@bindingScope]:id`. This file witnesses:
 *   - the collision is real without the stamp, and fixed with it;
 *   - parent/child linkage stays within its own binding under stamped keys;
 *   - the `@scope` segment / `data-binding-scope` attribute appear ONLY when
 *     stamped, so single-binding and legacy output is byte-identical (asserted
 *     against fixed expected strings, never against the code under test).
 *
 * Run with: node --test tests/unit/lin-3126-tree-keying.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForest, nodeKey } from '../../lib/tree.js';
import { renderPage } from '../../lib/render.js';
import { flattenTrees, renderSwipePage } from '../../lib/render-swipe.js';

function ghIssue(overrides = {}) {
  return {
    id: '1',
    identifier: '#1',
    title: 'Issue',
    description: null,
    priority: 2,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    dueDate: null,
    completedAt: null,
    url: null,
    parent: null,
    project: { id: 'p1', name: 'Proj' },
    state: { name: 'Todo', type: 'unstarted' },
    assignee: null,
    labels: { nodes: [] },
    source: 'github',
    ...overrides,
  };
}

/** A project tree in the shape `renderPage`/`flattenTrees` consume. */
function projectTree(issues) {
  return {
    project: { id: 'p1', name: 'Proj', content: null, url: null },
    incomplete: issues.map(issue => ({ issue, children: [], depth: 0 })),
    completed: [],
    completedCount: 0,
  };
}

const RENDER_OPTS = {
  isLanding: false,
  urlKey: 'ws',
  workspaces: [{ id: 'w1', name: 'WS', urlKey: 'ws' }],
};

describe('LIN-3240 nodeKey format', () => {
  test('an unstamped issue keeps the pre-slice `<source>:<id>` key exactly', () => {
    assert.equal(nodeKey({ source: 'github', id: '1' }), 'github:1');
    assert.equal(nodeKey({ id: 'X' }), 'linear:X');
  });

  test('a stamped issue keys `<source>@<bindingScope>:<id>`', () => {
    assert.equal(nodeKey({ source: 'github', id: '1', bindingScope: 'octo/repoB' }), 'github@octo/repoB:1');
    assert.equal(nodeKey({ source: 'github', id: '7', bindingScope: 'octo/repoA' }), 'github@octo/repoA:7');
  });
});

describe('LIN-3240 merged-forest collision', () => {
  test('WITHOUT the stamp, two same-provider #1 rows collide and one is lost (the defect)', () => {
    const forest = buildForest([
      ghIssue({ id: '1', title: 'A' }),
      ghIssue({ id: '1', title: 'B' }),
    ]);
    // Both map to `github:1`; the Map keeps only one — the pre-LIN-3240 loss.
    assert.equal(forest.get('p1').issueMap.size, 1);
  });

  test('WITH the stamp, repoA#1 and repoB#1 both survive in the merged forest', () => {
    const a = ghIssue({ id: '1', title: 'A', bindingScope: 'octo/repoA' });
    const b = ghIssue({ id: '1', title: 'B', bindingScope: 'octo/repoB' });
    const { roots, issueMap } = buildForest([a, b]).get('p1');

    assert.equal(issueMap.size, 2);
    assert.deepEqual(
      [...issueMap.keys()].sort(),
      ['github@octo/repoA:1', 'github@octo/repoB:1']
    );
    assert.deepEqual(roots.map(n => n.issue.title).sort(), ['A', 'B']);
  });

  test('parent/child linkage stays within its own binding under stamped keys', () => {
    const { roots, issueMap } = buildForest([
      ghIssue({ id: '1', title: 'A root', bindingScope: 'octo/repoA' }),
      ghIssue({ id: '2', title: 'A child', parent: { id: '1' }, bindingScope: 'octo/repoA' }),
      ghIssue({ id: '1', title: 'B root', bindingScope: 'octo/repoB' }),
      ghIssue({ id: '2', title: 'B child', parent: { id: '1' }, bindingScope: 'octo/repoB' }),
    ]).get('p1');

    assert.equal(roots.length, 2, 'two roots, one per binding');
    const rootA = issueMap.get('github@octo/repoA:1');
    const rootB = issueMap.get('github@octo/repoB:1');
    assert.deepEqual(rootA.children.map(c => c.issue.title), ['A child']);
    assert.deepEqual(rootB.children.map(c => c.issue.title), ['B child']);
  });
});

describe('LIN-3240 render byte-identity (fixed expected strings)', () => {
  test('unstamped source badge is exactly the pre-slice span, with no binding attribute', () => {
    const html = renderPage([projectTree([ghIssue({ id: '42', identifier: '#42', title: 'A GitHub task' })])], [], [], 'Test', {
      ...RENDER_OPTS,
      showSource: true,
    });
    assert.ok(
      html.includes('<span class="source-badge" data-testid="issue-source" data-source="github">github</span>'),
      'the exact pre-slice badge markup'
    );
    assert.ok(!html.includes('data-binding-scope'), 'no binding attribute anywhere when unstamped');
  });

  test('stamped source badge carries data-binding-scope beside data-source', () => {
    const html = renderPage([projectTree([ghIssue({ id: '42', identifier: '#42', title: 'A', bindingScope: 'octo/repoB' })])], [], [], 'Test', {
      ...RENDER_OPTS,
      showSource: true,
    });
    assert.ok(
      html.includes('data-source="github" data-binding-scope="octo/repoB">github</span>'),
      'binding scope emitted beside the source badge'
    );
  });

  test('the lazy details wrapper carries the binding stamp only when present', () => {
    const stamped = renderPage([projectTree([ghIssue({ id: '42', description: 'body', bindingScope: 'octo/repoB' })])], [], [], 'Test', {
      ...RENDER_OPTS,
      showSource: true,
    });
    assert.ok(stamped.includes('data-source="github" data-binding-scope="octo/repoB" data-lazy="1"'));

    const bare = renderPage([projectTree([ghIssue({ id: '42', description: 'body' })])], [], [], 'Test', {
      ...RENDER_OPTS,
      showSource: true,
    });
    assert.ok(!bare.includes('data-binding-scope'));
  });
});

describe('LIN-3240 swipe card stamp (sparse)', () => {
  test('a stamped card carries bindingScope; an unstamped card has no such key', () => {
    const stamped = flattenTrees([projectTree([ghIssue({ id: '1', bindingScope: 'octo/repoB' })])], 'project')[0];
    assert.equal(stamped.bindingScope, 'octo/repoB');
    assert.equal(stamped.source, 'github');

    const bare = flattenTrees([projectTree([ghIssue({ id: '1' })])], 'project')[0];
    assert.ok(!Object.prototype.hasOwnProperty.call(bare, 'bindingScope'), 'sparse — key absent when unstamped');
  });

  test('two same-number cards from two bindings are distinguishable', () => {
    const cards = flattenTrees([
      projectTree([
        ghIssue({ id: '1', title: 'A', bindingScope: 'octo/repoA' }),
        ghIssue({ id: '1', title: 'B', bindingScope: 'octo/repoB' }),
      ]),
    ], 'project');
    const byScope = new Map(cards.map(c => [c.bindingScope, c.title]));
    assert.equal(byScope.get('octo/repoA'), 'A');
    assert.equal(byScope.get('octo/repoB'), 'B');
  });
});

describe('LIN-3240 swipe page de-dupe (binding-aware)', () => {
  function swipeIssues(html) {
    const m = html.match(/window\.__SWIPE_DATA__ = (.*);<\/script>/s);
    assert.ok(m, 'embedded __SWIPE_DATA__ not found');
    return JSON.parse(m[1]).issues;
  }

  function renderSwipe(projectTrees) {
    return renderSwipePage(
      { projectTrees, inProgressTrees: [], recentActivityTrees: [] },
      { urlKey: 'ws', workspaces: [{ id: 'w1', name: 'WS', urlKey: 'ws' }] }
    );
  }

  test('two stamped same-number issues both produce cards (repoA#1 and repoB#1 survive)', () => {
    const issues = swipeIssues(renderSwipe([
      projectTree([
        ghIssue({ id: '1', title: 'A', bindingScope: 'octo/repoA' }),
        ghIssue({ id: '1', title: 'B', bindingScope: 'octo/repoB' }),
      ]),
    ]));
    const ones = issues.filter(i => i.id === '1');
    assert.equal(ones.length, 2);
    assert.deepEqual(ones.map(i => i.bindingScope).sort(), ['octo/repoA', 'octo/repoB']);
  });

  test('an unstamped single card is unchanged (and same-number unstamped ids still collapse, as before)', () => {
    const single = swipeIssues(renderSwipe([projectTree([ghIssue({ id: '1', title: 'A' })])]));
    assert.equal(single.length, 1);
    assert.ok(!('bindingScope' in single[0]));

    const pair = swipeIssues(renderSwipe([projectTree([
      ghIssue({ id: '1', title: 'A' }),
      ghIssue({ id: '1', title: 'B' }),
    ])]));
    // Pre-existing collision shape: without a stamp the raw-id key collapses them.
    assert.equal(pair.length, 1);
  });
});
