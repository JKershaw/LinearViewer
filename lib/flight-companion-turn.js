/**
 * lib/flight-companion-turn.js — the Flight Companion turn, extracted from the
 * session route so more than one caller can run one (LIN-2631).
 *
 * Four tickets under LIN-751 need to run a companion turn from somewhere other
 * than the browser's session route: the proxy endpoint (LIN-2620), the boot
 * turn (LIN-2622), the playbook memory (LIN-2625) and Phase B's scheduler tick
 * (LIN-2627). Until now the whole turn lived inline in
 * `routes/flight-companion.js`'s POST handler, so each of those would have had
 * to re-derive it — and two of them need to reserve and commit the census
 * baseline WITHOUT going through the gate's refusal branches, which was the one
 * thing only `shouldSpendTurn` could produce records for.
 *
 * WHAT THIS OWNS: the gate, the reservation, the tool catalog, the model
 * resolution (at exactly one site), the stream, and the reservation-scoped
 * commit. WHAT IT DELIBERATELY DOES NOT OWN: HTTP. No `req`, no `res`, no SSE,
 * no status codes. Events leave through `onEvent`; refusals come back as a
 * return value. That is what makes a proxy caller and a scheduler tick possible
 * without either pretending to be an Express handler.
 *
 * BEHAVIOUR IS BYTE-IDENTICAL FOR THE BROWSER. This is a move, not a redesign:
 * the ordering (gate before quota before reservation before model), the
 * tri-state `advance()` consumption, LIN-2442's reserve/commit split,
 * LIN-2449's disconnect handling and LIN-2447's reservation-scoped commit CAS
 * are all carried across unchanged. `tests/unit/flight-companion-turn-route.test.js`
 * passes without edits to its behavioural assertions; only its structural
 * source-text pins move to point here.
 *
 * ON LIN-2447 SPECIFICALLY, because this ticket's description is stale about
 * it: LIN-2631 was filed saying it would discharge LIN-2447 items 1-3. Lane G
 * landed all three first (PR #1394, `f6eba327`), and LIN-2447 is Done. The
 * lease's corrected arithmetic, the reservation-scoped commit and the
 * `reservationId` nonce are therefore behaviour this extraction PRESERVES, not
 * behaviour it introduces. Re-deriving them here — or extracting the pre-fix
 * shape — would be a silent revert of a landed fix.
 */

import { shouldSpendTurn, buildTurnRecords, deriveReservationLeaseMs, COMPANION_SEED_STATE } from './flight-companion-gate.js';
import { buildFlightCompanionMessages } from './prompts/flight-companion-brief.js';
import { CHAT_TOOL_RESULT_BUDGETS } from './chat-tools.js';
import { resolveWorkspaceModel } from './workspace-preferences.js';
import { isToolCapableModel } from './openrouter.js';

// Restated, not imported, from lib/flight-companion-gate.js's own private
// prefixes — the same house convention each observer-pipeline-stage file
// follows (see that file's header): every consumer of an instance-key prefix
// restates it rather than sharing a cross-module import.
const COMPANION_INSTANCE_PREFIX = 'companion:v1:';
const SWEEP_INSTANCE_PREFIX = 'sweep:v1:';

const DEFAULT_MAX_TOKENS = 1500;

/**
 * Sum two OpenRouter usage payloads.
 *
 * `streamChatWithTools` bills a model call per tool hop, but only the FINAL
 * call's usage reaches the terminal `done` frame — every hop's usage goes to
 * `recordLlmCall` and is invisible to the event stream. A consumer reading
 * `done.usage` therefore under-reports a tool-using turn, sometimes by most of
 * its real cost.
 *
 * @param {Object|null} a
 * @param {Object|null} b
 * @returns {Object|null} null only when neither side carried usage
 */
export function sumUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (typeof x === 'number' || typeof y === 'number') {
      out[key] = (typeof x === 'number' ? x : 0) + (typeof y === 'number' ? y : 0);
    } else {
      // A non-numeric field (a model id, say) is not summable — last one wins,
      // which for these payloads is the final call's own value.
      out[key] = y !== undefined ? y : x;
    }
  }
  return out;
}

