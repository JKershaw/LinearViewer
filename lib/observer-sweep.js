/**
 * lib/observer-sweep.js
 *
 * Deterministic observer sweep (LIN-2131, P1-3 of the LIN-2114 observer-harness
 * epic). One tick reads the whole fleet for one workspace, classifies every
 * Loop into a fixed 7-lane census, builds a bounded JSON-safe payload, and
 * advances it into the P1-2 durable state store (`lib/observer-state-store.js`).
 *
 * Read/observe/record/relay ONLY. No LLM call, no `/api/proxy`, no dispatch or
 * agent-status write of any kind — `dead` diagnosis has no signal yet
 * (LIN-1952, unresolved), so this module contains no auto-resume, no
 * auto-kill, and no other automated-intervention code path.
 *
 * `blocked` is an active waiting-on-human lane, never terminal or resting
 * (`lib/dispatch-terminal.js:103-106`) — it is never folded into `terminal`.
 */

import { getLoopsForWorkspace } from './pipeline-loops.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { isLoopActive, isFreshlyActive, loopLastActivityMs, DEFAULT_LANE_STALE_MS } from './live-console.js';
import { computeWouldBeActions } from './observer-shadow-log.js';

// Only `silent` and `blocked` (the waiting-on-a-human lanes) are surfaced in
// `attention`; bounded so the payload's own caps set its ~11.5 KB document
// bound rather than assuming it from the store.
const ATTENTION_CAP = 25;

// All 7 lanes classification is exhaustive over, pre-initialised to 0 so a
// zero-count lane is still a present key, never a missing one. `unknown` is
// counted here but deliberately excluded from `attention` below — it is not
// established to be waiting on anyone.
const LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];

// The seed payload's key ({v:1, seeded:true}) is never emitted by
// buildSweepPayload (which always returns lanes/attention/truncated), so a
// never-seeded advance() returning true under a forced ensureSeeded/advance
// interleaving is structurally unreachable.
const SEED_STATE = { v: 1, seeded: true };

/**
 * Classify one Loop into exactly one of the 7 census lanes. Pure, no I/O.
 *
 * Ordering is load-bearing: terminal first (a `[blocked]`-then-`[done]` row
 * is terminal, never blocked), `resolved` second (an operator-cancelled or
 * -expired row is done-with regardless of a stale wake marker it may also
 * carry), `blocked` third (a lane can only be one thing, whichever of the two
 * blocked channels triggered it).
 *
 * `blocked` unions two independently-authoritative channels (LIN-1005,
 * `routes/dashboard.js:273` `loopIsWaiting`, neither subsumes the other): the
 * feedback-marker channel (`wakeMarker === 'blocked'`, never `[pending]` —
 * `WAITING_WAKE_MARKERS` in `lib/pipeline-loops.js:47` is `{'blocked'}` only)
 * and the agent-status channel (`agentState === 'waiting'`). Successor
 * exclusion applies to both channels alike — an agent-status `blocked` loop
 * is exactly as capable of reporting stale-forever as a feedback-marker one,
 * for the identical reason: a same-workspace follow-up updates the successor
 * loop's own state, never the original's.
 *
 * `superseded` is `computeSupersededLoopIds(loops)` (`lib/loop-supersede.js`),
 * reused rather than hand-rolled — see `buildSweepPayload` for where it is
 * computed, once per tick, over the whole workspace read.
 *
 * @param {Object} loop - a Loop record from `getLoopsForWorkspace(..., { lean: true })`
 * @param {Object} opts
 * @param {Set<string>} opts.superseded - loopIds superseded by a follow-up (this tick's full read)
 * @param {number} opts.now - epoch ms
 * @param {number} opts.staleMs - working→silent threshold
 * @returns {'working'|'silent'|'blocked'|'terminal'|'queued'|'resolved'|'unknown'}
 */
