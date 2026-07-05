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
import { streamChat, streamChatWithTools, isToolCapableModel, isRecommendationEnabled, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { createChatToolCatalog, CHAT_TOOL_RESULT_BUDGETS } from '../lib/chat-tools.js';
import { sessionIsTerminal } from './dashboard.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope, isValidIssueId } from '../lib/workspace.js';
import { testMockData } from '../tests/fixtures/mock-data.js';

const MAX_QUESTION_LENGTH = 2000;

function sendSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Sanitize a chat transcript to the durable `{role, content}` shape: only
 * user/assistant turns with string content survive. Shared by the turn endpoint
 * (replays client history) and the saved-chat save endpoint (LIN-1008) so a
 * stored transcript re-hydrates and replays byte-identically through the
 * unchanged turn route. This is also what keeps tool breadcrumbs / model / cost
 * out of a saved transcript.
 */
function sanitizeHistory(history) {
  return Array.isArray(history)
    ? history.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    : [];
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
 * Pick a deterministic OTHER fixture task for the mock tool breadcrumb (LIN-990).
 * The mock AI has no live LLM to decide a lookup, so we simulate one: choose the
 * first fixture task in the same project (falling back to any other task) that is
 * not the task being chatted with. This lets e2e prove a tool hop rendered a
 * breadcrumb and that the answer referenced the fetched task, without a provider.
 *
 * @param {Object} context - Resolved task context (issue, project).
 * @returns {{identifier: string, title: string}|null}
 */
function buildMockToolReference(context) {
  const currentId = context?.issue?.id;
  const currentProject = context?.project?.id;
  const candidates = testMockData.issues.filter(i => i.identifier && i.id !== currentId);
  const pick = candidates.find(i => i.project?.id === currentProject) || candidates[0];
  return pick ? { identifier: pick.identifier, title: pick.title || '' } : null;
}

/**
 * Detect a deterministic trigger phrase for simulating the `send_follow_up`
 * write tool in mock mode (LIN-1073 review: e2e needs to exercise the
 * breadcrumb for the catalog's one write tool, not just a read lookup, since
 * that breadcrumb is the tool's only visible safety property).
 *
 * @param {string} question
 * @returns {{sessionId: string, prompt: string}|null}
 */
function buildMockFollowUpTrigger(question) {
  const text = String(question || '').toLowerCase();
  if (!text.includes('follow up') && !text.includes('follow-up')) return null;
  return { sessionId: 'mock-session-1', prompt: 'Please post a status update.' };
}

/**
 * A deterministic, first-person mock answer so e2e can exercise the full
 * round-trip (gate → fetch → stream → render) without calling an LLM. Grounded
 * in the resolved context, in the spirit of the real prompt. When a `related`
 * task is supplied (the simulated tool lookup), the answer references it so the
 * e2e can assert tool-derived data surfaced.
 */
function buildMockAnswer(context, question, related) {
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
  if (related) {
    lines.push(`I looked up ${related.identifier}${related.title ? ` (${related.title})` : ''} to ground that.`);
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
 * @param {Object}   deps.savedChatStore       - durable saved-chat store (LIN-1008)
 * @param {Object}   deps.dispatchQueueStore   - dispatch queue store (LIN-1073): backs the
 *   session read-model AND the gated `send_follow_up` chat tool's write
 * @param {Object}   deps.agentStatusStore     - agent status store (LIN-1073): the other dep
 *   the session read-model needs
 * @returns {Router}
 */
export function createTaskChatRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, savedChatStore, recapCacheStore, briefCacheStore, dispatchQueueStore, agentStatusStore }) {
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
      // Saved chats require a user identity (linearUserId). When absent (local /
      // GitHub / anonymous sessions), the feature is unavailable — the page
      // renders an explicit empty-state and omits the save affordance (LIN-1008).
      const savedChatsAvailable = !!req.session.linearUserId;
      const html = renderTaskChatPage(
        { defaultTask: rawTask, aiConfigured, savedChatsAvailable },
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

  // ─── Saved chats (LIN-1008) ──────────────────────────────────────────────────
  //
  // Durable, private-per-user transcript CRUD. Every endpoint is gated on the
  // `taskChat` flag AND a present `linearUserId` (the only accepted identity);
  // an absent identity returns 401 rather than fabricating a fallback id (mirrors
  // dispatch recents). These literal `/saved` routes MUST be registered BEFORE
  // the `/:issueId` turn route below, or Express matches `saved` as an issue id.
  //
  // Session-auth only: this is content-bearing and is never wired onto the proxy
  // token-auth or /kpis surfaces (the prompt-trace privacy boundary).

  /**
   * Resolve the saved-chat identity for a request, or send the appropriate error
   * and return null. Shared gate for all four endpoints.
   */
  const resolveSavedChatUser = (req, res) => {
    if (getFeatureFlags(req.session).taskChat !== true) {
      res.status(403).json({ error: 'Task chat feature is not enabled' });
      return null;
    }
    const linearUserId = req.session.linearUserId;
    if (!linearUserId) {
      res.status(401).json({ error: 'Authentication required to use saved chats' });
      return null;
    }
    return linearUserId;
  };

  // List the current user's saved chats (metadata only, newest-first).
  router.get('/workspace/:urlKey/api/task-chat/saved', workspaceFromUrl, async (req, res) => {
    const linearUserId = resolveSavedChatUser(req, res);
    if (!linearUserId) return;
    try {
      const chats = await savedChatStore.list(req.workspace.urlKey, linearUserId);
      res.json({ chats });
    } catch (error) {
      console.error('Saved chat list error:', error);
      res.status(500).json({ error: 'Failed to list saved chats' });
    }
  });

  // Save the current transcript as a new saved chat.
  router.post('/workspace/:urlKey/api/task-chat/saved', workspaceFromUrl, async (req, res) => {
    const linearUserId = resolveSavedChatUser(req, res);
    if (!linearUserId) return;

    const body = req.body || {};
    const taskIdentifier = typeof body.taskIdentifier === 'string'
      ? body.taskIdentifier
      : (typeof body.issueId === 'string' ? body.issueId : '');
    // Accept `transcript` or `history` (the client sends the same array it
    // replays); sanitize to the shared `{role, content}` shape either way.
    const transcript = sanitizeHistory(body.transcript || body.history);

    try {
      const chat = await savedChatStore.create(req.workspace.urlKey, linearUserId, { taskIdentifier, transcript });
      res.status(201).json({ chat });
    } catch (error) {
      // Validation failures (e.g. empty transcript) are a 400; anything else 500.
      const isValidation = /required|at least one message/i.test(error.message || '');
      if (isValidation) return res.status(400).json({ error: error.message });
      console.error('Saved chat create error:', error);
      res.status(500).json({ error: 'Failed to save the chat' });
    }
  });

  // Full transcript for one saved chat (for re-hydration / resume).
  router.get('/workspace/:urlKey/api/task-chat/saved/:id', workspaceFromUrl, async (req, res) => {
    const linearUserId = resolveSavedChatUser(req, res);
    if (!linearUserId) return;
    try {
      const chat = await savedChatStore.get(req.workspace.urlKey, linearUserId, req.params.id);
      if (!chat) return res.status(404).json({ error: 'Saved chat not found' });
      res.json({ chat });
    } catch (error) {
      console.error('Saved chat get error:', error);
      res.status(500).json({ error: 'Failed to load the saved chat' });
    }
  });

  // Hard-delete a saved chat.
  router.delete('/workspace/:urlKey/api/task-chat/saved/:id', workspaceFromUrl, async (req, res) => {
    const linearUserId = resolveSavedChatUser(req, res);
    if (!linearUserId) return;
    try {
      const deleted = await savedChatStore.delete(req.workspace.urlKey, linearUserId, req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Saved chat not found' });
      res.json({ ok: true });
    } catch (error) {
      console.error('Saved chat delete error:', error);
      res.status(500).json({ error: 'Failed to delete the saved chat' });
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
    const safeHistory = sanitizeHistory(history);

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
        // Simulate one read-only tool hop so e2e can prove breadcrumb rendering
        // and tool-derived data without a live LLM. The `tool` events mirror the
        // real streamChatWithTools breadcrumb shape ({ phase, name, arguments }).
        const followUp = buildMockFollowUpTrigger(question);
        const related = followUp ? null : buildMockToolReference(context);
        if (followUp) {
          sendSSE(res, 'tool', { phase: 'call', iteration: 1, name: 'send_follow_up', arguments: followUp });
          sendSSE(res, 'tool', { phase: 'result', iteration: 1, name: 'send_follow_up', result: `queued a follow-up to session ${followUp.sessionId}` });
        } else if (related) {
          sendSSE(res, 'tool', { phase: 'call', iteration: 1, name: 'lookup_task', arguments: { issueId: related.identifier } });
          sendSSE(res, 'tool', { phase: 'result', iteration: 1, name: 'lookup_task', result: `${related.identifier} — ${related.title}` });
        }
        const answer = buildMockAnswer(context, question, related);
        sendSSE(res, 'token', { token: answer });
        sendSSE(res, 'done', {});
        return res.end();
      }

      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });
      const messages = buildTaskChatMessages(context.issue, context, question.trim(), safeHistory);
      const callMeta = { urlKey: workspace?.urlKey || null, feature: 'task-chat', issueIdentifier: context.issue?.identifier || null };

      // Forward every SSE event through untouched (including `tool` breadcrumbs,
      // which the client renders but never adds to chat history) and close the
      // stream on the terminal event. Shared by both the tool-calling and the
      // plain-streaming branches below.
      const onEvent = (type, data) => {
        sendSSE(res, type, data);
        if (type === 'done' || type === 'error') {
          res.end();
        }
      };

      if (isToolCapableModel(selectedModel)) {
        // Tool-capable model: offer the read-only, workspace-scoped catalog so a
        // turn can look up related tasks. The whole loop is ONE turn — the single
        // free-tier tryUse above still covers it; we add no per-hop quota call.
        const provider = getProviderForWorkspace(workspace);
        const { tools, executeTool } = createChatToolCatalog({
          provider,
          scope: getWorkspaceCallScope(workspace),
          recapCacheStore,
          briefCacheStore,
          urlKey: workspace.urlKey,
          // LIN-1073: session read-model + the gated follow-up write. This is
          // the ONE deliberate call site that opts into followUpEnabled.
          dispatchQueueStore,
          agentStatusStore,
          sessionIsTerminal,
          followUpEnabled: true,
          dispatchedBy: req.session.linearUserId || null,
        });
        await streamChatWithTools(
          messages,
          {
            apiKey: apiKeyToUse, model: selectedModel, maxTokens: 1500, tools, executeTool, callMeta,
            // Additive per-tool budget so get_comments can return full comment
            // bodies while every other tool keeps the 4000-char default (LIN-1065).
            toolResultMaxCharsByTool: CHAT_TOOL_RESULT_BUDGETS,
          },
          onEvent
        );
      } else {
        // Unknown-capability model: degrade to plain streaming with tools OFF.
        // We do NOT silently swap to a tool-capable model — the user's choice is
        // honored; free-tier already forces the tool-capable DEFAULT_MODEL.
        await streamChat(
          messages,
          { apiKey: apiKeyToUse, model: selectedModel, maxTokens: 1500, callMeta },
          onEvent
        );
      }
    } catch (error) {
      console.error('Task chat stream error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate a response' });
      res.end();
    }
  });

  return router;
}
