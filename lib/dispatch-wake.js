/**
 * lib/dispatch-wake.js
 *
 * Up-chain wake auto-enqueue (LIN-826) — the pure core of push-based
 * inter-session communication.
 *
 * When a *subscribed* child dispatch reaches a terminal/stopping point (a wake
 * event in its feedback — incl. a `[pending]` *pause*, LIN-843), its dispatching
 * parent should be WOKEN with a follow-up carrying that outcome — instead of the
 * parent polling for it. This module turns a child dispatch + its feedback into
 * the parent-addressed wake follow-up descriptor (or null when no wake is owed).
 * It is a PURE function; the single effect (set the once-only flag, enqueue)
 * lives at the `addFeedback` seam in lib/dispatch-store.js.
 *
 * The loop guard is structural, not a counter, and rests on ONE arm: a wake
 * follow-up is itself a dispatch addressed to the parent, and it is emitted with
 * `subscribe: false`, so when IT later terminates `buildWakeFollowUp` returns
 * null at the very first check — a wake can never beget a wake. (It also carries
 * `followUpTo`, but that is no longer load-bearing for the loop guard: a
 * *subscribed* follow-up is now allowed to wake, because the stepper's warm-resume
 * beats — `followUpTo: ROOT` + `subscribe: true` — are exactly how the push rails
 * reach a stepper orchestrator on every beat boundary, LIN-843/LIN-841.) The
 * durable `wakeEnqueued` flag (owned by the store) is the orthogonal once-only
 * guard against repeated feedback on the SAME child.
 */
import { findWakeEvent } from './dispatch-terminal.js';

/**
 * Build the one-line factual outcome summary the parent receives. Harbour
 * already holds the child's identifier/title/step + the wake feedback entry, so
 * the wake follow-up carries the same text the dashboard would show — no new
 * lookup. Kept deliberately minimal/factual; the autopilot's interpretation of
 * "done means go look" is prompt-side (Phase 2), not baked in here.
 *
 * A `[pending]` wake (LIN-843) is labelled distinctly — "paused (pending), not
 * done" — so a parent can never misread the pause for a completion. PENDING is a
 * WAKE event but NOT a terminal/completion one (the LIN-826 split), and the wake
 * text is the only channel the parent reads, so the label must say so here.
 *
 * @param {Object} child - the child dispatch doc/item
 * @param {{entry: object, marker: string}} wake - findWakeEvent result
 * @returns {string}
 */
function formatWakePrompt(child, wake) {
  const identifier = child.issueIdentifier || child.issueId || 'a subscribed task';
  const title = child.issueTitle ? `: ${child.issueTitle}` : '';
  const step = child.promptName ? ` (${child.promptName})` : '';
  const outcome = (wake.entry?.message || `[${wake.marker}]`).trim();
  const paused = wake.marker === 'pending';

  const lines = [
    paused
      ? `A subscribed child session reached a pause boundary — paused (pending), not done. Resume your cross-check / advance the next beat.`
      : `A subscribed child session reached a terminal outcome — resume your cross-check.`,
    ``,
    `Child: ${identifier}${title}${step}`,
    `Outcome: ${outcome}`
  ];
  if (child.issueUrl) lines.push(`Link: ${child.issueUrl}`);
  return lines.join('\n');
}

/**
 * Build the parent-addressed wake follow-up descriptor for a child dispatch, or
 * null when no wake is owed. PURE — no I/O, no mutation of the input.
 *
 * Returns a descriptor ONLY when every condition holds:
 *  - child.subscribe === true       — the edge was declared at dispatch time.
 *                                     This is ALSO the sole loop guard: a wake
 *                                     follow-up is subscribe:false, so it is
 *                                     rejected here and can never beget a wake.
 *  - child.sessionId present        — the edge target (the dispatching parent)
 *  - child.id !== child.sessionId    — skip self: the run owner's own dispatch
 *                                     stamps sessionId === its own id
 *  - child.kind !== 'autopilot'      — skip autopilot-generated items
 *  - findWakeEvent(feedback) truthy  — there is actually a wake event (terminal
 *                                     OR a `[pending]` pause, LIN-843)
 *
 * Note there is deliberately NO `!child.followUpTo` guard (LIN-843): a SUBSCRIBED
 * follow-up MUST be able to wake, because that is exactly the stepper's warm-resume
 * beat shape — `followUpTo: ROOT` + `subscribe: true` — and the push rails have to
 * reach the orchestrator on every beat boundary, not just the first fresh beat
 * (LIN-841). The loop guard does not need it: a wake follow-up is subscribe:false,
 * so the subscribe arm above already excludes it. A non-subscribed follow-up (a
 * plain liveness nudge) is likewise excluded by that same arm.
 *
 * The returned descriptor is itself NOT subscribed (`subscribe: false`) and is
 * `queueIfBusy: true` so it waits rather than fails if the parent is mid-judgment
 * (the LIN-827 runner path).
 *
 * @param {Object} child - the child dispatch doc/item (accepts `id` or `_id`)
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{followUpTo: string, prompt: string, queueIfBusy: boolean, sessionId: string, subscribe: boolean, kind: string}|null}
 */
export function buildWakeFollowUp(child, feedback) {
  if (!child) return null;
  if (child.subscribe !== true) return null;

  const sessionId = child.sessionId;
  if (!sessionId) return null;

  // NOTE: there is intentionally no `if (child.followUpTo) return null` here
  // (LIN-843). A subscribed follow-up is the stepper's warm-resume beat
  // (`followUpTo: ROOT` + `subscribe: true`), and it MUST wake the orchestrator so
  // beat boundaries advance on the push instead of a hand-rolled long-poll
  // (LIN-841). The loop guard does not rely on this arm — the `subscribe !== true`
  // check above already rejects every wake follow-up (they are subscribe:false).

  // Skip self: the run owner's own dispatch carries sessionId === its own id, so
  // it must not wake itself.
  const childId = child.id ?? child._id;
  if (childId && childId === sessionId) return null;

  // Skip autopilot-generated items — the orchestrator is the subscriber, not a
  // subscribed child.
  if (child.kind === 'autopilot') return null;

  const wake = findWakeEvent(feedback);
  if (!wake) return null;

  return {
    followUpTo: sessionId,
    prompt: formatWakePrompt(child, wake),
    queueIfBusy: true,
    sessionId,
    subscribe: false,
    kind: 'wake'
  };
}

export const __internal = { formatWakePrompt };
