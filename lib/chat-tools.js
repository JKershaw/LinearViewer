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
// Pass-3 (LIN-1073) adds a different SUBSTRATE (the autopilot/dispatch session
// read-model, not the issue backend) and — deliberately, once — the first
// WRITE tool:
//
//   * list_task_sessions / get_session — READ-ONLY reads of a task's autopilot
//     sessions via `getSessionsForIssues`/`getSessionsForWorkspace`
//     (lib/pipeline-loops.js), the same pure, network-free reconstruction the
//     Observation page and per-session page use. Still invariant #1 (direct
//     calls, no self-HTTP) and #2 (workspace-scoped by the closure-captured
//     `dispatchQueueStore`/`agentStatusStore`).
//   * send_follow_up — the FIRST write/side-effecting tool, a deliberate,
//     gated break of invariant #3. It reuses the EXISTING `followUpTo` dispatch
//     path (LIN-415) directly — `dispatchQueueStore.addItem(...)`, the same
//     store the human reply box (public/session.js) and the agent-to-agent
//     wake path use — rather than inventing a new transport. `force` and
//     `target` are derived SERVER-SIDE (mirroring public/session.js: `force`
//     only when the session is already terminal; `target` from the session's
//     anchor loop, cli/web only, never dash/local) — the model supplies only
//     `sessionId` and `prompt`. The tool is absent from the schema list (and
//     the executor refuses the call) unless the catalog is constructed with
//     `followUpEnabled: true`, so the break is opt-in per call site, not an
//     accident of this surface.
//
// The remaining stretch candidates (recommend, session-context relationship
// graph) stay deferred to a follow-up.

import { isValidIssueId } from './workspace.js';
import { hashContext } from './recap-cache.js';
import { buildTaskStack, clampStackLimit } from './task-stack.js';
import { getSessionsForIssues, getSessionsForWorkspace, isDecisionAnswerEntry } from './pipeline-loops.js';
import { findAnchorLoop } from './session-summary.js';
import { createDispatchItem } from './dispatch-factory.js';
import { provisionBootstrapToken, shouldUseMcpTokenField } from './proxy-preamble.js';

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
      name: 'get_history',
      description:
        "Return the state-transition history for ONE task in the current workspace: " +
        "each workflow-state change as `{createdAt, fromState, toState}` with an exact ISO " +
        "timestamp, newest first, plus a `latest` shortcut for the most recent transition. " +
        "Only genuine state changes are included (non-state edits like description or " +
        "assignee changes are filtered out). Use this to answer \"when did this move to X?\" " +
        "or \"when was it last worked / marked done?\" with an exact time rather than the " +
        "day-resolution dates in your context.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose state history to read.",
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
  {
    type: 'function',
    function: {
      name: 'list_task_sessions',
      description:
        "List the autopilot/dispatch sessions for ONE task in the current workspace, each as " +
        "a compact row: {sessionId, seedIssue, dispatchedAt, completedAt, terminal, runCount, " +
        "runtime}. A task can have more than one session. Use this to find which session(s) " +
        "belong to a task before reading one in detail with get_session or sending it a " +
        "follow-up with send_follow_up.",
      parameters: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string',
            description: "The task identifier (e.g. LIN-123) or UUID whose sessions to list.",
          },
        },
        required: ['issueId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_session',
      description:
        "Return ONE autopilot/dispatch session's detail in the current workspace: whether it " +
        "is terminal (finished) or still running, its telemetry (runtime, metrics, produced " +
        "artifacts), and each of its runs with the raw transcript (feedback entries). Use this " +
        "to answer \"what is this session doing / where is it wedged?\". Get the sessionId from " +
        "list_task_sessions first.",
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: "The session id (its root dispatch UUID), from list_task_sessions.",
          },
        },
        required: ['sessionId'],
      },
    },
  },
];

