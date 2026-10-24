/**
 * Pure session/run state for the dashboard routes (LIN-3742): the read-time
 * derivations the Observation feed, the rulings feed, the summaries and the run
 * page all share. No I/O, no store, no router: every function here is a pure
 * function of the loops and sessions it is handed, which is why the route
 * modules can all depend on it and nothing in it can depend on them.
 *
 * Everything was module-level in routes/dashboard.js before the rebuild;
 * routes/dashboard.js re-exports the names its importers (server.js,
 * routes/task-chat.js, tests) resolve there.
 */
import { computeSupersededLoopIds } from '../lib/loop-supersede.js';
import { findWakeEvent, isWaitingWakeMarker } from '../lib/dispatch-terminal.js';
import { isTerminalLoop } from '../lib/run-loop-state.js';
import { collectUnansweredDecisions } from '../lib/unanswered-decisions.js';
import { findAnchorLoop } from '../lib/session-summary.js';
import { toEpochMs } from '../lib/utils/time.js';

// A non-terminal session whose last activity is older than this is considered
// "stale" — a worker that died without emitting a terminal marker would otherwise
// sit in the Active feed forever (Bug 3, LIN-608). Derived only: the stored record
// is never mutated, so a later heartbeat (which advances lastActivity) un-stales it.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h ("after a day")

// Max workspace histories reconstructed concurrently in the cross-workspace
// fan-out. The old unbounded `Promise.allSettled` over every connected workspace
// made peak memory = the SUM of every workspace's full 30-day Loop graph
// materialised at once — the second amplifier behind the Observation memory
// spike (LIN-622). Capping it keeps peak at ~this many workspaces, not all.
export const WORKSPACE_FANOUT_CONCURRENCY = 2;

/**
 * Run `mapper` over `items` with at most `limit` in flight, returning
 * `Promise.allSettled`-shaped results so a single workspace's failure is
 * isolated to its own slot (same degradation contract the feed already relies
 * on). Bounds the fan-out's peak memory (LIN-622).
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<any>} mapper
 * @returns {Promise<Array<{status:'fulfilled',value:any}|{status:'rejected',reason:any}>>}
 */
export async function settleWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const runNext = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await mapper(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runNext);
  await Promise.all(workers);
  return results;
}

/**
 * Is this a STANDALONE session — a single user-dispatched cli/web prompt that
 * `_buildSessions` pass 3 synthesized into its own single-loop session (LIN-1194)?
 *
 * This is the DERIVED read-time discriminator that keeps the two Observation tabs
 * apart WITHOUT changing the shared session builder (cross-cutting concern #1 in
 * the plan): the Autopilot feed filters standalone sessions OUT (so extending the
 * builder cannot leak them into the existing feed on a live-fallback read), and the
 * Sessions feed keeps them. A session is standalone iff it has NO autopilot anchor
 * AND none of its loops carries an explicit `sessionId` — the latter clause keeps
 * orphan explicit-`sessionId` worker groups (an aged-out orchestrator, `_buildSessions`
 * pass 2) on the Autopilot side, since those ARE autopilot-shaped. Pure; exported for
 * unit tests.
 *
 * @param {Object} session - a reconstructed session (getSessionsForWorkspace shape)
 * @returns {boolean}
 */
export function isStandaloneSession(session) {
  if (findAnchorLoop(session)) return false;                 // autopilot-anchored
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  if (loops.length === 0) return false;
  return !loops.some(l => l && l.sessionId);                 // no explicit-sessionId group
}

