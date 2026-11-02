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
 * fold. Up next: at most UP_NEXT_LIMIT flat rows, ranked from the ordered cards `orderIssuesForSwipe` already made (LIN-4139:
 * the cards are the candidate pool only; their deck order is not read). One dedupe decides all of it, with precedence
 * Running > Up next > recent-only.
 */
import { isCompleted } from './providers/state-map.js'
import { PERIODICALS_PROJECT_ID, nodeKey, parentKeyOf } from './tree.js'
import { buildBlockingGraph } from './graph-features.js'

export const UP_NEXT_PER_PROJECT = 3
/** LIN-4113, LIN-4139: Home's Up next list is at most this long, ranked by `upNextOf` (never padded). */
export const UP_NEXT_LIMIT = 5
/** LIN-4113: the recent rows Home draws; the rest sit behind "show N more", paged by `/api/home-rows?kind=recent`. */
export const HOME_RECENT_LIMIT = 10

export const isStarted = issue => issue.state?.type === 'started'
export const isBacklog = issue => issue.state?.type === 'backlog' || issue.state?.type === 'triage'
export const isUnstarted = issue => issue.state?.type === 'unstarted'

/**
 * LIN-4114: the identifiers of the open rulings Home holds (`ruling.rows`), the Waiting on you set. It is its own set, not
 * extra ids in `shown`: a waiting node hands its open children up, which `shown` would not allow.
 */
export function waitingIdsOf(rulingRows = []) {
  return new Set(rulingRows.map(row => row?.anchor?.issueIdentifier).filter(Boolean))
}

/**
 * A failed stage on the task: it needs a person, so it belongs In Progress whatever its tracker word. LIN-4114 splits the
 * reason: a ruling (needs-you) is Waiting on you now, not a reason to be In Progress, so only a failure is one here.
 */
