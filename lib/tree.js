// =============================================================================
// Constants
// =============================================================================

import { isTerminalState, isCompleted } from './providers/state-map.js'
import { TERMINAL_TYPES } from './providers/models.js'
import { computeGraphFeatures, childrenToGraphNodes, hasOpenFrontier } from './graph-features.js'

/**
 * Virtual project ID for issues without an assigned project.
 * Used to group orphaned issues under a synthetic "No Project" section.
 */
export const NO_PROJECT_ID = '__no_project__'

/**
 * Virtual project ID for the synthetic Periodicals group (LIN-341).
 * Holds workspace-scoped periodical templates (e.g. Documentation Review)
 * injected by server.js behind the `periodicals` workspace flag. Like
 * NO_PROJECT_ID it is a synthetic id (prefixed `__`) — never a real Linear
 * project — so add-task/Linear-URL affordances must guard against it.
 */
export const PERIODICALS_PROJECT_ID = '__periodicals__'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Issue object from Linear API or landing.md
 * @typedef {Object} Issue
 * @property {string} id - Unique issue ID
 * @property {string} title - Issue title
 * @property {string} [description] - Issue description
 * @property {number} [priority] - Priority (1=Urgent, 2=High, 3=Medium, 4=Low, 0=None)
 * @property {number} [estimate] - Point estimate
 * @property {number} [sortOrder] - Sort order within project
 * @property {string} createdAt - ISO date string
 * @property {string} [dueDate] - ISO date string
 * @property {string} [completedAt] - ISO date string
 * @property {string} [url] - Link to issue in Linear
 * @property {{id: string}} [parent] - Parent issue reference
 * @property {{id: string}} [project] - Project reference
 * @property {{name: string, type: string}} [state] - Issue state (type: started|completed|canceled|unstarted|backlog)
 * @property {{name: string}} [assignee] - Assignee
 * @property {{nodes: Array<{name: string}>}} [labels] - Labels
 * @property {{id: string}} [team] - Team reference
 */

/**
 * Project object from Linear API or landing.md
 * @typedef {Object} Project
 * @property {string} id - Unique project ID
 * @property {string} name - Project name
 * @property {string} [content] - Project description
 * @property {string} [url] - Link to project in Linear
 * @property {number} sortOrder - Sort order
 * @property {boolean} [collapsed] - Default collapsed state (landing page only)
 * @property {string} [linkText] - Custom link text
 * @property {boolean} [sameTab] - Open link in same tab
 */

/**
 * Tree node representing an issue and its children
 * @typedef {Object} TreeNode
 * @property {Issue} issue - The issue data
 * @property {TreeNode[]} children - Child nodes
 * @property {number} depth - Depth in tree (0 = root)
 */

/**
 * Tree node for in-progress view (includes isInProgress flag)
 * @typedef {Object} InProgressTreeNode
 * @property {Issue} issue - The issue data
 * @property {InProgressTreeNode[]} children - Child nodes
 * @property {number} depth - Depth in tree (0 = root)
 * @property {boolean} isInProgress - Whether this specific issue is in-progress
 */

/**
 * Entry in the forest Map for a single project
 * @typedef {Object} ForestEntry
 * @property {TreeNode[]} roots - Root nodes of the tree
 * @property {Map<string, TreeNode>} issueMap - Map of issue ID to node
 */

/**
 * Forest: Map of project ID to tree structure
 * @typedef {Map<string, ForestEntry>} Forest
 */

/**
 * Partitioned project tree for rendering
 * @typedef {Object} ProjectTree
 * @property {Project} project - The project
 * @property {TreeNode[]} incomplete - Incomplete issue trees
 * @property {TreeNode[]} completed - Completed issue trees
 * @property {number} completedCount - Total count of completed issues
 */

/**
 * In-progress tree grouped by project
 * @typedef {Object} InProgressTree
 * @property {string} projectId - Project ID
 * @property {string} projectName - Project name
 * @property {InProgressTreeNode[]} roots - Root nodes of in-progress tree
 */

