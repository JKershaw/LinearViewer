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

    // Assign depths
    function assignDepth(node, depth) {
      node.depth = depth
      for (const child of node.children) {
        assignDepth(child, depth + 1)
      }
    }
    for (const root of roots) {
      assignDepth(root, 0)
    }

    // Sort: incomplete before complete, then by priority, then by sortOrder
    function sortNodes(nodes) {
      nodes.sort((a, b) => {
        const aComplete = isCompleted(a.issue)
        const bComplete = isCompleted(b.issue)
        if (aComplete !== bComplete) {
          return aComplete ? 1 : -1
        }
        // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=None
        // Lower number = higher priority, but 0 (none) should sort last
        const aPriority = a.issue.priority || 5
        const bPriority = b.issue.priority || 5
        if (aPriority !== bPriority) {
          return aPriority - bPriority
        }
        return a.issue.sortOrder - b.issue.sortOrder
      })
      for (const node of nodes) {
        sortNodes(node.children)
      }
    }
    sortNodes(roots)

    forest.set(projectId, { roots, issueMap })
  }

  return forest
}

/**
 * Check if an issue is completed or canceled
 */
function isCompleted(issue) {
  const type = issue.state?.type
  return type === 'completed' || type === 'canceled'
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
