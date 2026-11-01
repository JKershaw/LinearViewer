/**
 * The agent onboarding guide, public (LIN-4085):
 *
 *   GET /getting-started      HTML render, for a person who follows the link
 *   GET /getting-started.md   plain markdown, for the agent that reads it
 *
 * Public and session-less: both paths are exact entries in `isAuthExemptPath`
 * (lib/guest-task-path.js), so token refresh and PAT auto-login skip them. Lookalikes
 * (`/getting-started.md.bak`, `/api/getting-started`) are not served here.
 *
 * The body is built per request from the validated origin and this deployment's
 * sign-in doors and free tier (lib/prompts/agent-onboarding.js), so it varies by
 * origin and is `no-store`. Both forms carry `nosniff`; the HTML form uses the
 * Library's CSP (its theme script is hash-pinned), the markdown form the
 * sandboxed Library CSP for `.md`.
 */
import { Router } from 'express';
import { Marked } from 'marked';
import { renderPage } from '../lib/components/page.js';
import { renderPageFooter } from '../lib/components/footer.js';
import { descriptionTag } from '../lib/components/head-meta.js';
import { signInDoors } from '../lib/components/landing-hero.js';
import { buildAgentOnboarding } from '../lib/prompts/agent-onboarding.js';
import { escapeHtml } from '../lib/utils/html.js';
import { publicOrigin } from '../lib/public-origin.js';
import { isEmailSignInAvailable } from '../lib/email-availability.js';
import { getProvider } from '../lib/providers/index.js';
import { isFreeTierOffered } from '../lib/chat-request.js';
import { LIBRARY_CSP, MARKDOWN_CSP } from './library.js';

/** The deployment's sign-in and free-tier flags, read the way the landing reads them. */
export function deploymentFlags() {
  return {
    githubEnabled: getProvider('github').entryCta.isConfigured(),
    jiraEnabled: getProvider('jira').entryCta.isConfigured(),
    emailEnabled: isEmailSignInAvailable(),
    freeTierEnabled: isFreeTierOffered(),
  };
}

// The guide's own renderer, for the HTML form only. Its content is ours, not a
// visitor's, but raw HTML is still escaped and link targets are allow-listed,
// so a placeholder value cannot inject markup. (The Library's renderer needs its
// per-document catalog context and is not reusable here.)
const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#|mailto:)/i;
const markdown = new Marked({ gfm: true }).use({
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
    image(token) {
      return escapeHtml(token.text || '');
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      if (!SAFE_HREF.test(token.href)) return text;
      return `<a href="${escapeHtml(token.href)}">${text}</a>`;
    },
  },
});

/**
 * The guide's markdown as the HTML form renders it. Exported so the safety of the
 * renderer (raw HTML escaped, unsafe link targets dropped) is tested directly with
 * hostile input, since the real guide contains none.
 * @param {string} md
 * @returns {string}
 */
export function renderGuideHtml(md) {
  return markdown.parse(md);
}

/**
 * @param {import('express').Request} req
 * @param {() => object} flagsFor - the deployment flags (injectable for tests)
 * @returns {string} the guide as markdown for this request
 */
function guideFor(req, flagsFor) {
  const flags = flagsFor();
  return buildAgentOnboarding({
    baseUrl: publicOrigin(req, { safeHost: true }),
    doors: signInDoors(flags).map(({ label, href }) => ({ label, href })),
    freeTierEnabled: flags.freeTierEnabled,
  });
}

/**
 * @param {Object} [deps]
 * @param {() => object} [deps.flags] - returns the deployment flags; defaults to the live predicates
 * @returns {import('express').Router}
 */
export function createGettingStartedRouter({ flags = deploymentFlags } = {}) {
  const router = Router();

  router.get('/getting-started.md', (req, res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', MARKDOWN_CSP);
    res.type('text/markdown; charset=utf-8');
    return res.send(guideFor(req, flags));
  });

  router.get('/getting-started', (req, res) => {
    const body = renderGuideHtml(guideFor(req, flags));
    const html = renderPage({
      title: 'Getting started with Harbour',
      stylesheets: ['/style.css', '/library.css'],
      bodyClass: 'is-landing',
      followSystemTheme: true,
      headExtra: descriptionTag('Onboarding guide for coding agents: how to set up Harbour with a person.'),
      content: `<main class="library library--doc" data-testid="getting-started">
    <article class="library-doc">
      <div class="library-doc__body">
        ${body}
      </div>
    </article>
  </main>
  ${renderPageFooter({ isLanding: true, currentPage: '/getting-started' })}`,
    });
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', LIBRARY_CSP);
    res.type('text/html; charset=utf-8');
    return res.send(html);
  });

  return router;
}
