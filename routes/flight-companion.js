/**
 * Flight Companion route — the experimental prototype for LIN-751's "realtime
 * chat interface for work in flight" (LIN-922).
 *
 * Anchored at /workspace/:urlKey/flight-companion, reusing workspaceFromUrl + the
 * collective/task-chat/next-run feature-gate-redirect-to-settings pattern. The
 * page is a provider-free stub that surfaces the exact kickoff prompt
 * (buildFlightCompanionKickoff) for copy/paste into a real Claude Code session —
 * the prototype's whole mechanism (a session standing in for the model, its curls
 * as tools). No new transport is invented; the prompt reuses the proven proxy
 * kickoff shape.
 *
 *   GET  /workspace/:urlKey/flight-companion        — page shell (gated)
 *   POST /workspace/:urlKey/api/flight-companion/turn — SSE chat turn (LIN-2432 §A.3)
 *
 * There is intentionally no launch/dispatch endpoint in this V1: the prototype is
 * validated by pasting the prompt into a session by hand and watching it, which
 * also keeps the user-approval gate honest (nothing dispatches from this page). A
 * launch-via-dispatch button is a named, deferred follow-up.
 *
 * ## The turn endpoint (LIN-2432 §A.3) — trigger taxonomy
 *
 * Copy-adapted from `routes/task-chat.js`'s SSE turn endpoint: same `token`/
 * `tool`/`done`/`error` SSE events, the same shared §A.1 sanitiser
 * (`filterChatTurns`, unclamped), the same free-tier `tryUse` gate, the same
 * `isToolCapableModel` degrade to plain `streamChat`, the same account-attributed
 * credential chain (`req.session.accountId` — `linearUserId` is dead code post-
 * LIN-1332 and is never reintroduced here).
 *
 * What's different from Task Chat: the turn SHAPE is derived server-side from
 * whether the request body carries a new, non-empty `message` — **never** a
 * client-asserted flag. A body claiming any other shape (e.g. a stray
 * `triggerType`/`kind` field) is simply never read for this purpose:
 *
 *   - **user-initiated** (real `message` text present) → `followUpMode: 'execute'`,
 *     identical write posture to Task Chat today.
 *   - **auto-wake** (no real message text) → `followUpMode: 'propose'` (§A.4: the
 *     `send_follow_up` tool can still be REASONED ABOUT and REQUESTED —
 *     `followUpEnabled` stays `true` for both shapes — but its write only
 *     *executes* on a turn a human demonstrably started). An auto-wake turn also
 *     runs §A.2's `shouldSpendTurn` (`lib/flight-companion-gate.js`) FIRST — before
 *     `tryUse`, before any model call — reusing the companion's own
 *     `companion:v1:<urlKey>` `observerStateStore` instance (no new store) against
 *     the sweep's `sweep:v1:<urlKey>` census. `false` short-circuits with a cheap
 *     JSON response; no quota is touched and no model is called. A free-tier
 *     `tryUse` rejection is asymmetric too: 429 (with the `freeTier` body) for
 *     user-initiated, silent (plain 200, no toast) for auto-wake — there may be no
 *     one watching an auto-wake tick.
 *
 * The `tool` SSE event gains one new `phase` value, `'proposed'` — never a new
 * event kind — emitted in place of the generic `'result'` phase specifically when
 * `send_follow_up`'s own return value carries `proposed: true` (the propose-mode
 * executor's contract, LIN-2432 beat 1). This is self-describing from the
 * executor's own return shape, not a second turnKind branch threaded through the
 * SSE forwarding — so it can never fire for an `execute`-mode call, which never
 * returns that shape.
 */

