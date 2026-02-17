/**
 * Workspace-prefixed API routes.
 *
 * Handles all /workspace/:urlKey/api/* endpoints:
 * - Audit: Run workspace audit
 * - Prompts: Generate handwritten prompts
 * - Recommendations: AI-generated prompts via OpenRouter
 * - Comments: Fetch issue comments
 * - Images: Proxy Linear-hosted images with auth
 */
import { Router } from 'express';
import { fetchIssueContext, fetchRecommendationContext, fetchIssueComments } from '../lib/linear.js';
import { generatePrompt, hasPrompt, getAvailablePrompts } from '../lib/prompt-templates.js';
import { PREPARING_LABEL, WORK_ISSUE_LABELS } from '../lib/workflow-config.js';
import { parseRepoFromDescription } from '../lib/prompt-formatters.js';
import { isRecommendationEnabled, getRecommendation, getRecommendationStream, DEFAULT_MODEL } from '../lib/openrouter.js';
import { runAudit, computeAuditFromData } from '../lib/audit.js';
import { UUID_REGEX } from '../lib/workspace.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { testMockTeams, testMockData } from '../tests/fixtures/mock-data.js';

/**
 * Create workspace API routes with required dependencies.
 * @param {Object} options
 * @param {Function} options.workspaceFromUrl - Middleware to extract workspace from URL
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Function} options.getOpenRouterSource - Helper to determine OpenRouter source
 * @returns {Router} Express router
 */
