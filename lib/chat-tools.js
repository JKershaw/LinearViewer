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
//     gated break of invariant #3. It enqueues via the shared dispatch factory
//     (LIN-415/LIN-1139) — `createDispatchItem(...)` — the same seam every
//     other dispatch path uses, rather than calling `dispatchQueueStore.addItem`
//     directly or inventing a new transport. `followUpTo` and `force` are
//     derived SERVER-SIDE from the TAIL of the session's anchor loop's own
//     lineage (`anchorLineageTail(anchorLoop, session.loops)`, LIN-1486):
//     `followUpTo` is that tail's `loopId` (falling back to `session.sessionId`
//     when there is no anchor), and `force` is that tail's own terminality —
//     never the session's aggregate/root. `target` (cli/web only, never
//     dash/local) still comes straight from the anchor loop itself, unchanged
//     by LIN-1486 — the model supplies only `sessionId` and `prompt`. The tool
//     is absent from the schema list (and the executor refuses the call)
//     unless the catalog is constructed with `followUpEnabled: true`, so the
//     break is opt-in per call site, not an accident of this surface. This
//     description covers the default `followUpMode: 'execute'` posture; a
//     catalog constructed with `followUpMode: 'propose'` (Flight Companion
//     auto-wake turns) short-circuits before any of the above — see
//     `createChatToolCatalog`'s JSDoc.
//
// Pass-4 (LIN-2617) adds the two FLEET-WIDE read-only tools the in-page Flight
// Companion needs before it can say anything but census counts. Both keep all
// three invariants above:
//
//   * list_active_sessions — one row per SESSION (not per run) for everything in
//     flight across the workspace, over the same `getSessionsForWorkspace` read
//     `get_session` already uses. Its lifecycle rule is IMPORTED, not re-derived:
//     `classifyLoop` (lib/observer-sweep.js) per loop, with the superseded set
//     and stale threshold the sweep itself passes, then folded to one lane per
//     session. Before this tool, "what is in flight right now?" was unanswerable
//     from inside the chat — every session read needed an issueId or a sessionId
//     the model had no way to obtain.
//   * list_pending_decisions — every decision waiting on a human, over
//     `collectUnansweredDecisions`, the ONE predicate the rulings feeds already
//     share. Read-only in the strong sense: it can report a decision, never
//     answer or dismiss one.
//
// The remaining stretch candidates (recommend, session-context relationship
// graph) stay deferred to a follow-up.