export function classifyLoop(loop, { superseded, now, staleMs } = {}) {
  const supersededIds = superseded || new Set();
  const { loopId, terminalStatus, wakeMarker, agentState, historyStatus, source } = loop;

  const lifecycle = terminalStatus ?? ((wakeMarker === 'blocked' || agentState === 'waiting') ? 'blocked' : null);

  if (lifecycle === 'done' || lifecycle === 'failed' || lifecycle === 'aborted' || lifecycle === 'skipped') {
    return 'terminal';
  }
  // historyStatus is null for every live-sourced row (lib/pipeline-loops.js:372),
  // so this can never misfire on a queued/working row. Must be checked before
  // blocked: a row can carry historyStatus 'cancelled'/'expired' (terminalStatus
  // null for both) AND a stale wakeMarker === 'blocked' at once.
  if (historyStatus === 'cancelled' || historyStatus === 'expired') {
    return 'resolved';
  }
  if (lifecycle === 'blocked' && !supersededIds.has(loopId)) {
    return 'blocked';
  }
  if (source === 'live' && agentState === 'queued') {
    return 'queued';
  }
  if (isLoopActive(loop)) {
    if (isFreshlyActive(loop, now, staleMs)) return 'working';
    // Declared-defensive, not exercised by this sweep's own read path
    // (plan-review note 1): `loopLastActivityMs` can return 0 for a
    // signal-less loop, but `_buildLoops` skips any row whose `dispatchedAt`
    // fails to parse (lib/pipeline-loops.js:250-254 live, :271-275 history),
    // so every loop this sweep can ever see already carries a non-zero
    // `dispatchedAt`. Kept rather than removed because `loopLastActivityMs`
    // is a shared function whose zero case is real for OTHER callers, and a
    // future upstream change here would otherwise silently mis-stale — but
    // there is no real fixture through `_buildLoops` that reaches it, so it
    // is untested by design rather than by omission.
    if (loopLastActivityMs(loop) === 0) return 'unknown';
    if (now - loopLastActivityMs(loop) > staleMs) return 'silent';
  }
  // Exhaustive by construction: every branch above, including this one,
  // names one of the 7 lane keys buildSweepPayload tallies; none is a silent
  // drop (F1).
  return 'unknown';
}

/**
 * Classify every Loop in a workspace read into the fixed 7-lane census and
 * build the bounded, deterministic, JSON-safe diagnosis payload the P1-2
 * state store hashes for dedup. Pure, no I/O.
 *
 * Two traps that would each silently break `advance()`'s duplicate-tick
 * dedup alone: no per-tick-varying value anywhere in the return value (no
 * `sweptAt`, no age-in-ms — the store stamps `updatedAt`/`lastSeenAt` outside
 * the hashed payload), and `attention` sorted here by the sweep itself, since
 * `stableStringify` (`lib/recap-cache.js:30-32`) sorts object keys but
 * preserves array order and `canonicalizeForHash`
 * (`lib/observer-state-store.js:215-217`) maps arrays without sorting either.
 *
 * @param {Array<Object>} loops - full `getLoopsForWorkspace(urlKey, { lean: true, ... })` result
 * @param {Object} opts
 * @param {number} opts.now - epoch ms
 * @param {number} opts.staleMs - working→silent threshold (`DEFAULT_LANE_STALE_MS`)
 * @returns {{v: number, lanes: Object<string, number>, attention: Array<Object>, truncated: boolean}}
 */
