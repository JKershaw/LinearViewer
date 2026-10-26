/**
 * Shared Footer Component
 *
 * Renders the page footer with deploy info and navigation links.
 * Used by all pages: Dashboard, Settings, Prompts, and Audit.
 */

import { escapeHtml } from '../utils/html.js';
import { renderWordmark } from './wordmark.js';

// LIN-3995: the one name for the way home from a signed-out preview. The preview's
// back link (navbar.js) and its footer home link both read it, so they cannot drift.
export const PREVIEW_HOME_LABEL = 'Harbour';

// LIN-3995: the line under a signed-out preview's title (render-swipe.js, render-swim.js).
export const PREVIEW_NOTE = 'Sample tasks, not a workspace. Sign in to see yours.';

/**
 * Renders deploy information HTML.
 * @param {Object} deployInfo - Deploy information (see lib/deploy-info.js)
 * @param {string} [deployInfo.version] - DEPLOY_VERSION
 * @param {string} [deployInfo.createdAt] - DEPLOY_CREATED_AT (ISO-8601)
 * @param {string} [deployInfo.commit] - DEPLOY_COMMIT / RAILWAY_GIT_COMMIT_SHA
 * @returns {string} HTML for deploy info
 */
function renderDeployInfo(deployInfo = {}) {
  if (deployInfo.version || deployInfo.commit) {
    const parts = [];

    // Version (e.g., "v42") - not every platform/deploy provides one
    if (deployInfo.version) {
      parts.push(deployInfo.version);
    }

    // Deploy date/time - render with data attribute for client-side local timezone formatting
    if (deployInfo.createdAt) {
      const date = new Date(deployInfo.createdAt);
      if (!isNaN(date.getTime())) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const fallbackText = `deployed ${months[date.getMonth()]} ${date.getDate()}`;
        parts.push(`<span class="deploy-time" data-timestamp="${escapeHtml(deployInfo.createdAt)}">${fallbackText}</span>`);
      }
    }

    // Commit hash linked to GitHub (e.g., "abc123")
    if (deployInfo.commit) {
      const shortCommit = deployInfo.commit.slice(0, 7);
      parts.push(`<a href="https://github.com/JKershaw/LinearViewer/commit/${escapeHtml(deployInfo.commit)}" target="_blank" class="footer-link">${escapeHtml(shortCommit)}</a>`);
    }

    return parts.join(' · ');
  }

  // Fallback: link to GitHub repo
  return '<a href="https://github.com/JKershaw/LinearViewer" target="_blank" class="footer-link">github.com/JKershaw/LinearViewer</a>';
}

/**
 * Renders AI status indicator for the footer.
 * @param {'oauth'|'env'|'free'|null} source - Source of OpenRouter API key
 * @param {string|null} urlKey - Current workspace URL key for settings link
 * @returns {string} HTML for AI status indicator
 */
function renderAiStatus(source, urlKey) {
  let statusClass, statusText, statusIcon;
  if (source === 'oauth') {
    statusClass = 'connected';
    statusText = 'connected';
    statusIcon = '●';
  } else if (source === 'env') {
    statusClass = 'env';
    statusText = 'env';
    statusIcon = '●';
  } else if (source === 'free') {
    statusClass = 'free';
    statusText = 'free tier';
    statusIcon = '●';
  } else {
    statusClass = 'disconnected';
    statusText = 'off';
    statusIcon = '○';
  }

  // The AI status is the OpenRouter connection, which lives in Settings › Account (LIN-3846).
  const settingsUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/settings/account` : '/settings';

  // Sibling element (kept OUTSIDE the .footer-ai-status anchor so its exact text
  // stays "ai: ●"/"ai: ○") that the client fills with the workspace's configured
  // model name from /api/recommend/status. Empty until populated.
  const modelHtml = `<span class="footer-ai-model" data-ai-model></span>`;

  // For free tier, show a span that will be updated client-side with remaining count
  if (source === 'free') {
    return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" data-testid="footer-ai-status" data-ai-source="free" title="OpenRouter: ${statusText}">ai: ${statusIcon} free</a>${modelHtml}`;
  }

  return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" data-testid="footer-ai-status" title="OpenRouter: ${statusText}">ai: ${statusIcon}</a>${modelHtml}`;
}

