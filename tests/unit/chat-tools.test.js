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
import { createChatToolCatalog, CHAT_TOOL_SCHEMAS, CHAT_TOOL_RESULT_BUDGETS, FOLLOW_UP_TOOL_SCHEMA, REMEMBER_TOOL_SCHEMA, PLAYBOOK_MAX_CHARS, deriveFollowUpDispatch, projectActiveSession } from '../../lib/chat-tools.js';
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
      'get_brief', 'get_children_status', 'get_comments', 'get_history', 'get_pr_status',
      'get_recap', 'get_relations', 'get_session', 'get_stack', 'list_active_sessions',
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

describe('CHAT_TOOL_RESULT_BUDGETS (LIN-1065, LIN-1073, LIN-2617, LIN-2624)', () => {
  test('grants only the row-list, transcript and PR-status tools a larger-than-default budget', () => {
    // Additive map: get_comments, get_session (full transcript, LIN-1073), the
    // two LIN-2617 fleet-wide row lists, and LIN-2624's get_pr_status are the
    // ONLY overrides, each strictly larger than the global default.
    assert.deepStrictEqual(Object.keys(CHAT_TOOL_RESULT_BUDGETS).sort(), [
      'get_comments', 'get_pr_status', 'get_session', 'list_active_sessions', 'list_pending_decisions',
    ]);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments > TOOL_RESULT_MAX_CHARS);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_comments >= 10000, 'within the recommended ~10-12k range');
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_session > TOOL_RESULT_MAX_CHARS);
    // LIN-2617: sized so twenty rows fit without truncation — a clipped row list
    // is a silently wrong answer to "what is in flight?", not a shorter one.
    // The exact figures are pinned by the full-cap serialization witnesses
    // below; here we only hold the line that both exceed the global default.
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.list_active_sessions > TOOL_RESULT_MAX_CHARS);
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions > TOOL_RESULT_MAX_CHARS);
    // LIN-2624: a matrix build's check-run rollup can carry dozens of named
    // rows — a truncated CI readout is a silently wrong answer, not a shorter one.
    assert.ok(CHAT_TOOL_RESULT_BUDGETS.get_pr_status > TOOL_RESULT_MAX_CHARS);
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
    // LIN-2617: no longer reference-equal to CHAT_TOOL_SCHEMAS, because a
    // catalog built without the decision stores withholds the one tool that
    // could then only ever throw. Every OTHER schema is still the shared one,
    // by identity — the catalog filters, it never rebuilds or rewrites a schema.
    assert.deepStrictEqual(
      tools.map(t => t.function.name),
      CHAT_TOOL_SCHEMAS.filter(t => t.function.name !== 'list_pending_decisions').map(t => t.function.name)
    );
    for (const t of tools) assert.ok(CHAT_TOOL_SCHEMAS.includes(t), `${t.function.name} must be the shared schema object`);
    assert.strictEqual(typeof executeTool, 'function');
    assert.strictEqual(typeof executors.lookup_task, 'function');
  });

  test('LIN-2617: list_pending_decisions is advertised only when its stores are wired', () => {
    const has = (tools) => tools.some(t => t.function.name === 'list_pending_decisions');

    const bare = createChatToolCatalog({ provider: makeFakeProvider(), scope: SCOPE });
    assert.strictEqual(has(bare.tools), false, 'a tool that could only throw must not be advertised');
    // Still reachable by a direct caller, who gets a real error rather than silence.
    assert.strictEqual(typeof bare.executors.list_pending_decisions, 'function');

    const halfWired = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE,
      taskDecisionsStore: { async listUnansweredForWorkspaces() { return []; } },
    });
    assert.strictEqual(has(halfWired.tools), false, 'both stores are required, not either');

    const wired = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE,
      taskDecisionsStore: { async listUnansweredForWorkspaces() { return []; } },
      shelvedRulingsStore: { async listForWorkspaces() { return []; } },
    });
    assert.strictEqual(has(wired.tools), true);
    // The fleet read needs no new stores, so it is always advertised.
    assert.ok(bare.tools.some(t => t.function.name === 'list_active_sessions'));
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
    // Every schema is the shared object (the catalog filters, never rewrites);
    // reference-equality to the whole array no longer holds since LIN-2617
    // withholds list_pending_decisions from a call site without its stores.
    for (const t of withoutFlag) assert.ok(CHAT_TOOL_SCHEMAS.includes(t));
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

  // LIN-2439: the boundary must FAIL CLOSED. A second producer (a proxy
  // caller, a future refactor) that threads a typo'd or otherwise
  // unrecognised value into followUpMode must propose, never execute — the
  // opposite of the old "anything that isn't exactly 'propose' executes"
  // shape. This is the test that would fail if the default (or the check)
  // flipped back to fail-open.
  for (const garbage of ['Propose', 'propse', 'PROPOSE', 'true', '', 'exec', null, 42, {}]) {
    test(`followUpMode: ${JSON.stringify(garbage)} (unrecognised) fails CLOSED to propose, never executes`, async () => {
      const { executeTool, dispatchQueueStore } = makeCatalog({ history: twoSessionHistory(), followUpMode: garbage });
      const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
      assert.deepStrictEqual(result, { proposed: true, sessionId: 'sess-done', prompt: 'ship it' });
      assert.strictEqual(dispatchQueueStore.calls.length, 0, 'createDispatchItem must never run for an unrecognised followUpMode');
    });
  }
});

// ─── remember (LIN-2625) ─────────────────────────────────────────────────────

