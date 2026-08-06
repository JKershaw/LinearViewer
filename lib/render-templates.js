/**
 * Public Templates Page Renderer (LIN-1889).
 *
 * A public, unauthenticated page publishing the prompt-template catalog for
 * anyone to view and copy. Follows the public-page shell pattern of
 * lib/render-kpis.js / lib/render-styleguide.js: `is-landing` body class, no
 * nav bar, indexable (no `noindex` — unlike /kpis and /styleguide, discovery
 * is this page's point).
 *
 * Reuses computePromptsData() (session-free, network-free, provider-free —
 * see lib/audit.js) and the exported card-rendering helpers from
 * lib/render-prompts.js, but deliberately never reads or renders
 * promptsData.metaPrompt: exclusion of the meta template is an omission at
 * render time, not a filter inside computePromptsData (that function has a
 * second consumer, runAudit(), whose report shape must stay unchanged).
 */

import { computePromptsData } from './audit.js';
import { renderTemplatesByCategory } from './render-prompts.js';
import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';

/**
 * Renders the public /templates page.
 *
 * @param {Object} [options]
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @returns {string} Complete HTML document
 */
export function renderTemplatesPage({ deployInfo = {} } = {}) {
  const promptsData = computePromptsData();
  const templatesHtml = renderTemplatesByCategory(promptsData.templates);
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/templates' });

  // promptsData.totalCharCount includes the (unrendered) meta-prompt's chars —
  // computed separately here so the stat matches what this page actually shows.
  const templatesCharCount = promptsData.templates.reduce((sum, t) => sum + t.charCount, 0);

  return renderPage({
    title: 'Templates - Harbour',
    stylesheets: ['/style.css', '/prompts.css'],
    bodyClass: 'is-landing',
    scripts: ['/templates.js'],
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main>
    <section class="prompts-summary">
      <div class="summary-stats">
        <span class="stat"><strong>${promptsData.templateCount}</strong> templates</span>
        <span class="stat-separator">·</span>
        <span class="stat"><strong>${escapeHtml(templatesCharCount.toLocaleString())}</strong> total chars</span>
      </div>
    </section>

    ${renderSection({ className: 'templates-section', titleVariant: 'ruled', title: 'Templates by Category', body: `${templatesHtml}` })}
  </main>
  ${footerHtml}`
  });
}
