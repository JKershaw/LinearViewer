/**
 * Shared session follow-up dispatch composition (LIN-3254 S4).
 *
 * Extracted, unchanged in behaviour, from the Flight Companion
 * `approve-follow-up` route so that both that route and the run page's
 * proposal-Apply route enqueue a follow-up through one composition: read the
 * session, derive `followUpTo`/`target`/`force` from the anchor's lineage tail
 * (`deriveFollowUpDispatch`, LIN-2433), then `createDispatchItem` with a
 * `provisionResumeCredential` finalize (LIN-3134 T2-ii).
 *
 * The route-owning concerns stay in the caller: the flightCompanion feature
 * flag, the attended session/account auth gate, and the `dispatchQueueLimiter`
 * all remain on `approve-follow-up` (and are added by Apply's own route).
 *
 * Returns an HTTP-shaped envelope `{ status, body }` for every expected
 * outcome so both callers map identically; only genuinely unexpected errors
 * are thrown, for the caller's own 500 path.
 */

import { getSessionsForWorkspace } from './pipeline-loops.js';
import { findAnchorLoop } from './session-summary.js';
import { followUpTarget } from './dispatch-targets.js';
import { isRowClosed } from './dispatch-terminal.js';
import { createDispatchItem } from './dispatch-factory.js';
import { resolveRunnerOwnerRefusal } from './runner-owner-gate.js';
import { shouldUseMcpTokenField, provisionResumeCredential, isStructuralGrantRefusal } from './proxy-preamble.js';

// LIN-1486: loop-local mirror of routes/dashboard.js's `isTerminalLoop`
// (`TERMINAL_AGENT_STATES.has(loop.agentState)`) OR'd with a direct
// `terminalStatus` marker check — NOT `enrichLoop`/`effectiveAgentState`'s
// fuller marker fallback, which also re-derives a MISSING `terminalStatus` by
// scanning `loop.feedback` (`deriveTerminalStatus`) when the field is
// `undefined`. That re-derivation can't fire here: `pipeline-loops.js:477`
// always sets `terminalStatus` on every loop it builds (`null`, never
// `undefined`), and `session.loops` (this handler's only input) is built
// exclusively by that path — so a direct field check is equivalent for these
// loops, with no feedback-scanning needed. Those functions are also
// unexported, and this module must not import from routes/ (the ticket's
// binding constraint against touching routes/dashboard.js — #977 is in
// flight against that file), so the two-clause rule is replicated here
// instead. BOTH clauses matter: `agentState` alone misses a `[aborted]`/
// `[skipped]` marker on an otherwise still-"taken" loop, and `terminalStatus`
// alone misses an expired/cancelled loop, which is terminal via `agentState`
// with no feedback marker at all.
const LOOP_TERMINAL_AGENT_STATES = new Set(['complete', 'error']);
const LOOP_TERMINAL_MARKERS = new Set(['done', 'failed', 'aborted', 'skipped']);
function isLoopTerminal(loop) {
  if (!loop) return false;
  return LOOP_TERMINAL_AGENT_STATES.has(loop.agentState) || LOOP_TERMINAL_MARKERS.has(loop.terminalStatus) || isRowClosed(loop);
}

/**
 * The tail of `anchorLoop`'s own lineage within `session.loops` (LIN-1486).
 * A lineage is every loop sharing `lineageId ?? loopId` with the anchor;
 * `session.loops` is already ordered dispatchedAt-ascending (`_assembleSession`,
 * lib/pipeline-loops.js), and `filter` preserves that order, so the last match
 * is the tail — no sort needed. An autopilot anchor and its explicit-sessionId
 * workers are NOT one lineage (they don't share `rootItemId`), so this can
 * legitimately return just `anchorLoop` itself.
 *
 * @param {Object|null} anchorLoop
 * @param {Array<Object>} loops - `session.loops`
 * @returns {Object|null}
 */
function anchorLineageTail(anchorLoop, loops) {
  if (!anchorLoop) return null;
  const key = (l) => l.lineageId ?? l.loopId;
  const lineage = (loops || []).filter(l => key(l) === key(anchorLoop));
  return lineage.length ? lineage[lineage.length - 1] : null;
}

