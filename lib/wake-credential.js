/**
 * Wake-path credential provisioning policy (LIN-1430 / S2), extracted from
 * `routes/dispatch.js` for LIN-3130 S2a.
 *
 * A wake follow-up is built and enqueued INSIDE `addFeedback`
 * (lib/dispatch-store.js), bypassing `createDispatchItem` entirely — so,
 * pre-fix, `bootstrapToken` was structurally always null on this path and a
 * resumed claude-code session had no credential to write back with
 * (LIN-1428). This builder owns the provisioning POLICY; the store only
 * decides WHETHER a wake fires and resolves the donor (parent) harness to
 * hand it.
 *
 * Mirrors the S1/S3 shape (`routes/proxy.js`'s dispatch seam, the dispatch
 * feedback route's own follow-up-provisioning branch): decide on the RESOLVED
 * harness via `shouldUseMcpTokenField`, never throw (a feedback write must not
 * be lost to a provisioning failure — LIN-1343), and stamp `createdBy` from
 * the posting token's own owner so the exchanged working token resolves under
 * LIN-1366's owner-scoped selection (never fabricated).
 */

import { provisionResumeCredential, isStructuralGrantRefusal, shouldUseMcpTokenField, applyDefaultDispatchHarness } from './proxy-preamble.js';

/**
 * Builds the `provisionWakeCredential(parentHarness, grantDeclaration)` callback
 * the store invokes when it enqueues a wake follow-up.
 *
 * LIN-3134 T2-ii (S6): `grantDeclaration` is the parent's persisted
 * declared-mint record (`null` when it has none), read by the store. With a
 * record, the mint comes from the RECORDED owner/workspace/grants through
 * `provisionResumeCredential` — `createdBy` is not the authority, so the
 * ownerless degrade is bypassed (including the harbour-feedback branch, which
 * never sets an owner). Without one, today's exact plain mint. A declared
 * mint's refusal is split like every other outcome here: the transient
 * OWNER_CHECK_UNAVAILABLE withdraws (`reason`), a structural code enqueues
 * grant-less (`degraded` + `grantRefusal`, which the store stamps on the row
 * with a notice).
 *
 * @param {Object} options
 * @param {Object|null} options.proxyTokenStore - Proxy token store; absent →
 *   the wake enqueues token-less (`degraded: 'no-proxy-token-store'`).
 * @param {string} options.urlKey - The workspace urlKey the wake belongs to.
 * @param {string} options.baseUrl - Origin used to compose the bootstrap.
 * @param {string|null} options.createdBy - Owner to stamp on the bootstrap.
 * @returns {(parentHarness: string|null, grantDeclaration?: Object|null) => Promise<{token: string|null, reason: string|null, degraded: string|null, grantRefusal?: string}>}
 */
