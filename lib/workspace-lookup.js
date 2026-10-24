/**
 * The one place that decides "which workspace has this urlKey".
 *
 * Zero-import leaf on purpose: the pure navbar renderer (components/navbar.js)
 * sits in an import cycle pinned by tests/unit/email-import-boundary.test.js, so
 * the finder must not pull workspace.js (and its provider/token graph) into it.
 * Page renderers take the route's resolved workspace instead (LIN-3755).
 * tests/unit/lin-2389-workspace-lookup.test.js guards against new hand-rolled copies.
 *
 * Non-array input, or a falsy urlKey, matches nothing (a keyless workspace is
 * never "found" by an undefined key). Entries may be null. First match wins.
 */

/**
 * @param {Array<{urlKey?: string}>|null|undefined} workspaces
 * @param {string|null|undefined} urlKey
 * @returns {number} Index of the first workspace with this urlKey, or -1
 */
export function findWorkspaceIndexByUrlKey(workspaces, urlKey) {
  if (!Array.isArray(workspaces) || !urlKey) return -1;
  return workspaces.findIndex(w => w?.urlKey === urlKey);
}

/**
 * @template {{urlKey?: string}} W
 * @param {W[]|null|undefined} workspaces
 * @param {string|null|undefined} urlKey
 * @returns {W|null} The first workspace with this urlKey, or null
 */
export function findWorkspaceByUrlKey(workspaces, urlKey) {
  const index = findWorkspaceIndexByUrlKey(workspaces, urlKey);
  return index === -1 ? null : workspaces[index];
}
