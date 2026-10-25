/**
 * Group E write routes (LIN-679 Stage 3b / LIN-2537: extracted from
 * routes/proxy.js; rebuilt design-first in LIN-3573 / LIN-3576).
 *
 * Consumer-API write endpoints: POST /issues, PATCH /issues/:issueId,
 * description append/replace, comments create/delete/patch, attachments
 * upload, relations create/delete, labels add/remove.
 *
 * Shape. Every route is one literal registration whose handler runs through
 * `guarded(spec, handler)`, which owns the part they all share, in this order:
 * optional pre-resolve validation, credential/provider resolution, the 503 for an
 * unresolvable workspace, the capability gate, the optional issue-id format
 * check, the handler, and one mapped catch. The per-route facts that differ
 * (log endpoint, capability, `?source=` policy, id-check logging, failure
 * message, which typed errors map) are the `SPEC` table below, not code.
 *
 * Deliberately preserved irregularities (no comment, doc or test warrants
 * normalising them, so they are written down here instead of tidied):
 *  - Unlogged 4xx exits are marked `log: false` at the exit: the invalid-issueId
 *    400s on comment create/delete/edit, relation create/delete and label
 *    add/remove; the comment body type/character/length 400s; the relatedIssueId
 *    400; and the field-validation 400s on create/update.
 *  - Order deviations: append/replace validate their body BEFORE resolving
 *    (a 400 beats a 503); labels resolve the label ref before the trashed read;
 *    comment create refuses a trashed target before its dedupe lookup; the
 *    attachments `target` check runs after the 503 and the uploadFile gate.
 *  - Two null-issue policies: a missing issue PROCEEDS for the write guard (the
 *    provider's own not-found maps to the usual status) and is a 404 for the
 *    description and label reads, which feed the write.
 *  - Attachments with a description target re-resolve, re-check updateIssue and
 *    re-read the description inside the description pipeline.
 */
import { Router, json } from 'express';
import { dedupeKey } from '../lib/proxy-dedupe.js';
import { graphqlErrorExtra, graphqlErrorDetail, normalizeWritePayload } from '../lib/proxy-graphql-errors.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  DANGEROUS_CHARS_REGEX,
  isValidPriority,
  validateIssueWriteFields,
  validateCommentBody,
} from '../lib/issue-write-validation.js';
import { canonicalPriorityToLinear } from '../lib/providers/models.js';
import { isTrashed } from '../lib/trashed-signal.js';
import { checkPeriodicalReportGate } from '../lib/periodical-report-gate.js';
import { extractPeriodicalGateId } from '../lib/periodicals.js';
import { flattenIssue, MAX_ATTACHMENT_BYTES } from '../lib/proxy-wire.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import { appendBlock, replace as replaceInDescription, DescriptionEditError } from '../lib/description-edit.js';
import { jsonError } from '../lib/errors.js';
import { parseFeedbackImage } from '../lib/attachment-upload.js';

const TRASHED_MESSAGE = 'Issue is trashed; refusing to modify a deleted issue';
const BAD_ISSUE_ID = 'Invalid issue ID format';
const COMMENT_TOO_LONG = `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`;
const RELATION_TYPES = ['blocks', 'blocked-by', 'duplicate', 'related'];

// Body-size exception, scoped to the attachments route only (mirrors the feedback
// route's own parser, routes/workspace-api-feedback.js): the global
// `express.json({ limit: '250kb' })` (server.js) only matches
// `application/json`, so a caller sending the base64 image payload with a
// non-JSON content type (e.g. `text/plain`) passes through it unparsed; this
// permissive parser (raised limit) then parses it. A small `application/json`
// body is already parsed by the global parser by the time it gets here —
// body-parser no-ops on an already-parsed body — so it keeps the 250kb
// ceiling and this exception cannot leak to other routes.
const ATTACHMENT_UPLOAD_BODY_LIMIT = '14mb'; // ~4/3 base64 expansion of MAX_ATTACHMENT_BYTES + JSON overhead
// Stand-in for the `![](assetUrl)` markdown before the real assetUrl exists
// (it's only returned by uploadFile itself): comfortably covers "![]()" (4
// chars) plus a real Linear asset URL, so the pre-upload estimate never passes
// a body that the real embed would then push over the limit.
const ATTACHMENT_EMBED_RESERVE = 200;

/**
 * Per-route facts the shared wrapper needs.
 *  - endpoint: the string every logEvent / capability / 503 refusal reports.
 *  - needs: the provider capability gated right after resolution (422 otherwise).
 *  - source: true forwards `?source=` to credential resolution (LIN-3335: kind-only
 *    routing; a refactor once dropped it and Jira-bound writes went to Linear);
 *    false ignores it (POST /issues has no issue to route by).
 *  - issueId: 'logged' | 'silent' — validate :issueId right after the capability
 *    gate and say whether that 400 is logged; absent when the handler orders the
 *    check itself (attachments).
 *  - failure / label: the mapped catch's envelope message and console label.
 *  - refs / partial: which typed provider errors the catch maps. RefResolutionError
 *    and PartialWriteError are thrown only by the resolve*Input closures and by
 *    updateIssue, so only the routes that call those map them.
 *  - pre: validation that runs before any resolution.
 */