import { isValidIssueId } from './workspace.js';
import { hashContext } from './recap-cache.js';
import { buildTaskStack, clampStackLimit } from './task-stack.js';
import { getSessionsForIssues, getSessionsForWorkspace, getLoopsForWorkspace, isDecisionAnswerEntry } from './pipeline-loops.js';
import { findAnchorLoop } from './session-summary.js';
// LIN-2617: the fleet-wide reads below IMPORT their lifecycle rule rather than
// re-deriving one. `classifyLoop` is the observer sweep's own per-loop
// classifier, and it needs exactly the two inputs the sweep computes for it
// (`lib/observer-sweep.js:149`): the superseded set over the whole workspace
// read, and the working->silent threshold. A second hand-rolled classifier here
// is precisely how the chat and the census would come to disagree about which
// lane a run is in.
import { classifyLoop } from './observer-sweep.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { DEFAULT_LANE_STALE_MS, loopLastActivityMs } from './live-console.js';
import { collectUnansweredDecisions } from './unanswered-decisions.js';
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
  {
    type: 'function',
    function: {
      name: 'list_active_sessions',
      description:
        "List every session currently IN FLIGHT across the whole workspace \u2014 one row per " +
        "session, not per run \u2014 as {sessionId, seedIssue, tasksTouched, kind, dispatchedAt, " +
        "lastActivityAt, lifecycle, latestMarker, latestFeedback, runCount, parentSessionId, " +
        "waitingOnHuman}. This is the fleet-wide read: use it to answer \"what is in flight " +
        "right now?\" or \"what is stalled?\" with actual session ids and task identifiers " +
        "rather than census counts, and lane 'waiting' for \"what needs me?\". Terminal " +
        "sessions are excluded unless you ask for lane 'all'. `count` is the full number that " +
        "matched; the rows are capped at `limit` and `truncated` says when they differ. Then " +
        "drill into one with get_session.",
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: "How many sessions to return (1-50, default 20).",
            minimum: 1,
            maximum: 50,
          },
          lane: {
            type: 'string',
            description:
              "Filter the list. 'working' is actively moving, 'silent' has not reported for " +
              "over an hour, 'blocked' is parked waiting on a human (alive, not dead), " +
              "'queued' has not started. 'waiting' is the one to use for \"what needs me?\": " +
              "every session with a run parked on a person, including one whose latest run has " +
              "since moved on and so no longer reads as 'blocked'. 'all' also includes " +
              "finished sessions, which are otherwise omitted. Omit for every session still " +
              "in flight.",
            enum: ['working', 'silent', 'blocked', 'waiting', 'queued', 'all'],
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pending_decisions',
      description:
        "List the decisions in this workspace that are waiting on a human answer \u2014 the same " +
        "rows the rulings queue shows, oldest first. Each row carries the question, the options " +
        "offered, the recommended one, the task and the run (`loopId`) that raised it plus the " +
        "`sessionId` that run belongs to (pass THAT one to get_session, not the loopId), how " +
        "long it has been parked, and whether it can still be replied to. Use this to answer " +
        "\"what needs me?\" or \"what is parked?\". Read-only: this never answers or dismisses " +
        "a decision.",
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: "How many decisions to return (1-20, default 20).",
            minimum: 1,
            maximum: 20,
          },
        },
        required: [],
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
  // LIN-2617: both fleet-wide reads are ROW LISTS whose whole point is that the
  // model holds real ids rather than counts, so a truncated result is a silently
  // wrong answer to "what is in flight?" rather than a merely shorter one.
  // `list_active_sessions` returns up to 20 session rows, each carrying a
  // ~200-char feedback line plus ids and stamps (~450 chars/row observed);
  // `list_pending_decisions` returns up to 20 decision rows carrying a question
  // and its options. 12000 fits both at their caps.
  // Both figures are derived from the row caps rather than guessed, and each is
  // pinned by a test that serializes a FULL-CAP worst-case payload — the first
  // draft of both was measurably too small.
  //   sessions:  20 rows x (200-char feedback line + 12 task ids + ~250 of ids,
  //              stamps and flags) ~= 13k measured.
  //   decisions: 20 rows x (300-char question + 4 x 60-char option labels +
  //              ~250 of ids, stamps and flags) ~= 17k measured.
  list_active_sessions: 16000,
  list_pending_decisions: 18000,
};

// The lane filter `list_active_sessions` accepts. `terminal`/`resolved` are
// deliberately absent as filter values — "show me the finished ones" is `all`
// plus the model's own reading, not a lane the fleet read advertises.
const LIST_ACTIVE_LANES = new Set(['working', 'silent', 'blocked', 'waiting', 'queued', 'all']);

/**
 * Apply the `lane` filter to the projected rows.
 *
 * `waiting` is NOT a census lane and is deliberately not one: it selects on
 * `waitingOnHuman`, which is true whenever ANY loop of the session is parked on
 * a person. `blocked` stays exactly the census lane — the fold takes the
 * lineage TAIL's lane (the plan of record's rule), so an orchestrator that
 * parked six hours ago with a child dispatched since reads `silent`, correctly
 * by that rule and uselessly for the tool's own headline question. Without
 * `waiting`, "what is waiting on me?" returns nothing in exactly the case that
 * matters most. The two are kept separate rather than merged so the chat and
 * the census seed never disagree about what `blocked` means.
 *
 * @param {Array<Object>} rows
 * @param {string|undefined} lane
 * @returns {Array<Object>}
 */
function selectSessionLane(rows, lane) {
  if (lane === 'all') return [...rows];
  if (lane === 'waiting') return rows.filter(r => r.waitingOnHuman);
  if (lane) return rows.filter(r => r.lifecycle === lane);
  // Default: everything still in flight.
  return rows.filter(r => !FINISHED_LANES.has(r.lifecycle));
}

/**
 * Project ONE `collectUnansweredDecisions` row into the compact chat row.
 *
 * A NARROWING of the predicate's own output — never a re-derivation of it.
 * `disposition`, `canReply` and the anchor all ride through untouched, so this
 * row and the rulings feed cannot disagree about whether a decision is
 * answerable.
 *
 * @param {Object} row - `{decision, anchor, disposition, canReply, shelvedLapseCount}`
 * @param {number|null} sinceMs - epoch ms this decision has been parked since (a LOWER bound, see `buildDecisionSinceIndex`)
 * @returns {Object}
 */
