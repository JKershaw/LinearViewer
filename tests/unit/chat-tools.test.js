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
import { createChatToolCatalog, CHAT_TOOL_SCHEMAS } from '../../lib/chat-tools.js';

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
    ...overrides,
  };
  return provider;
}

const SCOPE = 'workspace-token-abc';

describe('CHAT_TOOL_SCHEMAS', () => {
  test('exposes exactly the three pass-1 read tools', () => {
    const names = CHAT_TOOL_SCHEMAS.map(t => t.function.name).sort();
    assert.deepStrictEqual(names, ['get_relations', 'lookup_task', 'search_tasks']);
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

describe('read-only invariant', () => {
  test('the catalog exposes no write/mutation tools', () => {
    const names = CHAT_TOOL_SCHEMAS.map(t => t.function.name);
    const writeish = /create|update|delete|add|remove|move|mutat|write|comment|label|assign|close|archive/i;
    for (const name of names) {
      assert.ok(!writeish.test(name), `unexpected write-shaped tool: ${name}`);
    }
  });
});
