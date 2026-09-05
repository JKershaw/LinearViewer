/**
 * routes/proxy-flight-companion.js — LIN-2620.
 *
 * POST /api/proxy/flight-companion/turn: the Flight Companion turn, reachable
 * over the workspace API proxy so an agent (not just a human in a browser
 * tab) can drive one. Built entirely on the extracted turn core
 * (`lib/flight-companion-turn.js`, LIN-2631) — this file owns NO copy of the
 * gate/reservation/stream-loop logic, only the HTTP shape: auth, credential
 * resolution, request/response translation.
 *
 * ALWAYS propose mode, regardless of message presence (LIN-2434's approval
 * guardrail is untouched — a proxy caller is an agent, not a human, so a
 * model-proposed follow-up still waits for a human on the session-auth
 * approve endpoint). A message-less (auto-wake-shaped) proxy turn runs the
 * SAME pre-call census gate the browser's silent tick does, but against its
 * OWN reservation instance (`companion:v1:<urlKey>:proxy`, via
 * `instanceKeySuffix` — LIN-2620's one named, minimal addition to the core)
 * so an agent polling this endpoint can never advance — and so never
 * silently consume — the browser's own `companion:v1:<urlKey>` census delta
 * before a human has seen it (the LIN-2449 shape from a new trigger).
 *
 * `read` scope, like every other compute route (routes/proxy-compute.js) —
 * `requireWriteScope` is never called here. A proposal is not a write.
 *
 * Credential: the token creator's own OpenRouter key
 * (`getWorkspaceOpenRouterKey` + `resolveProxyLLM`, exactly as recap/brief
 * do), never the caller's own bearer token — the proxy token authenticates
 * the CALL, not the LLM spend.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendSSE } from '../lib/sse.js';
import { runFlightCompanionTurn } from '../lib/flight-companion-turn.js';
import { filterChatTurns } from '../lib/chat-transcript.js';
import { streamChat as defaultStreamChat, streamChatWithTools as defaultStreamChatWithTools, isRecommendationEnabled } from '../lib/openrouter.js';
import { createChatToolCatalog as defaultCreateChatToolCatalog } from '../lib/chat-tools.js';
import { buildCensusSeedText } from './flight-companion.js';
import { sessionIsTerminal, enrichLoop } from './dashboard.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { jsonError } from '../lib/errors.js';

// Restated, not imported (lib/flight-companion-turn.js's own house convention
// for these prefixes/limits): a proxy caller's message body is capped the
// same as the browser's, so a giant payload cannot inflate the prompt either
// way. Kept in sync by inspection, not by a shared constant, matching how
// lib/flight-companion-turn.js restates COMPANION_INSTANCE_PREFIX/
// SWEEP_INSTANCE_PREFIX rather than importing them.
const MAX_MESSAGE_LENGTH = 2000;

// LIN-2620: a message-less (auto-wake-shaped) proxy turn reserves/commits
// against its OWN companion instance, never the browser's — see this file's
// header and lib/flight-companion-turn.js's `instanceKeySuffix` doc.
const PROXY_INSTANCE_SUFFIX = ':proxy';

// Named caps (ticket 2620): a per-token hourly bound and a per-workspace
// daily bound, independent of and in addition to `proxyLimiter`'s per-IP
// 60/min. In-memory, like `proxyLimiter` itself (routes/proxy.js) — process-
// local budgets that reset on restart, not a durable per-workspace store
// (lib/free-tier-store.js's shape) — simple and safe, and easy to graduate
// to a durable store later if the in-memory bound proves too loose in
// practice. Every dispatched worker holds a readWrite working token, so
// these caps are the real bound on a worker spending its creator's key here.
export const PROXY_TURN_HOURLY_LIMIT = 30;
export const PROXY_TURN_DAILY_LIMIT = 200;

// Both limiters run AFTER `authenticateProxyToken` in the chain below, which
// either 401s (never reaching these) or sets `req.proxyTokenId`/
// `req.proxyUrlKey` before calling `next()` — so neither key is ever IP-
// derived, and no `ipKeyGenerator` fallback is needed (express-rate-limit's
// own IPv6-safety lint would otherwise require one for any key touching
// `req.ip`).
const proxyTurnHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: PROXY_TURN_HOURLY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.proxyTokenId,
  message: { error: 'Too many Flight Companion turns from this token this hour, try again later' },
  skip: () => process.env.NODE_ENV === 'test',
});

const proxyTurnDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: PROXY_TURN_DAILY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.proxyUrlKey,
  message: { error: 'Too many Flight Companion turns for this workspace today, try again tomorrow' },
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * Merge the core's per-event `tool` frames (call/result/error/proposed,
 * keyed by the event's own `id`) into one row per tool invocation, for the
 * default (non-streaming) response body. `cap` frames carry no `id` (no
 * single call owns them) and are not represented here — a streaming caller
 * still sees them verbatim, since streaming forwards every frame unchanged.
 *
 * @param {Array<{type: string, data: Object}>} events
 * @returns {{tools: Array<Object>, proposals: Array<Object>}}
 */
