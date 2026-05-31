/**
 * Roadmap Deterministic Layer
 *
 * Pure functions that compute velocity, execution order, milestones,
 * projected timelines, critical paths, and risk indicators from
 * Linear issue data. No LLM calls — all deterministic and testable.
 */

import { sortIssuesForSwipe, applyBlockingOrder } from './render-swipe.js';
import { isTerminalState } from './tree.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get ISO week key for a date (YYYY-WNN format).
 * @param {Date} date
 * @returns {string}
 */
function isoWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Take the first paragraph of a block of text and truncate it to a bound,
 * collapsing internal whitespace into single spaces so it renders on one line.
 * Returns null for empty input. Shared by the task-description (card) and
 * project-description (groupByProject) paths so both truncate identically.
 *
 * @param {string} text
 * @param {number} [max=200]
 * @returns {string|null}
 */
export function firstParaTruncated(text, max = 200) {
  if (!text) return null;
  const firstPara = (String(text).split(/\n\s*\n/)[0] || '').trim().replace(/\s+/g, ' ');
  if (!firstPara) return null;
  return firstPara.length > max ? firstPara.slice(0, max - 3) + '...' : firstPara;
}

/**
 * Convert a raw Linear issue to a roadmap card object.
 * @param {Object} issue - Raw Linear issue
 * @returns {Object} Card-like object for roadmap use
 */
export function issueToRoadmapCard(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier || '',
    title: issue.title || '',
    description: firstParaTruncated(issue.description),
    stateType: issue.state?.type || 'unstarted',
    stateName: issue.state?.name || '',
    priority: issue.priority || 0,
    estimate: issue.estimate || null,
    assignee: issue.assignee?.name || null,
    labels: (issue.labels?.nodes || []).map(l => l.name),
    projectName: issue.project?.name || null,
    projectId: issue.project?.id || null,
    dueDate: issue.dueDate || null,
    parentId: issue.parent?.id || null,
    blocksIds: (issue.relations?.nodes || [])
      .filter(r => r.type === 'blocks' && r.relatedIssue)
      .map(r => r.relatedIssue.id),
    createdAt: issue.createdAt || null,
    completedAt: issue.completedAt || null
  };
}

// =============================================================================
// Hierarchy helpers
// =============================================================================

/**
 * Build a hierarchy lookup from a flat array of roadmap cards.
 * Only considers relationships where both parent and child exist in the set.
 *
 * @param {Array} cards - Flat array of roadmap card objects (with parentId)
 * @returns {{ childrenOf: Map<string, string[]>, parentOf: Map<string, string>, isLeaf: (id: string) => boolean, isParent: (id: string) => boolean }}
 */
export function buildHierarchy(cards) {
  const ids = new Set(cards.map(c => c.id));
  const childrenOf = new Map();
  const parentOf = new Map();

  for (const card of cards) {
    if (card.parentId && ids.has(card.parentId)) {
      parentOf.set(card.id, card.parentId);
      if (!childrenOf.has(card.parentId)) childrenOf.set(card.parentId, []);
      childrenOf.get(card.parentId).push(card.id);
    }
  }

  return {
    childrenOf,
    parentOf,
    isLeaf: (id) => !childrenOf.has(id) || childrenOf.get(id).length === 0,
    isParent: (id) => childrenOf.has(id) && childrenOf.get(id).length > 0
  };
}

/**
 * Compute rollup stats for a parent card from its children.
 *
 * @param {Array} childCards - Array of child roadmap cards
 * @returns {{ subtaskTotal: number, subtaskDone: number, subtaskInProgress: number, subtaskRemaining: number, rollupEstimate: number }}
 */
export function computeParentRollup(childCards) {
  let subtaskDone = 0;
  let subtaskInProgress = 0;
  let subtaskRemaining = 0;
  let rollupEstimate = 0;

  for (const child of childCards) {
    if (child.stateType === 'completed') subtaskDone++;
    else if (child.stateType === 'started') subtaskInProgress++;
    else subtaskRemaining++;
    rollupEstimate += child.estimate || 0;
  }

  return {
    subtaskTotal: childCards.length,
    subtaskDone,
    subtaskInProgress,
    subtaskRemaining,
    rollupEstimate
  };
}

