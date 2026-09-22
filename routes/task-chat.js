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
import { streamChat, streamChatWithTools, isRecommendationEnabled } from '../lib/openrouter.js';
import { createChatToolCatalog } from '../lib/chat-tools.js';
import { runAgentTurn } from '../lib/agent-turn.js';
import { sessionIsTerminal, enrichLoop } from './dashboard.js';
import { resolveIssueBinding, isValidIssueId, getWorkspaceCallScope } from '../lib/workspace.js';
import { getProvider, getProviderForWorkspace } from '../lib/providers/registry.js';
import { testMockData } from '../tests/fixtures/mock-data.js';
import { filterChatTurns } from '../lib/chat-transcript.js';
import { resolveChatCredential, checkFreeTierGate, CHAT_MESSAGE_MAX_LENGTH } from '../lib/chat-request.js';
import { sendSSE } from '../lib/sse.js';

const MAX_QUESTION_LENGTH = CHAT_MESSAGE_MAX_LENGTH;

/**
 * Sanitize a chat transcript to the durable `{role, content}` shape: only
 * user/assistant turns with string content survive. Shared by the turn endpoint
 * (replays client history) and the saved-chat save endpoint (LIN-1008) so a
 * stored transcript re-hydrates and replays byte-identically through the
 * unchanged turn route. This is also what keeps tool breadcrumbs / model / cost
 * out of a saved transcript.
 */