describe('remember', () => {
  function makeRememberCatalog({ playbookEnabled = true, onRemember } = {}) {
    const provider = makeFakeProvider();
    return createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY, playbookEnabled, onRemember });
  }

  test('is absent from tools when playbookEnabled is false (the default) — Task Chat never gets it', () => {
    const { tools } = makeRememberCatalog({ playbookEnabled: false, onRemember: () => {} });
    assert.ok(!tools.some(t => t.function.name === 'remember'));
  });

  test('is present in tools when playbookEnabled is true', () => {
    const { tools } = makeRememberCatalog({ onRemember: () => {} });
    assert.ok(tools.some(t => t.function.name === 'remember'));
  });

  test('forwards the validated playbook to onRemember and never touches a store', async () => {
    const calls = [];
    const { executeTool } = makeRememberCatalog({ onRemember: (p) => calls.push(p) });
    const result = await executeTool({ name: 'remember', arguments: { playbook: 'lane G: confirm LIN-1988 at 08:00' } });
    assert.deepStrictEqual(calls, ['lane G: confirm LIN-1988 at 08:00']);
    assert.deepStrictEqual(result, { remembered: true, length: calls[0].length });
  });

  test('a second call in the same turn keeps the last value — REPLACES, never appends', async () => {
    const calls = [];
    const { executeTool } = makeRememberCatalog({ onRemember: (p) => calls.push(p) });
    await executeTool({ name: 'remember', arguments: { playbook: 'first draft' } });
    await executeTool({ name: 'remember', arguments: { playbook: 'final draft' } });
    assert.deepStrictEqual(calls, ['first draft', 'final draft']);
  });

  test('the size cap is enforced with a clear, recoverable tool error — before onRemember is ever called', async () => {
    const calls = [];
    const { executeTool } = makeRememberCatalog({ onRemember: (p) => calls.push(p) });
    const tooLong = 'x'.repeat(PLAYBOOK_MAX_CHARS + 1);
    await assert.rejects(
      () => executeTool({ name: 'remember', arguments: { playbook: tooLong } }),
      new RegExp(`Playbook must be ${PLAYBOOK_MAX_CHARS} characters or fewer`),
    );
    assert.strictEqual(calls.length, 0, 'a rejected call must never reach the buffer');
  });

  test('exactly at the cap succeeds (boundary, not off-by-one)', async () => {
    const calls = [];
    const { executeTool } = makeRememberCatalog({ onRemember: (p) => calls.push(p) });
    const atCap = 'x'.repeat(PLAYBOOK_MAX_CHARS);
    const result = await executeTool({ name: 'remember', arguments: { playbook: atCap } });
    assert.strictEqual(result.remembered, true);
    assert.strictEqual(calls.length, 1);
  });

  test('a non-string playbook is rejected before onRemember is called', async () => {
    const calls = [];
    const { executeTool } = makeRememberCatalog({ onRemember: (p) => calls.push(p) });
    await assert.rejects(
      () => executeTool({ name: 'remember', arguments: { playbook: 42 } }),
      /requires a string "playbook"/,
    );
    assert.strictEqual(calls.length, 0);
  });

  test('fails cleanly as not-configured when playbookEnabled is true but onRemember is missing (mutation-check: a misconfigured call site never silently no-ops)', async () => {
    const provider = makeFakeProvider();
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY, playbookEnabled: true });
    await assert.rejects(
      () => executeTool({ name: 'remember', arguments: { playbook: 'x' } }),
      /not configured/,
    );
  });

  test('a proxy-shaped catalog construction (playbookEnabled omitted, matching routes/proxy-flight-companion.js) advertises no remember tool, and the model can never reach it', async () => {
    const provider = makeFakeProvider();
    const { tools, executeTool } = createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY });
    assert.ok(!tools.some(t => t.function.name === 'remember'), 'a proxy turn must never see remember in its own tool list');
    await assert.rejects(
      () => executeTool({ name: 'remember', arguments: { playbook: 'x' } }),
      /not configured/,
    );
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

  test('send_follow_up (LIN-1073) and remember (LIN-2625) are the two deliberate exceptions — both kept out of CHAT_TOOL_SCHEMAS', () => {
    assert.strictEqual(FOLLOW_UP_TOOL_SCHEMA.function.name, 'send_follow_up');
    assert.strictEqual(REMEMBER_TOOL_SCHEMA.function.name, 'remember');
    assert.ok(!CHAT_TOOL_SCHEMAS.includes(FOLLOW_UP_TOOL_SCHEMA));
    assert.ok(!CHAT_TOOL_SCHEMAS.includes(REMEMBER_TOOL_SCHEMA));
  });
});

// ─── Invariant 2 (workspace-scoped): the LIN-2624 exception ─────────────────
//
// Invariant #2 (lib/chat-tools.js:16-20) is that no executor accepts a
// workspace/token/scope argument from the model — every OTHER tool takes only
// an issue id or a query. `get_pr_status` is the one deliberate, named
// exception: it takes a model-supplied `repo`, checked against a
// server-derived allowlist rather than trusted outright. This is distinct
// from the pre-existing "read-only invariant" tests above (invariant #3).

describe('invariant 2 exception (LIN-2624)', () => {
  test('get_pr_status is the sole schema accepting a cross-workspace "repo" — every other tool stays closure-scoped', () => {
    const crossScopeParamNames = ['repo', 'workspace', 'workspaceId', 'urlKey', 'token', 'scope'];
    for (const t of CHAT_TOOL_SCHEMAS) {
      const props = Object.keys(t.function.parameters.properties || {});
      const found = props.find(p => crossScopeParamNames.includes(p));
      if (t.function.name === 'get_pr_status') {
        assert.strictEqual(found, 'repo', 'get_pr_status must declare a "repo" parameter');
      } else {
        assert.strictEqual(found, undefined, `${t.function.name} unexpectedly accepts a cross-scope "${found}" parameter`);
      }
    }
  });
});

// ─── get_pr_status (LIN-2624) ────────────────────────────────────────────────