/**
 * Derive the `{ followUpTo, target, force }` triple for following up on a
 * session's anchor loop (LIN-1486, extracted from `send_follow_up`'s
 * executor by LIN-2433). Throws if the anchor targets `dash`/`local` (not
 * supported for follow-up); callers that need a non-throwing surface (e.g.
 * an HTTP route) must catch and map that error themselves.
 *
 * LIN-1486: target the TAIL of the anchor's own lineage, not the session
 * root — and derive `force` from that tail's own terminality, not an
 * anchor-first/all()-shaped aggregate across the whole session (the two
 * shapes LIN-1478 found unsafe on the session-page reply path). Falls
 * back to `session.sessionId`/`false` when there's no anchor at all
 * (anchorless/orphan session), matching prior behavior.
 *
 * @param {Object} session - A session as returned by `getSessionsForWorkspace`
 *   / `getSessionsForIssues`, carrying `sessionId` and `loops`.
 * @returns {{ followUpTo: string, target: 'web'|'cli', force: boolean }}
 */
export function deriveFollowUpDispatch(session) {
  const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
  const anchorTarget = (anchorLoop && anchorLoop.target) || null;
  const target = followUpTarget(anchorTarget);
  if (target === null) {
    throw new Error(`Session ${session.sessionId} cannot be followed up on (only cli and web sessions can be followed up)`);
  }
  const tail = anchorLineageTail(anchorLoop, session.loops);
  const { followUpTo, force } = tail ? followUpForLoop(tail) : { followUpTo: session.sessionId, force: false };
  return { followUpTo, target, force };
}

/**
 * The `{ followUpTo, force }` pair for following up on one lineage tail loop:
 * the loop's own row, forced when that loop is terminal. Shared by
 * `deriveFollowUpDispatch` (the anchor's tail) and the CI wake sweep (a parked
 * worker's tail, LIN-3661). Target and the no-tail fallback stay with callers.
 *
 * @param {Object} loop
 * @returns {{ followUpTo: string, force: boolean }}
 */
export function followUpForLoop(loop) {
  return { followUpTo: loop.loopId, force: isLoopTerminal(loop) };
}

