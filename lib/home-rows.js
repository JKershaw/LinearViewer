/**
 * lib/home-rows.js — the rows a Home fold opens (LIN-4024 step 2, Volume).
 *
 * Home renders only what needs the person, what is running and what is next. Everything else sits behind a
 * fold: a project's Backlog, the Up next overflow, a started parent's folded children, and the older recent rows. This
 * module answers those requests from the same trees and the same states the page was built from, so a fetched
 * row is the row the page would have rendered. It is pure: it reads no store and changes no input.
 *
 * Done tasks are never returned, whatever the fold request. Every answer is a bounded page of HOME_ROWS_PAGE roots.
 *
 * `searchTasks` (LIN-4562) is the search page's reader, which finds done work too. LIN-4563 retired Home's in-page search
 * and with it the `search` fold kind (`searchRows`): the rail's search is the one search.
 */
import { isCompleted } from './providers/state-map.js'
import { buildHomeView, foldedChildrenOf, fullNodesById, identifiersIn, openOnly, waitingIdsOf } from './home-view.js'
import { PERIODICALS_PROJECT_ID } from './tree.js'

export const HOME_ROW_KINDS = ['backlog', 'up-next', 'more-of-parent', 'recent']
export const HOME_ROWS_PAGE = 50
/** The longest search text the search page reads (the rail's field and the page's own carry it as `maxlength`). */
export const SEARCH_MAX_LENGTH = 200

const empty = (section, parentId) => ({ nodes: [], section, parentId, nextOffset: null, remaining: 0 })

/** One page of a list of roots, from `offset`. `remaining` is how many roots are still behind it. */
function pageOf(list, offset, section, parentId) {
  const nodes = list.slice(offset, offset + HOME_ROWS_PAGE)
  const end = offset + nodes.length
  return {
    nodes,
    section,
    parentId,
    nextOffset: end < list.length ? end : null,
    remaining: list.length - end,
  }
}

/** A node by issue id, searched depth-first. */
function findById(nodes, id) {
  for (const node of nodes) {
    if (node.issue.id === id) return node
    const found = findById(node.children || [], id)
    if (found) return found
  }
  return null
}

/** The text search matches on: a task's title, description, assignee, identifier and labels, lowercased. */
function searchTextOf(issue) {
  return [
    issue.title,
    issue.description || '',
    issue.assignee?.name || '',
    issue.identifier || '',
    ...(issue.labels?.nodes || []).map(label => label.name),
  ].join(' ').toLowerCase()
}

/** How many tasks the search page lists (`searchTasks`). The rest are counted, not drawn. */
export const SEARCH_TASKS_LIMIT = 100

/**
 * LIN-4562: search across the workspace, for the search page (`GET /workspace/:urlKey/search`). It reads the same
 * prepared trees Home reads (`fetchAndPrepareProjects`), but unlike Home's folds, which skip done work, it walks every
 * task in every project, done ones included: "finds tasks across the workspace" would be
 * untrue otherwise. Open matches come first, in tree order; then done ones, most recently finished first. Each task is
 * listed once, flat, with its project. Capped at `limit`; `remaining` counts the rest.
 *
 * @param {Object} input
 * @param {string} input.q - the search text (matched, lowercased, on `searchTextOf`'s fields)
 * @param {Array} input.trees - the project trees (`{ project, incomplete, completed }`)
 * @param {number} [input.limit]
 * @returns {{matches: Array<{issue: Object, project: Object, done: boolean}>, open: number, done: number, remaining: number}}
 */
export function searchTasks({ q, trees = [], limit = SEARCH_TASKS_LIMIT }) {
  const needle = (q || '').toLowerCase().trim()
  if (!needle) return { matches: [], open: 0, done: 0, remaining: 0 }
  const open = []
  const done = []
  const seen = new Set()
  const walk = (nodes, project) => {
    for (const node of nodes || []) {
      const issue = node.issue
      const key = issue.identifier || issue.id
      if (!seen.has(key) && searchTextOf(issue).includes(needle)) {
        seen.add(key)
        const isDone = isCompleted(issue)
        ;(isDone ? done : open).push({ issue, project, done: isDone })
      }
      walk(node.children, project)
    }
  }
  for (const tree of trees) {
    if (tree.project?.id === PERIODICALS_PROJECT_ID) continue
    walk(tree.incomplete, tree.project)
    walk(tree.completed, tree.project)
  }
  const finishedAt = (m) => Date.parse(m.issue.completedAt || '') || 0
  done.sort((a, b) => finishedAt(b) - finishedAt(a))
  const all = [...open, ...done]
  const matches = all.slice(0, limit)
  return { matches, open: open.length, done: done.length, remaining: all.length - matches.length }
}