export function createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource }) {
  const router = Router();

  // ===========================================================================
  // Audit API
  // ===========================================================================

  /**
   * Audit API endpoint - runs a workspace audit and returns JSON.
   * Requires authentication.
   */
  router.get('/workspace/:urlKey/api/audit', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    try {
      // Use mock audit data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockAuditData = {
          teams: testMockTeams,
          projects: testMockData.projects.map(p => ({ ...p, state: 'started' })),
          workflowStates: [
            { id: 'ws1', name: 'Backlog', type: 'backlog', team: { id: 'team1', name: 'Test Team' } },
            { id: 'ws2', name: 'In Progress', type: 'started', team: { id: 'team1', name: 'Test Team' } },
            { id: 'ws3', name: 'Done', type: 'completed', team: { id: 'team1', name: 'Test Team' } }
          ],
          labels: [
            { id: 'l1', name: 'breakdown', color: '#000', issues: { nodes: [{ id: 'i1' }] } },
            { id: 'l2', name: 'ready', color: '#000', issues: { nodes: [{ id: 'i2' }, { id: 'i3' }] } },
            { id: 'l3', name: 'bug', color: '#f00', issues: { nodes: [] } }
          ],
          issues: testMockData.issues.map(i => ({
            ...i,
            labels: { nodes: [] }
          }))
        };
        const report = computeAuditFromData(mockAuditData);
        return res.json(report);
      }

      const report = await runAudit(workspace.accessToken);
      res.json(report);
    } catch (error) {
      console.error('Audit error:', error);

      // Handle 401 from Linear API
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }

      res.status(500).json({ error: 'Audit failed', message: error.message });
    }
  });

  // ===========================================================================
  // Prompt Generation API
  // ===========================================================================

  /**
   * Generate a prompt for a specific issue and label.
   * Returns a prompt that can be copied and used with Claude Code + Linear MCP.
   *
   * @route GET /workspace/:urlKey/api/prompt/:issueId/:labelName
   * @param {string} issueId - The Linear issue ID
   * @param {string} labelName - The label name (must have a prompt template)
   * @returns {Object} { label, promptName, prompt } or error
   */
  router.get('/workspace/:urlKey/api/prompt/:issueId/:labelName', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace

    const { issueId, labelName } = req.params

    // Validate issue ID format (must be valid UUID)
    if (!UUID_REGEX.test(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    // Check if label has a prompt template
    if (!hasPrompt(labelName)) {
      return res.status(404).json({ error: `No prompt template for label: ${labelName}` })
    }

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }

        // Extract identifier from URL (e.g., https://linear.app/test/issue/TEST-6 -> TEST-6)
        const identifier = mockIssue.url.split('/').pop()

        // Find project for the mock issue
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)

        // Extract labels as array of strings
        const labels = (mockIssue.labels?.nodes || []).map(l => l.name)

        // Find parent issue if exists
        const mockParent = mockIssue.parent
          ? testMockData.issues.find(i => i.id === mockIssue.parent.id)
          : null

        // Find siblings (other children of same parent)
        const mockSiblings = mockParent
          ? testMockData.issues
              .filter(i => i.parent?.id === mockParent.id && i.id !== issueId)
              .slice(0, 5)
              .map(s => ({
                id: s.id,
                identifier: s.url.split('/').pop(),
                title: s.title,
                state: s.state
              }))
          : []

        // Find children of this issue
        const mockChildren = testMockData.issues
          .filter(i => i.parent?.id === issueId)
          .map(c => ({
            id: c.id,
            identifier: c.url.split('/').pop(),
            title: c.title,
            state: c.state
          }))

        const result = generatePrompt(labelName, {
          ...mockIssue,
          identifier,
          labels
        }, {
          parent: mockParent ? {
            id: mockParent.id,
            identifier: mockParent.url.split('/').pop(),
            title: mockParent.title,
            state: mockParent.state
          } : null,
          siblings: mockSiblings,
          project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
          children: mockChildren
        }, getFeatureFlags(req.session))

        const mockProjectDescription = mockProject?.content || null
        return res.json({
          label: labelName,
          promptName: result.name,
          prompt: result.prompt,
          repo: parseRepoFromDescription(mockProjectDescription)
        })
      }

      // Fetch issue context from Linear
      const { issue, parent, siblings, project, children, comments } = await fetchIssueContext(workspace.accessToken, issueId)

      // Generate the prompt
      const result = generatePrompt(labelName, issue, { parent, siblings, project, children, comments }, getFeatureFlags(req.session))

      if (!result) {
        return res.status(500).json({ error: 'Failed to generate prompt' })
      }

      res.json({
        label: labelName,
        promptName: result.name,
        prompt: result.prompt,
        repo: parseRepoFromDescription(project?.description)
      })
    } catch (error) {
      console.error('Prompt generation error:', error)

      // Handle 401 from Linear API
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }

      // Handle issue not found
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }

      res.status(500).json({ error: 'Failed to generate prompt', message: error.message })
    }
  })

  // ===========================================================================
  // AI Recommendation API
  // ===========================================================================

  /**
   * Check if recommendation feature is available.
   * Returns feature availability status.
   *
   * @route GET /workspace/:urlKey/api/recommend/status
   * @returns {Object} { enabled: boolean }
   */
  router.get('/workspace/:urlKey/api/recommend/status', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace

    // In test mode, always report as enabled for testing
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
    const sessionApiKey = req.session.openRouterApiKey
    const source = getOpenRouterSource(req)

    const enabled = isTestMode || isRecommendationEnabled(sessionApiKey) || source === 'free'

    const result = { enabled, source }

    // Include free tier usage info when applicable
    if (source === 'free') {
      const usage = await freeTierStore.getUsage(workspace.urlKey)
      result.freeTier = usage
    }

    res.json(result)
  })

  /**
   * Get AI-generated prompt for a task.
   * Analyzes task context and generates a tailored prompt.
   *
   * @route GET /workspace/:urlKey/api/recommend/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { reasoning, prompt } or error
   */
  router.get('/workspace/:urlKey/api/recommend/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace

    const { issueId } = req.params

    // Validate issue ID format (must be valid UUID)
    if (!UUID_REGEX.test(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    // Check if feature is enabled (except in test mode)
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
    const sessionApiKey = req.session.openRouterApiKey
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey
    if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return res.status(503).json({ error: 'AI recommendation feature is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.' })
    }

    // Atomically check rate limits and record usage before proceeding
    if (!isTestMode && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey)
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: {
            used: true,
            remaining: check.remaining,
            limit: check.limit,
            resetsAt: check.resetsAt
          }
        })
      }
    }

    try {
      // Use mock data in test mode
      if (isTestMode) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }

        // Atomically check free tier limits and record usage in test mode
        const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !process.env.OPENROUTER_API_KEY
        if (testIsFreeTier) {
          const check = await freeTierStore.tryUse(workspace.urlKey)
          if (!check.allowed) {
            return res.status(429).json({
              error: check.reason,
              freeTier: {
                used: true,
                remaining: check.remaining,
                limit: check.limit,
                resetsAt: check.resetsAt
              }
            })
          }
        }

        // Generate a mock prompt based on the issue
        const labels = (mockIssue.labels?.nodes || []).map(l => l.name)
        let reasoning = 'Start by getting an overview of what this task involves before deciding on the next steps.'
        let goal = 'Summarize what this task involves and how it fits into the broader project context.'

        // Provide contextual mock prompts based on labels (simplified 3-label system)
        if (labels.includes(PREPARING_LABEL)) {
          reasoning = 'This task needs preparation before implementation. Research, breakdown, or design work is needed.'
          goal = 'Complete the necessary preparation work so this task is ready for implementation.'
        } else if (labels.includes(WORK_ISSUE_LABELS.BLOCKED)) {
          reasoning = 'This task is blocked. Analyzing the blocker will help identify ways to unblock progress.'
          goal = 'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path.'
        } else if (labels.includes(WORK_ISSUE_LABELS.BUG)) {
          reasoning = 'This is a bug. Investigating the issue systematically will help find the root cause and fix.'
          goal = 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.'
        } else if (mockIssue.state?.type === 'backlog' || mockIssue.state?.type === 'unstarted') {
          reasoning = 'This task is ready to start. Creating an implementation plan will provide a clear path forward.'
          goal = 'Research the codebase, identify files to modify, and create a step-by-step implementation plan.'
        }

        // Build the mock prompt
        // Extract identifier from URL (e.g., "https://linear.app/test/issue/TEST-6" -> "TEST-6")
        const identifier = mockIssue.url?.split('/').pop() || 'ISSUE'

        const prompt = `Help me with task ${identifier}

## Context

**Project:** Test Project
**Status:** ${mockIssue.state?.name || 'Unknown'}
${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}

## Goal

${goal}`

        const mockRecommendProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const result = {
          reasoning,
          prompt,
          truncated: false,
          completionTokens: null,
          issueUrl: mockIssue.url,
          repo: parseRepoFromDescription(mockRecommendProject?.content)
        }

        // Include free tier metadata in test mode
        if (testIsFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey)
          result.freeTier = {
            used: true,
            remaining: usage.remaining,
            limit: usage.limit,
            resetsAt: usage.resetsAt
          }
        }

        return res.json(result)
      }

      // Fetch issue context from Linear (uses two-tier context for parent tasks)
      const context = await fetchRecommendationContext(workspace.accessToken, issueId)
      const { issue, parent, siblings, project, children, comments, focusedChild } = context

      // Get AI-generated prompt (pass session API key, free tier key, and model if available)
      const selectedModel = req.session.modelId || DEFAULT_MODEL
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)
      const recommendation = await getRecommendation(issue, { parent, siblings, project, children, comments, focusedChild }, { apiKey: apiKeyToUse, model: selectedModel, featureFlags: getFeatureFlags(req.session) })

      const result = {
        reasoning: recommendation.reasoning,
        prompt: recommendation.prompt,
        truncated: recommendation.truncated,
        completionTokens: recommendation.completionTokens,
        issueUrl: issue.url,
        repo: parseRepoFromDescription(project?.description)
      }

      // Include free tier metadata
      if (isFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey)
        result.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        }
      }

      res.json(result)
    } catch (error) {
      console.error('Recommendation error:', error)

      // Handle 401 from Linear API
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }

      // Handle issue not found
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }

      // Handle OpenRouter errors
      if (error.message?.includes('OpenRouter')) {
        return res.status(503).json({ error: 'AI service temporarily unavailable', message: error.message })
      }

      res.status(500).json({ error: 'Failed to get recommendation', message: error.message })
    }
  })

  // ===========================================================================
  // AI Recommendation Streaming API (SSE)
  // ===========================================================================

  /**
   * Helper: write an SSE event to the response.
   * @param {Object} res - Express response
   * @param {string} type - Event type
   * @param {Object} data - Event data (will be JSON-stringified)
   */
  function sendSSE(res, type, data) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Generate mock recommendation content for test mode.
   * Shared logic between streaming and non-streaming endpoints.
   */
  function generateMockRecommendation(mockIssue) {
    const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
    let reasoning = 'Start by getting an overview of what this task involves before deciding on the next steps.';
    let goal = 'Summarize what this task involves and how it fits into the broader project context.';

    if (labels.includes(PREPARING_LABEL)) {
      reasoning = 'This task needs preparation before implementation. Research, breakdown, or design work is needed.';
      goal = 'Complete the necessary preparation work so this task is ready for implementation.';
    } else if (labels.includes(WORK_ISSUE_LABELS.BLOCKED)) {
      reasoning = 'This task is blocked. Analyzing the blocker will help identify ways to unblock progress.';
      goal = 'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path.';
    } else if (labels.includes(WORK_ISSUE_LABELS.BUG)) {
      reasoning = 'This is a bug. Investigating the issue systematically will help find the root cause and fix.';
      goal = 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.';
    } else if (mockIssue.state?.type === 'backlog' || mockIssue.state?.type === 'unstarted') {
      reasoning = 'This task is ready to start. Creating an implementation plan will provide a clear path forward.';
      goal = 'Research the codebase, identify files to modify, and create a step-by-step implementation plan.';
    }

    const identifier = mockIssue.url?.split('/').pop() || 'ISSUE';

    const prompt = `Help me with task ${identifier}

## Context

**Project:** Test Project
**Status:** ${mockIssue.state?.name || 'Unknown'}
${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}

## Goal

${goal}`;

    return { reasoning, prompt, identifier };
  }

  /**
   * Stream AI-generated prompt for a task via Server-Sent Events.
   * Delivers content incrementally with phase indicators.
   *
   * LIN-185: Streaming endpoint for dynamic AI suggestion UX.
   *
   * @route GET /workspace/:urlKey/api/recommend/:issueId/stream
   * @param {string} issueId - The Linear issue ID
   * @returns SSE stream with phase, delta, done, and error events
   */
  router.get('/workspace/:urlKey/api/recommend/:issueId/stream', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    // --- Pre-flight validation (regular HTTP errors) ---

    if (!UUID_REGEX.test(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }

    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;

    if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return res.status(503).json({ error: 'AI recommendation feature is not configured.' });
    }

    // Rate limiting (before streaming starts)
    if (!isTestMode && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt }
        });
      }
    }

    // --- Test mode: mock streaming ---

    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId);
      if (!mockIssue) {
        return res.status(404).json({ error: 'Issue not found' });
      }

      // Free tier check in test mode
      const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !process.env.OPENROUTER_API_KEY;
      if (testIsFreeTier) {
        const check = await freeTierStore.tryUse(workspace.urlKey);
        if (!check.allowed) {
          return res.status(429).json({
            error: check.reason,
            freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt }
          });
        }
      }

      const { reasoning, prompt } = generateMockRecommendation(mockIssue);
      const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id);

      // Start SSE
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders();

      // Emit phases and deltas
      sendSSE(res, 'phase', { phase: 'fetching_context' });

      // Split into multiple chunks to test assembly
      sendSSE(res, 'phase', { phase: 'reasoning' });
      const reasoningMid = Math.floor(reasoning.length / 2);
      sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(0, reasoningMid) });
      sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(reasoningMid) });

      sendSSE(res, 'phase', { phase: 'prompt' });
      const promptMid = Math.floor(prompt.length / 2);
      sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(0, promptMid) });
      sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(promptMid) });

      // Done event with metadata
      const doneData = {
        truncated: false,
        completionTokens: null,
        issueUrl: mockIssue.url,
        repo: parseRepoFromDescription(mockProject?.content)
      };

      if (testIsFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey);
        doneData.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        };
      }

      sendSSE(res, 'done', doneData);
      res.end();
      return;
    }

    // --- Production mode: real streaming ---

    // Start SSE
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    // Track client disconnection
    const abortController = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      abortController.abort();
    });

    try {
      // Phase 1: Fetch context from Linear
      sendSSE(res, 'phase', { phase: 'fetching_context' });
      const context = await fetchRecommendationContext(workspace.accessToken, issueId);
      const { issue, parent, siblings, project, children, comments, focusedChild } = context;

      if (closed) return;

      // Phase 2: Stream AI recommendation
      const selectedModel = req.session.modelId || DEFAULT_MODEL;
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);

      await getRecommendationStream(
        issue,
        { parent, siblings, project, children, comments, focusedChild },
        {
          apiKey: apiKeyToUse,
          model: selectedModel,
          featureFlags: getFeatureFlags(req.session),
          signal: abortController.signal
        },
        (type, data) => {
          if (closed) return;
          sendSSE(res, type, data);
        }
      );

      if (closed) return;

      // Amend done event with additional metadata
      const doneData = {
        issueUrl: issue.url,
        repo: parseRepoFromDescription(project?.description)
      };

      if (isFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey);
        doneData.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        };
      }

      // The getRecommendationStream already emits a 'done' event with truncated/completionTokens.
      // Send an additional metadata event with issueUrl, repo, freeTier.
      sendSSE(res, 'metadata', doneData);
    } catch (error) {
      if (closed) return;
      console.error('Streaming recommendation error:', error);
      sendSSE(res, 'error', { error: error.message });
    } finally {
      if (!closed) res.end();
    }
  });

  // ===========================================================================
  // Comments API
  // ===========================================================================

  /**
   * Fetch comments for a specific issue.
   * LIN-156: Lightweight endpoint for fetching issue comments.
   *
   * @route GET /workspace/:urlKey/api/comments/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { comments: Array<{id, body, createdAt, user}> }
   */
  router.get('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    // Validate issue ID format (must be valid UUID)
    if (!issueId || !UUID_REGEX.test(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    try {
      // Use mock data in test mode
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
      if (isTestMode) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }
        // Return mock comments for test mode
        return res.json({
          comments: [
            { id: 'comment-1', body: 'This is a test comment with **markdown**.', createdAt: '2024-01-15T10:00:00Z', user: 'Alice' },
            { id: 'comment-2', body: 'Second comment with `code`.', createdAt: '2024-01-16T14:30:00Z', user: 'Bob' }
          ]
        })
      }

      const comments = await fetchIssueComments(workspace.accessToken, issueId)
      res.json({ comments })
    } catch (error) {
      console.error('Comments fetch error:', error)

      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }

      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }

      res.status(500).json({ error: 'Failed to fetch comments', message: error.message })
    }
  })

  // ===========================================================================
  // Image Proxy API
  // ===========================================================================

  /**
   * Proxy image requests to Linear with authentication.
   * LIN-156: Linear-hosted images require auth headers that browsers can't add to img src.
   *
   * @route GET /workspace/:urlKey/api/image
   * @query {string} url - The Linear image URL to fetch
   * @returns {Stream} Image data with appropriate content-type
   */
  router.get('/workspace/:urlKey/api/image', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const imageUrl = req.query.url

    // Validate URL
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing url parameter' })
    }

    // Only allow HTTPS URLs (security)
    if (!imageUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid image URL: must be HTTPS' })
    }

    // Only allow Linear-hosted images (security - prevent SSRF)
    // Use exact hostname matching to prevent bypass via evillinear.app
    const allowedHosts = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app'])
    let urlObj
    try {
      urlObj = new URL(imageUrl)
      if (!allowedHosts.has(urlObj.hostname)) {
        return res.status(400).json({ error: 'Invalid image URL: must be from Linear' })
      }
      // Prevent path traversal attacks
      if (urlObj.pathname.includes('..')) {
        return res.status(400).json({ error: 'Invalid image URL: path traversal not allowed' })
      }
    } catch {
      return res.status(400).json({ error: 'Invalid image URL format' })
    }

    // Max image size: 10MB to prevent memory exhaustion
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024

    try {
      const response = await fetch(imageUrl, {
        headers: {
          Authorization: `Bearer ${workspace.accessToken}`
        },
        // Prevent redirects that could bypass SSRF protection
        redirect: 'error'
      })

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch image' })
      }

      // Validate content-type is an image (prevent serving HTML/JS through proxy)
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'Invalid response: not an image' })
      }

      // Check content-length if available
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_IMAGE_SIZE) {
        return res.status(413).json({ error: 'Image too large' })
      }

      // Read response with size limit
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
        return res.status(413).json({ error: 'Image too large' })
      }

      res.set('Content-Type', contentType)
      res.set('Cache-Control', 'private, max-age=3600')
      res.send(Buffer.from(arrayBuffer))
    } catch (error) {
      // Handle redirect errors specifically
      if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
        return res.status(400).json({ error: 'Redirects not allowed' })
      }
      console.error('Image proxy error:', error)
      res.status(500).json({ error: 'Failed to fetch image' })
    }
  })

  return router;
}
