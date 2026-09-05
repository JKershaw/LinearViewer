/**
 * Flight Companion route — the experimental prototype for LIN-751's "realtime
 * chat interface for work in flight" (LIN-922).
 *
 * Anchored at /workspace/:urlKey/flight-companion, reusing workspaceFromUrl + the
 * collective/task-chat/next-run feature-gate-redirect-to-settings pattern.
 *
 * LIN-2435 (Phase A §A.8) made this a live, in-page chat surface (below) —
 * the page is no longer just a stub. It ALSO still serves the original, older
 * kickoff-prompt mechanism (buildFlightCompanionKickoff) for copy/paste into a
 * real Claude Code session, kept alongside the newer chat rather than replaced
 * by it, for whoever wants a full agent session rather than a chat turn. No
 * new transport is invented there; the prompt reuses the proven proxy kickoff
 * shape.
 *
 *   GET  /workspace/:urlKey/flight-companion                  — page shell (gated)
 *   POST /workspace/:urlKey/api/flight-companion/turn          — SSE chat turn (LIN-2432 §A.3)
 *   POST /workspace/:urlKey/api/flight-companion/approve-follow-up — human-approved
 *     enqueue of a follow-up the model proposed (LIN-2434 §A.6); see that route's
 *     own header comment below for the full contract.
 *
 * The kickoff prompt above is a DIFFERENT TRANSPORT, not a different companion
 * (a session standing in for the model, its curls as tools) — pasted by hand,
 * no dispatch of its own. Since LIN-2618 it renders the SAME shared brief this
 * route's system turn does (lib/prompts/flight-companion-brief.js); what
 * differs between them is the transport, not who the companion is.
 * The turn + approve-follow-up endpoints are the newer, in-page chat mechanism
 * (LIN-751 Phase A): the model proposes a follow-up on an auto-wake turn, but can
 * never dispatch it itself — only approve-follow-up, reached by an attended
 * human click, can actually enqueue one (LIN-2434's whole guardrail).
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
 *     clears §A.2's `shouldSpendTurn` gate FIRST — before `tryUse`, before any
 *     model call — against the companion's own `companion:v1:<urlKey>`
 *     `observerStateStore` instance and the sweep's `sweep:v1:<urlKey>` census.
 *     **Since LIN-2631 that happens in `lib/flight-companion-turn.js`, not here.**
 *     This file no longer evaluates the gate, seeds that instance, or writes a
 *     reservation; it supplies the config and quota checks through the core's
 *     `onBeforeSpend` hook, which the core calls at exactly that point in the
 *     order. That is what let the gate move without the ordering moving with it —
 *     and leaving the check here instead is what had this handler running its own
 *     duplicate copy of the gate. A refusal comes back as a value and is answered
 *     here with the same cheap JSON response as before; no quota is touched and no
 *     model is called. The free-tier rejection stays asymmetric: 429 (with the
 *     `freeTier` body) for user-initiated, silent (plain 200, no toast) for
 *     auto-wake — there may be no one watching an auto-wake tick.
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
import { buildCompanionSnapshot } from '../lib/flight-companion-gate.js';
import { filterChatTurns } from '../lib/chat-transcript.js';
import { streamChat as defaultStreamChat, streamChatWithTools as defaultStreamChatWithTools, isToolCapableModel, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { createChatToolCatalog as defaultCreateChatToolCatalog, CHAT_TOOL_RESULT_BUDGETS, deriveFollowUpDispatch } from '../lib/chat-tools.js';
import { buildFlightCompanionMessages, renderStaleAttentionLine } from '../lib/prompts/flight-companion-brief.js';
import { sessionIsTerminal, enrichLoop } from './dashboard.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope } from '../lib/workspace.js';
import { getSessionsForWorkspace } from '../lib/pipeline-loops.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { provisionBootstrapToken, shouldUseMcpTokenField } from '../lib/proxy-preamble.js';
import { dispatchQueueLimiter } from './dispatch.js';
import { badRequest, unauthorized, notFound, jsonError, serverError } from '../lib/errors.js';
// LIN-2631 item 2: one shared writer, so LIN-2620's proxy turn does not become
// a fourth copy of the frame format.
import { sendSSE } from '../lib/sse.js';
// LIN-2631: the turn itself lives in lib/ now, so the proxy endpoint, the boot
// turn, the playbook memory and the scheduler tick can each run one without
// pretending to be an Express handler. This route is the browser's adapter.
import { runFlightCompanionTurn } from '../lib/flight-companion-turn.js';

const MAX_MESSAGE_LENGTH = 2000;

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
// Exported for direct unit testing of the verbatim guarantee (LIN-2432 §A.7),
// and now also because `buildFlightCompanionMessages` reads it from another
// module. LIN-2618 RETIRES this note's former second half ("no premature
// lib/prompts/ extraction", beat-2 feedback): the builder has moved to
// `lib/prompts/flight-companion-brief.js`. That note's own condition has been
// met rather than overruled — a SECOND surface (the pasted kickoff) now needs
// the same persona, disposition, readout shape and gate, and the in-page chat
// having drifted away from it is the defect LIN-2618 exists to fix. The seed
// itself deliberately stays here: it is coupled to this route's census read and
// to `buildCompanionSnapshot`, neither of which belongs in a prompt module.
export function buildCensusSeedText(currentCensusDoc) {
  if (!currentCensusDoc) {
    return 'CURRENT CENSUS: not available yet for this workspace (no sweep has run).';
  }
  // This filter is for RENDERING HONESTY, not crash avoidance (LIN-2661 made
  // `buildCompanionSnapshot` itself safe against a null/undefined row — see
  // `isWellFormedAttentionRow`, `lib/flight-companion-gate.js:280` — so
  // feeding it the raw `currentCensusDoc` directly, below, is no longer a
  // hazard). It stays because it serves an independent purpose: this route
  // reads `since`/`issue` straight off these rows for `attentionLines` below,
  // fields the snapshot's identity-tuple projection deliberately drops
  // (`lib/flight-companion-gate.js:360`), and a row with no `loopId` cannot be
  // drilled into or shown honestly to a human — it is dropped outright rather
  // than rendered as a half-row. The bar here is deliberately LOOSER than the
  // gate's own well-formed-ROW criterion (`loopId`+`lane`+`stage`,
  // `isWellFormedAttentionRow`, `lib/flight-companion-gate.js:280`): a row with
  // an id but no `lane`/`stage` still renders here, honestly labelled, even
  // though the gate excludes it from its own identity-tuple accounting.
  const attention = (Array.isArray(currentCensusDoc.state?.attention) ? currentCensusDoc.state.attention : [])
    .filter((row) => row && typeof row === 'object' && row.loopId);
  const snapshot = buildCompanionSnapshot(currentCensusDoc);
  const laneLines = CENSUS_LANE_KEYS.map((key) => `  ${key}: ${snapshot.lanes[key]}`).join('\n');

  // LIN-2617: the ROWS, not just the count. Read straight off the census doc's
  // own `state.attention` (written by lib/observer-sweep.js:161-170), copied
  // field-for-field under the same no-recompute discipline the counts above
  // already carry — never re-sorted, re-dated or re-derived here.
  //
  // Deliberately NOT `buildCompanionSnapshot`'s `attentionKeys`: that projection
  // drops `since` on purpose (lib/flight-companion-gate.js:360), because it
  // moves on every heartbeat and would defeat the gate's own identity
  // comparison. The gate needs the identity tuple; the model needs the age.
  // The sweep already applies ATTENTION_CAP before storing, so the stored array
  // is bounded and `truncated` says whether it was cut.
  // Every remaining field is defended too: this document is persisted store
  // state read back at turn time, so a row written by an older sweep revision
  // can be partial, and rendering the literal string "undefined" inside a block
  // the prompt calls ground truth is worse than saying "unknown".
  const attentionLines = attention.map(
    (row) => `  - ${row.issue || '(no task)'} · ${row.lane || 'unknown lane'} · stage ${row.stage || 'unknown'}` +
      ` · since ${row.since || 'unknown'} · loop ${row.loopId}`
  );

  // The header count is computed from THIS route's own filtered `attention`
  // array (loopId-present criterion), not `snapshot.attentionCount`
  // (loopId+lane+stage, LIN-2661) — a deliberate, permanent divergence, not a
  // bug to reconcile later. `snapshot.attentionCount` only counts rows the
  // gate trusts as identity-tuples for its own no-delta diff; this header
  // must count the SAME set as `attentionLines` above so the header and the
  // rendered rows never disagree (the invariant at
  // `tests/unit/flight-companion-turn-route.test.js:982-984`). The two predicates
  // can differ in both directions: a row with an id but no `lane`/`stage`
  // renders here (counted in the header) but is excluded from the gate's own
  // `attentionCount`; conversely a falsy-but-present `loopId` (e.g. `''`) is
  // dropped by this route's truthiness filter but kept by the gate's `!= null`
  // check, so the gate's count can exceed the header's. No producer emits
  // that second case today, and it is harmless either way since this header
  // is compared only against this route's own rows, never against the gate's
  // count. Do NOT "fix" the two numbers back into agreement: doing so either
  // re-admits an unsanitized tuple into the gate's identity diff, or deletes
  // the tested honest-partial-row rendering at
  // `tests/unit/flight-companion-turn-route.test.js:979`.
  const lines = [
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):',
    laneLines,
    `  attention items: ${attention.length}${snapshot.truncated ? ' (list truncated)' : ''}`,
  ];
  if (attentionLines.length) {
    lines.push('ATTENTION ROWS (each is a real run — name the task, never just the count):', ...attentionLines);
  }

  // LIN-2619's fossil fold, rendered through the SHARED helper so this line and
  // the instruction the brief teaches (COMPANION_FOSSIL_READOUT, carried
  // byte-identically into the pasted kickoff) cannot drift apart. #1399 landed
  // the count alone, without its threshold; LIN-2619's review ledger item 5 asks
  // for both, because "313 fossil rows" and "313 rows older than 7d" are
  // different claims and only the second is actionable.
  const staleLine = renderStaleAttentionLine(
    currentCensusDoc.state?.staleAttentionCount,
    currentCensusDoc.state?.staleAttentionThresholdMs
  );
  if (staleLine) lines.push(staleLine);

  lines.push(
    `  census revision: ${snapshot.censusRev}`,
    // The vocabulary line (plan-review 2617-F1). The model wrote "2,197 tasks
    // terminal" on 2026-09-05 because nothing here told it what a lane counts:
    // `buildSweepPayload` tallies one lane per LOOP (lib/observer-sweep.js:132-157)
    // and `classifyLoop` classifies one Loop (:70), while a session spans several
    // loops and a task can span several sessions.
    'VOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. ' +
      '"silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.',
  );
  return lines.join('\n');
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
 * @param {Object} [deps.taskDecisionsStore] - LIN-2617: scan-produced decisions,
 *   one of `list_pending_decisions`' three inputs. Wired in server.js §A.12.
 * @param {Object} [deps.shelvedRulingsStore] - LIN-2617: shelved rulings
 *   (LIN-1727), the input whose absence would resurface a decision a human
 *   deliberately shelved. Wired in server.js §A.12.
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
  // LIN-2617: the two extra inputs `list_pending_decisions` needs to return the
  // same rows the rulings feed returns. Optional, like every other store here —
  // absent, that ONE tool reports "not configured" and the rest of the catalog
  // is untouched.
  taskDecisionsStore, shelvedRulingsStore,
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

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;
    // The "AI is not configured" 503 is NOT checked here, even though the key is
    // resolved here. §A.2 requires the gate to be cleared before anything else
    // is touched, and the gate lives in the core — so this check rides in
    // `onBeforeSpend` below, which the core calls at exactly the right moment.
    // Checking it here instead is what left this handler running its own copy of
    // the gate: the ordering was preserved by duplicating the gate rather than
    // by moving the check.

    // LIN-2449: the client can vanish mid-turn. `writableFinished` is the
    // discriminator — true only once the response has been fully flushed, so a
    // 'close' before that is a genuine disconnect rather than our own
    // `res.end()` completing. The reservation is deliberately NOT released
    // here; it self-expires via the lease, which is LIN-2442's recorded
    // no-write-on-failure design and the property LIN-2447 depends on.
    const clientAbort = new AbortController();
    let clientGone = false;
    res.on('close', () => {
      if (res.writableFinished) return;
      clientGone = true;
      clientAbort.abort();
    });

    // The SSE headers go up at the core's point of no return — after every
    // refusal path, before the model call — which is exactly where this handler
    // wrote them before the extraction. Lazily writing them on the first EVENT
    // instead is subtly wrong and was caught by the (a1) witness: a model call
    // that throws before emitting anything would then answer 500 JSON where the
    // browser has always received a 200 with an SSE `error` frame.
    let streaming = false;
    const startStream = () => {
      if (streaming) return;
      streaming = true;
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders?.();
    };

    try {
      const outcome = await runFlightCompanionTurn({
        workspace,
        turnKind,
        message: hasUserMessage ? rawMessage.trim() : null,
        history: safeHistory,
        apiKey: apiKeyToUse,
        isFreeTier,
        onStreamStart: startStream,
        onEvent: (type, data) => {
          sendSSE(res, type, data);
          if (type === 'done' || type === 'error') res.end();
        },
        signal: clientAbort.signal,
        isClientGone: () => clientGone,
        // The free-tier quota sits HERE — after the gate, before the
        // reservation write — which is the ordering LIN-2432 §A.2 makes an
        // acceptance criterion. The core owns the ordering; this route owns
        // what a quota is.
        // Everything that must happen AFTER the gate and BEFORE the reservation
        // write, in the order the pre-extraction handler ran it: the config
        // check, then the quota. The core owns WHEN this runs; this route owns
        // WHAT a config or quota failure is.
        onBeforeSpend: async () => {
          if (!apiKeyToUse) return { reason: 'not-configured' };
          if (!isFreeTier) return null;
          const check = await freeTierStore.tryUse(workspace.urlKey);
          if (check.allowed) return null;
          return { reason: 'free-tier', freeTierCheck: check };
        },
        deps: {
          observerStateStore, workspacePreferencesStore, recapCacheStore, briefCacheStore,
          dispatchQueueStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore,
          proxyTokenStore, sessionIsTerminal, enrichLoop,
          chatClient, createToolCatalog,
          getProvider: getProviderForWorkspace,
          getScope: getWorkspaceCallScope,
          buildCensusSeedText,
          baseUrl: `${req.protocol}://${req.get('host')}`,
          dispatchedBy: req.session?.accountId || null,
        },
      });

      if (!outcome.spent && !streaming) {
        if (outcome.reason === 'not-configured') {
          return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
        }
        // A free-tier refusal is the one that differs by turn kind: a user
        // typed and deserves the 429 with its quota detail; an auto-wake tick
        // fails SILENTLY — no toast, no surfaced error, since there may be no
        // one watching it.
        if (outcome.reason === 'free-tier' && turnKind === 'user-initiated') {
          const check = outcome.freeTierCheck;
          return res.status(429).json({
            error: check.reason,
            freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt },
          });
        }
        return res.json({
          turnKind: outcome.turnKind,
          spent: false,
          reason: outcome.reason,
          sweepLastSeenAt: outcome.sweepLastSeenAt,
        });
      }
    } catch (error) {
      // LIN-2449: a disconnect aborts the streaming call, which throws here.
      // There is no socket left to tell, so skip the write rather than pushing
      // an `error` frame into a dead one. Keep the error itself: a genuine bug
      // coinciding with a disconnect would otherwise vanish without a trace.
      if (clientGone) {
        // Keep the error itself: a genuine bug that happens to coincide with a
        // disconnect would otherwise vanish without a trace, since this branch
        // swallows the only report of it.
        // The pre-extraction handler also logged `instanceKey` here. That value
        // lives inside the core now, and hardcoding `null` would be worse than
        // omitting it — a diagnostic saying "no reservation" for a turn that
        // held one is a false lead. It is derivable from what IS logged: the
        // companion instance key is `companion:v1:<urlKey>`.
        console.error('Flight Companion turn: client disconnected mid-turn, census delta left unconsumed', {
          urlKey: workspace.urlKey,
          error: error?.message,
        });
        return;
      }
      console.error('Flight Companion turn error:', error);
      // The frame the browser has always received, unchanged: a FIXED generic
      // message under `message`. Not `error.message` — this is the one place a
      // refactor is most tempted to "improve" by forwarding the real text, and
      // that would both change the client's payload shape and hand the browser
      // internal error strings it has never been given.
      //
      // The headers are always up by the time a model error lands
      // (`onStreamStart` fires before the model call), so this is the same
      // 200-plus-error-frame the pre-extraction handler produced. A throw from
      // BEFORE the stream opened — a store fault, say — also lands here and
      // also gets a frame, exactly as it did before: matching the old behaviour
      // is the job, not improving on it inside a refactor.
      startStream();
      sendSSE(res, 'error', { message: 'Failed to generate a response' });
      res.end();
    }
  });

  router.post('/workspace/:urlKey/api/flight-companion/approve-follow-up', dispatchQueueLimiter, workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    if (featureFlags.flightCompanion !== true) {
      return jsonError(res, 403, 'Flight Companion feature is not enabled');
    }

    // Every write here stays behind an attended, session-authed request —
    // the boundary the whole ticket exists to enforce is "who can reach
    // createDispatchItem at all", not "who can see the page".
    const dispatchedBy = req.session && req.session.accountId;
    if (!dispatchedBy) {
      return unauthorized.json(res, 'Authentication required to approve a follow-up');
    }

    const body = req.body || {};
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (!sessionId) {
      return badRequest.json(res, 'approve-follow-up requires a non-empty "sessionId" string');
    }
    if (!prompt) {
      return badRequest.json(res, 'approve-follow-up requires a non-empty "prompt" string');
    }
    if (!dispatchQueueStore) {
      return serverError.json(res, 'Flight Companion approve-follow-up is not configured for this workspace');
    }

    try {
      // Same read `send_follow_up`'s executor uses (lib/chat-tools.js).
      const sessions = await getSessionsForWorkspace(
        workspace.urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }
      );
      const session = sessions.find(s => s.sessionId === sessionId);

      // The route's OWN guard, ahead of derivation: deriveFollowUpDispatch
      // dereferences session.loops/session.sessionId unguarded by design
      // (LIN-2433's review ledger, item 3) — without this check here, an
      // unknown sessionId becomes a 500 instead of a clean 404.
      if (!session) {
        return notFound.json(res, `Session ${sessionId} not found`);
      }

      let followUpTo, target, force;
      try {
        ({ followUpTo, target, force } = deriveFollowUpDispatch(session));
      } catch (deriveError) {
        // deriveFollowUpDispatch throws for a dash/local anchor target
        // (LIN-2433's review ledger, item 4). 422, not 409: this is not a
        // transient state conflict a retry could resolve — a dash/local
        // session structurally can never support a follow-up dispatch, the
        // same "well-formed request, unsupported for this resource" shape
        // routes/proxy.js's CAPABILITY_NOT_SUPPORTED already uses 422 for.
        return jsonError(res, 422, deriveError.message);
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        applyDefaultHarness: false,
        prompt,
        // Byte-for-byte mirror of send_follow_up's own finalizePrompt
        // (lib/chat-tools.js): the shouldUseMcpTokenField guard is
        // load-bearing (LIN-1431 S3 #2) — minting for a prose harness that
        // never rewrites the prompt would strand an unreferenceable
        // credential on the item.
        finalizePrompt: async (resolvedHarness) => {
          if (shouldUseMcpTokenField(resolvedHarness)) {
            const bootstrapToken = await provisionBootstrapToken({
              proxyTokenStore,
              urlKey: workspace.urlKey,
              baseUrl,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              createdBy: dispatchedBy
            });
            return { prompt, bootstrapToken };
          }
          return { prompt, bootstrapToken: null };
        },
        fields: {
          followUpTo,
          target,
          force,
          dispatchedBy,
        }
      });

      res.json({
        queued: true,
        itemId: item._id,
        sessionId: session.sessionId,
        target,
        force,
      });
    } catch (error) {
      console.error('Flight Companion approve-follow-up error:', error);
      serverError.json(res, 'Failed to approve follow-up');
    }
  });

  return router;
}
