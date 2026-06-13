/**
 * Standalone page renderers for non-dashboard pages.
 *
 * Renders full HTML documents for:
 * - Login page (unauthenticated users)
 * - Error pages (generic errors, workspace not found)
 */

import { escapeHtml } from './utils/html.js'
import { renderPage } from './components/page.js'

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
    content: `<h1>Linear Projects Viewer</h1>
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
 * @returns {string} Full HTML document
 */
export function renderErrorPage(title, message, options = {}) {
  const { action = 'Go back', actionUrl = '/' } = options;

  const homeLink = actionUrl !== '/'
    ? `<a href="/" class="error-home-link">Go to homepage</a>`
    : '';

  return renderPage({
    title: `${escapeHtml(title)} - Projects`,
    stylesheets: ['/style.css'],
    content: `<header>
    <h1>Linear Projects Viewer</h1>
  </header>
  <div class="error-container">
    <div class="error-title">${escapeHtml(title)}</div>
    <p class="error-message">${escapeHtml(message)}</p>
    <a href="${escapeHtml(actionUrl)}" class="login-button">${escapeHtml(action)}</a>
    ${homeLink}
  </div>`
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
    content: `<header>
    <h1>Linear Projects Viewer</h1>
  </header>
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
