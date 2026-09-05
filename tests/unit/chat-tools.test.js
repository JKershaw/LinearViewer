// Unit tests for the read-only, workspace-scoped chat tool catalog (LIN-989).
//
// Run with: node --test tests/unit/chat-tools.test.js
//
// The catalog exposes OpenAI-style tool schemas + executors that call the
// workspace's provider read functions DIRECTLY (never over self-HTTP), are
// scoped to the workspace by construction (provider + scope captured in the
// closure, never accepted from the model), validate ids with `isValidIssueId`,
// and are read-only in V1.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createChatToolCatalog, CHAT_TOOL_SCHEMAS, CHAT_TOOL_RESULT_BUDGETS, FOLLOW_UP_TOOL_SCHEMA, deriveFollowUpDispatch, projectActiveSession } from '../../lib/chat-tools.js';
import { TOOL_RESULT_MAX_CHARS } from '../../lib/openrouter.js';
import { hashContext } from '../../lib/recap-cache.js';
import { snapshotFromContext } from '../../lib/task-snapshot-store.js';
import { getSessionsForWorkspace, getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { classifyLoop } from '../../lib/observer-sweep.js';
import { computeSupersededLoopIds } from '../../lib/loop-supersede.js';
import { DEFAULT_LANE_STALE_MS } from '../../lib/live-console.js';
import { collectUnansweredDecisions } from '../../lib/unanswered-decisions.js';

// A recording fake of the pass-1 provider read surface. Every method records
// the scope it was called with so tests can assert workspace-scoping, and
// returns a canned value so tests can assert the direct pass-through.
function makeFakeProvider(overrides = {}) {
  const calls = [];
  const provider = {
    calls,
    async fetchRecommendationContext(scope, issueId, opts) {
      calls.push({ method: 'fetchRecommendationContext', scope, issueId, opts });
      return { issue: { id: 'uuid-1', identifier: issueId, title: 'A task' } };
    },
    async search(scope, query, opts) {
      calls.push({ method: 'search', scope, query, opts });
      return [{ id: 'uuid-2', identifier: 'LIN-2', title: `match: ${query}` }];
    },
    async relations(scope, issueId) {
      calls.push({ method: 'relations', scope, issueId });
      return { trashed: false, relations: { nodes: [] }, inverseRelations: { nodes: [] } };
    },
    // Pass-2 (LIN-1026): the stack tool fetches projects+issues through the
    // provider. Return a tiny raw-shaped fixture the pipeline can project.
    async fetchProjects(scope, teamId, opts) {
      calls.push({ method: 'fetchProjects', scope, teamId, opts });
      return {
        projects: [{ id: 'proj-1', name: 'Proj', sortOrder: 1 }],
        issues: [
          {
            id: 'i-1', identifier: 'LIN-1', title: 'In progress task',
            description: 'First line of body\nsecond line', priority: 1,
            state: { name: 'In Progress', type: 'started' },
            project: { id: 'proj-1', name: 'Proj' }, parent: null,
            labels: { nodes: [] },
          },
        ],
      };
    },
    ...overrides,
  };
  return provider;
}

// An in-memory cache store matching the RecapCacheStore/BriefCacheStore get()
// contract used by the cache-only brief/recap tools. Keyed by (urlKey, issueId).
function makeFakeCacheStore() {
  const map = new Map();
  const k = (workspaceId, issueId) => `${workspaceId}:${issueId}`;
  return {
    map,
    async get(workspaceId, issueId) {
      return map.get(k(workspaceId, issueId)) || null;
    },
    put(workspaceId, issueId, value) {
      map.set(k(workspaceId, issueId), value);
    },
  };
}

const SCOPE = 'workspace-token-abc';
const URL_KEY = 'ws-key';

// The canonical context the fake provider returns for any issueId (its issue.id
// is a fixed 'uuid-1'), and the hash the cache-only tools compute over it. Used
// to seed the cache stores so a seeded entry reads back as `fresh`.
const CANONICAL_ID = 'uuid-1';
function contextFor(issueId) {
  return { issue: { id: CANONICAL_ID, identifier: issueId, title: 'A task' } };
}

describe('CHAT_TOOL_SCHEMAS', () => {
  test('exposes the pass-1 + pass-2 + pass-3 read tools', () => {
    const names = CHAT_TOOL_SCHEMAS.map(t => t.function.name).sort();
    assert.deepStrictEqual(names, [
      'get_brief', 'get_children_status', 'get_comments', 'get_history', 'get_recap',
      'get_relations', 'get_session', 'get_stack', 'list_active_sessions',
      'list_pending_decisions', 'list_task_sessions', 'lookup_task',
      'search_tasks',
    ]);
  });

  test('every schema is a well-formed OpenAI function tool', () => {
    for (const t of CHAT_TOOL_SCHEMAS) {
      assert.strictEqual(t.type, 'function');
      assert.strictEqual(typeof t.function.name, 'string');
      assert.strictEqual(typeof t.function.description, 'string');
      assert.strictEqual(t.function.parameters.type, 'object');
    }
  });

  test('id-taking tools require issueId; search requires query', () => {
    const byName = Object.fromEntries(CHAT_TOOL_SCHEMAS.map(t => [t.function.name, t.function]));
    assert.deepStrictEqual(byName.lookup_task.parameters.required, ['issueId']);
    assert.deepStrictEqual(byName.get_relations.parameters.required, ['issueId']);
    assert.deepStrictEqual(byName.search_tasks.parameters.required, ['query']);
    // Pass-2: brief/recap take an issueId; stack's limit is optional.
    assert.deepStrictEqual(byName.get_brief.parameters.required, ['issueId']);
    assert.deepStrictEqual(byName.get_recap.parameters.required, ['issueId']);
    assert.deepStrictEqual(byName.get_stack.parameters.required, []);
    // LIN-1065: get_comments takes one explicitly-named task.
    assert.deepStrictEqual(byName.get_comments.parameters.required, ['issueId']);
    // LIN-1066: get_children_status rolls up one named parent's children.
    assert.deepStrictEqual(byName.get_children_status.parameters.required, ['issueId']);
    // LIN-1067: get_history reads one named task's state-transition history.
    assert.deepStrictEqual(byName.get_history.parameters.required, ['issueId']);
    // LIN-1073: session reads over a different substrate (the sessions read-model).
    assert.deepStrictEqual(byName.list_task_sessions.parameters.required, ['issueId']);
    assert.deepStrictEqual(byName.get_session.parameters.required, ['sessionId']);
  });
});

describe('CHAT_TOOL_RESULT_BUDGETS (LIN-1065, LIN-1073, LIN-2617)', () => {
  test('grants only the row-list and transcript tools a larger-than-default budget', () => {
    // Additive map: get_comments, get_session (full transcript, LIN-1073) and the
    // two LIN-2617 fleet-wide row lists are the ONLY overrides, each strictly
    // larger than the global default.
    assert.deepStrictEqual(Object.keys(CHAT_TOOL_RESULT_BUDGETS).sort(), [
      'get_comments', 'get_session', 'list_active_sessions', 'list_pending_decisions',
    ]);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments > TOOL_RESULT_MAX_CHARS);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments >= 10000, 'within the recommended ~10-12k range');
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_session > TOOL_RESULT_MAX_CHARS);
    // LIN-2617: sized so twenty rows fit without truncation — a clipped row list
    // is a silently wrong answer to "what is in flight?", not a shorter one.
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.list_active_sessions >= 12000);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions >= 12000);
  });

  test('does NOT override any other tool, so they keep the 4000 default', () => {
    for (const name of ['lookup_task', 'search_tasks', 'get_relations', 'get_brief', 'get_recap', 'get_stack', 'get_history', 'list_task_sessions']) {
      assert.strictEqual(CHAT_TOOL_RESULT_BUDGETS[name], undefined, `${name} must not be overridden`);
    }
  });
});

describe('createChatToolCatalog — construction', () => {
  test('throws without a provider', () => {
    assert.throws(() => createChatToolCatalog({ scope: SCOPE }), /requires a provider/);
  });

  test('returns the shared schemas plus an executor', () => {
    const { tools, executeTool, executors } = createChatToolCatalog({ provider: makeFakeProvider(), scope: SCOPE });
    assert.strictEqual(tools, CHAT_TOOL_SCHEMAS);
    assert.strictEqual(typeof executeTool, 'function');
    assert.strictEqual(typeof executors.lookup_task, 'function');
  });
});

