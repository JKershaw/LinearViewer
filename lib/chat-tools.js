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
// Pass-2 (LIN-1026) grows the catalog with more READ-ONLY tools, keeping
// all three invariants above intact (LIN-4537 retired its two cache-only
// reads with the model-written brief and recap):
//
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
//     lineage (`anchorLineageTail(anchorLoop, session.loops)` in lib/follow-up-dispatch.js, LIN-1486):
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
//   * list_pending_decisions — the questions the person was asked and has not
//     answered, read as question records over lib/open-questions.js (LIN-4538:
//     the ruling stores no longer feed it). Read-only in the strong sense: it can
//     report a question, never answer or dismiss one.
//
// Pass-5 (LIN-2624) adds the ONE deliberate exception to invariant #2
// (workspace-scoped by construction): `get_pr_status`. Every other tool's
// scope is fixed at catalog-construction time by the closure; this tool
// instead takes a model-supplied `repo` and reaches the public GitHub REST
// API for it, through `createProxyFetch` (`lib/proxy-fetch.js:96`) so it
// respects the same egress proxy as every other outbound call.
//
//   * get_pr_status({ repo, number?, sha? }) — read-only PR state (open/
//     merged/closed), head/base, mergeable, and the check-run + status
//     rollup for a ref. LIN-3333: `repo` is any public `owner/name` slug — the
//     workspace repo allowlist (derived from the retired project `repo=` lines)
//     is gone, and `isGitHubRepoSlug` (`lib/github-pr-status.js`) refuses
//     anything that is not a safe path segment pair before any fetch.
//     `number`/`sha` are validated (`^\d+$` / `^[0-9a-f]{7,40}$`) before either
//     reaches a URL. LIN-3443: the workspace's bound repo is read with the
//     workspace's own GitHub token (`prReadToken`); every other repo is an
//     anonymous read. A repo the read cannot see (private or nonexistent)
//     answers `not readable: private or unknown repository` rather than the
//     404 a model would misread as "does not exist" — GitHub returns the same
//     404 for "private" and "does not exist" by design. Results are cached 60s
//     per (repo, number, sha); an anonymous miss is subject to GitHub's per-IP
//     rate limit (LIN-840), NOT the run page's own 36/h budget
//     (`lib/pr-state-store.js`).

import { isValidIssueId } from './workspace.js';
import { buildTaskStack, clampStackLimit, askedForStack } from './task-stack.js';
import { readSessionById } from './dispatch-session-read.js';
import { getSessionsForIssues, getSessionsForWorkspace, isDecisionLifecycleStampEntry } from './pipeline-loops.js';
import { findAnchorLoop } from './session-summary.js';
import { createProxyFetch } from './proxy-fetch.js';
// LIN-3247: the `get_pr_status` reader lives in lib/github-pr-status.js now —
// a verbatim extraction, imported back here so the chat tool's behaviour and
// output shape are unchanged (pinned by tests/unit/chat-tools.test.js).
import { requireProviderMethod, fetchPrStatus, resolvePrReadToken, PR_STATUS_CACHE_TTL_MS } from './github-pr-status.js';
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
import { questionStandingOf } from './records/question-standing.js';
import { createDispatchItem } from './dispatch-factory.js';
import { shouldUseMcpTokenField, provisionResumeCredential, isStructuralGrantRefusal } from './proxy-preamble.js';
import { deriveFollowUpDispatch } from './follow-up-dispatch.js';
import { openQuestionsFor, titlesFromIssues } from './open-questions.js';

const PR_NUMBER_PATTERN = /^\d+$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

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
      name: 'get_stack',
      description:
        "Return the current workspace's sorted task stack as a compact orientation digest: " +
        "the top tasks in recommended execution order (in-progress and blocking work first), " +
        "each as a one-line headline plus state, priority, and blocking/critical-path signals. " +
        "Use this to see what to work on next across the whole workspace when the user has no " +
        "specific task in mind; then drill into a single task with lookup_task.",
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
        "List the questions this person was asked that are still open, oldest first. Each row " +
        "(`questions`) carries its `questionId`, the question, the options offered, the recommended " +
        "one, and the task (`issueIdentifier`) it is on. `count` is how many are open; `truncated` " +
        "says whether the list was cut. Use this to answer \"what needs me?\" or \"what is parked?\". " +
        "Read-only: this never answers or dismisses a question. A question is answered or dismissed " +
        "on its card (Flight Companion, Home's Waiting on you, the task page), never through chat.",
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: "How many questions to return (1-20, default 20).",
            minimum: 1,
            maximum: 20,
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pr_status',
      description:
        "Read a pull request's and/or a commit's CI status from GitHub — the ONE " +
        "tool in this catalog that reaches beyond this workspace's own tracker, over the " +
        "GitHub REST API. `repo` is any `owner/name` (slug-validated); the workspace's " +
        "own bound repo is read with its GitHub access, any other is public-only, and " +
        "an unreadable repo answers `not readable: private or unknown repository` " +
        "rather than a misleading 404. Returns PR state " +
        "(open/merged/closed), head/base, mergeable, and the " +
        "check-run + status rollup (name + conclusion) for the relevant commit. Pass at " +
        "least one of `number` or `sha`. Results are cached 60s per repo/number/sha. " +
        "Read-only.",
      parameters: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: "owner/name, e.g. \"JKershaw/LinearViewer\" (any public GitHub repo).",
          },
          number: {
            type: 'integer',
            description: "Pull request number to look up.",
          },
          sha: {
            type: 'string',
            description: "Commit SHA (7-40 lowercase hex chars) to check CI status for. Defaults to the PR's head commit when `number` is given and this is omitted.",
          },
        },
        required: ['repo'],
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

