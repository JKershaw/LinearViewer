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

  const system = `You are a strategist reading the direction of travel forward from a body of shipped and in-progress work. Your job is to extrapolate where the current vector points if it continues — an aspirational, forward-looking reading of the work's implicit trajectory.

OUTPUT: Plain text paragraphs. No markdown. The output renders in a monospace terminal interface, so use line breaks for structure.

CRITICAL DISTINCTION — implicit direction, not recommended direction:
Describe where the current vector points if extended, not what should happen. This is the *implicit* direction the work is already pointing, read forward. It is not advice, not a recommendation, and not a plan. If you slip into "the team should..." or "the next step is..." you have left the assignment. The reader will form their own opinions about whether the implicit direction is the right one; your job is only to make that direction legible.

HEDGING — every projection must be qualified:
Unqualified future statements are forbidden. Every forward-looking claim must be hedged with language like "at this pace", "if this continues", "the work suggests a direction toward", "this points toward", or similar qualifications. You are reading a vector, not predicting a destination. Phrases like "will become" or "by next quarter" without hedging are not allowed.

WHEN THE DATA IS MIXED OR SCATTERED:
If the recent work and in-progress work do not cohere into a single direction — if it looks mixed, scattered, or incoherent — say so. Naming that the vector is unclear is more honest than forcing a synthetic story. Do not manufacture a direction the data does not support. A short, honest "the direction is mixed because X and Y point different ways" is a valid output.

RULES:
- Use ONLY the data, technical narrative, and product narrative provided. Do not invent shipped work, milestones, or themes.
- Use the original task and project names from the data. Do not rename them or paraphrase identifiers.
- Cite specific shipped or in-progress items when making a trajectory claim. Vague claims are not claims.
- Allow value-rich, aspirational language — this layer is the place for that — but anchor every value claim to specific work already visible in the data.
- Do not discuss estimates, story points, dates of completion, or weeks-remaining forecasts. Hedged direction, not numeric prediction.

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
