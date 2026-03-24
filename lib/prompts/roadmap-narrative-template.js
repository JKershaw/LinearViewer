/**
 * Roadmap narrative prompt template.
 *
 * Instructs the LLM to produce a stakeholder-friendly roadmap narrative
 * from the deterministic roadmap model. The model is summarized into a
 * compact text representation to minimize token usage. Output is plain
 * text (no markdown) since the client renders in a pre-wrap container.
 */

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

  // Velocity
  const v = model.velocity || {};
  lines.push('');
  lines.push('VELOCITY');
  lines.push(`  Tasks/week: ${v.tasksPerWeek ?? 0}`);
  lines.push(`  Points/week: ${v.pointsPerWeek ?? 0}`);
  lines.push(`  Trend: ${v.trend || 'stable'}`);

  // Milestones
  const milestones = model.milestones || [];
  if (milestones.length > 0) {
    lines.push('');
    lines.push('MILESTONES');
    for (const m of milestones) {
      const name = m.name || 'Untitled';
      const pct = m.progressPercent ?? 0;
      const remaining = m.remainingTasks ?? 0;
      const total = m.totalTasks ?? 0;
      const points = m.remainingPoints ?? 0;
      const weeks = m.weeksRemaining;
      const low = m.confidenceLow;
      const high = m.confidenceHigh;

      lines.push(`  ${name}:`);
      lines.push(`    Progress: ${pct}% (${total - remaining}/${total} tasks done)`);
      lines.push(`    Remaining: ${remaining} tasks, ${points} points`);
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

      // In-progress tasks (present narrative)
      const inProgress = (m.tasksInQueue || []).filter(t => t.stateType === 'started');
      if (inProgress.length > 0) {
        lines.push('    In progress:');
        for (const t of inProgress) {
          lines.push(`      - ${t.title}`);
        }
      }

      // Upcoming tasks (future narrative) — next few unstarted items
      const upcoming = (m.tasksInQueue || []).filter(t => t.stateType !== 'started').slice(0, 3);
      if (upcoming.length > 0) {
        lines.push('    Up next:');
        for (const t of upcoming) {
          lines.push(`      - ${t.title}`);
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

  // Risks
  const risks = model.risks || [];
  if (risks.length > 0) {
    lines.push('');
    lines.push('RISKS');
    for (const r of risks) {
      const milestone = r.milestone ? ` [${r.milestone}]` : '';
      lines.push(`  [${r.severity}]${milestone} ${r.description}`);
    }
  }

  // Pre-computed analysis (deterministic, not LLM-generated)
  const a = model.analysis || {};
  const analysisLines = [];

  if (a.cycleTime) {
    analysisLines.push(`  Median cycle time: ${a.cycleTime.medianDays} days (avg ${a.cycleTime.avgDays}, sample: ${a.cycleTime.sampleSize} tasks)`);
  }

  if (a.velocityShift) {
    const dir = a.velocityShift.pctChange >= 0 ? '+' : '';
    analysisLines.push(`  Velocity shift (last 2 wks vs prior 2): ${a.velocityShift.recentAvg} vs ${a.velocityShift.priorAvg} tasks/wk (${dir}${a.velocityShift.pctChange}%)`);
  }

  if (a.tshirtSizing) {
    const ts = a.tshirtSizing;
    if (ts.inferredDistribution) {
      const d = ts.inferredDistribution;
      analysisLines.push(`  Estimation gap: ${ts.unestimatedCount} of ${ts.totalRemaining} tasks unestimated. Based on ${ts.basedOnSample} completed tasks, inferred split: ~${d.small} small, ~${d.medium} medium, ~${d.large} large.`);
    } else {
      analysisLines.push(`  Estimation gap: ${ts.unestimatedCount} of ${ts.totalRemaining} tasks unestimated. No completed estimates to infer from.`);
    }
  }

  if (a.staleTasks && a.staleTasks.length > 0) {
    analysisLines.push('  Stale in-progress (>2x median cycle time):');
    for (const t of a.staleTasks) {
      analysisLines.push(`    - "${t.title}" [${t.milestone}] — ${t.ageDays} days old`);
    }
  }

  if (a.blockers && a.blockers.length > 0) {
    analysisLines.push('  Critical bottlenecks:');
    for (const b of a.blockers) {
      const status = b.stateType === 'started' ? 'in progress' : 'not started';
      analysisLines.push(`    - "${b.title}" [${b.milestone}] — blocks ${b.blocksCount} task(s), ${status}`);
    }
  }

  if (analysisLines.length > 0) {
    lines.push('');
    lines.push('ANALYSIS (pre-computed from data)');
    lines.push(...analysisLines);
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

  const system = `You are a technical program manager writing a stakeholder-facing roadmap narrative. You translate engineering task data into clear, grounded prose.

OUTPUT FORMAT: Plain text only. Do NOT use markdown (no **, no ##, no - bullets). Use line breaks and indentation for structure. The output is displayed in a monospace terminal-style interface.

RULES:
- Use ONLY the data provided below. Do not invent dates, numbers, or status values.
- Do not speculate about items not in the data.
- Translate internal task names into client-facing deliverable language.
- Do NOT fixate on missing assignees or estimates unless they represent a genuine bottleneck. For small teams, unassigned tasks are normal.

NO-SPIN DIRECTIVE:
State velocity trends and completion data without characterizing them as "strong," "good," "impressive," or "concerning." Let the numbers speak. Do not use words like "exciting," "great progress," or "unfortunately." Report what happened, what it means for timelines, and stop.

TWO-STEP PROCESS:
First, silently reason about the data: What do the cycle times and velocity shifts reveal? Which stale tasks or blockers actually matter? What does the estimation gap mean for timeline confidence? Then write the narrative from that reasoning. Do NOT output the reasoning step — only the final narrative.

STRUCTURE — separate facts from interpretation:

1. What shipped (facts): List recent accomplishments from "Recently completed" items. State what was delivered and when. No editorializing.

2. Current focus (facts): State what is in progress right now. Reference "In progress" items. Note any stale in-progress tasks flagged in the ANALYSIS section — state how long they have been open and what they block, without characterizing this as good or bad.

3. What is next (facts + projection): Describe upcoming work from "Up next" items and milestone projections. State confidence ranges. If the ANALYSIS section includes t-shirt sizing estimates for unestimated tasks, incorporate those numbers (e.g., "of the N remaining tasks, roughly X appear small and Y appear substantially larger based on historical patterns").

4. Risks and observations (grounded analysis): Answer these specific questions using ONLY the ANALYSIS section data:
   - Are any in-progress tasks older than 2x the median cycle time? Name them.
   - Are there tasks that block other work and are not yet started? Name them.
   - Has velocity changed in the last two weeks vs the two before? State the numbers.
   - What percentage of remaining tasks lack estimates, and what does the inferred size distribution suggest about timeline reliability?
   Skip any question where the data has no answer. Do not pad with generic observations.

Keep the entire response under 500 words.

TONE: Direct and factual. Professional but not performative. Trust the reader to draw their own conclusions from clearly stated facts.`;

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