/** Cap for `remember`'s `playbook` argument (LIN-2625), enforced before any write. */
export const PLAYBOOK_MAX_CHARS = 4000;

/**
 * Schema for the LIN-2625 write tool — the SECOND deliberate, gated break of
 * the read-only invariant, alongside {@link FOLLOW_UP_TOOL_SCHEMA}. Kept OUT
 * of {@link CHAT_TOOL_SCHEMAS} for the same reason: `createChatToolCatalog`
 * appends this schema to `tools` only when constructed with
 * `playbookEnabled: true` (the Flight Companion turn core, never Task Chat —
 * Task Chat has no companion record to write). The executor itself never
 * touches a store: it only forwards the validated value to the injected
 * `onRemember` callback, which the turn core uses to buffer the write until
 * the turn's terminal frame (see `lib/agent-turn.js`'s
 * `persistPlaybook`) — an errored or disconnected turn must never persist a
 * half-thought.
 * @type {Object}
 */
export const REMEMBER_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'remember',
    description:
      "Rewrite your own playbook: the notes that carry forward to your NEXT turn's " +
      "system prompt verbatim, under \"## Playbook\". This REPLACES the whole thing — " +
      "it does not append — so always pass the full replacement text, not a delta. " +
      `Capped at ${PLAYBOOK_MAX_CHARS} characters. This is the ONE way anything you learn ` +
      "persists between turns; rewrite it every turn you act, with: ordered lanes and their " +
      "tails, promises you made with times (e.g. \"I'll confirm Done at 08:00\"), and " +
      "preferences the human stated (e.g. \"Gauge noted as a nice-to-have; stop citing it\"). " +
      "Anything you don't write here is forgotten by your next turn.",
    parameters: {
      type: 'object',
      properties: {
        playbook: {
          type: 'string',
          description: `The full replacement playbook text (never a delta/addition). Empty string clears it. Max ${PLAYBOOK_MAX_CHARS} characters.`,
        },
      },
      required: ['playbook'],
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
  // `list_pending_decisions` returns up to 20 open question rows (LIN-4538: the
  // old decision rows left this tool). Both figures are derived from the row caps
  // rather than guessed, and each is pinned by a test that serializes a FULL-CAP
  // worst-case payload — the first draft of both was measurably too small.
  //   sessions:  20 rows x (200-char feedback line + 12 task ids + ~250 of ids,
  //              stamps and flags) ~= 13k measured.
  //   questions: 20 rows x (300-char question + 4 x 60-char option labels +
  //              ids and the ticket identifier). The LIN-2704 raise to 20000 was
  //              sized on the old task-bound decision row (a 36-char UUID in two
  //              fields); a question row carries fewer such fields, so the cap
  //              still holds at 20 rows. Pinned by the suite ("a full-cap question
  //              payload fits the budget"), so a widened row fails rather than
  //              silently withholding a pending question.
  //
  //              No other tool result shares this budget key. The rulings feeds
  //              and the scan read the ruling stores directly, untouched by this.
  list_active_sessions: 16000,
  list_pending_decisions: 20000,
  // A PR object (state/head/base/mergeable) plus the check-run + status
  // rollup: a real matrix build can carry 30-50 named checks, each ~60-90
  // chars serialized ({"name":"...","conclusion":"..."}), which alone
  // approaches the 4000-char default — a truncated rollup is a silently
  // wrong CI readout, not a shorter one, the same reasoning LIN-2617 applied
  // to its own row lists.
  get_pr_status: 8000,
};

/**
 * LIN-3362: which tools may run side by side within one hop.
 *
 * `CONCURRENT_SAFE_TOOLS` is every tool in {@link CHAT_TOOL_SCHEMAS} (the
 * read-only catalog). Their only writes are idempotent caches (e.g. the
 * `get_pr_status` `prStatusCache.set`),
 * so two of them racing cannot change each other's answer.
 *
 * `SERIAL_ONLY_TOOLS` are the two tools kept OUT of that catalog because they
 * write: `send_follow_up` (persists a proposal before its frame is emitted) and
 * `remember` (rewrites the playbook). A hop containing either runs fully serial.
 * A test requires every known tool to sit in exactly one set, so a new tool
 * cannot be batched by accident.
 */
export const CONCURRENT_SAFE_TOOLS = new Set(CHAT_TOOL_SCHEMAS.map(t => t.function.name));
export const SERIAL_ONLY_TOOLS = new Set([
  FOLLOW_UP_TOOL_SCHEMA.function.name,
  REMEMBER_TOOL_SCHEMA.function.name
]);