/**
 * Recent activity tree grouped by project
 * @typedef {Object} RecentActivityTree
 * @property {string} projectId - Project ID
 * @property {string} projectName - Project name
 * @property {TreeNode[]} roots - Root nodes of recent activity tree
 */

// =============================================================================
// Tree Helper Functions
// =============================================================================

/**
 * Recursively assign depth values to tree nodes
 * @param {TreeNode|InProgressTreeNode} node - Tree node with children array
 * @param {number} depth - Current depth (0 for root)
 */
function assignDepth(node, depth) {
  node.depth = depth
  for (const child of node.children) {
    assignDepth(child, depth + 1)
  }
}

/**
 * Sort nodes with full criteria: status, completion, priority, date
 * @param {TreeNode[]} nodes - Array of tree nodes to sort in place
 */
function sortNodesWithStatus(nodes) {
  nodes.sort((a, b) => {
    // In-progress issues first
    const aInProgress = a.issue.state?.type === 'started'
    const bInProgress = b.issue.state?.type === 'started'
    if (aInProgress !== bInProgress) {
      return aInProgress ? -1 : 1
    }
    // Then: ToDo (unstarted) before Backlog
    const aBacklog = a.issue.state?.type === 'backlog'
    const bBacklog = b.issue.state?.type === 'backlog'
    if (aBacklog !== bBacklog) {
      return aBacklog ? 1 : -1
    }
    // Then: incomplete before complete
    const aComplete = isCompleted(a.issue)
    const bComplete = isCompleted(b.issue)
    if (aComplete !== bComplete) {
      return aComplete ? 1 : -1
    }
    // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=None (treat as 5)
    const aPriority = a.issue.priority || 5
    const bPriority = b.issue.priority || 5
    if (aPriority !== bPriority) {
      return aPriority - bPriority
    }
    // Tiebreaker: createdAt (oldest first)
    return new Date(a.issue.createdAt) - new Date(b.issue.createdAt)
  })
  for (const node of nodes) {
    sortNodesWithStatus(node.children)
  }
}

/**
 * Terminal state types: issues in these states are non-actionable
 * and should be filtered/grouped together across all views.
 *
 * State semantics now live in lib/providers/state-map.js (canonical source of
 * truth, LIN-174 Phase 1). Re-exported here under the original names so the
 * existing importers of these symbols keep working with zero changes.
 */
export const TERMINAL_STATE_TYPES = TERMINAL_TYPES
export { isTerminalState, isCompleted }

/**
 * Check if an issue is blocked (by label or by blocking relation).
 * An issue is blocked if:
 * - It has the 'blocked' label, OR
 * - It has an inverse 'blocks' relation from an incomplete issue
 *
 * Relocated from lib/linear.js (LIN-330): this reasons over the issue's tree
 * shape — its `labels.nodes` and `inverseRelations.nodes` — not Linear's
 * transport, so it belongs with the canonical tree helpers.
 *
 * @param {Object} issue - Issue object with labels and inverseRelations
 * @returns {boolean} True if the issue is blocked
 */
export function isBlocked(issue) {
  // Check for 'blocked' label
  const hasBlockedLabel = Array.isArray(issue.labels?.nodes) &&
    issue.labels.nodes.some(l => l.name?.toLowerCase() === 'blocked')
  if (hasBlockedLabel) return true

  // Check for blocking relations (inverse 'blocks' from non-terminal issues)
  const hasBlockingRelation = Array.isArray(issue.inverseRelations?.nodes) &&
    issue.inverseRelations.nodes.some(r =>
      r.type === 'blocks' &&
      !isTerminalState(r.issue?.state?.type)
    )
  return hasBlockingRelation
}

