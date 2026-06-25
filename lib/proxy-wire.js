/**
 * Wire-contract neutralization for the consumer proxy API (LIN-310).
 *
 * The proxy speaks a source-neutral, tool-shaped contract:
 *  - nested collections are plain arrays, never a `{ nodes: [...] }` wrapper;
 *  - `labels` is a plain array of names (aligned with the `/stack` flat style),
 *    not an array of `{ id, name, color }` objects — the label catalog lives at
 *    GET /labels for id/colour lookup;
 *  - no field exposes a backend deep-link URL.
 *
 * Opaque IDs and identifiers (e.g. "LIN-123") are left untouched by decision.
 *
 * These transforms run as a post-fetch pass at the response boundary — the
 * GraphQL queries are unchanged, so the upstream shape is reshaped here once,
 * consistently, for every read seam and write echo. All transforms mutate in
 * place, are idempotent, and are defensive: an already-flat array passes
 * through untouched and a missing collection is left absent.
 */

// Unwrap a `{ nodes: [...] }` connection into a plain array. Tolerates an
// already-flat array and a missing/null connection.
function unwrap(conn) {
  if (Array.isArray(conn)) return conn;
  if (conn && Array.isArray(conn.nodes)) return conn.nodes;
  return [];
}

/**
 * Reshape a raw issue (or issue-like object) into the neutral wire contract,
 * in place, and return it. Safe to call on any object: only the fields present
 * are touched.
 */
export function flattenIssue(issue) {
  if (!issue || typeof issue !== 'object') return issue;

  // labels: { nodes: [{ id, name, color }] } → ["bug", ...]
  if (issue.labels !== undefined) {
    issue.labels = unwrap(issue.labels)
      .map(l => (typeof l === 'string' ? l : l && l.name))
      .filter(Boolean);
  }

  // children: { nodes: [...] } → [...] (each child neutralized too)
  if (issue.children !== undefined) {
    issue.children = unwrap(issue.children).map(flattenIssue);
  }

  // team: lift a flat `teamId` scalar from the nested team object (LIN-589), so
  // a consumer can resolve the issue's team-scoped states/labels without a
  // separate /teams call + inference. Done here — the one shared post-fetch pass
  // over reads, write echoes, and nested children — so the flat id stays
  // consistent everywhere instead of being derived per route. The nested
  // `team: { id, name }` is left in place, mirroring `project: { id, name }`.
  // Only acts when the upstream selected `team`; teamless shapes pass through.
  if (issue.team !== undefined) {
    issue.teamId = issue.team && issue.team.id != null ? issue.team.id : null;
  }

  // comments: { nodes: [...] } → [...]
  if (issue.comments !== undefined) {
    issue.comments = unwrap(issue.comments);
  }

  // relations / inverseRelations: { nodes: [...] } → [...]
  if (issue.relations !== undefined) {
    issue.relations = unwrap(issue.relations);
  }
  if (issue.inverseRelations !== undefined) {
    issue.inverseRelations = unwrap(issue.inverseRelations);
  }

  // Drop backend-revealing deep-link URLs (opaque ids/identifiers stay).
  delete issue.url;

  return issue;
}

/**
 * Strip the backend deep-link URL from a project (or any object that should
 * not expose one), in place. Returns the object.
 */
export function neutralizeProject(project) {
  if (project && typeof project === 'object') delete project.url;
  return project;
}

/**
 * Flatten a cycle's nested `issues` connection into a plain array, in place,
 * neutralizing each issue. Returns the cycle.
 */
export function flattenCycle(cycle) {
  if (!cycle || typeof cycle !== 'object') return cycle;
  if (cycle.issues !== undefined) {
    cycle.issues = unwrap(cycle.issues).map(flattenIssue);
  }
  delete cycle.url;
  return cycle;
}

/**
 * Build the neutral relations payload for GET .../relations from a raw issue:
 * both directions as plain arrays.
 */
export function flattenRelations(issue) {
  return {
    relations: unwrap(issue && issue.relations),
    inverseRelations: unwrap(issue && issue.inverseRelations)
  };
}
