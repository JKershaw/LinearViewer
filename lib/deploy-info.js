/**
 * Get deploy information from environment variables.
 *
 * Reads platform-neutral `DEPLOY_*` vars first. `commit` falls back to
 * Railway's auto-injected `RAILWAY_GIT_COMMIT_SHA` so the footer works by
 * default on Railway with no dashboard step; `version`/`createdAt` have no
 * Railway analog and stay `null` unless the neutral vars are set.
 * @returns {Object} Deploy info object with version, createdAt, commit
 */
export function getDeployInfo() {
  return {
    version: process.env.DEPLOY_VERSION || null,
    createdAt: process.env.DEPLOY_CREATED_AT || null,
    commit: process.env.DEPLOY_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || null
  }
}
