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
 *
 * LIN-4113: Home's desk is two sections over that view. Running and recently moved: the In Progress view (a running or
 * queued task is In Progress too) and then the 1-day recent rows, capped at HOME_RECENT_LIMIT with the rest behind a
 * fold. Up next: at most UP_NEXT_LIMIT flat rows, filtered from the ordered cards `orderIssuesForSwipe` already made.
 * One dedupe decides all of it, with precedence Running > Up next > recent-only.
 */
import { isCompleted } from './providers/state-map.js'
import { PERIODICALS_PROJECT_ID, nodeKey } from './tree.js'
import { needsAPerson } from './task-state.js'

export const UP_NEXT_PER_PROJECT = 3
/** LIN-4113: Home's Up next list is at most this long, in `orderIssuesForSwipe` order. */
export const UP_NEXT_LIMIT = 5
/** LIN-4113: the recent rows Home draws; the rest sit behind "show N more", paged by `/api/home-rows?kind=recent`. */
export const HOME_RECENT_LIMIT = 10

export const isStarted = issue => issue.state?.type === 'started'
export const isBacklog = issue => issue.state?.type === 'backlog' || issue.state?.type === 'triage'
export const isUnstarted = issue => issue.state?.type === 'unstarted'

/** A ruling or failed stage on the task: it needs a person, so it belongs In Progress whatever its tracker word. */
const needsAttention = (issue, states) => {
  const state = states.get(issue.identifier)
  return !!state && needsAPerson(state.state)
}

/**
 * A session is running or queued on the task (LIN-4113): a Todo task with its own live run belongs In Progress, not
 * only in its project's Up next, where it was invisible on Home. The decided state is read, so no status is re-derived.
 */
const isRunningOrQueued = (issue, states) => {
  const state = states.get(issue.identifier)
  return !!state && (state.state === 'running' || state.state === 'queued')
}

/**
 * The top task is matched by its nodeKey (`source:id`), the key every caller builds (server.js:3484), and only while
 * it is open: a done top task is never promoted here. A done task with a ruling still comes in through needsAttention.
 * A done task is never admitted for its run either: a done parent of a running subtask carries `running` by roll-up
 * (lib/task-state.js rollUpRow), and it stays context only.
 */
const isOwn = (issue, { states, topTaskId }) =>
  isStarted(issue)
  || needsAttention(issue, states)
  || (!isCompleted(issue) && (isRunningOrQueued(issue, states) || (!!topTaskId && nodeKey(issue) === topTaskId)))

/**
 * One In Progress node: kept when it is its own reason to show, or when a kept descendant needs it as
 * context. Returns null when neither holds, or when the node is in `skip` (already shown). A node keeps only its
 * kept children and counts the open children it folds in `more`, whatever its state (LIN-4117). The fold is counted
 * from the project tree's copy of the node, which has every child; the In Progress forest holds only some of them.
 */
function inProgressNode(node, ctx, skip = null) {
  if (skip && skip.has(node.issue.identifier)) return null
  const full = ctx.fullById.get(node.issue.identifier)
  const allChildren = full ? full.children || [] : node.children || []
  // The forest's children keep their order; the full children the forest does not hold follow. Those are the own
  // tasks and rulings the forest left out, so they are grafted in here (LIN-4117). Each child is looked up in full.
  const held = new Set((node.children || []).map(child => child.issue.identifier))
  const order = [...(node.children || []), ...allChildren.filter(child => !held.has(child.issue.identifier))]
  const children = []
  const keptIds = new Set()
  for (const child of order) {
    const kept = inProgressNode(child, ctx, skip)
    if (kept) {
      children.push(kept)
      keptIds.add(child.issue.identifier)
    }
  }
  const dropped = allChildren.filter(child => !keptIds.has(child.issue.identifier) && !isCompleted(child.issue)).length
  const own = isOwn(node.issue, ctx)
  if (!own && children.length === 0) return null
  return {
    ...node,
    children,
    context: !own,
    more: dropped,
  }
}

