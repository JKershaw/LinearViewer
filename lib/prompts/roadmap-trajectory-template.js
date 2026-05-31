/**
 * Roadmap trajectory prompt template (layer 3a of the five-layer pipeline).
 *
 * Instructs the LLM to extrapolate forward from the technical and product
 * narratives — describing the *implicit* direction of travel suggested by
 * current work, hedged and aspirational, but explicitly NOT a recommendation.
 *
 * This layer chains from layers 1 (technical) and 2 (product), folding both
 * into the user message alongside the deterministic data summary. The
 * critical design constraint is that every projection must be hedged and
 * that the model is permitted (and encouraged) to say so when the data is
 * mixed or incoherent rather than forcing a synthetic direction.
 *
 * Output is plain text (no markdown) to match the monospace UI.
 */

import { summarizeRoadmapModel } from './roadmap-narrative-template.js';
import { analyzeRoadmap } from '../roadmap.js';

/**
 * Summarize the observed delivery pace for the trajectory layer.
 *
 * The deterministic layer computes rich temporal signals (velocity trend,
 * recent-vs-prior shift, cycle time) but the shared model summary surfaces
 * only the flat 90-day tasks/week average. The trajectory layer is the one
 * place that reasons about "how fast / which way the vector is moving", so it
 * gets these signals explicitly — grounding hedged extrapolation in the actual
 * pace instead of vague "if this continues" hand-waving.
 *
 * All values are observed/past-tense measurements, never forecasts.
 *
 * @param {Object} model - The deterministic roadmap model
 * @returns {string} A plain-text DELIVERY PACE block (empty string if no data)
 */
export function summarizeTrajectoryPace(model) {
  const v = model.velocity || {};
  const analysis = analyzeRoadmap({
    milestones: model.milestones || [],
    velocity: v,
    criticalPaths: model.criticalPaths || {}
  });

  const lines = ['DELIVERY PACE (observed — measurement of the past, not a forecast)'];
  lines.push(`  Tasks shipped per week (90-day avg): ${v.tasksPerWeek ?? 0}`);
  if (v.trend) {
    lines.push(`  Velocity trend: ${v.trend}`);
  }
  if (analysis.velocityShift) {
    const s = analysis.velocityShift;
    const dir = s.pctChange > 0 ? `up ${s.pctChange}%`
      : s.pctChange < 0 ? `down ${Math.abs(s.pctChange)}%`
      : 'flat';
    lines.push(`  Recent shift: last 2 weeks ${s.recentAvg}/wk vs prior 2 weeks ${s.priorAvg}/wk (${dir})`);
  }
  if (analysis.cycleTime) {
    const c = analysis.cycleTime;
    lines.push(`  Typical cycle time: ${c.medianDays}d median (avg ${c.avgDays}d, sample ${c.sampleSize} tasks)`);
  }

  return lines.join('\n');
}

/**
 * Build messages array for generating a roadmap trajectory reading.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model
 * @param {string} tech - Layer 1 technical narrative (verbatim)
 * @param {string} product - Layer 2 product narrative (verbatim)
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapTrajectoryMessages(roadmapModel, tech, product) {
  const summary = summarizeRoadmapModel(roadmapModel);
  const pace = summarizeTrajectoryPace(roadmapModel);

  const system = `You are a strategist reading the direction of travel forward from a body of shipped and in-progress work. Your job is to extrapolate where the current vector points if it continues — an aspirational, forward-looking reading of the work's implicit trajectory.

OUTPUT: Plain text paragraphs. No markdown. The output renders in a monospace terminal interface, so use line breaks for structure.

CRITICAL DISTINCTION — implicit direction, not recommended direction:
Describe where the current vector points if extended, not what should happen. This is the *implicit* direction the work is already pointing, read forward. It is not advice, not a recommendation, and not a plan. If you slip into "the team should..." or "the next step is..." you have left the assignment. The reader will form their own opinions about whether the implicit direction is the right one; your job is only to make that direction legible.

HEDGING — every projection must be qualified:
Unqualified future statements are forbidden. Every forward-looking claim must be hedged with language like "at this pace", "if this continues", "the work suggests a direction toward", "this points toward", or similar qualifications. You are reading a vector, not predicting a destination. Phrases like "will become" or "by next quarter" without hedging are not allowed.

WHEN THE DATA IS MIXED OR SCATTERED:
If the recent work and in-progress work do not cohere into a single direction — if it looks mixed, scattered, or incoherent — say so. Naming that the vector is unclear is more honest than forcing a synthetic story. Do not manufacture a direction the data does not support. A short, honest "the direction is mixed because X and Y point different ways" is a valid output.

GROUND THE PACE — characterize how fast the vector is moving:
You are given a DELIVERY PACE block with observed metrics: tasks shipped per week, velocity trend, any recent shift (last 2 weeks vs prior 2 weeks), and typical cycle time. Use these to characterize HOW FAST and in WHICH DIRECTION the current vector is moving — for example "at the current pace of N tasks/week, with velocity trending up" or "cadence has slowed, so the direction firms up more slowly than it did". This is observed, past-tense measurement, not a forecast. Prefer grounding hedged direction in this actual pace over generic "if this continues" phrasing when the pace data is present. If the pace data is sparse (e.g. only an average, no trend), do not over-read it.

RULES:
- Use ONLY the data, technical narrative, and product narrative provided. Do not invent shipped work, milestones, or themes.
- Use the original task and project names from the data on first mention. After a task or project has been introduced by its full name, you may refer to it by a short, recognizable short-form (e.g. its first few distinctive words) so the prose does not read like a list of database keys. Do not invent new names, and never alter identifiers like LIN-123.
- Cite specific shipped or in-progress items when making a trajectory claim. Vague claims are not claims.
- Allow value-rich, aspirational language — this layer is the place for that — but anchor every value claim to specific work already visible in the data.
- Do not produce forecasts: no completion dates, no weeks-remaining, no story-point totals, no "by next quarter" numbers. You MAY cite the observed delivery pace (tasks/week, trend, recent shift, cycle time) from the DELIVERY PACE block as evidence of how fast the current vector is already moving — that is measurement of the past, not prediction of the future.

REASONING:
Before writing the trajectory, output a REASONING section where you work through the inputs:
- What direction does the recently shipped work point toward, if extended?
- Does the in-progress work reinforce that direction or pull against it?
- Is there a coherent vector, or is the work mixed/scattered? If mixed, name why.
- Which specific items would you cite as evidence of the implicit direction?

Then write the trajectory below it, separated by a blank line.

TRAJECTORY STRUCTURE:
A few short paragraphs, plain text. Open by naming the direction the work points toward, hedged. Walk through which specific projects and items make that direction visible. If a project is on a different vector from the rest, name that. If the overall picture is mixed, say so plainly rather than smoothing it over.

TONE: Aspirational where the data supports it, hedged everywhere, honest when the data is mixed. You are making the implicit direction legible — not selling it, not recommending it.`;

  const user = `Here is the deterministic roadmap data:

${summary}

${pace}

Here is the technical narrative (layer 1):

${tech}

Here is the product narrative (layer 2):

${product}

Write the trajectory reading — where the current vector points if extended, hedged throughout.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapTrajectoryPrompt(roadmapModel, tech, product) {
  const messages = buildRoadmapTrajectoryMessages(roadmapModel, tech, product);
  return messages.map(m => m.content).join('\n\n');
}