/**
 * Flatten a nested tasksInQueue array (parents with subtasks) into a flat list.
 * Includes both top-level tasks and their nested subtasks.
 *
 * @param {Array} tasks - Tasks array where parents may have a .subtasks array
 * @returns {Array} Flat array of all tasks
 */
export function flattenTasks(tasks) {
  const result = [];
  for (const task of tasks) {
    result.push(task);
    if (task.subtasks && task.subtasks.length > 0) {
      for (const sub of task.subtasks) {
        result.push(sub);
      }
    }
  }
  return result;
}

// =============================================================================
// calculateVelocity
// =============================================================================

/**
 * Calculate team velocity from completion history.
 *
 * @param {Array} issues - Raw Linear issues (all, including completed)
 * @param {number} daysBack - How many days of history to analyze
 * @param {Date} [now] - Reference date (defaults to current time)
 * @returns {{ tasksPerWeek: number, pointsPerWeek: number, trend: string, weeklyData: Array }}
 */
export function calculateVelocity(issues, daysBack, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - daysBack);

  // Filter to completed issues within the window
  const allCompleted = issues.filter(issue => {
    if (issue.state?.type !== 'completed') return false;
    if (!issue.completedAt) return false;
    const completedDate = new Date(issue.completedAt);
    return completedDate >= cutoff && completedDate <= now;
  });

  // Exclude parent tasks whose children are also in the set (avoid double-counting)
  const parentIds = new Set(issues.filter(i => i.parent?.id).map(i => i.parent.id));
  const completed = allCompleted.filter(issue => !parentIds.has(issue.id));

  if (completed.length === 0) {
    return { tasksPerWeek: 0, pointsPerWeek: 0, trend: 'stable', weeklyData: [] };
  }

  // Group by ISO week
  const weekMap = new Map();
  for (const issue of completed) {
    const key = isoWeekKey(new Date(issue.completedAt));
    if (!weekMap.has(key)) weekMap.set(key, { week: key, tasks: 0, points: 0 });
    const entry = weekMap.get(key);
    entry.tasks++;
    entry.points += issue.estimate || 0;
  }

  const weeklyData = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week));
  const numWeeks = weeklyData.length;

  const totalTasks = weeklyData.reduce((s, w) => s + w.tasks, 0);
  const totalPoints = weeklyData.reduce((s, w) => s + w.points, 0);

  const tasksPerWeek = Math.round((totalTasks / numWeeks) * 100) / 100;
  const pointsPerWeek = Math.round((totalPoints / numWeeks) * 100) / 100;

  // Trend detection: compare first half vs second half of weekly data
  let trend = 'stable';
  if (numWeeks >= 2) {
    const mid = Math.floor(numWeeks / 2);
    const firstHalf = weeklyData.slice(0, mid);
    const secondHalf = weeklyData.slice(mid);

    const avgFirst = firstHalf.reduce((s, w) => s + w.tasks, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, w) => s + w.tasks, 0) / secondHalf.length;

    const threshold = 0.3; // 30% change threshold
    const ratio = avgFirst > 0 ? (avgSecond - avgFirst) / avgFirst : (avgSecond > 0 ? 1 : 0);

    if (ratio > threshold) trend = 'increasing';
    else if (ratio < -threshold) trend = 'decreasing';
  }

  return { tasksPerWeek, pointsPerWeek, trend, weeklyData };
}

// =============================================================================
// buildExecutionQueue
// =============================================================================

/**
 * Build a canonical execution queue from raw issues.
 * Filters out completed/canceled, sorts by priority, applies blocking order.
 *
 * @param {Array} issues - Raw Linear issues
 * @returns {Array} Ordered array of card-like objects
 */
export function buildExecutionQueue(issues) {
  if (issues.length === 0) return [];

  // Convert to card format and filter out terminal-state issues (completed/canceled/duplicate).
  // Retain explicit British 'cancelled' check defensively (kept for parity with prior behavior).
  const cards = issues
    .map(issueToRoadmapCard)
    .filter(c => !isTerminalState(c.stateType) && c.stateType !== 'cancelled');

  if (cards.length === 0) return [];

  // Sort by priority (reuse swipe sort logic)
  sortIssuesForSwipe(cards);

  // Apply blocking order (topological sort)
  return applyBlockingOrder(cards);
}

