/**
 * Consumer-API read routes (LIN-679 Stage 3a / LIN-2536 extraction; rebuilt
 * design-first in LIN-3569). Every route is a GET under /api/proxy, behind
 * the per-IP limiter and the consumer-token auth:
 *
 *   provider-backed (resolve a workspace credential, call the provider):
 *     /me, /teams, /projects, /issues, /issues/:issueId, /search,
 *     /states/:teamId, /labels, /cycles, /cycles|cycle/:cycleId,
 *     /issues/:issueId/relations | /relations/:issueId
 *   store-backed (read this token's own event rows, no provider):
 *     /credential-health, /credential-trail, /heartbeats
 *   byte relay:
 *     /attachments/:id
 *
 * Three shapes carry every route, so each rule is stated once:
 *
 *   providerRead  resolve -> 503 -> capability 422 -> work -> mapped catch
 *   storeRead     read -> 200, or 500 on any throw
 *   the relay     decode -> locate -> fetch -> admit -> safe download
 *
 * Contracts that are not visible in the code below:
 *
 * - ORDER of a provider read: resolve, 503, 422, validate, team-membership
 *   pre-read, provider call, 404, log, respond. Agents key off which status
 *   wins when two things are wrong at once (LIN-677: a down workspace is a
 *   wait, so it answers 503 before an unsupported capability answers 422).
 * - ENDPOINT STRINGS are a data contract. `logEvent` writes them to the
 *   event store, and /credential-trail and lib/kpi-stats.js read them back. They stay literal beside the routes they name.
 * - A LOCAL catch (rather than the global error handler) is what gives a
 *   failure its mapped status, its `detail`, and a logged event. The global
 *   handler sends a bare 500 and logs nothing.
 */
import { Router } from 'express';
import { buildHeartbeatView } from '../lib/consumer-heartbeat.js';
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
import { badRequest, clientErrorStatus, jsonError, notFound } from '../lib/errors.js';
import { createProxyFetch } from '../lib/proxy-fetch.js';
import { UUID_REGEX, isValidIssueId, requireTeamMembership, TeamNotFoundError } from '../lib/workspace.js';
import { graphqlErrorExtra, graphqlErrorDetail } from '../lib/proxy-graphql-errors.js';

const MAX_SEARCH_LENGTH = 500;
const MAX_PAGE_SIZE = 250;
const DEFAULT_PAGE_SIZE = 50;

// An absent query parameter stays `undefined`; anything else is parsed, and a
// NaN is passed on as-is because the event store clamps it.
const optionalInt = (value) => (value !== undefined ? parseInt(value, 10) : undefined);

const createdAtMs = (comment) => new Date(comment.createdAt).getTime() || 0;

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local; its own internal call closes over rejectedCredentialRegistry/BYTE_IDENTICAL_ESCALATION_THRESHOLD from the SAME createProxyRoutes invocation — safe by reference, not by absence of D-local refs)
 * @param {Object} deps.proxyEventStore - Proxy event/audit storage instance (composer param); used by the two store-backed routes, whose own catch turns a missed injection into a generic 500
 */
