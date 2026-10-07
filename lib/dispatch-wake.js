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
 * makes wakes recurse.) The durable `terminalWakeItems` set (owned by the store,
 * on the edge-bearing ROOT dispatch — LIN-1059, re-keyed per producing beat item
 * by LIN-1357) is the orthogonal terminal-scoped guard: it caps each producing
 * beat item's TERMINAL wake at one — while a DISTINCT beat item sharing the same
 * edge still wakes, and `[pending]` beats on an `everything` edge may wake on
 * every boundary. It is NOT read here — this function stays pure; the store
 * applies it at the addFeedback seam.
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
 * The descriptor also carries the TRIGGERING dispatch's `issueIdentifier`
 * (LIN-2121), inherited verbatim from `child` — the edge-bearing dispatch whose
 * wake event produced this row. Without it the minted `kind:'wake'` row is
 * identifier-less, so the `?issueIdentifier=` scoped listing
 * (`listItems`/`listHistory`, the proxy-dispatch investigation read) cannot
 * reach it and the row surfaces only in the truncated unscoped view. Stamping
 * at construction time — not a later repair — is required: the already-created
 * invisible rows could not be reached by a post-hoc fix anyway. Only
 * `issueIdentifier` is stamped; `issueUrl` is deliberately not, because the
 * scoped reads key solely on `issueIdentifier` and the wake prompt already
 * carries the child link (`formatWakePrompt`).
 *
 * LIN-3126 residual (review W1) / LIN-3335: the descriptor ALSO carries the
 * child's kind-only `issueSource` when stamped, sparsely. A wake row never
 * reaches `createDispatchItem`, so the factory's §5.5a inheritance cannot cover
 * it — this is the second row producer. Without the source the wake renders as
 * its own lineage root with a source-less reply box; the source moves only when
 * present (an unstamped child adds no key, so the descriptor is byte-identical
 * to before). The pair-era `issueBindingScope` is gone.
 *
 * @param {Object} child - the child dispatch doc/item (accepts `id` or `_id`)
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{followUpTo: string, prompt: string, queueIfBusy: boolean, sessionId: string, subscription: string, kind: string, issueIdentifier: string|null, issueSource?: string}|null}
 */
export function buildWakeFollowUp(child, feedback) {
  if (!child) return null;

  // ABORT-ROW EXCLUSION (LIN-2078). A single abort produces two terminal posts —
  // one on the abort row itself, one on the aborted child's own row (LIN-1471,
  // added to close a separate wake hole). Both carry `sessionId`, so without this
  // guard both independently mint a wake, duplicating the LIN-1471 child-row wake
  // with a content-free one built from the abort row's own data. Row-keyed (not
  // marker-keyed) so it also suppresses the `[failed]` variant posted when an
  // abort's target is already gone. Must run here, before any witness/CAS work —
  // a post-mint suppression would leave a re-deliverable witness for LIN-1717's
  // future reconciliation sweep to resurrect. Deliberately narrow: do not widen
  // past `abort === true` to `followUpTo`/`kind`/`cascade`/`[skipped]`.
  if (child.abort === true) return null;

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
    kind: 'wake',
    // LIN-2121: carry the triggering dispatch's issue scope onto the minted
    // wake row so `?issueIdentifier=` listing can reach it. Explicit null when
    // the trigger is itself identifier-less (a general run's worker) — never a
    // fabricated id.
    issueIdentifier: child.issueIdentifier || null,
    // LIN-3126 residual W1 / LIN-3335: the SAME issue's kind-only source,
    // spread SPARSELY so an unstamped child keeps a byte-identical descriptor.
    // The wake mint is the row producer that bypasses `createDispatchItem`; the
    // source must travel on the row itself or the run-page reply box loses it.
    ...(child.issueSource != null ? { issueSource: child.issueSource } : {})
  };
}

/**
 * The server-authored notice prepended to a wake whose declared dispatch grant
 * was structurally refused (LIN-3134 S6). The wake still enqueues, grant-less,
 * so the parent learns why it can no longer enqueue work instead of failing
 * silently on its next dispatch. `code` is one of the four structural refusal
 * codes; the notice names the code only, never an account.
 *
 * @param {string} code - The structural refusal code (e.g. 'GRANT_OWNER_ONLY')
 * @returns {string}
 */
export function formatGrantRefusalNotice(code) {
  return `your dispatch grant was refused (${code}); you cannot enqueue further work; report this to your human and stop`;
}

// ---------------------------------------------------------------------------
// Shadow wake classification (LIN-3257, M1 shadow)
//
// PURE, read-only classification of every wake Harbour mints. This powers the
// shadow tally ONLY: no branch of the mint path reads the result, so there is
// no suppression code path and delivery stays byte-identical. See
// lib/wake-shadow.js for the recording seam and routes/proxy-dispatch.js for
// the read-only proxy exposure.
// ---------------------------------------------------------------------------

