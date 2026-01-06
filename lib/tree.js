// =============================================================================
// Tree Helper Functions
// =============================================================================

/**
 * Recursively assign depth values to tree nodes
 * @param {Object} node - Tree node with children array
 * @param {number} depth - Current depth (0 for root)
 */
function assignDepth(node, depth) {
  node.depth = depth
  for (const child of node.children) {
    assignDepth(child, depth + 1)
  }
}

/**
 * Sort nodes by priority and creation date (simple sort)
 * @param {Array} nodes - Array of tree nodes to sort in place
 */
function sortNodesByPriority(nodes) {
  nodes.sort((a, b) => {
    // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=None (treat as 5)
    const aPriority = a.issue.priority || 5
    const bPriority = b.issue.priority || 5
    if (aPriority !== bPriority) return aPriority - bPriority
    // Tiebreaker: createdAt (oldest first)
    return new Date(a.issue.createdAt) - new Date(b.issue.createdAt)
  })
  for (const node of nodes) {
    sortNodesByPriority(node.children)
  }
}

/**
 * Sort nodes with full criteria: status, completion, priority, date
 * @param {Array} nodes - Array of tree nodes to sort in place
 */
function sortNodesWithStatus(nodes) {
  nodes.sort((a, b) => {
    // In-progress issues first
    const aInProgress = a.issue.state?.type === 'started'
    const bInProgress = b.issue.state?.type === 'started'
    if (aInProgress !== bInProgress) {
      return aInProgress ? -1 : 1
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
 * Check if an issue is completed or canceled
 */
function isCompleted(issue) {
  const type = issue.state?.type
  return type === 'completed' || type === 'canceled'
}

// =============================================================================
// Main Export Functions
// =============================================================================

/**
 * Build a forest of issue trees grouped by project
 * @param {Array} issues - Flat list of issues from Linear API
 * @returns {Map} Map of projectId → { roots, issueMap }
 */
export function buildForest(issues) {
  const forest = new Map()

  // Group issues by project
  const byProject = new Map()
  for (const issue of issues) {
    const projectId = issue.project?.id
    if (!projectId) continue

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
 */
function isSubtreeCompleted(node) {
  if (!isCompleted(node.issue)) return false
  return node.children.every(child => isSubtreeCompleted(child))
}

/**
 * Partition roots into incomplete and completed subtrees
 * @param {Array} roots - Root nodes of the tree
 * @returns {{ incomplete: Array, completed: Array, completedCount: number }}
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
 * @param {Array} issues - All issues (not just in-progress)
 * @param {Array} projects - All projects (for getting project names)
 * @returns {Array} Array of { projectId, projectName, roots: Array<Node> }
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

  // Build nodes for relevant issues, grouped by project
  const byProject = new Map()

  for (const id of relevantIds) {
    const issue = issueMap.get(id)
    const projectId = issue.project?.id
    if (!projectId) continue

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

    // Sort by priority only (simpler sort for in-progress view)
    sortNodesByPriority(roots)

    // Get project name
    const project = projects.find(p => p.id === projectId)
    if (project && roots.length > 0) {
      result.push({
        projectId,
        projectName: project.name,
        roots
      })
    }
  }

  // Sort by project sortOrder
  result.sort((a, b) => {
    const projA = projects.find(p => p.id === a.projectId)
    const projB = projects.find(p => p.id === b.projectId)
    return (projA?.sortOrder || 0) - (projB?.sortOrder || 0)
  })

  return result
}
