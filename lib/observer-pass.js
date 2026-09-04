/**
 * lib/observer-pass.js
 *
 * The cloud observer's LLM judgement pass (LIN-2395, P2-1 of the LIN-2114
 * observer-harness epic). A small-context, STATELESS LLM call seeded from
 * durable state: it reads the sweep's (`lib/observer-sweep.js`, P1-3)
 * already-curated fleet census, asks the model for qualitative narrative
 * only (never numbers — lane counts are always copied verbatim from the
 * census, never trusted from the model), and persists a report a human can
 * read. It never accumulates transcript history — each tick reads one prior
 * summary, not a growing conversation.
 *
 * Report-only boundary (binding for this ticket): no relay write, no wake
 * sink, no dispatch/kick authority, no provider write beyond the workspace-
 * feature reader below, no `/api/proxy` traffic, no `simple-dispatcher`
 * entry, no mutation of live fleet truth. The `observerAuthority` workspace
 * feature (`lib/feature-defaults.js`) has NO acting branch in this ticket —
 * `true` only changes the `authority` stamp written into the report, from
 * `'off'` to `'on-unimplemented'`; every write this module makes is
 * identical either way. See `resolveAuthorityStamp` below.
 *
 * This module cannot live inside `lib/observer-sweep.js` — that module's own
 * static-import test pins its imports to exactly four specifiers and its
 * `createObserverSweepRun` deps object by function reference
 * (`tests/unit/observer-sweep.test.js`), so an LLM dependency here would
 * break both. It is a second, independently-scheduled module instead — the
 * boundary those tests exist to hold.
 *
 * Memory: reuses `ObserverStateStore` (LIN-2129) under a NEW instance key
 * (`pass:v1:<urlKey>`), never a second store — the store's whole contract is
 * "one current state document per observer instance". The sweep's own
 * instance (`sweep:v1:<urlKey>`, `lib/observer-sweep.js:235`) is read here,
 * never written — this module is a read-only consumer of that document, via
 * the SAME injected `observerStateStore`, not a second store instance.
 *
 * Static-import allowlist for this module (enforced by its own test in
 * tests/unit/observer-pass.test.js): only `./observer-sweep.js` (for its
 * pure, I/O-free roster-union helpers — reused rather than re-derived, so
 * the pass and the sweep can never disagree about which workspaces are
 * "worth observing"), `./workspace-preferences.js` (for the pure
 * `isWorkspaceFeatureEnabled`/`resolveWorkspaceModel` precedence resolvers,
 * which take an injected store and make no I/O of their own), and
 * `./feature-defaults.js` (the `observerAuthority` key constant). The actual
 * LLM call is reached ONLY through an injected seam (`deps.streamChatWithTools`
 * / `deps.getPaidEnvKey`) — this module never imports `lib/openrouter.js`
 * itself, so "zero outbound network attempts" is provable structurally on
 * every path that does not choose to inject a real caller, not merely by
 * convention. Must NOT import `dispatch-factory.js`, `dispatch-store.js`,
 * `agent-status-store.js`, any provider module, or `lib/observer-shadow-log.js`.
 */

import { resolveRosterFromSessions, mergeRosterUnion } from './observer-sweep.js';
import { isWorkspaceFeatureEnabled, resolveWorkspaceModel } from './workspace-preferences.js';
import { WORKSPACE_FEATURES } from './feature-defaults.js';

// Duplicated verbatim from lib/observer-sweep.js:235 (`sweep:v1:${urlKey}`) —
// not exported there, and importing an internal string constant across
// modules would be a stranger coupling than restating it once, here, with
// this comment as the tripwire if it ever drifts.
const SWEEP_INSTANCE_PREFIX = 'sweep:v1:';
export const PASS_INSTANCE_PREFIX = 'pass:v1:';

