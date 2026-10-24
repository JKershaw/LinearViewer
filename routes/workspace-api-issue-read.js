/**
 * The issue-read routes of the workspace API (LIN-2246: moved out of
 * workspace-api.js, LIN-3872): GET /api/comments/:issueId, GET /api/detail/:issueId
 * and GET /api/image.
 *
 * They register on the router they are given (the composer's own), not on a mounted
 * sub-router: POST /api/comments/:issueId stays in workspace-api.js, and a mounted
 * inner router would answer OPTIONS on that path itself (`Allow: GET,HEAD`) instead
 * of reaching the composer's POST route (`Allow: GET,HEAD,POST`).
 */
import { badRequest, jsonError, notFound } from '../lib/errors.js';
import { renderDetailsContent } from '../lib/render.js';
import { sniffRasterType } from '../lib/attachment-upload.js';
import { getWorkspaceToken, isActiveProviderLinear } from '../lib/workspace.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { testMockData } from '../lib/sample-data/mock-data.js';
import { isTestToken, failureOf, openIssue } from './workspace-api-steps.js';

// Max image size: 10MB to prevent memory exhaustion
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// The render sections the lazy detail route whitelists (LIN-732).
const KNOWN_SECTIONS = ['project', 'in-progress', 'recent-activity'];

/**
 * Register the three issue-read routes, in order: comments, detail, image.
 * @param {import('express').Router} router - the composer's router
 */
