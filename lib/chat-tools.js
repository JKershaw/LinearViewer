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
// Pass-2 (LIN-1026) grows the catalog with three more READ-ONLY tools, keeping
// all three invariants above intact:
//
//   * get_brief / get_recap — CACHE-ONLY reads of the current-state brief and the
//     AI recap. They mirror the proxy's `?noRefresh=1` branch: fetch the
//     recommendation context, hash it, and compare against the cached payload,
//     returning `{ status: fresh|stale|missing }` WITHOUT ever spending an LLM
//     call. On-miss generation is deliberately out of scope (it would drag the
//     OpenRouter-key / free-tier billing surface into the catalog). If the needed
//     cache store was not wired into the catalog, the tool fails cleanly as
//     "not configured" rather than improvising.
//   * get_stack — the sorted task-stack digest projection, via the SAME pure
//     pipeline the `/api/proxy/stack` route uses (lib/task-stack.js), fetched
//     through the captured provider scope (`provider.fetchProjects`).
//
// The remaining stretch candidates (recommend, agent/session status) stay
// deferred to a follow-up.

import { isValidIssueId } from './workspace.js';
import { hashContext } from './recap-cache.js';
import { buildTaskStack, clampStackLimit } from './task-stack.js';

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
  {
    type: 'function',
    function: {
      name: 'get_comments',
      description:
        "Return the FULL, untruncated comment thread for ONE task in the current " +
        "workspace, oldest first, each as `{author, createdAt, body}`. Unlike the " +
        "comments folded into lookup_task (which share the general tool budget and can " +
        "be clipped), this tool has a larger result budget for reading long comment " +
        "bodies verbatim. Use it when you need the exact wording of a task's comments " +
        "(e.g. a research write-up or plan) rather than a summary.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose comments to read.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_children_status',
      description:
        "Return a COMPACT per-child status rollup for ONE parent task in the current " +
        "workspace: every direct child as `{identifier, title, state, blockedBy[], " +
        "blocks[], lastUpdate}`, where blockedBy/blocks are the identifiers a child is " +
        "blocked by / blocks, and lastUpdate is the child's last-updated timestamp. Use " +
        "this to answer \"what is wedged?\" — which children are blocked, on what, and how " +
        "stale — in one call, without looking each child up individually. It is a status " +
        "rollup only, not a full relation dump.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The parent task identifier (e.g. LIN-123) or UUID whose children to roll up.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_brief',
      description:
        "Return the CACHED current-state brief for a task in the current workspace: " +
        "a distilled, present-tense version of the task that folds in comment-thread " +
        "developments (supersedes stale description wording). This is a cache-only read " +
        "— it never generates — so the result carries a `status` of `fresh` (cached and " +
        "current), `stale` (cached but the task has changed since), or `missing` (no brief " +
        "cached yet). Use it to orient on a task; on `missing`, tell the user no brief is cached.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose brief to read.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recap',
      description:
        "Return the CACHED AI recap for a task in the current workspace (what has been " +
        "done, what is pending, and any deviations). Like get_brief this is a cache-only " +
        "read that never generates, so the result carries a `status` of `fresh`, `stale`, " +
        "or `missing`. Use it to summarize progress on a task; on `missing`, tell the user " +
        "no recap is cached yet.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose recap to read.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stack',
      description:
        "Return the current workspace's sorted task stack as a compact orientation digest: " +
        "the top tasks in recommended execution order (in-progress and blocking work first), " +
        "each as a one-line headline plus state, priority, and blocking/critical-path signals. " +
        "Use this to see what to work on next across the whole workspace when the user has no " +
        "specific task in mind; then drill into a single task with lookup_task or get_brief.",
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: "How many tasks to return (1-50, default 5).",
            minimum: 1,
            maximum: 50,
          },
        },
        required: [],
      },
    },
  },
];

/**
 * Per-tool result-budget overrides for the chat tool catalog (LIN-1065). Threaded
 * into `streamChatWithTools` as `toolResultMaxCharsByTool`, this is an ADDITIVE map:
 * only the tools named here diverge from the global `TOOL_RESULT_MAX_CHARS` (4000).
 *
 * `get_comments` returns full comment bodies verbatim, so it needs a larger budget
 * than the 4000-char default (which would clip a long research/plan comment). Every
 * other tool is intentionally absent, so it keeps the unchanged 4000-char budget.
 * @type {Object<string, number>}
 */
export const CHAT_TOOL_RESULT_BUDGETS = {
  get_comments: 12000,
};

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
 * @param {Object} [args.recapCacheStore] - The workspace's recap cache store
 *   (LIN-1026). Captured for the CACHE-ONLY `get_recap` read; absent → the tool
 *   fails cleanly as "not configured". Never written to (read-only surface).
 * @param {Object} [args.briefCacheStore] - The workspace's brief cache store,
 *   used the same cache-only way by `get_brief`.
 * @param {string} [args.urlKey] - The workspace url key the cache stores are keyed
 *   by. Captured alongside the stores; brief/recap reads need it to scope the
 *   cache lookup, so an absent urlKey is treated as "not configured".
 * @returns {{ tools: Array<Object>, executeTool: Function, executors: Object }}
 *   `tools` are the schemas above; `executeTool({name, arguments})` matches the
 *   `streamChatWithTools` executor contract and returns a JSON-serializable value;
 *   `executors` exposes the per-tool functions for direct/unit use.
 */