/**
 * Select the next subtask to focus on for AI recommendations.
 *
 * Eligibility (HAR-149 fix, LIN-433): non-blocked in-progress → non-blocked todo
 * → non-terminal fallback. The in-progress branch now skips blocked children — it
 * previously returned the lowest-identifier in-progress child *regardless of
 * blocked status*, routing the descent straight into a blocked branch (HAR-149 →
 * blocked HAR-497/502) instead of the live, actionable frontier.
 *
 * Among the eligible (non-blocked, non-terminal) candidates, a transitive
 * dead-end guard runs FIRST (LIN-444): a candidate whose entire reachable subtree
 * frontier is blocked (descending into it can only land on blocked work) is set
 * aside in favour of any candidate with a genuinely open frontier — and only when
 * NO open-frontier candidate exists anywhere do we fall back to a dead-end branch.
 * This is what stops a busy epic from routing into a dead branch (HAR-149: HAR-497
 * → blocked HAR-502) instead of its live frontier (HAR-545 → HAR-616). The signal
 * (`hasOpenFrontier`, lib/graph-features.js) is inert when the children carry no
 * subtree blocked-ness — every candidate then reads as open — so it bites only on
 * the enriched data and never perturbs the LinearViewer baseline.
 *
 * Within the surviving pool the original tiering holds — in-progress before todo —
 * each ranked by live frontier signals: `downstreamUnblocks` desc (clear the most
 * successors), then `criticalPathLen` desc (shorten the makespan), then
 * `compareByIdentifier` asc as the deterministic tie-break. Those signals are the
 * same ones the swipe/stack digest computes, reconstructed from the in-set siblings'
 * `inverseRelations` (canonical children carry no forward `blocksIds`). An edge-free
 * set leaves every feature at its default, so ranking degrades cleanly to identifier
 * order — today's behavior.
 *
 * NOTE: this picker IS the single next-child source of truth. The descent
 * (recommend-recurse.js), the handwritten `nextChild` (prompt-formatters.js), and
 * the meta-prompt's `focusedSubtaskId` all route through it, so the advertised
 * "next child" can never disagree with the child the descent actually enters.
 *
 * The transitive guard reaches the cross-sibling-set blockers LIN-391 deferred
 * (its Scope 3): a child's dead-end is detected from its OWN subtree's blocked-ness,
 * whatever set the blockers live in — not from in-set sibling edges (which the
 * frontier features above still reconstruct only within the sibling set).
 *
 * Relocated from lib/linear.js (LIN-330): this reasons over the children tree
 * shape and state types, not Linear's transport.
 *
 * @param {Array} children - Array of child issues
 * @returns {Object|null} The selected focus subtask or null if none available
 */
export function selectFocusSubtask(children) {
  if (!children?.length) return null

  // Frontier features over the in-set sibling blocking graph. Computed on adapter
  // nodes (childrenToGraphNodes returns fresh objects) so computeGraphFeatures'
  // in-place mutation never touches the caller's children.
  const featById = new Map(
    computeGraphFeatures(childrenToGraphNodes(children)).map(n => [n.id, n])
  )
  const byFrontier = (a, b) => {
    const fa = featById.get(a.id) || {}
    const fb = featById.get(b.id) || {}
    if ((fb.downstreamUnblocks || 0) !== (fa.downstreamUnblocks || 0)) {
      return (fb.downstreamUnblocks || 0) - (fa.downstreamUnblocks || 0)
    }
    if ((fb.criticalPathLen || 0) !== (fa.criticalPathLen || 0)) {
      return (fb.criticalPathLen || 0) - (fa.criticalPathLen || 0)
    }
    return compareByIdentifier(a, b)
  }

  // Eligible candidates: non-blocked AND non-terminal (the union of the
  // in-progress + todo tiers below). LIN-444: split them by whether their reachable
  // subtree frontier is open. A dead-end candidate (entire reachable frontier
  // blocked) is skipped in favour of ANY open candidate — across the state tiers,
  // since descending into a dead-end can only reach blocked work — and we fall back
  // to the dead-end pool only when no open frontier exists at all. Precomputed once
  // (hasOpenFrontier walks each subtree) rather than inside the comparator.
  const nonBlocked = children.filter(c => !isBlocked(c) && !isTerminalState(c.state?.type))
  const openFrontier = nonBlocked.filter(c => hasOpenFrontier(c, isBlocked))
  const pool = openFrontier.length ? openFrontier : nonBlocked

  // 1. Continue in-progress work, frontier-ranked.
  const inProgress = pool
    .filter(c => c.state?.type === 'started')
    .sort(byFrontier)
  if (inProgress.length) return inProgress[0]

  // 2. First todo, frontier-ranked.
  const nextTodo = pool
    .filter(c => c.state?.type === 'unstarted' || c.state?.type === 'backlog')
    .sort(byFrontier)
  if (nextTodo.length) return nextTodo[0]

  // 3. Fall back to the lowest-identifier non-terminal subtask (degenerate
  //    all-blocked case — identifier order, no frontier preference to express)
  return children.filter(c => !isTerminalState(c.state?.type)).sort(compareByIdentifier)[0]
}