describe('get_pr_status', () => {
  // A fake provider whose fetchProjects reports one project bound to the
  // public LinearViewer repo via the `repo=` convention (lib/workspace-repos.js).
  function makeRepoProvider({ repo = 'JKershaw/LinearViewer' } = {}) {
    return makeFakeProvider({
      async fetchProjects(scope) {
        return {
          projects: [{ id: 'proj-1', name: 'Proj', content: `repo=${repo}` }],
          issues: [],
        };
      },
    });
  }

  // A fetch fake that records every call and answers a small, fixed script of
  // GitHub REST responses keyed by path. Unset paths 404.
  function makeFakeGithubFetch(responses = {}) {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const path = url.replace('https://api.github.com', '');
      const entry = responses[path];
      if (!entry) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
      return { ok: entry.status >= 200 && entry.status < 300, status: entry.status, json: async () => entry.body };
    };
    fetchImpl.calls = calls;
    return fetchImpl;
  }

  function catalogWithGithubFetch({ repo, githubFetch }) {
    const provider = makeRepoProvider({ repo });
    return createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY, githubFetch });
  }

  test('rejects a repo this workspace has not named, before ever calling fetch (mutation-check: removing the allowlist check would make this pass)', async () => {
    const githubFetch = makeFakeGithubFetch();
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'someone-else/not-named', number: 42 } }),
      /not in this workspace's allowed repo list/,
    );
    assert.strictEqual(githubFetch.calls.length, 0, 'an unlisted repo must never reach a GitHub fetch');
  });

  test('rejects a malformed PR number before any fetch, including the allowlist read', async () => {
    const githubFetch = makeFakeGithubFetch();
    const provider = makeRepoProvider({});
    const { executeTool } = createChatToolCatalog({ provider, scope: SCOPE, urlKey: URL_KEY, githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 'not-a-number' } }),
      /Invalid PR number/,
    );
    assert.strictEqual(provider.calls.length, 0, 'malformed input must be rejected before the allowlist is even resolved');
    assert.strictEqual(githubFetch.calls.length, 0);
  });

  test('rejects a malformed sha before any fetch', async () => {
    const githubFetch = makeFakeGithubFetch();
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', sha: 'zz-not-hex' } }),
      /Invalid commit sha/,
    );
    assert.strictEqual(githubFetch.calls.length, 0);
  });

  test('requires at least one of number/sha', async () => {
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch: makeFakeGithubFetch() });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer' } }),
      /requires "number" and\/or "sha"/,
    );
  });

  test('a private allow-listed repo answers not-readable rather than a bare 404 (repo-visibility probe fails)', async () => {
    // No `/repos/JKershaw/LinearViewer` entry in the script → the fake 404s it.
    const githubFetch = makeFakeGithubFetch({});
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    const result = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } });
    assert.deepStrictEqual(result, { repo: 'JKershaw/LinearViewer', readable: false, reason: 'not readable: private repository' });
    assert.strictEqual(githubFetch.calls.length, 1, 'a failed visibility probe must short-circuit before the PR/check calls');
  });

  test('rollup shape: PR state, head/base, mergeable, and the check-run + status rollup', async () => {
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      '/repos/JKershaw/LinearViewer/pulls/42': {
        status: 200,
        body: {
          state: 'open', merged: false, mergeable: true,
          head: { ref: 'feature-x', sha: 'abc1234abc1234abc1234abc1234abc1234abcd' },
          base: { ref: 'main' },
        },
      },
      '/repos/JKershaw/LinearViewer/commits/abc1234abc1234abc1234abc1234abc1234abcd/check-runs': {
        status: 200, body: { check_runs: [{ name: 'unit', conclusion: 'success' }, { name: 'e2e', conclusion: 'failure' }] },
      },
      '/repos/JKershaw/LinearViewer/commits/abc1234abc1234abc1234abc1234abc1234abcd/status': {
        status: 200, body: { statuses: [{ context: 'ci-success', state: 'success' }] },
      },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    const result = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } });
    assert.deepStrictEqual(result, {
      repo: 'JKershaw/LinearViewer',
      readable: true,
      number: 42,
      state: 'open',
      merged: false,
      head: { ref: 'feature-x', sha: 'abc1234abc1234abc1234abc1234abc1234abcd' },
      base: { ref: 'main' },
      mergeable: true,
      ref: 'abc1234abc1234abc1234abc1234abc1234abcd',
      checks: [
        { name: 'unit', conclusion: 'success' },
        { name: 'e2e', conclusion: 'failure' },
        { name: 'ci-success', conclusion: 'success' },
      ],
    });
  });

  test('a sha-only call (no number) skips the PR fetch and reports checks for that ref directly', async () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      [`/repos/JKershaw/LinearViewer/commits/${sha}/check-runs`]: { status: 200, body: { check_runs: [] } },
      [`/repos/JKershaw/LinearViewer/commits/${sha}/status`]: { status: 200, body: { statuses: [] } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    const result = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', sha } });
    assert.deepStrictEqual(result, { repo: 'JKershaw/LinearViewer', readable: true, ref: sha, checks: [] });
    assert.ok(!githubFetch.calls.some(u => u.includes('/pulls/')), 'a sha-only call must never fetch a PR');
  });

  test('an unknown PR number throws rather than being read as a private repo', async () => {
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 9999 } }),
      /PR #9999 not found/,
    );
  });

  // LIN-2624 review finding: an unauthenticated GitHub 403 (the 60/hour rate
  // limit, or any other forbidden reason) must NEVER be conflated with a 404
  // — neither read as "private repository" nor silently degraded to an empty
  // checks list. Both are real, distinguishable failures the model should see
  // as errors, not as false "private"/"no CI" answers.
  test('a 403 on the repo-visibility probe throws — it must NOT be read as private repository (rate-limit != private)', async () => {
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 403, body: { message: 'API rate limit exceeded' } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } }),
      /HTTP 403/,
    );
  });

  test('a 403 on the PR fetch throws — it must NOT be read as "PR not found"', async () => {
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      '/repos/JKershaw/LinearViewer/pulls/42': { status: 403, body: { message: 'API rate limit exceeded' } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } }),
      (err) => err.message.includes('HTTP 403') && !/not found/.test(err.message),
    );
  });

  test('a 403 on the check-runs/status calls throws — it must NOT silently degrade to an empty (false "no CI checks") rollup', async () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      [`/repos/JKershaw/LinearViewer/commits/${sha}/check-runs`]: { status: 403, body: { message: 'API rate limit exceeded' } },
      [`/repos/JKershaw/LinearViewer/commits/${sha}/status`]: { status: 200, body: { statuses: [] } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    await assert.rejects(
      () => executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', sha } }),
      /HTTP 403/,
    );
  });

  test('a genuine 404 on check-runs for a real ref degrades to an empty list (distinct from the 403 case above)', async () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      [`/repos/JKershaw/LinearViewer/commits/${sha}/status`]: { status: 200, body: { statuses: [] } },
      // no check-runs entry → the fake 404s it
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    const result = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', sha } });
    assert.deepStrictEqual(result, { repo: 'JKershaw/LinearViewer', readable: true, ref: sha, checks: [] });
  });

  test('a cache hit avoids a second round of fetches for the same (repo, number, sha)', async () => {
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/LinearViewer': { status: 200, body: { private: false } },
      '/repos/JKershaw/LinearViewer/pulls/42': {
        status: 200,
        body: { state: 'open', merged: false, mergeable: null, head: { ref: 'x', sha: 'abc1234' }, base: { ref: 'main' } },
      },
      '/repos/JKershaw/LinearViewer/commits/abc1234/check-runs': { status: 200, body: { check_runs: [] } },
      '/repos/JKershaw/LinearViewer/commits/abc1234/status': { status: 200, body: { statuses: [] } },
    });
    const { executeTool } = catalogWithGithubFetch({ repo: 'JKershaw/LinearViewer', githubFetch });
    const first = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } });
    const callsAfterFirst = githubFetch.calls.length;
    assert.ok(callsAfterFirst > 0);
    const second = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/LinearViewer', number: 42 } });
    assert.strictEqual(githubFetch.calls.length, callsAfterFirst, 'a cache hit must not fetch again');
    assert.deepStrictEqual(second, first);
  });

  test('the GitHub binding\'s own repo (scope.repo) is allow-listed even with no matching project repo=', async () => {
    const provider = makeFakeProvider({
      async fetchProjects() { return { projects: [], issues: [] }; },
    });
    const githubFetch = makeFakeGithubFetch({
      '/repos/JKershaw/bound-repo': { status: 200, body: { private: false } },
      '/repos/JKershaw/bound-repo/commits/abc1234/check-runs': { status: 200, body: { check_runs: [] } },
      '/repos/JKershaw/bound-repo/commits/abc1234/status': { status: 200, body: { statuses: [] } },
    });
    const { executeTool } = createChatToolCatalog({
      provider, scope: { token: 'gh-token', repo: 'JKershaw/bound-repo' }, urlKey: URL_KEY, githubFetch,
    });
    const result = await executeTool({ name: 'get_pr_status', arguments: { repo: 'JKershaw/bound-repo', sha: 'abc1234' } });
    assert.strictEqual(result.readable, true);
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

// Multi-loop sessions, which the single-loop fixtures above cannot exercise:
// the lineage-tail rule, and a session parked on a human whose latest run has
// since moved on.
function multiLoopFleetHistory() {
  return [
    // Tail rule: anchor finished long ago, child dispatched since and running.
    sessionHistoryItem({
      id: 'sess-tail', kind: 'autopilot', issueIdentifier: 'LIN-710', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: T_FLEET_MID, status: 'taken',
      feedback: [{ message: '[done] orchestrator finished', timestamp: T_FLEET_MID }],
    }),
    sessionHistoryItem({
      id: 'tail-child', sessionId: 'sess-tail', issueIdentifier: 'LIN-710', target: 'cli',
      dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 4 tools/9s · alive', timestamp: T_FLEET_FRESH }],
    }),
    // Parked-but-moving-on: anchor blocked on a human, child dispatched since.
    sessionHistoryItem({
      id: 'sess-parked', kind: 'autopilot', issueIdentifier: 'LIN-711', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[blocked] which option do you want?', timestamp: T_FLEET_OLD }],
    }),
    sessionHistoryItem({
      id: 'parked-child', sessionId: 'sess-parked', issueIdentifier: 'LIN-711', target: 'cli',
      dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 1 tools/2s · alive', timestamp: T_FLEET_FRESH }],
    }),
  ];
}

// Two tail loops sharing the EXACT dispatch instant — the only case in which
// SESSION_LANE_PRECEDENCE is consulted at all.
function ambiguousTailHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-tie', kind: 'autopilot', issueIdentifier: 'LIN-720', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] orchestrating', timestamp: T_FLEET_OLD }],
    }),
    sessionHistoryItem({
      id: 'tie-blocked', sessionId: 'sess-tie', issueIdentifier: 'LIN-720', target: 'cli',
      dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[blocked] needs a ruling', timestamp: T_FLEET_FRESH }],
    }),
    sessionHistoryItem({
      id: 'tie-working', sessionId: 'sess-tie', issueIdentifier: 'LIN-720', target: 'cli',
      dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] 2 tools/4s · alive', timestamp: T_FLEET_FRESH }],
    }),
  ];
}

