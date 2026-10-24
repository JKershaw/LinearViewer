/**
 * The issue-write routes of the workspace API (LIN-2246: moved out of
 * workspace-api.js, LIN-3876): POST /api/comments/:issueId, POST /api/issues and
 * PATCH /api/issues/:issueId, with the helpers and module state only they use.
 *
 * They register on the router they are given (the composer's own), directly after
 * the issue reads, not on a mounted sub-router: GET /api/comments/:issueId lives in
 * workspace-api-issue-read.js, and a mounted inner router would answer OPTIONS on
 * that path itself instead of reaching the composer's routes (`Allow:
 * GET,HEAD,POST`).
 */
import { badRequest, jsonError, classifyUpstreamError } from '../lib/errors.js';
import { UUID_REGEX, isValidIssueId, resolveIssueBinding, applyAccessTokenToWorkspace, saveSession } from '../lib/workspace.js';
import { adoptDurableCredentialIfDifferent } from '../lib/suspect-credential-refresh.js';
import { activeConnectionBackedBinding, setBindingCredential, setWorkspaceCredential } from '../lib/connection-binding.js';
import { fingerprintCredential } from '../lib/credential-diagnostics.js';
import { json } from 'express';
// LIN-1552 Session A: the session-auth issue write routes reuse the SAME
// symbolic-ref primitives the proxy write path uses, the shared trashed-signal
// detector, and the shared issue-write validator — no rules re-inlined here.
import {
  parseSourceNamespace,
  resolveStateRef,
  resolveProjectRef,
  resolveTeamRef,
  RefResolutionError,
} from '../lib/proxy-ref-resolver.js';
import { PartialWriteError } from '../lib/partial-write-error.js';
import { isTrashed } from '../lib/trashed-signal.js';
import { validateIssueWriteFields, isValidPriority, validateCommentBody, MAX_COMMENT_LENGTH } from '../lib/issue-write-validation.js';
// LIN-2154: the session-auth (human-lane) comment write shares the agent-lane's
// dedupe cache instances (routes/proxy.js) rather than a fresh pair that would
// miss workspace-wide generation bumps, and its key-building primitive.
import { dedupeKey, createDedupeCache } from '../lib/proxy-dedupe.js';
import { commentDedupe, commentDedupeGenerations } from './proxy.js';
import { isTestToken, refuseCapability } from './workspace-api-steps.js';


// LIN-2208: whether the decision-answer stamp(s) for a given comment-dedupe
// `key` have already succeeded — separate from `commentDedupe` itself (which
// caches the WRITTEN COMMENT and is spread verbatim into the JSON response;
// piggybacking stamp bookkeeping onto that value would leak new fields into
// the wire contract). Same TTL discipline as `commentDedupe`: an entry ages
// out with the comment dedupe window it tracks, so a stamp that never
// succeeds within 5 minutes simply falls out of both caches together, at
// which point a resubmission mints a fresh (unrelated) comment+stamp attempt
// rather than being treated as a retry forever.
export const decisionStampDedupe = createDedupeCache();

/**
 * Best-effort decision-answer stamp(s) for a human comment write (LIN-1728
 * decision 1 / LIN-2197 Phase 5) — the loop-backed and task-bound sibling
 * stamps, factored out so the dedupe-hit retry path (LIN-2208) and the
 * fresh-write path share identical stamping logic; they must never drift.
 * Both stamp attempts are independently best-effort (a lone id pair is a
 * malformed/partial client payload, never a half-stamp attempt) and never
 * throw — failure is logged only, mirroring the pre-LIN-2208 inline code.
 *
 * @returns {Promise<boolean>} true iff every REQUESTED stamp (only the pairs
 *   actually present in `decision`) succeeded — the signal LIN-2208's dedupe
 *   bypass uses to decide whether a later identical-text retry still needs to
 *   try again.
 */