function projectPendingDecision(row, sinceMs, sessionIdByLoopId) {
  const decision = row.decision || {};
  const loopId = row.anchor?.loopId || null;
  return {
    decisionId: decision.decision_id || null,
    issueIdentifier: row.anchor?.issueIdentifier || null,
    // The RUN that raised it, and the SESSION that run belongs to. These are
    // different ids and only coincide for a single-loop session: a decision
    // raised by a child of an orchestrated session carries the child's loopId,
    // which `get_session` would reject as not found. Reporting the loopId under
    // the name `sessionId` is exactly how this tool and `list_active_sessions`
    // would name the same work differently in one turn.
    loopId,
    sessionId: loopId ? (sessionIdByLoopId.get(loopId) || null) : null,
    question: truncateText(decision.question, DECISION_QUESTION_MAX),
    options: (decision.options || []).slice(0, DECISION_OPTIONS_MAX).map(o => ({
      id: o?.id ?? null, label: truncateText(o?.label, DECISION_OPTION_LABEL_MAX),
    })),
    optionsTotal: (decision.options || []).length,
    recommended: decision.recommended || null,
    since: Number.isFinite(sinceMs) && sinceMs > 0 ? new Date(sinceMs).toISOString() : null,
    disposition: row.disposition,
    canReply: row.canReply,
    shelvedLapseCount: row.shelvedLapseCount,
  };
}

/**
 * Map every loop to the session `get_session` would resolve it under, in the
 * SAME precedence order `_buildSessions` claims loops in
 * (`lib/pipeline-loops.js`):
 *
 *   1. `sessionId` — pass 2's explicit orchestrator grouping (LIN-591). It is
 *      checked FIRST, not second: pass 2.5 begins `if (l.sessionId) continue`,
 *      so a loop carrying one is grouped by it even when it also carries a
 *      `sessionGroupId`.
 *   2. `followUpTo` — pass 2.5's follow-up stitch, resolved by walking the
 *      chain to its root over the same workspace-wide loop set this tool
 *      already holds, then taking that root's own session. The walk is used in
 *      preference to the `sessionGroupId` shortcut because the group key can
 *      itself be an intermediate follow-up hop rather than a true root
 *      (LIN-1393), in which case `_buildSessions` also resolves to the chain
 *      root — so the shortcut is the case that would disagree, not the walk.
 *   3. the loop's own id — pass 1's anchor and pass 3's standalone session are
 *      both keyed by it.
 *
 * Bounded honestly: a chain whose root aged out of the 30-day window cannot be
 * resolved from this input at all, and yields null rather than a confident
 * wrong id — `_buildSessions` coalesces those under the durable group id, which
 * is knowledge this loop-only read does not have.
 *
 * @param {Array<Object>} loops
 * @returns {Map<string, string|null>}
 */
function buildSessionIdByLoopId(loops) {
  const byId = new Map();
  for (const loop of loops) {
    if (loop?.loopId) byId.set(loop.loopId, loop);
  }
  const resolve = (loop) => {
    if (loop.sessionId) return loop.sessionId;
    if (!loop.followUpTo) return loop.loopId;
    const seen = new Set();
    let current = loop;
    while (current.followUpTo) {
      if (seen.has(current.loopId)) return null; // malformed cycle — never guess
      seen.add(current.loopId);
      const parent = byId.get(current.followUpTo);
      if (!parent) return null; // predecessor aged out — unresolvable from here
      current = parent;
    }
    return current.sessionId || current.loopId;
  };
  const map = new Map();
  for (const loop of byId.values()) map.set(loop.loopId, resolve(loop));
  return map;
}

/**
 * Index the "parked since" instant for every decision the predicate can return.
 *
 * `collectUnansweredDecisions` does not carry one, so it is resolved here from
 * the SAME two inputs that were just handed to it — no third read.
 *
 * For a loop-anchored decision this is the loop's last activity, which is a
 * LOWER BOUND on when it parked, not the exact instant it raised the question.
 * That is deliberately the identical convention (and the identical function)
 * the observer sweep already uses for its own attention rows'
 * `since` (`lib/observer-sweep.js:161-170`), so a model reading the census seed
 * and this tool in one turn sees one meaning of the word rather than two.
 * A task-bound decision has no run behind it, so its scan time is exact.
 *
 * @param {Array<Object>} loops
 * @param {Array<Object>} taskDecisions
 * @returns {{byLoopId: Map<string, number>, byTaskDecisionId: Map<string, number>}}
 */
