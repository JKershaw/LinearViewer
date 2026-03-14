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
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID } from '../lib/tree.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent } from '../lib/render-swipe.js';
import { generatePrompt, hasPrompt, getAvailablePrompts } from '../lib/prompt-templates.js';
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
        labels { nodes { name } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
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
        labels { nodes { name } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
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
      labels { nodes { name } }
      priority
      estimate
      dueDate
      createdAt
      completedAt
      project { id name }
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
        labels { nodes { name } }
        project { id name }
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
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Function} options.getWorkspaceAccessToken - Function to get workspace access token by urlKey
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, foremanStore, workspaceFromUrl, getWorkspaceAccessToken }) {
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
   */
  async function getClient(urlKey) {
    const accessToken = await getWorkspaceAccessToken(urlKey);
    if (!accessToken) {
      return null;
    }
    const clientOptions = { headers: { Authorization: accessToken } };
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
        singleUse: singleUse === true || singleUse === 'true'
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
  → List labels (optionally filter by team)

GET ${baseUrl}/api/proxy/relations/{issueId}
  → Get issue relations (blocks, blocked-by, related, duplicate)

## Foreman Endpoints

GET ${baseUrl}/api/proxy/stack?limit={n}
  → Sorted task stack (default 5, max 50) with available prompts per task

GET ${baseUrl}/api/proxy/prompt/{identifier}/{templateKey}
  → Generate a prompt for an issue (e.g., /prompt/LIN-42/research)

GET ${baseUrl}/api/proxy/recommend/{identifier}
  → AI-generated prompt recommendation for an issue (requires OPENROUTER_API_KEY on server)

GET ${baseUrl}/api/proxy/foreman/status
  → List recent foreman status entries

GET ${baseUrl}/api/proxy/foreman/playbook
  → Get the foreman playbook prompt (plain text)`;

    const writeEndpoints = scope === 'readWrite' ? `

## Write Endpoints

POST ${baseUrl}/api/proxy/issues
  Body: { "teamId": "...", "title": "...", "description": "...", "projectId": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4 }
  → Create a new issue

PATCH ${baseUrl}/api/proxy/issue/{issueId}
  Body: { "title": "...", "description": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4 }
  → Update an existing issue

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
  Body: { "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "..." }
  → Record a foreman status update` : '';

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

      const { teamId, title, description, projectId, stateId, assigneeId, priority, parentId } = req.body;

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

      const { title, description, stateId, assigneeId, priority, projectId, parentId } = req.body;

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
        ({ projects, issues } = await fetchProjects(accessToken));
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

      // Add available prompts and trim to limit
      const tasks = sortedIssues.slice(0, limit).map(issue => {
        // Build a minimal issue object for getAvailablePrompts
        const issueForPrompts = {
          labels: { nodes: (issue.labels || []).map(name => ({ name })) },
          state: { type: issue.stateType }
        };
        return {
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
          blocksIds: issue.blocksIds || [],
          availablePrompts: getAvailablePrompts(issueForPrompts)
        };
      });

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
        ({ issue, parent, siblings, project, children, comments } = await fetchIssueContext(accessToken, identifier));
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
   * Uses the server-side OPENROUTER_API_KEY (no session needed).
   */
  router.get('/api/proxy/recommend/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const accessToken = await getWorkspaceAccessToken(req.proxyUrlKey);
      if (!accessToken) {
        logEvent(req, '/api/proxy/recommend', 503);
        return res.status(503).json({ error: 'Workspace not available' });
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // Check if AI recommendations are available (skip in test mode)
      if (!isTestMode && !isRecommendationEnabled()) {
        logEvent(req, '/api/proxy/recommend', 503);
        return res.status(503).json({ error: 'AI recommendations not configured. Set OPENROUTER_API_KEY on the server.' });
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
      const context = await fetchRecommendationContext(accessToken, identifier);
      const { issue, parent, siblings, project, children, comments, focusedChild } = context;

      // Get AI-generated recommendation (uses server-side OPENROUTER_API_KEY)
      const recommendation = await getRecommendation(
        issue,
        { parent, siblings, project, children, comments, focusedChild },
        { featureFlags: {} }
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
   * POST /api/proxy/foreman/status
   * Record a foreman status update.
   */
  router.post('/api/proxy/foreman/status', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { taskIdentifier, action, status, summary } = req.body;

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
        summary
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
   * List recent foreman status entries.
   */
  router.get('/api/proxy/foreman/status', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const result = await foremanStore.listStatus(req.proxyUrlKey, { limit, offset });

      logEvent(req, '/api/proxy/foreman/status', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/foreman/status', 500);
      console.error('Foreman status list error:', err.message);
      res.status(500).json({ error: 'Failed to list status' });
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

All curl commands below need the auth header:
  -H "Authorization: Bearer YOUR_TOKEN"

## Loop

### 1. Fetch the stack

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/stack?limit=5
\`\`\`

Returns the top tasks sorted by priority, blocking dependencies, and parent-child clustering.

### 2. Pick the next task

- If the top task has incomplete subtasks, work on the first incomplete subtask instead
- Skip completed/canceled tasks
- The stack is pre-sorted: bugs first, then by state (started → unstarted → backlog), then by priority
- Blocking issues appear before the issues they block

### 3. Get the prompt

**Option A — AI recommendation** (recommended, adapts to task context):

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recommend/{identifier}
\`\`\`

Returns \`{ reasoning, prompt, repo }\`. The AI analyzes the task and generates the right prompt automatically.
Read the \`reasoning\` to understand why it chose that approach, then use the \`prompt\`.

**Option B — Template prompt** (deterministic, you choose the template):

Each task in the stack includes \`availablePrompts\` — an array of valid template keys.
Select based on task state:
- New/unstarted → \`research\` or \`look-into\`
- Needs breakdown → \`breakdown\`
- Ready for planning → \`plan\`
- Has a plan → \`implementation\`
- Implementation done → \`review\`
- Bug-labeled → \`bug\`

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/prompt/{identifier}/{templateKey}
\`\`\`

Returns \`{ prompt, promptName, repo }\`.

### 4. Execute the prompt

Use the Agent tool to spawn a sub-agent with the prompt content.
The sub-agent does the actual work (research, coding, review).

### 5. Update Linear

Based on the result:

**Research/Plan:**
\`\`\`bash
# Add findings as a comment
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"body":"## Research Findings\\n\\n..."}' \\
  ${baseUrl}/api/proxy/issue/{issueId}/comments

# Create subtasks if warranted
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"teamId":"...","title":"Subtask title","parentId":"..."}' \\
  ${baseUrl}/api/proxy/issues
\`\`\`

**Implementation:**
\`\`\`bash
# Add summary comment
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"body":"## Implementation Summary\\n\\n..."}' \\
  ${baseUrl}/api/proxy/issue/{issueId}/comments
\`\`\`

**Review:**
\`\`\`bash
# Add review findings
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"body":"## Review\\n\\n..."}' \\
  ${baseUrl}/api/proxy/issue/{issueId}/comments
\`\`\`

### 6. Report status

\`\`\`bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"taskIdentifier":"LIN-42","action":"research","status":"completed","summary":"Found 3 API endpoints needing auth fixes"}' \\
  ${baseUrl}/api/proxy/foreman/status
\`\`\`

### 7. Decide next action

- Same task needs follow-up? (research → plan → implement → review) → go to step 3
- Task complete? → go to step 1 for next task
- Hit a blocker? → comment on issue, report status, STOP and notify user

## Stop conditions

- External dependency (waiting on another person/team)
- Ambiguous requirements that need human judgment
- 3+ consecutive failures on the same task
- Destructive action needed (deleting data, force-pushing)
- No more tasks in the stack

When you stop, post a final status update explaining why.
`;

    res.type('text/plain').send(playbook);
  });

  return router;
}