/** Every node of the project trees by identifier, each with all its children (the full copy LIN-4117 counts from). */
function fullNodesById(trees) {
  const byId = new Map()
  const visit = nodes => {
    for (const found of nodes) {
      if (!byId.has(found.issue.identifier)) byId.set(found.issue.identifier, found)
      visit(found.children || [])
    }
  }
  for (const tree of trees) {
    visit(tree.incomplete || [])
    visit(tree.completed || [])
  }
  return byId
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
 * Every node of the inputs by identifier, with its parent's identifier and its project's name (LIN-4113). The project
 * trees come first, so a node's copy there (with every child) is the one kept. Recent rows are flat and have no
 * children, so they only add the nodes the project trees do not hold.
 */
function indexNodes({ trees, inProgressTrees, recentActivityTrees }) {
  const byId = new Map()
  const parentOf = new Map()
  const projectNameOf = new Map()
  const visit = (nodes, projectName, parentId) => {
    for (const found of nodes) {
      const id = found.issue.identifier
      if (!byId.has(id)) byId.set(id, found)
      if (parentId && !parentOf.has(id)) parentOf.set(id, parentId)
      if (projectName && !projectNameOf.has(id)) projectNameOf.set(id, projectName)
      visit(found.children || [], projectName, id)
    }
  }
  for (const tree of trees) {
    visit([...(tree.incomplete || []), ...(tree.completed || [])], tree.project?.name ?? null, null)
  }
  for (const tree of inProgressTrees) visit(tree.roots || [], tree.projectName ?? null, null)
  for (const tree of recentActivityTrees) {
    for (const root of tree.roots || []) {
      visit([root], root.projectName ?? null, null)
    }
  }
  return { byId, parentOf, projectNameOf }
}

/** Is `ancestorId` an ancestor of `id` in the indexed tree? The walk stops at the root, and a loop cannot form in a tree. */
function isAncestorOf(ancestorId, id, parentOf) {
  let parent = parentOf.get(id)
  while (parent) {
    if (parent === ancestorId) return true
    parent = parentOf.get(parent)
  }
  return false
}

/**
 * Every identifier Home shows through the Running view: each node it draws, and each open child a drawn node folds
 * behind "N more" (the same children `moreOfParent` pages, so the fold and this set cannot disagree).
 */
function onHomeIn(nodes, ctx, into) {
  for (const node of nodes) {
    into.add(node.issue.identifier)
    const full = ctx.fullById.get(node.issue.identifier)
    const kept = new Set((node.children || []).map(child => child.issue.identifier))
    const folded = (full ? full.children || [] : node.children || []).filter(child => !kept.has(child.issue.identifier))
    identifiersIn(openOnly(folded), into)
    onHomeIn(node.children || [], ctx, into)
  }
  return into
}

/**
 * Up next (LIN-4113): the ordered cards the pipeline computed, filtered to the eligible ones, in that order, at most
 * UP_NEXT_LIMIT. Eligible: an unstarted tracker task, not a seed, whose decided state is `todo` or none, and not on Home
 * (drawn or behind a fold). A card whose ancestor or descendant is already taken is skipped, so a parent and its child
 * never both appear. Each row is flat (no children) and carries its project name for the badge.
 */
function upNextOf({ orderedCards, byId, parentOf, projectNameOf, onHome, states }) {
  const taken = []
  for (const cardRef of orderedCards) {
    if (taken.length >= UP_NEXT_LIMIT) break
    if (cardRef.isSeed) continue
    const id = cardRef.identifier
    const found = byId.get(id)
    if (!found || onHome.has(id) || !isUnstarted(found.issue)) continue
    const decided = states.get(id)?.state
    if (decided && decided !== 'todo') continue
    if (taken.some(row => isAncestorOf(row.issue.identifier, id, parentOf) || isAncestorOf(id, row.issue.identifier, parentOf))) continue
    taken.push({ ...found, children: [], depth: 0, projectName: projectNameOf.get(id) ?? null })
  }
  return taken
}

/**
 * Home's trimmed view.
 *
 * Running and recently moved (LIN-4113): `inProgressTrees` is the Running view (its `isOwn` admits running and queued
 * tasks), `recent.nodes` the first HOME_RECENT_LIMIT recent rows that are not already on Home, and `recent.rest` the rest,
 * which the "show N more" fold pages. Up next: `upNext`, the flat rows from `orderedCards`. One dedupe, here, with
 * precedence Running > Up next > recent-only rows. A row on Home is never repeated in a later section.
 *
 * @param {Object} input
 * @param {Array<{projectId, projectName, roots}>} input.inProgressTrees - the in-progress forest
 * @param {Array<{project, incomplete, completed, completedCount}>} input.trees - the project trees
 * @param {Map<string, Object>} input.states - one task state per identifier (`taskStateOf`'s output)
 * @param {string|null} [input.topTaskId] - the top task's identifier, always shown
 * @param {Array<{roots}>} [input.recentActivityTrees] - the 1-day recent forest (`buildRecentActivityForest`), newest first
 * @param {Array<Object>} [input.orderedCards] - the front-card order (`orderIssuesForSwipe`), seeds included
 * @returns {{inProgressTrees: Array<Object>, trees: Array<Object>, upNext: Array<Object>,
 *   recent: {nodes: Array<Object>, rest: Array<Object>, remaining: number}}} the view. The first two keep their shapes
 *   plus `context`, `more`, `upNextMore`, `doneCount` and `backlogCount`; the inputs are not changed.
 */
export function buildHomeView({ inProgressTrees = [], trees = [], states = new Map(), topTaskId = null, recentActivityTrees = [], orderedCards = [] }) {
  const ctx = { states, topTaskId, fullById: fullNodesById(trees) }

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

  // LIN-4113: Running and recently moved, and Up next, from the same Running view. Precedence: Running > Up next >
  // recent-only. A task on Home (drawn or folded) is never a recent row; an Up next row is never a recent row.
  const { byId, parentOf, projectNameOf } = indexNodes({ trees, inProgressTrees: homeInProgress, recentActivityTrees })
  const onHome = onHomeIn(homeInProgress.flatMap(tree => tree.roots), ctx, new Set())
  const upNext = upNextOf({ orderedCards, byId, parentOf, projectNameOf, onHome, states })
  const upNextIds = new Set(upNext.map(row => row.issue.identifier))
  const recentRows = []
  const recentSeen = new Set()
  for (const recentTree of recentActivityTrees) {
    for (const row of recentTree.roots || []) {
      const id = row.issue.identifier
      if (recentSeen.has(id) || onHome.has(id) || upNextIds.has(id)) continue
      recentSeen.add(id)
      recentRows.push(row)
    }
  }
  const recent = {
    nodes: recentRows.slice(0, HOME_RECENT_LIMIT),
    rest: recentRows.slice(HOME_RECENT_LIMIT),
    remaining: Math.max(0, recentRows.length - HOME_RECENT_LIMIT),
  }

  return { inProgressTrees: homeInProgress, trees: homeTrees, upNext, recent }
}
