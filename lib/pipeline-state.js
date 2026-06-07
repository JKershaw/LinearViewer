/**
 * lib/pipeline-state.js
 *
 * Assembles the full Pipeline Snapshot for a workspace by joining Linear fetch
 * results, the existing stack-assembly helpers, and the loop reconstruction
 * library (`lib/pipeline-loops.js`) into a `{queue, active, recent}` shape.
 *
 * Two public entry points:
 *   - `buildPipelineSnapshot(urlKey, deps)` — full grid snapshot with the
 *     leaf-primary filter applied (parents drop off once they have incomplete
 *     children, unless a recent own-loop re-admits them).
 *   - `getTaskForIssue(urlKey, identifier, deps)` — single Task rollup for
 *     any issue, bypassing the leaf filter, for detail overlays.
 *
 * Both routes go through the private `rollupTask` helper so they cannot drift.
 *
 * Dependency injection (mirroring `lib/pipeline-loops.js`) makes this unit
 * testable without network or DB access: callers inject
 * `getWorkspaceAccessToken`, `dispatchStore`, `foremanStore`, and optionally
 * `fetchProjects`/`getLoopsForWorkspace` for deterministic fixtures.
 *
 * See LIN-246 for the design plan and rationale.
 */

import { getProvider } from './providers/registry.js';
import './providers/linear/index.js'; // side effect: self-registers the Linear provider into the registry
import { getLoopsForWorkspace as defaultGetLoopsForWorkspace } from './pipeline-loops.js';
import {
  buildForest,
  partitionCompleted,
  buildInProgressForest,
  buildRecentActivityForest,
  isTerminalState,
  NO_PROJECT_ID
} from './tree.js';
import {
  flattenTrees,
  sortIssuesForSwipe,
  applyBlockingOrder,
  clusterByParent
} from './render-swipe.js';

// DI default for fetchProjects: resolves the registered Linear provider lazily
// (LIN-331). The `deps.fetchProjects` override seam is preserved so fixtures can
// still inject their own fetchProjects.
const defaultFetchProjects = (apiKey, teamId) => getProvider('linear').fetchProjects(apiKey, teamId);

// ─── Tunables ────────────────────────────────────────────────────────────────

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_CAP = 50;

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Pipeline cell health color based on loop count.
 * Thresholds match the LIN-246 plan: ≤3 green, ≤6 amber, else red.
 *
 * @param {number} loopCount
 * @returns {'green'|'amber'|'red'}
 */
function healthColor(loopCount) {
  if (loopCount <= 3) return 'green';
  if (loopCount <= 6) return 'amber';
  return 'red';
}

/**
 * Walk the parent chain for an issue using an `id → issue` lookup.
 *
 * Returns an ordered array `[{identifier, title}, …]` starting with the
 * immediate parent and ending at the highest available ancestor. A `Set`
 * guards against self-parent cycles (data corruption); the walk also halts
 * cleanly when the next parent falls outside the fetched page.
 *
 * @param {Object} issue                         - Issue with `.parent?.id`
 * @param {Map<string, Object>} issueById        - id → issue map
 * @returns {Array<{identifier: string, title: string}>}
 */
function walkParentChain(issue, issueById) {
  const chain = [];
  if (!issue) return chain;
  const seen = new Set();
  let cur = issue;
  while (cur?.parent?.id && !seen.has(cur.parent.id)) {
    seen.add(cur.parent.id);
    const parent = issueById.get(cur.parent.id);
    if (!parent) break;
    chain.push({ identifier: parent.identifier, title: parent.title });
    cur = parent;
  }
  return chain;
}

/**
 * Leaf-primary predicate for stackTasks.
 *
 * A task is a leaf when it has no subtasks, or all of its subtasks are in a
 * terminal state (`completed`/`canceled`). The stack assembly at
 * `routes/proxy.js:1480-1544` already decorates each task's `subtasks[]` with
 * `stateType`, so this predicate runs in pure memory.
 *
 * Note: this is philosophically aligned with `selectFocusSubtask()` at
 * `lib/linear.js:549` — both expressions of the "descend into the real unit
 * of work" rule. They are mechanically different (return types and call
 * sites differ), so we intentionally do NOT extract a shared helper. See the
 * LIN-246 plan's cross-cutting concerns section for rationale.
 *
 * @param {Object} stackTask   - task with `subtasks: [{stateType, …}]`
 * @returns {boolean}
 */
