/**
 * Linear API proxy routes.
 *
 * Two types of endpoints:
 * 1. User-facing API (workspace-prefixed, session auth):
 *    - Token management (CRUD)
 *    - Event log listing
 *
 * 2. Consumer API (proxy token auth):
 *    - Read endpoints (viewer, teams, projects, issues, search, etc.)
 *    - Write endpoints (create/update issues, comments, relations, labels)
 *    - Agent instructions endpoint (llms.txt)
 */

import { Router } from 'express';
import { GraphQLClient, gql } from 'graphql-request';
import rateLimit from 'express-rate-limit';
import { createProxyFetch } from '../lib/proxy-fetch.js';
import { createDedupeCache, dedupeKey } from '../lib/proxy-dedupe.js';
import { fetchProjects, fetchIssueContext, fetchRecommendationContext } from '../lib/linear.js';
import { applyTrashedSignal, isTrashed } from '../lib/trashed-signal.js';
import { isRecommendationEnabled, getRecommendation } from '../lib/openrouter.js';
import { resolveRecommendation, describeDescent, armHopSignal } from '../lib/recommend-recurse.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, isTerminalState, NO_PROJECT_ID } from '../lib/tree.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent, computeGraphFeatures, computeOffPageBlockers, buildWhy } from '../lib/render-swipe.js';
import { generatePrompt, hasPrompt, isValidDispatchKind, deriveDispatchKind, DISPATCH_KINDS } from '../lib/prompt-templates.js';
import { parseRepoFromDescription, buildPromptFilename } from '../lib/prompt-formatters.js';
import { buildForemanPlaybook } from '../lib/prompts/foreman-playbook.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import { appendBlock, replace as replaceInDescription, DescriptionEditError } from '../lib/description-edit.js';
import { workspaceUnavailableEnvelope } from '../lib/errors.js';

// Lazy-load test fixtures only in test mode to avoid production dependency on test files
let testMockData = null;
async function getTestMockData() {
  if (!testMockData) {
    const mod = await import('../tests/fixtures/mock-data.js');
    testMockData = mod.testMockData;
  }
  return testMockData;
}

/**
 * Build a mock recommendation context from test fixtures (mirrors workspace-api.js).
 */
async function buildMockRecapContextFromFixtures(issueId) {
  const mockData = await getTestMockData();
  const mockIssue = mockData.issues.find(i => i.id === issueId || i.identifier === issueId || i.url?.endsWith(`/${issueId}`));
  if (!mockIssue) return null;
  const project = mockData.projects.find(p => p.id === mockIssue.project?.id) || null;
  const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
  const comments = (mockIssue.comments?.nodes || []).map(c => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    user: { name: c.user?.name || 'Unknown' }
  }));
  const children = (mockIssue.children?.nodes || []).map(c => ({
    id: c.id,
    identifier: c.identifier || c.id,
    title: c.title,
    state: c.state || { type: 'unstarted', name: 'Todo' },
    labels: (c.labels?.nodes || []).map(l => l.name)
  }));
  return {
    issue: {
      id: mockIssue.id,
      identifier: mockIssue.identifier || mockIssue.id,
      title: mockIssue.title,
      description: mockIssue.description || '',
      state: mockIssue.state,
      labels,
      url: mockIssue.url
    },
    parent: null,
    siblings: [],
    project: project ? { id: project.id, name: project.name } : null,
    children,
    comments,
    focusedChild: null
  };
}

/**
 * Build a small deterministic recap for test mode.
 */
function buildMockRecapFromContext(context) {
  const labels = context.issue?.labels || [];
  const done = [];
  const pending = [];
  const deviations = [];

  if ((context.comments || []).length > 0) {
    done.push({
      item: 'Discussion captured in comments',
      evidence: `${context.comments.length} comment(s) recorded`
    });
  }
  if (context.issue?.description) {
    done.push({
      item: 'Description documented',
      evidence: 'Description is present on the issue'
    });
  }
  const remainingChildren = (context.children || []).filter(
    c => !isTerminalState(c.state?.type)
  );
  for (const c of remainingChildren.slice(0, 3)) {
    pending.push({
      item: `Complete subtask ${c.identifier}`,
      predicted: c.title || ''
    });
  }
  if (pending.length === 0) {
    pending.push({
      item: 'Continue implementation',
      predicted: 'Pick up from current state'
    });
  }
  if (labels.includes('blocked') || labels.includes('Blocked')) {
    deviations.push({
      item: 'Task is blocked',
      type: 'blocker',
      evidence: 'Blocked label applied'
    });
  }
  return { done, pending, deviations };
}

/**
 * Build a small deterministic brief (fixed-section Markdown) for test mode.
 * Mirrors buildMockBrief in routes/workspace-api.js so the proxy and in-app
 * paths return the same shape under test.
 */
function buildMockBriefFromContext(context) {
  const issue = context.issue || {};
  const remaining = (context.children || []).filter(c => !isTerminalState(c.state?.type));
  const labels = issue.labels || [];

  const lines = [];
  lines.push('## Current');
  lines.push(`${issue.title || 'Untitled task'} — ${issue.description ? issue.description.split('\n')[0] : 'No description provided.'}`);
  if (remaining.length > 0) {
    lines.push('');
    lines.push(`Remaining: ${remaining.map(c => c.identifier).join(', ')}.`);
  }
  lines.push('');

  lines.push('## Constraints');
  if (labels.includes('blocked') || labels.includes('Blocked')) {
    lines.push('- Task is blocked; resolve the blocker before proceeding.');
  } else {
    lines.push('- _None._');
  }
  lines.push('');

  lines.push('## Open questions');
  lines.push('- _None._');
  lines.push('');

  lines.push('## Changelog');
  if ((context.comments || []).length > 0) {
    lines.push(`- **Discussion captured in ${context.comments.length} comment(s)** — context lives in the thread, not yet folded into the spec.`);
  } else {
    lines.push('- _None._');
  }

  return lines.join('\n');
}

const LINEAR_API_ENDPOINT = 'https://api.linear.app/graphql';

// Proxy-aware fetch for environments behind an HTTP proxy (e.g. corporate networks).
// graphql-request's default fetch doesn't respect HTTP_PROXY/HTTPS_PROXY env vars.
const proxyFetch = await createProxyFetch();

// Short-window dedupe for non-idempotent comment creates (LIN-399). An
// identical (workspace + issue + body) create arriving within the window
// collapses to the first comment instead of minting a duplicate, so a
// consumer that retries after a lost response gets the original back.
const commentDedupe = createDedupeCache();

// Rate limiters
// Note: proxyLimiter is applied before authenticateProxyToken on consumer
// endpoints intentionally. This ensures unauthenticated/malicious requests
// are counted against the per-IP limit, mitigating DoS attacks that would
// otherwise bypass rate limiting by failing at auth.
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many proxy requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

const proxyTokenCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token creation requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

const MAX_NAME_LENGTH = 1000;
const MAX_SEARCH_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100000;
const MAX_COMMENT_LENGTH = 50000;

// Dispatch input limits (mirror routes/dispatch.js, the session-auth twin).
const MAX_PROMPT_LENGTH = 10000000;    // 10MB max for prompt content
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
// Proxy consumers are remote, so 'local' (Harbour, spawns on the server's
// own /dev/tty) is intentionally excluded from the targets they may set.
const VALID_PROXY_DISPATCH_TARGETS = ['cli', 'web', 'dash'];

// Timeout for individual GraphQL requests to Linear.
// Prevents the proxy from hanging silently when Linear is slow or payloads are large,
// which causes downstream "stream idle timeout" errors in CLI clients like curl.
const GRAPHQL_TIMEOUT_MS = 25_000;

// Longer timeout for Linear endpoints that make multiple sequential GraphQL
// calls (e.g. the projects + issues fetch behind /stack-style pagination).
// The OpenRouter generation leg is NOT capped by this — it has its own, much
// larger budget (LLM_TIMEOUT_MS) so a slow-but-healthy generation isn't killed.
const MULTI_REQUEST_TIMEOUT_MS = 50_000;

// Budget for the OpenRouter LLM generation leg on recommendation-style endpoints
// (recommend/recap/brief). Generation routinely runs tens of seconds and varies
// with provider routing and output size; the previous 50s cap surfaced as
// intermittent 504s whose root cause was this leg, not Linear (the error text
// misattributed it). The armed keepalive (http-keepalive.js) writes a heartbeat
// space every 15s after its 25s flush, so the socket stays alive for an
// arbitrarily long wait — the keepalive, not this number, is what keeps Heroku's
// H12 at bay. This cap is therefore just a generous backstop against a genuinely
// hung generation.
const LLM_TIMEOUT_MS = 180_000;

// Backstop for the Linear context fetch on recommendation-style endpoints
// (recommend/recap/brief/status). These fetches run behind an armed keepalive
// (http-keepalive.js flushes a 200 + heartbeat at 25s and then holds the
// connection open), so a 25s cap on the fetch would fire at the same instant
// the keepalive starts covering for slowness — surfacing a 504 on healthy large
// epics instead of letting the request complete. A larger budget keeps the cap
// as a backstop for a genuinely hung Linear while letting normal large epics
// finish. Paired with an AbortSignal so a trip actually cancels the request.
const CONTEXT_FETCH_TIMEOUT_MS = 45_000;

// Shared cross-hop budget for the recommend recursion (LIN-329). Each defer hop is
// a Linear fetch + an LLM routing reply, but a deferring reply emits NO prompt body
// (the cost contract), so it is far cheaper than the single terminal prompt. A
// ~10-deep descent is therefore ≈ 10 short replies + 1 full prompt — comfortably
// inside this budget. resolveRecommendation checks it BETWEEN hops (a shared
// deadline, not per-call); each individual hop is still bounded by the per-call
// CONTEXT_FETCH/LLM caps above, and the armed keepalive holds the socket open.
const RECOMMEND_DESCENT_BUDGET_MS = LLM_TIMEOUT_MS;

/**
 * Race a promise against a timeout. Throws a TimeoutError if the promise
 * doesn't settle within `ms` milliseconds, giving the same error shape as
 * AbortSignal.timeout() so graphqlErrorStatus() maps it to 504.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const err = new DOMException('Linear API request timed out', 'TimeoutError');
        reject(err);
      }, ms);
    })
  ]);
}

/**
 * Like withTimeout, but cancels the underlying work via AbortSignal when the
 * deadline passes instead of leaving the HTTP request running orphaned. workFn
 * receives the signal to thread into fetch (e.g. fetchRecommendationContext).
 * Clears its timer on settle so a fast success doesn't abort a later request,
 * and preserves the TimeoutError shape so graphqlErrorStatus()/graphqlErrorDetail()
 * still map a trip to a 504.
 */