/**
 * Run one Flight Companion turn.
 *
 * @param {Object} p
 * @param {Object} p.workspace - the resolved workspace (urlKey + provider binding)
 * @param {'user-initiated'|'auto-wake'} p.turnKind - derived by the CALLER from message presence, never client-asserted
 * @param {string|null} [p.message] - the human's text; absent on an auto-wake tick
 * @param {Array<Object>} [p.history] - already-sanitised prior turns
 * @param {string} p.apiKey - resolved by the caller (session key / env / free tier)
 * @param {boolean} [p.isFreeTier] - forces the default model when true
 * @param {'execute'|'propose'} [p.followUpMode] - defaults from `turnKind`
 * @param {{maxIterations?: number, maxTokens?: number}} [p.budget] - the turn's own budget; drives the reservation lease
 * @param {Function} p.onEvent - `(type, data) => void`; the ONLY output channel
 * @param {AbortSignal} [p.signal] - aborts the model call
 * @param {Function} [p.isClientGone] - `() => boolean`; when true after `done`, the commit is skipped (LIN-2449)
 * @param {Function} [p.onStreamStart] - called once when the turn commits to a model call, after every refusal path and the reservation write. A streaming caller opens its stream here, so a refusal can still be answered as a plain value.
 * @param {Function} [p.onBeforeSpend] - async hook run AFTER the gate clears and BEFORE the reservation write; return a `{reason}` object to refuse, or null/undefined to proceed. This is the seam the session route's free-tier quota check occupies, which is what keeps "gate before quota before model" true without this module knowing what a quota is.
 * @param {Object} p.deps - injected stores and seams (see the destructure below)
 * @returns {Promise<{spent: boolean, turnKind: string, reason?: string, sweepLastSeenAt?: string}>}
 */
