/**
 * lib/dispatch-wake.js
 *
 * Up-chain wake auto-enqueue (LIN-826 / LIN-900 §5) — the pure core of push-based
 * inter-session communication.
 *
 * When a child dispatch reaches a stopping point (a wake event in its feedback —
 * a terminal `[done]`/`[failed]`/`[aborted]`, a `[blocked]`, or a `[pending]`
 * *pause*, LIN-843), its dispatching parent may be WOKEN with a follow-up carrying
 * that outcome — instead of the parent polling for it. Whether the outcome
 * propagates up the edge is the §5 **bubbling matrix**, a pure function of
 * `(outcome, edge.subscription)`:
 *
 *   - Terminal (`done`/`complete`/`failed`/`aborted`) and `blocked` **always
 *     bubble**, regardless of the edge's declared `subscription` level — a parent
 *     always learns its branch finished (well or badly) or is blocked.
 *   - `pending` (PENDING-external — SD never emits a wake-worthy marker for
 *     PENDING-internal, §4/§8.1) bubbles **only on an `everything` edge**. This is
 *     the one row the subscription level controls.
 *
 * This module turns a child dispatch + its feedback into the parent-addressed wake
 * follow-up descriptor (or null when no wake is owed). It is a PURE function; the
 * single effect (set the once-only flag, enqueue) lives at the `addFeedback` seam
 * in lib/dispatch-store.js.
 *
 * The loop guard is structural, not a counter, and rests on ONE arm: a wake
 * follow-up is itself a dispatch addressed to the parent, emitted with
 * `kind: 'wake'`, so when IT later terminates `buildWakeFollowUp` returns null at
 * the very first check — a wake can never beget a wake. (The old `subscribe:false`
 * self-guard is gone: under §5 terminals always bubble, so the boolean "never
 * bubble" off-state no longer exists to lean on; the guard moved onto the
 * structural `kind` field — LIN-901 trap #1. Miss it and terminals-always-bubble
 * makes wakes recurse.) The durable `terminalWakeEnqueued` flag (owned by the
 * store, on the edge-bearing ROOT dispatch — LIN-1059) is the orthogonal
 * terminal-scoped guard: it caps a child's TERMINAL wake at one, while `[pending]`
 * beats on an `everything` edge may wake on every boundary. It is NOT read here —
 * this function stays pure; the store applies it at the addFeedback seam.
 */
import { findWakeEvent } from './dispatch-terminal.js';

/**
 * Subscription levels (LIN-900 §6). The edge's declared `subscription` enum is the
 * ONE variable the §5 bubbling matrix reads. `everything` = wake on every event
 * incl. PENDING-external (a stepper wants each beat); `terminal-only` = wake only
 * on the always-bubbling outcomes (DONE/FAILED/BLOCKED). Declared once, on the
 * edge, at dispatch time — a dispatcher MUST NOT reconstruct it from incidental
 * fields (e.g. "has a sessionId"). An undeclared edge defaults to
 * `terminal-only`. Single source of truth, imported by every validation/coercion
 * site so they cannot drift.
 */
