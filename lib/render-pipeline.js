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

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Safe JSON for embedding inside a `<script>` block.
 *
 * - `<` → `\u003c` blocks `</script>` breakout
 * - U+2028 / U+2029 → escaped so ES5 parsers don't see a line terminator
 *
 * @param {*} value
 * @returns {string}
 */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pipeline - Floor View</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/pipeline.css">
</head>
<body>
  ${navBarHtml}
  <main class="pipeline-page" data-url-key="${encodedUrlKey}">
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
        <p class="pipeline-queue-empty hidden" id="pipeline-queue-empty">○ queue empty</p>
      </aside>

      <section class="pipeline-grid-wrap" aria-label="Active tasks">
        <h2 class="pipeline-grid-title">active <span class="zone-count" id="pipeline-active-count"></span></h2>
        <div class="pipeline-grid" id="pipeline-grid"></div>
        <p class="pipeline-grid-empty hidden" id="pipeline-grid-empty">○ no active tasks</p>
      </section>

      <aside class="pipeline-rail pipeline-activity" aria-label="Activity feed">
        <h2 class="pipeline-rail-title">activity <span class="zone-count" id="pipeline-activity-count"></span></h2>
        <ul class="pipeline-activity-list" id="pipeline-activity-list"></ul>
        <p class="pipeline-activity-empty hidden" id="pipeline-activity-empty">○ no recent activity</p>
      </aside>

    </div>

    <div class="pipeline-overlay hidden" id="pipeline-overlay" aria-hidden="true"></div>
  </main>
  ${footerHtml}
  <script>window.__PIPELINE_DATA__ = ${embedJson(pipelineData)};</script>
  <script src="/common.js"></script>
  <script src="/recap.js"></script>
  <script src="/pipeline.js"></script>
</body>
</html>`;
}