const SPEC = {
  createIssue: { endpoint: '/api/proxy/issues', needs: 'createIssue', source: false, failure: 'Failed to create issue', label: 'create issue', refs: true },
  updateIssue: { endpoint: '/api/proxy/issues/:id', needs: 'updateIssue', source: true, issueId: 'logged', failure: 'Failed to update issue', label: 'update issue', refs: true, partial: true },
  appendDescription: { endpoint: '/api/proxy/issues/:id/description/append', needs: 'updateIssue', source: true, issueId: 'logged', failure: 'Failed to update description', label: 'description edit', refs: true, partial: true },
  replaceDescription: { endpoint: '/api/proxy/issues/:id/description/replace', needs: 'updateIssue', source: true, issueId: 'logged', failure: 'Failed to update description', label: 'description edit', refs: true, partial: true },
  createComment: { endpoint: '/api/proxy/issues/comments', needs: 'createComment', source: true, issueId: 'silent', failure: 'Failed to create comment', label: 'create comment' },
  deleteComment: { endpoint: '/api/proxy/issues/comments', needs: 'deleteComment', source: true, issueId: 'silent', failure: 'Failed to delete comment', label: 'delete comment' },
  updateComment: { endpoint: '/api/proxy/issues/comments', needs: 'updateComment', source: true, issueId: 'silent', failure: 'Failed to update comment', label: 'update comment' },
  attachment: { endpoint: '/api/proxy/issues/:id/attachments', needs: 'uploadFile', source: true, failure: 'Failed to upload attachment', label: 'attachment upload' },
  createRelation: { endpoint: '/api/proxy/issues/relations', needs: 'createRelation', source: true, issueId: 'silent', failure: 'Failed to create relation', label: 'create relation' },
  deleteRelation: { endpoint: '/api/proxy/issues/relations', needs: 'deleteRelation', source: true, issueId: 'silent', failure: 'Failed to delete relation', label: 'delete relation' },
  addLabel: { endpoint: '/api/proxy/issues/labels', needs: 'addLabel', source: true, issueId: 'silent', failure: 'Failed to add label', label: 'add label', refs: true },
  removeLabel: { endpoint: '/api/proxy/issues/labels', needs: 'removeLabel', source: true, issueId: 'silent', failure: 'Failed to remove label', label: 'remove label', refs: true },
};

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Object} deps.commentDedupe - Short-window comment create dedupe cache (module-scope singleton in routes/proxy.js; injected, NOT re-exported here — the dependency stays one-way, proxy.js -> proxy-writes.js)
 * @param {Object} deps.commentDedupeGenerations - Per-workspace generation tracker invalidating commentDedupe entries on delete/edit (module-scope singleton in routes/proxy.js; injected, same one-way rule as commentDedupe)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.requireWriteScope - readWrite-scope gate middleware (closure-local)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.denyIfMissingRead - Capability gate for an internal read a write handler depends on; 422s when absent (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local)
 * @param {Function} deps.writeRejected - 4xx envelope for a provider write that reports non-success (closure-local)
 * @param {Function} deps.resolveTeamInput - Symbolic-or-UUID team ref resolver (closure-local)
 * @param {Function} deps.resolveStateInput - Symbolic-or-UUID state ref resolver, team-scoped (closure-local)
 * @param {Function} deps.resolveProjectInput - Symbolic-or-UUID project ref resolver (closure-local)
 * @param {Function} deps.resolveLabelInput - Symbolic-or-UUID label ref resolver (closure-local)
 * @param {Function} deps.refResolutionFailed - Maps a RefResolutionError to its own 422 (closure-local)
 * @param {Function} deps.partialWriteFailed - Maps a PartialWriteError (write landed, confirmation re-read failed) to its own envelope (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Object} [deps.harbourCommentsStore] - Durable (urlKey, commentId) ledger (LIN-2648); best-effort record at each createComment seam, never gates the response
 * @param {Function} [deps.onTicketWrite] - Optional ticket-closed closer seam (LIN-3366), fire-and-forget; never changes a response
 * @param {Function} [deps.recordPipelineMerge] - Optional merged-PR recorder (LIN-3756), fired once beside seam 1 for a state write; fire-and-forget, never changes a response
 */
