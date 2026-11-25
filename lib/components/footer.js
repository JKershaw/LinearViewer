/**
 * The pieces of chrome the page frame (lib/components/frame.js) draws from here: the deploy stamp in the footer
 * (`renderDeployInfo`), the quiet AI status at the rail's foot (`renderAiStatus`), the feedback widget's mount
 * (`renderFeedbackMount`), and a signed-out preview's words.
 *
 * The old page footer (`renderPageFooter`), which every page once assembled for itself, went with the old bar
 * (LIN-4568, LIN-4342 piece 7): the frame's footer (`renderFrameFooter`) is the same on every page, the landing included.
 */

import { escapeHtml } from '../utils/html.js';

// LIN-3995: the one name for the way home from a signed-out preview. The preview's
// back link (the public frame's band, passed by render-swipe.js, render-swim.js and render-ship.js since LIN-4564)
// reads it.
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
export function renderDeployInfo(deployInfo = {}) {
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
 * Renders the AI status indicator, the quiet line at the rail's foot (it left the old footer, LIN-4562).
 * @param {'oauth'|'env'|'free'|null} source - Source of OpenRouter API key
 * @param {string|null} urlKey - Current workspace URL key for settings link
 * @returns {string} HTML for AI status indicator
 */
export function renderAiStatus(source, urlKey) {
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
  // model name from /workspace/:urlKey/api/recommend/status. Empty until populated.
  const modelHtml = `<span class="footer-ai-model" data-ai-model></span>`;

  // For free tier, show a span that will be updated client-side with remaining count
  if (source === 'free') {
    return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" data-testid="footer-ai-status" data-ai-source="free" title="OpenRouter: ${statusText}">ai: ${statusIcon} free</a>${modelHtml}`;
  }

  return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" data-testid="footer-ai-status" title="OpenRouter: ${statusText}">ai: ${statusIcon}</a>${modelHtml}`;
}

/**
 * Renders the feedback widget mount point and its client assets (LIN-635 S3).
 *
 * The mount carries the urlKey + enabled flag the client widget reads; the CSS
 * and script are loaded here so the widget rides the frame (renderFrame draws the mount)
 * onto every authenticated page. The script always loads (it owns the trigger's
 * toggle handler too); it only builds the panel when enabled. It paints no
 * trigger at all since LIN-2298 — that lives at the rail's foot (navbar.js renderFeedbackTrigger).
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
export function renderFeedbackMount(urlKey, featureFlags = {}, dispatchDefaults = {}) {
  const on = featureFlags.feedbackWidget === true;
  return `
  <div id="feedback-widget-root" data-testid="feedback-widget-root"
       data-url-key="${escapeHtml(urlKey)}" data-enabled="${on ? 'true' : 'false'}"
       data-default-model="${escapeHtml(dispatchDefaults.model || '')}" data-default-harness="${escapeHtml(dispatchDefaults.harness || '')}"></div>
  <link rel="stylesheet" href="/feedback-widget.css">
  <script src="/feedback-widget.js" defer></script>`;
}