// =============================================================================
// groupByProject (formerly groupByMilestone)
// =============================================================================

/**
 * Group execution queue items by project with subtask nesting.
 * Subtasks are nested under their parents; counts use leaf tasks only.
 *
 * @param {Array} queue - Execution queue from buildExecutionQueue
 * @param {Array} projects - Linear projects (with id, name, content)
 * @param {Array} [completedIssues] - Optional completed issues for progress tracking
 * @returns {Array} Project group objects with rollup stats
 */
export function groupByProject(queue, projects, completedIssues = []) {
  if (queue.length === 0 && completedIssues.length === 0) return [];

  // Group remaining tasks by project name
  const groups = new Map();

  for (const item of queue) {
    const name = item.projectName || 'Unassigned';
    if (!groups.has(name)) {
      groups.set(name, { remaining: [], completed: [] });
    }
    groups.get(name).remaining.push(item);
  }

  // Add completed issues to their groups
  for (const item of completedIssues) {
    const name = item.projectName || 'Unassigned';
    if (!groups.has(name)) {
      groups.set(name, { remaining: [], completed: [] });
    }
    groups.get(name).completed.push(item);
  }

  const projectGroups = [];

  for (const [name, group] of groups) {
    const remaining = group.remaining;
    const completed = group.completed;

    // Build hierarchy for remaining tasks
    const hierarchy = buildHierarchy(remaining);

    // Nest subtasks under parents
    const cardById = new Map(remaining.map(c => [c.id, c]));
    const nestedRemaining = [];
    for (const item of remaining) {
      if (hierarchy.parentOf.has(item.id)) continue; // skip children; they go under parent

      if (hierarchy.isParent(item.id)) {
        const childIds = hierarchy.childrenOf.get(item.id) || [];
        const childCards = childIds.map(id => cardById.get(id)).filter(Boolean);
        const rollup = computeParentRollup(childCards);
        nestedRemaining.push({ ...item, subtasks: childCards, rollup });
      } else {
        nestedRemaining.push({ ...item, subtasks: [], rollup: null });
      }
    }

    // Build hierarchy for completed tasks too
    const allCards = [...remaining, ...completed];
    const completedHierarchy = buildHierarchy(allCards);

    // Count only leaf tasks for accurate progress
    const leafRemaining = remaining.filter(c => completedHierarchy.isLeaf(c.id));
    const leafCompleted = completed.filter(c => completedHierarchy.isLeaf(c.id));

    const remainingTasks = leafRemaining.length;
    const completedTasks = leafCompleted.length;
    const totalTasks = remainingTasks + completedTasks;

    const remainingPoints = leafRemaining.reduce((s, i) => s + (i.estimate || 0), 0);
    const completedPoints = leafCompleted.reduce((s, i) => s + (i.estimate || 0), 0);
    const totalPoints = remainingPoints + completedPoints;

    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Find project metadata
    const project = projects.find(p => p.name === name);

    // Truncate project description to first paragraph or ~200 chars for prompt context
    const description = firstParaTruncated(project?.content);

    // Recently completed: last 25 by completedAt for narrative context.
    // The narrative is delivery-focused, so we surface a large window of
    // shipped work rather than a tight handful.
    const recentlyCompleted = [...completed]
      .filter(t => t.completedAt)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 25);

    projectGroups.push({
      name,
      projectId: project?.id || null,
      description,
      totalTasks,
      remainingTasks,
      completedTasks,
      totalPoints,
      remainingPoints,
      completedPoints,
      progressPercent,
      tasksInQueue: nestedRemaining,
      recentlyCompleted
    });
  }

  return projectGroups;
}

/** @deprecated Use groupByProject instead */
export const groupByMilestone = groupByProject;

// =============================================================================
// projectTimeline
// =============================================================================

/**
 * Project completion timelines for milestones based on velocity.
 *
 * @param {Array} milestones - Milestone objects from groupByMilestone
 * @param {Object} velocity - Velocity from calculateVelocity
 * @param {Date} [startDate] - Reference start date (defaults to now)
 * @returns {Array} Milestones augmented with timeline projections
 */
