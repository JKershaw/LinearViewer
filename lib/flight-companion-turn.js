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
 * SAY PLAINLY WHAT THIS DOES AND DOES NOT FIX TODAY. `lib/openrouter.js` emits
 * `usage` on NO non-`done` frame — its `tool` events carry
 * phase/iteration/id/name/result/error only — and `streamChatWithTools` emits
 * exactly one `done`. So in production this accumulator absorbs a single
 * payload and the sum is a no-op. It is forward-looking plumbing, correct and
 * pinned through the injected `chatClient` seam, and it becomes real the moment
 * a producer puts hop usage on the stream. Making it real is one line in
 * `lib/openrouter.js`, which is outside this change's file carve. Do not read
 * this function as evidence that hop cost is currently accounted for.
 *
 * @param {Object|null} a
 * @param {Object|null} b
 * @returns {Object|null} null only when neither side carried usage
 */
export function sumUsage(a, b) {
  // Copied, never returned by reference: the accumulator is mutated across a
  // whole turn, and handing back a caller's own object would let it observe
  // later frames' totals appear inside the payload it already read.
  if (!a) return b ? { ...b } : null;
  if (!b) return a ? { ...a } : null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    // `Number.isFinite`, not `typeof === 'number'`: NaN is a number, and one NaN
    // field would poison the accumulator for the rest of the turn.
    if (Number.isFinite(x) || Number.isFinite(y)) {
      out[key] = (Number.isFinite(x) ? x : 0) + (Number.isFinite(y) ? y : 0);
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
 * @param {string} [p.instanceKeySuffix] - LIN-2620: appended to the companion
 *   reservation instance key only (`companion:v1:<urlKey><suffix>`), never to
 *   the sweep census key. Empty string (the default) is byte-identical to
 *   before this param existed — the browser session route never passes it.
 *   The proxy route passes `':proxy'` so a message-less proxy auto-wake
 *   reserves/commits against its OWN instance rather than the browser's,
 *   which is what keeps an agent polling the proxy from ever consuming a
 *   census delta the human hasn't seen (the LIN-2449 shape from a new
 *   trigger).
 * @param {string} [p.via] - LIN-2620: additive attribution merged into
 *   `callMeta` (e.g. `'proxy'`) so `lib/llm-call-log.js` rows can tell a
 *   proxy-driven turn's spend apart from the browser's. Absent → `callMeta`
 *   is byte-identical to before this param existed.
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
  instanceKeySuffix = '',
  via = null,
  budget = {},
  onEvent,
  signal,
  isClientGone = () => false,
  onBeforeSpend,
  onStreamStart,
  // LIN-2625: session-auth turns only (browser and boot) may write the
  // playbook in V1. The browser route never passes this — its default of
  // `true` is what makes it session-auth-writable; the proxy route
  // (routes/proxy-flight-companion.js) is the ONE caller that passes
  // `false`, since every dispatched worker holds a readWrite proxy token and
  // a proxy-writable playbook would let any of them put text into the
  // system turn of every user of the workspace (plan-review 2625-F3).
  // Reading the playbook is unaffected by this flag — every turn kind, proxy
  // included, always reads it (see `playbookInstanceKey` below).
  allowPlaybookWrite = true,
  deps = {},
} = {}) {
  const {
    observerStateStore, workspacePreferencesStore, recapCacheStore, briefCacheStore,
    dispatchQueueStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore,
    proxyTokenStore, sessionIsTerminal, enrichLoop, chatClient, createToolCatalog,
    getProvider, getScope, baseUrl = null, dispatchedBy = null, now = () => Date.now(),
  } = deps;

  // ONE definition of "a usable iteration budget", read by both the lease
  // derivation and the model call. They disagreed in the first draft: the lease
  // treated `0` as a real budget (a 180s lease) while the model call treated it
  // as falsy and fell back to openrouter's default of 4 — a 600s worst case
  // against a 180s lease. `0` was never a usable budget downstream anyway.
  const usableIterations = Number.isInteger(budget.maxIterations) && budget.maxIterations > 0
    ? budget.maxIterations
    : null;

  // §A.7: the deterministic census this turn seeds its system prompt from.
  let currentCensusDoc = null;
  let companionAdvance = null;
  // LIN-2435: the gate's own computed `surface` — whether this spend is worth
  // resetting the client's wake cadence for. Only ever attached to an auto-wake
  // terminal frame; a user-initiated `done` carries no `surface` field at all.
  let turnSurface = null;

  // LIN-2625: the playbook is ONE shared, workspace-scoped record, decoupled
  // from whichever reservation instance this call reserves/commits against.
  // A proxy turn reserves against its OWN suffixed instance
  // (`instanceKeySuffix: ':proxy'`, LIN-2620) for census-delta bookkeeping,
  // but must read the SAME playbook the browser's companion wrote — never a
  // separate, empty one keyed by its own suffix. So this key is deliberately
  // NEVER suffixed, unlike `companionInstanceKey` below.
  const playbookInstanceKey = `${COMPANION_INSTANCE_PREFIX}${workspace.urlKey}`;
  // Buffered until `done` (LIN-2625 item 3): a playbook written mid-turn is
  // held here and only reaches the store from `persistPlaybook`/
  // `commitBaseline` below, both of which run only once the turn has
  // genuinely reached its terminal frame — an errored or disconnected turn
  // must never persist a half-thought. `bufferedPlaybookSet` (not a bare
  // truthy check on the value) is what lets an explicit empty-string
  // `remember('')` still count as "this turn wrote something".
  let bufferedPlaybookSet = false;
  let bufferedPlaybookValue = '';

  if (turnKind === 'auto-wake') {
    const companionInstanceKey = `${COMPANION_INSTANCE_PREFIX}${workspace.urlKey}${instanceKeySuffix}`;
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
      leaseMs: deriveReservationLeaseMs(usableIterations),
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

  // LIN-2622: a boot turn skips shouldSpendTurn's refusal branches (no-census,
  // hash-identical, floor, no-delta) — a human asked for this turn — but not
  // the reservation protocol. It calls the shared record producer LIN-2631
  // extracted, `buildTurnRecords`, DIRECTLY rather than through
  // `shouldSpendTurn`, and sets `companionAdvance` in exactly the shape the
  // reservation-write block below (and `commitBaseline` after `done`) already
  // consume — both are turnKind-agnostic by construction, so this branch needs
  // no changes anywhere else in the function.
  if (turnKind === 'boot') {
    const companionInstanceKey = `${COMPANION_INSTANCE_PREFIX}${workspace.urlKey}`;
    const sweepInstanceKey = `${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`;
    const companionDocEnvelope = await observerStateStore.ensureSeeded(companionInstanceKey, COMPANION_SEED_STATE);
    currentCensusDoc = await observerStateStore.readCurrent(sweepInstanceKey);
    // `buildTurnRecords` throws on a null census doc ("a boot caller must
    // handle no-census itself") — a workspace with no sweep yet has no
    // baseline to reserve against, so a boot there runs with NO reservation at
    // all (companionAdvance stays unset) rather than call it blind. Same
    // posture on a companion ensureSeeded backend fault
    // (`companionDocEnvelope === null`): nothing to build a record against, so
    // skip reservation rather than throw.
    if (currentCensusDoc != null && companionDocEnvelope != null) {
      const { reserveRecord, commitRecord } = buildTurnRecords({
        currentCensusDoc,
        companionDoc: companionDocEnvelope.state,
        now: now(),
        // LIN-2622 item 3: the lease follows THIS turn's own budget, the same
        // derivation the auto-wake branch above uses.
        leaseMs: deriveReservationLeaseMs(usableIterations),
      });
      companionAdvance = {
        instanceKey: companionInstanceKey,
        expectedRev: companionDocEnvelope.rev,
        reserveRecord,
        commitRecord,
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
      // LIN-2620: additive — the proxy route's non-streaming JSON response
      // reports the resolved model (ticket acceptance); the browser has
      // never read this field and keeps ignoring it. `selectedModel` (below)
      // is assigned before `emit` is ever CALLED with 'done' (both the
      // tool-capable and degraded branches resolve it first), even though
      // this closure is defined textually above that assignment.
      data = { ...data, model: selectedModel };
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
  // LIN-2622: a boot turn does NOT need this widened to it — its own branch
  // above ALWAYS reads the census unconditionally (it needs the doc for its
  // reservation), so `currentCensusDoc` is already set (to a doc, or to a
  // genuine `null` when no sweep has ever run) by the time this line runs, on
  // every path through the boot branch. Widening this condition to `boot` was
  // a true no-op — reached only when the sweep read had already come back
  // `null`, re-issuing the identical read for the identical `null` result —
  // and a no-op branch is not a minimal seam. Reverted (beat 3 review).
  // Optional-guarded: an absent store degrades to the honest "not available"
  // seed text rather than throwing.
  if (currentCensusDoc === null && turnKind === 'user-initiated' && observerStateStore) {
    currentCensusDoc = await observerStateStore.readCurrent(`${SWEEP_INSTANCE_PREFIX}${workspace.urlKey}`);
  }

  // LIN-2625: rendered into EVERY system turn, every turn kind, both routes —
  // read fresh here rather than reused from the auto-wake gate's own
  // (possibly suffixed-instance) companionDoc above, since the playbook
  // itself always lives at the UNSUFFIXED instance key regardless of which
  // instance this turn reserves/commits against (see `playbookInstanceKey`'s
  // own comment). Optional-guarded like the census read just above: an
  // absent store degrades to no playbook rather than throwing.
  const playbookEnvelope = observerStateStore
    ? await observerStateStore.readCurrent(playbookInstanceKey)
    : null;
  const currentPlaybook = playbookEnvelope?.state?.notes || null;

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
    playbook: currentPlaybook,
  });
  const callMeta = { urlKey: workspace.urlKey, feature: 'flight-companion', ...(via ? { via } : {}) };
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
      // LIN-2625: session-auth only (see `allowPlaybookWrite`'s own doc
      // above). `onRemember` just buffers — the actual write happens in
      // `persistPlaybook`/`commitBaseline` below, only once the turn reaches
      // `done`.
      playbookEnabled: allowPlaybookWrite,
      onRemember: allowPlaybookWrite
        ? (value) => { bufferedPlaybookSet = true; bufferedPlaybookValue = value; }
        : undefined,
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
        ...(usableIterations != null ? { maxIterations: usableIterations } : {}),
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

  // LIN-2625: the persistence path for every turn kind OTHER than auto-wake,
  // which never builds a `companionAdvance` (that reservation machinery is
  // auto-wake-only — a user-initiated/boot turn holds no lease to begin
  // with). Gated on `bufferedPlaybookSet`, `allowPlaybookWrite` and
  // `sawDone`/`!isClientGone()` — the same "only a genuinely finished turn
  // persists" discipline `commitBaseline` applies below, so an errored or
  // disconnected turn never writes a half-thought.
  if (turnKind !== 'auto-wake' && allowPlaybookWrite && bufferedPlaybookSet
      && sawDone && !isClientGone() && observerStateStore) {
    await persistPlaybook({
      observerStateStore, instanceKey: playbookInstanceKey,
      playbook: bufferedPlaybookValue, workspace,
    });
  }

  await commitBaseline({
    companionAdvance, sawDone, isClientGone, observerStateStore, workspace,
    bufferedPlaybookSet, bufferedPlaybookValue,
  });
  return { spent: true, turnKind };
}

/**
 * LIN-2625: persist a playbook written via `remember` on a turn kind that
 * never touches `companionAdvance` (user-initiated today; boot once LIN-2622
 * lands). Always targets the UNSUFFIXED companion instance — see
 * `playbookInstanceKey`'s own comment above — never the caller's
 * (possibly-suffixed) reservation instance. `ensureSeeded` rather than
 * `readCurrent`: this can be the very FIRST write for a workspace whose
 * auto-wake tick has never fired yet. One retry on a lost CAS (LIN-2625's
 * plan of record); never touches `turnReservedUntil`/`reservationId` — this
 * path holds no reservation, so those fields are simply carried through
 * unchanged from whatever is already stored. Isolated in its own try/catch
 * for the same reason `commitBaseline` is: a throw here must never reach the
 * caller's error path, which would try to write an `error` frame into a
 * response the terminal `done` already ended.
 *
 * @param {Object} p
 * @param {Object} p.observerStateStore
 * @param {string} p.instanceKey
 * @param {string} p.playbook
 * @param {Object} p.workspace
 */
async function persistPlaybook({ observerStateStore, instanceKey, playbook, workspace }) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const envelope = await observerStateStore.ensureSeeded(instanceKey, COMPANION_SEED_STATE);
      if (!envelope || !envelope.state) {
        console.error('Flight Companion turn: playbook persist skipped, record has no state', {
          instanceKey, urlKey: workspace.urlKey,
        });
        return;
      }
      const result = await observerStateStore.advance(
        instanceKey, envelope.rev, { ...envelope.state, notes: playbook },
        { reason: 'flight-companion-playbook' }
      );
      if (result === true) return;
      if (attempt === 1) {
        // Logged, never retried further: the model already committed to this
        // playbook text for its NEXT turn's own read, which will simply
        // re-read whatever is current then. Matches commitBaseline's own
        // "benign lost CAS" posture below.
        console.error('Flight Companion turn: playbook persist did not land after retry', {
          instanceKey, result,
        });
      }
    }
  } catch (persistError) {
    console.error('Flight Companion turn: playbook persist threw', {
      instanceKey, error: persistError,
    });
  }
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
 *
 * @param {boolean} [p.bufferedPlaybookSet] - LIN-2625: true when THIS turn
 *   called `remember` at least once. An auto-wake turn CAN call `remember`
 *   too (its tools are unaffected by turnKind, only by `allowPlaybookWrite`),
 *   so this commit must not ignore it.
 * @param {string} [p.bufferedPlaybookValue] - the buffered value, when set.
 */
async function commitBaseline({
  companionAdvance, sawDone, isClientGone, observerStateStore, workspace,
  bufferedPlaybookSet = false, bufferedPlaybookValue = '',
}) {
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
      // LIN-2625 plan-review F1: NEVER write the gate-time `notes` copy
      // embedded in `companionAdvance.commitRecord` (frozen when this turn's
      // reservation was built, from the companionDoc read BEFORE the model
      // call ran) — a typed turn that wrote a NEWER playbook mid-flight (via
      // `remember`, persisted through `persistPlaybook` above, or through a
      // DIFFERENT overlapping turn entirely) would otherwise be silently
      // clobbered by this stale value. Prefer THIS turn's own buffered
      // `remember` value when set; otherwise use the FRESH read
      // `currentEnvelope` already performed just above, never the gate-time
      // copy.
      const notes = bufferedPlaybookSet ? bufferedPlaybookValue : (currentEnvelope.state.notes || '');
      const commitResult = await observerStateStore.advance(
        companionAdvance.instanceKey, currentEnvelope.rev, { ...companionAdvance.commitRecord, notes },
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