/**
 * Declared provider-scope tier for every tool in {@link CHAT_TOOL_SCHEMAS},
 * {@link FOLLOW_UP_TOOL_SCHEMA}, and {@link REMEMBER_TOOL_SCHEMA} (LIN-2971).
 * LIN-2967 is what actually consumes this: `createChatToolCatalog`'s
 * `scopeByTier` resolves `row`/`workspace` tools against their OWN
 * provider/scope pair (falling back to the single top-level pair when a
 * caller doesn't override a tier — see that function's own JSDoc).
 *
 * Three tiers, each verified against its executor's actual read/write above
 * (not copied from a proposal):
 *
 *   - `'row'` — reads the closure-captured `provider`/`scope` pair keyed to
 *     ONE issue, or a query run against that same credential: the row's own
 *     binding (LIN-2047). `lookup_task`, `get_relations`, `get_comments`,
 *     `get_children_status`, and `get_history` call
 *     `provider.fetchRecommendationContext`/`relations` with one `issueId`.
 *
 *     `search_tasks` is the one entry in this tier NOT derived from its
 *     executor's own breadth — flagged in LIN-2971's review and settled on
 *     LIN-2971 (comments of 19:45/19:47, 2026-09-21), record kept here per
 *     that discussion:
 *       1. `search_tasks` calls `provider.search(scope, query)`, which is
 *          BINDING-WIDE (every issue the credential can see), the identical
 *          breadth to `get_stack`'s `provider.fetchProjects(scope)` below —
 *          which this same map tiers `workspace`. By breadth alone,
 *          `search_tasks` would be `workspace` too.
 *       2. It stays `'row'` anyway, by a DELIBERATE product judgment
 *          (inherited from LIN-2047/LIN-2085, not re-derived here): this
 *          tier is a RESOLUTION label — which scope pair a tool resolves
 *          against — not a BREADTH label — how much data the underlying call
 *          reaches. They coincide for every other tool in this map; only
 *          `search_tasks`'s call is workspace-wide while its intended
 *          resolution is row-scoped ("search within the row's own tracker").
 *       3. LIN-2967 ruled: keep `search_tasks: 'row'`. Reclassifying it would
 *          silently change today's behavior from inside a ticket (LIN-2971)
 *          whose acceptance was "no behavioral diff" — the wrong ticket to
 *          carry a product call in. Do not re-derive this tier from the
 *          executor alone; the resolution/breadth distinction above is the
 *          reason, not an oversight.
 *   - `'workspace'` — reads `provider.fetchProjects(scope)`: ALL projects and
 *     issues bound to `scope`, not one row. `get_stack` calls it directly
 *     (see the `get_stack` executor below). Per LIN-2085/LIN-2967 (D-B,
 *     pre-answered: `get_stack`'s own schema description already promises the
 *     workspace's stack, so code contradicting it was the defect) this tier
 *     needs the WORKSPACE's own binding rather than the row's — the exact class
 *     that went unnoticed for `get_pr_status` and motivated that ticket.
 *   - `'fleet'` — reads the autopilot/dispatch session read-model
 *     (`dispatchQueueStore`/`agentStatusStore`, via `getSessionsForIssues` /
 *     `getSessionsForWorkspace` / `getLoopsForWorkspace`), a DIFFERENT
 *     substrate from the issue-tracker `provider` entirely (see the Pass-3
 *     header comment above `:40`). `list_task_sessions`, `get_session`,
 *     `list_active_sessions`, and `list_pending_decisions` read it directly.
 *     LIN-4549: `list_pending_decisions` also makes one best-effort
 *     `workspaceProvider.fetchProjects(workspaceScope)` read, only to title its
 *     rows (lib/open-questions.js `titlesFromIssues`); it stays `fleet` because
 *     the tier is the resolution label, as with `search_tasks` above, and a
 *     missing or failed read leaves the identifier alone.
 *     `send_follow_up` reads the identical substrate to resolve the session
 *     before writing through the same `dispatchQueueStore` via
 *     `createDispatchItem` — the Pass-3 header comment already groups its
 *     write with these reads under one substrate, not a separate one.
 *
 * `remember` and `get_pr_status` are explicitly `null` rather than defaulted
 * into a tier: `remember`'s executor (see the `remember` executor below)
 * touches no store and no provider call at all — it only forwards the
 * validated playbook string to the injected `onRemember` callback.
 * `get_pr_status` (LIN-3333) reads no tracker provider either — it reaches the
 * public GitHub REST API directly — so there is no scope here for a future
 * per-tier factory to resolve.
 * @type {Object<string, 'row'|'workspace'|'fleet'|null>}
 */
export const CHAT_TOOL_SCOPE_TIERS = {
  lookup_task: 'row',
  search_tasks: 'row',
  get_relations: 'row',
  get_comments: 'row',
  get_children_status: 'row',
  get_history: 'row',
  get_stack: 'workspace',
  list_task_sessions: 'fleet',
  get_session: 'fleet',
  list_active_sessions: 'fleet',
  list_pending_decisions: 'fleet',
  get_pr_status: null,
  send_follow_up: 'fleet',
  remember: null,
};

/** Recognized non-null values of {@link CHAT_TOOL_SCOPE_TIERS}. */
export const CHAT_TOOL_SCOPE_TIER_VALUES = ['row', 'workspace', 'fleet'];

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
 * Trim a row list until its SERIALIZED size fits the tool's result budget.
 *
 * A per-field cap alone cannot guarantee this — the reviewer found both a
 * `limit: 50` call (which the schema advertises) and a non-string `question`
 * that each blew past a budget derived from the caps. `truncateToolResult`
 * (`lib/openrouter.js`) JSON-stringifies then HARD-SLICES an over-budget
 * result, so the model receives invalid JSON with no signal, and this tool's
 * own `truncated` flag would still be reporting only the row-count cap. Fitting
 * here makes the bound structural rather than arithmetic: whatever the rows
 * contain, the payload is valid JSON and `truncated` is honest about it.
 *
 * @param {Object} payload - the result object, mutated in place
 * @param {string} listKey - the field holding the rows
 * @param {number} budget
 * @returns {Object} the same payload
 */