function mergeToolEvents(events) {
  const byId = new Map();
  const order = [];
  for (const { type, data } of events) {
    if (type !== 'tool' || !data || data.id == null) continue;
    if (!byId.has(data.id)) {
      byId.set(data.id, { name: data.name, arguments: data.arguments });
      order.push(data.id);
    }
    const row = byId.get(data.id);
    row.phase = data.phase;
    if (data.phase === 'result' || data.phase === 'proposed') row.result = data.result;
    if (data.phase === 'error') row.error = data.error;
  }
  const tools = order.map((id) => byId.get(id));
  const proposals = tools.filter((t) => t.phase === 'proposed').map((t) => t.result);
  return { tools, proposals };
}

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local) — the "a proxy-events row per turn" ticket line
 * @param {Function} deps.getWorkspaceOpenRouterKey - Resolves the TOKEN CREATOR's own OpenRouter key (module-scope, shared)
 * @param {Function} deps.resolveProxyLLM - Resolves {apiKey, isFreeTier} from a session key (module-scope in routes/proxy.js, shared)
 * @param {Function} deps.chargeFreeTierOrReject - Free-tier metering choke point (closure-local, shared with compute/dispatch groups)
 * @param {Object} deps.observerStateStore - Census/companion reservation store (turn-core dep)
 * @param {Object} deps.workspacePreferencesStore - Model + preference resolution (turn-core dep)
 * @param {Object} deps.recapCacheStore - `get_comments`-adjacent tool dep (turn-core dep, via createToolCatalog)
 * @param {Object} deps.briefCacheStore - Tool dep (turn-core dep, via createToolCatalog)
 * @param {Object} deps.dispatchQueueStore - Tool dep: session/follow-up reads (turn-core dep)
 * @param {Object} deps.agentStatusStore - Tool dep: session reads (turn-core dep)
 * @param {Object} deps.proxyTokenStore - Tool dep: `send_follow_up`'s bootstrap-provisioning seam (turn-core dep; inert under propose mode, kept for parity with the session route)
 * @param {Object} [deps.taskDecisionsStore] - Optional tool dep (LIN-2617); absent → that one tool reports "not configured"
 * @param {Object} [deps.shelvedRulingsStore] - Optional tool dep (LIN-2617); absent → that one tool reports "not configured"
 * @param {{streamChat: Function, streamChatWithTools: Function}} [deps.chatClient] - Test seam; defaults to the real lib/openrouter.js exports
 * @param {Function} [deps.createToolCatalog] - Test seam; defaults to the real lib/chat-tools.js factory
 * @returns {Router}
 */