function isLeaf(stackTask) {
  const subtasks = stackTask?.subtasks || [];
  if (subtasks.length === 0) return true;
  return subtasks.every(s => isTerminalState(s.stateType));
}

/**
 * True if the Task has any open loop (queued/running/waiting).
 *
 * Used by both the leaf-primary filter (to decide what belongs in `active`)
 * and by `queue` partitioning (to exclude anything already in flight).
 *
 * @param {Object} task   - rolled-up Task with `loops[]`
 * @returns {boolean}
 */
function hasActiveLoop(task) {
  if (!task?.loops) return false;
  return task.loops.some(l =>
    l.agentState === 'queued' || l.agentState === 'running' || l.agentState === 'waiting'
  );
}

/**
 * True if the Task has its own loop dispatched within the last 24 hours.
 *
 * This is the re-admission rule for parents: once a parent's children have
 * been broken down, it drops out of the grid under `isLeaf`. If the user
 * then fires a review/retry loop against the parent itself, that recent
 * own-loop pulls the parent back onto the grid alongside any still-open
 * child rows.
 *
 * @param {Object} task   - rolled-up Task with `loops[]`
 * @param {number} now    - numeric timestamp
 * @returns {boolean}
 */
function hasRecentOwnLoop(task, now) {
  if (!task?.loops || task.loops.length === 0) return false;
  const cutoff = now - RECENT_WINDOW_MS;
  return task.loops.some(l => {
    const t = l.dispatchedAt ? new Date(l.dispatchedAt).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}

/**
 * Produce the per-issue Pipeline Task rollup.
 *
 * Called from BOTH public functions — any change here affects the grid and
 * the detail overlay simultaneously. Does not mutate inputs.
 *
 * The `issue` argument may be either:
 *   - a raw Linear issue (from `fetchProjects` → `issueByIdentifier`), used
 *     by `getTaskForIssue`; or
 *   - a decorated stackTask (from the stack-assembly pipeline), used by
 *     `buildPipelineSnapshot`. Stack tasks carry `subtasks[]`, `parentId`,
 *     etc. but do not carry `parent.id` for chain walking — we look the
 *     canonical issue up via `issueById` when the input is a stack task.
 *
 * @param {Object} issue                      - raw issue or stack task
 * @param {Array<Object>} loopsForIssue       - loops for this issue, any order
 * @param {Map<string, Object>} issueById     - full id → raw issue lookup
 * @param {number} now                        - numeric timestamp (for sort stability)
 * @returns {Object} Task rollup
 */
function rollupTask(issue, loopsForIssue, issueById, now) {
  const loops = Array.isArray(loopsForIssue) ? [...loopsForIssue] : [];

  // Sort newest-first by dispatchedAt; tie-break on loopId for determinism.
  loops.sort((a, b) => {
    const ta = a.dispatchedAt ? new Date(a.dispatchedAt).getTime() : 0;
    const tb = b.dispatchedAt ? new Date(b.dispatchedAt).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(b.loopId || '').localeCompare(String(a.loopId || ''));
  });

  const head = loops[0] || null;
  const loopCount = loops.length;

  // Max timestamp across all loop activity (dispatchedAt or resolvedAt).
  let lastActivityAt = null;
  let lastActivityMs = -Infinity;
  for (const l of loops) {
    for (const candidate of [l.resolvedAt, l.dispatchedAt]) {
      if (!candidate) continue;
      const t = new Date(candidate).getTime();
      if (Number.isFinite(t) && t > lastActivityMs) {
        lastActivityMs = t;
        lastActivityAt = candidate;
      }
    }
  }

  // Resolve the "raw" linear issue for parentChain walking. Stack tasks carry
  // `id` but not `parent.id`; raw issues from fetchProjects carry both.
  const rawIssue = (issue && issue.parent !== undefined)
    ? issue
    : (issue?.id ? issueById.get(issue.id) : null);
  const parentChain = rawIssue ? walkParentChain(rawIssue, issueById) : [];

  // Labels normalisation: stack tasks already expose `labels: string[]`;
  // raw issues expose `labels.nodes[].name`.
  let labels;
  if (Array.isArray(issue?.labels)) {
    labels = issue.labels.slice();
  } else if (Array.isArray(issue?.labels?.nodes)) {
    labels = issue.labels.nodes.map(l => l.name);
  } else {
    labels = [];
  }

  // State normalisation: stack tasks carry `stateType`/`stateName` flat;
  // raw issues expose `state.{type,name}`.
  const stateType = issue?.stateType ?? issue?.state?.type ?? null;
  const stateName = issue?.stateName ?? issue?.state?.name ?? null;

  return {
    id: issue?.id || null,
    identifier: issue?.identifier || null,
    title: issue?.title || null,
    priority: issue?.priority ?? 0,
    state: stateType ? { type: stateType, name: stateName } : null,
    labels,
    url: issue?.url || null,
    loops,
    loopCount,
    currentStage: head ? head.stage : null,
    agentState: head ? head.agentState : null,
    healthColor: healthColor(loopCount),
    lastActivityAt,
    parentChain,
    // Secondary sort key — stable, numeric, always defined.
    _lastActivityMs: Number.isFinite(lastActivityMs) ? lastActivityMs : 0
  };
}

// ─── Stack assembly (pure extract of routes/proxy.js:1480-1544) ──────────────

/**
 * Reconstruct the same ordered task stack used by `/api/proxy/stack`.
 *
 * This logic is currently duplicated inline in `routes/proxy.js` — the plan
 * explicitly defers extracting a shared helper (would widen the blast radius
 * beyond LIN-246). The Pipeline snapshot's `_buildStack` and the proxy route
 * must stay in sync; a test verifies ordering parity against a fixture.
 *
 * @param {Array<Object>} projects    - projects from fetchProjects (mutated locally only)
 * @param {Array<Object>} issues      - issues from fetchProjects
 * @returns {Array<Object>}           - ordered stack tasks with subtasks[] etc.
 */
function _buildStack(projects, issues) {
  // Do not mutate caller arrays.
  const localProjects = [...projects];

  const forest = buildForest(issues);
  if (forest.has(NO_PROJECT_ID)) {
    localProjects.push({
      id: NO_PROJECT_ID,
      name: 'No Project',
      content: null,
      url: null,
      sortOrder: Number.MAX_SAFE_INTEGER
    });
  }

  const inProgressTrees = buildInProgressForest(issues, localProjects);
  const recentActivityTrees = buildRecentActivityForest(issues, localProjects, 1);
  const trees = localProjects
    .slice() // avoid mutating via sort
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(project => {
      const { roots } = forest.get(project.id) || { roots: [] };
      const { incomplete } = partitionCompleted(roots);
      return { project, incomplete };
    });

  const projectIssues = flattenTrees(trees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // Dedupe preserving "in-progress first" ordering (matches proxy route).
  const seenIds = new Set();
  const allIssues = [];
  for (const issue of inProgressIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of projectIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of recentIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }

  // Parent/subtask relationships (single-hop decoration).
  const cardById = new Map(allIssues.map(i => [i.id, i]));
  const subtaskMap = new Map();
  for (const issue of allIssues) {
    if (issue.parentId && cardById.has(issue.parentId)) {
      const parent = cardById.get(issue.parentId);
      issue.parentIdentifier = parent.identifier;
      issue.parentTitle = parent.title;
      if (!subtaskMap.has(issue.parentId)) subtaskMap.set(issue.parentId, []);
      subtaskMap.get(issue.parentId).push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stateType: issue.stateType
      });
    }
  }
  for (const [parentId, children] of subtaskMap) {
    const parent = cardById.get(parentId);
    if (parent) parent.subtasks = children;
  }
  // Ensure every stack task has a subtasks array (default empty).
  for (const issue of allIssues) {
    if (!issue.subtasks) issue.subtasks = [];
  }

  sortIssuesForSwipe(allIssues);
  return clusterByParent(applyBlockingOrder(allIssues));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the full Pipeline Snapshot for a workspace.
 *
 * Returns `{fetchedAt, queue, active, recent}` where:
 *   - `active` = leaves (or parents with a recent own-loop) that have at
 *     least one open loop.
 *   - `queue`  = the rest of the stack minus anything already in `active`
 *     and minus anything with an open loop (truly ready-to-start).
 *   - `recent` = loops resolved within the last 24h, newest first, capped.
 *
 * @param {string} urlKey                              - workspace urlKey
 * @param {Object} [deps]                              - DI hook
 * @param {Function} [deps.getWorkspaceAccessToken]    - `(urlKey) => token`
 * @param {Object}   [deps.dispatchStore]
 * @param {Object}   [deps.foremanStore]
 * @param {Function} [deps.fetchProjects]              - override for tests
 * @param {Function} [deps.getLoopsForWorkspace]       - override for tests
 * @param {number|Date} [deps.now]                     - inject for determinism
 * @returns {Promise<{fetchedAt: string, queue: Array, active: Array, recent: Array}>}
 */
export async function buildPipelineSnapshot(urlKey, deps = {}) {
  const {
    getWorkspaceAccessToken,
    dispatchStore,
    foremanStore,
    fetchProjects = defaultFetchProjects,
    getLoopsForWorkspace = defaultGetLoopsForWorkspace,
    now = Date.now()
  } = deps;

  if (!urlKey) {
    throw new Error('pipeline-state: urlKey is required');
  }
  if (typeof getWorkspaceAccessToken !== 'function') {
    throw new Error('pipeline-state: getWorkspaceAccessToken must be injected');
  }
  if (!dispatchStore || !foremanStore) {
    throw new Error('pipeline-state: dispatchStore and foremanStore must be injected');
  }

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

  const accessToken = await getWorkspaceAccessToken(urlKey);
  if (!accessToken) {
    throw new Error('pipeline-state: no access token available for workspace');
  }

  const [projectsResult, allLoops] = await Promise.all([
    fetchProjects(accessToken),
    getLoopsForWorkspace(urlKey, { dispatchStore, foremanStore })
  ]);

  const { projects = [], issues = [] } = projectsResult || {};

  // Group loops by issueIdentifier (rollupTask re-sorts descending).
  const loopsByIssue = new Map();
  for (const loop of allLoops) {
    const key = loop.issueIdentifier;
    if (!key) continue;
    if (!loopsByIssue.has(key)) loopsByIssue.set(key, []);
    loopsByIssue.get(key).push(loop);
  }

  // Build canonical issue lookups from the raw fetch (used for parentChain).
  const issueByIdentifier = new Map();
  const issueById = new Map();
  for (const issue of issues) {
    if (issue.identifier) issueByIdentifier.set(issue.identifier, issue);
    if (issue.id) issueById.set(issue.id, issue);
  }

  // Rebuild the stack exactly as /api/proxy/stack does.
  const stackTasks = _buildStack(projects, issues);

  // Roll up every stackTask through the shared helper.
  const rolled = stackTasks.map(stackTask => {
    const loopsForIssue = loopsByIssue.get(stackTask.identifier) || [];
    const task = rollupTask(stackTask, loopsForIssue, issueById, nowMs);
    // Keep a back-reference to the stack task so the leaf filter can read
    // subtasks/stateType without rolling them into the public Task shape.
    return { task, stackTask };
  });

  // Partition: active = state is "started" (in-progress) && (isLeaf || hasRecentOwnLoop).
  // Queue = state is "unstarted" or "backlog" (ready to start).
  // Terminal-state tasks (completed/canceled/duplicate) and non-leaf parents without recent own-loops are excluded.
  const activeEntries = [];
  const queueEntries = [];
  for (const entry of rolled) {
    const { task, stackTask } = entry;
    const stateType = task.state?.type;
    if (stateType === 'started' && (isLeaf(stackTask) || hasRecentOwnLoop(task, nowMs))) {
      activeEntries.push(entry);
    } else if (stateType === 'unstarted' || stateType === 'backlog') {
      queueEntries.push(entry);
    }
    // Terminal-state tasks (completed/canceled/duplicate) fall out of both.
    // Non-leaf parents with state "started" but no recent own-loop also fall
    // out — the children carry the cells.
  }

  // Primary sort: lastActivityAt desc. Stable tie-break: original stack order
  // (captured via index).
  const stackOrder = new Map(stackTasks.map((t, i) => [t.id, i]));
  const sortByActivity = (a, b) => {
    if (b.task._lastActivityMs !== a.task._lastActivityMs) {
      return b.task._lastActivityMs - a.task._lastActivityMs;
    }
    const ai = stackOrder.get(a.stackTask.id) ?? 0;
    const bi = stackOrder.get(b.stackTask.id) ?? 0;
    return ai - bi;
  };
  activeEntries.sort(sortByActivity);
  queueEntries.sort(sortByActivity);

  const stripPrivate = ({ task }) => {
    const { _lastActivityMs, ...publicTask } = task;
    return publicTask;
  };

  const active = activeEntries.map(stripPrivate);
  const queue = queueEntries.map(stripPrivate);

  // Recent: loops resolved in the last 24h, newest first, capped.
  const recentCutoff = nowMs - RECENT_WINDOW_MS;
  const recent = allLoops
    .filter(l => {
      if (l.agentState !== 'complete' && l.agentState !== 'error') return false;
      if (!l.resolvedAt) return false;
      const t = new Date(l.resolvedAt).getTime();
      return Number.isFinite(t) && t >= recentCutoff;
    })
    .sort((a, b) => new Date(b.resolvedAt).getTime() - new Date(a.resolvedAt).getTime())
    .slice(0, RECENT_CAP);

  return {
    fetchedAt: new Date(nowMs).toISOString(),
    queue,
    active,
    recent
  };
}

/**
 * Produce a single Pipeline Task rollup for any issue in the workspace.
 *
 * Bypasses the leaf-primary filter so non-leaf parents can be inspected via
 * the detail overlay (LIN-249). Same rollup path as `buildPipelineSnapshot`
 * to guarantee field-for-field consistency.
 *
 * Throws a 404-style `Error` with `.status = 404` if the identifier is not
 * present in the workspace fetch.
 *
 * @param {string} urlKey
 * @param {string} identifier
 * @param {Object} [deps]    - same shape as `buildPipelineSnapshot`
 * @returns {Promise<Object>} single Task
 */
export async function getTaskForIssue(urlKey, identifier, deps = {}) {
  const {
    getWorkspaceAccessToken,
    dispatchStore,
    foremanStore,
    fetchProjects = defaultFetchProjects,
    getLoopsForWorkspace = defaultGetLoopsForWorkspace,
    now = Date.now()
  } = deps;

  if (!urlKey) {
    throw new Error('pipeline-state: urlKey is required');
  }
  if (!identifier) {
    throw new Error('pipeline-state: identifier is required');
  }
  if (typeof getWorkspaceAccessToken !== 'function') {
    throw new Error('pipeline-state: getWorkspaceAccessToken must be injected');
  }
  if (!dispatchStore || !foremanStore) {
    throw new Error('pipeline-state: dispatchStore and foremanStore must be injected');
  }

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

  const accessToken = await getWorkspaceAccessToken(urlKey);
  if (!accessToken) {
    throw new Error('pipeline-state: no access token available for workspace');
  }

  const [projectsResult, allLoops] = await Promise.all([
    fetchProjects(accessToken),
    getLoopsForWorkspace(urlKey, { dispatchStore, foremanStore })
  ]);

  const { issues = [] } = projectsResult || {};

  const issueByIdentifier = new Map();
  const issueById = new Map();
  for (const issue of issues) {
    if (issue.identifier) issueByIdentifier.set(issue.identifier, issue);
    if (issue.id) issueById.set(issue.id, issue);
  }

  const issue = issueByIdentifier.get(identifier);
  if (!issue) {
    const err = new Error(`pipeline-state: issue not found: ${identifier}`);
    err.status = 404;
    throw err;
  }

  const loopsForIssue = allLoops.filter(l => l.issueIdentifier === identifier);
  const task = rollupTask(issue, loopsForIssue, issueById, nowMs);
  // Strip private sort key; not part of the public Task contract.
  const { _lastActivityMs, ...publicTask } = task;
  return publicTask;
}

// ─── Internal exports for unit tests ─────────────────────────────────────────

export const __internal = {
  healthColor,
  walkParentChain,
  isLeaf,
  hasActiveLoop,
  hasRecentOwnLoop,
  rollupTask,
  _buildStack,
  RECENT_WINDOW_MS,
  RECENT_CAP
};
