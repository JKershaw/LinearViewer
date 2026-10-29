/**
 * lib/home-rows.js — the rows a Home fold opens (LIN-4024 step 2, Volume).
 *
 * Home renders only what needs the person, what is running and what is next. Everything else sits behind a
 * fold: a project's Backlog, the Up next overflow, a started parent's folded children, and search. This module
 * answers those four requests from the same trees and the same states the page was built from, so a fetched
 * row is the row the page would have rendered. It is pure: it reads no store and changes no input.
 *
 * Done tasks are never returned, whatever the request. Every answer is a bounded page of
 * HOME_ROWS_PAGE roots, except search, which is capped at HOME_SEARCH_LIMIT matches.
 */
import { isCompleted } from './providers/state-map.js'
import { buildHomeView, identifiersIn, openOnly, splitProjectRoots } from './home-view.js'
import { PERIODICALS_PROJECT_ID } from './tree.js'

export const HOME_ROW_KINDS = ['backlog', 'up-next', 'more-of-parent', 'search']
export const HOME_ROWS_PAGE = 50
export const HOME_SEARCH_LIMIT = 100
export const HOME_SEARCH_MAX_LENGTH = 200

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

/** The text search matches on: the same fields `renderNodeHtml` puts in `data-search-text`, lowercased. */
function searchTextOf(issue) {
  return [
    issue.title,
    issue.description || '',
    issue.assignee?.name || '',
    issue.identifier || '',
    ...(issue.labels?.nodes || []).map(label => label.name),
  ].join(' ').toLowerCase()
}

/**
 * The open nodes that match `needle`, each with its ancestors as context. A match keeps its own open subtree.
 * A done node is never a match and never shown; its open children take its place.
 */
function matchingNodes(nodes, needle) {
  const out = []
  for (const node of nodes) {
    if (isCompleted(node.issue)) {
      out.push(...matchingNodes(node.children || [], needle))
    } else if (searchTextOf(node.issue).includes(needle)) {
      out.push({ ...node, children: openOnly(node.children || []), context: false })
    } else {
      const kept = matchingNodes(node.children || [], needle)
      if (kept.length > 0) out.push({ ...node, children: kept, context: true })
    }
  }
  return out
}

/**
 * Search across the open work Home holds: the In Progress forest first, then the project trees. A task that is
 * in both is shown once, under In Progress.
 */
function searchRows({ q, trees, inProgressTrees }) {
  const needle = q.toLowerCase().trim()
  if (!needle) return empty('search', 'search')
  const roots = [
    ...inProgressTrees.flatMap(tree => matchingNodes(tree.roots || [], needle)),
    ...trees
      .filter(tree => tree.project?.id !== PERIODICALS_PROJECT_ID)
      .flatMap(tree => matchingNodes(tree.incomplete || [], needle)),
  ]
  const seen = new Set()
  const unique = []
  for (const root of roots) {
    if (seen.has(root.issue.identifier)) continue
    seen.add(root.issue.identifier)
    unique.push(root)
  }
  const nodes = unique.slice(0, HOME_SEARCH_LIMIT)
  return {
    nodes,
    section: 'search',
    parentId: 'search',
    nextOffset: null,
    remaining: unique.length - nodes.length,
  }
}

/**
 * The children of a started parent that Home's In Progress view folded (its "N more"): the open ones it did not
 * keep. The parent is looked up in the view and in the full forest, so the two can never disagree.
 */
function moreOfParent({ parentId, view, inProgressTrees }) {
  const kept = view.inProgressTrees.flatMap(tree => tree.roots).map(root => findById([root], parentId)).find(Boolean)
  const full = inProgressTrees.flatMap(tree => tree.roots || []).map(root => findById([root], parentId)).find(Boolean)
  if (!full) return empty('in-progress', parentId)
  const keptIds = identifiersIn((kept?.children || []))
  const folded = (full.children || []).filter(child => !keptIds.has(child.issue.identifier))
  return pageOf(openOnly(folded), 0, 'in-progress', parentId)
}

/**
 * The rows for one fold request.
 *
 * @param {Object} input
 * @param {'backlog'|'up-next'|'more-of-parent'|'search'} input.kind
 * @param {string|null} [input.projectId] - the project a backlog or up-next fold belongs to
 * @param {string|null} [input.parentId] - the started parent's issue id, for more-of-parent
 * @param {string} [input.q] - the search text, for search
 * @param {number} [input.offset] - the page start, for the paged kinds
 * @param {Array} input.trees - the project trees (`fetchAndPrepareProjects`)
 * @param {Array} input.inProgressTrees - the In Progress forest (the same call)
 * @param {Map<string, Object>} input.states - one task state per identifier (`homeRowStates`)
 * @param {string|null} [input.topTaskId] - the top task, which the view always shows
 * @returns {{nodes: Array<Object>, section: string, parentId: string, nextOffset: number|null, remaining: number}}
 *   `section` and `parentId` are what the rows render under. `nextOffset` is null on the last page.
 */
export function homeRowsFor({ kind, projectId = null, parentId = null, q = '', offset = 0, trees = [], inProgressTrees = [], states = new Map(), topTaskId = null }) {
  if (kind === 'search') return searchRows({ q, trees, inProgressTrees })

  const view = buildHomeView({ inProgressTrees, trees, states, topTaskId })
  if (kind === 'more-of-parent') return moreOfParent({ parentId, view, inProgressTrees })

  const tree = trees.find(candidate => candidate.project?.id === projectId)
  if (!tree) return empty('project', projectId)
  const shown = identifiersIn(view.inProgressTrees.flatMap(candidate => candidate.roots))
  const { upNextRest, backlog } = splitProjectRoots(tree, shown)
  const list = kind === 'backlog' ? backlog : upNextRest
  return pageOf(list, offset, 'project', projectId)
}