const failedAttention = (issue, states) => {
  const state = states.get(issue.identifier)
  return !!state && state.state === 'failed'
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
 * it is open: a done top task is never promoted here. A done task with an open ruling comes in through the Waiting set instead (LIN-4114).
 * A done task is never admitted for its run either: a done parent of a running subtask carries `running` by roll-up
 * (lib/task-state.js rollUpRow), and it stays context only.
 */
const isOwn = (issue, { states, topTaskId, waiting }) => {
  // LIN-4114: a waiting task is not a reason to be In Progress; it is Waiting on you. It is tested first, so a started
  // waiting task leaves Running. A waiting task with an open child shown below it stays as a context row (named exception).
  if (waiting && waiting.has(issue.identifier)) return false
  return isStarted(issue)
    || failedAttention(issue, states)
    || (!isCompleted(issue) && (isRunningOrQueued(issue, states) || (!!topTaskId && nodeKey(issue) === topTaskId)))
}

/**
 * How many rows a folded child adds to its parent's "N more" (LIN-4114). A waiting child is not a row, so its open
 * children stand in for it, the way `openOnly` hands them up; any other open child is one row. A done child is not a row
 * either, and `openOnly` hands its open children up the same way, so they are counted (LIN-4145 audit).
 */
function foldedOpenCount(child, waiting) {
  if (isCompleted(child.issue) || (waiting && waiting.has(child.issue.identifier))) {
    return (child.children || []).reduce((n, grandchild) => n + foldedOpenCount(grandchild, waiting), 0)
  }
  return 1
}

/**
 * One In Progress node: kept when it is its own reason to show, or when a kept descendant needs it as
 * context. Returns null when neither holds, or when the node is in `skip` (already shown). A node keeps only its
 * kept children and counts the open children it folds in `more`, whatever its state (LIN-4117). The fold is counted
 * from the project tree's copy of the node, which has every child; the In Progress forest holds only some of them.
 */
function inProgressNode(node, ctx, skip = null) {
  if (skip && skip.has(node.issue.identifier)) return null
  const full = ctx.fullById.get(node.issue.identifier)
  // LIN-4145: a child the tracker links from another project is neither grafted nor counted here. Whether Home draws it
  // (as its own project's row) is known only once every row is built, so `withLinkedFolds` counts it after.
  const allChildren = (full ? full.children || [] : node.children || []).filter(child => !ctx.linked.has(child.issue.identifier))
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
  const dropped = allChildren
    .filter(child => !keptIds.has(child.issue.identifier))
    .reduce((n, child) => n + foldedOpenCount(child, ctx.waiting), 0)
  const own = isOwn(node.issue, ctx)
  if (!own && children.length === 0) return null
  return {
    ...node,
    children,
    context: !own,
    more: dropped,
  }
}

/**
 * Every node of the project trees by identifier, each with all its children (the full copy LIN-4117 counts from).
 *
 * LIN-4145: a node's children follow the tracker parent link (`parentKeyOf`), wherever the child's project is. A project
 * tree nests a child only under a parent in the same project (`buildForest`), so a child in another project is a root of
 * its own tree; it is added to its parent's children here, and its identifier is in `linked`. The trees are not changed.
 */
export function fullNodesById(trees) {
  const byId = new Map()
  const idByKey = new Map()
  const roots = []
  const visit = (nodes, areRoots) => {
    for (const found of nodes) {
      if (!byId.has(found.issue.identifier)) {
        byId.set(found.issue.identifier, found)
        idByKey.set(nodeKey(found.issue), found.issue.identifier)
        if (areRoots) roots.push(found)
      }
      visit(found.children || [], false)
    }
  }
  for (const tree of trees) {
    visit(tree.incomplete || [], true)
    visit(tree.completed || [], true)
  }
  const linked = new Set()
  for (const root of roots) {
    const parentId = idByKey.get(parentKeyOf(root.issue))
    if (!parentId || parentId === root.issue.identifier) continue
    const parent = byId.get(parentId)
    byId.set(parentId, { ...parent, children: [...(parent.children || []), root] })
    linked.add(root.issue.identifier)
  }
  return { byId, linked }
}

/**
 * The children a drawn node folds behind "N more": its full children it does not keep, less a child linked from another
 * project that Home draws as its own project's row (LIN-4145: counted once). One rule for the count, `onHome` and
 * `moreOfParent`, so the fold and the set cannot disagree.
 */
export function foldedChildrenOf(children, keptIds, linked, shown) {
  return children.filter(child => {
    const id = child.issue.identifier
    return !keptIds.has(id) && !(linked.has(id) && shown.has(id))
  })
}

/**
 * LIN-4145: adds to each drawn node's `more` the open children linked from another project that it folds. `inProgressNode`
 * leaves them out because `shown` (which says whether Home draws one elsewhere) needs the whole Running view first.
 */
function withLinkedFolds(nodes, ctx, shown) {
  return nodes.map(node => {
    const children = withLinkedFolds(node.children || [], ctx, shown)
    const full = ctx.fullById.get(node.issue.identifier)
    const keptIds = new Set(children.map(child => child.issue.identifier))
    const added = foldedChildrenOf(full ? full.children || [] : [], keptIds, ctx.linked, shown)
      .filter(child => ctx.linked.has(child.issue.identifier))
      .reduce((n, child) => n + foldedOpenCount(child, ctx.waiting), 0)
    if (added === 0 && children.every((child, i) => child === node.children[i])) return node
    return { ...node, children, more: (node.more || 0) + added }
  })
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
function openNodesOf(nodes, { shown, doneRef, waiting = new Set() }) {
  const out = []
  for (const node of nodes) {
    if (shown.has(node.issue.identifier)) continue
    if (isCompleted(node.issue)) {
      doneRef.count += 1
      out.push(...openNodesOf(node.children || [], { shown, doneRef, waiting }))
    } else if (waiting.has(node.issue.identifier)) {
      // LIN-4114: a waiting task is Waiting on you, not a row here; its open children take its place, as a done task's do.
      out.push(...openNodesOf(node.children || [], { shown, doneRef, waiting }))
    } else {
      out.push({ ...node, children: openNodesOf(node.children || [], { shown, doneRef, waiting }) })
    }
  }
  return out
}

/**
 * The open part of a list of nodes: done tasks are dropped and their open children take their place. Used for
 * the rows a fold opens, so a done task is never sent to Home.
 */
export function openOnly(nodes, waiting = new Set()) {
  return openNodesOf(nodes, { shown: new Set(), doneRef: { count: 0 }, waiting })
}

/**
 * One project's open roots, split for Home. `upNext` is shown, `upNextRest` is the unstarted overflow behind
 * "show more", `backlog` is folded, and `doneCount` is the done tasks the project holds. A root already in
 * `shown` (the In Progress view) is left out.
 */
export function splitProjectRoots(tree, shown, waiting = new Set()) {
  const doneRef = { count: 0 }
  const upNext = []
  const upNextRest = []
  const backlog = []
  for (const root of openNodesOf(tree.incomplete || [], { shown, doneRef, waiting })) {
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
function indexNodes({ trees, inProgressTrees, recentActivityTrees, fullById }) {
  const byId = new Map()
  const parentOf = new Map()
  // LIN-4145: the parent is the tracker's, wherever the child's project is (the full children follow that link).
  for (const [id, full] of fullById) {
    for (const child of full.children || []) {
      if (!parentOf.has(child.issue.identifier)) parentOf.set(child.issue.identifier, id)
    }
  }
  const projectNameOf = new Map()
  // LIN-4139: each node's first visit, in the order the trees are walked (project order, then sibling order). It is the
  // last tie-break of Up next's ranking, so it must come from the trees and not from the deck's order.
  const positionOf = new Map()
  const visit = (nodes, projectName, parentId) => {
    for (const found of nodes) {
      const id = found.issue.identifier
      if (!byId.has(id)) {
        byId.set(id, found)
        positionOf.set(id, positionOf.size)
      }
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
  return { byId, parentOf, projectNameOf, positionOf }
}

/**
 * The top-level epic of `id`: the root of its tracker parent chain (LIN-4145's link, so a cross-project parent counts). A
 * task with no parent is its own epic. The tracker forbids a loop, and the walk is bounded by the map's size, so bad data
 * cannot hang it.
 */
function topAncestorOf(id, parentOf) {
  let top = id
  let parent = parentOf.get(id)
  for (let steps = 0; parent && steps <= parentOf.size; steps++) {
    top = parent
    parent = parentOf.get(parent)
  }
  return top
}

/** Does any tracker ancestor of `id` belong to `set`? The same bounded walk as `topAncestorOf`. */
function hasAncestorIn(id, parentOf, set) {
  let parent = parentOf.get(id)
  for (let steps = 0; parent && steps <= parentOf.size; steps++) {
    if (set.has(parent)) return true
    parent = parentOf.get(parent)
  }
  return false
}

/**
 * Every identifier Home shows through the Running view: each node it draws, and each open child a drawn node folds
 * behind "N more" (the same children `moreOfParent` pages, so the fold and this set cannot disagree).
 */
function onHomeIn(nodes, ctx, shown, into) {
  for (const node of nodes) {
    into.add(node.issue.identifier)
    const full = ctx.fullById.get(node.issue.identifier)
    const kept = new Set((node.children || []).map(child => child.issue.identifier))
    const folded = foldedChildrenOf(full ? full.children || [] : node.children || [], kept, ctx.linked, shown)
    identifiersIn(openOnly(folded, ctx.waiting), into)
    onHomeIn(node.children || [], ctx, shown, into)
  }
  return into
}

/** Linear's priority names by its number (0 = No priority). The ranking reads the number, the label reads the name. */
const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * An ISO timestamp or date as `D Mon YYYY`, in UTC. The text is the same on every machine and at every clock time, so the
 * label never moves with `Date.now()` (LIN-4139). Null when the value is missing or unreadable.
 */
function absoluteDate(iso) {
  const ms = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * The one-line "why" of an Up next row (LIN-4139): its priority name, then its due date when it has one (else when it was
 * added), then `unblocks N` when the deck counts one or more blocked tasks behind it. Shown, never ranked.
 */
function whyLine(issue, cardRef) {
  const parts = [PRIORITY_NAMES[issue.priority] ?? 'No priority']
  const due = absoluteDate(issue.dueDate)
  if (due) parts.push(`due ${due}`)
  else {
    const added = absoluteDate(issue.createdAt)
    if (added) parts.push(`added ${added}`)
  }
  const unblocks = cardRef.downstreamUnblocks || 0
  if (unblocks >= 1) parts.push(`unblocks ${unblocks}`)
  return parts.join(' · ')
}

/** Three-way compare for the ranking keys. Infinity compares equal to Infinity, which subtraction would not. */
const compareKeys = (x, y) => (x < y ? -1 : x > y ? 1 : 0)

/** A tracker timestamp or date as milliseconds, or `fallback` when it is missing or unreadable (the ranking sorts it last). */
function timeOr(iso, fallback) {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : fallback
}

/**
 * Up next (LIN-4113, ranked by LIN-4139). The ordered cards the pipeline computed are the candidate pool only; their deck
 * order is not read, because the deck groups parents with children and boosts bugs, which says nothing about what is next.
 *
 * Eligible: an unstarted tracker task, not a seed, whose decided state is `todo` or none, not on Home (drawn or behind a
 * fold), not waiting on an open ruling (LIN-4114), and ready: no open card in the deck blocks it (`buildBlockingGraph`
 * over the deck, so a blocker that is open anywhere on Home or in the deck holds its blocked task back, and a done blocker
 * does not).
 *
 * Ranking, in order:
 *  1. Priority, Urgent to Low. No priority ranks after Low (`priority || 5`), because it is the team's way of saying the
 *     task was never triaged, not a reason to start it first.
 *  2. Due date, earliest first. No due date ranks after any due date. A deadline outranks an undated task of the same
 *     priority; it never outranks a higher priority.
 *  3. Created, newest first. Within a priority this is the choice that matters. A High backlog is common (88 ready High
 *     tasks on the live workspace), and within High the deck's unblocks and critical-path keys pick the oldest planned
 *     chains (3 to 4 months old), which is the "older tasks" complaint. The newest task is the best record of what was
 *     decided to matter lately, and it needs no weights to defend.
 *  4. Position in the project trees (project order, then sibling order). It only makes the order total, so the same
 *     inputs always give the same list whatever order the deck arrived in.
 *
 * One card per top-level epic: the best-ranked task of each epic is the card, so five different pieces of work appear
 * rather than four children of one parent. The epic is the root of the tracker parent chain (`topAncestorOf`), which
 * includes a parent in another project (LIN-4145). The exception is a task under a Waiting task: the Waiting card already
 * stands for that work, and its open children are what Home places in its place, so they are not capped to one. The cap
 * is UP_NEXT_LIMIT, and the list is never padded: fewer qualifying tasks show fewer rows, and none shows no section.
 *
 * Each row is flat (no children), carries its project name for the badge and its `why` line.
 */
function upNextOf({ orderedCards, byId, parentOf, projectNameOf, positionOf, onHome, states, waiting }) {
  // Readiness is read from the deck's own blocking graph: `inDegree` counts open, in-deck blockers. Keyed `key || id`, as
  // buildBlockingGraph keys its edges, so a card is looked up the same way it was added.
  const { inDegree } = buildBlockingGraph(orderedCards)
  const seen = new Set()
  const candidates = []
  for (const cardRef of orderedCards) {
    if (cardRef.isSeed) continue
    const id = cardRef.identifier
    if (seen.has(id)) continue
    seen.add(id)
    const found = byId.get(id)
    if (!found || onHome.has(id) || waiting.has(id) || !isUnstarted(found.issue)) continue
    const decided = states.get(id)?.state
    if (decided && decided !== 'todo') continue
    if ((inDegree.get(cardRef.key || cardRef.id) || 0) > 0) continue
    const issue = found.issue
    candidates.push({
      found,
      cardRef,
      id,
      rank: issue.priority || 5,
      due: timeOr(issue.dueDate, Infinity),
      created: timeOr(issue.createdAt, -Infinity),
      position: positionOf.get(id) ?? Infinity,
    })
  }
  candidates.sort((a, b) => compareKeys(a.rank, b.rank)
    || compareKeys(a.due, b.due)
    || compareKeys(b.created, a.created)
    || compareKeys(a.position, b.position))

  const taken = []
  const epicsTaken = new Set()
  for (const c of candidates) {
    if (taken.length >= UP_NEXT_LIMIT) break
    const epic = topAncestorOf(c.id, parentOf)
    // A task under a Waiting task is not held back by the epic cap: its Waiting card is already Home's card for that work,
    // and `openOnly` hands its open children up in its place, so they are the work Home has to place (LIN-4114 witness 8).
    const underWaiting = hasAncestorIn(c.id, parentOf, waiting)
    if (!underWaiting && epicsTaken.has(epic)) continue
    epicsTaken.add(epic)
    taken.push({
      ...c.found,
      children: [],
      depth: 0,
      projectName: projectNameOf.get(c.id) ?? null,
      why: whyLine(c.found.issue, c.cardRef),
    })
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
export function buildHomeView({ inProgressTrees = [], trees = [], states = new Map(), topTaskId = null, recentActivityTrees = [], orderedCards = [], rulingRows = [] }) {
  // LIN-4114: the Waiting on you set, from the rows Home holds for the count. Waiting is one input to every placement below.
  const waiting = waitingIdsOf(rulingRows)
  const { byId: fullById, linked } = fullNodesById(trees)
  const ctx = { states, topTaskId, fullById, linked, waiting }

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

  const drawnTrees = [...forestTrees, ...promotedTrees]
  const shown = identifiersIn(drawnTrees.flatMap(tree => tree.roots))
  const homeInProgress = drawnTrees.map(tree => ({ ...tree, roots: withLinkedFolds(tree.roots, ctx, shown) }))

  const homeTrees = trees.map(tree => {
    if (tree.project?.id === PERIODICALS_PROJECT_ID) return tree

    // A fully done subtree arrives in `completed` (partitionCompleted), and its tasks are counted in completedCount.
    const { upNext, upNextRest, backlog, doneCount } = splitProjectRoots(tree, shown, waiting)
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
  const { byId, parentOf, projectNameOf, positionOf } = indexNodes({ trees, inProgressTrees: homeInProgress, recentActivityTrees, fullById })
  const onHome = onHomeIn(homeInProgress.flatMap(tree => tree.roots), ctx, shown, new Set())
  const upNext = upNextOf({ orderedCards, byId, parentOf, projectNameOf, positionOf, onHome, states, waiting })
  const upNextIds = new Set(upNext.map(row => row.issue.identifier))
  const recentRows = []
  const recentSeen = new Set()
  for (const recentTree of recentActivityTrees) {
    for (const row of recentTree.roots || []) {
      const id = row.issue.identifier
      if (recentSeen.has(id) || onHome.has(id) || upNextIds.has(id) || waiting.has(id)) continue
      recentSeen.add(id)
      recentRows.push(row)
    }
  }
  const recent = {
    nodes: recentRows.slice(0, HOME_RECENT_LIMIT),
    rest: recentRows.slice(HOME_RECENT_LIMIT),
    remaining: Math.max(0, recentRows.length - HOME_RECENT_LIMIT),
  }

  // LIN-4114: the Waiting on you rows and their ids. Every ruling row keeps its card, including one on a waiting task
  // that is kept as a context row (a waiting task with an open child shown below it): the count line and the badge count
  // every row, so each must have a card. The context row in Running is the only place that row's task is repeated.
  const contextIds = new Set()
  const markContext = nodes => { for (const node of nodes) { if (node.context) contextIds.add(node.issue.identifier); markContext(node.children || []) } }
  homeInProgress.forEach(tree => markContext(tree.roots))
  const waitingRows = rulingRows
  const waitingIds = waitingRows.map(row => row?.anchor?.issueIdentifier).filter(Boolean)

  // `contextIds` that are waiting tasks: their context rows draw no state words, because the card in Waiting says it (the
  // view's named exception to "each task once").
  const waitingContextIds = [...contextIds].filter(id => waiting.has(id))
  // The title each waiting card's task line shows: from the full trees (a started waiting task is not in the trimmed view).
  const titles = {}
  const visitTitles = nodes => {
    for (const node of nodes || []) {
      const id = node?.issue?.identifier
      if (id && waiting.has(id) && !(id in titles)) titles[id] = node.issue.title || ''
      visitTitles(node?.children)
    }
  }
  for (const tree of [...trees, ...inProgressTrees]) { visitTitles(tree.incomplete); visitTitles(tree.completed); visitTitles(tree.roots) }

  return { inProgressTrees: homeInProgress, trees: homeTrees, upNext, recent, waiting: { rows: waitingRows, ids: waitingIds, contextIds: waitingContextIds, titles } }
}
