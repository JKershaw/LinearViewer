/**
 * Starter content seeded into a fresh local workspace so it is not a dead-end.
 * Predates the in-app create flow (LIN-1553/LIN-1973 landed the "+ Add task"
 * page since); kept as a friendly first-run seed rather than an empty board.
 * Shape mirrors the E2E harness seed (routes/test.js).
 * @param {string} urlKey - Workspace partition scope (also the issue URL prefix).
 */
export function starterSeed(urlKey) {
  return {
    projects: [
      { id: `${urlKey}-proj-1`, name: 'Getting started', content: 'Your first local project. Edit or add issues via the API/CLI for now.', sortOrder: 1 },
    ],
    issues: [
      { id: `${urlKey}-issue-1`, identifier: 'LOCAL-1', title: 'Welcome to your local workspace', description: 'This workspace is backed by the local provider — no Linear account required. It lives entirely in this app.', projectId: `${urlKey}-proj-1`, sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${urlKey}-issue-1` },
      { id: `${urlKey}-issue-2`, identifier: 'LOCAL-2', title: 'Add your own tasks', description: 'Use the "+ Add task" affordance, the Linear API proxy, or the CLI to create issues.', projectId: `${urlKey}-proj-1`, parentId: `${urlKey}-issue-1`, sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${urlKey}/issue/${urlKey}-issue-2` },
    ],
  }
}

/**
 * The set of issue ids the starter seed creates for a workspace (LIN-2944 P3
 * addendum 18). Read-only and additive: derived from `starterSeed(urlKey)` so a
 * future third seed issue is covered automatically and the two cannot drift.
 * Used only at the presentation layer (the shared ordering helper) to demote
 * seed cards — it does not change `starterSeed()`'s data, `task-stack.js` or the
 * sort. LIN-3069 can reuse it for roadmap/next-run later.
 * @param {string} urlKey - Workspace partition scope
 * @returns {Set<string>}
 */
export function starterSeedIssueIds(urlKey) {
  return new Set(starterSeed(urlKey).issues.map((issue) => issue.id))
}
