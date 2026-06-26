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
export function renderLoginPage(options = {}) {
  // GitHub login is offered only when its OAuth app is configured (LIN-541),
  // mirroring how /auth/github 503s when the env vars are missing.
  const { githubEnabled = !!process.env.GITHUB_CLIENT_ID } = options
  const githubButton = githubEnabled
    ? `<a href="/auth/github" class="login-button login-button-github" data-testid="login-github">Continue with GitHub</a>`
    : ''
  return renderPage({
    title: 'Login - Projects',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Harbour' })}
  <div class="login-container">
    <p>Sign in to view your projects</p>
    <a href="/auth/linear" class="login-button">Login with Linear</a>
    ${githubButton}
    ${renderLocalWorkspaceCta()}
  </div>`
  })
}

/**
 * Render the post-OAuth GitHub repository picker (LIN-541).
 *
 * Step 2 of the GitHub login flow: the user has authorized, and now chooses
 * which repository's issues to bind. Submitting POSTs the `owner/name` slug to
 * `/auth/github/link`, which writes the binding (the credential is already held
 * server-side in the session, never round-tripped through this form).
 *
 * @param {Array<{slug: string, name: string, private?: boolean, installationId?: string}>} repos
 *   `installationId` is present only on the already-installed re-bind path
 *   (LIN-728); when repos span more than one installation the options are grouped
 *   by account so the user can tell same-named repos on different accounts apart.
 * @param {{mode?: string, login?: string}} [options]
 * @returns {string} Full HTML document
 */
export function renderGitHubRepoSelectPage(repos = [], options = {}) {
  const { mode = 'new', login = '' } = options
  const heading = mode === 'add-source' ? 'Add a GitHub repository' : 'Choose a GitHub repository'
  const subtitle = login
    ? `Signed in as ${escapeHtml(login)}. Pick the repository whose issues to connect.`
    : 'Pick the repository whose issues to connect.'

  // The form ALWAYS submits only the `repo` slug — the server maps repo ->
  // installation from the session pending (no client trust). On the re-bind path
  // (LIN-728) repos may come from several installations; group them by account
  // (the slug owner) only when more than one installation is present, so the
  // single-installation/install path stays a flat list (byte-identical render).
  const option = (r) => `<option value="${escapeHtml(r.slug)}">${escapeHtml(r.name)}${r.private ? ' (private)' : ''}</option>`
  const installationCount = new Set(repos.map(r => r.installationId).filter(Boolean)).size
  let optionsHtml
  if (installationCount > 1) {
    const byAccount = new Map()
    for (const r of repos) {
      const account = String(r.slug).split('/')[0] || 'GitHub'
      if (!byAccount.has(account)) byAccount.set(account, [])
      byAccount.get(account).push(r)
    }
    optionsHtml = [...byAccount.entries()]
      .map(([account, rs]) => `<optgroup label="${escapeHtml(account)}">
          ${rs.map(option).join('\n          ')}
        </optgroup>`)
      .join('\n        ')
  } else {
    optionsHtml = repos.map(option).join('\n        ')
  }

  const body = repos.length === 0
    ? `<p class="error-message">No repositories were found for your GitHub account.</p>
    <a href="/" class="login-button">Go to homepage</a>`
    : `<form action="/auth/github/link" method="POST" class="github-repo-form" data-testid="github-repo-form">
      <label class="field-label" for="github-repo-select">Repository</label>
      <select name="repo" id="github-repo-select" class="github-repo-select" data-testid="github-repo-select" required>
        ${optionsHtml}
      </select>
      <button type="submit" class="login-button" data-testid="github-repo-submit">Connect repository</button>
    </form>`

  return renderPage({
    title: 'Choose a repository - Projects',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Harbour' })}
  <div class="login-container" data-testid="github-repo-select-page">
    <div class="error-title">${escapeHtml(heading)}</div>
    <p>${subtitle}</p>
    ${body}
  </div>`
  })
}

/**
 * Render the post-install GitHub Projects board picker (LIN-560 Session 2).
 *
 * Step 2 of the GitHub Projects connect flow: the user has installed/configured
 * the shared GitHub App, and now chooses which Projects v2 board to bind.
 * Submitting POSTs the `org/projectNumber` slug to `/auth/github-projects/link`,
 * which writes the binding (the installation credential is already held
 * server-side in the session, never round-tripped through this form).
 *
 * The empty state is deliberately informative: an installation with no readable
 * boards almost always means the GitHub App was not granted the **Projects (read)**
 * permission — the operational prerequisite — so the page says so rather than a
 * bare "none found".
 *
 * @param {Array<{login: string, number: number, title?: string, url?: string|null, shortDescription?: string|null}>} boards
 * @param {{mode?: string, login?: string}} [options]
 * @returns {string} Full HTML document
 */
export function renderGitHubProjectSelectPage(boards = [], options = {}) {
  const { mode = 'new', login = '' } = options
  const heading = mode === 'add-source' ? 'Add a GitHub project board' : 'Choose a GitHub project board'
  const subtitle = login
    ? `Installed for ${escapeHtml(login)}. Pick the Projects v2 board to connect.`
    : 'Pick the Projects v2 board to connect.'

  // The form ALWAYS submits only the `org/projectNumber` slug. Each board's owner
  // is its `login` and its identifier its `number`; the visible label is the
  // board's title (falling back to the slug) so same-numbered boards on different
  // owners stay distinguishable.
  const option = (b) => {
    const slug = `${b.login}/${b.number}`
    const label = b.title ? `${b.title} (${slug})` : slug
    return `<option value="${escapeHtml(slug)}">${escapeHtml(label)}</option>`
  }
  const optionsHtml = boards.map(option).join('\n        ')

  const body = boards.length === 0
    ? `<p class="error-message">No Projects v2 boards were found for this installation. Make sure the Harbour GitHub App is granted the <strong>Projects (read)</strong> permission, then try again.</p>
    <a href="/auth/github-projects" class="login-button">Try again</a>`
    : `<form action="/auth/github-projects/link" method="POST" class="github-repo-form" data-testid="github-projects-board-form">
      <label class="field-label" for="github-projects-board-select">Project board</label>
      <select name="board" id="github-projects-board-select" class="github-repo-select" data-testid="github-projects-board-select" required>
        ${optionsHtml}
      </select>
      <button type="submit" class="login-button" data-testid="github-projects-board-submit">Connect board</button>
    </form>`

  return renderPage({
    title: 'Choose a project board - Projects',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Harbour' })}
  <div class="login-container" data-testid="github-projects-board-select-page">
    <div class="error-title">${escapeHtml(heading)}</div>
    <p>${subtitle}</p>
    ${body}
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
    content: `${renderPageHeader({ title: 'Harbour' })}
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

  // An auth failure (Linear rejected the token as unauthenticated — 401/403)
  // can never be fixed by retrying the same URL: the rejected token is reused on
  // every retry, so a bare "Try again" button is a dead end — the "no way out"
  // failure mode. The only real recovery is to drop the session and sign in
  // again, so the action ALWAYS points at /logout here, overriding whatever the
  // caller passed (which would loop straight back into the same auth error).
  if (classified.category === 'auth') {
    return renderErrorPage(
      'Re-authentication Needed',
      'Linear rejected your session as unauthenticated — your sign-in has expired or been revoked. Log out and sign in again to continue.',
      {
        action: 'Log out and sign in again',
        actionUrl: '/logout',
        diagnostic: { ...classified, time }
      }
    );
  }

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
    content: `${renderPageHeader({ title: 'Harbour' })}
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
