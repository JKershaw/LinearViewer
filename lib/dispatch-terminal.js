/**
 * lib/dispatch-terminal.js
 *
 * Terminal-marker detection for dispatch runs (shared seam).
 *
 * The dispatch runner posts completion as a free-form feedback entry prefixed
 * with a marker — e.g. "[done] Task completed in 45s" / "[failed] remote-control
 * never connected" — while the queue's lifecycle status stays 'taken'. Reading
 * that marker is the ONLY reliable signal that a taken dispatch actually
 * finished (a still-running worker and a finished-but-not-agent-reported
 * worker both look like 'taken' otherwise). See LIN-400.
 *
 * This was first solved inside the proxy watch/list endpoints (routes/proxy.js);
 * it now lives here so the dashboard's Loop feed (LIN-509) derives the same
 * terminal truth from the same regex instead of growing a divergent copy.
 * Derivation is read-only — the stored lifecycle status is never mutated.
 */

// `[skipped]` (LIN-946/LIN-951) is a terminal-BENIGN outcome: when a cascade
// abort hits a human-continued session the runner refuses the cancel and posts
// "[skipped] human-continued session <id> (<phase>)." instead of "[aborted]". It
// is terminal (the abort item is resolved — never retry it) but benign and its
// own distinct status: NOT 'aborted' (the session wasn't closed — a human is in
// it) and NOT 'failed'. It is deliberately absent from WAKE_FEEDBACK_REGEX below
// (a skip means nothing ended up-chain, so it must not wake a parent).
const TERMINAL_FEEDBACK_REGEX = /^\s*\[(done|complete|failed|aborted|skipped)\]/i;
const TERMINAL_MARKER_TO_STATUS = { done: 'done', complete: 'done', failed: 'failed', aborted: 'aborted', skipped: 'skipped' };

/**
 * Wake events (LIN-826/LIN-843) — the markers that, when a *subscribed* child
 * reaches them, wake its parent with a follow-up. This is a deliberate SUPERSET
 * of the terminal markers: it additionally counts `[blocked]` (a blocked child
 * must wake its parent so it can react — not only a clean done) and `[pending]`
 * (LIN-843: a child that has *paused* at a holdable boundary — e.g. a stepper
 * beat reporting "my part's done, the task isn't" — must wake its parent so the
 * orchestrator can advance the next beat rather than long-poll for the boundary).
 *
 * It is kept SEPARATE from TERMINAL_FEEDBACK_REGEX on purpose. The terminal
 * regex feeds completion-time, session-telemetry, KPI accounting, and the
 * dashboard Loop feed, where counting `[blocked]`/`[pending]` as a *completion*
 * would corrupt those semantics — `[pending]` in particular is explicitly a
 * pause, NOT a finish (LIN-843). The split keeps the blast radius of the
 * `[blocked]`/`[pending]` recognition at zero on existing consumers — this
 * predicate is consumed ONLY by the up-chain wake auto-enqueue. Both are
 * forward-compatible: each only bites once the runner actually emits that marker
 * (the SD `[pending]` marker is the LIN-842 half).
 *
 * The two sets are NO LONGER a strict superset: `[skipped]` (LIN-946/LIN-951) is
 * terminal but deliberately NOT a wake event. A `[skipped]` means the runner
 * refused a cascade abort because a human is still in that session — nothing
 * ended, so waking the parent would be wrong. Do NOT add `skipped` here.
 */
const WAKE_FEEDBACK_REGEX = /^\s*\[(done|complete|failed|aborted|blocked|pending)\]/i;