export function projectTimeline(milestones, velocity, startDate = new Date()) {
  return milestones.map(milestone => {
    const { remainingTasks, remainingPoints, tasksInQueue } = milestone;

    if (remainingTasks === 0) {
      return {
        ...milestone,
        projectedStart: startDate.toISOString(),
        projectedEnd: startDate.toISOString(),
        weeksRemaining: 0,
        confidenceLow: 0,
        confidenceHigh: 0
      };
    }

    // Determine whether to use points-based or count-based projection
    const estimatedCount = tasksInQueue.filter(t => t.estimate != null && t.estimate > 0).length;
    const usePoints = estimatedCount > tasksInQueue.length * 0.5;

    let weeksRemaining = null;
    let projectedEnd = null;

    if (usePoints && velocity.pointsPerWeek > 0) {
      weeksRemaining = Math.ceil(remainingPoints / velocity.pointsPerWeek);
    } else if (velocity.tasksPerWeek > 0) {
      weeksRemaining = Math.ceil(remainingTasks / velocity.tasksPerWeek);
    }

    if (weeksRemaining !== null) {
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + weeksRemaining * 7);
      projectedEnd = endDate.toISOString();
    }

    // Confidence range: wider for more remaining work
    // Uses a simple sqrt scaling — uncertainty grows with the square root of remaining weeks
    let confidenceLow = weeksRemaining;
    let confidenceHigh = weeksRemaining;

    if (weeksRemaining !== null && weeksRemaining > 0) {
      const uncertainty = Math.ceil(Math.sqrt(weeksRemaining));
      confidenceLow = Math.max(1, weeksRemaining - uncertainty);
      confidenceHigh = weeksRemaining + uncertainty;
    }

    return {
      ...milestone,
      projectedStart: startDate.toISOString(),
      projectedEnd,
      weeksRemaining,
      confidenceLow,
      confidenceHigh
    };
  });
}

// =============================================================================
// findCriticalPaths
// =============================================================================

/**
 * Find the critical path (longest dependency chain) for each project.
 *
 * @param {Array} queue - Execution queue with blocksIds
 * @returns {Map<string, { path: string[], length: number, blockers: string[] }>}
 */
export function findCriticalPaths(queue) {
  const result = new Map();

  // Build a global dependency graph
  const issueById = new Map(queue.map(i => [i.id, i]));

  // adjacency: blocker → blocked
  const adj = new Map();
  const reverseAdj = new Map(); // blocked → blockers
  for (const issue of queue) {
    if (!adj.has(issue.id)) adj.set(issue.id, []);
    if (!reverseAdj.has(issue.id)) reverseAdj.set(issue.id, []);
  }

  for (const issue of queue) {
    for (const blockedId of issue.blocksIds || []) {
      if (issueById.has(blockedId)) {
        adj.get(issue.id).push(blockedId);
        if (!reverseAdj.has(blockedId)) reverseAdj.set(blockedId, []);
        reverseAdj.get(blockedId).push(issue.id);
      }
    }
  }

  // Compute longest path from each node using DFS with memoization
  // longestFrom[id] = { length, path }
  const memo = new Map();
  const visiting = new Set(); // cycle detection

  function longestFrom(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return { length: 1, path: [id] }; // cycle fallback

    visiting.add(id);

    let best = { length: 1, path: [id] };
    for (const nextId of adj.get(id) || []) {
      const sub = longestFrom(nextId);
      if (sub.length + 1 > best.length) {
        best = { length: sub.length + 1, path: [id, ...sub.path] };
      }
    }

    visiting.delete(id);
    memo.set(id, best);
    return best;
  }

  // Find longest path per project
  const projectPaths = new Map();

  for (const issue of queue) {
    const project = issue.projectName || 'Unassigned';
    const { length, path } = longestFrom(issue.id);

    if (!projectPaths.has(project) || length > projectPaths.get(project).length) {
      projectPaths.set(project, { length, path });
    }
  }

  // Build result with blockers
  for (const [project, { length, path }] of projectPaths) {
    // Blockers are nodes in the path that have dependents waiting on them
    const blockers = path.filter(id => (adj.get(id) || []).length > 0);

    if (length <= 1) {
      // No meaningful chain
      result.set(project, { path: [], length: 0, blockers: [] });
    } else {
      result.set(project, { path, length, blockers });
    }
  }

  return result;
}

// =============================================================================
// assessRisks
// =============================================================================