// The seed payload's shape is never emitted by a real advance() below (which
// always writes {v:1, summary, report, authority, ...}), so a never-seeded
// advance() returning true under a forced ensureSeeded/advance interleaving
// is structurally unreachable — mirrors lib/observer-sweep.js's SEED_STATE.
const PASS_SEED_STATE = { v: 1, seeded: true };

const REPORT_ATTENTION_CAP = 10;
const SUMMARY_MAX_CHARS = 600;
const NARRATIVE_MAX_CHARS = 1200;
const LLM_MAX_TOKENS = 500;

/**
 * The authority stamp written into every report. P2-1 has no acting branch:
 * `true` and `false` produce byte-identical writes apart from this one
 * field. Exported so the render layer and tests share the exact vocabulary.
 *
 * @param {boolean} enabled
 * @returns {'off'|'on-unimplemented'}
 */
export function resolveAuthorityStamp(enabled) {
  return enabled === true ? 'on-unimplemented' : 'off';
}

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Pull a JSON object out of a raw model reply, tolerating code fences and
 * prose around it (mirrors lib/next-run.js / lib/prompts/ship-biscuit-editor.js
 * `extractJsonObject`).
 * @param {string} raw
 * @returns {Object|null}
 */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    text = text.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse a raw LLM reply into `{narrative, flags, degraded}`. Deliberately
 * reads ONLY `narrative` (string) and `flags` (string array) — the model is
 * never asked for, and nothing here ever reads, a numeric field. This is
 * the numeric-grounding rule enforced BY CONSTRUCTION rather than by a
 * post-parse reconciliation step: there is no lane-count field in the
 * schema for the model to get wrong, so `report.lanes` below is always the
 * census's own verbatim numbers, never the model's.
 *
 * Never throws. A malformed/empty reply yields `narrative: null` with a
 * `degraded` reason rather than a fabricated report — the same "one logged
 * tick, no persisted lie" posture `lib/observer-sweep.js` uses for a missing
 * `now`.
 *
 * @param {string} raw
 * @returns {{narrative: string|null, flags: string[], degraded: {reason: string}|null}}
 */
export function parseObserverPassResponse(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { narrative: null, flags: [], degraded: { reason: 'unparseable' } };

  const narrative = clampText(parsed.narrative, NARRATIVE_MAX_CHARS) || null;
  const flags = Array.isArray(parsed.flags)
    ? [...new Set(parsed.flags.filter((f) => typeof f === 'string' && f.trim()).map((f) => clampText(f, 100)))].sort()
    : [];

  if (!narrative) return { narrative: null, flags, degraded: { reason: 'missing-narrative' } };
  return { narrative, flags, degraded: null };
}

/**
 * Deterministic "nothing to report" narrative — no LLM call, so this is
 * guaranteed honest regardless of model behaviour (mirrors
 * `lib/prompts/ship-biscuit-editor.js`'s `buildQuietEdition`).
 *
 * @param {'no-census'|'empty-fleet'|'unchanged'} reason
 * @returns {string}
 */
function buildQuietNarrative(reason) {
  if (reason === 'no-census') return 'No fleet census has been recorded for this workspace yet — nothing to report.';
  if (reason === 'empty-fleet') return 'The fleet census is empty right now — no active loops to observe.';
  return 'No change in the fleet census since the last observation pass.';
}

/**
 * Determine whether this tick can skip the LLM call entirely. Pure.
 *
 * @param {Object} params
 * @param {Object|null} params.censusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')` result.
 * @param {string|null} params.lastCensusStateHash - the hash this pass instance last processed.
 * @param {boolean} [params.priorDegraded=false] - whether the report this instance
 *   is carrying was itself produced by a degraded tick (LIN-2408).
 * @returns {{quiet: boolean, reason: 'no-census'|'empty-fleet'|'unchanged'|null}}
 */