function fitToBudget(payload, listKey, budget) {
  while (payload[listKey].length && JSON.stringify(payload).length > budget) {
    // Down to zero if it comes to it. A floor of one row would let a single
    // oversized row escape the bound entirely — which is the invalid-JSON
    // failure this function exists to prevent, and an empty list under a
    // truthful `count` and `truncated` is a worse answer but never a
    // malformed one. Every row field is capped, so reaching zero needs input
    // no producer here writes; the floor's removal is the belt to the caps'
    // braces, not the primary bound.
    payload[listKey].pop();
    payload.truncated = true;
  }
  return payload;
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
// Identifier fields. Short tokens in every producer this system has, but they
// are agent-authored free text with no length bound anywhere upstream
// (`_parseDecisionOptions` requires `id`/`label` be strings and bounds
// neither), and an unbounded one is the only way a SINGLE row could outgrow the
// whole result budget.
const DECISION_ID_MAX = 200;
const DECISION_OPTION_LABEL_MAX = 60;
// A decision offering more than this many options is not a question a person can
// answer from a chat row; the count rides so the model can say there are more.
const DECISION_OPTIONS_MAX = 4;
const TASKS_TOUCHED_MAX = 12;

/**
 * LIN-4532 (P2b): one open question record as a `list_pending_decisions` row in `questions`.
 * The row is read by lib/open-questions.js; `questionId` is what the question routes answer or dismiss by.
 */
function projectPendingQuestion(row) {
  const options = Array.isArray(row.options) ? row.options : [];
  return {
    questionId: truncateText(row.questionId, DECISION_ID_MAX),
    question: truncateText(row.asks, DECISION_QUESTION_MAX),
    // LIN-4550: the one-line question (lib/open-questions.js `short`), already within its own cap; capped again, as every field here is.
    short: row.short ? truncateText(row.short, DECISION_QUESTION_MAX) : null,
    options: options.slice(0, DECISION_OPTIONS_MAX).map(o => truncateText(o, DECISION_OPTION_LABEL_MAX)),
    recommended: row.recommended ? truncateText(row.recommended, DECISION_ID_MAX) : null,
    issueIdentifier: row.ticket ? truncateText(row.ticket, DECISION_ID_MAX) : null,
    // LIN-4549: the task's title, for the card's task line (null when the issue read did not know it).
    issueTitle: row.title ? truncateText(row.title, DECISION_QUESTION_MAX) : null,
    state: row.state,
    interactive: row.interactive === true,
  };
}

// A non-string is not renderable text and must not ride uncapped: a question's
// asks come off a record's free-text field, which the records checker bounds on
// write but this projection does not trust, so a non-string never reaches the model.
function truncateText(value, max) {
  if (typeof value !== 'string' || !value) return null;
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
      // LIN-3037: a decision-lifecycle stamp's message is answer/withdrawal
      // metadata (a withdrawal's `reason` reads like real feedback), not a
      // chat/feedback line — must never become `latestFeedback` verbatim.
      if (isDecisionLifecycleStampEntry(entry)) continue;
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
 * Every loop, `wake` included, takes part in the LANE decision: B closes stale
 * wake rows at the source, so a wake still classified live is genuinely in
 * flight and `foldSessionLane` lets the lineage tail speak for the session.
 *
 * @param {Object} session - a `getSessionsForWorkspace` record
 * @param {Object} ctx
 * @param {Set<string>} ctx.superseded - `computeSupersededLoopIds` over the WHOLE workspace read
 * @param {number} ctx.now - epoch ms
 * @param {number} ctx.staleMs - working→silent threshold
 * @param {Map<string, 'waiting'|'settled'>} [ctx.questionStanding] - `questionStandingOf` over the WHOLE workspace (LIN-4538); threaded straight through to `classifyLoop`
 * @returns {Object} the row, including its folded `lifecycle` lane
 */
export function projectActiveSession(session, { superseded, now, staleMs, questionStanding } = {}) {
  const loops = session.loops || [];
  const laneByLoopId = new Map(
    loops.map(l => [l.loopId, classifyLoop(l, { superseded, now, staleMs, questionStanding })])
  );
  const lifecycle = foldSessionLane(loops, laneByLoopId);

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
    // AND the answered-decision discharge (LIN-2671 — an answered [blocked] row
    // lands `resolved`, not `blocked`) before it names the lane.
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
 *   provider read — it is NOT accepted from the model. This is the `row` tier's
 *   pair by default, and every tier's fallback when `scopeByTier` (below) does
 *   not override it — so a caller passing only `provider`/`scope`, as every
 *   caller did before LIN-2967, reproduces today's catalog exactly.
 * @param {{row?: {provider: Object, scope: (string|Object)}, workspace?: {provider: Object, scope: (string|Object)}}} [args.scopeByTier] -
 *   LIN-2967: per-tier overrides of the `provider`/`scope` pair above, keyed by
 *   {@link CHAT_TOOL_SCOPE_TIERS} value. Only `row` and `workspace` are
 *   meaningful here — `fleet` and `null`-tier tools resolve against the
 *   autopilot/dispatch read-model or nothing at all, never a provider, so a
 *   `scopeByTier.fleet` entry would have no consumer. Omitting a tier (or the
 *   whole param) falls back to the top-level `provider`/`scope` for that
 *   tier — additive, so every pre-LIN-2967 caller (a single pair, used
 *   everywhere) is unchanged. This is what lets a `workspace`-tier tool
 *   (`get_stack`, `get_pr_status`) resolve the WORKSPACE's own binding even
 *   when `row` is pinned to a foreign-source row's binding (LIN-2047's fix,
 *   which this ticket extends rather than reopens).
 * @param {Array<string>} [args.includeTiers] - LIN-2967 "subset" seam: when
 *   given, every tool whose {@link CHAT_TOOL_SCOPE_TIERS} value is in this
 *   list is included (subject to its own existing preconditions —
 *   `followUpEnabled`, configured stores, etc., all still apply).
 * @param {Array<string>} [args.includeTools] - LIN-2967 "subset" seam: when
 *   given, exactly these tool names are included, regardless of tier.
 *   Combines with `includeTiers` as a UNION — a tool is included if EITHER
 *   filter admits it, so a caller can ask for "the whole `row` tier, plus
 *   `get_stack`" in one call. Neither filter supplied (both omitted, the
 *   default) → no subset restriction, every existing caller's full catalog.
 *   This is the seam "an agent with a specific prompt and a subset of tools"
 *   (John, 2026-09-21) is a real parameter through, instead of a future
 *   surface forking this factory to hand-pick tools itself.
 * @param {string} [args.urlKey] - The workspace url key the records and session reads are keyed by.
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
 *   derived by `isLoopTerminal(tail)` in lib/follow-up-dispatch.js, not by this function.
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
 *   Anything else — `'propose'`, an unrecognised string, `null` — is treated
 *   as `'propose'`. LIN-2439: this boundary FAILS CLOSED. A second producer
 *   (e.g. a proxy caller) that passes a typo'd or garbage value must never
 *   fall through to executing a write; only the exact string `'execute'`
 *   does that, and only when the caller supplied it or omitted the arg
 *   entirely (the default). `'propose'` is for a turn that was not
 *   demonstrably started by a human (e.g. an auto-wake turn): the executor
 *   still validates its arguments and looks the session up, but stops there
 *   — it never calls `deriveFollowUpDispatch` or `createDispatchItem`, and
 *   returns exactly `{ proposed: true, sessionId, prompt }` with no derived
 *   `force`/`target`/`followUpTo`. Those are re-derived fresh, server-side,
 *   at approval time (a later ticket) from the session's then-current state,
 *   so a proposal never carries stale derived state.
 * @param {Function} [args.enqueueGuard] - LIN-3383. `async ({target}) =>
 *   refusal|null` (the route closes it over the hoisted owner seam). REQUIRED
 *   for `send_follow_up` in execute mode: absent means the tool refuses.
 * @param {string} [args.dispatchedBy] - The requesting user's account id (e.g.
 *   `req.session.accountId`), forwarded to `dispatchQueueStore.addItem` as
 *   `dispatchedBy` so a follow-up sent via the tool is attributed the same way
 *   as one sent via the reply box.
 * @param {Function} [args.githubFetch] - LIN-2624: test seam for `get_pr_status`'s
 *   GitHub REST calls. Defaults to `createProxyFetch()`'s result (or
 *   `globalThis.fetch` when no egress proxy is configured) — production
 *   behavior is unchanged when this is omitted.
 * @returns {{ tools: Array<Object>, executeTool: Function, executors: Object }}
 *   `tools` are the schemas above (plus {@link FOLLOW_UP_TOOL_SCHEMA} when
 *   `followUpEnabled` is true); `executeTool({name, arguments})` matches the
 *   `streamChatWithTools` executor contract and returns a JSON-serializable value;
 *   `executors` exposes the per-tool functions for direct/unit use.
 */
