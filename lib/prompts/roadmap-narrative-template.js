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
// Risk types that are derived from forward-looking projections.
// The narrative is delivery-focused, so these are filtered out of the
// LLM summary even though they may still appear on the rendered page.
const PROJECTION_RISK_TYPES = new Set([
  'velocity-declining',
  'overdue',
  'unestimated-critical'
]);

export function summarizeRoadmapModel(model) {
  const lines = [];
  const now = new Date().toISOString().split('T')[0];
  lines.push(`Report date: ${now}`);

  // Delivery cadence — past-only tasks/week, no points (estimates excluded),
  // no projection or trend framing.
  const v = model.velocity || {};
  lines.push('');
  lines.push('DELIVERY CADENCE');
  lines.push(`  Tasks shipped per week (90-day avg): ${v.tasksPerWeek ?? 0}`);

  // Projects — current state only. No projected weeks, no projected end,
  // no upcoming-task lists.
  const projects = model.milestones || [];
  if (projects.length > 0) {
    lines.push('');
    lines.push('PROJECTS');
    for (const m of projects) {
      const name = m.name || 'Untitled';
      const pct = m.progressPercent ?? 0;
      const remaining = m.remainingTasks ?? 0;
      const total = m.totalTasks ?? 0;

      lines.push(`  ${name}:`);
      if (m.description) {
        lines.push(`    Description: ${m.description}`);
      }
      lines.push(`    Progress: ${pct}% (${total - remaining}/${total} tasks done, ${remaining} remaining)`);

      // Recently completed tasks (the heart of the delivery narrative)
      const recent = m.recentlyCompleted || [];
      if (recent.length > 0) {
        lines.push('    Recently completed:');
        for (const t of recent) {
          const when = t.completedAt ? t.completedAt.split('T')[0] : '';
          const state = t.stateName ? ` [${t.stateName}]` : '';
          lines.push(`      - ${t.title}${state}${when ? ` (${when})` : ''}`);
        }
      }

      // In-progress tasks (present state) — with subtask hierarchy
      const inProgress = (m.tasksInQueue || []).filter(t =>
        t.stateType === 'started' || (t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
      );
      if (inProgress.length > 0) {
        lines.push('    In progress:');
        for (const t of inProgress) {
          renderTaskLine(lines, t, '      ');
        }
      }
    }
  }

  // Critical paths — current dependency state, used for blocker discussion
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

  // Signals — current-state observations only. Projection-derived risks
  // (overdue, velocity-declining, unestimated-critical) and estimate-based
  // analysis (t-shirt sizing, velocity shift) are excluded.
  const risks = (model.risks || []).filter(r => !PROJECTION_RISK_TYPES.has(r.type));
  const a = model.analysis || {};
  const signalLines = [];

  for (const r of risks) {
    const milestone = r.milestone ? ` [${r.milestone}]` : '';
    signalLines.push(`  [${r.severity}]${milestone} ${r.description}`);
  }

  // Cycle time baseline — past-only delivery measurement
  if (a.cycleTime) {
    signalLines.push(`  Median cycle time: ${a.cycleTime.medianDays} days (avg ${a.cycleTime.avgDays}, sample: ${a.cycleTime.sampleSize} tasks)`);
  }

  // Stale in-progress tasks — current state
  if (a.staleTasks && a.staleTasks.length > 0) {
    signalLines.push('  Stale in-progress (>2x median cycle time):');
    for (const t of a.staleTasks) {
      signalLines.push(`    - "${t.title}" [${t.milestone}] — ${t.ageDays} days old`);
    }
  }

  // Blocking bottlenecks — current state
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

  const system = `You are a technical program manager writing a delivery-focused roadmap narrative from structured data. The narrative tells the reader what has been delivered and where the work stands right now — not what will happen next.

OUTPUT: Plain text paragraphs. No markdown. The output renders in a monospace terminal interface, so use line breaks for structure.

RULES:
- Use ONLY the data provided. Do not invent dates, numbers, or status.
- Use the original task and project names from the data on first mention. After a task or project has been introduced by its full name, you may refer to it by a short, recognizable short-form (e.g. its first few distinctive words) so the prose does not read like a list of database keys. Do not invent new names, and never alter identifiers like LIN-123.
- Tasks may have subtasks shown as indented trees. Use the subtask rollup (e.g. "3/5 subtasks done") to describe progress on parent tasks rather than listing every subtask individually.
- Do NOT include projections, forecasts, weeks-remaining estimates, confidence ranges, completion-date predictions, or "X% complete suggests Y" reasoning. Do NOT discuss estimates or story points. Do NOT speculate about when remaining work will finish.
- Missing assignees are normal for small teams. Only mention them if flagged in SIGNALS.
- Do not editorialize. No "strong," "good," "impressive," "concerning," "exciting," "unfortunately." State facts and let the reader draw conclusions.

REASONING:
Before writing the narrative, output a REASONING section where you work through the data:
- What was delivered recently? Are there patterns in cadence or project focus?
- Which tasks are in progress now? Are any stale, blocked, or unassigned?
- Are any SIGNALS redundant or contradictory?

Then write the narrative below it, separated by a blank line.

NARRATIVE STRUCTURE — include only sections that have data:

What shipped recently: The core of the narrative. Walk through recently completed work by project, with completion dates. When there are many items, group by recency (this week, last week, earlier in the period) or by project theme. Use the original task titles.

Where we are now: Current in-progress work, by project. For tasks with subtasks, summarize subtask progress. Flag any stale tasks from SIGNALS with their age and what they block.

Open risks: Surface anything from SIGNALS not already covered above (unassigned critical tasks, stale work, bottlenecks). Name specific tasks. Skip if no signals remain.

TONE: Direct, factual, concise. Be proportional — write more when there is more data, less when there is less. The reader wants to know what was done and what is happening now.`;

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
