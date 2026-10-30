/**
 * lib/home-view.js — Home's trimmed forest (LIN-4024 step 2, Volume).
 *
 * Home lists what needs the person, what is running and what is next, and folds the rest. This module
 * decides which tasks that is, from the in-progress forest, the project trees and the one task state per
 * row (`lib/task-state.js`). It is pure: it never mutates its inputs and reads no store, so
 * `fetchAndPrepareProjects` (shared with Swipe, Swim and Ship) keeps its full trees.
 *
 * In Progress: a task that is started, failed, has an open ruling, or is the top task, with its ancestors
 * as context. A started parent shows only its own started or needs-you children and counts the rest in
 * `more`. Up next: unstarted (Todo) roots, a few per project, the rest counted in `upNextMore`. Backlog:
 * counted per project in `backlogCount` and not rendered; the lazy route fetches it on open. Done: counted
 * in `doneCount` and never rendered, except a done task with an open ruling, which is In Progress. A
 * root already shown In Progress is left out of its project so no task appears twice.
 */
import { isCompleted } from './providers/state-map.js'
import { PERIODICALS_PROJECT_ID } from './tree.js'

export const UP_NEXT_PER_PROJECT = 3

export const isStarted = issue => issue.state?.type === 'started'
export const isBacklog = issue => issue.state?.type === 'backlog' || issue.state?.type === 'triage'
export const isUnstarted = issue => issue.state?.type === 'unstarted'

/** A ruling or failed stage on the task: it needs a person, so it belongs In Progress whatever its tracker word. */
const needsAttention = (issue, states) => {
  const state = states.get(issue.identifier)
  return !!state && (state.needsYou === true || state.state === 'failed')
}

const isOwn = (issue, { states, topTaskId }) =>
  isStarted(issue) || needsAttention(issue, states) || issue.identifier === topTaskId

/**
 * One In Progress node: kept when it is its own reason to show, or when a kept descendant needs it as
 * context. Returns null when neither holds, or when the node is in `skip` (already shown). A started parent
 * keeps only its own children (and context ancestors of them) and counts the rest in `more`.
 */
function inProgressNode(node, ctx, skip = null) {
  if (skip && skip.has(node.issue.identifier)) return null
  const children = []
  let dropped = 0
  for (const child of node.children || []) {
    const kept = inProgressNode(child, ctx, skip)
    if (kept) children.push(kept)
    else if (!isCompleted(child.issue)) dropped += 1
  }
  const own = isOwn(node.issue, ctx)
  if (!own && children.length === 0) return null
  return {
    ...node,
    children,
    context: !own,
    more: isStarted(node.issue) ? dropped : 0,
  }
}

/** Every identifier the In Progress view shows, so a project does not repeat it. */
export function identifiersIn(nodes, into = new Set()) {
  for (const node of nodes) {
    into.add(node.issue.identifier)
    identifiersIn(node.children, into)
  }
  return into
}

/** How many of a subtree\'s nodes are still open (not terminal). */
function openCountOf(node) {
  return (isCompleted(node.issue) ? 0 : 1) + (node.children || []).reduce((n, child) => n + openCountOf(child), 0)
}

/**
 * The open nodes of a list of siblings, for the project view. A terminal node is counted once in `doneRef`
 * and its children take its place, so open work under a done task is never dropped with it. A node
 * already shown In Progress (`shown`) is left out, and so is its subtree.
 */
function openNodesOf(nodes, { shown, doneRef }) {
  const out = []
  for (const node of nodes) {
    if (shown.has(node.issue.identifier)) continue
    if (isCompleted(node.issue)) {
      doneRef.count += 1
      out.push(...openNodesOf(node.children || [], { shown, doneRef }))
    } else {
      out.push({ ...node, children: openNodesOf(node.children || [], { shown, doneRef }) })
    }
  }
  return out
}

/**
 * The open part of a list of nodes: done tasks are dropped and their open children take their place. Used for
 * the rows a fold opens, so a done task is never sent to Home.
 */