// A [blocked] run that a follow-up already answered — `computeSupersededLoopIds`
// is what makes it stop reading as blocked.
function supersededBlockedHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-answered', kind: 'autopilot', issueIdentifier: 'LIN-730', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[blocked] which option?', timestamp: T_FLEET_OLD }],
    }),
    sessionHistoryItem({
      id: 'answer-1', sessionId: 'sess-answered', issueIdentifier: 'LIN-730', target: 'cli',
      followUpTo: 'sess-answered', rootItemId: 'sess-answered',
      dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
      feedback: [{ message: '[working] taking option b', timestamp: T_FLEET_MID }],
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

  test('session lanes agree with classifyLoop on the same fixture — a hand-rolled classifier diverges', async () => {
    const { executeTool, stores } = makeFleetCatalog([
      ...fleetHistory(), ...multiLoopFleetHistory(), ...supersededBlockedHistory(),
    ]);
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    // Re-derive the expectation through the IMPORTED classifier with the same
    // two inputs the sweep passes it, INCLUDING the superseded set — dropping
    // either input, or hand-rolling the rule, diverges from this.
    const sessions = await getSessionsForWorkspace(URL_KEY, {
      dispatchStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    });
    const superseded = computeSupersededLoopIds(sessions.flatMap(s => s.loops || []));
    const now = Date.now();
    const laneOf = (loop) => classifyLoop(loop, { superseded, now, staleMs: DEFAULT_LANE_STALE_MS });

    assert.ok(superseded.size > 0, 'the fixture must actually exercise supersession');
    let sawMultiLoop = false;
    for (const row of result.sessions) {
      const session = sessions.find(s => s.sessionId === row.sessionId);
      const workLoops = (session.loops || []).filter(l => l.kind !== 'wake');
      if (workLoops.length > 1) sawMultiLoop = true;
      // The lineage tail is the latest-DISPATCHED loop, which is not the same
      // as the last one in any array order.
      const tailMs = Math.max(...workLoops.map(l => Date.parse(l.dispatchedAt)));
      const tail = workLoops.filter(l => Date.parse(l.dispatchedAt) === tailMs);
      const expected = tail.length === 1
        ? laneOf(tail[0])
        : ['blocked', 'working', 'silent', 'queued'].find(x => tail.some(l => laneOf(l) === x))
          ?? laneOf(tail[tail.length - 1]);
      assert.strictEqual(
        row.lifecycle, expected,
        `${row.sessionId} lane must be classifyLoop's on the lineage tail, not a second opinion`
      );
    }
    assert.ok(sawMultiLoop, 'the fixture must exercise a multi-loop session');

    const lanes = new Set(result.sessions.map(r => r.lifecycle));
    assert.ok(lanes.size >= 2, `expected several lanes, got ${[...lanes].join(',')}`);
  });

  test('the fold takes the lineage TAIL, not the first or the loudest loop', async () => {
    const { executeTool } = makeFleetCatalog(multiLoopFleetHistory());
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    // `sess-tail`: an orchestrator that finished 5h ago, then a child dispatched
    // 10m ago and still running. The tail is the CHILD, so the session is
    // working — a first-loop rule would say terminal, and an
    // any-loop-terminal rule would too.
    const tail = result.sessions.find(r => r.sessionId === 'sess-tail');
    assert.strictEqual(tail.lifecycle, 'working');
    assert.strictEqual(tail.runCount, 2);
  });

  test('an ambiguous tail (two loops sharing the dispatch instant) resolves by precedence, blocked first', async () => {
    const { executeTool } = makeFleetCatalog(ambiguousTailHistory());
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    // Both tail loops carry the SAME dispatchedAt: one blocked, one working.
    // blocked > working, because the parked run is the one that owes the human
    // an answer. Inverting SESSION_LANE_PRECEDENCE turns this red.
    const row = result.sessions.find(r => r.sessionId === 'sess-tie');
    assert.strictEqual(row.lifecycle, 'blocked');
    assert.strictEqual(row.waitingOnHuman, true);
  });

  test('supersession is threaded: an answered [blocked] run is not still blocked', async () => {
    // `sess-answered`'s blocked loop has a follow-up naming it, which is the
    // evidence a human already answered. classifyLoop excludes it from
    // `blocked` ONLY when the superseded set is passed — computing it over an
    // empty set, or dropping it, turns this red.
    const { executeTool } = makeFleetCatalog(supersededBlockedHistory());
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    const row = result.sessions.find(r => r.sessionId === 'sess-answered');
    assert.notStrictEqual(row.lifecycle, 'blocked');
    assert.strictEqual(row.waitingOnHuman, false, 'an answered decision is not still waiting');
  });

  test("lane 'waiting' finds a session parked on a human whose latest run has since moved on", async () => {
    const { executeTool } = makeFleetCatalog(multiLoopFleetHistory());

    // `sess-parked`: orchestrator blocked 5h ago, child dispatched since and
    // running. The tail rule (the plan of record) makes the session 'working',
    // so lane 'blocked' correctly does not match it — and "what needs me?"
    // would return nothing without a separate waiting filter.
    const asLane = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'blocked' } });
    assert.strictEqual(asLane.sessions.some(r => r.sessionId === 'sess-parked'), false);

    const waiting = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'waiting' } });
    assert.strictEqual(waiting.sessions.some(r => r.sessionId === 'sess-parked'), true);
    assert.ok(waiting.sessions.every(r => r.waitingOnHuman));
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
      'parentSessionId', 'runCount', 'seedIssue', 'sessionId', 'tasksTouched', 'tasksTouchedTotal',
      'waitingOnHuman',
    ]);
    assert.strictEqual(row.latestFeedback, 'hello');
  });

  test('LIN-2653 F1: a bookkeeping stamp flips both lifecycle and waitingOnHuman for projectActiveSession', () => {
    const baseLoop = {
      loopId: 's-fossil', kind: 'autopilot', dispatchedAt: T_FLEET_OLD, agentState: 'waiting',
      terminalStatus: null, wakeMarker: 'blocked', feedback: [{ message: '[blocked] waiting', timestamp: T_FLEET_OLD }],
    };
    const opts = { superseded: new Set(), now: Date.now(), staleMs: DEFAULT_LANE_STALE_MS };

    const unstamped = projectActiveSession(
      { sessionId: 's1', seedIssue: 'LIN-9', tasksTouched: [], dispatchedAt: T_FLEET_OLD, loops: [baseLoop] },
      opts
    );
    assert.strictEqual(unstamped.lifecycle, 'blocked');
    assert.strictEqual(unstamped.waitingOnHuman, true);

    const stamped = projectActiveSession(
      {
        sessionId: 's1', seedIssue: 'LIN-9', tasksTouched: [], dispatchedAt: T_FLEET_OLD,
        loops: [{ ...baseLoop, bookkeeping: { at: T_FLEET_OLD, by: 'operator', reason: 'fossil' } }],
      },
      opts
    );
    assert.strictEqual(stamped.lifecycle, 'resolved');
    assert.strictEqual(stamped.waitingOnHuman, false);
  });
});