function buildDecisionSinceIndex(loops, taskDecisions) {
  const byLoopId = new Map();
  for (const loop of loops) {
    if (loop?.loopId) byLoopId.set(loop.loopId, loopLastActivityMs(loop));
  }
  const byTaskDecisionId = new Map();
  for (const entry of taskDecisions) {
    if (!entry?.id) continue;
    const ms = new Date(entry.scannedAt).getTime();
    if (Number.isFinite(ms)) byTaskDecisionId.set(entry.id, ms);
  }
  return { byLoopId, byTaskDecisionId };
}

function decisionSinceMs(row, index) {
  const { loopId, taskDecisionId } = row.anchor || {};
  if (loopId && index.byLoopId.has(loopId)) return index.byLoopId.get(loopId);
  if (taskDecisionId && index.byTaskDecisionId.has(taskDecisionId)) {
    return index.byTaskDecisionId.get(taskDecisionId);
  }
  return null;
}

// ─── LIN-2617: the fleet-wide session read ───────────────────────────────────

// Session-lane precedence, applied ONLY when a session's lineage tail is
// ambiguous (several loops share the latest dispatch instant). Ordered by how
// much the lane owes the human: a session with a parked run in its tail is
// "blocked" even when a sibling is still moving, because the parked run is the
// one that needs an answer.
const SESSION_LANE_PRECEDENCE = ['blocked', 'working', 'silent', 'queued'];

// The two lanes that mean "finished", omitted from the default read. `blocked`
// is deliberately NOT here: it is an active waiting-on-a-human lane, alive not
// dead (lib/observer-sweep.js's own header, lib/dispatch-terminal.js:134).
const FINISHED_LANES = new Set(['terminal', 'resolved']);

const FEEDBACK_LINE_MAX = 200;

// Row-field caps (review finding 8). `truncateToolResult` (lib/openrouter.js)
// JSON-stringifies then HARD-SLICES an over-budget result, so the model receives
// invalid JSON plus a dropped-chars marker — and this tool's own `truncated`
// flag reports only the row-count cap, so a budget overrun would be silent.
// Every unbounded row field is therefore bounded here instead: a question and an
// option label are agent-authored free text, and `tasksTouched` grows with a
// long autopilot session.
const DECISION_QUESTION_MAX = 300;
const DECISION_OPTION_LABEL_MAX = 60;
// A decision offering more than this many options is not a question a person can
// answer from a chat row; the count rides so the model can say there are more.
const DECISION_OPTIONS_MAX = 4;
const TASKS_TOUCHED_MAX = 12;