/**
 * Deterministic frontier facts for a node's children (LIN-433). Surfaced into both
 * prompt paths so the model stops re-deriving them at the LIN-389 defer-vs-breakdown
 * fork. Reads the SAME `isBlocked` + selectFocusSubtask computation the descent uses,
 * so the facts can never disagree with the child the descent picks.
 *
 * @param {Array} children - Array of child issues
 * @returns {{openCount, blockedCount, openChildren: Array<{identifier, blocked}>, nextChild}|null}
 */
export function computeFrontierFacts(children) {
  if (!children?.length) return null
  const open = children.filter(c => !isTerminalState(c.state?.type))
  const openChildren = open.map(c => ({ identifier: c.identifier, blocked: isBlocked(c) }))
  const next = selectFocusSubtask(children)
  return {
    openCount: open.length,
    blockedCount: openChildren.filter(c => c.blocked).length,
    openChildren,
    nextChild: next ? next.identifier : null
  }
}

/**
 * Natural-order comparator for issues by identifier (LIN-9 before LIN-10, not
 * "LIN-10" before "LIN-9" as a raw string compare would give).
 *
 * It is the deterministic tie-break for selectFocusSubtask: among equally-eligible
 * candidates (same state, all unblocked) the picker would otherwise fall to the
 * input array's order, which is Linear's connection order (newest-first) — so it
 * surfaces the most recently created subtask, the opposite of the usual "work them
 * in order" intuition (LIN-177: parallel subtasks S0–S5, all unblocked once S0/S1
 * were Done, picked S5 instead of the earliest remaining, S2). The same comparator
 * orders the subtask overview so the displayed order matches the chosen one.
 *
 * @param {{identifier?: string}} a
 * @param {{identifier?: string}} b
 * @returns {number}
 */
export function compareByIdentifier(a, b) {
  return (a?.identifier || '').localeCompare(b?.identifier || '', undefined, { numeric: true, sensitivity: 'base' })
}

// =============================================================================
// Main Export Functions
// =============================================================================

/**
 * Build a forest of issue trees grouped by project
 * @param {Issue[]} issues - Flat list of issues from Linear API
 * @returns {Forest} Map of projectId → { roots, issueMap }
 */