/**
 * Schema for the pass-3 (LIN-1073) write tool — the ONE deliberate, gated
 * break of the read-only invariant. Kept OUT of {@link CHAT_TOOL_SCHEMAS} so
 * the base catalog (and its read-only invariant test) stays genuinely
 * read-only by construction; `createChatToolCatalog` appends this schema to
 * the returned `tools` list only when constructed with `followUpEnabled: true`.
 * @type {Object}
 */
export const FOLLOW_UP_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'send_follow_up',
    description:
      "Send a follow-up message to an existing autopilot/dispatch session — the SAME " +
      "mechanism as the human reply box on a session's page. This is the ONE write/" +
      "side-effecting tool in this catalog: it enqueues a real follow-up that the running " +
      "(or next-woken) agent will act on, so only call it to actually direct or unwedge a " +
      "session, never just to answer a question. Get the sessionId from list_task_sessions " +
      "first.",
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: "The session id (its root dispatch UUID) to follow up on.",
        },
        prompt: {
          type: 'string',
          description: "The follow-up message to send to the session.",
        },
      },
      required: ['sessionId', 'prompt'],
    },
  },
};

/**
 * Per-tool result-budget overrides for the chat tool catalog (LIN-1065). Threaded
 * into `streamChatWithTools` as `toolResultMaxCharsByTool`, this is an ADDITIVE map:
 * only the tools named here diverge from the global `TOOL_RESULT_MAX_CHARS` (4000).
 *
 * `get_comments` returns full comment bodies verbatim, so it needs a larger budget
 * than the 4000-char default (which would clip a long research/plan comment). Every
 * other tool is intentionally absent, so it keeps the unchanged 4000-char budget.
 *
 * `get_session` (LIN-1073) similarly returns a full per-run transcript
 * (feedback[] entries), which can outgrow the 4000-char default for a
 * long-running session.
 * @type {Object<string, number>}
 */
