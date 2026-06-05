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
import { fetchProjects, fetchIssueContext, fetchRecommendationContext } from '../lib/linear.js';
import { isRecommendationEnabled, getRecommendation } from '../lib/openrouter.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, isTerminalState, NO_PROJECT_ID } from '../lib/tree.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent } from '../lib/render-swipe.js';
import { generatePrompt, hasPrompt } from '../lib/prompt-templates.js';
import { parseRepoFromDescription } from '../lib/prompt-formatters.js';
import { buildForemanPlaybook } from '../lib/prompts/foreman-playbook.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';

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

// Longer timeout for endpoints that make multiple sequential API calls
// (stack fetches all issues with pagination, recommend calls Linear + OpenRouter).
const MULTI_REQUEST_TIMEOUT_MS = 50_000;

// Backstop for the Linear context fetch on recommendation-style endpoints
// (recommend/recap/brief/status). These fetches run behind an armed keepalive
// (http-keepalive.js flushes a 200 + heartbeat at 25s and then holds the
// connection open), so a 25s cap on the fetch would fire at the same instant
// the keepalive starts covering for slowness — surfacing a 504 on healthy large
// epics instead of letting the request complete. A larger budget keeps the cap
// as a backstop for a genuinely hung Linear while letting normal large epics
// finish. Paired with an AbortSignal so a trip actually cancels the request.
const CONTEXT_FETCH_TIMEOUT_MS = 45_000;

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
  const task = issueIdentifier || 'your task';
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
    `Use it to pull context (e.g. GET ${baseUrl}/api/proxy/issues/${task},`,
    `/relations/${task}) and to update Linear as you work (status, comments, labels).`,
    '',
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with a concise summary that',
    'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
    'report carries proof rather than a bare "done".',
    ''
  ].join('\n');
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
      labels { nodes { id name } }
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
 * @param {Function} options.getWorkspaceAccessToken - Function to get workspace access token by urlKey
 * @param {Function} options.getWorkspaceOpenRouterKey - Function to get OpenRouter API key from workspace sessions
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, briefCacheStore, dispatchQueueStore, workspaceFromUrl, getWorkspaceAccessToken, getWorkspaceOpenRouterKey, workspacePreferencesStore }) {
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
    const accessToken = await getWorkspaceAccessToken(urlKey);
    if (!accessToken) {
      return null;
    }
    const clientOptions = {
      headers: { Authorization: accessToken },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (proxyFetch) clientOptions.fetch = proxyFetch;
    return new GraphQLClient(LINEAR_API_ENDPOINT, clientOptions);
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
      "labels":   { "nodes": [{ "name": "bug" }] },
      "children": { "nodes": [{ "id": "...", "identifier": "LIN-124", "title": "..." }] },
      "parent":   { "id": "...", "identifier": "LIN-100", "title": "..." },
      "comments": { "nodes": [{ "id": "...", "body": "...", "createdAt": "..." }] }
    }
  → Note: labels / children / comments use Linear's {nodes: [...]} wrapper.

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
  → { "relations":        { "nodes": [{ "id": "...", "type": "blocks", "relatedIssue": { "id": "...", "identifier": "LIN-9" } }] },
      "inverseRelations": { "nodes": [{ "id": "...", "type": "blocks", "issue": { "id": "...", "identifier": "LIN-7" } }] } }
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

GET ${baseUrl}/api/proxy/recommend/{identifier}
  → AI-generated prompt recommendation (requires OpenRouter on the server; >25s responses
    stream whitespace-keepalive bytes inside a single 200 response, which JSON.parse ignores)
  → { "identifier": "LIN-123", "reasoning": "...", "prompt": "...", "truncated": false, "repo": "owner/name" }

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
  → Foreman playbook (plain text, not JSON)`;

    const writeEndpoints = scope === 'readWrite' ? `

## Write Endpoints

POST ${baseUrl}/api/proxy/issues
  Body: { "teamId": "...", "title": "...", "description": "...", "projectId": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "..." }
  → Create a new issue; set parentId (UUID) to create as a sub-issue

PATCH ${baseUrl}/api/proxy/issues/{issueId}
  Body: { "title": "...", "description": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "...|null" }
  → Update an existing issue; set cycleId to assign/move to a cycle; set parentId to a UUID to re-parent, or null to promote to top-level

POST ${baseUrl}/api/proxy/issues/{issueId}/comments
  Body: { "body": "..." }
  → Add a comment to an issue

POST ${baseUrl}/api/proxy/issues/{issueId}/relations
  Body: { "type": "blocks|related|duplicate", "relatedIssueId": "..." }
  → Create a relation between issues

DELETE ${baseUrl}/api/proxy/issues/{issueId}/relations/{relationId}
  → Remove a relation. relationId is the relation's own id (the \`id\` field on
    each node from GET /relations/{issueId} or GET /issue/{id}), NOT an issue id.
  → { "success": true }

