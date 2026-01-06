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
 * Sort nodes by priority and creation date (simple sort)
 * @param {TreeNode[]|InProgressTreeNode[]} nodes - Array of tree nodes to sort in place
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
 * @param {Issue} issue - Issue to check
 * @returns {boolean} True if issue state is 'completed' or 'canceled'
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
 * @param {Issue[]} issues - Flat list of issues from Linear API
 * @returns {Forest} Map of projectId → { roots, issueMap }
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