export function registerIssueReadRoutes(router, { workspaceFromUrl, getOpenRouterSource, customPromptsStore }) {
  /**
   * Fetch comments for a specific issue.
   * LIN-156: Lightweight endpoint for fetching issue comments.
   *
   * @route GET /workspace/:urlKey/api/comments/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { comments: Array<{id, body, createdAt, user}> }
   */
  router.get('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, async (req, res) => {
    // The detail-surface comments path is fully provider-backed: the dashboard
    // (interactions.spec) reads comments through the local provider and no
    // test-token spec reaches this endpoint, so the old `testMockData` data-mock
    // branch was orphaned and removed (LIN-413). Linear + local both serve here.
    // LIN-1904: the issue's own binding via `source`, same as /api/detail.
    const issue = openIssue(req, res);
    if (!issue) return;

    try {
      const comments = await issue.provider.fetchIssueComments(issue.callScope, issue.issueId);
      res.json({ comments });
    } catch (error) {
      console.error('Comments fetch error:', error);
      jsonError(res, ...failureOf(error, 'Failed to fetch comments'));
    }
  });

  /**
   * Render one issue's detail block for the lazy dashboard (LIN-442).
   *
   * The authenticated homepage now ships only collapsed lines; `renderNode`
   * emits an empty `.details` wrapper and the client fetches the rendered inner
   * HTML here on first expand (mirroring the comments lazy-load). This is what
   * removes the dominant multi-MB per-page payload on large projects.
   *
   * Provider-backed for real workspaces (local in E2E, Linear in prod), with a
   * test-token/testMockData branch for the mock specs (`/test/set-session`),
   * since those render the homepage from fixtures, not the provider API. The
   * returned HTML is byte-identical to what `renderDetails` emitted inline before
   * — same feature flags, provider UI, and prompt containers.
   *
   * @route GET /workspace/:urlKey/api/detail/:issueId
   * @returns {Object} { html } - inner HTML for the issue's `.details` block
   */
  router.get('/workspace/:urlKey/api/detail/:issueId', workspaceFromUrl, async (req, res) => {
    // LIN-1903: the dashboard tree merges issues across ALL of a workspace's
    // bindings (LIN-544), but a bare id-only drill-down defaulted to the
    // WORKSPACE's active provider/scope — misrouting a foreign-source row's id
    // to the wrong provider/credential. The client-supplied `source` (the
    // issue's own provenance, LIN-561) lets us resolve that issue's own
    // binding instead, via resolveIssueBinding — bounded to this workspace's
    // OWN bindings, so it can only select among credentials the caller
    // already has access to (LIN-1904).
    const found = openIssue(req, res);
    if (!found) return;
    const { workspace, issueId, provider, callScope } = found;

    try {
      // Test mode (test-token + testMockData): the homepage renders from the mock
      // fixtures, not the provider API, so the lazy detail must too — fetching via
      // the Linear provider with 'test-token' would hit the network. Mirrors the
      // prompt route's test-mode branch.
      let issue;
      if (isTestToken(workspace)) {
        issue = testMockData.issues.find(i => i.id === issueId);
        if (!issue) {
          return notFound.json(res, 'Issue not found');
        }
      } else {
        issue = await provider.fetchIssueFields(callScope, issueId);
      }

      // Custom prompts (non-blocking, fallback to empty) — matches the homepage.
      let customPrompts = [];
      try {
        customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
      } catch (e) { /* non-fatal */ }

      const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h));

      // The same issue can be lazily expanded in two sections at once (e.g. In
      // Progress + its project tree). `section` disambiguates the dispatch
      // disclosure panel ids so the second appearance's "Dispatch ▾" resolves to
      // its OWN panel, not the first one's (LIN-732). Whitelisted to the known
      // render sections; anything else falls back to '' (pre-LIN-732 id scheme).
      const section = KNOWN_SECTIONS.includes(req.query.section) ? req.query.section : '';

      const html = renderDetailsContent(issue, {
        isLanding: false,
        openRouterSource: getOpenRouterSource(req),
        urlKey: workspace.urlKey,
        featureFlags: await requestFeatureFlags(req),
        customPrompts,
        isLocalhost,
        provider,
        section
      });

      res.json({ html });
    } catch (error) {
      console.error('Detail fetch error:', error);
      jsonError(res, ...failureOf(error, 'Failed to fetch detail'));
    }
  });

  // ===========================================================================
  // Image Proxy API
  // ===========================================================================

  /**
   * Proxy image requests to Linear with authentication.
   * LIN-156: Linear-hosted images require auth headers that browsers can't add to img src.
   *
   * @route GET /workspace/:urlKey/api/image
   * @query {string} url - The Linear image URL to fetch
   * @returns {Stream} Image data with appropriate content-type
   */
  router.get('/workspace/:urlKey/api/image', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const imageUrl = req.query.url;

    // Validate URL
    if (!imageUrl) {
      return badRequest.json(res, 'Missing url parameter');
    }

    // A repeated `?url=` parses to an array (LIN-3596): bad input is a 400 here,
    // not a TypeError out of `startsWith` that surfaces as a 500 (LIN-1158).
    if (typeof imageUrl !== 'string') {
      return badRequest.json(res, 'Invalid image URL format');
    }

    // Only allow HTTPS URLs (security)
    if (!imageUrl.startsWith('https://')) {
      return badRequest.json(res, 'Invalid image URL: must be HTTPS');
    }

    // Only allow Linear-hosted images (security - prevent SSRF)
    // Use exact hostname matching to prevent bypass via evillinear.app
    const allowedHosts = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app']);
    try {
      const urlObj = new URL(imageUrl);
      if (!allowedHosts.has(urlObj.hostname)) {
        return badRequest.json(res, 'Invalid image URL: must be from Linear');
      }
      // Prevent path traversal attacks
      if (urlObj.pathname.includes('..')) {
        return badRequest.json(res, 'Invalid image URL: path traversal not allowed');
      }
    } catch {
      return badRequest.json(res, 'Invalid image URL format');
    }

    try {
      // LIN-1899: attach the workspace credential ONLY when the active binding
      // is Linear. `workspace.accessToken` is the provider-agnostic scalar
      // mirror, so for a Jira-active workspace this template would send a raw
      // Jira API token to uploads.linear.app — the same cross-provider
      // credential egress LIN-1891 closed on the attachment relay
      // (routes/proxy.js:2477-2479), and this route is the same site class, so
      // it takes that precedent's consequence verbatim: SERVE the asset, WITHHOLD
      // the header. Deliberately degrade rather than refuse (unlike the audit
      // capability above) — a mixed workspace's already-rendered <img> still
      // resolves for genuinely public linear.app assets, and the security
      // property is identical either way: the credential does not leave the
      // system. `linear`-only, never `linear` OR `local` (LIN-1891's rule);
      // legacy providerless workspaces keep their header.
      //
      // Placed at the fetch, AFTER the https-only / exact-host-allowlist /
      // path-traversal checks above — none of which are reordered or relaxed.
      const fetchHeaders = isActiveProviderLinear(workspace)
        ? { Authorization: `Bearer ${getWorkspaceToken(workspace)}` }
        : {};
      const response = await fetch(imageUrl, {
        headers: fetchHeaders,
        // Prevent redirects that could bypass SSRF protection
        redirect: 'error'
      });

      if (!response.ok) {
        return jsonError(res, response.status, 'Failed to fetch image');
      }

      // Check content-length if available
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_IMAGE_SIZE) {
        return jsonError(res, 413, 'Image too large');
      }

      // Read response with size limit
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
        return jsonError(res, 413, 'Image too large');
      }

      // Security (LIN-682): do NOT relay the upstream content type verbatim — the
      // old `startsWith('image/')` guard let `image/svg+xml` through, and an SVG
      // served inline same-origin executes its embedded script in the operator's
      // session. Sniff the actual bytes and serve only raster images; reject any
      // non-raster body (SVG/HTML/JS) via the existing 400 path. This closes the
      // class for ANY SVG asset reaching the proxy — feedback uploads, legacy
      // tickets, or the LIN-652 attachments gallery — not just new uploads.
      //
      // No `Content-Disposition: attachment`: this is an `<img src>` relay for
      // both the feedback render and the LIN-652 gallery, so attachment would
      // force a download and break legitimate inline raster rendering. The
      // raster allowlist + `nosniff` close the hole while preserving inline use.
      const buffer = Buffer.from(arrayBuffer);
      const rasterType = sniffRasterType(buffer);
      if (!rasterType) {
        return badRequest.json(res, 'Invalid response: not a supported raster image');
      }

      res.set('Content-Type', rasterType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (error) {
      // Handle redirect errors specifically
      if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
        return badRequest.json(res, 'Redirects not allowed');
      }
      console.error('Image proxy error:', error);
      jsonError(res, 500, 'Failed to fetch image');
    }
  });
}
