// =============================================================================
// In-memory fake GitHub Projects v2 client (LIN-560) — the test seam.
// =============================================================================
//
// Implements the SAME board-scoped surface as createGitHubProjectsClient
// (client.js) over an in-memory store, so the provider's reads can be driven
// end-to-end with no network and no auth. It returns the exact CLEAN shape the
// real client unwraps the GraphQL envelope into — `{ project, items }` with each
// item `{ id, type, status, content }` — so the provider's mapping code runs
// unchanged against fake and real backends alike. This is what lets the E2E be a
// genuine board-backend proof rather than a mock short-circuit.
//
// Seed shape (keyed by `org/projectNumber` board scope):
//   { 'octocat/5': { project: {id,number,title,url,shortDescription}, items: [...] } }
// where each item is { id, type, status, content: {number,title,body,url,
// createdAt,closedAt,author,assignees,labels} }. The clean shape (not the raw
// GraphQL union) keeps seeds trivial; the GraphQL wire is the real client's
// concern, pinned by its captured-fetch unit test.

/** Clone one clean item so callers can reuse a seed literal across tests. */
function cloneItem(item = {}) {
  const c = item.content || {}
  return {
    id: item.id ?? null,
    type: item.type ?? 'ISSUE',
    status: item.status ?? null,
    content: {
      number: c.number ?? null,
      title: c.title ?? '',
      body: c.body ?? '',
      url: c.url ?? null,
      createdAt: c.createdAt ?? null,
      closedAt: c.closedAt ?? null,
      author: c.author ?? null,
      assignees: [...(c.assignees || [])],
      labels: [...(c.labels || [])],
    },
  }
}

/**
 * @param {Object<string, {project?: object, items?: Array}>} seed
 *   keyed by `org/projectNumber` board scope.
 * @returns {object} a fake client with the createGitHubProjectsClient surface.
 */
export function createFakeGitHubProjectsClient(seed = {}) {
  const boards = {}
  for (const [scope, data] of Object.entries(seed)) {
    boards[scope] = {
      project: data.project ? { ...data.project } : null,
      items: (data.items || []).map(cloneItem),
    }
  }

  return {
    async fetchBoard(scope) {
      const board = boards[scope]
      if (!board) return { project: null, items: [] }
      return {
        project: board.project ? { ...board.project } : null,
        items: board.items.map(cloneItem),
      }
    },

    /**
     * List the seeded boards owned by `login` (the project-picker seam, LIN-560
     * Session 2). Derives the list from the seeded `org/projectNumber` scope keys
     * whose owner matches `login`, mapping each board's `project` summary into the
     * same clean board-summary shape the real client emits — so the auth router's
     * picker runs unchanged against fake and real backends. An unknown login yields
     * `[]`, exercising the picker's "no boards / Projects permission" empty state.
     */
    async listBoards(login) {
      const want = String(login || '')
      return Object.entries(boards)
        .filter(([scope]) => scope.split('/')[0] === want)
        .map(([scope, board]) => {
          const p = board.project || {}
          return {
            login: want,
            number: p.number ?? (Number(scope.split('/')[1]) || null),
            title: p.title ?? '',
            url: p.url ?? null,
            shortDescription: p.shortDescription ?? null,
            closed: !!p.closed,
          }
        })
    },
  }
}
