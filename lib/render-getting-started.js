/**
 * The getting-started page shell (`/getting-started`).
 *
 * The guide is written for a person's coding agent (see lib/getting-started.js),
 * but a person may open it too: to see what their agent will read, or because
 * they came here first. So the page leads with the prompt to paste into their
 * agent, then shows the guide itself.
 *
 * Formatted on the Library's reading shell (`is-landing`, public/library.css),
 * so the guide reads like a Library document. Script-free: the route's CSP
 * pins the shell's one inline theme script by hash, as the Library's does, so
 * the prompt here is selectable text with no copy button (the homepage has one).
 * Every value interpolated here is escaped; the guide body arrives as safe HTML
 * from `renderGuideHtml`.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderPageHeader } from './components/page-header.js';
import { canonicalTag, descriptionTag } from './components/head-meta.js';
import { GETTING_STARTED_MARKDOWN_PATH } from './getting-started.js';

/** The page's `<title>`. */
export const GETTING_STARTED_TITLE = 'Getting started - Harbour';

/** The page's one-line description (also its meta description). */
export const GETTING_STARTED_DESCRIPTION = 'Set Harbour up through your coding agent: paste one prompt and it reads this guide, looks at your repositories and walks you through the rest.';

/**
 * @param {Object} data
 * @param {string} data.guideHtml - the guide as safe HTML (renderGuideHtml)
 * @param {string} data.prompt - the prompt to paste into an agent (buildAgentPrompt)
 * @param {string} [data.canonicalUrl] - absolute canonical URL
 * @param {Object} [data.deployInfo] - for the footer
 * @returns {string} complete HTML document
 */
export function renderGettingStartedPage({ guideHtml = '', prompt = '', canonicalUrl = '', deployInfo = {} } = {}) {
  return renderPage({
    title: GETTING_STARTED_TITLE,
    stylesheets: ['/style.css', '/library.css', '/getting-started.css'],
    bodyClass: 'is-landing',
    followSystemTheme: true,
    htmlComment: `AI agents: this guide is written for you. Plain Markdown: ${GETTING_STARTED_MARKDOWN_PATH}`,
    headExtra: [descriptionTag(GETTING_STARTED_DESCRIPTION), canonicalTag(canonicalUrl)].filter(Boolean).join('\n  '),
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="library library--doc getting-started" data-testid="getting-started-page">
    <article class="library-doc">
      <aside class="library-doc__aside">
        <p>This guide is written for your coding agent, not for you. Your agent reads it, then walks you through setup.</p>
        <p class="library-markdown"><a href="${escapeHtml(GETTING_STARTED_MARKDOWN_PATH)}" data-testid="getting-started-markdown-link">View as Markdown</a></p>
      </aside>
      <section class="getting-started__handoff" data-testid="getting-started-handoff" aria-labelledby="getting-started-handoff-h">
        <p id="getting-started-handoff-h" class="getting-started__handoff-title">Paste this into your agent</p>
        <p class="getting-started__handoff-note">Claude Code, or whichever coding agent you use. It will read the rest of this page for you.</p>
        <pre class="getting-started__prompt" data-testid="getting-started-prompt">${escapeHtml(prompt)}</pre>
      </section>
      <div class="library-doc__body" data-testid="getting-started-body">
        ${guideHtml}
      </div>
    </article>
  </main>
  ${renderPageFooter({ isLanding: true, deployInfo, currentPage: '/getting-started' })}`,
  });
}
