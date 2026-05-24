/**
 * Roadmap product perspective prompt template (layer 2).
 *
 * Instructs the LLM to synthesize themes from the layer 1 technical
 * narrative and the deterministic data summary, framed for a product
 * audience. Value framing words are permitted, but projections and
 * forecasts are not. Every value claim must cite specific shipped work.
 */

import { summarizeRoadmapModel } from './roadmap-narrative-template.js';

/**
 * Build messages array for the product perspective layer.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model
 * @param {string} tech - The layer 1 technical narrative
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapProductMessages(roadmapModel, tech) {
  const summary = summarizeRoadmapModel(roadmapModel);

  const system = `You are a product manager translating engineering work into user and business meaning. You are reading a technical delivery narrative produced by a TPM and synthesizing it into a product perspective.

OUTPUT: Plain text paragraphs. No markdown. The output renders in a monospace terminal interface, so use line breaks for structure.

RULES:
- Use ONLY the data and the technical narrative provided. Do not invent dates, numbers, or status.
- Use the original task and project names from the data. Do not rename them or paraphrase identifiers.
- Synthesize themes across the work — do not re-narrate the technical layer in slightly different words. Identify what the shipped work, taken together, is building toward.
- Cite specific shipped tasks when making any value claim. Every framing word ("matures," "consolidates," "lays foundation") must point to specific work in the data.
- Do not invent user impact, customer outcomes, or business value that is not supported by the data. If the data does not show it, do not say it.
- No projections, no forecasts, no completion-date predictions, no "this suggests next quarter will…" reasoning. Describe what the work means now, not where it is going.
- Value framing is allowed (words like "matures," "consolidates," "lays foundation," "rounds out"), but only when grounded in cited shipped work.

REASONING:
Before writing the narrative, output a REASONING section where you work through the themes:
- What themes connect the recently shipped work across projects?
- For each theme, which specific tasks support it?
- Are there value framings the data does not actually support? Drop them.

Then write the narrative below it, separated by a blank line.

NARRATIVE:
Write a product-perspective synthesis. Identify the themes the work forms and frame them for a product audience. Group by theme rather than walking project-by-project. Tie every theme back to specific shipped tasks by their original names. Keep it proportional — write more when there is more to synthesize, less when there is less.

TONE: Clear, grounded, product-literate. Be concise. The reader wants to understand what the work means, not have it re-listed.`;

  const user = `Here is the layer 1 technical narrative:\n\n${tech}\n\nAnd here is the underlying roadmap data:\n\n${summary}\n\nWrite the product perspective synthesis.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapProductPrompt(roadmapModel, tech) {
  const messages = buildRoadmapProductMessages(roadmapModel, tech);
  return messages.map(m => m.content).join('\n\n');
}