describe('executors — direct provider calls, workspace-scoped', () => {
  test('lookup_task calls fetchRecommendationContext directly with the bound scope', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'lookup_task', arguments: { issueId: 'LIN-123' } });

    assert.strictEqual(provider.calls.length, 1);
    assert.deepStrictEqual(provider.calls[0], {
      method: 'fetchRecommendationContext', scope: SCOPE, issueId: 'LIN-123', opts: undefined,
    });
    assert.strictEqual(result.issue.identifier, 'LIN-123');
  });

  test('search_tasks calls provider.search with the bound scope and clamps limit to 50', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await executeTool({ name: 'search_tasks', arguments: { query: '  streaming  ', limit: 999 } });

    assert.deepStrictEqual(provider.calls[0], {
      method: 'search', scope: SCOPE, query: 'streaming', opts: { first: 50 },
    });
  });

  test('search_tasks omits `first` when no valid limit is given', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await executeTool({ name: 'search_tasks', arguments: { query: 'x' } });

    assert.strictEqual(provider.calls[0].opts, undefined);
  });

  test('get_relations calls provider.relations with the bound scope', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'get_relations', arguments: { issueId: 'LIN-9' } });

    assert.deepStrictEqual(provider.calls[0], { method: 'relations', scope: SCOPE, issueId: 'LIN-9' });
    assert.strictEqual(result.trashed, false);
  });

  test('get_comments returns the named task\'s full comment thread as {author, createdAt, body} (LIN-1065)', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId, opts) {
        this.calls.push({ method: 'fetchRecommendationContext', scope, issueId, opts });
        return {
          issue: { id: 'uuid-1', identifier: issueId, title: 'A task' },
          // Provider already sorts comments oldest-first; shape is {body, createdAt, user}.
          comments: [
            { body: 'first note', createdAt: '2026-01-01T00:00:00Z', user: 'Ada' },
            { body: 'second note', createdAt: '2026-01-02T00:00:00Z', user: 'Grace' },
          ],
        };
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'get_comments', arguments: { issueId: 'LIN-42' } });

    assert.deepStrictEqual(provider.calls[0], {
      method: 'fetchRecommendationContext', scope: SCOPE, issueId: 'LIN-42', opts: undefined,
    });
    assert.strictEqual(result.identifier, 'LIN-42');
    assert.strictEqual(result.count, 2);
    assert.deepStrictEqual(result.comments, [
      { author: 'Ada', createdAt: '2026-01-01T00:00:00Z', body: 'first note' },
      { author: 'Grace', createdAt: '2026-01-02T00:00:00Z', body: 'second note' },
    ]);
  });

  test('get_comments maps a missing comment author to Unknown and handles no comments', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId, opts) {
        this.calls.push({ method: 'fetchRecommendationContext', scope, issueId, opts });
        return { issue: { id: 'uuid-1', identifier: issueId }, comments: [{ body: 'x', createdAt: 't' }] };
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const withComment = await executeTool({ name: 'get_comments', arguments: { issueId: 'LIN-7' } });
    assert.deepStrictEqual(withComment.comments, [{ author: 'Unknown', createdAt: 't', body: 'x' }]);

    // A context with no comments array yields an empty, well-formed result.
    provider.fetchRecommendationContext = async (scope, issueId) => ({ issue: { id: 'uuid-1', identifier: issueId } });
    const empty = await executeTool({ name: 'get_comments', arguments: { issueId: 'LIN-8' } });
    assert.strictEqual(empty.count, 0);
    assert.deepStrictEqual(empty.comments, []);
  });

  test('get_comments rejects an invalid id and a missing task', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext() { return null; },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await assert.rejects(
      () => executeTool({ name: 'get_comments', arguments: { issueId: 'not a valid id!' } }),
      /Invalid issue id/,
    );
    await assert.rejects(
      () => executeTool({ name: 'get_comments', arguments: { issueId: 'LIN-99' } }),
      /Task LIN-99 not found/,
    );
  });

  // LIN-1066: a canonical context whose children carry the two new query fields
  // (updatedAt + forward relations) alongside the existing state/inverseRelations.
  function childrenContextFor(issueId) {
    return {
      issue: { id: 'uuid-1', identifier: issueId, title: 'Parent epic' },
      children: [
        {
          id: 'c-1', identifier: 'LIN-201', title: 'Wedged child',
          state: { name: 'Todo', type: 'unstarted' },
          updatedAt: '2026-06-01T00:00:00Z',
          // Blocked by LIN-9 (inverse blocks) + one non-blocks edge that must be dropped.
          inverseRelations: { nodes: [
            { type: 'blocks', issue: { id: 'u-9', identifier: 'LIN-9', state: { type: 'started' } } },
            { type: 'related', issue: { id: 'u-5', identifier: 'LIN-5', state: { type: 'started' } } },
          ] },
          // Blocks LIN-300 (forward blocks) + a related edge that must be dropped.
          relations: { nodes: [
            { type: 'blocks', relatedIssue: { id: 'u-300', identifier: 'LIN-300', state: { type: 'unstarted' } } },
            { type: 'related', relatedIssue: { id: 'u-6', identifier: 'LIN-6', state: { type: 'started' } } },
          ] },
        },
        {
          id: 'c-2', identifier: 'LIN-202', title: 'Free child',
          state: { name: 'In Progress', type: 'started' },
          updatedAt: '2026-06-02T00:00:00Z',
          inverseRelations: { nodes: [] },
          relations: { nodes: [] },
        },
      ],
    };
  }

  test('get_children_status returns a compact per-child rollup (LIN-1066)', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId, opts) {
        this.calls.push({ method: 'fetchRecommendationContext', scope, issueId, opts });
        return childrenContextFor(issueId);
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'get_children_status', arguments: { issueId: 'LIN-200' } });

    assert.deepStrictEqual(provider.calls[0], {
      method: 'fetchRecommendationContext', scope: SCOPE, issueId: 'LIN-200', opts: undefined,
    });
    assert.strictEqual(result.identifier, 'LIN-200');
    assert.strictEqual(result.count, 2);
    // Compact projection: only the six named fields, blockedBy/blocks reduced to
    // identifiers and filtered to `blocks`-type edges (the related edges dropped).
    assert.deepStrictEqual(result.children, [
      {
        identifier: 'LIN-201', title: 'Wedged child', state: 'Todo',
        blockedBy: ['LIN-9'], blocks: ['LIN-300'], lastUpdate: '2026-06-01T00:00:00Z',
      },
      {
        identifier: 'LIN-202', title: 'Free child', state: 'In Progress',
        blockedBy: [], blocks: [], lastUpdate: '2026-06-02T00:00:00Z',
      },
    ]);
  });

  test('get_children_status handles a parent with no children and rejects a bad/missing id (LIN-1066)', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId) {
        if (issueId === 'LIN-404') return null;
        return { issue: { id: 'uuid-1', identifier: issueId } };
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const empty = await executeTool({ name: 'get_children_status', arguments: { issueId: 'LIN-1' } });
    assert.strictEqual(empty.count, 0);
    assert.deepStrictEqual(empty.children, []);

    await assert.rejects(
      () => executeTool({ name: 'get_children_status', arguments: { issueId: 'not a valid id!' } }),
      /Invalid issue id/,
    );
    await assert.rejects(
      () => executeTool({ name: 'get_children_status', arguments: { issueId: 'LIN-404' } }),
      /Task LIN-404 not found/,
    );
  });

  test('get_history returns state transitions newest-first with a latest shortcut (LIN-1067)', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId, opts) {
        this.calls.push({ method: 'fetchRecommendationContext', scope, issueId, opts });
        // The Linear provider already filters to toState-present nodes and returns
        // them newest-first; the tool passes that normalized slice straight through.
        return {
          issue: { id: 'uuid-1', identifier: issueId, title: 'A task' },
          stateTransitions: [
            { createdAt: '2026-06-03T09:00:00Z', fromState: 'In Progress', toState: 'Done' },
            { createdAt: '2026-06-01T08:00:00Z', fromState: 'Todo', toState: 'In Progress' },
          ],
        };
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'get_history', arguments: { issueId: 'LIN-50' } });

    assert.deepStrictEqual(provider.calls[0], {
      method: 'fetchRecommendationContext', scope: SCOPE, issueId: 'LIN-50', opts: undefined,
    });
    assert.strictEqual(result.identifier, 'LIN-50');
    assert.strictEqual(result.count, 2);
    // `latest` is the newest (first) transition, for the common "when did it last move?".
    assert.deepStrictEqual(result.latest, {
      createdAt: '2026-06-03T09:00:00Z', fromState: 'In Progress', toState: 'Done',
    });
    assert.strictEqual(result.transitions.length, 2);
  });

  test('get_history handles no history and rejects a bad/missing id (LIN-1067)', async () => {
    const provider = makeFakeProvider({
      async fetchRecommendationContext(scope, issueId) {
        if (issueId === 'LIN-404') return null;
        // A task with no state history (or a provider that supplies none) → empty list,
        // null latest, never an error.
        return { issue: { id: 'uuid-1', identifier: issueId } };
      },
    });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const empty = await executeTool({ name: 'get_history', arguments: { issueId: 'LIN-1' } });
    assert.strictEqual(empty.count, 0);
    assert.strictEqual(empty.latest, null);
    assert.deepStrictEqual(empty.transitions, []);

    await assert.rejects(
      () => executeTool({ name: 'get_history', arguments: { issueId: 'not a valid id!' } }),
      /Invalid issue id/,
    );
    await assert.rejects(
      () => executeTool({ name: 'get_history', arguments: { issueId: 'LIN-404' } }),
      /Task LIN-404 not found/,
    );
  });

  // The load-bearing shared-surface guard: the two new child fields ride on
  // context.children but must NOT change the hash/snapshot slices, or every task
  // resnapshots and recap/brief caches invalidate workspace-wide.
  test('the new child fields (updatedAt, relations) do not leak into hashContext / snapshotFromContext (LIN-1066)', () => {
    const withNewFields = childrenContextFor('LIN-200');
    // The same context with the two new fields stripped from every child.
    const withoutNewFields = {
      ...withNewFields,
      children: withNewFields.children.map(({ updatedAt, relations, ...rest }) => rest),
    };

    assert.strictEqual(
      hashContext(withNewFields), hashContext(withoutNewFields),
      'hashContext must ignore child updatedAt/relations',
    );
    assert.deepStrictEqual(
      snapshotFromContext(withNewFields), snapshotFromContext(withoutNewFields),
      'snapshotFromContext must ignore child updatedAt/relations',
    );
  });

  test('an executor never accepts a scope/token from the model (scoping is by construction)', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    // A malicious/confused model tries to smuggle a different scope in the args.
    await executeTool({
      name: 'lookup_task',
      arguments: { issueId: 'LIN-1', scope: 'other-workspace-token', apiKey: 'evil' },
    });

    // The bound scope is used regardless of what the model passed.
    assert.strictEqual(provider.calls[0].scope, SCOPE);
  });
});

describe('executors — id validation', () => {
  test('lookup_task rejects a malformed id before hitting the provider', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await assert.rejects(
      () => executeTool({ name: 'lookup_task', arguments: { issueId: 'bad id with spaces!' } }),
      /Invalid issue id/,
    );
    assert.strictEqual(provider.calls.length, 0);
  });

  test('get_relations rejects a missing id before hitting the provider', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await assert.rejects(
      () => executeTool({ name: 'get_relations', arguments: {} }),
      /Invalid issue id/,
    );
    assert.strictEqual(provider.calls.length, 0);
  });

  test('accepts both identifier and UUID id shapes', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await executeTool({ name: 'lookup_task', arguments: { issueId: 'LIN-123' } });
    await executeTool({ name: 'lookup_task', arguments: { issueId: '550e8400-e29b-41d4-a716-446655440000' } });

    assert.strictEqual(provider.calls.length, 2);
  });

  test('search_tasks rejects an empty query before hitting the provider', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    await assert.rejects(
      () => executeTool({ name: 'search_tasks', arguments: { query: '   ' } }),
      /non-empty "query"/,
    );
    assert.strictEqual(provider.calls.length, 0);
  });
});

