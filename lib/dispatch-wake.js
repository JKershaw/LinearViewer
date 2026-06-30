/**
 * lib/dispatch-wake.js
 *
 * Up-chain wake auto-enqueue (LIN-826) — the pure core of push-based
 * inter-session communication.
 *
 * When a *subscribed* child dispatch reaches a terminal/stopping point (a wake
 * event in its feedback), its dispatching parent should be WOKEN with a
 * follow-up carrying that outcome — instead of the parent polling for it. This
 * module turns a child dispatch + its feedback into the parent-addressed wake
 * follow-up descriptor (or null when no wake is owed). It is a PURE function;
 * the single effect (set the once-only flag, enqueue) lives at the `addFeedback`
 * seam in lib/dispatch-store.js.
 *
 * The loop guard is structural, not a counter: a wake follow-up is itself a
 * dispatch addressed to the parent, and it is emitted with `subscribe: false`
 * (and carries `followUpTo`), so when IT later terminates `buildWakeFollowUp`
 * returns null for it — a wake can never beget a wake. The durable `wakeEnqueued`
 * flag (owned by the store) is the orthogonal once-only guard against repeated or
 * post-terminal feedback on the SAME child.
 */
import { findWakeEvent } from './dispatch-terminal.js';

/**
 * Build the one-line factual outcome summary the parent receives. Harbour
 * already holds the child's identifier/title/step + the wake feedback entry, so
 * the wake follow-up carries the same text the dashboard would show — no new
 * lookup. Kept deliberately minimal/factual; the autopilot's interpretation of
 * "done means go look" is prompt-side (Phase 2), not baked in here.
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

  const lines = [
    `A subscribed child session reached a terminal outcome — resume your cross-check.`,
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
 *  - child.subscribe === true       — the edge was declared at dispatch time
 *  - child.sessionId present        — the edge target (the dispatching parent)
 *  - !child.followUpTo              — a follow-up is not a fresh subscribed child;
 *                                     this is also why a wake (which carries
 *                                     followUpTo) can never re-trigger a wake
 *  - child.id !== child.sessionId    — skip self: the run owner's own dispatch
 *                                     stamps sessionId === its own id
 *  - child.kind !== 'autopilot'      — skip autopilot-generated items
 *  - findWakeEvent(feedback) truthy  — there is actually a terminal wake event
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

  // A follow-up resumes an existing session; it is not a fresh subscribed child.
  // This arm also makes the loop guard total: a wake follow-up carries followUpTo,
  // so it is excluded here even before its subscribe:false is considered.
  if (child.followUpTo) return null;

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