/**
 * LIN-2123 / LIN-2268: the marker a resumed session's feedback actually
 * carries back to the ORIGINAL (anchor) row in production.
 *
 * LIN-2123's fix keyed on `dispatcher.js`'s OWN router-level post —
 * `[working] Resumed session <id> (window: ...)`, posted immediately after a
 * successful relaunch (`dispatcher.js:~821`). LIN-2268 found that post is a
 * production no-op for THIS purpose: it is posted with `feedback(item.id, ...)`
 * and no `rootItemId`, so `mergeLineageFeedback`'s
 * `entry.rootItemId === anchor` filter drops it — it never joins the
 * anchor row's merged feedback and `deriveLifecycleStatus` below never sees it.
 *
 * The marker that DOES reach the anchor row is `hook.js`'s own Stop-hook
 * status, posted once the resumed session's bootstrap turn ends and the
 * RESUMING phase's `block` action fires (`hook.js:~826` / `hook.js:~837`,
 * both prefixed `[working] Session resumed.`). That post goes through
 * `hook.js`'s single feedback choke point (`feedback()`, `hook.js:~87`),
 * which unconditionally threads `rootItemId = session.rootItemId ||
 * session.itemMetadata?.itemId` — the SAME stable anchor every other
 * hook-originated post (terminal markers included) already relies on. So
 * this marker reaches the anchor row for free, with no Simple Dispatcher
 * change required.
 *
 * Matched on the shared `[working] Session resumed.` prefix rather than
 * pinning the full sentence: it's how BOTH `hook.js` cases word it (the
 * ordinary follow-up handshake, "...Executing follow-up...", and the
 * stall-failsafe refire's re-ask, "...Re-confirming completion state...").
 * The refire case only ever fires on a session that reached EXECUTING/
 * AWAITING_EXTERNAL — never BLOCKED (the stall failsafe deliberately
 * excludes it, see reapers.js) — so matching it here too is harmless: a
 * session that was never `blocked` has nothing for this marker to clear.
 *
 * Distinct from an ordinary `[working]` heartbeat, which carries no such
 * text and must NOT clear a derived `blocked` (the ticket's own pinned
 * case: `[blocked]` then plain `[working]` heartbeats stays `blocked`).
 *
 * Deliberately kept OUT of `WAKE_FEEDBACK_REGEX`: that regex also drives
 * `lib/dispatch-wake.js`'s up-chain auto-enqueue (a *subscribed* child
 * reaching a wake event dispatches a follow-up to its parent) — folding a
 * resume marker into it would auto-enqueue a follow-up on every in-place
 * resume, an unrelated and unwanted behavior change. This marker is consumed
 * ONLY by `deriveLifecycleStatus`, mirroring the file's existing
 * TERMINAL/WAKE split for the identical blast-radius reason (see that
 * regex's own docstring above).
 */
const RESUME_MARKER_REGEX = /^\s*\[working\]\s*Session resumed\./i;

/**
 * Scan feedback entries for a terminal marker and return the LAST one found
 * (the runner posts the terminal event last) as {entry, status}, or null.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{entry: object, status: ('done'|'failed'|'aborted'|'skipped')}|null}
 */
export function findTerminalFeedback(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const match = TERMINAL_FEEDBACK_REGEX.exec(feedback[i]?.message || '');
    if (match) {
      return { entry: feedback[i], status: TERMINAL_MARKER_TO_STATUS[match[1].toLowerCase()] };
    }
  }
  return null;
}

/**
 * The terminal status derived from the feedback markers, or null if none.
 *
 * @param {Array<{message?: string}>} feedback
 * @returns {('done'|'failed'|'aborted'|'skipped')|null}
 */
export function deriveTerminalStatus(feedback) {
  return findTerminalFeedback(feedback)?.status || null;
}