describe('executeTool — error handling', () => {
  test('unknown tool name throws a clear error', async () => {
    const { executeTool } = createChatToolCatalog({ provider: makeFakeProvider(), scope: SCOPE });
    await assert.rejects(
      () => executeTool({ name: 'delete_everything', arguments: {} }),
      /Unknown tool: delete_everything/,
    );
  });

  test('a provider missing a read method yields a clean capability error, not a TypeError', async () => {
    const provider = makeFakeProvider({ search: undefined });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });
    await assert.rejects(
      () => executeTool({ name: 'search_tasks', arguments: { query: 'x' } }),
      /does not support search/,
    );
  });

  test('a not-found lookup surfaces a not-found error', async () => {
    const provider = makeFakeProvider({ fetchRecommendationContext: async () => ({}) });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });
    await assert.rejects(
      () => executeTool({ name: 'lookup_task', arguments: { issueId: 'LIN-404' } }),
      /Task LIN-404 not found/,
    );
  });
});

describe('pass-2 cache-only reads — get_brief / get_recap (LIN-1026)', () => {
  // Each twin is exercised against both stores/fields via a small table so the
  // shared readCachedContext helper is proven for both.
  const twins = [
    { name: 'get_brief', field: 'brief', storeName: 'Brief cache' },
    { name: 'get_recap', field: 'recap', storeName: 'Recap cache' },
  ];

  function makeCatalog({ store, field } = {}) {
    const provider = makeFakeProvider();
    const briefCacheStore = field === 'brief' ? store : makeFakeCacheStore();
    const recapCacheStore = field === 'recap' ? store : makeFakeCacheStore();
    const { executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, briefCacheStore, recapCacheStore, urlKey: URL_KEY,
    });
    return { provider, executeTool };
  }

  for (const twin of twins) {
    test(`${twin.name} returns 'fresh' with the cached payload when the hash matches`, async () => {
      const store = makeFakeCacheStore();
      const inputHash = hashContext(contextFor('LIN-1'));
      store.put(URL_KEY, CANONICAL_ID, {
        inputHash, [twin.field]: 'cached body', model: 'openai/x', generatedAt: 'ts',
      });
      const { executeTool } = makeCatalog({ store, field: twin.field });

      const result = await executeTool({ name: twin.name, arguments: { issueId: 'LIN-1' } });
      assert.strictEqual(result.status, 'fresh');
      assert.strictEqual(result.identifier, 'LIN-1');
      assert.strictEqual(result[twin.field], 'cached body');
      assert.strictEqual(result.model, 'openai/x');
      assert.strictEqual(result.generatedAt, 'ts');
    });

    test(`${twin.name} returns 'stale' (no body) when the cached hash is outdated`, async () => {
      const store = makeFakeCacheStore();
      store.put(URL_KEY, CANONICAL_ID, {
        inputHash: 'a-different-hash', [twin.field]: 'old body', model: 'm', generatedAt: 'ts',
      });
      const { executeTool } = makeCatalog({ store, field: twin.field });

      const result = await executeTool({ name: twin.name, arguments: { issueId: 'LIN-1' } });
      assert.strictEqual(result.status, 'stale');
      assert.strictEqual(result.identifier, 'LIN-1');
      assert.strictEqual(result[twin.field], undefined, 'stale never leaks a body');
      assert.strictEqual(result.generatedAt, 'ts');
    });

    test(`${twin.name} returns 'missing' when nothing is cached`, async () => {
      const { executeTool } = makeCatalog({ store: makeFakeCacheStore(), field: twin.field });
      const result = await executeTool({ name: twin.name, arguments: { issueId: 'LIN-1' } });
      assert.strictEqual(result.status, 'missing');
      assert.strictEqual(result.identifier, 'LIN-1');
      assert.strictEqual(result[twin.field], undefined);
    });

    test(`${twin.name} NEVER generates — it only reads the store`, async () => {
      const { provider, executeTool } = makeCatalog({ store: makeFakeCacheStore(), field: twin.field });
      await executeTool({ name: twin.name, arguments: { issueId: 'LIN-1' } });
      // The only provider call is the context fetch; no generate* is invoked.
      assert.deepStrictEqual(
        provider.calls.map(c => c.method),
        ['fetchRecommendationContext'],
      );
    });

    test(`${twin.name} validates the id before touching the provider`, async () => {
      const { provider, executeTool } = makeCatalog({ store: makeFakeCacheStore(), field: twin.field });
      await assert.rejects(
        () => executeTool({ name: twin.name, arguments: { issueId: 'bad id!' } }),
        /Invalid issue id/,
      );
      assert.strictEqual(provider.calls.length, 0);
    });

    test(`${twin.name} fails cleanly as 'not configured' when its cache store is absent`, async () => {
      const provider = makeFakeProvider();
      // Construct WITHOUT the stores/urlKey — mirrors a deployment that never wired them.
      const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });
      await assert.rejects(
        () => executeTool({ name: twin.name, arguments: { issueId: 'LIN-1' } }),
        new RegExp(`${twin.storeName} is not configured`),
      );
      assert.strictEqual(provider.calls.length, 0, 'no provider call on a not-configured store');
    });
  }

  test('brief/recap reads are scoped to the bound urlKey, not a model-supplied one', async () => {
    const store = makeFakeCacheStore();
    const inputHash = hashContext(contextFor('LIN-1'));
    store.put(URL_KEY, CANONICAL_ID, { inputHash, brief: 'body' });
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, briefCacheStore: store, recapCacheStore: makeFakeCacheStore(), urlKey: URL_KEY,
    });
    // Model tries to smuggle a different urlKey — ignored; the bound key resolves the hit.
    const result = await executeTool({ name: 'get_brief', arguments: { issueId: 'LIN-1', urlKey: 'other-ws' } });
    assert.strictEqual(result.status, 'fresh');
    assert.strictEqual(result.brief, 'body');
  });
});

describe('pass-2 stack tool — get_stack (LIN-1026)', () => {
  test('fetches projects via the bound scope and returns the digest projection', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });

    const result = await executeTool({ name: 'get_stack', arguments: {} });

    const fetch = provider.calls.find(c => c.method === 'fetchProjects');
    assert.ok(fetch, 'fetchProjects was called');
    assert.strictEqual(fetch.scope, SCOPE, 'bound scope, not a model arg');
    assert.strictEqual(result.view, 'digest');
    assert.ok(Array.isArray(result.tasks));
    assert.ok(result.tasks.length >= 1);
    const row = result.tasks[0];
    // Digest shape: headline (not full description), count fields.
    assert.strictEqual(row.description, undefined);
    assert.strictEqual(typeof row.headline, 'string');
    assert.strictEqual(typeof row.children, 'number');
    assert.strictEqual(typeof result.total, 'number');
  });

  test('clamps the limit to 1-50 (default 5) — an out-of-range limit is bounded', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });
    // Only one task in the fixture, so assert it does not throw and returns <= 50 rows.
    const big = await executeTool({ name: 'get_stack', arguments: { limit: 999 } });
    assert.ok(big.tasks.length <= 50);
    const small = await executeTool({ name: 'get_stack', arguments: { limit: 0 } });
    assert.ok(small.tasks.length >= 0);
  });

  test('a provider without fetchProjects yields a clean capability error', async () => {
    const provider = makeFakeProvider({ fetchProjects: undefined });
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE });
    await assert.rejects(
      () => executeTool({ name: 'get_stack', arguments: {} }),
      /does not support fetchProjects/,
    );
  });
});

// ─── Pass-3 (LIN-1073): session read-model tools + the gated follow-up write ──

// A recording fake of the sessions read-model's two store deps. Mirrors
// `makeMockStores` in tests/unit/pipeline-loops.test.js (dispatchStore.listItems/
// listHistory + agentStatusStore.listStatus) so `list_task_sessions`/`get_session`
// exercise the SAME real reconstruction (`getSessionsForIssues`/
// `getSessionsForWorkspace`) the executors call directly, not a stubbed shortcut.
function makeMockSessionStores({ history = [] } = {}) {
  return {
    dispatchQueueStore: {
      async listItems(urlKey, options) {
        const id = options?.issueIdentifier;
        return id ? [] : [];
      },
      async listHistory(urlKey, options) {
        const id = options?.issueIdentifier;
        const items = id ? history.filter(x => x.issueIdentifier === id) : history;
        return { items, total: items.length };
      },
    },
    agentStatusStore: {
      async listStatus() {
        return { items: [], total: 0 };
      },
    },
  };
}

// Timestamps relative to "now" (like pipeline-loops.test.js's recentHistoryStore) —
// getSessionsForIssues/getSessionsForWorkspace apply a rolling 30-day lookback,
// so a fixed past date would silently fall outside the window.
const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_WORKING = new Date(Date.now() - 40 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function sessionHistoryItem(overrides = {}) {
  return {
    id: 'hist-1',
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier: 'LIN-500',
    issueTitle: 'A task',
    issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    feedback: [],
    ...overrides,
  };
}

// Two fixture sessions across two tasks: a TERMINAL session on LIN-500 (cli
// target), and a RUNNING session on LIN-501 (web target) — enough to exercise
// terminal/running derivation and cli/web target derivation.
function twoSessionHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-done', kind: 'autopilot', issueIdentifier: 'LIN-500', target: 'cli',
      feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
    }),
    sessionHistoryItem({
      id: 'w-done', sessionId: 'sess-done', issueIdentifier: 'LIN-500', target: 'cli',
      feedback: [
        { message: '[working] 2 tools/5s · alive', timestamp: T_WORKING, url: 'https://x/1', urlLabel: 'PR' },
        { message: '[done] Task completed in 8s', timestamp: T_DONE },
      ],
    }),
    sessionHistoryItem({
      id: 'sess-run', kind: 'autopilot', issueIdentifier: 'LIN-501', target: 'web',
      resolvedAt: null, feedback: [{ message: '[working] 1 tools/3s · alive', timestamp: T_WORKING }],
    }),
  ];
}