export function assessQuietPath({ censusDoc, lastCensusStateHash, priorDegraded = false }) {
  if (!censusDoc) return { quiet: true, reason: 'no-census' };
  const lanes = censusDoc.state?.lanes || {};
  const fleetEmpty = Object.values(lanes).every((n) => n === 0);
  if (fleetEmpty) return { quiet: true, reason: 'empty-fleet' };
  if (lastCensusStateHash && censusDoc.stateHash === lastCensusStateHash) {
    // LIN-2408: a DEGRADED prior report is not a settled state, so an
    // unchanged census is not a reason to keep it.
    //
    // The `unchanged` gate exists to avoid re-spending an LLM call to restate
    // a conclusion already reached. That reasoning holds only if a conclusion
    // WAS reached. When the previous tick degraded, there is nothing to
    // restate — and LIN-2405's carry-forward (below in `runObserverPass`) then republishes
    // the degraded narrative verbatim every tick, so the pass never retries
    // until the census happens to change. On a mostly-idle fleet, which is
    // exactly the state the report exists to describe, the census is stable
    // and "until it changes" means indefinitely.
    //
    // Measured shape of the bug: tick 1 with no API key writes
    // `degraded: {reason: 'llm-unavailable'}`; tick 2 WITH a working key and an
    // unchanged census calls the LLM zero times and carries the "could not
    // reach a model" narrative forward.
    //
    // COST, measured rather than waved at. The dominant case —
    // `llm-unavailable` — costs NOTHING extra: `getPaidEnvKey` is awaited
    // ABOVE the quiet branch in `runObserverPass`, so that resolver call was
    // already being paid on every quiet tick, and the retry short-circuits
    // before `resolveWorkspaceModel`/`buildPassMessages`. It is a re-check of
    // whether a key resolves now, not a model call.
    //
    // A model-side degradation (`unparseable`/`missing-narrative`) does
    // re-spend one real call while the model keeps failing. The bound is
    // tighter than "once per 15 minutes": `createObserverPassRun` selects
    // exactly ONE workspace per tick by round-robin, so a given workspace
    // retries every 15min x roster.length, and the GLOBAL ceiling across the
    // whole fleet is one call per 15 minutes regardless of roster size.
    // (An earlier version of this comment said "bounded by the pass's own
    // 15-minute cadence", which is the per-job figure, not the per-workspace
    // one — the real bound is stronger than the one it claimed.)
    //
    // That is the right trade: a persistently broken model is a state you want
    // the system recovering from as soon as it can, not one frozen into the
    // panel. A backoff counter would reintroduce the same frozen-state class
    // of bug in a subtler form.
    if (priorDegraded) return { quiet: false, reason: null };
    return { quiet: true, reason: 'unchanged' };
  }
  return { quiet: false, reason: null };
}