async function stampDecisionAnswers(workspace, decision, { dispatchQueueStore, taskDecisionsStore, sessionsFeedCache = null }) {
  const given = (v) => typeof v === 'string' && v !== '';
  const d = decision || {};
  const { urlKey } = workspace;

  // Each requested stamp is an attempt that resolves to null when it landed, or
  // to the "not applied" log line when it matched nothing. A throw is logged
  // under the attempt's own `failure` label.
  const attempts = [];
  if (given(d.decisionLoopId) && given(d.decisionId)) {
    attempts.push({
      failure: 'Decision-answer stamp failed:',
      // LIN-2792: `optionId` rides this stamp with an undefined `outcome` (never
      // reached for a dismissal, so it cannot leak onto one) — the 5th argument
      // `markDecisionAnswered` gained in LIN-2754 Track B.
      run: async () => (await dispatchQueueStore.markDecisionAnswered(d.decisionLoopId, urlKey, d.decisionId, undefined, d.optionId))
        ? null
        : `Decision-answer stamp not applied: no matching item ${d.decisionLoopId} in workspace ${urlKey}`
    });
  }
  if (taskDecisionsStore && given(d.taskDecisionId) && given(d.taskDecisionIssueId)) {
    attempts.push({
      failure: 'Task-decision answer stamp failed:',
      // LIN-2889/LIN-2724: the shared answer() op un-retires a self-resolved row
      // before re-stamping it, and firstStampWins comes from a conditional write
      // (matchedCount), not markOutcome's earlier read — so a truthy record alone
      // does not prove this call's own write landed.
      run: async () => {
        const { record, firstStampWins } = await taskDecisionsStore.answer({
          urlKey, issueId: d.taskDecisionIssueId, id: d.taskDecisionId
        });
        const settled = firstStampWins || record?.outcome === 'answered' || record?.outcome === 'dismissed';
        return record && settled
          ? null
          : `Task-decision answer stamp not applied: no matching row ${d.taskDecisionId} for issue ${d.taskDecisionIssueId} in workspace ${urlKey} (outcome=${record?.outcome ?? 'none'})`;
      }
    });
  }

  let everyStampLanded = true;
  for (const attempt of attempts) {
    try {
      const notApplied = await attempt.run();
      if (notApplied) {
        console.error(notApplied);
        everyStampLanded = false;
      } else {
        // LIN-2755: both stamps write into state the cached loop reconstruction
        // (mergeLoops / loadLoops) may read, so drop the cache only on a
        // genuine success. For the task-decision store, read live and uncached,
        // this is defensive rather than a fix for observable staleness.
        sessionsFeedCache?.clear(urlKey);
      }
    } catch (stampErr) {
      console.error(attempt.failure, stampErr.message);
      everyStampLanded = false;
    }
  }
  return everyStampLanded;
}

// Normalize a provider write result to `{ success, issue }`. Linear/GitHub
// return that shape already; the local provider returns a bare canonical issue
// (or null), so without this a successful local write would read as
// `success: undefined` and wrongly 502. Mirrors proxy.js's normalizeWritePayload.
function normalizeIssueWrite(result) {
  return asWriteEnvelope(result, 'issue');
}

// Same normalization, keyed 'comment' instead of 'issue' (LIN-2154) — the
// session-auth comment route's provider.createComment() result can be
// Linear's `{success, comment}` envelope or a bare comment entity (Local).
function normalizeCommentWrite(result) {
  return asWriteEnvelope(result, 'comment');
}

// A result that already carries `success` is the envelope; anything else is the
// bare entity (or null), wrapped under `key`.
function asWriteEnvelope(result, key) {
  const isEnvelope = !!result && typeof result === 'object' && 'success' in result;
  return isEnvelope ? result : { success: !!result, [key]: result ?? null };
}

// Input-side symbolic-ref resolution, mirroring the proxy write path
// (routes/proxy.js resolveTeamInput/resolveStateInput/resolveProjectInput): a
// bare UUID short-circuits before any provider read, so existing UUID payloads
// pay no network cost; a symbolic ref triggers the scoped list fetch and
// resolves to a native id (or throws RefResolutionError → clean 422 below).
// A bare UUID passes straight through; anything else is looked up by `list()` and
// matched by `match`.
async function resolveRefVia(rawRef, list, match) {
  const { localRef } = parseSourceNamespace(rawRef);
  if (UUID_REGEX.test(localRef)) return localRef;
  return match(await list(), localRef);
}
const resolveIssueTeamRef = (provider, token, rawRef) =>
  resolveRefVia(rawRef, () => provider.fetchTeams(token), resolveTeamRef);
const resolveIssueProjectRef = (provider, token, rawRef) =>
  resolveRefVia(rawRef, () => provider.fetchProjectsList(token), resolveProjectRef);
// States are team-scoped. Without a team the symbolic match cannot be scoped, so
// it fails loud (422) rather than guessing across teams.
const resolveIssueStateRef = (provider, token, teamId, rawRef) =>
  resolveRefVia(rawRef, () => {
    if (teamId) return provider.states(token, teamId);
    const { localRef } = parseSourceNamespace(rawRef);
    throw new RefResolutionError(
      `Cannot resolve state '${localRef}' — the issue's team could not be determined`,
      { status: 422 },
    );
  }, resolveStateRef);