export function buildWakeCredentialProvisioner({ proxyTokenStore, urlKey, baseUrl, createdBy }) {
  return async (parentHarness, grantDeclaration = null) => {
    // Null-harness rule here is DELIBERATELY the opposite of the reply-box /
    // send_follow_up rule in LIN-1431 (S3). Do not "harmonize" them.
    //
    //   Here (wake):  null harness -> claude-code -> MINT.
    //     A wake is machine-generated and resumes a parent on Simple Dispatcher,
    //     whose own default harness is claude-code. Null means "unspecified", and
    //     an unprovisioned claude-code resume is exactly the LIN-1428 stall.
    //
    //   There (S3):   blank harness -> stays prose -> NO MINT.
    //     That path is user-facing and `applyDefaultHarness:false` keeps the
    //     LIN-1159 interpose off on purpose — LIN-1111's blank-harness escape
    //     hatch, test-locked at dispatch-route-proxy-context.test.js:125.
    //
    // Both are correct for their own path. Changing either to match the other
    // regresses LIN-1111 or LIN-1430. See LIN-1431.
    const resolved = applyDefaultDispatchHarness(parentHarness);
    // Prose harness (explicit 'opencode' etc.): no out-of-band token is WANTED.
    // Not a failure — the wake enqueues normally with bootstrapToken null.
    if (!shouldUseMcpTokenField(resolved)) return { token: null, reason: null, degraded: null };
    // ── STRUCTURAL misses: enqueue the wake anyway, token-less (LIN-1447) ──
    // Neither of these can be fixed by retrying, so suppressing the wake would
    // just strand the parent forever — the exact LIN-1428 stall. LIN-1447 landed
    // a tolerate-ownerless policy on POST /api/dispatch/broker-token, because
    // the host runner authenticates with exactly such a token.
    //
    // LIN-1448 note: that lane is now switchable, and when it is switched off
    // it adopts THIS branch's policy (refuse rather than hand back a token that
    // cannot work) rather than the reverse. The degrade below is unaffected
    // either way — this branch has never minted for an ownerless caller.
    if (!proxyTokenStore) return { token: null, reason: null, degraded: 'no-proxy-token-store' };
    // We deliberately do NOT mint for an ownerless caller. An ownerless bootstrap
    // mints fine and EXCHANGES fine (exchangeBootstrapToken has no owner check) —
    // it dies one hop later, at every data endpoint, because LIN-1366's
    // owner-scoped selection fails closed on a null owner
    // (lib/workspace-token-resolver.js `selectOwnerWorkspaceToken`, the explicit
    // `scoped && !ownerAccountId` guard → reason 'not_connected'). So a minted
    // ownerless token is dead on arrival; handing one to the wake would only
    // disguise the miss. Enqueue token-less instead.
    //
    // NOTE — there is NO downstream backstop on this lane. LIN-1446's fallback
    // mint is on SD's FRESH-LAUNCH path only (dispatcher.js:741); the follow-up/
    // wake resume branch returns at dispatcher.js:658, well before it, and reads
    // item.bootstrapToken directly with no mint of its own. So a degraded wake
    // really does resume with an empty HARBOUR_LOCAL_BASE — LIN-1428's symptom,
    // surviving in this narrow lane. We degrade anyway because a woken-but-
    // uncredentialed parent strictly beats a parent that never wakes, and
    // post-fix only these two structural lanes are token-less where pre-fix
    // EVERY wake was. Do not widen the degrade on the assumption something
    // downstream catches it — nothing does. SD-side follow-up: LIN-1449.
    // This is also the degrade path for the harbour-feedback auth branch
    // (authenticateFeedbackToken), which never sets req.dispatchTokenOwner.
    // A declared parent skips it: the recorded owner is the authority.
    if (grantDeclaration == null && !createdBy) return { token: null, reason: null, degraded: 'no-token-owner' };
    // ── TRANSIENT failures: withdraw the wake so the terminal stays retryable ──
    try {
      // `grantDeclaration` is passed as already read (`null` = none), so the
      // helper never looks it up again. `label` is explicit on BOTH paths: the
      // helper's default is 'dispatch-bootstrap'.
      const { bootstrapToken: token } = await provisionResumeCredential({
        proxyTokenStore,
        urlKey,
        baseUrl,
        label: 'wake-bootstrap',
        harness: resolved,
        createdBy,
        prompt: null,
        grantDeclaration
      });
      return token
        ? { token, reason: null, degraded: null }
        : { token: null, reason: 'wake-provision-failed:mint-returned-null', degraded: null };
    } catch (err) {
      if (err && err.code === 'OWNER_CHECK_UNAVAILABLE') {
        console.error('Wake declared grant mint unavailable (transient):', err.message);
        return { token: null, reason: 'grant-mint-transient:OWNER_CHECK_UNAVAILABLE', degraded: null };
      }
      // ── STRUCTURAL refusal of a declared grant: enqueue grant-less, never
      // withdraw — retrying cannot fix it (the same rule as the misses above).
      if (isStructuralGrantRefusal(err)) {
        return { token: null, reason: null, degraded: `declared-grant-refused:${err.code}`, grantRefusal: err.code };
      }
      console.error('Wake bootstrap provisioning failed:', err.message);
      return { token: null, reason: `wake-provision-failed:${err.message}`, degraded: null };
    }
  };
}
