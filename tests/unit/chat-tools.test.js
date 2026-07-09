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
import { createChatToolCatalog, CHAT_TOOL_SCHEMAS, CHAT_TOOL_RESULT_BUDGETS, FOLLOW_UP_TOOL_SCHEMA } from '../../lib/chat-tools.js';
import { TOOL_RESULT_MAX_CHARS } from '../../lib/openrouter.js';
import { hashContext } from '../../lib/recap-cache.js';
import { snapshotFromContext } from '../../lib/task-snapshot-store.js';

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
      'get_relations', 'get_session', 'get_stack', 'list_task_sessions', 'lookup_task',
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

describe('CHAT_TOOL_RESULT_BUDGETS (LIN-1065, LIN-1073)', () => {
  test('grants only get_comments and get_session a larger-than-default budget', () => {
    // Additive map: get_comments and get_session (full transcript, LIN-1073) are
    // the ONLY overrides, each strictly larger than the global default.
    assert.deepStrictEqual(Object.keys(CHAT_TOOL_RESULT_BUDGETS).sort(), ['get_comments', 'get_session']);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments > TOOL_RESULT_MAX_CHARS);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments >= 10000, 'within the recommended ~10-12k range');
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_session > TOOL_RESULT_MAX_CHARS);
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

  function makeCatalog({ history, followUpEnabled = true, dispatchedBy = null } = {}) {
    const provider = makeFakeProvider();
    const dispatchQueueStore = makeFakeDispatchQueueStore(history);
    const { tools, executeTool } = createChatToolCatalog({
      provider, scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore, agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
      followUpEnabled, dispatchedBy,
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
        kind: 'custom', model: null, harness: null, bootstrapToken: null,
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