export function buildSweepPayload(loops, { now, staleMs } = {}) {
  // Computed once per tick, over the full fetched workspace array — never
  // issue-scoped, or a cross-issue successor would be invisible (F3). This is
  // wider than computeSupersededLoopIds's stated single-session contract
  // (LIN-1478, guarding against a same-id collision across sessions — moot
  // here since loopId/followUpTo are global dispatch UUIDs, not per-session
  // sequence numbers). Review note 2: that disposes of the *same-id*
  // collision the module's own header names, but not the narrower case
  // `tests/unit/loop-supersede.test.js:104-136` pins — a cross-session loop
  // with a distinct id and a genuine `followUpTo` naming another session's
  // row, which a session-scoped caller would (correctly, for its purpose)
  // treat as out of scope. The widening is still right for THIS consumer:
  // any loop carrying `followUpTo === X` means a follow-up dispatch resuming
  // X actually exists — exactly the "a human answered" evidence this sweep's
  // blocked-exclusion is looking for. Session boundaries are a display
  // concern for the rollup consumers (dashboard/render-session); they are
  // not a correctness constraint on a fleet-wide waiting-on-human census.
  const superseded = computeSupersededLoopIds(loops);

  const lanes = Object.fromEntries(LANE_KEYS.map((key) => [key, 0]));
  const attentionRows = [];

  for (const loop of loops) {
    const lane = classifyLoop(loop, { superseded, now, staleMs });
    lanes[lane] += 1;

    // attention's contract is specifically the waiting-on-a-human lanes; an
    // unknown row is not established to be waiting on anyone.
    if (lane === 'silent' || lane === 'blocked') {
      attentionRows.push({
        loopId: loop.loopId,
        issue: loop.issueIdentifier,
        lane,
        stage: loop.stage,
        // Absolute ISO instant, never an age in ms (an age recomputes every
        // tick and defeats dedup). This is last-activity, not exact
        // blocked-since — sound only as a lower bound, and only because
        // successor exclusion already ran.
        since: new Date(loopLastActivityMs(loop)).toISOString()
      });
    }
  }

  // stableStringify does not sort arrays — sort deterministically here.
  attentionRows.sort((a, b) => (a.loopId < b.loopId ? -1 : a.loopId > b.loopId ? 1 : 0));
  const truncated = attentionRows.length > ATTENTION_CAP;

  // F1: lane totals reconcile against the workspace's loop count by
  // construction — every classifyLoop branch names a tallied key.
  return {
    v: 1,
    lanes,
    attention: attentionRows.slice(0, ATTENTION_CAP),
    truncated
  };
}

/**
 * The tick body for one workspace: read the fleet, classify, advance the
 * state store. `now` is injected via `deps` rather than read inside this
 * function — `Scheduler.register()`'s `run` receives no arguments
 * (`lib/scheduler.js:88`), so the closure that calls this resolves its own
 * `Date.now()` and passes it through, keeping this function's own output a
 * pure function of its inputs (load-bearing for the idempotency test's
 * duplicate-tick determinism).
 *
 * `readCurrent()` returns null for both "not found" and "backend error" by
 * design; the ambiguity dissolves by ordering, not a probe — `ensureSeeded`
 * is `$setOnInsert`, so a later null can only mean backend fault, never
 * "seed again".
 *
 * `deps.observerShadowLogStore` (LIN-2132, P1-5), when supplied, additionally
 * logs what this tick's diagnosis WOULD have relayed to a read-only shadow
 * store — see `lib/observer-shadow-log.js`'s own header for the vocabulary
 * mapping. It is OPTIONAL and additive only: omitting it (the shape every
 * pre-P1-5 caller and test still uses) reproduces this function's prior
 * behavior byte-for-byte, and the shadow write, when present, never
 * participates in this function's own P1-2 CAS write or its result.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {import('./observer-state-store.js').ObserverStateStore} deps.observerStateStore
 * @param {import('./observer-shadow-log.js').ObserverShadowLogStore} [deps.observerShadowLogStore]
 * @param {number} deps.now - epoch ms, resolved by the caller's closure
 * @returns {Promise<void>}
 */