function truncateText(value, max) {
  if (typeof value !== 'string' || !value) return value ?? null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * The session's most recent feedback message, truncated. Prefers the entry with
 * the greatest parsable timestamp; falls back to the last message seen in the
 * session's already-ordered loops when no entry carries a usable one, so a
 * session whose only feedback is unstamped still reports a line rather than
 * silently reporting none.
 * @param {Array<Object>} loops
 * @returns {string|null}
 */
function latestFeedbackLine(loops) {
  let best = null;
  let bestMs = -Infinity;
  let fallback = null;
  for (const loop of loops) {
    for (const entry of loop.feedback || []) {
      if (typeof entry?.message !== 'string' || !entry.message) continue;
      fallback = entry.message;
      const ms = Date.parse(entry.timestamp);
      if (Number.isFinite(ms) && ms >= bestMs) { bestMs = ms; best = entry.message; }
    }
  }
  const line = best ?? fallback;
  if (!line) return null;
  return line.length > FEEDBACK_LINE_MAX ? `${line.slice(0, FEEDBACK_LINE_MAX)}…` : line;
}

/**
 * The session's latest lifecycle marker: the terminal status or wake marker of
 * its most recently dispatched loop that carries one. Both fields are
 * build-time derivations `_buildLoops` always sets (lib/pipeline-loops.js:733
 * and :741),
 * so this never rescans raw feedback.
 * @param {Array<Object>} loops - the session's loops, oldest first
 * @returns {string|null}
 */
function latestLoopMarker(loops) {
  for (let i = loops.length - 1; i >= 0; i -= 1) {
    const marker = loops[i]?.terminalStatus ?? loops[i]?.wakeMarker ?? null;
    if (marker) return marker;
  }
  return null;
}

/**
 * Fold per-loop lanes into ONE session lane.
 *
 * The rule (LIN-2617 plan-review 2617-F2): a session's lane is its lineage
 * tail's loop lane. The tail is the latest-dispatched loop; when several loops
 * share that instant the tail is ambiguous, and {@link SESSION_LANE_PRECEDENCE}
 * breaks the tie. `classifyLoop` itself is never re-implemented here — this
 * only chooses WHICH already-classified loop speaks for the session.
 *
 * @param {Array<Object>} loops
 * @param {Map<string, string>} laneByLoopId
 * @returns {string} one of the 7 census lane keys
 */
function foldSessionLane(loops, laneByLoopId) {
  let tailMs = -Infinity;
  for (const loop of loops) {
    const ms = Date.parse(loop?.dispatchedAt);
    if (Number.isFinite(ms) && ms > tailMs) tailMs = ms;
  }
  const tail = loops.filter(l => Date.parse(l?.dispatchedAt) === tailMs);
  const candidates = tail.length ? tail : loops;
  // Total by construction: a session with no loops cannot happen through
  // `_assembleSession`, but this function is reachable from an EXPORTED pure
  // projection that LIN-1951's twin will call with its own inputs, so it
  // returns a lane rather than throwing.
  if (!candidates.length) return 'unknown';
  if (candidates.length === 1) return laneByLoopId.get(candidates[0].loopId) || 'unknown';
  const lanes = new Set(candidates.map(l => laneByLoopId.get(l.loopId)));
  for (const lane of SESSION_LANE_PRECEDENCE) {
    if (lanes.has(lane)) return lane;
  }
  return laneByLoopId.get(candidates[candidates.length - 1]?.loopId) || 'unknown';
}

/**
 * Project ONE reconstructed session into the compact fleet-wide row.
 *
 * Exported and pure so LIN-1951's proxy twin reuses this exact shape rather
 * than deriving a second one — two projections of one read is how the chat and
 * the supervisory proxy would come to describe the same session differently.
 *
 * `wake` loops are excluded from the LANE decision (they are re-wakes, not
 * work) but still counted in `runCount`, which reports what actually ran.
 *
 * @param {Object} session - a `getSessionsForWorkspace` record
 * @param {Object} ctx
 * @param {Set<string>} ctx.superseded - `computeSupersededLoopIds` over the WHOLE workspace read
 * @param {number} ctx.now - epoch ms
 * @param {number} ctx.staleMs - working→silent threshold
 * @returns {Object} the row, including its folded `lifecycle` lane
 */
export function projectActiveSession(session, { superseded, now, staleMs } = {}) {
  const loops = session.loops || [];
  // A session made only of wake loops is dropped by the caller; a session that
  // merely CONTAINS them classifies on its real work.
  const workLoops = loops.filter(l => l?.kind !== 'wake');
  const laneLoops = workLoops.length ? workLoops : loops;

  const laneByLoopId = new Map(
    laneLoops.map(l => [l.loopId, classifyLoop(l, { superseded, now, staleMs })])
  );
  const lifecycle = foldSessionLane(laneLoops, laneByLoopId);

  let lastActivityMs = 0;
  for (const loop of loops) {
    const ms = loopLastActivityMs(loop);
    if (ms > lastActivityMs) lastActivityMs = ms;
  }

  const anchor = findAnchorLoop(session);
  // A loop of this session naming a DIFFERENT session as its orchestrator.
  //
  // Documented honestly rather than oversold: this is null for every ordinarily
  // grouped session, because `_buildSessions` pass 2 groups BY `loop.sessionId`,
  // so within such a session that field always equals `session.sessionId`. Only
  // the pass-2.5 follow-up stitch can produce a divergence, and the value there
  // is a stitched sibling's own assignment. It is NOT a general
  // "which session spawned this one" pointer — no such pointer exists in the
  // reconstruction today.
  const parentSessionId =
    loops.map(l => l?.sessionId).find(id => id && id !== session.sessionId) || null;

  const tasksTouched = session.tasksTouched || [];

  return {
    sessionId: session.sessionId,
    seedIssue: session.seedIssue,
    // Bounded: a long autopilot session touches dozens of tasks, and an
    // over-budget tool result reaches the model as truncated invalid JSON.
    tasksTouched: tasksTouched.slice(0, TASKS_TOUCHED_MAX),
    tasksTouchedTotal: tasksTouched.length,
    kind: anchor?.kind ?? loops[0]?.kind ?? null,
    dispatchedAt: session.dispatchedAt,
    lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
    lifecycle,
    latestMarker: latestLoopMarker(loops),
    latestFeedback: latestFeedbackLine(loops),
    runCount: loops.length,
    parentSessionId,
    // Derived from the SAME imported classifier as `lifecycle`, never a second
    // waiting-on-a-human predicate: `classifyLoop` already applies supersession
    // (an answered [blocked] is not blocked) before it names the lane.
    waitingOnHuman: [...laneByLoopId.values()].includes('blocked'),
  };
}

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
 * Derive the `{ followUpTo, target, force }` triple for following up on a
 * session's anchor loop (LIN-1486, extracted from `send_follow_up`'s
 * executor by LIN-2433). Throws if the anchor targets `dash`/`local` (not
 * supported for follow-up); callers that need a non-throwing surface (e.g.
 * an HTTP route) must catch and map that error themselves.
 *
 * LIN-1486: target the TAIL of the anchor's own lineage, not the session
 * root — and derive `force` from that tail's own terminality, not an
 * anchor-first/all()-shaped aggregate across the whole session (the two
 * shapes LIN-1478 found unsafe on the session-page reply path). Falls
 * back to `session.sessionId`/`false` when there's no anchor at all
 * (anchorless/orphan session), matching prior behavior.
 *
 * @param {Object} session - A session as returned by `getSessionsForWorkspace`
 *   / `getSessionsForIssues`, carrying `sessionId` and `loops`.
 * @returns {{ followUpTo: string, target: 'web'|'cli', force: boolean }}
 */
