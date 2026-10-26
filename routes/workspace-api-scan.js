/**
 * Scan routes (LIN-3877, LIN-2246: extracted from workspace-api.js): the operator
 * decision queue's human-triggered producer (LIN-2197): GET and POST /api/scan/:issueId,
 * POST /api/scan/:issueId/dismiss, /retire and /unretire, and GET /api/scan-due.
 * `registerScanRoutes` puts them on the router createWorkspaceApiRoutes hands it, at
 * the place the scan block sat in that file, so the route table's order is unchanged.
 * The steps they share with the composer (`refuseFreeTier`, `aiNotConfigured`,
 * `keepaliveFailure`, `loadContext`) live in workspace-api-steps.js.
 */
import { json } from 'express';
import { jsonError, keepaliveError, notFound } from '../lib/errors.js';
import { streamChat } from '../lib/openrouter.js';
import { resolveChatCredential, isAiUnavailable, checkFreeTierGate } from '../lib/chat-request.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { generateScan, parseScanResponse, buildScanMessages, isExplicitRetirementSignal, extractScanPayload } from '../lib/scan.js';
import { hashContext } from '../lib/recap-cache.js';
import { scanBasisHashFromContext, dueBasisHashFromContext, dueChanged, basisChanged as computeBasisChanged, BASIS_VERSION } from '../lib/scan-fingerprint.js';
import { settleWithConcurrency } from './dashboard.js';
import { UUID_REGEX, resolveIssueBinding } from '../lib/workspace.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { shouldMockAi } from '../lib/should-mock-ai.js';
import { buildMockScanText } from '../lib/workspace-api-mocks.js';
import { failureOf, openIssue, refuseCapability, refuseFreeTier, aiNotConfigured, keepaliveFailure, loadContext } from './workspace-api-steps.js';


// GET /api/scan-due paging + fan-out bounds (LIN-2649 WS2/S3). Page size
// mirrors BASIS_CHECK_MAX_PER_PAGE (public/observation.js) and its reasoning
// — each check fetches live task context, so N candidates is N provider
// reads. Concurrency mirrors pumpBasisChecks's shape, server-side over the
// DB-sourced candidate list.
const DUE_CHECK_PAGE_SIZE = 40;
const DUE_CHECK_CONCURRENCY = 5;

// Never let a durable scan record be keyed under a non-canonical fallback
// (LIN-2197 Phase 2 close-out ledger item 3). Spread into jsonError / keepaliveError.
const CANONICAL_ID_REFUSAL = [422, "This task's canonical id could not be resolved; scan requires a canonical identity", { code: 'CANONICAL_ID_REQUIRED' }];

/**
 * The scan routes' common first steps: the task's context and the canonical id a durable
 * scan record is keyed under (LIN-2197 Phase 2 close-out ledger item 3: never a
 * non-canonical fallback). A refusal comes back as `[status, message, extra]` for the
 * route to reply with, plain or through its keepalive.
 */
async function loadScanSubject(workspace, issueId, binding) {
  const { context, missing } = await loadContext(workspace, issueId, binding);
  if (missing) return { refusal: [404, 'Issue not found'] };
  const canonicalId = context.issue?.id || issueId;
  if (!UUID_REGEX.test(canonicalId)) return { refusal: CANONICAL_ID_REFUSAL };
  return { context, canonicalId };
}

/** The non-null slice of a scan row the scan routes return; `raw` keeps absent fields absent (retire, unretire). */
function scanRow(record, { raw = false } = {}) {
  const orNull = (value) => (raw ? value : (value ?? null));
  return {
    id: record.id,
    issueId: record.issueId,
    decision: record.decision,
    scannedAt: record.scannedAt,
    outcome: record.outcome,
    outcomeAt: record.outcomeAt,
    outcomeReason: orNull(record.outcomeReason),
    outcomeBasisHash: orNull(record.outcomeBasisHash),
  };
}