/**
 * The row's read-time LIFECYCLE status: the terminal status when one exists,
 * else `'blocked'` when the last wake event is `[blocked]`, else null (LIN-2079).
 *
 * A `[blocked]` runner is ALIVE and parked on a human — it is neither a live
 * run nor a tombstone, but with no terminal marker it fell back to the stored
 * `taken` and was indistinguishable from both. Deriving it here (rather than
 * widening TERMINAL_FEEDBACK_REGEX, which would corrupt completion-time /
 * telemetry / KPI / Loop semantics — see the header comment above) keeps the
 * blast radius at the call sites that opt in.
 *
 * ORDERING IS LOAD-BEARING: the terminal check runs FIRST and short-circuits,
 * so a later genuine terminal always wins over an earlier `[blocked]` and
 * `completedAt` (derived separately, from the terminal scan) can never rewind.
 * Do NOT refactor this to consult the wake event first.
 *
 * `[pending]` deliberately falls through to null — it is a PAUSE, already
 * bounded by the consumer's own AWAITING_EXTERNAL -> FAILED failsafe, and
 * mapping it here would give a paused row a resting state it has not earned.
 *
 * NOT terminal: a row reporting `blocked` is still being worked (by a human),
 * so every terminal-gated caller — the watch endpoint's `alreadyTerminal`
 * short-circuit, its long-poll baseline and comparator — must keep calling
 * `deriveTerminalStatus`, never this.
 *
 * LIN-2123: a session unblocked and resumed posts no wake event at all
 * (`[working]` heartbeats are not wake events — see WAKE_FEEDBACK_REGEX's
 * docstring), so the last wake event stays the earlier `[blocked]` forever
 * while the session runs. Fixed by scanning for BOTH the last wake event and
 * `RESUME_MARKER_REGEX` together, backward, in one pass: whichever occurs
 * LATER in the array wins (array position only — no timestamp comparison, no
 * "any later activity" heuristic; a plain `[working]` heartbeat still does
 * not count, exactly as the ticket requires). This keeps the derivation
 * marker-pure — it is a new, more specific marker recognized in a NEW place,
 * not a widening of what counts as "later activity".
 *
 * LIN-2268: LIN-2123's original `RESUME_MARKER_REGEX` matched a marker that
 * never actually reaches this function's input in production — see that
 * regex's own docstring above for the corrected story (the marker now
 * matched is `hook.js`'s, posted through its rootItemId-threading choke
 * point, not `dispatcher.js`'s own rootItemId-less direct post).
 *
 * @param {Array<{message?: string}>} feedback
 * @returns {('done'|'failed'|'aborted'|'skipped'|'blocked')|null}
 */
export function deriveLifecycleStatus(feedback) {
  const terminal = deriveTerminalStatus(feedback);
  if (terminal) return terminal;
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const message = feedback[i]?.message || '';
    if (RESUME_MARKER_REGEX.test(message)) return null;
    const match = WAKE_FEEDBACK_REGEX.exec(message);
    if (match) return match[1].toLowerCase() === 'blocked' ? 'blocked' : null;
  }
  return null;
}

/**
 * The truthful task-completion time: the timestamp of the terminal feedback
 * entry, or null until that marker exists. Distinct from `resolvedAt`, which
 * marks take/archive time (lands seconds after enqueue regardless of how long
 * the work runs) and must not be read as completion (LIN-400).
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {string|null}
 */
export function deriveCompletedAt(feedback) {
  return findTerminalFeedback(feedback)?.entry?.timestamp || null;
}

/**
 * Harvest each abort row's own `[aborted]` terminal entry into a map keyed by the
 * dispatch id it TARGETS (`abortTo`) — the shared harvest half of the LIN-1257
 * abort terminal-attribution rule (LIN-1261 F1/F2).
 *
 * Simple Dispatcher posts the terminal `[aborted]` marker to the abort item's OWN
 * dispatch row, never to the `abortTo` target's stored feedback. This builds the
 * `abortTo → aborted-entry` map both consumers need — pipeline reconstruction
 * (`_buildLoops`) and the proxy read boundary (`routes/proxy.js`) — so the rule
 * has ONE definition rather than a divergent copy per consumer. Only a genuine
 * `[aborted]` status is harvested: a `[skipped]` (human-continued session; the
 * runner refused the cancel) is deliberately excluded, since nothing ended there.
 * Pure; never mutates the inputs.
 *
 * @param {Array<{abort?: boolean, abortTo?: string, feedback?: Array}>} items
 * @returns {Map<string, object>} abortTo → the harvested `[aborted]` feedback entry
 */