// The first reason a create body is refused, or null. Order is the contract:
// team, title, the shared field validation, then the LIN-1973 restrictive half.
function issueCreateRefusal({ title, description, teamId, stateId, priority }, declared) {
  if (declared.includes('teamId') && (!teamId || typeof teamId !== 'string')) return 'Valid teamId is required';
  if (!title || typeof title !== 'string') return 'title is required';
  // Shared seam (length caps, control characters, priority range). Unlike the
  // proxy surface, this session-auth one opts into priority rejection so a bad
  // priority is a clean 400 rather than a silent drop (LIN-1552 Session A spec).
  const fieldError = validateIssueWriteFields({ title, description, priority }, { mode: 'create', validatePriority: true });
  if (fieldError) return fieldError;
  // LIN-1973: a stateId/priority the provider's createFields() does not declare
  // is a 400, not a silent drop. Checked by presence, not truthiness, so an
  // explicit `stateId: ''` is still caught.
  if (stateId !== undefined && !declared.includes('stateId')) return 'stateId is not supported by this provider';
  if (priority !== undefined && !declared.includes('priority')) return 'priority is not supported by this provider';
  return null;
}

// The first reason an update body is refused, or null: field validation, then a
// wholly empty body — both before any provider read.
function issueUpdateRefusal({ title, description, priority, stateRef }) {
  const fieldError = validateIssueWriteFields({ title, description, priority }, { mode: 'update', validatePriority: true });
  if (fieldError) return fieldError;
  const anySupplied = [title, description, stateRef, priority].some((v) => v !== undefined);
  return anySupplied ? null : 'No valid fields to update';
}

// Normalize a provider's write result and answer 502 (with the raw result as
// `detail`) when it did not produce an issue. Returns the result on success,
// otherwise null once the 502 is sent.
function answerIssueWrite(res, rawResult, failureMessage) {
  const result = normalizeIssueWrite(rawResult);
  if (result.success && result.issue) return result;
  jsonError(res, 502, failureMessage, { detail: result || null });
  return null;
}

// Map a RefResolutionError to a clean 422 (with candidate ids for an ambiguous
// match). Returns true when handled so the catch can `if (...) return;`.
function issueRefResolutionFailed(res, err) {
  if (!(err instanceof RefResolutionError)) return false;
  jsonError(res, err.status || 422, err.message, err.candidates ? { candidates: err.candidates } : undefined);
  return true;
}

// Map a PartialWriteError (LIN-2012) the same way the proxy route does —
// same structured envelope, same non-2xx PARTIAL_WRITE code — so a caller
// sees identical shapes on both lanes. This route has no logEvent-equivalent
// audit trail today (unlike the proxy lane), so the provider-level
// console.warn in lib/providers/jira/index.js is what covers this lane;
// adding one here is a separate, out-of-scope concern.
function partialWriteFailed(res, err) {
  if (!(err instanceof PartialWriteError)) return false;
  jsonError(res, err.status || 500, err.message, {
    code: 'PARTIAL_WRITE',
    category: 'upstream',
    retryable: true,
    detail: err.cause?.message || null,
    context: { applied: err.applied, failed: err.failed },
  });
  return true;
}

/**
 * Register the three issue-write routes, in order: comment write, issue create, issue patch.
 * @param {import('express').Router} router - the composer's router
 */