async function fetchWithTimeout(workFn, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Linear API request timed out', 'TimeoutError'));
    }, ms);
  });
  try {
    return await Promise.race([workFn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Pattern to detect null bytes and dangerous control characters
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** Max length of the deterministic one-line headline in the `/stack` digest view. */
const STACK_HEADLINE_MAX = 140;

/**
 * Reduce a task description to a single deterministic headline line for the
 * `/stack?view=digest` projection. Takes the first non-empty line and truncates
 * it — no LLM, cheap and exact, so orientation stays light and reproducible.
 * @param {string|null|undefined} description - Full task description
 * @returns {string} One-line headline (possibly empty)
 */
function toStackHeadline(description) {
  if (!description || typeof description !== 'string') return '';
  const firstLine = description.split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
  if (firstLine.length <= STACK_HEADLINE_MAX) return firstLine;
  return firstLine.slice(0, STACK_HEADLINE_MAX - 1).trimEnd() + '…';
}

/**
 * Builds the proxy-context block appended to a dispatched prompt so the worker
 * inherits Linear access for this workspace — the richer replacement for the
 * old local MCP. It does NOT teach phone-home: the dispatch runner's own Stop
 * hook reports back automatically when the session ends, so reporting is a
 * harness concern, not a prompt concern. We only ask the worker to END with an
 * evidence-rich summary, so whatever the hook forwards carries proof rather
 * than a bare "done" (the invariant-2 / LIN-292 discipline, applied at source).
 *
 * SECURITY DEBT — revisit (do not ship to broad use as-is): this embeds the
 * caller's STANDING readWrite proxy token in plaintext inside the queued prompt
 * (and anywhere that prompt is later rendered). A leaked prompt leaks full
 * workspace write. Planned hardening: mint a per-dispatch, short-TTL token bound
 * to this item with a narrow scope, mirroring the Harbour per-item feedback
 * token. For now (by explicit choice): standing readWrite.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://host
 * @param {string} params.token - Bearer token to embed (standing readWrite, for now)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42"
 * @returns {string} Block to append to the prompt
 */
function buildProxyContextPreamble({ baseUrl, token, issueIdentifier }) {
  // Per-issue examples only make sense when we actually have an identifier;
  // otherwise fall back to generic discovery endpoints (avoids rendering a
  // malformed ".../issues/your task" with a literal space).
  const contextLines = issueIdentifier
    ? [
        `Start from the distilled brief: GET ${baseUrl}/api/proxy/brief/${issueIdentifier}`,
        `(present-state — folds in comments, supersedes stale wording; read it before the raw`,
        `description). Use GET ${baseUrl}/api/proxy/issues/${issueIdentifier} for full raw detail`,
        `and /relations/${issueIdentifier}, and update Linear as you work (status, comments, labels).`
      ]
    : [
        `Once you pick a task, start from its distilled brief (GET ${baseUrl}/api/proxy/brief/{id}).`,
        `Use the proxy to pull context (e.g. GET ${baseUrl}/api/proxy/stack, /search?q=…,`,
        `/issues/LIN-123) and to update Linear as you work (status, comments, labels).`
      ];
  return [
    '',
    '',
    '---',
    '## Linear access (auto-appended)',
    '',
    `You have a Linear API proxy for this workspace. Base: ${baseUrl}/api/proxy`,
    `Auth header on every call: \`Authorization: Bearer ${token}\` (read+write).`,
    `Full endpoint catalog: GET ${baseUrl}/api/proxy/instructions`,
    '',
    ...contextLines,
    '',
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with a concise summary that',
    'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
    'report carries proof rather than a bare "done".',
    ''
  ].join('\n');
}

// Terminal markers the dispatch runner prefixes onto its final feedback entry.
// The runner posts completion as free-form text (e.g. "[done] Task completed in
// 45s" / "[failed] remote-control never connected"), and the queue's lifecycle
// status stays 'taken' — so without this an orchestrator has to parse prose to
// know a dispatch finished. Map the marker → a terminal status the watch/list
// endpoints can surface as a field. Derived on read only; the stored lifecycle
// status is untouched (so feedback the runner posts after taking still applies).
const TERMINAL_FEEDBACK_REGEX = /^\s*\[(done|complete|failed|aborted)\]/i;
const TERMINAL_MARKER_TO_STATUS = { done: 'done', complete: 'done', failed: 'failed', aborted: 'aborted' };

/**
 * Scans feedback entries for a terminal marker and returns the LAST one found
 * (the runner posts the terminal event last) as {entry, status}, or null if none.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{entry: object, status: ('done'|'failed'|'aborted')}|null}
 */
function findTerminalFeedback(feedback) {
  if (!Array.isArray(feedback)) {
    return null;
  }
  for (let i = feedback.length - 1; i >= 0; i--) {
    const match = TERMINAL_FEEDBACK_REGEX.exec(feedback[i]?.message || '');
    if (match) {
      return { entry: feedback[i], status: TERMINAL_MARKER_TO_STATUS[match[1].toLowerCase()] };
    }
  }
  return null;
}

/**
 * The terminal status derived from the feedback markers, or null if none.
 *
 * @param {Array<{message?: string}>} feedback
 * @returns {('done'|'failed'|'aborted')|null}
 */
function deriveTerminalStatus(feedback) {
  return findTerminalFeedback(feedback)?.status || null;
}

/**
 * The truthful task-completion time: the timestamp of the terminal feedback
 * entry (when the runner posted [done]/[failed]/[aborted]), or null until that
 * marker exists. Distinct from `resolvedAt`, which marks when the runner
 * *claimed* the item (take/archive time) — that lands seconds after enqueue
 * regardless of how long the work runs, so it must not be read as completion
 * (LIN-400). Derived on read; no schema/storage change.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {string|null}
 */
function deriveCompletedAt(feedback) {
  return findTerminalFeedback(feedback)?.entry?.timestamp || null;
}

// Long-poll tuning for GET /api/proxy/dispatch/:id?wait=Ns (LIN-392).
// DISPATCH_WAIT_MAX_S caps the hold below the ~60s ceiling that armKeepalive
// (flush at 25s) buys us past Heroku's 30s H12; the re-check interval bounds
// worst-case detection latency. Module-level so tests can drive the loop at
// short `wait` values instead of real-time waits.
const DISPATCH_WAIT_MAX_S = 50;
const DISPATCH_WAIT_POLL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shapes a store item into the watch-endpoint response body. Shared by the
// immediate short-poll and the long-poll.
//
// `meta` (long-poll only) makes the response self-describing about WHY it
// returned, so a held-the-full-window return is distinguishable from a
// short-circuit — they were previously byte-identical, which made a working
// 50s hold look like a fast empty return to a caller with no wall-clock on its
// own calls. `reason` ∈ 'terminal' (already done before the hold), 'change'
// (status transition or new feedback during the hold), 'timeout' (held the full
// window, nothing new); `waitedMs` is how long the handler actually held. Omitted
// on the plain short-poll (no `?wait`) so that path stays byte-identical.
function formatDispatchWatch(item, meta = null) {
  const terminalStatus = deriveTerminalStatus(item.feedback);
  const body = {
    id: item.id,
    status: terminalStatus || item.status,
    promptName: item.promptName,
    kind: item.kind || 'custom',
    issueIdentifier: item.issueIdentifier,
    issueUrl: item.issueUrl,
    target: item.target,
    dispatchedAt: item.dispatchedAt,
    // resolvedAt is take/archive time (when the runner claimed the item), NOT
    // completion. completedAt is the real completion time, null until terminal.
    resolvedAt: item.resolvedAt || null,
    completedAt: deriveCompletedAt(item.feedback),
    feedback: (item.feedback || []).map(f => ({
      message: f.message,
      url: f.url || null,
      urlLabel: f.urlLabel || null,
      timestamp: f.timestamp || null
    }))
  };
  if (meta) {
    body.reason = meta.reason;
    body.waitedMs = meta.waitedMs;
  }
  return body;
}

// A dispatch item has "changed" for long-poll purposes when its derived
// terminal status appears (or shifts — last-marker-wins is not monotonic) or
// new feedback arrives. Compared against a baseline snapshot captured on the
// handler's first read.
function dispatchWatchChanged(baseline, item) {
  return (
    (deriveTerminalStatus(item.feedback) || item.status) !== baseline.status ||
    (item.feedback || []).length !== baseline.feedbackLength
  );
}

// =============================================================================
// GraphQL Queries
// =============================================================================

const VIEWER_QUERY = gql`
  query {
    viewer {
      id
      name
      email
    }
  }
`;

const TEAMS_QUERY = gql`
  query {
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`;

const PROJECTS_QUERY = gql`
  query {
    projects(filter: { state: { eq: "started" } }) {
      nodes {
        id
        name
        content
        url
      }
    }
  }
`;

const ISSUES_QUERY = gql`
  query($first: Int!, $after: String, $teamId: ID) {
    issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
        cycle { id name number }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_QUERY_ALL = gql`
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
        cycle { id name number }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUE_DETAIL_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state { name type }
      trashed
      assignee { name }
      labels { nodes { id name color } }
      priority
      estimate
      dueDate
      createdAt
      completedAt
      project { id name }
      cycle { id name number startsAt endsAt }
      parent { id identifier title }
      children {
        nodes {
          id identifier title
          state { name type }
        }
      }
      comments {
        nodes {
          id body createdAt
          user { name }
        }
      }
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title state { name type } }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title state { name type } }
        }
      }
    }
  }
`;

const SEARCH_QUERY = gql`
  query($query: String!, $first: Int) {
    searchIssues(term: $query, first: $first) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        project { id name }
        cycle { id name number }
        parent { id identifier }
      }
    }
  }
`;

const STATES_QUERY = gql`
  query($teamId: ID!) {
    workflowStates(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id name type position
      }
    }
  }
`;

const CYCLES_QUERY = gql`
  query($teamId: ID) {
    cycles(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id
        name
        number
        startsAt
        endsAt
        team { id name }
      }
    }
  }
`;

const CYCLES_QUERY_ALL = gql`
  query {
    cycles {
      nodes {
        id
        name
        number
        startsAt
        endsAt
        team { id name }
      }
    }
  }
`;

const CYCLE_DETAIL_QUERY = gql`
  query($id: String!) {
    cycle(id: $id) {
      id
      name
      number
      description
      startsAt
      endsAt
      completedAt
      progress
      scopeHistory
      completedScopeHistory
      team { id name }
      issues {
        nodes {
          id
          identifier
          title
          state { name type }
          assignee { name }
          priority
        }
      }
    }
  }
`;

const LABELS_QUERY = gql`
  query {
    issueLabels {
      nodes {
        id name color
        team { id name }
      }
    }
  }
`;

const LABELS_BY_TEAM_QUERY = gql`
  query($teamId: ID!) {
    issueLabels(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id name color
      }
    }
  }
`;

const RELATIONS_QUERY = gql`
  query($issueId: String!) {
    issue(id: $issueId) {
      trashed
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title state { name type } }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title state { name type } }
        }
      }
    }
  }
`;

// Write mutations
const CREATE_ISSUE_MUTATION = gql`
  mutation($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id identifier title url
        state { name type }
      }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = gql`
  mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier title url
        state { name type }
      }
    }
  }
`;

// Lightweight read for description edits — the full ISSUE_DETAIL_QUERY is far
// heavier than a read-modify-write of the body needs.
const ISSUE_DESCRIPTION_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      description
      trashed
    }
  }
`;

const CREATE_COMMENT_MUTATION = gql`
  mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id body createdAt
        user { name }
      }
    }
  }
`;

const CREATE_RELATION_MUTATION = gql`
  mutation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation {
        type
        issue { id identifier }
        relatedIssue { id identifier }
      }
    }
  }