export function deriveFollowUpDispatch(session) {
  const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
  const anchorTarget = (anchorLoop && anchorLoop.target) || null;
  if (anchorTarget === 'dash' || anchorTarget === 'local') {
    throw new Error(`Session ${session.sessionId} cannot be followed up on (dash/local targets are not supported)`);
  }
  const target = anchorTarget === 'web' ? 'web' : 'cli';
  const tail = anchorLineageTail(anchorLoop, session.loops);
  const followUpTo = tail ? tail.loopId : session.sessionId;
  const force = isLoopTerminal(tail);
  return { followUpTo, target, force };
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
 *   `getSessionsForWorkspace`) AND for the gated `send_follow_up` write, passed
 *   to `createDispatchItem` as `store` — the SAME store the human reply box and
 *   the agent-to-agent wake path use. Absent → session tools fail cleanly as
 *   "not configured".
 * @param {Object} [args.agentStatusStore] - The workspace's agent status store,
 *   the other dep the session read-model needs. Absent → session tools fail
 *   cleanly as "not configured".
 * @param {Function} [args.sessionIsTerminal] - `(session) => boolean` (from
 *   `routes/dashboard.js`), injected rather than imported directly so this lib
 *   module does not reach into routes/. Used to surface `terminal` on session
 *   reads; on the `send_follow_up` path it survives only as a presence guard
 *   (the call is refused when this is not a function) — `force` there is
 *   derived by the module-local `isLoopTerminal(tail)`, not by this function.
 *   Absent → session reads omit `terminal`; `send_follow_up` fails cleanly as
 *   "not configured".
 * @param {boolean} [args.followUpEnabled] - Deliberate gate (default `false`)
 *   for the ONE write tool, `send_follow_up`. Only when `true` is its schema
 *   appended to `tools` and its executor allowed to run — every other call
 *   site keeps the base catalog genuinely read-only.
 * @param {'execute'|'propose'} [args.followUpMode] - Trigger-aware posture for
 *   `send_follow_up` (default `'execute'`, so every existing call site — Task
 *   Chat's included — is byte-identical to before this param existed).
 *   `'execute'` enqueues via `createDispatchItem` exactly as documented above.
 *   `'propose'` is for a turn that was not demonstrably started by a human
 *   (e.g. an auto-wake turn): the executor still validates its arguments and
 *   looks the session up, but stops there — it never calls
 *   `deriveFollowUpDispatch` or `createDispatchItem`, and returns exactly
 *   `{ proposed: true, sessionId, prompt }` with no derived `force`/`target`/
 *   `followUpTo`. Those are re-derived fresh, server-side, at approval time
 *   (a later ticket) from the session's then-current state, so a proposal
 *   never carries stale derived state.
 * @param {Object} [args.taskDecisionsStore] - LIN-2617: the scan-produced
 *   decisions input to `list_pending_decisions`
 *   (`listUnansweredForWorkspaces`). Absent → that tool fails cleanly as
 *   "not configured"; every other tool is unaffected.
 * @param {Object} [args.shelvedRulingsStore] - LIN-2617: the shelved-rulings
 *   input to the same tool (`listForWorkspaces`, LIN-1727). Load-bearing, not
 *   optional-in-spirit: without it a decision a human deliberately shelved
 *   resurfaces in the chat, and the tool stops matching the rulings feed it is
 *   supposed to mirror. Absent → the tool fails cleanly as "not configured".
 * @param {Function} [args.enrichLoop] - LIN-2617: `(loop) => loop` from
 *   `routes/dashboard.js`, injected rather than imported so this lib module does
 *   not reach into routes/. Both rulings feeds shape their loops through it
 *   before collecting; this catalog does the same so the three surfaces cannot
 *   drift on loop shape. Absent → identity.
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
  followUpMode = 'execute',
  workspacePreferencesStore = null,
  // LIN-2617: the two extra inputs `list_pending_decisions` needs to return the
  // SAME rows the rulings feed returns. The feed passes three inputs
  // (routes/dashboard.js:1427-1445 — loops via `mergeLoops`, then the two
  // store reads; routes/proxy-rulings.js:119-123); without
  // `shelvedRulingsStore` an actively-shelved decision would resurface here
  // after a human deliberately shelved it. Absent → the tool fails cleanly as
  // "not configured", mirroring the pass-2 brief/recap guards.
  taskDecisionsStore = null, shelvedRulingsStore = null,
  // Injected, never imported: `lib/` must not reach into `routes/` (see the
  // LIN-1486 note above `isLoopTerminal`). Same injection shape as
  // `sessionIsTerminal`. The rulings feeds both shape their loops through
  // `enrichLoop` before collecting, so this catalog does too rather than let
  // the two surfaces drift on how a loop is shaped. Absent → identity.
  enrichLoop = null,
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

    // Fleet-wide, ONE ROW PER SESSION (LIN-2617) — the read that makes "what is
    // in flight right now?" answerable from inside the chat. Reads exactly what
    // `get_session` reads (`getSessionsForWorkspace` over the same two injected
    // stores): no new store, no self-HTTP, no second reconstruction.
    list_active_sessions: async ({ limit, lane } = {}) => {
      requireSessionStores();
      if (lane != null && !LIST_ACTIVE_LANES.has(lane)) {
        throw new Error(
          `list_active_sessions "lane" must be one of ${[...LIST_ACTIVE_LANES].join(', ')}`
        );
      }
      const rows = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
      const sessions = await getSessionsForWorkspace(
        urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );

      // Computed ONCE over every loop in the workspace read, exactly as the
      // sweep does (lib/observer-sweep.js:149) — a per-session set would miss a
      // cross-session follow-up and report an already-answered run as blocked.
      const superseded = computeSupersededLoopIds(sessions.flatMap(s => s.loops || []));
      const now = Date.now();

      let wakeLoopsFolded = 0;
      const live = [];
      for (const session of sessions) {
        const loops = session.loops || [];
        // THE FOLD: a session made only of `wake` loops is a re-wake of work
        // that lives in another lineage, never work of its own, so it never
        // becomes its own row. Wake loops inside a real session need no folding
        // — that session emits one row regardless — so they are NOT counted
        // here: `wakeLoopsFolded` reports rows actually suppressed, which is
        // what "37 wake rows are re-wakes, not work" claims.
        if (loops.length && loops.every(l => l?.kind === 'wake')) {
          wakeLoopsFolded += loops.length;
          continue;
        }
        live.push(projectActiveSession(session, { superseded, now, staleMs: DEFAULT_LANE_STALE_MS }));
      }

      const selected = selectSessionLane(live, lane);
      // Counted against what this read ACTUALLY withheld, never against the
      // fleet: under `lane: 'all'` nothing is omitted for being finished, so
      // this is 0 — reporting a non-zero count there would have the model
      // narrate an omission that did not happen.
      const kept = new Set(selected);
      const terminalOmitted = live.filter(
        r => FINISHED_LANES.has(r.lifecycle) && !kept.has(r)
      ).length;

      // ISO-8601 sorts lexicographically; a plain compare is locale-independent.
      selected.sort((a, b) => {
        const x = a.lastActivityAt || '';
        const y = b.lastActivityAt || '';
        return x < y ? 1 : x > y ? -1 : 0;
      });
      return {
        // The total that MATCHED, which is what the model should quote — the
        // list below is capped at `limit`, and `truncated` says when the two
        // differ so a partial list is never narrated as the whole fleet.
        count: selected.length,
        truncated: selected.length > rows,
        noise: { wakeLoopsFolded, terminalOmitted },
        sessions: selected.slice(0, rows),
      };
    },

    // Every decision waiting on a human (LIN-2617), over
    // `collectUnansweredDecisions` — the ONE predicate the rulings feed already
    // uses (LIN-1728 / LIN-2197 phase 3 / LIN-2215). Never a second classifier.
    list_pending_decisions: async ({ limit } = {}) => {
      requireSessionStores();
      if (!taskDecisionsStore || !shelvedRulingsStore) {
        throw new Error('Decision data is not configured for this workspace');
      }
      const rows = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 20;

      // The LOOP read, not the session read. `_buildSessions`' standalone pass
      // excludes `dash`/`local` targets (lib/pipeline-loops.js:1234), so
      // flattening `getSessionsForWorkspace` would silently drop any decision
      // raised by one of those runs and this tool would disagree with the feed
      // it is supposed to mirror. Both rulings feeds read loops directly; so
      // does this.
      const rawLoops = await getLoopsForWorkspace(
        urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore, lean: true }
      );
      // The workspace tag is load-bearing, not decorative: `shelfGate` keys on
      // (urlKey, decisionId) (lib/unanswered-decisions.js:162), so an untagged
      // loop's shelved decision would resurface. Tagging precedent:
      // routes/proxy-rulings.js:105.
      const shape = typeof enrichLoop === 'function' ? enrichLoop : (l => l);
      const loops = rawLoops.map(loop => ({ ...shape(loop), workspaceUrlKey: urlKey }));

      const [taskDecisions, shelvedRulings] = await Promise.all([
        taskDecisionsStore.listUnansweredForWorkspaces([urlKey]),
        shelvedRulingsStore.listForWorkspaces([urlKey]),
      ]);
      const collected = collectUnansweredDecisions(
        { loops, taskDecisions, shelvedRulings }, { now: new Date() }
      );

      // Oldest first: the longest-parked decision is the one that most needs an
      // answer, so it must survive the cap rather than be truncated away by it.
      // An unresolvable `since` sorts last rather than first — an unknown age is
      // not evidence of a long wait.
      const index = buildDecisionSinceIndex(loops, taskDecisions);
      const sessionIdByLoopId = buildSessionIdByLoopId(loops);
      // A `since` that did not resolve sorts LAST, not first — an unknown age is
      // not evidence of a long wait. `loopLastActivityMs` returns 0 rather than
      // null for a signal-less loop, so 0 is treated as unresolved too; `??`
      // alone would sort it to the very front.
      const rank = (ms) => (Number.isFinite(ms) && ms > 0 ? ms : Infinity);
      const ordered = collected
        .map(row => ({ row, sinceMs: decisionSinceMs(row, index) }))
        .sort((a, b) => {
          const x = rank(a.sinceMs);
          const y = rank(b.sinceMs);
          return x < y ? -1 : x > y ? 1 : 0;
        });
      return {
        count: ordered.length,
        truncated: ordered.length > rows,
        decisions: ordered.slice(0, rows).map(
          ({ row, sinceMs }) => projectPendingDecision(row, sinceMs, sessionIdByLoopId)
        ),
      };
    },

    // THE one write tool (LIN-1073) — a deliberate, gated break of invariant #3.
    // Enqueues via the shared dispatch factory, `createDispatchItem(...)`, the
    // same seam every other dispatch path uses — not `dispatchQueueStore.addItem`
    // directly, no new transport. `followUpTo`/`target`/`force` come from
    // `deriveFollowUpDispatch` (LIN-2433), which targets the TAIL of the
    // anchor loop's own lineage, never the session's aggregate/root — the
    // model supplies only sessionId + prompt.
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
      const finalPrompt = prompt.trim();
      if (followUpMode === 'propose') {
        // §A.4: an auto-wake (non-human-started) turn cannot execute a write.
        // Stop here — never derive followUpTo/target/force and never call
        // createDispatchItem. Derivation happens fresh, server-side, at
        // approval time from the session's then-current state.
        return { proposed: true, sessionId: session.sessionId, prompt: finalPrompt };
      }
      const { followUpTo, target, force } = deriveFollowUpDispatch(session);
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
          followUpTo,
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

  // LIN-2617: `list_pending_decisions` needs two stores not every call site
  // wires. Where they are absent the executor still fails cleanly (a direct
  // caller gets a real error), but the schema is withheld from `tools` — a
  // catalog that ADVERTISES a tool which can only ever throw spends a model
  // turn to learn that, every turn. The name stays in CHAT_TOOL_SCHEMAS, which
  // is the catalog of what exists, not of what this call site can run.
  const decisionsConfigured = !!(taskDecisionsStore && shelvedRulingsStore);
  const base = decisionsConfigured
    ? CHAT_TOOL_SCHEMAS
    : CHAT_TOOL_SCHEMAS.filter(t => t.function.name !== 'list_pending_decisions');
  const tools = followUpEnabled ? [...base, FOLLOW_UP_TOOL_SCHEMA] : base;
  return { tools, executeTool, executors };
}