export async function runFlightCompanionTurn({
  workspace,
  turnKind,
  message = null,
  history = [],
  apiKey,
  isFreeTier = false,
  followUpMode,
  budget = {},
  onEvent,
  signal,
  isClientGone = () => false,
  onBeforeSpend,
  onStreamStart,
  deps = {},
} = {}) {
  const {
    observerStateStore, workspacePreferencesStore, recapCacheStore, briefCacheStore,
    dispatchQueueStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore,
    proxyTokenStore, sessionIsTerminal, enrichLoop, chatClient, createToolCatalog,
    getProvider, getScope, baseUrl = null, dispatchedBy = null, now = () => Date.now(),
  } = deps;

  // §A.7: the deterministic census this turn seeds its system prompt from.
  let currentCensusDoc = null;
  let companionAdvance = null;
  // LIN-2435: the gate's own computed `surface` — whether this spend is worth
  // resetting the client's wake cadence for. Only ever attached to an auto-wake
  // terminal frame; a user-initiated `done` carries no `surface` field at all.
  let turnSurface = null;

  if (turnKind === 'auto-wake') {
    const companionInstanceKey = `${COMPANION_INSTANCE_PREFIX}${workspace.urlKey}`;
    const sweepInstanceKey = `${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`;
    const companionDocEnvelope = await observerStateStore.ensureSeeded(companionInstanceKey, COMPANION_SEED_STATE);
    currentCensusDoc = await observerStateStore.readCurrent(sweepInstanceKey);
    const gate = shouldSpendTurn({
      currentCensusDoc,
      companionDoc: companionDocEnvelope ? companionDocEnvelope.state : null,
      now: now(),
      // LIN-2631 item 5: the lease follows THIS turn's budget rather than one
      // constant for every caller. A boot turn runs a bigger budget and would
      // otherwise outlive the default lease as a matter of course.
      leaseMs: deriveReservationLeaseMs(budget.maxIterations),
    });
    if (!gate.spend) {
      // Nothing to report — no model call, no quota touched. `sweepLastSeenAt`
      // is additive and only present when the gate relabelled the reason
      // (LIN-2438); every other reason forwards `undefined`, which callers'
      // JSON.stringify omits.
      return { spent: false, turnKind, reason: gate.reason, sweepLastSeenAt: gate.sweepLastSeenAt };
    }
    turnSurface = gate.surface;
    if (companionDocEnvelope) {
      companionAdvance = {
        instanceKey: companionInstanceKey,
        expectedRev: companionDocEnvelope.rev,
        reserveRecord: gate.reserveRecord,
        commitRecord: gate.nextRecord,
      };
    }
  }

  // The caller's own pre-spend refusal (the session route's free-tier quota).
  // Placed HERE and nowhere else: after the gate, before the reservation write,
  // which is the ordering LIN-2432 §A.2 makes an acceptance criterion rather
  // than a preference.
  if (typeof onBeforeSpend === 'function') {
    const refusal = await onBeforeSpend();
    if (refusal) return { spent: false, turnKind, ...refusal };
  }

  if (companionAdvance) {
    // LIN-2435: consume advance()'s tri-state. A lost CAS (`false`, another
    // overlapping auto-wake turn won) or a backend error (`null`) must abort
    // before the model call, never silently proceed to a second billable spend
    // against the same gate window. `null` denies the spend — the safe reading
    // of observer-state-store's "do not treat as safe to converge" contract.
    // LIN-2442: this writes the RESERVATION, not the new baseline.
    const advanceResult = await observerStateStore.advance(
      companionAdvance.instanceKey, companionAdvance.expectedRev, companionAdvance.reserveRecord,
      { reason: 'flight-companion-turn' }
    );
    if (advanceResult !== true) {
      if (advanceResult === null) {
        console.error('Flight Companion turn: advance() backend error', { instanceKey: companionAdvance.instanceKey });
      }
      return { spent: false, turnKind, reason: advanceResult === null ? 'advance-error' : 'lost-race' };
    }
  }

  // §A.4: the 'proposed' phase is self-describing from the propose-mode
  // executor's own return shape, not a second turnKind branch threaded through
  // event forwarding — it can never fire for an execute-mode call.
  const proposedCallIds = new Set();
  // LIN-2442: the ONLY signal gating the post-stream commit. A throw, a dead
  // socket, or a crash all leave this false and nothing releases the
  // reservation — it self-expires instead.
  let sawDone = false;
  // LIN-2631: every usage payload this turn observes, summed. See `sumUsage`.
  let accumulatedUsage = null;

  const emit = (type, data) => {
    if (type === 'tool' && data.phase === 'result' && proposedCallIds.has(data.id)) {
      data = { ...data, phase: 'proposed' };
      proposedCallIds.delete(data.id);
    }
    // Accumulate usage from every frame that carries it, so a tool-using turn's
    // terminal frame reports the WHOLE turn rather than only its final call.
    if (data && data.usage) accumulatedUsage = sumUsage(accumulatedUsage, data.usage);
    if (type === 'done') {
      if (accumulatedUsage) data = { ...data, usage: accumulatedUsage };
      if (turnKind === 'auto-wake') data = { ...data, surface: turnSurface };
      sawDone = true;
    }
    onEvent(type, data);
  };

  // The point of no return: every refusal is behind us, the reservation (if
  // any) is written, and the next thing that happens is a billable model call.
  // A streaming caller opens its stream HERE and not before — after this, a
  // failure is reported through `onEvent`, never as a return value. Placing it
  // any earlier would mean a refusal could no longer be answered as anything
  // but a stream; any later would mean a model throw arrives before the
  // caller has a channel to report it on, which is a 500 where the browser
  // used to get an error frame.
  if (typeof onStreamStart === 'function') onStreamStart();

  // §A.7: a user-initiated turn has not read the census yet (only the auto-wake
  // gate does, above) — read it fresh here, purely for orientation.
  // Optional-guarded: an absent store degrades to the honest "not available"
  // seed text rather than throwing.
  if (currentCensusDoc === null && turnKind === 'user-initiated' && observerStateStore) {
    currentCensusDoc = await observerStateStore.readCurrent(`${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`);
  }

  // ONE model-resolution site (LIN-2631 item 1). Every future caller inherits
  // the free-tier clamp rather than re-deriving it.
  const selectedModel = await resolveWorkspaceModel({
    urlKey: workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier,
  });
  const messages = buildFlightCompanionMessages({
    history,
    message,
    censusSeedText: deps.buildCensusSeedText(currentCensusDoc),
    now: now(),
    turnKind,
  });
  const callMeta = { urlKey: workspace.urlKey, feature: 'flight-companion' };
  const maxTokens = budget.maxTokens || DEFAULT_MAX_TOKENS;

  if (isToolCapableModel(selectedModel)) {
    const { tools, executeTool: catalogExecuteTool } = createToolCatalog({
      provider: getProvider(workspace),
      scope: getScope(workspace),
      recapCacheStore,
      briefCacheStore,
      urlKey: workspace.urlKey,
      dispatchQueueStore,
      agentStatusStore,
      sessionIsTerminal,
      followUpEnabled: true,
      // §A.4: the ONE line that makes an auto-wake turn write-incapable.
      followUpMode: followUpMode || (turnKind === 'user-initiated' ? 'execute' : 'propose'),
      dispatchedBy,
      workspacePreferencesStore,
      proxyTokenStore,
      taskDecisionsStore,
      shelvedRulingsStore,
      enrichLoop,
      baseUrl,
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
        apiKey, model: selectedModel, maxTokens, tools, executeTool, callMeta,
        toolResultMaxCharsByTool: CHAT_TOOL_RESULT_BUDGETS,
        ...(budget.maxIterations ? { maxIterations: budget.maxIterations } : {}),
        signal,
      },
      emit
    );
  } else {
    // Unknown-capability model: degrade to plain streaming with tools OFF,
    // mirroring Task Chat — never a silent swap to a different model.
    await chatClient.streamChat(
      messages,
      { apiKey, model: selectedModel, maxTokens, callMeta, signal },
      emit
    );
  }

  await commitBaseline({ companionAdvance, sawDone, isClientGone, observerStateStore, workspace });
  return { spent: true, turnKind };
}

