/**
 * Unit coverage for the recommend AI-mock helpers (LIN-405).
 *
 * `generateMockRecommendation` must be SHAPE-TOLERANT: it serves both the
 * canonical provider issue (local sessions) and the Linear-shaped `testMockData`
 * issue still passed by the isTestMode stream / GET blocks (RETAINED at LIN-413 —
 * free-tier.spec still drives them on the test-token path).
 * `buildMockRecommendationHop` synthesises the resolver's computeOne
 * record — a defer for a parent with a non-terminal focused child, a real action
 * for a leaf — so a mocked local session drives the SAME descent as the real path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMockRecommendation,
  buildMockRecommendationHop,
} from '../../routes/workspace-api.js';

test('generateMockRecommendation: canonical issue (labels.nodes shape, identifier)', () => {
  // Shape the local provider's _toCanonicalIssue emits: labels.nodes + a url that
  // ends in a UUID (so identifier must come from issue.identifier, not the url tail).
  // Uses the `bug` label (LIN-357: `blocked` is no longer a label).
  const canonical = {
    identifier: 'TEST-13',
    url: '/workspace/local-workspace/issue/dddddddd-dddd-dddd-dddd-ddddddddddde',
    state: { name: 'In Progress', type: 'started' },
    labels: { nodes: [{ name: 'bug' }] },
  };
  const { reasoning, prompt, identifier } = generateMockRecommendation(canonical);
  assert.equal(identifier, 'TEST-13');
  assert.match(reasoning, /bug/i);
  assert.match(prompt, /Help me with task TEST-13/);
  assert.match(prompt, /\*\*Labels:\*\* bug/);
});

test('generateMockRecommendation: plain-array labels are tolerated', () => {
  const canonical = {
    identifier: 'TEST-13',
    url: '/workspace/local-workspace/issue/dddddddd-dddd-dddd-dddd-ddddddddddde',
    state: { name: 'In Progress', type: 'started' },
    labels: ['bug'],
  };
  const { reasoning, prompt } = generateMockRecommendation(canonical);
  assert.match(reasoning, /bug/i);
  assert.match(prompt, /TEST-13/);
});

test('generateMockRecommendation: Linear-shaped issue (url tail = identifier)', () => {
  // The testMockData shape: labels.nodes and a url whose tail IS the identifier.
  // identifier is still present, so it is preferred; the prompt must still carry it.
  const linearShaped = {
    identifier: 'TEST-13',
    url: 'https://linear.app/test/issue/TEST-13',
    state: { name: 'In Progress', type: 'started' },
    labels: { nodes: [{ name: 'bug' }] },
  };
  const { reasoning, prompt, identifier } = generateMockRecommendation(linearShaped);
  assert.equal(identifier, 'TEST-13');
  assert.match(reasoning, /bug/i);
  assert.match(prompt, /TEST-13/);
});

test('generateMockRecommendation: identifier falls back to url tail when absent', () => {
  const noIdentifier = {
    url: 'https://linear.app/test/issue/TEST-99',
    state: { name: 'Backlog', type: 'backlog' },
    labels: { nodes: [] },
  };
  const { prompt } = generateMockRecommendation(noIdentifier);
  assert.match(prompt, /Help me with task TEST-99/);
});

test('generateMockRecommendation: bug label routes to the bug reasoning', () => {
  const { reasoning } = generateMockRecommendation({
    identifier: 'TEST-13',
    state: { name: 'Todo', type: 'unstarted' },
    labels: ['bug'],
  });
  assert.match(reasoning, /bug/i);
});

test('buildMockRecommendationHop: leaf returns a real (non-defer) action with a prompt', () => {
  const ctx = {
    issue: {
      identifier: 'TEST-13',
      url: '/workspace/local-workspace/issue/dddd',
      state: { name: 'In Progress', type: 'started' },
      labels: { nodes: [{ name: 'bug' }] },
    },
    project: { name: 'Local', description: null },
    children: [],
    // no focusedChild → leaf
  };
  const hop = buildMockRecommendationHop(ctx);
  assert.equal(hop.recommendedAction, 'recommend');
  assert.equal(hop.deferTo, null);
  assert.equal(hop.identifier, 'TEST-13');
  assert.match(hop.prompt, /TEST-13/);
  assert.match(hop.reasoning, /bug/i);
  assert.deepEqual(hop.children, []);
});

test('buildMockRecommendationHop: parent with non-terminal focused child synthesises a defer', () => {
  const child = {
    issue: { identifier: 'TEST-2', state: { type: 'unstarted' } },
  };
  const ctx = {
    issue: {
      identifier: 'TEST-1',
      url: '/workspace/local-workspace/issue/issue-1',
      state: { name: 'In Progress', type: 'started' },
      labels: { nodes: [] },
    },
    project: { name: 'Local', description: null },
    children: [{ identifier: 'TEST-2', state: { type: 'unstarted' } }],
    focusedChild: child,
  };
  const hop = buildMockRecommendationHop(ctx);
  assert.equal(hop.recommendedAction, 'defer');
  assert.equal(hop.deferTo, 'TEST-2');
  // children (with state) ride along for the resolver's terminal-edge guard.
  assert.equal(hop.children.length, 1);
  assert.equal(hop.children[0].identifier, 'TEST-2');
  // A defer has no prompt body and surfaces the routing breadcrumb in reasoning.
  assert.equal(hop.prompt, null);
  assert.match(hop.reasoning, /is a container → routing to TEST-2/);
});
