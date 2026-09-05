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

// LIN-2619: a THIRD, distinct "is this row archaeology?" quantity — deliberately
// not one of the two existing LIVENESS numbers ("is this run still working?"),
// which stay outside LIN-1445's unification on purpose: Observation's 24h
// (`STALE_AFTER_MS`, `routes/dashboard.js:85`) and Live Console's 1h
// (`DEFAULT_LANE_STALE_MS`, `lib/live-console.js:85`, imported above). Exported
// (unlike `ATTENTION_CAP`) because LIN-2633's write half reuses this exact value.
export const FOSSIL_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * -expired row — or, since LIN-2653, a bookkeeping-stamped fossil — is
 * done-with regardless of a stale wake marker it may also carry), `blocked`
 * third (a lane can only be one thing, whichever of the two blocked channels
 * triggered it).
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
  const { loopId, terminalStatus, wakeMarker, agentState, historyStatus, source, bookkeeping } = loop;

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
  // Fossil-bookkeeping stamp (LIN-2653/LIN-2633): an operator has retired this
  // row, so it is done-with for census purposes — the same meaning the
  // cancelled/expired test above carries, hence the same lane. Read off the
  // Loop record (`lib/pipeline-loops.js:763`, threaded on the always-present
  // scalar set so the lean read this sweep uses still carries it); no new
  // import — this module's static-import allowlist is pinned at four
  // specifiers.
  //
  // Placement is load-bearing in BOTH directions, and each bound has its own
  // test: AFTER terminal, or a stamped row that also posted `[done]` would
  // stop reading `terminal`; BEFORE blocked, because a fossil row very often
  // ALSO carries a stale `wakeMarker === 'blocked'`/`agentState === 'waiting'`
  // and `blocked` is roughly half the target population — a branch below
  // `blocked` would be unreachable for half the rows this exists to retire,
  // silently. Before the `isLoopActive` branch too, or a stamped row reads
  // `silent`. `status` is untouched, so this is the ONLY surface in the change
  // whose emitted value differs for a stamped row.
  if (bookkeeping) {
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
 * Rank key for one attention-eligible row: last-activity epoch ms, or
 * `-Infinity` for anything non-finite. A `blocked` row can legitimately carry
 * `loopLastActivityMs(loop) === 0` (epoch) — the zero-guard at `classifyLoop`
 * (`:104`) only runs on the `isLoopActive` branch that leads to
 * `working`/`silent`/`unknown`, never on `blocked`, which returns before that
 * check (`:86-88`). `silent` can never hit this: `:104-105` requires a
 * nonzero `loopLastActivityMs` before a row is ever classified `silent`. `0`
 * already sorts last against any real activity timestamp in the descending
 * compare below, so no special-casing is needed for it; `-Infinity` exists
 * only as a defensive floor for a value that isn't even a finite number,
 * which never happens on today's `_buildLoops` output (LIN-2619 beat 1).
 *
 * @param {Object} loop
 * @returns {number}
 */
function rankableSinceMs(loop) {
  const ms = loopLastActivityMs(loop);
  return Number.isFinite(ms) ? ms : -Infinity;
}

/**
 * Classify every Loop in a workspace read into the fixed 7-lane census and
 * build the bounded, deterministic, JSON-safe diagnosis payload the P1-2
 * state store hashes for dedup. Pure, no I/O.
 *
 * Two traps that would each silently break `advance()`'s duplicate-tick
 * dedup alone: no per-tick-varying value anywhere in the return value (no
 * `sweptAt`, no age-in-ms — the store stamps `updatedAt`/`lastSeenAt` outside
 * the hashed payload), and `attention`/`attentionKeysFull` sorted here by the
 * sweep itself, since `stableStringify` (`lib/recap-cache.js:30-32`) sorts
 * object keys but preserves array order and `canonicalizeForHash`
 * (`lib/observer-state-store.js:215-217`) maps arrays without sorting either.
 * `now` (the SAME injected clock already used for `classifyLoop`'s
 * `isFreshlyActive`/`staleMs` checks, never a fresh `Date.now()` read here) is
 * what LIN-2619's fossil-age comparison uses too — one clock read per tick,
 * reused, not a second one.
 *
 * LIN-2619 (beat 2, read side): `attention` now ranks by recency of `since`
 * (most-recently-transitioned first, `loopId` tie-break — total and
 * deterministic, since this array's own order is load-bearing for the
 * dedup hash above) and EXCLUDES any row older than `FOSSIL_AGE_MS`, which is
 * instead folded into `staleAttentionCount` — freeing the `ATTENTION_CAP`
 * enumeration budget for genuinely fresh signal rather than letting
 * long-silent fossils occupy it. The fossil filter runs BEFORE the
 * `ATTENTION_CAP` slice: `truncated` reports only cap truncation of the
 * FRESH population, since a fossil is already accounted for via
 * `staleAttentionCount`, not via truncation. `attentionKeysFull` is the
 * companion gate's own separate, additive key (LIN-2619's plan-of-record
 * ruling on open question (c)) — every attention-eligible row's identity
 * tuple, untouched by both the fossil filter and `ATTENTION_CAP`, so a row
 * merely ageing out of the enumerated `attention` array is not a set-
 * membership change the gate can see; beat 3 wires the gate to diff against
 * this key instead of `attention` itself.
 *
 * @param {Array<Object>} loops - full `getLoopsForWorkspace(urlKey, { lean: true, ... })` result
 * @param {Object} opts
 * @param {number} opts.now - epoch ms
 * @param {number} opts.staleMs - working→silent threshold (`DEFAULT_LANE_STALE_MS`)
 * @returns {{v: number, lanes: Object<string, number>, attention: Array<Object>, truncated: boolean, staleAttentionCount: number, staleAttentionThresholdMs: number, attentionKeysFull: Array<[string,string,string]>}}
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
  const attentionCandidates = [];

  for (const loop of loops) {
    const lane = classifyLoop(loop, { superseded, now, staleMs });
    lanes[lane] += 1;

    // attention's contract is specifically the waiting-on-a-human lanes; an
    // unknown row is not established to be waiting on anyone.
    if (lane === 'silent' || lane === 'blocked') {
      attentionCandidates.push({
        loopId: loop.loopId,
        issue: loop.issueIdentifier,
        lane,
        stage: loop.stage,
        sinceMs: rankableSinceMs(loop)
      });
    }
  }

  // The gate's full-identity key (LIN-2619 open question (c) ruling): every
  // attention-eligible row, sorted by `loopId` — independent of the freshness
  // ranking below, so this key's own order never shifts just because `now`
  // advanced past a row's fossil threshold. Neither `ATTENTION_CAP`-sliced
  // nor fossil-filtered — that's the whole point: a row moving from
  // enumerated to stale-counted is invisible here, and only a genuine
  // membership change (a real new/resolved row) changes this set.
  const attentionKeysFull = attentionCandidates
    .map((row) => [row.loopId, row.lane, row.stage])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Freshness ranking: most-recently-transitioned first. Tie-break by
  // `loopId` so equal timestamps never fall back to engine-dependent sort
  // order — the module header above makes this array's order load-bearing
  // for the duplicate-tick hash, so the compare must stay total.
  const rankedCandidates = [...attentionCandidates].sort((a, b) => {
    if (a.sinceMs !== b.sinceMs) return b.sinceMs - a.sinceMs;
    return a.loopId < b.loopId ? -1 : a.loopId > b.loopId ? 1 : 0;
  });

  // Fossil filter runs BEFORE the ATTENTION_CAP slice, on the ranked list —
  // a row past FOSSIL_AGE_MS is summarised as a count instead of enumerated,
  // freeing the cap's 25 slots for fresh signal rather than letting fossils
  // occupy them. A `-Infinity` sinceMs makes `now - sinceMs` `+Infinity`,
  // always past the threshold — fossil-eligible by construction, never a
  // special case.
  const freshRows = [];
  let staleAttentionCount = 0;
  for (const row of rankedCandidates) {
    if (now - row.sinceMs > FOSSIL_AGE_MS) {
      staleAttentionCount += 1;
    } else {
      freshRows.push(row);
    }
  }

  // truncated reports ONLY cap truncation of the fresh population — a
  // fossil's absence from `attention` is already accounted for via
  // `staleAttentionCount`, never double-counted as truncation too.
  const truncated = freshRows.length > ATTENTION_CAP;
  const attention = freshRows.slice(0, ATTENTION_CAP).map((row) => ({
    loopId: row.loopId,
    issue: row.issue,
    lane: row.lane,
    stage: row.stage,
    // Absolute ISO instant, never an age in ms (an age recomputes every
    // tick and defeats dedup). This is last-activity, not exact
    // blocked-since — sound only as a lower bound, and only because
    // successor exclusion already ran.
    since: new Date(row.sinceMs === -Infinity ? 0 : row.sinceMs).toISOString()
  }));

  // F1: lane totals reconcile against the workspace's loop count by
  // construction — every classifyLoop branch names a tallied key.
  return {
    v: 1,
    lanes,
    attention,
    truncated,
    staleAttentionCount,
    staleAttentionThresholdMs: FOSSIL_AGE_MS,
    attentionKeysFull
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

  // LIN-2438 reverses the refusal this comment used to record. The
  // companion's pre-call gate (lib/flight-companion-gate.js) needs a genuine
  // last-*seen* stamp on this document to tell a quiet fleet from a dead
  // producer, and `advance()`'s duplicate-tick branch performs no write at
  // all (below) — so without an explicit heartbeat, `lastSeenAt` on THIS
  // document would only ever be a second last-*changed* stamp, exactly like
  // `updatedAt`. The heartbeat added after `advance()` below fixes that by
  // refreshing `lastSeenAt` on every completed tick, whether or not the
  // census content changed. The side effect this trade now accepts (this
  // sweep declined it before): a workspace still on the roster is no longer
  // evictable by `cleanup()` mid-observation — a strict improvement, not a
  // cost, since a workspace that leaves the roster simply stops heartbeating
  // and is still evicted after `RETENTION_IDLE_MS` once it does. Retention
  // is preserved, not defeated.
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
    return;
  }
  // result === true: advanced or duplicate no-op; either way state === next

  // LIN-2438: the sweep-liveness heartbeat. Placed strictly AFTER advance()
  // succeeds so the stamp means "this tick produced a current census", not
  // merely "a timer fired" — a tick that throws before advance() (e.g.
  // getLoopsForWorkspace rejecting, above) must not look alive, and neither
  // must a lost CAS race or a backend error on advance() itself (the `return`
  // above already short-circuits those). ensureSeeded refreshes lastSeenAt on
  // its own no-op branch (lib/observer-state-store.js:311) and touches
  // nothing else — rev, state, stateHash, updatedAt and the ledger are all
  // left untouched (LIN-2438 research 2/3, spike-verified against a real
  // MangoDB instance).
  if (await observerStateStore.ensureSeeded(instanceKey, SEED_STATE) === null) {
    console.error(`observer-sweep: failed to heartbeat ${instanceKey}`);
  }
}

/**
 * Derive the SESSION-DERIVED half of the round-robin roster from the raw
 * `sessionsCollection.find({}).toArray()` rows — the same full-collection
 * scan precedent as `resolveWorkspaceAccess` (`server.js`, e.g. its
 * `selectOwnerWorkspaceToken` call site). A workspace worked entirely by
 * dispatched agents, with no browser session, never appears in THIS
 * function's output — that population is the other half of the union
 * `mergeRosterUnion` builds below (LIN-2146, closing the gap LIN-2131 filed
 * at its own close-out). Deliberately roster-source-agnostic at every other
 * call site — `sweepOneWorkspace`'s logic and its own tests do not depend on
 * which roster source(s) feed it.
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
 * Union the session-derived roster with workspaces observed in the dispatch
 * store (LIN-2146) — the roster's SOLE order determinant. A workspace worked
 * entirely by dispatched agents, with no browser session, contributes only
 * to `dispatchUrlKeys`; a workspace with a live browser session may
 * contribute to both and is deduped to one entry either way.
 *
 * One `Set`, one terminal `.sort()`, over the UNION — this is what keeps the
 * round-robin index (`roster[Math.floor(tickNow / intervalMs) % roster.length]`
 * below) stable against scan-order noise from either source, exactly the
 * guarantee `resolveRosterFromSessions` already gives its own input alone.
 *
 * @param {Array<string>} [sessionUrlKeys]
 * @param {Array<string>} [dispatchUrlKeys]
 * @returns {Array<string>} deduped, sorted union
 */
export function mergeRosterUnion(sessionUrlKeys, dispatchUrlKeys) {
  return [...new Set([...(sessionUrlKeys || []), ...(dispatchUrlKeys || [])])].sort();
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
    // Fail soft: a query error yields an empty half-roster (never a thrown
    // job failure — a roster read is not worth losing a tick's lease over),
    // and the two reads use INDEPENDENT .catch()s so a fault in one source
    // can never blank the other. No durable, queryable workspace registry
    // exists yet (see lib/workspace-store.js — constructed but wired to no
    // route), so the roster is a union of two proxies for "workspace worth
    // sweeping": the session-derived half (a human's browser session) and
    // the dispatch-observed half (LIN-2146 — a workspace with recent
    // dispatch-queue/dispatch-history rows is, by definition, agent-worked,
    // exactly the population a session scan alone misses).
    const [sessions, dispatchUrlKeys] = await Promise.all([
      sessionsCollection.find({}).toArray().catch(() => []),
      dispatchStore.listObservedWorkspaceKeys().catch(() => [])
    ]);
    const roster = mergeRosterUnion(resolveRosterFromSessions(sessions), dispatchUrlKeys);
    if (!roster.length) return;
    const urlKey = roster[Math.floor(tickNow / intervalMs) % roster.length];
    const sweepDeps = { dispatchStore, agentStatusStore, observerStateStore, now: tickNow };
    if (observerShadowLogStore) sweepDeps.observerShadowLogStore = observerShadowLogStore;
    await sweep(urlKey, sweepDeps);
  };
}
