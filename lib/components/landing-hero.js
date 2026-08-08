/**
 * Landing Hero Component (LIN-726, Harbour brand S4)
 *
 * The brand lockup + primary sign-in CTAs at the top of the unauthenticated
 * landing page. This owns the *landing's* Harbour branding, distinct from the
 * chrome wordmark (lib/components/wordmark.js) which is explicitly scoped to
 * authenticated chrome and hands the landing visuals to this ticket.
 *
 * Treatment, per LIN-716 / brand S1–S3:
 *   - the anchor mark (S1 anchor glyph) as a themeable inline SVG painted in the
 *     brand `--teal` token (S2), so it tracks light/dark rather than baking a
 *     fixed-colour raster like the favicon does.
 *   - the lowercase `harbour` wordmark on the CLI mono stack
 *     (`--font-structural`) with a trailing teal accent dot — NOT a serif. DM
 *     Serif Display is explicitly rejected; the brand stays in its terminal
 *     aesthetic (mono + sans only).
 *   - three large primary CTAs: Linear (always), GitHub, and Jira. The GitHub
 *     CTA is gated on `githubEnabled` (process.env.GITHUB_CLIENT_ID), mirroring
 *     how `/auth/github` 503s and `renderLoginPage` hides the button when the
 *     GitHub App is unconfigured (LIN-541). When false the GitHub CTA is omitted
 *     entirely — never a dead link.
 *   - the Jira CTA (LIN-1890) is gated the same way on `jiraEnabled`, sourced
 *     from the provider-owned `isJiraOAuthConfigured()` predicate rather than an
 *     inline `process.env` read. The gate is not cosmetic: `/auth/jira/oauth`
 *     503s when JIRA_CLIENT_ID/SECRET/REDIRECT_URI are unset, so an ungated CTA
 *     would promise a sign-in the server cannot deliver. It points at
 *     `?mode=new` explicitly — the route defaults to `new`, but the landing is
 *     the surface where that intent is the whole point, so it is stated rather
 *     than inherited.
 *
 * The wordmark is the page's single `<h1>` (this header replaces the plain
 * `renderPageHeader` title on the landing), so the brand carries the document
 * heading instead of a second, redundant "Harbour" title.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.githubEnabled] - Whether the GitHub OAuth App is
 *   configured. When false the GitHub CTA is omitted.
 * @param {boolean} [opts.jiraEnabled] - Whether Jira OAuth 3LO is configured
 *   (`isJiraOAuthConfigured()`). When false the Jira CTA is omitted.
 * @returns {string} Hero HTML (`<header class="landing-hero">`).
 */

// Feather-style anchor glyph — the S1 anchor mark rendered as a crisp,
// theme-aware inline SVG. Stroke is `currentColor` so `.landing-mark` can paint
// it in the brand teal token and it flips with light/dark.
const ANCHOR_MARK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="22" x2="12" y2="8"></line><path d="M5 12H2a10 10 0 0 0 20 0h-3"></path></svg>';

export function renderLandingHero({ githubEnabled = false, jiraEnabled = false } = {}) {
  const githubCta = githubEnabled
    ? `<a href="/auth/github" class="landing-cta landing-cta-github" data-testid="landing-cta-github">Continue with GitHub</a>`
    : '';
  const jiraCta = jiraEnabled
    ? `<a href="/auth/jira/oauth?mode=new" class="landing-cta landing-cta-jira" data-testid="landing-cta-jira">Continue with Jira</a>`
    : '';

  return `<header class="landing-hero" data-testid="landing-hero">
    <div class="landing-mark" aria-hidden="true">${ANCHOR_MARK_SVG}</div>
    <h1 class="landing-wordmark">harbour<span class="landing-wordmark-accent" aria-hidden="true">.cat</span></h1>
    <p class="landing-tagline">Keep human intent in command of AI execution</p>
    <div class="landing-ctas">
      <a href="/auth/linear" class="landing-cta landing-cta-linear" data-testid="landing-cta-linear">Log in with Linear</a>
      ${githubCta}
      ${jiraCta}
    </div>
  </header>`;
}