/**
 * Enqueue a follow-up to a session's lineage tail.
 *
 * @param {Object} options
 * @param {Object} options.dispatchQueueStore - Dispatch queue store.
 * @param {Object} options.agentStatusStore - Agent status store.
 * @param {Object} options.workspacePreferencesStore - Workspace preferences store.
 * @param {Object} options.proxyTokenStore - Proxy token store.
 * @param {string} options.urlKey - Workspace urlKey.
 * @param {string} options.sessionId - The anchor session to resume.
 * @param {string} options.prompt - The follow-up prompt.
 * @param {string} options.baseUrl - Origin used to compose the bootstrap.
 * @param {string} options.dispatchedBy - Account stamped as the dispatcher.
 * @param {Function} options.ownerCheck - The hoisted workspace-owner seam
 *   (LIN-3383). REQUIRED: absent means the enqueue is refused (fail closed).
 * @param {string} options.workspaceId - The route-resolved workspace id.
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function dispatchSessionFollowUp({
  dispatchQueueStore,
  agentStatusStore,
  workspacePreferencesStore,
  proxyTokenStore,
  urlKey,
  sessionId,
  prompt,
  baseUrl,
  dispatchedBy,
  ownerCheck,
  workspaceId,
}) {
  // Same read `send_follow_up`'s executor uses (lib/chat-tools.js).
  const sessions = await getSessionsForWorkspace(
    urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }
  );
  const session = sessions.find(s => s.sessionId === sessionId);

  // The caller's OWN guard, ahead of derivation: deriveFollowUpDispatch
  // dereferences session.loops/session.sessionId unguarded by design
  // (LIN-2433's review ledger, item 3) — without this check here, an
  // unknown sessionId becomes a 500 instead of a clean 404.
  if (!session) {
    return { status: 404, body: { error: `Session ${sessionId} not found` } };
  }

  let followUpTo, target, force;
  try {
    ({ followUpTo, target, force } = deriveFollowUpDispatch(session));
  } catch (deriveError) {
    // deriveFollowUpDispatch throws for a dash/local anchor target
    // (LIN-2433's review ledger, item 4). 422, not 409: this is not a
    // transient state conflict a retry could resolve — a dash/local
    // session structurally can never support a follow-up dispatch, the
    // same "well-formed request, unsupported for this resource" shape
    // routes/proxy.js's CAPABILITY_NOT_SUPPORTED already uses 422 for.
    return { status: 422, body: { error: deriveError.message } };
  }

  return enqueueFollowUp({
    dispatchQueueStore, workspacePreferencesStore, proxyTokenStore, urlKey, prompt, baseUrl,
    dispatchedBy, ownerCheck, workspaceId, followUpTo, target, force, sessionId: session.sessionId
  });
}

/**
 * The half of the composition after derivation: owner gate, then
 * `createDispatchItem` with the resume-credential finalize. Takes the already
 * derived `followUpTo`/`target`/`force`, so a caller that targets a lineage tail
 * other than the session anchor's (the CI wake sweep, LIN-3661) reuses the owner
 * gate and credential finalize as one composition (LIN-3383/3408, LIN-3134)
 * instead of copying them. `sessionId` only fills the 200 body.
 *
 * @param {Object} options - as `dispatchSessionFollowUp`, minus `agentStatusStore`
 *   and the anchor `sessionId` lookup, plus:
 * @param {string} options.followUpTo - the row to follow up on
 * @param {('web'|'cli')} options.target
 * @param {boolean} options.force
 * @param {string} options.sessionId - echoed in the 200 body
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function enqueueFollowUp({
  dispatchQueueStore,
  workspacePreferencesStore,
  proxyTokenStore,
  urlKey,
  prompt,
  baseUrl,
  dispatchedBy,
  ownerCheck,
  workspaceId,
  followUpTo,
  target,
  force,
  sessionId,
}) {
  // LIN-3383 owner-only runner enqueue: a follow-up lands on the owner's runner
  // (and re-mints the parent's recorded owner credential), so only the owner may
  // queue one. After derivation (the target is the anchor's), before any write.
  // Fails closed when the seam, workspace or account is absent. A not-owner is a
  // 422, never 403: public/flight-companion.js reads a 403 from approve as
  // flag-off and stops the cadence (LIN-2771), same reason as the structural
  // grant refusal below. Apply reverts its claimed proposal on any non-200.
  const refusal = await resolveRunnerOwnerRefusal({
    ownerCheck,
    workspaceId,
    accountId: dispatchedBy,
    target
  });
  if (refusal) {
    const status = refusal.status === 403 ? 422 : refusal.status;
    return {
      status,
      body: { error: refusal.error, code: refusal.code, category: refusal.category, retryable: refusal.retryable }
    };
  }

  try {
    const item = await createDispatchItem({
      store: dispatchQueueStore,
      urlKey,
      workspacePreferencesStore,
      proxyTokenStore,
      applyDefaultHarness: false,
      prompt,
      // Byte-for-byte mirror of send_follow_up's own finalizePrompt
      // (lib/chat-tools.js). Always a follow-up (`followUpTo` is derived
      // server-side), so the whole finalize is the one resume helper
      // (LIN-3134 T2-ii): the credential comes from the persisted parent
      // record, declared or plain. `mint` keeps the load-bearing
      // shouldUseMcpTokenField guard (LIN-1431 S3 #2) — minting for a prose
      // harness that never rewrites the prompt would strand an
      // unreferenceable credential on the item.
      finalizePrompt: (resolvedHarness) => provisionResumeCredential({
        proxyTokenStore,
        dispatchStore: dispatchQueueStore,
        urlKey,
        baseUrl,
        label: 'dispatch-bootstrap',
        harness: resolvedHarness,
        followUpTo,
        createdBy: dispatchedBy,
        prompt,
        mint: shouldUseMcpTokenField(resolvedHarness)
      }),
      fields: {
        followUpTo,
        target,
        force,
        dispatchedBy,
      }
    });

    return {
      status: 200,
      body: {
        queued: true,
        itemId: item._id,
        sessionId,
        target,
        force,
      },
    };
  } catch (error) {
    // LIN-3134 (NB2): only the CODED transient refusal is a retryable 503 —
    // any other error, including an uncoded mint failure that carries
    // `proxyAttachFailed`, keeps the caller's 500 below.
    if (error && error.code === 'OWNER_CHECK_UNAVAILABLE') {
      return { status: 503, body: { error: error.message, code: error.code, retryable: true } };
    }
    // A structural refusal is 422, never 403: public/flight-companion.js
    // treats 403 as flag-off and stops the cadence (LIN-2771).
    if (isStructuralGrantRefusal(error)) {
      return { status: 422, body: { error: error.message, code: error.code, retryable: false } };
    }
    throw error;
  }
}