export async function sweepOneWorkspace(urlKey, deps) {
  const { dispatchStore, agentStatusStore, observerStateStore, observerShadowLogStore, now } = deps;

  // `now` is REQUIRED, and its absence must be loud (close-out ledger item 9).
  // Unguarded, a caller omitting it degrades silently and expensively rather
  // than failing: `isFreshlyActive` is false and `NaN > staleMs` is false for
  // every row, so every active loop classifies `unknown` — and that wrong
  // diagnosis is then WRITTEN to the durable store as if it were real. A throw
  // costs nothing here: `Scheduler._tick` catches a throwing `run` and logs it
  // (`lib/scheduler.js:187`), self-healing on the next tick, so the failure
  // mode becomes "one logged tick, no write" instead of "a persisted lie".
  if (!Number.isFinite(now)) {
    throw new Error('observer-sweep: deps.now (epoch ms) is required');
  }

  const instanceKey = `sweep:v1:${urlKey}`;

  // Review note 3: `ensureSeeded()` is documented safe to call every tick —
  // it stamps `lastSeenAt` on both the insert and the no-op branch
  // (lib/observer-state-store.js:264-271) — and a caller relying on it alone
  // to signal liveness for a diagnosis that has gone genuinely stable is
  // told to do exactly that. This sweep deliberately does NOT take that
  // every-tick shape: it only calls `ensureSeeded` on a first-ever `null`
  // read, so a workspace whose classified state stays byte-identical for the
  // full `RETENTION_IDLE_MS` window gets no further `lastSeenAt` refresh from
  // the no-op branch of `advance()` (which performs no write at all) and can
  // be evicted by `cleanup()` mid-observation. We accept that eviction rather
  // than pay an unconditional write every tick, because a workspace with
  // nothing changing for 30 days has nothing left for a diagnosis consumer
  // (LIN-2133) to detect either — the store does not force this choice, it
  // offers the every-tick alternative and this ticket declines it.
  let doc = await observerStateStore.readCurrent(instanceKey);
  if (doc === null) {
    doc = await observerStateStore.ensureSeeded(instanceKey, SEED_STATE);
    if (doc === null) {
      // BACKEND FAULT — do not spin, do not treat as "new instance" a second time.
      console.error(`observer-sweep: failed to seed ${instanceKey}`);
      return;
    }
  }

  const loops = await getLoopsForWorkspace(urlKey, { lean: true, dispatchStore, agentStatusStore });
  const payload = buildSweepPayload(loops, { now, staleMs: DEFAULT_LANE_STALE_MS });
  const next = { ...payload, urlKey };

  // LIN-2132 (P1-5): log what this tick's diagnosis WOULD have relayed, to
  // the caller-supplied shadow store ONLY — deliberately independent of the
  // P1-2 CAS write above (a duplicate-tick no-op or even a lost-race/backend-
  // error `advance()` outcome does not affect what this tick's own read
  // computed, and the shadow store's health is not this function's own
  // invariant to protect). Optional: a caller that omits
  // `observerShadowLogStore` gets none of this — see this function's own
  // header.
  if (observerShadowLogStore) {
    const wouldBeActions = computeWouldBeActions(payload);
    if (wouldBeActions.length) {
      await observerShadowLogStore.recordActions(urlKey, wouldBeActions, new Date(now));
    }
  }

  const result = await observerStateStore.advance(instanceKey, doc.rev, next, { reason: 'sweep' });
  if (result === false) return; // lost race / stale witness — next tick re-reads, no in-tick retry
  if (result === null) {
    console.error(`observer-sweep: failed to advance ${instanceKey}`);
  }
  // result === true: advanced or duplicate no-op; either way state === next
}

/**
 * Derive the round-robin roster of workspace `urlKey`s from the raw
 * `sessionsCollection.find({}).toArray()` rows — the same full-collection
 * scan precedent as `resolveWorkspaceAccess` (`server.js`, e.g. its
 * `selectOwnerWorkspaceToken` call site). Interim source (LIN-2131 plan,
 * Follow-ups item 3): no durable, queryable workspace registry exists yet,
 * so a workspace worked entirely by dispatched agents with no browser
 * session never enters the roster. Deliberately roster-source-agnostic at
 * every other call site — `sweepOneWorkspace`'s logic and this ticket's
 * tests do not depend on which roster source is eventually chosen.
 *
 * Each row's `.session` is the persisted express-session blob, string or
 * already-parsed, carrying `workspaces[]` as `{urlKey, provider, accessToken,
 * tokenExpiresAt}` (`lib/workspace-token-resolver.js:13-16`) — only `urlKey`
 * is ever read here, never a credential field.
 *
 * A malformed `session` string must skip only its own row, never wedge the
 * whole tick — one bad row would otherwise blank the roster fleet-wide.
 *
 * @param {Array<{session: string|Object}>} sessions
 * @returns {Array<string>} deduped, sorted urlKeys — sorted so round-robin
 *   index shifts only on a real membership change, never on scan-order noise
 *   from the collection's own find({}) cursor
 */