// LIN-1486 fixture: a multi-wake lineage — an autopilot anchor ('sess-multi'),
// a follow-up wake attached via `followUpTo`/`rootItemId` (the lineage TAIL,
// 'wake-1'), and an unrelated sibling worker ('w-side') attached the ordinary
// explicit-`sessionId` way (no `rootItemId`, so it is its OWN lineage — the
// autopilot-anchor-plus-workers case is not one lineage). `w-side` is
// dispatched AFTER the tail so a naive "last loop in the session" pick would
// wrongly choose it over the true lineage tail.
const T_MULTI_ANCHOR_DISPATCHED = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const T_MULTI_ANCHOR_DONE = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();
const T_MULTI_WAKE_DISPATCHED = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const T_MULTI_WAKE_DONE = new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString();
const T_MULTI_WSIDE_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function multiWakeHistory({
  anchorFeedback = [{ message: '[done] Task completed in 6s', timestamp: T_MULTI_ANCHOR_DONE }],
  anchorResolvedAt = T_MULTI_ANCHOR_DONE,
  anchorStatus = 'taken',
  tailFeedback = [{ message: '[working] 1 tools/4s · alive', timestamp: T_MULTI_WAKE_DISPATCHED }],
  tailResolvedAt = null,
  tailStatus = 'taken',
} = {}) {
  return [
    sessionHistoryItem({
      id: 'sess-multi', kind: 'autopilot', issueIdentifier: 'LIN-600', target: 'cli',
      dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: anchorResolvedAt, status: anchorStatus,
      feedback: anchorFeedback,
    }),
    sessionHistoryItem({
      id: 'wake-1', issueIdentifier: 'LIN-600', target: 'cli',
      followUpTo: 'sess-multi', rootItemId: 'sess-multi',
      dispatchedAt: T_MULTI_WAKE_DISPATCHED, resolvedAt: tailResolvedAt, status: tailStatus,
      feedback: tailFeedback,
    }),
    sessionHistoryItem({
      id: 'w-side', sessionId: 'sess-multi', issueIdentifier: 'LIN-600', target: 'cli',
      dispatchedAt: T_MULTI_WSIDE_DISPATCHED, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 1 tools/2s · alive', timestamp: T_MULTI_WSIDE_DISPATCHED }],
    }),
  ];
}

// LIN-1486 fixture: an ANCHORLESS multi-loop session — two workers sharing an
// explicit `sessionId` ('sess-orphan') whose orchestrator never dispatched (no
// kind:'autopilot' loop with that loopId exists), so `_buildSessions`' "orphan
// explicit-sessionId group" pass builds it with `anchorLoop: null`. Neither
// worker carries `rootItemId`, so each is its OWN lineage — `w1` is dispatched
// first and finishes; `w2` is dispatched later and is still running. This
// exercises `findAnchorLoop(session) || session.loops[0]` picking `w1` (the
// first-dispatched loop, per `_assembleSession`'s dispatchedAt-ascending
// order) as the fallback anchor, whose own (single-loop) lineage tail is
// itself — DELIBERATELY chosen so old and new code disagree: the OLD
// `sessionIsTerminal` aggregate (`loops.every(loopIsTerminal)`) is false here
// (w2 is still running), while the NEW tail-of-w1's-own-lineage force is true
// (w1 is done) — a real behaviour change, not just a re-derivation of the
// same answer.
function orphanMultiLoopHistory() {
  return [
    sessionHistoryItem({
      id: 'w1', sessionId: 'sess-orphan', issueIdentifier: 'LIN-620', target: 'cli',
      dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: T_MULTI_ANCHOR_DONE, status: 'taken',
      feedback: [{ message: '[done] Task completed in 4s', timestamp: T_MULTI_ANCHOR_DONE }],
    }),
    sessionHistoryItem({
      id: 'w2', sessionId: 'sess-orphan', issueIdentifier: 'LIN-620', target: 'cli',
      dispatchedAt: T_MULTI_WAKE_DISPATCHED, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 1 tools/3s · alive', timestamp: T_MULTI_WAKE_DISPATCHED }],
    }),
  ];
}

describe('pass-3 session reads — list_task_sessions / get_session (LIN-1073)', () => {
  function makeCatalog(history) {
    const provider = makeFakeProvider();
    const stores = makeMockSessionStores({ history });
    const { executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
      sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
    });
    return executeTool;
  }

  test('list_task_sessions returns compact rows for the named task only', async () => {
    const executeTool = makeCatalog(twoSessionHistory());
    const result = await executeTool({ name: 'list_task_sessions', arguments: { issueId: 'LIN-500' } });
    assert.strictEqual(result.issueId, 'LIN-500');
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.sessions[0].sessionId, 'sess-done');
    assert.strictEqual(result.sessions[0].terminal, true);
    assert.strictEqual(result.sessions[0].runCount, 2);
  });

  test('list_task_sessions reflects a still-running session as non-terminal', async () => {
    const executeTool = makeCatalog(twoSessionHistory());
    const result = await executeTool({ name: 'list_task_sessions', arguments: { issueId: 'LIN-501' } });
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.sessions[0].terminal, false);
  });

  test('list_task_sessions rejects a malformed id and fails cleanly when stores are absent', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY });
    await assert.rejects(
      () => executeTool({ name: 'list_task_sessions', arguments: { issueId: 'bad id!' } }),
      /Invalid issue id/,
    );
    await assert.rejects(
      () => executeTool({ name: 'list_task_sessions', arguments: { issueId: 'LIN-1' } }),
      /Session data is not configured/,
    );
  });

  test('get_session returns status/telemetry/transcript for the named session, from the WHOLE workspace', async () => {
    const executeTool = makeCatalog(twoSessionHistory());
    const result = await executeTool({ name: 'get_session', arguments: { sessionId: 'sess-done' } });
    assert.strictEqual(result.sessionId, 'sess-done');
    assert.strictEqual(result.terminal, true);
    assert.ok(result.telemetry);
    assert.strictEqual(result.runs.length, 2);
    const workerRun = result.runs.find(r => r.kind !== 'autopilot' && r.terminalStatus === 'done');
    assert.ok(workerRun, 'expected the worker run');
    assert.ok(Array.isArray(workerRun.transcript));
    assert.deepStrictEqual(workerRun.transcript[0], {
      message: '[working] 2 tools/5s · alive', timestamp: T_WORKING, url: 'https://x/1', urlLabel: 'PR',
    });
  });

  test('LIN-1789: get_session forwards telemetry.resources unchanged — a wholesale object passthrough needs no field-specific code', async () => {
    const history = twoSessionHistory();
    const workerLoop = history.find(h => h.id === 'w-done');
    workerLoop.feedback = [
      ...workerLoop.feedback,
      { message: '[resources] {"peakRssBytes":536870912,"cpuCount":4}', kind: 'resources', timestamp: T_DONE },
    ];
    const executeTool = makeCatalog(history);
    const result = await executeTool({ name: 'get_session', arguments: { sessionId: 'sess-done' } });
    assert.deepStrictEqual(result.telemetry.resources, { peakRssBytes: 536870912, cpuCount: 4 });
    const workerRun = result.runs.find(r => r.kind !== 'autopilot' && r.terminalStatus === 'done');
    assert.deepStrictEqual(workerRun.telemetry.resources, { peakRssBytes: 536870912, cpuCount: 4 });
  });

  // LIN-2207: `get_session`'s transcript is an LLM tool payload, structurally
  // the same class of feedback[] consumer LIN-1728 already fixed elsewhere
  // (run-summary's LLM prompt, public/session.js's rendered transcript,
  // lib/sessions-view.js) — a `decision-answer` stamp is metadata about a
  // decision, not a chat turn, and must never reach the model as one.
  test('LIN-2207: get_session\'s transcript omits a decision-answer stamp', async () => {
    const history = twoSessionHistory();
    const workerLoop = history.find(h => h.id === 'w-done');
    workerLoop.feedback = [
      ...workerLoop.feedback,
      { kind: 'decision-answer', message: JSON.stringify({ decision_id: 'd-1' }), timestamp: T_DONE },
    ];
    const executeTool = makeCatalog(history);
    const result = await executeTool({ name: 'get_session', arguments: { sessionId: 'sess-done' } });
    const workerRun = result.runs.find(r => r.kind !== 'autopilot' && r.terminalStatus === 'done');
    assert.ok(workerRun, 'expected the worker run');
    // The two real entries survive; the stamp does not appear as a third.
    assert.strictEqual(workerRun.transcript.length, 2);
    assert.ok(!workerRun.transcript.some(t => t.message.includes('decision_id')),
      'a decision-answer stamp must never reach the LLM tool payload as a transcript entry');
  });

  test('list_task_sessions does NOT forward resources — it only ever picks runtime, matching its narrower :735 field-by-field projection', async () => {
    const history = twoSessionHistory();
    const workerLoop = history.find(h => h.id === 'w-done');
    workerLoop.feedback = [
      ...workerLoop.feedback,
      { message: '[resources] {"peakRssBytes":536870912}', kind: 'resources', timestamp: T_DONE },
    ];
    const executeTool = makeCatalog(history);
    const result = await executeTool({ name: 'list_task_sessions', arguments: { issueId: 'LIN-500' } });
    assert.deepStrictEqual(Object.keys(result.sessions[0]).sort(), ['completedAt', 'dispatchedAt', 'runCount', 'sessionId', 'seedIssue', 'terminal', 'runtime'].sort());
  });

  test('get_session rejects a missing sessionId and an unknown session', async () => {
    const executeTool = makeCatalog(twoSessionHistory());
    await assert.rejects(
      () => executeTool({ name: 'get_session', arguments: {} }),
      /non-empty "sessionId"/,
    );
    await assert.rejects(
      () => executeTool({ name: 'get_session', arguments: { sessionId: 'no-such-session' } }),
      /Session no-such-session not found/,
    );
  });

  test('get_session omits `terminal` (rather than throwing) when sessionIsTerminal is not injected', async () => {
    const provider = makeFakeProvider();
    const stores = makeMockSessionStores({ history: twoSessionHistory() });
    const { executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    });
    const result = await executeTool({ name: 'get_session', arguments: { sessionId: 'sess-done' } });
    assert.strictEqual(result.terminal, null);
  });
});

