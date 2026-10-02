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
import { deriveFollowUpDispatch } from './chat-tools.js';
import { createDispatchItem } from './dispatch-factory.js';
import { shouldUseMcpTokenField, provisionResumeCredential, isStructuralGrantRefusal } from './proxy-preamble.js';

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
        sessionId: session.sessionId,
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