import { Router } from 'express';
import { renderFlightCompanionPage } from '../lib/render-flight-companion.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildFlightCompanionKickoff } from '../lib/prompts/flight-companion-kickoff.js';
import { PASS_INSTANCE_PREFIX } from '../lib/observer-pass.js';
import { COMPANION_INSTANCE_PREFIX, COMPANION_SEED_STATE, shouldSpendTurn, buildCompanionSnapshot } from '../lib/flight-companion-gate.js';
import { filterChatTurns } from '../lib/chat-transcript.js';
import { streamChat as defaultStreamChat, streamChatWithTools as defaultStreamChatWithTools, isToolCapableModel, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { createChatToolCatalog as defaultCreateChatToolCatalog, CHAT_TOOL_RESULT_BUDGETS } from '../lib/chat-tools.js';
import { sessionIsTerminal } from './dashboard.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope } from '../lib/workspace.js';

// Duplicated, not imported — same house convention `lib/flight-companion-gate.js`'s
// own header documents (each observer-pipeline-stage file restates its own
// instance-key prefix rather than sharing a cross-module import).
const SWEEP_INSTANCE_PREFIX = 'sweep:v1:';

const MAX_MESSAGE_LENGTH = 2000;

function sendSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Restated, not imported, from lib/flight-companion-gate.js's own private
// LANE_KEYS (which itself restates lib/observer-sweep.js's LANE_KEYS) — same
// house convention its header documents: each consumer of the 7-lane census
// vocabulary restates it rather than sharing a cross-module import.
const CENSUS_LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];

/**
 * §A.7: the deterministic census seed, built from the SAME raw sweep census
 * doc (`sweep:v1:<urlKey>`, via `buildCompanionSnapshot`) the auto-wake gate
 * already reads. Every number below is interpolated straight from the
 * snapshot with no rounding/reformatting/recomputation — copied verbatim, so
 * a caller diffing this text against `buildCompanionSnapshot`'s own output
 * finds the exact same values. The model is told explicitly to treat these as
 * ground truth and narrate, never recompute or restate them differently; it
 * can reach for `list_task_sessions`/`get_session` (via its tool catalog) for
 * depth beyond these counts — never a `/api/dashboard/*` poll, which a
 * proxy-token session can't reach anyway and which this route must not add.
 *
 * @param {Object|null} currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s
 *   result, or `null` when no sweep has ever run for this workspace.
 * @returns {string}
 */
// Exported ONLY for direct unit testing of the verbatim guarantee (LIN-2432
// §A.7) — `buildFlightCompanionMessages` itself stays local/unexported (per
// beat-2 feedback: no premature lib/prompts/ extraction), the same
// local-helper-plus-source-grep testing shape routes/task-chat.js already
// uses for its own unexported sanitizeHistory. This is the one pure,
// deterministic piece worth a real import-and-call test rather than a
// source-text assertion.
export function buildCensusSeedText(currentCensusDoc) {
  if (!currentCensusDoc) {
    return 'CURRENT CENSUS: not available yet for this workspace (no sweep has run).';
  }
  const snapshot = buildCompanionSnapshot(currentCensusDoc);
  const laneLines = CENSUS_LANE_KEYS.map((key) => `  ${key}: ${snapshot.lanes[key]}`).join('\n');
  return [
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):',
    laneLines,
    `  attention items: ${snapshot.attentionCount}${snapshot.truncated ? ' (list truncated)' : ''}`,
    `  census revision: ${snapshot.censusRev}`,
  ].join('\n');
}

/**
 * Turn messages: system framing (persona + the §A.7 census seed) + replayed
 * history + the new turn. An auto-wake turn (no new user text) still needs a
 * turn-shaped final message so the model has something to react to — a fixed,
 * neutral prompt stands in for a real user turn.
 */