export const CHAT_TOOL_RESULT_BUDGETS = {
  get_comments: 12000,
  get_session: 8000,
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

// LIN-1486: loop-local mirror of routes/dashboard.js's `isTerminalLoop`
// (`TERMINAL_AGENT_STATES.has(loop.agentState)`) OR'd with a direct
// `terminalStatus` marker check — NOT `enrichLoop`/`effectiveAgentState`'s
// fuller marker fallback, which also re-derives a MISSING `terminalStatus` by
// scanning `loop.feedback` (`deriveTerminalStatus`) when the field is
// `undefined`. That re-derivation can't fire here: `pipeline-loops.js:477`
// always sets `terminalStatus` on every loop it builds (`null`, never
// `undefined`), and `session.loops` (this handler's only input) is built
// exclusively by that path — so a direct field check is equivalent for these
// loops, with no feedback-scanning needed. Those functions are also
// unexported, and this module must not import from routes/ (the ticket's
// binding constraint against touching routes/dashboard.js — #977 is in
// flight against that file), so the two-clause rule is replicated here
// instead. BOTH clauses matter: `agentState` alone misses a `[aborted]`/
// `[skipped]` marker on an otherwise still-"taken" loop, and `terminalStatus`
// alone misses an expired/cancelled loop, which is terminal via `agentState`
// with no feedback marker at all.
const LOOP_TERMINAL_AGENT_STATES = new Set(['complete', 'error']);
const LOOP_TERMINAL_MARKERS = new Set(['done', 'failed', 'aborted', 'skipped']);
function isLoopTerminal(loop) {
  if (!loop) return false;
  return LOOP_TERMINAL_AGENT_STATES.has(loop.agentState) || LOOP_TERMINAL_MARKERS.has(loop.terminalStatus);
}

/**
 * The tail of `anchorLoop`'s own lineage within `session.loops` (LIN-1486).
 * A lineage is every loop sharing `lineageId ?? loopId` with the anchor;
 * `session.loops` is already ordered dispatchedAt-ascending (`_assembleSession`,
 * lib/pipeline-loops.js), and `filter` preserves that order, so the last match
 * is the tail — no sort needed. An autopilot anchor and its explicit-sessionId
 * workers are NOT one lineage (they don't share `rootItemId`), so this can
 * legitimately return just `anchorLoop` itself.
 *
 * @param {Object|null} anchorLoop
 * @param {Array<Object>} loops - `session.loops`
 * @returns {Object|null}
 */
function anchorLineageTail(anchorLoop, loops) {
  if (!anchorLoop) return null;
  const key = (l) => l.lineageId ?? l.loopId;
  const lineage = (loops || []).filter(l => key(l) === key(anchorLoop));
  return lineage.length ? lineage[lineage.length - 1] : null;
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
 * @param {Object} [args.dispatchQueueStore] - The workspace's dispatch queue store
 *   (LIN-1073). Captured for the session read-model (`list_task_sessions` /
 *   `get_session`, as the `dispatchStore` dep of `getSessionsForIssues` /
 *   `getSessionsForWorkspace`) AND for the gated `send_follow_up` write
 *   (`dispatchQueueStore.addItem`, the SAME store the human reply box and the
 *   agent-to-agent wake path use). Absent → session tools fail cleanly as
 *   "not configured".
 * @param {Object} [args.agentStatusStore] - The workspace's agent status store,
 *   the other dep the session read-model needs. Absent → session tools fail
 *   cleanly as "not configured".
 * @param {Function} [args.sessionIsTerminal] - `(session) => boolean` (from
 *   `routes/dashboard.js`), injected rather than imported directly so this lib
 *   module does not reach into routes/. Used to surface `terminal` on session
 *   reads and to derive `force` server-side for `send_follow_up`. Absent →
 *   session reads omit `terminal`; `send_follow_up` fails cleanly as "not
 *   configured".
 * @param {boolean} [args.followUpEnabled] - Deliberate gate (default `false`)
 *   for the ONE write tool, `send_follow_up`. Only when `true` is its schema
 *   appended to `tools` and its executor allowed to run — every other call
 *   site keeps the base catalog genuinely read-only.
 * @param {string} [args.dispatchedBy] - The requesting user's account id (e.g.
 *   `req.session.accountId`), forwarded to `dispatchQueueStore.addItem` as
 *   `dispatchedBy` so a follow-up sent via the tool is attributed the same way
 *   as one sent via the reply box.
 * @returns {{ tools: Array<Object>, executeTool: Function, executors: Object }}
 *   `tools` are the schemas above (plus {@link FOLLOW_UP_TOOL_SCHEMA} when
 *   `followUpEnabled` is true); `executeTool({name, arguments})` matches the
 *   `streamChatWithTools` executor contract and returns a JSON-serializable value;
 *   `executors` exposes the per-tool functions for direct/unit use.
 */
export function createChatToolCatalog({
  provider, scope, recapCacheStore, briefCacheStore, urlKey,
  dispatchQueueStore, agentStatusStore, sessionIsTerminal, followUpEnabled = false, dispatchedBy = null,
  workspacePreferencesStore = null,
  // LIN-1431: both required by provisionBootstrapToken so `send_follow_up` can
  // credential a follow-up resuming a claude-code session. Optional, mirroring
  // workspacePreferencesStore — absent, provisioning degrades to null for prose
  // harnesses and fail-closed-throws for claude-code (never a silent bare resume).
  proxyTokenStore = null, baseUrl = null,
} = {}) {
  if (!provider) {
    throw new Error('createChatToolCatalog requires a provider');
  }

  /**
   * Guard: the session read-model needs both stores. Absent → a clean
   * "not configured" error, mirroring `readCachedContext`'s brief/recap guard,
   * rather than pipeline-loops' raw "must be injected" throw.
   */
  function requireSessionStores() {
    if (!dispatchQueueStore || !agentStatusStore) {
      throw new Error('Session data is not configured for this workspace');
    }
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

    // State-transition history for one named task (LIN-1067). Reuses the same
    // fetchRecommendationContext read, then returns the provider-normalized
    // stateTransitions (already filtered to genuine state changes — toState present —
    // and newest-first in the Linear provider). `latest` is the most recent transition
    // for the common "when did it last move?" question. A provider that doesn't supply
    // history yields an empty list, not an error. Read-only; never generates.
    get_history: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(provider, 'fetchRecommendationContext');
      const context = await provider.fetchRecommendationContext(scope, issueId);
      if (!context || !context.issue) {
        throw new Error(`Task ${issueId} not found`);
      }
      const transitions = Array.isArray(context.stateTransitions) ? context.stateTransitions : [];
      return {
        identifier: context.issue.identifier || issueId,
        count: transitions.length,
        latest: transitions[0] || null,
        transitions,
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

    // Compact per-session rows for one task (LIN-1073), via the pure session
    // read-model (lib/pipeline-loops.js) — a DIFFERENT substrate from the
    // issue-backend tools above. Still a direct call (invariant #1): no self-HTTP.
    list_task_sessions: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireSessionStores();
      const sessions = await getSessionsForIssues(
        urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }, [issueId]
      );
      return {
        issueId,
        count: sessions.length,
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          seedIssue: s.seedIssue,
          dispatchedAt: s.dispatchedAt,
          completedAt: s.completedAt,
          terminal: typeof sessionIsTerminal === 'function' ? sessionIsTerminal(s) : null,
          runCount: (s.loops || []).length,
          runtime: s.telemetry?.runtime ?? null,
        })),
      };
    },

    // Full detail for one session (LIN-1073): status, telemetry, and the raw
    // per-run transcript. Sessions key by sessionId (an opaque string — often a
    // dispatch UUID, but any grouping key since LIN-1118), not issueId, so
    // this reads the WHOLE workspace's sessions and finds the match — still a
    // pure, network-free reconstruction over the injected stores, no self-HTTP.
    // Deliberately WITHOUT the session-context relationship graph (that needs
    // the heavier workspace issue set; deferred per LIN-1073 research notes).
    get_session: async ({ sessionId } = {}) => {
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new Error('get_session requires a non-empty "sessionId" string');
      }
      requireSessionStores();
      const sessions = await getSessionsForWorkspace(
        urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );
      const session = sessions.find(s => s.sessionId === sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      return {
        sessionId: session.sessionId,
        seedIssue: session.seedIssue,
        tasksTouched: session.tasksTouched,
        dispatchedAt: session.dispatchedAt,
        completedAt: session.completedAt,
        terminal: typeof sessionIsTerminal === 'function' ? sessionIsTerminal(session) : null,
        telemetry: session.telemetry,
        runs: (session.loops || []).map(loop => ({
          issueIdentifier: loop.issueIdentifier,
          kind: loop.kind,
          iteration: loop.iteration,
          target: loop.target,
          terminalStatus: loop.terminalStatus,
          dispatchedAt: loop.dispatchedAt,
          terminalCompletedAt: loop.terminalCompletedAt,
          telemetry: loop.telemetry,
          // LIN-2207: a `decision-answer` stamp is metadata about a decision,
          // not a chat turn — the same exclusion every other feedback[]
          // consumer in this class already applies (LIN-1728 Phase 1/2).
          transcript: (loop.feedback || []).filter(f => !isDecisionAnswerEntry(f)).map(f => ({
            message: f.message, timestamp: f.timestamp, url: f.url, urlLabel: f.urlLabel,
          })),
        })),
      };
    },

    // THE one write tool (LIN-1073) — a deliberate, gated break of invariant #3.
    // Reuses the existing followUpTo dispatch path directly (dispatchQueueStore
    // is the SAME store the human reply box / wake path use); no new transport.
    // `force`/`target` are derived server-side, mirroring public/session.js —
    // the model supplies only sessionId + prompt.
    send_follow_up: async ({ sessionId, prompt } = {}) => {
      if (!followUpEnabled) {
        throw new Error('send_follow_up is not enabled for this chat');
      }
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new Error('send_follow_up requires a non-empty "sessionId" string');
      }
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error('send_follow_up requires a non-empty "prompt" string');
      }
      if (!dispatchQueueStore || typeof sessionIsTerminal !== 'function') {
        throw new Error('send_follow_up is not configured for this workspace');
      }
      requireSessionStores();
      const sessions = await getSessionsForWorkspace(
        urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );
      const session = sessions.find(s => s.sessionId === sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
      const anchorTarget = (anchorLoop && anchorLoop.target) || null;
      if (anchorTarget === 'dash' || anchorTarget === 'local') {
        throw new Error(`Session ${sessionId} cannot be followed up on (dash/local targets are not supported)`);
      }
      const target = anchorTarget === 'web' ? 'web' : 'cli';
      // LIN-1486: target the TAIL of the anchor's own lineage, not the session
      // root — and derive `force` from that tail's own terminality, not an
      // anchor-first/all()-shaped aggregate across the whole session (the two
      // shapes LIN-1478 found unsafe on the session-page reply path). Falls
      // back to `session.sessionId`/`false` when there's no anchor at all
      // (anchorless/orphan session), matching prior behavior.
      const tail = anchorLineageTail(anchorLoop, session.loops);
      const followUpTarget = tail ? tail.loopId : session.sessionId;
      const force = isLoopTerminal(tail);
      // Reuse the shared dispatch factory (LIN-1139) so a tool-driven follow-up
      // inherits the workspace dispatch defaults like every other dispatch path.
      // kind defaults to 'custom'.
      // applyDefaultHarness:false — a blank harness stays null (LIN-1159's
      // claude-code interpose is scoped to the proxy dispatch boundary), preserving
      // this follow-up path's prior behavior. NOT flipped by LIN-1431 (7926ee8
      // reverted exactly that under CI).
      //
      // LIN-1431 S3 #2: this path used to pass a plain prompt and NO finalizePrompt,
      // so a tool-driven follow-up resuming a claude-code session was enqueued with
      // `bootstrapToken: null` — and the broker holding its original credential died
      // with its window (LIN-1362/1375), leaving the resumed session unable to write
      // back. It now provisions on the SAME terms as the human reply box: keyed on the
      // RESOLVED harness, no prose appended, fail-closed inherited.
      const finalPrompt = prompt.trim();
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey,
        workspacePreferencesStore,
        applyDefaultHarness: false,
        prompt: finalPrompt,
        // The shouldUseMcpTokenField guard is load-bearing: provisionBootstrapToken
        // returns the minted token for prose harnesses too, and this path never
        // rewrites the prompt, so minting there would strand an unreferenceable
        // credential on the item. A blank harness resolves null here → prose branch →
        // bootstrapToken null, exactly as before this change.
        finalizePrompt: async (resolvedHarness) => {
          if (shouldUseMcpTokenField(resolvedHarness)) {
            const bootstrapToken = await provisionBootstrapToken({
              proxyTokenStore,
              urlKey,
              baseUrl,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              // LIN-1376: the chat's own dispatching account, the same stamp the
              // item's `dispatchedBy` field carries below.
              createdBy: dispatchedBy || null
            });
            return { prompt: finalPrompt, bootstrapToken };
          }
          return { prompt: finalPrompt, bootstrapToken: null };
        },
        fields: {
          followUpTo: followUpTarget,
          target,
          force,
          dispatchedBy,
        }
      });
      return {
        queued: true,
        itemId: item._id,
        sessionId: session.sessionId,
        target,
        force,
      };
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

  const tools = followUpEnabled ? [...CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA] : CHAT_TOOL_SCHEMAS;
  return { tools, executeTool, executors };
}