describe('pass-3 write tool — send_follow_up (LIN-1073)', () => {
  function makeFakeDispatchQueueStore(history) {
    const calls = [];
    const stores = makeMockSessionStores({ history });
    return {
      ...stores.dispatchQueueStore,
      calls,
      async addItem(urlKey, item) {
        calls.push({ urlKey, item });
        return { _id: 'queued-item-1', urlKey, ...item };
      },
    };
  }

  function makeCatalog({ history, followUpEnabled = true, dispatchedBy = null, anchorHarness, proxyTokenStore } = {}) {
    const provider = makeFakeProvider();
    const dispatchQueueStore = makeFakeDispatchQueueStore(history);
    // getItemStatus is added ONLY when a test opts in (LIN-1431). Every
    // pre-existing test in this block leaves it off, so their anchor resolves
    // null and their harness/bootstrapToken assertions are unaffected — which
    // is why the whole-item deepStrictEqual floor below still passes unchanged.
    // Opting in also counts the calls, so an inheritance test cannot pass
    // vacuously with the anchor never consulted.
    if (anchorHarness !== undefined) {
      dispatchQueueStore.getItemStatusCalls = 0;
      dispatchQueueStore.getItemStatus = async () => {
        dispatchQueueStore.getItemStatusCalls++;
        return { harness: anchorHarness };
      };
    }
    const { tools, executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore, agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
      followUpEnabled, dispatchedBy,
      ...(proxyTokenStore !== undefined ? { proxyTokenStore, baseUrl: 'https://harbour.test' } : {}),
    });
    return { tools, executeTool, dispatchQueueStore };
  }

  test('is absent from tools unless followUpEnabled is true', () => {
    const { tools: withoutFlag } = makeCatalog({ history: twoSessionHistory(), followUpEnabled: false });
    assert.strictEqual(withoutFlag, CHAT_TOOL_SCHEMAS, 'reference-equal to the base read-only catalog');
    assert.ok(!withoutFlag.some(t => t.function.name === 'send_follow_up'));

    const { tools: withFlag } = makeCatalog({ history: twoSessionHistory(), followUpEnabled: true });
    assert.ok(withFlag.some(t => t.function.name === 'send_follow_up'));
    assert.ok(!CHAT_TOOL_SCHEMAS.some(t => t.function.name === 'send_follow_up'), 'never leaks into the base catalog');
  });

  test('refuses to run when followUpEnabled is false, even if invoked directly', async () => {
    const { executeTool } = makeCatalog({ history: twoSessionHistory(), followUpEnabled: false });
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-run', prompt: 'keep going' } }),
      /not enabled/,
    );
  });

  test('a terminal session gets force:true and the anchor\'s cli target', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory(), dispatchedBy: 'user-42' });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.deepStrictEqual(result, { queued: true, itemId: 'queued-item-1', sessionId: 'sess-done', target: 'cli', force: true });
    assert.strictEqual(dispatchQueueStore.calls.length, 1);
    // LIN-1139: send_follow_up now creates the item through the shared dispatch
    // factory, so the item also carries the resolved kind/model/harness/
    // bootstrapToken. With no workspacePreferencesStore wired here, model + harness
    // stay null (the factory is called with applyDefaultHarness:false — the
    // claude-code interpose is scoped to the proxy dispatch boundary, LIN-1159);
    // kind derives to 'custom' (no promptName); bootstrapToken is null (no proxy
    // context on this path). The caller-owned fields are unchanged.
    assert.deepStrictEqual(dispatchQueueStore.calls[0], {
      urlKey: URL_KEY,
      item: {
        prompt: 'ship it', followUpTo: 'sess-done', target: 'cli', force: true, dispatchedBy: 'user-42',
        kind: 'custom', model: null, harness: null, terminal: null, effort: null, presetConfig: null, presetName: null, bootstrapToken: null,
      },
    });
  });

  test('a running session gets force:false and the anchor\'s web target — the model never supplies force/target', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory() });
    const result = await executeTool({
      name: 'send_follow_up',
      // A confused/malicious model tries to smuggle force/target — ignored.
      arguments: { sessionId: 'sess-run', prompt: 'what are you doing?', force: true, target: 'dash' },
    });
    assert.deepStrictEqual(result, { queued: true, itemId: 'queued-item-1', sessionId: 'sess-run', target: 'web', force: false });
    assert.strictEqual(dispatchQueueStore.calls[0].item.target, 'web');
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, false);
  });

  test('rejects a session whose anchor target is dash/local', async () => {
    const history = [
      ...twoSessionHistory(),
      sessionHistoryItem({
        id: 'sess-dash', kind: 'autopilot', issueIdentifier: 'LIN-502', target: 'dash',
        feedback: [{ message: '[working] 1 tools/2s · alive', timestamp: '2026-04-11T11:05:00.000Z' }],
      }),
    ];
    const { executeTool } = makeCatalog({ history });
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-dash', prompt: 'hi' } }),
      /dash\/local targets are not supported/,
    );
  });

  test('rejects an unknown session and empty sessionId/prompt before touching the store', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory() });
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'no-such', prompt: 'hi' } }),
      /Session no-such not found/,
    );
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: '', prompt: 'hi' } }),
      /non-empty "sessionId"/,
    );
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-run', prompt: '  ' } }),
      /non-empty "prompt"/,
    );
    assert.strictEqual(dispatchQueueStore.calls.length, 0);
  });

  /**
   * LIN-1431 S3 #2. `send_follow_up` used to pass no finalizePrompt at all, so a
   * tool-driven follow-up resuming a claude-code session was enqueued with
   * `bootstrapToken: null` — and the broker holding its original credential died
   * with its window (LIN-1362/1375), leaving the resumed session unable to write
   * back. It now provisions on the same terms as the human reply box: keyed on the
   * RESOLVED harness (inherited from the anchor), no prose appended,
   * `applyDefaultHarness:false` untouched.
   */
  const MINTED = 'bootstrap-xyz';
  const workingTokenStore = { createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }) };

  test('LIN-1431: a follow-up on a claude-code-resolved anchor carries a bootstrapToken', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({
      history: twoSessionHistory(), anchorHarness: 'claude-code', proxyTokenStore: workingTokenStore,
    });
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });

    assert.ok(dispatchQueueStore.getItemStatusCalls > 0,
      'the anchor must actually be consulted — otherwise this passes for the wrong reason');
    assert.strictEqual(dispatchQueueStore.calls[0].item.harness, 'claude-code',
      'harness is inherited from the anchor, which is what arms the MCP branch');
    assert.strictEqual(dispatchQueueStore.calls[0].item.bootstrapToken, MINTED,
      'a resumed broker-dependent session must receive a LIVE credential');
    assert.strictEqual(dispatchQueueStore.calls[0].item.prompt, 'ship it',
      'provisioning appends no prose — the prompt is the trimmed original');
  });

  test('LIN-1431: a follow-up on a BLANK-harness anchor mints nothing and stays null', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({
      history: twoSessionHistory(), anchorHarness: null, proxyTokenStore: workingTokenStore,
    });
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });

    assert.ok(dispatchQueueStore.getItemStatusCalls > 0, 'the anchor was consulted');
    assert.strictEqual(dispatchQueueStore.calls[0].item.harness, null,
      'a blank anchor must NOT be silently upgraded to claude-code (LIN-1111)');
    assert.strictEqual(dispatchQueueStore.calls[0].item.bootstrapToken, null,
      'a prose-path token has no channel to the worker — minting one would strand it');
  });

  test('LIN-1431: a claude-code follow-up whose mint fails is refused, nothing enqueued (fail-closed)', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({
      history: twoSessionHistory(),
      anchorHarness: 'claude-code',
      proxyTokenStore: { createToken: async () => { throw new Error('rate limited'); } },
    });
    // The tool surfaces the throw rather than resuming credential-less: the
    // factory propagates before addItem (LIN-1175).
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } }),
      /credential-less|token mint failed|cannot attach/i,
    );
    assert.strictEqual(dispatchQueueStore.calls.length, 0, 'no item was ever enqueued');
  });
});

// LIN-1486: `send_follow_up` must target the TAIL of the anchor's own lineage
// (not the session root) and derive `force` from that tail's own terminality
// (not an aggregate across the whole session). The `sessionIsTerminal` mock
// used by the OTHER send_follow_up tests above is intentionally a loose
// "any loop done" stub — fine for those tests, but it doesn't reproduce the
// real bug (root-anchored, anchor-first-then-all()). This block injects a
// FAITHFUL mirror of the real `sessionIsTerminal`/`loopIsTerminal`
// (routes/dashboard.js:160-185) so the RED failures below are for the right
// reason — root-targeting and anchor-only force — not an artifact of a loose
// test double.
const MOCK_TERMINAL_AGENT_STATES = new Set(['complete', 'error']);
const MOCK_MARKER_TO_AGENT_STATE = { done: 'complete', failed: 'error', aborted: 'error', skipped: 'complete' };
function mockLoopIsTerminal(l) {
  if (!l) return false;
  if (MOCK_TERMINAL_AGENT_STATES.has(l.agentState)) return true;
  return l.terminalStatus ? MOCK_TERMINAL_AGENT_STATES.has(MOCK_MARKER_TO_AGENT_STATE[l.terminalStatus]) : false;
}
function mockSessionIsTerminal(session) {
  const loops = session.loops || [];
  const anchor = loops.find(l => l.kind === 'autopilot');
  if (anchor) return mockLoopIsTerminal(anchor);
  return loops.length > 0 && loops.every(mockLoopIsTerminal);
}

