/**
 * Task Chat routes — the experimental "talk to a task" feature (V1).
 *
 * Anchored at /workspace/:urlKey/task-chat (reusing workspaceFromUrl + the
 * pipeline/collective feature-gate-redirect-to-settings pattern). The page is a
 * provider-free shell; each conversation turn POSTs a question to the SSE chat
 * endpoint, which fetches the task's full context and streams a grounded,
 * first-person answer from the task itself.
 *
 *   GET  /workspace/:urlKey/task-chat                  — page shell (gated)
 *   POST /workspace/:urlKey/api/task-chat/:issueId     — SSE chat turn
 *
 * V1 scope (decided): a private, in-page, read-only conversation. History lives
 * in the browser and is replayed on each turn (ephemeral, like roadmap chat).
 * No durable transcript and no Linear writes — both are deferred.
 */

import { Router } from 'express';
import { renderTaskChatPage } from '../lib/render-task-chat.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildTaskChatMessages } from '../lib/prompts/task-chat-template.js';
import { streamChat, isRecommendationEnabled, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope, isValidIssueId } from '../lib/workspace.js';
import { testMockData } from '../tests/fixtures/mock-data.js';

const MAX_QUESTION_LENGTH = 2000;

function sendSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Whether the AI layer should be mocked for this request — mirrors
 * `shouldMockAi` in routes/workspace-api.js so e2e specs (and local-provider
 * sessions) stream a deterministic answer without an OpenRouter key.
 */
function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}

/**
 * Build a small deterministic task context from the data fixtures for test mode
 * (mirrors buildMockRecapContext in routes/workspace-api.js). Returns null when
 * the identifier doesn't resolve, so the caller can 404.
 */
function buildMockTaskContext(issueId) {
  const mockIssue = testMockData.issues.find(
    i => i.id === issueId || i.identifier === issueId || i.url?.endsWith(`/${issueId}`)
  );
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

/**
 * A deterministic, first-person mock answer so e2e can exercise the full
 * round-trip (gate → fetch → stream → render) without calling an LLM. Grounded
 * in the resolved context, in the spirit of the real prompt.
 */
function buildMockAnswer(context, question) {
  const issue = context.issue || {};
  const open = (context.children || []).filter(c => c.state?.type !== 'completed' && c.state?.type !== 'canceled');
  const lines = [
    `You asked: ${String(question).trim()}`,
    `I'm ${issue.identifier || 'this task'}${issue.title ? ` — ${issue.title}` : ''}.`,
    `Right now I'm in "${issue.state?.name || 'an unknown state'}".`
  ];
  if (open.length > 0) {
    lines.push(`I still have ${open.length} open subtask(s); the next is ${open[0].identifier}.`);
  } else if ((context.children || []).length > 0) {
    lines.push('All of my subtasks are complete.');
  } else if (issue.description) {
    lines.push('My description is the best source on what I am.');
  } else {
    lines.push("My history is thin, so there's little for me to draw on.");
  }
  return lines.join('\n');
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl    - middleware: session + req.workspace
 * @param {Object}   deps.freeTierStore       - free-tier usage store (tryUse)
 * @param {Object}   deps.workspacePreferencesStore - workspace prefs store (model selection)
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo       - () → deploy metadata
 * @returns {Router}
 */
export function createTaskChatRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/task-chat', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/pipeline).
    if (featureFlags.taskChat !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const rawTask = typeof req.query.task === 'string' ? req.query.task.trim().slice(0, 64) : '';
      const aiConfigured = isRecommendationEnabled(req.session.openRouterApiKey) || !!process.env.OPENROUTER_FREE_TIER_KEY;
      const html = renderTaskChatPage(
        { defaultTask: rawTask, aiConfigured },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags,
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Task chat page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Task Chat page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/task-chat`,
      });
      res.status(500).send(html);
    }
  });

  // ─── SSE chat turn ────────────────────────────────────────────────────────────

  router.post('/workspace/:urlKey/api/task-chat/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;

    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.taskChat !== true) {
      return res.status(403).json({ error: 'Task chat feature is not enabled' });
    }

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }

    const { question, history } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required and must be a non-empty string' });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer` });
    }

    // `isTestMode` gates the DATA mock; `mockAi` additionally fires the AI mock
    // for local-provider sessions. The AI-config + free-tier guards key off
    // `mockAi` so a mocked session isn't 503'd for lacking an OpenRouter key.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;

    if (!mockAi && !apiKeyToUse) {
      return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (!mockAi && isFreeTier) {
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

    // Sanitize history: only user/assistant turns with string content.
    const safeHistory = Array.isArray(history)
      ? history.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
      : [];

    // Resolve the task's context BEFORE opening the SSE stream so failures return
    // a proper HTTP status (404 for an unknown task, 401 for an expired token).
    let context;
    try {
      if (isTestMode) {
        context = buildMockTaskContext(issueId);
        if (!context) return res.status(404).json({ error: 'Issue not found' });
      } else {
        context = await getProviderForWorkspace(workspace).fetchRecommendationContext(getWorkspaceCallScope(workspace), issueId);
        if (!context || !context.issue) return res.status(404).json({ error: 'Issue not found' });
      }
    } catch (error) {
      console.error('Task chat context error:', error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
      return res.status(502).json({ error: 'Failed to load the task' });
    }

    // Start SSE.
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders?.();

    try {
      if (mockAi) {
        const answer = buildMockAnswer(context, question);
        sendSSE(res, 'token', { token: answer });
        sendSSE(res, 'done', {});
        return res.end();
      }

      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });
      const messages = buildTaskChatMessages(context.issue, context, question.trim(), safeHistory);
      await streamChat(
        messages,
        { apiKey: apiKeyToUse, model: selectedModel, maxTokens: 1500,
          callMeta: { urlKey: workspace?.urlKey || null, feature: 'task-chat', issueIdentifier: context.issue?.identifier || null } },
        (type, data) => {
          sendSSE(res, type, data);
          if (type === 'done' || type === 'error') {
            res.end();
          }
        }
      );
    } catch (error) {
      console.error('Task chat stream error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate a response' });
      res.end();
    }
  });

  return router;
}