/**
 * Renders the page footer with navigation links and deploy info.
 *
 * @param {Object} options - Footer options
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @param {boolean} [options.isLanding] - If true, hide all action links (unauthenticated)
 * @param {boolean} [options.showReset] - If true, show reset link (main dashboard only)
 * @param {string} [options.currentPage] - Current page path (e.g., '/settings') to show in bold
 * @param {string} [options.urlKey] - Current workspace URL key for generating links
 * @param {'oauth'|'env'|null} [options.openRouterSource] - Source of OpenRouter API key
 * @param {Object} [options.featureFlags] - Current feature toggle states
 * @returns {string} HTML for footer
 */
export function renderPageFooter(options = {}) {
  const { deployInfo = {}, isLanding = false, showReset = false, currentPage = null, urlKey = null, openRouterSource = null, featureFlags = {}, dispatchDefaults = {} } = options;

  const deployHtml = renderDeployInfo(deployInfo);

  // Build links HTML with separators
  let linksHtml = '';
  const landingViewPages = new Set(['/', '/swipe', '/swim']);
  if (isLanding && landingViewPages.has(currentPage)) {
    // LIN-3980: a signed-out visitor on `/` is not in any view, so nothing is
    // marked current and the row names the previews. On the previews themselves
    // `landing` links back to `/`, and swipe / swim keep their current marking.
    // (The old row marked "projects" current on `/`, a page with no project tree.)
    // LIN-3995: on a preview the home link comes first and is named as the back link
    // (PREVIEW_HOME_LABEL), then the previews row, so the row reads "Harbour · previews: swipe · swim".
    const onLanding = currentPage === '/';
    const previewLinks = [{ href: '/swipe', text: 'swipe' }, { href: '/swim', text: 'swim' }].map(link => {
      if (link.href === currentPage) {
        return `<strong class="footer-current" data-testid="footer-link-${escapeHtml(link.text)}">${escapeHtml(link.text)}</strong>`;
      }
      return `<a href="${escapeHtml(link.href)}" class="footer-action" data-testid="footer-link-${escapeHtml(link.text)}">${escapeHtml(link.text)}</a>`;
    });
    const previewsRow = `<span class="footer-label">previews:</span> ${previewLinks.join(' · ')}`;
    const homeLink = onLanding
      ? ''
      : `<a href="/" class="footer-action" data-testid="footer-link-landing">${escapeHtml(PREVIEW_HOME_LABEL)}</a> · `;
    linksHtml = `
    <div class="footer-actions">
      ${homeLink}${previewsRow}
    </div>`;
  } else if (!isLanding) {
    // The cross-view links were hoisted into the shared header nav switcher
    // (LIN-978, `renderViewNav` in the nav bar) so cross-view navigation is
    // reachable from the sticky header without scrolling to the footer. The
    // footer keeps only its non-view controls; `reset` is a client-side action
    // (main dashboard only), NOT a view-switch link, so it stays here.
    const linkElements = [];

    if (showReset) {
      linkElements.push('<a href="#" class="footer-action reset-view">reset</a>');
    }

    // Only emit `.footer-actions` when there is a non-view action to show
    // (i.e. reset). Legal/prompts/etc. pages with no reset get no empty row.
    if (linkElements.length > 0) {
      linksHtml = `
    <div class="footer-actions">
      ${linkElements.join(' · ')}
    </div>`;
    }
  }

  // AI status (only for authenticated users)
  const aiStatusHtml = !isLanding ? renderAiStatus(openRouterSource, urlKey) : '';

  // Feedback control (LIN-635 / LIN-641). Authenticated, workspace-scoped pages
  // get the widget mount + assets; the widget PANEL itself is only built
  // client-side when the per-user `feedbackWidget` flag is on. LIN-3848: the
  // footer "feedback" link that used to flip that flag is gone — Settings is the
  // one place to switch the widget.
  //
  // The TRIGGER that opens that panel is no longer emitted here, or anywhere in
  // this file: LIN-2298 moved it to the nav bar (`renderFeedbackTrigger`,
  // lib/components/navbar.js) and deleted the fixed FAB this mount used to
  // paint. The two gates must agree — a mount with no trigger is an
  // unreachable panel, a trigger with no mount is a dead control — which
  // tests/unit/navbar-feedback-trigger.test.js pins across the full input
  // cross-product.
  const showFeedback = !isLanding && urlKey;
  const feedbackMount = showFeedback ? renderFeedbackMount(urlKey, featureFlags, dispatchDefaults) : '';

  // The light/dark theme choice lives in Settings › Account since LIN-3846 (it was a footer link).

  // Legal links (visible on all pages, highlight current legal page).
  const legalItems = [
    { href: '/privacy', text: 'privacy' },
    { href: '/terms', text: 'terms' },
    { href: '/templates', text: 'templates' },
    { href: '/library', text: 'library' }
  ].map(link => {
    if (link.href === currentPage) {
      return `<strong class="footer-current">${link.text}</strong>`;
    }
    return `<a href="${link.href}" class="footer-legal" rel="noopener noreferrer">${link.text}</a>`;
  });
  const legalLinks = legalItems.join(' · ');

  const deployParts = [aiStatusHtml, deployHtml, legalLinks].filter(Boolean).join(' · ');

  // Lowercase `harbour` wordmark in the footer chrome (LIN-725), sharing the
  // single wordmark partial with the nav bar so the two never drift. Rendered
  // as a plain brand label (no link). Authenticated chrome only — the landing
  // footer is left untouched so landing visuals stay owned by LIN-726.
  const brandHtml = !isLanding
    ? `\n    <div class="footer-brand">${renderWordmark({ context: 'footer', href: null })}</div>`
    : '';

  return `
  <footer class="page-footer">
    ${linksHtml}
    <div class="footer-deploy">${deployParts}</div>${brandHtml}
  </footer>${feedbackMount}`;
}