// References that identify "what the child is waiting on": the issue/task
// identifiers (LIN-nnnn), dispatch/session UUIDs, and `#n` PR numbers. The set
// is deliberately narrow and explicit (the plan's fingerprint rule): a
// different ref set means a different awaited target, even when the prose is
// identical. Digits are NOT stripped from refs — stripping would merge
// LIN-3257 and LIN-3258.
const WAKE_REF_LIN_REGEX = /LIN-\d+/gi;
const WAKE_REF_UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const WAKE_REF_PR_REGEX = /#\d+/g;

/**
 * Extract the sorted, de-duplicated reference set from a wake message. Pure.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function extractWakeRefs(message) {
  if (typeof message !== 'string' || message.length === 0) return [];
  const refs = new Set();
  for (const m of message.match(WAKE_REF_LIN_REGEX) || []) refs.add(m.toUpperCase());
  for (const m of message.match(WAKE_REF_UUID_REGEX) || []) refs.add(m.toLowerCase());
  for (const m of message.match(WAKE_REF_PR_REGEX) || []) refs.add(m);
  return [...refs].sort();
}

/**
 * Normalize a wake message to its "digits aside" fingerprint: case-folded,
 * every run of digits replaced by `#`, whitespace collapsed. Pure. This is the
 * second half of the repeat test — "the same waiting message with digits
 * aside" (e.g. "waiting 12 min" vs "waiting 15 min").
 *
 * @param {string} message
 * @returns {string}
 */
export function normalizeWakeMessage(message) {
  if (typeof message !== 'string' || message.length === 0) return '';
  return message.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * The full fingerprint of a wake message: `{ refs, text }`. Stored per-edge as
 * the "prior" record so the NEXT pause wake on the same edge can be compared.
 * Pure.
 *
 * @param {string} message
 * @returns {{refs: string[], text: string}}
 */
export function wakeFingerprint(message) {
  return { refs: extractWakeRefs(message), text: normalizeWakeMessage(message) };
}

function sameRefSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Classify a single minted wake for the shadow tally. PURE — takes the wake's
 * marker + message, whether it is person-originated, and the prior wake
 * fingerprint recorded for this same edge, and returns `{ wouldSkip, reason }`.
 *
 * Reasons, and the rule (LIN-3257):
 *  - `terminal` / `blocked` — a `[done]`/`[complete]`/`[failed]`/`[aborted]` or
 *    `[blocked]` wake is never a candidate. Checked FIRST so the verdict is the
 *    outcome class regardless of origin (a person-dispatched worker's terminal
 *    is still `terminal`, not `person`).
 *  - `person` — a person-originated wake is never a candidate (H7: reply box,
 *    ruling reply, Task Chat, Flight Companion). Defence in depth: those relays
 *    are dispatched as follow-ups and are not minted by `addFeedback`; no
 *    production path reaches this branch today.
 *  - `first-pause` — a `[pending]` wake whose edge has no prior pending record
 *    (the very first pause, or the first after an intervening terminal/blocked
 *    wake, which resets the repeat state). Never a candidate.
 *  - `target-changed` — a repeat pause whose fingerprint differs: a different
 *    ref set, or a different "digits aside" message. Conservative: an
 *    unparseable/empty message also lands here. Never a candidate.
 *  - `repeat-same-target` — a repeat pause with a non-empty, identical ref set
 *    AND identical normalized text. The only candidate class besides the
 *    message-only form below.
 *  - `repeat-same-message` — a repeat pause with no refs on either side and an
 *    identical "digits aside" message.
 *
 * @param {Object} args
 * @param {string} args.marker - the wake marker (`pending`|`blocked`|`done`|…)
 * @param {boolean} [args.personOriginated=false]
 * @param {string} [args.message='']
 * @param {{marker?: string, refs?: string[], text?: string}|null} [args.prior=null]
 * @returns {{wouldSkip: boolean, reason: string}}
 */
export function classifyWake({ marker, personOriginated = false, message = '', prior = null } = {}) {
  if (!marker) return { wouldSkip: false, reason: 'unknown' };
  if (marker !== 'pending') {
    return { wouldSkip: false, reason: marker === 'blocked' ? 'blocked' : 'terminal' };
  }
  if (personOriginated) return { wouldSkip: false, reason: 'person' };

  if (!prior || prior.marker !== 'pending') return { wouldSkip: false, reason: 'first-pause' };

  const { refs, text } = wakeFingerprint(message);
  const priorRefs = Array.isArray(prior.refs) ? prior.refs : [];
  const priorText = typeof prior.text === 'string' ? prior.text : '';

  // Conservative: an empty/unparseable message never marks.
  if (text.length === 0 || priorText.length === 0) {
    return { wouldSkip: false, reason: 'target-changed' };
  }

  const refsUnchanged = sameRefSet(refs, priorRefs);
  const textUnchanged = text === priorText;

  if (refs.length > 0 && refsUnchanged && textUnchanged) {
    return { wouldSkip: true, reason: 'repeat-same-target' };
  }
  if (refs.length === 0 && priorRefs.length === 0 && textUnchanged) {
    return { wouldSkip: true, reason: 'repeat-same-message' };
  }
  return { wouldSkip: false, reason: 'target-changed' };
}

export const __internal = { formatWakePrompt, sameRefSet };