export function createReadRoutes({ proxyLimiter, authenticateProxyToken, resolveProviderAccess, denyIfUnsupported, logEvent, workspaceUnavailable, graphqlErrorStatus, proxyEventStore, consumerHeartbeatStore = null }) {
  const router = Router();

  // The status and body for a provider/GraphQL failure, logged against the
  // route's endpoint string. `failure` is the agent-facing message.
  function replyMappedFailure(req, res, endpoint, failure, err, status = graphqlErrorStatus(err, req)) {
    logEvent(req, endpoint, status);
    console.error(`Proxy ${endpoint} error:`, err.message);
    // graphqlErrorDetail reads req.resolvedProvider, so it follows the log.
    return jsonError(res, status, failure, { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
  }

  /**
   * The handler for a provider-backed read.
   *
   * spec.endpoint    the string logged and handed to the 503/422 helpers
   * spec.capability  provider method gated with 422, or null for none
   * spec.failure     message of the mapped failure reply
   * spec.source      true when `?source=` picks the credential (LIN-3335)
   * spec.teamScoped  true when a stale team id is a 404 TEAM_NOT_FOUND
   *
   * `work({ req, res, provider, token, reply })` validates, calls the
   * provider, then logs its own literal 200 and responds. `reply.refuse`
   * logs a 4xx against the endpoint and sends it.
   */
  function providerRead(spec, work) {
    const { endpoint, capability, failure, source = false, teamScoped = false } = spec;
    const reply = {
      refuse(req, res, status, message) {
        logEvent(req, endpoint, status);
        return jsonError(res, status, message);
      },
    };
    return async (req, res) => {
      try {
        // A fourth argument is passed only for source-routed reads: a
        // source-bearing resolve bypasses the credential cache (LIN-3335).
        const access = source
          ? await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source: req.query?.source })
          : await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
        const { token, reason, provider } = access;
        if (!token) {
          return workspaceUnavailable(req, res, endpoint, reason);
        }
        if (capability && denyIfUnsupported(provider, capability, req, res, endpoint)) return;
        await work({ req, res, provider, token, reply });
      } catch (err) {
        if (teamScoped && err instanceof TeamNotFoundError) {
          logEvent(req, endpoint, 404);
          return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
        }
        return replyMappedFailure(req, res, endpoint, failure, err);
      }
    };
  }

  // LIN-2025: a well-formed-but-unmatched team id fails loud (TEAM_NOT_FOUND)
  // instead of silently widening to the whole workspace — an autonomous
  // caller cannot detect a dropped filter. The membership pre-read happens
  // only when a team id was given, so the unfiltered path pays no extra
  // provider round trip; a teamless provider's empty list passes the raw id
  // straight through.
  async function scopeToTeam(provider, token, req) {
    const teamId = req.query.teamId || null;
    return teamId ? requireTeamMembership(await provider.fetchTeams(token), teamId) : null;
  }

  /**
   * The handler for a store-backed read: `read(req)` produces the body.
   * These routes never resolve a provider credential, so their own event
   * rows stay staged `proxy-token` and never pollute /credential-trail.
   */
  function storeRead(spec, read) {
    const { endpoint, failure } = spec;
    return async (req, res) => {
      try {
        const body = await read(req);
        logEvent(req, endpoint, 200);
        res.json(body);
      } catch (err) {
        logEvent(req, endpoint, 500);
        console.error(`Proxy consumer ${endpoint} error:`, err.message);
        jsonError(res, 500, failure);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Provider-backed reads
  // ---------------------------------------------------------------------------

  router.get('/api/proxy/me', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/me', capability: 'viewer', failure: 'Failed to fetch user info' },
    async ({ req, res, provider, token }) => {
      const user = await provider.viewer(token);
      logEvent(req, '/api/proxy/me', 200);
      res.json(user);
    },
  ));

  // The only provider read with no capability gate.
  router.get('/api/proxy/teams', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/teams', capability: null, failure: 'Failed to fetch teams' },
    async ({ req, res, provider, token }) => {
      const teams = await provider.fetchTeams(token);
      logEvent(req, '/api/proxy/teams', 200);
      res.json({ teams, truncated: !!teams.truncated });
    },
  ));

  router.get('/api/proxy/projects', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/projects', capability: 'projects', failure: 'Failed to fetch projects' },
    async ({ req, res, provider, token }) => {
      const projects = await provider.projects(token);
      logEvent(req, '/api/proxy/projects', 200);
      res.json({ projects: projects.map(neutralizeProject) });
    },
  ));

  router.get('/api/proxy/issues', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/issues', capability: 'issues', failure: 'Failed to fetch issues', teamScoped: true },
    async ({ req, res, provider, token }) => {
      // A junk or zero `limit` falls back to the default; the rest is clamped.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      // The page cursor is opaque and passed verbatim — its format belongs to
      // the provider (Linear: base64, Local: an offset). `cursor` is an alias
      // of `after`; absent means the first page (LIN-1511).
      const after = req.query.after ?? req.query.cursor ?? null;
      const teamId = await scopeToTeam(provider, token, req);

      const { nodes, pageInfo } = await provider.issues(token, { teamId, first: limit, after });
      logEvent(req, '/api/proxy/issues', 200);
      res.json({
        issues: nodes.map(flattenIssue),
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage || false,
          endCursor: pageInfo.endCursor || null,
        },
      });
    },
  ));

  router.get('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/issues/:id', capability: 'issueDetail', failure: 'Failed to fetch issue', source: true },
    async ({ req, res, provider, token, reply }) => {
      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return reply.refuse(req, res, 400, 'Invalid issue ID format');
      }
      const issue = await provider.issueDetail(token, issueId);
      if (!issue) {
        return reply.refuse(req, res, 404, 'Issue not found');
      }

      // Oldest first; a comment with an unparseable date sorts as time 0.
      issue.comments?.nodes?.sort((a, b) => createdAtMs(a) - createdAtMs(b));

      // LIN-401: a trashed issue still resolves by id with a stale pre-deletion
      // state. Override it to a terminal Trashed/canceled state plus a trashed
      // flag so a consumer cannot mistake the ghost for live work.
      applyTrashedSignal(issue);

      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(flattenIssue(issue));
    },
  ));

  router.get('/api/proxy/search', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/search', capability: 'search', failure: 'Failed to search issues' },
    async ({ req, res, provider, token, reply }) => {
      const query = req.query.q;
      if (!query || typeof query !== 'string') {
        return reply.refuse(req, res, 400, 'q query parameter is required');
      }
      if (query.length > MAX_SEARCH_LENGTH) {
        return reply.refuse(req, res, 400, `Search query too long (max ${MAX_SEARCH_LENGTH})`);
      }

      const results = await provider.search(token, query, { first: 50 });
      logEvent(req, '/api/proxy/search', 200);
      res.json({ issues: results.map(flattenIssue) });
    },
  ));

  // LIN-2025: no local format gate on the team id; the provider rejects a bad
  // one itself, like any other provider-rejected input. The endpoint string
  // drops the `:teamId`.
  router.get('/api/proxy/states/:teamId', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/states', capability: 'states', failure: 'Failed to fetch states' },
    async ({ req, res, provider, token }) => {
      // The provider already sorts by board position.
      const states = await provider.states(token, req.params.teamId);
      logEvent(req, '/api/proxy/states', 200);
      res.json({ states });
    },
  ));

  router.get('/api/proxy/labels', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/labels', capability: 'labels', failure: 'Failed to fetch labels', teamScoped: true },
    async ({ req, res, provider, token }) => {
      const teamId = await scopeToTeam(provider, token, req);
      const labels = await provider.labels(token, teamId);
      logEvent(req, '/api/proxy/labels', 200);
      res.json({ labels });
    },
  ));

  router.get('/api/proxy/cycles', proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/cycles', capability: 'cycles', failure: 'Failed to fetch cycles', teamScoped: true },
    async ({ req, res, provider, token }) => {
      const teamId = await scopeToTeam(provider, token, req);
      const cycles = await provider.cycles(token, teamId);
      logEvent(req, '/api/proxy/cycles', 200);
      res.json({ cycles });
    },
  ));

  // Canonical plural form plus a forgiving singular alias; one `:cycleId`
  // param across both (LIN-528).
  router.get(['/api/proxy/cycles/:cycleId', '/api/proxy/cycle/:cycleId'], proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/cycle', capability: 'cycleDetail', failure: 'Failed to fetch cycle' },
    async ({ req, res, provider, token, reply }) => {
      const { cycleId } = req.params;
      if (!UUID_REGEX.test(cycleId)) {
        return reply.refuse(req, res, 400, 'Invalid cycle ID format');
      }
      const cycle = await provider.cycleDetail(token, cycleId);
      if (!cycle) {
        return reply.refuse(req, res, 404, 'Cycle not found');
      }
      logEvent(req, '/api/proxy/cycle', 200);
      res.json(flattenCycle(cycle));
    },
  ));

  // Canonical nested form (the write form already lives at POST
  // /issues/:issueId/relations) plus the original flat alias; one `:issueId`
  // param across both (LIN-528).
  router.get(['/api/proxy/issues/:issueId/relations', '/api/proxy/relations/:issueId'], proxyLimiter, authenticateProxyToken, providerRead(
    { endpoint: '/api/proxy/relations', capability: 'relations', failure: 'Failed to fetch relations', source: true },
    async ({ req, res, provider, token, reply }) => {
      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return reply.refuse(req, res, 400, 'Invalid issue ID format');
      }
      const issueRelations = await provider.relations(token, issueId);
      if (!issueRelations) {
        return reply.refuse(req, res, 404, 'Issue not found');
      }

      // LIN-401: this query selects only relations, so there is no root state
      // to override; a trashed target is a top-level `trashed: true`. The
      // relations are still returned — a consumer may want to see what a
      // now-deleted issue was related to. Plain arrays, no {nodes} wrapper,
      // like every other read (LIN-310).
      logEvent(req, '/api/proxy/relations', 200);
      res.json({
        trashed: isTrashed(issueRelations),
        ...flattenRelations(issueRelations),
      });
    },
  ));

  // ---------------------------------------------------------------------------
  // Store-backed reads (LIN-2076, LIN-1746, LIN-3282)
  // ---------------------------------------------------------------------------

  // This token's own credential health, never workspace-wide token metadata.
  // Two questions from one read: the top-level fields say whether Linear is
  // rejecting a credential this token DID resolve (a time-bucketed occupancy
  // rate, `verdict: 'unknown'` until enough buckets exist); `workspaceAccess`
  // says whether a workspace credential can be resolved AT ALL (the 503
  // reasons that arrive before any provider-lane credential, invisible to the
  // stage-filtered occupancy read). `windowMs` widens the look-back for both
  // and is clamped by the store.
  router.get('/api/proxy/credential-health', proxyLimiter, authenticateProxyToken, storeRead(
    { endpoint: '/api/proxy/credential-health', failure: 'Failed to read credential health' },
    async (req) => {
      const { occupancy, workspaceAccess } = await proxyEventStore.listSelfCredentialHealth(
        req.proxyUrlKey, req.proxyTokenId, { windowMs: optionalInt(req.query.windowMs) });
      return { ...occupancy, workspaceAccess };
    },
  ));

  // This token's own provider-lane credential trail, newest first: which
  // credential source and fingerprint each call resolved, so a 401/200 flip
  // can be attributed from a proxy token (LIN-3282). Never exposes token
  // bytes. `endpoint` is the route pattern as logged, not the concrete id.
  // Only `stage: 'provider-lane'` rows appear, so this route's own reads
  // never pollute the window. `limit` and `windowMs` are clamped by the store.
  router.get('/api/proxy/credential-trail', proxyLimiter, authenticateProxyToken, storeRead(
    { endpoint: '/api/proxy/credential-trail', failure: 'Failed to read credential trail' },
    (req) => proxyEventStore.listSelfCredentialTrail(req.proxyUrlKey, req.proxyTokenId, {
      windowMs: optionalInt(req.query.windowMs),
      limit: optionalInt(req.query.limit),
    }),
  ));

  // LIN-1952: which dispatch consumers are reporting, how loaded each host is,
  // how many sessions each runs. Read scope, this token's workspace only. Not
  // under /api/proxy/runner/*, which needs the `take` grant. Newest first; an
  // entry is `stale` once ageMs > 3 x its intervalMs. Expired docs (15 min) are
  // filtered by the store query, not by a sweep.
  router.get('/api/proxy/heartbeats', proxyLimiter, authenticateProxyToken, storeRead(
    { endpoint: '/api/proxy/heartbeats', failure: 'Failed to read consumer heartbeats' },
    async (req) => {
      const now = new Date();
      const docs = await consumerHeartbeatStore.listLive(req.proxyUrlKey, now);
      return { heartbeats: docs.map(doc => buildHeartbeatView(doc, now)) };
    },
  ));

  // ---------------------------------------------------------------------------
  // GET /api/proxy/attachments/:id — Bearer-authed byte relay (LIN-650)
  // ---------------------------------------------------------------------------
  //
  // Consumers hold an OPAQUE attachment handle (LIN-649), never a backend URL,
  // and their proxy token 401s against the asset host, so the proxy decodes
  // the handle and fetches the bytes itself. Two handle types:
  //   att:  a formal attachment id; an authenticated provider call discovers
  //         the URL, so the workspace is resolved BEFORE the SSRF guard.
  //   md:   a markdown image URL embedded in the handle; the SSRF guard runs
  //         BEFORE the workspace is resolved, so an invalid URL is a 400
  //         whether or not the workspace is up.
  //
  // Both go through one host allowlist (https only, exact host, no `..`),
  // kept in lockstep with discovery's UPLOAD_HOSTS in lib/proxy-wire.js; the
  // GitHub hosts come from the same exported set so the two cannot drift
  // (LIN-771).
  //
  // Auth is by host AND provider (LIN-771, LIN-1891), two independent checks:
  // GitHub asset hosts are public and never get Authorization; a Linear asset
  // gets the bearer token only when the workspace's own provider is `linear`,
  // so another provider's credential is never sent to Linear's CDN.
  //
  // SAFE DOWNLOAD (LIN-774): every relayed byte is served as a forced
  // download — `Content-Disposition: attachment`, `nosniff`, and a neutral
  // `application/octet-stream`. The upstream type only ADMITS the bytes
  // (an `image/*`, or a filename hint on the file allowlist from LIN-750);
  // it never types the response, so `image/svg+xml` cannot render inline.
  const ATTACHMENT_ENDPOINT = '/api/proxy/attachments/:id';
  const ATTACHMENT_ALLOWED_HOSTS = new Set([
    'uploads.linear.app', 'cdn.linear.app', 'linear.app',
    ...GITHUB_UPLOAD_HOSTS,
  ]);

  // The SSRF/allowlist guard for both handle types (LIN-890). `reason` lets
  // `att:` give an off-allowlist host its own code.
  function guardAttachmentUrl(url) {
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

  // A redirect could bypass the allowlist, so the relay never follows one.
  // Native fetch (`redirect: 'error'`) throws; the real undici error is
  // `TypeError('fetch failed')` whose cause says 'unexpected redirect', which
  // the message alone does not show. The proxy transport (lib/proxy-fetch.js)
  // never follows either, but RESOLVES a 3xx instead of throwing.
  const isRedirectError = (error) => error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS'
    || error.cause?.message === 'unexpected redirect'
    || !!error.message?.includes('redirect');
  const isRedirectStatus = (status) => status >= 300 && status < 400;

  // The relay's own resolve step. A rejection is answered here, mapped and
  // logged like every other read route's, instead of falling to the global
  // handler's bare 500 with no event. A rejection that already carries a
  // client 4xx keeps that status, as the global handler gave it before.
  async function resolveAccess(req, res) {
    try {
      return await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
    } catch (err) {
      replyMappedFailure(req, res, ATTACHMENT_ENDPOINT, 'Failed to resolve attachment', err, clientErrorStatus(err) ?? undefined);
      return null;
    }
  }

  // Where to fetch from, or null once a response has been sent. Throws when
  // `fetchAttachment` fails; the caller maps that.
  // Both handle types answer with { fetchUrl, urlObj, nameHint, isGithubAssetHost, token, providerName }.
  async function locateAttachment(req, res, decoded) {
    const refuse = (status, message, extra) => {
      logEvent(req, ATTACHMENT_ENDPOINT, status);
      return jsonError(res, status, message, extra);
    };

    if (decoded.type === 'att') {
      const access = await resolveAccess(req, res);
      if (!access) return null;
      const { token, reason, provider } = access;
      // LIN-677: a down workspace is a wait, so 503 comes before the 422 for
      // a provider with no formal-attachment node (GitHub Issues never mints
      // `att:` handles).
      if (!token) {
        workspaceUnavailable(req, res, ATTACHMENT_ENDPOINT, reason);
        return null;
      }
      if (denyIfUnsupported(provider, 'fetchAttachment', req, res, ATTACHMENT_ENDPOINT)) return null;

      const attachment = await provider.fetchAttachment(token, decoded.value);
      if (!attachment) {
        refuse(404, 'Attachment not found');
        return null;
      }
      const guard = guardAttachmentUrl(attachment.url);
      if (!guard.ok) {
        // An off-allowlist host is an EXPECTED outcome for `att:` (a Linear
        // attachment can point at Figma, Drive, Slack…), not a caller error.
        if (guard.reason === 'host-not-allowed') {
          refuse(422, 'Attachment host is not in the allowed set', { code: 'ATTACHMENT_HOST_NOT_ALLOWED' });
        } else {
          refuse(400, guard.message);
        }
        return null;
      }
      return {
        fetchUrl: attachment.url,
        urlObj: guard.urlObj,
        // `att:` handles carry no filename hint, so the attachment's title
        // stands in; otherwise every non-image attachment would 400.
        nameHint: attachment.title || null,
        isGithubAssetHost: GITHUB_UPLOAD_HOSTS.includes(guard.urlObj.hostname),
        token,
        providerName: provider?.name,
      };
    }

    const guard = guardAttachmentUrl(decoded.value);
    if (!guard.ok) {
      refuse(400, guard.message);
      return null;
    }
    const isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(guard.urlObj.hostname);
    const access = await resolveAccess(req, res);
    if (!access) return null;
    const { token, reason, provider } = access;
    // GitHub asset hosts are public, so they need no workspace token.
    if (!isGithubAssetHost && !token) {
      workspaceUnavailable(req, res, ATTACHMENT_ENDPOINT, reason);
      return null;
    }
    return {
      // The fragment never reaches the asset host; it only carries the
      // `name=` hint discovery encoded for extension-less uploads (LIN-750).
      fetchUrl: decoded.value.split('#')[0],
      urlObj: guard.urlObj,
      nameHint: new URLSearchParams(guard.urlObj.hash.replace(/^#/, '')).get('name'),
      isGithubAssetHost,
      token,
      providerName: provider?.name,
    };
  }

  router.get('/api/proxy/attachments/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = ATTACHMENT_ENDPOINT;
    const refuse = (status, message) => {
      logEvent(req, endpoint, status);
      return jsonError(res, status, message);
    };

    const decoded = decodeAttachmentHandle(req.params.id);
    if (!decoded) {
      return refuse(400, 'Invalid attachment handle');
    }

    let target;
    try {
      target = await locateAttachment(req, res, decoded);
    } catch (err) {
      return replyMappedFailure(req, res, endpoint, 'Failed to resolve attachment', err);
    }
    if (!target) return;
    const { fetchUrl, urlObj, nameHint, isGithubAssetHost, token, providerName } = target;

    // A file relay is typed from the filename hint; an image from upstream.
    const typedFromHint = nameHint ? relayContentTypeFromName(nameHint) : null;
    const isFileRelay = !!typedFromHint && !typedFromHint.startsWith('image/');

    try {
      // Egress goes through the configured proxy, like every other Linear call.
      const customFetch = (await createProxyFetch()) || fetch;
      const response = await customFetch(fetchUrl, {
        method: 'GET',
        headers: (!isGithubAssetHost && providerName === 'linear') ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'error',
      });

      if (isRedirectStatus(response.status)) {
        return refuse(400, 'Redirects not allowed');
      }
      if (!response.ok) {
        return refuse(response.status, 'Failed to fetch attachment');
      }

      // Admit the bytes: type first, then size (header, then actual body).
      const upstreamType = response.headers.get('content-type') || '';
      if (!isFileRelay && !upstreamType.startsWith('image/')) {
        return refuse(400, 'Invalid response: unsupported content-type');
      }
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_ATTACHMENT_BYTES) {
        return refuse(413, 'Attachment too large');
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return refuse(413, 'Attachment too large');
      }

      const rawName = nameHint || urlObj.pathname.split('/').pop() || 'attachment';
      const safeName = rawName.replace(/[^\w.\- ]/g, '_') || 'attachment';
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${safeName}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=3600');
      logEvent(req, endpoint, 200);
      res.send(Buffer.from(bytes));
    } catch (error) {
      if (isRedirectError(error)) {
        return refuse(400, 'Redirects not allowed');
      }
      console.error('Proxy attachment relay error:', error.message);
      refuse(502, 'Failed to fetch attachment');
    }
  });

  return router;
}