export function buildForest(issues) {
  const forest = new Map()

  // Build lookup for parent chain traversal (subtasks inherit parent's project)
  const issueById = new Map(issues.map(i => [i.id, i]))

  function getDisplayProjectId(issue) {
    if (issue.project?.id) return issue.project.id
    if (issue.parent?.id) {
      const parent = issueById.get(issue.parent.id)
      if (parent) return getDisplayProjectId(parent)
    }
    return NO_PROJECT_ID
  }

  // Group issues by project (subtasks inherit parent's project for display)
  const byProject = new Map()
  for (const issue of issues) {
    const projectId = getDisplayProjectId(issue)

    if (!byProject.has(projectId)) {
      byProject.set(projectId, [])
    }
    byProject.get(projectId).push(issue)
  }

  // Build tree for each project
  for (const [projectId, projectIssues] of byProject) {
    // Create node map
    const issueMap = new Map()
    for (const issue of projectIssues) {
      issueMap.set(issue.id, {
        issue,
        children: [],
        depth: null,
      })
    }

    // Link children to parents
    const roots = []
    for (const issue of projectIssues) {
      const node = issueMap.get(issue.id)
      const parentId = issue.parent?.id

      if (parentId && issueMap.has(parentId)) {
        // Parent is in same project, add as child
        issueMap.get(parentId).children.push(node)
      } else {
        // No parent or parent in different project = root
        roots.push(node)
      }
    }

    // Assign depths using extracted helper
    for (const root of roots) {
      assignDepth(root, 0)
    }

    // Sort with full criteria (status, completion, priority, date)
    sortNodesWithStatus(roots)

    forest.set(projectId, { roots, issueMap })
  }

  return forest
}

/**
 * Check if a node and all its descendants are completed
 * @param {TreeNode} node - Node to check
 * @returns {boolean} True if node and all descendants are completed
 */
function isSubtreeCompleted(node) {
  if (!isCompleted(node.issue)) return false
  return node.children.every(child => isSubtreeCompleted(child))
}

/**
 * Partition roots into incomplete and completed subtrees
 * @param {TreeNode[]} roots - Root nodes of the tree
 * @returns {{incomplete: TreeNode[], completed: TreeNode[], completedCount: number}} Partitioned trees
 */
export function partitionCompleted(roots) {
  const incomplete = []
  const completed = []
  let completedCount = 0

  function countNodes(node) {
    let count = 1
    for (const child of node.children) {
      count += countNodes(child)
    }
    return count
  }

  for (const root of roots) {
    if (isSubtreeCompleted(root)) {
      completed.push(root)
      completedCount += countNodes(root)
    } else {
      incomplete.push(root)
    }
  }

  return { incomplete, completed, completedCount }
}

/**
 * Build a forest of in-progress issues with their ancestor chains.
 * Groups by project for display purposes.
 *
 * @param {Issue[]} issues - All issues (not just in-progress)
 * @param {Project[]} projects - All projects (for getting project names)
 * @returns {InProgressTree[]} Array of in-progress trees grouped by project
 */