describe('LIN-1486: send_follow_up targets the lineage tail, not the session root', () => {
  function makeFakeDispatchQueueStore(history) {
    const calls = [];
    const stores = makeMockSessionStores({ history });
    return {
      ...stores.dispatchQueueStore,
      calls,
      async addItem(urlKey, item) {
        calls.push({ urlKey, item });
        return { _id: 'queued-item-1', urlKey, ...item };
      },
    };
  }

  function makeCatalog(history) {
    const provider = makeFakeProvider();
    const dispatchQueueStore = makeFakeDispatchQueueStore(history);
    const { executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore, agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionIsTerminal: mockSessionIsTerminal,
      followUpEnabled: true,
    });
    return { executeTool, dispatchQueueStore };
  }

  test('targets the lineage tail (the wake), not the session root', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog(multiWakeHistory());
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-multi', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.followUpTo, 'wake-1',
      'must resume the live tail, not the long-finished root anchor');
  });

  test('force is the TAIL\'s own terminality — a running tail behind a done anchor is force:false', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog(multiWakeHistory());
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-multi', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, false,
      'the tail is still running — force:true here would kill-first a live run (the LIN-1252 collision)');
  });

  test('force is the TAIL\'s own terminality — a done tail behind a running anchor is force:true', async () => {
    const history = multiWakeHistory({
      anchorFeedback: [{ message: '[working] 1 tools/2s · alive', timestamp: T_MULTI_ANCHOR_DISPATCHED }],
      anchorResolvedAt: null,
      tailFeedback: [{ message: '[done] Task completed in 5s', timestamp: T_MULTI_WAKE_DONE }],
      tailResolvedAt: T_MULTI_WAKE_DONE,
    });
    const { executeTool, dispatchQueueStore } = makeCatalog(history);
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-multi', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'anchor-first (the old rule) would read the still-running anchor and wrongly return false');
  });

  test('sibling-lineage isolation — a worker dispatched AFTER the tail must not be chosen over it', async () => {
    // w-side (a sibling lineage — no rootItemId) is dispatched later than wake-1.
    // A naive "last loop in session.loops" implementation would pick w-side.
    const { executeTool, dispatchQueueStore } = makeCatalog(multiWakeHistory());
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-multi', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.followUpTo, 'wake-1',
      'the sibling worker w-side must never be targeted for the anchor\'s own follow-up');
  });

  test('an aborted tail forces, even though its agentState alone is not terminal', async () => {
    // The abort marker lands on an otherwise still-"taken"/"running" loop
    // (harvestAbortedTargets appends a synthetic [aborted] entry to a live
    // target's feedback) — LIN-1478's literal `terminalStatus === 'done'||'failed'`
    // shape would miss this; the fix's predicate must also check terminalStatus
    // against ALL four markers, not just agentState.
    const history = [
      sessionHistoryItem({
        id: 'sess-abort', kind: 'autopilot', issueIdentifier: 'LIN-601', target: 'cli',
        dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[aborted] Aborted by operator', timestamp: T_MULTI_ANCHOR_DONE }],
      }),
    ];
    const { executeTool, dispatchQueueStore } = makeCatalog(history);
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-abort', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'terminalStatus:"aborted" must force even when historyStatus/agentStatus alone derive a non-terminal agentState');
  });

  test('an expired tail forces via its terminal agentState, even with no feedback marker at all', async () => {
    // `_deriveAgentState` maps historyStatus:'expired' -> agentState:'error' with
    // no terminal feedback marker whatsoever — LIN-1478's literal shape (which
    // only checks terminalStatus) would silently drop force here.
    const history = [
      sessionHistoryItem({
        id: 'sess-expired', kind: 'autopilot', issueIdentifier: 'LIN-602', target: 'cli',
        dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: T_MULTI_ANCHOR_DONE, status: 'expired',
        feedback: [],
      }),
    ];
    const { executeTool, dispatchQueueStore } = makeCatalog(history);
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-expired', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'an expired loop is terminal via agentState alone — no marker is ever posted for it');
  });

  test('a skipped tail forces, even though its agentState alone is not terminal', async () => {
    // `[skipped]` (LIN-1478's runner-refused-cancel marker) is the OTHER
    // terminalStatus value LIN-1478's literal `'done'||'failed'` check misses —
    // sibling to the aborted case above, mapping to agentState:'complete' via
    // MARKER_TO_AGENT_STATE rather than 'error'.
    const history = [
      sessionHistoryItem({
        id: 'sess-skipped', kind: 'autopilot', issueIdentifier: 'LIN-603', target: 'cli',
        dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[skipped] Human continued the session', timestamp: T_MULTI_ANCHOR_DONE }],
      }),
    ];
    const { executeTool, dispatchQueueStore } = makeCatalog(history);
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-skipped', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'terminalStatus:"skipped" must force even when historyStatus/agentStatus alone derive a non-terminal agentState');
  });

  test('a cancelled tail forces via its terminal agentState, even with no feedback marker at all', async () => {
    // `_deriveAgentState` maps historyStatus:'cancelled' -> agentState:'complete'
    // (the operator explicitly removed the item) with no terminal feedback
    // marker — sibling to the expired case above, exercising the OTHER
    // no-marker terminal agentState value.
    const history = [
      sessionHistoryItem({
        id: 'sess-cancelled', kind: 'autopilot', issueIdentifier: 'LIN-604', target: 'cli',
        dispatchedAt: T_MULTI_ANCHOR_DISPATCHED, resolvedAt: T_MULTI_ANCHOR_DONE, status: 'cancelled',
        feedback: [],
      }),
    ];
    const { executeTool, dispatchQueueStore } = makeCatalog(history);
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-cancelled', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'a cancelled loop is terminal via agentState alone — no marker is ever posted for it');
  });

  test('anchorless multi-loop session (orphan explicit-sessionId group) — force is the fallback anchor\'s OWN lineage tail, not the old every() aggregate', async () => {
    // findAnchorLoop(session) returns null here (no kind:'autopilot' loop), so
    // the handler falls back to session.loops[0] as its anchor — w1, the
    // first-dispatched loop. w1's own (single-loop) lineage tail is itself
    // (done), so force must be true. The OLD sessionIsTerminal aggregate
    // (loops.every(loopIsTerminal)) would have been FALSE here, since w2 is
    // still running — proving this is a genuine behaviour change on an
    // anchorless session, not a no-op re-derivation of the prior answer.
    const { executeTool, dispatchQueueStore } = makeCatalog(orphanMultiLoopHistory());
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-orphan', prompt: 'continue' } });
    assert.strictEqual(dispatchQueueStore.calls[0].item.followUpTo, 'w1',
      'targets the fallback anchor (session.loops[0]) itself, its own lineage tail');
    assert.strictEqual(dispatchQueueStore.calls[0].item.force, true,
      'w1 is done; the old every()-across-both-workers aggregate would have said false because w2 is still running');
  });
});

// LIN-2434 beat 3, Part B — DIRECT unit coverage for the exported
// `deriveFollowUpDispatch` helper itself (LIN-2433 review ledger item 2). At
// LIN-2433's own merge it was proved only TRANSITIVELY through send_follow_up
// (the 'LIN-1486' describe block just above, driving the same scenarios
// through executeTool). As the helper's second consumer (LIN-2434's
// approve-follow-up route), this ticket owes it direct tests: call the
// helper itself and assert on ITS OWN return value.
//
// Realistic scenarios reuse the SAME fixtures/real getSessionsForWorkspace
// reconstruction as the block above (multiWakeHistory/orphanMultiLoopHistory)
// rather than re-deriving a parallel fixture set. The two edge cases the
// JSDoc promises but that fixture set never happens to produce — the dash/
// local throw (needs no real session shape at all) and the TRUE no-loops
// orphan fallback (a documented contract of the pure function, per its own
// JSDoc: "Falls back to session.sessionId/false when there's no anchor at
// all") — use hand-built minimal session objects instead.
describe('deriveFollowUpDispatch — direct unit coverage (LIN-2433 review ledger item 2)', () => {
  async function realSession(history, sessionId) {
    const stores = makeMockSessionStores({ history });
    const sessions = await getSessionsForWorkspace(URL_KEY, {
      dispatchStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    });
    const session = sessions.find(s => s.sessionId === sessionId);
    assert.ok(session, `expected a reconstructed session for ${sessionId}`);
    return session;
  }

  test('targets the lineage TAIL (the wake), not the session root — LIN-1486', async () => {
    const session = await realSession(multiWakeHistory(), 'sess-multi');
    assert.strictEqual(deriveFollowUpDispatch(session).followUpTo, 'wake-1',
      'must resume the live tail, not the long-finished root anchor');
  });

  test('force is the TAIL\'s own terminality, independent of the anchor\'s', async () => {
    const runningTail = await realSession(multiWakeHistory(), 'sess-multi');
    assert.strictEqual(deriveFollowUpDispatch(runningTail).force, false,
      'the tail is still running — the done anchor must not leak into force');

    const doneTail = await realSession(multiWakeHistory({
      anchorFeedback: [{ message: '[working] 1 tools/2s · alive', timestamp: T_MULTI_ANCHOR_DISPATCHED }],
      anchorResolvedAt: null,
      tailFeedback: [{ message: '[done] Task completed in 5s', timestamp: T_MULTI_WAKE_DONE }],
      tailResolvedAt: T_MULTI_WAKE_DONE,
    }), 'sess-multi');
    assert.strictEqual(deriveFollowUpDispatch(doneTail).force, true,
      'the still-running anchor must not leak into force when the tail itself is done');
  });

  test('sibling-lineage isolation — a later-dispatched sibling worker is never chosen over the anchor\'s own tail', async () => {
    const session = await realSession(multiWakeHistory(), 'sess-multi');
    assert.strictEqual(deriveFollowUpDispatch(session).followUpTo, 'wake-1',
      'the sibling worker w-side must never be targeted for the anchor\'s own follow-up');
  });

  test('anchorless multi-loop session — falls back to session.loops[0] as the anchor, targeting ITS OWN lineage tail', async () => {
    const session = await realSession(orphanMultiLoopHistory(), 'sess-orphan');
    const result = deriveFollowUpDispatch(session);
    assert.strictEqual(result.followUpTo, 'w1', 'the fallback anchor (loops[0]) is its own single-loop lineage tail');
    assert.strictEqual(result.force, true, 'w1 itself is done, independent of w2 still running');
  });

  test('throws for a dash anchor target — not supported for follow-up', () => {
    const session = { sessionId: 'sess-dash', loops: [{ loopId: 'sess-dash', kind: 'autopilot', target: 'dash' }] };
    assert.throws(() => deriveFollowUpDispatch(session), /dash\/local targets are not supported/);
  });

  test('throws for a local anchor target — not supported for follow-up', () => {
    const session = { sessionId: 'sess-local', loops: [{ loopId: 'sess-local', kind: 'autopilot', target: 'local' }] };
    assert.throws(() => deriveFollowUpDispatch(session), /dash\/local targets are not supported/);
  });

  test('a true orphan (no loops at all) falls back to session.sessionId with force:false, target defaulting to cli', () => {
    const session = { sessionId: 'sess-empty', loops: [] };
    assert.deepStrictEqual(deriveFollowUpDispatch(session), { followUpTo: 'sess-empty', target: 'cli', force: false });
  });

  test('a single-loop anchor with no follow-up wake yet targets itself, force from its OWN terminality', () => {
    const nonTerminal = { sessionId: 'sess-solo', loops: [{ loopId: 'sess-solo', kind: 'autopilot', target: 'web' }] };
    assert.deepStrictEqual(deriveFollowUpDispatch(nonTerminal), { followUpTo: 'sess-solo', target: 'web', force: false });

    const terminal = { sessionId: 'sess-solo-2', loops: [{ loopId: 'sess-solo-2', kind: 'autopilot', target: 'web', terminalStatus: 'done' }] };
    assert.deepStrictEqual(deriveFollowUpDispatch(terminal), { followUpTo: 'sess-solo-2', target: 'web', force: true });
  });
});