// retire's two ways to find the row not stamped, as `[status, message, extras]`
// for the response helpers. `markOutcome` returns null for a row pruned or
// replaced (`_pruneToCapacity`, a superseding scan), and a record that is not
// 'self-resolved' when first-stamp-wins hit an already-terminal row — reachable
// with no client bug, since the route's own re-scan runs before its write and
// leaves a window for a dismiss/answer/earlier retire to land first.
const RETIRE_ROW_GONE = [404, 'This ruling no longer exists — it may have been pruned or superseded by a newer scan', { code: 'ROW_GONE' }];
const RETIRE_ALREADY_TERMINAL = [409, 'This ruling changed while the check was running and was not retired', { code: 'ALREADY_TERMINAL' }];

// The raw model text of retire's re-scan, or null when the scan prompt could not
// be built (the Principle 0 gate was skipped). Deliberately not `generateScan`,
// whose own `has_decision !== true` collapse is right for raising and wrong for
// retiring (see lib/scan.js).
async function rawRetireRescan({ context, workspace, apiKey, model }) {
  const messages = buildScanMessages(context.issue, context);
  if (!messages) return null;
  let text = '';
  await streamChat(
    messages,
    {
      apiKey, model, maxTokens: 1000, temperature: 0,
      callMeta: { feature: 'scan-retire', issueIdentifier: context.issue?.identifier || null, urlKey: workspace?.urlKey }
    },
    (type, data) => { if (type === 'token' && data?.token) text += data.token; }
  );
  return text;
}