export function createProxyWriteRoutes({
  proxyLimiter,
  commentDedupe,
  commentDedupeGenerations,
  authenticateProxyToken,
  requireWriteScope,
  resolveProviderAccess,
  denyIfUnsupported,
  denyIfMissingRead,
  workspaceUnavailable,
  graphqlErrorStatus,
  writeRejected,
  resolveTeamInput,
  resolveStateInput,
  resolveProjectInput,
  resolveLabelInput,
  refResolutionFailed,
  partialWriteFailed,
  logEvent,
  harbourCommentsStore = null,
  onTicketWrite = null,
  recordPipelineMerge = null,
}) {
  const router = Router();
  const writeAuth = [proxyLimiter, authenticateProxyToken, requireWriteScope];

  // ---------------------------------------------------------------------------
  // Shared steps
  // ---------------------------------------------------------------------------

  /**
   * Send an error envelope; `log: false` marks the exits that have never logged.
   * Always returns true so a caller can `return refuse(...)`.
   */
  function refuse({ req, res, endpoint }, status, message, { log = true, ...extra } = {}) {
    if (log) logEvent(req, endpoint, status);
    jsonError(res, status, message, extra);
    return true;
  }

  /** The mapped catch: typed provider errors (where the route maps them), then the generic envelope. */
  function fail({ req, res, endpoint }, err, { failure, label, refs, partial }) {
    if (refs && refResolutionFailed(req, res, endpoint, err)) return;
    if (partial && partialWriteFailed(req, res, endpoint, err)) return;
    const status = graphqlErrorStatus(err, req);
    logEvent(req, endpoint, status);
    console.error(`Proxy ${label} error:`, err.message);
    jsonError(res, status, failure, { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
  }

  /** Resolve credentials/provider, then the 503 and the capability gate. Null once a response has been sent. */
  async function open(req, res, spec) {
    const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, spec.source ? { source: req.query?.source } : undefined);
    if (!token) {
      workspaceUnavailable(req, res, spec.endpoint, reason);
      return null;
    }
    if (denyIfUnsupported(provider, spec.needs, req, res, spec.endpoint)) return null;
    return { req, res, endpoint: spec.endpoint, token, provider };
  }

  /** One route's handler: see the module docblock for the order. */
  function guarded(spec, handler) {
    return async (req, res) => {
      if (spec.pre?.({ req, res, endpoint: spec.endpoint })) return;
      try {
        const ctx = await open(req, res, spec);
        if (!ctx) return;
        if (spec.issueId && !isValidIssueId(req.params.issueId)) {
          refuse(ctx, 400, BAD_ISSUE_ID, { log: spec.issueId === 'logged' });
          return;
        }
        await handler(ctx);
      } catch (err) {
        fail({ req, res, endpoint: spec.endpoint }, err, spec);
      }
    };
  }

  /**
   * Read the write target through `read` (a provider read the write depends on) and
   * refuse a trashed one (LIN-401). Returns `{ issue }` to proceed, or null once a
   * response has been sent. `onNull` is the missing-issue policy: 'proceed' lets the
   * write run so the provider's own not-found maps to the usual status, 'notFound'
   * answers 404 because the read feeds the write. `refuseTrashed: false` is the
   * attachments length pre-check, which has already refused a trashed target.
   */
  async function guardTarget(ctx, read, { onNull, refuseTrashed = true }) {
    const { req, res, endpoint, token, provider } = ctx;
    if (denyIfMissingRead(provider, read, req, res, endpoint)) return null;
    const issue = await provider[read](token, req.params.issueId);
    if (!issue && onNull === 'notFound') {
      refuse(ctx, 404, 'Issue not found');
      return null;
    }
    if (refuseTrashed && isTrashed(issue)) {
      refuse(ctx, 409, TRASHED_MESSAGE);
      return null;
    }
    return { issue };
  }

  /** Fire-and-forget ticket-closer seam (LIN-3366) once the response is out. */
  function afterResponse(seam, run) {
    if (!onTicketWrite) return;
    void Promise.resolve()
      .then(run)
      .catch(e => console.error(`[ticket-closer] seam ${seam} failure:`, e?.message || e));
  }

  /**
   * Best-effort Harbour-comments ledger record (LIN-2648, WS1 of LIN-2241): one
   * attempt, caught and logged, never propagated, never retried. The comment
   * already succeeded and is the durable half of the write; a ledger failure must
   * never fail it. Also used to repair a dedupe hit (LIN-2649 S1, F2): the
   * original create's own attempt may have failed silently, and the upsert is
   * idempotent.
   */
  async function recordInLedger(req, payload, what) {
    if (!harbourCommentsStore) return;
    try {
      const commentId = payload.comment?.id;
      if (commentId) await harbourCommentsStore.record({ urlKey: req.proxyUrlKey, commentId });
    } catch (ledgerErr) {
      console.error(`Harbour-comments ledger ${what} failed:`, ledgerErr.message);
    }
  }

  /** Create a comment and answer 201; `remember` sees the payload once the write is accepted. */
  async function postComment({ req, res, endpoint, token, provider }, text, remember) {
    const created = normalizeWritePayload(await provider.createComment(token, req.params.issueId, text), 'comment');
    // A clear failure instead of a misleading 201 when the provider reports the write did not land.
    if (writeRejected(req, res, endpoint, created, 'Comment was not created')) return;
    remember?.(created);
    await recordInLedger(req, created, 'record');
    logEvent(req, endpoint, 201);
    res.status(201).json(created);
  }

  /** Comment create/edit body: shared validator first, then the length check (LIN-2154). */
  function refuseBadCommentBody(ctx, body) {
    const validation = validateCommentBody(body, { required: true });
    if (!validation.valid) return refuse(ctx, 400, validation.error, { log: validation.error === 'body is required' });
    if (body.length > MAX_COMMENT_LENGTH) return refuse(ctx, 400, COMMENT_TOO_LONG, { log: false });
    return false;
  }

  const refuseBadUuid = (ctx, value, noun) => !UUID_REGEX.test(value) && refuse(ctx, 400, `Invalid ${noun} ID format`);

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  // POST /api/proxy/issues: create an issue.
  router.post('/api/proxy/issues', ...writeAuth, guarded(SPEC.createIssue, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { teamId, title, description, projectId, stateId, assigneeId, priority, priorityLevel, parentId, cycleId } = req.body;

    // LIN-2239: `priority` (Linear-native) and `priorityLevel` (canonical
    // ascending) both resolve to the SAME provider input field — sending both is
    // refused rather than silently picking one, since silently preferring either
    // would recreate the "plausible wrong value, no error" hazard.
    if (priority !== undefined && priorityLevel !== undefined) {
      return refuse(ctx, 400, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
    }

    // LIN-2352: teamId is only required when the provider's create contract
    // declares it — sourced from createFields() (LIN-1972's contract; NOT
    // supports()/fetchTeams(), which a teamless-but-writable provider like
    // GitHub/Local can still return non-empty/true for). When required it may be a
    // UUID, a team key or a team name (LIN-556), resolved once below so the
    // resolved id can also scope the symbolic stateId.
    const requiresTeam = provider.createFields().includes('teamId');
    if (requiresTeam && (!teamId || typeof teamId !== 'string')) return refuse(ctx, 400, 'Valid teamId is required');
    if (!title || typeof title !== 'string') return refuse(ctx, 400, 'title is required');

    // LIN-1552: length + control-char validation via the shared seam.
    const fieldError = validateIssueWriteFields({ title, description }, { mode: 'create' });
    if (fieldError) return refuse(ctx, 400, fieldError, { log: false });

    // LIN-2352: a create has no fetched issue to derive a team from, so supply
    // provider.name when the contract excludes teamId — a real non-empty string
    // every teamless states() implementation accepts and ignores (mirrors
    // LIN-1972's workspace-api.js reference).
    const resolvedTeamId = requiresTeam ? await resolveTeamInput(provider, token, teamId) : provider.name;

    // LIN-1557: apiWriteFields() — the provider's headless-door write contract,
    // deliberately separate from createFields() (the UI-form descriptor) — governs
    // every OTHER optional field. A field the caller sent that the provider does
    // not honour is refused with 400 instead of being silently forwarded and
    // discarded on a false 201. teamId's stray-value refusal is keyed on the SAME
    // `requiresTeam` signal rather than on apiWriteFields(), since a provider
    // disagreeing between the two lists would otherwise become uncreatable.
    const writable = provider.apiWriteFields();
    const unsupported = (field) => refuse(ctx, 400, `${field} is not supported by this provider`);
    if (teamId !== undefined && !requiresTeam) return unsupported('teamId');

    const input = { title };
    if (requiresTeam) input.teamId = resolvedTeamId;
    if (description) input.description = description;

    // In request order: each field is gated on the provider's write contract, then
    // converted (LIN-556: projectId / stateId accept symbolic names, state scoped
    // to the just-resolved team; assigneeId / parentId / cycleId stay UUID-only).
    // LIN-2239: priorityLevel reuses isValidPriority's range check (both scales are
    // integers over [0,4]) and converts to the native scale; it has no
    // apiWriteFields entry of its own, so it is gated on `priority`.
    const isUuid = (v) => Boolean(v) && UUID_REGEX.test(v);
    const isPriority = (v) => v !== undefined && isValidPriority(v);
    const fields = [
      { name: 'projectId', key: 'projectId', value: projectId, present: Boolean, convert: (v) => resolveProjectInput(provider, token, v) },
      { name: 'stateId', key: 'stateId', value: stateId, present: Boolean, convert: (v) => resolveStateInput(provider, token, resolvedTeamId, v) },
      { name: 'assigneeId', key: 'assigneeId', value: assigneeId, present: isUuid },
      { name: 'parentId', key: 'parentId', value: parentId, present: isUuid },
      { name: 'cycleId', key: 'cycleId', value: cycleId, present: isUuid },
      { name: 'priority', key: 'priority', value: priority, present: isPriority },
      { name: 'priorityLevel', key: 'priority', gate: 'priority', value: priorityLevel, present: isPriority, convert: canonicalPriorityToLinear },
    ];
    for (const { name, key, gate = name, value, present, convert } of fields) {
      if (!present(value)) continue;
      if (!writable.includes(gate)) return unsupported(name);
      input[key] = convert ? await convert(value) : value;
    }

    const created = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
    if (writeRejected(req, res, endpoint, created, 'Issue was not created')) return;
    flattenIssue(created.issue);
    logEvent(req, endpoint, 201);
    res.status(201).json(created);
  }));

  /**
   * LIN-694: report-persistence gate for periodical review tasks. The marker check
   * is free (the guard read already carries the description); a states() lookup to
   * learn the target's `type` only runs for the rare marked issue. Returns true
   * once it has refused with 409.
   */
  async function refusedByPeriodicalGate(ctx, guard, teamId, stateId) {
    if (!extractPeriodicalGateId(guard?.description)) return false;
    let targetStateType = null;
    try {
      const states = await ctx.provider.states(ctx.token, teamId);
      targetStateType = (states || []).find(s => s.id === stateId)?.type || null;
    } catch {
      targetStateType = null; // provider without a states() capability — the gate cannot apply
    }
    const gate = checkPeriodicalReportGate({
      description: guard?.description,
      comments: guard?.comments?.nodes,
      targetStateType,
    });
    return gate.applies && !gate.ok && refuse(ctx, 409, gate.message, { code: gate.code });
  }

  // PATCH /api/proxy/issues/:issueId: update an issue.
  router.patch('/api/proxy/issues/:issueId', ...writeAuth, guarded(SPEC.updateIssue, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { issueId } = req.params;
    const { title, description, stateId, assigneeId, priority, priorityLevel, projectId, parentId, cycleId } = req.body;

    // LIN-2239: same field, same hazard, same refusal as create.
    if (priority !== undefined && priorityLevel !== undefined) {
      return refuse(ctx, 400, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
    }
    // LIN-1552: length + control-char validation via the shared seam.
    const fieldError = validateIssueWriteFields({ title, description }, { mode: 'update' });
    if (fieldError) return refuse(ctx, 400, fieldError, { log: false });

    // A wholly empty body is refused before any read (the no-network 400 for
    // `{}`); the check after conversion still catches a body whose only fields
    // are unsupported or dropped.
    const updatable = [title, description, stateId, assigneeId, projectId, parentId, cycleId, priority, priorityLevel];
    if (updatable.every(v => v === undefined)) return refuse(ctx, 400, 'No valid fields to update');

    // LIN-556: one guard read serves both the trashed refusal AND the team scope a
    // symbolic stateId needs (e.g. `done` -> the team's completed state).
    const target = await guardTarget(ctx, 'issueWriteGuard', { onNull: 'proceed' });
    if (!target) return;
    const guard = target.issue;
    const teamId = guard?.team?.id || null;

    const input = {};
    if (title) input.title = title;
    if (description !== undefined) input.description = description;
    // LIN-556: stateId / projectId accept symbolic names; assigneeId / parentId /
    // cycleId stay UUID-only.
    if (stateId) {
      input.stateId = await resolveStateInput(provider, token, teamId, stateId);
      if (await refusedByPeriodicalGate(ctx, guard, teamId, input.stateId)) return;
    }
    if (projectId) input.projectId = await resolveProjectInput(provider, token, projectId);
    if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
    if (parentId === null) input.parentId = null;
    else if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
    if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
    // LIN-2239: update's convention is to silently drop a field the provider
    // cannot honour rather than 400, so unlike create there is no capability gate.
    if (priority !== undefined && isValidPriority(priority)) input.priority = priority;
    if (priorityLevel !== undefined && isValidPriority(priorityLevel)) input.priority = canonicalPriorityToLinear(priorityLevel);
    if (Object.keys(input).length === 0) return refuse(ctx, 400, 'No valid fields to update');

    const updated = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
    if (writeRejected(req, res, endpoint, updated, 'Issue was not updated')) return;
    flattenIssue(updated.issue);
    logEvent(req, endpoint, 200);
    res.json(updated);
    // Seam 1 (LIN-3366): a state write may have made the ticket terminal.
    if (input.stateId) {
      afterResponse(1, () => onTicketWrite({ urlKey: req.proxyUrlKey, written: updated.issue, readBack: () => provider.fetchIssueContext(token, issueId) }));
      // LIN-3756: the close-out worker merges, then sets Done here; record the merge.
      // Its own fire-and-forget (afterResponse returns early when onTicketWrite is
      // unset). `token` is the structured call scope the PR read needs.
      if (recordPipelineMerge) {
        void Promise.resolve()
          .then(() => recordPipelineMerge({
            urlKey: req.proxyUrlKey,
            workspaceId: req.proxyWorkspaceId ?? null,
            accountId: req.proxyCreatedBy ?? null,
            provider,
            callScope: token,
            source: req.query?.source ?? null,
            written: updated.issue,
            readBack: () => provider.fetchIssueContext(token, issueId),
          }))
          .catch(e => console.error('[close-out-merges] seam 1 failure:', e?.message || e));
      }
    }
  }));

  // ---------------------------------------------------------------------------
  // Description edits
  // ---------------------------------------------------------------------------

  /**
   * Shared read-modify-write for the description edit endpoints. Reads the live
   * body, lets `merge(current)` produce the new body, validates it, and writes.
   * The agent never re-emits the original, so the LIN-398 corruption class cannot
   * recur. `merge` may throw DescriptionEditError for a loud 422.
   *
   * The read and the write each map their own failures: a read error reports
   * "Failed to read issue description" and maps no typed error; the write maps
   * RefResolutionError (a provider that REFUSES the write, e.g. Jira's D1
   * unrenderable-content guard, LIN-1886, is a permanent caller-visible 422, not a
   * 500 telling an agent to retry) and PartialWriteError (LIN-2012: the field PUT
   * landed and only the confirmation re-read failed).
   */
  async function editDescription(ctx, merge) {
    const { req, res, endpoint, token, provider } = ctx;
    let next;
    try {
      const target = await guardTarget(ctx, 'issueDescription', { onNull: 'notFound' });
      if (!target) return;
      next = merge(target.issue.description || '');
    } catch (err) {
      if (err instanceof DescriptionEditError) {
        return refuse(ctx, 422, err.message, { code: err.code, matchCount: err.matchCount });
      }
      return fail(ctx, err, { failure: 'Failed to read issue description', label: 'description edit (read)' });
    }

    if (next.length > MAX_DESCRIPTION_LENGTH) return refuse(ctx, 400, 'resulting description exceeds maximum length');
    if (DANGEROUS_CHARS_REGEX.test(next)) return refuse(ctx, 400, 'resulting description contains invalid characters');

    try {
      const updated = normalizeWritePayload(await provider.updateIssue(token, req.params.issueId, { description: next }), 'issue');
      // docs/proxy-integration.md: a write never answers a 2xx with a falsy success.
      if (writeRejected(req, res, endpoint, updated, 'Description was not updated')) return;
      flattenIssue(updated.issue);
      logEvent(req, endpoint, 200);
      res.json(updated);
    } catch (err) {
      fail(ctx, err, { failure: 'Failed to update description', label: 'description edit (write)', refs: true, partial: true });
    }
  }

  /** Body checks for append/replace, which run before resolution (a 400 beats a 503). */
  const refuseBadAppend = (ctx) => {
    const { block } = ctx.req.body;
    if (!block || typeof block !== 'string') return refuse(ctx, 400, 'block is required');
    if (block.length > MAX_DESCRIPTION_LENGTH) return refuse(ctx, 400, 'block exceeds maximum length');
    if (DANGEROUS_CHARS_REGEX.test(block)) return refuse(ctx, 400, 'block contains invalid characters');
    return false;
  };
  const refuseBadReplace = (ctx) => {
    const { oldString, newString } = ctx.req.body;
    if (!oldString || typeof oldString !== 'string') return refuse(ctx, 400, 'oldString is required');
    if (typeof newString !== 'string') return refuse(ctx, 400, 'newString is required');
    if (newString.length > MAX_DESCRIPTION_LENGTH) return refuse(ctx, 400, 'newString exceeds maximum length');
    if (DANGEROUS_CHARS_REGEX.test(newString)) return refuse(ctx, 400, 'newString contains invalid characters');
    return false;
  };

  // POST /api/proxy/issues/:issueId/description/append: append a block to the end
  // of the description; the existing body is preserved byte-for-byte.
  router.post('/api/proxy/issues/:issueId/description/append', ...writeAuth,
    guarded({ ...SPEC.appendDescription, pre: refuseBadAppend }, (ctx) => editDescription(ctx, (current) => appendBlock(current, ctx.req.body.block))));

  // POST /api/proxy/issues/:issueId/description/replace: replace one uniquely
  // matched span (normalised, backslash-unescaped, on both sides); a missing or
  // ambiguous span is a loud 422. Full rewrites stay on the issue PATCH.
  router.post('/api/proxy/issues/:issueId/description/replace', ...writeAuth,
    guarded({ ...SPEC.replaceDescription, pre: refuseBadReplace }, (ctx) => {
      const { oldString, newString } = ctx.req.body;
      return editDescription(ctx, (current) => replaceInDescription(current, oldString, newString));
    }));

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  // POST /api/proxy/issues/:issueId/comments (canonical, nested issue-scoped form)
  // and /api/proxy/comments/:issueId (forgiving flat alias, LIN-528): add a comment.
  router.post(['/api/proxy/issues/:issueId/comments', '/api/proxy/comments/:issueId'], ...writeAuth, guarded(SPEC.createComment, async (ctx) => {
    const { req, res, endpoint } = ctx;
    const { issueId } = req.params;
    const { body } = req.body;
    // LIN-2154: presence/type/dangerous-chars first, then length — a named,
    // cosmetic exception for a doubly-invalid body, which reports the
    // dangerous-chars message instead of the length one.
    if (refuseBadCommentBody(ctx, body)) return;
    if (!await guardTarget(ctx, 'issueWriteGuard', { onNull: 'proceed' })) return;

    // Deterministic dedupe (LIN-399): an identical comment just created for this
    // issue is returned instead of minting a duplicate. The generation tag
    // (LIN-1160/LIN-2005) folds in so a delete/edit anywhere in this workspace
    // invalidates every prior dedupe entry in it.
    //
    // LIN-2154: this stays a 4-argument call. Padding it to 5 (to match the human
    // lane's salted call in routes/workspace-api-issue-write.js) would change ITS OWN digest
    // stream shape relative to every entry it has ever produced, silently
    // invalidating this lane's live dedupe window.
    const key = dedupeKey(req.proxyUrlKey, issueId, body, commentDedupeGenerations.current(req.proxyUrlKey));
    const prior = commentDedupe.get(key);
    if (prior) {
      // LIN-2109: skipWitness — this 200 is served from the dedupe cache, never
      // from the provider, so it is not evidence the provider accepted anything
      // on THIS request.
      logEvent(req, endpoint, 200, null, { skipWitness: true });
      await recordInLedger(req, prior, 'repair');
      return res.status(200).json({ ...prior, deduped: true });
    }
    await postComment(ctx, body, (created) => commentDedupe.set(key, created));
  }));

  // DELETE /api/proxy/issues/:issueId/comments/:commentId: remove a comment. The
  // commentId is the comment's own id, exposed on the nodes GET /issues/:id
  // returns. :issueId keeps the URL shape consistent with the other issue-scoped
  // endpoints but the delete is keyed solely on commentId. No trashed guard:
  // removing a stray comment from a trashed issue is exactly its use case.
  router.delete('/api/proxy/issues/:issueId/comments/:commentId', ...writeAuth, guarded(SPEC.deleteComment, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { commentId } = req.params;
    if (refuseBadUuid(ctx, commentId, 'comment')) return;
    const deleted = await provider.deleteComment(token, commentId);
    if (writeRejected(req, res, endpoint, deleted, 'Comment was not deleted')) return;
    commentDedupeGenerations.bump(req.proxyUrlKey);
    logEvent(req, endpoint, 200);
    res.json(deleted);
  }));

  // PATCH /api/proxy/issues/:issueId/comments/:commentId: edit a comment's body.
  // Same URL-shape and no-trashed-guard rationale as DELETE — an edit corrects
  // existing content, it does not add new content to a dead issue.
  router.patch('/api/proxy/issues/:issueId/comments/:commentId', ...writeAuth, guarded(SPEC.updateComment, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { commentId } = req.params;
    if (refuseBadUuid(ctx, commentId, 'comment')) return;
    const { body } = req.body;
    if (refuseBadCommentBody(ctx, body)) return;
    const updated = normalizeWritePayload(await provider.updateComment(token, commentId, body), 'comment');
    if (writeRejected(req, res, endpoint, updated, 'Comment was not updated')) return;
    commentDedupeGenerations.bump(req.proxyUrlKey);
    logEvent(req, endpoint, 200);
    res.status(200).json(updated);
  }));

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  // POST /api/proxy/issues/:issueId/attachments (LIN-891): agent-facing upload —
  // attach a base64 raster image to an issue, either as a new comment (default
  // "comment" target) or appended to the description ("description" target). The
  // asset is embedded as markdown `![](assetUrl)`, so it is immediately readable
  // through the EXISTING `md:` read path (lib/proxy-wire.js).
  //
  // Deliberately NOT the human feedback widget's `/api/image` route (session-
  // authed, human-only): this is a separate Bearer-token route that reuses its
  // primitives end-to-end — provider.uploadFile() (LIN-636) and the raster
  // magic-byte sniffing guard (LIN-682, parseFeedbackImage, shared via
  // lib/attachment-upload.js).
  router.post('/api/proxy/issues/:issueId/attachments', ...writeAuth, json({ type: () => true, limit: ATTACHMENT_UPLOAD_BODY_LIMIT }), guarded(SPEC.attachment, async (ctx) => {
    const { req, endpoint, token, provider } = ctx;
    const { image, target, body } = req.body || {};
    if (target !== undefined && target !== 'comment' && target !== 'description') {
      return refuse(ctx, 400, 'target must be "comment" or "description"');
    }
    const toDescription = target === 'description';
    if (denyIfUnsupported(provider, toDescription ? 'updateIssue' : 'createComment', req, ctx.res, endpoint)) return;

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) return refuse(ctx, 400, BAD_ISSUE_ID);

    // LIN-2154: shared validator (the caption is optional); its native order,
    // type-check then dangerous-chars, comes before the length/budget math.
    const bodyValidation = validateCommentBody(body, { required: false });
    if (!bodyValidation.valid) return refuse(ctx, 400, bodyValidation.error);

    if (!image) return refuse(ctx, 400, 'image is required');
    const parsed = parseFeedbackImage(image);
    if (!parsed) return refuse(ctx, 400, 'image must be a base64 data URL or { data, contentType?, filename? } decoding to a PNG/JPEG/GIF/WEBP');
    if (parsed.bytes.length > MAX_ATTACHMENT_BYTES) return refuse(ctx, 413, 'image too large');

    if (!await guardTarget(ctx, 'issueWriteGuard', { onNull: 'proceed' })) return;

    // Pre-validate the projected final length BEFORE uploadFile() runs, with
    // ATTACHMENT_EMBED_RESERVE standing in for the not-yet-known assetUrl. An
    // oversized `body` is then a 400 with no side effect, instead of an orphaned,
    // wasted asset per call.
    const bodyBudget = body ? body.length + 2 : 0; // "\n\n" separator before the embed
    if (toDescription) {
      const current = await guardTarget(ctx, 'issueDescription', { onNull: 'notFound', refuseTrashed: false });
      if (!current) return;
      const currentLength = (current.issue.description || '').length;
      const separator = currentLength > 0 ? 2 : 0;
      if (currentLength + separator + bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_DESCRIPTION_LENGTH) {
        return refuse(ctx, 400, 'resulting description exceeds maximum length');
      }
    } else if (bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_COMMENT_LENGTH) {
      return refuse(ctx, 400, COMMENT_TOO_LONG);
    }

    const assetUrl = await provider.uploadFile(token, parsed.bytes, { contentType: parsed.contentType, filename: parsed.filename });
    const markdown = `![](${assetUrl})`;
    const embedded = body ? `${body}\n\n${markdown}` : markdown;

    if (toDescription) {
      // The description pipeline starts from resolution; the redundant resolve,
      // updateIssue gate and description read are today's behaviour, kept.
      const again = await open(req, ctx.res, { ...SPEC.attachment, needs: 'updateIssue' });
      if (!again) return;
      return editDescription(again, (existing) => appendBlock(existing, embedded));
    }
    if (embedded.length > MAX_COMMENT_LENGTH) return refuse(ctx, 400, COMMENT_TOO_LONG);
    await postComment(ctx, embedded);
  }));

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------

  // POST /api/proxy/issues/:issueId/relations: create a relation between issues.
  router.post('/api/proxy/issues/:issueId/relations', ...writeAuth, guarded(SPEC.createRelation, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { issueId } = req.params;
    const { type, relatedIssueId } = req.body;
    if (!type || !RELATION_TYPES.includes(type)) return refuse(ctx, 400, `type must be one of: ${RELATION_TYPES.join(', ')}`);
    if (!relatedIssueId || !isValidIssueId(relatedIssueId)) return refuse(ctx, 400, 'Valid relatedIssueId is required', { log: false });
    if (!await guardTarget(ctx, 'issueWriteGuard', { onNull: 'proceed' })) return;

    // The provider owns the blocked-by -> inverse-blocks sugar (ids swapped).
    const created = normalizeWritePayload(await provider.createRelation(token, issueId, { type, relatedIssueId }), 'issueRelation');
    if (writeRejected(req, res, endpoint, created, 'Relation was not created')) return;
    logEvent(req, endpoint, 201);
    res.status(201).json(created);
    // Seam 4 (LIN-3366): a `duplicate` relation may move the source issue to
    // Duplicate. Read it back once; a non-terminal result is a no-op.
    if (type === 'duplicate') {
      afterResponse(4, () => onTicketWrite({ urlKey: req.proxyUrlKey, written: null, readBack: () => provider.fetchIssueContext(token, issueId) }));
    }
  }));

  // DELETE /api/proxy/issues/:issueId/relations/:relationId: remove a relation.
  // The relationId is the IssueRelation's own id (exposed on GET /relations/:issueId
  // and GET /issue/:id); the delete is keyed solely on it (Linear deletes by
  // relation id, not by the issue pair), so :issueId is format-checked only.
  router.delete('/api/proxy/issues/:issueId/relations/:relationId', ...writeAuth, guarded(SPEC.deleteRelation, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
    const { relationId } = req.params;
    if (refuseBadUuid(ctx, relationId, 'relation')) return;
    const removed = await provider.deleteRelation(token, relationId);
    if (writeRejected(req, res, endpoint, removed, 'Relation was not removed')) return;
    logEvent(req, endpoint, 200);
    res.json(removed);
  }));

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  /**
   * Label read-modify-write shared by add and remove. Linear's API takes the full
   * label-id array, so this is a read, a set computation, then a full write:
   * concurrent label changes (e.g. from the Linear UI and this proxy at once) can
   * overwrite each other — there is no atomic add/remove. `plan(current, id)`
   * returns the new id list, or null when the change is a no-op, which answers
   * 200 with `noop` and writes nothing.
   */
  async function changeLabels(ctx, rawLabel, { plan, noop, rejected }) {
    const { req, res, endpoint, token, provider } = ctx;
    // LIN-556: the label may be a UUID or a label name (case-insensitive).
    const labelId = await resolveLabelInput(provider, token, rawLabel);
    const target = await guardTarget(ctx, 'issueLabels', { onNull: 'notFound' });
    if (!target) return;
    const next = plan((target.issue.labels?.nodes || []).map(l => l.id), labelId);
    if (!next) {
      logEvent(req, endpoint, 200);
      return res.json({ success: true, message: noop });
    }
    if (denyIfMissingRead(provider, 'updateIssueLabels', req, res, endpoint)) return;
    const updated = await provider.updateIssueLabels(token, req.params.issueId, next);
    if (writeRejected(req, res, endpoint, updated, rejected)) return;
    flattenIssue(updated.issue);
    logEvent(req, endpoint, 200);
    res.json(updated);
  }

  // POST /api/proxy/issues/:issueId/labels: add a label to an issue.
  router.post('/api/proxy/issues/:issueId/labels', ...writeAuth, guarded(SPEC.addLabel, (ctx) => {
    const { labelId } = ctx.req.body;
    if (!labelId || typeof labelId !== 'string') return refuse(ctx, 400, 'Valid labelId is required');
    return changeLabels(ctx, labelId, {
      plan: (current, id) => (current.includes(id) ? null : [...current, id]),
      noop: 'Label already present',
      rejected: 'Label was not added',
    });
  }));

  // DELETE /api/proxy/issues/:issueId/labels/:labelId: remove a label from an issue.
  router.delete('/api/proxy/issues/:issueId/labels/:labelId', ...writeAuth, guarded(SPEC.removeLabel, (ctx) => changeLabels(ctx, ctx.req.params.labelId, {
    plan: (current, id) => (current.includes(id) ? current.filter(x => x !== id) : null),
    noop: 'Label not present',
    rejected: 'Label was not removed',
  })));

  return router;
}
