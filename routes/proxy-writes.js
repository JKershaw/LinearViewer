/**
 * Group E write routes (LIN-679 Stage 3b / LIN-2537: extracted from
 * routes/proxy.js, byte-identical handler bodies).
 *
 * Consumer-API write endpoints: POST /issues, PATCH /issues/:issueId,
 * description append/replace, comments create/delete/patch, attachments
 * upload, relations create/delete, labels add/remove.
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
import { extractPeriodicalGateId, checkPeriodicalReportGate } from '../lib/periodical-report-gate.js';
import { flattenIssue, MAX_ATTACHMENT_BYTES } from '../lib/proxy-wire.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import { appendBlock, replace as replaceInDescription, DescriptionEditError } from '../lib/description-edit.js';
import { badRequest, jsonError, notFound } from '../lib/errors.js';
import { parseFeedbackImage } from '../lib/attachment-upload.js';

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
}) {
  const router = Router();

  /**
   * POST /api/proxy/issues
   * Create a new issue.
   */
  router.post('/api/proxy/issues', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }
      if (denyIfUnsupported(provider, 'createIssue', req, res, '/api/proxy/issues')) return;

      const { teamId, title, description, projectId, stateId, assigneeId, priority, priorityLevel, parentId, cycleId } = req.body;

      // LIN-2239: `priority` (Linear-native) and `priorityLevel` (canonical
      // ascending) both resolve to the SAME provider input field — sending
      // both is refused rather than silently picking one, since silently
      // preferring either would recreate the exact "plausible wrong value,
      // no error" hazard this ticket exists to prevent.
      if (priority !== undefined && priorityLevel !== undefined) {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
      }

      // LIN-2352: teamId is only required when the provider's create contract
      // declares it — sourced from createFields() (LIN-1972's contract; NOT
      // supports()/fetchTeams(), which a teamless-but-writable provider like
      // GitHub/Local can still return non-empty/true for). A teamless
      // provider must never be asked for one. When required, it may be a
      // UUID, a team key (e.g. `LIN`), or a team name (LIN-556); the
      // symbolic→id resolution happens once below so the resolved id can also
      // scope the symbolic stateId.
      const fields = provider.createFields();
      const requiresTeam = fields.includes('teamId');

      if (requiresTeam && (!teamId || typeof teamId !== 'string')) {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Valid teamId is required');
      }

      if (!title || typeof title !== 'string') {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'title is required');
      }

      // LIN-1552: length + control-char validation via the shared seam
      // (identical rules/messages/order to the former inline checks).
      const createFieldError = validateIssueWriteFields({ title, description }, { mode: 'create' });
      if (createFieldError) {
        return badRequest.json(res, createFieldError);
      }

      // LIN-2352: a create has no fetched issue to derive a team from, so
      // supply provider.name directly when the contract excludes teamId — a
      // real non-empty string every teamless states() implementation accepts
      // and ignores (mirrors LIN-1972's workspace-api.js reference), keeping
      // resolveStateInput's `if (!teamId) throw 422` guard untripped on
      // either lane.
      const resolvedTeamId = requiresTeam
        ? await resolveTeamInput(provider, token, teamId)
        : provider.name;

      // LIN-1557: `apiWriteFields()` — the provider's headless-door write
      // contract, deliberately separate from `createFields()` (the UI-form
      // descriptor) — governs every OTHER optional field below. A field the
      // caller sent that the provider does not honour is refused with 400
      // instead of being silently forwarded and discarded on a false 201.
      // title stays required unconditionally. teamId is conditionally
      // required per createFields() (LIN-2352, not LIN-1976 — LIN-1976
      // instance 3 is the separate feedback-route lane); its stray-value
      // refusal below is deliberately keyed on the SAME `requiresTeam` signal
      // rather than on apiWriteFields(), since a provider disagreeing between
      // the two lists would otherwise become uncreatable (required by one
      // check, refused by the other).
      const writableFields = provider.apiWriteFields();
      const refuseUnwritable = (field) => {
        logEvent(req, '/api/proxy/issues', 400);
        badRequest.json(res, `${field} is not supported by this provider`);
        return true;
      };

      if (teamId !== undefined && !requiresTeam) return refuseUnwritable('teamId');

      const input = { title };
      if (requiresTeam) input.teamId = resolvedTeamId;
      if (description) input.description = description;
      // LIN-556: projectId / stateId accept symbolic names alongside UUIDs.
      // State is scoped to the just-resolved team so symbolic matches cannot
      // bleed across teams. assigneeId / parentId / cycleId stay UUID-only this
      // ticket (named out of scope in the LIN-556 design record).
      if (projectId) {
        if (!writableFields.includes('projectId')) return refuseUnwritable('projectId');
        input.projectId = await resolveProjectInput(provider, token, projectId);
      }
      if (stateId) {
        if (!writableFields.includes('stateId')) return refuseUnwritable('stateId');
        input.stateId = await resolveStateInput(provider, token, resolvedTeamId, stateId);
      }
      if (assigneeId && UUID_REGEX.test(assigneeId)) {
        if (!writableFields.includes('assigneeId')) return refuseUnwritable('assigneeId');
        input.assigneeId = assigneeId;
      }
      if (parentId && UUID_REGEX.test(parentId)) {
        if (!writableFields.includes('parentId')) return refuseUnwritable('parentId');
        input.parentId = parentId;
      }
      if (cycleId && UUID_REGEX.test(cycleId)) {
        if (!writableFields.includes('cycleId')) return refuseUnwritable('cycleId');
        input.cycleId = cycleId;
      }
      if (priority !== undefined && isValidPriority(priority)) {
        if (!writableFields.includes('priority')) return refuseUnwritable('priority');
        input.priority = priority;
      }
      // LIN-2239: priorityLevel reuses isValidPriority's range check — both
      // scales are integers over the same [0,4] cardinality, just relabeled —
      // then converts to the provider's native scale before it reaches the
      // SAME `input.priority` the block above sets. Gated on the SAME
      // capability (priorityLevel has no independent apiWriteFields entry;
      // it maps onto the provider's existing priority support).
      if (priorityLevel !== undefined && isValidPriority(priorityLevel)) {
        if (!writableFields.includes('priority')) return refuseUnwritable('priorityLevel');
        input.priority = canonicalPriorityToLinear(priorityLevel);
      }

      const issueCreate = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
      if (writeRejected(req, res, '/api/proxy/issues', issueCreate, 'Issue was not created')) return;
      flattenIssue(issueCreate.issue);
      logEvent(req, '/api/proxy/issues', 201);
      res.status(201).json(issueCreate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy create issue error:', err.message);
      jsonError(res, status, 'Failed to create issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * PATCH /api/proxy/issues/:issueId
   * Update an issue.
   */
  /**
   * LIN-401: refuse a write whose target is a trashed (soft-deleted) issue.
   * Returns true (and sends a 409) when the issue is trashed, so the caller can
   * `if (await refuseIfTrashed(...)) return;` before mutating. A missing issue
   * (null) is NOT refused here — the mutation proceeds and Linear's own
   * not-found error maps to the usual status, preserving existing behaviour.
   */
  async function refuseIfTrashed(activeProvider, token, issueId, req, res, endpoint) {
    // Site 1 (LIN-1559). Returning true also serves the caller's early return.
    if (denyIfMissingRead(activeProvider, 'issueWriteGuard', req, res, endpoint)) return true;
    const issue = await activeProvider.issueWriteGuard(token, issueId);
    if (isTrashed(issue)) {
      logEvent(req, endpoint, 409);
      jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      return true;
    }
    return false;
  }

  router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }
      if (denyIfUnsupported(provider, 'updateIssue', req, res, '/api/proxy/issues/:id')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { title, description, stateId, assigneeId, priority, priorityLevel, projectId, parentId, cycleId } = req.body;

      // LIN-2239: see the create-route comment — same field, same hazard,
      // same refusal.
      if (priority !== undefined && priorityLevel !== undefined) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
      }

      // LIN-1552: length + control-char validation via the shared seam
      // (identical rules/messages/order to the former inline checks).
      const updateFieldError = validateIssueWriteFields({ title, description }, { mode: 'update' });
      if (updateFieldError) {
        return badRequest.json(res, updateFieldError);
      }

      // Reject a wholly empty body before any read (preserves the no-network 400
      // for `{}`); the post-resolution check below still catches a body whose
      // only fields are unsupported/dropped.
      const hasUpdatableField = [title, description, stateId, assigneeId, projectId, parentId, cycleId, priority, priorityLevel]
        .some(v => v !== undefined);
      if (!hasUpdatableField) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'No valid fields to update');
      }

      // LIN-556: one guard read serves both the trashed refusal AND the team
      // scope a symbolic stateId needs (e.g. `done` → the team's completed
      // state). Replaces the former post-build refuseIfTrashed call.
      if (denyIfMissingRead(provider, 'issueWriteGuard', req, res, '/api/proxy/issues/:id')) return; // site 2
      const guard = await provider.issueWriteGuard(token, issueId);
      if (isTrashed(guard)) {
        logEvent(req, '/api/proxy/issues/:id', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }
      const teamId = guard?.team?.id || null;

      const input = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description;
      // LIN-556: stateId / projectId accept symbolic names alongside UUIDs;
      // state is scoped to the issue's team. assigneeId / parentId / cycleId
      // stay UUID-only this ticket (named out of scope in the design record).
      if (stateId) {
        input.stateId = await resolveStateInput(provider, token, teamId, stateId);
        // LIN-694: report-persistence gate for periodical review tasks. The
        // marker check is free (guard.description was already fetched above
        // for every write); a states() lookup to learn the target's `type`
        // only runs for the rare marked issue, so this adds no cost to the
        // overwhelmingly common (non-periodical) stateId-bearing write.
        const periodicalGateId = extractPeriodicalGateId(guard?.description);
        if (periodicalGateId) {
          let targetStateType = null;
          try {
            const states = await provider.states(token, teamId);
            targetStateType = (states || []).find(s => s.id === input.stateId)?.type || null;
          } catch {
            targetStateType = null; // provider without a states() capability — gate cannot apply
          }
          const gateResult = checkPeriodicalReportGate({
            description: guard?.description,
            comments: guard?.comments?.nodes,
            targetStateType
          });
          if (gateResult.applies && !gateResult.ok) {
            logEvent(req, '/api/proxy/issues/:id', 409);
            return jsonError(res, 409, gateResult.message, { code: gateResult.code });
          }
        }
      }
      if (projectId) input.projectId = await resolveProjectInput(provider, token, projectId);
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (parentId === null) input.parentId = null;
      else if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && isValidPriority(priority)) {
        input.priority = priority;
      }
      // LIN-2239: same conversion + capability parity as the create route
      // (update's existing convention is to silently drop an unsupported
      // field rather than 400, so no explicit gate here — an unsupported
      // provider's `updateIssue` already ignores `input.priority`).
      if (priorityLevel !== undefined && isValidPriority(priorityLevel)) {
        input.priority = canonicalPriorityToLinear(priorityLevel);
      }

      if (Object.keys(input).length === 0) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'No valid fields to update');
      }

      const issueUpdate = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
      if (writeRejected(req, res, '/api/proxy/issues/:id', issueUpdate, 'Issue was not updated')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/:id', err)) return;
      if (partialWriteFailed(req, res, '/api/proxy/issues/:id', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy update issue error:', err.message);
      jsonError(res, status, 'Failed to update issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * Shared read-modify-write for the description edit endpoints. Reads the live
   * body, lets `merge(current)` produce the new body, validates it, and writes.
   * The agent never re-emits the original, so the LIN-398 corruption class cannot
   * recur. `merge` may throw DescriptionEditError for a loud 422.
   */
  async function applyDescriptionEdit(req, res, endpoint, merge) {
    const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
    if (!token) {
      return workspaceUnavailable(req, res, endpoint, reason);
    }
    if (denyIfUnsupported(provider, 'updateIssue', req, res, endpoint)) return;

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid issue ID format');
    }

    if (denyIfMissingRead(provider, 'issueDescription', req, res, endpoint)) return; // site 3

    let newDescription;
    try {
      const issue = await provider.issueDescription(token, issueId);
      if (!issue) {
        logEvent(req, endpoint, 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, endpoint, 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }
      newDescription = merge(issue.description || '');
    } catch (err) {
      if (err instanceof DescriptionEditError) {
        logEvent(req, endpoint, 422);
        return jsonError(res, 422, err.message, { code: err.code, matchCount: err.matchCount });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (read) error:', err.message);
      return jsonError(res, status, 'Failed to read issue description', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }

    if (newDescription.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'resulting description exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(newDescription)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'resulting description contains invalid characters');
    }

    try {
      const issueUpdate = normalizeWritePayload(await provider.updateIssue(token, issueId, { description: newDescription }), 'issue');
      flattenIssue(issueUpdate.issue);
      logEvent(req, endpoint, 200);
      res.json(issueUpdate);
    } catch (err) {
      // A provider that REFUSES the write (Jira's D1 unrenderable-content guard,
      // LIN-1886) throws RefResolutionError with its own status. Map it the same
      // way PATCH /issues/:id does, so a permanent, caller-visible refusal reads
      // as a 422 with its reason — not a 500 telling an agent to back off and
      // retry something that can never succeed.
      if (refResolutionFailed(req, res, endpoint, err)) return;
      // LIN-2012: this is a description-only write (no stateId), so the only
      // partial-write shape reachable here is the confirmation re-read failing
      // after the field PUT already landed — still must not read as a total
      // failure.
      if (partialWriteFailed(req, res, endpoint, err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (write) error:', err.message);
      jsonError(res, status, 'Failed to update description', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  }

  /**
   * POST /api/proxy/issues/:issueId/description/append
   * Append a block to the end of an issue's description. The agent supplies only
   * the new content; the existing body is preserved byte-for-byte.
   */
  router.post('/api/proxy/issues/:issueId/description/append', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/append';
    const { block } = req.body;
    if (!block || typeof block !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block is required');
    }
    if (block.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(block)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block contains invalid characters');
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => appendBlock(current, block));
  });

  /**
   * POST /api/proxy/issues/:issueId/description/replace
   * Replace a single, uniquely-matched span in an issue's description. Matching is
   * normalised (backslash-unescaped) on both sides and fails loud (422) when the
   * span is missing or ambiguous. Full rewrites stay on PATCH .../issues/:id.
   */
  router.post('/api/proxy/issues/:issueId/description/replace', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/replace';
    const { oldString, newString } = req.body;
    if (!oldString || typeof oldString !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'oldString is required');
    }
    if (typeof newString !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString is required');
    }
    if (newString.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(newString)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString contains invalid characters');
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => replaceInDescription(current, oldString, newString));
  });

  /**
   * POST /api/proxy/issues/:issueId/comments  (canonical — nested issue-scoped form)
   * POST /api/proxy/comments/:issueId           (forgiving alias, flat form)
   * Add a comment to an issue. Shared :issueId param across both forms (LIN-528).
   */
  router.post(['/api/proxy/issues/:issueId/comments', '/api/proxy/comments/:issueId'], proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'createComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { body } = req.body;
      // LIN-2154: presence/type/dangerous-chars via the shared validator FIRST,
      // then the retained length check — a named, cosmetic exception for a
      // doubly-invalid (over-length AND dangerous-chars) body, which now
      // reports the dangerous-chars message instead of the length one.
      const bodyValidation = validateCommentBody(body, { required: true });
      if (!bodyValidation.valid) {
        if (bodyValidation.error === 'body is required') {
          logEvent(req, '/api/proxy/issues/comments', 400);
        }
        return badRequest.json(res, bodyValidation.error);
      }

      if (body.length > MAX_COMMENT_LENGTH) {
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/comments')) return;

      // Deterministic dedupe (LIN-399): if an identical comment was just
      // created for this issue, return that one instead of minting a duplicate.
      // The generation tag (LIN-1160/LIN-2005) folds in so a delete/edit
      // anywhere in this workspace invalidates every prior dedupe entry in it
      // (see commentDedupeGenerations above).
      //
      // LIN-2154: this stays a 4-argument call. Padding it to 5 (to match the
      // human lane's salted call in routes/workspace-api.js) would change ITS
      // OWN digest stream shape relative to every entry it has ever produced,
      // silently invalidating this lane's live dedupe window — a same-lane
      // regression, not a cross-lane collision risk (dedupeKey's length-prefix
      // scheme is the whole collision guarantee between distinct streams).
      const key = dedupeKey(req.proxyUrlKey, issueId, body, commentDedupeGenerations.current(req.proxyUrlKey));
      const prior = commentDedupe.get(key);
      if (prior) {
        // LIN-2109: skipWitness — this 200 is served from the dedupe cache,
        // never from `provider.createComment` below, so it is not evidence
        // the provider accepted anything on THIS request.
        logEvent(req, '/api/proxy/issues/comments', 200, null, { skipWitness: true });
        return res.status(200).json({ ...prior, deduped: true });
      }

      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, body), 'comment');

      // Surface a clear failure instead of a misleading 201 when Linear
      // reports the write did not land.
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentCreate, 'Comment was not created')) return;

      commentDedupe.set(key, commentCreate);

      // Best-effort Harbour-comments ledger record (LIN-2648, WS1 of LIN-2241):
      // mirrors the stampDecisionAnswers discipline (routes/workspace-api.js) —
      // a single attempt, caught and logged, never propagated, never retried.
      // The comment already succeeded and is the durable half of this write; a
      // ledger-write failure must never fail it.
      if (harbourCommentsStore) {
        try {
          const newCommentId = commentCreate.comment?.id;
          if (newCommentId) {
            await harbourCommentsStore.record({ urlKey: req.proxyUrlKey, commentId: newCommentId });
          }
        } catch (ledgerErr) {
          console.error('Harbour-comments ledger record failed:', ledgerErr.message);
        }
      }

      logEvent(req, '/api/proxy/issues/comments', 201);
      res.status(201).json(commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy create comment error:', err.message);
      jsonError(res, status, 'Failed to create comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/comments/:commentId
   * Remove a comment. The commentId is the comment's own id, exposed on the
   * nodes returned by GET /issues/:id.
   *
   * Note: :issueId is accepted for a consistent URL shape with the other
   * /issue/:issueId/... endpoints, but the delete is keyed solely on
   * commentId (mirrors DELETE .../relations/:relationId exactly). No trashed
   * guard: removing a stray/bad comment from a trashed issue is exactly the
   * use case this endpoint exists for.
   */
  router.delete('/api/proxy/issues/:issueId/comments/:commentId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'deleteComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId, commentId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(commentId)) {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return badRequest.json(res, 'Invalid comment ID format');
      }

      const commentDelete = await provider.deleteComment(token, commentId);
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentDelete, 'Comment was not deleted')) return;
      commentDedupeGenerations.bump(req.proxyUrlKey);
      logEvent(req, '/api/proxy/issues/comments', 200);
      res.json(commentDelete);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy delete comment error:', err.message);
      jsonError(res, status, 'Failed to delete comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * PATCH /api/proxy/issues/:issueId/comments/:commentId
   * Edit a comment's body. Same URL-shape note and no-trashed-guard rationale
   * as DELETE above — an edit is a correction to existing content, not new
   * content added to a dead issue.
   */
  router.patch('/api/proxy/issues/:issueId/comments/:commentId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'updateComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId, commentId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(commentId)) {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return badRequest.json(res, 'Invalid comment ID format');
      }

      const { body } = req.body;
      // LIN-2154: same validator-first, length-second order as the create route
      // above (and the same named doubly-invalid-body exception).
      const bodyValidation = validateCommentBody(body, { required: true });
      if (!bodyValidation.valid) {
        if (bodyValidation.error === 'body is required') {
          logEvent(req, '/api/proxy/issues/comments', 400);
        }
        return badRequest.json(res, bodyValidation.error);
      }
      if (body.length > MAX_COMMENT_LENGTH) {
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      const commentUpdate = normalizeWritePayload(await provider.updateComment(token, commentId, body), 'comment');
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentUpdate, 'Comment was not updated')) return;
      commentDedupeGenerations.bump(req.proxyUrlKey);
      logEvent(req, '/api/proxy/issues/comments', 200);
      res.status(200).json(commentUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy update comment error:', err.message);
      jsonError(res, status, 'Failed to update comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  // Body-size exception, scoped to THIS route only (mirrors the feedback
  // route's own parser, routes/workspace-api.js): the global
  // `express.json({ limit: '250kb' })` (server.js) only matches
  // `application/json`, so a caller sending the base64 image payload with a
  // non-JSON content type (e.g. `text/plain`) passes through it unparsed; this
  // permissive parser (raised limit) then parses it. A small `application/json`
  // body is already parsed by the global parser by the time it gets here —
  // body-parser no-ops on an already-parsed body — so it keeps the 250kb
  // ceiling and this exception cannot leak to other routes.
  const ATTACHMENT_UPLOAD_BODY_LIMIT = '14mb'; // ~4/3 base64 expansion of MAX_ATTACHMENT_BYTES + JSON overhead
  const attachmentUploadBodyParser = json({ type: () => true, limit: ATTACHMENT_UPLOAD_BODY_LIMIT });
  // Stand-in for the `![](assetUrl)` markdown before the real assetUrl exists
  // (it's only returned by uploadFile itself): comfortably covers "![]()" (4
  // chars) plus a real Linear asset URL, so the pre-upload estimate below never
  // passes a body that the real embed would then push over the limit.
  const ATTACHMENT_EMBED_RESERVE = 200;

  /**
   * POST /api/proxy/issues/:issueId/attachments (LIN-891)
   * Agent-facing upload: attach a base64 raster image to an issue, either as a
   * new comment (default "comment" target) or appended to the description
   * ("description" target). The uploaded asset is embedded as markdown
   * `![](assetUrl)`, so it is immediately readable through the EXISTING `md:`
   * read path (lib/proxy-wire.js) — no new read-side plumbing.
   *
   * Deliberately NOT the human feedback widget's `/api/image` route (session-
   * authed, human-only) — this is a separate Bearer-token route that reuses
   * its underlying primitives end-to-end: `provider.uploadFile()` (LIN-636)
   * and the raster magic-byte sniffing guard (LIN-682, `parseFeedbackImage` /
   * `sniffRasterType`, now shared via lib/attachment-upload.js). No formal
   * `attachmentCreate` mutation exists in this codebase (per LIN-871's
   * research) — this route does not assume one.
   */
  router.post('/api/proxy/issues/:issueId/attachments', proxyLimiter, authenticateProxyToken, requireWriteScope, attachmentUploadBodyParser, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/attachments';
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, endpoint, reason);
      }
      if (denyIfUnsupported(provider, 'uploadFile', req, res, endpoint)) return;

      const { image, target, body } = req.body || {};
      if (target !== undefined && target !== 'comment' && target !== 'description') {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'target must be "comment" or "description"');
      }
      const resolvedTarget = target || 'comment';
      const writeCapability = resolvedTarget === 'description' ? 'updateIssue' : 'createComment';
      if (denyIfUnsupported(provider, writeCapability, req, res, endpoint)) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      // LIN-2154: shared validator (optional body — the relay's caption is
      // never required). Its native order (type-check then dangerous-chars,
      // both before the length/budget math below) is unchanged by the move.
      const bodyValidation = validateCommentBody(body, { required: false });
      if (!bodyValidation.valid) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, bodyValidation.error);
      }

      if (!image) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'image is required');
      }
      const parsed = parseFeedbackImage(image);
      if (!parsed) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'image must be a base64 data URL or { data, contentType?, filename? } decoding to a PNG/JPEG/GIF/WEBP');
      }
      if (parsed.bytes.length > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'image too large');
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, endpoint)) return;

      // Pre-validate the projected final length BEFORE uploadFile() runs, using
      // ATTACHMENT_EMBED_RESERVE in place of the not-yet-known assetUrl. This
      // turns an oversized `body` into a 400 with no side effect, instead of
      // the upload running unconditionally and only then discovering (via the
      // post-write check below / inside applyDescriptionEdit) that nothing
      // could reference it — an orphaned, wasted Linear asset per call.
      const bodyBudget = body ? body.length + 2 : 0; // "\n\n" separator before the embed
      if (resolvedTarget === 'description') {
        if (denyIfMissingRead(provider, 'issueDescription', req, res, endpoint)) return; // site 4
        const issue = await provider.issueDescription(token, issueId);
        if (!issue) {
          logEvent(req, endpoint, 404);
          return notFound.json(res, 'Issue not found');
        }
        const currentLength = (issue.description || '').length;
        const separator = currentLength > 0 ? 2 : 0;
        if (currentLength + separator + bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_DESCRIPTION_LENGTH) {
          logEvent(req, endpoint, 400);
          return badRequest.json(res, 'resulting description exceeds maximum length');
        }
      } else if (bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_COMMENT_LENGTH) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      const assetUrl = await provider.uploadFile(token, parsed.bytes, {
        contentType: parsed.contentType,
        filename: parsed.filename,
      });
      const markdown = `![](${assetUrl})`;
      const embedded = body ? `${body}\n\n${markdown}` : markdown;

      if (resolvedTarget === 'description') {
        return applyDescriptionEdit(req, res, endpoint, (current) => appendBlock(current, embedded));
      }

      if (embedded.length > MAX_COMMENT_LENGTH) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }
      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, embedded), 'comment');
      if (writeRejected(req, res, endpoint, commentCreate, 'Comment was not created')) return;

      // Best-effort Harbour-comments ledger record (LIN-2648) — same discipline
      // as the plain-comment seam above: a single attempt, caught and logged,
      // never propagated, never retried.
      if (harbourCommentsStore) {
        try {
          const newCommentId = commentCreate.comment?.id;
          if (newCommentId) {
            await harbourCommentsStore.record({ urlKey: req.proxyUrlKey, commentId: newCommentId });
          }
        } catch (ledgerErr) {
          console.error('Harbour-comments ledger record failed:', ledgerErr.message);
        }
      }

      logEvent(req, endpoint, 201);
      res.status(201).json(commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy attachment upload error:', err.message);
      jsonError(res, status, 'Failed to upload attachment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/relations
   * Create a relation between issues.
   */
  router.post('/api/proxy/issues/:issueId/relations', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }
      if (denyIfUnsupported(provider, 'createRelation', req, res, '/api/proxy/issues/relations')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { type, relatedIssueId } = req.body;
      const validTypes = ['blocks', 'blocked-by', 'duplicate', 'related'];
      if (!type || !validTypes.includes(type)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return badRequest.json(res, `type must be one of: ${validTypes.join(', ')}`);
      }

      if (!relatedIssueId || !isValidIssueId(relatedIssueId)) {
        return badRequest.json(res, 'Valid relatedIssueId is required');
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/relations')) return;

      // The provider owns the blocked-by → inverse-blocks sugar (ids swapped).
      const issueRelationCreate = normalizeWritePayload(await provider.createRelation(token, issueId, { type, relatedIssueId }), 'issueRelation');
      if (writeRejected(req, res, '/api/proxy/issues/relations', issueRelationCreate, 'Relation was not created')) return;
      logEvent(req, '/api/proxy/issues/relations', 201);
      res.status(201).json(issueRelationCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy create relation error:', err.message);
      jsonError(res, status, 'Failed to create relation', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/relations/:relationId
   * Remove a relation. The relationId is the IssueRelation's own id, which is
   * exposed on the nodes returned by GET /relations/:issueId and GET /issue/:id.
   *
   * Note: :issueId is accepted for a consistent URL shape with the other
   * /issue/:issueId/... endpoints, but the delete is keyed solely on relationId
   * (Linear deletes by relation id, not by the issue pair). It is validated for
   * format but not otherwise used.
   */
  router.delete('/api/proxy/issues/:issueId/relations/:relationId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }
      if (denyIfUnsupported(provider, 'deleteRelation', req, res, '/api/proxy/issues/relations')) return;

      const { issueId, relationId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(relationId)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return badRequest.json(res, 'Invalid relation ID format');
      }

      const issueRelationDelete = await provider.deleteRelation(token, relationId);
      if (writeRejected(req, res, '/api/proxy/issues/relations', issueRelationDelete, 'Relation was not removed')) return;
      logEvent(req, '/api/proxy/issues/relations', 200);
      res.json(issueRelationDelete);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy delete relation error:', err.message);
      jsonError(res, status, 'Failed to delete relation', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/labels
   * Add a label to an issue.
   *
   * Note: This performs a Read-Modify-Write cycle (fetch current labels, then
   * update with the new set) because Linear's GraphQL API requires sending the
   * full label ID array. Concurrent label modifications (e.g. from the Linear
   * UI and this proxy simultaneously) could overwrite each other. This is an
   * inherent limitation of Linear's label API — there is no atomic add/remove.
   */
  router.post('/api/proxy/issues/:issueId/labels', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }
      if (denyIfUnsupported(provider, 'addLabel', req, res, '/api/proxy/issues/labels')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { labelId } = req.body;
      if (!labelId || typeof labelId !== 'string') {
        logEvent(req, '/api/proxy/issues/labels', 400);
        return badRequest.json(res, 'Valid labelId is required');
      }

      // LIN-556: labelId may be a UUID or a label name (case-insensitive).
      const resolvedLabelId = await resolveLabelInput(provider, token, labelId);

      // Fetch current labels (the read half of the label read-modify-write).
      if (denyIfMissingRead(provider, 'issueLabels', req, res, '/api/proxy/issues/labels')) return; // site 5
      const issue = await provider.issueLabels(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }

      const currentLabelIds = (issue.labels?.nodes || []).map(l => l.id);
      if (currentLabelIds.includes(resolvedLabelId)) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label already present' });
      }

      if (denyIfMissingRead(provider, 'updateIssueLabels', req, res, '/api/proxy/issues/labels')) return; // site 6
      const issueUpdate = await provider.updateIssueLabels(token, issueId, [...currentLabelIds, resolvedLabelId]);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not added')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy add label error:', err.message);
      jsonError(res, status, 'Failed to add label', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/labels/:labelId
   * Remove a label from an issue.
   *
   * Note: Same Read-Modify-Write race condition caveat as the add-label
   * endpoint above. See POST /labels comment for details.
   */
  router.delete('/api/proxy/issues/:issueId/labels/:labelId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }
      if (denyIfUnsupported(provider, 'removeLabel', req, res, '/api/proxy/issues/labels')) return;

      const { issueId, labelId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      // LIN-556: labelId may be a UUID or a label name (case-insensitive).
      const resolvedLabelId = await resolveLabelInput(provider, token, labelId);

      // Fetch current labels (the read half of the label read-modify-write).
      if (denyIfMissingRead(provider, 'issueLabels', req, res, '/api/proxy/issues/labels')) return; // site 7
      const issue = await provider.issueLabels(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }

      const currentLabelIds = (issue.labels?.nodes || []).map(l => l.id);
      const filtered = currentLabelIds.filter(id => id !== resolvedLabelId);

      if (filtered.length === currentLabelIds.length) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label not present' });
      }

      if (denyIfMissingRead(provider, 'updateIssueLabels', req, res, '/api/proxy/issues/labels')) return; // site 8
      const issueUpdate = await provider.updateIssueLabels(token, issueId, filtered);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not removed')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy remove label error:', err.message);
      jsonError(res, status, 'Failed to remove label', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  return router;
}
