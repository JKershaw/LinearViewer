/**
 * Roadmap Deterministic Layer
 *
 * Pure functions that compute velocity, execution order, milestones,
 * projected timelines, critical paths, and risk indicators from
 * Linear issue data. No LLM calls — all deterministic and testable.
 */

import { sortIssuesForSwipe, applyBlockingOrder } from './render-swipe.js';

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
 * Convert a raw Linear issue to a roadmap card object.
 * @param {Object} issue - Raw Linear issue
 * @returns {Object} Card-like object for roadmap use
 */
export function issueToRoadmapCard(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier || '',
    title: issue.title || '',
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
  const completed = issues.filter(issue => {
    if (issue.state?.type !== 'completed') return false;
    if (!issue.completedAt) return false;
    const completedDate = new Date(issue.completedAt);
    return completedDate >= cutoff && completedDate <= now;
  });

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

  // Convert to card format and filter out completed/canceled
  const cards = issues
    .map(issueToRoadmapCard)
    .filter(c => c.stateType !== 'completed' && c.stateType !== 'canceled' && c.stateType !== 'cancelled');

  if (cards.length === 0) return [];

  // Sort by priority (reuse swipe sort logic)
  sortIssuesForSwipe(cards);

  // Apply blocking order (topological sort)
  return applyBlockingOrder(cards);
}

// =============================================================================
// groupByMilestone
// =============================================================================

/**
 * Group execution queue items by project (milestone).
 *
 * @param {Array} queue - Execution queue from buildExecutionQueue
 * @param {Array} projects - Linear projects
 * @param {Array} [completedIssues] - Optional completed issues for progress tracking
 * @returns {Array} Milestone objects with rollup stats
 */
export function groupByMilestone(queue, projects, completedIssues = []) {
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

  const milestones = [];

  for (const [name, group] of groups) {
    const remaining = group.remaining;
    const completed = group.completed;

    const remainingTasks = remaining.length;
    const completedTasks = completed.length;
    const totalTasks = remainingTasks + completedTasks;

    const remainingPoints = remaining.reduce((s, i) => s + (i.estimate || 0), 0);
    const completedPoints = completed.reduce((s, i) => s + (i.estimate || 0), 0);
    const totalPoints = remainingPoints + completedPoints;

    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Find project ID
    const project = projects.find(p => p.name === name);

    milestones.push({
      name,
      projectId: project?.id || null,
      totalTasks,
      remainingTasks,
      completedTasks,
      totalPoints,
      remainingPoints,
      completedPoints,
      progressPercent,
      tasksInQueue: remaining
    });
  }

  return milestones;
}

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

  for (const milestone of milestones) {
    const cp = criticalPaths.get(milestone.name);
    if (!cp) continue;

    const criticalIds = new Set(cp.path);
    const taskMap = new Map(milestone.tasksInQueue.map(t => [t.id, t]));

    // Unassigned tasks on critical path
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