export function harvestAbortedTargets(items) {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (!item || item.abort !== true || !item.abortTo) continue;
    const terminal = findTerminalFeedback(Array.isArray(item.feedback) ? item.feedback : []);
    if (terminal && terminal.status === 'aborted') {
      map.set(item.abortTo, terminal.entry);
    }
  }
  return map;
}

/**
 * The feedback array to DERIVE a target's terminal facts from once an abort has
 * been harvested for it — the shared guard half of the LIN-1257 rule (LIN-1261
 * F1/F2). Non-mutating: returns a NEW array with the abort entry appended last
 * (so the position-based, last-in-array-wins `findTerminalFeedback` reports the
 * target `aborted`), or the original array unchanged.
 *
 * F1 guard — never let an EARLIER abort override a LATER genuine terminal or
 * rewind `completedAt`: if the target already ends with its own genuine terminal
 * marker (`[done]@12:00`) and the harvested abort is earlier (`@11:30`), a blind
 * append would relabel a finished target `aborted` and move its completion time
 * backward. So only append when the abort is STRICTLY later than any pre-existing
 * terminal; when ordering can't be established (a missing/unparseable timestamp on
 * either side) keep the pre-existing terminal, never rewinding on unknown order.
 * The guard lives here as an append-or-not decision ABOVE `findTerminalFeedback`,
 * so that function's scan semantics (relied on broadly) are untouched.
 *
 * @param {Array} feedback  the target row's own stored feedback (not mutated)
 * @param {{timestamp?: string}|null|undefined} abortEntry  harvested `[aborted]` entry, or falsy when none
 * @returns {Array}  feedback to derive from (the SAME ref when nothing is appended)
 */
export function feedbackWithHarvestedAbort(feedback, abortEntry) {
  const base = Array.isArray(feedback) ? feedback : [];
  if (!abortEntry) return base;
  const existing = findTerminalFeedback(base);
  if (existing) {
    const existingMs = Date.parse(existing.entry?.timestamp);
    const abortMs = Date.parse(abortEntry.timestamp);
    // Only let the abort win if it is strictly LATER than the existing terminal.
    // NaN (missing/unparseable) fails every comparison → fall through to `return
    // base`, keeping the pre-existing terminal rather than rewinding on unknown order.
    if (!(Number.isFinite(existingMs) && Number.isFinite(abortMs) && abortMs > existingMs)) {
      return base;
    }
  }
  return [...base, abortEntry];
}

// Formerly duplicated in lib/dispatch-store.js as `feedbackTimestampMs`
// (LIN-1470); that copy was removed by LIN-1480 once `_collectGroupFeedback`
// started calling `mergeLineageFeedback` directly, so this is now the single
// definition. LIN-1465's separate concern — an explicit `.sort({_id: 1})`
// tiebreak — is untouched and still stands.
function lineageFeedbackTimestampMs(timestamp) {
  return timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
}

