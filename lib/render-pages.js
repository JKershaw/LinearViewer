/**
 * Standalone page renderers for non-dashboard pages.
 *
 * Renders full HTML documents for:
 * - Login page (unauthenticated users)
 * - Error pages (generic errors, workspace not found)
 */

import { escapeHtml } from './utils/html.js'
import { renderPage } from './components/page.js'
import { renderPageHeader } from './components/page-header.js'
import { classifyUpstreamError } from './errors.js'

/**
 * Render a small, safe diagnostic block for an error page. Surfaces only the
 * classified vocabulary (reason · type · code · time) — never tokens, secrets,
 * or raw upstream bodies — so a user can quote it in a bug report and the `time`
 * lines up with the server log. Returns '' when no diagnostic is supplied, so
 * existing callers are unaffected.
 * @param {{detail?: string, category?: string, retryable?: boolean, code?: string, time?: string}} [diagnostic]
 * @returns {string} HTML fragment (possibly empty)
 */
function renderDiagnosticBlock(diagnostic) {
  if (!diagnostic) return ''
  const rows = [
    ['Reason', diagnostic.detail],
    ['Type', diagnostic.category && `${diagnostic.category}${diagnostic.retryable ? ' · retryable' : ''}`],
    ['Code', diagnostic.code],
    ['Time', diagnostic.time]
  ].filter(([, v]) => v)
  if (rows.length === 0) return ''
  return `<div class="error-details" role="note">
      ${rows.map(([k, v]) =>
        `<div class="error-detail-row"><span class="error-detail-key">${escapeHtml(k)}</span> <span class="error-detail-value">${escapeHtml(String(v))}</span></div>`
      ).join('\n      ')}
    </div>`
}

/**
 * Render the "create a local workspace" CTA — a form-POST to the non-OAuth
 * bootstrap (`POST /workspace/new`). Available regardless of Linear/PAT auth
 * config so local onboarding never depends on OAuth being set up. Mirrors the
 * no-CSRF form convention of `/workspace/:urlKey/remove`.
 * @returns {string} HTML fragment
 */
export function renderLocalWorkspaceCta() {
  return `<form action="/workspace/new" method="POST" class="local-workspace-cta">
      <span class="local-workspace-cta-sep">or</span>
      <input type="text" name="name" class="local-workspace-name" placeholder="Local Workspace" aria-label="Workspace name" maxlength="50">
      <button type="submit" class="local-workspace-button">Create a local workspace</button>
    </form>`
}

/**
 * Render the login page
 * @returns {string} Full HTML document
 */
export function renderLoginPage() {
  return renderPage({
    title: 'Login - Projects',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Linear Projects Viewer' })}
  <div class="login-container">
    <p>Sign in to view your Linear projects</p>
    <a href="/auth/linear" class="login-button">Login with Linear</a>
    ${renderLocalWorkspaceCta()}
  </div>`
  })
}

/**
 * Render a user-friendly error page
 * @param {string} title - Short error title
 * @param {string} message - User-friendly error message
 * @param {Object} options - Optional settings
 * @param {string} options.action - Link text for the action button
 * @param {string} options.actionUrl - URL for the action button
 * @param {Object} [options.diagnostic] - Optional safe diagnostic ({detail, category, retryable, code, time}); rendered as a small note block
 * @returns {string} Full HTML document
 */
export function renderErrorPage(title, message, options = {}) {
  const { action = 'Go back', actionUrl = '/', diagnostic = null } = options;

  const homeLink = actionUrl !== '/'
    ? `<a href="/" class="error-home-link">Go to homepage</a>`
    : '';

  return renderPage({
    title: `${escapeHtml(title)} - Projects`,
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Linear Projects Viewer' })}
  <div class="error-container">
    <div class="error-title">${escapeHtml(title)}</div>
    <p class="error-message">${escapeHtml(message)}</p>
    ${renderDiagnosticBlock(diagnostic)}
    <a href="${escapeHtml(actionUrl)}" class="login-button">${escapeHtml(action)}</a>
    ${homeLink}
  </div>`
  });
}

/**
 * Render an error page for a thrown exception on a Linear-backed route.
 *
 * Classifies the error (`classifyUpstreamError`) so a transient upstream blip —
 * the connection to Linear dropping mid-request, the failure mode behind the flat
 * "Could not load your projects" page — reads as a clear "we couldn't reach
 * Linear, this is usually temporary, try again", distinct from an internal bug.
 * Either way it appends a safe diagnostic block (reason · type · code · time) the
 * user can quote, with `time` matching the server-log line.
 *
 * @param {*} error - the caught error
 * @param {Object} [options]
 * @param {string} [options.defaultMessage] - message used when the error is NOT an upstream/network failure
 * @param {string} [options.action] - action button label
 * @param {string} [options.actionUrl] - action button URL
 * @param {string} [options.time] - ISO timestamp (defaults to now); injected for deterministic tests
 * @returns {string} Full HTML document
 */
export function renderUpstreamAwareErrorPage(error, options = {}) {
  const {
    defaultMessage = 'Something went wrong. Please try again.',
    action = 'Try again',
    actionUrl = '/',
    time = new Date().toISOString()
  } = options;

  const classified = classifyUpstreamError(error);
  const isUpstream = classified.category === 'upstream';
  const title = isUpstream ? 'Trouble Reaching Linear' : 'Something Went Wrong';
  const message = isUpstream
    ? "We couldn't reach Linear's API just now — the connection closed before it responded. This is usually temporary; try again in a moment."
    : defaultMessage;

  return renderErrorPage(title, message, {
    action,
    actionUrl,
    diagnostic: { ...classified, time }
  });
}

/**
 * Render the "workspace not found" error page
 * Shows the invalid urlKey and lists available workspaces to switch to.
 * @param {string} urlKey - The invalid URL key that was attempted
 * @param {import('./workspace.js').Workspace[]} workspaces - Array of user's workspaces
 * @returns {string} Full HTML document
 */
export function renderWorkspaceNotFoundPage(urlKey, workspaces = []) {
  const workspaceListHtml = workspaces.length > 0
    ? `<div class="workspace-list">
        <p>Your workspaces:</p>
        <ul>
          ${workspaces.map(ws => `<li><a href="/workspace/${encodeURIComponent(ws.urlKey)}/">${escapeHtml(ws.name)} (${escapeHtml(ws.urlKey)})</a></li>`).join('')}
        </ul>
      </div>`
    : '';

  const addWorkspaceLink = workspaces.length > 0
    ? `<a href="/auth/linear" class="error-home-link">Connect a new workspace</a>`
    : '';

  return renderPage({
    title: 'Workspace Not Found - Projects',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Linear Projects Viewer' })}
  <div class="error-container">
    <div class="error-title">Workspace Not Found</div>
    <p class="error-message">The workspace "${escapeHtml(urlKey)}" was not found in your connected workspaces.</p>
    ${workspaceListHtml}
    <a href="/" class="login-button">Go to homepage</a>
    ${addWorkspaceLink}
    ${renderLocalWorkspaceCta()}
  </div>`
  });
}