/**
 * The observation session status string — the single contract consumed by the
 * client's icon/label maps and CSS (`public/observation.js` / `observation.css`).
 *
 * Six values: `stale`, `in-progress`, `waiting`, `error`, `done`, and
 * `done-with-warning`. `waiting` (LIN-1005) is the session-level "this session
 * needs you" rollup — a non-terminal session paused on a human (an agent-status
 * `blocked` run and/or a latest `[blocked]` feedback marker). It is
 * deliberately NON-terminal: `[blocked]` stays a pause/wait signal, never a
 * terminal state, so a genuinely finished session is never shown as waiting.
 * `done-with-warning` (LIN-749) is the done/error split's 5th outcome: a terminal
 * session that had at least one errored run but whose touched task is now Done —
 * the autopilot finished the task despite the errors (the LIN-744 case).
 *
 * `taskDone` is the ONLY task-state input. It is NOT proof the task flipped
 * *during* this run (no start-state baseline is recorded; that precise per-run
 * attribution is a tracked cross-repo follow-up) — it approximates "done now ∧
 * ≥1 run errored". It is sourced solely from the existing Linear hydration seam
 * at the terminal boundary, never from the per-poll feed, which honours an
 * explicit no-Linear cost contract and always passes `taskDone=false`. `stale`
 * only ever holds for non-terminal sessions, so its branch is checked first to
 * keep the pre-existing outcomes byte-identical; `waiting` is a non-terminal
 * refinement checked AFTER terminal outcomes (a session that actually finished
 * wins over any lingering wait signal) and defaults false so existing call sites
 * that omit it stay byte-identical.
 *
 * Pure; exported for unit tests.
 *
 * @param {{terminal: boolean, stale: boolean, hasError: boolean, waiting?: boolean, taskDone?: boolean}} input
 * @returns {'stale'|'in-progress'|'waiting'|'error'|'done'|'done-with-warning'}
 */
export function deriveSessionStatus({ terminal, stale, hasError, waiting = false, taskDone = false }) {
  if (stale) return 'stale';
  if (terminal) return hasError ? (taskDone ? 'done-with-warning' : 'error') : 'done';
  if (waiting) return 'waiting';
  return 'in-progress';
}

/**
 * Is a single ENRICHED loop (effectiveAgentState applied) waiting on a human?
 *
 * Two independent runner channels, unioned (LIN-1005 — neither subsumes the
 * other): (a) an agent-status `blocked` entry surfaces as `agentState==='waiting'`
 * (lib/pipeline-loops.js `_deriveAgentState`), and (b) a `[blocked]`
 * *feedback* marker (`WAITING_WAKE_MARKERS`, lib/dispatch-terminal.js; `[pending]`
 * is not a wait, LIN-1025), pre-derived at build time as `wakeMarker` so this read is
 * lean-safe (never touches raw `feedback[]`, which the feed drops). Terminal wins:
 * a run that actually finished (a terminal feedback marker folded in by
 * `effectiveAgentState`, or a native complete/error) is never waiting.
 *
 * @param {Object} loop - enriched loop (post-`enrichLoop`)
 * @returns {boolean}
 */
function loopIsWaiting(loop) {
  if (!loop || isTerminalLoop(loop)) return false;
  if (loop.agentState === 'waiting') return true;
  // Prefer the build-time `wakeMarker` (present on every reconstructed loop, lean
  // or not); fall back to scanning raw feedback for loops built elsewhere.
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return isWaitingWakeMarker(marker);
}

/**
 * Roll a session's ENRICHED loops up to a session-level waiting signal (LIN-1005):
 * `{ waiting, message }`. `waiting` is true when a chain TAIL loop is waiting on a
 * human; `message` is the first available waiting (`[blocked]`) text (falling back to
 * the waiting run's agent summary) so the UI can show the actual message rather
 * than a manufactured taxonomy. Pure; the single truth shared by the feed payload
 * and the session-page banner so they can never disagree.
 *
 * LIN-1341 (RC2, block-then-replied): a loop that has since been followed up on
 * WITHIN THIS SESSION is superseded by its follower and excluded from the
 * rollup — otherwise a reply that resolves a `[blocked]` loop would leave the
 * session waiting forever, since feedback is append-only per loop and the
 * original loop's last marker never changes. A loop nothing in the session
 * resumes (the common case, and every chain's tail) still counts, so an
 * ordinary standalone block is unaffected; a session with several independent
 * chains/workers evaluates each chain's own tail.
 *
 * Exported for unit tests (LIN-1478) — the supersede characterization/agreement
 * test asserts this against `lib/render-session.js`'s per-run mirror directly.
 *
 * @param {Array<Object>} enrichedLoops - loops already run through `enrichLoop`
 * @returns {{
 *   waiting: boolean,
 *   message: string|null,
 *   producerLoopId: string|null,
 *   decision: Object|null,
 *   decisionCase: Array
 * }} `message`/`producerLoopId`/`decision`/`decisionCase` all come from the
 *   SAME loop — the first non-superseded, waiting loop whose
 *   `waitingMessage || agentSummary` is truthy (one producer, always). If
 *   `waiting` is true but no waiting loop has message text, all four stay
 *   null/empty — a provenance pointer is meaningless without a message to
 *   attach it to, so a message-less loop's decision is never surfaced this way.
 */