// LIN-2432 §A.4: `followUpMode` ('execute'|'propose', default 'execute') lets a
// call site built for a non-human-started turn (Flight Companion auto-wake)
// stop `send_follow_up` short of any write. Default omission must be
// byte-identical to pre-existing behaviour — the whole 'pass-3 write tool'
// and 'LIN-1486' blocks above construct their catalogs with no followUpMode
// argument at all and must keep passing unmodified.
describe('LIN-2432 §A.4: send_follow_up followUpMode (execute/propose)', () => {
  function makeFakeDispatchQueueStore(history) {
    const calls = [];
    const stores = makeMockSessionStores({ history });
    return {
      ...stores.dispatchQueueStore,
      calls,
      async addItem(urlKey, item) {
        calls.push({ urlKey, item });
        return { _id: 'queued-item-1', urlKey, ...item };
      },
    };
  }

  function makeCatalog({ history, followUpMode } = {}) {
    const provider = makeFakeProvider();
    const dispatchQueueStore = makeFakeDispatchQueueStore(history);
    const catalog = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore, agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
      followUpEnabled: true,
      ...(followUpMode !== undefined ? { followUpMode } : {}),
    });
    return { ...catalog, dispatchQueueStore };
  }

  test('defaults to execute — omitting followUpMode entirely is byte-identical to today', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory() });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.deepStrictEqual(result, { queued: true, itemId: 'queued-item-1', sessionId: 'sess-done', target: 'cli', force: true });
    assert.strictEqual(dispatchQueueStore.calls.length, 1, 'createDispatchItem ran exactly as it does today');
  });

  test('followUpMode: "execute" explicitly behaves the same as the default', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory(), followUpMode: 'execute' });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.deepStrictEqual(result, { queued: true, itemId: 'queued-item-1', sessionId: 'sess-done', target: 'cli', force: true });
    assert.strictEqual(dispatchQueueStore.calls.length, 1);
  });

  test('followUpMode: "propose" never calls createDispatchItem (asserted on the store spy, not just the return value)', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory(), followUpMode: 'propose' });
    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.strictEqual(dispatchQueueStore.calls.length, 0, 'addItem (behind createDispatchItem) was never invoked');
  });

  test('followUpMode: "propose" returns exactly { proposed, sessionId, prompt } — no derived force/target/followUpTo', async () => {
    const { executeTool } = makeCatalog({ history: twoSessionHistory(), followUpMode: 'propose' });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.deepStrictEqual(result, { proposed: true, sessionId: 'sess-done', prompt: 'ship it' });
    assert.deepStrictEqual(Object.keys(result).sort(), ['prompt', 'proposed', 'sessionId']);
  });

  test('followUpMode: "propose" still validates and still 404s an unknown session, before proposing anything', async () => {
    const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory(), followUpMode: 'propose' });
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'no-such', prompt: 'hi' } }),
      /Session no-such not found/,
    );
    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: '  ' } }),
      /non-empty "prompt"/,
    );
    assert.strictEqual(dispatchQueueStore.calls.length, 0);
  });

  test('followUpMode: "propose" would have hit the dash/local guard in execute mode but never reaches it — proves derivation is skipped, not just its result discarded', async () => {
    const history = [
      ...twoSessionHistory(),
      sessionHistoryItem({
        id: 'sess-dash', kind: 'autopilot', issueIdentifier: 'LIN-502', target: 'dash',
        feedback: [{ message: '[working] 1 tools/2s · alive', timestamp: '2026-04-11T11:05:00.000Z' }],
      }),
    ];
    const { executeTool } = makeCatalog({ history, followUpMode: 'propose' });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-dash', prompt: 'hi' } });
    assert.deepStrictEqual(result, { proposed: true, sessionId: 'sess-dash', prompt: 'hi' });
  });
});

describe('read-only invariant', () => {
  test('the catalog exposes no write/mutation tools', () => {
    const names = CHAT_TOOL_SCHEMAS.map(t => t.function.name);
    const writeish = /create|update|delete|add|remove|move|mutat|write|comment|label|assign|close|archive/i;
    // Read tools are named with an explicit read verb (get_/lookup_/search_).
    // The heuristic flags nouns like "comment" that also appear in write tool
    // names; a read-verb prefix means the tool is unambiguously a lookup
    // (e.g. get_comments reads a thread, it does not post one — LIN-1065).
    const readVerb = /^(get|lookup|search|list|read|fetch)_/i;
    for (const name of names) {
      if (readVerb.test(name)) continue;
      assert.ok(!writeish.test(name), `unexpected write-shaped tool: ${name}`);
    }
  });

  test('send_follow_up (LIN-1073) is the sole, deliberate exception — kept out of CHAT_TOOL_SCHEMAS', () => {
    assert.strictEqual(FOLLOW_UP_TOOL_SCHEMA.function.name, 'send_follow_up');
    assert.ok(!CHAT_TOOL_SCHEMAS.includes(FOLLOW_UP_TOOL_SCHEMA));
  });
});

// ─── Pass-4 (LIN-2617): the fleet-wide reads ─────────────────────────────────

const T_FLEET_OLD = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
const T_FLEET_MID = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const T_FLEET_FRESH = new Date(Date.now() - 10 * 60 * 1000).toISOString();

// A fleet with one of each thing the tool has to get right: a session still
// moving, a session parked on a human, a finished session, and a bare `wake`
// loop that — with no sessionId and no followUpTo — would otherwise surface as
// its own session row via `_buildSessions`' standalone pass.
function fleetHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-working', kind: 'autopilot', issueIdentifier: 'LIN-700', target: 'cli',
      dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 3 tools/12s · alive', timestamp: T_FLEET_FRESH }],
    }),
    sessionHistoryItem({
      id: 'sess-blocked', kind: 'autopilot', issueIdentifier: 'LIN-701', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[blocked] Needs a ruling on the merge order', timestamp: T_FLEET_MID }],
    }),
    sessionHistoryItem({
      id: 'sess-finished', kind: 'autopilot', issueIdentifier: 'LIN-702', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: T_FLEET_MID, status: 'taken',
      feedback: [{ message: '[done] Task completed in 9s', timestamp: T_FLEET_MID }],
    }),
    sessionHistoryItem({
      id: 'wake-loose', kind: 'wake', issueIdentifier: 'LIN-703', target: 'cli',
      dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] re-waking held session', timestamp: T_FLEET_MID }],
    }),
  ];
}

function makeFleetCatalog(history) {
  const stores = makeMockSessionStores({ history });
  const { executeTool } = createChatToolCatalog({
    provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
    dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
  });
  return { executeTool, stores };
}

describe('pass-4 fleet read — list_active_sessions (LIN-2617)', () => {
  test('folds a bare wake loop into noise instead of emitting it as a session row', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    // The wake loop DID reconstruct into its own standalone session (that is
    // `_buildSessions`' pass-3 behaviour, not something this tool controls) —
    // the tool is what must decline to report it as work.
    assert.strictEqual(
      result.sessions.some(r => r.sessionId === 'wake-loose'), false,
      'a wake loop must never be its own row'
    );
    assert.strictEqual(result.noise.wakeLoopsFolded, 1);
    // ...and the fold is not achieved by dropping the fleet: the three real
    // sessions all survive it.
    assert.deepStrictEqual(
      result.sessions.map(r => r.sessionId).sort(),
      ['sess-blocked', 'sess-finished', 'sess-working']
    );
  });

  test('session lanes agree with classifyLoop on the same fixture, folded to the lineage tail', async () => {
    const history = fleetHistory();
    const { executeTool, stores } = makeFleetCatalog(history);
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    // Re-derive the expectation through the IMPORTED classifier with the same
    // two inputs the sweep passes it. A hand-rolled lane rule in the tool
    // diverges from this and fails.
    const sessions = await getSessionsForWorkspace(URL_KEY, {
      dispatchStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    });
    const superseded = computeSupersededLoopIds(sessions.flatMap(s => s.loops || []));
    const now = Date.now();

    assert.ok(result.sessions.length > 0);
    for (const row of result.sessions) {
      const session = sessions.find(s => s.sessionId === row.sessionId);
      const workLoops = (session.loops || []).filter(l => l.kind !== 'wake');
      // Single-loop sessions here, so the lineage tail is the loop itself.
      assert.strictEqual(workLoops.length, 1, `${row.sessionId} fixture is single-loop`);
      assert.strictEqual(
        row.lifecycle,
        classifyLoop(workLoops[0], { superseded, now, staleMs: DEFAULT_LANE_STALE_MS }),
        `${row.sessionId} lane must be classifyLoop's, not a second opinion`
      );
    }

    // And the fixture really does exercise more than one lane, so the agreement
    // above is not vacuously true.
    const lanes = new Set(result.sessions.map(r => r.lifecycle));
    assert.ok(lanes.size >= 2, `expected several lanes, got ${[...lanes].join(',')}`);
  });

  test('the default read omits finished sessions and counts them as noise; lane:all keeps them', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());

    const dflt = await executeTool({ name: 'list_active_sessions', arguments: {} });
    assert.strictEqual(dflt.sessions.some(r => r.sessionId === 'sess-finished'), false);
    assert.strictEqual(dflt.noise.terminalOmitted, 1);

    const all = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.strictEqual(all.sessions.some(r => r.sessionId === 'sess-finished'), true);
  });

  test('rows carry real ids and a waiting-on-human flag, sorted by last activity descending', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());
    const result = await executeTool({ name: 'list_active_sessions', arguments: {} });

    const blocked = result.sessions.find(r => r.sessionId === 'sess-blocked');
    assert.strictEqual(blocked.lifecycle, 'blocked');
    assert.strictEqual(blocked.waitingOnHuman, true);
    assert.strictEqual(blocked.seedIssue, 'LIN-701');
    assert.deepStrictEqual(blocked.tasksTouched, ['LIN-701']);
    assert.strictEqual(blocked.kind, 'autopilot');
    assert.strictEqual(blocked.latestMarker, 'blocked');
    assert.match(blocked.latestFeedback, /Needs a ruling on the merge order/);
    assert.strictEqual(blocked.runCount, 1);

    const working = result.sessions.find(r => r.sessionId === 'sess-working');
    assert.strictEqual(working.waitingOnHuman, false);

    const stamps = result.sessions.map(r => r.lastActivityAt);
    assert.deepStrictEqual(stamps, [...stamps].sort().reverse(), 'sorted by lastActivityAt desc');
  });

  test('the lane filter is validated, and the read needs its stores', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());
    await assert.rejects(
      () => executeTool({ name: 'list_active_sessions', arguments: { lane: 'terminal' } }),
      /lane/
    );

    const { executeTool: unconfigured } = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
    });
    await assert.rejects(
      () => unconfigured({ name: 'list_active_sessions', arguments: {} }),
      /not configured/
    );
  });

  test('projectActiveSession is exported and pure, so LIN-1951 reuses this shape', () => {
    const row = projectActiveSession(
      {
        sessionId: 's1', seedIssue: 'LIN-9', tasksTouched: ['LIN-9'], dispatchedAt: T_FLEET_MID,
        loops: [{
          loopId: 's1', kind: 'autopilot', dispatchedAt: T_FLEET_MID, agentState: 'running',
          terminalStatus: null, wakeMarker: null, feedback: [{ message: 'hello', timestamp: T_FLEET_MID }],
        }],
      },
      { superseded: new Set(), now: Date.now(), staleMs: DEFAULT_LANE_STALE_MS }
    );
    assert.deepStrictEqual(Object.keys(row).sort(), [
      'dispatchedAt', 'kind', 'lastActivityAt', 'latestFeedback', 'latestMarker', 'lifecycle',
      'parentSessionId', 'runCount', 'seedIssue', 'sessionId', 'tasksTouched', 'waitingOnHuman',
    ]);
    assert.strictEqual(row.latestFeedback, 'hello');
  });
});