export function resolveRosterFromSessions(sessions) {
  const urlKeys = new Set();
  for (const row of sessions || []) {
    let data;
    try {
      // Same JSON-string-or-object duality lib/workspace-token-resolver.js's
      // private parseSessionData(row) handles — not exported, so duplicated
      // here as one line rather than coupling this module to that one's
      // internals.
      data = typeof row.session === 'string' ? JSON.parse(row.session) : row.session;
    } catch {
      continue; // malformed session JSON — skip this row, not every other row's contribution
    }
    const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
    for (const ws of workspaces) {
      if (ws?.urlKey) urlKeys.add(ws.urlKey);
    }
  }
  return [...urlKeys].sort();
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the observer sweep
 * (close-out ledger item 6). This lived as an anonymous closure inside
 * `server.js`'s `scheduler.register(...)` call, where nothing could reach it:
 * the roster read, its fail-soft, the round-robin selection and the deps
 * object it threads were all invisible to CI, so every green check was
 * compatible with the closure never producing a correct sweep. Extracted
 * verbatim — same reads, same fail-soft, same index arithmetic — so the
 * production wiring is exercised rather than merely inspected. `server.js`'s
 * remaining delta is now the registration itself.
 *
 * Every collaborator stays INJECTED, exactly as before: this module still
 * imports only `pipeline-loops`/`loop-supersede`/`live-console` (pinned by the
 * static import assertion), so the extraction adds no capability — least of
 * all a write or intervention path.
 *
 * The round-robin index is deliberately derived from the SAME `intervalMs` the
 * job is registered with: one workspace per tick, and two ticks landing inside
 * one interval must select the same workspace, or they would produce different
 * payloads and defeat the store's duplicate-tick dedup.
 *
 * @param {Object} deps
 * @param {{find: Function}} deps.sessionsCollection - session store collection, read via find({})
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {import('./observer-state-store.js').ObserverStateStore} deps.observerStateStore
 * @param {import('./observer-shadow-log.js').ObserverShadowLogStore} [deps.observerShadowLogStore] -
 *   optional (LIN-2132, P1-5); threaded through to `sweep()`'s own deps ONLY
 *   when supplied, so an existing caller that omits it (every pre-P1-5 one)
 *   gets the exact same deps object shape as before this ticket
 * @param {number} deps.intervalMs - the job's own registered tick period
 * @param {Function} [deps.sweep] - seam for tests; defaults to sweepOneWorkspace
 * @param {Function} [deps.now] - seam for tests; defaults to Date.now
 * @returns {() => Promise<void>} the scheduler `run` callback (takes no arguments)
 */
export function createObserverSweepRun({
  sessionsCollection,
  dispatchStore,
  agentStatusStore,
  observerStateStore,
  observerShadowLogStore,
  intervalMs,
  sweep = sweepOneWorkspace,
  now = Date.now
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('observer-sweep: createObserverSweepRun requires a positive intervalMs');
  }
  return async () => {
    // `Scheduler.register`'s `run` receives nothing (lib/scheduler.js:88) — no
    // `now`, no lock — so the tick resolves its own clock once and threads that
    // one value into both the selection and the sweep, keeping the sweep a
    // pure function of its inputs.
    const tickNow = now();
    // Fail soft: a query error yields an empty roster (skip this tick), never
    // a thrown job failure — a roster read is not worth losing a tick's lease
    // over. Interim roster source (LIN-2131 plan, Follow-ups item 3): no
    // durable, queryable workspace registry exists yet, so a workspace worked
    // entirely by dispatched agents with no browser session is invisible here
    // — the known gap, ruled non-blocking, filed as its own ticket at close-out.
    const sessions = await sessionsCollection.find({}).toArray().catch(() => []);
    const roster = resolveRosterFromSessions(sessions);
    if (!roster.length) return;
    const urlKey = roster[Math.floor(tickNow / intervalMs) % roster.length];
    const sweepDeps = { dispatchStore, agentStatusStore, observerStateStore, now: tickNow };
    if (observerShadowLogStore) sweepDeps.observerShadowLogStore = observerShadowLogStore;
    await sweep(urlKey, sweepDeps);
  };
}