export function deriveSessionWaiting(enrichedLoops) {
  const supersededLoopIds = computeSupersededLoopIds(enrichedLoops);
  let waiting = false;
  let message = null;
  let producerLoopId = null;
  let decision = null;
  let decisionCase = [];
  let foundProducer = false;
  for (const l of enrichedLoops) {
    if (!l || supersededLoopIds.has(l.loopId)) continue;
    if (!loopIsWaiting(l)) continue;
    waiting = true;
    if (foundProducer) continue;
    const text = l.waitingMessage || l.agentSummary || null;
    if (!text) continue;
    foundProducer = true;
    message = text;
    producerLoopId = l.loopId;
    decision = l.decision || null;
    decisionCase = Array.isArray(l.decisionCase) ? l.decisionCase : [];
  }
  return { waiting, message, producerLoopId, decision, decisionCase };
}

/**
 * The run page's pinned-question-card read (LIN-3252 S2): every UNANSWERED,
 * session-scoped decision, whether or not the session is `waiting` — including
 * after it has finished. This is what lifts the LIN-2184 waiting-only render
 * gate: the predicate here never consults `waiting`, so a completion-path
 * decision (or one on a finished session) still reaches the card.
 *
 * Scope is session MEMBERSHIP — the caller hands this the session's own enriched
 * loops, so there is no workspace-wide filter and no operator shelf is passed
 * (`shelvedRulings: []`): an operator's shelve must never hide the person's
 * card. Scan-sourced task-bound rulings have no loop and stay out
 * (`taskDecisions: []`). `collectUnansweredDecisions` remains the single
 * unanswered-decision predicate, so an answered/dismissed decision is already
 * subtracted and never reappears.
 *
 * Pure; exported for unit tests (mirrors `deriveSessionWaiting` above).
 *
 * LIN-3252 G2: injects the SAME `liveDispatchOnAnchor` predicate (`liveOnAnchor`
 * below) the dashboard rulings feed and `routes/proxy-rulings.js` use — a live run already
 * on the anchor means `resolveEffect` branch 3, so a `gone` row answers
 * `record`, never a second run racing the live one.
 *
 * LIN-3260: the predicate scans the `liveLoops` opt when supplied — the
 * workspace-wide loop set the route reads from the warm `sessionsFeedCache`
 * `rulings` entry — so a live run on the same issue in ANOTHER session is seen.
 * Absent `liveLoops`, it scans the session's OWN loops (the prior behaviour,
 * and the route's cold-cache fallback).
 *
 * @param {Array<Object>} enrichedLoops - loops already run through `enrichLoop`
 * @param {{now?: Date, liveLoops?: Array<Object>}} [opts] - `liveLoops`: the
 *   loop set the liveness predicate scans (defaults to `enrichedLoops`)
 * @returns {Array<Object>} `collectUnansweredDecisions` rows
 */
export function deriveSessionDecisions(enrichedLoops, { now, liveLoops } = {}) {
  const loops = Array.isArray(enrichedLoops) ? enrichedLoops : [];
  // The rows still come from the session's own loops (session membership); only
  // the liveness predicate widens to the workspace set when one is supplied.
  const livenessScope = Array.isArray(liveLoops) ? liveLoops : loops;
  return collectUnansweredDecisions(
    {
      loops,
      taskDecisions: [],
      shelvedRulings: [],
      newestScanByTask: {}
    },
    {
      now: now instanceof Date ? now : new Date(),
      liveDispatchOnAnchor: liveOnAnchor(livenessScope)
    }
  );
}