/**
 * Commit the new census baseline, scoped to this turn's own reservation.
 *
 * Carried across from the route unchanged — this is LIN-2447 item 2's landed
 * fix (`f6eba327`), which this extraction preserves rather than re-derives.
 *
 * Isolated in its own try/catch: a throw here must never reach the caller's
 * error path, which would try to write an `error` frame into a response the
 * terminal `done` already ended.
 */
async function commitBaseline({ companionAdvance, sawDone, isClientGone, observerStateStore, workspace }) {
  // LIN-2449: `!isClientGone()` alongside `sawDone`. The abort usually makes
  // this moot by throwing out of the streaming call, but not always — a
  // disconnect arriving after the terminal frame is too late to abort and
  // reaches here with `sawDone` already true. This gate is what catches that.
  // The known residual (a disconnect landing in the same event-loop iteration
  // as the terminal frame) is recorded in full on the route's history and is
  // not closable from here.
  if (!sawDone || isClientGone() || !companionAdvance) return;
  try {
    // Fresh read rather than `expectedRev + 1`: the store's
    // duplicate-identical-state branch returns true for a no-op write WITHOUT
    // bumping `rev`, so a strict +1 would CAS against a stale witness.
    const currentEnvelope = await observerStateStore.readCurrent(companionAdvance.instanceKey);
    // LIN-2447 item 2: commit only onto OUR OWN reservation. Fresh also means
    // this can return a SUCCESSOR's record if this turn outlived its lease.
    // Committing onto that would clear the successor's live lease (our record
    // carries `turnReservedUntil: null`) and overwrite its baseline with our
    // stale one. Our own id must be truthy for the match to mean anything: a
    // `null` on both sides would make `stillOurs` true against a successor that
    // has just COMMITTED, which is precisely the record we must not write over.
    const ourReservationId = companionAdvance.reserveRecord.reservationId;
    const stillOurs = !!ourReservationId
      && currentEnvelope
      && currentEnvelope.state
      && currentEnvelope.state.reservationId === ourReservationId;
    if (currentEnvelope && !currentEnvelope.state) {
      console.error('Flight Companion turn: commit skipped, record has no state', {
        instanceKey: companionAdvance.instanceKey, urlKey: workspace.urlKey,
      });
    } else if (currentEnvelope && !stillOurs) {
      console.error('Flight Companion turn: commit skipped, reservation no longer ours', {
        instanceKey: companionAdvance.instanceKey, urlKey: workspace.urlKey,
      });
    } else if (currentEnvelope) {
      const commitResult = await observerStateStore.advance(
        companionAdvance.instanceKey, currentEnvelope.rev, companionAdvance.commitRecord,
        { reason: 'flight-companion-commit' }
      );
      if (commitResult !== true) {
        // Benign by design: the report already reached the user, so a lost CAS
        // only means the baseline lags — the next eligible turn re-surfaces the
        // same change once. Logged, never retried, never thrown.
        console.error('Flight Companion turn: commit advance() did not land', {
          instanceKey: companionAdvance.instanceKey, result: commitResult,
        });
      }
    } else {
      console.error('Flight Companion turn: commit skipped, instance vanished', {
        instanceKey: companionAdvance.instanceKey,
      });
    }
  } catch (commitError) {
    console.error('Flight Companion turn: commit write threw', {
      instanceKey: companionAdvance.instanceKey, error: commitError,
    });
  }
}
