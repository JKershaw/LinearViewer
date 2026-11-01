/**
 * The getting-started guide routes: public, session-less, read-only.
 *
 *   GET /getting-started     the guide. A browser (which asks for `text/html`
 *                            by name) gets the page; an agent's fetch (`*\/*`,
 *                            no Accept, or Markdown/plain text asked for first)
 *                            gets the Markdown, so `curl` reads it whole.
 *   GET /getting-started.md  the guide's Markdown, always.
 *
 * The guide is written for a person's coding agent; the homepage hands the
 * person a prompt that points their agent here (lib/getting-started.js).
 * `{{BASE_URL}}` in the guide is this server's public origin, so a self-host's
 * guide points at the self-host.
 *
 * Headers follow the Library's (routes/library.js): `nosniff` on every
 * response, the HTML page under the Library CSP (only the shell's inline theme
 * script may run), the Markdown as `text/markdown` under the sandbox CSP.
 * `/getting-started` varies on `Accept`. `isAuthExemptPath`
 * (lib/guest-task-path.js) exempts both paths from session mint and refresh.
 */

import { Router } from 'express';
import { publicOrigin } from '../lib/public-origin.js';
import {
  GETTING_STARTED_PATH,
  GETTING_STARTED_MARKDOWN_PATH,
  buildAgentPrompt,
  buildGettingStartedGuide,
  renderGuideHtml,
  prefersMarkdown,
} from '../lib/getting-started.js';
import { renderGettingStartedPage } from '../lib/render-getting-started.js';
import { LIBRARY_CSP, MARKDOWN_CSP } from './library.js';

/**
 * @param {Object} [deps]
 * @param {(params: {baseUrl: string}) => string} [deps.buildGuide] - the guide's Markdown (injectable for tests)
 * @param {() => Object} [deps.getDeployInfo] - footer deploy info
 * @returns {import('express').Router}
 */
export function createGettingStartedRouter({ buildGuide = buildGettingStartedGuide, getDeployInfo = () => ({}) } = {}) {
  const router = Router();

  // The configured public origin, else a validated Host header (the Library's rule).
  const baseUrl = (req) => publicOrigin(req, { safeHost: true });

  function sendMarkdown(req, res) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Security-Policy', MARKDOWN_CSP);
    return res.send(buildGuide({ baseUrl: baseUrl(req) }));
  }

  router.get(GETTING_STARTED_MARKDOWN_PATH, sendMarkdown);

  router.get(GETTING_STARTED_PATH, (req, res) => {
    res.set('Vary', 'Accept');
    if (prefersMarkdown(req)) return sendMarkdown(req, res);
    const base = baseUrl(req);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', LIBRARY_CSP);
    return res.send(renderGettingStartedPage({
      guideHtml: renderGuideHtml(buildGuide({ baseUrl: base })),
      prompt: buildAgentPrompt({ origin: base }),
      canonicalUrl: `${base}${GETTING_STARTED_PATH}`,
      deployInfo: getDeployInfo(),
    }));
  });

  return router;
}