/**
 * The ONE "is there a live run on this anchor issue" predicate (LIN-2773 Area 4):
 * the rulings feed and the run page's pinned question card both hand it to
 * `collectUnansweredDecisions` as `liveDispatchOnAnchor`, over the loop set each
 * one holds. No `agentState === 'running'` conjunct, because that would miss
 * `queued` (created, not yet claimed) and `waiting` (parked `blocked` on that
 * very anchor), both of which are live runs on the anchor.
 *
 * LIN-2934 (S4): a null-anchored ruling (`issueIdentifier` itself null — e.g. an
 * identifier-less general-autopilot anchor row, now retained by `_buildLoops`)
 * must never read as "live" just because some UNRELATED general run elsewhere in
 * the set also carries a null identifier. Guard on `issueIdentifier != null`
 * before the scan, so `null === null` can never fire this predicate true.
 *
 * @param {Array<Object>} loops - enriched loops (post-`enrichLoop`)
 * @returns {(issueIdentifier: string|null) => boolean}
 */
export function liveOnAnchor(loops) {
  return (issueIdentifier) =>
    issueIdentifier != null &&
    loops.some(l => l.issueIdentifier === issueIdentifier && !isTerminalLoop(l));
}

/**
 * Most-relevant activity timestamp for a run, used to sort the merged feed.
 * Prefers the truthful completion time (terminal feedback marker) so a run that
 * just finished sorts above an older still-running one.
 *
 * LIN-1477: also takes the lineage heartbeat (`loop.lineageLastActivityMs`,
 * emitted by `lib/pipeline-loops.js`) into account, so a loop whose lineage has
 * since beaten on a follow-up run reads as recently active even though ITS OWN
 * timestamps predate that beat — the max of the two, never a replacement. This
 * is the only lineage input into the activity clock; identity/terminal
 * derivation elsewhere are untouched.
 * @param {Object} loop
 * @returns {number} epoch ms (0 when unknown)
 */
export function loopActivityMs(loop) {
  const t = loop.completedAt || loop.agentTimestamp || loop.resolvedAt || loop.dispatchedAt;
  const ownMs = toEpochMs(t) ?? 0;
  const lineageMs = Number.isFinite(loop.lineageLastActivityMs) ? loop.lineageLastActivityMs : 0;
  const ms = Math.max(ownMs, lineageMs);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Peak tool-activity figure across a run's heartbeats — the single number the
 * feed's metric chip renders. Pre-computing it lets the feed ship only the
 * recent metrics tail instead of every heartbeat (an unbounded list on a long
 * run), which was pure per-poll waste (LIN-608 memory follow-up).
 * @param {Array<Object>} metrics
 * @returns {number|null}
 */
export function peakToolCount(metrics) {
  if (!Array.isArray(metrics)) return null;
  let best = null;
  for (const m of metrics) {
    const v = m && m.total != null ? m.total : (m ? m.toolCount : null);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * Deterministic, cache-free live status line for a session's feed payload: the
 * most-recently-active child's own agent summary (capped). This is the SAME
 * fallback `liveStatusLine` derives, lifted onto the feed so a RUNNING session's
 * status needs no extra per-poll workspace scan — the client renders
 * `s.statusLine` directly instead of polling /session-summary every 5s. That
 * per-poll re-scan (its gate churns on every heartbeat), multiplied by every
 * active session, was the out-of-memory crash (LIN-608 memory follow-up).
 * @param {Array<Object>} children - enriched child loops
 * @returns {string}
 */
export function deriveFeedStatusLine(children) {
  if (!Array.isArray(children) || !children.length) return '';
  let best = null;
  let bestMs = -Infinity;
  for (const c of children) {
    const ms = loopActivityMs(c);
    if (ms >= bestMs) { bestMs = ms; best = c; }
  }
  const text = best && best.agentSummary ? String(best.agentSummary) : '';
  return text.slice(0, 200);
}

/**
 * The connected workspaces of a cookie session as the feeds tag them
 * (`{ urlKey, name }`). Every Observation read here is scoped to
 * `req.session.workspaces` and never fleet-wide (LIN-1728 plan constraint).
 * @param {{workspaces?: Array<{urlKey: string, name?: string}>}} session
 * @returns {Array<{urlKey: string, name: string|undefined}>}
 */
export function connectedWorkspaces(session) {
  return (session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));
}