export function buildInProgressForest(issues, projects) {
  // Create a map of all issues by ID for fast lookup
  const issueMap = new Map(issues.map(i => [i.id, i]))

  // Build a children map for walking down the tree
  const childrenMap = new Map()
  for (const issue of issues) {
    if (issue.parent?.id) {
      if (!childrenMap.has(issue.parent.id)) {
        childrenMap.set(issue.parent.id, [])
      }
      childrenMap.get(issue.parent.id).push(issue)
    }
  }

  // Find all in-progress issues
  const inProgressIds = new Set(
    issues.filter(i => i.state?.type === 'started').map(i => i.id)
  )

  if (inProgressIds.size === 0) return []

  // For each in-progress issue, collect:
  // 1. Its ancestor chain (for context)
  // 2. All its descendants (to show subtasks when parent is in-progress)
  const relevantIds = new Set(inProgressIds)

  for (const issue of issues) {
    if (inProgressIds.has(issue.id)) {
      // Walk up parent chain (ancestors for context)
      let current = issue
      while (current.parent?.id && issueMap.has(current.parent.id)) {
        relevantIds.add(current.parent.id)
        current = issueMap.get(current.parent.id)
      }

      // Walk down to collect all descendants (subtasks of in-progress parent)
      const queue = [issue.id]
      while (queue.length > 0) {
        const parentId = queue.shift()
        const children = childrenMap.get(parentId) || []
        for (const child of children) {
          relevantIds.add(child.id)
          queue.push(child.id)
        }
      }
    }
  }

  // Helper to inherit parent's project for display (subtasks appear under parent)
  function getDisplayProjectId(issue) {
    if (issue.project?.id) return issue.project.id
    if (issue.parent?.id) {
      const parent = issueMap.get(issue.parent.id)
      if (parent) return getDisplayProjectId(parent)
    }
    return NO_PROJECT_ID
  }

  // Build nodes for relevant issues, grouped by project (subtasks inherit parent's project)
  const byProject = new Map()

  for (const id of relevantIds) {
    const issue = issueMap.get(id)
    const projectId = getDisplayProjectId(issue)

    if (!byProject.has(projectId)) {
      byProject.set(projectId, new Map())
    }
    byProject.get(projectId).set(id, issue)
  }

  // For each project, build tree structure
  const result = []

  for (const [projectId, projectIssueMap] of byProject) {
    const nodeMap = new Map()

    // Create nodes
    for (const [id, issue] of projectIssueMap) {
      nodeMap.set(id, {
        issue,
        children: [],
        depth: null,
        isInProgress: inProgressIds.has(id)
      })
    }

    // Link children to parents
    const roots = []
    for (const [id, issue] of projectIssueMap) {
      const node = nodeMap.get(id)
      const parentId = issue.parent?.id

      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId).children.push(node)
      } else {
        roots.push(node)
      }
    }

    // Assign depths using extracted helper
    for (const root of roots) {
      assignDepth(root, 0)
    }

    // Sort with full criteria to match Projects view
    sortNodesWithStatus(roots)

    // Get project name (use "No Project" / "Periodicals" for virtual projects)
    const project = projects.find(p => p.id === projectId)
    const projectName = projectId === NO_PROJECT_ID
      ? 'No Project'
      : projectId === PERIODICALS_PROJECT_ID
        ? 'Periodicals'
        : project?.name
    if (projectName && roots.length > 0) {
      result.push({
        projectId,
        projectName,
        roots
      })
    }
  }

  // Sort by project sortOrder (virtual "No Project" / "Periodicals" always last)
  result.sort((a, b) => {
    if (a.projectId === NO_PROJECT_ID || a.projectId === PERIODICALS_PROJECT_ID) return 1
    if (b.projectId === NO_PROJECT_ID || b.projectId === PERIODICALS_PROJECT_ID) return -1
    const projA = projects.find(p => p.id === a.projectId)
    const projB = projects.find(p => p.id === b.projectId)
    return (projA?.sortOrder || 0) - (projB?.sortOrder || 0)
  })

  return result
}

/**
 * Build a flat list of recently completed issues sorted by completion time.
 *
 * @param {Issue[]} issues - All issues
 * @param {Project[]} projects - All projects (for getting project names)
 * @param {number} daysBack - Number of days to look back (default: 7)
 * @returns {RecentActivityTree[]} Single-element array with flat list of issues
 */
export function buildRecentActivityForest(issues, projects, daysBack = 7) {
  const threshold = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
  const issueById = new Map(issues.map(i => [i.id, i]))

  // Helper to get project name for display (inherits from parent if needed)
  function getProjectName(issue) {
    let projectId = issue.project?.id
    if (!projectId && issue.parent?.id) {
      const parent = issueById.get(issue.parent.id)
      if (parent) projectId = parent.project?.id
    }
    if (!projectId) return 'No Project'
    const project = projects.find(p => p.id === projectId)
    return project?.name || 'No Project'
  }

  // Filter and sort by completedAt DESC (newest first)
  const recentlyCompleted = issues
    .filter(i =>
      i.state?.type === 'completed' &&
      i.completedAt &&
      new Date(i.completedAt) > threshold
    )
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))

  if (recentlyCompleted.length === 0) return []

  // Build flat nodes with project name attached to each
  const roots = recentlyCompleted.map(issue => ({
    issue,
    children: [],
    depth: 0,
    projectName: getProjectName(issue)
  }))

  // Return as single "tree" with no project grouping
  return [{ projectId: null, projectName: null, roots }]
}