POST ${baseUrl}/api/proxy/issues/{issueId}/labels
  Body: { "labelId": "..." }
  → Add a label to an issue

DELETE ${baseUrl}/api/proxy/issues/{issueId}/labels/{labelId}
  → Remove a label from an issue

POST ${baseUrl}/api/proxy/foreman/status
  Body: { "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "...", "dispatchId": "..." }
  → Record a foreman status update (dispatchId optional: pass the dispatch-history item ID from /api/dispatch/take to enable exact loop-reconstruction join)

## Dispatch Endpoints

POST ${baseUrl}/api/proxy/dispatch
  Body: { "prompt": "...", "promptName": "...", "issueId": "...", "issueIdentifier": "LIN-42", "issueTitle": "...", "issueUrl": "...", "target": "cli|web|dash", "repo": "...", "appendProxyContext": true }
  → Queue a prompt for the workspace's dispatch consumer (the runner). Only "prompt" is required; target defaults to "cli". ("local"/Harbour is not available to proxy consumers.)
  → By default a proxy-context block is appended to the prompt so the worker inherits Linear access for this workspace (the MCP replacement). Reporting is handled by the runner's Stop hook, not the prompt. Set "appendProxyContext": false to opt out.
  → { "id": "...", "status": "queued", "promptName": "...", "issueIdentifier": "...", "target": "cli", "dispatchedAt": "..." }

GET ${baseUrl}/api/proxy/dispatch?issueIdentifier={LIN-42}&status={queued|taken}&limit={n}
  → List your dispatch items (live queue + recent history), newest first. All query params optional. Use this to find an item's id when you only know the issue.
  → { "items": [{ "id": "...", "status": "queued|taken|...", "issueIdentifier": "...", "feedbackCount": 1, ... }], "total": N }

GET ${baseUrl}/api/proxy/dispatch/{id}
  → Watch a dispatched item: whether it is still queued or has been taken by the runner, plus any feedback posted back. Poll this after dispatching.
  → { "id": "...", "status": "queued|taken|cancelled|expired", "feedback": [{ "message": "...", "url": "...", "timestamp": "..." }], ... }
  → Feedback is free-form text — read it to decide the next step; there is no structured "done" flag.

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

## Error Codes

401 - Invalid, expired, or consumed token
403 - Endpoint requires read-write token (yours is read-only)
404 - Resource not found
429 - Rate limited (max 60 requests/minute)
500 - Internal server error

## Notes

- All responses are JSON (except \`/api/proxy/foreman/playbook\` and \`/api/proxy/instructions\`, which are plain text).
- Issue IDs can be UUIDs or identifiers (e.g., "LIN-123").
- Dates are ISO 8601 format.
- Rate limit: 60 requests per minute.

## Client Notes

- **Validate Content-Type before parsing.** If the body is empty or
  \`Content-Type\` isn't \`application/json\`, it's almost always transient
  client-side network flakiness, not a proxy error. Retry once before
  surfacing the failure.
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/me', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/teams', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/projects', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/:id', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/search', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/states', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/labels', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/cycles', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/cycle', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/relations', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      logEvent(req, '/api/proxy/relations', 200);
      // Wrap in Linear's {nodes:[...]} shape to match /issue and the rest of
      // the raw-read surface (labels/children/comments), so consumers see a
      // single consistent convention across endpoints.
      res.json({
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
  router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/:id', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      const data = await client.request(UPDATE_ISSUE_MUTATION, { id: issueId, input });
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
   * POST /api/proxy/issues/:issueId/comments
   * Add a comment to an issue.
   */
  router.post('/api/proxy/issues/:issueId/comments', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/comments', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      const data = await client.request(CREATE_COMMENT_MUTATION, {
        input: { issueId, body }
      });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/relations', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      // Handle blocked-by as inverse blocks
      let input;
      if (type === 'blocked-by') {
        input = { issueId: relatedIssueId, relatedIssueId: issueId, type: 'blocks' };
      } else {
        input = { issueId, relatedIssueId, type };
      }

      const data = await client.request(CREATE_RELATION_MUTATION, { input });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/relations', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/labels', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id);
      if (currentLabelIds.includes(labelId)) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label already present' });
      }

      const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
        id: issueId,
        input: { labelIds: [...currentLabelIds, labelId] }
      });
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
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issues/labels', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/stack', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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

      // Sort and cluster
      sortIssuesForSwipe(allIssues);
      const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

      // Trim to limit and transform to Linear-native shape. Agents assume
      // `state.name`, `parent.identifier`, `children` (not `subtasks`), so we
      // expose that shape uniformly here. Internal flat fields remain
      // available only to this handler.
      const tasks = sortedIssues.slice(0, limit).map(issue => ({
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
        blocksIds: issue.blocksIds || []
      }));

      logEvent(req, '/api/proxy/stack', 200);
      res.json({ tasks, total: sortedIssues.length });
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
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/prompt', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
   * GET /api/proxy/recommend/:identifier
   * Returns an AI-generated prompt recommendation for an issue.
   * Uses the token creator's OAuth key (if available) or server-side OPENROUTER_API_KEY.
   */
  router.get('/api/proxy/recommend/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/recommend', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
      if (isTestMode) {
        const mockData = await getTestMockData();
        // Find mock issue by UUID or identifier
        const mockIssue = mockData.issues.find(i =>
          i.id === identifier || i.identifier === identifier
        );
        if (!mockIssue) {
          logEvent(req, '/api/proxy/recommend', 404);
          return res.status(404).json({ error: 'Issue not found' });
        }

        const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
        const issueIdentifier = mockIssue.identifier || mockIssue.url?.split('/').pop() || 'ISSUE';

        let reasoning = 'Analyzing the task to determine the best approach.';
        let goal = 'Understand what this task involves and plan the next steps.';

        if (labels.includes('bug')) {
          reasoning = 'This is a bug. Investigating systematically will help find the root cause.';
          goal = 'Identify reproduction steps, hypothesize causes, and suggest a fix.';
        } else if (labels.includes('blocked')) {
          reasoning = 'This task is blocked. Analyzing the blocker to find a way forward.';
          goal = 'Identify the blocker and recommend how to unblock.';
        } else if (mockIssue.state?.type === 'started') {
          reasoning = 'Task is in progress. Checking what work remains.';
          goal = 'Continue implementation and update progress.';
        }

        const mockProject = mockData.projects.find(p => p.id === mockIssue.project?.id);

        logEvent(req, '/api/proxy/recommend', 200);
        return res.json({
          identifier: issueIdentifier,
          reasoning,
          prompt: `Help me with task ${issueIdentifier}\n\n## Context\n\n**Status:** ${mockIssue.state?.name || 'Unknown'}\n${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}\n\n## Goal\n\n${goal}`,
          truncated: false,
          repo: parseRepoFromDescription(mockProject?.content)
        });
      }

      // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
      // delayed whitespace keepalive so the dyno can keep the connection open
      // while the LLM call completes.
      const keepalive = armKeepalive(res);
      try {
        // Fetch issue context with two-tier support for parent tasks
        const context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        const { issue, parent, siblings, project, children, comments, focusedChild } = context;

        // Get AI-generated recommendation (uses session OAuth key or server-side OPENROUTER_API_KEY)
        // Uses a longer timeout since this makes a Linear API call + an OpenRouter LLM call.
        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore });
        const recommendation = await withTimeout(
          getRecommendation(
            issue,
            { parent, siblings, project, children, comments, focusedChild },
            { apiKey: sessionApiKey, model: selectedModel, featureFlags: {} }
          ),
          MULTI_REQUEST_TIMEOUT_MS
        );

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend', 200);
        keepalive.send(200, {
          identifier: issue.identifier,
          reasoning: recommendation.reasoning,
          prompt: recommendation.prompt,
          truncated: recommendation.truncated,
          repo: parseRepoFromDescription(project?.description)
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
          body = { error: 'Failed to get recommendation', detail: graphqlErrorDetail(err) };
          console.error('Proxy /recommend error:', err.message);
        }
        logEvent(req, '/api/proxy/recommend', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/recommend', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }
      if (err.message?.includes('OpenRouter')) {
        logEvent(req, '/api/proxy/recommend', 503);
        return res.status(503).json({ error: 'AI service temporarily unavailable', detail: err.message });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/recommend', status);
      console.error('Proxy /recommend error:', err.message);
      res.status(status).json({ error: 'Failed to get recommendation', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/recap/:identifier
   * Returns the AI-generated recap (done/pending/deviations) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   */
  router.get('/api/proxy/recap/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
            generateRecap(context.issue, context, { apiKey: sessionApiKey, model: selectedModel }),
            MULTI_REQUEST_TIMEOUT_MS
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
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
            generateRecap(context.issue, context, { apiKey: sessionApiKey, model: selectedModel }),
            MULTI_REQUEST_TIMEOUT_MS
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
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
            generateBrief(context.issue, context, { apiKey: sessionApiKey, model: selectedModel }),
            MULTI_REQUEST_TIMEOUT_MS
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
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/brief', 503);
        return res.status(503).json({ error: 'Workspace not available' });
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
            generateBrief(context.issue, context, { apiKey: sessionApiKey, model: selectedModel }),
            MULTI_REQUEST_TIMEOUT_MS
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
      const { prompt, promptName, issueId, issueIdentifier, issueTitle, issueUrl, target, repo } = req.body || {};

      if (!prompt || typeof prompt !== 'string') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return res.status(400).json({ error: `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}` });
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
        id: item._id,
        status: 'queued',
        promptName: item.promptName,
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

      const filtered = merged.filter(i =>
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
        issueIdentifier: i.issueIdentifier,
        issueUrl: i.issueUrl,
        target: i.target,
        dispatchedAt: i.dispatchedAt,
        resolvedAt: i.resolvedAt || null,
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

    try {
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id', 404);
        return res.status(404).json({ error: 'Dispatch item not found' });
      }

      logEvent(req, '/api/proxy/dispatch/:id', 200);
      res.json({
        id: item.id,
        status: item.status,
        promptName: item.promptName,
        issueIdentifier: item.issueIdentifier,
        issueUrl: item.issueUrl,
        target: item.target,
        dispatchedAt: item.dispatchedAt,
        resolvedAt: item.resolvedAt || null,
        feedback: (item.feedback || []).map(f => ({
          message: f.message,
          url: f.url || null,
          urlLabel: f.urlLabel || null,
          timestamp: f.timestamp || null
        }))
      });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id', 500);
      console.error('Proxy dispatch watch error:', err.message);
      res.status(500).json({ error: 'Failed to read dispatch item' });
    }
  });

  return router;
}