export function createChatToolCatalog({ provider, scope, recapCacheStore, briefCacheStore, urlKey } = {}) {
  if (!provider) {
    throw new Error('createChatToolCatalog requires a provider');
  }

  /**
   * Shared cache-only read for the brief/recap twins. Fetches the recommendation
   * context, hashes it, and compares against the cached payload — mirroring the
   * proxy's `?noRefresh=1` branch. NEVER generates: on a hash mismatch or an
   * absent entry it reports `stale`/`missing` instead of spending an LLM call.
   * @param {Object} p
   * @param {Object} p.store - Cache store (recap or brief); absent → not configured.
   * @param {string} p.storeName - Human name for the not-configured error.
   * @param {string} p.field - Payload field to surface (`brief` or `recap`).
   * @param {*} p.issueId - Model-supplied issue id (validated).
   * @returns {Promise<Object>} `{ status, identifier, [field]?, generatedAt?, model? }`
   */
  async function readCachedContext({ store, storeName, field, issueId }) {
    requireValidIssueId(issueId);
    if (!store || !urlKey) {
      throw new Error(`${storeName} is not configured for this workspace`);
    }
    requireProviderMethod(provider, 'fetchRecommendationContext');
    const context = await provider.fetchRecommendationContext(scope, issueId);
    if (!context || !context.issue) {
      throw new Error(`Task ${issueId} not found`);
    }
    const canonicalId = context.issue.id || issueId;
    const identifier = context.issue.identifier || issueId;
    const inputHash = hashContext(context);
    const cached = await store.get(urlKey, canonicalId);
    if (cached && cached.inputHash === inputHash) {
      return {
        status: 'fresh',
        identifier,
        [field]: cached[field],
        generatedAt: cached.generatedAt,
        model: cached.model,
      };
    }
    return {
      status: cached ? 'stale' : 'missing',
      identifier,
      generatedAt: cached?.generatedAt,
      model: cached?.model,
    };
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

    // Full, untruncated comment thread for one named task (LIN-1065). Reuses the
    // same fetchRecommendationContext read as lookup_task, but returns ONLY the
    // comments (author/createdAt/body, oldest first — the provider already sorts
    // them chronologically) so the larger per-tool budget is spent on comment
    // bodies, not the surrounding issue tree. Read-only; never generates.
    get_comments: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(provider, 'fetchRecommendationContext');
      const context = await provider.fetchRecommendationContext(scope, issueId);
      if (!context || !context.issue) {
        throw new Error(`Task ${issueId} not found`);
      }
      const comments = (context.comments || []).map(c => ({
        author: c.user || 'Unknown',
        createdAt: c.createdAt,
        body: c.body,
      }));
      return {
        identifier: context.issue.identifier || issueId,
        count: comments.length,
        comments,
      };
    },

    // Compact per-child status rollup for a parent task (LIN-1066). Reuses the
    // same fetchRecommendationContext read, then projects each direct child into
    // {identifier, title, state, blockedBy[], blocks[], lastUpdate}. blockedBy is
    // read from the child's inverseRelations (X blocks child ⇒ child blocked-by X),
    // blocks from the child's forward relations (child blocks Y) — both filtered to
    // `blocks`-type edges and reduced to identifiers so the rollup stays compact and
    // never becomes a generic relation dump. Read-only; never generates.
    get_children_status: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(provider, 'fetchRecommendationContext');
      const context = await provider.fetchRecommendationContext(scope, issueId);
      if (!context || !context.issue) {
        throw new Error(`Task ${issueId} not found`);
      }
      const relIds = (nodes, key) =>
        (nodes || [])
          .filter(r => r?.type === 'blocks')
          .map(r => r?.[key]?.identifier)
          .filter(Boolean);
      const children = (context.children || []).map(c => ({
        identifier: c.identifier,
        title: c.title,
        state: c.state?.name ?? null,
        blockedBy: relIds(c.inverseRelations?.nodes, 'issue'),
        blocks: relIds(c.relations?.nodes, 'relatedIssue'),
        lastUpdate: c.updatedAt ?? null,
      }));
      return {
        identifier: context.issue.identifier || issueId,
        count: children.length,
        children,
      };
    },

    // Cache-only current-state brief (LIN-1026). Never generates.
    get_brief: async ({ issueId } = {}) =>
      readCachedContext({ store: briefCacheStore, storeName: 'Brief cache', field: 'brief', issueId }),

    // Cache-only AI recap (LIN-1026). Never generates.
    get_recap: async ({ issueId } = {}) =>
      readCachedContext({ store: recapCacheStore, storeName: 'Recap cache', field: 'recap', issueId }),

    // Sorted task-stack digest via the shared /stack pipeline (lib/task-stack.js).
    // Fetches projects+issues through the captured provider scope, then projects
    // the orientation-grade digest; `limit` is clamped to 1-50 (default 5).
    get_stack: async ({ limit } = {}) => {
      requireProviderMethod(provider, 'fetchProjects');
      const { projects, issues } = await provider.fetchProjects(scope);
      return buildTaskStack({
        projects: projects || [],
        issues: issues || [],
        limit: clampStackLimit(limit),
        view: 'digest',
      });
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
