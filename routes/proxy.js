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
import { isRecommendationEnabled, getRecommendation, DEFAULT_MODEL } from '../lib/openrouter.js';
import { generateRecap } from '../lib/recap.js';
import { hashContext } from '../lib/recap-cache.js';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID } from '../lib/tree.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent } from '../lib/render-swipe.js';
import { generatePrompt, hasPrompt } from '../lib/prompt-templates.js';
import { parseRepoFromDescription } from '../lib/prompt-formatters.js';

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
    c => c.state?.type !== 'completed' && c.state?.type !== 'canceled'
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 1000;
const MAX_SEARCH_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100000;
const MAX_COMMENT_LENGTH = 50000;

// Timeout for individual GraphQL requests to Linear.
// Prevents the proxy from hanging silently when Linear is slow or payloads are large,
// which causes downstream "stream idle timeout" errors in CLI clients like curl.
const GRAPHQL_TIMEOUT_MS = 25_000;

// Longer timeout for endpoints that make multiple sequential API calls
// (stack fetches all issues with pagination, recommend calls Linear + OpenRouter).
const MULTI_REQUEST_TIMEOUT_MS = 50_000;

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

// Pattern to detect null bytes and dangerous control characters
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

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
          type
          relatedIssue { id identifier title state { name type } }
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
  query($issueId: ID!) {
    issue(id: $issueId) {
      relations {
        nodes {
          type
          relatedIssue { id identifier title state { name type } }
        }
      }
      inverseRelations {
        nodes {
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
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Function} options.getWorkspaceAccessToken - Function to get workspace access token by urlKey
 * @param {Function} options.getWorkspaceOpenRouterKey - Function to get OpenRouter API key from workspace sessions
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, workspaceFromUrl, getWorkspaceAccessToken, getWorkspaceOpenRouterKey }) {
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
   * Extract a safe, human-readable error message from a GraphQL error.
   * graphql-request stores the server errors in err.response.errors.
   *
   * Sanitizes the message to avoid leaking internal schema structures
   * or validation details to external consumers.
   */
  function graphqlErrorDetail(err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'Linear API request timed out — the response may be too large or Linear is slow. Try a more specific query.';
    }
    const gqlMessage = err.response?.errors?.[0]?.message;
    const raw = gqlMessage || err.message || 'Unknown error';

    // Strip messages that could reveal internal schema or field details.
    // Keep common user-facing messages (not found, permission, validation).
    const safePatterns = [
      /not found/i,
      /does not exist/i,
      /permission/i,
      /unauthorized/i,
      /forbidden/i,
      /rate limit/i,
      /invalid.*id/i,
      /already exists/i,
    ];

    if (safePatterns.some(p => p.test(raw))) {
      return raw;
    }

    // For anything else, return a generic message and log the real one
    console.error('GraphQL error detail (suppressed from response):', raw);
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
  → Current authenticated user (name, email)

GET ${baseUrl}/api/proxy/teams
  → List all teams (id, name, key)

GET ${baseUrl}/api/proxy/projects
  → List active projects (id, name, url)

GET ${baseUrl}/api/proxy/issues?teamId={teamId}&limit={n}
  → List issues (optionally filter by team, default limit 50, max 250)

GET ${baseUrl}/api/proxy/issue/{issueId}
  → Full issue detail (description, comments, children, relations)
  → issueId: UUID or identifier like "LIN-123"

GET ${baseUrl}/api/proxy/search?q={query}
  → Search issues by text (max 50 results)

GET ${baseUrl}/api/proxy/states/{teamId}
  → List workflow states for a team

GET ${baseUrl}/api/proxy/labels?teamId={teamId}
  → List labels (optionally filter by team, includes id/name/color)

GET ${baseUrl}/api/proxy/cycles?teamId={teamId}
  → List cycles (optionally filter by team)

GET ${baseUrl}/api/proxy/cycle/{cycleId}
  → Cycle detail with issues, progress, and scope history

GET ${baseUrl}/api/proxy/relations/{issueId}
  → Get issue relations (blocks, blocked-by, related, duplicate)

## Foreman Endpoints

GET ${baseUrl}/api/proxy/stack?limit={n}
  → Sorted task stack (default 5, max 50)

GET ${baseUrl}/api/proxy/recommend/{identifier}
  → AI-generated prompt recommendation for an issue (requires OPENROUTER_API_KEY on server)

GET ${baseUrl}/api/proxy/recap/{identifier}
  → AI recap of progress: { done, pending, deviations }. Auto-regenerates when stale; pass ?noRefresh=1 to skip regeneration.

POST ${baseUrl}/api/proxy/recap/{identifier}
  → Force-regenerate the recap and return the fresh result.

GET ${baseUrl}/api/proxy/foreman/status
  → List recent foreman status entries

GET ${baseUrl}/api/proxy/foreman/playbook
  → Get the foreman playbook prompt (plain text)`;

    const writeEndpoints = scope === 'readWrite' ? `

## Write Endpoints

POST ${baseUrl}/api/proxy/issues
  Body: { "teamId": "...", "title": "...", "description": "...", "projectId": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "..." }
  → Create a new issue (optionally assign to a cycle)

PATCH ${baseUrl}/api/proxy/issue/{issueId}
  Body: { "title": "...", "description": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "..." }
  → Update an existing issue (set cycleId to assign/move to a cycle)

POST ${baseUrl}/api/proxy/issue/{issueId}/comments
  Body: { "body": "..." }
  → Add a comment to an issue

POST ${baseUrl}/api/proxy/issue/{issueId}/relations
  Body: { "type": "blocks|related|duplicate", "relatedIssueId": "..." }
  → Create a relation between issues

POST ${baseUrl}/api/proxy/issue/{issueId}/labels
  Body: { "labelId": "..." }
  → Add a label to an issue

DELETE ${baseUrl}/api/proxy/issue/{issueId}/labels/{labelId}
  → Remove a label from an issue

POST ${baseUrl}/api/proxy/foreman/status
  Body: { "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "...", "dispatchId": "..." }
  → Record a foreman status update (dispatchId optional: pass the dispatch-history item ID from /api/dispatch/take to enable exact loop-reconstruction join)

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

- All responses are JSON
- Issue IDs can be UUIDs or identifiers (e.g., "LIN-123")
- Dates are ISO 8601 format
- Rate limit: 60 requests per minute
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
   * GET /api/proxy/issue/:issueId
   */
  router.get('/api/proxy/issue/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId } = req.params;

      // Allow UUID or identifier (e.g., "LIN-123")
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        logEvent(req, '/api/proxy/issue', 400);
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const data = await client.request(ISSUE_DETAIL_QUERY, { id: issueId });
      if (!data.issue) {
        logEvent(req, '/api/proxy/issue', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      logEvent(req, '/api/proxy/issue', 200);
      res.json(data.issue);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue', status);
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
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        logEvent(req, '/api/proxy/relations', 400);
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const data = await client.request(RELATIONS_QUERY, { issueId });
      if (!data.issue) {
        logEvent(req, '/api/proxy/relations', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      logEvent(req, '/api/proxy/relations', 200);
      res.json({
        relations: data.issue.relations?.nodes || [],
        inverseRelations: data.issue.inverseRelations?.nodes || []
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
   * PATCH /api/proxy/issue/:issueId
   * Update an issue.
   */
  router.patch('/api/proxy/issue/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId } = req.params;
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        logEvent(req, '/api/proxy/issue', 400);
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
      if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && Number.isInteger(priority) && priority >= 0 && priority <= 4) {
        input.priority = priority;
      }

      if (Object.keys(input).length === 0) {
        logEvent(req, '/api/proxy/issue', 400);
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const data = await client.request(UPDATE_ISSUE_MUTATION, { id: issueId, input });
      logEvent(req, '/api/proxy/issue', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue', status);
      console.error('Proxy update issue error:', err.message);
      res.status(status).json({ error: 'Failed to update issue', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issue/:issueId/comments
   * Add a comment to an issue.
   */
  router.post('/api/proxy/issue/:issueId/comments', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue/comments', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId } = req.params;
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { body } = req.body;
      if (!body || typeof body !== 'string') {
        logEvent(req, '/api/proxy/issue/comments', 400);
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
      logEvent(req, '/api/proxy/issue/comments', 201);
      res.status(201).json(data.commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue/comments', status);
      console.error('Proxy create comment error:', err.message);
      res.status(status).json({ error: 'Failed to create comment', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issue/:issueId/relations
   * Create a relation between issues.
   */
  router.post('/api/proxy/issue/:issueId/relations', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue/relations', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId } = req.params;
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { type, relatedIssueId } = req.body;
      const validTypes = ['blocks', 'blocked-by', 'duplicate', 'related'];
      if (!type || !validTypes.includes(type)) {
        logEvent(req, '/api/proxy/issue/relations', 400);
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      }

      if (!relatedIssueId || (!UUID_REGEX.test(relatedIssueId) && !/^[A-Z]+-\d+$/i.test(relatedIssueId))) {
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
      logEvent(req, '/api/proxy/issue/relations', 201);
      res.status(201).json(data.issueRelationCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue/relations', status);
      console.error('Proxy create relation error:', err.message);
      res.status(status).json({ error: 'Failed to create relation', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issue/:issueId/labels
   * Add a label to an issue.
   *
   * Note: This performs a Read-Modify-Write cycle (fetch current labels, then
   * update with the new set) because Linear's GraphQL API requires sending the
   * full label ID array. Concurrent label modifications (e.g. from the Linear
   * UI and this proxy simultaneously) could overwrite each other. This is an
   * inherent limitation of Linear's label API — there is no atomic add/remove.
   */
  router.post('/api/proxy/issue/:issueId/labels', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue/labels', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId } = req.params;
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }

      const { labelId } = req.body;
      if (!labelId || !UUID_REGEX.test(labelId)) {
        logEvent(req, '/api/proxy/issue/labels', 400);
        return res.status(400).json({ error: 'Valid labelId is required' });
      }

      // Fetch current labels
      const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId });
      if (!issueData.issue) {
        logEvent(req, '/api/proxy/issue/labels', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id);
      if (currentLabelIds.includes(labelId)) {
        logEvent(req, '/api/proxy/issue/labels', 200);
        return res.json({ success: true, message: 'Label already present' });
      }

      const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
        id: issueId,
        input: { labelIds: [...currentLabelIds, labelId] }
      });
      logEvent(req, '/api/proxy/issue/labels', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue/labels', status);
      console.error('Proxy add label error:', err.message);
      res.status(status).json({ error: 'Failed to add label', detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * DELETE /api/proxy/issue/:issueId/labels/:labelId
   * Remove a label from an issue.
   *
   * Note: Same Read-Modify-Write race condition caveat as the add-label
   * endpoint above. See POST /labels comment for details.
   */
  router.delete('/api/proxy/issue/:issueId/labels/:labelId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const client = await getClient(req.proxyUrlKey);
      if (!client) {
        logEvent(req, '/api/proxy/issue/labels', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const { issueId, labelId } = req.params;
      if (!UUID_REGEX.test(issueId) && !/^[A-Z]+-\d+$/i.test(issueId)) {
        return res.status(400).json({ error: 'Invalid issue ID format' });
      }
      if (!UUID_REGEX.test(labelId)) {
        return res.status(400).json({ error: 'Invalid label ID format' });
      }

      // Fetch current labels
      const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId });
      if (!issueData.issue) {
        logEvent(req, '/api/proxy/issue/labels', 404);
        return res.status(404).json({ error: 'Issue not found' });
      }

      const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id);
      const filtered = currentLabelIds.filter(id => id !== labelId);

      if (filtered.length === currentLabelIds.length) {
        logEvent(req, '/api/proxy/issue/labels', 200);
        return res.json({ success: true, message: 'Label not present' });
      }

      const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
        id: issueId,
        input: { labelIds: filtered }
      });
      logEvent(req, '/api/proxy/issue/labels', 200);
      res.json(data.issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issue/labels', status);
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

      // Build parent/subtask relationships
      const cardById = new Map(allIssues.map(i => [i.id, i]));
      const subtaskMap = new Map();
      for (const issue of allIssues) {
        if (issue.parentId && cardById.has(issue.parentId)) {
          const parent = cardById.get(issue.parentId);
          issue.parentIdentifier = parent.identifier;
          issue.parentTitle = parent.title;
          if (!subtaskMap.has(issue.parentId)) subtaskMap.set(issue.parentId, []);
          subtaskMap.get(issue.parentId).push({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            stateType: issue.stateType
          });
        }
      }
      for (const [parentId, children] of subtaskMap) {
        const parent = cardById.get(parentId);
        if (parent) parent.subtasks = children;
      }

      // Sort and cluster
      sortIssuesForSwipe(allIssues);
      const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

      // Trim to limit
      const tasks = sortedIssues.slice(0, limit).map(issue => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        url: issue.url,
        stateType: issue.stateType,
        stateName: issue.stateName,
        labels: issue.labels,
        projectName: issue.projectName,
        parentId: issue.parentId || null,
        parentIdentifier: issue.parentIdentifier || null,
        parentTitle: issue.parentTitle || null,
        subtasks: issue.subtasks || [],
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
      if (!UUID_REGEX.test(identifier) && !/^[A-Z]+-\d+$/i.test(identifier)) {
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
      if (!UUID_REGEX.test(identifier) && !/^[A-Z]+-\d+$/i.test(identifier)) {
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

      // Fetch issue context with two-tier support for parent tasks
      const context = await withTimeout(fetchRecommendationContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS);
      const { issue, parent, siblings, project, children, comments, focusedChild } = context;

      // Get AI-generated recommendation (uses session OAuth key or server-side OPENROUTER_API_KEY)
      // Uses a longer timeout since this makes a Linear API call + an OpenRouter LLM call.
      const recommendation = await withTimeout(
        getRecommendation(
          issue,
          { parent, siblings, project, children, comments, focusedChild },
          { apiKey: sessionApiKey, featureFlags: {} }
        ),
        MULTI_REQUEST_TIMEOUT_MS
      );

      logEvent(req, '/api/proxy/recommend', 200);
      res.json({
        identifier: issue.identifier,
        reasoning: recommendation.reasoning,
        prompt: recommendation.prompt,
        truncated: recommendation.truncated,
        repo: parseRepoFromDescription(project?.description)
      });
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
      if (!UUID_REGEX.test(identifier) && !/^[A-Z]+-\d+$/i.test(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const noRefresh = req.query.noRefresh === '1' || req.query.noRefresh === 'true';
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      let context;
      if (isTestMode) {
        context = await buildMockRecapContextFromFixtures(identifier);
        if (!context) {
          logEvent(req, '/api/proxy/recap', 404);
          return res.status(404).json({ error: 'Issue not found' });
        }
      } else {
        context = await withTimeout(fetchRecommendationContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS);
      }

      const canonicalId = context.issue?.id || identifier;
      const inputHash = hashContext(context);
      const cached = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

      if (cached && cached.inputHash === inputHash) {
        logEvent(req, '/api/proxy/recap', 200);
        return res.json({
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          recap: cached.recap,
          generatedAt: cached.generatedAt,
          model: cached.model
        });
      }

      if (noRefresh) {
        logEvent(req, '/api/proxy/recap', 200);
        return res.json({
          status: cached ? 'stale' : 'missing',
          identifier: context.issue?.identifier || identifier,
          generatedAt: cached?.generatedAt,
          model: cached?.model
        });
      }

      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      let recap;
      let modelUsed;
      if (isTestMode) {
        recap = buildMockRecapFromContext(context);
        modelUsed = DEFAULT_MODEL;
      } else {
        const result = await withTimeout(
          generateRecap(context.issue, context, { apiKey: sessionApiKey, model: DEFAULT_MODEL }),
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

      logEvent(req, '/api/proxy/recap', 200);
      res.json({
        status: 'fresh',
        identifier: context.issue?.identifier || identifier,
        recap: stored?.recap ?? recap,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
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
      console.error('Proxy /recap error:', err.message);
      res.status(status).json({ error: 'Failed to fetch recap', detail: graphqlErrorDetail(err) });
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
      if (!UUID_REGEX.test(identifier) && !/^[A-Z]+-\d+$/i.test(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return res.status(400).json({ error: 'Invalid identifier format' });
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
        logEvent(req, '/api/proxy/recap', 503);
        return res.status(503).json({ error: 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
      }

      let context;
      if (isTestMode) {
        context = await buildMockRecapContextFromFixtures(identifier);
        if (!context) {
          logEvent(req, '/api/proxy/recap', 404);
          return res.status(404).json({ error: 'Issue not found' });
        }
      } else {
        context = await withTimeout(fetchRecommendationContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS);
      }

      const canonicalId = context.issue?.id || identifier;
      const inputHash = hashContext(context);

      let recap;
      let modelUsed;
      if (isTestMode) {
        recap = buildMockRecapFromContext(context);
        modelUsed = DEFAULT_MODEL;
      } else {
        const result = await withTimeout(
          generateRecap(context.issue, context, { apiKey: sessionApiKey, model: DEFAULT_MODEL }),
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

      logEvent(req, '/api/proxy/recap', 200);
      res.json({
        status: 'fresh',
        identifier: context.issue?.identifier || identifier,
        recap: stored?.recap ?? recap,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
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

    const playbook = `# Foreman — Autonomous Task Runner

You are a foreman managing a Linear task stack. You work through tasks iteratively using curl to interact with the Linear proxy API.

## Setup

- Base URL: ${baseUrl}
- Auth header: Authorization: Bearer YOUR_TOKEN
- Your token needs \`readWrite\` scope — foreman workflows post status, comments, and sometimes state changes.
- Response shapes for every endpoint: \`GET ${baseUrl}/api/proxy/instructions\`.

All curl commands below need the auth header:
  -H "Authorization: Bearer YOUR_TOKEN"

## Loop

### 1. Choose a task

Fetch the stack:

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/stack?limit=5
\`\`\`

The stack is pre-sorted (bugs → started → unstarted → backlog, then priority; blockers before blocked; subtasks clustered with parents). Pick the top task. **The top may be a parent** — parents with incomplete subtasks are structure, not work. Descend to the first incomplete subtask; a parent doesn't have its own work unit. Skip completed/canceled.

### 2. Read + recap

Read the full task (description, comments, children, relations):

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/issue/{identifier}
\`\`\`

Then fetch the recap (auto-regenerates when stale):

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recap/{identifier}
\`\`\`

Returns \`{ status, recap: { done, pending, deviations } }\`. Read it before deciding anything — it is the ground truth for what's done, what's pending, and what deviated.

To force regeneration after you push new comments or status changes:

\`\`\`bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recap/{identifier}
\`\`\`

### 3. Follow the AI-recommended prompt

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recommend/{identifier}
\`\`\`

Returns \`{ reasoning, prompt, repo }\`. Read the \`reasoning\` to understand why this prompt was chosen, then spawn a sub-agent with the \`prompt\` content. The sub-agent does the actual work (research, planning, coding, review).

The recommender walks preparing → blocked/bug → plan → (implementation | breakdown) → review. The natural terminal step is \`review\` — when a clean review is the prompt returned and it comes back passing, the task is complete.

**Linear writes**: the generated prompt assumes the sub-agent can write to Linear (via MCP or the proxy itself). If it can't, treat its output as advisory and post the changes yourself via \`/api/proxy/issue/{identifier}/comments\`, \`PATCH /api/proxy/issue/{identifier}\`, etc.

### 4. When the sub-agent stops, decide

Re-fetch the recap (POST to force regeneration), then pick one branch:

**a. Resume** — sub-agent paused on an expected procedural step. Reply "yes, proceed" to the same prompt and continue. Safe resume cases:
- "Should I commit this?"
- "Should I push?"
- "Run the tests?"
- "Install the dependencies listed in package.json?"

Never auto-resume destructive actions (force-push, \`rm -rf\`, dropping data, deleting branches, removing files outside the task scope). Cap consecutive resumes on the same prompt at 3 — if the sub-agent keeps pausing without progress, escalate to "help".

**b. Continue** — current prompt finished cleanly, recap still shows pending work or unresolved deviations. Go back to step 3 for the next AI-recommended prompt.

**Review verdict takes precedence over recap.** The recap lags by one Linear write, so when the last prompt was \`review\`, read the verdict in the sub-agent's output directly:
- **Approve** → go to 4.c (complete)
- **Request Changes** → go to 4.b (continue — recommender will likely return \`implementation\`)
- **Needs Discussion** → go to 4.d (help)

**c. Complete** — verdict is Approve, and recap \`pending\` is empty with no unresolved deviations. **Verify before declaring complete**: re-fetch \`GET /api/proxy/issue/{identifier}\` and confirm the expected terminal state actually landed (status moved out of In Review / In Progress, summary comment exists). If the sub-agent said it updated Linear but the issue doesn't reflect it, drop to 4.d (help) instead. Otherwise post a completion status and go back to step 1.

**d. Help** — real blocker, unresolved deviation the agent can't address, ambiguous requirements, \`review\` returned "Needs Discussion", 3+ consecutive resumes without progress, or \`/recommend\` returned the same prompt type 3 times in a row (suspected implementation ↔ review loop). Post a status with a clear summary of the recap + recommended prompt + blocker, and STOP.

## Updating Linear

Comment bodies often contain markdown with backticks, quotes, and special characters. Always write JSON bodies to a file to avoid shell escaping issues:

\`\`\`bash
cat > /tmp/comment.json << 'PAYLOAD'
{"body":"## Research Findings\\n\\nFound issues in \`auth.js\` and \`proxy.js\`.\\n\\n- Fix applied in commit abc123"}
PAYLOAD

curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d @/tmp/comment.json \\
  ${baseUrl}/api/proxy/issue/{identifier}/comments
\`\`\`

Simple fields are fine inline:

\`\`\`bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"teamId":"...","title":"Subtask title","parentId":"..."}' \\
  ${baseUrl}/api/proxy/issues
\`\`\`

## Reporting status

Report after each decision (resume, continue, complete, help):

\`\`\`bash
cat > /tmp/status.json << 'PAYLOAD'
{"taskIdentifier":"LIN-42","action":"research","status":"completed","summary":"Found 3 API endpoints needing auth fixes"}
PAYLOAD

curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d @/tmp/status.json \\
  ${baseUrl}/api/proxy/foreman/status
\`\`\`

\`action\` values: \`resume\`, \`continue\`, \`complete\`, \`help\`, or the prompt name (\`research\`, \`plan\`, \`implementation\`, \`review\`, etc.).

**Optional: \`dispatchId\` for exact loop tracking.** If you claimed this task via \`POST /api/dispatch/take/{itemId}\`, pass that same \`itemId\` as \`dispatchId\`. This lets loop reconstruction join your status to the exact dispatch item instead of guessing by timestamp. Omit when not applicable.

## Stop conditions

- External dependency (waiting on another person/team)
- Ambiguous requirements that need human judgment
- 3+ consecutive resumes without progress on the same prompt
- \`/recommend\` returns the same prompt type 3 times in a row on the same task
- Sub-agent claimed a Linear write that didn't actually land (see 4.c)
- Destructive action needed (deleting data, force-pushing)
- No more tasks in the stack

When you stop, post a final status update with a clear summary of the recap and what you need.
`;

    res.type('text/plain').send(playbook);
  });

  return router;
}