/**
 * Build the deterministic prompt context for the LLM call. Pure. Carries the
 * census's OWN `updatedAt`/`rev` through untouched — never re-derives
 * freshness — so the render layer and this prompt agree on how stale the
 * grounding is.
 *
 * @param {Object} params
 * @param {Object} params.censusDoc - the sweep's stored census document.
 * @param {string|null} params.priorSummary - the prior pass's own summary, for continuity.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildPassMessages({ censusDoc, priorSummary }) {
  const state = censusDoc.state || {};
  const lanes = state.lanes || {};
  const attention = Array.isArray(state.attention) ? state.attention : [];

  const lines = [];
  lines.push(`Fleet census as of ${censusDoc.updatedAt instanceof Date ? censusDoc.updatedAt.toISOString() : censusDoc.updatedAt} (revision ${censusDoc.rev}):`);
  for (const [lane, count] of Object.entries(lanes)) {
    lines.push(`- ${lane}: ${count}`);
  }
  if (attention.length) {
    lines.push('');
    lines.push('Rows waiting on a human (lane, issue, stage, since):');
    for (const row of attention.slice(0, REPORT_ATTENTION_CAP)) {
      lines.push(`- [${row.lane}] ${row.issue || row.loopId} (${row.stage || 'unknown stage'}) since ${row.since}`);
    }
    if (attention.length > REPORT_ATTENTION_CAP) {
      lines.push(`- …and ${attention.length - REPORT_ATTENTION_CAP} more (truncated: ${state.truncated === true})`);
    }
  }
  if (priorSummary) {
    lines.push('');
    lines.push(`Your own prior observation: ${priorSummary}`);
  }

  const system = `You are the cloud observer for an autopilot fleet. You are read-only: you narrate what the census shows, you never invent numbers.
Respond with ONLY a JSON object of the shape {"narrative": string, "flags": string[]}.
- "narrative" is 2-4 sentences, plain language, grounded ONLY in the census data given — never invent counts, issue ids, or activity not present in the data.
- "flags" is a short list of terse tags for anything worth a human's attention (e.g. "blocked-cluster", "silent-growth"); [] if nothing stands out.
- Do NOT include lane counts or any other numeric field — those are already known and reported separately.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') }
  ];
}

/**
 * The tick body for one workspace: read the sweep's stored census, read this
 * pass's own prior state, decide the quiet path, optionally call the
 * injected LLM seam, and advance this instance's state. Mirrors
 * `lib/observer-sweep.js`'s `sweepOneWorkspace` shape and its loud-throw
 * convention for a missing `now`.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {import('./observer-state-store.js').ObserverStateStore} deps.observerStateStore
 * @param {Object} deps.workspacePreferencesStore - threaded to `isWorkspaceFeatureEnabled`/`resolveWorkspaceModel`
 * @param {Function} [deps.streamChatWithTools] - injected LLM seam, `(messages, options, onEvent) => Promise<void>`. Omitted ⇒ the LLM is never called (degrades honestly, never network-reaches).
 * @param {Function} [deps.getPaidEnvKey] - `(urlKey) => Promise<string|undefined>`. LIN-2412: despite the name, this
 *   resolves a durable, consent-gated, per-account key via `lib/openrouter-key-resolver.js`'s `getUnattendedOpenRouterKey`
 *   — never an env var. The name is kept stable at the deps-object key so `createObserverPassRun`'s destructuring stays
 *   untouched; only what the injected function does has changed. MUST be awaited — it is async now, and a Promise is
 *   truthy, so an un-awaited call would make the `llm-unavailable` degrade below unreachable.
 * @param {Array<Object>} [deps.tools] - optional, injected; empty in P2-1
 * @param {Function} [deps.executeTool] - optional, injected; absent in P2-1
 * @param {number} deps.now - epoch ms, resolved by the caller's closure
 * @param {Object} [deps.logger=console]
 * @returns {Promise<{advanced: boolean|null, quiet: boolean, authority: string}|null>}
 */