export function registerIssueWriteRoutes(router, { workspaceFromUrl, dispatchQueueStore, taskDecisionsStore, harbourCommentsStore = null, sessionsFeedCache = null, ownerCredentialStore = null, adoptConnectionCredential = null, onTicketWrite = null }) {
  /**
   * Add a human comment to an issue (LIN-2154) — the session-auth twin of the
   * agent-lane `POST /api/proxy/issues/:issueId/comments` (routes/proxy.js).
   * The durable sink for a "save"/"save and continue" ruling response from the
   * session reply box: the operator's answer lands as a comment on the task,
   * independent of (and, from the client, sequenced before) the existing
   * follow-up dispatch.
   *
   * V1 tenancy note: `resolveIssueBinding(workspace, req.query.source)` below
   * is the same defensive shape the paired GET above and the issues PATCH
   * already use. The reply-box client sends no `?source=` (removed — see
   * public/session.js), so on a workspace holding more than one binding of
   * the same provider this resolves to the workspace's ACTIVE binding, which
   * may not be the one the displayed issue actually lives in. Accepted as a
   * named V1 limitation; LIN-2188 owns closing that gap.
   *
   * @route POST /workspace/:urlKey/api/comments/:issueId
   * Body: { body: string, decisionLoopId?: string, decisionId?: string, taskDecisionId?: string, taskDecisionIssueId?: string }
   * @returns 201 { success: true, comment } | 200 { success: true, comment, deduped: true }
   *
   * LIN-1728 Phase 2: an optional `{decisionLoopId, decisionId}` pair, both
   * required together, threaded from the reply box's `data-decision-id`
   * (`renderInlineReplyBox`, lib/render-session.js) via
   * `window.ReplyDelivery`. After a successful comment write, best-effort
   * stamps the answer onto the decision-bearing loop via
   * `dispatchStore.markDecisionAnswered` — logged on failure, never thrown,
   * and never blocks the (already-succeeded) comment response. This is the
   * ONE write path for the `decision-answer` kind (decision 1): a runner
   * token can never reach it, since it lives outside the runner-facing
   * feedback route entirely.
   *
   * LIN-2197 Phase 5 (Phase 4 close-out ledger item L4): the task-decision
   * sibling of the pair above — an optional `{taskDecisionId, taskDecisionIssueId}`
   * pair, both required together, threaded from `public/scan.js`'s answer
   * form via the same `window.ReplyDelivery.postComment`. After a successful
   * comment write, best-effort stamps `outcome: 'answered'` onto the scanned
   * row via `taskDecisionsStore.markOutcome` — logged on failure, never
   * thrown, mirroring the loop-decision stamp's discipline exactly. This is
   * the first (and, at HEAD, only) production caller of `markOutcome` with
   * `'answered'` — before this, the outcome was reachable only as
   * `'dismissed'` via the dismiss route, so `'answered'` was unwritable in
   * production (the gap Phase 4's review recorded as L4, "the item that must
   * not be dropped": dismissed-vs-answered is what the false-escalation KPI
   * `docs/escalation-philosophy.md` is computed from).
   */
  router.post('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    // LIN-3240 / LIN-3335: the issue's own provider-kind source, source-only.
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const issueBinding = resolveIssueBinding(workspace, req.query.source);
    const { provider, callScope: token } = issueBinding;

    if (!provider.supports('createComment')) {
      return refuseCapability(res, provider.name, 'createComment', 'commenting on issues');
    }

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    const { body } = req.body || {};
    const bodyValidation = validateCommentBody(body, { required: true });
    if (!bodyValidation.valid) {
      return badRequest.json(res, bodyValidation.error);
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
    }

    // test-token/testMockData branch (matches the codebase-wide `isTestMode`
    // convention, e.g. fetchWorkspaceIssues above): a `/test/set-session`
    // workspace carries no real provider binding, so the session-page e2e
    // coupling specs (tests/e2e/session-page.spec.js) need a write double
    // here rather than a live Linear GraphQL call — including no real
    // `issueWriteGuard` to check trashed-ness against, so this mode skips
    // that step entirely. Real (local/Linear-bound) workspaces are
    // unaffected and keep the full guard below.
    //
    // Hoisted above the `try` (LIN-2933 plan-review implementation note 1):
    // the recovery branch below runs from the outer `catch`, which cannot see
    // a `const` declared inside the `try` — a bare read from there would
    // throw a ReferenceError outside the inner error boundary and hang the
    // request exactly the way an unguarded failed retry would.
    const isTestMode = isTestToken(workspace);

    // Dedupe key and attribution are pure — neither calls the provider — so
    // both are computed once, up front, and reused unchanged by a recovered
    // retry (LIN-2933): an identical resubmission must still hit the same
    // dedupe entry, and the written body must not diverge between attempts.
    const key = dedupeKey(workspace.urlKey, issueId, body, commentDedupeGenerations.current(workspace.urlKey), 'human-comment');
    const attributedBody = `${body}\n\n— Ruling recorded via Harbour`;

    // Attribution (OQ2): a static fallback line, not a `provider.fetchViewer`
    // round-trip — see the plan's Attribution note for why. Reversible,
    // revisit as its own follow-up if the fallback proves unsatisfying.
    //
    // Deliberately identifier-agnostic in test mode — it echoes whichever
    // :issueId the caller sent, so every spec's own seeded issueIdentifier
    // is accepted, not one hardcoded fixture.
    const writeComment = async ({ provider: writer, callScope }) => (isTestMode
      ? { success: true, comment: { id: `test-comment-${key}`, body: attributedBody, createdAt: new Date().toISOString(), user: { name: 'Harbour' } } }
      : normalizeCommentWrite(await writer.createComment(callScope, issueId, attributedBody)));

    const refuseTrashed = () => jsonError(res, 409, 'Issue is trashed; refusing to comment on a deleted issue');

    // Best-effort answer stamp(s) (LIN-1728 decision 1 / LIN-2197 Phase 5;
    // factored into stampDecisionAnswers, shared with the dedupe-hit retry
    // path — LIN-2208). Failure is logged only: the comment already
    // succeeded and is the durable half of this write; the stamp is a
    // secondary annotation the rulings predicate tolerates missing (the
    // loop just stays "unanswered" until a later attempt succeeds — LIN-2208
    // is what makes an identical-text retry one such later attempt).
    const stampAnswers = async () => {
      const stampOk = await stampDecisionAnswers(workspace, req.body || {}, { dispatchQueueStore, taskDecisionsStore, sessionsFeedCache });
      if (stampOk) decisionStampDedupe.set(key, true);
    };

    // Best-effort Harbour-comments ledger record (LIN-2648, WS1 of LIN-2241):
    // mirrors the stampDecisionAnswers discipline — a single attempt, caught and
    // logged, never propagated, never retried. The comment already succeeded and is
    // the durable half of this write; a ledger-write failure must never fail it.
    const recordInLedger = async (commentId, failureLabel) => {
      if (!harbourCommentsStore) return;
      try {
        if (commentId) {
          await harbourCommentsStore.record({ urlKey: workspace.urlKey, commentId });
        }
      } catch (ledgerErr) {
        console.error(failureLabel, ledgerErr.message);
      }
    };

    // Shared success tail (dedupe write + best-effort ledger + best-effort
    // stamp + the 201 response). Used by both the original attempt and a
    // LIN-2933 recovered retry, so a successful write reaches this exactly
    // once per request, on whichever attempt produced it — never duplicated.
    const finishCommentSuccess = async (commentCreate) => {
      commentDedupe.set(key, commentCreate);
      await recordInLedger(commentCreate.comment?.id, 'Harbour-comments ledger record failed:');
      await stampAnswers();
      return res.status(201).json(commentCreate);
    };

    // LIN-3124 PR3 (D7 adopt entrant): a connection-backed active workspace
    // adopts from its Connection (connection-keyed) and hydrates the
    // per-request side-table — `applyAccessTokenToWorkspace` no-ops for such
    // a workspace, so without this the retry would read the stale credential.
    // The legacy path is byte-identical. Returns `{ token, expiresAt }`, or null
    // when there is nothing newer to adopt.
    const adoptReplacementCredential = async () => {
      const activeConnectionId = activeConnectionBackedBinding(workspace)?.connectionId ?? null;
      if (activeConnectionId && typeof adoptConnectionCredential === 'function') {
        const adoptedConnection = await adoptConnectionCredential({
          workspace,
          ownerAccountId: req.session.accountId,
          fingerprint: fingerprintCredential(token),
        });
        if (!adoptedConnection) return null;
        setBindingCredential(adoptedConnection.binding, adoptedConnection.credentialBag);
        setWorkspaceCredential(workspace, adoptedConnection.credentialBag);
        return { token: adoptedConnection.token, expiresAt: adoptedConnection.expiresAt };
      }
      return adoptDurableCredentialIfDifferent({
        fingerprint: fingerprintCredential(token),
        urlKey: workspace.urlKey,
        ownerAccountId: req.session.accountId,
        provider: provider.name,
        store: ownerCredentialStore,
      });
    };

    // The recovery sequence once a replacement credential exists: mirror it onto the
    // workspace, save the session, re-resolve the binding and retry the guard and the
    // write. Resolves true once the request is answered, false when there was nothing
    // newer to adopt. This is the ONLY path that mutates or saves the session (it is
    // reached from the catch below, never in test mode, never for a `?source` binding).
    const retryWithAdoptedCredential = async () => {
      const adopted = await adoptReplacementCredential();
      if (!adopted) return false;

      applyAccessTokenToWorkspace(workspace, adopted.token, adopted.expiresAt);
      await saveSession(req.session);
      // LIN-3186: same observability shape as the headless lane's
      // [credential-adopted] line — this lane's write-back is the request's
      // own session row via applyAccessTokenToWorkspace. Digests only,
      // never token bytes.
      console.log('[credential-adopted]', JSON.stringify({
        source: 'session-comment-recovery',
        urlKey: workspace.urlKey,
        provider: provider.name,
        fromFingerprint: fingerprintCredential(token),
        toFingerprint: fingerprintCredential(adopted.token),
        writeBack: { rows: 1, ok: true },
      }));

      // Re-resolve the binding to pick up the freshly-mirrored token.
      // `requestedSource` is null here (the eligibility check in the catch),
      // so this re-read is guaranteed to land on the same active
      // binding `applyAccessTokenToWorkspace` just mirrored into.
      const retried = resolveIssueBinding(workspace, requestedSource);

      if (!isTestMode) {
        const retryGuard = await retried.provider.issueWriteGuard(retried.callScope, issueId);
        if (isTrashed(retryGuard)) {
          // Same terminal outcome the main path gives a trashed issue —
          // plan-review implementation note 4.
          refuseTrashed();
          return true;
        }
      }

      const retryCommentCreate = await writeComment(retried);

      if (!retryCommentCreate.success || !retryCommentCreate.comment) {
        // Unlike the main path's direct 502, a non-success shape here is
        // treated as a thrown synthetic error so there is exactly one
        // exit from this catch block downstream of it: the classified
        // 500 below.
        throw new Error('Comment was not created on retry');
      }

      await finishCommentSuccess(retryCommentCreate);
      return true;
    };

    try {
      if (!isTestMode) {
        // Two-step trashed guard (LIN-1559): the capability check above cannot
        // speak for this route-internal read, so a provider that implements
        // createComment but not issueWriteGuard gets a clean 422, not a 500.
        if (typeof provider.issueWriteGuard !== 'function') {
          return refuseCapability(res, provider.name, 'issueWriteGuard', 'commenting on issues');
        }
        const guard = await provider.issueWriteGuard(token, issueId);
        if (isTrashed(guard)) {
          return refuseTrashed();
        }
      }

      // Dedupe key is salted with a stable 'human-comment' discriminator so this
      // lane's digest stream can never collide with the agent lane's own
      // 4-argument call (routes/proxy.js) — see the comment there. Keyed on the
      // RAW, pre-attribution operator text (not the final attributed body,
      // composed above): an identical resubmission must hit the same cache
      // entry even though attribution makes the two *written* bodies diverge.
      const prior = commentDedupe.get(key);
      if (prior) {
        // LIN-2208: the dedupe cache protects the COMMENT WRITE (never mint a
        // second comment for an identical resubmission) — it must not also
        // protect a FAILED decision-answer stamp from ever being retried.
        // Pressing Save again with the exact same text is the one natural way
        // an operator retries a failed stamp (the reply text has no reason to
        // differ), so as long as this key's stamp hasn't already succeeded,
        // still attempt it before returning the deduped comment response.
        // `decisionStampDedupe` is what stops that from becoming a THIRD
        // stamp attempt once one has already landed (the pre-existing "a
        // deduped resubmission does not re-stamp" success-path coverage).
        if (!decisionStampDedupe.get(key)) {
          await stampAnswers();
        }

        // Dedupe-hit ledger repair (LIN-2649 S1, F2): a dedupe hit means the
        // ORIGINAL create's own ledger-record attempt may have failed
        // silently, leaving a Harbour-written comment unrecorded. Re-attempt
        // it here before returning — idempotent upsert, same best-effort
        // discipline as the non-dedupe path, never gates the response.
        await recordInLedger(prior.comment?.id, 'Harbour-comments ledger repair failed:');

        return res.status(200).json({ ...prior, deduped: true });
      }

      const commentCreate = await writeComment(issueBinding);

      if (!commentCreate.success || !commentCreate.comment) {
        return jsonError(res, 502, 'Comment was not created', { detail: commentCreate || null });
      }

      return await finishCommentSuccess(commentCreate);
    } catch (err) {
      // LIN-2933: one-shot, server-side adopt-first recovery for a provider
      // auth rejection. Bounded to the comment route's single consumer — see
      // lib/suspect-credential-refresh.js's adoptDurableCredentialIfDifferent
      // for what this can and cannot recover (a session copy superseded by a
      // DIFFERENT durable credential, not a dead/byte-identical one; the
      // latter is LIN-3018).
      let errorToClassify = err;

      // Eligibility, all of which must hold before attempting recovery:
      // - only ever a provider-auth rejection, never any other failure shape
      // - never in test mode (no real credential store to recover from)
      // - only when a store is actually wired in (production, or a test that
      //   injects one — see server.js's production wiring below)
      // - only for the workspace's own ACTIVE Linear binding: a `?source`-
      //   bound request resolves a possibly-foreign binding's callScope, and
      //   applyAccessTokenToWorkspace always mirrors onto the active slot —
      //   mirroring a "different" credential found under a foreign binding's
      //   identity onto the active slot would misauthenticate future
      //   active-binding calls.
      // - only Linear: the adopt arm only ever returns a credential for a
      //   bare-token (Linear) provider (isBareTokenCredentialProvider).
      const classification = classifyUpstreamError(err, provider.ui?.displayName ?? null);
      const recoveryEligible = classification.category === 'auth'
        && !isTestMode
        && Boolean(ownerCredentialStore)
        && !requestedSource
        && provider.name === 'linear';

      if (recoveryEligible) {
        // Inner error boundary (plan-review R1): the route's outer `catch`
        // is not itself inside a `try` from Express's point of view (a bare
        // async handler, no `.catch(next)`), so a throw from adopt → mirror →
        // save → retry would otherwise have no home but the logging-only
        // `unhandledRejection` handler — no response sent, `restore()`
        // never runs client-side, and a bulk Agree row hangs forever. Every
        // throw in this sequence is caught here and reassigned to
        // errorToClassify; it is NEVER re-thrown, so nothing below this
        // point can escape the handler unresolved. The adopt read itself is
        // inside the boundary (LIN-3596): it can throw (the connection
        // authorisation reads are unguarded), and the one exit from this catch
        // is the classified 500 below.
        try {
          if (await retryWithAdoptedCredential()) return;
        } catch (recoveryErr) {
          errorToClassify = recoveryErr;
        }
      }

      // Credential fingerprint digest only (never token bytes), matching the
      // proxy lane's `[credential-rejected]` logging convention. Logs
      // errorToClassify, not the original err, so the log reflects what
      // actually produced the response when recovery was attempted.
      const loggedClassification = errorToClassify === err ? classification : classifyUpstreamError(errorToClassify, provider.ui?.displayName ?? null);
      console.error('Workspace-api create comment error:', errorToClassify.message, {
        code: loggedClassification.code,
        category: loggedClassification.category,
        credentialFingerprint: fingerprintCredential(token),
      });

      // Never the raw upstream message (LIN-1511/LIN-2260): `detail`/`code`/
      // `category`/`retryable` come from the classifier alone, attributed to
      // the actual provider that rejected the write (plan-review R3) so a
      // Jira/GitHub auth failure never reads as a Linear one. `retryable` is
      // never locally overridden — `classifyUpstreamError` already returns
      // `false` for an auth rejection, matching docs/proxy-integration.md's
      // contract, whether recovery was skipped, found nothing, or was
      // attempted and the adopt, the retry (or the session save) itself failed.
      return jsonError(res, 500, 'Failed to create comment', loggedClassification);
    }
  });
  // ===========================================================================
  // Issue write surface (session-auth) — LIN-1552 / LIN-1504 Session A
  //
  // POST  /workspace/:urlKey/api/issues            → create → 201 {success, issue}
  // PATCH /workspace/:urlKey/api/issues/:issueId    → update → 200 {success, issue}
  //
  // Backend only (no UI). Modeled on POST /workspace/:urlKey/api/feedback above:
  // resolve the workspace provider, take the call-scope token, gate the
  // capability with a clean 422 (never 500), validate fields through the shared
  // seam (lib/issue-write-validation.js), resolve symbolic refs via the shared
  // proxy ref-resolver primitives, perform the provider write, and map a failed
  // write to 502. This is the surface the in-app UI (Session B) will call.
  // ===========================================================================

  /**
   * Create an issue on the workspace provider (session-auth).
   * @route POST /workspace/:urlKey/api/issues
   */
  router.post('/workspace/:urlKey/api/issues', workspaceFromUrl, json(), async (req, res) => {
    // LIN-3240 / LIN-3335: creation targets the workspace's default (active)
    // binding, source-only; the call scope comes from that resolved binding.
    const { provider, callScope: token } = resolveIssueBinding(req.workspace, null);

    // Clean 422 (never 500) when the provider can't create.
    if (!provider.supports('createIssue')) {
      return refuseCapability(res, provider.name, 'createIssue', 'creating issues');
    }

    // LIN-1972: teamId is required only when the provider's create contract
    // declares it, so a teamless provider (Local, GitHub) is never asked for one.
    // The contract comes from createFields(), never supports()/fetchTeams().
    const declared = provider.createFields();
    const refusal = issueCreateRefusal(req.body || {}, declared);
    if (refusal) return badRequest.json(res, refusal);

    const { title, description, teamId, projectId, stateId, priority } = req.body || {};
    const needsTeam = declared.includes('teamId');

    try {
      // A create has no fetched issue to take a team from (unlike PATCH's
      // issueWriteGuard), so a teamless contract gets `provider.name`: a real
      // non-empty string that teamless states() implementations accept and
      // ignore, and that never reaches createIssue because `teamId` is only set
      // on the input when the contract asks for it (LIN-1972).
      const scopeTeam = needsTeam ? await resolveIssueTeamRef(provider, token, teamId) : provider.name;

      // LIN-1552: stamp the creating account from the session (NOT linearUserId),
      // the LIN-1376 owner-stamping convention. Unverifiable offline against a
      // real Linear IssueCreateInput, so per LIN-1579 the discharge is the NAMED
      // monitor in the catch below, not a bare "watch for a spike".
      const input = { title, createdBy: req.session?.accountId || null };
      if (needsTeam) input.teamId = scopeTeam;

      // LIN-1972: forward only optional fields the provider declares AND the
      // caller sent — restrictive but lossless (every in-tree provider already
      // drops an undeclared field one layer down). Refs resolve in this order.
      const optional = [
        ['description', description, (v) => v],
        ['projectId', projectId, (v) => resolveIssueProjectRef(provider, token, v)],
        ['stateId', stateId, (v) => resolveIssueStateRef(provider, token, scopeTeam, v)]
      ];
      for (const [field, supplied, resolve] of optional) {
        if (declared.includes(field) && supplied) input[field] = await resolve(supplied);
      }
      if (declared.includes('priority') && priority !== undefined && isValidPriority(priority)) input.priority = priority;

      const created = answerIssueWrite(res, await provider.createIssue(token, input), 'Issue was not created');
      if (created) res.status(201).json({ success: true, issue: created.issue });
    } catch (err) {
      if (issueRefResolutionFailed(res, err)) return;
      // NAMED MONITOR (LIN-1579) for the createdBy stamp: a createdBy-related
      // Linear rejection (5xx/502) surfaces here as a caught error under this
      // exact message — grep server logs for "Workspace-api create issue error".
      // No dedicated metric/oplog entry exists for that cause; a spike in this
      // line on Linear-backed workspaces is the signal.
      console.error('Workspace-api create issue error:', err.message);
      return jsonError(res, 500, 'Failed to create issue');
    }
  });

  /**
   * Update an issue on the workspace provider (session-auth). Description edit is
   * a full-body PATCH (replace, not append).
   * @route PATCH /workspace/:urlKey/api/issues/:issueId
   */
  router.patch('/workspace/:urlKey/api/issues/:issueId', workspaceFromUrl, json(), async (req, res) => {
    // LIN-1904: the issue's own binding via `source` (threaded from the edit-link
    // → task-edit → PATCH provenance hop), as on the read routes. The guard read
    // and the write both use this one pairing, so they cannot land on different
    // bindings (the invariant LIN-1903's review mutation-tested).
    const { provider, callScope: token } = resolveIssueBinding(req.workspace, req.query.source);

    if (!provider.supports('updateIssue')) {
      return refuseCapability(res, provider.name, 'updateIssue', 'updating issues');
    }
    if (!isValidIssueId(req.params.issueId)) return badRequest.json(res, 'Invalid issue ID format');

    // v1 edit fields: title, description, state, priority. `stateId` is primary;
    // `state` / `status` are aliases and all go through the symbolic state resolver.
    const { title, description, priority } = req.body || {};
    const stateRef = req.body?.stateId ?? req.body?.state ?? req.body?.status;

    const refusal = issueUpdateRefusal({ title, description, priority, stateRef });
    if (refusal) return badRequest.json(res, refusal);

    try {
      // One guard read serves both the trashed refusal (409) and the team scope a
      // symbolic state needs, as on the proxy update path.
      //
      // LIN-1559: `issueWriteGuard` is a ROUTE-INTERNAL read, deliberately off the
      // declared PROVIDER_SURFACE, so the `supports('updateIssue')` gate above
      // cannot vouch for it: a provider can pass that gate and still lack the read,
      // which used to throw a TypeError in this `try` and answer 500. So key on the
      // method's existence, in this route's own inline 422 idiom.
      if (typeof provider.issueWriteGuard !== 'function') {
        return refuseCapability(res, provider.name, 'issueWriteGuard', 'updating issues');
      }
      const { issueId } = req.params;
      const guard = await provider.issueWriteGuard(token, issueId);
      if (isTrashed(guard)) {
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }

      const input = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description; // full-body replace
      if (stateRef) input.stateId = await resolveIssueStateRef(provider, token, guard?.team?.id || null, stateRef);
      if (priority !== undefined && isValidPriority(priority)) input.priority = priority;
      if (!Object.keys(input).length) return badRequest.json(res, 'No valid fields to update');

      const updated = answerIssueWrite(res, await provider.updateIssue(token, issueId, input), 'Issue was not updated');
      if (!updated) return;
      res.json({ success: true, issue: updated.issue });

      // Seam 2 (LIN-3366): a state write may have made the ticket terminal.
      if (onTicketWrite && stateRef) {
        void Promise.resolve()
          .then(() => onTicketWrite({ urlKey: req.workspace.urlKey, written: updated.issue, readBack: () => provider.fetchIssueContext(token, issueId) }))
          .catch(e => console.error('[ticket-closer] seam 2 failure:', e?.message || e));
      }
    } catch (err) {
      if (issueRefResolutionFailed(res, err) || partialWriteFailed(res, err)) return;
      console.error('Workspace-api update issue error:', err.message);
      return jsonError(res, 500, 'Failed to update issue');
    }
  });
}