/**
 * Merge a row's own feedback with its lineage siblings' feedback into one
 * timestamp-ordered array (LIN-1470) — the read-side counterpart of
 * `lib/dispatch-store.js`'s `_collectGroupFeedback`, for the list endpoint's
 * always-on join (no extra opt-in query param; see routes/proxy.js).
 *
 * `ownFeedback` is trusted unconditionally (it is this row's own stored
 * data). Each `siblingRows` entry's `feedback` is entry-level filtered to
 * `f.rootItemId === anchor` — a sibling must not contribute feedback it
 * cannot verify belongs to this exact lineage (mirrors the "must not absorb
 * feedback it can't verify" rule at `lib/dispatch-store.js:447-450`). Pure;
 * never mutates `ownFeedback` or `siblingRows`.
 *
 * FORWARD-ONLY INVARIANT (LIN-1470 review F7): a row is never reported
 * complete before it was itself dispatched. A status-based allowlist
 * (`joinsLineage`/F1) closes WHICH ROWS may join a lineage, but says nothing
 * about WHICH FEEDBACK a joined row may inherit — a still-running (`taken`)
 * follow-up dispatched after its parent already finished was joining the
 * lineage and absorbing the parent's earlier terminal, reporting a
 * `completedAt` that predates its own `dispatchedAt`. `since` (the row's own
 * `dispatchedAt`) makes that structural rather than another status carve-out:
 * a sibling entry is only inherited if its timestamp is at or after `since`.
 * Both `since` and the entry's timestamp must be verifiable — either being
 * unparseable excludes the entry, failing closed (same posture as the "must
 * not absorb feedback it can't verify" rule above). The ticket's headline
 * case (an EARLIER original inheriting a LATER follow-up's completion) still
 * holds: the original's own `dispatchedAt` necessarily precedes the
 * follow-up's completion, so the comparison passes trivially.
 *
 * @param {Array<{message?: string, timestamp?: string, rootItemId?: string}>} ownFeedback
 * @param {Array<{feedback?: Array}>} siblingRows  other rows sharing `anchor`, own row excluded by the caller
 * @param {string} anchor  the lineage anchor siblings' entries must carry to be included
 * @param {string|Date} since  this row's own `dispatchedAt` — a sibling entry is
 *   inherited only if its timestamp is at or after this
 * @returns {Array}  own feedback + verified, forward-only sibling feedback,
 *   timestamp-ascending (NaN-safe: entries with a missing/unparseable timestamp
 *   sort last, ties broken by Array#sort's guaranteed stability — own feedback
 *   first, then each sibling's own entries in query order)
 */
export function mergeLineageFeedback(ownFeedback, siblingRows, anchor, since) {
  const own = Array.isArray(ownFeedback) ? ownFeedback : [];
  const siblings = Array.isArray(siblingRows) ? siblingRows : [];
  const sinceMs = lineageFeedbackTimestampMs(since);
  const siblingFeedback = siblings
    .flatMap(row => (row && Array.isArray(row.feedback)) ? row.feedback : [])
    .filter(entry => entry && entry.rootItemId === anchor)
    .filter(entry => {
      const entryMs = lineageFeedbackTimestampMs(entry?.timestamp);
      return Number.isFinite(sinceMs) && Number.isFinite(entryMs) && entryMs >= sinceMs;
    });

  return [...own, ...siblingFeedback].sort((a, b) => {
    const at = lineageFeedbackTimestampMs(a?.timestamp);
    const bt = lineageFeedbackTimestampMs(b?.timestamp);
    const aValid = !Number.isNaN(at);
    const bValid = !Number.isNaN(bt);
    if (aValid && bValid) return at - bt;
    if (aValid !== bValid) return aValid ? -1 : 1;
    return 0;
  });
}

/**
 * Whether a single feedback message is a wake event (LIN-826/LIN-843) — a
 * `[done]`, `[complete]`, `[failed]`, `[aborted]`, `[blocked]`, or `[pending]`
 * prefix. Pure; the marker must be a leading prefix (a mid-sentence mention does
 * not count), matching the terminal-marker contract.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isWakeEvent(message) {
  return WAKE_FEEDBACK_REGEX.test(message || '');
}

/**
 * Scan feedback entries for a wake marker and return the LAST one found
 * (the runner posts the terminal/wake event last) as {entry, marker}, or null.
 * The wake superset includes `[blocked]` and `[pending]`; unlike
 * findTerminalFeedback there is no status mapping — a wake event is an event, not
 * a completion verdict (a `[pending]` marker is a pause, never a finish).
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{entry: object, marker: string}|null}
 */
export function findWakeEvent(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const match = WAKE_FEEDBACK_REGEX.exec(feedback[i]?.message || '');
    if (match) {
      return { entry: feedback[i], marker: match[1].toLowerCase() };
    }
  }
  return null;
}

export const __internal = { TERMINAL_FEEDBACK_REGEX, TERMINAL_MARKER_TO_STATUS, WAKE_FEEDBACK_REGEX, RESUME_MARKER_REGEX };