export async function runObserverPass(urlKey, deps) {
  const { observerStateStore, workspacePreferencesStore, streamChatWithTools, getPaidEnvKey, tools = [], executeTool, now, logger = console } = deps;

  // Same loud-throw discipline as lib/observer-sweep.js's sweepOneWorkspace:
  // a caller bug here must not silently persist a wrong diagnosis.
  if (!Number.isFinite(now)) {
    throw new Error('observer-pass: deps.now (epoch ms) is required');
  }

  const passInstanceKey = `${PASS_INSTANCE_PREFIX}${urlKey}`;
  const sweepInstanceKey = `${SWEEP_INSTANCE_PREFIX}${urlKey}`;

  // ensureSeeded EVERY tick (including the quiet path) — this is what keeps
  // a byte-stable "nothing changed" report out of RETENTION_IDLE_MS eviction
  // (lib/observer-state-store.js's Liveness-vs-change contract): the
  // no-op-write branch of advance() makes no write at all and so cannot
  // refresh lastSeenAt on its own.
  const passDoc = await observerStateStore.ensureSeeded(passInstanceKey, PASS_SEED_STATE);
  if (passDoc === null) {
    logger.error(`observer-pass: failed to seed ${passInstanceKey}`);
    return null;
  }

  const censusDoc = await observerStateStore.readCurrent(sweepInstanceKey);
  const priorState = passDoc.state && passDoc.state.seeded !== true ? passDoc.state : null;

  const authorityEnabled = await isWorkspaceFeatureEnabled({
    urlKey,
    featureKey: WORKSPACE_FEATURES.OBSERVER_AUTHORITY,
    store: workspacePreferencesStore
  });
  const authority = resolveAuthorityStamp(authorityEnabled);
  if (authorityEnabled) {
    // Loud and logged, per the ticket's "authority ON must remain an
    // explicitly stamped/logged unimplemented report-only path" — there is
    // no branch below that behaves differently because of this.
    logger.log(`[observer-pass] ${urlKey}: observerAuthority is ON, but P2-1 has no acting path — stamping 'on-unimplemented' and continuing report-only.`);
  }

  // LIN-2408. Read off the stored report, which is the only durable record that
  // the last conclusion was not a real one. Computed ONCE and threaded to both
  // consumers — the quiet gate below and the prior-summary derivation further
  // down — because the two were written separately in opposite polarities
  // (`!= null` / `== null`) and agreed only by coincidence. They must move
  // together: "do not treat this as settled" and "do not replay this to the
  // model" are the same judgement about the same field.
  const priorDegraded = priorState?.report?.degraded != null;

  const { quiet, reason: quietReason } = assessQuietPath({
    censusDoc,
    lastCensusStateHash: priorState?.lastCensusStateHash || null,
    priorDegraded
  });

  const lanes = censusDoc?.state?.lanes || {};
  const attention = Array.isArray(censusDoc?.state?.attention) ? censusDoc.state.attention : [];
  const censusGroundedAt = censusDoc ? (censusDoc.updatedAt instanceof Date ? censusDoc.updatedAt.toISOString() : censusDoc.updatedAt) : null;
  const censusRev = censusDoc ? censusDoc.rev : null;

  let narrative;
  let flags = [];
  let degraded = null;

  // LIN-2412: getPaidEnvKey is now the async, urlKey-taking unattended
  // resolver (never an env reader — see the JSDoc above) and MUST be
  // awaited: a Promise is truthy, so a sync call here would make the
  // `llm-unavailable` degrade below unreachable and pass a Promise as
  // apiKey into streamChatWithTools.
  const apiKey = typeof getPaidEnvKey === 'function' ? await getPaidEnvKey(urlKey) : null;

  if (quiet) {
    narrative = buildQuietNarrative(quietReason);
  } else if (typeof streamChatWithTools !== 'function' || !apiKey) {
    // No injected LLM caller, or no key resolvable — degrade honestly rather
    // than fabricate a narrative or silently skip the tick.
    narrative = 'The observer pass could not reach a model this cycle (no API key configured).';
    degraded = { reason: 'llm-unavailable' };
  } else {
    const model = await resolveWorkspaceModel({ urlKey, workspacePreferencesStore });
    // LIN-2408: a DEGRADED prior summary is not an observation, so it is not
    // offered back to the model as one.
    //
    // `buildPassMessages` injects this as "Your own prior observation: …" for
    // continuity. On the recovery tick this fix creates — which is now the
    // common path out of a degraded state — that string would be "The observer
    // pass could not reach a model this cycle (no API key configured)", i.e.
    // the fallback narrating its own failure, handed to the model as context
    // to build on. It was reachable before this ticket too (a changed census
    // after a degraded tick), just rare.
    const priorSummary = priorDegraded ? null : (priorState?.summary || null);
    const messages = buildPassMessages({ censusDoc, priorSummary });
    let buffer = '';
    await streamChatWithTools(
      messages,
      {
        apiKey,
        model,
        maxTokens: LLM_MAX_TOKENS,
        temperature: 0.4,
        tools,
        executeTool,
        callMeta: { urlKey, feature: 'observer-pass' }
      },
      (type, data) => {
        if (type === 'token' && data?.token) buffer += data.token;
      }
    );
    const parsed = parseObserverPassResponse(buffer);
    narrative = parsed.narrative;
    flags = parsed.flags;
    degraded = parsed.degraded;
    if (!narrative) narrative = 'The observer pass ran but produced no usable narrative this tick.';
  }

  let report = {
    lanes: { ...lanes },
    attentionCount: attention.length,
    attention: attention.slice(0, REPORT_ATTENTION_CAP),
    narrative,
    flags: [...flags].sort(),
    degraded,
    censusGroundedAt,
    censusRev
  };
  let summary = clampText(narrative || '', SUMMARY_MAX_CHARS);

  // An `unchanged` quiet tick must not clobber the last substantive report
  // with the generic placeholder narrative — carry the prior report/summary
  // forward verbatim instead (LIN-2405). `empty-fleet`/`no-census` are
  // untouched: those are honest quiet narratives, not a clobber of memory.
  if (quiet && quietReason === 'unchanged' && priorState) {
    report = priorState.report;
    summary = priorState.summary;
  }

  const nextState = {
    v: 1,
    summary,
    report,
    authority,
    lastCensusStateHash: censusDoc ? censusDoc.stateHash : null
  };

  const result = await observerStateStore.advance(passInstanceKey, passDoc.rev, nextState, { reason: quiet ? `quiet:${quietReason}` : 'observed', authority });
  if (result === null) {
    logger.error(`observer-pass: failed to advance ${passInstanceKey}`);
  }

  return { advanced: result, quiet, authority };
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the observer
 * pass. Mirrors `lib/observer-sweep.js`'s `createObserverSweepRun` shape:
 * one workspace per tick, round-robin over the SAME session+dispatch roster
 * union the sweep uses (reused, never re-derived), selected by THIS job's
 * own registered `intervalMs` so two ticks inside one interval agree.
 *
 * @param {Object} deps
 * @param {{find: Function}} deps.sessionsCollection
 * @param {Object} deps.dispatchStore
 * @param {import('./observer-state-store.js').ObserverStateStore} deps.observerStateStore
 * @param {Object} deps.workspacePreferencesStore
 * @param {Function} [deps.streamChatWithTools]
 * @param {Function} [deps.getPaidEnvKey] - `(urlKey) => Promise<string|undefined>` (LIN-2412: the consent-gated
 *   unattended resolver, wired in at server.js — see `runObserverPass`'s JSDoc above for the full contract)
 * @param {number} deps.intervalMs - this job's own registered tick period
 * @param {Function} [deps.pass] - seam for tests; defaults to runObserverPass
 * @param {Function} [deps.now] - seam for tests; defaults to Date.now
 * @param {Object} [deps.logger=console]
 * @returns {() => Promise<void>}
 */
export function createObserverPassRun({
  sessionsCollection,
  dispatchStore,
  observerStateStore,
  workspacePreferencesStore,
  streamChatWithTools,
  getPaidEnvKey,
  intervalMs,
  pass = runObserverPass,
  now = Date.now,
  logger = console
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('observer-pass: createObserverPassRun requires a positive intervalMs');
  }
  return async () => {
    const tickNow = now();
    const [sessions, dispatchUrlKeys] = await Promise.all([
      sessionsCollection.find({}).toArray().catch(() => []),
      dispatchStore.listObservedWorkspaceKeys().catch(() => [])
    ]);
    const roster = mergeRosterUnion(resolveRosterFromSessions(sessions), dispatchUrlKeys);
    if (!roster.length) return;
    const urlKey = roster[Math.floor(tickNow / intervalMs) % roster.length];
    await pass(urlKey, { observerStateStore, workspacePreferencesStore, streamChatWithTools, getPaidEnvKey, now: tickNow, logger });
  };
}