export function registerScanRoutes(router, { workspaceFromUrl, freeTierStore, workspacePreferencesStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache }) {
  // LIN-2649 WS2: the ledger-store null guard, in one place for both of its call sites
  // (the scan-time write and the scan-due check). An absent harbourCommentsStore means
  // "we cannot tell which comments are Harbour's", not "no comments changed" — an empty
  // set filters nothing, so the worst case is a false DUE, never a false not-due and
  // never a fabricated unknown (a dueBasisHash stored with the store absent and later
  // compared with one computed while it IS present differs). `harbourCommentsStore`
  // defaults to null in createWorkspaceApiRoutes, and tests/unit/scan-routes.test.js
  // mounts the real router with no ledger store while driving the scan route end to
  // end — an unguarded call would be a TypeError on a shipped route.
  const recordedByHarbour = async (workspace, comments) => (harbourCommentsStore
    ? harbourCommentsStore.wereRecordedByHarbour(workspace.urlKey, comments)
    : new Set());

  // ===========================================================================
  // Scan API (LIN-2197 Phase 4) — the third producer into the operator
  // decision queue (LIN-1721): a human-triggered, single-task triage read.
  //
  // Mirrors the Brief/Recap route pair's shape (context fetch → canonical id
  // → hashContext → store lookup/write) but is neither: the store is
  // task-keyed with no TTL (an unanswered ruling must never silently expire,
  // unlike the 7-day brief/recap caches), and a scan additionally carries a
  // fail-closed Principle 0 gate and an outcome (dismiss) write path.
  // ===========================================================================

  // The canonical id dismiss and unretire act on. When `:issueId` is already
  // UUID-shaped it IS the canonical id — `markOutcome` filters on `{_id, urlKey,
  // issueId}`, so the row's own stored key is the authority and there is no reason
  // to pay for a provider context fetch just to re-derive an id already in hand.
  // This also fixes the trashed/deleted-task case: a stale ruling on a task the
  // provider can no longer fetch could previously never be dismissed (the fetch
  // 404s before `markOutcome` is ever reached). A non-UUID `:issueId` (an
  // identifier, or a caller that hasn't been updated to pass the canonical id
  // GET/POST scan now return) still resolves it via the context fetch. Returns
  // null after replying when it cannot be resolved.
  const resolveCanonicalScanId = async (req, res, workspace, issueId) => {
    if (UUID_REGEX.test(issueId)) return issueId;

    const binding = resolveIssueBinding(workspace, req.query.source);
    if (!binding.provider.supports('fetchRecommendationContext')) {
      refuseCapability(res, binding.provider.name, 'fetchRecommendationContext', 'scan for this issue');
      return null;
    }

    const subject = await loadScanSubject(workspace, issueId, binding);
    if (subject.refusal) {
      jsonError(res, ...subject.refusal);
      return null;
    }
    return subject.canonicalId;
  };

  /**
   * GET scan status. `fresh` means the stored row matches the task's CURRENT
   * content hash (so it agrees with what a POST scan would return right now,
   * including any terminal outcome); `stale` means a row exists but for
   * different content (a re-scan is needed to know the current state);
   * `missing` means this task has never been scanned.
   *
   * @route GET /workspace/:urlKey/api/scan/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', decision?, outcome?, outcomeAt?, scannedAt?, id?, issueId?, basisChanged? } —
   *   `basisChanged` (LIN-2241) rides on the `fresh` and `stale` shapes only,
   *   never on `missing`: tri-state, `true`/`false`/`null`, where `null` means
   *   the question could not be answered (no recorded basis, or one from a
   *   different BASIS_VERSION) and must never be read as `false`.
   *   `stale` carries the same decision fields as `fresh` (LIN-2211): the row is still a live,
   *   answerable/dismissable ruling, only the content hash has moved, so a caller must not treat
   *   `stale` as a bare `{status, scannedAt}` shape.
   */
  router.get('/workspace/:urlKey/api/scan/:issueId', workspaceFromUrl, async (req, res) => {
    const issue = openIssue(req, res, { store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return jsonError(res, ...subject.refusal);
      const { context, canonicalId } = subject;

      const inputHash = hashContext(context);
      const cached = await taskDecisionsStore.getStatus(workspace.urlKey, canonicalId, inputHash);

      if (!cached) {
        return res.json({ status: 'missing' });
      }
      // LIN-2241 tier 1: `status` and `basisChanged` answer DIFFERENT questions
      // and are deliberately both reported rather than collapsed. `status:
      // 'stale'` means the stored row is not for this exact content — it moves
      // on a label edit, because `inputHash`/`hashContext` carries labels
      // (lib/recap-cache.js:54). `basisChanged: true` means the content the
      // ruling's judgement actually rests on has moved, which is the signal
      // acceptance criterion 1 requires be free of that nuisance. A row can
      // therefore be `stale` with `basisChanged: false` — relabelled, same
      // question — and that combination is the point, not a contradiction.
      //
      // This route is the ONE producer of the signal, and it is deliberately
      // the live-content path: it already holds a fresh
      // `fetchRecommendationContext`, so the comparison is exact and costs no
      // call this handler was not already making. Both consumers — the
      // per-task scan panel (public/scan.js, which already polls this route)
      // and the rulings card (public/observation.js, on demand when the tab is
      // open) — read it from here rather than re-deriving it, so there is no
      // second, approximate implementation to drift.
      const basisChanged = computeBasisChanged({
        raisedBasisHash: cached.basisHash,
        raisedBasisVersion: cached.basisVersion,
        currentBasisHash: scanBasisHashFromContext(context)
      });
      return res.json({
        status: cached.inputHash !== inputHash ? 'stale' : 'fresh',
        ...scanRow(cached),
        basisChanged
      });
    } catch (error) {
      console.error('Scan GET error:', error);
      jsonError(res, ...failureOf(error, 'Failed to fetch scan status'));
    }
  });

  /**
   * POST scan: triage this task for an operator-worthy decision. Always
   * calls the LLM (force-regenerate semantics, matching the recap/brief POST
   * routes) — idempotency lives in the STORED `_id` (content-hash-keyed), not
   * in skipping the call. A stored terminal (answered/dismissed) row for the
   * current content is never overwritten by a fresh call (see
   * TaskDecisionsStore.recordScan); everything else about the found-vs-not
   * outcome is decided by lib/scan.js's fail-closed Principle 0 gate and
   * strict parse/validation, not by this route.
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId
   * @returns {Object} { status: 'fresh', id, issueId, decision, scannedAt, outcome, outcomeAt, model }
   */
  router.post('/workspace/:urlKey/api/scan/:issueId', workspaceFromUrl, async (req, res) => {
    const issue = openIssue(req, res, { store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    // LIN-3126 residual / LIN-3335: persist the validated kind-only `issueSource`
    // onto the durable scan row so a later rulings anchor
    // (lib/unanswered-decisions.js) and a scan-due item can hand the browser the
    // issue's own provider. Only a non-blank source is stored — a legacy scan
    // adds no key (sparse, byte-identical).
    const scanBindingPair = (
      typeof req.query.source === 'string' && req.query.source.trim()
    )
      ? { issueSource: req.query.source.trim() }
      : {};

    // See the recap/brief POST notes: `isTestMode` gates the DATA mock,
    // `mockAi` the AI mock (incl. local-provider sessions), and the
    // AI-config/free-tier guards.
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'scan');
    }

    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return keepaliveError(keepalive, ...subject.refusal);
      const { context, canonicalId } = subject;

      const inputHash = hashContext(context);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'scan', forceDefault: isFreeTier });

      let scanResult;
      let modelUsed;
      if (mockAi) {
        // The mock ALSO goes through parseScanResponse (unlike buildMockBrief/
        // buildMockRecap, which bypass their own parse layer) — this feature's
        // whole premise is strict, uniform validation, so a mock response must
        // prove out the same has_decision/isClaimedDecisionValid/parseDecision
        // gate a real one does, not a shortcut around it.
        scanResult = parseScanResponse(buildMockScanText(context), { issueId: canonicalId, inputHash });
        modelUsed = selectedModel;
      } else {
        const generated = await generateScan(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel, issueId: canonicalId, inputHash, callMeta: { urlKey: workspace?.urlKey } }
        );
        scanResult = generated;
        modelUsed = generated.model;
      }

      if (scanResult.outcome === 'fail-closed') {
        // Never send a scan prompt without the Principle 0 gate — and never
        // persist anything when it was skipped, since nothing was actually
        // evaluated (a stored zero-finding here would be a false "found
        // nothing", exactly what this feature exists to prevent).
        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {
          code: 'PRINCIPLE_ZERO_UNAVAILABLE'
        });
      }
      if (scanResult.outcome === 'error') {
        // A claimed decision that failed validation, or an unparseable
        // response: persists nothing and asks the operator to retry, rather
        // than risk silently downgrading a real ruling into a zero-finding.
        return keepaliveError(keepalive, 502, 'Scan produced an unusable response; please retry', {
          code: 'SCAN_PARSE_FAILED'
        });
      }

      // LIN-2649 WS2: [C-3] scan-time ledger-store null guard (see recordedByHarbour).
      const recordedCommentIds = await recordedByHarbour(workspace, context.comments);

      // 'decision' or 'zero-finding' — both are normal, persisted outcomes.
      const record = await taskDecisionsStore.recordScan({
        urlKey: workspace.urlKey,
        issueId: canonicalId,
        issueIdentifier: context.issue?.identifier || issueId,
        // LIN-3983 PR 2: the title the Rulings row names its task by (the scan context carries
        // the issue's own title; a row without one keeps the id alone).
        issueTitle: context.issue?.title || null,
        inputHash,
        // LIN-2241 tier 1. A SECOND, narrower digest — `inputHash` stays the
        // row's identity (buildId → `_id`, and lib/scan.js's decision_id), so
        // it is never narrowed in place; this one records the content the
        // ruling is raised FROM, so a later reader can tell whether that basis
        // has since moved without spending a model call.
        basisHash: scanBasisHashFromContext(context),
        basisVersion: BASIS_VERSION,
        // LIN-2649 WS2: a THIRD, additive digest — the same projection as
        // basisHash with Harbour-ledger-recorded comments filtered out, for
        // "is this scanned task worth spending another scan on?" rather than
        // "has a pending ruling's basis moved?". Computed in the SAME request
        // from the SAME context as basisHash above, so a scan always stores
        // both hashes together and there is exactly one write path to keep
        // in sync.
        dueBasisHash: dueBasisHashFromContext(context, { recordedCommentIds }),
        // LIN-2665 L1: dueBasisHash's OWN version field, never shared with
        // tier-1's basisVersion above — see lib/task-decisions-store.js's
        // [F-2] terminal-row patch for why the split is load-bearing.
        dueBasisVersion: BASIS_VERSION,
        decision: scanResult.outcome === 'decision' ? scanResult.decision : null,
        // LIN-3126 residual: the issue's own binding pair, stored only when a
        // complete validated selector was supplied (see `scanBindingPair`).
        ...scanBindingPair
      });
      if (!record) {
        return keepaliveError(keepalive, 500, 'Failed to record scan result');
      }

      keepalive.send(200, { status: 'fresh', ...scanRow(record), model: modelUsed });
    } catch (error) {
      keepaliveFailure(keepalive, 'Scan POST error:', error, 'Failed to run scan', { openRouter: true });
    }
  });

  /**
   * POST dismiss: stamp a specific scan row 'dismissed' — the operator has
   * seen this ruling and does not want it counted as an outstanding
   * decision. Idempotent (TaskDecisionsStore.markOutcome: first stamp wins),
   * so a double-submit can never flip an already-answered row into
   * 'dismissed'. Requires the exact record `id` from a prior GET/POST scan
   * response, not just the task's issueId, so a stale client can't
   * accidentally dismiss whatever happens to be current server-side.
   *
   * LIN-2197 Phase 5 (Phase 4 close-out ledger item L3): the canonical id comes
   * from resolveCanonicalScanId (UUID fast path; a context fetch otherwise).
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/dismiss
   * @returns {Object} { status: 'fresh', id, issueId, decision, outcome, outcomeAt, scannedAt }
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/dismiss', workspaceFromUrl, json(), async (req, res) => {
    const found = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', bind: false });
    if (!found) return;
    const { workspace, issueId, recordId } = found;

    try {
      const canonicalId = await resolveCanonicalScanId(req, res, workspace, issueId);
      if (!canonicalId) return;

      const record = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: canonicalId, id: recordId, outcome: 'dismissed'
      });
      if (!record) {
        return notFound.json(res, 'Scan record not found');
      }
      // LIN-2755: uniform invalidation on every ruling write — taskDecisionsStore
      // is read live (not cached), so this is defensive/uniform rather than
      // fixing an observable staleness bug.
      if (sessionsFeedCache) sessionsFeedCache.clear(workspace.urlKey);

      return res.json({ status: 'fresh', ...scanRow(record) });
    } catch (error) {
      console.error('Scan dismiss error:', error);
      jsonError(res, ...failureOf(error, 'Failed to dismiss scan result'));
    }
  });

  /**
   * POST retire (LIN-2650 WS4): re-scan a task SERVER-SIDE and, only if that
   * fresh check finds an EXPLICIT, well-formed "nothing pending" signal,
   * stamp the row named in the request body 'self-resolved'. Never trusts a
   * client-supplied verdict — the ONLY input to the retirement decision is
   * the raw text THIS call's own re-scan produces.
   *
   * Deliberately does NOT call `generateScan`/`recordScan` (John's
   * option-(a) ruling: no second row). It reuses POST scan's first three
   * steps verbatim (provider/capability resolution, `fetchRecommendationContext`,
   * `hashContext`) and then diverges: `buildScanMessages` (same fail-closed
   * discipline as raising) → `streamChat` directly for the raw model text →
   * `isExplicitRetirementSignal(raw)`, never `generateScan`'s own
   * `has_decision !== true` collapse, which is right for raising and wrong
   * for retiring (see `lib/scan.js`). Carries the SAME `mockAi` branch POST
   * scan does, so mock-mode tests can reach both signal shapes deterministically.
   *
   * `markOutcome`'s three return shapes map to three distinct responses —
   * fail loud, never a silent no-op, on a row that changed underneath this
   * call:
   *   - `null` (row pruned/replaced, `_pruneToCapacity` or a superseding
   *     scan) → 404 `ROW_GONE`
   *   - a record with `outcome !== 'self-resolved'` (first-stamp-wins caught
   *     an already-terminal row — reachable without any client bug, since
   *     this route's OWN re-scan runs before its `markOutcome` call, leaving
   *     a window for a dismiss/answer/earlier-retire to land first) → 409
   *     `ALREADY_TERMINAL`
   *   - a record with `outcome === 'self-resolved'` (the write happened) →
   *     200, success shape
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/retire
   * @body {string} id - the existing row's `_id`, from a prior GET/POST scan result
   * @returns {Object} 200 `{ retired: true, id, issueId, decision, outcome: 'self-resolved',
   *   outcomeAt, outcomeReason, outcomeBasisHash, scannedAt }` on retirement;
   *   200 `{ retired: false, reason }` when the rescan found nothing to retire;
   *   404 `ROW_GONE` / 409 `ALREADY_TERMINAL` on a row that can't be (or
   *   wasn't) stamped; 502 `SCAN_PARSE_FAILED` on a genuine parse/model
   *   failure; 503 `PRINCIPLE_ZERO_UNAVAILABLE` fail-closed — same shapes
   *   POST scan already uses for the latter two.
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/retire', workspaceFromUrl, json(), async (req, res) => {
    const issue = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId, recordId } = issue;

    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'scan');
    }
    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // Retire always re-scans, so — unlike dismiss's UUID fast path — it needs
    // fresh content every time, never just the stored row.
    const keepalive = armKeepalive(res);
    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return keepaliveError(keepalive, ...subject.refusal);
      const { context, canonicalId } = subject;

      const inputHash = hashContext(context);
      const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'scan-retire', forceDefault: isFreeTier });

      // The raw text of THIS call's own re-scan is the only input to the
      // retirement decision — nothing the client sent, which is just the row `id`.
      const rescanned = mockAi
        ? buildMockScanText(context)
        : await rawRetireRescan({ context, workspace, apiKey: apiKeyToUse, model });
      if (rescanned === null) {
        // Same fail-closed discipline as raising: no scan prompt without the
        // Principle 0 gate, and the row is untouched when it was skipped.
        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {
          code: 'PRINCIPLE_ZERO_UNAVAILABLE'
        });
      }

      if (!isExplicitRetirementSignal(rescanned)) {
        keepalive.stop();
        // A genuine parse/model failure: the same shape POST scan uses.
        if (extractScanPayload(rescanned).payload === null) {
          return keepaliveError(keepalive, 502, 'Scan produced an unusable response; please retry', { code: 'SCAN_PARSE_FAILED' });
        }
        // A live decision, or absent/malformed input alike — all four of the
        // ticket's negative cases collapse to "leave it standing".
        return keepalive.send(200, { retired: false, reason: 'The rescan did not find an explicit "nothing pending" signal — the ruling stands.' });
      }

      const record = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: canonicalId, id: recordId,
        outcome: 'self-resolved',
        outcomeReason: `Retired automatically: a rescan on ${new Date().toISOString()} found no pending decision.`,
        // The same formula as `inputHash`, over the SAME context: "what was
        // checked when this was retired", not a fourth hash scheme.
        outcomeBasisHash: inputHash
      });

      keepalive.stop();
      const unstamped = !record ? RETIRE_ROW_GONE : record.outcome !== 'self-resolved' ? RETIRE_ALREADY_TERMINAL : null;
      if (unstamped) return keepaliveError(keepalive, ...unstamped);

      // LIN-2755: uniform invalidation on every ruling write, only past the race
      // check above (this call's own write must have landed). The store is read
      // live, so this is defensive rather than a fix for observable staleness.
      sessionsFeedCache?.clear(workspace.urlKey);
      return keepalive.send(200, { retired: true, ...scanRow(record, { raw: true }) });
    } catch (error) {
      keepaliveFailure(keepalive, 'Scan retire error:', error, 'Failed to retire scan result', { openRouter: true });
    }
  });

  /**
   * POST unretire (LIN-2650 WS4): reverse a 'self-resolved' outcome, over
   * `reverseOutcome`'s fail-loud thrown-error contract. No re-scan, no LLM
   * call — this route's only job is the reverse write, so it mirrors
   * dismiss's canonical-id resolution (UUID fast path; a context fetch only
   * for a non-UUID `:issueId`), not retire's always-fresh-context shape.
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/unretire
   * @body {string} id - the row's `_id`
   * @returns {Object} 200 `{ status: 'fresh', id, issueId, decision, outcome: null,
   *   outcomeAt: null, outcomeReason: null, outcomeBasisHash: null, scannedAt }`;
   *   404 `ROW_GONE` when the row is pruned/replaced; 409 `NOT_SELF_RESOLVED`
   *   when it isn't currently self-resolved.
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/unretire', workspaceFromUrl, json(), async (req, res) => {
    const found = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', bind: false });
    if (!found) return;
    const { workspace, issueId, recordId } = found;

    try {
      const canonicalId = await resolveCanonicalScanId(req, res, workspace, issueId);
      if (!canonicalId) return;

      const record = await taskDecisionsStore.reverseOutcome({ urlKey: workspace.urlKey, issueId: canonicalId, id: recordId });
      // LIN-2755: uniform invalidation on every ruling write — reverseOutcome's
      // fail-loud contract means reaching here is already a genuine success
      // (a failure throws, caught below, never invalidating). taskDecisionsStore
      // is read live (not cached), so this is defensive/uniform rather than
      // fixing an observable staleness bug.
      if (sessionsFeedCache) sessionsFeedCache.clear(workspace.urlKey);

      return res.json({ status: 'fresh', ...scanRow(record, { raw: true }) });
    } catch (error) {
      if (error.message === 'reverseOutcome: row not found (pruned or replaced)') {
        return jsonError(res, 404, 'This ruling no longer exists — it may have been pruned or superseded by a newer scan', { code: 'ROW_GONE' });
      }
      if (error.message === 'reverseOutcome: row is not self-resolved') {
        return jsonError(res, 409, 'This ruling is not currently self-resolved and cannot be un-retired', { code: 'NOT_SELF_RESOLVED' });
      }
      console.error('Scan unretire error:', error);
      jsonError(res, ...failureOf(error, 'Failed to un-retire scan result', { notFound: false }));
    }
  });

  /**
   * GET paginated scan-due candidates for a workspace (LIN-2649 WS2/S3): which
   * already-scanned tasks have had their DUE-basis content move since they
   * were last scanned, checked on demand against live provider reads. Pages
   * ACROSS every distinct scanned issueId in the workspace via
   * `taskDecisionsStore.listCandidatesForWorkspace` (keyset-ordered
   * `(scannedAt asc, issueId asc)`), unlike the single-task scan routes above
   * — but reuses this file's same resolve-then-gate capability convention and
   * keepalive precedent.
   *
   * Do not reopen: page size, concurrency, ordering, response shape and the
   * ledger-exclusion rule are the parent LIN-2241/LIN-2649 plan's settled
   * design (LIN-2666).
   *
   * @route GET /workspace/:urlKey/api/scan-due
   * @query {string} [cursor] - opaque base64url-JSON `{scannedAt,issueId}` keyset position;
   *   absent starts at the beginning of the ordering. A decodable-but-stale cursor
   *   (naming a pair no longer present) is NOT an error — the keyset `>` comparison
   *   resumes from the nearest later point.
   * @query {string} [source] - provider binding override, same convention as the routes above
   * @returns {Object} { items, nextCursor, pageCandidateCount, totalCandidateCount } —
   *   `items[]`: { issueId, issueIdentifier, dueStatus: true|false|null, error?: true }.
   *   `dueStatus` is exactly `true`/`false`/`null`; `error` is an orthogonal flag set only
   *   on a per-candidate provider-read failure, never folded into `dueStatus`.
   *   `nextCursor` is the SAME opaque base64url-JSON string the `cursor` query param
   *   above accepts — emitted and accepted are identical, replay it verbatim as
   *   `?cursor=<nextCursor>`; `null` on the last page. (Its inverse decode is above,
   *   at the top of the handler.)
   */
  router.get('/workspace/:urlKey/api/scan-due', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    // LIN-3240 / LIN-3335: scan-due is a WORKSPACE-LEVEL batch (no :issueId).
    // It uses the source-only default binding, so it never 422s for ambiguity.
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, null);

    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }
    // [F-4] Capability gate — once per request, BEFORE any store read or
    // provider call: a provider without fetchRecommendationContext fails the
    // WHOLE page with one clean 422, instead of DUE_CHECK_PAGE_SIZE candidates
    // each 422ing individually. Same resolve-then-gate convention as the scan
    // routes above (and the recommend/recap/brief routes elsewhere in this file).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return refuseCapability(res, issueProvider.name, 'fetchRecommendationContext', 'scan-due checks');
    }

    // Parse the opaque keyset cursor BEFORE any store call. Anything present
    // that fails to decode/parse, or decodes to the wrong shape, is a 400 —
    // a stale-but-decodable cursor is handled entirely inside
    // listCandidatesForWorkspace's keyset comparison, not here.
    let cursor = null;
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== 'string') throw new Error('cursor must be a string');
        const decoded = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
        if (!decoded || typeof decoded !== 'object' || typeof decoded.scannedAt !== 'string' || typeof decoded.issueId !== 'string') {
          throw new Error('cursor has the wrong shape');
        }
        cursor = { scannedAt: decoded.scannedAt, issueId: decoded.issueId };
      } catch {
        return jsonError(res, 400, 'Invalid cursor', { code: 'INVALID_CURSOR' });
      }
    }

    // Force-regenerate-per-candidate always spends up to DUE_CHECK_PAGE_SIZE
    // provider reads; arm a Heroku H12 guard around the store read + fan-out.
    const keepalive = armKeepalive(res);
    try {
      const page = await taskDecisionsStore.listCandidatesForWorkspace(workspace.urlKey, { cursor, limit: DUE_CHECK_PAGE_SIZE });

      // LIN-3126 residual / LIN-3335: the row's own kind-only source, recorded when it
      // was scanned, rides the item so the client's bulk-scan POST can forward it
      // (public/observation.js startDueBulkScan). SPARSE — a row with no source emits no key.
      const sourceOf = (row) => (row.issueSource != null ? { source: row.issueSource } : {});

      const results = await settleWithConcurrency(page.items, DUE_CHECK_CONCURRENCY, async (row) => {
        const context = await issueProvider.fetchRecommendationContext(issueCallScope, row.issueId);
        // LIN-2649 WS2 null-ledger guard — this route's second call site of
        // recordedByHarbour: a false DUE at worst, never a false not-due.
        const recordedCommentIds = await recordedByHarbour(workspace, context.comments);
        const currentDueBasisHash = dueBasisHashFromContext(context, { recordedCommentIds });
        return {
          issueId: row.issueId,
          issueIdentifier: row.issueIdentifier,
          dueStatus: dueChanged({
            raisedDueBasisHash: row.dueBasisHash,
            raisedDueBasisVersion: row.dueBasisVersion,
            currentDueBasisHash
          }),
          ...sourceOf(row),
        };
      });

      // Per-item failure isolation: one candidate's provider read rejecting
      // (after the page-level capability check already passed) contributes
      // {dueStatus: null, error: true} for THAT row only — settleWithConcurrency's
      // allSettled shape means every other row and the page's 200 are unaffected.
      const items = results.map((result, i) => result.status === 'fulfilled'
        ? result.value
        : {
            issueId: page.items[i].issueId,
            issueIdentifier: page.items[i].issueIdentifier,
            dueStatus: null,
            error: true,
            ...sourceOf(page.items[i])
          });

      keepalive.send(200, {
        items,
        // Symmetric with the cursor decode above (N-A discharge, LIN-2667):
        // emit the SAME base64url-JSON string the `cursor` param accepts, so a
        // client replays it verbatim. Conditional — an unconditional encode
        // would turn a last-page `null` into the string "bnVsbA".
        nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null,
        pageCandidateCount: page.items.length,
        totalCandidateCount: page.totalCandidateCount
      });
    } catch (error) {
      console.error('Scan-due GET error:', error);
      keepaliveError(keepalive, 500, 'Failed to fetch scan-due candidates', { message: error.message });
    } finally {
      // Always stop, on the success path, on a settleWithConcurrency rejection
      // (defensive — its allSettled shape shouldn't reject), and on any
      // synchronous throw before the response is sent.
      keepalive.stop();
    }
  });
}
