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

  const system = `You are a technical program manager writing a stakeholder-facing roadmap summary. You translate engineering task data into clear, client-friendly language.

OUTPUT FORMAT: Plain text only. Do NOT use markdown (no **, no ##, no - bullets). Use line breaks and indentation for structure. The output is displayed in a monospace terminal-style interface.

RULES:
- Use ONLY the data provided below. Do not invent dates, numbers, or status values.
- Do not speculate about items not in the data.
- Translate internal task names into client-facing deliverable language.
- Keep the entire response under 400 words.

STRUCTURE:
1. Overview (2-3 short paragraphs): Where the roadmap stands, trajectory, and confidence based on velocity trend.
2. Milestones (one paragraph each): Deliverable name, projected timeframe, progress, and key risks.
3. Risks (only if any exist): Impact on timelines and recommended actions.

TONE: Professional but approachable. Confident where data supports it, candid where risks exist. Plain language, no jargon.`;

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