function decisionEntry(id, question, timestamp, optionCount = 0) {
  // `optionCount` builds a deliberately over-cap set of long labels, so the
  // budget witness measures the WORST case the caps admit, not a sample.
  const options = optionCount
    ? Array.from({ length: optionCount }, (_, i) => ({ id: `o${i}`, label: 'y'.repeat(400) }))
    : [{ id: 'a', label: 'Merge now' }, { id: 'b', label: 'Hold for the witness' }];
  return {
    kind: 'decision',
    timestamp,
    message: `[decision] ${JSON.stringify({
      decision_id: id, question, options, recommended: options[1].id,
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

describe('pass-4 fleet reads — review-ledger witnesses (LIN-2617)', () => {
  test('a decision names the SESSION get_session can resolve, alongside the run that raised it', async () => {
    // The child of an orchestrated session raises the decision. Its anchor
    // carries the CHILD's loopId — reporting that as `sessionId` would hand the
    // model an id `get_session` rejects, and would contradict what
    // list_active_sessions calls the same work in the same turn.
    const history = [
      sessionHistoryItem({
        id: 'orc', kind: 'autopilot', issueIdentifier: 'LIN-900', target: 'cli',
        dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] orchestrating', timestamp: T_FLEET_OLD }],
      }),
      sessionHistoryItem({
        id: 'orc-child', sessionId: 'orc', issueIdentifier: 'LIN-901', target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: '[blocked] parked', timestamp: T_FLEET_MID },
          decisionEntry('dec-child', 'Which option?', T_FLEET_MID),
        ],
      }),
    ];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });
    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-child');

    assert.strictEqual(row.loopId, 'orc-child', 'the run that raised it');
    assert.strictEqual(row.sessionId, 'orc', 'the session that run belongs to');

    // The drill-down the tool description promises actually resolves...
    const session = await executeTool({ name: 'get_session', arguments: { sessionId: row.sessionId } });
    assert.strictEqual(session.sessionId, 'orc');
    // ...and the loopId does NOT, which is exactly why the two are distinct.
    await assert.rejects(
      () => executeTool({ name: 'get_session', arguments: { sessionId: row.loopId } }),
      /not found/
    );

    // The two tools name the same work the same way in one turn.
    const fleet = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.ok(fleet.sessions.some(r => r.sessionId === row.sessionId));
  });

  test('enrichLoop is genuinely applied — it changes a disposition this tool reports', async () => {
    const fixture = decisionsFixture();
    const stores = makeMockSessionStores({ history: fixture.history });
    const build = (enrichLoop) => createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
      taskDecisionsStore: { async listUnansweredForWorkspaces() { return []; } },
      shelvedRulingsStore: { async listForWorkspaces() { return []; } },
      ...(enrichLoop ? { enrichLoop } : {}),
    }).executeTool;

    // `resolveDisposition` branches on agentState === 'running' → 'mid-turn'.
    // The rulings feeds shape their loops through enrichLoop before collecting,
    // so a catalog that ignored the injection would report a different
    // disposition than the feed it claims parity with.
    const shaped = await build(loop => ({ ...loop, agentState: 'running', terminalStatus: null, wakeMarker: null }))(
      { name: 'list_pending_decisions', arguments: {} }
    );
    assert.ok(shaped.decisions.length > 0);
    assert.ok(shaped.decisions.every(d => d.disposition === 'mid-turn'), 'the injected shaping must reach the predicate');

    const unshaped = await build(null)({ name: 'list_pending_decisions', arguments: {} });
    assert.ok(unshaped.decisions.some(d => d.disposition !== 'mid-turn'), 'and identity must differ from it');
  });

  test('a full-cap payload of either list fits inside its declared result budget', async () => {
    // The budget comment claims twenty rows fit. `truncateToolResult`
    // JSON-stringifies then hard-slices, so an over-budget result reaches the
    // model as invalid JSON — and `truncated` reports only the row cap, so the
    // overrun would be silent. Measure it rather than assert a number.
    const long = 'x'.repeat(4000);
    const history = [];
    for (let i = 0; i < 25; i += 1) {
      history.push(sessionHistoryItem({
        id: `bulk-${i}`, kind: 'autopilot', issueIdentifier: `LIN-9${i}`, target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: `[working] ${long}`, timestamp: T_FLEET_FRESH },
          decisionEntry(`bulk-dec-${i}`, long, T_FLEET_MID, 8),
        ],
      }));
    }
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });

    const fleet = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.strictEqual(fleet.sessions.length, 20, 'the default cap');
    assert.ok(
      JSON.stringify(fleet).length <= CHAT_TOOL_RESULT_BUDGETS.list_active_sessions,
      `20 session rows serialize to ${JSON.stringify(fleet).length}, over the declared budget`
    );

    const decisions = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.strictEqual(decisions.decisions.length, 20);
    assert.ok(
      JSON.stringify(decisions).length <= CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions,
      `20 decision rows serialize to ${JSON.stringify(decisions).length}, over the declared budget`
    );
  });

  test('noise.terminalOmitted counts what THIS read withheld, never the fleet', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());

    const all = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.strictEqual(all.noise.terminalOmitted, 0, 'lane:all omits nothing for being finished');

    const dflt = await executeTool({ name: 'list_active_sessions', arguments: {} });
    assert.strictEqual(dflt.noise.terminalOmitted, 1);

    const blocked = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'blocked' } });
    assert.strictEqual(blocked.noise.terminalOmitted, 1, 'the finished row really was withheld here too');
  });

  test('projectActiveSession is total — an empty loop list returns a lane, never a TypeError', () => {
    const row = projectActiveSession({ sessionId: 's0', seedIssue: null, loops: [] }, {
      superseded: new Set(), now: Date.now(), staleMs: DEFAULT_LANE_STALE_MS,
    });
    assert.strictEqual(row.lifecycle, 'unknown');
    assert.strictEqual(row.lastActivityAt, null);
    assert.strictEqual(row.runCount, 0);
    // Called with no ctx at all (LIN-1951's twin may), it still returns a row.
    assert.doesNotThrow(() => projectActiveSession({ sessionId: 's0', loops: [] }));
  });
});

describe('pass-4 — the decision row resolves the session get_session actually keys by (LIN-2617)', () => {
  test('a follow-up loop resolves to its CHAIN ROOT session, not its own id or its group key', async () => {
    // `_buildSessions` pass 2.5 stitches a follow-up into the session of the
    // loop at the root of its followUpTo chain. A precedence that read
    // `sessionGroupId` first would answer 'hop' here — which is itself only an
    // intermediate follow-up (LIN-1393), not a session key.
    const history = [
      sessionHistoryItem({
        id: 'root', issueIdentifier: 'LIN-910', target: 'cli',
        dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] started', timestamp: T_FLEET_OLD }],
      }),
      sessionHistoryItem({
        id: 'hop', issueIdentifier: 'LIN-910', target: 'cli', followUpTo: 'root',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] continued', timestamp: T_FLEET_MID }],
      }),
      sessionHistoryItem({
        id: 'leaf', issueIdentifier: 'LIN-910', target: 'cli',
        followUpTo: 'hop', sessionGroupId: 'hop',
        dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
        feedback: [
          { message: '[blocked] parked', timestamp: T_FLEET_FRESH },
          decisionEntry('dec-leaf', 'Which way?', T_FLEET_FRESH),
        ],
      }),
    ];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });
    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-leaf');

    assert.strictEqual(row.loopId, 'leaf');
    assert.strictEqual(row.sessionId, 'root', 'the chain root, not the loop and not the group key');

    // The id it reports is one get_session can actually resolve — which is the
    // whole point of reporting it separately from the loopId.
    const session = await executeTool({ name: 'get_session', arguments: { sessionId: row.sessionId } });
    assert.strictEqual(session.sessionId, 'root');
  });

  test('a follow-up whose predecessor aged out reports the session the reconstruction actually gives it', async () => {
    // Nothing in this read can walk the chain — the predecessor is outside the
    // 30-day window — so `_buildSessions` falls through to its standalone pass
    // and keys the loop by its own id. Reading the index off the reconstruction
    // gets that right for free; the field-inference draft this replaced had to
    // guess, and guessed the same answer for the WRONG reason.
    const history = [
      sessionHistoryItem({
        id: 'orphan', issueIdentifier: 'LIN-911', target: 'cli', followUpTo: 'aged-out-of-window',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: '[blocked] parked', timestamp: T_FLEET_MID },
          decisionEntry('dec-orphan', 'Still?', T_FLEET_MID),
        ],
      }),
    ];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });
    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-orphan');

    assert.strictEqual(row.loopId, 'orphan');
    // The claim that matters is not which id it is, but that it RESOLVES.
    const session = await executeTool({ name: 'get_session', arguments: { sessionId: row.sessionId } });
    assert.strictEqual(session.sessionId, row.sessionId);
  });

  test("a decision on a loop the reconstruction never groups reports sessionId null, not an id that throws", async () => {
    // `_buildSessions` claims no unclaimed `dash`/`local` loop
    // (lib/pipeline-loops.js:1234), so this decision has no session at all. The
    // rulings feed still shows it, so this tool must too — with an honest null
    // rather than the loop's own id, which get_session would reject.
    const history = [
      sessionHistoryItem({
        id: 'dash-run', issueIdentifier: 'LIN-912', target: 'dash',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: '[blocked] parked', timestamp: T_FLEET_MID },
          decisionEntry('dec-dash', 'Which?', T_FLEET_MID),
        ],
      }),
    ];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });
    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-dash');

    assert.ok(row, 'the decision must still be reported — this is the parity case');
    assert.strictEqual(row.loopId, 'dash-run');
    assert.strictEqual(row.sessionId, null);
    await assert.rejects(
      () => executeTool({ name: 'get_session', arguments: { sessionId: 'dash-run' } }), /not found/
    );
  });

  test('the session read also fits its budget at a full cap of worst-case rows', async () => {
    // The decisions side was measured; this is the other half. `tasksTouched`
    // is the unbounded field here — a long autopilot session touches many.
    const history = [];
    for (let i = 0; i < 25; i += 1) {
      history.push(sessionHistoryItem({
        id: `wide-${i}`, kind: 'autopilot', issueIdentifier: `LIN-80${i}`, target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [{ message: `[working] ${'z'.repeat(5000)}`, timestamp: T_FLEET_FRESH }],
      }));
      for (let j = 0; j < 40; j += 1) {
        history.push(sessionHistoryItem({
          id: `wide-${i}-w${j}`, sessionId: `wide-${i}`, issueIdentifier: `LIN-8${i}${j}`, target: 'cli',
          dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken', feedback: [],
        }));
      }
    }
    const { executeTool } = makeFleetCatalog(history);
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });

    assert.strictEqual(result.sessions.length, 20);
    assert.ok(result.sessions.every(r => r.tasksTouched.length <= 12), 'tasksTouched is capped');
    assert.ok(result.sessions.some(r => r.tasksTouchedTotal > 12), 'and the true total still rides');
    const size = JSON.stringify(result).length;
    assert.ok(
      size <= CHAT_TOOL_RESULT_BUDGETS.list_active_sessions,
      `20 session rows serialize to ${size}, over the declared budget`
    );
  });
});

describe('pass-4 — bounds that must hold on real data, not just fixtures (LIN-2617)', () => {
  test("a child absorbed by _buildSessions' INFERENCE fallback still reports a resolvable session", async () => {
    // The case that defeated a field-inference map: this child carries no
    // sessionId, no sessionGroupId and no followUpTo. Pass 1 absorbs it into
    // the orchestrator's session by issue + time window alone, and none of
    // those inputs exist on the loop — so only reading the reconstruction's own
    // output gets it right.
    const history = [
      sessionHistoryItem({
        id: 'orc-1', kind: 'autopilot', issueIdentifier: 'LIN-920', target: 'cli',
        dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] orchestrating', timestamp: T_FLEET_OLD }],
      }),
      sessionHistoryItem({
        id: 'inferred-child', issueIdentifier: 'LIN-920', target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: '[blocked] parked', timestamp: T_FLEET_MID },
          decisionEntry('dec-inferred', 'Which option?', T_FLEET_MID),
        ],
      }),
    ];
    const { executeTool, stores } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });

    // Ground the premise: the reconstruction really does absorb it.
    const sessions = await getSessionsForWorkspace(URL_KEY, {
      dispatchStore: stores.dispatchQueueStore, agentStatusStore: stores.agentStatusStore,
    });
    const owner = sessions.find(s => (s.loops || []).some(l => l.loopId === 'inferred-child'));
    assert.strictEqual(owner.sessionId, 'orc-1', 'fixture must exercise the inference fallback');

    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-inferred');
    assert.strictEqual(row.loopId, 'inferred-child');
    assert.strictEqual(row.sessionId, 'orc-1', 'not the child loop id, which get_session rejects');
    const session = await executeTool({ name: 'get_session', arguments: { sessionId: row.sessionId } });
    assert.strictEqual(session.sessionId, 'orc-1');
  });

  test('neither list can exceed its result budget at the largest limit its schema advertises', async () => {
    // The schema advertises `maximum: 50`. `truncateToolResult` hard-slices an
    // over-budget payload, so the model would receive invalid JSON — and
    // `truncated` would still be reporting only the row-count cap. The fit is
    // structural: whatever the rows contain, this holds.
    const history = [];
    for (let i = 0; i < 60; i += 1) {
      history.push(sessionHistoryItem({
        id: `big-${i}`, kind: 'autopilot', issueIdentifier: `LIN-70${i}`, target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
        feedback: [
          { message: `[working] ${'q'.repeat(5000)}`, timestamp: T_FLEET_FRESH },
          decisionEntry(`big-dec-${i}`, 'w'.repeat(5000), T_FLEET_MID, 9),
        ],
      }));
    }
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });

    const fleet = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all', limit: 50 } });
    const fleetSize = JSON.stringify(fleet).length;
    assert.ok(fleetSize <= CHAT_TOOL_RESULT_BUDGETS.list_active_sessions, `sessions serialized to ${fleetSize}`);
    assert.strictEqual(fleet.truncated, true, 'and it says so');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(fleet)), 'what the model receives is valid JSON');

    const decisions = await executeTool({ name: 'list_pending_decisions', arguments: { limit: 20 } });
    const decSize = JSON.stringify(decisions).length;
    assert.ok(decSize <= CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions, `decisions serialized to ${decSize}`);
    assert.strictEqual(decisions.truncated, true);
  });

  test('a malformed task decision degrades instead of taking out the whole call', async () => {
    // Task decisions are stored raw — `taskDecisionsStore` documents
    // parseDecision's shape in a comment but does not enforce it, so a
    // non-array `options` and a non-string `question` are both reachable.
    const taskDecisions = [{
      id: 'td-bad', urlKey: URL_KEY, issueId: 'uuid-930', issueIdentifier: 'LIN-930',
      scannedAt: T_FLEET_FRESH, outcome: null,
      decision: { decision_id: 'dec-bad', question: { not: 'a string' }, options: 'not an array' },
    }];
    const { executeTool } = makeDecisionsCatalog({ history: [], taskDecisions, shelvedRulings: [] });

    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    const row = result.decisions.find(d => d.decisionId === 'dec-bad');
    assert.ok(row, 'the row still rides — the rulings feed shows it too');
    assert.deepStrictEqual(row.options, []);
    assert.strictEqual(row.optionsTotal, 0);
    assert.strictEqual(row.question, null, 'an unrenderable question is null, never 3000 uncapped chars');
  });

  test('the option cap reports what it withheld', async () => {
    const history = [sessionHistoryItem({
      id: 'many-opts', kind: 'autopilot', issueIdentifier: 'LIN-931', target: 'cli',
      dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken',
      feedback: [
        { message: '[blocked] parked', timestamp: T_FLEET_MID },
        decisionEntry('dec-many', 'Pick one', T_FLEET_MID, 9),
      ],
    })];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions: [], shelvedRulings: [] });
    const row = (await executeTool({ name: 'list_pending_decisions', arguments: {} }))
      .decisions.find(d => d.decisionId === 'dec-many');
    assert.strictEqual(row.options.length, 4, 'capped');
    assert.strictEqual(row.optionsTotal, 9, 'and the true count still rides, computed before the slice');
  });

  test('a wake loop INSIDE a real session is not counted as a suppressed row', async () => {
    // `wakeLoopsFolded` claims rows suppressed. A wake loop stitched into a real
    // session produced no row of its own to suppress, so counting it would
    // overstate the noise.
    const history = [
      sessionHistoryItem({
        id: 'sess-wk', kind: 'autopilot', issueIdentifier: 'LIN-940', target: 'cli',
        dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] going', timestamp: T_FLEET_OLD }],
      }),
      sessionHistoryItem({
        id: 'inner-wake', kind: 'wake', sessionId: 'sess-wk', issueIdentifier: 'LIN-940', target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken', feedback: [],
      }),
    ];
    const { executeTool } = makeFleetCatalog(history);
    const result = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.strictEqual(result.sessions.length, 1);
    assert.strictEqual(result.noise.wakeLoopsFolded, 0, 'nothing was suppressed');
    assert.strictEqual(result.sessions[0].runCount, 2, 'but the wake run still counts as a run');
  });

  test('noise reports everything the filter withheld, not only the finished rows', async () => {
    const { executeTool } = makeFleetCatalog(fleetHistory());
    const blocked = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'blocked' } });
    assert.strictEqual(blocked.sessions.length, 1);
    assert.strictEqual(blocked.noise.terminalOmitted, 1);
    // Two more were withheld by the lane filter itself; terminalOmitted alone
    // would have the model under-report the fleet.
    assert.strictEqual(blocked.noise.omittedByFilter, 2);
  });

  test('both lists are actually ordered, not merely non-reversed', async () => {
    // Built so the reconstruction's own order (most-recent DISPATCH first) and
    // this tool's order (most-recent ACTIVITY first) genuinely disagree: 'quiet'
    // was dispatched more recently but has not moved since, while 'busy' was
    // dispatched earlier and beat ten minutes ago. A comparator returning 0
    // leaves the reconstruction's order and fails here — a flip test alone
    // would not catch that.
    const { executeTool } = makeFleetCatalog([
      sessionHistoryItem({
        id: 'quiet', kind: 'autopilot', issueIdentifier: 'LIN-960', target: 'cli',
        dispatchedAt: T_FLEET_MID, resolvedAt: null, status: 'taken', feedback: [],
      }),
      sessionHistoryItem({
        id: 'busy', kind: 'autopilot', issueIdentifier: 'LIN-961', target: 'cli',
        dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
        feedback: [{ message: '[working] 9 tools/30s · alive', timestamp: T_FLEET_FRESH }],
      }),
    ]);
    const fleet = await executeTool({ name: 'list_active_sessions', arguments: { lane: 'all' } });
    assert.deepStrictEqual(fleet.sessions.map(r => r.sessionId), ['busy', 'quiet']);
    const stamps = fleet.sessions.map(r => r.lastActivityAt);
    assert.deepStrictEqual(stamps, [...stamps].sort().reverse());
    assert.ok(new Set(stamps).size > 1, 'the fixture must have something to order');

    const { executeTool: dec } = makeDecisionsCatalog({
      history: [
        sessionHistoryItem({
          id: 'newer', kind: 'autopilot', issueIdentifier: 'LIN-951', target: 'cli',
          dispatchedAt: T_FLEET_FRESH, resolvedAt: null, status: 'taken',
          feedback: [{ message: '[blocked] b', timestamp: T_FLEET_FRESH }, decisionEntry('d-new', 'new?', T_FLEET_FRESH)],
        }),
        sessionHistoryItem({
          id: 'older', kind: 'autopilot', issueIdentifier: 'LIN-950', target: 'cli',
          dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
          feedback: [{ message: '[blocked] a', timestamp: T_FLEET_OLD }, decisionEntry('d-old', 'old?', T_FLEET_OLD)],
        }),
      ],
      taskDecisions: [], shelvedRulings: [],
    });
    // Reconstruction order is most-recent-session-first, so oldest-first is a
    // real re-ordering the comparator has to perform.
    const ids = (await dec({ name: 'list_pending_decisions', arguments: {} })).decisions.map(d => d.decisionId);
    assert.deepStrictEqual(ids, ['d-old', 'd-new']);
  });
});

describe('pass-4 — review-ledger discharge (LIN-2617)', () => {
  test('no single row can escape the byte bound, however long its identifier fields are', async () => {
    // The one path that could outgrow the whole budget in ONE row: the id
    // fields are agent-authored free text and nothing upstream bounds their
    // length. A payload that still exceeded the budget would reach the model
    // hard-sliced into invalid JSON.
    const huge = 'k'.repeat(30000);
    const taskDecisions = [{
      id: 'td-huge', urlKey: URL_KEY, issueId: 'uuid-970', issueIdentifier: huge,
      scannedAt: T_FLEET_FRESH, outcome: null,
      decision: {
        decision_id: huge, question: 'short', recommended: huge,
        options: [{ id: huge, label: huge }],
      },
    }];
    const { executeTool } = makeDecisionsCatalog({ history: [], taskDecisions, shelvedRulings: [] });
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });

    const size = JSON.stringify(result).length;
    assert.ok(size <= CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions, `serialized to ${size}`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
    // The row survives, capped — reaching zero rows is the last resort, not the
    // first response to a long identifier.
    assert.strictEqual(result.decisions.length, 1);
    assert.strictEqual(result.count, 1);
    const row = result.decisions[0];
    for (const [field, value] of Object.entries({
      decisionId: row.decisionId, issueIdentifier: row.issueIdentifier, recommended: row.recommended,
      optionId: row.options[0].id, optionLabel: row.options[0].label,
    })) {
      assert.ok(value.length <= 501, `${field} must be capped, got ${value.length}`);
    }
  });

  test('fitToBudget reports the truncation it performs, even under the row cap', async () => {
    // Under the row cap (5 < 20) but over the byte budget, so ONLY the byte
    // trim can set the flag — the row-count cap cannot mask a missing one here.
    // Fifteen rows, each at its per-field caps — under the 20-row cap, over the
    // 18000-byte budget.
    const taskDecisions = [];
    for (let i = 0; i < 15; i += 1) {
      taskDecisions.push({
        id: `td-fat-${i}`, urlKey: URL_KEY, issueId: `uuid-97${i}`, issueIdentifier: 'L'.repeat(400),
        scannedAt: new Date(Date.now() - (100 - i) * 60000).toISOString(), outcome: null,
        decision: {
          decision_id: `fat-dec-${i}${'z'.repeat(400)}`,
          question: 'p'.repeat(2000),
          options: Array.from({ length: 4 }, (_, j) => ({ id: `${j}${'q'.repeat(400)}`, label: 'r'.repeat(400) })),
        },
      });
    }
    const { executeTool } = makeDecisionsCatalog({ history: [], taskDecisions, shelvedRulings: [] });

    const decisions = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.ok(decisions.count <= 20, 'the row cap is NOT what trimmed this');
    assert.ok(decisions.decisions.length < decisions.count, 'rows were dropped by the byte trim');
    assert.strictEqual(decisions.truncated, true, 'and the payload says so');
  });

  test('a decision whose parked-since cannot be resolved sorts last, never first', async () => {
    // An unresolvable `since` must not masquerade as the longest wait and
    // displace a genuinely old decision from the top of the list.
    const history = [sessionHistoryItem({
      id: 'aged', kind: 'autopilot', issueIdentifier: 'LIN-980', target: 'cli',
      dispatchedAt: T_FLEET_OLD, resolvedAt: null, status: 'taken',
      feedback: [
        { message: '[blocked] parked', timestamp: T_FLEET_OLD },
        decisionEntry('dec-aged', 'Oldest?', T_FLEET_OLD),
      ],
    })];
    const taskDecisions = [{
      id: 'td-nostamp', urlKey: URL_KEY, issueId: 'uuid-981', issueIdentifier: 'LIN-981',
      scannedAt: 'not a date', outcome: null,
      decision: { decision_id: 'dec-nostamp', question: 'When?', options: [] },
    }];
    const { executeTool } = makeDecisionsCatalog({ history, taskDecisions, shelvedRulings: [] });
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });

    assert.deepStrictEqual(result.decisions.map(d => d.decisionId), ['dec-aged', 'dec-nostamp']);
    assert.strictEqual(result.decisions[1].since, null);
  });

  test('the session index read is lean — it exists only to map short ids', async () => {
    const fixture = decisionsFixture();
    const leanFlags = [];
    const base = makeMockSessionStores({ history: fixture.history });
    const { executeTool } = createChatToolCatalog({
      provider: makeFakeProvider(), scope: SCOPE, urlKey: URL_KEY,
      dispatchQueueStore: {
        ...base.dispatchQueueStore,
        async listHistory(urlKey, options) {
          // `lean` sets `projection: { prompt: 0 }` at the query
          // (lib/pipeline-loops.js:1309) so a real DB never transfers 30 days of
          // prompt text — the LIN-623 read the LIN-608 OOM is blamed on.
          leanFlags.push(options?.projection?.prompt);
          return base.dispatchQueueStore.listHistory(urlKey, options);
        },
      },
      agentStatusStore: base.agentStatusStore,
      taskDecisionsStore: { async listUnansweredForWorkspaces() { return fixture.taskDecisions; } },
      shelvedRulingsStore: { async listForWorkspaces() { return fixture.shelvedRulings; } },
    });
    await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.strictEqual(leanFlags.length, 2, 'the loop read for the predicate, and the session read for the index');
    // BOTH reads project prompt away — the index read has no use for it at all.
    assert.deepStrictEqual(leanFlags, [0, 0], 'neither read drags prompt text along');
  });
});
