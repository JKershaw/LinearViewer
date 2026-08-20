import { parseRepoFromDescription } from './prompt-formatters.js'

/**
 * Known repos of a workspace, derived from the projects the caller already
 * holds (started-only on the Linear path — the codebase has no general
 * "non-completed projects" filter to apply here).
 *
 * Pure: no I/O, no clock, no store access, does not mutate `projects`.
 *
 * @param {Array<{name?: string, content?: string|null}>} projects - Already-fetched
 *   canonical project array. `content` may be null/absent/non-string; such
 *   projects are tolerated and contribute no repo.
 * @param {{ defaultLabel?: string }} [opts]
 * @returns {Array<{repo: string|null, label: string, isDefault: boolean}>}
 *   Always non-empty: element 0 is the default row
 *   `{repo: null, label: defaultLabel, isDefault: true}`, followed by one row
 *   per distinct, non-empty `repo=` value in first-seen project order,
 *   deduped by exact (case-sensitive) match.
 */
export function knownWorkspaceRepos(projects, { defaultLabel = 'none' } = {}) {
  const rows = [{ repo: null, label: defaultLabel, isDefault: true }]
  const seen = new Set()

  for (const project of projects || []) {
    const content = project && project.content
    if (typeof content !== 'string') continue

    const repo = parseRepoFromDescription(content)
    if (!repo) continue
    if (seen.has(repo)) continue

    seen.add(repo)
    rows.push({ repo, label: repo, isDefault: false })
  }

  return rows
}