/**
 * The children of an In Progress parent that Home's view folded (its "N more"): the open ones it did not keep. The
 * parent is taken from the project trees first, which hold every child, and from the In Progress forest otherwise
 * (LIN-4117). The project trees are read through the view's own full map, so a child in another project is the parent's
 * child here too (LIN-4145). The view is where the kept children come from, so the fold and the count can never disagree.
 */
function moreOfParent({ parentId, view, inProgressTrees, trees, waiting }) {
  const kept = view.inProgressTrees.flatMap(tree => tree.roots).map(root => findById([root], parentId)).find(Boolean)
  const { byId: fullById, linked } = fullNodesById(trees)
  const full = [...fullById.values()].find(node => node.issue.id === parentId)
    || inProgressTrees.flatMap(tree => tree.roots || []).map(root => findById([root], parentId)).find(Boolean)
  if (!full) return empty('in-progress', parentId)
  const keptIds = identifiersIn((kept?.children || []))
  const shown = identifiersIn(view.inProgressTrees.flatMap(tree => tree.roots))
  const folded = foldedChildrenOf(full.children || [], keptIds, linked, shown)
  // LIN-4114: a waiting child is Waiting on you, so its open children stand in for it (the view's own rule).
  return pageOf(openOnly(folded, waiting), 0, 'in-progress', parentId)
}

/**
 * The rows for one fold request.
 *
 * @param {Object} input
 * @param {'backlog'|'up-next'|'more-of-parent'|'recent'} input.kind
 * @param {string|null} [input.projectId] - the project a backlog or up-next fold belongs to
 * @param {string|null} [input.parentId] - the started parent's issue id, for more-of-parent
 * @param {number} [input.offset] - the page start, for the paged kinds
 * @param {Array} input.trees - the project trees (`fetchAndPrepareProjects`)
 * @param {Array} input.inProgressTrees - the In Progress forest (the same call)
 * @param {Array} [input.recentActivityTrees] - the 1-day recent forest (the same call), for the recent fold
 * @param {Array} [input.orderedCards] - the front-card order (`gatherHomeInputs`), for Up next's dedupe
 * @param {Map<string, Object>} input.states - one task state per identifier (`homeRowStates`)
 * @param {string|null} [input.topTaskId] - the top task, which the view always shows
 * @returns {{nodes: Array<Object>, section: string, parentId: string, nextOffset: number|null, remaining: number}}
 *   `section` and `parentId` are what the rows render under. `nextOffset` is null on the last page.
 */
export function homeRowsFor({ kind, projectId = null, parentId = null, offset = 0, trees = [], inProgressTrees = [], recentActivityTrees = [], orderedCards = [], states = new Map(), topTaskId = null, rulingRows = [] }) {
  // LIN-4114: the same Waiting set the page's view was built with (`rulingRows`), so a fold and the page cannot disagree.
  const waiting = waitingIdsOf(rulingRows)
  const view = buildHomeView({ inProgressTrees, trees, states, topTaskId, recentActivityTrees, orderedCards, rulingRows })
  if (kind === 'more-of-parent') return moreOfParent({ parentId, view, inProgressTrees, trees, waiting })
  // LIN-4113: the recent rows past the first HOME_RECENT_LIMIT the page drew. The page and this fold read one view, so
  // a row is drawn once and folded once, never both.
  if (kind === 'recent') return pageOf(view.recent.rest, offset, 'recent-activity', 'recent-activity-root')

  // LIN-4151: the project's split is the view's own (`projectSplits`), the same one the page's three came from. The fold
  // pages what the page did not show, in the ranked order, and never splits the project again.
  const split = view.projectSplits.get(projectId)
  if (!split) return empty('project', projectId)
  const list = kind === 'backlog' ? split.backlog : split.leadRest
  return pageOf(list, offset, 'project', projectId)
}
