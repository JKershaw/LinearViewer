/**
 * Pipeline Page Renderer
 *
 * Generates HTML for the Pipeline floor view shell.
 * Embeds the initial Pipeline Snapshot as `window.__PIPELINE_DATA__`
 * and lets the client hydrate the three zones (queue rail, active grid,
 * activity rail) from it.
 *
 * Zero business logic: all formatting, coloring, and layout are owned by
 * `public/pipeline.css` (LIN-250) and `public/pipeline.js` (LIN-249).
 */

import { escapeHtml } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPage } from './components/page.js';
import { renderEmptyState } from './components/empty-state.js';

/**
 * Renders the Pipeline page.
 *
 * @param {Object} data
 * @param {Object} data.snapshot - buildPipelineSnapshot() return value:
 *                                 `{fetchedAt, queue, active, recent}`
 * @param {string} [data.organizationName]
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document
 */
export function renderPipelinePage(data, options = {}) {
  const { snapshot } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces = [],
    featureFlags = {}
  } = options;

  const navBarHtml = renderNavBar({
    workspaces,
    urlKey,
    currentPage: 'pipeline',
    featureFlags
  });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/pipeline',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const pipelineData = {
    snapshot,
    urlKey: urlKey || '',
    featureFlags: {
      dispatch: featureFlags.dispatch === true,
      proxy: featureFlags.proxy === true
    }
  };

  const encodedUrlKey = escapeHtml(urlKey || '');
  const encodedFetchedAt = escapeHtml(snapshot.fetchedAt);

  return renderPage({
    title: 'Pipeline - Floor View',
    stylesheets: ['/style.css', '/pipeline.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__PIPELINE_DATA__', value: pipelineData },
    scripts: ['/common.js', '/recap.js', '/pipeline.js'],
    content: `<main class="pipeline-page" data-url-key="${encodedUrlKey}">
    <header class="pipeline-header">
      <span class="pipeline-header-title">pipeline</span>
      <span class="pipeline-header-fetched" id="pipeline-fetched-at" data-fetched-at="${encodedFetchedAt}">
        fetched: ${encodedFetchedAt}
      </span>
      <span class="pipeline-header-status" id="pipeline-status"></span>
    </header>

    <div class="pipeline-floor">

      <aside class="pipeline-rail pipeline-queue" aria-label="Queue">
        <h2 class="pipeline-rail-title">queue <span class="zone-count" id="pipeline-queue-count"></span></h2>
        <ol class="pipeline-queue-list" id="pipeline-queue-list"></ol>
        ${renderEmptyState({ tag: 'p', className: 'pipeline-queue-empty hidden', id: 'pipeline-queue-empty', text: '○ queue empty' })}
      </aside>

      <section class="pipeline-grid-wrap" aria-label="Active tasks">
        <h2 class="pipeline-grid-title">active <span class="zone-count" id="pipeline-active-count"></span></h2>
        <div class="pipeline-grid" id="pipeline-grid"></div>
        ${renderEmptyState({ tag: 'p', className: 'pipeline-grid-empty hidden', id: 'pipeline-grid-empty', text: '○ no active tasks' })}
      </section>

      <aside class="pipeline-rail pipeline-activity" aria-label="Activity feed">
        <h2 class="pipeline-rail-title">activity <span class="zone-count" id="pipeline-activity-count"></span></h2>
        <ul class="pipeline-activity-list" id="pipeline-activity-list"></ul>
        ${renderEmptyState({ tag: 'p', className: 'pipeline-activity-empty hidden', id: 'pipeline-activity-empty', text: '○ no recent activity' })}
      </aside>

    </div>

    <div class="pipeline-overlay hidden" id="pipeline-overlay" aria-hidden="true"></div>
  </main>
  ${footerHtml}`
  });
}