function buildFlightCompanionMessages({ history, message, censusDoc }) {
  const system = {
    role: 'system',
    content: [
      "You are the Flight Companion for this workspace — a friendly, up-to-speed colleague who " +
        "watches work in flight and talks it through with the human.",
      buildCensusSeedText(censusDoc),
      "Use your tools (list_task_sessions, get_session, get_stack, and the rest of the read catalog) " +
        "when you want more depth than the census above gives you. You may call send_follow_up to " +
        "reason about or request a follow-up on a session, but its write may not always execute " +
        "immediately — respect whatever the tool itself reports back.",
    ].join('\n\n'),
  };
  const turnMessage = {
    role: 'user',
    content: message || '(No new message from the human this tick — check on anything that changed and only speak up if there is something worth surfacing.)',
  };
  return [system, ...history, turnMessage];
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl    - middleware: session + req.workspace
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo       - () → deploy metadata
 * @param {import('../lib/observer-state-store.js').ObserverStateStore} [deps.observerStateStore] -
 *   LIN-2395's read-only report-panel source, ALSO reused (no new store) by the
 *   turn endpoint's §A.2 gate for both the `companion:v1:<urlKey>` instance
 *   (ensureSeeded/readCurrent/advance) and the read-only `sweep:v1:<urlKey>`
 *   census read. Optional so the GET page keeps working (empty-state panel) if
 *   omitted; the turn endpoint's auto-wake path requires it.
 * @param {Object} [deps.freeTierStore] - LIN-2432 §A.3: free-tier usage store
 *   (`tryUse`), mirroring Task Chat's own gate. Wired in server.js §A.12.
 * @param {Object} [deps.workspacePreferencesStore] - LIN-2432 §A.3/§A.4: model
 *   selection (`resolveWorkspaceModel`) AND threaded into `createChatToolCatalog`
 *   for the `send_follow_up` tool's dispatch-factory defaults (LIN-1139) — this
 *   is the one whose absence silently loses the LIN-1139 model/harness
 *   inheritance a §A.6 approval-time enqueue would otherwise get, so its
 *   presence here is load-bearing, not cosmetic. Wired in server.js §A.12.
 * @param {Object} [deps.recapCacheStore] - `get_recap` chat tool (cache-only).
 *   Wired in server.js §A.12.
 * @param {Object} [deps.briefCacheStore] - `get_brief` chat tool (cache-only).
 *   Wired in server.js §A.12.
 * @param {Object} [deps.dispatchQueueStore] - session read-model + the gated
 *   `send_follow_up` write (LIN-1073). Wired in server.js §A.12.
 * @param {Object} [deps.agentStatusStore] - the other session read-model dep.
 *   Wired in server.js §A.12.
 * @param {Object} [deps.proxyTokenStore] - LIN-1431 bootstrap-token provisioning
 *   for an `execute`-mode follow-up resuming a claude-code session. Optional,
 *   same as Task Chat's own wiring — absence degrades cleanly
 *   (`provisionBootstrapToken`'s own null/fail-closed contract) rather than
 *   crashing. Wired in server.js §A.12.
 *
 * DELIBERATELY NOT a param here, unlike `createTaskChatRoutes`: `savedChatStore`.
 * The ticket's §A.12 lists it parenthetically as "(§A.11)" — LIN-2437 ("Opt-in
 * saved-chat for Flight Companion transcripts"), a SEPARATE, still-`Todo` ticket
 * that is *blocked by* this one, i.e. depends on this one landing first, not the
 * other way round. Nothing in this route reads or writes a saved-chat store —
 * there is no `/api/flight-companion/saved` CRUD surface here the way Task
 * Chat's LIN-1008 routes exist for it — and `createChatToolCatalog` itself
 * accepts no `savedChatStore` param at all (verified against its actual
 * signature, `lib/chat-tools.js`), so the ticket's "needed by
 * createChatToolCatalog" framing does not hold for this one store at HEAD.
 * Threading a store reference through with zero readers would be inert,
 * untestable plumbing — worse than not passing it, since nothing would ever
 * catch it going stale. LIN-2437 is the natural, sole owner of wiring
 * `savedChatStore` alongside the CRUD routes it will add, the same one-piece
 * shape LIN-1008 used for Task Chat.
 * @param {{streamChat: Function, streamChatWithTools: Function}} [deps.chatClient] -
 *   LIN-2432 beat 4: the ONLY seam this route adds beyond what
 *   `routes/task-chat.js` has, and deliberately narrow — it overrides just the
 *   two functions that make a live OpenRouter call, defaulting to the real
 *   `lib/openrouter.js` exports so production behavior is byte-identical when
 *   omitted. Exists so the `isToolCapableModel` → plain `streamChat` degrade
 *   (an acceptance criterion) can be a REAL executable test — driving a fake
 *   `chatClient` and asserting on the calls it recorded — rather than a
 *   source-text assertion, without pulling the whole unit suite into Node's
 *   `--experimental-test-module-mocks` flag (which nothing else here uses).
 *   `isToolCapableModel` itself is NOT part of this seam: it is a pure,
 *   synchronous allowlist membership check (`lib/openrouter.js`) with no
 *   network of its own, so a test can call the real one directly.
 * @param {Function} [deps.createToolCatalog] - Same reasoning, for
 *   `createChatToolCatalog` (`lib/chat-tools.js`): defaults to the real one;
 *   overriding it lets a test capture the exact `followUpMode` the route
 *   passed in per turn shape — the OTHER acceptance criterion beat 2 could
 *   only pin structurally — via a fake catalog factory, with no network
 *   touched (the fake never has to actually call an LLM).
 * @returns {Router}
 */
export function createFlightCompanionRoutes({
  workspaceFromUrl, getOpenRouterSource, getDeployInfo, observerStateStore,
  freeTierStore, workspacePreferencesStore, recapCacheStore, briefCacheStore,
  dispatchQueueStore, agentStatusStore, proxyTokenStore,
  chatClient = { streamChat: defaultStreamChat, streamChatWithTools: defaultStreamChatWithTools },
  createToolCatalog = defaultCreateChatToolCatalog,
}) {
  const router = Router();

  router.get('/workspace/:urlKey/flight-companion', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/task-chat/next-run).
    if (featureFlags.flightCompanion !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const prompt = buildFlightCompanionKickoff({ baseUrl });
      // Read-only: readCurrent ONLY. This route must never be able to write
      // observer state — there is no ensureSeeded/advance call reachable
      // from request/render handling (LIN-2395).
      const observerReportDoc = observerStateStore
        ? await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${workspace.urlKey}`).catch(() => null)
        : null;
      const html = renderFlightCompanionPage(
        { prompt, observerReportDoc },
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
      console.error('Flight Companion page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Flight Companion page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/flight-companion`,
      });
      res.status(500).send(html);
    }
  });

  // ─── SSE chat turn (LIN-2432 §A.3) ──────────────────────────────────────────

  router.post('/workspace/:urlKey/api/flight-companion/turn', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    if (featureFlags.flightCompanion !== true) {
      return res.status(403).json({ error: 'Flight Companion feature is not enabled' });
    }

    const body = req.body || {};
    // §A.0: the turn shape is derived SERVER-SIDE from message presence —
    // NEVER a client-asserted flag. Any other body field (e.g. a stray
    // `triggerType`/`kind`) is simply never read for this purpose, so a
    // compromised/buggy client cannot claim "user-initiated" without
    // actually supplying real user text.
    const rawMessage = typeof body.message === 'string' ? body.message : '';
    const hasUserMessage = rawMessage.trim().length > 0;
    const turnKind = hasUserMessage ? 'user-initiated' : 'auto-wake';

    if (hasUserMessage && rawMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const safeHistory = filterChatTurns(body.history);

    // §A.7: the deterministic census this route seeds the system turn from —
    // populated below on BOTH turn shapes (the auto-wake gate needs it first
    // and ahead of tryUse either way; a user-initiated turn reads it fresh,
    // purely for orientation, no ordering constraint attached).
    let currentCensusDoc = null;

    // §A.0/§A.2: an auto-wake turn must clear the deterministic pre-call gate
    // BEFORE the model or the free-tier quota is touched at all — ordering is
    // an acceptance criterion, not a style preference.
    let companionAdvance = null;
    if (turnKind === 'auto-wake') {
      const companionInstanceKey = `${COMPANION_INSTANCE_PREFIX}${workspace.urlKey}`;
      const sweepInstanceKey = `${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`;
      const companionDocEnvelope = await observerStateStore.ensureSeeded(companionInstanceKey, COMPANION_SEED_STATE);
      currentCensusDoc = await observerStateStore.readCurrent(sweepInstanceKey);
      const gate = shouldSpendTurn({
        currentCensusDoc,
        companionDoc: companionDocEnvelope ? companionDocEnvelope.state : null,
        now: Date.now(),
      });
      if (!gate.spend) {
        // Nothing to report — a cheap response with no model call and no
        // quota touched at all.
        return res.json({ turnKind, spent: false, reason: gate.reason });
      }
      // Captured now (CAS'd against the rev we just read), but only actually
      // PERSISTED below once tryUse has also cleared — a config/quota failure
      // between here and there must not mark the floor as spent when no real
      // turn happened.
      if (companionDocEnvelope) {
        companionAdvance = { instanceKey: companionInstanceKey, expectedRev: companionDocEnvelope.rev, nextRecord: gate.nextRecord };
      }
    }

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;

    if (!apiKeyToUse) {
      return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        if (turnKind === 'user-initiated') {
          return res.status(429).json({
            error: check.reason,
            freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt },
          });
        }
        // Auto-wake: fail SILENTLY — no toast, no surfaced error. There may
        // be no one watching an auto-wake tick.
        return res.json({ turnKind, spent: false, reason: 'free-tier' });
      }
    }

    if (companionAdvance) {
      await observerStateStore.advance(
        companionAdvance.instanceKey, companionAdvance.expectedRev, companionAdvance.nextRecord,
        { reason: 'flight-companion-turn' }
      );
    }

    // Start SSE.
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders?.();

    // §A.4: the 'proposed' phase is self-describing from the propose-mode
    // executor's own return shape (`{ proposed: true, ... }`), not a second
    // turnKind branch threaded through SSE forwarding — it can never fire for
    // an execute-mode call, which never returns that shape.
    const proposedCallIds = new Set();
    const onEvent = (type, data) => {
      if (type === 'tool' && data.phase === 'result' && proposedCallIds.has(data.id)) {
        data = { ...data, phase: 'proposed' };
        proposedCallIds.delete(data.id);
      }
      sendSSE(res, type, data);
      if (type === 'done' || type === 'error') {
        res.end();
      }
    };

    try {
      // §A.7: user-initiated turns haven't read the census yet (only the
      // auto-wake gate does, above) — read it fresh here, purely for
      // orientation. Optional-guarded, mirroring the GET page handler: an
      // absent observerStateStore degrades to the honest "not available" seed
      // text rather than throwing.
      if (currentCensusDoc === null && turnKind === 'user-initiated' && observerStateStore) {
        currentCensusDoc = await observerStateStore.readCurrent(`${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`);
      }

      const selectedModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });
      const messages = buildFlightCompanionMessages({ history: safeHistory, message: hasUserMessage ? rawMessage.trim() : null, censusDoc: currentCensusDoc });
      const callMeta = { urlKey: workspace.urlKey, feature: 'flight-companion' };

      if (isToolCapableModel(selectedModel)) {
        const provider = getProviderForWorkspace(workspace);
        const scope = getWorkspaceCallScope(workspace);
        const { tools, executeTool: catalogExecuteTool } = createToolCatalog({
          provider,
          scope,
          recapCacheStore,
          briefCacheStore,
          urlKey: workspace.urlKey,
          dispatchQueueStore,
          agentStatusStore,
          sessionIsTerminal,
          followUpEnabled: true,
          // §A.4: the ONE line that makes an auto-wake turn write-incapable —
          // followUpMode: 'propose' short-circuits send_follow_up before it
          // ever reaches createDispatchItem (lib/chat-tools.js, LIN-2432 beat 1).
          followUpMode: turnKind === 'user-initiated' ? 'execute' : 'propose',
          dispatchedBy: req.session?.accountId || null,
          workspacePreferencesStore,
          proxyTokenStore,
          baseUrl: `${req.protocol}://${req.get('host')}`,
        });
        const executeTool = async (call) => {
          const raw = await catalogExecuteTool(call);
          if (call?.name === 'send_follow_up' && raw && raw.proposed === true) {
            proposedCallIds.add(call.id);
          }
          return raw;
        };
        await chatClient.streamChatWithTools(
          messages,
          {
            apiKey: apiKeyToUse, model: selectedModel, maxTokens: 1500, tools, executeTool, callMeta,
            toolResultMaxCharsByTool: CHAT_TOOL_RESULT_BUDGETS,
          },
          onEvent
        );
      } else {
        // Unknown-capability model: degrade to plain streaming with tools OFF,
        // exactly mirroring Task Chat — never a silent swap to a different model.
        await chatClient.streamChat(
          messages,
          { apiKey: apiKeyToUse, model: selectedModel, maxTokens: 1500, callMeta },
          onEvent
        );
      }
    } catch (error) {
      console.error('Flight Companion turn error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate a response' });
      res.end();
    }
  });

  return router;
}