/**
 * Identify risks in the roadmap.
 *
 * @param {Array} milestones - Milestones with timeline projections
 * @param {Map} criticalPaths - Critical paths per project
 * @param {Object} velocity - Velocity data
 * @returns {Array<{ type: string, severity: string, description: string, milestone: string, issues: string[] }>}
 */
export function assessRisks(milestones, criticalPaths, velocity) {
  const risks = [];

  // Check velocity trend
  if (velocity.trend === 'decreasing') {
    risks.push({
      type: 'velocity-declining',
      severity: 'medium',
      description: 'Team velocity is declining. Projections may be optimistic.',
      milestone: null,
      issues: []
    });
  }

  // Detect solo-dev pattern: if >=80% of all tasks across milestones are
  // unassigned, "no assignee" is the norm, not a risk worth flagging.
  const allTasks = milestones.flatMap(m => m.tasksInQueue || []);
  const totalCount = allTasks.length;
  const unassignedCount = allTasks.filter(t => !t.assignee).length;
  const soloDevPattern = totalCount > 0 && (unassignedCount / totalCount) >= 0.8;

  for (const milestone of milestones) {
    const cp = criticalPaths.get(milestone.name);
    if (!cp) continue;

    const criticalIds = new Set(cp.path);
    const taskMap = new Map(milestone.tasksInQueue.map(t => [t.id, t]));

    // Unassigned tasks on critical path — suppress for solo-dev teams
    if (!soloDevPattern) {
      const unassigned = cp.path.filter(id => {
        const task = taskMap.get(id);
        return task && !task.assignee;
      });

      if (unassigned.length > 0) {
        risks.push({
          type: 'unassigned-critical',
          severity: 'high',
          description: `${unassigned.length} critical-path task(s) have no assignee.`,
          milestone: milestone.name,
          issues: unassigned
        });
      }
    }

    // Unestimated tasks on critical path
    const unestimated = cp.path.filter(id => {
      const task = taskMap.get(id);
      return task && (task.estimate == null || task.estimate === 0);
    });

    if (unestimated.length > 0) {
      risks.push({
        type: 'unestimated-critical',
        severity: 'medium',
        description: `${unestimated.length} critical-path task(s) have no estimate.`,
        milestone: milestone.name,
        issues: unestimated
      });
    }

    // Overdue: projected end after milestone due date
    if (milestone.projectedEnd && milestone.dueDate) {
      const projected = new Date(milestone.projectedEnd);
      const due = new Date(milestone.dueDate);
      if (projected > due) {
        risks.push({
          type: 'overdue',
          severity: 'high',
          description: `Projected completion (${milestone.projectedEnd.split('T')[0]}) exceeds due date (${milestone.dueDate}).`,
          milestone: milestone.name,
          issues: []
        });
      }
    }
  }

  return risks;
}

// =============================================================================
// analyzeRoadmap — deterministic pre-analysis for narrative generation
// =============================================================================

/**
 * Compute a structured analysis from roadmap data. This runs before the
 * narrative LLM call so the model gets grounded facts, not guesswork.
 *
 * @param {Object} opts
 * @param {Array}  opts.milestones - Milestones with tasksInQueue and recentlyCompleted
 * @param {Object} opts.velocity - Velocity object with weeklyData
 * @param {Object|Map} opts.criticalPaths - Critical paths keyed by project name
 * @param {Date}   [opts.now] - Reference date (defaults to current time)
 * @returns {Object} Structured analysis
 */
