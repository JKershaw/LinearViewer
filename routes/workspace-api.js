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
import { fetchIssueContext, fetchRecommendationContext, fetchIssueComments, fetchProjects } from '../lib/linear.js';
import { buildRoadmapModel } from '../lib/roadmap.js';
import { buildRoadmapNarrativeMessages } from '../lib/prompts/roadmap-narrative-template.js';
import { buildRoadmapProductMessages } from '../lib/prompts/roadmap-product-template.js';
import { buildRoadmapTrajectoryMessages } from '../lib/prompts/roadmap-trajectory-template.js';
import { buildRoadmapNorthStarMessages } from '../lib/prompts/roadmap-north-star-template.js';
import { buildRoadmapGapMessages } from '../lib/prompts/roadmap-gap-template.js';
import { buildRoadmapDigestMessages } from '../lib/prompts/roadmap-digest-template.js';
import { buildRoadmapOrientationMessages, serializeOrientationCandidates, countOrientationCandidates, parseOrientationLines, ORIENTATION_BEARINGS } from '../lib/prompts/roadmap-orientation-template.js';
import { generatePrompt, generateCustomPrompt, hasPrompt, getAvailablePrompts } from '../lib/prompt-templates.js';
import { WORK_ISSUE_LABELS } from '../lib/workflow-config.js';
import { parseRepoFromDescription } from '../lib/prompt-formatters.js';
import { buildForemanPlaybook, buildMiniForemanStep } from '../lib/prompts/foreman-playbook.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { isRecommendationEnabled, getRecommendation, getRecommendationStream, streamChat } from '../lib/openrouter.js';
import { resolveRecommendation } from '../lib/recommend-recurse.js';

// Shared cross-hop budget for the recommend recursion (LIN-329) on the human UI
// path. Matches the proxy's budget; defer hops are cheap (no prompt body) so a deep
// descent stays well inside it. Checked between hops by resolveRecommendation.
const RECOMMEND_DESCENT_BUDGET_MS = 180_000;
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { getLoopsForIssue } from '../lib/pipeline-loops.js';
import { toSessionView } from '../lib/sessions-view.js';
import { runAudit, computeAuditFromData } from '../lib/audit.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { isTerminalState } from '../lib/tree.js';
import { testMockTeams, testMockData } from '../tests/fixtures/mock-data.js';

/**
 * Create workspace API routes with required dependencies.
 * @param {Object} options
 * @param {Function} options.workspaceFromUrl - Middleware to extract workspace from URL
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Function} options.getOpenRouterSource - Helper to determine OpenRouter source
 * @returns {Router} Express router
 */