export function openOnly(nodes) {
  return openNodesOf(nodes, { shown: new Set(), doneRef: { count: 0 } })
}

/**
 * One project's open roots, split for Home. `upNext` is shown, `upNextRest` is the unstarted overflow behind
 * "show more", `backlog` is folded, and `doneCount` is the done tasks the project holds. A root already in
 * `shown` (the In Progress view) is left out.
 */
export function splitProjectRoots(tree, shown) {
  const doneRef = { count: 0 }
  const upNext = []
  const upNextRest = []
  const backlog = []
  for (const root of openNodesOf(tree.incomplete || [], { shown, doneRef })) {
    if (isBacklog(root.issue)) {
      backlog.push(root)
    } else if (isUnstarted(root.issue) && upNext.length >= UP_NEXT_PER_PROJECT) {
      upNextRest.push(root)
    } else {
      // Up next, and any state the view does not name (a custom tracker word) stays visible.
      upNext.push(root)
    }
  }
  return { upNext, upNextRest, backlog, doneCount: doneRef.count }
}

/**
 * Home's trimmed view.
 *
 * @param {Object} input
 * @param {Array<{projectId, projectName, roots}>} input.inProgressTrees - the in-progress forest
 * @param {Array<{project, incomplete, completed, completedCount}>} input.trees - the project trees
 * @param {Map<string, Object>} input.states - one task state per identifier (`taskStateOf`'s output)
 * @param {string|null} [input.topTaskId] - the top task's identifier, always shown
 * @returns {{inProgressTrees: Array<Object>, trees: Array<Object>}} the view, same shapes as the inputs
 *   plus `context`, `more`, `upNextMore`, `doneCount` and `backlogCount`; the inputs are not changed.
 */
export function buildHomeView({ inProgressTrees = [], trees = [], states = new Map(), topTaskId = null }) {
  const ctx = { states, topTaskId }

  // The In Progress forest (started tasks and their relatives) first. Then a project's own roots that need a
  // person or are the top task, which the forest does not hold (a failed Todo task, a Backlog task with a
  // ruling). Those are added under their project, skipping anything the forest already shows.
  const forestTrees = inProgressTrees
    .map(tree => ({ ...tree, roots: (tree.roots || []).map(root => inProgressNode(root, ctx)).filter(Boolean) }))
    .filter(tree => tree.roots.length > 0)
  const shownByForest = identifiersIn(forestTrees.flatMap(tree => tree.roots))
  // A done root arrives in `completed` (partitionCompleted), so it is promoted from there too, or a done task
  // with an open ruling would be counted and never shown (LIN-4024 review finding 2).
  const promotedTrees = trees
    .filter(tree => tree.project?.id !== PERIODICALS_PROJECT_ID)
    .map(tree => ({
      projectId: tree.project.id,
      projectName: tree.project.name,
      roots: [...(tree.incomplete || []), ...(tree.completed || [])]
        .map(root => inProgressNode(root, ctx, shownByForest))
        .filter(Boolean),
    }))
    .filter(tree => tree.roots.length > 0)

  const homeInProgress = [...forestTrees, ...promotedTrees]
  const shown = identifiersIn(homeInProgress.flatMap(tree => tree.roots))

  const homeTrees = trees.map(tree => {
    if (tree.project?.id === PERIODICALS_PROJECT_ID) return tree

    // A fully done subtree arrives in `completed` (partitionCompleted), and its tasks are counted in completedCount.
    const { upNext, upNextRest, backlog, doneCount } = splitProjectRoots(tree, shown)
    return {
      ...tree,
      incomplete: upNext,
      completed: [],
      completedCount: 0,
      doneCount: doneCount + (tree.completedCount || 0),
      backlogCount: backlog.reduce((n, root) => n + openCountOf(root), 0),
      upNextMore: upNextRest.length,
    }
  })

  return { inProgressTrees: homeInProgress, trees: homeTrees }
}