export function analyzeRoadmap({ milestones, velocity, criticalPaths, now = new Date() }) {
  const analysis = {};

  // ── Cycle time from completed tasks ──────────────────────────────
  const allCompleted = milestones.flatMap(m => m.recentlyCompleted || []);
  const cycleTimes = allCompleted
    .filter(t => t.createdAt && t.completedAt)
    .map(t => {
      const days = (new Date(t.completedAt) - new Date(t.createdAt)) / (1000 * 60 * 60 * 24);
      return { title: t.title, days: Math.round(days * 10) / 10 };
    });

  if (cycleTimes.length > 0) {
    const sorted = cycleTimes.map(c => c.days).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg = Math.round((sorted.reduce((s, d) => s + d, 0) / sorted.length) * 10) / 10;
    analysis.cycleTime = { medianDays: median, avgDays: avg, sampleSize: sorted.length };
  }

  // ── Stale in-progress tasks (older than 2× median cycle time) ───
  const medianCycle = analysis.cycleTime?.medianDays ?? 14;
  const staleThreshold = medianCycle * 2;
  const staleTasks = [];
  for (const m of milestones) {
    for (const t of flattenTasks(m.tasksInQueue || [])) {
      if (t.stateType !== 'started' || !t.createdAt) continue;
      const age = (now - new Date(t.createdAt)) / (1000 * 60 * 60 * 24);
      if (age > staleThreshold) {
        staleTasks.push({ title: t.title, ageDays: Math.round(age), milestone: m.name });
      }
    }
  }
  if (staleTasks.length > 0) {
    analysis.staleTasks = staleTasks;
  }

  // ── Velocity shift: last 2 weeks vs prior 2 weeks ──────────────
  const weekly = (velocity.weeklyData || []).slice().sort((a, b) => a.week.localeCompare(b.week));
  if (weekly.length >= 4) {
    const recent2 = weekly.slice(-2);
    const prior2 = weekly.slice(-4, -2);
    const recentAvg = (recent2[0].tasks + recent2[1].tasks) / 2;
    const priorAvg = (prior2[0].tasks + prior2[1].tasks) / 2;
    if (priorAvg > 0) {
      const pctChange = Math.round(((recentAvg - priorAvg) / priorAvg) * 100);
      analysis.velocityShift = {
        recentAvg: Math.round(recentAvg * 10) / 10,
        priorAvg: Math.round(priorAvg * 10) / 10,
        pctChange
      };
    }
  }

  // ── T-shirt sizing: estimate unestimated tasks from completed history ──
  const allTasks = milestones.flatMap(m => flattenTasks(m.tasksInQueue || []));
  const unestimated = allTasks.filter(t => t.estimate == null || t.estimate === 0);
  const estimated = allTasks.filter(t => t.estimate != null && t.estimate > 0);

  if (unestimated.length > 0 && allCompleted.length > 0) {
    // Build size distribution from completed tasks that had estimates
    const completedWithEstimates = allCompleted.filter(t => t.estimate != null && t.estimate > 0);
    if (completedWithEstimates.length > 0) {
      const sizes = { small: 0, medium: 0, large: 0 };
      for (const t of completedWithEstimates) {
        if (t.estimate <= 1) sizes.small++;
        else if (t.estimate <= 3) sizes.medium++;
        else sizes.large++;
      }
      const total = completedWithEstimates.length;
      // Apply same distribution to unestimated tasks
      const inferredSmall = Math.round(unestimated.length * (sizes.small / total));
      const inferredLarge = Math.round(unestimated.length * (sizes.large / total));
      const inferredMedium = unestimated.length - inferredSmall - inferredLarge;
      analysis.tshirtSizing = {
        unestimatedCount: unestimated.length,
        totalRemaining: allTasks.length,
        estimatedCount: estimated.length,
        inferredDistribution: { small: inferredSmall, medium: inferredMedium, large: inferredLarge },
        basedOnSample: total
      };
    } else {
      analysis.tshirtSizing = {
        unestimatedCount: unestimated.length,
        totalRemaining: allTasks.length,
        estimatedCount: estimated.length,
        inferredDistribution: null,
        basedOnSample: 0
      };
    }
  }

  // ── Blockers: tasks on critical paths that block other work ─────
  const pathEntries = criticalPaths instanceof Map
    ? [...criticalPaths.entries()]
    : Object.entries(criticalPaths || {});
  const blockingTasks = [];
  const allFlatTasks = milestones.flatMap(m => flattenTasks(m.tasksInQueue || []));
  const taskMap = new Map(allFlatTasks.map(t => [t.id, t]));
  for (const [project, cp] of pathEntries) {
    if (!cp.path || cp.path.length < 2) continue;
    // First item in critical path is the bottleneck
    const bottleneck = taskMap.get(cp.path[0]);
    if (bottleneck) {
      blockingTasks.push({
        title: bottleneck.title,
        milestone: project,
        blocksCount: cp.path.length - 1,
        hasDescription: !!(bottleneck.description),
        stateType: bottleneck.stateType
      });
    }
  }
  if (blockingTasks.length > 0) {
    analysis.blockers = blockingTasks;
  }

  return analysis;
}