`;

const DELETE_RELATION_MUTATION = gql`
  mutation($id: String!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`;

const ISSUE_LABELS_QUERY = gql`
  query($issueId: String!) {
    issue(id: $issueId) {
      id
      trashed
      labels { nodes { id name } }
    }
  }
`;

// LIN-401: a lightweight trashed-only probe for write handlers that don't
// otherwise read the issue (PATCH, comments, relation create). Linear still
// resolves trashed issues by ID, so without this a write would silently mutate
// a soft-deleted ghost.
const TRASHED_GUARD_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      trashed
    }
  }
`;

const UPDATE_ISSUE_LABELS_MUTATION = gql`
  mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier
        labels { nodes { id name } }
      }
    }
  }
`;

/**
 * Creates proxy routes with injected dependencies.
 *
 * @param {Object} options - Dependencies
 * @param {Object} options.proxyTokenStore - Proxy token storage instance
 * @param {Object} options.proxyEventStore - Proxy event storage instance
 * @param {Object} options.foremanStore - Foreman status storage instance
 * @param {Object} options.recapCacheStore - Recap cache storage instance
 * @param {Object} options.briefCacheStore - Brief cache storage instance
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Function} options.getWorkspaceAccessToken - Function to get workspace access token by urlKey (token-only)
 * @param {Function} options.resolveWorkspaceAccess - Function returning { token, reason } for actionable error envelopes (LIN-417)
 * @param {Function} options.getWorkspaceOpenRouterKey - Function to get OpenRouter API key from workspace sessions
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, briefCacheStore, dispatchQueueStore, workspaceFromUrl, getWorkspaceAccessToken, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, workspacePreferencesStore }) {
  const router = Router();

  // =========================================================================
  // Proxy Token Authentication Middleware
  // =========================================================================

  async function authenticateProxyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    if (!token) {
      return res.status(401).json({ error: 'Empty token' });
    }

    try {
      const result = await proxyTokenStore.validateToken(token);
      if (!result) {
        return res.status(401).json({ error: 'Invalid, expired, or consumed token' });
      }

      req.proxyTokenId = result.tokenId;
      req.proxyUrlKey = result.urlKey;
      req.proxyTokenLabel = result.label;
      req.proxyTokenScope = result.scope;
      req.proxyCreatedBy = result.createdBy;
      next();
    } catch (err) {
      console.error('Proxy token validation error:', err.message);
      return res.status(500).json({ error: 'Authentication error' });
    }
  }

  /**
   * Middleware to require write scope.
   */
  function requireWriteScope(req, res, next) {
    if (req.proxyTokenScope !== 'readWrite') {
      return res.status(403).json({ error: 'This endpoint requires a read-write token' });
    }
    next();
  }

  /**
   * Helper to create a Linear GraphQL client for the workspace.
   * Includes an AbortSignal timeout so the proxy fails fast instead of
   * hanging silently (which causes "stream idle timeout" in CLI callers).
   */
  async function getClient(urlKey, { timeoutMs = GRAPHQL_TIMEOUT_MS } = {}) {
    const { token, reason } = await resolveWorkspaceAccess(urlKey);
    if (!token) {
      return { client: null, reason };
    }
    const clientOptions = {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (proxyFetch) clientOptions.fetch = proxyFetch;
    return { client: new GraphQLClient(LINEAR_API_ENDPOINT, clientOptions), reason };
  }

  /**
   * Helper to log a proxy event (fire and forget).
   */
  function logEvent(req, endpoint, status) {
    proxyEventStore.recordEvent({
      urlKey: req.proxyUrlKey,
      tokenId: req.proxyTokenId,
      tokenLabel: req.proxyTokenLabel,
      method: req.method,
      endpoint,
      status
    }).catch(err => console.error('Failed to log proxy event:', err));
  }

  /**
   * Send the structured "workspace not available" 503 envelope (LIN-417).
   * Status stays 503; the body carries code/category/retryable/detail and a
   * safe `context` (public workspace slug only) so an automated caller can
   * decide whether to back off (retryable) or escalate (auth/config).
   * `reason` is threaded unmodified from resolveWorkspaceAccess via both the
   * getClient path and the raw-token path.
   */
  function workspaceUnavailable(req, res, endpoint, reason) {
    logEvent(req, endpoint, 503);
    return res.status(503).json(workspaceUnavailableEnvelope(reason, req.proxyUrlKey));
  }

  /**
   * Extract the upstream HTTP status from a graphql-request error.
   * graphql-request stores Linear's response status in err.response.status
   * and in err.response.errors[].extensions.statusCode.
   *
   * Maps upstream status to appropriate proxy response status:
   *  - 401/403 from Linear → 401 (workspace token invalid/expired)
   *  - 404 from Linear     → 404 (resource not found)
   *  - 429 from Linear     → 429 (rate limited)
   *  - anything else       → 500
   */
  function graphqlErrorStatus(err) {
    // AbortSignal.timeout() raises a TimeoutError (name === 'TimeoutError')
    // and manual AbortController.abort() raises AbortError.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 504;
    const status = err.response?.status
      || err.response?.errors?.[0]?.extensions?.statusCode;
    if (status === 401 || status === 403) return 401;
    if (status === 404) return 404;
    if (status === 429) return 429;
    return 500;
  }

  /**
   * Extract a human-readable error message from a GraphQL error.
   *
   * graphql-request splits errors into two buckets:
   *  - err.response.errors[].message  → originated from Linear's GraphQL
   *    response. These describe resource state or API misuse and are safe
   *    to pass through — callers (especially autonomous agents) need them
   *    to self-diagnose.
   *  - err.message                    → network / fetch / parse failure,
   *    potentially containing internal stack traces or proxy-level details.
   *    Log server-side and return a generic message to the caller.
   */
  function graphqlErrorDetail(err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'Linear API request timed out — the response may be too large or Linear is slow. Try a more specific query.';
    }

    const gqlMessage = err.response?.errors?.[0]?.message;
    if (gqlMessage) {
      const status = err.response?.status || err.response?.errors?.[0]?.extensions?.statusCode;
      if (status === 401 || status === 403) {
        console.error(`Linear auth error (HTTP ${status}): ${gqlMessage}`);
      }
      return gqlMessage;
    }

    console.error('GraphQL error detail (suppressed from response):', err.message || 'Unknown error');
    return 'Linear API request failed';
  }

  /**
   * Guard a Linear write mutation's result before reporting success.
   *
   * Linear's *Create/*Update/*Delete payloads carry a `success` boolean. A
   * falsy one (or a missing payload) must never ride on a 2xx — autonomous
   * agents need an authoritative signal, and a misleading success is exactly
   * what drives a confused retry (LIN-399). On rejection this sends a 502 and
   * returns true so the caller can `return` early.
   *
   * @returns {boolean} true if a failure response was sent
   */
  function writeRejected(req, res, endpoint, payload, errorMessage) {
    if (payload && payload.success === true) return false;
    logEvent(req, endpoint, 502);
    res.status(502).json({ error: errorMessage, detail: payload || null });
    return true;
  }

  // =========================================================================
  // User-Facing API (Session Auth) - Token Management
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/proxy/tokens
   * Create a new proxy token.
   */
  router.post('/workspace/:urlKey/api/proxy/tokens', proxyTokenCreationLimiter, workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const { label, scope, singleUse } = req.body || {};

      if (label && label.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `label exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      if (scope && !['read', 'readWrite'].includes(scope)) {
        return res.status(400).json({ error: 'scope must be "read" or "readWrite"' });
      }

      const result = await proxyTokenStore.createToken(workspace.urlKey, {
        label: label || 'default',
        scope: scope || 'read',
        singleUse: singleUse === true || singleUse === 'true',
        createdBy: req.session?.linearUserId || null
      });

      res.status(201).json({
        success: true,
        tokenId: result.tokenId,
        token: result.token,
        label: result.label,
        scope: result.scope,
        singleUse: result.singleUse,
        message: 'Token created. Save this token now - it cannot be retrieved later.'
      });
    } catch (err) {
      console.error('Create proxy token error:', err.message);
      res.status(500).json({ error: 'Failed to create token' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/tokens
   * List all proxy tokens for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/tokens', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const tokens = await proxyTokenStore.listTokens(workspace.urlKey);
      res.json({ tokens });
    } catch (err) {
      console.error('List proxy tokens error:', err.message);
      res.status(500).json({ error: 'Failed to list tokens' });
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId
   * Revoke a proxy token.
   */
  router.delete('/workspace/:urlKey/api/proxy/tokens/:tokenId', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { tokenId } = req.params;

    if (!UUID_REGEX.test(tokenId)) {
      return res.status(400).json({ error: 'Invalid token ID format' });
    }

    try {
      const revoked = await proxyTokenStore.revokeToken(workspace.urlKey, tokenId);
      if (!revoked) {
        return res.status(404).json({ error: 'Token not found' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Revoke proxy token error:', err.message);
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/events
   * List recent proxy events for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/events', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100) : 50;
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const result = await proxyEventStore.listEvents(workspace.urlKey, { limit, offset });
      res.json(result);
    } catch (err) {
      console.error('List proxy events error:', err.message);
      res.status(500).json({ error: 'Failed to list events' });
    }
  });

  // =========================================================================
  // Consumer API - Agent Instructions (llms.txt)
  // =========================================================================

  /**
   * GET /api/proxy/instructions
   * Returns agent-readable instructions for using the proxy API.
   * Authenticated so token is validated and base URL is known.
   */
  router.get('/api/proxy/instructions', authenticateProxyToken, (req, res) => {
    const scope = req.proxyTokenScope;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    logEvent(req, '/api/proxy/instructions', 200);

    const readEndpoints = `
## Read Endpoints

GET ${baseUrl}/api/proxy/me
  → Current authenticated user
  → { "id": "...", "name": "Jane Doe", "email": "jane@example.com" }

GET ${baseUrl}/api/proxy/teams
  → List all teams
  → { "teams": [{ "id": "...", "name": "Engineering", "key": "ENG" }] }

GET ${baseUrl}/api/proxy/projects
  → List active projects
  → { "projects": [{ "id": "...", "name": "...", "url": "https://linear.app/..." }] }

GET ${baseUrl}/api/proxy/issues?teamId={teamId}&limit={n}
  → List issues (optionally filter by team, default limit 50, max 250)
  → { "issues": [{ "id": "...", "identifier": "LIN-1", "title": "...",
                   "state": { "name": "In Progress", "type": "started" },
                   "labels": { "nodes": [{ "id": "...", "name": "bug", "color": "#f00" }] },
                   "cycle": { "id": "...", "number": 12 } }] }
  → Note: labels arrive as {nodes: [...]} (Linear GraphQL shape).

GET ${baseUrl}/api/proxy/issues/{issueId}
  → Full issue detail; issueId: UUID or identifier like "LIN-123"
  → {
      "id": "...", "identifier": "LIN-123", "title": "...", "description": "...",
      "state": { "name": "In Progress", "type": "started" },
      "trashed": false,
      "labels":   { "nodes": [{ "name": "bug" }] },
      "children": { "nodes": [{ "id": "...", "identifier": "LIN-124", "title": "..." }] },
      "parent":   { "id": "...", "identifier": "LIN-100", "title": "..." },
      "comments": { "nodes": [{ "id": "...", "body": "...", "createdAt": "..." }] }
    }
  → Note: labels / children / comments use Linear's {nodes: [...]} wrapper.
  → TRASHED ISSUES: Linear soft-deletes (trash for ~30 days). A deleted issue
    vanishes from every list/search/child collection but STILL resolves by ID,
    carrying its stale pre-deletion state. When that happens this endpoint sets
    "trashed": true AND overrides the reported state to
    { "name": "Trashed", "type": "canceled" } so you cannot mistake a deleted
    ghost for live work. Key off state.type ("canceled" ⇒ terminal, do not act)
    and read "trashed" to tell a deleted issue from a user-canceled one. The
    foreman endpoints (recommend/recap/brief/prompt) refuse a trashed target
    with 404; the write endpoints refuse with 409.

GET ${baseUrl}/api/proxy/search?q={query}
  → Search issues by text (max 50 results)
  → { "issues": [ /* same shape as /issues, including parent field; children not included — call /issue/{id} for full hierarchy */ ] }

GET ${baseUrl}/api/proxy/states/{teamId}
  → Workflow states for a team
  → { "states": [{ "id": "...", "name": "In Progress", "type": "started", "position": 1 }] }

GET ${baseUrl}/api/proxy/labels?teamId={teamId}
  → Labels (id, name, color); optional team filter
  → { "labels": [{ "id": "...", "name": "bug", "color": "#f00" }] }

GET ${baseUrl}/api/proxy/cycles?teamId={teamId}
  → Cycles (optional team filter)
  → { "cycles": [{ "id": "...", "number": 12, "startsAt": "...", "endsAt": "..." }] }

GET ${baseUrl}/api/proxy/cycle/{cycleId}
  → Cycle detail with issues, progress, and scope history

GET ${baseUrl}/api/proxy/relations/{issueId}
  → Issue relations (blocks, blocked-by, related, duplicate)
  → { "trashed": false,
      "relations":        { "nodes": [{ "id": "...", "type": "blocks", "relatedIssue": { "id": "...", "identifier": "LIN-9" } }] },
      "inverseRelations": { "nodes": [{ "id": "...", "type": "blocks", "issue": { "id": "...", "identifier": "LIN-7" } }] } }
  → "trashed": true means the issue itself has been soft-deleted (this query has
    no root state to override, so the flag is the only signal). Relations are
    still returned so you can see what a now-deleted issue was related to.
  → Note: relations / inverseRelations use Linear's {nodes: [...]} wrapper,
    same as relations on /issue/{id}. \`relatedIssue\` is the target of an
    outgoing relation; \`issue\` is the source of an inverse (e.g. blocked-by) one.
    Each node's \`id\` is the relation id — pass it to DELETE .../relations/{id}.

## Foreman Endpoints

GET ${baseUrl}/api/proxy/stack?limit={n}
  → Sorted task stack (default 5, max 50). Top-level shape:
  → { "tasks": [...], "total": 98 }
  → Each task has a FLAT Linear-native shape. Expect \`state.name\`, \`parent.identifier\`,
    \`children\` (NOT \`subtasks\`), and \`labels\` as a plain string array:
  → {
      "id": "...",
      "identifier": "LIN-296",
      "title": "...",
      "description": "...",
      "priority": 1,
      "url": "https://linear.app/...",
      "state":    { "name": "In Progress", "type": "started" },
      "labels":   ["milestone-x"],
      "project":  { "name": "Safety & Security" },
      "parent":   { "id": "...", "identifier": "LIN-295", "title": "..." },
      "children": [{ "id": "...", "identifier": "LIN-297", "title": "...", "state": { "type": "unstarted" } }],
      "blocksIds": []
    }
  → \`parent\` and \`project\` are null when absent. \`children\` is [] when there are none.

GET ${baseUrl}/api/proxy/stack?limit={n}&view=digest
  → Compact orientation projection: same sorted stack, but each task drops the full
    \`description\` for a deterministic one-line \`headline\`, and \`children\`/\`blocks\` are
    counts (not arrays). Use this to orient over the whole stack cheaply, then fetch full
    detail (\`/brief/{id}\` or the full \`/stack\`) only for the task you pick.
  → Each line also carries deterministic ranking features (computed in-set, no LLM):
    \`downstreamUnblocks\` (how many tasks this one transitively unblocks),
    \`criticalPathLen\` (longest dependency chain through it), an optional \`heldBy\`
    (off-page blockers that forced this line's position when a small \`limit\` hides
    them), and a compact \`why\` array summarizing why it ranks where it does. The
    ordering itself factors \`downstreamUnblocks\`/\`criticalPathLen\` in (just below
    state, above priority), so the order is explainable, not just opaque.
  → { "tasks": [{ "identifier": "LIN-296", "title": "...", "headline": "...", "state": {...},
      "labels": [...], "priority": 1, "section": "in-progress", "blocks": 0, "children": 2,
      "downstreamUnblocks": 6, "criticalPathLen": 4, "heldBy": ["LIN-412"],
      "why": ["bug", "unblocks 6", "critical path 4", "held by LIN-412"],
      "parent": { "identifier": "LIN-295" }, "url": "..." }], "total": 98, "view": "digest" }

GET ${baseUrl}/api/proxy/recommend/{identifier}
  → AI-generated prompt recommendation (requires OpenRouter on the server; >25s responses
    stream whitespace-keepalive bytes inside a single 200 response, which JSON.parse ignores)
  → { "identifier": "LIN-123", "reasoning": "...", "prompt": "...", "truncated": false, "repo": "owner/name" }
  → Add ?format=md to download the bare prompt as a markdown file instead of JSON
    (Content-Type: text/markdown, Content-Disposition: attachment). Useful when the
    prompt is too large to paste — save it straight to a .md file:
      curl -H "Authorization: Bearer YOUR_TOKEN" "${baseUrl}/api/proxy/recommend/LIN-123?format=md" -o LIN-123-recommend.md
  → Add ?noDescend=1 to recommend the named issue's OWN next step WITHOUT descending into an
    open child. Use it to drive a parent whose work lives in its own description/checklist while
    a child stays open or is separately tracked (otherwise the engine routes into that child).

GET ${baseUrl}/api/proxy/recap/{identifier}
  → Cached AI recap; auto-regenerates when stale. Pass \`?noRefresh=1\` to skip regeneration.
  → { "status": "fresh" | "stale" | "missing",
      "identifier": "LIN-123",
      "recap": { "done": "...", "pending": "...", "deviations": "..." },
      "generatedAt": "2026-04-20T12:00:00Z",
      "model": "..." }

POST ${baseUrl}/api/proxy/recap/{identifier}
  → Force-regenerate the recap and return the fresh result (same shape as GET above).

GET ${baseUrl}/api/proxy/brief/{identifier}
  → Current-state task brief: a distilled, present-tense version of the task
    (Current / Constraints / Open questions / Changelog) for use as starting context.
    Auto-regenerates when stale. Pass \`?noRefresh=1\` to skip regeneration.
  → { "status": "fresh" | "stale" | "missing",
      "identifier": "LIN-123",
      "brief": "## Current\\n...\\n## Constraints\\n...\\n## Open questions\\n...\\n## Changelog\\n...",
      "generatedAt": "2026-04-20T12:00:00Z",
      "model": "..." }
  → \`brief\` is fixed-section Markdown (not structured fields); read it before the
    full description — it supersedes stale wording and folds in comments/subtask state.

POST ${baseUrl}/api/proxy/brief/{identifier}
  → Force-regenerate the brief and return the fresh result (same shape as GET above).

GET ${baseUrl}/api/proxy/foreman/status
  → Recent foreman status entries
  → { "items": [{ "id": "...", "taskIdentifier": "LIN-42", "action": "research",
                   "status": "completed", "summary": "...", "timestamp": "..." }], "total": 7 }

GET ${baseUrl}/api/proxy/foreman/playbook
  → Foreman playbook (plain text, not JSON)

GET ${baseUrl}/api/proxy/autopilot/manual
  → Autopilot operating manual / handbook (plain text, not JSON) — the disposition
    behind the loop. Composed inline into the kickoff; fetch here to re-read a part.`;

    const writeEndpoints = scope === 'readWrite' ? `

## Write Endpoints

Success responses wrap the affected entity (e.g. { "success": true, "issue": {...} }) —
read the documented shape rather than assuming the entity comes back top-level. The
response is authoritative: a 2xx with "success": true means the write landed; a non-2xx
(or "success": false) means it did not. Do NOT blind-retry a create on a lost/empty
response — if you got no clean response, re-read (search or GET the issue) to confirm
before retrying. Identical comment creates are additionally deduped server-side within a
short window: a repeat of the same (issue + body) returns the original comment with
"deduped": true (HTTP 200) instead of minting a duplicate, so a confirming retry is safe.

POST ${baseUrl}/api/proxy/issues
  Body: { "teamId": "...", "title": "...", "description": "...", "projectId": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "..." }
  → Create a new issue; set parentId (UUID) to create as a sub-issue. Returns 201:
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "title": "...", "url": "...", "state": { "name": "Backlog", "type": "backlog" } } }

PATCH ${baseUrl}/api/proxy/issues/{issueId}
  Body: { "title": "...", "description": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "...|null" }
  → Update an existing issue; set cycleId to assign/move to a cycle; set parentId to a UUID to re-parent, or null to promote to top-level
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "title": "...", "url": "...", "state": { "name": "In Progress", "type": "started" } } }
  → Passing "description" here REPLACES the whole body. For anything other than a deliberate full rewrite, prefer the two splice endpoints below — they let you supply only the new content, so you never re-emit (and risk corrupting) the existing body.

POST ${baseUrl}/api/proxy/issues/{issueId}/description/append
  Body: { "block": "..." }
  → Append a block to the END of the description. The existing body is preserved byte-for-byte; "block" is added after a blank line. Use this to add findings, notes, or a new section. Returns the same { "success": true, "issue": {...} } shape as PATCH.

POST ${baseUrl}/api/proxy/issues/{issueId}/description/replace
  Body: { "oldString": "...", "newString": "..." }
  → Replace ONE occurrence of "oldString" with "newString" in the description (surgical edit). Same old_string/new_string semantics as a code editor: quote a span you copied from GET /issue/{id}. Matching is normalised — Linear stores markdown punctuation backslash-escaped (e.g. \\#\\#, \\*\\*), so quoting either the escaped bytes or the rendered text works.
  → Fails LOUD, never a silent no-op: 422 { "code": "NOT_FOUND" } if the span is absent, 422 { "code": "NOT_UNIQUE", "matchCount": N } if it appears more than once (quote a longer, unique span). On NOT_FOUND, re-read the description; to swap many occurrences at once, rewrite the whole body via PATCH instead.
  → Returns { "success": true, "issue": {...} }.

POST ${baseUrl}/api/proxy/issues/{issueId}/comments
  Body: { "body": "..." }
  → Add a comment to an issue. Returns 201:
  → { "success": true, "comment": { "id": "...", "body": "...", "createdAt": "...", "user": { "name": "..." } } }
  → Deduped within a short window: a repeat of the same (issue + body) returns the
    original comment with "deduped": true and HTTP 200 (not 201) — no duplicate is created.

POST ${baseUrl}/api/proxy/issues/{issueId}/relations
  Body: { "type": "blocks|related|duplicate", "relatedIssueId": "..." }
  → Create a relation between issues. Returns 201:
  → { "success": true, "issueRelation": { "type": "blocks", "issue": { "id": "...", "identifier": "LIN-7" }, "relatedIssue": { "id": "...", "identifier": "LIN-9" } } }

DELETE ${baseUrl}/api/proxy/issues/{issueId}/relations/{relationId}
  → Remove a relation. relationId is the relation's own id (the \`id\` field on
    each node from GET /relations/{issueId} or GET /issue/{id}), NOT an issue id.
  → { "success": true }

POST ${baseUrl}/api/proxy/issues/{issueId}/labels
  Body: { "labelId": "..." }
  → Add a label to an issue (idempotent)
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "labels": { "nodes": [{ "id": "...", "name": "bug" }] } } }
  → When the label is already present: { "success": true, "message": "Label already present" }

DELETE ${baseUrl}/api/proxy/issues/{issueId}/labels/{labelId}
  → Remove a label from an issue (idempotent)
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "labels": { "nodes": [...] } } }
  → When the label is not present: { "success": true, "message": "Label not present" }

POST ${baseUrl}/api/proxy/foreman/status
  Body: { "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "...", "dispatchId": "..." }
  → Record a foreman status update (dispatchId optional: pass the dispatch-history item ID from /api/dispatch/take to enable exact loop-reconstruction join). Returns 201:
  → { "success": true }

## Dispatch Endpoints

POST ${baseUrl}/api/proxy/dispatch
  Body: { "prompt": "...", "promptName": "...", "kind": "implementation", "issueId": "...", "issueIdentifier": "LIN-42", "issueTitle": "...", "issueUrl": "...", "target": "cli|web|dash", "repo": "...", "appendProxyContext": true }
  → Queue a prompt for the workspace's dispatch consumer (the runner). Only "prompt" is required; target defaults to "cli". ("local"/Harbour is not available to proxy consumers.)
  → "kind" is a stable task classification (research/plan/implementation/review/etc. — the prompt-template keys, plus "custom"). Optional: when omitted it is derived from "promptName", falling back to "custom". Read it instead of inferring the task type from promptName or the prompt body.
  → By default a proxy-context block is appended to the prompt so the worker inherits Linear access for this workspace (the MCP replacement). Reporting is handled by the runner's Stop hook, not the prompt. Set "appendProxyContext": false to opt out.
  → { "id": "...", "status": "queued", "promptName": "...", "kind": "implementation", "issueIdentifier": "...", "target": "cli", "dispatchedAt": "..." }

POST ${baseUrl}/api/proxy/recommend-and-dispatch
  Body: { "issueIdentifier": "LIN-42", "target": "cli|web|dash", "repo": "...", "appendProxyContext": true, "noDescend": false }
  → Fused verb: runs /recommend and forwards the recommended prompt straight into a dispatch, server-side. "issueIdentifier" is required; target defaults to "cli".
  → The prompt body NEVER returns to you — you only get the task header. This keeps the prompt out of your context (the point of the verb); learn what was chosen from "kind"/"promptName", then watch the item via GET /dispatch/{id}.
  → "kind" is derived from the recommendation's own action signal (falling back to "custom") — no need to read the prompt to classify the task.
  → Set "noDescend": true to dispatch the named issue's OWN next step and NOT descend into an open child (deterministic). Use it to drive a parent whose deliverables live in its own description while a child is out of scope / separately tracked; the dispatched item then references the parent, and "deferredVia" is just [parent].
  → { "id": "...", "status": "queued", "kind": "plan", "promptName": "plan", "issueIdentifier": "...", "target": "cli", "dispatchedAt": "..." }

GET ${baseUrl}/api/proxy/dispatch?issueIdentifier={LIN-42}&status={queued|taken|done|failed|aborted}&limit={n}
  → List your dispatch items (live queue + recent history), newest first. All query params optional. Use this to find an item's id when you only know the issue.
  → { "items": [{ "id": "...", "status": "queued|taken|done|failed|aborted", "kind": "implementation", "issueIdentifier": "...", "feedbackCount": 1, ... }], "total": N }

GET ${baseUrl}/api/proxy/dispatch/{id}
  → Watch a dispatched item: whether it is still queued or has been taken by the runner, plus any feedback posted back. Poll this after dispatching.
  → { "id": "...", "status": "queued|taken|done|failed|aborted", "kind": "implementation", "feedback": [{ "message": "...", "url": "...", "timestamp": "..." }], ... }
  → status is terminal (done/failed/aborted) once the runner posts a "[done]"/"[failed]"/"[aborted]" feedback marker; until then it is queued or taken. Poll until status is terminal.
  → completedAt is the real completion time (timestamp of the terminal marker), null until terminal. resolvedAt is take/archive time (lands seconds after dispatch) — do NOT read it as completion.
  → Feedback is free-form text — read it (e.g. the final recap) for the detail; status gives you the terminal signal without parsing prose.

## Shell Tip

When posting bodies with markdown (backticks, quotes, special chars), use a file to avoid shell escaping issues:
  cat > /tmp/body.json << 'PAYLOAD'
  {"body":"Content with \`backticks\` and 'quotes' here"}
  PAYLOAD
  curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -d @/tmp/body.json URL` : '';

    const text = `# Linear API Proxy

Use this proxy to interact with Linear on behalf of the workspace that issued your token.

## Authentication

All requests require:
  Authorization: Bearer YOUR_TOKEN

Your token scope: ${scope}
${scope === 'read' ? '(Read-only — you can query but not modify data)' : '(Read-write — you can query and modify data)'}

## Example

curl -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/me
${readEndpoints}${writeEndpoints}

## Response Shapes

One convention across every endpoint, so you can branch on the same fields everywhere:

- **Success is the HTTP status.** Any 2xx is success; any non-2xx is failure. There is no
  partial state — a write never returns 2xx with a falsy success flag.
- **Reads** return the data directly: a single resource as the object itself
  (e.g. GET /me, GET /issues/{id}, GET /cycle/{id}), a collection under a named key
  (e.g. { "issues": [...] }, { "teams": [...] }).
- **Writes** return { "success": true, ...} — Linear writes nest the affected entity under a
  named key ({ "success": true, "issue": {...} }); other writes (dispatch, token) carry their
  fields alongside "success": true. A write that does not land is a non-2xx, never a 2xx.
- **Errors** are always { "error": "<message>", "detail"?: "<upstream detail>" } with a non-2xx
  status. "detail" carries the Linear or AI upstream's own message when there is one.

## Error Codes

400 - Validation error (bad/missing field, malformed ID)
401 - Invalid, expired, or consumed token
403 - Endpoint requires read-write token (yours is read-only)
404 - Resource not found (includes a trashed target on the foreman endpoints)
409 - Refusing to modify a trashed (soft-deleted) issue (write endpoints)
429 - Rate limited (max 60 requests/minute)
500 - Internal server error
502 - Upstream write was rejected (the create/update did not land)
503 - Workspace or AI service unavailable

## Notes

- All responses are JSON (except \`/api/proxy/foreman/playbook\`, \`/api/proxy/autopilot/manual\`, and \`/api/proxy/instructions\`, which are plain text).
- Issue IDs can be UUIDs or identifiers (e.g., "LIN-123").
- Dates are ISO 8601 format.
- Rate limit: 60 requests per minute.

## Client Notes

- **Validate Content-Type before parsing.** If the body is empty or
  \`Content-Type\` isn't \`application/json\`, it's almost always transient
  client-side network flakiness, not a proxy error. Safe to retry once for
  reads (GET). For a create (POST issues/comments/relations), do NOT
  blind-retry on an empty/lost response — the write may have already landed.
  Re-read (search or GET the issue) to confirm first. Identical comment
  creates are deduped server-side within a short window, so a confirming
  retry of the same body returns the original (\`"deduped": true\`) rather
  than a duplicate.
- **\`/api/proxy/recommend\` can exceed 25s.** The server emits whitespace
  heartbeats inside a single 200 response to stay inside Heroku's router
  cap. \`JSON.parse\` ignores interior whitespace, so a plain
  \`response.json()\` works — just don't set a client-side timeout below
  ~60s for this endpoint.
- **Status-vs-body on long-running endpoints.** Once a long-running
  response has started streaming keepalive bytes, the HTTP status is
  committed as 200; any error is conveyed in the body as
  \`{ "error": "...", "statusCode": 5xx }\`. Check for an \`error\` key
  before trusting \`200\`.
- **\`/stack\` uses a flat Linear-native shape.** Use \`task.state.name\`,
  \`task.parent?.identifier\`, and \`task.children\` — do NOT expect
  \`state.nodes\`, \`parentIdentifier\`, or \`subtasks\`.
`;

    res.type('text/plain').send(text);
  });

  // =========================================================================
  // Consumer API - Read Endpoints
  // =========================================================================

  /**
   * GET /api/proxy/me
   */
  router.get('/api/proxy/me', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/me', reason);
      }

      const data = await client.request(VIEWER_QUERY);
      logEvent(req, '/api/proxy/me', 200);
      res.json(data.viewer);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/me', status);
      console.error('Proxy /me error:', err.message);
      res.status(status).json({ error: 'Failed to fetch user info', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/teams
   */
  router.get('/api/proxy/teams', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/teams', reason);
      }

      const data = await client.request(TEAMS_QUERY);
      logEvent(req, '/api/proxy/teams', 200);
      res.json({ teams: data.teams?.nodes || [] });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/teams', status);
      console.error('Proxy /teams error:', err.message);
      res.status(status).json({ error: 'Failed to fetch teams', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/projects
   */
  router.get('/api/proxy/projects', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/projects', reason);
      }

      const data = await client.request(PROJECTS_QUERY);
      logEvent(req, '/api/proxy/projects', 200);
      res.json({ projects: data.projects?.nodes || [] });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/projects', status);
      console.error('Proxy /projects error:', err.message);
      res.status(status).json({ error: 'Failed to fetch projects', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/issues
   */
  router.get('/api/proxy/issues', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }

      const teamId = req.query.teamId;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 250);

      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/issues', 400);
        return res.status(400).json({ error: 'Invalid teamId format' });
      }

      const query = teamId ? ISSUES_QUERY : ISSUES_QUERY_ALL;
      const variables = teamId
        ? { first: limit, after: null, teamId }
        : { first: limit, after: null };

      const data = await client.request(query, variables);
      logEvent(req, '/api/proxy/issues', 200);
      const pageInfo = data.issues?.pageInfo || {};
      res.json({
        issues: data.issues?.nodes || [],
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage || false,
          endCursor: pageInfo.endCursor || null
        }
      });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy /issues error:', err.message);
      res.status(status).json({ error: 'Failed to fetch issues', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId
   */
  router.get('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }

      const { issueId } = req.params;

      // Allow UUID or identifier (e.g., "LIN-123")
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const data = await client.request(ISSUE_DETAIL_QUERY, { id: issueId });
      if (!data.issue) {
        logEvent(req, '/api/proxy/issues/:id', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      if (data.issue.comments?.nodes) {
        data.issue.comments.nodes.sort((a, b) => {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
      }

      // LIN-401: a trashed issue still resolves by ID with a stale pre-deletion
      // state. Override it to a terminal Trashed/canceled state + trashed flag so
      // a consumer cannot mistake the ghost for live work.
      applyTrashedSignal(data.issue);

      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(data.issue);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy /issue error:', err.message);
      res.status(status).json({ error: 'Failed to fetch issue', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/search
   */
  router.get('/api/proxy/search', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/search', reason);
      }

      const query = req.query.q;
      if (!query || typeof query !== 'string') {
        logEvent(req, '/api/proxy/search', 400);
        return res.status(400).json({ error: 'q query parameter is required' });
      }

      if (query.length > MAX_SEARCH_LENGTH) {
        logEvent(req, '/api/proxy/search', 400);
        return res.status(400).json({ error: `Search query too long (max ${MAX_SEARCH_LENGTH})` });
      }

      const data = await client.request(SEARCH_QUERY, { query, first: 50 });
      logEvent(req, '/api/proxy/search', 200);
      res.json({ issues: data.searchIssues?.nodes || [] });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/search', status);
      console.error('Proxy /search error:', err.message);
      res.status(status).json({ error: 'Failed to search issues', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/states/:teamId
   */
  router.get('/api/proxy/states/:teamId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/states', reason);
      }

      const { teamId } = req.params;
      if (!UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/states', 400);
        return res.status(400).json({ error: 'Invalid team ID format' });
      }

      const data = await client.request(STATES_QUERY, { teamId });
      const states = (data.workflowStates?.nodes || []).sort((a, b) => a.position - b.position);
      logEvent(req, '/api/proxy/states', 200);
      res.json({ states });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/states', status);
      console.error('Proxy /states error:', err.message);
      res.status(status).json({ error: 'Failed to fetch states', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/labels
   */
  router.get('/api/proxy/labels', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/labels', reason);
      }

      const teamId = req.query.teamId;
      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/labels', 400);
        return res.status(400).json({ error: 'Invalid team ID format' });
      }

      const query = teamId ? LABELS_BY_TEAM_QUERY : LABELS_QUERY;
      const variables = teamId ? { teamId } : {};
      const data = await client.request(query, variables);
      logEvent(req, '/api/proxy/labels', 200);
      res.json({ labels: data.issueLabels?.nodes || [] });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/labels', status);
      console.error('Proxy /labels error:', err.message);
      res.status(status).json({ error: 'Failed to fetch labels', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/cycles
   * List cycles, optionally filtered by team.
   */
  router.get('/api/proxy/cycles', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/cycles', reason);
      }

      const teamId = req.query.teamId;
      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/cycles', 400);
        return res.status(400).json({ error: 'Invalid team ID format' });
      }

      const query = teamId ? CYCLES_QUERY : CYCLES_QUERY_ALL;
      const variables = teamId ? { teamId } : {};
      const data = await client.request(query, variables);
      logEvent(req, '/api/proxy/cycles', 200);
      res.json({ cycles: data.cycles?.nodes || [] });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/cycles', status);
      console.error('Proxy /cycles error:', err.message);
      res.status(status).json({ error: 'Failed to fetch cycles', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/cycle/:cycleId
   * Get cycle detail with issues.
   */
  router.get('/api/proxy/cycle/:cycleId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/cycle', reason);
      }

      const { cycleId } = req.params;
      if (!UUID_REGEX.test(cycleId)) {
        logEvent(req, '/api/proxy/cycle', 400);
        return res.status(400).json({ error: 'Invalid cycle ID format' });
      }

      const data = await client.request(CYCLE_DETAIL_QUERY, { id: cycleId });
      if (!data.cycle) {
        logEvent(req, '/api/proxy/cycle', 404);
        return res.status(404).json({ error: 'Cycle not found' });
      }

      logEvent(req, '/api/proxy/cycle', 200);
      res.json(data.cycle);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/cycle', status);
      console.error('Proxy /cycle error:', err.message);
      res.status(status).json({ error: 'Failed to fetch cycle', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/relations/:issueId
   */
  router.get('/api/proxy/relations/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/relations', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/relations', 400);
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const data = await client.request(RELATIONS_QUERY, { issueId });
      if (!data.issue) {
        logEvent(req, '/api/proxy/relations', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      // LIN-401: this query selects only relations (no root state to override),
      // so a trashed target is signalled by a top-level `trashed: true` flag.
      // The relations themselves are still returned — a consumer may legitimately
      // want to see what a now-deleted issue was related to.
      logEvent(req, '/api/proxy/relations', 200);
      // Wrap in Linear's {nodes:[...]} shape to match /issue and the rest of
      // the raw-read surface (labels/children/comments), so consumers see a
      // single consistent convention across endpoints.
      res.json({
        trashed: isTrashed(data.issue),
        relations: { nodes: data.issue.relations?.nodes || [] },
        inverseRelations: { nodes: data.issue.inverseRelations?.nodes || [] }
      });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/relations', status);
      console.error('Proxy /relations error:', err.message);
      res.status(status).json({ error: 'Failed to fetch relations', detail: graphqlErrorDetail(err) });
    }
  });

  // =========================================================================
  // Consumer API - Write Endpoints
  // =========================================================================

  /**
   * POST /api/proxy/issues
   * Create a new issue.
   */
  router.post('/api/proxy/issues', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }

      const { teamId, title, description, projectId, stateId, assigneeId, priority, parentId, cycleId } = req.body;

      if (!teamId || !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/issues', 400);
        return res.status(400).json({ error: 'Valid teamId is required' });
      }

      if (!title || typeof title !== 'string') {
        logEvent(req, '/api/proxy/issues', 400);
        return res.status(400).json({ error: 'title is required' });
      }

      if (title.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `title exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: 'description exceeds maximum length' });
      }

      if (DANGEROUS_CHARS_REGEX.test(title)) {
        return res.status(400).json({ error: 'title contains invalid characters' });
      }

      if (description && DANGEROUS_CHARS_REGEX.test(description)) {
        return res.status(400).json({ error: 'description contains invalid characters' });
      }

      const input = { teamId, title };
      if (description) input.description = description;
      if (projectId && UUID_REGEX.test(projectId)) input.projectId = projectId;
      if (stateId && UUID_REGEX.test(stateId)) input.stateId = stateId;
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && Number.isInteger(priority) && priority >= 0 && priority <= 4) {
        input.priority = priority;
      }

      const data = await client.request(CREATE_ISSUE_MUTATION, { input });
      if (writeRejected(req, res, '/api/proxy/issues', data.issueCreate, 'Issue was not created')) return;
      logEvent(req, '/api/proxy/issues', 201);
      res.status(201).json(data.issueCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy create issue error:', err.message);
      res.status(status).json({ error: 'Failed to create issue', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * PATCH /api/proxy/issues/:issueId
   * Update an issue.
   */
  /**
   * LIN-401: refuse a write whose target is a trashed (soft-deleted) issue.
   * Returns true (and sends a 409) when the issue is trashed, so the caller can
   * `if (await refuseIfTrashed(...)) return;` before mutating. A missing issue
   * (null) is NOT refused here — the mutation proceeds and Linear's own
   * not-found error maps to the usual status, preserving existing behaviour.
   */
  async function refuseIfTrashed(client, issueId, req, res, endpoint) {
    const data = await client.request(TRASHED_GUARD_QUERY, { id: issueId });
    if (isTrashed(data.issue)) {
      logEvent(req, endpoint, 409);
      res.status(409).json({ error: 'Issue is trashed; refusing to modify a deleted issue' });
      return true;
    }
    return false;
  }

  router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { title, description, stateId, assigneeId, priority, projectId, parentId, cycleId } = req.body;

      if (title && title.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `title exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      if (title && DANGEROUS_CHARS_REGEX.test(title)) {
        return res.status(400).json({ error: 'title contains invalid characters' });
      }

      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: 'description exceeds maximum length' });
      }

      if (description && DANGEROUS_CHARS_REGEX.test(description)) {
        return res.status(400).json({ error: 'description contains invalid characters' });
      }

      const input = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description;
      if (stateId && UUID_REGEX.test(stateId)) input.stateId = stateId;
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (projectId && UUID_REGEX.test(projectId)) input.projectId = projectId;
      if (parentId === null) input.parentId = null;
      else if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && Number.isInteger(priority) && priority >= 0 && priority <= 4) {
        input.priority = priority;
      }

      if (Object.keys(input).length === 0) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      if (await refuseIfTrashed(client, issueId, req, res, '/api/proxy/issues/:id')) return;

      const data = await client.request(UPDATE_ISSUE_MUTATION, { id: issueId, input });
      if (writeRejected(req, res, '/api/proxy/issues/:id', data.issueUpdate, 'Issue was not updated')) return;
      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy update issue error:', err.message);
      res.status(status).json({ error: 'Failed to update issue', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * Shared read-modify-write for the description edit endpoints. Reads the live
   * body, lets `merge(current)` produce the new body, validates it, and writes.
   * The agent never re-emits the original, so the LIN-398 corruption class cannot
   * recur. `merge` may throw DescriptionEditError for a loud 422.
   */
  async function applyDescriptionEdit(req, res, endpoint, merge) {
    const { client, reason } = await getClient(req.proxyUrlKey);
    if (!client) {
      return workspaceUnavailable(req, res, endpoint, reason);
    }

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }

    let newDescription;
    try {
      const data = await client.request(ISSUE_DESCRIPTION_QUERY, { id: issueId });
      if (!data.issue) {
        logEvent(req, endpoint, 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (isTrashed(data.issue)) {
        logEvent(req, endpoint, 409);
        return res.status(409).json({ error: 'Issue is trashed; refusing to modify a deleted issue' });
      }
      newDescription = merge(data.issue.description || '');
    } catch (err) {
      if (err instanceof DescriptionEditError) {
        logEvent(req, endpoint, 422);
        return res.status(422).json({ error: err.message, code: err.code, matchCount: err.matchCount });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (read) error:', err.message);
      return res.status(status).json({ error: 'Failed to read issue description', detail: graphqlErrorDetail(err) });
    }

    if (newDescription.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'resulting description exceeds maximum length' });
    }
    if (DANGEROUS_CHARS_REGEX.test(newDescription)) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'resulting description contains invalid characters' });
    }

    try {
      const data = await client.request(UPDATE_ISSUE_MUTATION, { id: issueId, input: { description: newDescription } });
      logEvent(req, endpoint, 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (write) error:', err.message);
      res.status(status).json({ error: 'Failed to update description', detail: graphqlErrorDetail(err) });
    }
  }

  /**
   * POST /api/proxy/issues/:issueId/description/append
   * Append a block to the end of an issue's description. The agent supplies only
   * the new content; the existing body is preserved byte-for-byte.
   */
  router.post('/api/proxy/issues/:issueId/description/append', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/append';
    const { block } = req.body;
    if (!block || typeof block !== 'string') {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'block is required' });
    }
    if (block.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'block exceeds maximum length' });
    }
    if (DANGEROUS_CHARS_REGEX.test(block)) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'block contains invalid characters' });
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => appendBlock(current, block));
  });

  /**
   * POST /api/proxy/issues/:issueId/description/replace
   * Replace a single, uniquely-matched span in an issue's description. Matching is
   * normalised (backslash-unescaped) on both sides and fails loud (422) when the
   * span is missing or ambiguous. Full rewrites stay on PATCH .../issues/:id.
   */
  router.post('/api/proxy/issues/:issueId/description/replace', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/replace';
    const { oldString, newString } = req.body;
    if (!oldString || typeof oldString !== 'string') {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'oldString is required' });
    }
    if (typeof newString !== 'string') {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'newString is required' });
    }
    if (newString.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'newString exceeds maximum length' });
    }
    if (DANGEROUS_CHARS_REGEX.test(newString)) {
      logEvent(req, endpoint, 400);
      return res.status(400).json({ error: 'newString contains invalid characters' });
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => replaceInDescription(current, oldString, newString));
  });

  /**
   * POST /api/proxy/issues/:issueId/comments
   * Add a comment to an issue.
   */
  router.post('/api/proxy/issues/:issueId/comments', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { body } = req.body;
      if (!body || typeof body !== 'string') {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return res.status(400).json({ error: 'body is required' });
      }

      if (body.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({ error: `body exceeds maximum length of ${MAX_COMMENT_LENGTH}` });
      }

      if (DANGEROUS_CHARS_REGEX.test(body)) {
        return res.status(400).json({ error: 'body contains invalid characters' });
      }

      if (await refuseIfTrashed(client, issueId, req, res, '/api/proxy/issues/comments')) return;

      // Deterministic dedupe (LIN-399): if an identical comment was just
      // created for this issue, return that one instead of minting a duplicate.
      const key = dedupeKey(req.proxyUrlKey, issueId, body);
      const prior = commentDedupe.get(key);
      if (prior) {
        logEvent(req, '/api/proxy/issues/comments', 200);
        return res.status(200).json({ ...prior, deduped: true });
      }

      const data = await client.request(CREATE_COMMENT_MUTATION, {
        input: { issueId, body }
      });

      // Surface a clear failure instead of a misleading 201 when Linear
      // reports the write did not land.
      if (writeRejected(req, res, '/api/proxy/issues/comments', data.commentCreate, 'Comment was not created')) return;

      commentDedupe.set(key, data.commentCreate);
      logEvent(req, '/api/proxy/issues/comments', 201);
      res.status(201).json(data.commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy create comment error:', err.message);
      res.status(status).json({ error: 'Failed to create comment', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/relations
   * Create a relation between issues.
   */
  router.post('/api/proxy/issues/:issueId/relations', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { type, relatedIssueId } = req.body;
      const validTypes = ['blocks', 'blocked-by', 'duplicate', 'related'];
      if (!type || !validTypes.includes(type)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      }

      if (!relatedIssueId || !isValidIssueId(relatedIssueId)) {
        return res.status(400).json({ error: 'Valid relatedIssueId is required' });
      }

      if (await refuseIfTrashed(client, issueId, req, res, '/api/proxy/issues/relations')) return;

      // Handle blocked-by as inverse blocks
      let input;
      if (type === 'blocked-by') {
        input = { issueId: relatedIssueId, relatedIssueId: issueId, type: 'blocks' };
      } else {
        input = { issueId, relatedIssueId, type };
      }

      const data = await client.request(CREATE_RELATION_MUTATION, { input });
      if (writeRejected(req, res, '/api/proxy/issues/relations', data.issueRelationCreate, 'Relation was not created')) return;
      logEvent(req, '/api/proxy/issues/relations', 201);
      res.status(201).json(data.issueRelationCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy create relation error:', err.message);
      res.status(status).json({ error: 'Failed to create relation', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/relations/:relationId
   * Remove a relation. The relationId is the IssueRelation's own id, which is
   * exposed on the nodes returned by GET /relations/:issueId and GET /issue/:id.
   *
   * Note: :issueId is accepted for a consistent URL shape with the other
   * /issue/:issueId/... endpoints, but the delete is keyed solely on relationId
   * (Linear deletes by relation id, not by the issue pair). It is validated for
   * format but not otherwise used.
   */
  router.delete('/api/proxy/issues/:issueId/relations/:relationId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }

      const { issueId, relationId } = req.params;
      if (!isValidIssueId(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }
      if (!UUID_REGEX.test(relationId)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return res.status(400).json({ error: 'Invalid relation ID format' });
      }

      const data = await client.request(DELETE_RELATION_MUTATION, { id: relationId });
      if (writeRejected(req, res, '/api/proxy/issues/relations', data.issueRelationDelete, 'Relation was not removed')) return;
      logEvent(req, '/api/proxy/issues/relations', 200);
      res.json(data.issueRelationDelete);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy delete relation error:', err.message);
      res.status(status).json({ error: 'Failed to delete relation', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/labels
   * Add a label to an issue.
   *
   * Note: This performs a Read-Modify-Write cycle (fetch current labels, then
   * update with the new set) because Linear's GraphQL API requires sending the
   * full label ID array. Concurrent label modifications (e.g. from the Linear
   * UI and this proxy simultaneously) could overwrite each other. This is an
   * inherent limitation of Linear's label API — there is no atomic add/remove.
   */
  router.post('/api/proxy/issues/:issueId/labels', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { labelId } = req.body;
      if (!labelId || !UUID_REGEX.test(labelId)) {
        logEvent(req, '/api/proxy/issues/labels', 400);
        return res.status(400).json({ error: 'Valid labelId is required' });
      }

      // Fetch current labels
      const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId });
      if (!issueData.issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (isTrashed(issueData.issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return res.status(409).json({ error: 'Issue is trashed; refusing to modify a deleted issue' });
      }

      const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id);
      if (currentLabelIds.includes(labelId)) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label already present' });
      }

      const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
        id: issueId,
        input: { labelIds: [...currentLabelIds, labelId] }
      });
      if (writeRejected(req, res, '/api/proxy/issues/labels', data.issueUpdate, 'Label was not added')) return;
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy add label error:', err.message);
      res.status(status).json({ error: 'Failed to add label', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/labels/:labelId
   * Remove a label from an issue.
   *
   * Note: Same Read-Modify-Write race condition caveat as the add-label
   * endpoint above. See POST /labels comment for details.
   */
  router.delete('/api/proxy/issues/:issueId/labels/:labelId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { client, reason } = await getClient(req.proxyUrlKey);
      if (!client) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }

      const { issueId, labelId } = req.params;
      if (!isValidIssueId(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }
      if (!UUID_REGEX.test(labelId)) {
        return res.status(400).json({ error: 'Invalid label ID format' });
      }

      // Fetch current labels
      const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId });
      if (!issueData.issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (isTrashed(issueData.issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return res.status(409).json({ error: 'Issue is trashed; refusing to modify a deleted issue' });
      }

      const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id);
      const filtered = currentLabelIds.filter(id => id !== labelId);

      if (filtered.length === currentLabelIds.length) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label not present' });
      }

      const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
        id: issueId,
        input: { labelIds: filtered }
      });
      if (writeRejected(req, res, '/api/proxy/issues/labels', data.issueUpdate, 'Label was not removed')) return;
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy remove label error:', err.message);
      res.status(status).json({ error: 'Failed to remove label', detail: graphqlErrorDetail(err) });
    }
  });

  // =========================================================================
  // Consumer API - Foreman Endpoints
  // =========================================================================

  /**
   * GET /api/proxy/stack
   * Returns the sorted task stack for foreman use.
   * Uses the same sort pipeline as the swipe view.
   */
  router.get('/api/proxy/stack', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/stack', reason);
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 50);

      // Fetch projects and issues (use mock data in test mode)
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      let projects, issues;
      if (isTestMode) {
        const mockData = await getTestMockData();
        projects = [...mockData.projects];
        issues = [...mockData.issues];
      } else {
        ({ projects, issues } = await withTimeout(fetchProjects(accessToken), MULTI_REQUEST_TIMEOUT_MS));
      }

      // Build tree structure
      const forest = buildForest(issues);
      if (forest.has(NO_PROJECT_ID)) {
        projects.push({
          id: NO_PROJECT_ID,
          name: 'No Project',
          content: null,
          url: null,
          sortOrder: Number.MAX_SAFE_INTEGER
        });
      }

      const inProgressTrees = buildInProgressForest(issues, projects);
      const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);
      const trees = projects
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(project => {
          const { roots } = forest.get(project.id) || { roots: [] };
          const { incomplete } = partitionCompleted(roots);
          return { project, incomplete };
        });

      // Flatten and deduplicate (same as swipe view)
      const projectIssues = flattenTrees(trees, 'project');
      const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
      const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

      const seenIds = new Set();
      const allIssues = [];
      for (const issue of inProgressIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }
      for (const issue of projectIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }
      for (const issue of recentIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }

      // Build parent/child relationships (kept flat internally; transformed at
      // the response boundary into Linear-native shape).
      const cardById = new Map(allIssues.map(i => [i.id, i]));
      const childrenMap = new Map();
      for (const issue of allIssues) {
        if (issue.parentId && cardById.has(issue.parentId)) {
          const parent = cardById.get(issue.parentId);
          issue.parentIdentifier = parent.identifier;
          issue.parentTitle = parent.title;
          if (!childrenMap.has(issue.parentId)) childrenMap.set(issue.parentId, []);
          childrenMap.get(issue.parentId).push({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            state: { type: issue.stateType }
          });
        }
      }
      for (const [parentId, children] of childrenMap) {
        const parent = cardById.get(parentId);
        if (parent) parent.children = children;
      }

      // Compute transitive graph features (LIN-391) BEFORE the sort — they are
      // sort-keys (downstreamUnblocks/criticalPathLen) and also stamped onto the
      // digest line. Same ordering as the swipe view (renderSwipePage), which
      // runs the identical pipeline.
      computeGraphFeatures(allIssues);
      sortIssuesForSwipe(allIssues);
      const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

      // Trim to limit and transform to Linear-native shape. Agents assume
      // `state.name`, `parent.identifier`, `children` (not `subtasks`), so we
      // expose that shape uniformly here. Internal flat fields remain
      // available only to this handler.
      //
      // `?view=digest` returns a compact, orientation-grade projection: it drops
      // the (potentially large) full `description` in favour of a deterministic
      // one-line `headline`, and replaces the `children`/`blocksIds` arrays with
      // counts. This lets a light orchestrator (Autopilot) get a sense of the
      // whole stack at a glance without holding every task's full body in
      // context — then drill into one task's detail (full description / `/brief`)
      // only for the item it picks. See docs/autopilot-kickoff.md.
      const sliced = sortedIssues.slice(0, limit);
      // Off-page blockers (LIN-391): direct blockers pushed beyond the slice that
      // still shaped a visible line's position. Derived from final post-cluster
      // positions; no transitive closure stored.
      const offPageBlockers = computeOffPageBlockers(sortedIssues, limit);
      const isDigest = req.query.view === 'digest';
      const tasks = isDigest
        ? sliced.map(issue => {
            const heldBy = offPageBlockers.get(issue.id) || [];
            return {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              headline: toStackHeadline(issue.description),
              priority: issue.priority,
              state: { name: issue.stateName, type: issue.stateType },
              labels: issue.labels || [],
              section: issue.section || null,
              assignee: issue.assignee || null,
              project: issue.projectName ? { name: issue.projectName } : null,
              parent: issue.parentId
                ? { identifier: issue.parentIdentifier || null }
                : null,
              blocks: (issue.blocksIds || []).length,
              children: (issue.children || []).length,
              // Explainability (LIN-391): transitive features + compact `why`.
              downstreamUnblocks: issue.downstreamUnblocks || 0,
              criticalPathLen: issue.criticalPathLen || 0,
              ...(heldBy.length > 0 ? { heldBy } : {}),
              why: buildWhy(issue, heldBy),
              url: issue.url
            };
          })
        : sliced.map(issue => {
            const heldBy = offPageBlockers.get(issue.id) || [];
            return {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              priority: issue.priority,
              url: issue.url,
              state: { name: issue.stateName, type: issue.stateType },
              labels: issue.labels || [],
              project: issue.projectName ? { name: issue.projectName } : null,
              parent: issue.parentId
                ? { id: issue.parentId, identifier: issue.parentIdentifier || null, title: issue.parentTitle || null }
                : null,
              children: issue.children || [],
              blocksIds: issue.blocksIds || [],
              // Same computed scalars as digest, for full/digest consistency (LIN-391).
              downstreamUnblocks: issue.downstreamUnblocks || 0,
              criticalPathLen: issue.criticalPathLen || 0,
              ...(heldBy.length > 0 ? { heldBy } : {})
            };
          });

      logEvent(req, '/api/proxy/stack', 200);
      res.json({ tasks, total: sortedIssues.length, view: isDigest ? 'digest' : 'full' });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/stack', status);
      console.error('Proxy /stack error:', err.message);
      res.status(status).json({ error: 'Failed to fetch task stack', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/prompt/:identifier/:templateKey
   * Returns the generated prompt for a specific issue and template.
   */
  router.get('/api/proxy/prompt/:identifier/:templateKey', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/prompt', reason);
      }

      const { identifier, templateKey } = req.params;

      // Validate identifier format (UUID or LIN-123 pattern)
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/prompt', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      // Validate template key
      if (!hasPrompt(templateKey)) {
        logEvent(req, '/api/proxy/prompt', 404);
        return res.status(404).json({ error: `No prompt template for key: ${templateKey}` });
      }

      // Fetch issue context (use mock data in test mode)
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      let issue, parent, siblings, project, children, comments;
      if (isTestMode) {
        const mockData = await getTestMockData();
        const mockIssue = mockData.issues.find(i =>
          i.id === identifier || i.identifier === identifier
        );
        if (!mockIssue) {
          logEvent(req, '/api/proxy/prompt', 404);
          return res.status(404).json({ error: 'Issue not found' });
        }
        const mockProject = mockData.projects.find(p => p.id === mockIssue.project?.id);
        issue = {
          id: mockIssue.id,
          identifier: mockIssue.identifier || 'TEST-1',
          title: mockIssue.title,
          description: mockIssue.description || '',
          state: mockIssue.state || { name: 'Todo', type: 'unstarted' },
          labels: (mockIssue.labels?.nodes || []).map(l => l.name),
          url: mockIssue.url || ''
        };
        parent = null;
        siblings = [];
        project = mockProject ? { name: mockProject.name, description: mockProject.content } : null;
        children = mockData.issues.filter(i => i.parent?.id === mockIssue.id).map(i => ({
          id: i.id, identifier: i.identifier, title: i.title, state: i.state
        }));
        comments = [];
      } else {
        ({ issue, parent, siblings, project, children, comments } = await withTimeout(fetchIssueContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS));
      }

      // Generate the prompt
      const result = generatePrompt(templateKey, issue, { parent, siblings, project, children, comments }, {});

      if (!result) {
        logEvent(req, '/api/proxy/prompt', 500);
        return res.status(500).json({ error: 'Failed to generate prompt' });
      }

      logEvent(req, '/api/proxy/prompt', 200);
      res.json({
        identifier: issue.identifier,
        templateKey,
        promptName: result.name,
        prompt: result.prompt,
        repo: parseRepoFromDescription(project?.description)
      });
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/prompt', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/prompt', status);
      console.error('Proxy /prompt error:', err.message);
      res.status(status).json({ error: 'Failed to generate prompt', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * Shared, test-mode-aware recommendation compute used by both GET /recommend
   * and the fused POST /recommend-and-dispatch verb. Returns
   * { identifier, reasoning, prompt, truncated, repo, recommendedAction }.
   *
   * Does NOT manage keepalive — the calling handler arms it around this call
   * (the test-mode path resolves immediately, so arming is harmless there).
   * May throw (issue-not-found / OpenRouter / graphql); callers map the error
   * with recommendErrorResponse(). `sessionApiKey` may be passed in to avoid a
   * second key lookup when the caller already resolved it for its precheck.
   */
  async function computeRecommendation({ urlKey, createdBy, identifier, accessToken, isTestMode, sessionApiKey, deadline, noDescend = false }) {
    if (sessionApiKey === undefined) {
      sessionApiKey = await getWorkspaceOpenRouterKey(urlKey, createdBy);
    }

    if (isTestMode) {
      const mockData = await getTestMockData();
      // Find mock issue by UUID or identifier
      const mockIssue = mockData.issues.find(i =>
        i.id === identifier || i.identifier === identifier
      );
      if (!mockIssue) {
        throw new Error('Issue not found');
      }

      const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
      const issueIdentifier = mockIssue.identifier || mockIssue.url?.split('/').pop() || 'ISSUE';

      let reasoning = 'Analyzing the task to determine the best approach.';
      let goal = 'Understand what this task involves and plan the next steps.';
      // recommendedAction mirrors the live meta-prompt's `→ **<name>**` signal so
      // the fused verb's `kind` plumbing is exercised in E2E: bug→bug,
      // blocked→blocked, started→implement, else plan.
      let recommendedAction = 'plan';

      // A node with an incomplete child defers to it (LIN-327), so the recommend
      // recursion (resolveRecommendation) is exercised end-to-end in E2E: a parent
      // resolves to its actionable descendant, not a parent-framed prompt. Labels
      // (bug/blocked) still take precedence so the existing routes stay covered.
      const mockChildren = mockData.issues.filter(i => i.parent?.id === mockIssue.id);
      const focusChild = mockChildren.find(c => c.state?.type !== 'completed' && c.state?.type !== 'canceled');

      if (labels.includes('bug')) {
        reasoning = 'This is a bug. Investigating systematically will help find the root cause.';
        goal = 'Identify reproduction steps, hypothesize causes, and suggest a fix.';
        recommendedAction = 'bug';
      } else if (labels.includes('blocked')) {
        reasoning = 'This task is blocked. Analyzing the blocker to find a way forward.';
        goal = 'Identify the blocker and recommend how to unblock.';
        recommendedAction = 'blocked';
      } else if (!noDescend && focusChild) {
        // No prompt body on defer — the cost contract (mirrors getRecommendation).
        // noDescend (LIN-365) skips this container branch so the parent's own work is
        // recommended even with an open child (mirrors the live focusedChild suppression).
        return {
          identifier: issueIdentifier,
          reasoning: `${issueIdentifier} is a container; the actionable work lives in ${focusChild.identifier}.`,
          prompt: null,
          truncated: false,
          repo: parseRepoFromDescription(mockData.projects.find(p => p.id === mockIssue.project?.id)?.content),
          recommendedAction: 'defer',
          deferTo: focusChild.identifier
        };
      } else if (mockIssue.state?.type === 'started') {
        reasoning = 'Task is in progress. Checking what work remains.';
        goal = 'Continue implementation and update progress.';
        recommendedAction = 'implement';
      }

      const mockProject = mockData.projects.find(p => p.id === mockIssue.project?.id);

      return {
        identifier: issueIdentifier,
        reasoning,
        prompt: `Help me with task ${issueIdentifier}\n\n## Context\n\n**Status:** ${mockIssue.state?.name || 'Unknown'}\n${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}\n\n## Goal\n\n${goal}`,
        truncated: false,
        repo: parseRepoFromDescription(mockProject?.content),
        recommendedAction,
        deferTo: null
      };
    }

    // Live path. Fetch issue context with two-tier support for parent tasks,
    // then the AI recommendation. Uses a longer timeout since this makes a
    // Linear API call + an OpenRouter LLM call.
    const context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal, noDescend }), CONTEXT_FETCH_TIMEOUT_MS);
    const { issue, parent, siblings, project, children, comments, focusedChild } = context;

    const selectedModel = await resolveWorkspaceModel({ urlKey, workspacePreferencesStore });
    // Cancel the in-flight LLM call when its deadline trips instead of racing and
    // leaving it running orphaned (fetchWithTimeout vs withTimeout, LIN-346 surface 5).
    // getRecommendation now honors options.signal (gap #2). The per-hop deadline guard
    // (gap #3) bounds each hop by the REMAINING shared descent budget so a stalled hop
    // can't overrun it — released on settle so the timer can't leak across hops.
    const hop = armHopSignal({ deadline });
    let recommendation;
    try {
      recommendation = await fetchWithTimeout(
        (signal) => getRecommendation(
          issue,
          { parent, siblings, project, children, comments, focusedChild },
          {
            apiKey: sessionApiKey,
            model: selectedModel,
            featureFlags: {},
            signal: AbortSignal.any([signal, hop.signal]),
            callMeta: { urlKey, feature: 'recommend', issueIdentifier: issue.identifier }
          }
        ),
        LLM_TIMEOUT_MS
      );
    } finally {
      hop.release();
    }

    return {
      identifier: issue.identifier,
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      repo: parseRepoFromDescription(project?.description),
      recommendedAction: recommendation.recommendedAction,
      // deferTo (LIN-327) drives the recommend recursion (resolveRecommendation).
      deferTo: recommendation.deferTo || null,
      // This node's own state + its children (with state) let the resolver guard
      // the descent against terminal nodes (LIN-353) without an extra fetch — both
      // are already in hand from the context fetched for this hop.
      state: issue.state,
      children
    };
  }

  /**
   * Map a recommendation error to { status, body }. Shared by GET /recommend
   * and POST /recommend-and-dispatch so both surfaces report issue-not-found /
   * OpenRouter / graphql failures identically.
   */
  function recommendErrorResponse(err) {
    if (err.message?.includes('not found')) {
      return { status: 404, body: { error: 'Issue not found' } };
    }
    if (err.message?.includes('OpenRouter')) {
      return { status: 503, body: { error: 'AI service temporarily unavailable', detail: err.message } };
    }
    console.error('Proxy /recommend error:', err.message);
    return { status: graphqlErrorStatus(err), body: { error: 'Failed to get recommendation', detail: graphqlErrorDetail(err) } };
  }

  /**
   * GET /api/proxy/recommend/:identifier
   * Returns an AI-generated prompt recommendation for an issue.
   * Uses the token creator's OAuth key (if available) or server-side OPENROUTER_API_KEY.
   */
  router.get('/api/proxy/recommend/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend', reason);
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // Resolve OpenRouter API key: token creator's OAuth key or server env var
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Check if AI recommendations are available (skip in test mode)
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/recommend', 503);
        return res.status(503).json({ error: 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      const { identifier } = req.params;

      // Validate identifier format (UUID or LIN-123 pattern)
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recommend', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      // noDescend (LIN-365): recommend the named node's OWN work, never descend into
      // an open child. Deterministic leaf-target lever for parents whose children are
      // out of scope / separately tracked.
      const noDescend = req.query.noDescend === '1' || req.query.noDescend === 'true';

      // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
      // delayed whitespace keepalive so the dyno can keep the connection open
      // while the LLM call completes.
      const keepalive = armKeepalive(res);
      try {
        // Follow any `defer` decisions to a terminal actionable node (LIN-329).
        // A leaf resolves in one hop; a container descends to its real work.
        const recommendDeadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
        const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: identifier,
          deadline: recommendDeadline,
          noDescend,
          computeOne: (id) => computeRecommendation({
            urlKey: req.proxyUrlKey,
            createdBy: req.proxyCreatedBy,
            identifier: id,
            accessToken,
            isTestMode,
            sessionApiKey,
            deadline: recommendDeadline,
            noDescend
          })
        });

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend', 200);
        // ?format=md serves the bare recommended prompt as a downloadable
        // markdown file for external consumers (LIN-316). When the keepalive
        // already flushed JSON headers (>25s runs) we can no longer set the
        // attachment headers, so we just stream the prompt bytes — a curl
        // consumer redirecting to a file still gets the right content.
        if (req.query.format === 'md') {
          if (!keepalive.flushed) {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${buildPromptFilename(rec.identifier, 'recommend')}"`);
          }
          return res.end(rec.prompt || '');
        }
        // recommendedAction + kind are additive (LIN-321); deferredVia + the terminal
        // identifier are additive (LIN-327): existing clients that read
        // identifier/reasoning/prompt/truncated/repo are unaffected.
        keepalive.send(200, {
          identifier: rec.identifier,
          reasoning: rec.reasoning,
          prompt: rec.prompt,
          truncated: rec.truncated,
          repo: rec.repo,
          recommendedAction: rec.recommendedAction,
          kind: deriveDispatchKind(rec.recommendedAction),
          deferredVia,
          deferTruncated,
          deferStopReason
        });
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err);
        logEvent(req, '/api/proxy/recommend', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      const { status, body } = recommendErrorResponse(err);
      logEvent(req, '/api/proxy/recommend', status);
      res.status(status).json(body);
    }
  });

  /**
   * GET /api/proxy/recap/:identifier
   * Returns the AI-generated recap (done/pending/deviations) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   */
  router.get('/api/proxy/recap/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
      if (!recapCacheStore) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'Recap cache not configured' });
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const noRefresh = req.query.noRefresh === '1' || req.query.noRefresh === 'true';
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Regenerate path calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        const cached = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        if (cached && cached.inputHash === inputHash) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 200);
          return keepalive.send(200, {
            status: 'fresh',
            identifier: context.issue?.identifier || identifier,
            recap: cached.recap,
            generatedAt: cached.generatedAt,
            model: cached.model
          });
        }

        if (noRefresh) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 200);
          return keepalive.send(200, {
            status: cached ? 'stale' : 'missing',
            identifier: context.issue?.identifier || identifier,
            generatedAt: cached?.generatedAt,
            model: cached?.model
          });
        }

        if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 503);
          return keepalive.send(503, { error: 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
        }

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore });
        let recap;
        let modelUsed;
        if (isTestMode) {
          recap = buildMockRecapFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateRecap(context.issue, context, { apiKey: sessionApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          recap = result.recap;
          modelUsed = result.model;
        }

        await recapCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          recap,
          model: modelUsed
        });
        const stored = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/recap', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          recap: stored?.recap ?? recap,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err) };
          console.error('Proxy /recap error:', err.message);
        }
        logEvent(req, '/api/proxy/recap', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      logEvent(req, '/api/proxy/recap', 500);
      console.error('Proxy /recap outer error:', err.message);
      res.status(500).json({ error: 'Failed to fetch recap', detail: err.message });
    }
  });

  /**
   * POST /api/proxy/recap/:identifier
   * Force-regenerate the recap and return it.
   */
  router.post('/api/proxy/recap/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
      if (!recapCacheStore) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'Recap cache not configured' });
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore });
        let recap;
        let modelUsed;
        if (isTestMode) {
          recap = buildMockRecapFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateRecap(context.issue, context, { apiKey: sessionApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          recap = result.recap;
          modelUsed = result.model;
        }

        await recapCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          recap,
          model: modelUsed
        });
        const stored = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/recap', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          recap: stored?.recap ?? recap,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err) };
          console.error('Proxy /recap error:', err.message);
        }
        logEvent(req, '/api/proxy/recap', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/recap', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (err.message?.includes('OpenRouter')) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'AI service temporarily unavailable', detail: err.message });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/recap', status);
      console.error('Proxy /recap POST error:', err.message);
      res.status(status).json({ error: 'Failed to generate recap', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/brief/:identifier
   * Returns the current-state task brief (fixed-section Markdown) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   */
  router.get('/api/proxy/brief/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
      if (!briefCacheStore) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'Brief cache not configured' });
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/brief', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const noRefresh = req.query.noRefresh === '1' || req.query.noRefresh === 'true';
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Regenerate path calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/brief', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        const cached = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        if (cached && cached.inputHash === inputHash) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 200);
          return keepalive.send(200, {
            status: 'fresh',
            identifier: context.issue?.identifier || identifier,
            brief: cached.brief,
            generatedAt: cached.generatedAt,
            model: cached.model
          });
        }

        if (noRefresh) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 200);
          return keepalive.send(200, {
            status: cached ? 'stale' : 'missing',
            identifier: context.issue?.identifier || identifier,
            generatedAt: cached?.generatedAt,
            model: cached?.model
          });
        }

        if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 503);
          return keepalive.send(503, { error: 'AI brief is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
        }

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore });
        let brief;
        let modelUsed;
        if (isTestMode) {
          brief = buildMockBriefFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateBrief(context.issue, context, { apiKey: sessionApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          brief = result.brief;
          modelUsed = result.model;
        }

        await briefCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          brief,
          model: modelUsed
        });
        const stored = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/brief', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          brief: stored?.brief ?? brief,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch brief', detail: graphqlErrorDetail(err) };
          console.error('Proxy /brief error:', err.message);
        }
        logEvent(req, '/api/proxy/brief', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      logEvent(req, '/api/proxy/brief', 500);
      console.error('Proxy /brief outer error:', err.message);
      res.status(500).json({ error: 'Failed to fetch brief', detail: err.message });
    }
  });

  /**
   * POST /api/proxy/brief/:identifier
   * Force-regenerate the brief and return it.
   */
  router.post('/api/proxy/brief/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
      if (!briefCacheStore) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'Brief cache not configured' });
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/brief', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'AI brief is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/brief', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore });
        let brief;
        let modelUsed;
        if (isTestMode) {
          brief = buildMockBriefFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateBrief(context.issue, context, { apiKey: sessionApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          brief = result.brief;
          modelUsed = result.model;
        }

        await briefCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          brief,
          model: modelUsed
        });
        const stored = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/brief', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          brief: stored?.brief ?? brief,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to generate brief', detail: graphqlErrorDetail(err) };
          console.error('Proxy /brief error:', err.message);
        }
        logEvent(req, '/api/proxy/brief', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/brief', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (err.message?.includes('OpenRouter')) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'AI service temporarily unavailable', detail: err.message });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/brief', status);
      console.error('Proxy /brief POST error:', err.message);
      res.status(status).json({ error: 'Failed to generate brief', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/foreman/status
   * Record a foreman status update.
   */
  router.post('/api/proxy/foreman/status', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { taskIdentifier, action, status, summary, dispatchId } = req.body;

    if (!taskIdentifier || typeof taskIdentifier !== 'string') {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'taskIdentifier is required' });
    }
    if (!action || typeof action !== 'string') {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'action is required' });
    }
    if (!status || typeof status !== 'string') {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'status is required' });
    }
    if (!summary || typeof summary !== 'string') {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'summary is required' });
    }
    if (summary.length > 10000) {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'summary exceeds max length (10000)' });
    }
    if (taskIdentifier.length > 200 || action.length > 200 || status.length > 200) {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'Field exceeds max length (200)' });
    }

    // dispatchId is optional. When present it must be a non-empty string ≤200 chars
    // (same cap as other field inputs). Enables exact-match loop join in LIN-245;
    // absence is back-compatible and consumers fall back to timestamp-window matching.
    if (dispatchId !== undefined && dispatchId !== null) {
      if (typeof dispatchId !== 'string' || dispatchId.length === 0) {
        logEvent(req, '/api/proxy/foreman/status', 400);
        return res.status(400).json({ error: 'dispatchId must be a non-empty string' });
      }
      if (dispatchId.length > 200) {
        logEvent(req, '/api/proxy/foreman/status', 400);
        return res.status(400).json({ error: 'Field exceeds max length (200)' });
      }
      if (DANGEROUS_CHARS_REGEX.test(dispatchId)) {
        logEvent(req, '/api/proxy/foreman/status', 400);
        return res.status(400).json({ error: 'Input contains invalid characters' });
      }
    }

    if (DANGEROUS_CHARS_REGEX.test(taskIdentifier) || DANGEROUS_CHARS_REGEX.test(action) ||
        DANGEROUS_CHARS_REGEX.test(status) || DANGEROUS_CHARS_REGEX.test(summary)) {
      logEvent(req, '/api/proxy/foreman/status', 400);
      return res.status(400).json({ error: 'Input contains invalid characters' });
    }

    try {
      await foremanStore.recordStatus({
        urlKey: req.proxyUrlKey,
        taskIdentifier,
        action,
        status,
        summary,
        // Attribute the write to the posting token so the UI can group
        // entries into sessions. Label is snapshotted so it survives revocation.
        tokenId: req.proxyTokenId,
        tokenLabel: req.proxyTokenLabel,
        ...(dispatchId ? { dispatchId } : {})
      });

      logEvent(req, '/api/proxy/foreman/status', 201);
      res.status(201).json({ success: true });
    } catch (err) {
      logEvent(req, '/api/proxy/foreman/status', 500);
      console.error('Foreman status post error:', err.message);
      res.status(500).json({ error: 'Failed to record status' });
    }
  });

  /**
   * GET /api/proxy/foreman/status
   * List recent foreman status entries. Optional filters: tokenId (session) +
   * taskIdentifier (task thread).
   */
  router.get('/api/proxy/foreman/status', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const filters = {};
      if (req.query.tokenId) {
        const raw = String(req.query.tokenId);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/foreman/status', 400);
          return res.status(400).json({ error: 'Invalid tokenId' });
        }
        filters.tokenId = raw;
      }
      if (req.query.taskIdentifier) {
        const raw = String(req.query.taskIdentifier);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/foreman/status', 400);
          return res.status(400).json({ error: 'Invalid taskIdentifier' });
        }
        filters.taskIdentifier = raw;
      }

      const result = await foremanStore.listStatus(req.proxyUrlKey, { limit, offset, ...filters });

      logEvent(req, '/api/proxy/foreman/status', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/foreman/status', 500);
      console.error('Foreman status list error:', err.message);
      res.status(500).json({ error: 'Failed to list status' });
    }
  });

  /**
   * GET /api/proxy/foreman/sessions
   * Lists foreman sessions for a workspace, keyed by posting token. Each
   * session shows its most recent activity so observers can pick "which agent
   * to watch" at a glance. Entries without a tokenId (legacy) roll up into a
   * synthetic "unattributed" session.
   */
  router.get('/api/proxy/foreman/sessions', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const result = await foremanStore.listSessions(req.proxyUrlKey);
      logEvent(req, '/api/proxy/foreman/sessions', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/foreman/sessions', 500);
      console.error('Foreman sessions list error:', err.message);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  /**
   * GET /api/proxy/foreman/tasks
   * Lists task threads (groups of status entries by Linear identifier).
   * Optional `tokenId` filter narrows to a single session.
   */
  router.get('/api/proxy/foreman/tasks', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const filters = {};
      if (req.query.tokenId) {
        const raw = String(req.query.tokenId);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/foreman/tasks', 400);
          return res.status(400).json({ error: 'Invalid tokenId' });
        }
        filters.tokenId = raw;
      }
      const result = await foremanStore.listTaskThreads(req.proxyUrlKey, filters);
      logEvent(req, '/api/proxy/foreman/tasks', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/foreman/tasks', 500);
      console.error('Foreman tasks list error:', err.message);
      res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  /**
   * GET /api/proxy/foreman/playbook
   * Returns the foreman playbook prompt as plain text.
   */
  router.get('/api/proxy/foreman/playbook', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    logEvent(req, '/api/proxy/foreman/playbook', 200);

    const playbook = buildForemanPlaybook({ baseUrl });
    res.type('text/plain').send(playbook);
  });

  /**
   * GET /api/proxy/autopilot/kickoff
   * Returns the Autopilot kickoff prompt as plain text — the briefing that
   * turns the receiving session into the Autopilot orchestrator (it dispatches
   * work to a separate worker and judges completion from external evidence).
   * General (stack-walk) by default; `?goal=` supplies a focus, `?mode=readonly`
   * restricts to investigation/research prompts.
   */
  router.get('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT;
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : '';

    logEvent(req, '/api/proxy/autopilot/kickoff', 200);

    const kickoff = buildAutopilotKickoff({ baseUrl, goal, mode });
    res.type('text/plain').send(kickoff);
  });

  /**
   * GET /api/proxy/autopilot/manual
   * Returns the Autopilot operating manual (the "handbook") as plain text — the
   * portable senior-lead disposition that sits beside the kickoff's mechanics.
   * The kickoff composes this same text inline, so this endpoint is for re-reading
   * a part mid-run (and for humans / other consumers).
   */
  router.get('/api/proxy/autopilot/manual', proxyLimiter, authenticateProxyToken, async (req, res) => {
    logEvent(req, '/api/proxy/autopilot/manual', 200);
    res.type('text/plain').send(buildAutopilotManual());
  });

  // ===========================================================================
  // Dispatch Endpoints (proxy-token twin of routes/dispatch.js)
  // ===========================================================================

  /**
   * POST /api/proxy/dispatch
   * Queue a prompt for the workspace's dispatch consumer (the runner).
   * Proxy-token equivalent of POST /workspace/:urlKey/api/dispatch — same
   * body shape and validation, but scoped by the token's workspace and
   * requiring readWrite scope. Excludes target 'local' (Harbour spawns on
   * the server's own tty, which a remote consumer can't drive). This is the
   * write half the autopilot orchestrator uses to dispatch a chosen task.
   */
  router.post('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return res.status(503).json({ error: 'Dispatch is not available' });
    }

    try {
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo } = req.body || {};

      if (!prompt || typeof prompt !== 'string') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}` });
      }
      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `kind must be one of: ${DISPATCH_KINDS.join(', ')}` });
      }

      if (prompt.length > MAX_PROMPT_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` });
      }
      if (promptName && promptName.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `promptName exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }
      if (issueIdentifier && issueIdentifier.length > MAX_IDENTIFIER_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `issueIdentifier exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}` });
      }
      if (issueTitle && issueTitle.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `issueTitle exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }
      if (issueUrl && issueUrl.length > MAX_URL_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `issueUrl exceeds maximum length of ${MAX_URL_LENGTH}` });
      }
      if (repo && repo.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `repo exceeds maximum length of ${MAX_NAME_LENGTH}` });
      }

      if (DANGEROUS_CHARS_REGEX.test(prompt)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'prompt contains invalid characters' });
      }
      if (promptName && DANGEROUS_CHARS_REGEX.test(promptName)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'promptName contains invalid characters' });
      }
      if (issueTitle && DANGEROUS_CHARS_REGEX.test(issueTitle)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'issueTitle contains invalid characters' });
      }
      if (repo && DANGEROUS_CHARS_REGEX.test(repo)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'repo contains invalid characters' });
      }
      if (issueId && !UUID_REGEX.test(issueId)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'Invalid issueId format' });
      }

      // Auto-append the proxy context (Linear access + reporting channel) by
      // default, so the worker can both read context and report its result.
      // Opt out with appendProxyContext:false (e.g. a self-contained prompt).
      const { appendProxyContext } = req.body || {};
      let finalPrompt = prompt;
      if (appendProxyContext !== false) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const bearerToken = (req.headers.authorization || '').slice(7);
        finalPrompt = prompt + buildProxyContextPreamble({
          baseUrl,
          token: bearerToken,
          issueIdentifier: issueIdentifier || null
        });
      }

      const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
        prompt: finalPrompt,
        promptName: promptName || 'Prompt',
        kind: kind || deriveDispatchKind(promptName),
        issueId: issueId || null,
        issueIdentifier: issueIdentifier || null,
        issueTitle: issueTitle || null,
        issueUrl: issueUrl || null,
        dispatchedBy: req.proxyCreatedBy || null,
        target: target || 'cli',
        repo: repo || null
      });

      logEvent(req, '/api/proxy/dispatch', 201);
      res.status(201).json({
        success: true,
        id: item._id,
        status: 'queued',
        promptName: item.promptName,
        kind: item.kind,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt
      });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch error:', err.message);
      res.status(500).json({ error: 'Failed to dispatch prompt' });
    }
  });

  /**
   * POST /api/proxy/recommend-and-dispatch
   * Fused verb (LIN-321): run /recommend and forward the recommended prompt
   * straight into a dispatch, SERVER-SIDE, returning only the task header.
   * The prompt body never reaches the caller, so the orchestrator's context-
   * economy rule (autopilot invariant 4) becomes mechanical instead of a rule
   * it must remember. `kind` is derived from the recommendation's own action
   * signal — no need to read the prompt to classify the task.
   */
  router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
      return res.status(503).json({ error: 'Dispatch is not available' });
    }

    try {
      const { issueIdentifier, target, repo, appendProxyContext, noDescend } = req.body || {};

      // Validate caller-supplied inputs. (Only the server-generated prompt skips
      // the dangerous-char/length checks — see the dispatch step below.)
      if (!issueIdentifier || typeof issueIdentifier !== 'string') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return res.status(400).json({ error: 'issueIdentifier is required and must be a string' });
      }
      if (!isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return res.status(400).json({ error: `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}` });
      }
      if (noDescend !== undefined && typeof noDescend !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return res.status(400).json({ error: 'noDescend must be a boolean' });
      }
      if (repo !== undefined && (typeof repo !== 'string' || repo.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(repo))) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return res.status(400).json({ error: 'repo is invalid' });
      }

      // Recommendation preconditions — identical to GET /recommend.
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend-and-dispatch', reason);
      }
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
        return res.status(503).json({ error: 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      // /recommend is slow (Linear + OpenRouter) — arm keepalive before computing.
      const keepalive = armKeepalive(res);

      let rec, deferredVia, deferTruncated, deferStopReason;
      try {
        // Resolve `defer` to a terminal actionable node server-side (LIN-329) so
        // Autopilot can fire this verb on ANY task — node or leaf — and get the
        // actionable descendant's prompt + kind, never a `defer` to act on.
        const recommendDeadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
        ({ recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: issueIdentifier,
          deadline: recommendDeadline,
          // noDescend (LIN-365): dispatch the named node's OWN work, never an open child.
          noDescend: noDescend === true,
          computeOne: (id) => computeRecommendation({
            urlKey: req.proxyUrlKey,
            createdBy: req.proxyCreatedBy,
            identifier: id,
            accessToken,
            isTestMode,
            sessionApiKey,
            deadline: recommendDeadline,
            noDescend: noDescend === true
          })
        }));
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err);
        logEvent(req, '/api/proxy/recommend-and-dispatch', status);
        return keepalive.send(status, body);
      }

      // The descent should always terminate on a real action carrying a prompt.
      // If it stopped abnormally (depth cap / cycle / unresolved child / timeout)
      // it may have halted on a `defer` with no prompt — surface that anomaly
      // rather than dispatching an empty prompt. `defer` must never reach dispatch.
      if (rec.recommendedAction === 'defer' || !rec.prompt) {
        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 422);
        return keepalive.send(422, {
          error: 'Recommendation did not resolve to an actionable task',
          deferredVia,
          deferTruncated,
          deferStopReason
        });
      }

      try {
        // The recommended prompt is server-generated/trusted, so we forward it
        // verbatim and intentionally SKIP the DANGEROUS_CHARS/length checks the
        // caller-supplied POST /dispatch path runs. The prompt body is never
        // returned to the caller — that is the whole point of this verb.
        // The dispatched item references the TERMINAL actionable node (rec.identifier),
        // not the parent the caller named — the worker should inherit context for the
        // task it is actually working on (LIN-327). For a leaf these are identical.
        const terminalIdentifier = rec.identifier || issueIdentifier;
        let finalPrompt = rec.prompt;
        if (appendProxyContext !== false) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const bearerToken = (req.headers.authorization || '').slice(7);
          finalPrompt = rec.prompt + buildProxyContextPreamble({
            baseUrl,
            token: bearerToken,
            issueIdentifier: terminalIdentifier
          });
        }

        // kind provenance: parseRecommendedAction (in computeRecommendation) →
        // recommendedAction → deriveDispatchKind → BOTH the stored item's kind
        // and the response kind (same value); falls back to 'custom' when the
        // action can't be parsed.
        const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
          prompt: finalPrompt,
          promptName: rec.recommendedAction || 'Prompt',
          kind: deriveDispatchKind(rec.recommendedAction),
          issueId: null,
          issueIdentifier: terminalIdentifier,
          issueTitle: null,
          issueUrl: null,
          dispatchedBy: req.proxyCreatedBy || null,
          target: target || 'cli',
          repo: repo || null
        });

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 201);
        // Task header ONLY — no prompt body. deferredVia + descent are additive
        // (LIN-327): they let Autopilot read the descent ("LIN-318 → LIN-297
        // (research) · dispatched") from the structured header, never a prompt body.
        const descent = describeDescent(deferredVia, rec);
        keepalive.send(201, {
          success: true,
          id: item._id,
          status: 'queued',
          kind: item.kind,
          promptName: item.promptName,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
          deferredVia,
          deferTruncated,
          ...(descent ? { descent: `${descent} · dispatched` } : {})
        });
      } catch (err) {
        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
        console.error('Proxy recommend-and-dispatch error:', err.message);
        keepalive.send(500, { error: 'Failed to dispatch prompt' });
      }
    } catch (err) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
      console.error('Proxy recommend-and-dispatch error:', err.message);
      res.status(500).json({ error: 'Failed to dispatch prompt' });
    }
  });

  /**
   * GET /api/proxy/dispatch
   * List the workspace's dispatch items across both the live queue (status
   * 'queued') and recent history (taken/cancelled/expired, with feedback),
   * newest first. Lets the orchestrator discover its own in-flight items
   * without having to remember every id it dispatched. Optional filters:
   *   ?issueIdentifier=LIN-42   exact match on the issue identifier
   *   ?status=queued|taken|...  exact match on lifecycle status
   *   ?limit=N                  cap (default 20, max 100)
   */
  router.get('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return res.status(503).json({ error: 'Dispatch is not available' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    let issueIdentifier = null;
    if (req.query.issueIdentifier !== undefined) {
      issueIdentifier = String(req.query.issueIdentifier);
      if (issueIdentifier.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(issueIdentifier)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'Invalid issueIdentifier' });
      }
    }

    let statusFilter = null;
    if (req.query.status !== undefined) {
      statusFilter = String(req.query.status);
      if (statusFilter.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(statusFilter)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'Invalid status' });
      }
    }

    try {
      // Live queue (still 'queued') + resolved history (with feedback), merged.
      const [queued, history] = await Promise.all([
        dispatchQueueStore.listItems(req.proxyUrlKey),
        dispatchQueueStore.listHistory(req.proxyUrlKey, { limit: 200 })
      ]);

      const merged = [
        ...queued.map(i => ({ ...i, status: 'queued', feedback: [] })),
        ...history.items
      ];

      // Resolve each item's effective status once (terminal marker → done/failed/
      // aborted, else the lifecycle status) so filtering and the response agree.
      const resolved = merged.map(i => ({ ...i, status: deriveTerminalStatus(i.feedback) || i.status }));

      const filtered = resolved.filter(i =>
        (!issueIdentifier || i.issueIdentifier === issueIdentifier) &&
        (!statusFilter || i.status === statusFilter)
      );

      filtered.sort((a, b) => {
        const at = new Date(a.dispatchedAt || 0).getTime();
        const bt = new Date(b.dispatchedAt || 0).getTime();
        return bt - at;
      });

      const items = filtered.slice(0, limit).map(i => ({
        id: i.id,
        status: i.status,
        promptName: i.promptName,
        kind: i.kind || 'custom',
        issueIdentifier: i.issueIdentifier,
        issueUrl: i.issueUrl,
        target: i.target,
        dispatchedAt: i.dispatchedAt,
        // resolvedAt = take/archive time; completedAt = real completion (null until terminal).
        resolvedAt: i.resolvedAt || null,
        completedAt: deriveCompletedAt(i.feedback),
        feedbackCount: (i.feedback || []).length
      }));

      logEvent(req, '/api/proxy/dispatch', 200);
      res.json({ items, total: filtered.length });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch list error:', err.message);
      res.status(500).json({ error: 'Failed to list dispatch items' });
    }
  });

  /**
   * GET /api/proxy/dispatch/:id
   * Watch a dispatched item: report whether it is still queued or has been
   * taken by the runner, plus any feedback the runner has posted. This is the
   * poll half of the autopilot loop — the orchestrator reads feedback here to
   * decide its next step. Feedback is free-form by design; the orchestrator
   * (the judge) reads it rather than relying on a structured "done" flag.
   *
   * Optional ?wait=Ns (LIN-392) turns this into a server-side long-poll: the
   * handler holds the request open (re-checking the store every ~1.5s) and
   * returns the instant the derived status transitions or new feedback arrives,
   * else returns the current snapshot at a ~50s cap so the caller simply calls
   * again. This collapses the autopilot watch loop to a no-sleep/no-backoff
   * `do { GET ...?wait=50 } while (!terminal)`. No ?wait preserves today's
   * immediate short-poll, byte-for-byte.
   */
  router.get('/api/proxy/dispatch/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch/:id', 503);
      return res.status(503).json({ error: 'Dispatch is not available' });
    }

    const { id } = req.params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id)) {
      logEvent(req, '/api/proxy/dispatch/:id', 400);
      return res.status(400).json({ error: 'Invalid dispatch id' });
    }

    // Parse + clamp ?wait. Garbage / non-positive → 0 → unchanged short-poll.
    const waitSeconds = Math.min(
      Math.max(0, Math.floor(Number(req.query.wait)) || 0),
      DISPATCH_WAIT_MAX_S
    );

    try {
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id', 404);
        return res.status(404).json({ error: 'Dispatch item not found' });
      }

      // First read short-circuits: no wait requested, or already terminal.
      // (The terminal short-circuit also keeps re-polling a finished item free
      // — the caller can re-verify without ever incurring the hold.)
      let current = item;
      const alreadyTerminal = deriveTerminalStatus(current.feedback) !== null;
      if (waitSeconds > 0) {
        // Long-poll path. The response carries `reason`/`waitedMs` so the caller
        // can tell WHY it came back (see formatDispatchWatch) — a terminal item
        // short-circuits with no hold; otherwise we hold and report 'change' vs
        // 'timeout'.
        if (alreadyTerminal) {
          logEvent(req, '/api/proxy/dispatch/:id', 200);
          return res.json(formatDispatchWatch(current, { reason: 'terminal', waitedMs: 0 }));
        }
        // Hold the request open. armKeepalive flushes 200 + JSON whitespace at
        // 25s so the connection survives Heroku's 30s H12 while we wait; the
        // baseline is this first (non-terminal) read, so a change that already
        // landed is reflected in the baseline AND in whatever we ultimately
        // return — the caller never loses data, only an early return.
        const keepalive = armKeepalive(res);
        const baseline = {
          status: deriveTerminalStatus(current.feedback) || current.status,
          feedbackLength: (current.feedback || []).length
        };
        const waitStart = Date.now();
        const deadline = waitStart + waitSeconds * 1000;
        let reason = 'timeout'; // default: held the full window, nothing new
        while (Date.now() < deadline) {
          await sleep(DISPATCH_WAIT_POLL_MS);
          if (res.writableEnded || res.destroyed) {
            keepalive.stop();
            return; // client gave up
          }
          const next = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
          if (!next) break; // item expired mid-wait; return last known snapshot
          current = next;
          if (dispatchWatchChanged(baseline, current)) { reason = 'change'; break; }
        }
        keepalive.stop();
        logEvent(req, '/api/proxy/dispatch/:id', 200);
        return keepalive.send(200, formatDispatchWatch(current, { reason, waitedMs: Date.now() - waitStart }));
      }

      logEvent(req, '/api/proxy/dispatch/:id', 200);
      res.json(formatDispatchWatch(current));
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id', 500);
      console.error('Proxy dispatch watch error:', err.message);
      res.status(500).json({ error: 'Failed to read dispatch item' });
    }
  });

  return router;
}