export const SUBSCRIPTION_LEVELS = ['everything', 'terminal-only'];
export const DEFAULT_SUBSCRIPTION = 'terminal-only';
export function isValidSubscription(v) {
  return SUBSCRIPTION_LEVELS.includes(v);
}

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
  const identifier = child.issueIdentifier || child.issueId || 'a child task';
  const title = child.issueTitle ? `: ${child.issueTitle}` : '';
  const step = child.promptName ? ` (${child.promptName})` : '';
  const outcome = (wake.entry?.message || `[${wake.marker}]`).trim();
  const paused = wake.marker === 'pending';

  const lines = [
    paused
      ? `A child session reached a pause boundary — paused (pending), not done. Resume your cross-check / advance the next beat.`
      : `A child session reached a terminal outcome — resume your cross-check.`,
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
 * The checks, in order:
 *  - child.kind !== 'wake'          — LOOP GUARD (trap #1). A wake follow-up is
 *                                     itself emitted `kind:'wake'`; when it later
 *                                     terminates it must NOT beget another wake.
 *                                     This is the sole structural loop guard now
 *                                     that §5 makes terminals always bubble (the
 *                                     old `subscribe:false` self-guard vanished).
 *  - child.sessionId present        — the edge target (the dispatching parent)
 *  - child.id !== child.sessionId   — skip self: the run owner's own dispatch
 *                                     stamps sessionId === its own id
 *  - findWakeEvent(feedback) truthy — there is actually a wake event (terminal,
 *                                     `[blocked]`, OR a `[pending]` pause)
 *  - §5 matrix                      — terminals + `[blocked]` bubble on ANY edge;
 *                                     `[pending]` bubbles ONLY when the edge's
 *                                     `subscription === 'everything'`.
 *
 * There is deliberately NO `child.kind !== 'autopilot'` guard (LIN-813). A CHILD
 * autopilot — one an autopilot acting as a coordinator dispatched for a whole task,
 * with `sessionId` = the coordinator's id (its dispatching parent) and a declared
 * `subscription` — MUST wake that coordinator when it finishes; that up-chain
 * report is the literal substrate for "each autopilot reports back up the chain."
 * The coordinator's own kickoff never falls through: a top-level kickoff carries no
 * `sessionId` (rejected below), and a run owner that stamps `sessionId === its own
 * id` is caught by the self-skip. So the only `kind: 'autopilot'` item that reaches
 * the wake is exactly a child whose parent differs from itself — which we want.
 *
 * There is deliberately NO `!child.followUpTo` guard (LIN-843): a stepper's
 * warm-resume beat — `followUpTo: ROOT` + `subscription: 'everything'` — MUST be
 * able to wake, because the push rails have to reach the orchestrator on every beat
 * boundary, not just the first fresh beat (LIN-841). The loop guard does not need
 * it: a wake follow-up is `kind:'wake'`, so the first check already excludes it.
 *
 * The returned descriptor carries `subscription: 'terminal-only'` (schema-valid;
 * moot behind the `kind:'wake'` guard, kept well-formed per §6) and is
 * `queueIfBusy: true` so it waits rather than fails if the parent is mid-judgment
 * (the LIN-827 runner path).
 *
 * @param {Object} child - the child dispatch doc/item (accepts `id` or `_id`)
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{followUpTo: string, prompt: string, queueIfBusy: boolean, sessionId: string, subscription: string, kind: string}|null}
 */
export function buildWakeFollowUp(child, feedback) {
  if (!child) return null;

  // LOOP GUARD FIRST (LIN-901 trap #1). A wake follow-up is a dispatch addressed
  // to the parent with `kind: 'wake'`; when it later terminates it must not beget
  // another wake. This replaces the old `subscribe:false` self-guard, which
  // vanished under §5 (terminals always bubble regardless of subscription).
  if (child.kind === 'wake') return null;

  const sessionId = child.sessionId;
  if (!sessionId) return null;

  // Skip self: the run owner's own dispatch carries sessionId === its own id, so
  // it must not wake itself.
  const childId = child.id ?? child._id;
  if (childId && childId === sessionId) return null;

  // NOTE (LIN-843): no `if (child.followUpTo) return null` — a subscribed
  // follow-up is the stepper's warm-resume beat and MUST wake the orchestrator.
  // NOTE (LIN-813): no `if (child.kind === 'autopilot') return null` — a child
  // autopilot must wake its coordinator up-chain, exactly like any other child.

  const wake = findWakeEvent(feedback);
  if (!wake) return null;

  // §5 bubbling matrix. Terminal outcomes (done/complete/failed/aborted) and
  // `[blocked]` ALWAYS bubble — regardless of the edge's subscription level.
  // `[pending]` is PENDING-external (SD filters PENDING-internal before it ever
  // reaches Harbour, §4/§8.1) and bubbles ONLY on an `everything` edge — the one
  // row the subscription level controls.
  const isPending = wake.marker === 'pending';
  if (isPending && child.subscription !== 'everything') return null;

  return {
    followUpTo: sessionId,
    prompt: formatWakePrompt(child, wake),
    queueIfBusy: true,
    sessionId,
    subscription: 'terminal-only',
    kind: 'wake'
  };
}

export const __internal = { formatWakePrompt };