export function createChatToolCatalog({
  provider, scope, scopeByTier = null, includeTiers = null, includeTools = null,
  urlKey,
  // LIN-4501: the get_stack headlines read each task `asked` (lib/task-stack.js askedForStack). Absent: empty headlines.
  recordsStore = null,
  dispatchQueueStore, agentStatusStore, sessionIsTerminal, followUpEnabled = false, dispatchedBy = null,
  followUpMode = 'execute',
  // LIN-4080 (ruling lin4080-task-chat-person-force): the server-side indication that this catalog serves
  // a person-started chat turn. Set by routes/task-chat.js and forwarded by agent-turn; a closure value,
  // never a tool argument, so the model can neither supply nor forge it. Only an execute-mode send reaches
  // createDispatchItem, so a propose or run-scoped turn can never use it.
  personTurn = false,
  enqueueGuard = null,
  workspacePreferencesStore = null,
  // LIN-1431: both required by provisionBootstrapToken so `send_follow_up` can
  // credential a follow-up resuming a claude-code session. Optional, mirroring
  // workspacePreferencesStore — absent, provisioning degrades to null for prose
  // harnesses and fail-closed-throws for claude-code (never a silent bare resume).
  proxyTokenStore = null, baseUrl = null,
  // LIN-2624: test seam for get_pr_status's GitHub REST calls; see JSDoc above.
  githubFetch = null,
  // LIN-3285: `workspaceId` + `installationTokenFor` let `get_pr_status` read a
  // Linear/Jira workspace's PR with the owner's GitHub App installation. Both
  // absent (the proxy chat) → the anonymous read, as before.
  workspaceId = null, installationTokenFor = null,
  // LIN-2625: deliberate gate (default `false`) for the second write tool,
  // `remember` — mirrors `followUpEnabled`. Only when `true` is its schema
  // appended to `tools`; `onRemember` is the buffering callback the turn core
  // supplies (see REMEMBER_TOOL_SCHEMA's own doc). Absent/non-function while
  // `playbookEnabled` is true fails the call cleanly as "not configured",
  // same discipline as every other optional dep in this factory.
  playbookEnabled = false, onRemember = null,
  // LIN-4532 (finding-79815581): the canonical account of `dispatchedBy` (a merged account's alias reads as its canonical one). Absent
  // or failing, the session account stands, as before. Only the question read uses it, never the attribution of a follow-up.
  resolveCanonicalAccountId = null,
} = {}) {
  if (!provider) {
    throw new Error('createChatToolCatalog requires a provider');
  }

  // LIN-4532: the canonical account of a session account (see `resolveCanonicalAccountId` above). A resolver that throws reads as
  // the account itself, the same fallback personWriterOf takes (routes/task-records.js).
  async function canonicalAccountOf(accountId) {
    if (typeof resolveCanonicalAccountId !== 'function') return accountId;
    try {
      return (await resolveCanonicalAccountId(accountId)) || accountId;
    } catch {
      return accountId;
    }
  }

  // LIN-2967: resolve each tier's own provider/scope pair, falling back to
  // the top-level `provider`/`scope` when `scopeByTier` doesn't override that
  // tier — this is the whole additive contract: a caller that never passes
  // `scopeByTier` gets `rowProvider === provider` and `workspaceProvider ===
  // provider` for every tool, byte-identical to before this param existed.
  // Only `row` and `workspace` tiers ever read a provider (see the JSDoc on
  // `scopeByTier` above), so only those two are resolved here.
  const rowProvider = scopeByTier?.row?.provider || provider;
  const rowScope = scopeByTier?.row ? scopeByTier.row.scope : scope;
  const workspaceProvider = scopeByTier?.workspace?.provider || provider;
  const workspaceScope = scopeByTier?.workspace ? scopeByTier.workspace.scope : scope;

  // LIN-2967: the "subset" seam. `null` (neither filter supplied) means NO
  // restriction — every existing caller's full catalog, unchanged. Filters
  // combine as a union (see the JSDoc above); computed once here and applied
  // in two places below: the final `tools` list, and `executeTool`'s own
  // gate, so a tool excluded from the subset can neither be offered to the
  // model NOR called directly by one that already knows its name.
  const allowedToolNames = (includeTiers || includeTools)
    ? new Set([
        ...(includeTiers ? Object.keys(CHAT_TOOL_SCOPE_TIERS).filter(n => includeTiers.includes(CHAT_TOOL_SCOPE_TIERS[n])) : []),
        ...(includeTools || []),
      ])
    : null;

  // LIN-2624: `get_pr_status`'s cross-workspace cache, closure-scoped so a
  // fresh catalog (a fresh test, a fresh request in a call site that builds
  // one per-request) starts cold rather than leaking entries across
  // workspaces or tests. 60s per (repo, number, sha) key.
  const prStatusCache = new Map();

  // LIN-2439: fail CLOSED at the boundary. The default parameter above only
  // covers an omitted arg; this covers every OTHER value a second producer
  // might pass. Only the exact string 'execute' executes a write — anything
  // else ('propose', a typo, null) proposes. Never widen this to a
  // startsWith/case-insensitive match: a strict, narrow allowlist is the
  // point.
  const safeFollowUpMode = followUpMode === 'execute' ? 'execute' : 'propose';

  /**
   * Guard: the session read-model needs both stores. Absent → a clean
   * "not configured" error,
   * rather than pipeline-loops' raw "must be injected" throw.
   */
  function requireSessionStores() {
    if (!dispatchQueueStore || !agentStatusStore) {
      throw new Error('Session data is not configured for this workspace');
    }
  }

  const executors = {
    // Task lookup via fetchRecommendationContext (Linear provider index.js:2049).
    lookup_task: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(rowProvider, 'fetchRecommendationContext');
      const context = await rowProvider.fetchRecommendationContext(rowScope, issueId);
      if (!context || !context.issue) {
        throw new Error(`Task ${issueId} not found`);
      }
      return context;
    },

    // Full-text search via provider.search (Linear provider index.js:2054).
    // LIN-2967: `row`-tiered by product judgment, not by the call's own
    // breadth (it is binding-wide, the same shape as `get_stack`'s
    // `workspace`-tiered fetchProjects) — see CHAT_TOOL_SCOPE_TIERS' own doc
    // comment above for the resolution-vs-breadth distinction this rests on.
    search_tasks: async ({ query, limit } = {}) => {
      if (typeof query !== 'string' || !query.trim()) {
        throw new Error('search_tasks requires a non-empty "query" string');
      }
      requireProviderMethod(rowProvider, 'search');
      // Clamp to the provider's 50-result cap; only pass `first` when a valid
      // positive limit was supplied, otherwise fall through to the default.
      const opts =
        Number.isInteger(limit) && limit > 0 ? { first: Math.min(limit, 50) } : undefined;
      return rowProvider.search(rowScope, query.trim(), opts);
    },

    // Relations via provider.relations (Linear provider index.js:2059).
    get_relations: async ({ issueId } = {}) => {
      requireValidIssueId(issueId);
      requireProviderMethod(rowProvider, 'relations');
      const rel = await rowProvider.relations(rowScope, issueId);
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
      requireProviderMethod(rowProvider, 'fetchRecommendationContext');
      const context = await rowProvider.fetchRecommendationContext(rowScope, issueId);
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
      requireProviderMethod(rowProvider, 'fetchRecommendationContext');
      const context = await rowProvider.fetchRecommendationContext(rowScope, issueId);
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
      requireProviderMethod(rowProvider, 'fetchRecommendationContext');
      const context = await rowProvider.fetchRecommendationContext(rowScope, issueId);
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

    // Sorted task-stack digest via the shared /stack pipeline (lib/task-stack.js).
    // Fetches projects+issues through the captured provider scope, then projects
    // the orientation-grade digest; `limit` is clamped to 1-50 (default 5).
    // LIN-2967 (D-B, pre-answered): the WORKSPACE's own binding, never the
    // row's — closes LIN-2085's open question.
    get_stack: async ({ limit } = {}) => {
      requireProviderMethod(workspaceProvider, 'fetchProjects');
      const { projects, issues } = await workspaceProvider.fetchProjects(workspaceScope);
      return buildTaskStack({
        projects: projects || [],
        issues: issues || [],
        limit: clampStackLimit(limit),
        view: 'digest',
        // LIN-4501: the headlines are the tasks' `asked`, as on GET /api/proxy/stack.
        askedByTicket: await askedForStack(recordsStore, urlKey, issues),
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
      const session = await readSessionById(
        urlKey, sessionId, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );
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
          // LIN-2207/LIN-3037: a decision-lifecycle stamp is metadata about a
          // decision or withdrawal, not a chat turn — the same exclusion
          // every other feedback[] consumer in this class already applies
          // (LIN-1728 Phase 1/2).
          transcript: (loop.feedback || []).filter(f => !isDecisionLifecycleStampEntry(f)).map(f => ({
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
      const allLoops = sessions.flatMap(s => s.loops || []);
      const superseded = computeSupersededLoopIds(allLoops);
      // LIN-4538: the lineage standing read from question records, once, over the
      // workspace — the same map the sweep computes (lib/observer-sweep.js), so this
      // tool and the census cannot disagree on whether a blocked run is waiting on a question.
      const questionStanding = recordsStore ? await questionStandingOf(recordsStore, urlKey) : new Map();
      const now = Date.now();

      const live = sessions.map(session =>
        projectActiveSession(session, { superseded, now, staleMs: DEFAULT_LANE_STALE_MS, questionStanding })
      );

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
      return fitToBudget({
        // The total that MATCHED, which is what the model should quote — the
        // list below is capped at `limit` (and then at the result budget), and
        // `truncated` says when the two differ so a partial list is never
        // narrated as the whole fleet.
        count: selected.length,
        truncated: selected.length > rows,
        noise: {
          terminalOmitted,
          // Everything this read withheld, terminal or not — under an explicit
          // lane the filter withholds far more than the finished rows, and
          // `terminalOmitted` alone would have the model under-report.
          omittedByFilter: live.length - selected.length,
        },
        sessions: selected.slice(0, rows),
      }, 'sessions', CHAT_TOOL_RESULT_BUDGETS.list_active_sessions);
    },

    // Every question this person was asked that is still open (LIN-4538: question records, read by
    // lib/open-questions.js, the one reader the page, Home and the count share). Oldest first.
    list_pending_decisions: async ({ limit } = {}) => {
      if (!recordsStore) {
        throw new Error('Decision data is not configured for this workspace');
      }
      const rows = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 20;
      // The question is addressed to the canonical account (`person:<canonical>`), so the read names that one (finding-79815581).
      // No account (a coordinator's call) reads none: a question is someone's to answer.
      const questionAccountId = dispatchedBy ? await canonicalAccountOf(dispatchedBy) : null;
      // LIN-4549: each question's task title, from the workspace's own issue read (the read get_stack makes), best effort: a failed
      // or missing read leaves the card its identifier alone (lib/open-questions.js titlesOf).
      const titlesOf = typeof workspaceProvider?.fetchProjects === 'function'
        ? async (tickets) => titlesFromIssues((await workspaceProvider.fetchProjects(workspaceScope))?.issues)(tickets)
        : null;
      const questionRows = questionAccountId
        ? await openQuestionsFor({ recordsStore, dispatchStore: dispatchQueueStore, urlKey, accountId: questionAccountId, titlesOf }).catch(() => [])
        : [];
      // `openQuestionsFor` sorts oldest first already; the cap keeps the longest-waiting questions.
      const payload = {
        count: questionRows.length,
        truncated: questionRows.length > rows,
        questions: questionRows.slice(0, rows).map(projectPendingQuestion),
      };
      return fitToBudget(payload, 'questions', CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions);
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
      const session = await readSessionById(
        urlKey, sessionId, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const finalPrompt = prompt.trim();
      if (safeFollowUpMode !== 'execute') {
        // §A.4: an auto-wake (non-human-started) turn cannot execute a write.
        // Stop here — never derive followUpTo/target/force and never call
        // createDispatchItem. Derivation happens fresh, server-side, at
        // approval time from the session's then-current state.
        return { proposed: true, sessionId: session.sessionId, prompt: finalPrompt };
      }
      const { followUpTo, target, force } = deriveFollowUpDispatch(session);
      // LIN-3383 owner-only runner enqueue. Execute mode only (propose returned
      // above and never reaches a write). The guard is injected by the route
      // (it closes over the hoisted owner seam, the route workspace id and the
      // session account); a catalog built without one in execute mode REFUSES —
      // fail closed, never a silent skip. Ahead of createDispatchItem, so a
      // refusal enqueues nothing and mints no credential. Thrown here, outside
      // the factory try/catch below, so no mint-oriented catch can swallow it.
      if (typeof enqueueGuard !== 'function') {
        throw new Error('send_follow_up refused (OWNER_CHECK_UNAVAILABLE): no owner guard is wired for this chat; do not retry, tell the user');
      }
      const enqueueRefusal = await enqueueGuard({ target });
      if (enqueueRefusal) {
        throw new Error(enqueueRefusal.retryable
          ? `send_follow_up refused (${enqueueRefusal.code}): retry once shortly`
          : `send_follow_up refused (${enqueueRefusal.code}): ${enqueueRefusal.error}; do not retry, tell the user`);
      }
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
      //
      // LIN-3134 T2-ii: always a follow-up, so the whole finalize is the one
      // resume helper — the credential comes from the persisted parent record,
      // declared or plain, never from this chat's account on a declared resume.
      // A refusal is rethrown as a tool error the model can act on; nothing is
      // enqueued (the throw precedes addItem) and no token is minted.
      let item;
      try {
        item = await createDispatchItem({
          store: dispatchQueueStore,
          urlKey,
          workspacePreferencesStore,
          proxyTokenStore,
          applyDefaultHarness: false,
          // LIN-4080: a person-started Task Chat turn (the route's indication) may force a stopped run's
          // resume. The factory admits it only with force:true and stamps the row; anything else stays 409.
          personOriginated: personTurn === true,
          prompt: finalPrompt,
          // The shouldUseMcpTokenField guard (`mint`) is load-bearing: a prose
          // harness would get a minted token too, and this path never rewrites the
          // prompt, so minting there would strand an unreferenceable credential on
          // the item. A blank harness resolves null here → no mint → bootstrapToken
          // null, exactly as before this change.
          // LIN-4492: the run the factory gave this row, from the finalize argument.
          finalizePrompt: (resolvedHarness, _resolvedKind, { runRecordId = null } = {}) => provisionResumeCredential({
            proxyTokenStore,
            dispatchStore: dispatchQueueStore,
            urlKey,
            baseUrl,
            label: 'dispatch-bootstrap',
            harness: resolvedHarness,
            followUpTo,
            // LIN-1376: the chat's own dispatching account, the same stamp the
            // item's `dispatchedBy` field carries below.
            createdBy: dispatchedBy || null,
            prompt: finalPrompt,
            mint: shouldUseMcpTokenField(resolvedHarness),
            runRecordId
          }),
          fields: {
            followUpTo,
            target,
            force,
            dispatchedBy,
          }
        });
      } catch (err) {
        if (err && err.code === 'OWNER_CHECK_UNAVAILABLE') {
          throw new Error('send_follow_up refused (OWNER_CHECK_UNAVAILABLE): retry once shortly');
        }
        if (isStructuralGrantRefusal(err)) {
          throw new Error(`send_follow_up refused (${err.code}): the orchestrator's dispatch grant cannot be re-issued; do not retry, tell the user`);
        }
        throw err;
      }
      return {
        queued: true,
        itemId: item._id,
        sessionId: session.sessionId,
        target,
        force,
      };
    },

    // LIN-2624: the sole deliberate exception to invariant #2 — see the Pass-5
    // header comment above and fetchPrStatus below it. Validation order is
    // load-bearing and pinned by tests: repo type, then number/sha SHAPE (before
    // any fetch), then the slug check inside fetchPrStatus (before any GitHub
    // fetch), then the cache.
    get_pr_status: async ({ repo, number, sha } = {}) => {
      if (typeof repo !== 'string' || !repo.trim()) {
        throw new Error('get_pr_status requires a non-empty "repo"');
      }
      if (number === undefined && sha === undefined) {
        throw new Error('get_pr_status requires "number" and/or "sha"');
      }
      if (number !== undefined && !PR_NUMBER_PATTERN.test(String(number))) {
        throw new Error(`Invalid PR number: ${JSON.stringify(number)}`);
      }
      if (sha !== undefined && !COMMIT_SHA_PATTERN.test(String(sha))) {
        throw new Error(`Invalid commit sha: ${JSON.stringify(sha)}`);
      }

      // LIN-3443: the bound repo is read with the workspace's own token. The
      // cache is per catalog (closure), so it is already per workspace; the
      // `auth|` prefix keeps an authenticated entry apart from an anonymous one.
      // LIN-3285: a Linear/Jira workspace (`workspaceProvider.name`) reads with
      // the owner's installation token, for any repo that installation covers.
      const token = await resolvePrReadToken({
        callScope: workspaceScope, repo, providerKind: workspaceProvider?.name, workspaceId, installationTokenFor,
      });
      const cacheKey = `${token ? 'auth|' : ''}${repo}|${number ?? ''}|${sha ?? ''}`;
      const cached = prStatusCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }

      const doFetch = githubFetch || (await createProxyFetch()) || globalThis.fetch;
      const result = await fetchPrStatus(doFetch, { repo, number, sha, token });
      prStatusCache.set(cacheKey, { value: result, expiresAt: Date.now() + PR_STATUS_CACHE_TTL_MS });
      return result;
    },

    // LIN-2625: the second deliberate write exception, alongside send_follow_up.
    // Never touches a store itself — only forwards the validated playbook to
    // the injected `onRemember` buffer; the turn core decides when (and
    // whether) that buffer actually reaches the observer-state record. A
    // second call within the same turn simply overwrites the buffer, which is
    // what "keeps the last value" means for a multi-iteration tool loop.
    remember: async ({ playbook } = {}) => {
      if (!playbookEnabled || typeof onRemember !== 'function') {
        throw new Error('Playbook memory is not configured for this call');
      }
      if (typeof playbook !== 'string') {
        throw new Error('remember requires a string "playbook"');
      }
      if (playbook.length > PLAYBOOK_MAX_CHARS) {
        throw new Error(`Playbook must be ${PLAYBOOK_MAX_CHARS} characters or fewer (got ${playbook.length})`);
      }
      onRemember(playbook);
      return { remembered: true, length: playbook.length };
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
    // LIN-2967: the subset seam is a real boundary, not just a hint to the
    // model — a tool excluded by `includeTiers`/`includeTools` refuses here
    // too, the same defense-in-depth `followUpEnabled`/`playbookEnabled`
    // already apply to `send_follow_up`/`remember` below.
    if (allowedToolNames && !allowedToolNames.has(name)) {
      throw new Error(`Tool ${name} is not available in this call's subset`);
    }
    return fn(args || {});
  }

  // LIN-2617 / LIN-4538: `list_pending_decisions` needs the records store (the question
  // records it reads) not every call site wires. Where it is absent the executor still fails cleanly (a direct
  // caller gets a real error), but the schema is withheld from `tools` — a
  // catalog that ADVERTISES a tool which can only ever throw spends a model
  // turn to learn that, every turn. The name stays in CHAT_TOOL_SCHEMAS, which
  // is the catalog of what exists, not of what this call site can run.
  const decisionsConfigured = !!recordsStore;
  const base = decisionsConfigured
    ? CHAT_TOOL_SCHEMAS
    : CHAT_TOOL_SCHEMAS.filter(t => t.function.name !== 'list_pending_decisions');
  let tools = base;
  if (followUpEnabled) tools = [...tools, FOLLOW_UP_TOOL_SCHEMA];
  if (playbookEnabled) tools = [...tools, REMEMBER_TOOL_SCHEMA];
  // LIN-2967: applied LAST, after every other inclusion rule above — the
  // subset can only narrow what those rules already produced, never re-add
  // a tool one of them withheld (e.g. an unconfigured list_pending_decisions).
  if (allowedToolNames) tools = tools.filter(t => allowedToolNames.has(t.function.name));
  return { tools, executeTool, executors };
}