function sanitizeHistory(history) {
  return filterChatTurns(history);
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
 * LIN-2812: a mock-only trigger so e2e can witness the per-token scroll gate
 * (public/task-chat.js) across REAL, separately-flushed SSE frames — the
 * normal single-frame mock answer completes in one write and can't exercise
 * a reader scrolling away mid-stream. Most frames add only a few words (a
 * small, realistic per-token/per-message delta), but the frame carrying
 * `MID_MARKER` is deliberately grouped much larger so it alone pushes the
 * transcript's height past isPinnedToBottom's 60px threshold in one hop —
 * matching the shape of the production single-frame answer path
 * (lib/openrouter.js's short-circuit and non-streaming paths, which emit an
 * entire answer as one `token` frame). An earlier version of this fixture
 * kept every frame under the threshold, which is exactly what let LIN-2812's
 * first implementation ship with the predicate sampled after the DOM
 * mutation: no fixture frame was ever big enough to expose the ordering bug.
 * `MID_MARKER`/`END_MARKER` give the e2e witness fixed points to synchronize
 * on. Frames are separated by a real delay so the browser's fetch reader
 * genuinely yields between them.
 */
function buildMockSlowStreamTrigger(question) {
  return /stream slowly/i.test(String(question || ''));
}

function buildMockSlowStreamFrames() {
  const words = [];
  for (let i = 1; i <= 140; i++) words.push(`filler-word-${i}`);
  const midIndex = 100;
  words.splice(midIndex, 0, 'MID_MARKER');
  words.push('END_MARKER');
  // Group most words a few per frame so cadence still resembles real
  // per-token deltas, except the frame that starts at MID_MARKER: that one
  // is grouped as ~24 words in a single frame, big enough at the 900x300
  // e2e viewport to grow the transcript by more than 60px in one hop.
  const frames = [];
  let i = 0;
  while (i < words.length) {
    if (words[i] === 'MID_MARKER') {
      frames.push(words.slice(i, i + 24).join(' ') + ' ');
      i += 24;
    } else {
      frames.push(words.slice(i, i + 4).join(' ') + ' ');
      i += 4;
    }
  }
  return frames;
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
 * @param {Object}   [deps.proxyTokenStore]    - proxy token store (LIN-1431): lets the gated
 *   `send_follow_up` tool provision a bootstrap credential for a follow-up resuming a
 *   broker-dependent (claude-code) session. Absent → provisioning degrades exactly as
 *   `provisionBootstrapToken` specifies (null for prose harnesses; fail-closed throw for
 *   claude-code, surfaced as a tool error rather than a silently credential-less resume)
 * @param {Object}   [deps.taskDecisionsStore] - LIN-2966 (subsumes LIN-2660): the
 *   scan-produced decisions input to the `list_pending_decisions` chat tool.
 *   Absent → that tool fails cleanly as "not configured"; every other tool is
 *   unaffected.
 * @param {Object}   [deps.shelvedRulingsStore] - LIN-2966: the shelved-rulings
 *   input to the same tool, so a deliberately shelved decision does not
 *   resurface in the chat.
 * @returns {Router}
 */
export function createTaskChatRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, savedChatStore, recapCacheStore, briefCacheStore, dispatchQueueStore, agentStatusStore, proxyTokenStore, taskDecisionsStore, shelvedRulingsStore }) {
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
      // LIN-1910: `source` is a HINT only, tied to the identifier it was minted
      // alongside (lib/render.js's chatHref) — the client drops it the moment
      // the user types a different task id (see public/task-chat.js).
      const rawSource = typeof req.query.source === 'string' ? req.query.source.trim().slice(0, 64) : '';
      const aiConfigured = isRecommendationEnabled(req.session.openRouterApiKey) || !!process.env.OPENROUTER_FREE_TIER_KEY;
      // Saved chats require a user identity (accountId). Absent only for a
      // genuinely anonymous session — local/GitHub sessions carry an accountId
      // via establishAccount same as Linear (LIN-1353) — the page renders an
      // explicit empty-state and omits the save affordance when it is (LIN-1008).
      const savedChatsAvailable = !!req.session.accountId;
      const html = renderTaskChatPage(
        { defaultTask: rawTask, defaultSource: rawSource, aiConfigured, savedChatsAvailable },
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
  // `taskChat` flag AND a present `accountId` (the only accepted identity, LIN-1353
  // — the prior session field excluded GitHub/local users even though they carry
  // a real accountId via establishAccount); an absent identity returns 401 rather
  // than fabricating a fallback id (mirrors dispatch recents). These literal
  // `/saved` routes MUST be registered BEFORE the `/:issueId` turn route below, or
  // Express matches `saved` as an issue id.
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
    const accountId = req.session.accountId;
    if (!accountId) {
      res.status(401).json({ error: 'Authentication required to use saved chats' });
      return null;
    }
    return accountId;
  };

  // List the current user's saved chats (metadata only, newest-first).
  router.get('/workspace/:urlKey/api/task-chat/saved', workspaceFromUrl, async (req, res) => {
    const accountId = resolveSavedChatUser(req, res);
    if (!accountId) return;
    try {
      const chats = await savedChatStore.list(req.workspace.urlKey, accountId);
      res.json({ chats });
    } catch (error) {
      console.error('Saved chat list error:', error);
      res.status(500).json({ error: 'Failed to list saved chats' });
    }
  });

  // Save the current transcript as a new saved chat.
  router.post('/workspace/:urlKey/api/task-chat/saved', workspaceFromUrl, async (req, res) => {
    const accountId = resolveSavedChatUser(req, res);
    if (!accountId) return;

    const body = req.body || {};
    const taskIdentifier = typeof body.taskIdentifier === 'string'
      ? body.taskIdentifier
      : (typeof body.issueId === 'string' ? body.issueId : '');
    // Accept `transcript` or `history` (the client sends the same array it
    // replays); sanitize to the shared `{role, content}` shape either way.
    const transcript = sanitizeHistory(body.transcript || body.history);

    try {
      const chat = await savedChatStore.create(req.workspace.urlKey, accountId, { taskIdentifier, transcript });
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
    const accountId = resolveSavedChatUser(req, res);
    if (!accountId) return;
    try {
      const chat = await savedChatStore.get(req.workspace.urlKey, accountId, req.params.id);
      if (!chat) return res.status(404).json({ error: 'Saved chat not found' });
      res.json({ chat });
    } catch (error) {
      console.error('Saved chat get error:', error);
      res.status(500).json({ error: 'Failed to load the saved chat' });
    }
  });

  // Hard-delete a saved chat.
  router.delete('/workspace/:urlKey/api/task-chat/saved/:id', workspaceFromUrl, async (req, res) => {
    const accountId = resolveSavedChatUser(req, res);
    if (!accountId) return;
    try {
      const deleted = await savedChatStore.delete(req.workspace.urlKey, accountId, req.params.id);
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
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.taskChat !== true) {
      return res.status(403).json({ error: 'Task chat feature is not enabled' });
    }

    if (!isValidIssueId(issueId)) {
      return res.status(400).json({ error: 'Invalid issue ID format' });
    }

    // Capability backstop — clean 422 (never a raw NotImplementedError → 502)
    // for a provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return res.status(422).json({
        error: "This workspace's provider does not support task chat for this issue",
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
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
    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });

    if (!mockAi && !apiKeyToUse) {
      return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (!mockAi) {
      const gate = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (gate) {
        return res.status(429).json({
          error: gate.reason,
          freeTier: {
            used: true,
            remaining: gate.remaining,
            limit: gate.limit,
            resetsAt: gate.resetsAt
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
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
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
        if (buildMockSlowStreamTrigger(question)) {
          for (const frame of buildMockSlowStreamFrames()) {
            sendSSE(res, 'token', { token: frame });
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          sendSSE(res, 'done', {});
          return res.end();
        }
        const answer = buildMockAnswer(context, question, related);
        sendSSE(res, 'token', { token: answer });
        sendSSE(res, 'done', {});
        return res.end();
      }

      // LIN-2371: the DECLARED provider identity for the persona sentence.
      //
      // Row-correct AND fallback-free, which needs both halves (the second was
      // found by review). `?source=` is a real client-sent param
      // (public/task-chat.js), so on a multi-binding workspace the row being
      // chatted with may come from a different backend than the workspace's own
      // active one — and LIN-2047 already settled, in this file, that this route
      // binds to the ROW's resolution rather than the workspace-active one.
      // Naming the workspace's provider there would assert a false one, the very
      // class this ticket fixes. So a requested source is honoured, but ONLY when
      // it matches a REAL binding — `workspace.bindings` is read directly rather
      // than through `getBindingsForWorkspace`, which SYNTHESIZES a
      // `provider || 'linear'` binding for a legacy workspace and would smuggle
      // the Linear default back in. A client-supplied param that matches nothing
      // is ignored, so it can never inject a provider name into the prose.
      //
      // The name is then resolved with `getProvider`, which is a bare registry
      // lookup carrying no legacy-Linear default — so an undeclared workspace
      // yields null and the persona degrades to "a single task" rather than
      // asserting Linear. Same derivation as routes/collective.js and the
      // feedback-triage dispatch in routes/workspace-api.js.
      //
      // Deliberately not read off `issueProvider` above: `resolveIssueBinding`'s
      // UNMATCHED branch ends in the defaulting lookup, so its display name can
      // name a provider that was never declared.
      const declaredSource = (typeof requestedSource === 'string' && requestedSource
        && (workspace.bindings || []).some(b => b.provider === requestedSource))
        ? requestedSource
        : workspace.provider;
      const providerDisplayName = getProvider(declaredSource)?.ui?.displayName ?? null;
      // The core's own seam (`deps.buildMessages`, see lib/agent-turn.js) — it
      // ignores the Flight-Companion-shaped fields (censusSeedText/turnKind/
      // playbook) the core passes and uses only `message`/`history`.
      const buildTaskChatTurnMessages = ({ message, history }) => {
        return buildTaskChatMessages(context.issue, context, message, history, providerDisplayName);
      };

      // Forward every SSE event through untouched (including `tool` breadcrumbs,
      // which the client renders but never adds to chat history) and close the
      // stream on the terminal event.
      const onEvent = (type, data) => {
        sendSSE(res, type, data);
        if (type === 'done' || type === 'error') {
          res.end();
        }
      };

      // LIN-2966: Task Chat drives the shared agent-turn core (lib/agent-turn.js)
      // instead of its own inline model-pick/tool-catalog/stream loop. The core
      // now owns model resolution (via `opKind: 'task-chat'`, so a per-operation
      // Settings override reaches Task Chat the same way it already reaches
      // Flight Companion), the credential-adjacent free-tier/config posture is
      // already handled above (checked before the core is ever called, so
      // `onBeforeSpend` is unneeded here), and the tool-capable/degrade branch.
      // `turnKind: 'user-initiated'` means the reservation/gate machinery below
      // (auto-wake/boot only) never engages — this call is model resolution +
      // catalog + stream, nothing more.
      await runAgentTurn({
        workspace,
        turnKind: 'user-initiated',
        message: question.trim(),
        history: safeHistory,
        apiKey: apiKeyToUse,
        isFreeTier,
        opKind: 'task-chat',
        issueIdentifier: context.issue?.identifier || null,
        // Task Chat has never exposed a `remember`/playbook write tool — this
        // keeps it that way rather than inheriting the core's own default.
        allowPlaybookWrite: false,
        onEvent,
        deps: {
          chatClient: { streamChat, streamChatWithTools },
          createToolCatalog: createChatToolCatalog,
          // Bound to the SAME row binding (issueProvider/issueCallScope,
          // resolved above at :336) the context fetch used above — not the
          // workspace-active binding — so a lookup tool the model calls
          // mid-turn resolves the same source the answer is already grounded
          // in (LIN-2047). `workspace` (the core's own catalog-scope input) is
          // deliberately ignored by both closures, mirroring
          // routes/proxy-flight-companion.js's own `getProvider`/`getScope`.
          getProvider: () => issueProvider,
          getScope: () => issueCallScope,
          // LIN-2967: the `row`-tier pair above is what LIN-2047 deliberately
          // re-pointed at the row's own binding — correct for a row-scoped
          // read, wrong for a workspace-wide one. `get_stack` and
          // `get_pr_status` are declared `workspace`-tier
          // (lib/chat-tools.js's `CHAT_TOOL_SCOPE_TIERS`), so this override is
          // what stops them from silently inheriting the row's binding on a
          // foreign-source row — the exact bug this route's own prior comment
          // here used to document as a known limitation.
          scopeByTier: {
            workspace: {
              provider: getProviderForWorkspace(workspace),
              scope: getWorkspaceCallScope(workspace),
            },
          },
          recapCacheStore,
          briefCacheStore,
          urlKey: workspace.urlKey,
          // LIN-1073: session read-model + the gated follow-up write.
          dispatchQueueStore,
          agentStatusStore,
          sessionIsTerminal,
          // LIN-2966 (subsumes LIN-2660): the two inputs `list_pending_decisions`
          // needs to return the same rows the rulings feed returns.
          taskDecisionsStore,
          shelvedRulingsStore,
          enrichLoop,
          // LIN-1139: thread the workspace prefs store so a tool-driven follow-up
          // resolves model/harness through the shared dispatch factory.
          workspacePreferencesStore,
          // LIN-1431: same reason, one layer on — provisionBootstrapToken needs both
          // of these, so a tool-driven follow-up onto a claude-code session can carry
          // a live credential instead of resuming into a dead broker (LIN-1362/1375).
          proxyTokenStore,
          baseUrl: `${req.protocol}://${req.get('host')}`,
          dispatchedBy: req.session?.accountId || null,
          buildMessages: buildTaskChatTurnMessages,
        },
      });
    } catch (error) {
      console.error('Task chat stream error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate a response' });
      res.end();
    }
  });

  return router;
}