/**
 * Renders the feedback widget mount point and its client assets (LIN-635 S3).
 *
 * The mount carries the urlKey + enabled flag the client widget reads; the CSS
 * and script are loaded here so the widget rides the single shared footer seam
 * onto every authenticated page. The script always loads (it owns the footer
 * toggle handler too); it only builds the panel when enabled. It paints no
 * trigger at all since LIN-2298 — that lives in the nav bar now.
 *
 * The workspace `dispatchDefaults` model/harness (LIN-1132) ride along as
 * `data-default-model`/`data-default-harness` so the widget's model/harness
 * exec-controls can show the current default as a UX-only placeholder hint —
 * the same resolved-default nicety the Dispatch page threads through its
 * `dispatch-exec-controls-container` (LIN-1094). Blank stays blank so an
 * untouched control still inherits the workspace default server-side.
 *
 * @param {string} urlKey - Current workspace URL key
 * @param {Object} featureFlags - Current feature toggle states
 * @param {Object} [dispatchDefaults] - `{ model, harness }` workspace dispatch defaults
 * @returns {string} HTML for the widget mount + assets
 */
function renderFeedbackMount(urlKey, featureFlags = {}, dispatchDefaults = {}) {
  const on = featureFlags.feedbackWidget === true;
  return `
  <div id="feedback-widget-root" data-testid="feedback-widget-root"
       data-url-key="${escapeHtml(urlKey)}" data-enabled="${on ? 'true' : 'false'}"
       data-default-model="${escapeHtml(dispatchDefaults.model || '')}" data-default-harness="${escapeHtml(dispatchDefaults.harness || '')}"></div>
  <link rel="stylesheet" href="/feedback-widget.css">
  <script src="/feedback-widget.js" defer></script>`;
}
