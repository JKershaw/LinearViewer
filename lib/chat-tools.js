// Read-only, workspace-scoped tool catalog for AI chat surfaces (LIN-989).
//
// Surface 2 of 3 from the LIN-489 tool-calling plan: a small catalog of
// OpenAI-style tool schemas plus executors that let a model read the current
// workspace's issue backend during a chat. It is the read side that the
// tool-calling loop `streamChatWithTools` (LIN-988) drives, and the wiring
// into Task Chat (LIN-990) consumes.
//
// Three load-bearing properties, each pinned by a unit test:
//
//   1. DIRECT PROVIDER CALLS. Executors call the workspace's provider functions
//      (`fetchRecommendationContext` / `search` / `relations`) directly. They do
//      NOT go back out over self-HTTP through the proxy — that would re-enter the
//      request stack and defeat the point of the catalog.
//
//   2. WORKSPACE-SCOPED BY CONSTRUCTION. The provider and its call scope
//      (credential) are captured in the closure at `createChatToolCatalog` time.
//      No executor accepts a workspace, token, or scope argument from the model —
//      the model can only pass an issue id or a query — so a tool call can never
//      reach beyond the workspace the catalog was built for.
//
//   3. READ-ONLY. V1 exposes lookups only; there are no write/mutation tools.
//      Adding one is a deliberate future step, not an accident of this surface.
//
// Pass-2 candidates (brief, recap, stack, recommend, agent/session status) are
// incremental and intentionally NOT built here.

import { isValidIssueId } from './workspace.js';

/**
 * OpenAI-style tool/function definitions for the pass-1 read tools. Shared as a
 * constant so a caller can inspect the schemas without constructing a catalog
 * (e.g. to render available tools). The executors that back these names live in
 * {@link createChatToolCatalog}.
 * @type {Array<Object>}
 */
export const CHAT_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'lookup_task',
      description:
        "Look up a single task in the current workspace by its id and return its " +
        "full context (title, description, state, labels, parent/children, comments, " +
        "and — for a parent — the focused subtask). Use this to read a task the user " +
        "references by identifier (e.g. LIN-123).",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID to look up.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description:
        "Full-text search the current workspace's tasks and return the matching " +
        "tasks (flat: id, identifier, title, state, priority, team). Use this to find " +
        "tasks by keyword when you do not already have an identifier.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "The text to search for across task titles and descriptions.",
          },
          limit: {
            type: 'integer',
            description: "Maximum number of results (1-50, default 50).",
            minimum: 1,
            maximum: 50,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_relations',
      description:
        "Return a task's relationships in the current workspace: its relations " +
        "(e.g. blocks) and inverse relations (e.g. blocked by), plus whether the task " +
        "has been trashed. Use this to understand what a task depends on or blocks.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose relations to fetch.",
          },
        },
        required: ['issueId'],
      },
    },
  },
];

/**
 * Guard: throw a clear, model-recoverable error for a malformed issue id before
 * it ever reaches the provider. Uses the shared {@link isValidIssueId} predicate
 * so the catalog and the proxy accept exactly the same id shapes.
 * @param {*} issueId
 */
function requireValidIssueId(issueId) {
  if (!isValidIssueId(issueId)) {
    throw new Error(`Invalid issue id: ${JSON.stringify(issueId)}`);
  }
}

/**
 * Guard: ensure the bound provider actually implements the read function a tool
 * needs. A provider without the capability yields a clean error the model can
 * report, instead of a raw "provider.search is not a function" TypeError.
 * @param {Object} provider
 * @param {string} method
 */
function requireProviderMethod(provider, method) {
  if (typeof provider?.[method] !== 'function') {
    throw new Error(`This workspace's provider does not support ${method}.`);
  }
}

/**
 * Build a read-only, workspace-scoped tool catalog for the given provider and
 * call scope. The returned `tools`/`executeTool` pair plugs straight into
 * `streamChatWithTools` (LIN-988).
 *
 * @param {Object} args
 * @param {Object} args.provider - The workspace's provider (from
 *   `getProviderForWorkspace(workspace)`). Its read functions are called directly.
 * @param {string|Object} [args.scope] - The provider call scope / credential for
 *   this workspace (from `getWorkspaceCallScope(workspace)`): a bare token string
 *   for Linear, or a `{ token, repo }` / `{ token, scope }` object for the GitHub
 *   providers. Captured in the closure and passed as the first argument to every
 *   provider read — it is NOT accepted from the model.
 * @returns {{ tools: Array<Object>, executeTool: Function, executors: Object }}
 *   `tools` are the schemas above; `executeTool({name, arguments})` matches the
 *   `streamChatWithTools` executor contract and returns a JSON-serializable value;
 *   `executors` exposes the per-tool functions for direct/unit use.
 */
export function createChatToolCatalog({ provider, scope } = {}) {
  if (!provider) {
    throw new Error('createChatToolCatalog requires a provider');
  }

  const executors = {
    // Task lookup via fetchRecommendationContext (Linear provider index.js:2049).
    lookup_task: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(provider, 'fetchRecommendationContext');
      const context = await provider.fetchRecommendationContext(scope, issueId);
      if (!context || !context.issue) {
        throw new Error(`Task ${issueId} not found`);
      }
      return context;
    },

    // Full-text search via provider.search (Linear provider index.js:2054).
    search_tasks: async ({ query, limit } = {}) => {
      if (typeof query !== 'string' || !query.trim()) {
        throw new Error('search_tasks requires a non-empty "query" string');
      }
      requireProviderMethod(provider, 'search');
      // Clamp to the provider's 50-result cap; only pass `first` when a valid
      // positive limit was supplied, otherwise fall through to the default.
      const opts =
        Number.isInteger(limit) && limit > 0 ? { first: Math.min(limit, 50) } : undefined;
      return provider.search(scope, query.trim(), opts);
    },

    // Relations via provider.relations (Linear provider index.js:2059).
    get_relations: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(provider, 'relations');
      const rel = await provider.relations(scope, issueId);
      if (!rel) {
        throw new Error(`Task ${issueId} not found`);
      }
      return rel;
    },
  };

  /**
   * Execute a named tool call. Matches the `streamChatWithTools` executor
   * contract — `({ id, name, arguments, rawArguments }) => value` — where the
   * returned value is JSON-serialized and truncated by the loop.
   * @param {{ name?: string, arguments?: Object }} call
   * @returns {Promise<*>}
   */
  async function executeTool({ name, arguments: args } = {}) {
    const fn = executors[name];
    if (!fn) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return fn(args || {});
  }

  return { tools: CHAT_TOOL_SCHEMAS, executeTool, executors };
}