function decisionEntry(id, question, timestamp) {
  return {
    kind: 'decision',
    timestamp,
    message: `[decision] ${JSON.stringify({
      decision_id: id,
      question,
      options: [{ id: 'a', label: 'Merge now' }, { id: 'b', label: 'Hold for the witness' }],
      recommended: 'b',
    })}`,
  };
}

// One of each of the predicate's three inputs, exactly as the acceptance names
// them: a dispatch-loop decision, a task-bound decision, and a decision that is
// actively shelved (which must NOT come back).
function decisionsFixture() {
  const history = [
    sessionHistoryItem({
      id: 'sess-dec', kind: 'autopilot', issueIdentifier: 'LIN-800', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [
        { message: '[blocked] waiting on a ruling', timestamp: T_FLEET_OLD },
        decisionEntry('dec-loop', 'Merge PR #219 before or after the witness?', T_FLEET_OLD),
      ],
    }),
    sessionHistoryItem({
      id: 'sess-shelved', kind: 'autopilot', issueIdentifier: 'LIN-801', target: 'cli',
      dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
      feedback: [
        { message: '[blocked] parked', timestamp: T_FLEET_MID },
        decisionEntry('dec-shelved', 'Should we rename the flag?', T_FLEET_MID),
      ],
    }),
  ];
  const taskDecisions = [{
    id: 'td-1', urlKey: URL_KEY, issueId: 'uuid-802', issueIdentifier: 'LIN-802',
    scannedAt: T_FLEET_FRESH, outcome: null,
    decision: {
      decision_id: 'dec-task',
      question: 'This ticket has two conflicting acceptance criteria — which holds?',
      options: [{ id: 'a', label: 'The description' }, { id: 'b', label: 'The review comment' }],
      recommended: 'b',
    },
  }];
  const shelvedRulings = [{
    urlKey: URL_KEY, decisionId: 'dec-shelved',
    resurfaceAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lapseCount: 1,
  }];
  return { history, taskDecisions, shelvedRulings };
}

function makeDecisionsCatalog({ history, taskDecisions, shelvedRulings }) {
  const stores = makeMockSessionStores({ history });
  const { executeTool } = createChatToolCatalog({
    provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
    dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    sessionIsTerminal: () => false,
    taskDecisionsStore: { async listUnansweredForWorkspaces() { return taskDecisions; } },
    shelvedRulingsStore: { async listForWorkspaces() { return shelvedRulings; } },
  });
  return { executeTool, stores };
}

describe('pass-4 fleet read — list_pending_decisions (LIN-2617)', () => {
  test('returns exactly the rows the rulings feed returns for the same three inputs', async () => {
    const fixture = decisionsFixture();
    const { executeTool, stores } = makeDecisionsCatalog(fixture);
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });

    // The feed's own call, on the same inputs — not a hand-written expectation.
    // If this tool ever grows a second classifier, the two diverge here.
    const rawLoops = await getLoopsForWorkspace(URL_KEY, {
      dispatchStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore, lean: true,
    });
    const loops = rawLoops.map(l => ({ ...l, workspaceUrlKey: URL_KEY }));
    const feedRows = collectUnansweredDecisions(
      { loops, taskDecisions: fixture.taskDecisions, shelvedRulings: fixture.shelvedRulings },
      { now: new Date() }
    );

    assert.deepStrictEqual(
      result.decisions.map(d => d.decisionId).sort(),
      feedRows.map(r => r.decision.decision_id).sort()
    );
    assert.strictEqual(result.count, feedRows.length);
  });

  test('an actively shelved ruling stays out, and a shelve is what keeps it out', async () => {
    const fixture = decisionsFixture();

    const withShelf = await (await makeDecisionsCatalog(fixture)).executeTool(
      { name: 'list_pending_decisions', arguments: {} }
    );
    assert.strictEqual(withShelf.decisions.some(d => d.decisionId === 'dec-shelved'), false);

    // Drop the shelf row and the same decision reappears — so the exclusion is
    // the shelvedRulings input doing its job, not the fixture being empty.
    const noShelf = await (await makeDecisionsCatalog({ ...fixture, shelvedRulings: [] })).executeTool(
      { name: 'list_pending_decisions', arguments: {} }
    );
    assert.strictEqual(noShelf.decisions.some(d => d.decisionId === 'dec-shelved'), true);
  });

  test('rows carry the question, options and recommendation, oldest first', async () => {
    const { executeTool } = makeDecisionsCatalog(decisionsFixture());
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });

    const loopRow = result.decisions.find(d => d.decisionId === 'dec-loop');
    assert.strictEqual(loopRow.issueIdentifier, 'LIN-800');
    assert.strictEqual(loopRow.sessionId, 'sess-dec');
    assert.match(loopRow.question, /Merge PR #219/);
    assert.deepStrictEqual(loopRow.options.map(o => o.id), ['a', 'b']);
    assert.strictEqual(loopRow.recommended, 'b');
    assert.strictEqual(loopRow.canReply, true);
    assert.ok(loopRow.since, 'a parked-since lower bound is reported');

    const taskRow = result.decisions.find(d => d.decisionId === 'dec-task');
    assert.strictEqual(taskRow.disposition, 'task-bound');
    assert.strictEqual(taskRow.sessionId, null, 'a task decision has no run behind it');

    // Oldest first: the loop decision (5h) precedes the task scan (10m).
    const order = result.decisions.map(d => d.decisionId);
    assert.ok(order.indexOf('dec-loop') < order.indexOf('dec-task'), `got ${order.join(',')}`);
  });

  test('fails cleanly as not-configured when the shelved-rulings store is absent', async () => {
    const stores = makeMockSessionStores({ history: decisionsFixture().history });
    const { executeTool } = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
      taskDecisionsStore: { async listUnansweredForWorkspaces() { return []; } },
    });
    // Without it, a decision a human deliberately shelved would resurface — so
    // this degrades to "not configured" rather than to a wrong answer.
    await assert.rejects(
      () => executeTool({ name: 'list_pending_decisions', arguments: {} }),
      /not configured/
    );
  });

  test('is read-only: it never answers or dismisses, and calls no store method that could', async () => {
    const fixture = decisionsFixture();
    const calls = [];
    const stores = makeMockSessionStores({ history: fixture.history });
    const { executeTool } = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
      taskDecisionsStore: new Proxy({
        async listUnansweredForWorkspaces() { return fixture.taskDecisions; },
      }, { get(t, k) { calls.push(String(k)); return t[k]; } }),
      shelvedRulingsStore: new Proxy({
        async listForWorkspaces() { return fixture.shelvedRulings; },
      }, { get(t, k) { calls.push(String(k)); return t[k]; } }),
    });
    await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.deepStrictEqual(
      [...new Set(calls)].sort(), ['listForWorkspaces', 'listUnansweredForWorkspaces'],
      'only the two list reads — never markDecisionAnswered/dismiss/shelve'
    );
  });
});

describe('pass-4 fleet reads — partial lists say so (LIN-2617)', () => {
  test('a capped list reports the full matching count AND flags itself truncated', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());
    const capped = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all', limit: 1 } });
    // Quoting `count` must stay safe: it is the fleet total, not the row count.
    assert.strictEqual(capped.count, 3);
    assert.strictEqual(capped.sessions.length, 1);
    assert.strictEqual(capped.truncated, true);

    const whole = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.strictEqual(whole.truncated, false);
  });

  test('the decisions list flags truncation the same way', async () => {
    const { executeTool } = makeDecisionsCatalog(decisionsFixture());
    const capped = await executeTool({ name: 'list_pending_decisions', arguments: { limit: 1 } });
    assert.strictEqual(capped.count, 2);
    assert.strictEqual(capped.decisions.length, 1);
    assert.strictEqual(capped.truncated, true);
    // Oldest-first survives the cap: the longest-parked decision is the one
    // that must not be truncated away.
    assert.strictEqual(capped.decisions[0].decisionId, 'dec-loop');
  });
});