export function createProxyFlightCompanionRoutes({
  proxyLimiter,
  authenticateProxyToken,
  resolveProviderAccess,
  workspaceUnavailable,
  logEvent,
  getWorkspaceOpenRouterKey,
  resolveProxyLLM,
  chargeFreeTierOrReject,
  observerStateStore,
  workspacePreferencesStore,
  recapCacheStore,
  briefCacheStore,
  dispatchQueueStore,
  agentStatusStore,
  proxyTokenStore,
  taskDecisionsStore = null,
  shelvedRulingsStore = null,
  chatClient = { streamChat: defaultStreamChat, streamChatWithTools: defaultStreamChatWithTools },
  createToolCatalog = defaultCreateChatToolCatalog,
}) {
  const router = Router();
  const ENDPOINT = '/api/proxy/flight-companion/turn';

  router.post(
    ENDPOINT,
    proxyLimiter,
    authenticateProxyToken,
    proxyTurnHourlyLimiter,
    proxyTurnDailyLimiter,
    async (req, res) => {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!accessToken) {
        return workspaceUnavailable(req, res, ENDPOINT, reason);
      }

      const body = req.body || {};
      const rawMessage = typeof body.message === 'string' ? body.message : '';
      const hasUserMessage = rawMessage.trim().length > 0;
      const turnKind = hasUserMessage ? 'user-initiated' : 'auto-wake';
      const wantsStream = body.stream === true;

      if (hasUserMessage && rawMessage.length > MAX_MESSAGE_LENGTH) {
        logEvent(req, ENDPOINT, 400);
        return jsonError(res, 400, `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
      }
      const safeHistory = filterChatTurns(body.history);

      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);
      const { apiKey: apiKeyToUse, isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (!isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, ENDPOINT, 503);
        return jsonError(res, 503, 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY on the server.');
      }

      const workspace = { urlKey: req.proxyUrlKey };
      const events = [];
      let streaming = false;
      const startStream = () => {
        if (streaming) return;
        streaming = true;
        if (wantsStream) {
          res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.flushHeaders?.();
        }
      };
      const keepalive = wantsStream ? null : armKeepalive(res);

      // LIN-2449, preserved for a proxy caller too: a client that vanishes
      // mid-turn must not have its reservation released here — it self-
      // expires via the lease — but the model call itself should stop
      // rather than run to completion for output nobody reads.
      const clientAbort = new AbortController();
      let clientGone = false;
      res.on('close', () => {
        if (res.writableFinished) return;
        clientGone = true;
        clientAbort.abort();
      });

      try {
        const outcome = await runFlightCompanionTurn({
          workspace,
          turnKind,
          message: hasUserMessage ? rawMessage.trim() : null,
          history: safeHistory,
          apiKey: apiKeyToUse,
          isFreeTier,
          // LIN-2620: ALWAYS propose — a proxy caller is an agent, never a
          // human, regardless of message presence. This is the "second
          // producer" LIN-2439 hardened chat-tools.js's boundary against.
          followUpMode: 'propose',
          instanceKeySuffix: PROXY_INSTANCE_SUFFIX,
          via: 'proxy',
          onStreamStart: startStream,
          onEvent: (type, data) => {
            events.push({ type, data });
            if (wantsStream) {
              sendSSE(res, type, data);
              if (type === 'done' || type === 'error') res.end();
            }
          },
          signal: clientAbort.signal,
          isClientGone: () => clientGone,
          onBeforeSpend: async () => {
            if (!isFreeTier) return null;
            const check = await chargeFreeTierOrReject(req, ENDPOINT);
            return check ? { reason: 'free-tier', freeTierCheck: check.body?.freeTier } : null;
          },
          deps: {
            observerStateStore,
            workspacePreferencesStore,
            recapCacheStore,
            briefCacheStore,
            dispatchQueueStore,
            agentStatusStore,
            taskDecisionsStore,
            shelvedRulingsStore,
            proxyTokenStore,
            sessionIsTerminal,
            enrichLoop,
            chatClient,
            createToolCatalog,
            getProvider: () => provider,
            getScope: () => accessToken,
            buildCensusSeedText,
            baseUrl: `${req.protocol}://${req.get('host')}`,
            dispatchedBy: req.proxyCreatedBy || null,
          },
        });

        if (wantsStream) {
          // Every frame already left through onEvent above; a refusal that
          // never reached onStreamStart falls through to the JSON branch
          // below exactly like the session route's own (non-streaming
          // headers were never sent, so a plain JSON refusal is still safe).
          if (streaming) {
            logEvent(req, ENDPOINT, 200);
            return;
          }
        }

        const { tools, proposals } = mergeToolEvents(events);
        const doneEvent = events.find((e) => e.type === 'done');
        const text = events.filter((e) => e.type === 'token').map((e) => e.data?.token || '').join('');
        const responseBody = {
          turnKind: outcome.turnKind,
          spent: outcome.spent,
          ...(outcome.spent ? {} : { reason: outcome.reason }),
          text,
          tools,
          proposals,
          usage: doneEvent?.data?.usage ?? null,
          model: doneEvent?.data?.model ?? null,
        };
        // Mirrors the session route exactly: a user-initiated free-tier
        // refusal is the one case that surfaces as an error status (429) —
        // an auto-wake free-tier refusal (nobody necessarily watching) stays
        // a silent 200, same as every other gate/quota refusal here.
        const status = (!outcome.spent && outcome.reason === 'free-tier' && turnKind === 'user-initiated') ? 429 : 200;
        logEvent(req, ENDPOINT, status);
        keepalive?.stop();
        keepalive ? keepalive.send(status, responseBody) : res.status(status).json(responseBody);
      } catch (error) {
        keepalive?.stop();
        if (clientGone) {
          console.error('Flight Companion proxy turn: client disconnected mid-turn, census delta left unconsumed', {
            urlKey: req.proxyUrlKey, error: error?.message,
          });
          return;
        }
        console.error('Flight Companion proxy turn error:', error);
        if (streaming && wantsStream) {
          sendSSE(res, 'error', { message: 'Failed to generate a response' });
          return res.end();
        }
        logEvent(req, ENDPOINT, 500);
        const body = { error: 'Failed to generate a response' };
        keepalive ? keepalive.send(500, body) : res.status(500).json(body);
      }
    }
  );

  return router;
}
