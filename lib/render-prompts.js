/**
 * Prompts Page Renderer
 *
 * Generates HTML for the standalone /prompts page.
 * Displays all prompt templates organized by category.
 * Maintains the CLI aesthetic while providing prompts functionality.
 */

import { computePromptsData } from './audit.js';
import { CATEGORY_DISPLAY_ORDER } from './prompt-templates.js';
import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';

/**
 * Render a single prompt template card
 * @param {Object} template - Template data
 * @returns {string} HTML for template card
 */
function renderTemplateCard(template) {
  const aiHintHtml = template.aiHint ? `
      <div class="prompt-ai-hint">
        <div class="ai-hint-row"><span class="ai-hint-label">Situation:</span> ${escapeHtml(template.aiHint.situation)}</div>
        <div class="ai-hint-row"><span class="ai-hint-label">Goal:</span> ${escapeHtml(template.aiHint.goal)}</div>
        <div class="ai-hint-row"><span class="ai-hint-label">Workflow:</span> ${escapeHtml(template.aiHint.workflow)}</div>
      </div>` : '';

  const signalsHtml = template.completionSignals ? `
      <div class="prompt-signals">
        <div class="signals-core"><span class="signals-label">Core outcome:</span> ${escapeHtml(template.completionSignals.coreOutcome)}</div>
        <div class="signals-list">
          <span class="signals-label">Signals:</span>
          <ul>${template.completionSignals.signals.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
        </div>
        ${template.completionSignals.readinessCheck ? `<div class="signals-readiness"><span class="signals-label">Readiness:</span> ${escapeHtml(template.completionSignals.readinessCheck)}</div>` : ''}
      </div>` : '';

  return `
    <div class="prompt-card">
      <div class="prompt-header">
        <span class="prompt-name">${escapeHtml(template.name)}</span>
        <span class="prompt-label">${escapeHtml(template.key)}</span>
        <span class="prompt-chars">${escapeHtml(template.charCount.toLocaleString())} chars</span>
      </div>
      <div class="prompt-description">${escapeHtml(template.description)}</div>
      ${aiHintHtml}
      ${signalsHtml}
      <details class="prompt-details">
        <summary>View prompt template</summary>
        <pre class="prompt-text">${escapeHtml(template.generatedPrompt)}</pre>
      </details>
    </div>`;
}

/**
 * Render templates grouped by category
 * @param {Array} templates - Array of template objects
 * @returns {string} HTML for all template groups
 */
function renderTemplatesByCategory(templates) {
  // Group templates by category
  const byCategory = {};
  for (const template of templates) {
    const cat = template.categoryDisplay || 'Other';
    if (!byCategory[cat]) {
      byCategory[cat] = [];
    }
    byCategory[cat].push(template);
  }

  // Render each category in defined order
  const sections = [];

  for (const category of CATEGORY_DISPLAY_ORDER) {
    const categoryTemplates = byCategory[category];
    if (!categoryTemplates || categoryTemplates.length === 0) continue;

    sections.push(`
      <div class="prompt-category">
        <h3 class="category-header">${escapeHtml(category)} <span class="category-count">(${categoryTemplates.length})</span></h3>
        <div class="category-templates">
          ${categoryTemplates.map(renderTemplateCard).join('')}
        </div>
      </div>`);
  }

  return sections.join('');
}

/**
 * Render the meta-prompt section
 * @param {string} metaPrompt - The meta-prompt template
 * @param {number} charCount - Character count
 * @returns {string} HTML for meta-prompt section
 */
function renderMetaPrompt(metaPrompt, charCount) {
  return `
    <section class="prompts-section meta-prompt-section">
      <h2 class="section-header">Meta-Prompt</h2>
      <p class="section-description">The AI prompt generator template used to create custom prompts for any task.</p>
      <div class="meta-prompt-stats">
        <span class="stat">${escapeHtml(charCount.toLocaleString())} chars</span>
      </div>
      <details class="prompt-details">
        <summary>View meta-prompt template</summary>
        <pre class="prompt-text meta-prompt-text">${escapeHtml(metaPrompt)}</pre>
      </details>
    </section>`;
}

/**
 * Options for renderPromptsPage
 * @typedef {Object} PromptsPageOptions
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 * @property {string} [urlKey] - Current workspace URL key for generating links
 */

/**
 * Renders the prompts page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {PromptsPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderPromptsPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null } = options;

  // Generate workspace-aware URLs
  const projectsUrl = urlKey ? `/workspace/${urlKey}/` : '/';

  // Get prompts data
  const promptsData = computePromptsData();

  // Footer with deploy info and links
  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/prompts',
    urlKey
  });

  // Render template sections
  const templatesHtml = renderTemplatesByCategory(promptsData.templates);
  const metaPromptHtml = renderMetaPrompt(promptsData.metaPrompt, promptsData.metaPromptCharCount);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Prompts</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/prompts.css">
</head>
<body>
  <nav class="nav-bar" aria-label="Prompts navigation">
    <div class="nav-filters">
      <div class="nav-item">
        <span class="nav-label">workspace:</span>
        <span class="nav-value-static">${escapeHtml(workspaceName)}</span>
      </div>
    </div>
    <div class="nav-actions">
      <a href="${projectsUrl}" class="nav-action">← projects</a>
      <a href="/logout" class="nav-action">logout</a>
    </div>
  </nav>

  <header>
    <h1>Prompts</h1>
    <p class="prompts-subtitle">Prompt templates for AI-assisted task workflows</p>
  </header>

  <main>
    <section class="prompts-summary">
      <div class="summary-stats">
        <span class="stat"><strong>${promptsData.templateCount}</strong> templates</span>
        <span class="stat-separator">·</span>
        <span class="stat"><strong>${escapeHtml(promptsData.totalCharCount.toLocaleString())}</strong> total chars</span>
      </div>
    </section>

    <section class="prompts-section templates-section">
      <h2 class="section-header">Templates by Category</h2>
      ${templatesHtml}
    </section>

    ${metaPromptHtml}
  </main>
  ${footerHtml}
</body>
</html>`;
}
