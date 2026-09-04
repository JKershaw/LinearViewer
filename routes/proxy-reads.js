/**
 * Group D read routes (LIN-679 Stage 3a / LIN-2536: extracted from
 * routes/proxy.js, byte-identical handler bodies).
 *
 * Consumer-API GET endpoints: /me, /credential-health, /teams, /projects,
 * /issues, /issues/:issueId, /search, /states/:teamId, /labels, /cycles,
 * /cycles|cycle/:cycleId, /issues/:issueId/relations|/relations/:issueId,
 * /attachments/:id.
 */
import { Router } from 'express';
import { applyTrashedSignal, isTrashed } from '../lib/trashed-signal.js';
import {
  flattenIssue,
  flattenCycle,
  flattenRelations,
  decodeAttachmentHandle,
  relayContentTypeFromName,
  GITHUB_UPLOAD_HOSTS,
  neutralizeProject,
  MAX_ATTACHMENT_BYTES,
} from '../lib/proxy-wire.js';
import { badRequest, jsonError, notFound } from '../lib/errors.js';
import { createProxyFetch } from '../lib/proxy-fetch.js';
import { UUID_REGEX, isValidIssueId, requireTeamMembership, TeamNotFoundError } from '../lib/workspace.js';
import { graphqlErrorExtra, graphqlErrorDetail } from '../lib/proxy-graphql-errors.js';

// D's only consumer of this cap (routes/proxy.js:1745/:1747 before the move).
// Unlike MAX_ATTACHMENT_BYTES this has no group-E consumer, so it moves with D
// rather than being lifted to lib/proxy-wire.js.
const MAX_SEARCH_LENGTH = 500;

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local; its own internal call closes over rejectedCredentialRegistry/BYTE_IDENTICAL_ESCALATION_THRESHOLD from the SAME createProxyRoutes invocation — safe by reference, not by absence of D-local refs)
 * @param {Object} deps.proxyEventStore - Proxy event/audit storage instance (composer param); used inside /credential-health's own try/catch — a missed injection here returns a generic 500, not a thrown error
 */
