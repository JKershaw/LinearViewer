/**
 * Roadmap narrative prompt template.
 *
 * Instructs the LLM to produce a stakeholder-friendly roadmap narrative
 * from the deterministic roadmap model. The model is summarized into a
 * compact text representation to minimize token usage. Output is plain
 * text (no markdown) since the client renders in a pre-wrap container.
 */

/**
 * Render a task (with optional subtasks) into the summary lines.
 * Parents show rollup stats; subtasks are indented with box-drawing characters.
 */
function renderTaskLine(lines, task, indent) {
  const subs = task.subtasks || [];
  if (subs.length > 0) {
    const r = task.rollup || {};
    lines.push(`${indent}- ${task.title} (${r.subtaskDone || 0}/${r.subtaskTotal || subs.length} subtasks done)`);
    for (let i = 0; i < subs.length; i++) {
      const prefix = i < subs.length - 1 ? '├─' : '└─';
      const status = subs[i].stateType === 'completed' ? 'done'
        : subs[i].stateType === 'started' ? 'in progress'
        : 'todo';
      lines.push(`${indent}  ${prefix} ${subs[i].title} [${status}]`);
    }
  } else {
    lines.push(`${indent}- ${task.title}`);
  }
}

/**
 * Summarize a roadmap model into a compact text block for the prompt.
 * Strips executionQueue and raw IDs to save tokens.
 *
 * @param {Object} model - Roadmap model from the deterministic layer
 * @param {Object} model.velocity - { tasksPerWeek, pointsPerWeek, trend, weeklyData }
 * @param {Array}  model.milestones - Milestones with timeline projections
 * @param {Object} model.criticalPaths - Critical paths keyed by project name
 * @param {Array}  model.risks - Risk objects with type, severity, description, milestone
 * @returns {string} Human-readable summary
 */