export function createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, foremanStore }) {
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

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    // Check if this is a custom prompt request (format: custom:promptId)
    const isCustomPrompt = labelName.startsWith('custom:');

    // Check if label has a prompt template (unless it's a custom prompt)
    if (!isCustomPrompt && !hasPrompt(labelName)) {
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

        const mockContext = {
          parent: mockParent ? {
            id: mockParent.id,
            identifier: mockParent.url.split('/').pop(),
            title: mockParent.title,
            state: mockParent.state
          } : null,
          siblings: mockSiblings,
          project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
          children: mockChildren
        };

        const issueObj = { ...mockIssue, identifier, labels };
        let result;

        if (isCustomPrompt) {
          const customPromptId = labelName.slice('custom:'.length);
          const customPromptDef = await customPromptsStore.get(req.workspace.urlKey, customPromptId);
          if (!customPromptDef) {
            return res.status(404).json({ error: 'Custom prompt not found' });
          }
          result = generateCustomPrompt(customPromptDef, issueObj, mockContext, getFeatureFlags(req.session));
        } else {
          result = generatePrompt(labelName, issueObj, mockContext, getFeatureFlags(req.session));
        }

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
      let result;
      if (isCustomPrompt) {
        const customPromptId = labelName.slice('custom:'.length);
        const customPromptDef = await customPromptsStore.get(req.workspace.urlKey, customPromptId);
        if (!customPromptDef) {
          return res.status(404).json({ error: 'Custom prompt not found' });
        }
        result = generateCustomPrompt(customPromptDef, issue, { parent, siblings, project, children, comments }, getFeatureFlags(req.session));
      } else {
        result = generatePrompt(labelName, issue, { parent, siblings, project, children, comments }, getFeatureFlags(req.session));
      }

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
  // Foreman Prompt API
  // ===========================================================================

  /**
   * Generate a foreman playbook pinned to a specific issue.
   *
   * The unparameterized playbook is still served at /api/proxy/foreman/playbook
   * for external agents. This endpoint is the in-app entry point: it targets a
   * single issue so the user can copy or dispatch a focused run.
   *
   * Gated on the proxy feature flag because the playbook instructs the agent
   * to use proxy endpoints exclusively.
   *
   * @route GET /workspace/:urlKey/api/foreman-prompt/:issueId
   * @param {string} issueId - The Linear issue ID (UUID)
   * @returns {Object} { label, promptName, prompt, repo } or error
   */
  router.get('/workspace/:urlKey/api/foreman-prompt/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return res.status(403).json({ error: 'Proxy feature is not enabled' })
    }

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }
        const identifier = mockIssue.url?.split('/').pop() || ''
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const prompt = buildForemanPlaybook({
          baseUrl,
          issue: { identifier, title: mockIssue.title },
          features: { linearMcp: featureFlags.linearMcp === true }
        })
        return res.json({
          label: 'foreman',
          promptName: `Foreman run — ${identifier}`,
          prompt,
          repo: parseRepoFromDescription(mockProject?.content || null)
        })
      }

      const { issue, project } = await fetchIssueContext(workspace.accessToken, issueId)
      const prompt = buildForemanPlaybook({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        features: { linearMcp: featureFlags.linearMcp === true }
      })
      res.json({
        label: 'foreman',
        promptName: `Foreman run — ${issue.identifier}`,
        prompt,
        repo: parseRepoFromDescription(project?.description)
      })
    } catch (error) {
      console.error('Foreman prompt error:', error)
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }
      res.status(500).json({ error: 'Failed to generate foreman prompt', message: error.message })
    }
  })

  /**
   * Generate a mini-foreman step pinned to a specific issue.
   *
   * Mirrors /workspace/:urlKey/api/foreman-prompt/:issueId but returns a
   * single-iteration instruction block that tells the agent to fetch the
   * freshest /api/proxy/recommend/{identifier} response and execute it once.
   * No loop, no role recitation — a one-shot variant of the foreman.
   *
   * Gated on the proxy feature flag because the block instructs the agent to
   * use proxy endpoints.
   *
   * @route GET /workspace/:urlKey/api/mini-foreman-prompt/:issueId
   * @param {string} issueId - The Linear issue ID (UUID)
   * @returns {Object} { label, promptName, prompt, repo } or error
   */
  router.get('/workspace/:urlKey/api/mini-foreman-prompt/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return res.status(403).json({ error: 'Proxy feature is not enabled' })
    }

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }
        const identifier = mockIssue.url?.split('/').pop() || ''
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const prompt = buildMiniForemanStep({
          baseUrl,
          issue: { identifier, title: mockIssue.title }
        })
        return res.json({
          label: 'mini-foreman',
          promptName: `Mini-foreman — ${identifier}`,
          prompt,
          repo: parseRepoFromDescription(mockProject?.content || null)
        })
      }

      const { issue, project } = await fetchIssueContext(workspace.accessToken, issueId)
      const prompt = buildMiniForemanStep({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title }
      })
      res.json({
        label: 'mini-foreman',
        promptName: `Mini-foreman — ${issue.identifier}`,
        prompt,
        repo: parseRepoFromDescription(project?.description)
      })
    } catch (error) {
      console.error('Mini-foreman prompt error:', error)
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }
      res.status(500).json({ error: 'Failed to generate mini-foreman prompt', message: error.message })
    }
  })

  /**
   * Generate an Autopilot kickoff prompt scoped to a specific issue — the
   * "run on autopilot until this task is done" instruction. Autopilot is a
   * light orchestrator that dispatches the actual work to a separate worker;
   * dispatching this prompt to `web` lets the user sit back and watch the loop.
   *
   * The general (stack-walk) kickoff is served at the issueless route below and
   * at /api/proxy/autopilot/kickoff for external agents.
   *
   * Gated on the proxy feature flag (same as foreman) — the kickoff drives the
   * proxy API exclusively. Optional `?mode=readonly` restricts the run to
   * investigation/research prompts; default is write (merge-gated).
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt/:issueId
   * @param {string} issueId - The Linear issue ID (UUID)
   * @returns {Object} { label, promptName, kind, prompt, repo } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return res.status(403).json({ error: 'Proxy feature is not enabled' })
    }

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' })
    }

    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT
    const baseUrl = `${req.protocol}://${req.get('host')}`

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return res.status(404).json({ error: 'Issue not found' })
        }
        const identifier = mockIssue.url?.split('/').pop() || ''
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const prompt = buildAutopilotKickoff({
          baseUrl,
          issue: { identifier, title: mockIssue.title },
          mode
        })
        return res.json({
          label: 'autopilot',
          promptName: `Autopilot — ${identifier}`,
          kind: 'autopilot',
          prompt,
          repo: parseRepoFromDescription(mockProject?.content || null)
        })
      }

      const { issue, project } = await fetchIssueContext(workspace.accessToken, issueId)
      const prompt = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        mode
      })
      res.json({
        label: 'autopilot',
        promptName: `Autopilot — ${issue.identifier}`,
        kind: 'autopilot',
        prompt,
        repo: parseRepoFromDescription(project?.description)
      })
    } catch (error) {
      console.error('Autopilot prompt error:', error)
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' })
      }
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }
      res.status(500).json({ error: 'Failed to generate autopilot prompt', message: error.message })
    }
  })

  /**
   * Generate a general (stack-walking) Autopilot kickoff — no issue scope.
   * Autopilot orients off `GET /stack` under the precedence policy and works the
   * backlog until it needs the human. Optional `?goal=` supplies a free-text
   * focus; `?mode=readonly` restricts to investigation/research prompts.
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt
   * @returns {Object} { label, promptName, kind, prompt } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return res.status(403).json({ error: 'Proxy feature is not enabled' })
    }

    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : ''
    const baseUrl = `${req.protocol}://${req.get('host')}`

    try {
      const prompt = buildAutopilotKickoff({ baseUrl, goal, mode })
      res.json({
        label: 'autopilot',
        promptName: goal.trim() ? `Autopilot — ${goal.trim().slice(0, 60)}` : 'Autopilot (stack walk)',
        kind: 'autopilot',
        prompt
      })
    } catch (error) {
      console.error('Autopilot kickoff error:', error)
      res.status(500).json({ error: 'Failed to generate autopilot kickoff', message: error.message })
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

    if (!isValidIssueId(issueId)) {
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

    // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
    // whitespace keepalive around the slow path.
    const keepalive = armKeepalive(res);
    try {
      // Use mock data in test mode
      if (isTestMode) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' })
        }

        // Atomically check free tier limits and record usage in test mode
        const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !process.env.OPENROUTER_API_KEY
        if (testIsFreeTier) {
          const check = await freeTierStore.tryUse(workspace.urlKey)
          if (!check.allowed) {
            keepalive.stop();
            return keepalive.send(429, {
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

        // Provide contextual mock prompts based on labels
        if (labels.includes(WORK_ISSUE_LABELS.BLOCKED)) {
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

        keepalive.stop();
        return keepalive.send(200, result)
      }

      // Get AI-generated prompt, following any `defer` decisions to a terminal
      // actionable node (LIN-329). A leaf resolves in one hop; a parent the human
      // pinned is transparently resolved to its actionable descendant, with the
      // descent breadcrumb returned. Free-tier usage is charged once per request
      // (above, before this point), not per hop.
      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore })
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)
      const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
        startIdentifier: issueId,
        deadline: Date.now() + RECOMMEND_DESCENT_BUDGET_MS,
        computeOne: async (id) => {
          // Two-tier context for parent tasks; the focused child seeds the defer choice.
          const ctx = await fetchRecommendationContext(workspace.accessToken, id)
          const r = await getRecommendation(
            ctx.issue,
            { parent: ctx.parent, siblings: ctx.siblings, project: ctx.project, children: ctx.children, comments: ctx.comments, focusedChild: ctx.focusedChild },
            { apiKey: apiKeyToUse, model: selectedModel, featureFlags: getFeatureFlags(req.session) }
          )
          return {
            identifier: ctx.issue.identifier,
            reasoning: r.reasoning,
            prompt: r.prompt,
            truncated: r.truncated,
            completionTokens: r.completionTokens,
            recommendedAction: r.recommendedAction,
            deferTo: r.deferTo,
            issueUrl: ctx.issue.url,
            repo: parseRepoFromDescription(ctx.project?.description)
          }
        }
      })

      const result = {
        reasoning: rec.reasoning,
        prompt: rec.prompt,
        truncated: rec.truncated,
        completionTokens: rec.completionTokens,
        issueUrl: rec.issueUrl,
        repo: rec.repo,
        // Terminal identifier + descent breadcrumb (LIN-327, additive).
        identifier: rec.identifier,
        deferredVia,
        deferTruncated,
        deferStopReason
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

      keepalive.stop();
      keepalive.send(200, result)
    } catch (error) {
      keepalive.stop();
      console.error('Recommendation error:', error)

      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' })
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message })
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message })
      }
      keepalive.send(500, { error: 'Failed to get recommendation', message: error.message })
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

    if (labels.includes(WORK_ISSUE_LABELS.BLOCKED)) {
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

    if (!isValidIssueId(issueId)) {
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

      const idOf = (iss) => iss.url?.split('/').pop() || iss.identifier;
      const incompleteChild = (iss) => testMockData.issues.find(
        i => i.parent?.id === iss.id && i.state?.type !== 'completed' && i.state?.type !== 'canceled'
      );

      // Node-shaped mock issue (LIN-327): mirror the live node path — stream a
      // descent breadcrumb for each container, then the terminal child's mock
      // recommendation. Keeps the descent-streaming behaviour E2E-covered.
      if (incompleteChild(mockIssue)) {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.flushHeaders();
        sendSSE(res, 'phase', { phase: 'reasoning' });

        const path = [];
        const seen = new Set();
        let node = mockIssue;
        while (node && !seen.has(node.id) && path.length < 10) {
          seen.add(node.id);
          path.push(node);
          node = incompleteChild(node);
        }
        const terminal = path[path.length - 1];
        const deferredVia = path.map(idOf);
        for (let k = 0; k < path.length - 1; k++) {
          sendSSE(res, 'delta', { section: 'reasoning', content: `↳ ${idOf(path[k])} is a container → routing to ${idOf(path[k + 1])}\n` });
        }
        const term = generateMockRecommendation(terminal);
        const termProject = testMockData.projects.find(p => p.id === terminal.project?.id);
        sendSSE(res, 'delta', { section: 'reasoning', content: `\n${term.reasoning}` });
        sendSSE(res, 'phase', { phase: 'prompt' });
        sendSSE(res, 'delta', { section: 'prompt', content: term.prompt });
        const doneData = {
          truncated: false, completionTokens: null,
          issueUrl: terminal.url, repo: parseRepoFromDescription(termProject?.content),
          identifier: idOf(terminal), deferredVia, deferTruncated: false
        };
        if (testIsFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey);
          doneData.freeTier = { used: true, remaining: usage.remaining, limit: usage.limit, resetsAt: usage.resetsAt };
        }
        sendSSE(res, 'done', doneData);
        res.end();
        return;
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

      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore });
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);

      // Node-shaped tasks (LIN-327): the first hop is a `defer` with no prompt body,
      // which can't be token-streamed. We resolve the descent and surface it LIVE —
      // each defer hop streams a breadcrumb into the reasoning section as it routes,
      // so the UI shows progress instead of sitting on "fetching" — then the terminal
      // node's reasoning and prompt are delivered (only the terminal hop has a prompt).
      // Leaf tasks fall through to true token streaming below — the common path is unchanged.
      if (children?.length > 0) {
        // Unhide the reasoning section up front so the descent breadcrumbs render live.
        sendSSE(res, 'phase', { phase: 'reasoning' });

        const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: issueId,
          deadline: Date.now() + RECOMMEND_DESCENT_BUDGET_MS,
          onHop: (hop) => {
            // Stream a breadcrumb for each container we route through.
            if (closed || !(hop.recommendedAction === 'defer' && hop.deferTo)) return;
            sendSSE(res, 'delta', { section: 'reasoning', content: `↳ ${hop.identifier} is a container → routing to ${hop.deferTo}\n` });
          },
          computeOne: async (id) => {
            const ctx = await fetchRecommendationContext(workspace.accessToken, id);
            const r = await getRecommendation(
              ctx.issue,
              { parent: ctx.parent, siblings: ctx.siblings, project: ctx.project, children: ctx.children, comments: ctx.comments, focusedChild: ctx.focusedChild },
              { apiKey: apiKeyToUse, model: selectedModel, featureFlags: getFeatureFlags(req.session), signal: abortController.signal }
            );
            return {
              identifier: ctx.issue.identifier, reasoning: r.reasoning, prompt: r.prompt,
              truncated: r.truncated, completionTokens: r.completionTokens,
              recommendedAction: r.recommendedAction, deferTo: r.deferTo,
              issueUrl: ctx.issue.url, repo: parseRepoFromDescription(ctx.project?.description)
            };
          }
        });
        if (closed) return;

        const metadata = { issueUrl: rec.issueUrl, repo: rec.repo, identifier: rec.identifier, deferredVia, deferTruncated, deferStopReason };
        if (isFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey);
          metadata.freeTier = { used: true, remaining: usage.remaining, limit: usage.limit, resetsAt: usage.resetsAt };
        }

        if (rec.recommendedAction === 'defer' || !rec.prompt) {
          // Abnormal stop (depth/cycle/unresolved/timeout) — surface, don't ship a defer.
          sendSSE(res, 'error', { error: 'Recommendation did not resolve to an actionable task', deferredVia, deferTruncated, deferStopReason });
        } else {
          // Terminal node's reasoning appended after the breadcrumbs, then its prompt.
          if (rec.reasoning) sendSSE(res, 'delta', { section: 'reasoning', content: `\n${rec.reasoning}` });
          sendSSE(res, 'phase', { phase: 'prompt' });
          sendSSE(res, 'delta', { section: 'prompt', content: rec.prompt });
          sendSSE(res, 'done', { truncated: rec.truncated, completionTokens: rec.completionTokens, ...metadata });
        }
        res.end();
        return;
      }

      // Phase 2: Stream AI recommendation (leaf task — true token streaming)

      // Build metadata to merge into the done event
      const metadata = {
        issueUrl: issue.url,
        repo: parseRepoFromDescription(project?.description)
      };

      if (isFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey);
        metadata.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        };
      }

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
          // Merge metadata into the done event so all data arrives in one event
          if (type === 'done') {
            sendSSE(res, 'done', { ...data, ...metadata });
          } else {
            sendSSE(res, type, data);
          }
        }
      );
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

    if (!isValidIssueId(issueId)) {
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
  // Dispatched Sessions API
  // ===========================================================================

  /**
   * GET the dispatched sessions (pipeline Loops) for a single issue.
   *
   * Reads the local dispatch + foreman stores only — no Linear call, no access
   * token — so it's cheap and works offline. The `:identifier` is the Linear
   * identifier (e.g. LIN-42), which is the join key the Swipe card already holds.
   * Returns newest-first so the most recent session is at the top.
   *
   * @route GET /workspace/:urlKey/api/sessions/:identifier
   * @returns {Object} { sessions: Array<SessionView> }
   */
  router.get('/workspace/:urlKey/api/sessions/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;

    if (!identifier || identifier.length > 100) {
      return res.status(400).json({ error: 'Invalid issue identifier' });
    }
    if (!dispatchQueueStore || !foremanStore) {
      return res.status(503).json({ error: 'Sessions are not available' });
    }

    try {
      const loops = await getLoopsForIssue(workspace.urlKey, identifier, {
        dispatchStore: dispatchQueueStore,
        foremanStore
      });
      // getLoopsForIssue returns oldest-first; reverse for newest-first display.
      const sessions = loops.map(toSessionView).reverse();
      res.json({ sessions });
    } catch (error) {
      console.error('Sessions GET error:', error);
      res.status(500).json({ error: 'Failed to fetch sessions', message: error.message });
    }
  });

  // ===========================================================================
  // Recap API (LIN-261)
  // ===========================================================================

  /**
   * GET recap status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', recap?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }
    if (!recapCacheStore) {
      return res.status(503).json({ error: 'Recap cache not configured' });
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) return res.status(404).json({ error: 'Issue not found' });
      } else {
        context = await fetchRecommendationContext(workspace.accessToken, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const cached = await recapCacheStore.get(workspace.urlKey, canonicalId);

      if (!cached) {
        return res.json({ status: 'missing' });
      }
      if (cached.inputHash !== inputHash) {
        return res.json({
          status: 'stale',
          generatedAt: cached.generatedAt,
          model: cached.model
        });
      }
      return res.json({
        status: 'fresh',
        recap: cached.recap,
        generatedAt: cached.generatedAt,
        model: cached.model
      });
    } catch (error) {
      console.error('Recap GET error:', error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to fetch recap status', message: error.message });
    }
  });

  /**
   * POST recap generate.
   * Regenerates the recap via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh', recap, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }
    if (!recapCacheStore) {
      return res.status(503).json({ error: 'Recap cache not configured' });
    }

    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;

    if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return res.status(503).json({ error: 'AI recap is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (!isTestMode && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: {
            used: true,
            remaining: check.remaining,
            limit: check.limit,
            resetsAt: check.resetsAt
          }
        });
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' });
        }
      } else {
        context = await fetchRecommendationContext(workspace.accessToken, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore });

      let recap;
      let modelUsed;
      if (isTestMode) {
        const mocked = buildMockRecap(context);
        recap = mocked;
        modelUsed = selectedModel;
      } else {
        const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
        const result = await generateRecap(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel }
        );
        recap = result.recap;
        modelUsed = result.model;
      }

      await recapCacheStore.put(workspace.urlKey, canonicalId, {
        inputHash,
        recap,
        model: modelUsed
      });
      const stored = await recapCacheStore.get(workspace.urlKey, canonicalId);

      keepalive.stop();
      keepalive.send(200, {
        status: 'fresh',
        recap: stored?.recap ?? recap,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
    } catch (error) {
      keepalive.stop();
      console.error('Recap POST error:', error);
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message });
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message });
      }
      keepalive.send(500, { error: 'Failed to generate recap', message: error.message });
    }
  });

  // ===========================================================================
  // Brief API (current-state task brief)
  // ===========================================================================

  /**
   * GET brief status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', brief?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }
    if (!briefCacheStore) {
      return res.status(503).json({ error: 'Brief cache not configured' });
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) return res.status(404).json({ error: 'Issue not found' });
      } else {
        context = await fetchRecommendationContext(workspace.accessToken, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const cached = await briefCacheStore.get(workspace.urlKey, canonicalId);

      if (!cached) {
        return res.json({ status: 'missing' });
      }
      if (cached.inputHash !== inputHash) {
        return res.json({
          status: 'stale',
          generatedAt: cached.generatedAt,
          model: cached.model
        });
      }
      return res.json({
        status: 'fresh',
        brief: cached.brief,
        generatedAt: cached.generatedAt,
        model: cached.model
      });
    } catch (error) {
      console.error('Brief GET error:', error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to fetch brief status', message: error.message });
    }
  });

  /**
   * POST brief generate.
   * Regenerates the brief via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh', brief, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }
    if (!briefCacheStore) {
      return res.status(503).json({ error: 'Brief cache not configured' });
    }

    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;

    if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return res.status(503).json({ error: 'AI brief is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (!isTestMode && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: {
            used: true,
            remaining: check.remaining,
            limit: check.limit,
            resetsAt: check.resetsAt
          }
        });
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' });
        }
      } else {
        context = await fetchRecommendationContext(workspace.accessToken, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore });

      let brief;
      let modelUsed;
      if (isTestMode) {
        brief = buildMockBrief(context);
        modelUsed = selectedModel;
      } else {
        const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
        const result = await generateBrief(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel }
        );
        brief = result.brief;
        modelUsed = result.model;
      }

      await briefCacheStore.put(workspace.urlKey, canonicalId, {
        inputHash,
        brief,
        model: modelUsed
      });
      const stored = await briefCacheStore.get(workspace.urlKey, canonicalId);

      keepalive.stop();
      keepalive.send(200, {
        status: 'fresh',
        brief: stored?.brief ?? brief,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
    } catch (error) {
      keepalive.stop();
      console.error('Brief POST error:', error);
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message });
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message });
      }
      keepalive.send(500, { error: 'Failed to generate brief', message: error.message });
    }
  });

  /** Build a small deterministic brief (Markdown) for test mode. */
  function buildMockBrief(context) {
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

  /** Build a mock recommendation context from test fixtures. */
  async function buildMockRecapContext(issueId) {
    const mockIssue = testMockData.issues.find(i => i.id === issueId || i.identifier === issueId || i.url?.endsWith(`/${issueId}`));
    if (!mockIssue) return null;
    const project = testMockData.projects.find(p => p.id === mockIssue.project?.id) || null;
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

  /** Build a small deterministic recap for test mode. */
  function buildMockRecap(context) {
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

  // ===========================================================================
  // Custom Prompts API
  // ===========================================================================

  /**
   * List all custom prompts for the workspace.
   * @route GET /workspace/:urlKey/api/prompts/custom
   */
  router.get('/workspace/:urlKey/api/prompts/custom', workspaceFromUrl, async (req, res) => {
    try {
      const prompts = await customPromptsStore.list(req.workspace.urlKey);
      res.json({ prompts });
    } catch (error) {
      console.error('Custom prompts list error:', error);
      res.status(500).json({ error: 'Failed to list custom prompts' });
    }
  });

  /**
   * Create a new custom prompt.
   * @route POST /workspace/:urlKey/api/prompts/custom
   */
  router.post('/workspace/:urlKey/api/prompts/custom', workspaceFromUrl, async (req, res) => {
    const { name, template } = req.body;

    try {
      const prompt = await customPromptsStore.create(req.workspace.urlKey, { name, template });
      res.json({ prompt });
    } catch (error) {
      console.error('Custom prompt create error:', error);
      const status = error.message.includes('required') || error.message.includes('maximum') || error.message.includes('characters') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Failed to create custom prompt' });
    }
  });

  /**
   * Update an existing custom prompt.
   * @route PUT /workspace/:urlKey/api/prompts/custom/:id
   */
  router.put('/workspace/:urlKey/api/prompts/custom/:id', workspaceFromUrl, async (req, res) => {
    const { id } = req.params;
    const { name, template } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    if (template !== undefined && (typeof template !== 'string' || !template.trim())) {
      return res.status(400).json({ error: 'Template cannot be empty' });
    }

    try {
      const updated = await customPromptsStore.update(req.workspace.urlKey, id, { name, template });
      if (!updated) {
        return res.status(404).json({ error: 'Custom prompt not found' });
      }
      res.json({ prompt: updated });
    } catch (error) {
      console.error('Custom prompt update error:', error);
      const status = error.message.includes('characters') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Failed to update custom prompt' });
    }
  });

  /**
   * Delete a custom prompt.
   * @route DELETE /workspace/:urlKey/api/prompts/custom/:id
   */
  router.delete('/workspace/:urlKey/api/prompts/custom/:id', workspaceFromUrl, async (req, res) => {
    const { id } = req.params;

    try {
      const deleted = await customPromptsStore.delete(req.workspace.urlKey, id);
      if (!deleted) {
        return res.status(404).json({ error: 'Custom prompt not found' });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Custom prompt delete error:', error);
      res.status(500).json({ error: 'Failed to delete custom prompt' });
    }
  });

  // ===========================================================================
  // Roadmap API Endpoints
  // ===========================================================================

  const NORTH_STAR_MAX_CHARS = 8000;

  /**
   * Get the saved north star for this workspace.
   * Reads from session; auth callback hydrates the session from user prefs.
   * @route GET /workspace/:urlKey/api/roadmap/north-star
   */
  router.get('/workspace/:urlKey/api/roadmap/north-star', workspaceFromUrl, (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }
    const byWorkspace = req.session.northStarByWorkspace || {};
    const northStar = byWorkspace[req.workspace.urlKey] || '';
    res.json({ northStar });
  });

  /**
   * Set the north star for this workspace.
   * Writes to session (authoritative) and best-effort to user preferences for
   * cross-device sync, mirroring the modelId/features pattern.
   * @route PUT /workspace/:urlKey/api/roadmap/north-star
   */
  router.put('/workspace/:urlKey/api/roadmap/north-star', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }

    const { northStar } = req.body || {};
    if (typeof northStar !== 'string') {
      return res.status(400).json({ error: 'northStar must be a string' });
    }
    if (northStar.length > NORTH_STAR_MAX_CHARS) {
      return res.status(400).json({ error: `northStar must be ${NORTH_STAR_MAX_CHARS} characters or fewer` });
    }

    if (!req.session.northStarByWorkspace) {
      req.session.northStarByWorkspace = {};
    }
    req.session.northStarByWorkspace[req.workspace.urlKey] = northStar;

    // Best-effort write-through to user preferences for cross-device sync.
    // Non-fatal: session is authoritative.
    if (userPreferencesStore && req.session.linearUserId) {
      try {
        const existing = await userPreferencesStore.getUserPreferences(req.session.linearUserId);
        const existingMap = existing.northStarByWorkspace || {};
        await userPreferencesStore.saveUserPreferences(req.session.linearUserId, {
          ...existing,
          northStarByWorkspace: {
            ...existingMap,
            [req.workspace.urlKey]: northStar
          }
        });
      } catch (err) {
        console.error('Failed to persist north star to preferences store:', err);
      }
    }

    res.json({ ok: true });
  });

  // ===========================================================================
  // Roadmap Report History (LIN-299)
  //
  // Durable per-workspace storage for completed report runs so the roadmap
  // reading survives a page reload. These are plain DB read/writes — NOT LLM
  // calls — so they are gated on the roadmap feature flag only (no free-tier
  // check, no H12 keepalive). The save happens client-side after all five
  // narrative streams complete.
  // ===========================================================================

  /**
   * Persist a completed report run.
   * The resolved model and timestamp are stamped server-side so the record is
   * trustworthy and consistent with how the layer endpoints pick their model.
   * @route POST /workspace/:urlKey/api/roadmap/reports
   */
  router.post('/workspace/:urlKey/api/roadmap/reports', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }
    if (!reportHistoryStore) {
      return res.status(503).json({ error: 'Report history not configured' });
    }

    const { northStar, narrative, orientation } = req.body || {};
    if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) {
      return res.status(400).json({ error: 'narrative object is required' });
    }
    if (northStar !== undefined && typeof northStar !== 'string') {
      return res.status(400).json({ error: 'northStar must be a string' });
    }
    if (orientation !== undefined && !Array.isArray(orientation)) {
      return res.status(400).json({ error: 'orientation must be an array' });
    }

    try {
      const model = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });
      const report = await reportHistoryStore.save(req.workspace.urlKey, {
        model,
        northStar: typeof northStar === 'string' ? northStar : '',
        narrative,
        orientation
      });
      res.status(201).json({ report });
    } catch (error) {
      console.error('Report save error:', error);
      res.status(500).json({ error: 'Failed to save report' });
    }
  });

  /**
   * List saved reports for this workspace, newest-first.
   * @route GET /workspace/:urlKey/api/roadmap/reports?limit={n}
   */
  router.get('/workspace/:urlKey/api/roadmap/reports', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }
    if (!reportHistoryStore) {
      return res.status(503).json({ error: 'Report history not configured' });
    }

    let limit;
    if (req.query.limit !== undefined) {
      const parsed = parseInt(req.query.limit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
    }

    try {
      const { items, total } = await reportHistoryStore.list(req.workspace.urlKey, { limit });
      res.json({ reports: items, total });
    } catch (error) {
      console.error('Report list error:', error);
      res.status(500).json({ error: 'Failed to list reports' });
    }
  });

  /**
   * Fetch a single saved report (full record) by id — backs the history UI's
   * view-on-click. The list endpoint returns summaries only, so this is the
   * way to retrieve a report's narrative bodies.
   * @route GET /workspace/:urlKey/api/roadmap/reports/:id
   */
  router.get('/workspace/:urlKey/api/roadmap/reports/:id', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }
    if (!reportHistoryStore) {
      return res.status(503).json({ error: 'Report history not configured' });
    }

    try {
      const report = await reportHistoryStore.get(req.workspace.urlKey, req.params.id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }
      res.json({ report });
    } catch (error) {
      console.error('Report get error:', error);
      res.status(500).json({ error: 'Failed to fetch report' });
    }
  });

  /**
   * Resolve the LLM credentials + model for the roadmap generate endpoint.
   * Does feature-flag and API-key gating, but does NOT charge the free tier —
   * the generate endpoint charges per-layer so a full reading costs the same
   * number of free-tier units as the old per-call pipeline did (LIN-317).
   * Sends the appropriate error response and returns null on failure.
   * Returns { apiKey, model, isFreeTier } when ready to proceed.
   */
  async function resolveRoadmapLLM(req, res) {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      res.status(403).json({ error: 'Roadmap feature is not enabled' });
      return null;
    }

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;
    const apiKey = sessionApiKey || process.env.OPENROUTER_API_KEY || freeTierKey;
    if (!apiKey) {
      res.status(503).json({ error: 'AI not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
      return null;
    }

    const model = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });
    return { apiKey, model, isFreeTier };
  }

  /**
   * Atomically charge one free-tier unit for a layer about to run. Returns the
   * store's check result ({ allowed, ... }). Non-free-tier callers are always
   * allowed without touching the store.
   */
  async function chargeRoadmapLayer(req, isFreeTier) {
    if (!isFreeTier) return { allowed: true };
    return freeTierStore.tryUse(req.workspace.urlKey);
  }

  /**
   * Stream one pipeline layer over the shared SSE connection (LIN-317). All
   * events are tagged with the layer id so the client can demultiplex many
   * layers from one connection. Never sets headers (the caller flushes once)
   * and never ends the response (the caller emits the terminal `done`). A layer
   * failure emits a `layer-error` event and resolves { ok: false } so the
   * pipeline can continue to the next layer per the design doc's failure modes.
   *
   * @returns {Promise<{ok: boolean, text: string, finishReason: ?string}>}
   */
  async function streamLayer(res, { messages, apiKey, model, maxTokens, layer, layerName }) {
    sendSSE(res, 'layer-start', { layer });
    let text = '';
    let finishReason = null;
    try {
      await streamChat(
        messages,
        { apiKey, model, maxTokens },
        (type, data) => {
          if (type === 'token') {
            const token = (data && data.token) || '';
            text += token;
            sendSSE(res, 'token', { layer, token });
          } else if (type === 'done') {
            finishReason = data ? data.finishReason : null;
          }
        }
      );
      sendSSE(res, 'layer-done', { layer, finishReason });
      return { ok: true, text, finishReason };
    } catch (error) {
      console.error(`Roadmap ${layerName} stream error:`, error);
      sendSSE(res, 'layer-error', { layer, message: `Failed to generate ${layerName}` });
      return { ok: false, text: '', finishReason: null };
    }
  }

  /**
   * Test-mode mock for one layer: emits the same layer-tagged event sequence as
   * streamLayer, split into two token chunks so the client's accumulation path
   * is exercised. Returns the same shape as streamLayer.
   */
  function emitMockLayer(res, { layer, text }) {
    sendSSE(res, 'layer-start', { layer });
    const half = Math.max(1, Math.floor(text.length / 2));
    sendSSE(res, 'token', { layer, token: text.slice(0, half) });
    sendSSE(res, 'token', { layer, token: text.slice(half) });
    sendSSE(res, 'layer-done', { layer, finishReason: 'stop' });
    return { ok: true, text, finishReason: 'stop' };
  }

  function isRoadmapTestMode(req) {
    return process.env.NODE_ENV === 'test' && req.workspace && req.workspace.accessToken === 'test-token';
  }

  // --- Orientation (LIN-300) ------------------------------------------------

  const ORIENTATION_BEARING_SET = new Set(ORIENTATION_BEARINGS);

  /**
   * Canned test-mode bearings. Deliberately exercises the normalizer end-to-end:
   * a clean bearing, a lowercase one (clamped to upper-case), an invalid one
   * (dropped because it is not archived), and an off-compass archived one (kept
   * with an empty bearing). References fixture identifiers from mock-data.js.
   */
  const ORIENTATION_TEST_BEARINGS = [
    { identifier: 'TEST-2', bearing: 'N', reason: 'Directly advances the stated intent.', archived: false },
    { identifier: 'TEST-13', bearing: 'se', reason: 'Partial support with some divergence.', archived: false },
    { identifier: 'TEST-99', bearing: 'NORTHWEST', reason: 'Invalid bearing — should be dropped.', archived: false },
    { identifier: 'TEST-14', bearing: '', reason: 'Off-compass: does not serve the north star.', archived: true }
  ];

  /**
   * Shared failure-notice copy for the orientation event (LIN-324). Used both
   * when the stream/parse throws and when the response parses to nothing usable
   * despite there being candidates to score — the two ways a reading can fail to
   * yield bearings. Either way the ship-view toggle stays off, but the operator
   * is told why instead of facing a silent, mysteriously-disabled control.
   */
  const ORIENTATION_FAILURE_NOTICE =
    'Orientation bearings could not be generated — the model response was incomplete or could not be parsed. The ship-view orientation toggle stays unavailable for this reading.';

  /**
   * Validate and normalize raw bearings to the 8-point vocabulary (LIN-300).
   * The store's normalizeOrientation enforces field *shape* only; the route owns
   * *vocabulary* enforcement so the persisted contract stays clean for LIN-301.
   *
   * - Drops entries with no identifier.
   * - Clamps bearings to upper-case and matches against the 8-point set.
   * - An un-archived task with an invalid/empty bearing is DROPPED (it cannot be
   *   placed on the compass and was not flagged off-compass).
   * - An archived (off-compass) task is KEPT; its bearing is the valid value if
   *   it is one, otherwise '' — it carries no placement weight either way.
   */
  function normalizeBearings(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const identifier = String(item.identifier || '').trim();
      if (!identifier) continue;
      const archived = item.archived === true;
      const bearing = String(item.bearing || '').trim().toUpperCase();
      const valid = ORIENTATION_BEARING_SET.has(bearing);
      if (!valid && !archived) continue;
      out.push({
        identifier,
        bearing: valid ? bearing : '',
        reason: String(item.reason || ''),
        archived
      });
    }
    return out;
  }

  /**
   * Token allowance for one orientation call, scaled to the candidate count
   * (LIN-324). The model must score EVERY candidate exactly once, so the JSON
   * grows linearly with the queue; a fixed ceiling truncates large workspaces
   * mid-array and the parse then fails. ~40-50 tok/entry plus headroom, floored
   * at the old 2000 and clamped to a generous ceiling.
   */
  function orientationMaxTokens(candidateCount) {
    return Math.min(16000, Math.max(2000, 1500 + candidateCount * 60));
  }

  /**
   * Generate per-task orientation bearings and emit them as ONE structured
   * `orientation` SSE event over the shared generate connection (LIN-300).
   *
   * Unlike the narrative layers this does not stream prose into a panel — it
   * accumulates the full line-format output, parses it with parseOrientationLines
   * (Strategy B / LIN-324), and validates against the 8-point vocabulary.
   *
   * LIN-324: failures are no longer silent. The token allowance scales to the
   * candidate count (Strategy A) so a real-sized queue no longer truncates, the
   * line format degrades gracefully (a truncated trailing line costs one line,
   * not the whole response), and a `notice` field on the orientation event
   * surfaces the remaining failure-like conditions at generation time (Strategy
   * C / D2):
   *   - a stream/parse failure (the catch) emits `orientation: []` PLUS a notice
   *     so the disabled ship toggle is explained rather than mysterious;
   *   - a parse that yields NOTHING usable despite having candidates (genuine
   *     format drift — e.g. the model emits JSON instead of lines) likewise emits
   *     `orientation: []` PLUS the same notice, rather than a silent empty array;
   *   - a safety-cap tail-drop emits the (non-empty) bearings PLUS a notice
   *     naming how many lowest-priority candidates were omitted.
   * The notice is transient (SSE + a DOM note on the roadmap page) — it is NOT
   * persisted. The saved `orientation` value stays a plain array, keeping the
   * report-history store contract and the ship gate (`hasOrientationData`)
   * untouched. Charges one free-tier unit like every other layer.
   *
   * @param {?string} injectedRaw - Test-only raw streamed text (gated on
   *   testMode by the caller) that drives the real strip→parse→normalize chain
   *   without an LLM call, so a test can exercise the truncation path the
   *   ORIENTATION_TEST_BEARINGS short-circuit skips (Strategy E / LIN-324).
   */
  async function generateOrientation(res, { roadmapModel, northStar, llm, req, testMode, injectedRaw }) {
    const check = await chargeRoadmapLayer(req, llm.isFreeTier);
    if (!check.allowed) {
      sendSSE(res, 'orientation', {
        orientation: [],
        notice: 'Orientation skipped — the free-tier limit was reached. The ship-view orientation toggle stays unavailable for this reading.'
      });
      return;
    }

    // Post-cap candidate list and the pre-cap total share one filter, so the
    // prompt's candidates and the token-scaling count can never diverge.
    const candidates = serializeOrientationCandidates(roadmapModel);
    const dropped = countOrientationCandidates(roadmapModel) - candidates.length;
    const capNotice = dropped > 0
      ? `Orientation scored the top ${candidates.length} candidates; ${dropped} lower-priority task${dropped === 1 ? ' was' : 's were'} omitted to fit a single request.`
      : null;

    let parsed = [];
    try {
      if (injectedRaw != null) {
        parsed = parseOrientationLines(injectedRaw);
      } else if (testMode) {
        parsed = ORIENTATION_TEST_BEARINGS;
      } else {
        const messages = buildRoadmapOrientationMessages(roadmapModel, northStar);
        let text = '';
        await streamChat(
          messages,
          { apiKey: llm.apiKey, model: llm.model, maxTokens: orientationMaxTokens(candidates.length) },
          (type, data) => { if (type === 'token') text += (data && data.token) || ''; }
        );
        parsed = parseOrientationLines(text);
      }
    } catch (error) {
      console.error('Roadmap orientation error:', error);
      sendSSE(res, 'orientation', { orientation: [], notice: ORIENTATION_FAILURE_NOTICE });
      return;
    }

    const orientation = normalizeBearings(parsed);

    // Parsed to nothing usable while candidates existed ⇒ genuine format drift
    // (e.g. the model ignored the line contract). Surface it, don't swallow it
    // (D2). An empty result with NO candidates is legitimately empty — no notice.
    if (orientation.length === 0 && candidates.length > 0) {
      sendSSE(res, 'orientation', { orientation: [], notice: ORIENTATION_FAILURE_NOTICE });
      return;
    }

    const payload = { orientation };
    if (capNotice) payload.notice = capNotice;
    sendSSE(res, 'orientation', payload);
  }

  /**
   * Server-orchestrated roadmap reading generation (LIN-317).
   *
   * Replaces the five client-driven per-layer calls (each of which sent the
   * whole roadmapModel back and tripped the 250kb body-parser cap on large
   * workspaces). Here the server fetches Linear ONCE, builds the model into a
   * request-local variable, and runs every layer in sequence streaming each
   * over a SINGLE SSE connection. The request body is tiny (north star +
   * optional team), so the 413 cliff is gone. No persistent server state.
   *
   * Layer order: technical → product → (trajectory, north-star) → gap → digest.
   * Each event is tagged with its layer id so the client demultiplexes one
   * connection into the right placeholders. A layer failure emits a
   * `layer-error` event and the pipeline continues where the design doc's
   * failure modes allow (technical/product are hard prerequisites; a failed
   * fork leg skips the gap; the digest still runs from layers 1/2/3a).
   *
   * Free tier: one unit is charged per layer that actually runs, matching the
   * old per-call accounting. The first unit is reserved before streaming starts
   * (clean 429); a mid-stream limit surfaces as a `layer-error` event since the
   * HTTP status is already committed to 200.
   *
   * @route POST /workspace/:urlKey/api/roadmap/generate
   */
  router.post('/workspace/:urlKey/api/roadmap/generate', workspaceFromUrl, async (req, res) => {
    const llm = await resolveRoadmapLLM(req, res);
    if (!llm) return;

    const testMode = isRoadmapTestMode(req);

    // North star comes from the body (tiny string — no 413 risk) and falls back
    // to the saved session value. Team filter mirrors the page route.
    const bodyNs = typeof req.body?.northStar === 'string' ? req.body.northStar : null;
    const sessionNs = req.session.northStarByWorkspace?.[req.workspace.urlKey] || '';
    const northStar = bodyNs != null ? bodyNs : sessionNs;
    const hasNorthStar = !!(northStar && northStar.trim());

    const rawTeam = req.body?.team;
    const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

    // Fetch Linear once and build the model into a local variable. Errors here
    // happen before any SSE headers are flushed, so they stay normal HTTP codes.
    let roadmapModel;
    try {
      const { projects, issues } = testMode
        ? testMockData
        : await fetchProjects(req.workspace.accessToken, teamId);
      roadmapModel = buildRoadmapModel(projects, issues);
    } catch (error) {
      console.error('Roadmap generate fetch error:', error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return res.status(500).json({ error: 'Failed to load roadmap data' });
    }

    // Reserve the first free-tier unit before streaming so an already-exhausted
    // free user gets a clean 429 rather than a 200 stream that errors instantly.
    const firstCharge = await chargeRoadmapLayer(req, llm.isFreeTier);
    if (!firstCharge.allowed) {
      return res.status(429).json({
        error: firstCharge.reason,
        freeTier: {
          used: true,
          remaining: firstCharge.remaining,
          limit: firstCharge.limit,
          resetsAt: firstCharge.resetsAt
        }
      });
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    /**
     * Run one layer over the shared connection. Charges a free-tier unit first
     * (unless pre-charged); on a build error or rate limit emits a layer-error
     * and resolves { ok: false } so the caller decides whether to continue.
     */
    async function runLayer({ layer, layerName, maxTokens, mockText, buildMessages, precharged }) {
      if (!precharged) {
        const check = await chargeRoadmapLayer(req, llm.isFreeTier);
        if (!check.allowed) {
          sendSSE(res, 'layer-error', { layer, message: check.reason || 'Free tier limit reached' });
          return { ok: false, text: '' };
        }
      }
      if (testMode) return emitMockLayer(res, { layer, text: mockText });
      let messages;
      try {
        messages = buildMessages();
      } catch (error) {
        console.error(`Roadmap ${layerName} build error:`, error);
        sendSSE(res, 'layer-error', { layer, message: `Failed to build ${layerName} prompt` });
        return { ok: false, text: '' };
      }
      return streamLayer(res, { messages, apiKey: llm.apiKey, model: llm.model, maxTokens, layer, layerName });
    }

    try {
      // Layer 1 — Technical (hard prerequisite; first unit already reserved).
      const tech = await runLayer({
        layer: 'technical', layerName: 'technical narrative', maxTokens: 5000, precharged: true,
        mockText: 'Mock technical narrative covering recent delivery.',
        buildMessages: () => buildRoadmapNarrativeMessages(roadmapModel)
      });
      if (tech.ok) {
        // Layer 2 — Product (hard prerequisite; chains from technical).
        const product = await runLayer({
          layer: 'product', layerName: 'product perspective', maxTokens: 4000,
          mockText: 'Mock product perspective synthesizing themes from layer 1.',
          buildMessages: () => buildRoadmapProductMessages(roadmapModel, tech.text)
        });
        if (product.ok) {
          // Layer 3a — Trajectory (chains from product; failure is non-fatal).
          const trajectory = await runLayer({
            layer: 'trajectory', layerName: 'trajectory reading', maxTokens: 4000,
            mockText: 'Mock trajectory at this pace pointing toward simpler onboarding.',
            buildMessages: () => buildRoadmapTrajectoryMessages(roadmapModel, tech.text, product.text)
          });

          // Layer 3b — North star reading (only with a north star; source-grounded).
          let nsReading = { ok: false, text: '' };
          if (hasNorthStar) {
            nsReading = await runLayer({
              layer: 'north-star-reading', layerName: 'north-star reading', maxTokens: 5000,
              mockText: 'Mock north star reading: aligned to stated intent.',
              buildMessages: () => buildRoadmapNorthStarMessages(roadmapModel, northStar, {
                tech: tech.text, product: product.text
              })
            });
          }

          // Layer 4 — Gap (needs both fork legs to have succeeded).
          let gap = { ok: false, text: '' };
          if (hasNorthStar && trajectory.ok && nsReading.ok) {
            gap = await runLayer({
              layer: 'gap', layerName: 'gap analysis', maxTokens: 3000,
              mockText: 'Mock gap analysis: trajectory and intent largely agree.',
              buildMessages: () => buildRoadmapGapMessages(northStar, trajectory.text, nsReading.text, roadmapModel)
            });
          }

          // Digest — synthesises everything above (generates last, renders first).
          await runLayer({
            layer: 'digest', layerName: 'summary', maxTokens: 1200,
            mockText: 'Mock summary: SHIPPED recent work. WHERE WE ARE on track. THE RISK is delivery. THE DECISION is for the human.',
            buildMessages: () => buildRoadmapDigestMessages({
              northStar: hasNorthStar ? northStar : '',
              technical: tech.text,
              product: product.text,
              trajectory: trajectory.text || '',
              nsReading: nsReading.text || '',
              gap: gap.text || ''
            })
          });
        }
      }

      // Orientation (LIN-300) — per-task compass bearings adjudicated against
      // the north star. A purely additive follow-up call (Strategy B): it does
      // not stream prose into a panel; it emits one `orientation` event the
      // client stashes for persistence and the ship view (LIN-301). It only
      // needs the model and the north star — not the prose layers' output — so
      // it runs whenever a north star is set, independent of layer outcomes.
      if (hasNorthStar) {
        // Test-only seam (LIN-324 / Strategy E): in roadmap test mode a body
        // field can inject the raw streamed text so a test drives the real
        // serialize→parse→normalize→emit chain (which the
        // ORIENTATION_TEST_BEARINGS short-circuit otherwise skips). Ignored
        // entirely outside test mode.
        const injectedRaw = testMode && typeof req.body?.__testOrientationRaw === 'string'
          ? req.body.__testOrientationRaw
          : null;
        await generateOrientation(res, { roadmapModel, northStar, llm, req, testMode, injectedRaw });
      } else {
        // No north star ⇒ orientation cannot be adjudicated (it scores work
        // AGAINST the stated intent). Emit an explicit orientation event with a
        // notice rather than nothing, so the roadmap page can explain why the
        // ship-view toggle stays inert instead of leaving it silently disabled
        // (LIN-324 / D2). The persisted orientation stays [].
        sendSSE(res, 'orientation', {
          orientation: [],
          notice: 'Orientation needs a north star — set one above to generate per-task bearings. The ship-view orientation toggle stays unavailable until then.'
        });
      }
    } catch (error) {
      console.error('Roadmap generate stream error:', error);
    } finally {
      sendSSE(res, 'done', {});
      res.end();
    }
  });

  /**
   * Roadmap Q&A chat via SSE streaming.
   * Client POSTs the question, roadmap model, and conversation history.
   * @route POST /workspace/:urlKey/api/roadmap/chat
   */
  router.post('/workspace/:urlKey/api/roadmap/chat', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return res.status(403).json({ error: 'Roadmap feature is not enabled' });
    }

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || process.env.OPENROUTER_API_KEY || freeTierKey;
    if (!apiKeyToUse) {
      return res.status(503).json({ error: 'AI not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    // Atomically check rate limits for free tier users
    if (isFreeTier) {
      const check = await freeTierStore.tryUse(req.workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: {
            used: true,
            remaining: check.remaining,
            limit: check.limit,
            resetsAt: check.resetsAt
          }
        });
      }
    }

    const { question, roadmapModel, history } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required and must be a non-empty string' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: 'question must be 2000 characters or fewer' });
    }
    if (!roadmapModel) {
      return res.status(400).json({ error: 'question and roadmapModel are required' });
    }

    // Sanitize history: only allow user/assistant roles with string content
    const safeHistory = Array.isArray(history)
      ? history.filter(h =>
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string'
        )
      : [];

    // Build messages before starting SSE so errors return proper HTTP status codes
    let messages;
    try {
      const { buildRoadmapChatMessages } = await import('../lib/prompts/roadmap-chat-template.js');
      messages = buildRoadmapChatMessages(roadmapModel, question.trim(), safeHistory);
    } catch (error) {
      console.error('Roadmap chat build error:', error);
      return res.status(500).json({ error: 'Failed to build chat prompt' });
    }

    const selectedModel = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });

    // Start SSE
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    try {
      await streamChat(
        messages,
        { apiKey: apiKeyToUse, model: selectedModel, maxTokens: 3000 },
        (type, data) => {
          sendSSE(res, type, data);
          if (type === 'done' || type === 'error') {
            res.end();
          }
        }
      );
    } catch (error) {
      console.error('Roadmap chat error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate response' });
      res.end();
    }
  });

  return router;
}