export function createReadRoutes({ proxyLimiter, authenticateProxyToken, resolveProviderAccess, denyIfUnsupported, logEvent, workspaceUnavailable, graphqlErrorStatus, proxyEventStore }) {
  const router = Router();

  /**
   * GET /api/proxy/me
   */
  router.get('/api/proxy/me', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/me', reason);
      }
      if (denyIfUnsupported(provider, 'viewer', req, res, '/api/proxy/me')) return;

      const user = await provider.viewer(token);
      logEvent(req, '/api/proxy/me', 200);
      res.json(user);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/me', status);
      console.error('Proxy /me error:', err.message);
      jsonError(res, status, 'Failed to fetch user info', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/credential-health
   *
   * Consumer-lane provider credential health (LIN-2076 Half B; extended by
   * LIN-1746). Bounded to the token it authenticated with — never
   * workspace-wide token metadata, which is the session-authed
   * `/workspace/:urlKey/api/proxy/credential-health` route's job and stays
   * exactly as it is. Two DIFFERENT questions, both answered from this one
   * self-scoped read:
   *
   * - The top-level fields (LIN-2076): "is Linear rejecting a credential I
   *   DID resolve?" — `providerLaneOccupancy`, a time-bucketed occupancy
   *   rate over this token's own `stage: 'provider-lane'` rows, not a raw
   *   call-count ratio (a caller's own retries would otherwise inflate a
   *   single bad bucket's apparent weight). `verdict: 'unknown'` — never a
   *   false `ok` — until at least `OCCUPANCY_MIN_BUCKETS` distinct buckets
   *   have carried this token's own provider-lane traffic.
   * - `workspaceAccess` (LIN-1746): "can I even resolve a workspace
   *   credential AT ALL?" — the non-ownerless credential-death class
   *   (`session_expired` / `owner_signed_out` / `owner_mismatch` /
   *   `not_connected`) that arrives as a 503 from `workspaceUnavailable()`
   *   BEFORE any provider-lane credential resolves, invisible to the
   *   occupancy read above by construction (that read is stage-filtered).
   *   `recentFailureReasons` tallies this token's own recent 503 reasons;
   *   `verdict: 'unknown'` until the SAME reason has repeated at least
   *   `RECENT_REASON_MIN_STREAK` times — a single failure is genuinely
   *   ambiguous between transient and permanently dead (this ticket's own
   *   framing) — at which point `dominantReason` names it, so a worker can
   *   stop guessing "the workspace is disconnected" and ask for re-dispatch
   *   instead (the exact LIN-1576 misdiagnosis this ticket exists to
   *   prevent).
   *
   * `windowMs` (optional query param) lets a caller widen the look-back for
   * BOTH halves together; clamped server-side (`resolveOccupancyWindow` /
   * `resolveCredentialHealthWindow`) regardless of what is requested.
   */
  router.get('/api/proxy/credential-health', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const requestedWindowMs = req.query.windowMs !== undefined ? parseInt(req.query.windowMs, 10) : undefined;
      // LIN-1746: one query for both halves (found by code review — this
      // route is meant to be cheap enough to poll; two separate finds()
      // against the same collection/tokenId on every call was a needless
      // doubling of I/O once both halves shared one window).
      const { occupancy, workspaceAccess } = await proxyEventStore.listSelfCredentialHealth(req.proxyUrlKey, req.proxyTokenId, { windowMs: requestedWindowMs });
      logEvent(req, '/api/proxy/credential-health', 200);
      res.json({ ...occupancy, workspaceAccess });
    } catch (err) {
      logEvent(req, '/api/proxy/credential-health', 500);
      console.error('Proxy consumer credential-health error:', err.message);
      jsonError(res, 500, 'Failed to read credential health');
    }
  });

  /**
   * GET /api/proxy/teams
   */
  router.get('/api/proxy/teams', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/teams', reason);
      }

      const teams = await provider.fetchTeams(token);
      logEvent(req, '/api/proxy/teams', 200);
      res.json({ teams, truncated: !!teams.truncated });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/teams', status);
      console.error('Proxy /teams error:', err.message);
      jsonError(res, status, 'Failed to fetch teams', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/projects
   */
  router.get('/api/proxy/projects', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/projects', reason);
      }
      if (denyIfUnsupported(provider, 'projects', req, res, '/api/proxy/projects')) return;

      const projectList = await provider.projects(token);
      logEvent(req, '/api/proxy/projects', 200);
      res.json({ projects: projectList.map(neutralizeProject) });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/projects', status);
      console.error('Proxy /projects error:', err.message);
      jsonError(res, status, 'Failed to fetch projects', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues
   */
  router.get('/api/proxy/issues', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }
      if (denyIfUnsupported(provider, 'issues', req, res, '/api/proxy/issues')) return;

      let teamId = req.query.teamId || null;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 250);
      // Opaque page cursor: pass the previous response's pageInfo.endCursor back
      // as `after` (or the `cursor` alias) to fetch the next slice. Treated
      // verbatim — never parsed/validated here — because its format is
      // provider-defined (Linear = base64 string, Local = stringified offset).
      // Absent → null, i.e. today's first-page behaviour (LIN-1511).
      const after = req.query.after ?? req.query.cursor ?? null;

      // LIN-2025: a well-formed-but-unmatched team id must fail loud instead
      // of silently widening to the whole workspace — an autonomous caller
      // cannot detect a dropped filter (John's ruling, 2026-08-10). Guarded
      // on teamId being present so the hot unfiltered-issues path pays no
      // extra provider round trip; a teamless provider's empty fetchTeams()
      // passes the raw value straight through (F1).
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const { nodes, pageInfo } = await provider.issues(token, { teamId, first: limit, after });
      logEvent(req, '/api/proxy/issues', 200);
      res.json({
        issues: nodes.map(flattenIssue),
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage || false,
          endCursor: pageInfo.endCursor || null
        }
      });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/issues', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy /issues error:', err.message);
      jsonError(res, status, 'Failed to fetch issues', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId
   */
  router.get('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }
      if (denyIfUnsupported(provider, 'issueDetail', req, res, '/api/proxy/issues/:id')) return;

      const { issueId } = req.params;

      // Allow UUID or identifier (e.g., "LIN-123")
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const issue = await provider.issueDetail(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/:id', 404);
        return notFound.json(res, 'Issue not found');
      }

      if (issue.comments?.nodes) {
        issue.comments.nodes.sort((a, b) => {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
      }

      // LIN-401: a trashed issue still resolves by ID with a stale pre-deletion
      // state. Override it to a terminal Trashed/canceled state + trashed flag so
      // a consumer cannot mistake the ghost for live work.
      applyTrashedSignal(issue);

      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(flattenIssue(issue));
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy /issue error:', err.message);
      jsonError(res, status, 'Failed to fetch issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/search
   */
  router.get('/api/proxy/search', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/search', reason);
      }
      if (denyIfUnsupported(provider, 'search', req, res, '/api/proxy/search')) return;

      const query = req.query.q;
      if (!query || typeof query !== 'string') {
        logEvent(req, '/api/proxy/search', 400);
        return badRequest.json(res, 'q query parameter is required');
      }

      if (query.length > MAX_SEARCH_LENGTH) {
        logEvent(req, '/api/proxy/search', 400);
        return badRequest.json(res, `Search query too long (max ${MAX_SEARCH_LENGTH})`);
      }

      const results = await provider.search(token, query, { first: 50 });
      logEvent(req, '/api/proxy/search', 200);
      res.json({ issues: results.map(flattenIssue) });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/search', status);
      console.error('Proxy /search error:', err.message);
      jsonError(res, status, 'Failed to search issues', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/states/:teamId
   */
  router.get('/api/proxy/states/:teamId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/states', reason);
      }
      if (denyIfUnsupported(provider, 'states', req, res, '/api/proxy/states')) return;

      const { teamId } = req.params;
      // LIN-2025: no local format gate — an invalid/unmatched team id is
      // surfaced by the provider itself (caught below), same as any other
      // provider-rejected input on this route.

      // Provider already sorts by board position (drop the route's duplicate sort).
      const stateList = await provider.states(token, teamId);
      logEvent(req, '/api/proxy/states', 200);
      res.json({ states: stateList });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/states', status);
      console.error('Proxy /states error:', err.message);
      jsonError(res, status, 'Failed to fetch states', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/labels
   */
  router.get('/api/proxy/labels', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/labels', reason);
      }
      if (denyIfUnsupported(provider, 'labels', req, res, '/api/proxy/labels')) return;

      let teamId = req.query.teamId || null;
      // LIN-2025: fail loud on a well-formed-but-unmatched team id rather
      // than silently widening to the whole workspace — see /api/proxy/issues.
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const labelList = await provider.labels(token, teamId);
      logEvent(req, '/api/proxy/labels', 200);
      res.json({ labels: labelList });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/labels', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/labels', status);
      console.error('Proxy /labels error:', err.message);
      jsonError(res, status, 'Failed to fetch labels', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/cycles
   * List cycles, optionally filtered by team.
   */
  router.get('/api/proxy/cycles', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycles', reason);
      }
      if (denyIfUnsupported(provider, 'cycles', req, res, '/api/proxy/cycles')) return;

      let teamId = req.query.teamId || null;
      // LIN-2025: fail loud on a well-formed-but-unmatched team id rather
      // than silently widening to the whole workspace — see /api/proxy/issues.
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const cycleList = await provider.cycles(token, teamId);
      logEvent(req, '/api/proxy/cycles', 200);
      res.json({ cycles: cycleList });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/cycles', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/cycles', status);
      console.error('Proxy /cycles error:', err.message);
      jsonError(res, status, 'Failed to fetch cycles', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/cycles/:cycleId  (canonical — plural, mirrors the /cycles list)
   * GET /api/proxy/cycle/:cycleId    (forgiving alias, singular)
   * Get cycle detail with issues. Shared :cycleId param across both forms (LIN-528).
   */
  router.get(['/api/proxy/cycles/:cycleId', '/api/proxy/cycle/:cycleId'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycle', reason);
      }
      if (denyIfUnsupported(provider, 'cycleDetail', req, res, '/api/proxy/cycle')) return;

      const { cycleId } = req.params;
      if (!UUID_REGEX.test(cycleId)) {
        logEvent(req, '/api/proxy/cycle', 400);
        return badRequest.json(res, 'Invalid cycle ID format');
      }

      const cycle = await provider.cycleDetail(token, cycleId);
      if (!cycle) {
        logEvent(req, '/api/proxy/cycle', 404);
        return notFound.json(res, 'Cycle not found');
      }

      logEvent(req, '/api/proxy/cycle', 200);
      res.json(flattenCycle(cycle));
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/cycle', status);
      console.error('Proxy /cycle error:', err.message);
      jsonError(res, status, 'Failed to fetch cycle', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId/relations  (canonical — heals the read/write split-brain;
   *     the write form already lives at POST /issues/:issueId/relations)
   * GET /api/proxy/relations/:issueId           (forgiving alias, original flat form)
   * Shared :issueId param across both forms (LIN-528).
   */
  router.get(['/api/proxy/issues/:issueId/relations', '/api/proxy/relations/:issueId'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/relations', reason);
      }
      if (denyIfUnsupported(provider, 'relations', req, res, '/api/proxy/relations')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/relations', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const issueRelations = await provider.relations(token, issueId);
      if (!issueRelations) {
        logEvent(req, '/api/proxy/relations', 404);
        return notFound.json(res, 'Issue not found');
      }

      // LIN-401: this query selects only relations (no root state to override),
      // so a trashed target is signalled by a top-level `trashed: true` flag.
      // The relations themselves are still returned — a consumer may legitimately
      // want to see what a now-deleted issue was related to.
      logEvent(req, '/api/proxy/relations', 200);
      // Plain arrays (no {nodes} wrapper) to match /issues/{id} and the rest of
      // the read surface — one flat convention across every endpoint (LIN-310).
      res.json({
        trashed: isTrashed(issueRelations),
        ...flattenRelations(issueRelations)
      });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/relations', status);
      console.error('Proxy /relations error:', err.message);
      jsonError(res, status, 'Failed to fetch relations', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  // =========================================================================
  // GET /api/proxy/attachments/:id — Bearer-authed image byte-relay (LIN-650)
  // =========================================================================
  //
  // External consumers hold an OPAQUE attachment handle (LIN-649), never a
  // backend URL — the proxy is deliberately source-neutral and strips asset
  // URLs — and their *proxy* token 401s against the asset host, so they cannot
  // fetch image bytes directly. This relay decodes the handle and fetches the
  // bytes server-side, authenticating BY PROVIDER/HOST (LIN-771): Linear asset
  // hosts get the workspace bearer token; GitHub user-content hosts are public and
  // fetched with no auth so the workspace token is never sent cross-provider. The
  // consumer is the external automation agent reading task/comment image
  // attachments (direct beneficiary; no other endpoint changes).
  //
  // `md:` markdown handles resolve here. The URL is recovered by
  // `decodeAttachmentHandle`, SSRF-guarded against the host allowlist
  // (mirrors the LIN-156 `/api/image` guard model: https-only, exact-host
  // allowlist, no path traversal, no redirects, 10 MB cap), then fetched through
  // the proxy-aware egress path. Two media classes are accepted (LIN-750):
  //   - images: recognised by the upstream `image/*` content-type;
  //   - non-image text/source files: recognised by the `#name=<filename>` hint the
  //     discovery layer encoded in the handle (upload URLs are extension-less and
  //     upstream often serves octet-stream, so the hint is authoritative), gated
  //     to a small allowlist (`relayContentTypeFromName`).
  // A content-type that is neither an allowlisted file nor an image is rejected
  // cleanly (never a 500).
  //
  // SAFE-DOWNLOAD CONTRACT (LIN-774): regardless of class, EVERY relayed byte is
  // served as a forced download — `Content-Disposition: attachment` +
  // `X-Content-Type-Options: nosniff` with a neutral `application/octet-stream`
  // content-type. The relay never preserves the upstream content-type and never
  // serves anything inline, so `image/svg+xml` (which would otherwise sniff/render
  // as active markup) cannot become a stored-XSS vector. The security boundary is
  // the host-allowlist + size cap + this download-coercion — NOT a per-extension
  // type-allowlist (the file-extension gate above is an access filter, not the
  // thing standing between bytes and inline execution).
  //
  // Both `md:` and `att:` relay through this SAME host-allowlist — one set, not
  // a parallel reimplementation that could drift. Any URL outside it is a
  // clean, machine-readable rejection; we never silently 500 on the missing
  // capability. Kept in lockstep with discovery's UPLOAD_HOSTS (lib/proxy-
  // wire.js): every host discovery can mint a handle for must be relayable
  // here, or discovery would emit a handle this guard refuses. The GitHub
  // asset hosts are sourced from the SAME exported set so the two allowlists
  // cannot drift (LIN-771). `linear.app` stays relay-only (it is an SSRF
  // allow, not a discovery upload host).
  const ATTACHMENT_ALLOWED_HOSTS = new Set([
    'uploads.linear.app', 'cdn.linear.app', 'linear.app',
    ...GITHUB_UPLOAD_HOSTS,
  ]);

  // Shared SSRF/allowlist guard (LIN-890) — the SAME logic for both the `md:`
  // and `att:` handle types, so the two paths provably cannot drift into a
  // parallel reimplementation. Returns `{ ok: true, urlObj }` on success or
  // `{ ok: false, reason, message }` on failure; `reason` distinguishes
  // 'host-not-allowed' from the other guard failures so a caller can map it to
  // a distinct error code where that matters (see the `att:` branch below).
  function ssrfGuardUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return { ok: false, reason: 'not-https', message: 'Invalid attachment URL: must be HTTPS' };
    }
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return { ok: false, reason: 'bad-format', message: 'Invalid attachment URL format' };
    }
    if (!ATTACHMENT_ALLOWED_HOSTS.has(urlObj.hostname)) {
      return { ok: false, reason: 'host-not-allowed', message: 'Invalid attachment URL: host not allowed' };
    }
    if (urlObj.pathname.includes('..')) {
      return { ok: false, reason: 'path-traversal', message: 'Invalid attachment URL: path traversal not allowed' };
    }
    return { ok: true, urlObj };
  }

  router.get('/api/proxy/attachments/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/attachments/:id';

    const decoded = decodeAttachmentHandle(req.params.id);
    if (!decoded) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment handle');
    }

    let fetchUrl, urlObj, nameHint, isGithubAssetHost, token, providerName;

    if (decoded.type === 'att') {
      // `att:` needs an authenticated provider call just to DISCOVER the URL,
      // before any SSRF check can run — unlike `md:`, whose URL is already
      // embedded in the handle. Resolve provider/token first, gate on the
      // capability (422 CAPABILITY_NOT_SUPPORTED for a provider with no
      // formal-attachment node — GitHub Issues included, since it correctly
      // never mints `att:` handles), then look up the attachment.
      const resolved = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (denyIfUnsupported(resolved.provider, 'fetchAttachment', req, res, endpoint)) return;
      if (!resolved.token) {
        return workspaceUnavailable(req, res, endpoint, resolved.reason);
      }
      // Never leave this call outside a catch: Express 4 does not auto-forward
      // an async rejection to error middleware, and this route has no
      // .catch(next) wrapper — an uncaught throw here hangs the request with
      // no response instead of erroring cleanly (LIN-890 close-out). The
      // Linear provider already normalizes its own "Entity not found" case to
      // null (handled by the check below); this catch is the backstop for
      // anything else (auth failure, network error, rate limit, an
      // unnormalized not-found from some other provider).
      let attachment;
      try {
        attachment = await resolved.provider.fetchAttachment(resolved.token, decoded.value);
      } catch (err) {
        const status = graphqlErrorStatus(err, req);
        logEvent(req, endpoint, status);
        console.error('Proxy attachment resolve error:', err.message);
        return jsonError(res, status, 'Failed to resolve attachment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
      }
      if (!attachment) {
        logEvent(req, endpoint, 404);
        return notFound.json(res, 'Attachment not found');
      }
      const guard = ssrfGuardUrl(attachment.url);
      if (!guard.ok) {
        // Off-allowlist is an EXPECTED, distinct outcome for `att:` — Linear
        // attachments can legitimately point at Figma/Drive/Slack etc, not a
        // caller error — so it gets its own 422, unlike `md:`'s bare 400.
        if (guard.reason === 'host-not-allowed') {
          logEvent(req, endpoint, 422);
          return jsonError(res, 422, 'Attachment host is not in the allowed set', {
            code: 'ATTACHMENT_HOST_NOT_ALLOWED',
          });
        }
        logEvent(req, endpoint, 400);
        return badRequest.json(res, guard.message);
      }
      urlObj = guard.urlObj;
      isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(urlObj.hostname);
      token = resolved.token;
      providerName = resolved.provider?.name;
      // The relay's file-type gate needs a filename hint; `att:` handles carry
      // none (unlike `md:`'s `#name=` fragment), so supply the attachment's own
      // title — otherwise every non-image formal attachment would 400 as
      // "unsupported content-type" even after URL resolution succeeds.
      nameHint = attachment.title || null;
      fetchUrl = attachment.url;
    } else {
      // `md:` handle — decoded.value is the source image URL, already embedded
      // in the handle. BYTE-IDENTICAL to before LIN-890: the SSRF guard runs
      // first, and provider/token resolution stays after it — collapsing this
      // into a shared "resolve provider first" flow would change `md:`'s error
      // precedence (an SSRF-invalid URL currently 400s regardless of workspace
      // availability; moving provider resolution earlier would make it 503
      // first when the workspace is also down).
      const imageUrl = decoded.value;
      const guard = ssrfGuardUrl(imageUrl);
      if (!guard.ok) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, guard.message);
      }
      urlObj = guard.urlObj;

      // Resolve the fetch auth BY PROVIDER/HOST (LIN-771). Historically the relay
      // sent the workspace's Linear bearer token to every asset host — correct for
      // Linear, but a token-leak hazard for GitHub user-content. We instead key off
      // the asset host (which uniquely identifies its provider):
      //   - Linear hosts  → authenticated with the workspace token (unchanged: the
      //     asset host requires it). Resolved through the shared provider/token seam
      //     so an unavailable workspace still yields the structured 503 envelope.
      //   - GitHub asset hosts → public user-content CDNs; fetched WITHOUT any auth
      //     header so the workspace token is never sent cross-provider. A workspace
      //     token is therefore not required to relay them.
      // Known gap, sequenced with S4/S5 (LIN-773/774, relay safety): the signed
      // `private-user-images.githubusercontent.com` form and the `github.com/
      // user-attachments/assets/<id>` form 302-redirect to the real bytes, which the
      // `redirect: 'error'` SSRF guard below rejects (a clean 400, never a 500).
      // Redirect-safe relaying of those is owned by S5; `user-images.
      // githubusercontent.com` serves bytes directly and works today.
      isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(urlObj.hostname);
      const resolved = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!isGithubAssetHost && !resolved.token) {
        return workspaceUnavailable(req, res, endpoint, resolved.reason);
      }
      token = resolved.token;
      providerName = resolved.provider?.name;

      // Non-image file relay (LIN-750): discovery encodes the filename in a
      // `#name=<filename>` fragment so we can type extension-less upload bytes.
      // The fragment is stripped before egress (it must never reach the asset
      // host); `relayContentTypeFromName` is the sole type-gate and returns null
      // for anything not on the allowlist.
      nameHint = new URLSearchParams(urlObj.hash.replace(/^#/, '')).get('name');
      fetchUrl = imageUrl.split('#')[0];
    }

    const typedFromHint = nameHint ? relayContentTypeFromName(nameHint) : null;
    const isFileRelay = !!typedFromHint && !typedFromHint.startsWith('image/');

    try {
      // Proxy-aware egress: route through the egress proxy when one is
      // configured, exactly like every other Linear call.
      const customFetch = (await createProxyFetch()) || fetch;
      // Auth header by host (LIN-771) AND by provider (LIN-1891) — two
      // INDEPENDENT booleans, checked alongside each other, never collapsed
      // into one condition:
      //   - GitHub asset hosts are public user-content; never send Authorization
      //     regardless of provider, so the workspace token is never leaked
      //     cross-provider (unchanged).
      //   - A Linear-hosted asset gets the bearer token ONLY when the resolved
      //     workspace's own provider is `linear` — deliberately `linear`-only,
      //     never `linear` OR `local`. Every other provider (local, jira,
      //     github, github-projects) sends NO Authorization header when
      //     relaying a Linear-hosted asset: today those workspaces send their
      //     OWN credential to Linear's CDN on every such relay, and stopping
      //     exactly that cross-provider credential egress is why this check
      //     exists. It also sidesteps a `token ? (scope ?? token) : token`
      //     structured scope object (edit 4) ever reaching this template —
      //     `resolveProviderAccess` returns jira/github/github-projects'
      //     {email,apiToken,site}/{token,repo} shape here, which would
      //     otherwise serialize as `Bearer [object Object]`.
      const fetchHeaders = (!isGithubAssetHost && providerName === 'linear')
        ? { Authorization: `Bearer ${token}` }
        : {};
      const response = await customFetch(fetchUrl, {
        method: 'GET',
        headers: fetchHeaders,
        redirect: 'error', // a redirect could bypass the SSRF allowlist
      });

      if (!response.ok) {
        logEvent(req, endpoint, response.status);
        return jsonError(res, response.status, 'Failed to fetch attachment');
      }

      // Type-gate. Images keep the original upstream-`image/*` contract; file
      // relays are typed from the (allowlisted) filename hint. Anything else is
      // rejected cleanly — never a 500.
      const upstreamType = response.headers.get('content-type') || '';
      if (!isFileRelay && !upstreamType.startsWith('image/')) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Invalid response: unsupported content-type');
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'Attachment too large');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'Attachment too large');
      }

      // Safe-download contract for ALL relayed bytes (LIN-774). Force download
      // with a neutral content-type + nosniff so nothing — most dangerously
      // `image/svg+xml` — can be sniffed back into a renderable/executable type or
      // served inline. We deliberately do NOT preserve the upstream content-type
      // (image or file): the upstream `image/*`/file class is used only to admit
      // the bytes (the gate above), never to type the response.
      const rawName = nameHint || urlObj.pathname.split('/').pop() || 'attachment';
      const safeName = rawName.replace(/[^\w.\- ]/g, '_') || 'attachment';
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${safeName}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=3600');
      logEvent(req, endpoint, 200);
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      // redirect: 'error' surfaces as a thrown fetch error on the native path.
      if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Redirects not allowed');
      }
      console.error('Proxy attachment relay error:', error.message);
      logEvent(req, endpoint, 502);
      jsonError(res, 502, 'Failed to fetch attachment');
    }
  });

  return router;
}