export function summarizeRoadmapModel(model) {
  const lines = [];
  const now = new Date().toISOString().split('T')[0];
  lines.push(`Report date: ${now}`);

  // Velocity — omit points when not meaningfully used
  const v = model.velocity || {};
  const hasPoints = (v.pointsPerWeek ?? 0) > 0;
  lines.push('');
  lines.push('VELOCITY');
  lines.push(`  Tasks/week: ${v.tasksPerWeek ?? 0}`);
  if (hasPoints) {
    lines.push(`  Points/week: ${v.pointsPerWeek}`);
  }
  lines.push(`  Trend: ${v.trend || 'stable'}`);

  // Projects
  const projects = model.milestones || [];
  if (projects.length > 0) {
    lines.push('');
    lines.push('PROJECTS');
    for (const m of projects) {
      const name = m.name || 'Untitled';
      const pct = m.progressPercent ?? 0;
      const remaining = m.remainingTasks ?? 0;
      const total = m.totalTasks ?? 0;
      const points = m.remainingPoints ?? 0;
      const weeks = m.weeksRemaining;
      const low = m.confidenceLow;
      const high = m.confidenceHigh;

      lines.push(`  ${name}:`);
      if (m.description) {
        lines.push(`    Description: ${m.description}`);
      }
      lines.push(`    Progress: ${pct}% (${total - remaining}/${total} tasks done)`);
      lines.push(`    Remaining: ${remaining} tasks${hasPoints ? `, ${points} points` : ''}`);
      if (weeks !== null && weeks !== undefined) {
        lines.push(`    Projected: ~${weeks} weeks (confidence: ${low}-${high} weeks)`);
      } else {
        lines.push('    Projected: insufficient velocity data');
      }
      if (m.projectedEnd) {
        lines.push(`    Projected end: ${m.projectedEnd.split('T')[0]}`);
      }

      // Recently completed tasks (past narrative)
      const recent = m.recentlyCompleted || [];
      if (recent.length > 0) {
        lines.push('    Recently completed:');
        for (const t of recent) {
          const when = t.completedAt ? t.completedAt.split('T')[0] : '';
          lines.push(`      - ${t.title}${when ? ` (${when})` : ''}`);
        }
      }

      // In-progress tasks (present narrative) — with subtask hierarchy
      const inProgress = (m.tasksInQueue || []).filter(t =>
        t.stateType === 'started' || (t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
      );
      if (inProgress.length > 0) {
        lines.push('    In progress:');
        for (const t of inProgress) {
          renderTaskLine(lines, t, '      ');
        }
      }

      // Upcoming tasks (future narrative) — next few unstarted items
      const upcoming = (m.tasksInQueue || []).filter(t =>
        t.stateType !== 'started' && !(t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
      ).slice(0, 3);
      if (upcoming.length > 0) {
        lines.push('    Up next:');
        for (const t of upcoming) {
          renderTaskLine(lines, t, '      ');
        }
      }
    }
  }

  // Critical paths
  const paths = model.criticalPaths || {};
  const pathEntries = paths instanceof Map ? [...paths.entries()] : Object.entries(paths);
  const meaningfulPaths = pathEntries.filter(([, v]) => v.length > 1);
  if (meaningfulPaths.length > 0) {
    lines.push('');
    lines.push('CRITICAL PATHS (longest dependency chains)');
    for (const [project, cp] of meaningfulPaths) {
      lines.push(`  ${project}: ${cp.length} tasks deep, ${cp.blockers?.length || 0} blockers`);
    }
  }

  // Signals — merged risks and pre-computed analysis into one section
  const risks = model.risks || [];
  const a = model.analysis || {};
  const signalLines = [];

  // Risks (auto-detected from model)
  for (const r of risks) {
    const milestone = r.milestone ? ` [${r.milestone}]` : '';
    signalLines.push(`  [${r.severity}]${milestone} ${r.description}`);
  }

  // Cycle time baseline
  if (a.cycleTime) {
    signalLines.push(`  Median cycle time: ${a.cycleTime.medianDays} days (avg ${a.cycleTime.avgDays}, sample: ${a.cycleTime.sampleSize} tasks)`);
  }

  // Velocity shift
  if (a.velocityShift) {
    const dir = a.velocityShift.pctChange >= 0 ? '+' : '';
    signalLines.push(`  Velocity shift (last 2 wks vs prior 2): ${a.velocityShift.recentAvg} vs ${a.velocityShift.priorAvg} tasks/wk (${dir}${a.velocityShift.pctChange}%)`);
  }

  // Estimation gap
  if (a.tshirtSizing) {
    const ts = a.tshirtSizing;
    if (ts.inferredDistribution) {
      const d = ts.inferredDistribution;
      signalLines.push(`  Estimation gap: ${ts.unestimatedCount} of ${ts.totalRemaining} tasks unestimated. Based on ${ts.basedOnSample} completed tasks, inferred split: ~${d.small} small, ~${d.medium} medium, ~${d.large} large.`);
    } else {
      signalLines.push(`  Estimation gap: ${ts.unestimatedCount} of ${ts.totalRemaining} tasks unestimated. No completed estimates to infer from.`);
    }
  }

  // Stale in-progress tasks
  if (a.staleTasks && a.staleTasks.length > 0) {
    signalLines.push('  Stale in-progress (>2x median cycle time):');
    for (const t of a.staleTasks) {
      signalLines.push(`    - "${t.title}" [${t.milestone}] — ${t.ageDays} days old`);
    }
  }

  // Blocking bottlenecks
  if (a.blockers && a.blockers.length > 0) {
    signalLines.push('  Critical bottlenecks:');
    for (const b of a.blockers) {
      const status = b.stateType === 'started' ? 'in progress' : 'not started';
      signalLines.push(`    - "${b.title}" [${b.milestone}] — blocks ${b.blocksCount} task(s), ${status}`);
    }
  }

  if (signalLines.length > 0) {
    lines.push('');
    lines.push('SIGNALS');
    lines.push(...signalLines);
  }

  return lines.join('\n');
}

/**
 * Build messages array for generating a roadmap narrative.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model
 * @param {Object} roadmapModel.velocity - { tasksPerWeek, pointsPerWeek, trend }
 * @param {Array}  roadmapModel.milestones - Milestones with timeline projections
 * @param {Object} roadmapModel.criticalPaths - Critical paths keyed by project name
 * @param {Array}  roadmapModel.risks - Risk objects
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapNarrativeMessages(roadmapModel) {
  const summary = summarizeRoadmapModel(roadmapModel);

  const system = `You are a technical program manager writing a roadmap narrative from structured data.

OUTPUT: Plain text paragraphs. No markdown. The output renders in a monospace terminal interface, so use line breaks for structure.

RULES:
- Use ONLY the data provided. Do not invent dates, numbers, or status.
- Use the original task and project names from the data. Do not rename them.
- Tasks may have subtasks shown as indented trees. Use the subtask rollup (e.g. "3/5 subtasks done") to describe progress on parent tasks rather than listing every subtask individually.
- Missing assignees or estimates are normal for small teams. Only mention them if flagged in SIGNALS.
- Do not editorialize. No "strong," "good," "impressive," "concerning," "exciting," "unfortunately." State facts and let the reader draw conclusions.

REASONING:
Before writing the narrative, output a REASONING section where you work through the data:
- What do cycle times and velocity shifts reveal?
- Which stale tasks or blockers matter and why?
- What does the estimation gap mean for timeline confidence?
- Are any SIGNALS redundant or contradictory?

Then write the narrative below it, separated by a blank line.

NARRATIVE STRUCTURE — include only sections that have data:

What shipped: List recently completed items with dates. Skip if none.

Current focus: What is in progress. For tasks with subtasks, summarize subtask progress. Flag any stale tasks from SIGNALS with their age and what they block.

What is next: Upcoming work and project projections with confidence ranges. Incorporate estimation gap data if present.

Risks: Surface anything from SIGNALS not already covered above. Name specific tasks. Skip if no signals remain.

TONE: Direct, factual, concise. Be proportional — write more when there is more data, less when there is less.`;

  const user = `Here is the current roadmap data:\n\n${summary}\n\nWrite the roadmap narrative.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapNarrativePrompt(roadmapModel) {
  const messages = buildRoadmapNarrativeMessages(roadmapModel);
  return messages.map(m => m.content).join('\n\n');
}
