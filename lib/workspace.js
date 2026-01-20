/**
 * Multi-workspace session management helpers.
 * Handles workspace CRUD operations within Express sessions.
 */
import { calculateExpiresAt } from './token-refresh.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Workspace object stored in session
 * @typedef {Object} Workspace
 * @property {string} id - Workspace/organization ID (UUID)
 * @property {string} name - Workspace display name
 * @property {string} urlKey - Workspace URL key (used in Linear URLs)
 * @property {string} accessToken - OAuth access token
 * @property {string} [refreshToken] - OAuth refresh token
 * @property {number} tokenExpiresAt - Token expiry timestamp (ms since epoch)
 * @property {number} addedAt - Timestamp when workspace was added (ms since epoch)
 */

/**
 * Express session with workspace data
 * @typedef {Object} WorkspaceSession
 * @property {Workspace[]} [workspaces] - Array of connected workspaces
 * @property {string} [activeWorkspaceId] - ID of currently active workspace
 * @property {function(function(Error=): void): void} save - Save session to store
 */

// =============================================================================
// Constants
// =============================================================================

export const MAX_WORKSPACES = 10;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// Session Helpers
// =============================================================================

/**
 * Get the active workspace from session.
 * If activeWorkspaceId is out of sync, syncs to first workspace.
 * @param {WorkspaceSession} session - Express session object
 * @returns {Workspace|null} Active workspace or null if not authenticated
 */
export function getActiveWorkspace(session) {
  if (!session.workspaces?.length) return null;
  const active = session.workspaces.find(w => w.id === session.activeWorkspaceId);
  if (!active) {
    // Sync activeWorkspaceId if it's out of sync
    session.activeWorkspaceId = session.workspaces[0].id;
    return session.workspaces[0];
  }
  return active;
}

/**
 * Add or update a workspace in session.
 * Updates existing workspace if same org ID, otherwise adds new.
 * @param {WorkspaceSession} session - Express session object
 * @param {Workspace} workspace - Workspace object to add/update
 * @throws {Error} If MAX_WORKSPACES limit reached
 */
export function upsertWorkspace(session, workspace) {
  session.workspaces = session.workspaces || [];
  const index = session.workspaces.findIndex(w => w.id === workspace.id);
  if (index >= 0) {
    // Update existing (re-auth for same workspace)
    session.workspaces[index] = { ...session.workspaces[index], ...workspace };
  } else {
    // Add new (check limit)
    if (session.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Maximum of ${MAX_WORKSPACES} workspaces allowed`);
    }
    session.workspaces.push(workspace);
  }
}

/**
 * Remove a workspace from session.
 * Updates activeWorkspaceId if removed workspace was active.
 * @param {WorkspaceSession} session - Express session object
 * @param {string} workspaceId - ID of workspace to remove
 * @returns {number} Number of remaining workspaces
 */
export function removeWorkspace(session, workspaceId) {
  session.workspaces = session.workspaces?.filter(w => w.id !== workspaceId) || [];

  // If removed workspace was active, switch to first remaining
  if (session.activeWorkspaceId === workspaceId) {
    session.activeWorkspaceId = session.workspaces[0]?.id || null;
  }

  return session.workspaces.length;
}

/**
 * Promisified session save.
 * @param {WorkspaceSession} session - Express session object
 * @returns {Promise<void>}
 */
export function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save(err => err ? reject(err) : resolve())
  })
}

/**
 * Update workspace with new OAuth token data.
 * Mutates the workspace object directly.
 * @param {Workspace} workspace - Workspace object to update
 * @param {Object} tokenData - Token response from OAuth flow
 * @param {string} tokenData.access_token - New access token
 * @param {string} tokenData.refresh_token - New refresh token
 * @param {number} tokenData.expires_in - Token lifetime in seconds
 */
export function updateWorkspaceTokens(workspace, tokenData) {
  workspace.accessToken = tokenData.access_token;
  workspace.refreshToken = tokenData.refresh_token;
  workspace.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
}

// =============================================================================
// URL Key Helpers
// =============================================================================

/**
 * Valid urlKey pattern: alphanumeric and hyphens, 1-50 chars.
 * Matches Linear's workspace URL key format.
 */
export const URL_KEY_REGEX = /^[a-z0-9-]{1,50}$/i;

/**
 * Find a workspace in session by its urlKey.
 * @param {WorkspaceSession} session - Express session object
 * @param {string} urlKey - Workspace URL key to find
 * @returns {Workspace|null} Matching workspace or null
 */
export function getWorkspaceByUrlKey(session, urlKey) {
  if (!session.workspaces?.length || !urlKey) return null;
  return session.workspaces.find(w => w.urlKey === urlKey) || null;
}

/**
 * Validate that a urlKey matches expected format.
 * @param {string} urlKey - URL key to validate
 * @returns {boolean} True if valid format
 */
export function validateWorkspaceUrlKey(urlKey) {
  return URL_KEY_REGEX.test(urlKey);
}
